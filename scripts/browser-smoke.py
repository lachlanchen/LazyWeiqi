#!/usr/bin/env python3
"""Visible end-to-end smoke through the dedicated noVNC Chrome/CDP session."""

from __future__ import annotations

import fcntl
import ipaddress
import json
import os
import re
import stat
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from playwright.sync_api import Page, sync_playwright

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RUNTIME_DIR = (PROJECT_ROOT / ".local/runtime/browser").resolve()
RUNTIME_OWNER_VALUE = "weiqi-browser-runtime-v1"


def _validated_runtime_dir(raw: str | os.PathLike[str]) -> Path:
    requested = Path(raw).expanduser()
    if requested.is_symlink():
        raise ValueError("WEIQI_NOVNC_RUNTIME_DIR must not be a symbolic link")
    target = requested.resolve(strict=False)
    forbidden = {Path("/"), Path.home().resolve(), PROJECT_ROOT}
    if target in forbidden or target.parent == Path("/"):
        raise ValueError("WEIQI_NOVNC_RUNTIME_DIR must be a dedicated child directory")
    if target.exists() and not target.is_dir():
        raise ValueError("WEIQI_NOVNC_RUNTIME_DIR must be a directory")
    owner_marker = target / ".weiqi-runtime-owner"
    if owner_marker.is_symlink() or (
        owner_marker.exists() and not owner_marker.is_file()
    ):
        raise ValueError("browser runtime ownership marker must be a regular file")
    if owner_marker.is_file():
        if owner_marker.read_text(encoding="ascii").strip() != RUNTIME_OWNER_VALUE:
            raise ValueError("WEIQI_NOVNC_RUNTIME_DIR has a foreign ownership marker")
    elif (
        target.is_dir()
        and target != DEFAULT_RUNTIME_DIR
        and next(target.iterdir(), None) is not None
    ):
        raise ValueError("existing WEIQI_NOVNC_RUNTIME_DIR is not owned by Weiqi")
    evidence = target / "evidence"
    if evidence.is_symlink():
        raise ValueError("browser evidence directory must not be a symbolic link")
    if evidence.exists() and not evidence.is_dir():
        raise ValueError("browser evidence path must be a directory")
    return target


RUNTIME_DIR = _validated_runtime_dir(
    os.environ.get("WEIQI_NOVNC_RUNTIME_DIR", DEFAULT_RUNTIME_DIR)
)
EVIDENCE_DIR = RUNTIME_DIR / "evidence"
CDP_PORT = int(os.environ.get("WEIQI_NOVNC_CDP_PORT", "9471"))
APP_PORT = int(os.environ.get("WEIQI_PORT", "8010"))
NOVNC_PORT = int(os.environ.get("WEIQI_NOVNC_PORT", "6131"))
CDP_URL = f"http://127.0.0.1:{CDP_PORT}"
APP_URL = f"http://127.0.0.1:{APP_PORT}/"
LONG_TIMEOUT_MS = 180_000
BACKGROUND_NETWORK_PATTERN = re.compile(
    r"(?:google_apis/gcm|\bgcm\b|\bfcm\b|registration (?:response|url)|"
    r"mcs endpoint|mtalk\.google)",
    re.IGNORECASE,
)
KNOWN_BLOCKED_BACKGROUND_PATTERNS = (
    re.compile(r"Failed to connect to MCS endpoint with error -130\b", re.IGNORECASE),
    re.compile(r"Registration URL fetching failed\b", re.IGNORECASE),
)
GAME_ID_PATTERN = re.compile(r"^game_[0-9a-f]{32}$")
SMOKE_LEDGER_NAME = ".smoke-games.json"
SMOKE_LEDGER_VERSION = 1
MAX_SMOKE_GAMES = 16
MAX_LEDGER_BYTES = 16 * 1024
MAX_API_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_GAME_LIST_PAGES = 100
MAX_BACKGROUND_LOG_BYTES = 4 * 1024 * 1024
CRASHPAD_LAUNCH_WINDOW_SECONDS = 60
EXPECTED_LOCALE_OPTIONS = [
    ["en", "English"],
    ["ar", "العربية"],
    ["es", "Español"],
    ["fr", "Français"],
    ["ja", "日本語"],
    ["ko", "한국어"],
    ["vi", "Tiếng Việt"],
    ["zh-Hans", "简体中文"],
    ["zh-Hant", "繁體中文"],
    ["de", "Deutsch"],
    ["ru", "Русский"],
]


def _prepare_runtime_dir() -> None:
    RUNTIME_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    RUNTIME_DIR.chmod(0o700)
    marker = RUNTIME_DIR / ".weiqi-runtime-owner"
    if not marker.exists():
        temporary = RUNTIME_DIR / f".weiqi-runtime-owner.part.{os.getpid()}"
        temporary.write_text(RUNTIME_OWNER_VALUE + "\n", encoding="ascii")
        temporary.chmod(0o600)
        temporary.replace(marker)
    if (
        marker.is_symlink()
        or not marker.is_file()
        or marker.read_text(encoding="ascii").strip() != RUNTIME_OWNER_VALUE
    ):
        raise ValueError("browser runtime ownership could not be established")
    marker.chmod(0o600)


