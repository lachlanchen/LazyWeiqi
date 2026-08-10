from __future__ import annotations

import asyncio
import json
import re
import sqlite3
import time
from typing import Any

import pytest
from conftest import create_game
from fastapi.testclient import TestClient

from weiqi.adapters.store.sqlite import IdempotencyConflict, RevisionConflict
from weiqi.schemas import CoachDraft, CoachQuestion, MoveRequest, PreviewRequest
from weiqi.services.game_service import (
    COACH_CONTEXT_MAX_ANSWER_BYTES,
    COACH_CONTEXT_MAX_BYTES,
    COACH_CONTEXT_MAX_EXCHANGES,
    COACH_CONTEXT_MAX_QUESTION_BYTES,
    _generated_coach_evidence,
)


def _move(
    client: TestClient,
    game_id: str,
    *,
    revision: int,
    actor_id: str,
    x: int,
    y: int,
    request_id: str,
) -> Any:
    return client.post(
        f"/api/games/{game_id}/moves",
        json={
            "actor_id": actor_id,
            "expected_revision": revision,
            "kind": "play",
            "point": {"x": x, "y": y},
            "intent": "unsure",
            "client_request_id": request_id,
        },
    )


def _offered_candidate_id(
    client: TestClient,
    game_id: str,
    *,
    revision: int,
    actor_id: str,
    index: int = 0,
) -> str:
    game = client.get(f"/api/games/{game_id}").json()
    occupied = {(item["x"], item["y"]) for item in game["stones"]}
    for y in range(game["board_size"]):
        for x in range(game["board_size"]):
            if (x, y) in occupied:
                continue
            response = client.post(
                f"/api/games/{game_id}/preview",
                json={
                    "x": x,
                    "y": y,
                    "actor_id": actor_id,
                    "expected_revision": revision,
                },
            )
            if response.status_code == 200 and response.json()["legal"]:
                return str(response.json()["candidates"][index]["id"])
    raise AssertionError("test position has no previewable candidate")


def _coach_draft(*, long: bool = False) -> CoachDraft:
    return CoachDraft.model_validate(
        {
            "schema_version": 1,
            "headline": "Count before you run",
            "story": ("S" * 700) if long else "The scout still has one open road.",
            "principle": {
                "name": "Liberties",
                "explanation": ("E" * 500)
                if long
                else "A connected string shares distinct adjacent empty points.",
            },
            "what_changed": (["C" * 240, "D" * 240, "F" * 240] if long else ["Atari is exact."]),
            "remember": ("R" * 240) if long else "Count exact liberties before choosing.",
            "choices": [],
            "reflection_question": "Which point gives the string more breath?",
            "uncertainty": None,
        }
    )


def test_generated_prose_never_inherits_an_exact_badge() -> None:
    assert _generated_coach_evidence("gpt-5.6-sol") == ["model"]
    assert _generated_coach_evidence("localllm+engine") == ["model"]
    assert _generated_coach_evidence("deterministic+engine") == ["teacher"]


def test_create_list_and_get_preserve_a_session(app_client_factory: Any) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        created = create_game(client)
        game_id = created["id"]

        assert created["revision"] == 1
        assert created["moves"] == []
        assert created["to_play"] == "black"
        assert {actor["id"] for actor in created["actors"]} == {
            "human",
            "sparring-agent",
            "companion",
        }
        authored = created["coach_messages"][0]
        assert authored["prompt"] == created["objective"]
        assert "question" not in authored

        listing = client.get("/api/games")
        assert listing.status_code == 200
        assert [game["id"] for game in listing.json()["games"]] == [game_id]
        assert listing.json()["next_cursor"] is None

        loaded = client.get(f"/api/games/{game_id}")
        assert loaded.status_code == 200
        assert loaded.json() == created


