from __future__ import annotations

from typing import Any

from ..domain import (
    Actor,
    ActorRole,
    Color,
    GameActors,
    GameMode,
    GamePhase,
    GameState,
    Move,
    MoveImpact,
    MoveKind,
    ResultReason,
    Vertex,
    replay_and_validate,
)


def vertex_to_dict(vertex: Vertex | None) -> dict[str, int] | None:
    if vertex is None:
        return None
    return {"x": vertex.x, "y": vertex.y}


def vertex_from_dict(payload: object) -> Vertex | None:
    if payload is None:
        return None
    if not isinstance(payload, dict) or set(payload) != {"x", "y"}:
        raise ValueError("stored vertex is invalid")
    return Vertex(int(payload["x"]), int(payload["y"]))


def actor_to_dict(actor: Actor) -> dict[str, Any]:
    return {
        "id": actor.id,
        "role": actor.role.value,
        "name": actor.name,
        "color": actor.color.value if actor.color else None,
        "aligned_with": actor.aligned_with.value if actor.aligned_with else None,
    }


def actor_from_dict(payload: object) -> Actor:
    if not isinstance(payload, dict):
        raise ValueError("stored actor is invalid")
    return Actor(
        id=str(payload["id"]),
        role=ActorRole(str(payload["role"])),
        name=str(payload["name"]),
        color=Color(str(payload["color"])) if payload.get("color") else None,
        aligned_with=(Color(str(payload["aligned_with"])) if payload.get("aligned_with") else None),
    )


def move_to_dict(move: Move) -> dict[str, Any]:
    return {
        "number": move.number,
        "color": move.color.value,
        "kind": move.kind.value,
        "vertex": vertex_to_dict(move.vertex),
        "actor_id": move.actor_id,
        "candidate_id": move.candidate_id,
        "captured": [vertex_to_dict(item) for item in move.captured],
        "position_hash_before": move.position_hash_before,
        "position_hash_after": move.position_hash_after,
    }


def move_from_dict(payload: object) -> Move:
    if not isinstance(payload, dict):
        raise ValueError("stored move is invalid")
    captured = tuple(vertex_from_dict(item) for item in payload.get("captured", []))
    if any(item is None for item in captured):
        raise ValueError("stored captured vertex is invalid")
    return Move(
        number=int(payload["number"]),
        color=Color(str(payload["color"])),
        kind=MoveKind(str(payload["kind"])),
        vertex=vertex_from_dict(payload.get("vertex")),
        actor_id=str(payload["actor_id"]),
        candidate_id=str(payload["candidate_id"]),
        captured=tuple(item for item in captured if item is not None),
        position_hash_before=str(payload["position_hash_before"]),
        position_hash_after=str(payload["position_hash_after"]),
    )


def state_to_dict(state: GameState) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "size": state.size,
        "komi": state.komi,
        "board": [point.value if point else None for point in state.board],
        "initial_board": [point.value if point else None for point in state.initial_board],
        "to_move": state.to_move.value,
        "move_number": state.move_number,
        "black_captures": state.black_captures,
        "white_captures": state.white_captures,
        "consecutive_passes": state.consecutive_passes,
        "phase": state.phase.value,
        "winner": state.winner.value if state.winner else None,
        "result_reason": state.result_reason.value if state.result_reason else None,
        "resigned_by": state.resigned_by.value if state.resigned_by else None,
        "last_move": move_to_dict(state.last_move) if state.last_move else None,
        "ko_point": vertex_to_dict(state.ko_point),
        "position_hash": state.position_hash,
        "seen_position_hashes": sorted(state.seen_position_hashes),
        "history": [move_to_dict(move) for move in state.history],
        "actors": {
            "mode": state.actors.mode.value,
            "actors": [actor_to_dict(actor) for actor in state.actors.actors],
        },
    }


def state_from_dict(payload: object) -> GameState:
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
        raise ValueError("stored game state has an unsupported schema")
    raw_board = payload.get("board")
    raw_initial = payload.get("initial_board")
    raw_history = payload.get("history")
    raw_actors = payload.get("actors")
    if not isinstance(raw_board, list) or not isinstance(raw_initial, list):
        raise ValueError("stored board is invalid")
    if not isinstance(raw_history, list) or not isinstance(raw_actors, dict):
        raise ValueError("stored history or actors are invalid")

    def point(value: object) -> Color | None:
        if value is None:
            return None
        return Color(str(value))

    history = tuple(move_from_dict(item) for item in raw_history)
    actor_items = raw_actors.get("actors")
    if not isinstance(actor_items, list):
        raise ValueError("stored actors are invalid")
    actors = GameActors(
        mode=GameMode(str(raw_actors["mode"])),
        actors=tuple(actor_from_dict(item) for item in actor_items),
    )
    state = GameState(
        size=int(payload["size"]),
        komi=float(payload["komi"]),
        board=tuple(point(item) for item in raw_board),
        initial_board=tuple(point(item) for item in raw_initial),
        to_move=Color(str(payload["to_move"])),
        move_number=int(payload["move_number"]),
        black_captures=int(payload["black_captures"]),
        white_captures=int(payload["white_captures"]),
        consecutive_passes=int(payload["consecutive_passes"]),
        phase=GamePhase(str(payload["phase"])),
        winner=Color(str(payload["winner"])) if payload.get("winner") else None,
        result_reason=(
            ResultReason(str(payload["result_reason"])) if payload.get("result_reason") else None
        ),
        resigned_by=(Color(str(payload["resigned_by"])) if payload.get("resigned_by") else None),
        last_move=move_from_dict(payload["last_move"]) if payload.get("last_move") else None,
        ko_point=vertex_from_dict(payload.get("ko_point")),
        position_hash=str(payload["position_hash"]),
        seen_position_hashes=frozenset(str(item) for item in payload["seen_position_hashes"]),
        history=history,
        actors=actors,
    )
    return replay_and_validate(state)


def impact_to_dict(impact: MoveImpact | None) -> dict[str, Any]:
    if impact is None:
        return {
            "schema_version": 1,
            "kind": "root",
            "teaching_tags": ["begin"],
        }
    return {
        "schema_version": 1,
        "color": impact.color.value,
        "kind": impact.kind.value,
        "vertex": vertex_to_dict(impact.vertex),
        "captured": [vertex_to_dict(vertex) for vertex in impact.captured],
        "self_group_size": impact.self_group_size,
        "self_liberties": impact.self_liberties,
        "friendly_groups_joined": impact.friendly_groups_joined,
        "escaped_atari_groups": impact.escaped_atari_groups,
        "newly_atari_opponent_groups": impact.newly_atari_opponent_groups,
        "mean_presence_change": impact.mean_presence_change,
        "mean_tension_change": impact.mean_tension_change,
        "teaching_tags": list(impact.teaching_tags),
    }
