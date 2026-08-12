"""Attested, single-resident KataGo runtime for ordinary 19x19 games.

The existing 9x9 HumanSL process remains a separate teaching lane.  This
manager owns two reviewed general 19x19 networks, but serializes access and
stops the active process before switching profiles so only one 19x19 model can
be resident at a time.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import os
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from ...config import REPOSITORY_ROOT, Settings
from .process import (
    KATAGO_ATTESTATION_RELATIVE_PATH,
    KATAGO_ATTESTATION_SCHEMA,
    KATAGO_SOURCE_COMMIT,
    KATAGO_VERSION,
    MAX_ATTESTATION_BYTES,
    MAX_ENGINE_LINE_BYTES,
    KataGoUnavailable,
    _absolute_path,
    _assert_project_local_parent_chains,
    _FileSignature,
    _read_regular_file,
    _regular_file_signature,
    _sha256_regular_file,
)

KataGo19Profile = Literal["fast", "quality"]

KATAGO19_BINARY_NAME = "katago"
KATAGO19_BINARY_SIZE = 20_569_624
KATAGO19_BINARY_SHA256 = "fa73f1190626bf2c2736732f4774da2087b6ab899bd123a7c1f0a1a1edbfce7c"
KATAGO19_CONFIG_NAME = "katago-analysis-19x19.cfg"
KATAGO19_CONFIG_SIZE = 1_247
KATAGO19_CONFIG_SHA256 = "c6c4b5d9d3c1a1b572ac4eeb0a1ab1ab8a024995c8aacf03e5728d1e114b2305"
KATAGO19_FAST_MODEL_NAME = "b10c384h6nbttflrs.bin.gz"
KATAGO19_FAST_MODEL_SIZE = 38_245_488
KATAGO19_FAST_MODEL_SHA256 = "0ba27eced5180b3e3d0b898b280c541112989765e789d1eb6cd0d31b2b2c1229"
KATAGO19_QUALITY_MODEL_NAME = "b11c768h12nbt3tflrs-fson-silu.bin.gz"
KATAGO19_QUALITY_MODEL_SIZE = 211_660_960
KATAGO19_QUALITY_MODEL_SHA256 = "1881600caab9e9d85a3dd6a019e9b8e7d2c237b5f984e13ed49a8645be3077c6"
KATAGO19_MANIFEST_NAME = "installed-models.sha256"
KATAGO19_MAX_WAITERS = 8
KATAGO19_MAX_CONFIGURED_VISITS = 128
KATAGO19_MAX_QUERY_SECONDS = 90.0


@dataclass(frozen=True, slots=True)
class KataGo19ProfileSpec:
    name: KataGo19Profile
    model_name: str
    model_size: int
    model_sha256: str
    max_visits: int
    timeout_seconds: float
    pv_length: int


@dataclass(frozen=True, slots=True)
class _Readiness:
    ready: bool
    detail: str
    version: str | None = None


def _profile_specs(settings: Settings) -> dict[KataGo19Profile, KataGo19ProfileSpec]:
    return {
        "fast": KataGo19ProfileSpec(
            name="fast",
            model_name=KATAGO19_FAST_MODEL_NAME,
            model_size=KATAGO19_FAST_MODEL_SIZE,
            model_sha256=KATAGO19_FAST_MODEL_SHA256,
            max_visits=settings.katago19_fast_max_visits,
            timeout_seconds=settings.katago19_fast_timeout_seconds,
            pv_length=10,
        ),
        "quality": KataGo19ProfileSpec(
            name="quality",
            model_name=KATAGO19_QUALITY_MODEL_NAME,
            model_size=KATAGO19_QUALITY_MODEL_SIZE,
            model_sha256=KATAGO19_QUALITY_MODEL_SHA256,
            max_visits=settings.katago19_quality_max_visits,
            timeout_seconds=settings.katago19_quality_timeout_seconds,
            pv_length=16,
        ),
    }


def _manifest_bytes() -> bytes:
    return (
        f"{KATAGO19_FAST_MODEL_SHA256}  {KATAGO19_FAST_MODEL_NAME}\n"
        f"{KATAGO19_QUALITY_MODEL_SHA256}  {KATAGO19_QUALITY_MODEL_NAME}\n"
    ).encode("ascii")


class KataGo19Process:
    """One serialized 19x19 GPU lane with explicit fast/quality profiles."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._specs = _profile_specs(settings)
        self._process: asyncio.subprocess.Process | None = None
        self._active_profile: KataGo19Profile | None = None
        self._reader_task: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._idle_task: asyncio.Task[None] | None = None
        self._pending: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._start_lock = asyncio.Lock()
        self._write_lock = asyncio.Lock()
        self._query_lock = asyncio.Lock()
        self._waiting_queries = 0
        self._last_used = 0.0
        self._stderr_tail: list[str] = []
        self._readiness_cache_key: tuple[tuple[str, str, _FileSignature], ...] | None = None
        self._readiness_cache: _Readiness | None = None

    def _artifact_paths(self) -> tuple[Path, dict[str, Path]]:
        project_root = _absolute_path(REPOSITORY_ROOT)
        configured = {
            "binary": _absolute_path(self._settings.katago_executable),
            "config": _absolute_path(self._settings.katago19_config),
            "fast_model": _absolute_path(self._settings.katago19_fast_model),
            "quality_model": _absolute_path(self._settings.katago19_quality_model),
        }
        expected = {
            "binary": project_root / ".local/bin" / KATAGO19_BINARY_NAME,
            "config": project_root / "config" / KATAGO19_CONFIG_NAME,
            "fast_model": project_root / ".local/models/katago19" / KATAGO19_FAST_MODEL_NAME,
            "quality_model": (
                project_root / ".local/models/katago19" / KATAGO19_QUALITY_MODEL_NAME
            ),
        }
        for name, path in expected.items():
            if configured[name] != _absolute_path(path):
                raise ValueError(f"configured 19x19 KataGo {name} path is not pinned")
        paths = {
            **configured,
            "manifest": project_root / ".local/models/katago19" / KATAGO19_MANIFEST_NAME,
            "attestation": project_root / KATAGO_ATTESTATION_RELATIVE_PATH,
        }
        runtime_probe = project_root / ".local/runtime/katago19/logs/.path-check"
        _assert_project_local_parent_chains(project_root, [*paths.values(), runtime_probe])
        return project_root, paths

    @staticmethod
    def _require_digest(path: Path, signature: _FileSignature, size: int, digest: str) -> None:
        if signature.size != size:
            raise ValueError(f"{path.name} has the wrong pinned byte size")
        if _sha256_regular_file(path, signature) != digest:
            raise ValueError(f"{path.name} has the wrong pinned SHA-256")

    def _validate_attestation(
        self,
        *,
        paths: dict[str, Path],
        signatures: dict[str, _FileSignature],
    ) -> _Readiness:
        self._require_digest(
            paths["binary"],
            signatures["binary"],
            KATAGO19_BINARY_SIZE,
            KATAGO19_BINARY_SHA256,
        )
        if not os.access(paths["binary"], os.X_OK, follow_symlinks=False):
            raise ValueError("KataGo binary is not executable")
        self._require_digest(
            paths["config"],
            signatures["config"],
            KATAGO19_CONFIG_SIZE,
            KATAGO19_CONFIG_SHA256,
        )
        self._require_digest(
            paths["fast_model"],
            signatures["fast_model"],
            KATAGO19_FAST_MODEL_SIZE,
            KATAGO19_FAST_MODEL_SHA256,
        )
        self._require_digest(
            paths["quality_model"],
            signatures["quality_model"],
            KATAGO19_QUALITY_MODEL_SIZE,
            KATAGO19_QUALITY_MODEL_SHA256,
        )

        manifest = _read_regular_file(
            paths["manifest"], signatures["manifest"], len(_manifest_bytes())
        )
        if manifest != _manifest_bytes():
            raise ValueError("19x19 model manifest does not match both reviewed pins")

        raw = _read_regular_file(
            paths["attestation"], signatures["attestation"], MAX_ATTESTATION_BYTES
        )
        try:
            attestation = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("KataGo binary attestation is not valid JSON") from exc
        if not isinstance(attestation, dict) or set(attestation) != {
            "schema",
            "katago_version",
            "source_commit",
            "artifacts",
        }:
            raise ValueError("KataGo binary attestation has an unexpected shape")
        if attestation["schema"] != KATAGO_ATTESTATION_SCHEMA:
            raise ValueError("KataGo binary attestation schema is unsupported")
        if attestation["katago_version"] != KATAGO_VERSION:
            raise ValueError("KataGo binary attestation has the wrong version")
        if attestation["source_commit"] != KATAGO_SOURCE_COMMIT:
            raise ValueError("KataGo binary attestation has the wrong source commit")
        artifacts = attestation["artifacts"]
        if not isinstance(artifacts, dict) or set(artifacts) != {
            "binary",
            "config",
            "main_model",
            "human_model",
        }:
            raise ValueError("KataGo binary attestation has unexpected artifacts")
        binary = artifacts["binary"]
        if binary != {
            "path": ".local/bin/katago",
            "size": KATAGO19_BINARY_SIZE,
            "sha256": KATAGO19_BINARY_SHA256,
        }:
            raise ValueError("KataGo binary attestation does not match the pinned executable")

        for spec in self._specs.values():
            if not 1 <= spec.max_visits <= KATAGO19_MAX_CONFIGURED_VISITS:
                raise ValueError(f"19x19 {spec.name} visits exceed the reviewed runtime bound")
            if not 0 < spec.timeout_seconds <= KATAGO19_MAX_QUERY_SECONDS:
                raise ValueError(f"19x19 {spec.name} timeout exceeds the reviewed runtime bound")
        return _Readiness(
            True,
            "Pinned KataGo binary, 19x19 config, manifest, and fast/quality models verified.",
            KATAGO_VERSION.removeprefix("v"),
        )

    def _readiness(self) -> _Readiness:
        if not self._settings.katago19_enabled:
            return _Readiness(False, "19x19 KataGo is disabled by configuration.")
        try:
            _project_root, paths = self._artifact_paths()
            signatures = {name: _regular_file_signature(path) for name, path in paths.items()}
            cache_key = tuple(
                (name, os.fspath(paths[name]), signatures[name]) for name in sorted(paths)
            )
            if cache_key == self._readiness_cache_key and self._readiness_cache is not None:
                return self._readiness_cache
            result = self._validate_attestation(paths=paths, signatures=signatures)
        except (OSError, ValueError) as exc:
            self._readiness_cache_key = None
            self._readiness_cache = None
            return _Readiness(False, str(exc))
        self._readiness_cache_key = cache_key
        self._readiness_cache = result
        return result

    def files_ready(self) -> bool:
        return self._readiness().ready

    def profile_descriptor(self, profile: KataGo19Profile) -> dict[str, Any]:
        if profile not in {"fast", "quality"}:
            raise ValueError("unknown 19x19 KataGo analysis profile")
        spec = self._specs[profile]
        return {
            "engine_version": KATAGO_VERSION.removeprefix("v"),
            "profile": spec.name,
            "model": spec.model_name,
            "model_sha256": spec.model_sha256,
            "model_size": spec.model_size,
            "max_visits": spec.max_visits,
            "perspective": "black",
            "config": {
                "name": KATAGO19_CONFIG_NAME,
                "size": KATAGO19_CONFIG_SIZE,
                "sha256": KATAGO19_CONFIG_SHA256,
            },
            "binary": {
                "size": KATAGO19_BINARY_SIZE,
                "sha256": KATAGO19_BINARY_SHA256,
                "source_commit": KATAGO_SOURCE_COMMIT,
            },
        }

    async def status(self) -> dict[str, Any]:
        readiness = self._readiness()
        process = self._process
        return {
            "available": readiness.ready,
            "running": bool(process and process.returncode is None),
            "active_profile": self._active_profile
            if process and process.returncode is None
            else None,
            "version": readiness.version,
            "gpu": self._settings.katago19_gpu,
            "profiles": {name: self.profile_descriptor(name) for name in ("fast", "quality")}
            if readiness.ready
            else {},
            "detail": readiness.detail,
        }

    async def _ensure_profile(self, profile: KataGo19Profile) -> None:
        if profile not in {"fast", "quality"}:
            raise ValueError("unknown 19x19 KataGo analysis profile")
        async with self._start_lock:
            if (
                self._process is not None
                and self._process.returncode is None
                and self._active_profile == profile
            ):
                self._last_used = time.monotonic()
                return
            if not self.files_ready():
                readiness = self._readiness()
                raise KataGoUnavailable(
                    f"19x19 KataGo is unavailable ({readiness.detail}); "
                    "deterministic opening teaching remains available"
                )
            if self._process is not None:
                if self._pending:
                    raise KataGoUnavailable("19x19 KataGo profile switch attempted while busy")
                await self._stop_process(self._process)

            project_root, paths = self._artifact_paths()
            runtime_log_dir = project_root / ".local/runtime/katago19/logs"
            if runtime_log_dir.is_symlink():
                raise KataGoUnavailable(
                    "19x19 KataGo runtime log directory must not be a symbolic link"
                )
            runtime_log_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            runtime_log_dir.chmod(0o700)
            spec = self._specs[profile]
            model_path = paths[f"{profile}_model"]
            env = {
                "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
                "HOME": os.environ.get("HOME", str(Path.home())),
                "CUDA_VISIBLE_DEVICES": str(self._settings.katago19_gpu),
                "LC_ALL": "C.UTF-8",
            }
            process = await asyncio.create_subprocess_exec(
                str(paths["binary"]),
                "analysis",
                "-config",
                str(paths["config"]),
                "-model",
                str(model_path),
                "-quit-without-waiting",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                cwd=str(project_root),
                limit=MAX_ENGINE_LINE_BYTES,
            )
            self._process = process
            self._active_profile = spec.name
            self._reader_task = asyncio.create_task(self._read_stdout(process))
            self._stderr_task = asyncio.create_task(self._read_stderr(process))
            self._last_used = time.monotonic()
            self._idle_task = asyncio.create_task(self._release_when_idle(process))

    async def _release_when_idle(self, process: asyncio.subprocess.Process) -> None:
        interval = min(max(self._settings.katago19_idle_seconds / 4, 0.05), 15.0)
        try:
            while self._process is process and process.returncode is None:
                await asyncio.sleep(interval)
                if self._pending or self._query_lock.locked():
                    continue
                if time.monotonic() - self._last_used < self._settings.katago19_idle_seconds:
                    continue
                async with self._start_lock:
                    if (
                        self._process is process
                        and process.returncode is None
                        and not self._pending
                        and not self._query_lock.locked()
                        and time.monotonic() - self._last_used
                        >= self._settings.katago19_idle_seconds
                    ):
                        await self._stop_process(process, cancel_idle=False)
                return
        except asyncio.CancelledError:
            raise

    async def _read_stdout(self, process: asyncio.subprocess.Process) -> None:
        if not process.stdout:
            return
        failure: KataGoUnavailable | None = None
        try:
            while True:
                line = await process.stdout.readline()
                if not line:
                    failure = KataGoUnavailable("19x19 KataGo exited before returning analysis")
                    return
                if len(line) > MAX_ENGINE_LINE_BYTES:
                    failure = KataGoUnavailable("19x19 KataGo response exceeded the line limit")
                    return
                try:
                    payload = json.loads(line)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    continue
                request_id = payload.get("id")
                if not isinstance(request_id, str):
                    continue
                if payload.get("warning") and "rootInfo" not in payload:
                    continue
                future = self._pending.get(request_id)
                if future and not future.done() and not payload.get("isDuringSearch"):
                    if payload.get("error"):
                        future.set_exception(
                            KataGoUnavailable("19x19 KataGo rejected the position")
                        )
                    else:
                        future.set_result(payload)
        except asyncio.CancelledError:
            raise
        finally:
            if failure is not None:
                for future in self._pending.values():
                    if not future.done():
                        future.set_exception(failure)

    async def _read_stderr(self, process: asyncio.subprocess.Process) -> None:
        if not process.stderr:
            return
        while True:
            line = await process.stderr.readline()
            if not line:
                return
            text = line.decode("utf-8", errors="replace").strip()
            if text:
                self._stderr_tail.append(text[:1000])
                del self._stderr_tail[:-40]

    @staticmethod
    def _rules() -> dict[str, Any]:
        return {
            "hasButton": False,
            "ko": "POSITIONAL",
            "scoring": "AREA",
            "suicide": False,
            "tax": "NONE",
            "whiteHandicapBonus": "0",
            "friendlyPassOk": True,
        }

    async def query(
        self,
        *,
        profile: KataGo19Profile,
        moves: list[list[str]],
        initial_stones: list[list[str]] | None = None,
        initial_player: str,
        board_size: int,
        komi: float,
        state_token: str,
        position_hash: str,
        history_digest: str,
    ) -> dict[str, Any]:
        if profile not in {"fast", "quality"}:
            raise ValueError("unknown 19x19 KataGo analysis profile")
        if board_size != 19:
            raise ValueError("the full-board KataGo lane accepts only 19x19 positions")
        if initial_player not in {"B", "W"}:
            raise ValueError("19x19 KataGo initial player must be B or W")
        for name, digest in (
            ("state token", state_token),
            ("position hash", position_hash),
            ("history digest", history_digest),
        ):
            if len(digest) != 64 or any(
                character not in "0123456789abcdef" for character in digest
            ):
                raise ValueError(f"19x19 KataGo {name} must be a public SHA-256 binding")
        if self._waiting_queries >= KATAGO19_MAX_WAITERS:
            raise KataGoUnavailable("the bounded 19x19 analysis lane is busy")
        self._waiting_queries += 1
        try:
            async with self._query_lock:
                await self._ensure_profile(profile)
                process = self._process
                if not process or not process.stdin or process.returncode is not None:
                    raise KataGoUnavailable("19x19 KataGo is not running")
                spec = self._specs[profile]
                request_id = f"analysis19-{profile}-{uuid.uuid4().hex}"
                query = {
                    "id": request_id,
                    "moves": moves,
                    "initialPlayer": initial_player,
                    "rules": self._rules(),
                    "komi": komi,
                    "boardXSize": 19,
                    "boardYSize": 19,
                    "maxVisits": spec.max_visits,
                    "analysisPVLen": spec.pv_length,
                    "includeOwnership": True,
                    "includeOwnershipStdev": True,
                    "includeMovesOwnership": True,
                    "includeMovesOwnershipStdev": True,
                    "includePolicy": True,
                    "overrideSettings": {
                        "ignorePreRootHistory": False,
                        "rootNumSymmetriesToSample": 2,
                    },
                }
                if initial_stones:
                    query["initialStones"] = initial_stones
                encoded = json.dumps(query, separators=(",", ":"), ensure_ascii=True).encode()
                line = encoded + b"\n"
                if len(line) > 256_000:
                    raise ValueError("19x19 KataGo query exceeded the request limit")
                binding_query = {key: value for key, value in query.items() if key != "id"}
                query_digest = hashlib.sha256(
                    json.dumps(
                        binding_query,
                        sort_keys=True,
                        separators=(",", ":"),
                        ensure_ascii=True,
                    ).encode()
                ).hexdigest()
                loop = asyncio.get_running_loop()
                future: asyncio.Future[dict[str, Any]] = loop.create_future()
                self._pending[request_id] = future
                started = time.monotonic()
                try:
                    async with self._write_lock:
                        process.stdin.write(line)
                        await process.stdin.drain()
                    self._last_used = time.monotonic()
                    response = await asyncio.wait_for(future, timeout=spec.timeout_seconds)
                except asyncio.CancelledError:
                    await asyncio.shield(self.terminate_query(request_id))
                    raise
                except asyncio.TimeoutError as exc:
                    await self.terminate_query(request_id)
                    raise KataGoUnavailable("19x19 KataGo analysis timed out") from exc
                finally:
                    self._pending.pop(request_id, None)
                    self._last_used = time.monotonic()

                elapsed_ms = round((time.monotonic() - started) * 1000, 3)
                root = response.get("rootInfo")
                actual_visits = root.get("visits") if isinstance(root, dict) else None
                provenance = {
                    "schema_version": 1,
                    "engine": "KataGo",
                    "engine_version": KATAGO_VERSION.removeprefix("v"),
                    "profile": profile,
                    "model": {
                        "name": spec.model_name,
                        "size": spec.model_size,
                        "sha256": spec.model_sha256,
                    },
                    "config": {
                        "name": KATAGO19_CONFIG_NAME,
                        "size": KATAGO19_CONFIG_SIZE,
                        "sha256": KATAGO19_CONFIG_SHA256,
                    },
                    "binary": {
                        "size": KATAGO19_BINARY_SIZE,
                        "sha256": KATAGO19_BINARY_SHA256,
                        "source_commit": KATAGO_SOURCE_COMMIT,
                    },
                    "requested_visits": spec.max_visits,
                    "actual_visits": actual_visits,
                    "elapsed_ms": elapsed_ms,
                    "cache_hit": False,
                    "perspective": "black",
                    "binding": {
                        "state_token": state_token,
                        "position_hash": position_hash,
                        "history_digest": history_digest,
                        "move_number": len(moves),
                        "side_to_move": None,
                        "board_size": 19,
                        "query_sha256": query_digest,
                    },
                }
                if isinstance(root, dict):
                    provenance["binding"]["side_to_move"] = {
                        "B": "black",
                        "W": "white",
                    }.get(root.get("currentPlayer"))
                result = dict(response)
                result["_weiqi_provenance"] = provenance
                return result
        finally:
            self._waiting_queries -= 1

    async def terminate_query(self, request_id: str) -> None:
        process = self._process
        if not process or not process.stdin or process.returncode is not None:
            return
        line = (
            json.dumps(
                {
                    "id": f"stop19-{uuid.uuid4().hex}",
                    "action": "terminate",
                    "terminateId": request_id,
                },
                separators=(",", ":"),
            ).encode()
            + b"\n"
        )
        with contextlib.suppress(BrokenPipeError, ConnectionResetError):
            async with self._write_lock:
                process.stdin.write(line)
                await process.stdin.drain()

    async def _stop_process(
        self,
        process: asyncio.subprocess.Process,
        *,
        cancel_idle: bool = True,
    ) -> None:
        if self._process is not process:
            return
        current = asyncio.current_task()
        tasks = [self._reader_task, self._stderr_task]
        if cancel_idle and self._idle_task is not current:
            tasks.append(self._idle_task)
        for task in tasks:
            if task and task is not current:
                task.cancel()
        if process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
        for task in tasks:
            if task and task is not current:
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        if self._process is process:
            self._process = None
            self._active_profile = None
            self._reader_task = None
            self._stderr_task = None
            if self._idle_task is not current:
                self._idle_task = None

    async def close(self) -> None:
        async with self._query_lock:
            async with self._start_lock:
                if self._process is not None:
                    await self._stop_process(self._process)
                elif self._idle_task:
                    self._idle_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await self._idle_task
                    self._idle_task = None