def test_delete_game_requires_current_revision_and_cascades_owned_rows(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        untouched = create_game(client)
        created = create_game(client, mode="two_player")
        game_id = created["id"]
        moved = _move(
            client,
            game_id,
            revision=1,
            actor_id="black-human",
            x=0,
            y=0,
            request_id="delete-cascade-move-1",
        )
        assert moved.status_code == 200, moved.text
        revision = moved.json()["revision"]
        coached = client.post(
            f"/api/games/{game_id}/coach",
            json={
                "expected_revision": revision,
                "question": "What is exact here?",
                "client_request_id": "delete-cascade-coach-1",
            },
        )
        assert coached.status_code == 200, coached.text

        stale = client.request(
            "DELETE",
            f"/api/games/{game_id}",
            json={"expected_revision": 1},
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "revision_conflict"

        assert client.get(f"/api/games/{game_id}").status_code == 200

        deleted = client.request(
            "DELETE",
            f"/api/games/{game_id}",
            json={"expected_revision": revision},
        )
        assert deleted.status_code == 200
        assert deleted.json() == {
            "id": game_id,
            "deleted": True,
            "revision": revision,
        }
        assert client.get(f"/api/games/{game_id}").status_code == 404
        assert client.get(f"/api/games/{untouched['id']}").status_code == 200
        missing = client.request(
            "DELETE",
            f"/api/games/{game_id}",
            json={"expected_revision": revision},
        )
        assert missing.status_code == 404

        database = client.app.state.game_store.path
        with sqlite3.connect(database) as connection:
            for table in ("games", "game_nodes", "idempotency_keys", "coach_messages"):
                remaining = connection.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE game_id=?"
                    if table != "games"
                    else "SELECT COUNT(*) FROM games WHERE id=?",
                    (game_id,),
                ).fetchone()[0]
                assert remaining == 0, f"{table} rows were not cascaded"


def test_game_history_cursor_recovers_every_old_session_without_duplicates(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        created_ids: list[str] = []
        for _index in range(23):
            created_ids.append(create_game(client)["id"])
            time.sleep(0.001)

        cursor: str | None = None
        recovered: list[str] = []
        while True:
            query = "/api/games?limit=7"
            if cursor is not None:
                query += f"&cursor={cursor}"
            page = client.get(query)
            assert page.status_code == 200, page.text
            payload = page.json()
            assert 1 <= len(payload["games"]) <= 7
            recovered.extend(item["id"] for item in payload["games"])
            cursor = payload["next_cursor"]
            if cursor is None:
                break

        assert recovered == list(reversed(created_ids))
        assert len(recovered) == len(set(recovered)) == 23

        invalid = client.get("/api/games?limit=7&cursor=not-a-cursor")
        assert invalid.status_code == 400
        assert invalid.json()["code"] == "invalid_game_request"


def test_selected_agent_doctrine_and_companion_style_reach_the_runtime_contract(
    app_client_factory: Any,
) -> None:
    with app_client_factory(openai_choice="m0") as (client, _katago, openai, _local):
        created_response = client.post(
            "/api/games",
            json={
                "lesson_id": "opening-compass",
                "board_size": 9,
                "mode": "agent_vs_agent",
                "black_agent": {"persona": "Mountain", "doctrine": "fighting"},
                "white_agent": {"persona": "River", "doctrine": "light"},
                "companion": {"persona": "Lantern", "style": "encouraging"},
            },
        )
        assert created_response.status_code == 201, created_response.text
        created = created_response.json()
        narrator = next(actor for actor in created["actors"] if actor["id"] == "narrator")
        assert narrator["personality"] == "encouraging"

        turn = client.post(
            f"/api/games/{created['id']}/agent-turn",
            json={"expected_revision": 1, "actor_id": "black-agent"},
        )
        assert turn.status_code == 200, turn.text
        assert openai.candidate_call_kwargs[0]["persona"] == "Mountain · fighting doctrine"
        move = turn.json()["moves"][0]
        assert move["intent"] in {"claim", "connect", "pressure", "escape", "settle"}
        assert "fighting doctrine" in move["comment"]


def test_preview_reports_legal_and_illegal_points_without_mutation(app_client_factory: Any) -> None:
    unavailable_for_small_boards = {
        "moveInfos": [{"move": "C4", "order": 0, "pv": ["C4"]}],
        "ownership": [0.0] * 25,
        "rootInfo": {"scoreLead": 99.0, "visits": 999},
    }
    with app_client_factory(katago_analysis=unavailable_for_small_boards) as (
        client,
        katago,
        _openai,
        _local,
    ):
        game = create_game(client, lesson_id="breath-5", board_size=5)
        game_id = game["id"]
        legal = client.post(
            f"/api/games/{game_id}/preview",
            json={"x": 2, "y": 1, "actor_id": "human", "expected_revision": 1},
        )
        assert legal.status_code == 200
        assert legal.json()["legal"] is True
        assert legal.json()["resulting_liberties"] > 1
        assert legal.json()["candidates"]
        assert all(candidate["verified"] is False for candidate in legal.json()["candidates"])

        occupied = client.post(
            f"/api/games/{game_id}/preview",
            json={"x": 2, "y": 2, "actor_id": "human", "expected_revision": 1},
        )
        assert occupied.status_code == 200
        assert occupied.json()["legal"] is False
        assert occupied.json()["reason"]

        outside = client.post(
            f"/api/games/{game_id}/preview",
            json={"x": 18, "y": 18, "actor_id": "human", "expected_revision": 1},
        )
        assert outside.status_code == 200
        assert outside.json()["legal"] is False
        assert "outside" in outside.json()["reason"]

        unchanged = client.get(f"/api/games/{game_id}").json()
        assert unchanged["revision"] == 1
        assert unchanged["moves"] == []
        assert katago.queries == []


def test_small_board_candidate_teaching_uses_exact_connection_facts_without_engine(
    app_client_factory: Any,
) -> None:
    with app_client_factory(katago_analysis={"rootInfo": {"scoreLead": 99.0}, "moveInfos": []}) as (
        client,
        katago,
        _openai,
        _local,
    ):
        game = create_game(client, lesson_id="bridge-5", board_size=5)
        preview = client.post(
            f"/api/games/{game['id']}/preview",
            json={"x": 2, "y": 2, "actor_id": "human", "expected_revision": 1},
        )
        assert preview.status_code == 200, preview.text
        teaching = preview.json()["teaching"]
        assert teaching["legal_verified"] is True
        assert teaching["engine_analyzed"] is False
        assert teaching["tactics"]["friendly_groups_joined"] == 2
        assert teaching["tactics"]["connects"] == [{"x": 1, "y": 2}, {"x": 3, "y": 2}]
        assert teaching["tactics"]["evidence"] == "exact"
        assert "score" not in teaching
        assert "ownership_after" not in teaching
        assert katago.queries == []

        seven = create_game(client, lesson_id="roads-7", board_size=7)
        seven_preview = client.post(
            f"/api/games/{seven['id']}/preview",
            json={"x": 5, "y": 3, "actor_id": "human", "expected_revision": 1},
        )
        assert seven_preview.status_code == 200
        assert seven_preview.json()["legal"] is True
        assert all(
            candidate["verified"] is False for candidate in seven_preview.json()["candidates"]
        )
        assert katago.queries == []


def test_pinned_katago_teaching_network_is_used_only_for_nine_by_nine(
    app_client_factory: Any,
) -> None:
    root_engine = {
        "moveInfos": [{"move": "E5", "order": 0, "pv": ["E5", "D5"]}],
        "ownership": [0.0] * 81,
        "ownershipStdev": [0.1] * 81,
        "rootInfo": {"currentPlayer": "B", "scoreLead": 0.5, "visits": 4},
    }

    def engine(query: dict[str, Any]) -> dict[str, Any]:
        if not query["moves"]:
            return root_engine
        assert query["moves"] == [["B", "E5"]]
        return {
            "rootInfo": {
                "currentPlayer": "W",
                "scoreLead": 2.0,
                "scoreStdev": 6.0,
                "winrate": 0.6,
                "visits": 20,
                "utility": 0.2,
            },
            "ownership": [0.1] * 81,
            "ownershipStdev": [0.25] * 81,
            "moveInfos": [{"move": "pass", "order": 0, "pv": ["pass", "D5"]}],
        }

    with app_client_factory(katago_analysis=engine) as (client, katago, _openai, _local):
        game = create_game(client, lesson_id="opening-compass", board_size=9)
        preview = client.post(
            f"/api/games/{game['id']}/preview",
            json={"x": 4, "y": 4, "actor_id": "human", "expected_revision": 1},
        )
        assert preview.status_code == 200
        assert katago.queries and katago.queries[-1]["board_size"] == 9
        assert any(candidate["verified"] is True for candidate in preview.json()["candidates"])


def test_analysis_endpoint_supplies_choices_before_a_board_point_is_selected(
    app_client_factory: Any,
) -> None:
    engine = {
        "rootInfo": {"currentPlayer": "B", "scoreLead": 0.5, "visits": 4},
        "ownership": [0.0] * 81,
        "ownershipStdev": [0.1] * 81,
        "moveInfos": [
            {
                "move": "E5",
                "order": 0,
                "scoreLead": 1.0,
                "visits": 4,
                "pv": ["E5", "D5"],
                "ownership": [0.1] * 81,
                "ownershipStdev": [0.1] * 81,
            }
        ],
    }
    with app_client_factory(katago_analysis=engine) as (client, katago, _openai, _local):
        game = create_game(client, lesson_id="opening-compass", board_size=9)
        response = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": 1},
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["game_id"] == game["id"]
        assert payload["revision"] == 1
        assert payload["analysis"]["candidates"][0]["coordinate"] == "E5"
        assert payload["analysis"]["candidates"][0]["engine_analyzed"] is True
        assert len(payload["analysis"]["candidates"][0]["ownership_after"]) == 81
        assert len(katago.queries) == 1

        stale = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": 2},
        )
        assert stale.status_code == 409


def test_katago_order_zero_pass_is_a_state_bound_selectable_agent_candidate(
    app_client_factory: Any,
) -> None:
    engine = {
        "rootInfo": {
            "currentPlayer": "B",
            "scoreLead": -1.0,
            "winrate": 0.4,
            "visits": 20,
        },
        "ownership": [0.0] * 81,
        "policy": [-1.0] * 81 + [0.8],
        "moveInfos": [
            {
                "move": "E5",
                "order": 1,
                "visits": 5,
                "scoreLead": -2.0,
                "winrate": 0.35,
                "prior": 0.1,
                "pv": ["E5", "D5"],
                "ownership": [-0.1] * 81,
            },
            {
                "move": "pass",
                "order": 0,
                "visits": 15,
                "scoreLead": -1.0,
                "winrate": 0.4,
                "utility": -0.2,
                "pv": ["pass", "E5"],
                "ownership": [0.0] * 81,
            },
        ],
    }
    with app_client_factory(katago_analysis=engine, openai_choice="m0") as (
        client,
        _katago,
        openai,
        _local,
    ):
        game = create_game(client, mode="agent_vs_agent")
        response = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": 1},
        )
        assert response.status_code == 200, response.text
        analysis = response.json()["analysis"]
        candidate = analysis["candidates"][0]

        assert candidate["kind"] == "pass"
        assert candidate["coordinate"] == "pass"
        assert candidate["point"] is None
        assert re.fullmatch(r"m_[0-9a-f]{32}", candidate["id"])
        assert candidate["intent"] == "endgame"
        assert candidate["intent_evidence"] == "teacher"
        assert candidate["title"] == "Possible end-of-game judgment"
        assert candidate["tactics"]["resulting_liberties"] is None
        assert candidate["tactics"]["ends_play"] is False
        assert candidate["tactics"]["captures"] == []
        assert candidate["evaluation"]["order"] == 0
        assert candidate["evaluation"]["policy"] == 0.8
        assert candidate["variation"][:2] == [
            {"color": "black", "kind": "pass", "point": None},
            {"color": "white", "kind": "play", "point": {"x": 4, "y": 4}},
        ]
        assert {item["id"] for item in candidate["facets"]} == {
            "breath",
            "bonds",
            "pressure",
        }
        assert analysis["side_to_move"] == "black"
        assert analysis["area_snapshot"]["status"] == "mechanical_all_stones_alive"
        assert {item["id"] for item in analysis["facets"]} >= {"area", "beat"}

        turn = client.post(
            f"/api/games/{game['id']}/agent-turn",
            json={"expected_revision": 1, "actor_id": "black-agent"},
        )
        assert turn.status_code == 200, turn.text
        move = turn.json()["moves"][0]
        assert move["kind"] == "pass"
        assert move["point"] is None
        assert move["intent"] == "endgame"
        assert move["intent_evidence"] == "teacher"
        assert turn.json()["to_play"] == "white"
        assert openai.candidate_calls[0][0]["coordinate"] == "pass"
        assert openai.candidate_calls[0][0]["intent_evidence"] == "teacher"
        assert "ownership_after" not in openai.candidate_calls[0][0]


def test_order_zero_second_pass_candidate_says_it_ends_play_without_scoring(
    app_client_factory: Any,
) -> None:
    engine = {
        "rootInfo": {"currentPlayer": "W", "scoreLead": -1.0, "visits": 12},
        "moveInfos": [
            {
                "move": "pass",
                "order": 0,
                "visits": 12,
                "scoreLead": -1.0,
                "pv": ["pass"],
            }
        ],
    }
    with app_client_factory(katago_analysis=engine) as (client, katago, _openai, _local):
        game = create_game(client)
        first_pass = client.post(
            f"/api/games/{game['id']}/moves",
            json={
                "actor_id": "human",
                "expected_revision": 1,
                "kind": "pass",
                "intent": "endgame",
                "client_request_id": "first-pass-before-engine-pass-0001",
            },
        )
        assert first_pass.status_code == 200, first_pass.text
        assert first_pass.json()["to_play"] == "white"

        response = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": 2},
        )
        assert response.status_code == 200, response.text
        candidate = response.json()["analysis"]["candidates"][0]
        assert candidate["kind"] == "pass"
        assert candidate["tactics"]["ends_play"] is True
        assert "two-consecutive-pass ending rule" in candidate["summary"]

        second_pass = client.post(
            f"/api/games/{game['id']}/agent-turn",
            json={
                "expected_revision": 2,
                "actor_id": "sparring-agent",
                "candidate_id": candidate["id"],
            },
        )
        assert second_pass.status_code == 200, second_pass.text
        ended = second_pass.json()
        assert ended["phase"] == "finished"
        assert ended["result"] is None
        assert ended["moves"][-1]["kind"] == "pass"
        assert "second consecutive pass ended play" in ended["coach_messages"][-1]["text"].lower()


def test_engine_pass_below_order_zero_is_not_offered(
    app_client_factory: Any,
) -> None:
    engine = {
        "rootInfo": {"currentPlayer": "B", "scoreLead": 0.0, "visits": 10},
        "moveInfos": [
            {"move": "pass", "order": 1, "pv": ["pass"]},
            {"move": "E5", "order": 0, "pv": ["E5"]},
        ],
    }
    with app_client_factory(katago_analysis=engine) as (client, _katago, _openai, _local):
        game = create_game(client)
        response = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": 1},
        )
        assert response.status_code == 200
        assert all(
            candidate["coordinate"] != "pass"
            for candidate in response.json()["analysis"]["candidates"]
        )


