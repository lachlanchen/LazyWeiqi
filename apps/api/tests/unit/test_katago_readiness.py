from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

import pytest

import weiqi.adapters.katago.process as process_module
from weiqi.adapters.katago.process import KataGoProcess
from weiqi.config import Settings


def _digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _installation(
    tmp_path: Path,
    monkeypatch: Any,
    *,
    write_attestation: bool = True,
) -> tuple[KataGoProcess, dict[str, Path]]:
    root = tmp_path / "project"
    contents = {
        "binary": b"test-only katago executable\n",
        "config": b"test-only exact config\n",
        "main_model": b"test-only main model\n",
        "human_model": b"test-only human model\n",
    }
    expectations = {
        "binary": process_module._ArtifactExpectation(
            ".local/bin/katago", None, None, executable=True
        ),
        "config": process_module._ArtifactExpectation(
            "config/katago-analysis-9x9.cfg",
            len(contents["config"]),
            _digest(contents["config"]),
        ),
        "main_model": process_module._ArtifactExpectation(
            f".local/models/katago/{process_module.MAIN_MODEL_NAME}",
            len(contents["main_model"]),
            _digest(contents["main_model"]),
        ),
        "human_model": process_module._ArtifactExpectation(
            f".local/models/katago/{process_module.HUMAN_MODEL_NAME}",
            len(contents["human_model"]),
            _digest(contents["human_model"]),
        ),
    }
    monkeypatch.setattr(process_module, "_expected_artifacts", lambda: expectations)
    monkeypatch.setattr(process_module, "REPOSITORY_ROOT", root)

    paths = {name: root / item.relative_path for name, item in expectations.items()}
    for name, path in paths.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(contents[name])
    paths["binary"].chmod(0o755)

    attestation_path = root / process_module.KATAGO_ATTESTATION_RELATIVE_PATH
    if write_attestation:
        attestation_path.parent.mkdir(parents=True, exist_ok=True)
        attestation_path.write_text(
            json.dumps(
                {
                    "schema": process_module.KATAGO_ATTESTATION_SCHEMA,
                    "katago_version": process_module.KATAGO_VERSION,
                    "source_commit": process_module.KATAGO_SOURCE_COMMIT,
                    "artifacts": {
                        name: {
                            "path": expectation.relative_path,
                            "size": len(contents[name]),
                            "sha256": _digest(contents[name]),
                        }
                        for name, expectation in expectations.items()
                    },
                }
            ),
            encoding="utf-8",
        )
    paths["attestation"] = attestation_path

    settings = Settings(data_dir=tmp_path / "data", openai_api_key=None)
    settings.katago_executable = paths["binary"]
    settings.katago_config = paths["config"]
    settings.katago_model = paths["main_model"]
    settings.katago_human_model = paths["human_model"]
    return KataGoProcess(settings), paths


@pytest.mark.asyncio
async def test_arbitrary_regular_files_without_setup_attestation_are_not_ready(
    tmp_path: Path, monkeypatch: Any
) -> None:
    manager, _ = _installation(tmp_path, monkeypatch, write_attestation=False)

    status = await manager.status()

    assert status["available"] is False
    assert status["version"] is None
    assert "attestation" in status["detail"]


@pytest.mark.asyncio
async def test_readiness_requires_executable_regular_non_symlink_binary(
    tmp_path: Path, monkeypatch: Any
) -> None:
    manager, paths = _installation(tmp_path, monkeypatch)
    paths["binary"].chmod(0o644)
    assert manager.files_ready() is False

    paths["binary"].chmod(0o755)
    assert manager.files_ready() is True
    target = paths["binary"].with_suffix(".real")
    paths["binary"].rename(target)
    paths["binary"].symlink_to(target)

    assert manager.files_ready() is False


@pytest.mark.asyncio
async def test_readiness_requires_exact_pinned_project_local_names(
    tmp_path: Path, monkeypatch: Any
) -> None:
    manager, paths = _installation(tmp_path, monkeypatch)
    renamed_model = paths["main_model"].with_name("arbitrary-network.bin.gz")
    renamed_model.write_bytes(paths["main_model"].read_bytes())
    manager._settings.katago_model = renamed_model

    assert manager.files_ready() is False


@pytest.mark.asyncio
async def test_readiness_rejects_a_parallel_tree_outside_the_repository_root(
    tmp_path: Path, monkeypatch: Any
) -> None:
    manager, paths = _installation(tmp_path, monkeypatch)
    expected_root = paths["config"].parent.parent
    alternate_root = tmp_path / "alternate-project"
    alternate_config = alternate_root / "config" / process_module.CONFIG_NAME
    alternate_config.parent.mkdir(parents=True)
    alternate_config.write_bytes(paths["config"].read_bytes())
    manager._settings.katago_config = alternate_config

    assert process_module.REPOSITORY_ROOT == expected_root
    assert manager.files_ready() is False


