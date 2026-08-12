from __future__ import annotations

import asyncio
import hashlib
import json
import time
from pathlib import Path
from typing import Any

import pytest

import weiqi.adapters.katago.full_board as full_board_module
from weiqi.adapters.katago.full_board import KataGo19Process
from weiqi.adapters.katago.process import KataGoUnavailable
from weiqi.config import Settings


class CaptureStdin:
    def __init__(self) -> None:
        self.writes: list[bytes] = []

    def write(self, data: bytes) -> None:
        self.writes.append(data)

    async def drain(self) -> None:
        return None


class FakeProcess:
    def __init__(self) -> None:
        self.returncode: int | None = None
        self.stdin = CaptureStdin()
        self.stdout = None
        self.stderr = None
        self.terminated = False

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = 0

    def kill(self) -> None:
        self.returncode = -9

    async def wait(self) -> int:
        assert self.returncode is not None
        return self.returncode


def _digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _installation(tmp_path: Path, monkeypatch: Any) -> tuple[KataGo19Process, dict[str, Path]]:
    root = tmp_path / "project"
    content = {
        "binary": b"small test executable\n",
        "config": b"small 19 config\n",
        "fast_model": b"small fast model\n",
        "quality_model": b"small quality model\n",
    }
    monkeypatch.setattr(full_board_module, "REPOSITORY_ROOT", root)
    monkeypatch.setattr(full_board_module, "KATAGO19_BINARY_SIZE", len(content["binary"]))
    monkeypatch.setattr(full_board_module, "KATAGO19_BINARY_SHA256", _digest(content["binary"]))
    monkeypatch.setattr(full_board_module, "KATAGO19_CONFIG_SIZE", len(content["config"]))
    monkeypatch.setattr(full_board_module, "KATAGO19_CONFIG_SHA256", _digest(content["config"]))
    monkeypatch.setattr(full_board_module, "KATAGO19_FAST_MODEL_SIZE", len(content["fast_model"]))
    monkeypatch.setattr(
        full_board_module,
        "KATAGO19_FAST_MODEL_SHA256",
        _digest(content["fast_model"]),
    )
    monkeypatch.setattr(
        full_board_module,
        "KATAGO19_QUALITY_MODEL_SIZE",
        len(content["quality_model"]),
    )
    monkeypatch.setattr(
        full_board_module,
        "KATAGO19_QUALITY_MODEL_SHA256",
        _digest(content["quality_model"]),
    )
    paths = {
        "binary": root / ".local/bin/katago",
        "config": root / "config/katago-analysis-19x19.cfg",
        "fast_model": root / ".local/models/katago19/b10c384h6nbttflrs.bin.gz",
        "quality_model": (root / ".local/models/katago19/b11c768h12nbt3tflrs-fson-silu.bin.gz"),
        "manifest": root / ".local/models/katago19/installed-models.sha256",
        "attestation": root / ".local/katago-install-attestation.json",
    }
    for name in ("binary", "config", "fast_model", "quality_model"):
        paths[name].parent.mkdir(parents=True, exist_ok=True)
        paths[name].write_bytes(content[name])
    paths["binary"].chmod(0o755)
    paths["manifest"].write_bytes(full_board_module._manifest_bytes())
    paths["attestation"].write_text(
        json.dumps(
            {
                "schema": 1,
                "katago_version": "v1.17.2",
                "source_commit": "6a1fc5de9fc253723ac475a0683bf0b9d9b7bd19",
                "artifacts": {
                    "binary": {
                        "path": ".local/bin/katago",
                        "size": len(content["binary"]),
                        "sha256": _digest(content["binary"]),
                    },
                    "config": {"path": "unused", "size": 1, "sha256": "0" * 64},
                    "main_model": {"path": "unused", "size": 1, "sha256": "0" * 64},
                    "human_model": {"path": "unused", "size": 1, "sha256": "0" * 64},
                },
            }
        ),
        encoding="utf-8",
    )
    settings = Settings(data_dir=tmp_path / "data", openai_api_key=None)
    settings.katago_executable = paths["binary"]
    settings.katago19_config = paths["config"]
    settings.katago19_fast_model = paths["fast_model"]
    settings.katago19_quality_model = paths["quality_model"]
    return KataGo19Process(settings), paths