def test_preview_separates_teacher_intent_move_facets_and_current_position_facts(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        game = create_game(client)
        preview = client.post(
            f"/api/games/{game['id']}/preview",
            json={"x": 0, "y": 8, "actor_id": "human", "expected_revision": 1},
        )
        assert preview.status_code == 200, preview.text
        payload = preview.json()
        teaching = payload["teaching"]
        assert teaching["kind"] == "play"
        assert teaching["intent_evidence"] == "teacher"
        assert teaching["title"].startswith("Possible ")
        assert "teacher hypothesis" in teaching["summary"].lower()
        assert {item["id"] for item in payload["candidate_facets"]} == {
            "breath",
            "bonds",
            "pressure",
        }
        assert "beat" not in {item["id"] for item in payload["candidate_facets"]}
        position_ids = {item["id"] for item in payload["position_facets"]}
        assert {"area", "beat"} <= position_ids
        assert (
            next(item for item in payload["position_facets"] if item["id"] == "beat")[
                "canonical_term"
            ]
            == "Side to move"
        )
        assert payload["candidates"]
        assert all(item["intent_evidence"] == "teacher" for item in payload["candidates"])
        analysis_response = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": 1},
        )
        assert analysis_response.status_code == 200
        analysis = analysis_response.json()["analysis"]
        assert analysis["engine"] == "Exact board facts + authored guidance"
        assert analysis["side_to_move"] == "black"
        assert analysis["area_snapshot"]["adjudicated"] is False


