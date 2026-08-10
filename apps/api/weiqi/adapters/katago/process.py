from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import os
import stat
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ...config import REPOSITORY_ROOT, Settings

MAX_ENGINE_LINE_BYTES = 8 * 1024 * 1024
MAX_ATTESTATION_BYTES = 32 * 1024

KATAGO_ATTESTATION_RELATIVE_PATH = ".local/katago-install-attestation.json"
KATAGO_ATTESTATION_SCHEMA = 1
KATAGO_VERSION = "v1.17.2"
KATAGO_SOURCE_COMMIT = "6a1fc5de9fc253723ac475a0683bf0b9d9b7bd19"
MAIN_MODEL_NAME = "kata9x9-b18c384nbt-20231025.bin.gz"
MAIN_MODEL_SIZE = 97_878_277
MAIN_MODEL_SHA256 = "a1298ce1adc1dad7bd868ca962b2384cc8388ed373a00e6bae1114fa6f9e2d61"
HUMAN_MODEL_NAME = "b18c384nbt-humanv0.bin.gz"
HUMAN_MODEL_SIZE = 99_066_230
HUMAN_MODEL_SHA256 = "637746e44f0efe00ad1245a50aa9bbf0716efe364c43965ead97bd6835d84ab5"
CONFIG_NAME = "katago-analysis-9x9.cfg"
CONFIG_SIZE = 1_451
CONFIG_SHA256 = "111de74b051827c1cd1f3732485106735b2d237137ebf3ba1c73429c27de2369"


@dataclass(frozen=True)
class _ArtifactExpectation:
    relative_path: str
    size: int | None
    sha256: str | None
    executable: bool = False


@dataclass(frozen=True)
class _FileSignature:
    device: int
    inode: int
    mode: int
    size: int
    mtime_ns: int
    ctime_ns: int

    @classmethod
    def from_stat(cls, value: os.stat_result) -> _FileSignature:
        return cls(
            device=value.st_dev,
            inode=value.st_ino,
            mode=value.st_mode,
            size=value.st_size,
            mtime_ns=value.st_mtime_ns,
            ctime_ns=value.st_ctime_ns,
        )


@dataclass(frozen=True)
class _Readiness:
    ready: bool
    detail: str
    version: str | None = None


def _expected_artifacts() -> dict[str, _ArtifactExpectation]:
    return {
        "binary": _ArtifactExpectation(".local/bin/katago", None, None, executable=True),
        "config": _ArtifactExpectation(f"config/{CONFIG_NAME}", CONFIG_SIZE, CONFIG_SHA256),
        "main_model": _ArtifactExpectation(
            f".local/models/katago/{MAIN_MODEL_NAME}",
            MAIN_MODEL_SIZE,
            MAIN_MODEL_SHA256,
        ),
        "human_model": _ArtifactExpectation(
            f".local/models/katago/{HUMAN_MODEL_NAME}",
            HUMAN_MODEL_SIZE,
            HUMAN_MODEL_SHA256,
        ),
    }


def _absolute_path(path: Path) -> Path:
    """Return a lexical absolute path without following a possible symlink."""

    return Path(os.path.abspath(os.fspath(path)))


def _assert_project_local_parent_chains(project_root: Path, paths: list[Path]) -> None:
    root = _absolute_path(project_root)
    root_stat = root.lstat()
    if not stat.S_ISDIR(root_stat.st_mode):
        raise ValueError("KataGo project root is not a real directory")
    resolved_root = root.resolve(strict=True)
    for raw_path in paths:
        path = _absolute_path(raw_path)
        try:
            relative = path.relative_to(root)
        except ValueError as exc:
            raise ValueError("KataGo path is outside the project root") from exc
        current = root
        for component in relative.parts[:-1]:
            current /= component
            try:
                value = current.lstat()
            except FileNotFoundError:
                continue
            if not stat.S_ISDIR(value.st_mode):
                raise ValueError(f"KataGo parent must be a real project-local directory: {current}")
        resolved_parent = path.parent.resolve(strict=False)
        try:
            resolved_parent.relative_to(resolved_root)
        except ValueError as exc:
            raise ValueError(f"KataGo path resolves outside the project: {path}") from exc


def _regular_file_signature(path: Path) -> _FileSignature:
    value = path.lstat()
    if not stat.S_ISREG(value.st_mode):
        raise ValueError(f"{path.name} is not a regular non-symbolic-link file")
    return _FileSignature.from_stat(value)


def _open_verified_file(path: Path, signature: _FileSignature) -> int:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    if _FileSignature.from_stat(os.fstat(descriptor)) != signature:
        os.close(descriptor)
        raise ValueError(f"{path.name} changed while it was being verified")
    return descriptor


