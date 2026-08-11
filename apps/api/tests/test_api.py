from __future__ import annotations

import asyncio
import json
import runpy
from pathlib import Path
from typing import Any

import anyio
import pytest
from starlette.requests import Request

from weiqi import main as main_module
from weiqi.config import Settings
from weiqi.main import (
    MAX_JSON_BODY_BYTES,
    RequestBodyLimitMiddleware,
    _preview_while_connected,
    _validated_web_dist,
)
from weiqi.services import providers as providers_module


def test_browser_security_headers_are_present(app_client_factory: Any) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        response = client.get("/healthz")
        assert response.status_code == 200
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
        assert "font-src 'self' data:" in response.headers["content-security-policy"]
        assert response.headers["cross-origin-opener-policy"] == "same-origin"
        assert response.headers["cache-control"] == "no-store"

        assert client.get("/docs").status_code == 404
        schema = client.get("/openapi.json")
        assert schema.status_code == 200
        assert "default-src 'self'" in schema.headers["content-security-policy"]


def test_static_web_root_rejects_symlinks_without_touching_the_target(tmp_path: Path) -> None:
    web_root = tmp_path / "apps" / "web"
    outside = tmp_path / "outside"
    web_root.mkdir(parents=True)
    outside.mkdir()
    sentinel = outside / "sentinel.txt"
    sentinel.write_text("keep me\n", encoding="utf-8")
    (web_root / "dist").symlink_to(outside, target_is_directory=True)

    with pytest.raises(RuntimeError, match="must not be a symbolic link"):
        _validated_web_dist(web_root / "dist")
    assert sentinel.read_text(encoding="utf-8") == "keep me\n"


def test_simple_ui_route_serves_the_reviewed_spa_entry(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    app_client_factory: Any,
) -> None:
    web_root = tmp_path / "apps" / "web"
    web_dist = web_root / "dist"
    web_dist.mkdir(parents=True)
    entry = "<!doctype html><title>Path of Influence</title><div id='root'></div>"
    (web_dist / "index.html").write_text(entry, encoding="utf-8")
    monkeypatch.setattr(main_module, "_web_dist", lambda: web_dist)

    with app_client_factory() as (client, _katago, _openai, _local):
        for route in ("/", "/simple", "/simple/", "/full", "/full/"):
            response = client.get(route)
            assert response.status_code == 200
            assert response.text == entry
            assert response.headers["content-type"].startswith("text/html")
            assert "frame-ancestors 'none'" in response.headers["content-security-policy"]


def test_blank_openai_key_is_unconfigured(tmp_path: Any) -> None:
    configured = Settings(data_dir=tmp_path / "data", openai_api_key="   ")
    assert configured.openai_api_key is None


@pytest.mark.asyncio
async def test_disconnected_preview_cancels_its_expensive_operation() -> None:
    cancelled = asyncio.Event()
    operation_started = asyncio.Event()
    disconnect = asyncio.Event()
    response_sent = anyio.Event()

    async def raw_receive() -> dict[str, Any]:
        await disconnect.wait()
        return {"type": "http.disconnect"}

    async def receive_or_disconnect() -> dict[str, Any]:
        """Match the receive race installed by Starlette BaseHTTPMiddleware."""

        if response_sent.is_set():
            return {"type": "http.disconnect"}
        async with anyio.create_task_group() as task_group:

            async def race(awaitable: Any) -> Any:
                result = await awaitable()
                task_group.cancel_scope.cancel()
                return result

            task_group.start_soon(race, response_sent.wait)
            message = await race(raw_receive)
        return {"type": "http.disconnect"} if response_sent.is_set() else message

    request = Request({"type": "http"}, receive=receive_or_disconnect)

    async def operation() -> dict[str, Any]:
        operation_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    waiting = asyncio.create_task(_preview_while_connected(request, operation()))
    await operation_started.wait()
    disconnect.set()
    result = await waiting

    assert result is None
    assert cancelled.is_set()