@pytest.mark.asyncio
async def test_full_board_readiness_attests_every_runtime_artifact(
    tmp_path: Path, monkeypatch: Any
) -> None:
    manager, paths = _installation(tmp_path, monkeypatch)
    assert manager.files_ready() is True
    status = await manager.status()
    assert status["available"] is True
    assert status["profiles"]["fast"]["model_sha256"] == _digest(b"small fast model\n")
    assert status["profiles"]["quality"]["model_sha256"] == _digest(b"small quality model\n")

    original = paths["quality_model"].read_bytes()
    paths["quality_model"].write_bytes(b"X" + original[1:])
    assert manager.files_ready() is False
    paths["quality_model"].write_bytes(original)
    assert manager.files_ready() is True

    paths["manifest"].write_text("not the reviewed manifest\n", encoding="ascii")
    assert manager.files_ready() is False


@pytest.mark.asyncio
async def test_full_board_profile_switch_stops_old_model_before_starting_new_one(
    tmp_path: Path, monkeypatch: Any
) -> None:
    manager, paths = _installation(tmp_path, monkeypatch)
    processes: list[FakeProcess] = []
    commands: list[tuple[object, ...]] = []

    async def create_process(*args: object, **_kwargs: Any) -> FakeProcess:
        commands.append(args)
        process = FakeProcess()
        processes.append(process)
        return process

    async def no_idle(_process: object) -> None:
        await asyncio.Event().wait()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)
    monkeypatch.setattr(manager, "_release_when_idle", no_idle)
    await manager._ensure_profile("fast")
    assert manager._active_profile == "fast"
    assert str(paths["fast_model"]) in commands[0]

    await manager._ensure_profile("quality")
    assert processes[0].terminated is True
    assert processes[0].returncode == 0
    assert manager._process is processes[1]
    assert manager._active_profile == "quality"
    assert str(paths["quality_model"]) in commands[1]
    assert sum(process.returncode is None for process in processes) == 1
    await manager.close()


@pytest.mark.asyncio
async def test_full_board_query_is_bounded_and_returns_complete_provenance(
    tmp_path: Path, monkeypatch: Any
) -> None:
    settings = Settings(data_dir=tmp_path / "data", openai_api_key=None)
    manager = KataGo19Process(settings)
    process = FakeProcess()
    manager._process = process  # type: ignore[assignment]
    manager._active_profile = "fast"

    async def already_started(_profile: str) -> None:
        return None

    monkeypatch.setattr(manager, "_ensure_profile", already_started)
    task = asyncio.create_task(
        manager.query(
            profile="fast",
            moves=[],
            initial_player="B",
            board_size=19,
            komi=7.5,
            state_token="a" * 64,
            position_hash="b" * 64,
            history_digest="c" * 64,
        )
    )
    await asyncio.sleep(0)
    request = json.loads(process.stdin.writes[0])
    assert request["maxVisits"] == 24
    assert request["boardXSize"] == request["boardYSize"] == 19
    assert request["includeOwnership"] is True
    assert request["includeMovesOwnership"] is True
    assert request["overrideSettings"] == {
        "ignorePreRootHistory": False,
        "rootNumSymmetriesToSample": 2,
    }
    manager._pending[request["id"]].set_result(
        {
            "id": request["id"],
            "turnNumber": 0,
            "rootInfo": {"currentPlayer": "B", "visits": 24},
            "moveInfos": [],
        }
    )
    result = await task
    provenance = result["_weiqi_provenance"]
    assert provenance["profile"] == "fast"
    assert provenance["requested_visits"] == provenance["actual_visits"] == 24
    assert provenance["cache_hit"] is False
    assert provenance["perspective"] == "black"
    assert provenance["binding"] == {
        "state_token": "a" * 64,
        "position_hash": "b" * 64,
        "history_digest": "c" * 64,
        "move_number": 0,
        "side_to_move": "black",
        "board_size": 19,
        "query_sha256": provenance["binding"]["query_sha256"],
    }
    assert len(provenance["binding"]["query_sha256"]) == 64


