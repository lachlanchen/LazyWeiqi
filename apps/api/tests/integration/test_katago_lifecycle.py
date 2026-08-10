from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any

import pytest

import weiqi.adapters.katago.process as process_module
from weiqi.adapters.katago.process import KataGoProcess
from weiqi.config import Settings


class IdleProcess:
    returncode: int | None = None


class FreshProcess:
    def __init__(self) -> None:
        self.returncode: int | None = None
        self.stdin = None
        self.stdout = None
        self.stderr = None

    def terminate(self) -> None:
        self.returncode = 0

    def kill(self) -> None:
        self.returncode = -9

    async def wait(self) -> int:
        assert self.returncode is not None
        return self.returncode


class CaptureStdin:
    def __init__(self) -> None:
        self.writes: list[bytes] = []

    def write(self, data: bytes) -> None:
        self.writes.append(data)

    async def drain(self) -> None:
        return None


class QueryProcess:
    def __init__(self) -> None:
        self.returncode: int | None = None
        self.stdin = CaptureStdin()


@pytest.mark.asyncio
async def test_idle_reaper_releases_a_quiet_engine(monkeypatch: Any, tmp_path: Path) -> None:
    settings = Settings(data_dir=tmp_path / "data", openai_api_key=None)
    settings.katago_idle_seconds = 0.04  # assignment is intentionally local to this unit test
    manager = KataGoProcess(settings)
    process = IdleProcess()
    manager._process = process  # type: ignore[assignment]
    manager._last_used = time.monotonic() - 1
    stopped: list[tuple[object, bool]] = []

    async def record_stop(target: object, *, cancel_idle: bool = True) -> None:
        stopped.append((target, cancel_idle))
        target.returncode = 0  # type: ignore[attr-defined]
        manager._process = None

    monkeypatch.setattr(manager, "_stop_process", record_stop)
    await asyncio.wait_for(manager._release_when_idle(process), timeout=0.3)  # type: ignore[arg-type]

    assert stopped == [(process, False)]


@pytest.mark.asyncio
async def test_query_requests_after_move_ownership_in_the_single_root_analysis(
    monkeypatch: Any, tmp_path: Path
) -> None:
    settings = Settings(data_dir=tmp_path / "data", openai_api_key=None)
    manager = KataGoProcess(settings)
    process = QueryProcess()
    manager._process = process  # type: ignore[assignment]

    async def already_started() -> None:
        return None

    monkeypatch.setattr(manager, "_start", already_started)
    task = asyncio.create_task(
        manager.query(
            moves=[],
            board_size=9,
            komi=7.5,
            rank_profile="rank_20k",
        )
    )
    await asyncio.sleep(0)
    request = json.loads(process.stdin.writes[0])
    assert request["includeOwnership"] is True
    assert request["includeOwnershipStdev"] is True
    assert request["includeMovesOwnership"] is True
    assert request["includeMovesOwnershipStdev"] is True
    manager._pending[request["id"]].set_result({"id": request["id"], "moveInfos": []})
    await task


@pytest.mark.asyncio
async def test_idle_reaper_does_not_release_with_an_analysis_pending(
    monkeypatch: Any, tmp_path: Path
) -> None:
    settings = Settings(data_dir=tmp_path / "data", openai_api_key=None)
    settings.katago_idle_seconds = 0.04
    manager = KataGoProcess(settings)
    process = IdleProcess()
    manager._process = process  # type: ignore[assignment]
    manager._last_used = time.monotonic() - 1
    manager._pending["analysis-test"] = asyncio.get_running_loop().create_future()
    stopped: list[object] = []

    async def record_stop(target: object, *, cancel_idle: bool = True) -> None:
        stopped.append(target)

    monkeypatch.setattr(manager, "_stop_process", record_stop)
    task = asyncio.create_task(manager._release_when_idle(process))  # type: ignore[arg-type]
    await asyncio.sleep(0.12)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

    assert stopped == []


@pytest.mark.asyncio
async def test_start_waits_for_idle_stop_and_publishes_a_fresh_live_process(
    monkeypatch: Any, tmp_path: Path
) -> None:
    monkeypatch.setattr(process_module, "REPOSITORY_ROOT", tmp_path)
    settings = Settings(data_dir=tmp_path / "data", openai_api_key=None)
    settings.katago_idle_seconds = 0.04
    settings.katago_config = tmp_path / "config" / process_module.CONFIG_NAME
    settings.katago_executable = tmp_path / ".local/bin/katago"
    settings.katago_model = tmp_path / f".local/models/katago/{process_module.MAIN_MODEL_NAME}"
    settings.katago_human_model = (
        tmp_path / f".local/models/katago/{process_module.HUMAN_MODEL_NAME}"
    )
    manager = KataGoProcess(settings)
    old_process = IdleProcess()
    fresh_process = FreshProcess()
    manager._process = old_process  # type: ignore[assignment]
    manager._last_used = time.monotonic() - 1
    stop_entered = asyncio.Event()
    allow_stop = asyncio.Event()
    hold_background = asyncio.Event()
    start_kwargs: dict[str, Any] = {}
    real_stop = manager._stop_process

    async def stop_at_barrier(target: object, *, cancel_idle: bool = True) -> None:
        assert target is old_process
        assert cancel_idle is False
        stop_entered.set()
        await allow_stop.wait()
        target.returncode = 0  # type: ignore[attr-defined]
        manager._process = None

    async def create_process(*_args: Any, **kwargs: Any) -> FreshProcess:
        start_kwargs.update(kwargs)
        return fresh_process

    async def hold_reader() -> None:
        await hold_background.wait()

    async def hold_idle(_process: object) -> None:
        await hold_background.wait()

    monkeypatch.setattr(manager, "_stop_process", stop_at_barrier)
    monkeypatch.setattr(manager, "files_ready", lambda: True)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)

    reaper = asyncio.create_task(manager._release_when_idle(old_process))  # type: ignore[arg-type]
    manager._idle_task = reaper
    await asyncio.wait_for(stop_entered.wait(), timeout=0.3)

    monkeypatch.setattr(manager, "_read_stdout", hold_reader)
    monkeypatch.setattr(manager, "_read_stderr", hold_reader)
    monkeypatch.setattr(manager, "_release_when_idle", hold_idle)
    concurrent_start = asyncio.create_task(manager._start())
    await asyncio.sleep(0)

    assert not concurrent_start.done()
    assert manager._process is old_process

    allow_stop.set()
    await asyncio.wait_for(reaper, timeout=0.3)
    await asyncio.wait_for(concurrent_start, timeout=0.3)

    assert manager._process is fresh_process
    assert fresh_process.returncode is None
    assert start_kwargs["cwd"] == str(settings.katago_config.parent.parent)

    monkeypatch.setattr(manager, "_stop_process", real_stop)
    await manager.close()