@contextmanager
def exclusive_smoke_run() -> Iterator[None]:
    """Prevent two visible workflows from driving the shared browser together."""

    _prepare_runtime_dir()
    lock_path = RUNTIME_DIR / ".smoke.lock"
    flags = os.O_CREAT | os.O_RDWR | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(lock_path, flags, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise RuntimeError("browser smoke lock must be a regular file")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError("another browser smoke is already running") from exc
        yield
    finally:
        os.close(descriptor)


def _run_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f") + f"-{os.getpid()}"


def _process_start_ticks(process_id: int) -> int | None:
    try:
        raw = Path(f"/proc/{process_id}/stat").read_text(encoding="ascii")
        tail = raw.rsplit(")", 1)[1].split()
        return int(tail[19])
    except (IndexError, OSError, ValueError):
        return None


def _crashpad_start_is_related(
    chrome_start_ticks: int, handler_start_ticks: int, ticks_per_second: int
) -> bool:
    early_tolerance = 2 * ticks_per_second
    launch_window = CRASHPAD_LAUNCH_WINDOW_SECONDS * ticks_per_second
    delta = handler_start_ticks - chrome_start_ticks
    return -early_tolerance <= delta <= launch_window


def _is_owned_chrome_crashpad(executable: Path, process_name: str) -> bool:
    return (
        executable.parent == Path("/opt/google/chrome")
        and executable.name == "chrome_crashpad_handler"
        and process_name in {"chrome_crashpad", "chrome_crashpad_handler"}
    )


def _related_crashpad_handler_ids(root_pid: int) -> set[int]:
    chrome_start = _process_start_ticks(root_pid)
    if chrome_start is None:
        raise RuntimeError("owned Chrome start time is unavailable")
    ticks_per_second = int(os.sysconf("SC_CLK_TCK"))
    related: set[int] = set()
    for process_path in Path("/proc").glob("[0-9]*"):
        try:
            process_id = int(process_path.name)
            executable = (process_path / "exe").resolve(strict=True)
            process_name = (process_path / "comm").read_text(encoding="ascii").strip()
        except (OSError, ValueError):
            continue
        if not _is_owned_chrome_crashpad(executable, process_name):
            continue
        handler_start = _process_start_ticks(process_id)
        if handler_start is not None and _crashpad_start_is_related(
            chrome_start, handler_start, ticks_per_second
        ):
            related.add(process_id)
    return related


def _unexpected_crashpad_handlers() -> list[str]:
    pid_path = RUNTIME_DIR / "chrome.pid"
    if pid_path.is_symlink() or not pid_path.is_file():
        raise RuntimeError("owned Chrome PID file is unavailable")
    root_pid = int(pid_path.read_text(encoding="ascii").strip())
    return [
        f"crashpad handler pid {process_id} started in the owned Chrome launch window"
        for process_id in sorted(_related_crashpad_handler_ids(root_pid))
    ]


def _browser_process_ids() -> set[int]:
    pid_path = RUNTIME_DIR / "chrome.pid"
    if pid_path.is_symlink() or not pid_path.is_file():
        raise RuntimeError("owned Chrome PID file is unavailable")
    root_pid = int(pid_path.read_text(encoding="ascii").strip())
    known = {root_pid}
    changed = True
    while changed:
        changed = False
        for status_path in Path("/proc").glob("[0-9]*/status"):
            try:
                lines = status_path.read_text(encoding="utf-8").splitlines()
                process_id = int(status_path.parent.name)
                parent_line = next(line for line in lines if line.startswith("PPid:"))
                parent_id = int(parent_line.split()[1])
            except (OSError, StopIteration, ValueError):
                continue
            if parent_id in known and process_id not in known:
                known.add(process_id)
                changed = True
    return known | _related_crashpad_handler_ids(root_pid)


def _crashpad_handler_binding(command: bytes) -> int | None:
    match = re.search(
        rb"(?:^|\x00)--crashpad-handler-pid=([1-9][0-9]*)(?:\x00|$)", command
    )
    return int(match.group(1)) if match else None


def _unexpected_crashpad_bindings() -> list[str]:
    bindings: list[str] = []
    for process_id in sorted(_browser_process_ids()):
        try:
            handler_id = _crashpad_handler_binding(
                Path(f"/proc/{process_id}/cmdline").read_bytes()
            )
        except OSError:
            continue
        if handler_id is not None:
            bindings.append(
                f"owned browser pid {process_id} is bound to crashpad handler {handler_id}"
            )
    return bindings


def _unexpected_browser_sockets() -> list[str]:
    browser_pids = _browser_process_ids()
    unexpected: list[str] = []
    commands = (
        ("tcp", ["ss", "-Hntp", "state", "established"]),
        ("udp", ["ss", "-Hunap"]),
    )
    for protocol, command in commands:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        for line in completed.stdout.splitlines():
            line_pids = {int(item) for item in re.findall(r"pid=(\d+)", line)}
            if not line_pids.intersection(browser_pids):
                continue
            fields = line.split()
            if len(fields) < 4:
                unexpected.append(f"unreadable {protocol} browser socket")
                continue
            endpoint = fields[3]
            if endpoint.endswith(":*"):
                continue
            host = endpoint.rsplit(":", 1)[0].strip("[]").split("%", 1)[0]
            try:
                address = ipaddress.ip_address(host)
                is_loopback = address.is_loopback or address.is_unspecified
            except ValueError:
                is_loopback = host.lower() == "localhost"
            if not is_loopback:
                unexpected.append(f"external {protocol} browser peer {endpoint}")
    return unexpected


def _sanitize_log_entry(value: str) -> str:
    value = " ".join(value.replace("\x00", " ").split())
    value = re.sub(
        r"https?://[^\s]+",
        lambda match: _safe_request_label("URL", match.group(0)),
        value,
    )
    value = re.sub(
        r"(?i)\b(token|key|secret|password)=([^\s&]+)",
        r"\1=<redacted>",
        value,
    )
    return value[:240]


def _background_network_log_report() -> dict[str, Any]:
    log_path = RUNTIME_DIR / "logs/chrome.log"
    if log_path.is_symlink() or not log_path.is_file():
        return {"quiet": True, "known_blocked": True, "evidence": [], "unexpected": []}
    size = log_path.stat().st_size
    if size > MAX_BACKGROUND_LOG_BYTES:
        evidence = [
            f"Chrome log exceeds bounded scan limit ({MAX_BACKGROUND_LOG_BYTES} bytes)"
        ]
        return {
            "quiet": False,
            "known_blocked": False,
            "evidence": evidence,
            "unexpected": evidence,
        }
    matches = [
        line.strip()
        for line in log_path.read_text(encoding="utf-8", errors="replace").splitlines()
        if BACKGROUND_NETWORK_PATTERN.search(line)
    ]
    unexpected = [
        line
        for line in matches
        if not any(
            pattern.search(line) for pattern in KNOWN_BLOCKED_BACKGROUND_PATTERNS
        )
    ]
    return {
        "quiet": not matches,
        "known_blocked": not unexpected,
        "evidence": [_sanitize_log_entry(line) for line in matches[-10:]],
        "unexpected": [_sanitize_log_entry(line) for line in unexpected[-10:]],
    }


def _background_network_contained(
    report: dict[str, Any], external_sockets: list[str], external_requests: list[str]
) -> bool:
    return bool(
        report["known_blocked"] and not external_sockets and not external_requests
    )


def _loopback_http_url(value: str) -> bool:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"}:
        return True
    if parsed.hostname is None:
        return False
    if parsed.hostname.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(parsed.hostname).is_loopback
    except ValueError:
        return False


def _safe_request_label(method: str, value: str) -> str:
    parsed = urlsplit(value)
    hostname = parsed.hostname or "invalid-host"
    if ":" in hostname:
        hostname = f"[{hostname}]"
    try:
        parsed_port = parsed.port
    except ValueError:
        parsed_port = None
        hostname = "invalid-host"
    port = f":{parsed_port}" if parsed_port is not None else ""
    path = parsed.path[:160]
    return f"{method} {parsed.scheme}://{hostname}{port}{path}"


def _ledger_path() -> Path:
    path = RUNTIME_DIR / SMOKE_LEDGER_NAME
    if path.parent.resolve(strict=False) != RUNTIME_DIR.resolve(strict=False):
        raise RuntimeError("smoke ledger escaped the owned runtime directory")
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise RuntimeError("smoke ledger must be a regular file")
    return path


def _atomic_private_json(path: Path, payload: dict[str, Any]) -> None:
    if path != _ledger_path():
        raise RuntimeError("refusing to write an unowned smoke ledger path")
    encoded = (
        json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n"
    ).encode()
    if len(encoded) > MAX_LEDGER_BYTES:
        raise RuntimeError("smoke ledger exceeds its size bound")
    temporary = path.parent / f".{path.name}.part.{os.getpid()}.{os.urandom(8).hex()}"
    if temporary.is_symlink() or temporary.exists():
        raise RuntimeError("smoke ledger temporary path is unsafe")
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(temporary, flags, 0o600)
    try:
        with os.fdopen(descriptor, "wb", closefd=False) as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.close(descriptor)
        descriptor = -1
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise RuntimeError("smoke ledger target changed while writing")
        temporary.replace(path)
        path.chmod(0o600)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if temporary.exists() and not temporary.is_symlink():
            temporary.unlink()


def _read_private_json(path: Path) -> dict[str, Any]:
    if path != _ledger_path():
        raise RuntimeError("refusing to read an unowned smoke ledger path")
    flags = os.O_RDONLY | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise RuntimeError("smoke ledger must be a regular file")
        if metadata.st_size > MAX_LEDGER_BYTES:
            raise RuntimeError("smoke ledger exceeds its size bound")
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "rb", closefd=False) as handle:
            raw = handle.read(MAX_LEDGER_BYTES + 1)
    finally:
        os.close(descriptor)
    if len(raw) > MAX_LEDGER_BYTES:
        raise RuntimeError("smoke ledger exceeds its size bound")
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise TypeError("smoke ledger has an invalid shape")
    return parsed