def test_live_board_count_never_presents_flood_fill_as_territory(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        game = create_game(client)
        moved = client.post(
            f"/api/games/{game['id']}/moves",
            json={
                "actor_id": "human",
                "expected_revision": 1,
                "kind": "play",
                "point": {"x": 0, "y": 8},
            },
        )

        assert moved.status_code == 200, moved.text
        area = next(item for item in moved.json()["analysis"]["facets"] if item["id"] == "area")
        assert area == {
            "id": "area",
            "label": "Board count",
            "canonical_term": "Stones and empty intersections",
            "value": "Black 1 stone · White 0 stones",
            "change": None,
            "evidence": "exact",
            "explanation": (
                "80 intersections are empty. Territory and dead stones are not settled "
                "during live play; engine ownership is a separate forecast."
            ),
        }
        assert "Black 81" not in json.dumps(moved.json())


def test_candidate_engine_evidence_is_black_perspective_complete_and_cached(
    app_client_factory: Any,
) -> None:
    root_ownership = [0.0] * 81
    after_ownership = [0.1] * 81
    root_engine = {
        "rootInfo": {
            "currentPlayer": "B",
            "scoreLead": 1.0,
            "scoreStdev": 5.0,
            "winrate": 0.5,
            "visits": 30,
        },
        "ownership": root_ownership,
        "ownershipStdev": [0.2] * 81,
        "moveInfos": [
            {
                "move": "C3",
                "order": 2,
                "visits": 3,
                "scoreLead": 0.5,
                "winrate": 0.48,
                "prior": 0.1,
                "utility": -0.1,
                "pv": ["C3", "D3"],
                "ownership": [-0.05] * 81,
            },
            {
                "move": "E5",
                "order": 0,
                "visits": 20,
                "scoreLead": 2.0,
                "scoreStdev": 6.0,
                "winrate": 0.6,
                "prior": 0.3,
                "utility": 0.2,
                "pv": ["E5", "pass", "D5"],
                "ownership": after_ownership,
                "ownershipStdev": [0.25] * 81,
            },
            {
                "move": "E3",
                "order": 1,
                "visits": 7,
                "scoreLead": 1.5,
                "winrate": 0.55,
                "prior": 0.2,
                "utility": 0.1,
                "pv": ["E3", "E4"],
                "ownership": [0.05] * 81,
            },
        ],
    }

    def engine(query: dict[str, Any]) -> dict[str, Any]:
        if not query["moves"]:
            return root_engine
        assert query["moves"] == [["B", "E5"]]
        return {
            "rootInfo": {
                "currentPlayer": "W",
                "scoreLead": 2.0,
                "scoreStdev": 6.0,
                "winrate": 0.6,
                "visits": 20,
                "utility": 0.2,
            },
            "ownership": after_ownership,
            "ownershipStdev": [0.25] * 81,
            "moveInfos": [{"move": "pass", "order": 0, "pv": ["pass", "D5"]}],
        }

    with app_client_factory(katago_analysis=engine) as (client, katago, _openai, _local):
        game = create_game(client)
        first = client.post(
            f"/api/games/{game['id']}/preview",
            json={"x": 4, "y": 4, "actor_id": "human", "expected_revision": 1},
        )
        assert first.status_code == 200, first.text
        candidate = first.json()["teaching"]

        assert candidate["coordinate"] == "E5"
        assert candidate["legal_verified"] is True
        assert candidate["engine_analyzed"] is True
        assert re.fullmatch(r"m_[0-9a-f]{32}", candidate["id"])
        assert candidate["score"] == {
            "before": 1.0,
            "after": 2.0,
            "delta": 1.0,
            "mover_delta": 1.0,
            "perspective": "black",
            "evidence": "engine",
            "outcome_spread_before": 5.0,
            "outcome_spread_after": 6.0,
            "difference_from_top": 0.0,
        }
        assert candidate["evaluation"] == {
            "perspective": "black",
            "evidence": "engine",
            "winrate_before": 0.5,
            "winrate_after": 0.6,
            "winrate_delta": 0.1,
            "winrate_mover_delta": 0.1,
            "order": 0,
            "visits": 20,
            "policy": 0.3,
            "utility": 0.2,
        }
        assert len(candidate["ownership_before"]) == 81
        assert len(candidate["ownership_after"]) == 81
        assert len(candidate["ownership_delta"]) == 81
        assert candidate["ownership_after"][0] == {
            "x": 0,
            "y": 0,
            "value": 0.1,
            "variation": 0.25,
        }
        assert candidate["ownership_delta"][-1] == {
            "x": 8,
            "y": 8,
            "value": 0.1,
            "variation": 0.25,
        }
        assert candidate["ownership_perspective"] == "black"
        assert candidate["analysis_source"] == "child_root"
        assert candidate["variation"][1] == {
            "color": "white",
            "kind": "pass",
            "point": None,
        }
        assert candidate["main_line_reply"] == "White pass"
        assert "influence" not in candidate

        repeated = client.post(
            f"/api/games/{game['id']}/preview",
            json={"x": 4, "y": 4, "actor_id": "human", "expected_revision": 1},
        )
        assert repeated.status_code == 200
        assert len(katago.queries) == 2


def test_white_mover_keeps_engine_values_black_normalized_and_gets_mover_delta(
    app_client_factory: Any,
) -> None:
    def engine(query: dict[str, Any]) -> dict[str, Any]:
        if len(query["moves"]) == 1:
            return {
                "rootInfo": {
                    "currentPlayer": "W",
                    "scoreLead": 2.0,
                    "winrate": 0.6,
                    "visits": 12,
                },
                "ownership": [0.2] * 81,
                "moveInfos": [
                    {
                        "move": "D5",
                        "order": 0,
                        "visits": 10,
                        "scoreLead": 3.0,
                        "winrate": 0.7,
                        "prior": 0.4,
                        "utility": 0.3,
                        "pv": ["D5", "E4"],
                        "ownership": [0.3] * 81,
                    }
                ],
            }
        assert query["moves"][-1] == ["W", "D5"]
        return {
            "rootInfo": {
                "currentPlayer": "B",
                "scoreLead": 3.0,
                "winrate": 0.7,
                "visits": 10,
                "utility": 0.3,
            },
            "ownership": [0.3] * 81,
            "moveInfos": [{"move": "E4", "order": 0, "pv": ["E4"]}],
        }

    with app_client_factory(katago_analysis=engine) as (client, katago, _openai, _local):
        game = create_game(client)
        moved = _move(
            client,
            game["id"],
            revision=1,
            actor_id="human",
            x=4,
            y=4,
            request_id="candidate-perspective-move-0001",
        )
        assert moved.status_code == 200
        preview = client.post(
            f"/api/games/{game['id']}/preview",
            json={
                "x": 3,
                "y": 4,
                "actor_id": "sparring-agent",
                "expected_revision": 2,
            },
        )
        assert preview.status_code == 200, preview.text
        candidate = preview.json()["teaching"]
        assert candidate["score"]["perspective"] == "black"
        assert candidate["score"]["delta"] == 1.0
        assert candidate["score"]["mover_delta"] == -1.0
        assert candidate["evaluation"]["winrate_delta"] == 0.1
        assert candidate["evaluation"]["winrate_mover_delta"] == -0.1
        assert candidate["ownership_delta"][0]["value"] == 0.1
        assert katago.queries[0]["moves"] == [["B", "E5"]]
        assert katago.queries[0]["initial_player"] == "B"
        assert katago.queries[1]["moves"] == [["B", "E5"], ["W", "D5"]]
        assert katago.queries[1]["initial_player"] == "B"


def test_arbitrary_legal_preview_uses_child_root_evidence_without_mutating_game(
    app_client_factory: Any,
) -> None:
    before_ownership = [0.0] * 81
    before_ownership[0] = -0.2
    before_ownership[-1] = 0.2
    after_ownership = [0.1] * 81
    after_ownership[0] = 0.7
    after_ownership[-1] = -0.7

    def engine(query: dict[str, Any]) -> dict[str, Any]:
        if not query["moves"]:
            return {
                "rootInfo": {
                    "currentPlayer": "B",
                    "scoreLead": 1.0,
                    "scoreStdev": 4.0,
                    "winrate": 0.5,
                    "visits": 50,
                },
                "ownership": before_ownership,
                "ownershipStdev": [0.2] * 81,
                "moveInfos": [
                    {
                        "move": "E5",
                        "order": 0,
                        "scoreLead": 2.0,
                        "pv": ["E5", "D5"],
                    }
                ],
            }
        assert query["moves"] == [["B", "A9"]]
        return {
            "rootInfo": {
                "currentPlayer": "W",
                "scoreLead": 2.5,
                "scoreStdev": 4.5,
                "winrate": 0.61,
                "visits": 40,
                "utility": 0.25,
            },
            "ownership": after_ownership,
            "ownershipStdev": [0.3] * 81,
            # These values are after White's possible reply. They must never
            # be substituted for the selected Black move's child-root fields.
            "moveInfos": [
                {
                    "move": "E5",
                    "order": 0,
                    "scoreLead": 999.0,
                    "ownership": [-1.0] * 81,
                    "pv": ["E5", "E4", "E5"],
                }
            ],
        }

    with app_client_factory(katago_analysis=engine) as (client, katago, _openai, _local):
        game = create_game(client)
        response = client.post(
            f"/api/games/{game['id']}/preview",
            json={"x": 0, "y": 0, "actor_id": "human", "expected_revision": 1},
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        teaching = payload["teaching"]

        assert teaching["coordinate"] == "A9"
        assert teaching["analysis_source"] == "child_root"
        assert teaching["legal_verified"] is True
        assert teaching["engine_analyzed"] is True
        assert teaching["score"] == {
            "before": 1.0,
            "after": 2.5,
            "delta": 1.5,
            "mover_delta": 1.5,
            "perspective": "black",
            "evidence": "engine",
            "outcome_spread_before": 4.0,
            "outcome_spread_after": 4.5,
        }
        assert teaching["evaluation"] == {
            "perspective": "black",
            "evidence": "engine",
            "winrate_before": 0.5,
            "winrate_after": 0.61,
            "winrate_delta": 0.11,
            "winrate_mover_delta": 0.11,
            "visits": 40,
            "utility": 0.25,
        }
        assert len(teaching["ownership_before"]) == 81
        assert len(teaching["ownership_after"]) == 81
        assert len(teaching["ownership_delta"]) == 81
        assert teaching["ownership_perspective"] == "black"
        assert teaching["ownership_before"][0] == {
            "x": 0,
            "y": 0,
            "value": -0.2,
            "variation": 0.2,
        }
        assert teaching["ownership_after"][0] == {
            "x": 0,
            "y": 0,
            "value": 0.7,
            "variation": 0.3,
        }
        assert teaching["ownership_after"][-1]["value"] == -0.7
        assert teaching["ownership_delta"][0]["value"] == 0.9
        assert teaching["variation"] == [
            {"color": "black", "kind": "play", "point": {"x": 0, "y": 0}},
            {"color": "white", "kind": "play", "point": {"x": 4, "y": 4}},
            {"color": "black", "kind": "play", "point": {"x": 4, "y": 5}},
        ]
        assert teaching["main_line_reply"] == "White E5"

        assert payload["current_area_snapshot"]["black_stones"] == 0
        assert payload["if_played_area_snapshot"]["black_stones"] == 1
        assert payload["if_played_side_to_move"] == "white"
        assert (
            next(item for item in payload["position_facets"] if item["id"] == "beat")["value"]
            == "Black to move"
        )
        assert (
            next(item for item in payload["if_played_facets"] if item["id"] == "beat")["value"]
            == "White to move"
        )
        assert (
            next(item for item in payload["if_played_facets"] if item["id"] == "reach")["evidence"]
            == "engine"
        )

        assert katago.queries[0]["moves"] == []
        assert katago.queries[0]["initial_player"] == "B"
        assert katago.queries[1]["moves"] == [["B", "A9"]]
        assert katago.queries[1]["initial_player"] == "B"
        assert all(query["board_size"] == 9 for query in katago.queries)

        repeated = client.post(
            f"/api/games/{game['id']}/preview",
            json={"x": 0, "y": 0, "actor_id": "human", "expected_revision": 1},
        )
        assert repeated.status_code == 200
        assert len(katago.queries) == 2

        unchanged = client.get(f"/api/games/{game['id']}").json()
        assert unchanged["revision"] == 1
        assert unchanged["moves"] == []
        assert unchanged["stones"] == []


def test_engine_response_for_the_wrong_side_to_move_is_not_attached_to_candidates(
    app_client_factory: Any,
) -> None:
    engine = {
        "rootInfo": {"currentPlayer": "W", "scoreLead": 4.0, "visits": 12},
        "ownership": [0.5] * 81,
        "moveInfos": [
            {
                "move": "E5",
                "order": 0,
                "scoreLead": 5.0,
                "pv": ["E5"],
                "ownership": [0.6] * 81,
            }
        ],
    }
    with app_client_factory(katago_analysis=engine) as (client, katago, _openai, _local):
        game = create_game(client)
        preview = client.post(
            f"/api/games/{game['id']}/preview",
            json={"x": 4, "y": 4, "actor_id": "human", "expected_revision": 1},
        )
        assert preview.status_code == 200
        teaching = preview.json()["teaching"]
        assert teaching["legal_verified"] is True
        assert teaching["engine_analyzed"] is False
        assert "score" not in teaching
        assert "ownership_after" not in teaching
        assert len(katago.queries) == 1


def test_engine_response_without_current_player_is_not_attached_to_candidates(
    app_client_factory: Any,
) -> None:
    engine = {
        "rootInfo": {"scoreLead": 4.0, "visits": 12},
        "ownership": [0.5] * 81,
        "moveInfos": [
            {
                "move": "E5",
                "order": 0,
                "scoreLead": 5.0,
                "pv": ["E5"],
                "ownership": [0.6] * 81,
            }
        ],
    }
    with app_client_factory(katago_analysis=engine) as (client, katago, _openai, _local):
        game = create_game(client)
        preview = client.post(
            f"/api/games/{game['id']}/preview",
            json={"x": 4, "y": 4, "actor_id": "human", "expected_revision": 1},
        )
        assert preview.status_code == 200
        teaching = preview.json()["teaching"]
        assert teaching["legal_verified"] is True
        assert teaching["engine_analyzed"] is False
        assert "score" not in teaching
        assert "ownership_after" not in teaching
        assert len(katago.queries) == 1


@pytest.mark.parametrize(
    "invalid_child_identity",
    [
        {"currentPlayer": "B", "turnNumber": 1},
        {"currentPlayer": "W", "turnNumber": None},
        {"currentPlayer": "W", "turnNumber": 99},
    ],
)
def test_preview_rejects_child_analysis_not_bound_to_the_exact_after_position(
    app_client_factory: Any,
    invalid_child_identity: dict[str, Any],
) -> None:
    def engine(query: dict[str, Any]) -> dict[str, Any]:
        if not query["moves"]:
            return {
                "rootInfo": {
                    "currentPlayer": "B",
                    "scoreLead": 0.0,
                    "visits": 10,
                },
                "ownership": [0.0] * 81,
                "moveInfos": [{"move": "A9", "order": 0, "pv": ["A9", "B9"]}],
            }
        return {
            "turnNumber": invalid_child_identity["turnNumber"],
            "rootInfo": {
                "currentPlayer": invalid_child_identity["currentPlayer"],
                "scoreLead": 5.0,
                "visits": 10,
            },
            "ownership": [0.8] * 81,
            "moveInfos": [],
        }

    with app_client_factory(katago_analysis=engine) as (client, katago, _openai, _local):
        game = create_game(client)
        preview = client.post(
            f"/api/games/{game['id']}/preview",
            json={"x": 0, "y": 0, "actor_id": "human", "expected_revision": 1},
        )
        assert preview.status_code == 200, preview.text
        teaching = preview.json()["teaching"]
        assert teaching["legal_verified"] is True
        assert teaching["engine_analyzed"] is False
        assert "analysis_source" not in teaching
        assert "score" not in teaching
        assert "ownership_after" not in teaching
        assert teaching["variation"] == []
        assert teaching["main_line_reply"] is None
        assert len(katago.queries) == 2


def test_malformed_candidate_evidence_is_omitted_and_payloads_stay_bounded(
    app_client_factory: Any,
) -> None:
    root_engine = {
        "rootInfo": {
            "currentPlayer": "B",
            "scoreLead": "unknown",
            "winrate": 2.0,
            "visits": -1,
        },
        "ownership": [0.0] * 80,
        "moveInfos": [
            {
                "move": "E5",
                "order": 0,
                "visits": -5,
                "scoreLead": float("nan"),
                "winrate": -0.1,
                "prior": 4.0,
                "utility": float("inf"),
                "pv": ["E5"] * 2_000,
                "ownership": [0.0] * 80,
                "ownershipStdev": [0.1] * 2_000,
            }
        ],
    }

    def engine(query: dict[str, Any]) -> dict[str, Any]:
        if not query["moves"]:
            return root_engine
        child = dict(root_engine)
        child["rootInfo"] = {
            **root_engine["rootInfo"],
            "currentPlayer": "W",
        }
        return child

    with app_client_factory(katago_analysis=engine) as (client, _katago, _openai, _local):
        game = create_game(client)
        preview = client.post(
            f"/api/games/{game['id']}/preview",
            json={"x": 4, "y": 4, "actor_id": "human", "expected_revision": 1},
        )
        assert preview.status_code == 200, preview.text
        payload = preview.json()
        candidate = payload["teaching"]
        assert candidate["engine_analyzed"] is True
        assert candidate["variation"] == [
            {"color": "black", "kind": "play", "point": {"x": 4, "y": 4}}
        ]
        assert candidate["main_line_reply"] is None
        assert "score" not in candidate
        assert candidate["evaluation"] == {
            "perspective": "black",
            "evidence": "engine",
            "order": 0,
        }
        assert "ownership_before" not in candidate
        assert "ownership_after" not in candidate
        assert "ownership_delta" not in candidate
        assert len(payload["candidates"]) <= 3
        assert len(preview.content) < 60_000


def test_stable_candidate_id_cannot_remap_when_engine_ranking_changes(
    app_client_factory: Any,
) -> None:
    first_engine = {
        "rootInfo": {"currentPlayer": "B", "scoreLead": 0.0, "visits": 10},
        "moveInfos": [
            {"move": "E5", "order": 0, "pv": ["E5"]},
            {"move": "C3", "order": 1, "pv": ["C3"]},
        ],
    }
    with app_client_factory(katago_analysis=first_engine) as (client, katago, _openai, _local):
        game = create_game(client, mode="agent_vs_agent")
        preview = client.post(
            f"/api/games/{game['id']}/preview",
            json={"x": 4, "y": 4, "actor_id": "black-agent", "expected_revision": 1},
        )
        original = next(item for item in preview.json()["candidates"] if item["coordinate"] == "E5")

        katago.analysis = {
            "rootInfo": {"currentPlayer": "B", "scoreLead": 0.0, "visits": 10},
            "moveInfos": [
                {"move": "C3", "order": 0, "pv": ["C3"]},
                {"move": "E5", "order": 1, "pv": ["E5"]},
            ],
        }
        client.app.state.game_service._engine_analysis_cache.clear()
        turn = client.post(
            f"/api/games/{game['id']}/agent-turn",
            json={
                "expected_revision": 1,
                "actor_id": "black-agent",
                "candidate_id": original["id"],
            },
        )
        assert turn.status_code == 200, turn.text
        assert turn.json()["moves"][0]["point"] == {"x": 4, "y": 4}


@pytest.mark.asyncio
async def test_identical_child_previews_share_search_when_one_waiter_disconnects(
    app_client_factory: Any,
    monkeypatch: Any,
) -> None:
    with app_client_factory(katago_analysis={"unused": True}) as (
        client,
        katago,
        _openai,
        _local,
    ):
        game = create_game(client)
        child_entered = asyncio.Event()
        child_release = asyncio.Event()
        child_cancelled = False
        query_count = 0

        async def query(**request: Any) -> dict[str, Any]:
            nonlocal child_cancelled, query_count
            query_count += 1
            if not request["moves"]:
                return {
                    "turnNumber": 0,
                    "rootInfo": {"currentPlayer": "B", "scoreLead": 0.0, "visits": 10},
                    "ownership": [0.0] * 81,
                    "moveInfos": [{"move": "E5", "order": 0, "pv": ["E5"]}],
                }
            child_entered.set()
            try:
                await child_release.wait()
            except asyncio.CancelledError:
                child_cancelled = True
                raise
            return {
                "turnNumber": 1,
                "rootInfo": {"currentPlayer": "W", "scoreLead": 1.0, "visits": 10},
                "ownership": [0.1] * 81,
                "moveInfos": [],
            }

        monkeypatch.setattr(katago, "query", query)
        service = client.app.state.game_service
        request = PreviewRequest(
            x=0,
            y=0,
            actor_id="human",
            expected_revision=1,
        )
        disconnected = asyncio.create_task(service.preview(game["id"], request))
        await asyncio.wait_for(child_entered.wait(), timeout=1.0)
        retry = asyncio.create_task(service.preview(game["id"], request))
        await asyncio.sleep(0)
        await asyncio.sleep(0)

        assert query_count == 2
        disconnected.cancel()
        with pytest.raises(asyncio.CancelledError):
            await disconnected
        assert child_cancelled is False
        assert not retry.done()

        child_release.set()
        response = await asyncio.wait_for(retry, timeout=1.0)
        assert response["teaching"]["analysis_source"] == "child_root"
        assert response["teaching"]["ownership_after"][0]["value"] == 0.1
        assert query_count == 2


@pytest.mark.asyncio
async def test_rapid_distinct_preview_supersedes_abandoned_child_before_next_search(
    app_client_factory: Any,
    monkeypatch: Any,
) -> None:
    with app_client_factory(katago_analysis={"unused": True}) as (
        client,
        katago,
        _openai,
        _local,
    ):
        game = create_game(client)
        entered = {"A9": asyncio.Event(), "B9": asyncio.Event()}
        release_b = asyncio.Event()
        cancelled: list[str] = []
        calls: list[str] = []
        active_children = 0
        maximum_active_children = 0

        async def query(**request: Any) -> dict[str, Any]:
            nonlocal active_children, maximum_active_children
            if not request["moves"]:
                calls.append("root")
                return {
                    "turnNumber": 0,
                    "rootInfo": {"currentPlayer": "B", "scoreLead": 0.0, "visits": 10},
                    "ownership": [0.0] * 81,
                    "moveInfos": [{"move": "E5", "order": 0, "pv": ["E5"]}],
                }
            coordinate = request["moves"][-1][1]
            calls.append(coordinate)
            active_children += 1
            maximum_active_children = max(maximum_active_children, active_children)
            entered[coordinate].set()
            try:
                if coordinate == "A9":
                    await asyncio.Event().wait()
                else:
                    await release_b.wait()
            except asyncio.CancelledError:
                cancelled.append(coordinate)
                raise
            finally:
                active_children -= 1
            return {
                "turnNumber": 1,
                "rootInfo": {"currentPlayer": "W", "scoreLead": 1.0, "visits": 10},
                "ownership": [0.1] * 81,
                "moveInfos": [],
            }

        monkeypatch.setattr(katago, "query", query)
        service = client.app.state.game_service
        first = asyncio.create_task(
            service.preview(
                game["id"],
                PreviewRequest(x=0, y=0, actor_id="human", expected_revision=1),
            )
        )
        await asyncio.wait_for(entered["A9"].wait(), timeout=1.0)
        second = asyncio.create_task(
            service.preview(
                game["id"],
                PreviewRequest(x=1, y=0, actor_id="human", expected_revision=1),
            )
        )
        with pytest.raises(asyncio.CancelledError):
            await first
        await asyncio.wait_for(entered["B9"].wait(), timeout=1.0)
        release_b.set()
        response = await asyncio.wait_for(second, timeout=1.0)

        assert response["coordinate"] == "B9"
        assert response["teaching"]["analysis_source"] == "child_root"
        assert cancelled == ["A9"]
        assert calls == ["root", "A9", "B9"]
        assert maximum_active_children == 1


@pytest.mark.asyncio
async def test_preview_rechecks_revision_after_child_engine_await(
    app_client_factory: Any,
    monkeypatch: Any,
) -> None:
    with app_client_factory(katago_analysis={"unused": True}) as (
        client,
        katago,
        _openai,
        _local,
    ):
        game = create_game(client)
        child_entered = asyncio.Event()
        child_release = asyncio.Event()

        async def query(**request: Any) -> dict[str, Any]:
            if not request["moves"]:
                return {
                    "turnNumber": 0,
                    "rootInfo": {"currentPlayer": "B", "scoreLead": 0.0, "visits": 10},
                    "ownership": [0.0] * 81,
                    "moveInfos": [{"move": "E5", "order": 0, "pv": ["E5"]}],
                }
            child_entered.set()
            await child_release.wait()
            return {
                "turnNumber": 1,
                "rootInfo": {"currentPlayer": "W", "scoreLead": 1.0, "visits": 10},
                "ownership": [0.1] * 81,
                "moveInfos": [],
            }

        monkeypatch.setattr(katago, "query", query)
        service = client.app.state.game_service
        pending = asyncio.create_task(
            service.preview(
                game["id"],
                PreviewRequest(x=0, y=0, actor_id="human", expected_revision=1),
            )
        )
        await asyncio.wait_for(child_entered.wait(), timeout=1.0)
        service.submit_move(
            game["id"],
            MoveRequest(
                actor_id="human",
                expected_revision=1,
                kind="play",
                point={"x": 4, "y": 4},
                client_request_id="preview-race-move-request-0001",
            ),
        )
        child_release.set()
        with pytest.raises(RevisionConflict):
            await pending

        stored = client.app.state.game_store.get_game(game["id"])
        assert stored is not None
        assert stored["revision"] == 2
        assert len(stored["current_node"]["state"]["history"]) == 1


def test_move_is_idempotent_and_revision_compare_and_swap_is_enforced(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        game = create_game(client)
        game_id = game["id"]

        first = _move(
            client,
            game_id,
            revision=1,
            actor_id="human",
            x=4,
            y=4,
            request_id="move-request-0001",
        )
        assert first.status_code == 200
        assert first.json()["revision"] == 2
        assert first.json()["move_count"] == 1

        retry = _move(
            client,
            game_id,
            revision=1,
            actor_id="human",
            x=4,
            y=4,
            request_id="move-request-0001",
        )
        assert retry.status_code == 200
        assert retry.json()["revision"] == 2
        assert retry.json()["move_count"] == 1

        stale = _move(
            client,
            game_id,
            revision=1,
            actor_id="human",
            x=3,
            y=3,
            request_id="move-request-0002",
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "revision_conflict"

        reused = _move(
            client,
            game_id,
            revision=1,
            actor_id="human",
            x=3,
            y=3,
            request_id="move-request-0001",
        )
        assert reused.status_code == 409
        assert reused.json()["code"] == "idempotency_conflict"


def test_two_pass_finish_stays_unscored_while_resignation_keeps_its_result(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        game = create_game(client, mode="two_player")
        first_pass = client.post(
            f"/api/games/{game['id']}/moves",
            json={
                "actor_id": "black-human",
                "expected_revision": 1,
                "kind": "pass",
                "client_request_id": "two-pass-black-0001",
            },
        )
        assert first_pass.status_code == 200, first_pass.text
        assert first_pass.json()["phase"] == "playing"
        assert first_pass.json()["result"] is None

        second_pass = client.post(
            f"/api/games/{game['id']}/moves",
            json={
                "actor_id": "white-human",
                "expected_revision": 2,
                "kind": "pass",
                "client_request_id": "two-pass-white-0001",
            },
        )
        assert second_pass.status_code == 200, second_pass.text
        assert second_pass.json()["phase"] == "finished"
        assert second_pass.json()["result"] is None
        assert second_pass.json()["area_snapshot"] == {
            "status": "mechanical_all_stones_alive",
            "black_stones": 0,
            "black_enclosed_empty": 0,
            "black_total": 0.0,
            "white_stones": 0,
            "white_enclosed_empty": 0,
            "komi": 7.5,
            "white_total": 7.5,
            "neutral_points": 81,
            "adjudicated": False,
        }
        assert client.get(f"/api/games/{game['id']}").json()["result"] is None

        resigned_game = create_game(client, mode="two_player")
        resigned = client.post(
            f"/api/games/{resigned_game['id']}/moves",
            json={
                "actor_id": "black-human",
                "expected_revision": 1,
                "kind": "resign",
                "client_request_id": "resignation-black-0001",
            },
        )
        assert resigned.status_code == 200, resigned.text
        assert resigned.json()["phase"] == "finished"
        assert resigned.json()["result"] == "W+R"


def test_frontend_move_without_an_explicit_request_key_is_still_retry_safe(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        game = create_game(client)
        payload = {
            "actor_id": "human",
            "expected_revision": 1,
            "kind": "play",
            "point": {"x": 4, "y": 4},
            "intent": "claim",
        }
        first = client.post(f"/api/games/{game['id']}/moves", json=payload)
        retry = client.post(f"/api/games/{game['id']}/moves", json=payload)

        assert first.status_code == retry.status_code == 200
        assert retry.json()["revision"] == 2
        assert retry.json()["move_count"] == 1


def test_companion_needs_explicit_one_turn_delegation_and_never_owns_the_move(
    app_client_factory: Any,
) -> None:
    with app_client_factory(openai_choice="m0") as (client, _katago, openai, _local):
        game = create_game(client)
        game_id = game["id"]

        refused = client.post(
            f"/api/games/{game_id}/agent-turn",
            json={"expected_revision": 1, "actor_id": "companion"},
        )
        assert refused.status_code == 403
        assert refused.json()["code"] == "actor_not_authorized"

        delegated = client.post(
            f"/api/games/{game_id}/agent-turn",
            json={
                "expected_revision": 1,
                "actor_id": "companion",
                "delegated_by": "human",
                "client_request_id": "delegate-request-0001",
            },
        )
        assert delegated.status_code == 200, delegated.text
        position = delegated.json()
        assert position["revision"] == 2
        assert position["moves"][0]["actor_id"] == "human"
        assert position["to_play"] == "white"
        assert openai.candidate_calls
        offered_ids = [item["id"] for item in openai.candidate_calls[0]]
        assert len(offered_ids) == len(set(offered_ids)) == 3
        assert all(re.fullmatch(r"m_[0-9a-f]{32}", item) for item in offered_ids)

        cannot_reuse = client.post(
            f"/api/games/{game_id}/agent-turn",
            json={
                "expected_revision": 2,
                "actor_id": "companion",
                "delegated_by": "human",
            },
        )
        assert cannot_reuse.status_code == 403


def test_agent_choice_maps_only_a_supplied_ui_id_to_its_domain_candidate(
    app_client_factory: Any,
) -> None:
    with app_client_factory(openai_choice="m1") as (client, _katago, openai, _local):
        game = create_game(client, mode="agent_vs_agent")
        response = client.post(
            f"/api/games/{game['id']}/agent-turn",
            json={"expected_revision": 1, "actor_id": "black-agent"},
        )
        assert response.status_code == 200, response.text
        public_candidates = openai.candidate_calls[0]
        selected = public_candidates[1]
        assert response.json()["moves"][0]["point"] == selected["point"]
        assert response.json()["moves"][0]["actor_id"] == "black-agent"

        invalid = client.post(
            f"/api/games/{game['id']}/agent-turn",
            json={
                "expected_revision": 2,
                "actor_id": "white-agent",
                "candidate_id": "m_00000000000000000000000000000000",
            },
        )
        assert invalid.status_code == 400
        assert invalid.json()["code"] == "invalid_game_request"


def test_rewind_preserves_nodes_but_exposes_only_the_active_branch_story(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        game = create_game(client, mode="two_player")
        game_id = game["id"]
        first = _move(
            client,
            game_id,
            revision=1,
            actor_id="black-human",
            x=0,
            y=0,
            request_id="branch-request-0001",
        ).json()
        second = _move(
            client,
            game_id,
            revision=2,
            actor_id="white-human",
            x=1,
            y=0,
            request_id="branch-request-0002",
        ).json()
        assert second["move_count"] == 2

        rewound = client.post(
            f"/api/games/{game_id}/rewind",
            json={"expected_revision": 3, "to_move_number": 1},
        )
        assert rewound.status_code == 200
        assert rewound.json()["move_count"] == 1
        assert rewound.json()["moves"] == first["moves"]

        branch = _move(
            client,
            game_id,
            revision=4,
            actor_id="white-human",
            x=2,
            y=0,
            request_id="branch-request-0003",
        )
        assert branch.status_code == 200
        points = [move["point"] for move in branch.json()["moves"]]
        assert points == [{"x": 0, "y": 0}, {"x": 2, "y": 0}]


def test_rewind_hides_coaching_attached_to_abandoned_nodes(app_client_factory: Any) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        game = create_game(client)
        game_id = game["id"]
        first = _move(
            client,
            game_id,
            revision=1,
            actor_id="human",
            x=4,
            y=4,
            request_id="story-branch-request-0001",
        ).json()
        original_reply = client.post(
            f"/api/games/{game_id}/agent-turn",
            json={
                "expected_revision": 2,
                "actor_id": "sparring-agent",
                "candidate_id": _offered_candidate_id(
                    client,
                    game_id,
                    revision=2,
                    actor_id="sparring-agent",
                ),
                "client_request_id": "story-branch-request-0002",
            },
        )
        assert original_reply.status_code == 200
        question = client.post(
            f"/api/games/{game_id}/coach",
            json={"expected_revision": 3, "question": "What changed?", "kind": "explain"},
        )
        assert question.status_code == 200
        abandoned_message_id = question.json()["message"]["id"]

        rewound = client.post(
            f"/api/games/{game_id}/rewind",
            json={"expected_revision": 3, "to_move_number": 1},
        )
        assert rewound.status_code == 200
        assert rewound.json()["moves"] == first["moves"]
        assert abandoned_message_id not in {item["id"] for item in rewound.json()["coach_messages"]}
        assert len(rewound.json()["coach_messages"]) == 2  # authored root and active move

        new_reply = client.post(
            f"/api/games/{game_id}/agent-turn",
            json={
                "expected_revision": 4,
                "actor_id": "sparring-agent",
                "candidate_id": _offered_candidate_id(
                    client,
                    game_id,
                    revision=4,
                    actor_id="sparring-agent",
                    index=1,
                ),
                "client_request_id": "story-branch-request-0003",
            },
        )
        assert new_reply.status_code == 200
        assert len(new_reply.json()["coach_messages"]) == 3


def test_coach_conversation_is_interleaved_with_moves_in_chronological_order(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        game = create_game(client)
        moved = _move(
            client,
            game["id"],
            revision=1,
            actor_id="human",
            x=4,
            y=4,
            request_id="ordered-chat-request-0001",
        ).json()
        answer = client.post(
            f"/api/games/{game['id']}/coach",
            json={"expected_revision": 2, "question": "What should I remember?"},
        )
        assert answer.status_code == 200
        answer_id = answer.json()["message"]["id"]

        reply = client.post(
            f"/api/games/{game['id']}/agent-turn",
            json={
                "expected_revision": 2,
                "actor_id": "sparring-agent",
                "candidate_id": _offered_candidate_id(
                    client,
                    game["id"],
                    revision=2,
                    actor_id="sparring-agent",
                ),
                "client_request_id": "ordered-chat-request-0002",
            },
        )
        assert reply.status_code == 200
        ids = [message["id"] for message in reply.json()["coach_messages"]]
        assert ids == ["authored-opening", moved["coach_messages"][-1]["id"], answer_id, "move-2"]


def test_stale_coach_message_cannot_commit_after_the_position_changes(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        game = create_game(client)
        root_node_id = client.app.state.game_store.get_game(game["id"])["current_node_id"]
        moved = _move(
            client,
            game["id"],
            revision=1,
            actor_id="human",
            x=4,
            y=4,
            request_id="coach-cas-move-0001",
        )
        assert moved.status_code == 200

        with pytest.raises(RevisionConflict):
            client.app.state.game_store.add_coach_message(
                game_id=game["id"],
                node_id=root_node_id,
                expected_revision=1,
                expected_current_node_id=root_node_id,
                role="assistant",
                content="Advice for the previous position",
                source="deterministic",
            )
        stored = client.app.state.game_store.get_game(game["id"])
        assert stored["coach_messages"] == []


def test_coach_falls_back_to_exact_deterministic_facts_and_persists_message(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, _katago, openai, local):
        game = create_game(client, lesson_id="breath-5", board_size=5)
        answer = client.post(
            f"/api/games/{game['id']}/coach",
            json={
                "expected_revision": 1,
                "question": "Why is this stone urgent?",
                "kind": "explain",
            },
        )
        assert answer.status_code == 200, answer.text
        message = answer.json()["message"]
        assert message["evidence"] == ["teacher"]
        assert "Exact board check" in message["text"]
        assert "fewest current liberties" in message["text"]
        assert "Rules-verified legal candidate:" in message["text"]
        assert "Teacher hypothesis (not KataGo's reason):" in message["text"]
        assert "Teacher risk hypothesis:" in message["text"]
        assert "urgent" not in message["text"]
        assert "weakest" not in message["text"]
        assert "model companion was unavailable" in message["text"]
        assert openai.coach_calls
        assert local.coach_calls == []

        loaded = client.get(f"/api/games/{game['id']}").json()
        assert loaded["coach_messages"][-1]["text"] == message["text"]
        assert openai.coach_calls[0]["candidates"]
        assert all(
            item["intent_evidence"] == "teacher" for item in openai.coach_calls[0]["candidates"]
        )
        assert "intent_evidence=teacher" in openai.coach_calls[0]["teaching_contract"]


def test_engine_candidate_coordinate_and_teacher_reason_are_rendered_separately(
    app_client_factory: Any,
) -> None:
    engine = {
        "rootInfo": {"currentPlayer": "B", "scoreLead": 0.0, "visits": 10},
        "moveInfos": [
            {"move": "E5", "order": 0, "pv": ["E5", "D5"]},
        ],
    }
    with app_client_factory(katago_analysis=engine) as (client, _katago, _openai, _local):
        game = create_game(client)
        answer = client.post(
            f"/api/games/{game['id']}/coach",
            json={"expected_revision": 1, "question": "What should I compare?"},
        )
        assert answer.status_code == 200, answer.text
        text = answer.json()["message"]["text"]
        assert "KataGo order candidate: E5." in text
        assert "Teacher hypothesis (not KataGo's reason):" in text
        assert "KataGo reply in one main line (not forced): White D5" in text


def test_model_coach_uncertainty_is_preserved_in_rendered_and_stored_text(
    app_client_factory: Any,
) -> None:
    uncertainty = "The supplied evidence does not settle whether the group can make two eyes."
    draft = _coach_draft().model_copy(update={"uncertainty": uncertainty})
    with app_client_factory(openai_draft=draft) as (client, _katago, _openai, _local):
        game = create_game(client, lesson_id="breath-5", board_size=5)
        answer = client.post(
            f"/api/games/{game['id']}/coach",
            json={"expected_revision": 1, "question": "What remains unknown?"},
        )
        assert answer.status_code == 200, answer.text
        assert f"Model uncertainty: {uncertainty}" in answer.json()["message"]["text"]
        loaded = client.get(f"/api/games/{game['id']}").json()
        assert f"Model uncertainty: {uncertainty}" in loaded["coach_messages"][-1]["text"]


def test_model_coach_does_not_claim_engine_evidence_when_katago_is_unavailable(
    app_client_factory: Any,
) -> None:
    draft = CoachDraft.model_validate(
        {
            "schema_version": 1,
            "headline": "Count before you run",
            "story": "The scout still has one open road.",
            "principle": {
                "name": "Liberties",
                "explanation": "A connected string shares distinct adjacent empty points.",
            },
            "what_changed": ["The current string is in atari."],
            "remember": "Count exact liberties before choosing a direction.",
            "choices": [],
            "reflection_question": "Which point gives the string more breath?",
            "uncertainty": None,
        }
    )
    with app_client_factory(openai_draft=draft) as (client, _katago, _openai, _local):
        game = create_game(client, lesson_id="breath-5", board_size=5)
        answer = client.post(
            f"/api/games/{game['id']}/coach",
            json={"expected_revision": 1, "question": "Why is this urgent?"},
        )
        assert answer.status_code == 200
        message = answer.json()["message"]
        assert message["evidence"] == ["model"]
        assert message["text"].startswith("Now: Count before you run")
        assert "What changed: The current string is in atari." in message["text"]
        assert "Why: Liberties —" in message["text"]
        assert "Candidate coordinate:" in message["text"]
        assert "Teacher hypothesis:" in message["text"]
        assert "Remember: Count exact liberties" in message["text"]
        assert "The scout still has one open road" not in message["text"]

        loaded = client.get(f"/api/games/{game['id']}").json()
        assert loaded["coach_messages"][-1]["evidence"] == ["model"]


def test_default_configuration_does_not_use_unverified_local_prose(
    app_client_factory: Any,
) -> None:
    with app_client_factory(local_draft=_coach_draft()) as (client, _katago, openai, local):
        game = create_game(client, lesson_id="breath-5", board_size=5)
        answer = client.post(
            f"/api/games/{game['id']}/coach",
            json={"expected_revision": 1, "question": "How many liberties are exact?"},
        )
        assert answer.status_code == 200
        message = answer.json()["message"]
        assert message["evidence"] == ["teacher"]
        assert "Exact board check" in message["text"]
        assert openai.coach_calls
        assert local.coach_calls == []


def test_explicitly_enabled_local_prose_is_never_labeled_as_exact(
    app_client_factory: Any,
) -> None:
    with app_client_factory(local_draft=_coach_draft()) as (client, _katago, _openai, local):
        client.app.state.providers.allow_local_prose = True
        game = create_game(client, lesson_id="breath-5", board_size=5)
        answer = client.post(
            f"/api/games/{game['id']}/coach",
            json={"expected_revision": 1, "question": "Explain this position."},
        )
        assert answer.status_code == 200
        message = answer.json()["message"]
        assert message["evidence"] == ["model"]
        assert message["text"].startswith("Local-model explanation — not an exact board fact.")
        assert local.coach_calls


def test_coach_exchange_reloads_with_its_learner_question_and_exact_response(
    app_client_factory: Any,
) -> None:
    with app_client_factory(openai_draft=_coach_draft()) as (
        client,
        _katago,
        openai,
        _local,
    ):
        game = create_game(client, lesson_id="breath-5", board_size=5)
        payload = {
            "expected_revision": 1,
            "question": "Why is this stone urgent?",
            "kind": "explain",
            "client_request_id": "coach-dialogue-request-0001",
        }
        first = client.post(f"/api/games/{game['id']}/coach", json=payload)
        assert first.status_code == 200, first.text
        assert first.json()["message"]["question"] == payload["question"]
        assert len(openai.coach_calls) == 1

        loaded = client.get(f"/api/games/{game['id']}")
        assert loaded.status_code == 200
        persisted = loaded.json()["coach_messages"][-1]
        assert persisted == first.json()["message"]

        retry = client.post(f"/api/games/{game['id']}/coach", json=payload)
        assert retry.status_code == 200
        assert retry.json() == first.json()
        assert len(openai.coach_calls) == 1
        stored = client.app.state.game_store.get_game(game["id"])
        assert len(stored["coach_messages"]) == 1
        assert stored["coach_messages"][0]["question"] == payload["question"]


def test_coach_request_key_cannot_be_reused_for_different_dialogue(
    app_client_factory: Any,
) -> None:
    with app_client_factory(openai_draft=_coach_draft()) as (
        client,
        _katago,
        openai,
        _local,
    ):
        game = create_game(client)
        first = client.post(
            f"/api/games/{game['id']}/coach",
            json={
                "expected_revision": 1,
                "question": "What should I notice?",
                "client_request_id": "coach-dialogue-request-0002",
            },
        )
        assert first.status_code == 200

        conflict = client.post(
            f"/api/games/{game['id']}/coach",
            json={
                "expected_revision": 1,
                "question": "Invent a different answer under the same key.",
                "client_request_id": "coach-dialogue-request-0002",
            },
        )
        assert conflict.status_code == 409
        assert conflict.json()["code"] == "idempotency_conflict"
        assert len(openai.coach_calls) == 1


def test_new_coach_dialogue_updates_session_recency_without_changing_revision(
    app_client_factory: Any,
) -> None:
    with app_client_factory(openai_draft=_coach_draft()) as (
        client,
        _katago,
        _openai,
        _local,
    ):
        first = create_game(client)
        time.sleep(0.01)
        second = create_game(client)
        assert [item["id"] for item in client.get("/api/games").json()["games"]][:2] == [
            second["id"],
            first["id"],
        ]

        store = client.app.state.game_store
        before = store.get_game(first["id"])
        assert before is not None
        time.sleep(0.01)
        payload = {
            "expected_revision": 1,
            "question": "Bring this quiet session back to the front.",
            "client_request_id": "coach-session-recency-0001",
        }
        response = client.post(f"/api/games/{first['id']}/coach", json=payload)
        assert response.status_code == 200, response.text

        after = store.get_game(first["id"])
        assert after is not None
        assert after["revision"] == before["revision"] == 1
        assert after["updated_at"] > before["updated_at"]
        assert [item["id"] for item in client.get("/api/games").json()["games"]][:2] == [
            first["id"],
            second["id"],
        ]

        retry = client.post(f"/api/games/{first['id']}/coach", json=payload)
        assert retry.status_code == 200
        retried = store.get_game(first["id"])
        assert retried is not None
        assert retried["updated_at"] == after["updated_at"]


def test_follow_up_context_excludes_dialogue_from_an_abandoned_branch(
    app_client_factory: Any,
) -> None:
    with app_client_factory(openai_draft=_coach_draft()) as (
        client,
        _katago,
        openai,
        _local,
    ):
        game = create_game(client)
        game_id = game["id"]
        _move(
            client,
            game_id,
            revision=1,
            actor_id="human",
            x=4,
            y=4,
            request_id="dialogue-branch-move-0001",
        )
        first_question = "What did my center move promise?"
        first = client.post(
            f"/api/games/{game_id}/coach",
            json={
                "expected_revision": 2,
                "question": first_question,
                "client_request_id": "dialogue-branch-coach-0001",
            },
        )
        assert first.status_code == 200
        reply = client.post(
            f"/api/games/{game_id}/agent-turn",
            json={
                "expected_revision": 2,
                "actor_id": "sparring-agent",
                "candidate_id": _offered_candidate_id(
                    client,
                    game_id,
                    revision=2,
                    actor_id="sparring-agent",
                ),
                "client_request_id": "dialogue-branch-agent-0001",
            },
        )
        assert reply.status_code == 200
        abandoned_question = "How should I answer this white move?"
        abandoned = client.post(
            f"/api/games/{game_id}/coach",
            json={
                "expected_revision": 3,
                "question": abandoned_question,
                "client_request_id": "dialogue-branch-coach-0002",
            },
        )
        assert abandoned.status_code == 200
        rewound = client.post(
            f"/api/games/{game_id}/rewind",
            json={"expected_revision": 3, "to_move_number": 1},
        )
        assert rewound.status_code == 200

        follow_up = client.post(
            f"/api/games/{game_id}/coach",
            json={
                "expected_revision": 4,
                "question": "What remains true after rewinding?",
                "client_request_id": "dialogue-branch-coach-0003",
            },
        )
        assert follow_up.status_code == 200
        recent = openai.coach_calls[-1]["recent_dialogue"]
        assert [item["learner_question"] for item in recent] == [first_question]
        assert abandoned_question not in json.dumps(recent)


def test_follow_up_context_has_strict_count_and_serialized_byte_caps(
    app_client_factory: Any,
) -> None:
    with app_client_factory(openai_draft=_coach_draft(long=True)) as (
        client,
        _katago,
        openai,
        _local,
    ):
        game = create_game(client)
        questions: list[str] = []
        for index in range(7):
            question = f"context-{index}-" + ("界" * 600)
            questions.append(question)
            response = client.post(
                f"/api/games/{game['id']}/coach",
                json={
                    "expected_revision": 1,
                    "question": question,
                    "client_request_id": f"bounded-dialogue-request-{index:04d}",
                },
            )
            assert response.status_code == 200, response.text

        context = openai.coach_calls[-1]["recent_dialogue"]
        encoded = json.dumps(context, ensure_ascii=False, separators=(",", ":")).encode()
        assert 0 < len(context) <= COACH_CONTEXT_MAX_EXCHANGES
        assert len(encoded) <= COACH_CONTEXT_MAX_BYTES
        assert not any(item["learner_question"].startswith("context-0-") for item in context)
        assert all(set(item) == {"learner_question", "assistant_answer"} for item in context)
        assert all(
            len(item["learner_question"].encode()) <= COACH_CONTEXT_MAX_QUESTION_BYTES
            for item in context
        )
        assert all(
            len(item["assistant_answer"].encode()) <= COACH_CONTEXT_MAX_ANSWER_BYTES
            for item in context
        )


@pytest.mark.asyncio
async def test_concurrent_identical_coach_requests_share_one_provider_call(
    app_client_factory: Any, monkeypatch: Any
) -> None:
    with app_client_factory(openai_draft=_coach_draft()) as (
        client,
        _katago,
        openai,
        _local,
    ):
        game = create_game(client)
        entered = asyncio.Event()
        release = asyncio.Event()
        provider_calls = 0

        async def blocked_coach(_evidence: dict[str, Any], **_kwargs: Any) -> CoachDraft:
            nonlocal provider_calls
            provider_calls += 1
            entered.set()
            await release.wait()
            return _coach_draft()

        monkeypatch.setattr(openai, "coach", blocked_coach)
        service = client.app.state.game_service
        request = CoachQuestion(
            expected_revision=1,
            question="Explain this position exactly once.",
            client_request_id="concurrent-coach-request-0001",
        )
        first = asyncio.create_task(service.coach(game["id"], request))
        await asyncio.wait_for(entered.wait(), timeout=1.0)
        second = asyncio.create_task(service.coach(game["id"], request))
        await asyncio.sleep(0)

        assert provider_calls == 1
        assert not first.done()
        assert not second.done()
        release.set()
        first_response, second_response = await asyncio.gather(first, second)

        assert first_response == second_response
        assert first_response["message"]["id"] == second_response["message"]["id"]
        stored = client.app.state.game_store.get_game(game["id"])
        assert stored is not None
        assert len(stored["coach_messages"]) == 1


@pytest.mark.asyncio
async def test_concurrent_coach_key_mismatch_conflicts_without_waiting(
    app_client_factory: Any, monkeypatch: Any
) -> None:
    with app_client_factory(openai_draft=_coach_draft()) as (
        client,
        _katago,
        openai,
        _local,
    ):
        game = create_game(client)
        entered = asyncio.Event()
        release = asyncio.Event()
        provider_calls = 0

        async def blocked_coach(_evidence: dict[str, Any], **_kwargs: Any) -> CoachDraft:
            nonlocal provider_calls
            provider_calls += 1
            entered.set()
            await release.wait()
            return _coach_draft()

        monkeypatch.setattr(openai, "coach", blocked_coach)
        service = client.app.state.game_service
        leader = asyncio.create_task(
            service.coach(
                game["id"],
                CoachQuestion(
                    expected_revision=1,
                    question="Keep this request in flight.",
                    client_request_id="concurrent-coach-request-0002",
                ),
            )
        )
        await asyncio.wait_for(entered.wait(), timeout=1.0)

        with pytest.raises(IdempotencyConflict):
            await service.coach(
                game["id"],
                CoachQuestion(
                    expected_revision=1,
                    question="This payload reuses the key incorrectly.",
                    client_request_id="concurrent-coach-request-0002",
                ),
            )

        assert provider_calls == 1
        assert not leader.done()
        release.set()
        await leader


@pytest.mark.asyncio
async def test_cancelling_one_coach_waiter_does_not_cancel_shared_generation(
    app_client_factory: Any, monkeypatch: Any
) -> None:
    with app_client_factory(openai_draft=_coach_draft()) as (
        client,
        _katago,
        openai,
        _local,
    ):
        game = create_game(client)
        entered = asyncio.Event()
        release = asyncio.Event()
        provider_calls = 0

        async def blocked_coach(_evidence: dict[str, Any], **_kwargs: Any) -> CoachDraft:
            nonlocal provider_calls
            provider_calls += 1
            entered.set()
            await release.wait()
            return _coach_draft()

        monkeypatch.setattr(openai, "coach", blocked_coach)
        service = client.app.state.game_service
        request = CoachQuestion(
            expected_revision=1,
            question="Keep answering if my first connection disappears.",
            client_request_id="concurrent-coach-request-0003",
        )
        disconnected = asyncio.create_task(service.coach(game["id"], request))
        await asyncio.wait_for(entered.wait(), timeout=1.0)
        retry = asyncio.create_task(service.coach(game["id"], request))
        await asyncio.sleep(0)

        disconnected.cancel()
        with pytest.raises(asyncio.CancelledError):
            await disconnected
        assert provider_calls == 1
        assert not retry.done()

        release.set()
        response = await retry
        assert response["message"]["question"] == request.question
        stored = client.app.state.game_store.get_game(game["id"])
        assert stored is not None
        assert len(stored["coach_messages"]) == 1


@pytest.mark.asyncio
async def test_position_change_during_provider_await_commits_no_partial_exchange(
    app_client_factory: Any, monkeypatch: Any
) -> None:
    with app_client_factory(openai_draft=_coach_draft()) as (
        client,
        _katago,
        openai,
        _local,
    ):
        game = create_game(client)
        entered = asyncio.Event()
        release = asyncio.Event()

        async def blocked_coach(_evidence: dict[str, Any], **_kwargs: Any) -> CoachDraft:
            entered.set()
            await release.wait()
            return _coach_draft()

        monkeypatch.setattr(openai, "coach", blocked_coach)
        service = client.app.state.game_service
        pending = asyncio.create_task(
            service.coach(
                game["id"],
                CoachQuestion(
                    expected_revision=1,
                    question="Please analyze the unchanged root.",
                    client_request_id="stale-dialogue-request-0001",
                ),
            )
        )
        await asyncio.wait_for(entered.wait(), timeout=1.0)
        service.submit_move(
            game["id"],
            MoveRequest(
                actor_id="human",
                expected_revision=1,
                kind="play",
                point={"x": 4, "y": 4},
                client_request_id="stale-dialogue-move-0001",
            ),
        )
        release.set()
        with pytest.raises(RevisionConflict):
            await pending

        stored = client.app.state.game_store.get_game(game["id"])
        assert stored["coach_messages"] == []