@pytest.mark.asyncio
async def test_readiness_rejects_symlinked_project_local_parents(
    tmp_path: Path, monkeypatch: Any
) -> None:
    manager, paths = _installation(tmp_path, monkeypatch)
    assert manager.files_ready() is True
    project_root = paths["config"].parent.parent

    outside_models = tmp_path / "outside-models"
    (project_root / ".local/models").rename(outside_models)
    (project_root / ".local/models").symlink_to(outside_models, target_is_directory=True)
    sentinel = outside_models / "sentinel.txt"
    sentinel.write_text("keep me\n", encoding="utf-8")

    assert manager.files_ready() is False
    assert sentinel.read_text(encoding="utf-8") == "keep me\n"


@pytest.mark.asyncio
async def test_readiness_rejects_symlinked_runtime_parent_before_start(
    tmp_path: Path, monkeypatch: Any
) -> None:
    manager, paths = _installation(tmp_path, monkeypatch)
    project_root = paths["config"].parent.parent
    outside_runtime = tmp_path / "outside-runtime"
    outside_runtime.mkdir()
    (outside_runtime / "sentinel.txt").write_text("keep me\n", encoding="utf-8")
    (project_root / ".local/runtime").symlink_to(outside_runtime, target_is_directory=True)

    assert manager.files_ready() is False
    assert (outside_runtime / "sentinel.txt").read_text(encoding="utf-8") == "keep me\n"


@pytest.mark.asyncio
async def test_tampered_model_or_attestation_invalidates_readiness(
    tmp_path: Path, monkeypatch: Any
) -> None:
    manager, paths = _installation(tmp_path, monkeypatch)
    assert manager.files_ready() is True

    original = paths["main_model"].read_bytes()
    paths["main_model"].write_bytes(b"X" + original[1:])
    assert manager.files_ready() is False

    paths["main_model"].write_bytes(original)
    assert manager.files_ready() is True

    original_config = paths["config"].read_bytes()
    paths["config"].write_bytes(b"X" + original_config[1:])
    assert manager.files_ready() is False
    paths["config"].write_bytes(original_config)
    assert manager.files_ready() is True

    original_binary = paths["binary"].read_bytes()
    paths["binary"].write_bytes(b"X" + original_binary[1:])
    assert manager.files_ready() is False
    paths["binary"].write_bytes(original_binary)
    paths["binary"].chmod(0o755)
    assert manager.files_ready() is True

    attestation = json.loads(paths["attestation"].read_text(encoding="utf-8"))
    attestation["katago_version"] = "v0.0.0"
    paths["attestation"].write_text(json.dumps(attestation), encoding="utf-8")

    status = await manager.status()
    assert status["available"] is False
    assert status["version"] is None


@pytest.mark.asyncio
async def test_unchanged_file_signatures_reuse_hash_verification_cache(
    tmp_path: Path, monkeypatch: Any
) -> None:
    manager, paths = _installation(tmp_path, monkeypatch)
    real_sha256 = process_module._sha256_regular_file
    verified: list[Path] = []

    def counting_sha256(path: Path, signature: object) -> str:
        verified.append(path)
        return real_sha256(path, signature)  # type: ignore[arg-type]

    monkeypatch.setattr(process_module, "_sha256_regular_file", counting_sha256)

    assert manager.files_ready() is True
    assert (await manager.status())["available"] is True
    assert manager.files_ready() is True
    assert len(verified) == 4

    current = paths["config"].stat()
    os.utime(
        paths["config"],
        ns=(current.st_atime_ns, current.st_mtime_ns + 1_000_000),
    )
    assert manager.files_ready() is True
    assert len(verified) == 8

    original_model = paths["main_model"].read_bytes()
    paths["main_model"].write_bytes(b"X" + original_model[1:])
    assert manager.files_ready() is False
    failed_verification_count = len(verified)
    assert manager.files_ready() is False
    assert len(verified) > failed_verification_count


@pytest.mark.asyncio
async def test_failed_verification_is_retried_when_stat_signatures_repeat(
    tmp_path: Path, monkeypatch: Any
) -> None:
    manager, paths = _installation(tmp_path, monkeypatch)
    assert manager.files_ready() is True

    config_stat = paths["config"].stat()
    os.utime(
        paths["config"],
        ns=(config_stat.st_atime_ns, config_stat.st_mtime_ns + 1_000_000),
    )
    real_validate = manager._validate_attestation
    calls = 0

    def fail_once(**kwargs: Any) -> process_module._Readiness:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ValueError("simulated failed verification with a stable stat signature")
        return real_validate(**kwargs)

    monkeypatch.setattr(manager, "_validate_attestation", fail_once)

    assert manager.files_ready() is False
    assert manager.files_ready() is True
    assert calls == 2