def _read_regular_file(path: Path, signature: _FileSignature, limit: int) -> bytes:
    descriptor = _open_verified_file(path, signature)
    try:
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(descriptor, min(64 * 1024, limit + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > limit:
                raise ValueError(f"{path.name} exceeds its verification size limit")
        if _FileSignature.from_stat(os.fstat(descriptor)) != signature:
            raise ValueError(f"{path.name} changed while it was being verified")
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def _sha256_regular_file(path: Path, signature: _FileSignature) -> str:
    descriptor = _open_verified_file(path, signature)
    digest = hashlib.sha256()
    try:
        while chunk := os.read(descriptor, 1024 * 1024):
            digest.update(chunk)
        if _FileSignature.from_stat(os.fstat(descriptor)) != signature:
            raise ValueError(f"{path.name} changed while it was being verified")
    finally:
        os.close(descriptor)
    return digest.hexdigest()


class KataGoUnavailable(RuntimeError):
    pass


class KataGoProcess:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._process: asyncio.subprocess.Process | None = None
        self._reader_task: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._idle_task: asyncio.Task[None] | None = None
        self._pending: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._start_lock = asyncio.Lock()
        self._write_lock = asyncio.Lock()
        self._last_used = 0.0
        self._stderr_tail: list[str] = []
        self._readiness_cache_key: tuple[tuple[str, str, _FileSignature], ...] | None = None
        self._readiness_cache: _Readiness | None = None

    def _artifact_paths(self) -> tuple[Path, dict[str, Path], Path]:
        configured = {
            "binary": _absolute_path(self._settings.katago_executable),
            "config": _absolute_path(self._settings.katago_config),
            "main_model": _absolute_path(self._settings.katago_model),
            "human_model": _absolute_path(self._settings.katago_human_model),
        }
        project_root = _absolute_path(REPOSITORY_ROOT)
        configured_root = configured["config"].parent.parent
        if configured_root != project_root:
            raise ValueError("configured KataGo tree is not the repository installation")
        expected = _expected_artifacts()
        for name, expectation in expected.items():
            required_path = _absolute_path(project_root / expectation.relative_path)
            if configured[name] != required_path:
                raise ValueError(f"configured {name} path is not the pinned project-local path")
        attestation = _absolute_path(project_root / KATAGO_ATTESTATION_RELATIVE_PATH)
        runtime_probe = project_root / ".local/runtime/katago/logs/.path-check"
        _assert_project_local_parent_chains(
            project_root,
            [*configured.values(), attestation, runtime_probe],
        )
        return project_root, configured, attestation

    def _validate_attestation(
        self,
        *,
        project_root: Path,
        artifact_paths: dict[str, Path],
        artifact_signatures: dict[str, _FileSignature],
        attestation_path: Path,
        attestation_signature: _FileSignature,
    ) -> _Readiness:
        raw = _read_regular_file(attestation_path, attestation_signature, MAX_ATTESTATION_BYTES)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("KataGo installation attestation is not valid JSON") from exc
        if not isinstance(payload, dict) or set(payload) != {
            "schema",
            "katago_version",
            "source_commit",
            "artifacts",
        }:
            raise ValueError("KataGo installation attestation has an unexpected shape")
        if payload["schema"] != KATAGO_ATTESTATION_SCHEMA:
            raise ValueError("KataGo installation attestation schema is unsupported")
        if payload["katago_version"] != KATAGO_VERSION:
            raise ValueError("KataGo installation attestation has the wrong version")
        if payload["source_commit"] != KATAGO_SOURCE_COMMIT:
            raise ValueError("KataGo installation attestation has the wrong source commit")

        artifacts = payload["artifacts"]
        expected = _expected_artifacts()
        if not isinstance(artifacts, dict) or set(artifacts) != set(expected):
            raise ValueError("KataGo installation attestation has unexpected artifacts")

        for name, expectation in expected.items():
            entry = artifacts[name]
            if not isinstance(entry, dict) or set(entry) != {"path", "size", "sha256"}:
                raise ValueError(f"KataGo {name} attestation entry has an unexpected shape")
            expected_path = _absolute_path(project_root / expectation.relative_path)
            if entry["path"] != expectation.relative_path or artifact_paths[name] != expected_path:
                raise ValueError(f"KataGo {name} attestation path is not pinned")
            size = entry["size"]
            digest = entry["sha256"]
            if type(size) is not int or size <= 0 or size > 1_000_000_000:
                raise ValueError(f"KataGo {name} attestation size is invalid")
            if (
                not isinstance(digest, str)
                or len(digest) != 64
                or any(character not in "0123456789abcdef" for character in digest)
            ):
                raise ValueError(f"KataGo {name} attestation SHA-256 is invalid")
            if expectation.size is not None and size != expectation.size:
                raise ValueError(f"KataGo {name} attestation size does not match its pin")
            if expectation.sha256 is not None and digest != expectation.sha256:
                raise ValueError(f"KataGo {name} attestation SHA-256 does not match its pin")
            signature = artifact_signatures[name]
            if signature.size != size:
                raise ValueError(f"KataGo {name} size no longer matches its attestation")
            if expectation.executable and not os.access(
                artifact_paths[name], os.X_OK, follow_symlinks=False
            ):
                raise ValueError("KataGo binary is not executable")
            if _sha256_regular_file(artifact_paths[name], signature) != digest:
                raise ValueError(f"KataGo {name} SHA-256 no longer matches its attestation")

        return _Readiness(
            ready=True,
            detail="Pinned KataGo installation attestation and artifact identities verified.",
            version=KATAGO_VERSION.removeprefix("v"),
        )

    def _readiness(self) -> _Readiness:
        if not self._settings.katago_enabled:
            return _Readiness(False, "KataGo is disabled by configuration.")
        cache_key: tuple[tuple[str, str, _FileSignature], ...] | None = None
        try:
            project_root, artifact_paths, attestation_path = self._artifact_paths()
            all_paths = {"attestation": attestation_path, **artifact_paths}
            signatures = {name: _regular_file_signature(path) for name, path in all_paths.items()}
            cache_key = tuple(
                (name, os.fspath(all_paths[name]), signatures[name]) for name in sorted(all_paths)
            )
            if cache_key == self._readiness_cache_key and self._readiness_cache is not None:
                return self._readiness_cache
            result = self._validate_attestation(
                project_root=project_root,
                artifact_paths=artifact_paths,
                artifact_signatures={name: signatures[name] for name in artifact_paths},
                attestation_path=attestation_path,
                attestation_signature=signatures["attestation"],
            )
        except (OSError, ValueError) as exc:
            result = _Readiness(False, str(exc))
            # Cache only a fully verified installation. Some filesystems can
            # reuse coarse timestamp signatures for an invalid in-place write
            # and its immediate repair; caching that negative result would
            # leave the repaired installation unavailable until another stat
            # field changed or the service restarted.
            self._readiness_cache_key = None
            self._readiness_cache = None
            return result
        self._readiness_cache_key = cache_key
        self._readiness_cache = result
        return result

    def files_ready(self) -> bool:
        return self._readiness().ready

    async def status(self) -> dict[str, Any]:
        process = self._process
        readiness = self._readiness()
        return {
            "available": readiness.ready,
            "running": bool(process and process.returncode is None),
            "version": readiness.version,
            "network": MAIN_MODEL_NAME if readiness.ready else None,
            "human_model": HUMAN_MODEL_NAME if readiness.ready else None,
            "gpu": self._settings.katago_gpu,
            "max_visits": self._settings.katago_max_visits,
            "detail": readiness.detail,
        }

    async def _start(self) -> None:
        async with self._start_lock:
            if self._process and self._process.returncode is None:
                self._last_used = time.monotonic()
                return
            if not self.files_ready():
                readiness = self._readiness()
                raise KataGoUnavailable(
                    f"KataGo is unavailable ({readiness.detail}); "
                    "deterministic teaching remains available"
                )
            if self._process is not None:
                await self._stop_process(self._process)
            project_root, _artifact_paths, _attestation = self._artifact_paths()
            runtime_log_dir = project_root / ".local/runtime/katago/logs"
            if runtime_log_dir.is_symlink():
                raise KataGoUnavailable("KataGo runtime log directory must not be a symbolic link")
            runtime_log_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            runtime_log_dir.chmod(0o700)
            env = {
                "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
                "HOME": os.environ.get("HOME", str(Path.home())),
                "CUDA_VISIBLE_DEVICES": str(self._settings.katago_gpu),
                "LC_ALL": "C.UTF-8",
            }
            self._process = await asyncio.create_subprocess_exec(
                str(self._settings.katago_executable),
                "analysis",
                "-config",
                str(self._settings.katago_config),
                "-model",
                str(self._settings.katago_model),
                "-human-model",
                str(self._settings.katago_human_model),
                "-quit-without-waiting",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                cwd=str(self._settings.katago_config.parent.parent),
                limit=MAX_ENGINE_LINE_BYTES,
            )
            self._reader_task = asyncio.create_task(self._read_stdout())
            self._stderr_task = asyncio.create_task(self._read_stderr())
            self._last_used = time.monotonic()
            self._idle_task = asyncio.create_task(self._release_when_idle(self._process))

    async def _release_when_idle(self, process: asyncio.subprocess.Process) -> None:
        interval = min(max(self._settings.katago_idle_seconds / 4, 0.05), 15.0)
        try:
            while self._process is process and process.returncode is None:
                await asyncio.sleep(interval)
                if self._pending:
                    continue
                if time.monotonic() - self._last_used < self._settings.katago_idle_seconds:
                    continue
                async with self._start_lock:
                    if (
                        self._process is process
                        and process.returncode is None
                        and not self._pending
                        and time.monotonic() - self._last_used >= self._settings.katago_idle_seconds
                    ):
                        await self._stop_process(process, cancel_idle=False)
                return
        except asyncio.CancelledError:
            raise

    async def _read_stdout(self) -> None:
        process = self._process
        if not process or not process.stdout:
            return
        try:
            while True:
                line = await process.stdout.readline()
                if not line:
                    raise KataGoUnavailable("KataGo exited before returning analysis")
                if len(line) > MAX_ENGINE_LINE_BYTES:
                    raise KataGoUnavailable("KataGo response exceeded the line limit")
                try:
                    payload = json.loads(line)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    continue
                request_id = payload.get("id")
                if not isinstance(request_id, str):
                    continue
                future = self._pending.get(request_id)
                if future and not future.done() and not payload.get("isDuringSearch"):
                    if payload.get("error"):
                        future.set_exception(KataGoUnavailable("KataGo rejected the position"))
                    else:
                        future.set_result(payload)
        except (asyncio.CancelledError, KataGoUnavailable) as exc:
            if isinstance(exc, asyncio.CancelledError):
                raise
            for future in self._pending.values():
                if not future.done():
                    future.set_exception(exc)
        finally:
            self._pending.clear()

    async def _read_stderr(self) -> None:
        process = self._process
        if not process or not process.stderr:
            return
        while True:
            line = await process.stderr.readline()
            if not line:
                return
            text = line.decode("utf-8", errors="replace").strip()
            if text:
                self._stderr_tail.append(text[:1000])
                del self._stderr_tail[:-40]

    async def query(
        self,
        *,
        moves: list[list[str]],
        initial_stones: list[list[str]] | None = None,
        board_size: int,
        komi: float,
        rank_profile: str,
        max_visits: int | None = None,
        timeout: float = 20.0,
    ) -> dict[str, Any]:
        await self._start()
        process = self._process
        if not process or not process.stdin or process.returncode is not None:
            raise KataGoUnavailable("KataGo is not running")
        request_id = f"analysis-{uuid.uuid4().hex}"
        query = {
            "id": request_id,
            "moves": moves,
            "rules": "chinese",
            "komi": komi,
            "boardXSize": board_size,
            "boardYSize": board_size,
            "maxVisits": max_visits or self._settings.katago_max_visits,
            "analysisPVLen": 10,
            "includeOwnership": True,
            "includeOwnershipStdev": True,
            # KataGo can return the searched after-move ownership maps in the
            # same bounded root query.  The service keeps only the three
            # shortlisted legal moves, avoiding one extra search per hover
            # candidate.
            "includeMovesOwnership": True,
            "includeMovesOwnershipStdev": True,
            "includePolicy": True,
            "overrideSettings": {
                "humanSLProfile": rank_profile,
                "ignorePreRootHistory": False,
                "rootNumSymmetriesToSample": 2,
                "humanSLRootExploreProbWeightless": 0.5,
                "humanSLCpuctPermanent": 2.0,
            },
        }
        if initial_stones:
            query["initialStones"] = initial_stones
        line = json.dumps(query, separators=(",", ":"), ensure_ascii=True).encode() + b"\n"
        if len(line) > 256_000:
            raise ValueError("KataGo query exceeded the request limit")
        loop = asyncio.get_running_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        self._pending[request_id] = future
        try:
            async with self._write_lock:
                process.stdin.write(line)
                await process.stdin.drain()
            self._last_used = time.monotonic()
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.CancelledError:
            await asyncio.shield(self.terminate_query(request_id))
            raise
        except asyncio.TimeoutError as exc:
            await self.terminate_query(request_id)
            raise KataGoUnavailable("KataGo analysis timed out") from exc
        finally:
            self._pending.pop(request_id, None)
            self._last_used = time.monotonic()

    async def terminate_query(self, request_id: str) -> None:
        process = self._process
        if not process or not process.stdin or process.returncode is not None:
            return
        line = (
            json.dumps(
                {"id": f"stop-{uuid.uuid4().hex}", "action": "terminate", "terminateId": request_id}
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
        if process and process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=3.0)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
        for task in tasks:
            if task and task is not current:
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        if self._process is process:
            self._process = None
            self._reader_task = None
            self._stderr_task = None
            if self._idle_task is not current:
                self._idle_task = None

    async def close(self) -> None:
        async with self._start_lock:
            process = self._process
            if process is not None:
                await self._stop_process(process)
            elif self._idle_task:
                self._idle_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await self._idle_task
                self._idle_task = None