@pytest.mark.asyncio
async def test_full_board_cancellation_terminates_engine_work_and_busy_bound_rejects(
    tmp_path: Path, monkeypatch: Any
) -> None:
    settings = Settings(data_dir=tmp_path / "data", openai_api_key=None)
    manager = KataGo19Process(settings)
    process = FakeProcess()
    manager._process = process  # type: ignore[assignment]
    manager._active_profile = "fast"

    async def already_started(_profile: str) -> None:
        return None

    monkeypatch.setattr(manager, "_ensure_profile", already_started)
    task = asyncio.create_task(
        manager.query(
            profile="fast",
            moves=[],
            initial_player="B",
            board_size=19,
            komi=7.5,
            state_token="a" * 64,
            position_hash="b" * 64,
            history_digest="c" * 64,
        )
    )
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(process.stdin.writes) == 2
    stop = json.loads(process.stdin.writes[1])
    assert stop["action"] == "terminate"
    assert stop["terminateId"].startswith("analysis19-fast-")

    manager._waiting_queries = full_board_module.KATAGO19_MAX_WAITERS
    with pytest.raises(KataGoUnavailable, match="busy"):
        await manager.query(
            profile="fast",
            moves=[],
            initial_player="B",
            board_size=19,
            komi=7.5,
            state_token="a" * 64,
            position_hash="b" * 64,
            history_digest="c" * 64,
        )


@pytest.mark.asyncio
async def test_full_board_idle_reaper_never_releases_pending_or_locked_work(
    tmp_path: Path, monkeypatch: Any
) -> None:
    settings = Settings(data_dir=tmp_path / "data", openai_api_key=None)
    settings.katago19_idle_seconds = 0.04
    manager = KataGo19Process(settings)
    process = FakeProcess()
    manager._process = process  # type: ignore[assignment]
    manager._active_profile = "fast"
    manager._last_used = time.monotonic() - 1
    manager._pending["active"] = asyncio.get_running_loop().create_future()
    task = asyncio.create_task(manager._release_when_idle(process))  # type: ignore[arg-type]
    await asyncio.sleep(0.12)
    assert process.terminated is False
    manager._pending.pop("active").cancel()
    await asyncio.wait_for(task, timeout=0.3)
    assert process.terminated is True


def test_full_board_paths_reject_external_and_symlinked_model_trees(
    tmp_path: Path, monkeypatch: Any
) -> None:
    manager, paths = _installation(tmp_path, monkeypatch)
    outside = tmp_path / "outside-fast.bin.gz"
    outside.write_bytes(paths["fast_model"].read_bytes())
    manager._settings.katago19_fast_model = outside
    assert manager.files_ready() is False

    manager, paths = _installation(tmp_path / "second", monkeypatch)
    target = paths["fast_model"].with_suffix(".real")
    paths["fast_model"].rename(target)
    paths["fast_model"].symlink_to(target)
    assert manager.files_ready() is False


def test_full_board_visit_and_timeout_settings_are_strictly_bounded(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        Settings(
            data_dir=tmp_path / "data",
            openai_api_key=None,
            katago19_fast_max_visits=33,
        )
    with pytest.raises(ValueError):
        Settings(
            data_dir=tmp_path / "data-2",
            openai_api_key=None,
            katago19_quality_timeout_seconds=91,
        )
