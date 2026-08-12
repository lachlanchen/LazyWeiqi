from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from weiqi.adapters.katago.full_board import (
    KATAGO19_BINARY_SHA256,
    KATAGO19_BINARY_SIZE,
    KATAGO19_CONFIG_NAME,
    KATAGO19_CONFIG_SHA256,
    KATAGO19_CONFIG_SIZE,
    KATAGO19_FAST_MODEL_NAME,
    KATAGO19_FAST_MODEL_SHA256,
    KATAGO19_FAST_MODEL_SIZE,
    KATAGO19_QUALITY_MODEL_NAME,
    KATAGO19_QUALITY_MODEL_SHA256,
    KATAGO19_QUALITY_MODEL_SIZE,
)
from weiqi.adapters.katago.process import KataGoUnavailable
from weiqi.adapters.store.sqlite import GameStore
from weiqi.config import Settings
from weiqi.main import create_app


class FakeKataGo:
    def __init__(
        self,
        analysis: dict[str, Any] | Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    ) -> None:
        self.analysis = analysis
        self.queries: list[dict[str, Any]] = []
        self.closed = False
        self._settings = SimpleNamespace(katago_model=Path("test-network.bin.gz"))

    async def status(self) -> dict[str, Any]:
        return {
            "available": self.analysis is not None,
            "running": False,
            "version": "test",
            "network": self._settings.katago_model.name,
            "human_model": "test-human.bin.gz",
            "gpu": 1,
            "max_visits": 20,
        }

    async def query(self, **query: Any) -> dict[str, Any]:
        self.queries.append(query)
        if self.analysis is None:
            raise KataGoUnavailable("disabled in deterministic tests")
        response = self.analysis(query) if callable(self.analysis) else self.analysis
        normalized = dict(response)
        normalized.setdefault("turnNumber", len(query.get("moves", [])))
        return normalized

    async def close(self) -> None:
        self.closed = True


class FakeKataGo19:
    def __init__(
        self,
        analysis: dict[str, Any] | Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    ) -> None:
        self.analysis = analysis
        self.queries: list[dict[str, Any]] = []
        self.closed = False

    @staticmethod
    def profile_descriptor(profile: str) -> dict[str, Any]:
        quality = profile == "quality"
        return {
            "engine_version": "1.17.2",
            "profile": profile,
            "model": KATAGO19_QUALITY_MODEL_NAME if quality else KATAGO19_FAST_MODEL_NAME,
            "model_sha256": (
                KATAGO19_QUALITY_MODEL_SHA256 if quality else KATAGO19_FAST_MODEL_SHA256
            ),
            "model_size": KATAGO19_QUALITY_MODEL_SIZE if quality else KATAGO19_FAST_MODEL_SIZE,
            "max_visits": 64 if quality else 24,
            "perspective": "black",
            "config": {
                "name": KATAGO19_CONFIG_NAME,
                "size": KATAGO19_CONFIG_SIZE,
                "sha256": KATAGO19_CONFIG_SHA256,
            },
            "binary": {
                "size": KATAGO19_BINARY_SIZE,
                "sha256": KATAGO19_BINARY_SHA256,
                "source_commit": "6a1fc5de9fc253723ac475a0683bf0b9d9b7bd19",
            },
        }

    async def status(self) -> dict[str, Any]:
        return {
            "available": self.analysis is not None,
            "running": False,
            "active_profile": None,
            "version": "1.17.2" if self.analysis is not None else None,
            "gpu": 1,
            "profiles": {name: self.profile_descriptor(name) for name in ("fast", "quality")}
            if self.analysis is not None
            else {},
            "detail": "test full-board engine"
            if self.analysis is not None
            else "disabled in tests",
        }

    async def query(self, **query: Any) -> dict[str, Any]:
        self.queries.append(query)
        if self.analysis is None:
            raise KataGoUnavailable("disabled in deterministic tests")
        response = self.analysis(query) if callable(self.analysis) else self.analysis
        normalized = dict(response)
        normalized.setdefault("turnNumber", len(query.get("moves", [])))
        profile = query["profile"]
        descriptor = self.profile_descriptor(profile)
        root = normalized.get("rootInfo")
        current_player = root.get("currentPlayer") if isinstance(root, dict) else None
        actual_visits = root.get("visits") if isinstance(root, dict) else None
        normalized.setdefault(
            "_weiqi_provenance",
            {
                "schema_version": 1,
                "engine": "KataGo",
                "engine_version": descriptor["engine_version"],
                "profile": profile,
                "model": {
                    "name": descriptor["model"],
                    "size": descriptor["model_size"],
                    "sha256": descriptor["model_sha256"],
                },
                "config": descriptor["config"],
                "binary": descriptor["binary"],
                "requested_visits": descriptor["max_visits"],
                "actual_visits": actual_visits,
                "elapsed_ms": 1.25,
                "cache_hit": False,
                "perspective": "black",
                "binding": {
                    "state_token": query["state_token"],
                    "position_hash": query["position_hash"],
                    "history_digest": query["history_digest"],
                    "move_number": len(query.get("moves", [])),
                    "side_to_move": {"B": "black", "W": "white"}.get(current_player),
                    "board_size": 19,
                    "query_sha256": "0" * 64,
                },
            },
        )
        return normalized

    async def close(self) -> None:
        self.closed = True


