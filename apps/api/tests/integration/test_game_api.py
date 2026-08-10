from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from typing import Any

import pytest
from conftest import create_game
from fastapi.testclient import TestClient

from weiqi.adapters.store.sqlite import IdempotencyConflict, RevisionConflict
from weiqi.schemas import CoachDraft, CoachQuestion, MoveRequest
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
    assert _generated_coach_evidence("localllm+engine") == ["model", "engine"]
    assert _generated_coach_evidence("deterministic+engine") == ["exact", "engine"]


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
        "moveInfos": [{"move": "C4", "pv": ["C4"]}],
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
    engine = {
        "moveInfos": [{"move": "E5", "pv": ["E5", "D5"]}],
        "ownership": [0.0] * 81,
        "ownershipStdev": [0.1] * 81,
        "rootInfo": {"scoreLead": 0.5, "visits": 4},
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
        assert [item["id"] for item in openai.candidate_calls[0]] == ["m0", "m1", "m2"]

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
                "candidate_id": "m9",
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
                "candidate_id": "m0",
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
                "candidate_id": "m1",
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
                "candidate_id": "m0",
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
        assert message["evidence"] == ["exact"]
        assert "Exact board check" in message["text"]
        assert "Try " in message["text"]
        assert "Next, watch this:" in message["text"]
        assert "model companion was unavailable" in message["text"]
        assert openai.coach_calls
        assert local.coach_calls == []

        loaded = client.get(f"/api/games/{game['id']}").json()
        assert loaded["coach_messages"][-1]["text"] == message["text"]


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
        assert "Try " in message["text"]
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
        assert message["evidence"] == ["exact"]
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
                "candidate_id": "m0",
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