def _validated_ledger_games(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if payload.get("version") != SMOKE_LEDGER_VERSION:
        raise RuntimeError("smoke ledger has an unsupported version")
    run_id = payload.get("run_id")
    games = payload.get("games")
    if not isinstance(run_id, str) or not re.fullmatch(r"[0-9A-Za-z_-]{1,96}", run_id):
        raise RuntimeError("smoke ledger has an invalid run id")
    if not isinstance(games, list) or len(games) > MAX_SMOKE_GAMES:
        raise RuntimeError("smoke ledger has an invalid game list")
    validated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in games:
        if not isinstance(item, dict) or set(item) != {"id", "revision"}:
            raise RuntimeError("smoke ledger contains an invalid entry")
        game_id = item.get("id")
        revision = item.get("revision")
        if (
            not isinstance(game_id, str)
            or not GAME_ID_PATTERN.fullmatch(game_id)
            or isinstance(revision, bool)
            or not isinstance(revision, int)
            or not 1 <= revision <= 1_000_000
            or game_id in seen
        ):
            raise RuntimeError("smoke ledger contains an invalid entry")
        seen.add(game_id)
        validated.append({"id": game_id, "revision": revision})
    return validated


class LoopbackGameApi:
    def __init__(self) -> None:
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def _request(
        self, method: str, path: str, payload: dict[str, Any] | None = None
    ) -> tuple[int, dict[str, Any]]:
        url = urllib.parse.urljoin(APP_URL, path.lstrip("/"))
        if not _loopback_http_url(url):
            raise RuntimeError("smoke cleanup API must remain loopback-only")
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            method=method,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
        )
        try:
            response = self._opener.open(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read(MAX_API_RESPONSE_BYTES + 1)
            status = response.status
        if len(raw) > MAX_API_RESPONSE_BYTES:
            raise RuntimeError("smoke cleanup API response exceeded its bound")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError as error:
            raise RuntimeError("smoke cleanup API returned invalid JSON") from error
        if not isinstance(parsed, dict):
            raise TypeError("smoke cleanup API returned an invalid shape")
        return status, parsed

    def list_game_ids(self) -> set[str]:
        cursor: str | None = None
        cursors: set[str] = set()
        game_ids: set[str] = set()
        for _page in range(MAX_GAME_LIST_PAGES):
            query = {"limit": "100"}
            if cursor is not None:
                query["cursor"] = cursor
            status, payload = self._request(
                "GET", "/api/games?" + urllib.parse.urlencode(query)
            )
            if status != 200 or not isinstance(payload.get("games"), list):
                raise RuntimeError(f"game history baseline failed with HTTP {status}")
            for item in payload["games"]:
                game_id = item.get("id") if isinstance(item, dict) else None
                if not isinstance(game_id, str) or not GAME_ID_PATTERN.fullmatch(
                    game_id
                ):
                    raise RuntimeError("game history baseline returned an invalid id")
                if game_id in game_ids:
                    raise RuntimeError("game history baseline returned a duplicate id")
                game_ids.add(game_id)
            next_cursor = payload.get("next_cursor")
            if next_cursor is None:
                return game_ids
            if (
                not isinstance(next_cursor, str)
                or not next_cursor
                or len(next_cursor) > 512
                or next_cursor in cursors
            ):
                raise RuntimeError("game history baseline returned an invalid cursor")
            cursors.add(next_cursor)
            cursor = next_cursor
        raise RuntimeError("game history baseline exceeded its page bound")

    def delete_latest(self, game_id: str) -> None:
        if not GAME_ID_PATTERN.fullmatch(game_id):
            raise RuntimeError("refusing to delete an invalid smoke game id")
        encoded_id = urllib.parse.quote(game_id, safe="")
        for _attempt in range(3):
            status, current = self._request("GET", f"/api/games/{encoded_id}")
            if status == 404:
                return
            revision = current.get("revision")
            if (
                status != 200
                or isinstance(revision, bool)
                or not isinstance(revision, int)
            ):
                raise RuntimeError(f"smoke game lookup failed with HTTP {status}")
            deleted_status, _receipt = self._request(
                "DELETE",
                f"/api/games/{encoded_id}",
                {"expected_revision": revision},
            )
            if deleted_status in {200, 404}:
                return
            if deleted_status != 409:
                raise RuntimeError(
                    f"smoke game deletion failed with HTTP {deleted_status}"
                )
        raise RuntimeError("smoke game kept changing during bounded cleanup")


class SmokeGameLedger:
    def __init__(self, run_id: str, games: list[dict[str, Any]] | None = None) -> None:
        if not re.fullmatch(r"[0-9A-Za-z_-]{1,96}", run_id):
            raise RuntimeError("invalid smoke run id")
        self.run_id = run_id
        self.games = list(games or [])

    @classmethod
    def load(cls) -> SmokeGameLedger | None:
        path = _ledger_path()
        if not path.exists():
            return None
        payload = _read_private_json(path)
        return cls(str(payload.get("run_id", "")), _validated_ledger_games(payload))

    def _persist(self) -> None:
        if not self.games:
            path = _ledger_path()
            if path.exists():
                path.unlink()
            return
        _atomic_private_json(
            _ledger_path(),
            {
                "version": SMOKE_LEDGER_VERSION,
                "run_id": self.run_id,
                "games": self.games,
            },
        )

    def record(self, game_id: str, revision: int) -> None:
        entry = {"id": game_id, "revision": revision}
        _validated_ledger_games(
            {"version": SMOKE_LEDGER_VERSION, "run_id": self.run_id, "games": [entry]}
        )
        for existing in self.games:
            if existing["id"] == game_id:
                existing["revision"] = max(existing["revision"], revision)
                self._persist()
                return
        if len(self.games) >= MAX_SMOKE_GAMES:
            raise RuntimeError("smoke run created too many game sessions")
        self.games.append(entry)
        self._persist()

    def cleanup(self, api: LoopbackGameApi) -> list[str]:
        errors: list[str] = []
        for entry in list(self.games):
            try:
                api.delete_latest(entry["id"])
                remaining = [item for item in self.games if item["id"] != entry["id"]]
                previous = self.games
                self.games = remaining
                try:
                    self._persist()
                except Exception:
                    self.games = previous
                    raise
            except Exception as error:  # noqa: BLE001 - retain a recoverable ledger
                errors.append(f"{entry['id']}: {type(error).__name__}: {error}")
                continue
        return errors


def _recover_stale_smoke_ledger(api: LoopbackGameApi) -> int:
    ledger = SmokeGameLedger.load()
    if ledger is None:
        return 0
    count = len(ledger.games)
    errors = ledger.cleanup(api)
    if errors:
        raise RuntimeError("prior smoke cleanup failed: " + "; ".join(errors))
    return count


@contextmanager
def cleanup_created_smoke_games(
    *,
    api: LoopbackGameApi,
    ledger: SmokeGameLedger,
    baseline_ids: set[str],
    page_reference: list[Page],
    checks: dict[str, Any],
    errors: list[str],
) -> Iterator[None]:
    """Always remove only response-recorded smoke games before releasing CDP."""

    browser_error: Exception | None = None
    try:
        yield
    except Exception as error:  # noqa: BLE001 - cleanup still owns the exact ledger
        browser_error = error
    finally:
        try:
            errors.extend(ledger.cleanup(api))
        except Exception as error:  # noqa: BLE001 - never mask the browser outcome
            errors.append(f"ledger cleanup failed: {type(error).__name__}: {error}")
        checks["smokeSessionsRemaining"] = len(ledger.games)
        try:
            after_ids = api.list_game_ids()
            checks["historyCountBefore"] = len(baseline_ids)
            checks["historyCountAfter"] = len(after_ids)
            checks["preexistingHistoryPreserved"] = after_ids == baseline_ids
            if after_ids != baseline_ids:
                errors.append(
                    "game history changed outside the exact smoke ledger "
                    f"(before={len(baseline_ids)}, after={len(after_ids)})"
                )
        except Exception as error:  # noqa: BLE001 - cleanup evidence must survive
            checks["preexistingHistoryPreserved"] = False
            errors.append(
                f"history baseline verification failed: {type(error).__name__}: {error}"
            )
        if page_reference:
            try:
                page = page_reference[0]
                page.goto(APP_URL, wait_until="networkidle")
                page.locator('[data-testid="app-root"][data-view="journey"]').wait_for(
                    state="visible", timeout=30_000
                )
                checks["browserRestoredToJourney"] = True
            except Exception as error:  # noqa: BLE001 - report, do not hide cleanup state
                checks["browserRestoredToJourney"] = False
                errors.append(
                    f"browser restore failed: {type(error).__name__}: {error}"
                )
    if browser_error is not None:
        if errors:
            raise RuntimeError(
                f"{type(browser_error).__name__}: {browser_error}; "
                f"smoke cleanup also failed: {errors}"
            ) from browser_error
        raise browser_error


def wait_idle(page: Page, timeout: int = LONG_TIMEOUT_MS) -> None:
    page.locator('[data-testid="app-root"][data-operation="idle"]').wait_for(
        state="visible", timeout=timeout
    )


def wait_turn_choices(page: Page, timeout: int = LONG_TIMEOUT_MS) -> None:
    """Wait for the revision-bound, read-only next-move comparison."""

    wait_idle(page, timeout)
    page.locator(".board-operation").wait_for(state="hidden", timeout=timeout)
    page.locator(".candidate-card").first.wait_for(state="visible", timeout=timeout)


def report_path(path: Path) -> str:
    try:
        return str(path.relative_to(PROJECT_ROOT))
    except ValueError:
        return str(path)


def screenshot(page: Page, timestamp: str, name: str, paths: list[str]) -> None:
    target = EVIDENCE_DIR / f"{timestamp}-{name}.png"
    # Playwright auto-scrolls controls into view. Reset before a full-page
    # capture so sticky navigation is composed at the actual page top instead
    # of appearing to bisect the board in the stitched evidence image.
    previous_scroll_behavior = page.evaluate(
        """() => {
          const previous = document.documentElement.style.scrollBehavior;
          document.documentElement.style.scrollBehavior = 'auto';
          window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
          return previous;
        }"""
    )
    page.wait_for_function("() => window.scrollY === 0")
    try:
        page.screenshot(path=str(target), full_page=True)
    finally:
        page.evaluate(
            "previous => { document.documentElement.style.scrollBehavior = previous; }",
            previous_scroll_behavior,
        )
    paths.append(report_path(target))


def start_first_visible_lesson(page: Page, board_size: int) -> None:
    page.get_by_test_id(f"board-size-{board_size}").click()
    campaign = page.get_by_test_id("campaign")
    if campaign.get_attribute("data-board-filter") != str(board_size):
        raise RuntimeError(
            f"campaign did not switch to the {board_size}x{board_size} route"
        )
    campaign.locator("article:not(.locked) .lesson-action").first.click()
    page.get_by_test_id("play-workspace").wait_for(state="visible", timeout=30_000)
    wait_turn_choices(page)


def wait_for_move_count(page: Page, minimum: int) -> None:
    page.wait_for_function(
        """minimum => document.querySelectorAll('.timeline-track > span').length >= minimum""",
        arg=minimum,
        timeout=LONG_TIMEOUT_MS,
    )
    wait_turn_choices(page)


def exercise_nineteen_opening(
    page: Page,
    context: Any,
    checks: dict[str, Any],
    screenshots: list[str],
    timestamp: str,
) -> None:
    """Exercise the state-bound 19x19 opening book through visible controls."""

    page.goto(f"{APP_URL}simple", wait_until="networkidle")
    page.locator(
        '[data-testid="app-root"][data-layout="simple"][data-view="journey"]'
    ).wait_for(state="visible", timeout=30_000)
    locale_select = page.get_by_test_id("locale-select").first
    locale_select.select_option("en")
    page.wait_for_function("document.documentElement.lang === 'en'")
    page.get_by_test_id("simple-board-size-19").click()
    page.get_by_test_id("simple-begin").click()
    page.locator(
        '[data-testid="play-workspace"][data-layout="simple"][data-board-size="19"]'
    ).wait_for(state="visible", timeout=LONG_TIMEOUT_MS)
    wait_turn_choices(page)
    reading = page.get_by_test_id("opening-reading")
    reading.wait_for(state="visible", timeout=LONG_TIMEOUT_MS)
    initial_suggestion_coordinate = page.get_by_test_id(
        "suggested-first-stone"
    ).get_attribute("data-coordinate")

    checks["opening19DefaultSuggestion"] = (
        page.get_by_test_id("app-root").get_attribute("data-engine-lane") == "19x19"
        and page.get_by_test_id("suggested-first-stone").is_visible()
        and page.get_by_test_id("opening-teaching-layers").count() == 1
        and page.get_by_test_id("opening-landscape-potential").count() == 1
        and page.get_by_test_id("opening-candidate-change-field").count() == 1
        and page.get_by_test_id("opening-potential-cloud").count() == 0
        and page.get_by_test_id("candidate-field-key").count() == 0
        and page.locator(".timeline-track > span").count() == 0
    )
    checks["opening19EvidenceSeparated"] = (
        page.get_by_test_id("opening-shape-exact").get_attribute("data-evidence")
        == "exact"
        and page.get_by_test_id("opening-territory-potential").get_attribute(
            "data-evidence"
        )
        == "calculated_potential"
        and page.get_by_test_id("opening-influence-potential").get_attribute(
            "data-evidence"
        )
        == "calculated_potential"
        and page.get_by_test_id("opening-follow-up-anchors").get_attribute(
            "data-evidence"
        )
        == "authored"
        and page.get_by_test_id("opening-landscape-potential").get_attribute(
            "data-not-ownership"
        )
        == "true"
        and page.get_by_test_id("opening-landscape-potential").get_attribute(
            "data-not-secured-territory"
        )
        == "true"
    )

    trigger = page.get_by_test_id("opening-details-trigger")
    trigger.focus()
    trigger.click()
    dialog = page.get_by_test_id("opening-dialog")
    dialog.wait_for(state="visible")
    checks["opening19DialogAccessible"] = (
        dialog.get_attribute("role") == "dialog"
        and dialog.get_attribute("aria-modal") == "true"
        and page.get_by_test_id("opening-dialog-close").evaluate(
            "element => document.activeElement === element"
        )
        and dialog.get_by_test_id("commit-move").count() == 0
        and page.get_by_test_id("opening-provenance-section").is_visible()
        and page.get_by_test_id("opening-engine-provenance").is_visible()
    )
    typography = dialog.evaluate(
        """dialog => {
          const minimum = selectors => Math.min(...selectors.flatMap(selector =>
            [...dialog.querySelectorAll(selector)].map(element =>
              Number.parseFloat(getComputedStyle(element).fontSize))
          ));
          return {
            main: minimum(['.opening-book-section > p', '.opening-why-grid p', '.opening-decision-grid p']),
            annotations: minimum(['.opening-evidence-cards small', '.opening-sequence-list small', '.opening-textbook-grid li small', '.opening-provenance-grid small']),
            internalScroll: getComputedStyle(dialog.querySelector('.opening-dialog-scroll')).overflowY === 'auto',
          };
        }"""
    )
    checks["opening19Typography"] = typography
    checks["opening19TypographyReadable"] = (
        typography["main"] >= 14.4
        and typography["annotations"] >= 12
        and typography["internalScroll"]
    )
    screenshot(page, timestamp, "opening-19-desktop-dialog", screenshots)
    page.keyboard.press("Escape")
    dialog.wait_for(state="hidden")
    checks["opening19FocusRestored"] = trigger.evaluate(
        "element => document.activeElement === element"
    )

    cdp = context.new_cdp_session(page)
    try:
        for label, width, height, mobile in (
            ("tablet", 768, 1024, False),
            ("mobile", 390, 844, True),
        ):
            cdp.send(
                "Emulation.setDeviceMetricsOverride",
                {
                    "width": width,
                    "height": height,
                    "deviceScaleFactor": 1,
                    "mobile": mobile,
                },
            )
            page.wait_for_timeout(400)
            trigger.click()
            dialog.wait_for(state="visible")
            geometry = page.evaluate(
                """() => {
                  const root = document.documentElement;
                  const dialog = document.querySelector('[data-testid="opening-dialog"]');
                  if (!(dialog instanceof HTMLElement)) return { fits: false, missing: true };
                  const box = dialog.getBoundingClientRect();
                  return {
                    fits: root.scrollWidth === root.clientWidth && box.left >= 0 &&
                      box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
                    scrollWidth: root.scrollWidth,
                    clientWidth: root.clientWidth,
                    dialogWidth: Math.round(box.width),
                    dialogHeight: Math.round(box.height),
                  };
                }"""
            )
            checks[f"opening19{label.title()}Geometry"] = geometry
            checks[f"opening19{label.title()}Fits"] = bool(geometry.get("fits"))
            screenshot(page, timestamp, f"opening-19-{label}-dialog", screenshots)
            page.keyboard.press("Escape")
            dialog.wait_for(state="hidden")

        locale_select.select_option("ar")
        page.wait_for_function(
            "document.documentElement.lang === 'ar' && document.documentElement.dir === 'rtl'"
        )
        trigger.click()
        dialog.wait_for(state="visible")
        arabic_text = dialog.inner_text()
        checks["opening19ArabicRtl"] = (
            page.locator("html").get_attribute("dir") == "rtl"
            and not any(
                phrase in arabic_text
                for phrase in (
                    "Why this move",
                    "Calculated potential",
                    "Illustrative context",
                    "Evidence and method",
                    "engine_evidence_not_attached",
                    "empty_board_opening",
                )
            )
            and "{" not in arabic_text
            and "}" not in arabic_text
        )
        screenshot(page, timestamp, "opening-19-arabic-mobile-dialog", screenshots)
        page.keyboard.press("Escape")
        dialog.wait_for(state="hidden")
        locale_select.select_option("en")
        page.wait_for_function("document.documentElement.lang === 'en'")
    finally:
        cdp.send("Emulation.clearDeviceMetricsOverride")
        cdp.detach()

    page.wait_for_timeout(400)
    page.locator('[data-testid="weiqi-board"] [data-coordinate="C16"]').click()
    page.locator(
        '[data-testid="play-workspace"][data-selection-state="move-preview"]'
        '[data-selected-coordinate="C16"]'
    ).wait_for(state="visible", timeout=LONG_TIMEOUT_MS)
    wait_idle(page)
    page.locator(".opening-reading-title span", has_text="C16").wait_for(
        state="visible", timeout=LONG_TIMEOUT_MS
    )
    moves_before = page.locator(".timeline-track > span").count()
    stones_before = page.locator('[data-testid="weiqi-board"] .stone').count()
    move_posts_before = page.evaluate(
        """() => performance.getEntriesByType('resource').filter(entry =>
          new URL(entry.name).pathname.endsWith('/moves')).length"""
    )
    page.get_by_test_id("opening-details-trigger").click()
    dialog.wait_for(state="visible")
    page.get_by_test_id("opening-deep-study-button").click()
    dialog.wait_for(state="hidden")
    wait_idle(page)
    answer = page.locator(".coach-exchange .coach-message.answer").last
    answer.wait_for(state="visible", timeout=LONG_TIMEOUT_MS)
    answer_text = answer.inner_text()
    move_posts_after = page.evaluate(
        """() => performance.getEntriesByType('resource').filter(entry =>
          new URL(entry.name).pathname.endsWith('/moves')).length"""
    )
    checks["opening19SelectedC16Study"] = (
        "C16" in answer_text
        and "empty_board_opening" not in answer_text
        and (
            initial_suggestion_coordinate == "C16"
            or f"Rules-verified legal candidate: {initial_suggestion_coordinate}."
            not in answer_text
        )
    )
    checks["opening19DeepStudyNoMutation"] = (
        page.locator(".timeline-track > span").count() == moves_before
        and page.locator('[data-testid="weiqi-board"] .stone').count() == stones_before
        and move_posts_after == move_posts_before
        and page.get_by_test_id("play-workspace").get_attribute(
            "data-selected-coordinate"
        )
        == "C16"
    )
    screenshot(page, timestamp, "opening-19-c16-deep-study", screenshots)
    page.keyboard.press("Escape")
    page.locator(
        '[data-testid="play-workspace"][data-selection-state="agent-suggestions"]'
    ).wait_for(state="visible")
    page.get_by_test_id("suggested-first-stone").wait_for(state="visible")
    checks["opening19StudyPreservesRootSuggestion"] = (
        initial_suggestion_coordinate is not None
        and page.get_by_test_id("suggested-first-stone").get_attribute(
            "data-coordinate"
        )
        == initial_suggestion_coordinate
        and page.locator(".timeline-track > span").count() == moves_before
    )


def run() -> dict[str, Any]:
    _prepare_runtime_dir()
    EVIDENCE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    EVIDENCE_DIR.chmod(0o700)
    timestamp = _run_timestamp()
    screenshots: list[str] = []
    checks: dict[str, Any] = {}
    console_errors: list[str] = []
    page_errors: list[str] = []
    request_failures: list[str] = []
    bad_responses: list[str] = []
    external_requests: list[str] = []
    response_record_errors: list[str] = []
    cleanup_errors: list[str] = []
    api = LoopbackGameApi()
    checks["recoveredPriorSmokeSessions"] = _recover_stale_smoke_ledger(api)
    baseline_game_ids = api.list_game_ids()
    ledger = SmokeGameLedger(timestamp)
    page_reference: list[Page] = []
    created_game_ids: list[str] = []

    with (
        sync_playwright() as playwright,
        cleanup_created_smoke_games(
            api=api,
            ledger=ledger,
            baseline_ids=baseline_game_ids,
            page_reference=page_reference,
            checks=checks,
            errors=cleanup_errors,
        ),
    ):
        browser = playwright.chromium.connect_over_cdp(CDP_URL)
        context = browser.contexts[0]
        pages = [
            candidate
            for candidate in context.pages
            if candidate.url.startswith(APP_URL)
        ]
        page = pages[0] if pages else context.new_page()
        page_reference.append(page)
        page.set_default_timeout(30_000)

        def handle_response(response: Any) -> None:
            if (
                response.url.startswith(("http://", "https://"))
                and response.status >= 400
            ):
                bad_responses.append(
                    f"{response.status} "
                    f"{_safe_request_label(response.request.method, response.url)}"
                )
            parsed = urlsplit(response.url)
            is_game_create = (
                response.request.method == "POST"
                and response.status == 201
                and parsed.path == "/api/games"
                and _loopback_http_url(response.url)
                and parsed.port == APP_PORT
            )
            if not is_game_create:
                return
            try:
                payload = response.json()
                game_id = payload.get("id") if isinstance(payload, dict) else None
                revision = (
                    payload.get("revision") if isinstance(payload, dict) else None
                )
                if (
                    not isinstance(game_id, str)
                    or isinstance(revision, bool)
                    or not isinstance(revision, int)
                ):
                    raise TypeError(
                        "create-game response omitted its exact id or revision"
                    )
                ledger.record(game_id, revision)
                created_game_ids.append(game_id)
            except Exception as error:  # noqa: BLE001 - cleanup must continue in finally
                response_record_errors.append(
                    f"created-game ledger record failed: {type(error).__name__}: {error}"
                )

        page.on(
            "console",
            lambda message: (
                console_errors.append(message.text) if message.type == "error" else None
            ),
        )
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on(
            "requestfailed",
            lambda request: (
                request_failures.append(
                    f"{_safe_request_label(request.method, request.url)}: "
                    f"{request.failure or 'failed'}"
                )
                if not request.url.startswith(
                    ("data:", "blob:", "chrome:", "devtools:")
                )
                else None
            ),
        )
        page.on(
            "request",
            lambda request: (
                external_requests.append(
                    _safe_request_label(request.method, request.url)
                )
                if not _loopback_http_url(request.url)
                else None
            ),
        )
        page.on("response", handle_response)
        page.bring_to_front()

        # The compact interface is the reloadable default. Its legacy /simple
        # alias remains available, and neither route may create a game.
        page.goto(APP_URL, wait_until="networkidle")
        page.locator(
            '[data-testid="app-root"][data-layout="simple"][data-view="journey"]'
        ).wait_for(state="visible")
        checks["simpleDefaultRoute"] = (
            urlsplit(page.url).path == "/"
            and page.get_by_test_id("simple-launcher").is_visible()
            and not created_game_ids
        )
        locale_select = page.get_by_test_id("locale-select").first
        checks["localeOptions"] = locale_select.locator("option").evaluate_all(
            "options => options.map(option => [option.value, option.textContent ?? ''])"
        )
        locale_metadata: list[dict[str, Any]] = []
        for locale, _label in EXPECTED_LOCALE_OPTIONS:
            locale_select.select_option(locale)
            page.wait_for_function(
                "locale => document.documentElement.lang === locale", arg=locale
            )
            metadata = page.evaluate(
                """locale => ({
                  locale,
                  lang: document.documentElement.lang,
                  dir: document.documentElement.dir,
                  title: document.title,
                  description: document.querySelector('meta[name="description"]')?.content ?? '',
                })""",
                locale,
            )
            locale_metadata.append(metadata)
        checks["localeMetadata"] = locale_metadata
        checks["localeMetadataValid"] = all(
            item["lang"] == item["locale"]
            and item["dir"] == ("rtl" if item["locale"] == "ar" else "ltr")
            and item["title"].startswith("Weiqi · ")
            and bool(item["description"].strip())
            for item in locale_metadata
        )
        locale_select.select_option("ar")
        page.wait_for_function("document.documentElement.dir === 'rtl'")
        arabic_launcher_text = page.get_by_test_id("simple-launcher").inner_text()
        checks["arabicAuthoredLessonLocalized"] = not any(
            english in arabic_launcher_text
            for english in (
                "Choose a Promise",
                "Your first real 9×9 opening",
                "A first move is a promise",
                "Choose any legal opening",
            )
        )
        screenshot(page, timestamp, "simple-launcher-arabic-desktop", screenshots)
        arabic_cdp = context.new_cdp_session(page)
        try:
            arabic_cdp.send(
                "Emulation.setDeviceMetricsOverride",
                {
                    "width": 390,
                    "height": 844,
                    "deviceScaleFactor": 1,
                    "mobile": True,
                },
            )
            page.wait_for_timeout(350)
            checks["arabicMobileFitsViewport"] = page.evaluate(
                """() => {
                  const root = document.documentElement;
                  const select = document.querySelector('[data-testid="locale-select"]');
                  if (!(select instanceof HTMLElement)) return false;
                  const rect = select.getBoundingClientRect();
                  return root.lang === 'ar' && root.dir === 'rtl' &&
                    root.scrollWidth === root.clientWidth &&
                    rect.width > 0 && rect.height >= 44 && rect.bottom <= innerHeight;
                }"""
            )
            screenshot(page, timestamp, "simple-launcher-arabic-mobile", screenshots)
        finally:
            arabic_cdp.send("Emulation.clearDeviceMetricsOverride")
            arabic_cdp.detach()
            page.wait_for_timeout(350)
        page.reload(wait_until="networkidle")
        locale_select = page.get_by_test_id("locale-select").first
        checks["localePersistence"] = (
            locale_select.input_value() == "ar"
            and page.locator("html").get_attribute("lang") == "ar"
            and page.locator("html").get_attribute("dir") == "rtl"
            and not created_game_ids
        )
        locale_select.select_option("en")
        page.wait_for_function("document.documentElement.lang === 'en'")
        page.goto(f"{APP_URL}simple/", wait_until="networkidle")
        root = page.get_by_test_id("app-root")
        root.wait_for(state="visible")
        page.locator(
            '[data-testid="app-root"][data-layout="simple"][data-view="journey"]'
        ).wait_for(state="visible")
        simple_launcher = page.get_by_test_id("simple-launcher")
        checks["simpleDirectRoute"] = (
            urlsplit(page.url).path == "/simple/"
            and simple_launcher.is_visible()
            and page.locator(".app-header").count() == 0
            and not created_game_ids
        )
        checks["simpleLauncherFitsViewport"] = page.evaluate(
            """() => {
              const root = document.documentElement;
              return root.scrollHeight === root.clientHeight &&
                root.scrollWidth === root.clientWidth;
            }"""
        )
        page.get_by_test_id("simple-nav-chronicle").click()
        page.get_by_test_id("chronicle").wait_for(state="visible")
        checks["simpleHistoryAccessible"] = page.evaluate(
            """() => {
              const root = document.documentElement;
              const main = document.querySelector('.app.is-simple > main');
              if (!(main instanceof HTMLElement)) return false;
              main.scrollTop = main.scrollHeight;
              return root.scrollHeight === root.clientHeight &&
                getComputedStyle(main).overflowY === 'auto';
            }"""
        )
        page.get_by_test_id("simple-nav-journey").click()
        simple_launcher.wait_for(state="visible")
        screenshot(page, timestamp, "simple-launcher-desktop", screenshots)
        page.get_by_test_id("ui-classic").click()
        page.locator('[data-testid="app-root"][data-layout="classic"]').wait_for(
            state="visible"
        )
        checks["simpleSwitchPreservesEmptyState"] = (
            urlsplit(page.url).path == "/full" and not created_game_ids
        )

        page.goto(f"{APP_URL}full", wait_until="networkidle")
        root = page.get_by_test_id("app-root")
        root.wait_for(state="visible")
        page.locator('[data-testid="app-root"][data-status="ready"]').wait_for(
            state="visible", timeout=30_000
        )
        checks["title"] = page.title()
        checks["initialView"] = root.get_attribute("data-view")
        checks["initialBoardPreference"] = page.get_by_test_id(
            "campaign"
        ).get_attribute("data-board-filter")
        page.get_by_test_id("board-size-9").click()
        page.wait_for_function(
            "document.querySelector('[data-testid=\"app-root\"]')?.dataset.engineLane === 'small-board'"
        )
        checks["engine"] = root.get_attribute("data-engine")
        checks["engineLane"] = root.get_attribute("data-engine-lane")
        checks["normalizedBoard"] = page.get_by_test_id("campaign").get_attribute(
            "data-board-filter"
        )
        checks["initialModePreference"] = page.get_by_test_id(
            "mode-picker"
        ).get_attribute("data-mode")
        page.get_by_test_id("mode-human_companion").click()
        checks["normalizedMode"] = page.get_by_test_id("mode-picker").get_attribute(
            "data-mode"
        )
        screenshot(page, timestamp, "journey-desktop", screenshots)

        # A true 5x5 lesson: the service supplies deterministic/authored choices
        # before any click, but never claims a 9x9 KataGo field.
        start_first_visible_lesson(page, 5)
        workspace = page.get_by_test_id("play-workspace")
        checks["smallBoard"] = page.get_by_test_id("weiqi-board-frame").get_attribute(
            "data-board-size"
        )
        page.locator('[data-testid="weiqi-board"] [data-coordinate="C4"]').click()
        commit = page.get_by_test_id("commit-move")
        page.locator('[data-testid="app-root"][data-operation="idle"]').wait_for(
            state="visible", timeout=LONG_TIMEOUT_MS
        )
        commit.wait_for(state="visible")
        checks["previewVerified"] = commit.is_enabled()
        small_field = page.get_by_test_id("candidate-field-key")
        checks["smallBoardNoEngineField"] = (
            small_field.get_attribute("data-engine-field") == "false"
            and page.get_by_test_id("candidate-ownership-after").count() == 0
            and page.get_by_test_id("candidate-ownership-delta").count() == 0
        )
        teacher_text = page.get_by_test_id("power-teacher").inner_text()
        checks["powerTeacherConcrete"] = all(
            label in teacher_text
            for label in (
                "Play",
                "Because",
                "Changes",
                "Opponent",
                "Then check",
                "Principle",
            )
        )
        screenshot(page, timestamp, "five-by-five-preview", screenshots)
        play_locale_select = page.get_by_test_id("locale-select").first
        play_locale_select.select_option("ar")
        page.wait_for_function("document.documentElement.lang === 'ar'")
        arabic_teacher_text = page.get_by_test_id("power-teacher").inner_text()
        arabic_candidate_text = page.locator(".candidate-card").first.inner_text()
        checks["arabicDeterministicTeachingLocalized"] = not any(
            english in f"{arabic_teacher_text}\n{arabic_candidate_text}"
            for english in (
                "Play",
                "Because",
                "Changes",
                "Opponent",
                "Then check",
                "Principle",
                "Possible ",
                "Teacher hypothesis",
                "Rules:",
            )
        )
        screenshot(page, timestamp, "five-by-five-preview-arabic", screenshots)
        play_locale_select.select_option("en")
        page.wait_for_function("document.documentElement.lang === 'en'")
        commit.click()
        wait_for_move_count(page, 2)
        checks["humanAndAgentMoves"] = page.locator(".timeline-track > span").count()

        # Ask the companion from the visible chat rail; no API shortcut.
        coach_question = "What changed in breath, shape, and the next urgent choice?"
        page.get_by_test_id("coach-input").fill(coach_question)
        page.get_by_test_id("coach-send").click()
        generated_exchange = page.locator(
            ".coach-exchange", has_text=coach_question
        ).last
        generated_exchange.wait_for(state="visible", timeout=LONG_TIMEOUT_MS)
        wait_idle(page)
        learner_bubble = generated_exchange.locator(".coach-message.learner")
        answer_bubble = generated_exchange.locator(".coach-message.answer")
        learner_box = learner_bubble.bounding_box()
        answer_box = answer_bubble.bounding_box()
        model_badges = answer_bubble.locator(".evidence-badge.model").count()
        teacher_badges = answer_bubble.locator(".evidence-badge.teacher").count()
        exact_badges = answer_bubble.locator(".evidence-badge.exact").count()
        engine_badges = answer_bubble.locator(".evidence-badge.engine").count()
        checks["coachAnswered"] = answer_bubble.is_visible()
        checks["learnerRightCoachLeft"] = bool(
            learner_box and answer_box and learner_box["x"] > answer_box["x"]
        )
        checks["safeCoachProvenance"] = (
            exact_badges == 0
            and engine_badges == 0
            and (model_badges > 0 or teacher_badges > 0)
        )
        checks["defaultCoachAvoidsLocalProse"] = (
            "LocalLLM" not in page.locator(".coach-state").inner_text()
        )
        checks["breathLensAvailable"] = (
            page.get_by_test_id("lens-breath").get_attribute("aria-disabled") != "true"
        )
        screenshot(page, timestamp, "companion-and-energy", screenshots)

        # Chronicle is populated only by actual server-persisted sessions.
        page.get_by_test_id("nav-chronicle").click()
        page.get_by_test_id("chronicle").wait_for(state="visible")
        checks["chronicleGames"] = page.locator(".history-card").count()
        screenshot(page, timestamp, "chronicle", screenshots)

        # Narrated Player Agent vs Player Agent: the top choice is visible before
        # play, pointer and keyboard compare different fields, and click pins a
        # non-committing revision-bound preview.
        page.get_by_test_id("nav-journey").click()
        page.get_by_test_id("mode-agent_vs_agent").click()
        start_first_visible_lesson(page, 9)
        checks["theatreMode"] = workspace.get_attribute("data-mode")
        candidate_cards = page.locator(".candidate-card")
        # The shared visible pointer may happen to rest over a newly rendered
        # card. Clear that incidental hover before recording the passive top
        # suggestion, or a later right-click reset would correctly return to
        # card 0 while the smoke incorrectly waits for the hovered card.
        page.mouse.move(8, 8)
        page.locator(".back-button").focus()
        first_field_id = str(
            candidate_cards.first.get_attribute("data-testid")
        ).removeprefix("candidate-")
        page.locator(
            f'[data-testid="candidate-field-key"][data-candidate-id="{first_field_id}"]'
            '[data-preview-mode="candidate-comparison"]'
        ).wait_for(state="visible")
        field_key = page.get_by_test_id("candidate-field-key")
        checks["turnStartDecisionField"] = bool(
            first_field_id
            and field_key.get_attribute("data-engine-field") == "true"
            and page.get_by_test_id("candidate-ownership-after").count() == 1
            and page.get_by_test_id("candidate-ownership-smooth").count() == 1
            and page.get_by_test_id("candidate-ownership-delta").count() == 1
            and page.get_by_test_id("candidate-ghost-stone").count() == 1
        )
        second = candidate_cards.nth(1)
        second_id = str(second.get_attribute("data-testid")).removeprefix("candidate-")
        second.hover()
        page.locator(
            f'[data-testid="candidate-field-key"][data-candidate-id="{second_id}"]'
        ).wait_for(state="visible")
        checks["candidateHoverSwitch"] = second_id != first_field_id

        third = candidate_cards.nth(2)
        third_id = str(third.get_attribute("data-testid")).removeprefix("candidate-")
        third.focus()
        page.locator(
            f'[data-testid="candidate-field-key"][data-candidate-id="{third_id}"]'
        ).wait_for(state="visible")
        checks["candidateFocusOverridesHover"] = third_id != second_id
        page.mouse.move(8, 8)
        page.locator(
            f'[data-testid="candidate-field-key"][data-candidate-id="{third_id}"]'
        ).wait_for(state="visible")
        checks["candidateFocusRestoredAfterLeave"] = True

        second.click()
        page.mouse.move(8, 8)
        page.locator(".back-button").focus()
        page.locator(
            f'[data-testid="candidate-field-key"][data-candidate-id="{second_id}"]'
        ).wait_for(state="visible")
        field_text = field_key.inner_text()
        checks["candidatePinnedPreview"] = (
            second.get_attribute("data-selected") == "true"
            and page.get_by_test_id("commit-move").count() == 0
        )
        checks["touchBackToSuggestionsAvailable"] = page.get_by_test_id(
            "back-to-suggestions"
        ).is_visible()
        checks["candidateFieldProvenance"] = (
            "Engine estimate" in field_text
            and "Black perspective" in field_text
            and "not territory already secured" in field_text
        )
        screenshot(page, timestamp, "nine-by-nine-candidate-decision", screenshots)
        page.get_by_test_id("weiqi-board").click(button="right")
        page.locator(
            '[data-testid="play-workspace"][data-selection-state="agent-suggestions"]'
        ).wait_for(state="visible")
        page.locator(
            f'[data-testid="candidate-field-key"][data-candidate-id="{first_field_id}"]'
            '[data-preview-mode="candidate-comparison"]'
        ).wait_for(state="visible")
        checks["theatreRightClickUnselect"] = (
            second.get_attribute("data-selected") == "false"
            and page.get_by_test_id("back-to-suggestions").count() == 0
            and page.locator(".timeline-track > span").count() == 0
        )
        page.get_by_test_id("agent-next-turn").click()
        wait_for_move_count(page, 1)
        checks["theatreMove"] = page.locator(".timeline-track > span").count()
        screenshot(page, timestamp, "agent-theatre", screenshots)

        # Companion delegation remains explicit and revision-bound. The server
        # records a one-turn chooser, then the ordinary opponent answers. Before
        # delegating, prove that a fresh board already teaches one opening and
        # that any other legal click reveals its child-position field without
        # committing a move.
        page.get_by_test_id("nav-journey").click()
        page.get_by_test_id("mode-human_companion").click()
        start_first_visible_lesson(page, 9)
        # A pointer left over a candidate from the theatre review can
        # intentionally switch the field into comparison mode. Neutralize
        # hover/focus before asserting the passive opening suggestion.
        page.mouse.move(8, 8)
        page.locator(".back-button").focus()
        opening_suggestion = page.get_by_test_id("suggested-first-stone")
        opening_suggestion.wait_for(state="visible", timeout=LONG_TIMEOUT_MS)
        suggested_coordinate = opening_suggestion.get_attribute("data-coordinate")
        suggested_card = page.get_by_test_id("suggested-first-stone-card")
        suggested_card_button = suggested_card.locator("xpath=ancestor::button[1]")
        suggestion_field = page.locator(
            '[data-testid="candidate-field-key"]'
            '[data-preview-mode="suggested-first-stone"]'
            '[data-engine-field="true"]'
        )
        suggestion_field.wait_for(state="visible", timeout=LONG_TIMEOUT_MS)
        checks["openingSuggestionVisible"] = bool(
            suggested_coordinate
            and suggested_card.is_visible()
            and suggested_coordinate in suggested_card_button.inner_text()
            and page.locator(".timeline-track > span").count() == 0
        )
        screenshot(page, timestamp, "nine-by-nine-opening-suggestion", screenshots)

        offered_coordinates = {
            coordinate.strip()
            for coordinate in page.locator(".candidate-coordinate").all_inner_texts()
            if coordinate.strip()
        }
        empty_points = page.locator(
            '[data-testid="weiqi-board"] [role="gridcell"][data-occupied="empty"]'
        )
        arbitrary_point = None
        arbitrary_coordinate = None
        for index in range(empty_points.count() - 1, -1, -1):
            point = empty_points.nth(index)
            coordinate = point.get_attribute("data-coordinate")
            if coordinate and coordinate not in offered_coordinates:
                arbitrary_point = point
                arbitrary_coordinate = coordinate
                break
        if arbitrary_point is None or arbitrary_coordinate is None:
            raise RuntimeError("could not find a legal non-suggested point to inspect")

        moves_before_preview = page.locator(".timeline-track > span").count()
        arbitrary_point.click()
        unconfirmed = page.locator(
            '[data-testid="unconfirmed-analysis"]'
            f'[data-coordinate="{arbitrary_coordinate}"]'
            '[data-analysis-state="ready"]'
        )
        unconfirmed.wait_for(state="visible", timeout=LONG_TIMEOUT_MS)
        if_played_field = page.locator(
            '[data-testid="candidate-field-key"]'
            '[data-preview-mode="if-played"]'
            '[data-engine-field="true"]'
        )
        if_played_field.wait_for(state="visible", timeout=LONG_TIMEOUT_MS)
        commit_after_analysis = page.get_by_test_id("commit-move")
        commit_after_analysis.wait_for(state="visible", timeout=LONG_TIMEOUT_MS)
        checks["unconfirmedClickAnalysis"] = (
            unconfirmed.get_attribute("data-coordinate") == arbitrary_coordinate
            and page.get_by_test_id("candidate-ownership-after").count() == 1
            and page.get_by_test_id("candidate-ownership-delta").count() == 1
            and page.get_by_test_id("if-played-score-forecast").count() == 1
            and page.get_by_test_id("if-played-position-comparison").count() == 1
            and page.get_by_test_id("current-position-bookkeeping").count() == 1
            and page.get_by_test_id("if-played-position-bookkeeping").count() == 1
            and page.locator(
                '[data-testid="energy-lenses"] [data-scope="if_played"]'
                '[data-facet-id="area"]'
            ).count()
            == 0
            and commit_after_analysis.is_enabled()
            and page.locator(".timeline-track > span").count() == moves_before_preview
        )
        checks["previewDoesNotPlaceStone"] = (
            moves_before_preview == 0
            and page.locator(".timeline-track > span").count() == 0
            and "Nothing changes until" in unconfirmed.inner_text()
        )
        screenshot(page, timestamp, "nine-by-nine-unconfirmed-analysis", screenshots)

        # The same live preview can move into /simple and through browser
        # history without another game, another move, or a rebuilt analysis.
        create_count_before_simple = len(created_game_ids)
        preview_coordinate_before_simple = workspace.get_attribute(
            "data-selected-coordinate"
        )
        page.get_by_test_id("ui-simple").click()
        page.locator(
            '[data-testid="app-root"][data-layout="simple"] '
            '[data-testid="play-workspace"][data-layout="simple"]'
        ).wait_for(state="visible")
        checks["simplePreviewStatePreserved"] = (
            urlsplit(page.url).path == "/"
            and workspace.get_attribute("data-selected-coordinate")
            == preview_coordinate_before_simple
            and page.get_by_test_id("commit-move").is_enabled()
            and page.locator(".timeline-track > span").count() == moves_before_preview
            and page.get_by_test_id("candidate-ownership-after").count() == 1
            and page.get_by_test_id("candidate-ownership-delta").count() == 1
            and page.get_by_test_id("candidate-ghost-stone").count() == 1
        )
        checks["simpleDesktopFitsViewport"] = page.evaluate(
            """() => {
              const root = document.documentElement;
              const selectors = [
                '[data-testid="weiqi-board"]',
                '[data-testid="move-controls"]',
                '[data-testid="power-teacher"]',
                '[data-testid="energy-lenses"]',
                '.candidate-card',
                '[data-testid="coach-input"]',
              ];
              const inside = selectors.every(selector => {
                const element = document.querySelector(selector);
                if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false;
                const box = element.getBoundingClientRect();
                return box.top >= 0 && box.left >= 0 &&
                  box.bottom <= innerHeight && box.right <= innerWidth;
              });
              return inside && root.scrollHeight === root.clientHeight &&
                root.scrollWidth === root.clientWidth;
            }"""
        )
        simple_second_candidate = page.locator(".candidate-card").nth(1)
        simple_second_id = str(
            simple_second_candidate.get_attribute("data-testid")
        ).removeprefix("candidate-")
        simple_second_candidate.hover()
        page.locator(
            f'[data-testid="candidate-field-key"][data-candidate-id="{simple_second_id}"]'
        ).wait_for(state="attached")
        checks["simpleCandidateHoverUpdatesBoard"] = (
            page.get_by_test_id("candidate-ownership-after").count() == 1
            and page.get_by_test_id("candidate-ownership-delta").count() == 1
            and page.locator(".timeline-track > span").count() == moves_before_preview
        )
        page.mouse.move(5, 5)
        screenshot(page, timestamp, "simple-preview-desktop", screenshots)

        page.go_back()
        page.locator('[data-testid="app-root"][data-layout="classic"]').wait_for(
            state="visible"
        )
        simple_back_preserved = (
            urlsplit(page.url).path == "/full"
            and workspace.get_attribute("data-selected-coordinate")
            == preview_coordinate_before_simple
            and page.get_by_test_id("commit-move").is_enabled()
        )
        page.go_forward()
        page.locator('[data-testid="app-root"][data-layout="simple"]').wait_for(
            state="visible"
        )
        checks["simpleHistoryNavigationPreservesPreview"] = (
            simple_back_preserved
            and urlsplit(page.url).path == "/"
            and workspace.get_attribute("data-selected-coordinate")
            == preview_coordinate_before_simple
            and page.get_by_test_id("commit-move").is_enabled()
            and len(created_game_ids) == create_count_before_simple
        )

        simple_cdp = context.new_cdp_session(page)
        try:
            simple_cdp.send(
                "Emulation.setDeviceMetricsOverride",
                {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True},
            )
            page.wait_for_timeout(500)
            simple_mobile_geometry = page.evaluate(
                """() => {
                  const root = document.documentElement;
                  const board = document.querySelector('[data-testid="weiqi-board"]');
                  const boardVisual = document.querySelector('.board-visual');
                  const controls = document.querySelector('[data-testid="move-controls"]');
                  const lenses = document.querySelector('[data-testid="energy-lenses"]');
                  const coach = document.querySelector('.coach-mobile-toggle');
                  if (!(board && boardVisual && controls && lenses && coach)) {
                    return { fits: false, missing: true };
                  }
                  const boardBox = board.getBoundingClientRect();
                  const boardVisualBox = boardVisual.getBoundingClientRect();
                  const controlsBox = controls.getBoundingClientRect();
                  const lensesBox = lenses.getBoundingClientRect();
                  const coachBox = coach.getBoundingClientRect();
                  const fits = root.scrollHeight === root.clientHeight &&
                    root.scrollWidth === root.clientWidth &&
                    boardBox.top >= 0 && boardBox.bottom <= innerHeight &&
                    boardVisualBox.bottom <= controlsBox.top &&
                    controlsBox.top >= 0 && controlsBox.bottom <= innerHeight &&
                    lensesBox.bottom <= coachBox.top && coachBox.bottom <= innerHeight;
                  const rect = box => ({
                    top: Math.round(box.top * 100) / 100,
                    bottom: Math.round(box.bottom * 100) / 100,
                    width: Math.round(box.width * 100) / 100,
                    height: Math.round(box.height * 100) / 100,
                  });
                  return {
                    fits,
                    root: {
                      scrollHeight: root.scrollHeight,
                      clientHeight: root.clientHeight,
                      scrollWidth: root.scrollWidth,
                      clientWidth: root.clientWidth,
                      innerHeight,
                    },
                    board: rect(boardBox),
                    boardVisual: rect(boardVisualBox),
                    controls: rect(controlsBox),
                    lenses: rect(lensesBox),
                    coach: rect(coachBox),
                  };
                }"""
            )
            checks["simpleMobileGeometry"] = simple_mobile_geometry
            checks["simpleMobileFitsViewport"] = bool(
                simple_mobile_geometry.get("fits")
            )
            screenshot(page, timestamp, "simple-preview-mobile", screenshots)
            page.locator(".coach-mobile-toggle").click()
            page.locator(
                '.coach-rail[data-mobile-open="true"] .candidate-card'
            ).first.wait_for(state="visible")
            checks["simpleMobileCandidatesAccessible"] = page.evaluate(
                """() => {
                  const root = document.documentElement;
                  const sheet = document.querySelector('.coach-sheet-content');
                  return sheet instanceof HTMLElement &&
                    root.scrollHeight === root.clientHeight &&
                    getComputedStyle(sheet).overflowY === 'auto';
                }"""
            )
            screenshot(page, timestamp, "simple-coach-mobile", screenshots)
            page.locator(".coach-mobile-toggle").click()

            simple_cdp.send(
                "Emulation.setDeviceMetricsOverride",
                {"width": 720, "height": 560, "deviceScaleFactor": 1, "mobile": False},
            )
            page.wait_for_timeout(350)
            page.get_by_test_id("move-controls").scroll_into_view_if_needed()
            checks["simpleShortViewportUsesInternalScroll"] = page.evaluate(
                """() => {
                  const root = document.documentElement;
                  const layout = document.querySelector('.simple-play .play-layout');
                  const controls = document.querySelector('[data-testid="move-controls"]');
                  if (!(layout instanceof HTMLElement) || !controls) return false;
                  const box = controls.getBoundingClientRect();
                  return root.scrollHeight === root.clientHeight &&
                    root.scrollWidth === root.clientWidth &&
                    layout.scrollHeight > layout.clientHeight &&
                    box.top >= 0 && box.bottom <= innerHeight;
                }"""
            )
        finally:
            simple_cdp.send("Emulation.clearDeviceMetricsOverride")
            simple_cdp.detach()
        page.wait_for_timeout(350)
        page.get_by_test_id("ui-classic").click()
        page.locator('[data-testid="app-root"][data-layout="classic"]').wait_for(
            state="visible"
        )
        checks["simpleRouteDoesNotDuplicateGames"] = (
            len(created_game_ids) == create_count_before_simple
        )

        # The new one-click teaching state must remain readable and actionable
        # at phone width before any stone is committed.
        preview_cdp = context.new_cdp_session(page)
        try:
            preview_cdp.send(
                "Emulation.setDeviceMetricsOverride",
                {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True},
            )
            page.wait_for_timeout(500)
            unconfirmed.scroll_into_view_if_needed()
            checks["mobileUnconfirmedAnalysis"] = (
                unconfirmed.is_visible()
                and if_played_field.is_visible()
                and commit_after_analysis.is_enabled()
                and page.locator(".timeline-track > span").count() == 0
            )
            checks["mobilePreviewScrollWidth"] = page.evaluate(
                "document.documentElement.scrollWidth"
            )
            checks["mobilePreviewClientWidth"] = page.evaluate(
                "document.documentElement.clientWidth"
            )
            screenshot(page, timestamp, "mobile-unconfirmed-analysis", screenshots)
        finally:
            preview_cdp.send("Emulation.clearDeviceMetricsOverride")
            preview_cdp.detach()
        page.wait_for_timeout(500)
        page.get_by_test_id("play-workspace").wait_for(state="visible")

        page.get_by_test_id("weiqi-board").click(button="right")
        page.locator(
            '[data-testid="play-workspace"][data-selection-state="agent-suggestions"]'
        ).wait_for(state="visible")
        wait_turn_choices(page)
        suggestion_field.wait_for(state="visible", timeout=LONG_TIMEOUT_MS)
        checks["rightClickReturnsAgentSuggestions"] = (
            page.get_by_test_id("unconfirmed-analysis").count() == 0
            and page.get_by_test_id("commit-move").count() == 0
            and page.locator(".timeline-track > span").count() == moves_before_preview
            and page.get_by_test_id("weiqi-board-frame").get_attribute(
                "data-context-action"
            )
            == "browser-default"
        )
        passive_context_prevented = page.get_by_test_id("weiqi-board").evaluate(
            """board => {
              const event = new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                button: 2,
              });
              board.dispatchEvent(event);
              return event.defaultPrevented;
            }"""
        )
        checks["passiveContextMenuPreserved"] = not passive_context_prevented

        focused_candidate = page.locator(".candidate-card").first
        focused_candidate_id = str(
            focused_candidate.get_attribute("data-testid")
        ).removeprefix("candidate-")
        focused_candidate.click()
        page.locator(
            '[data-testid="unconfirmed-analysis"][data-analysis-state="ready"]'
        ).wait_for(state="visible", timeout=LONG_TIMEOUT_MS)
        focused_child_field = page.locator(
            '[data-testid="candidate-field-key"]'
            f'[data-candidate-id="{focused_candidate_id}"]'
            '[data-preview-mode="if-played"]'
            '[data-engine-field="true"]'
        )
        focused_child_field.wait_for(state="visible", timeout=LONG_TIMEOUT_MS)
        checks["focusedCandidateUsesChildPreview"] = (
            focused_candidate.evaluate("element => document.activeElement === element")
            and page.get_by_test_id("commit-move").is_enabled()
            and page.locator(".timeline-track > span").count() == 0
        )
        page.keyboard.press("Escape")
        page.locator(
            '[data-testid="play-workspace"][data-selection-state="agent-suggestions"]'
        ).wait_for(state="visible")
        wait_turn_choices(page)
        checks["escapeReturnsAgentSuggestions"] = (
            page.get_by_test_id("unconfirmed-analysis").count() == 0
            and page.get_by_test_id("commit-move").count() == 0
            and page.locator(".timeline-track > span").count() == 0
        )

        page.get_by_test_id("delegation-zone").locator("button").click()
        checks["delegationConfirmedFirst"] = (
            page.get_by_test_id("delegation-zone").get_attribute("data-confirming")
            == "true"
        )
        page.get_by_test_id("delegate-confirm").click()
        wait_for_move_count(page, 2)
        checks["delegatedTurnPair"] = page.locator(".timeline-track > span").count()
        checks["delegationClosed"] = (
            page.get_by_test_id("delegation-zone").get_attribute("data-confirming")
            == "false"
        )
        screenshot(page, timestamp, "delegated-companion-turn", screenshots)

        # Mobile layout and touch geometry, while keeping the persistent desktop
        # browser alive for the noVNC viewer.
        cdp = context.new_cdp_session(page)
        cdp.send(
            "Emulation.setDeviceMetricsOverride",
            {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True},
        )
        page.wait_for_timeout(500)
        page.get_by_test_id("play-workspace").wait_for(state="visible")
        screenshot(page, timestamp, "mobile", screenshots)
        checks["mobileScrollWidth"] = page.evaluate(
            "document.documentElement.scrollWidth"
        )
        checks["mobileClientWidth"] = page.evaluate(
            "document.documentElement.clientWidth"
        )
        smallest_grid_cell = page.locator(
            '[data-testid="weiqi-board"] [role="gridcell"]'
        ).first
        checks["mobileBoardCellWidth"] = round(
            smallest_grid_cell.bounding_box()["width"], 1
        )
        cdp.send("Emulation.clearDeviceMetricsOverride")
        cdp.detach()
        page.wait_for_timeout(500)
        page.get_by_test_id("play-workspace").wait_for(state="visible")
        exercise_nineteen_opening(page, context, checks, screenshots, timestamp)
        page.bring_to_front()
        # Disconnecting Playwright does not close the shared persistent browser.

    external_browser_sockets = _unexpected_browser_sockets()
    crashpad_handlers = _unexpected_crashpad_handlers()
    crashpad_bindings = _unexpected_crashpad_bindings()
    background_network = _background_network_log_report()
    checks["browserLoopbackOnly"] = not external_browser_sockets
    checks["browserCrashpadQuiet"] = not crashpad_handlers
    checks["browserCrashReporterUnbound"] = not crashpad_bindings
    checks["browserBackgroundNetworkQuiet"] = background_network["quiet"]
    checks["browserBackgroundNetworkContained"] = _background_network_contained(
        background_network, external_browser_sockets, external_requests
    )

    failures: list[str] = []
    expected = {
        "title": "Weiqi · Path of Influence",
        "initialView": "journey",
        "engine": "ready",
        "engineLane": "small-board",
        "simpleDefaultRoute": True,
        "localeOptions": EXPECTED_LOCALE_OPTIONS,
        "localeMetadataValid": True,
        "localePersistence": True,
        "arabicAuthoredLessonLocalized": True,
        "arabicMobileFitsViewport": True,
        "simpleDirectRoute": True,
        "simpleLauncherFitsViewport": True,
        "simpleHistoryAccessible": True,
        "simpleSwitchPreservesEmptyState": True,
        "simplePreviewStatePreserved": True,
        "simpleDesktopFitsViewport": True,
        "simpleCandidateHoverUpdatesBoard": True,
        "simpleHistoryNavigationPreservesPreview": True,
        "simpleMobileFitsViewport": True,
        "simpleMobileCandidatesAccessible": True,
        "simpleShortViewportUsesInternalScroll": True,
        "simpleRouteDoesNotDuplicateGames": True,
        "normalizedBoard": "9",
        "normalizedMode": "human_companion",
        "smallBoard": "5",
        "previewVerified": True,
        "smallBoardNoEngineField": True,
        "powerTeacherConcrete": True,
        "arabicDeterministicTeachingLocalized": True,
        "turnStartDecisionField": True,
        "candidateHoverSwitch": True,
        "candidateFocusOverridesHover": True,
        "candidateFocusRestoredAfterLeave": True,
        "candidatePinnedPreview": True,
        "touchBackToSuggestionsAvailable": True,
        "candidateFieldProvenance": True,
        "theatreRightClickUnselect": True,
        "openingSuggestionVisible": True,
        "unconfirmedClickAnalysis": True,
        "previewDoesNotPlaceStone": True,
        "mobileUnconfirmedAnalysis": True,
        "rightClickReturnsAgentSuggestions": True,
        "passiveContextMenuPreserved": True,
        "focusedCandidateUsesChildPreview": True,
        "escapeReturnsAgentSuggestions": True,
        "coachAnswered": True,
        "learnerRightCoachLeft": True,
        "safeCoachProvenance": True,
        "defaultCoachAvoidsLocalProse": True,
        "browserLoopbackOnly": True,
        "browserCrashpadQuiet": True,
        "browserCrashReporterUnbound": True,
        "browserBackgroundNetworkContained": True,
        "browserRestoredToJourney": True,
        "preexistingHistoryPreserved": True,
        "smokeSessionsRemaining": 0,
        "breathLensAvailable": True,
        "theatreMode": "agent_vs_agent",
        "delegationConfirmedFirst": True,
        "delegationClosed": True,
        "opening19DefaultSuggestion": True,
        "opening19EvidenceSeparated": True,
        "opening19DialogAccessible": True,
        "opening19TypographyReadable": True,
        "opening19FocusRestored": True,
        "opening19TabletFits": True,
        "opening19MobileFits": True,
        "opening19ArabicRtl": True,
        "opening19SelectedC16Study": True,
        "opening19DeepStudyNoMutation": True,
        "opening19StudyPreservesRootSuggestion": True,
    }
    for name, value in expected.items():
        if checks.get(name) != value:
            failures.append(f"{name}: expected {value!r}, got {checks.get(name)!r}")
    for name in (
        "humanAndAgentMoves",
        "chronicleGames",
        "theatreMove",
        "delegatedTurnPair",
    ):
        if not isinstance(checks.get(name), int) or checks[name] < 1:
            failures.append(
                f"{name}: expected a positive count, got {checks.get(name)!r}"
            )
    if (
        checks.get("humanAndAgentMoves", 0) < 2
        or checks.get("delegatedTurnPair", 0) < 2
    ):
        failures.append("human/agent or delegated/opponent turn pair did not finish")
    if checks.get("mobileScrollWidth") != checks.get("mobileClientWidth"):
        failures.append(
            "mobile viewport overflows horizontally: "
            f"{checks.get('mobileScrollWidth')} > {checks.get('mobileClientWidth')}"
        )
    if checks.get("mobilePreviewScrollWidth") != checks.get("mobilePreviewClientWidth"):
        failures.append(
            "mobile unconfirmed preview overflows horizontally: "
            f"{checks.get('mobilePreviewScrollWidth')} > "
            f"{checks.get('mobilePreviewClientWidth')}"
        )
    if checks.get("mobileBoardCellWidth", 0) < 28:
        failures.append(
            f"mobile board cell is unexpectedly small: {checks.get('mobileBoardCellWidth')}"
        )
    if console_errors:
        failures.append(f"browser console errors: {console_errors}")
    if page_errors:
        failures.append(f"uncaught page errors: {page_errors}")
    if request_failures:
        failures.append(f"failed same-origin requests: {request_failures}")
    if bad_responses:
        failures.append(f"same-origin HTTP errors: {bad_responses}")
    if response_record_errors:
        failures.append(f"smoke ledger record errors: {response_record_errors}")
    if cleanup_errors:
        failures.append(f"smoke session cleanup errors: {cleanup_errors}")
    if external_requests:
        failures.append(f"external page requests: {external_requests}")
    if external_browser_sockets:
        failures.append(f"unexpected browser sockets: {external_browser_sockets}")
    if crashpad_handlers:
        failures.append(f"unexpected Chrome crashpad handlers: {crashpad_handlers}")
    if crashpad_bindings:
        failures.append(f"unexpected Chrome crashpad bindings: {crashpad_bindings}")
    if background_network["unexpected"]:
        failures.append(
            "unexpected browser background-network log entries: "
            f"{background_network['unexpected']}"
        )

    result = {
        "url": APP_URL,
        "noVnc": (
            f"http://127.0.0.1:{NOVNC_PORT}/vnc.html?host=127.0.0.1&port={NOVNC_PORT}"
            "&autoconnect=1&resize=scale"
        ),
        "status": "failed" if failures else "passed",
        "checks": checks,
        "failures": failures,
        "screenshots": screenshots,
        "backgroundNetworkEvidence": background_network["evidence"],
        "crashpadEvidence": crashpad_handlers,
        "crashpadBindingEvidence": crashpad_bindings,
    }
    status_path = EVIDENCE_DIR / f"{timestamp}-status.json"
    status_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    result["statusFile"] = report_path(status_path)
    return result


def crash_outcome(error: Exception, *, capture_browser: bool = True) -> dict[str, Any]:
    _prepare_runtime_dir()
    EVIDENCE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    EVIDENCE_DIR.chmod(0o700)
    timestamp = _run_timestamp()
    screenshots: list[str] = []
    capture_failure: str | None = None
    try:
        if not capture_browser:
            raise RuntimeError(
                "browser capture skipped because the smoke lock is occupied"
            )
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(CDP_URL)
            context = browser.contexts[0]
            if context.pages:
                target = EVIDENCE_DIR / f"{timestamp}-failure.png"
                context.pages[0].screenshot(path=str(target), full_page=True)
                screenshots.append(report_path(target))
    except Exception as capture_error:  # noqa: BLE001 - retain the original smoke failure
        capture_failure = f"failure screenshot unavailable: {capture_error}"
    failures = [f"{type(error).__name__}: {error}"]
    if capture_failure:
        failures.append(capture_failure)
    outcome: dict[str, Any] = {
        "url": APP_URL,
        "status": "failed",
        "checks": {},
        "failures": failures,
        "screenshots": screenshots,
    }
    status_path = EVIDENCE_DIR / f"{timestamp}-status.json"
    status_path.write_text(json.dumps(outcome, indent=2), encoding="utf-8")
    outcome["statusFile"] = report_path(status_path)
    return outcome


if __name__ == "__main__":
    try:
        with exclusive_smoke_run():
            try:
                outcome = run()
            except Exception as error:  # noqa: BLE001 - preserve evidence while lock is held
                outcome = crash_outcome(error)
    except Exception as error:  # noqa: BLE001 - final process boundary writes evidence
        outcome = crash_outcome(error, capture_browser=False)
    print(json.dumps(outcome, indent=2))
    raise SystemExit(1 if outcome["status"] == "failed" else 0)