class FakeModelClient:
    def __init__(
        self,
        *,
        candidate_choice: str | None = None,
        coach_draft: Any = None,
        available: bool = False,
    ) -> None:
        self.candidate_choice = candidate_choice
        self.coach_draft = coach_draft
        self.available = available
        self.candidate_calls: list[list[dict[str, Any]]] = []
        self.candidate_call_kwargs: list[dict[str, Any]] = []
        self.coach_calls: list[dict[str, Any]] = []
        self.closed = False

    async def status(self) -> dict[str, Any]:
        return {
            "available": self.available,
            "configured": self.available,
            "model": "test-model",
            "coach_model": "test-model",
            "vision_model": "test-vision",
            "coach_ready": self.available,
            "vision_ready": self.available,
        }

    async def choose_candidate(self, **kwargs: Any) -> str:
        candidates = kwargs["candidates"]
        self.candidate_calls.append(candidates)
        self.candidate_call_kwargs.append(kwargs)
        if self.candidate_choice is None:
            raise RuntimeError("model choice disabled in deterministic tests")
        # Older tests express an ordinal choice as m0/m1. Production IDs are
        # now opaque position-and-move-bound tokens, so translate only inside
        # this fake while preserving each test's intended ordinal selection.
        if self.candidate_choice.startswith("m") and self.candidate_choice[1:].isdigit():
            index = int(self.candidate_choice[1:])
            if index < len(candidates):
                return str(candidates[index]["id"])
        return self.candidate_choice

    async def coach(self, evidence: dict[str, Any], **_kwargs: Any) -> Any:
        self.coach_calls.append(evidence)
        if self.coach_draft is None:
            raise RuntimeError("model coach disabled in deterministic tests")
        return self.coach_draft

    async def close(self) -> None:
        self.closed = True


@pytest.fixture
def app_client_factory(tmp_path: Path):
    clients: list[tuple[FakeKataGo, FakeModelClient, FakeModelClient]] = []

    @contextmanager
    def factory(
        *,
        katago_analysis: (
            dict[str, Any] | Callable[[dict[str, Any]], dict[str, Any]] | None
        ) = None,
        openai_choice: str | None = None,
        openai_draft: Any = None,
        local_choice: str | None = None,
        local_draft: Any = None,
        katago19_analysis: (
            dict[str, Any] | Callable[[dict[str, Any]], dict[str, Any]] | None
        ) = None,
    ) -> Iterator[tuple[TestClient, FakeKataGo, FakeModelClient, FakeModelClient]]:
        slot = len(clients)
        data_dir = tmp_path / f"data-{slot}"
        settings = Settings(data_dir=data_dir, openai_api_key=None)
        store = GameStore(settings.prepare_data_dir())
        katago = FakeKataGo(katago_analysis)
        katago19 = FakeKataGo19(katago19_analysis)
        openai = FakeModelClient(
            candidate_choice=openai_choice,
            coach_draft=openai_draft,
            available=openai_choice is not None or openai_draft is not None,
        )
        local = FakeModelClient(
            candidate_choice=local_choice,
            coach_draft=local_draft,
            available=local_choice is not None or local_draft is not None,
        )
        clients.append((katago, openai, local))
        app = create_app(
            settings,
            store=store,
            katago=katago,  # type: ignore[arg-type]
            katago19=katago19,  # type: ignore[arg-type]
            openai=openai,  # type: ignore[arg-type]
            local=local,  # type: ignore[arg-type]
        )
        with TestClient(app) as client:
            yield client, katago, openai, local

    return factory


def create_game(
    client: TestClient,
    *,
    lesson_id: str = "opening-compass",
    board_size: int = 9,
    mode: str = "human_companion",
    human_color: str = "black",
) -> dict[str, Any]:
    response = client.post(
        "/api/games",
        json={
            "lesson_id": lesson_id,
            "board_size": board_size,
            "mode": mode,
            "human_color": human_color,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()