def test_data_directory_rejects_broad_or_root_level_targets(tmp_path: Path) -> None:
    repository_parent = Path(__file__).resolve().parents[4]
    for unsafe in (Path("/"), Path.home(), Path("/weiqi-data")):
        configured = Settings(data_dir=unsafe, openai_api_key=None)
        with pytest.raises(ValueError, match="dedicated child"):
            configured.prepare_data_dir()
    with pytest.raises(ValueError, match="not owned"):
        Settings(data_dir=repository_parent, openai_api_key=None).prepare_data_dir()

    safe = Settings(data_dir=tmp_path / "weiqi-data", openai_api_key=None)
    assert safe.prepare_data_dir() == (tmp_path / "weiqi-data").resolve()
    assert (tmp_path / "weiqi-data/.weiqi-data-owner").read_text() == "weiqi-data-v1\n"


def test_browser_smoke_rejects_broad_and_symlink_evidence_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    smoke_script = Path(__file__).resolve().parents[3] / "scripts/browser-smoke.py"
    monkeypatch.setenv("WEIQI_NOVNC_RUNTIME_DIR", "/")
    with pytest.raises(ValueError, match="dedicated child"):
        runpy.run_path(str(smoke_script))

    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "target").mkdir()
    (runtime / ".weiqi-runtime-owner").write_text("weiqi-browser-runtime-v1\n")
    (runtime / "evidence").symlink_to(runtime / "target", target_is_directory=True)
    monkeypatch.setenv("WEIQI_NOVNC_RUNTIME_DIR", str(runtime))
    with pytest.raises(ValueError, match="evidence directory"):
        runpy.run_path(str(smoke_script))

    monkeypatch.setenv("WEIQI_NOVNC_RUNTIME_DIR", str(smoke_script.parents[2]))
    with pytest.raises(ValueError, match="not owned"):
        runpy.run_path(str(smoke_script))


def test_browser_smoke_serializes_shared_visible_workflows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    smoke_script = Path(__file__).resolve().parents[3] / "scripts/browser-smoke.py"
    runtime = tmp_path / "browser-runtime"
    monkeypatch.setenv("WEIQI_NOVNC_RUNTIME_DIR", str(runtime))
    namespace = runpy.run_path(str(smoke_script))
    exclusive_smoke_run = namespace["exclusive_smoke_run"]
    assert namespace["_loopback_http_url"]("http://127.0.0.1:8010/api/status")
    assert namespace["_loopback_http_url"]("http://localhost:8010/")
    assert not namespace["_loopback_http_url"]("https://example.org/private?token=SECRET")
    safe_label = namespace["_safe_request_label"](
        "GET", "https://user:pass@example.org/private?token=SECRET"
    )
    assert safe_label == "GET https://example.org/private"

    with exclusive_smoke_run():
        with pytest.raises(RuntimeError, match="already running"):
            with exclusive_smoke_run():
                raise AssertionError("the second smoke unexpectedly acquired the lock")


