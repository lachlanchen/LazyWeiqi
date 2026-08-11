from __future__ import annotations

from typing import Any

from conftest import FakeKataGo, FakeModelClient
from fastapi.testclient import TestClient

from weiqi.adapters.store.sqlite import GameStore
from weiqi.config import Settings
from weiqi.main import create_app
from weiqi.services import game_service as game_service_module


def test_status_and_curriculum_expose_ordinary_19_but_keep_13_hidden(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        status = client.get("/api/status")
        assert status.status_code == 200, status.text
        assert status.json()["supported_board_sizes"] == [5, 7, 9, 19]

        response = client.get("/api/curriculum")
        assert response.status_code == 200, response.text
        lessons = response.json()["lessons"]
        assert 13 not in {lesson["board_size"] for lesson in lessons}

        full_board = next(lesson for lesson in lessons if lesson["id"] == "full-landscape-19")
        assert full_board == {
            "id": "full-landscape-19",
            "order": 8,
            "title": "The Full Landscape",
            "subtitle": "A normal game on the full board",
            "story": (
                "The full landscape opens. Corners, sides, and center now belong to one "
                "connected journey."
            ),
            "board_size": 19,
            "duration_minutes": 60,
            "concepts": ["Whole Board", "Opening", "Large Scale Strategy"],
            "difficulty": "growing",
            "status": "available",
            "training_variant": None,
            "memory_line": (
                "Board size changes scale, not the meaning of liberties, connection, or honest "
                "counting."
            ),
        }

        hidden = client.post(
            "/api/games",
            json={
                "lesson_id": "wide-river-13",
                "board_size": 13,
                "mode": "two_player",
            },
        )
        assert hidden.status_code == 400, hidden.text
        assert hidden.json()["code"] == "invalid_game_request"


def test_ordinary_19_game_supports_preview_moves_endings_history_and_persistence(
    app_client_factory: Any,
) -> None:
    out_of_domain_engine = {
        "rootInfo": {"currentPlayer": "B", "scoreLead": 99.0, "visits": 999},
        "moveInfos": [{"move": "K10", "order": 0, "pv": ["K10"]}],
        "ownership": [0.5] * 361,
    }
    with app_client_factory(katago_analysis=out_of_domain_engine) as (
        client,
        katago,
        _openai,
        _local,
    ):
        created_response = client.post(
            "/api/games",
            json={"board_size": 19, "mode": "two_player"},
        )
        assert created_response.status_code == 201, created_response.text
        created = created_response.json()
        game_id = created["id"]
        assert created["board_size"] == 19
        assert created["lesson_id"] == "full-landscape-19"
        assert created["title"] == "The Full Landscape"
        assert created["objective"] == (
            "Play a normal 19×19 game under Chinese area rules with positional superko, "
            "from the opening through passes or resignation."
        )
        assert created["rules"] == {
            "name": "Chinese area rules",
            "scoring": "chinese_area",
            "ko_rule": "positional_superko",
            "komi": 7.5,
            "training_variant": None,
        }
        assert created["area_snapshot"]["neutral_points"] == 361

        analysis_response = client.post(
            f"/api/games/{game_id}/analysis",
            json={"expected_revision": 1},
        )
        assert analysis_response.status_code == 200, analysis_response.text
        analysis = analysis_response.json()["analysis"]
        assert analysis["status"] == "fallback"
        assert analysis["ownership"] == []
        assert [candidate["coordinate"] for candidate in analysis["candidates"]] == [
            "D16",
            "Q16",
            "D4",
        ]
        assert katago.queries == []

        preview = client.post(
            f"/api/games/{game_id}/preview",
            json={
                "x": 18,
                "y": 18,
                "actor_id": "black-human",
                "expected_revision": 1,
            },
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["coordinate"] == "T1"
        assert preview.json()["legal"] is True
        assert preview.json()["if_played_area_snapshot"]["black_stones"] == 1
        assert client.get(f"/api/games/{game_id}").json()["revision"] == 1
        assert katago.queries == []

        played = client.post(
            f"/api/games/{game_id}/moves",
            json={
                "actor_id": "black-human",
                "expected_revision": 1,
                "kind": "play",
                "point": {"x": 18, "y": 18},
                "client_request_id": "full-board-play-0001",
            },
        )
        assert played.status_code == 200, played.text
        assert played.json()["revision"] == 2
        assert played.json()["stones"] == [{"x": 18, "y": 18, "color": "black", "move_number": 1}]

        white_pass = client.post(
            f"/api/games/{game_id}/moves",
            json={
                "actor_id": "white-human",
                "expected_revision": 2,
                "kind": "pass",
                "client_request_id": "full-board-white-pass-0001",
            },
        )
        assert white_pass.status_code == 200, white_pass.text
        assert white_pass.json()["phase"] == "playing"

        black_pass = client.post(
            f"/api/games/{game_id}/moves",
            json={
                "actor_id": "black-human",
                "expected_revision": 3,
                "kind": "pass",
                "client_request_id": "full-board-black-pass-0001",
            },
        )
        assert black_pass.status_code == 200, black_pass.text
        ended = black_pass.json()
        assert ended["revision"] == 4
        assert ended["phase"] == "finished"
        assert ended["result"] is None
        assert [move["kind"] for move in ended["moves"]] == ["play", "pass", "pass"]
        area = ended["area_snapshot"]
        assert area["status"] == "mechanical_all_stones_alive"
        assert area["adjudicated"] is False
        assert (
            area["black_stones"]
            + area["black_enclosed_empty"]
            + area["white_stones"]
            + area["white_enclosed_empty"]
            + area["neutral_points"]
            == 361
        )

        loaded = client.get(f"/api/games/{game_id}")
        assert loaded.status_code == 200, loaded.text
        assert loaded.json() == ended
        listing = client.get("/api/games")
        assert listing.status_code == 200, listing.text
        summary = next(item for item in listing.json()["games"] if item["id"] == game_id)
        assert summary["board_size"] == 19
        assert summary["move_count"] == 3
        assert summary["phase"] == "finished"

        data_dir = client.app.state.game_store.path.parent
        reopened_app = create_app(
            Settings(data_dir=data_dir, openai_api_key=None),
            store=GameStore(data_dir),
            katago=FakeKataGo(),  # type: ignore[arg-type]
            openai=FakeModelClient(),  # type: ignore[arg-type]
            local=FakeModelClient(),  # type: ignore[arg-type]
        )
        with TestClient(reopened_app) as reopened_client:
            persisted = reopened_client.get(f"/api/games/{game_id}")
            assert persisted.status_code == 200, persisted.text
            assert persisted.json() == ended

        resign_game = client.post(
            "/api/games",
            json={"board_size": 19, "mode": "two_player"},
        ).json()
        resigned = client.post(
            f"/api/games/{resign_game['id']}/moves",
            json={
                "actor_id": "black-human",
                "expected_revision": 1,
                "kind": "resign",
                "client_request_id": "full-board-resign-0001",
            },
        )
        assert resigned.status_code == 200, resigned.text
        assert resigned.json()["phase"] == "finished"
        assert resigned.json()["result"] == "W+R"


def test_19_shortlist_builds_full_visual_impact_only_for_public_candidates(
    app_client_factory: Any,
    monkeypatch: Any,
) -> None:
    original = game_service_module.explain_move_impact
    calls: list[tuple[int, int]] = []

    def tracked_impact(before: Any, after: Any) -> Any:
        calls.append((before.size, after.size))
        return original(before, after)

    monkeypatch.setattr(game_service_module, "explain_move_impact", tracked_impact)
    with app_client_factory() as (client, katago, _openai, _local):
        game = client.post(
            "/api/games",
            json={"board_size": 19, "mode": "two_player"},
        ).json()
        calls.clear()

        response = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": 1},
        )

        assert response.status_code == 200, response.text
        assert [
            candidate["coordinate"] for candidate in response.json()["analysis"]["candidates"]
        ] == ["D16", "Q16", "D4"]
        assert calls == [(19, 19)] * 3
        assert katago.queries == []
