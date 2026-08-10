from __future__ import annotations

from typing import Any

from conftest import create_game
from fastapi.testclient import TestClient


def _move(
    client: TestClient,
    game_id: str,
    *,
    revision: int,
    actor_id: str,
    x: int,
    y: int,
    request_id: str,
) -> dict[str, Any]:
    response = client.post(
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
    assert response.status_code == 200, response.text
    return response.json()


def _ask(
    client: TestClient,
    game_id: str,
    *,
    revision: int,
    question: str,
    request_id: str,
) -> dict[str, Any]:
    response = client.post(
        f"/api/games/{game_id}/coach",
        json={
            "expected_revision": revision,
            "question": question,
            "client_request_id": request_id,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["message"]


def test_initial_game_state_cursor_recovers_messages_older_than_its_bounded_window(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        game = create_game(client)
        store = client.app.state.game_store
        stored = store.get_game(game["id"])
        assert stored is not None

        exchange_ids: list[str] = []
        for index in range(81):
            exchange = store.add_coach_exchange(
                game_id=game["id"],
                node_id=stored["current_node_id"],
                expected_revision=stored["revision"],
                expected_current_node_id=stored["current_node_id"],
                request_id=f"seed-coach-history-{index:04d}",
                request_hash=f"seed-coach-history-hash-{index:04d}",
                question=f"Seed learner question {index}",
                content=f"Seed companion answer {index}",
                source="deterministic",
                response={},
            )
            exchange_ids.append(exchange["id"])

        loaded = client.get(f"/api/games/{game['id']}")
        assert loaded.status_code == 200, loaded.text
        initial = loaded.json()
        expected_ids = ["authored-opening", *exchange_ids]

        assert [message["id"] for message in initial["coach_messages"]] == expected_ids[-80:]
        assert isinstance(initial["coach_history_next_cursor"], str)
        assert initial["coach_history_next_cursor"]

        older = client.get(
            f"/api/games/{game['id']}/coach-history",
            params={"limit": 80, "cursor": initial["coach_history_next_cursor"]},
        )
        assert older.status_code == 200, older.text
        assert [message["id"] for message in older.json()["messages"]] == expected_ids[:-80]
        assert older.json()["next_cursor"] is None


def test_coach_history_pages_every_active_branch_event_with_explicit_provenance(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        game = create_game(client)
        game_id = game["id"]
        _move(
            client,
            game_id,
            revision=1,
            actor_id="human",
            x=4,
            y=4,
            request_id="history-branch-move-0001",
        )
        first_question = _ask(
            client,
            game_id,
            revision=2,
            question="What did the first move change?",
            request_id="history-branch-coach-0001",
        )
        original_reply = client.post(
            f"/api/games/{game_id}/agent-turn",
            json={
                "expected_revision": 2,
                "actor_id": "sparring-agent",
                "candidate_id": "m0",
                "client_request_id": "history-branch-agent-0001",
            },
        )
        assert original_reply.status_code == 200, original_reply.text
        abandoned_question = _ask(
            client,
            game_id,
            revision=3,
            question="Does this reply remain on my branch?",
            request_id="history-branch-coach-0002",
        )

        before_rewind = client.get(f"/api/games/{game_id}/coach-history", params={"limit": 2})
        assert before_rewind.status_code == 200, before_rewind.text
        stale_cursor = before_rewind.json()["next_cursor"]
        assert stale_cursor

        rewound = client.post(
            f"/api/games/{game_id}/rewind",
            json={"expected_revision": 3, "to_move_number": 1},
        )
        assert rewound.status_code == 200, rewound.text

        stale = client.get(
            f"/api/games/{game_id}/coach-history",
            params={"limit": 2, "cursor": stale_cursor},
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "revision_conflict"

        branch_reply = client.post(
            f"/api/games/{game_id}/agent-turn",
            json={
                "expected_revision": 4,
                "actor_id": "sparring-agent",
                "candidate_id": "m1",
                "client_request_id": "history-branch-agent-0002",
            },
        )
        assert branch_reply.status_code == 200, branch_reply.text
        active_question = _ask(
            client,
            game_id,
            revision=5,
            question="What should I compare on the new branch?",
            request_id="history-branch-coach-0003",
        )

        recovered: list[dict[str, Any]] = []
        cursor: str | None = None
        seen_cursors: set[str] = set()
        while True:
            params: dict[str, Any] = {"limit": 2}
            if cursor is not None:
                params["cursor"] = cursor
            page = client.get(f"/api/games/{game_id}/coach-history", params=params)
            assert page.status_code == 200, page.text
            payload = page.json()
            recovered = [*payload["messages"], *recovered]
            cursor = payload["next_cursor"]
            if cursor is None:
                break
            assert cursor not in seen_cursors
            seen_cursors.add(cursor)

        assert [message["id"] for message in recovered] == [
            "authored-opening",
            "move-1",
            first_question["id"],
            "move-2",
            active_question["id"],
        ]
        assert abandoned_question["id"] not in {message["id"] for message in recovered}

        authored = [
            message for message in recovered if message["id"].startswith(("authored-", "move-"))
        ]
        exchanges = [message for message in recovered if message["id"].startswith("coach_")]
        assert authored and exchanges
        assert all("prompt" in message and "question" not in message for message in authored)
        assert all("question" in message and "prompt" not in message for message in exchanges)
        assert [message["question"] for message in exchanges] == [
            "What did the first move change?",
            "What should I compare on the new branch?",
        ]


def test_coach_history_rejects_invalid_cursors_and_out_of_range_limits(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        game = create_game(client)
        path = f"/api/games/{game['id']}/coach-history"

        invalid = client.get(path, params={"cursor": "not-a-cursor"})
        assert invalid.status_code == 400
        assert invalid.json()["code"] == "invalid_game_request"

        for limit in (0, 81):
            rejected = client.get(path, params={"limit": limit})
            assert rejected.status_code == 422
            assert rejected.json()["code"] == "invalid_request"

        for limit in (1, 80):
            accepted = client.get(path, params={"limit": limit})
            assert accepted.status_code == 200, accepted.text
            assert 1 <= len(accepted.json()["messages"]) <= limit