def test_browser_smoke_ledger_recovers_only_exact_recorded_game_ids(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    smoke_script = Path(__file__).resolve().parents[3] / "scripts/browser-smoke.py"
    runtime = tmp_path / "browser-runtime"
    monkeypatch.setenv("WEIQI_NOVNC_RUNTIME_DIR", str(runtime))
    namespace = runpy.run_path(str(smoke_script))
    namespace["_prepare_runtime_dir"]()
    ledger_type = namespace["SmokeGameLedger"]
    first_id = "game_" + "1" * 32
    second_id = "game_" + "2" * 32
    ledger = ledger_type("prior-smoke")
    ledger.record(first_id, 1)
    ledger.record(second_id, 4)
    ledger_path = runtime / ".smoke-games.json"
    assert ledger_path.stat().st_mode & 0o777 == 0o600

    class FakeApi:
        def __init__(self) -> None:
            self.deleted: list[str] = []

        def delete_latest(self, game_id: str) -> None:
            self.deleted.append(game_id)

    api = FakeApi()
    recovered = namespace["_recover_stale_smoke_ledger"](api)
    assert recovered == 2
    assert api.deleted == [first_id, second_id]
    assert not ledger_path.exists()

    with pytest.raises(RuntimeError, match="invalid entry"):
        ledger_type("current-smoke").record("game_not-an-id", 1)
    assert api.deleted == [first_id, second_id]


def test_browser_smoke_ledger_rejects_symlink_oversize_and_retains_failures(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    smoke_script = Path(__file__).resolve().parents[3] / "scripts/browser-smoke.py"
    runtime = tmp_path / "browser-runtime"
    monkeypatch.setenv("WEIQI_NOVNC_RUNTIME_DIR", str(runtime))
    namespace = runpy.run_path(str(smoke_script))
    namespace["_prepare_runtime_dir"]()
    ledger_type = namespace["SmokeGameLedger"]
    game_id = "game_" + "a" * 32
    ledger = ledger_type("recoverable-smoke")
    ledger.record(game_id, 1)
    ledger_path = runtime / ".smoke-games.json"

    class FailingApi:
        def delete_latest(self, requested_id: str) -> None:
            assert requested_id == game_id
            raise RuntimeError("API unavailable")

    errors = ledger.cleanup(FailingApi())
    assert len(errors) == 1
    assert game_id in errors[0]
    assert ledger_path.exists()
    assert ledger_type.load().games == [{"id": game_id, "revision": 1}]

    ledger_path.unlink()
    target = runtime / "foreign-ledger"
    target.write_text("{}")
    ledger_path.symlink_to(target)
    with pytest.raises(RuntimeError, match="regular file"):
        ledger_type.load()

    ledger_path.unlink()
    ledger_path.write_bytes(b"x" * (namespace["MAX_LEDGER_BYTES"] + 1))
    with pytest.raises(RuntimeError, match="size bound"):
        ledger_type.load()


def test_browser_smoke_reports_blocked_chrome_attempts_without_calling_them_quiet(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    smoke_script = Path(__file__).resolve().parents[3] / "scripts/browser-smoke.py"
    runtime = tmp_path / "browser-runtime"
    monkeypatch.setenv("WEIQI_NOVNC_RUNTIME_DIR", str(runtime))
    namespace = runpy.run_path(str(smoke_script))
    namespace["_prepare_runtime_dir"]()
    related = namespace["_crashpad_start_is_related"]
    is_owned_crashpad = namespace["_is_owned_chrome_crashpad"]
    crashpad_binding = namespace["_crashpad_handler_binding"]
    assert related(10_000, 10_001, 100)
    assert related(10_000, 16_000, 100)
    assert not related(10_000, 16_001, 100)
    assert not related(10_000, 9_799, 100)
    assert is_owned_crashpad(Path("/opt/google/chrome/chrome_crashpad_handler"), "chrome_crashpad")
    assert not is_owned_crashpad(Path("/usr/bin/python3"), "python3")
    assert not is_owned_crashpad(Path("/opt/google/chrome/chrome"), "chrome_crashpad_handler")
    assert crashpad_binding(b"chrome\x00--crashpad-handler-pid=1234\x00") == 1234
    assert crashpad_binding(b"chrome\x00--enable-crash-reporter=,\x00") is None
    logs = runtime / "logs"
    logs.mkdir()
    chrome_log = logs / "chrome.log"
    chrome_log.write_text(
        "[google_apis/gcm] Failed to connect to MCS endpoint with error -130\n"
        "[google_apis/gcm] Registration URL fetching failed; "
        "https://user:pass@example.test/register?token=SECRET\n"
    )
    report = namespace["_background_network_log_report"]()
    assert report["quiet"] is False
    assert report["known_blocked"] is True
    assert namespace["_background_network_contained"](report, [], []) is True
    assert len(report["evidence"]) == 2
    assert all(len(item) <= 240 for item in report["evidence"])
    assert "SECRET" not in json.dumps(report["evidence"])
    assert (
        namespace["_background_network_contained"](
            report, ["external tcp browser peer 203.0.113.1:443"], []
        )
        is False
    )

    chrome_log.write_text("[google_apis/gcm] Registration response succeeded for an FCM token\n")
    unexpected = namespace["_background_network_log_report"]()
    assert unexpected["quiet"] is False
    assert unexpected["known_blocked"] is False
    assert unexpected["unexpected"]
    assert namespace["_background_network_contained"](unexpected, [], []) is False


def test_status_falls_back_cleanly_on_provider_timeout(app_client_factory: Any) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):

        async def timed_out() -> dict[str, Any]:
            raise asyncio.TimeoutError

        client.app.state.providers.status = timed_out
        response = client.get("/api/status")
        assert response.status_code == 200
        assert response.json()["coach"]["provider"] == "Deterministic companion"


def test_status_does_not_claim_a_missing_local_alias_is_ready(app_client_factory: Any) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):

        async def missing_alias() -> dict[str, Any]:
            return {
                "openai": {"available": False, "configured": False},
                "localllm": {"available": True, "coach_ready": False},
            }

        client.app.state.providers.status = missing_alias
        response = client.get("/api/status")
        assert response.status_code == 200
        assert response.json()["coach"]["provider"] == "Deterministic companion"


def test_hanging_openai_status_does_not_enable_default_off_local_prose(
    app_client_factory: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    with app_client_factory() as (client, _katago, openai, local):

        async def hanging_openai() -> dict[str, Any]:
            await asyncio.Event().wait()
            raise AssertionError("unreachable")

        async def healthy_local() -> dict[str, Any]:
            return {
                "available": True,
                "coach_ready": True,
                "coach_model": "localllm-balanced",
            }

        monkeypatch.setattr(providers_module, "PROVIDER_STATUS_TIMEOUT_SECONDS", 0.01)
        monkeypatch.setattr(openai, "status", hanging_openai)
        monkeypatch.setattr(local, "status", healthy_local)
        response = client.get("/api/status")
        assert response.status_code == 200
        assert response.json()["coach"]["provider"] == "Deterministic companion"
        status = client.app.state.providers
        assert status.allow_local_prose is False


def test_malformed_optional_provider_status_fails_soft(
    app_client_factory: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    with app_client_factory() as (client, _katago, openai, local):

        async def healthy_openai() -> dict[str, Any]:
            return {"available": False, "configured": False}

        async def malformed_local() -> dict[str, Any]:
            raise AttributeError("malformed model payload")

        monkeypatch.setattr(openai, "status", healthy_openai)
        monkeypatch.setattr(local, "status", malformed_local)
        response = client.get("/api/status")
        assert response.status_code == 200
        assert response.json()["coach"]["provider"] == "Deterministic companion"


def test_api_rejects_untrusted_hosts(app_client_factory: Any) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        response = client.get("/healthz", headers={"Host": "attacker.example"})
        assert response.status_code == 400
        assert "Invalid host" in response.text


def test_api_rejects_oversized_json_before_validation(app_client_factory: Any) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        response = client.post(
            "/api/games",
            content=b"{" + b'"padding":"' + b"x" * MAX_JSON_BODY_BYTES + b'"}',
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 413, response.text
        assert response.json()["code"] == "body_too_large"


@pytest.mark.asyncio
async def test_body_limit_counts_streamed_bytes_when_content_length_is_absent() -> None:
    async def downstream(_scope: Any, receive: Any, send: Any) -> None:
        while True:
            message = await receive()
            if not message.get("more_body"):
                break
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    incoming = iter(
        [
            {"type": "http.request", "body": b"123456", "more_body": True},
            {"type": "http.request", "body": b"789012", "more_body": False},
        ]
    )
    outgoing: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        return next(incoming)

    async def send(message: dict[str, Any]) -> None:
        outgoing.append(message)

    middleware = RequestBodyLimitMiddleware(downstream, maximum=10)
    await middleware(
        {"type": "http", "method": "POST", "headers": []},
        receive,
        send,
    )

    assert outgoing[0]["status"] == 413
    assert b"body_too_large" in outgoing[1]["body"]


def test_api_rejects_extra_fields_and_malformed_resource_ids(app_client_factory: Any) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        extra = client.post(
            "/api/games",
            json={"board_size": 9, "mode": "human_companion", "admin": True},
        )
        assert extra.status_code == 422
        assert extra.json()["code"] == "invalid_request"

        malformed = client.get("/api/games/../../etc/passwd")
        assert malformed.status_code in {404, 422}
