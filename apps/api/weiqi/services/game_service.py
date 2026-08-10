from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from ..adapters.katago.process import KataGoProcess
from ..adapters.store.sqlite import (
    GameNotFound,
    GameStore,
    IdempotencyConflict,
    RevisionConflict,
)
from ..domain import (
    Actor,
    ActorAuthorityError,
    ActorRole,
    CandidateSelection,
    Color,
    GameActors,
    GamePhase,
    GameState,
    IllegalMoveError,
    LegalCandidate,
    MoveImpact,
    MoveKind,
    Vertex,
    analyze_energy,
    apply_candidate,
    candidate_for_action,
    chinese_area_score,
    explain_move_impact,
    gtp_to_vertex,
    legal_candidates,
    new_game,
    vertex_to_gtp,
)
from ..domain import (
    GameMode as DomainGameMode,
)
from ..schemas import (
    AgentTurnRequest,
    CoachDraft,
    CoachQuestion,
    GameCreate,
    GameMode,
    MoveRequest,
    PreviewRequest,
    RewindRequest,
)
from .curriculum import get_lesson, list_lessons
from .providers import TeachingProviders
from .serialization import impact_to_dict, state_from_dict, state_to_dict, vertex_to_dict


class InvalidGameRequest(ValueError):
    pass


COACH_CONTEXT_MAX_EXCHANGES = 4
COACH_CONTEXT_MAX_BYTES = 4_000
COACH_CONTEXT_MAX_QUESTION_BYTES = 600
COACH_CONTEXT_MAX_ANSWER_BYTES = 1_200
COACH_HISTORY_PAGE_LIMIT = 80
COACH_HISTORY_CURSOR_MAX_BYTES = 512
GAME_LIST_CURSOR_MAX_BYTES = 160
GAME_ID_RE = re.compile(r"^game_[0-9a-f]{32}$")
NODE_ID_RE = re.compile(r"^node_[0-9a-f]{32}$")
COACH_EVENT_CURSOR_ID_RE = re.compile(r"^[nm]:(?:node|coach)_[0-9a-f]{32}$")


@dataclass(frozen=True, slots=True)
class ShortlistedCandidate:
    ui_id: str
    domain: LegalCandidate
    public: dict[str, Any]


@dataclass(frozen=True, slots=True)
class _InflightCoachExchange:
    request_hash: str
    task: asyncio.Task[dict[str, Any]]


def _now_iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _encode_game_cursor(updated_at: float, game_id: str) -> str:
    payload = json.dumps([updated_at, game_id], separators=(",", ":")).encode("ascii")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_game_cursor(cursor: str) -> tuple[float, str]:
    if not cursor or len(cursor.encode("ascii", errors="ignore")) > GAME_LIST_CURSOR_MAX_BYTES:
        raise InvalidGameRequest("the game-list cursor is invalid")
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        decoded = base64.b64decode(padded, altchars=b"-_", validate=True)
        value = json.loads(decoded.decode("ascii"))
    except (ValueError, UnicodeError, json.JSONDecodeError) as exc:
        raise InvalidGameRequest("the game-list cursor is invalid") from exc
    if (
        not isinstance(value, list)
        or len(value) != 2
        or isinstance(value[0], bool)
        or not isinstance(value[0], (int, float))
        or not math.isfinite(float(value[0]))
        or float(value[0]) < 0
        or not isinstance(value[1], str)
        or GAME_ID_RE.fullmatch(value[1]) is None
    ):
        raise InvalidGameRequest("the game-list cursor is invalid")
    return float(value[0]), value[1]


def _encode_coach_history_cursor(game: dict[str, Any], boundary: tuple[float, int, str]) -> str:
    payload = json.dumps(
        {
            "v": 1,
            "game": game["id"],
            "revision": game["revision"],
            "node": game["current_node_id"],
            "before": [boundary[0], boundary[1], boundary[2]],
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode("ascii")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_coach_history_cursor(
    cursor: str,
) -> tuple[str, int, str, tuple[float, int, str]]:
    try:
        encoded = cursor.encode("ascii")
    except UnicodeEncodeError as exc:
        raise InvalidGameRequest("the coach-history cursor is invalid") from exc
    if not encoded or len(encoded) > COACH_HISTORY_CURSOR_MAX_BYTES:
        raise InvalidGameRequest("the coach-history cursor is invalid")
    try:
        decoded = base64.b64decode(
            encoded + b"=" * (-len(encoded) % 4), altchars=b"-_", validate=True
        )
        value = json.loads(decoded.decode("ascii"))
    except (ValueError, UnicodeError, json.JSONDecodeError) as exc:
        raise InvalidGameRequest("the coach-history cursor is invalid") from exc
    if not isinstance(value, dict) or set(value) != {
        "v",
        "game",
        "revision",
        "node",
        "before",
    }:
        raise InvalidGameRequest("the coach-history cursor is invalid")
    before = value["before"]
    if (
        value["v"] != 1
        or not isinstance(value["game"], str)
        or GAME_ID_RE.fullmatch(value["game"]) is None
        or isinstance(value["revision"], bool)
        or not isinstance(value["revision"], int)
        or value["revision"] < 1
        or not isinstance(value["node"], str)
        or NODE_ID_RE.fullmatch(value["node"]) is None
        or not isinstance(before, list)
        or len(before) != 3
        or isinstance(before[0], bool)
        or not isinstance(before[0], (int, float))
        or not math.isfinite(float(before[0]))
        or float(before[0]) < 0
        or isinstance(before[1], bool)
        or not isinstance(before[1], int)
        or before[1] not in {0, 1}
        or not isinstance(before[2], str)
        or COACH_EVENT_CURSOR_ID_RE.fullmatch(before[2]) is None
    ):
        raise InvalidGameRequest("the coach-history cursor is invalid")
    return (
        value["game"],
        value["revision"],
        value["node"],
        (float(before[0]), before[1], before[2]),
    )


def _lesson_or_raise(lesson_id: str | None, board_size: int) -> dict[str, Any]:
    selected = lesson_id
    if selected is None:
        selected = {5: "breath-5", 7: "roads-7", 9: "opening-compass"}.get(
            board_size, "opening-compass"
        )
    lesson = get_lesson(selected)
    if lesson is None:
        raise InvalidGameRequest("that lesson does not exist")
    if int(lesson["board_size"]) != board_size:
        raise InvalidGameRequest(
            f"{lesson['title']} uses a {lesson['board_size']}×{lesson['board_size']} board"
        )
    if not lesson["available"]:
        raise InvalidGameRequest("that later-board lesson is not unlocked in this release")
    return lesson


def _domain_mode(mode: GameMode) -> DomainGameMode:
    if mode is GameMode.TWO_PLAYER:
        return DomainGameMode.HUMAN_VS_HUMAN
    return DomainGameMode(mode.value)


def _actors_for(request: GameCreate) -> GameActors:
    mode = _domain_mode(request.mode)
    human_color = Color(request.human_color)
    if mode is DomainGameMode.HUMAN_VS_AGENT:
        agent_color = human_color.opponent
        agent_config = request.black_agent if agent_color is Color.BLACK else request.white_agent
        return GameActors(
            mode,
            (
                Actor("human", ActorRole.HUMAN, "You", color=human_color),
                Actor(
                    "sparring-agent",
                    ActorRole.PLAYER_AGENT,
                    agent_config.persona,
                    color=agent_color,
                ),
            ),
        )
    if mode is DomainGameMode.HUMAN_COMPANION:
        agent_color = human_color.opponent
        agent_config = request.black_agent if agent_color is Color.BLACK else request.white_agent
        return GameActors(
            mode,
            (
                Actor("human", ActorRole.HUMAN, "You", color=human_color),
                Actor(
                    "sparring-agent",
                    ActorRole.PLAYER_AGENT,
                    agent_config.persona,
                    color=agent_color,
                ),
                Actor(
                    "companion",
                    ActorRole.COMPANION_AGENT,
                    request.companion.persona,
                    aligned_with=human_color,
                ),
            ),
        )
    if mode is DomainGameMode.AGENT_VS_AGENT:
        return GameActors(
            mode,
            (
                Actor(
                    "black-agent",
                    ActorRole.PLAYER_AGENT,
                    request.black_agent.persona,
                    color=Color.BLACK,
                ),
                Actor(
                    "white-agent",
                    ActorRole.PLAYER_AGENT,
                    request.white_agent.persona,
                    color=Color.WHITE,
                ),
                Actor("narrator", ActorRole.NARRATOR_AGENT, request.companion.persona),
            ),
        )
    return GameActors(
        mode,
        (
            Actor("black-human", ActorRole.HUMAN, "Black", color=Color.BLACK),
            Actor("white-human", ActorRole.HUMAN, "White", color=Color.WHITE),
        ),
    )


def _setup_state(request: GameCreate, lesson: dict[str, Any]) -> GameState:
    setup = lesson["setup"]
    initial_black = tuple(
        vertex for item in setup["black"] if (vertex := gtp_to_vertex(item, request.board_size))
    )
    initial_white = tuple(
        vertex for item in setup["white"] if (vertex := gtp_to_vertex(item, request.board_size))
    )
    return new_game(
        size=request.board_size,
        komi=7.5,
        to_move=Color.BLACK if setup["to_play"] == "B" else Color.WHITE,
        initial_black=initial_black,
        initial_white=initial_white,
        actors=_actors_for(request),
    )


def _actor_summary(actor: Actor, game: dict[str, Any]) -> dict[str, Any]:
    summary = {
        "id": actor.id,
        "name": actor.name,
        "role": actor.role.value,
        "color": actor.color.value if actor.color else None,
        "aligned_with": actor.aligned_with.value if actor.aligned_with else None,
        "doctrine": None,
        "personality": None,
    }
    if actor.role is ActorRole.PLAYER_AGENT:
        summary["doctrine"] = (
            game["black_persona"] if actor.color is Color.BLACK else game["white_persona"]
        )
    elif actor.role in {ActorRole.COMPANION_AGENT, ActorRole.NARRATOR_AGENT}:
        summary["personality"] = game.get("companion_style", "socratic")
    return summary


def _stones(state: GameState) -> list[dict[str, Any]]:
    last_placement: dict[tuple[int, int], int] = {}
    for move in state.history:
        if move.kind is MoveKind.PLAY and move.vertex:
            last_placement[(move.vertex.x, move.vertex.y)] = move.number
        for captured in move.captured:
            last_placement.pop((captured.x, captured.y), None)
    result: list[dict[str, Any]] = []
    for color in (Color.BLACK, Color.WHITE):
        for vertex in state.stones(color):
            item = {"x": vertex.x, "y": vertex.y, "color": color.value}
            move_number = last_placement.get((vertex.x, vertex.y))
            if move_number is not None:
                item["move_number"] = move_number
            result.append(item)
    return sorted(result, key=lambda item: (item["y"], item["x"]))


def _moves(state: GameState, active_nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    metadata_by_ply = {
        node["ply"]: node["move"]
        for node in active_nodes
        if node["ply"] > 0 and isinstance(node.get("move"), dict)
    }
    result: list[dict[str, Any]] = []
    for move in state.history:
        metadata = metadata_by_ply.get(move.number, {})
        intent = metadata.get("intent")
        if intent not in {
            "claim",
            "connect",
            "cut",
            "pressure",
            "escape",
            "settle",
            "invade",
            "reduce",
            "sacrifice",
            "endgame",
            "unsure",
        }:
            intent = None
        comment = None
        if metadata.get("choice_source"):
            chooser = metadata.get("chooser_actor_id", move.actor_id)
            doctrine = metadata.get("doctrine", "balanced")
            delegation = (
                f", invited by {metadata['delegated_by']}" if metadata.get("delegated_by") else ""
            )
            comment = (
                f"{chooser} chose with the {doctrine} doctrine through "
                f"{metadata['choice_source']}{delegation}."
            )
        result.append(
            {
                "id": move.candidate_id,
                "move_number": move.number,
                "color": move.color.value,
                "kind": move.kind.value,
                "point": vertex_to_dict(move.vertex),
                "actor_id": move.actor_id,
                "intent": intent,
                "captured": [vertex_to_dict(vertex) for vertex in move.captured],
                "comment": comment,
            }
        )
    return result


def _root_coach(lesson: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": "authored-opening",
        "speaker": "Lantern",
        "role": "companion",
        "text": lesson["story_hook"],
        "evidence": ["metaphor"],
        "prompt": lesson["objective"],
    }


def _move_coach(state: GameState, impact: MoveImpact, lesson: dict[str, Any]) -> dict[str, Any]:
    tags = set(impact.teaching_tags)
    if impact.kind is MoveKind.PASS:
        text = "You passed. That is a statement that no remaining move feels valuable enough."
    elif impact.kind is MoveKind.RESIGN:
        text = "The expedition ends by resignation. The chronicle remains available for review."
    elif "capture" in tags:
        text = f"That move captured {len(impact.captured)} stone(s). Count the liberties that vanished."
    elif "escape" in tags:
        text = "The pressured group found another road. Notice how urgency changed after the extension."
    elif "connect" in tags:
        text = "Two friendly groups now share their liberties. Connection changed their options immediately."
    elif "atari" in tags:
        text = "The opponent now has a group with one liberty. Check the reply before celebrating the pressure."
    else:
        text = "The stone changes local presence, but presence is only potential until borders become secure."
    return {
        "id": f"move-{state.move_number}",
        "speaker": "Lantern",
        "role": "companion",
        "text": text,
        "evidence": ["exact", "metaphor"],
        "prompt": lesson["memory"],
    }


def _global_facets(state: GameState, engine: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    energy = analyze_energy(state)
    atari_groups = [group for group in energy.groups if group.liberty_count == 1]
    black_groups = sum(group.color is Color.BLACK for group in energy.groups)
    white_groups = sum(group.color is Color.WHITE for group in energy.groups)
    score = chinese_area_score(state)
    engine_ready = engine is not None
    facets: list[dict[str, Any]] = [
        {
            "id": "breath",
            "label": "Breath",
            "canonical_term": "Liberties",
            "value": f"{len(atari_groups)} group(s) in atari",
            "change": None,
            "evidence": "exact",
            "explanation": "A group in atari has exactly one distinct liberty.",
            "confidence": 1.0,
        },
        {
            "id": "bonds",
            "label": "Bonds",
            "canonical_term": "Connected groups",
            "value": f"Black {black_groups} · White {white_groups}",
            "change": None,
            "evidence": "exact",
            "explanation": "Orthogonally connected stones form one group and share liberties.",
            "confidence": 1.0,
        },
        {
            "id": "shelter",
            "label": "Shelter",
            "canonical_term": "Life and eyes",
            "value": "Not yet settled" if state.phase is GamePhase.PLAYING else "Read in review",
            "change": None,
            "evidence": "tactical",
            "explanation": "A group needs reliable eye space or enough room to escape; this is not a final life claim.",
            "confidence": 0.55,
        },
        {
            "id": "roads",
            "label": "Roads",
            "canonical_term": "Development paths",
            "value": f"{len(energy.urgent_vertices)} urgent point(s)",
            "change": None,
            "evidence": "exact",
            "explanation": "Urgent points are stones or liberties belonging to groups with at most two liberties.",
            "confidence": 1.0,
        },
        {
            "id": "reach",
            "label": "Reach",
            "canonical_term": "Influence tendency",
            "value": "Engine ownership field" if engine_ready else "Distance-based presence",
            "change": None,
            "evidence": "engine" if engine_ready else "metaphor",
            "explanation": (
                "KataGo estimates future ownership; it is not territory already owned."
                if engine_ready
                else energy.disclaimer
            ),
            "confidence": 0.8 if engine_ready else 0.5,
        },
        {
            "id": "ground",
            "label": "Ground",
            "canonical_term": "Enclosed area",
            "value": f"Black {score.black_territory} · White {score.white_territory}",
            "change": None,
            "evidence": "exact",
            "explanation": "These are presently enclosed empty points, not a claim that every surrounding group is alive.",
            "confidence": 1.0,
        },
        {
            "id": "beat",
            "label": "Beat",
            "canonical_term": "Initiative",
            "value": f"{state.to_move.value.title()} to move",
            "change": None,
            "evidence": "exact",
            "explanation": "The turn is exact; whether a reply is forced is a tactical judgment.",
            "confidence": 1.0,
        },
        {
            "id": "aji",
            "label": "Aji",
            "canonical_term": "Latent possibilities",
            "value": "Ko point present" if state.ko_point else "Unresolved possibilities",
            "change": None,
            "evidence": "tactical",
            "explanation": "Aji names useful possibilities left in a position, not a numeric resource.",
            "confidence": 0.55,
        },
    ]
    return facets


def _impact_facets(impact: MoveImpact) -> list[dict[str, Any]]:
    return [
        {
            "id": "breath",
            "label": "Breath",
            "canonical_term": "Liberties",
            "value": f"{impact.self_liberties} liberties" if impact.vertex else impact.kind.value,
            "change": None,
            "evidence": "exact",
            "explanation": "The resulting connected string's distinct liberties are counted exactly.",
            "confidence": 1.0,
        },
        {
            "id": "bonds",
            "label": "Bonds",
            "canonical_term": "Connection",
            "value": (
                f"Joins {impact.friendly_groups_joined} groups"
                if impact.friendly_groups_joined
                else "No new connection"
            ),
            "change": None,
            "evidence": "exact",
            "explanation": "Friendly stones connect only across shared board lines.",
            "confidence": 1.0,
        },
        {
            "id": "reach",
            "label": "Reach",
            "canonical_term": "Presence change",
            "value": f"{impact.mean_presence_change:+.3f}",
            "change": f"{impact.mean_presence_change:+.3f}",
            "evidence": "metaphor",
            "explanation": "A transparent distance field visualizes direction; it is not score or physics.",
            "confidence": 0.5,
        },
        {
            "id": "beat",
            "label": "Beat",
            "canonical_term": "Pressure",
            "value": f"{impact.newly_atari_opponent_groups} new atari",
            "change": None,
            "evidence": "exact",
            "explanation": "Atari means an opposing group has exactly one liberty after the move.",
            "confidence": 1.0,
        },
    ]


def _intent_for(state: GameState, candidate: LegalCandidate, impact: MoveImpact) -> tuple[str, str]:
    tags = set(impact.teaching_tags)
    if "capture" in tags or "atari" in tags:
        return "pressure", "Fight"
    if "escape" in tags:
        return "escape", "Escape"
    if "connect" in tags:
        return "connect", "Connect"
    assert candidate.vertex is not None
    edge_distance = min(
        candidate.vertex.x,
        candidate.vertex.y,
        state.size - 1 - candidate.vertex.x,
        state.size - 1 - candidate.vertex.y,
    )
    if edge_distance <= 1:
        return "claim", "Build ground"
    if edge_distance >= max(1, state.size // 3):
        return "pressure", "Build reach"
    return "settle", "Stay flexible"


def _candidate_copy(public: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in public.items()}


def _active_nodes(game: dict[str, Any]) -> list[dict[str, Any]]:
    """Return only the root-to-current path from the immutable branch graph."""

    by_id = {node["id"]: node for node in game["nodes"]}
    current_id = game["current_node_id"]
    path: list[dict[str, Any]] = []
    seen: set[str] = set()
    while current_id is not None:
        if current_id in seen or current_id not in by_id:
            raise RuntimeError("stored game branch is incomplete or cyclic")
        seen.add(current_id)
        node = by_id[current_id]
        path.append(node)
        current_id = node["parent_id"]
    path.reverse()
    if not path or path[0]["id"] != game["root_node_id"]:
        raise RuntimeError("stored game branch does not reach its root")
    return path


def _coach_message_events(
    game: dict[str, Any],
) -> list[tuple[tuple[float, int, str], dict[str, Any]]]:
    """Build the stable, active-branch-only coach timeline."""

    active_nodes = _active_nodes(game)
    active_node_ids = {node["id"] for node in active_nodes}
    events: list[tuple[tuple[float, int, str], dict[str, Any]]] = []
    for node in active_nodes:
        if node.get("coach"):
            events.append(
                (
                    (float(node["created_at"]), 0, f"n:{node['id']}"),
                    node["coach"],
                )
            )
    for exchange in game.get("coach_messages", []):
        if exchange["node_id"] not in active_node_ids:
            continue
        events.append(
            (
                (float(exchange["created_at"]), 1, f"m:{exchange['id']}"),
                _coach_exchange_response(exchange)["message"],
            )
        )
    events.sort(key=lambda item: item[0])
    return events


def _coach_history_page(
    game: dict[str, Any],
    *,
    limit: int,
    before: tuple[float, int, str] | None = None,
) -> dict[str, Any]:
    if limit < 1 or limit > COACH_HISTORY_PAGE_LIMIT:
        raise InvalidGameRequest("the coach-history page size is invalid")
    events = _coach_message_events(game)
    end = len(events)
    if before is not None:
        try:
            end = next(index for index, item in enumerate(events) if item[0] == before)
        except StopIteration as exc:
            raise InvalidGameRequest("the coach-history cursor is invalid") from exc
    start = max(0, end - limit)
    page = events[start:end]
    next_cursor = None
    if start > 0 and page:
        next_cursor = _encode_coach_history_cursor(game, page[0][0])
    return {
        "messages": [item[1] for item in page],
        "next_cursor": next_cursor,
    }


def _generated_coach_evidence(source: str) -> list[str]:
    base_source = source.split("+", 1)[0]
    evidence = ["exact"] if base_source == "deterministic" else ["model"]
    if source.endswith("+engine"):
        evidence.append("engine")
    return evidence


def _clip_utf8(value: str, maximum: int) -> str:
    encoded = value.encode("utf-8")
    if len(encoded) <= maximum:
        return value
    if maximum <= 3:
        return ""
    return encoded[: maximum - 3].decode("utf-8", errors="ignore").rstrip() + "…"


def _recent_dialogue(game: dict[str, Any]) -> list[dict[str, str]]:
    active_node_ids = {node["id"] for node in _active_nodes(game)}
    context: list[dict[str, str]] = []
    for exchange in reversed(game.get("coach_messages", [])):
        if exchange["node_id"] not in active_node_ids:
            continue
        question = exchange.get("question")
        answer = exchange.get("content")
        if not isinstance(question, str) or not question or not isinstance(answer, str):
            continue
        entry = {
            "learner_question": _clip_utf8(question, COACH_CONTEXT_MAX_QUESTION_BYTES),
            "assistant_answer": _clip_utf8(answer, COACH_CONTEXT_MAX_ANSWER_BYTES),
        }
        candidate = [entry, *context]
        encoded = json.dumps(candidate, ensure_ascii=False, separators=(",", ":")).encode()
        if len(encoded) > COACH_CONTEXT_MAX_BYTES:
            break
        context = candidate
        if len(context) == COACH_CONTEXT_MAX_EXCHANGES:
            break
    return context


def _coach_exchange_response(exchange: dict[str, Any]) -> dict[str, Any]:
    metadata = exchange.get("response")
    if not isinstance(metadata, dict):
        metadata = {}
    candidates = metadata.get("candidates")
    facets = metadata.get("facets")
    content = exchange["content"]
    if str(exchange["source"]).split("+", 1)[0] == "localllm":
        content = (
            "Local-model explanation — not an exact board fact. Verify factual "
            "claims against the labeled Energy facets below.\n\n" + content
        )
    return {
        "message": {
            "id": exchange["id"],
            "speaker": "Lantern",
            "role": "companion",
            "text": content,
            "evidence": _generated_coach_evidence(exchange["source"]),
            "question": exchange.get("question"),
            "created_at": _now_iso(exchange["created_at"]),
        },
        "candidates": candidates if isinstance(candidates, list) else [],
        "facets": facets if isinstance(facets, list) else [],
    }


class GameService:
    def __init__(
        self,
        store: GameStore,
        katago: KataGoProcess,
        providers: TeachingProviders,
    ) -> None:
        self.store = store
        self.katago = katago
        self.providers = providers
        self._coach_inflight: dict[tuple[str, str], _InflightCoachExchange] = {}

    def curriculum(self) -> dict[str, Any]:
        lessons = []
        for item in list_lessons():
            if item["board_size"] not in {5, 7, 9}:
                continue
            lessons.append(
                {
                    "id": item["id"],
                    "order": item["order"] + 1,
                    "title": item["title"],
                    "subtitle": item["subtitle"],
                    "story": item["story_hook"],
                    "board_size": item["board_size"],
                    "duration_minutes": item["estimated_minutes"],
                    "concepts": [concept.replace("_", " ").title() for concept in item["concepts"]],
                    "difficulty": (
                        "first_steps"
                        if item["order"] <= 2
                        else "beginner"
                        if item["order"] <= 4
                        else "growing"
                    ),
                    "status": "available",
                    "training_variant": (item["variant"] if item["variant"] != "go" else None),
                    "memory_line": item["memory"],
                }
            )
        return {"version": "path-of-influence-v1", "title": "Path of Influence", "lessons": lessons}

    def create_game(self, request: GameCreate) -> dict[str, Any]:
        lesson = _lesson_or_raise(request.lesson_id, request.board_size)
        state = _setup_state(request, lesson)
        metadata = {
            "title": lesson["title"],
            "board_size": request.board_size,
            "lesson_id": lesson["id"],
            "mode": request.mode.value,
            "player_color": "B" if request.human_color == "black" else "W",
            "black_persona": request.black_agent.doctrine.value,
            "white_persona": request.white_agent.doctrine.value,
            "companion_enabled": request.mode
            in {GameMode.HUMAN_COMPANION, GameMode.AGENT_VS_AGENT},
            "companion_style": request.companion.style.value,
            "rank_profile": "rank_20k",
        }
        created = self.store.create_game(
            metadata=metadata,
            root_state=state_to_dict(state),
            root_impact=impact_to_dict(None),
            root_coach=_root_coach(lesson),
        )
        return self.game_response(created)

    def game(self, game_id: str) -> dict[str, Any]:
        loaded = self.store.get_game(game_id)
        if loaded is None:
            raise GameNotFound(game_id)
        return self.game_response(loaded)

    def delete_game(self, game_id: str, expected_revision: int) -> dict[str, Any]:
        self.store.delete_game(game_id, expected_revision)
        return {"id": game_id, "deleted": True, "revision": expected_revision}

    def coach_history(
        self,
        game_id: str,
        *,
        limit: int = COACH_HISTORY_PAGE_LIMIT,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        loaded = self.store.get_game(game_id)
        if loaded is None:
            raise GameNotFound(game_id)
        before = None
        if cursor is not None:
            cursor_game_id, revision, current_node_id, before = _decode_coach_history_cursor(cursor)
            if cursor_game_id != game_id:
                raise InvalidGameRequest("the coach-history cursor is invalid")
            if revision != loaded["revision"] or current_node_id != loaded["current_node_id"]:
                raise RevisionConflict("the game branch changed while history was being read")
        return _coach_history_page(loaded, limit=limit, before=before)

    def list_games(self, *, limit: int = 20, cursor: str | None = None) -> dict[str, Any]:
        before_updated_at: float | None = None
        before_id: str | None = None
        if cursor is not None:
            before_updated_at, before_id = _decode_game_cursor(cursor)
        rows = self.store.list_games(
            limit + 1,
            before_updated_at=before_updated_at,
            before_id=before_id,
        )
        page = rows[:limit]
        games: list[dict[str, Any]] = []
        for item in page:
            loaded = self.store.get_game(item["id"])
            if loaded is not None:
                games.append(self.game_summary(loaded))
        next_cursor = None
        if len(rows) > limit and page:
            last = page[-1]
            next_cursor = _encode_game_cursor(float(last["updated_at"]), str(last["id"]))
        return {"games": games, "next_cursor": next_cursor}

    def game_summary(self, game: dict[str, Any]) -> dict[str, Any]:
        state = state_from_dict(game["current_node"]["state"])
        lesson = get_lesson(game["lesson_id"])
        result = None
        if state.phase is GamePhase.FINISHED:
            result = game.get("result") or chinese_area_score(state).result
        return {
            "id": game["id"],
            "title": game["title"],
            "mode": game["mode"],
            "board_size": game["board_size"],
            "phase": state.phase.value,
            "move_count": state.move_number,
            "result": result,
            "updated_at": _now_iso(game["updated_at"]),
            "lesson_id": game["lesson_id"],
            "lesson_title": lesson["title"] if lesson else None,
            "concepts": [item.replace("_", " ").title() for item in lesson["concepts"]]
            if lesson
            else [],
        }

    def game_response(
        self,
        game: dict[str, Any],
        *,
        analysis: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        state = state_from_dict(game["current_node"]["state"])
        lesson = get_lesson(game["lesson_id"])
        if lesson is None:
            raise RuntimeError("stored game references a missing lesson")
        active_nodes = _active_nodes(game)
        coach_history = _coach_history_page(game, limit=COACH_HISTORY_PAGE_LIMIT)
        summary = self.game_summary(game)
        return {
            **summary,
            "revision": game["revision"],
            "to_play": state.to_move.value,
            "rules": {
                "name": "Chinese area rules",
                "scoring": "chinese_area",
                "ko_rule": "positional_superko",
                "komi": state.komi,
                "training_variant": (lesson["variant"] if lesson["variant"] != "go" else None),
            },
            "stones": _stones(state),
            "moves": _moves(state, active_nodes),
            "actors": [_actor_summary(actor, game) for actor in state.actors.actors],
            "objective": lesson["objective"],
            "act": self._act(state),
            "coach_messages": coach_history["messages"],
            "coach_history_next_cursor": coach_history["next_cursor"],
            "analysis": analysis
            or {
                "status": "fallback",
                "engine": "Deterministic board facts",
                "network": None,
                "visits": None,
                "score_lead": None,
                "ownership": [],
                "facets": _global_facets(state),
                "candidates": [],
            },
            "review_moments": [],
            "story_summary": None,
        }

    @staticmethod
    def _act(state: GameState) -> str:
        if state.phase is GamePhase.FINISHED:
            return "Resolution · Read the finished landscape"
        area = state.size * state.size
        if state.move_number == 0:
            return "Arrival · Make the first promise"
        if state.move_number < area * 0.18:
            return "Opening · Give each stone a purpose"
        if state.move_number < area * 0.55:
            return "Contact · Build, fight, escape, or connect"
        return "Settlement · Turn potential into readable ground"

    def _load_current(
        self, game_id: str, expected_revision: int | None = None
    ) -> tuple[dict[str, Any], GameState, dict[str, Any]]:
        game = self.store.get_game(game_id)
        if game is None:
            raise GameNotFound(game_id)
        if expected_revision is not None and game["revision"] != expected_revision:
            raise RevisionConflict("the game changed in another request")
        state = state_from_dict(game["current_node"]["state"])
        lesson = get_lesson(game["lesson_id"])
        if lesson is None:
            raise RuntimeError("stored game references a missing lesson")
        return game, state, lesson

    async def _compatible_engine_analysis(
        self, state: GameState, *, rank_profile: str
    ) -> dict[str, Any] | None:
        # The pinned teaching network and process buffers are explicitly 9x9.
        # Never decorate 5x5/7x7 lessons with estimates from an out-of-domain net.
        if state.size != 9:
            return None
        try:
            return await self.katago.query(
                moves=[
                    [move.color.gtp, vertex_to_gtp(move.vertex, state.size)]
                    for move in state.history
                    if move.kind in {MoveKind.PLAY, MoveKind.PASS}
                ],
                initial_stones=[
                    *[
                        ["B", vertex_to_gtp(vertex, state.size)]
                        for vertex in state.initial_stones(Color.BLACK)
                    ],
                    *[
                        ["W", vertex_to_gtp(vertex, state.size)]
                        for vertex in state.initial_stones(Color.WHITE)
                    ],
                ],
                board_size=state.size,
                komi=state.komi,
                rank_profile=rank_profile,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            return None

    async def _shortlist(
        self,
        state: GameState,
        *,
        lesson: dict[str, Any],
        rank_profile: str,
    ) -> tuple[list[ShortlistedCandidate], dict[str, Any] | None]:
        legal = [
            candidate
            for candidate in legal_candidates(state, include_pass=False)
            if candidate.vertex
        ]
        if not legal:
            return [], None
        by_vertex = {(item.vertex.x, item.vertex.y): item for item in legal if item.vertex}
        engine = await self._compatible_engine_analysis(state, rank_profile=rank_profile)
        ordered: list[tuple[LegalCandidate, dict[str, Any] | None]] = []
        if engine is not None:
            for info in engine.get("moveInfos", []):
                if not isinstance(info, dict) or not isinstance(info.get("move"), str):
                    continue
                try:
                    vertex = gtp_to_vertex(info["move"], state.size)
                except ValueError:
                    continue
                if vertex is None:
                    continue
                domain = by_vertex.get((vertex.x, vertex.y))
                if domain and all(existing[0].id != domain.id for existing in ordered):
                    ordered.append((domain, info))
                if len(ordered) == 3:
                    break

        if len(ordered) < 3:
            featured: list[LegalCandidate] = []
            for coordinate in lesson.get("featured_moves", []):
                try:
                    vertex = gtp_to_vertex(coordinate, state.size)
                except ValueError:
                    continue
                if vertex:
                    candidate = by_vertex.get((vertex.x, vertex.y))
                    if candidate:
                        featured.append(candidate)

            scored: list[tuple[float, LegalCandidate]] = []
            actor_id = state.actors.player_for(state.to_move).id
            center = (state.size - 1) / 2
            for candidate in legal:
                try:
                    after = apply_candidate(
                        state,
                        CandidateSelection(state.state_token, candidate.id, actor_id),
                    )
                    impact = explain_move_impact(state, after)
                except (IllegalMoveError, ActorAuthorityError):
                    continue
                assert candidate.vertex is not None
                center_distance = abs(candidate.vertex.x - center) + abs(
                    candidate.vertex.y - center
                )
                score = (
                    len(impact.captured) * 120
                    + impact.escaped_atari_groups * 80
                    + impact.newly_atari_opponent_groups * 35
                    + impact.friendly_groups_joined * 20
                    + impact.self_liberties * 3
                    - center_distance * 0.2
                )
                if candidate in featured:
                    score += 1000 - featured.index(candidate)
                scored.append((score, candidate))
            for _, candidate in sorted(scored, key=lambda item: (-item[0], item[1].id)):
                if all(existing[0].id != candidate.id for existing in ordered):
                    ordered.append((candidate, None))
                if len(ordered) == 3:
                    break

        shortlist: list[ShortlistedCandidate] = []
        actor_id = state.actors.player_for(state.to_move).id
        for index, (domain, info) in enumerate(ordered[:3]):
            after = apply_candidate(
                state,
                CandidateSelection(state.state_token, domain.id, actor_id),
            )
            impact = explain_move_impact(state, after)
            intent, title = _intent_for(state, domain, impact)
            assert domain.vertex is not None
            pv = info.get("pv", []) if info else []
            variation: list[dict[str, Any]] = []
            color = state.to_move
            for coordinate in pv[:4] if isinstance(pv, list) else []:
                if not isinstance(coordinate, str):
                    continue
                try:
                    vertex = gtp_to_vertex(coordinate, state.size)
                except ValueError:
                    continue
                if vertex is not None:
                    variation.append(
                        {"color": color.value, "point": {"x": vertex.x, "y": vertex.y}}
                    )
                color = color.opponent
            reply = None
            if len(variation) > 1:
                point = variation[1]["point"]
                reply = f"A likely reply begins near {vertex_to_gtp(Vertex(point['x'], point['y']), state.size)}."
            summary = self._candidate_summary(impact, intent)
            risk = self._candidate_risk(impact, intent)
            public = {
                "id": f"m{index}",
                "point": {"x": domain.vertex.x, "y": domain.vertex.y},
                "coordinate": vertex_to_gtp(domain.vertex, state.size),
                "intent": intent,
                "title": title,
                "summary": summary,
                "likely_reply": reply,
                "risk": risk,
                "variation": variation,
                "facets": _impact_facets(impact),
                "verified": info is not None,
            }
            shortlist.append(ShortlistedCandidate(f"m{index}", domain, public))
        return shortlist, engine

    @staticmethod
    def _candidate_summary(impact: MoveImpact, intent: str) -> str:
        if impact.captured:
            return f"Capture {len(impact.captured)} stone(s) and change the liberty balance now."
        if impact.escaped_atari_groups:
            return "Give the pressured group another road before the ring closes."
        if impact.friendly_groups_joined:
            return "Join friendly stones so they share breath and options."
        if impact.newly_atari_opponent_groups:
            return "Apply concrete pressure by leaving an opposing group one liberty."
        if intent == "claim":
            return "Begin a base near the edge while keeping a road toward open space."
        if intent == "pressure":
            return "Build central reach and flexibility; the open area is not territory yet."
        return "Keep several future directions without making a fragile promise."

    @staticmethod
    def _candidate_risk(impact: MoveImpact, intent: str) -> str:
        if "self-atari-risk" in impact.teaching_tags:
            return "The resulting group has only one liberty; read the immediate reply."
        if intent == "claim":
            return "Early ground can become small if the opponent takes the wider direction."
        if intent == "pressure":
            return "Influence is potential, so it still needs a useful target or conversion."
        return "A flexible move may be too quiet if a nearby group is already urgent."

    @staticmethod
    def _analysis_payload(
        state: GameState,
        shortlist: list[ShortlistedCandidate],
        engine: dict[str, Any] | None,
        network: str | None,
    ) -> dict[str, Any]:
        ownership: list[dict[str, Any]] = []
        values = engine.get("ownership", []) if engine else []
        stdev = engine.get("ownershipStdev", []) if engine else []
        if isinstance(values, list) and len(values) == state.size * state.size:
            for index, raw in enumerate(values):
                if not isinstance(raw, (int, float)) or not math.isfinite(float(raw)):
                    continue
                item = {"x": index % state.size, "y": index // state.size, "value": float(raw)}
                if (
                    isinstance(stdev, list)
                    and index < len(stdev)
                    and isinstance(stdev[index], (int, float))
                    and math.isfinite(float(stdev[index]))
                ):
                    item["uncertainty"] = float(stdev[index])
                ownership.append(item)
        root = engine.get("rootInfo", {}) if engine else {}
        score_lead = root.get("scoreLead") if isinstance(root, dict) else None
        visits = root.get("visits") if isinstance(root, dict) else None
        return {
            "status": "ready" if engine else "fallback",
            "engine": "KataGo 1.17.2" if engine else "Deterministic teaching fallback",
            "network": network if engine else None,
            "visits": visits if isinstance(visits, int) else None,
            "score_lead": float(score_lead)
            if isinstance(score_lead, (int, float)) and math.isfinite(float(score_lead))
            else None,
            "ownership": ownership,
            "facets": _global_facets(state, engine),
            "candidates": [_candidate_copy(item.public) for item in shortlist],
        }

    async def analyze(
        self, game_id: str, expected_revision: int | None = None
    ) -> tuple[dict[str, Any], list[ShortlistedCandidate]]:
        game, state, lesson = self._load_current(game_id, expected_revision)
        shortlist, engine = await self._shortlist(
            state,
            lesson=lesson,
            rank_profile=game["rank_profile"],
        )
        analysis = self._analysis_payload(
            state,
            shortlist,
            engine,
            self.katago._settings.katago_model.name,
        )
        return analysis, shortlist

    async def preview(self, game_id: str, request: PreviewRequest) -> dict[str, Any]:
        game, state, _lesson = self._load_current(game_id, request.expected_revision)
        state.actors.require_turn_actor(request.actor_id, state.to_move)
        vertex = Vertex(request.x, request.y)
        try:
            coordinate = vertex_to_gtp(vertex, state.size)
        except ValueError:
            return {
                "game_id": game_id,
                "revision": game["revision"],
                "point": {"x": request.x, "y": request.y},
                "coordinate": f"({request.x},{request.y})",
                "legal": False,
                "reason": f"that intersection is outside the {state.size}×{state.size} board",
                "captures": [],
                "resulting_liberties": None,
                "facets": [],
                "candidates": [],
                "coach_prompt": "Choose an intersection inside the board lines.",
            }
        try:
            candidate = candidate_for_action(state, MoveKind.PLAY, vertex)
            after = apply_candidate(
                state,
                CandidateSelection(state.state_token, candidate.id, request.actor_id),
            )
            impact = explain_move_impact(state, after)
        except IllegalMoveError as exc:
            return {
                "game_id": game_id,
                "revision": game["revision"],
                "point": {"x": request.x, "y": request.y},
                "coordinate": coordinate,
                "legal": False,
                "reason": str(exc),
                "captures": [],
                "resulting_liberties": None,
                "facets": [],
                "candidates": [],
                "coach_prompt": "Try another intersection and compare its liberties.",
            }
        analysis, _ = await self.analyze(game_id, request.expected_revision)
        return {
            "game_id": game_id,
            "revision": game["revision"],
            "point": {"x": request.x, "y": request.y},
            "coordinate": coordinate,
            "legal": True,
            "reason": None,
            "captures": [vertex_to_dict(item) for item in impact.captured],
            "resulting_liberties": impact.self_liberties,
            "facets": _impact_facets(impact),
            "candidates": analysis["candidates"],
            "coach_prompt": "Name the intention before committing: build, fight, escape, or connect?",
        }

    def submit_move(self, game_id: str, request: MoveRequest) -> dict[str, Any]:
        request_hash = self._request_id(
            "move",
            game_id,
            request.expected_revision,
            request.actor_id,
            request.kind,
            request.point.model_dump() if request.point else None,
            request.intent.value,
        )
        request_id = request.client_request_id or request_hash
        existing = self.store.idempotent_game(game_id, request_id, request_hash)
        if existing is not None:
            return self.game_response(existing)
        game, state, lesson = self._load_current(game_id, request.expected_revision)
        kind = MoveKind(request.kind)
        vertex = Vertex(request.point.x, request.point.y) if request.point else None
        candidate = candidate_for_action(state, kind, vertex)
        after = apply_candidate(
            state,
            CandidateSelection(state.state_token, candidate.id, request.actor_id),
            allow_resign=True,
        )
        impact = explain_move_impact(state, after)
        coach = _move_coach(after, impact, lesson) if game["companion_enabled"] else None
        result = chinese_area_score(after).result if after.phase is GamePhase.FINISHED else None
        updated = self.store.append_node(
            game_id=game_id,
            expected_revision=request.expected_revision,
            request_id=request_id,
            request_hash=request_hash,
            actor=request.actor_id,
            move={
                "kind": request.kind,
                "point": vertex_to_dict(vertex),
                "intent": request.intent.value,
                "candidate_id": candidate.id,
            },
            state=state_to_dict(after),
            impact=impact_to_dict(impact),
            coach=coach,
            result=result,
        )
        return self.game_response(updated)

    async def agent_turn(self, game_id: str, request: AgentTurnRequest) -> dict[str, Any]:
        request_hash = self._request_id(
            "agent-turn",
            game_id,
            request.expected_revision,
            request.actor_id,
            request.delegated_by,
            request.candidate_id,
            request.doctrine.value if request.doctrine else None,
        )
        request_id = request.client_request_id or request_hash
        existing = self.store.idempotent_game(game_id, request_id, request_hash)
        if existing is not None:
            return self.game_response(existing)
        game, state, lesson = self._load_current(game_id, request.expected_revision)
        turn_actor = state.actors.player_for(state.to_move)
        rule_actor_id = turn_actor.id
        chooser = turn_actor
        delegated = False
        if turn_actor.role is ActorRole.PLAYER_AGENT:
            if request.actor_id is not None and request.actor_id != turn_actor.id:
                raise ActorAuthorityError("that Player Agent does not control the current color")
        elif turn_actor.role is ActorRole.HUMAN:
            if request.delegated_by != turn_actor.id:
                raise ActorAuthorityError(
                    "a Human turn requires an explicit one-move delegation from that Human"
                )
            if request.actor_id is None:
                raise ActorAuthorityError("one-move delegation must name a Companion or Narrator")
            chooser = state.actors.actor(request.actor_id)
            if chooser.role not in {ActorRole.COMPANION_AGENT, ActorRole.NARRATOR_AGENT}:
                raise ActorAuthorityError(
                    "only a non-playing teaching agent may choose a delegated move"
                )
            delegated = True
        else:
            raise ActorAuthorityError("the current turn cannot be delegated")
        effective_doctrine = (
            request.doctrine.value
            if request.doctrine
            else (game["black_persona"] if state.to_move is Color.BLACK else game["white_persona"])
        )
        shortlist, _engine = await self._shortlist(
            state,
            lesson=lesson,
            rank_profile=game["rank_profile"],
        )
        if not shortlist:
            if request.candidate_id is not None:
                raise InvalidGameRequest("that candidate is not offered for this position")
            domain = candidate_for_action(state, MoveKind.PASS)
            public_intent = "unsure"
            choice_source = "deterministic"
        else:
            if request.candidate_id is not None:
                match = next(
                    (item for item in shortlist if item.ui_id == request.candidate_id), None
                )
                if match is None:
                    raise InvalidGameRequest("that candidate is not offered for this position")
                choice_source = "learner"
            else:
                selected_id, choice_source = await self.providers.choose_candidate(
                    persona=f"{chooser.name} · {effective_doctrine} doctrine",
                    rank_profile=game["rank_profile"],
                    candidates=[item.public for item in shortlist],
                    lesson_focus=lesson["objective"],
                )
                match = next((item for item in shortlist if item.ui_id == selected_id), None)
                if match is None:
                    match = shortlist[0]
                    choice_source = "deterministic"
            domain = match.domain
            public_intent = match.public["intent"]
        after = apply_candidate(
            state,
            CandidateSelection(state.state_token, domain.id, rule_actor_id),
        )
        impact = explain_move_impact(state, after)
        coach = _move_coach(after, impact, lesson) if game["companion_enabled"] else None
        if coach:
            delegation_note = " by explicit one-move invitation" if delegated else ""
            coach["text"] = (
                f"{chooser.name} chose this move through {choice_source}{delegation_note}. "
                f"{coach['text']}"
            )
        updated = self.store.append_node(
            game_id=game_id,
            expected_revision=request.expected_revision,
            request_id=request_id,
            request_hash=request_hash,
            actor=rule_actor_id,
            move={
                "kind": domain.kind.value,
                "point": vertex_to_dict(domain.vertex),
                "intent": public_intent,
                "doctrine": effective_doctrine,
                "candidate_id": domain.id,
                "choice_source": choice_source,
                "chooser_actor_id": chooser.id,
                "delegated_by": request.delegated_by if delegated else None,
            },
            state=state_to_dict(after),
            impact=impact_to_dict(impact),
            coach=coach,
            result=None,
        )
        return self.game_response(updated)

    def rewind(self, game_id: str, request: RewindRequest) -> dict[str, Any]:
        game, state, _lesson = self._load_current(game_id, request.expected_revision)
        if request.to_move_number > state.move_number:
            raise InvalidGameRequest("cannot rewind beyond the current move")
        by_id = {node["id"]: node for node in game["nodes"]}
        node = game["current_node"]
        while node["ply"] > request.to_move_number:
            parent_id = node["parent_id"]
            if parent_id is None or parent_id not in by_id:
                raise RuntimeError("stored game branch is incomplete")
            node = by_id[parent_id]
        if node["ply"] != request.to_move_number:
            raise InvalidGameRequest("that move is not on the current branch")
        updated = self.store.rewind(game_id, node["id"], request.expected_revision)
        return self.game_response(updated)

    async def coach(self, game_id: str, request: CoachQuestion) -> dict[str, Any]:
        request_hash = self._request_id(
            "coach",
            game_id,
            request.expected_revision,
            request.question,
            request.selected_point.model_dump() if request.selected_point else None,
            request.intent.value,
            request.kind,
        )
        request_id = request.client_request_id or request_hash
        existing = self.store.coach_exchange(game_id, request_id, request_hash)
        if existing is not None:
            return _coach_exchange_response(existing)

        key = (game_id, request_id)
        inflight = self._coach_inflight.get(key)
        if inflight is not None:
            if inflight.request_hash != request_hash:
                raise IdempotencyConflict(
                    "the idempotency key is already in use for another request"
                )
            return await asyncio.shield(inflight.task)

        # There is no await between the lookup and publication, so these operations
        # form one cooperative event-loop critical section. Shielding keeps a client
        # disconnect from cancelling work shared by another retry or waiter.
        task = asyncio.create_task(self._coach_once(game_id, request, request_id, request_hash))
        self._coach_inflight[key] = _InflightCoachExchange(request_hash, task)

        def cleanup(completed: asyncio.Task[dict[str, Any]]) -> None:
            current = self._coach_inflight.get(key)
            if current is not None and current.task is completed:
                self._coach_inflight.pop(key, None)
            if not completed.cancelled():
                completed.exception()

        task.add_done_callback(cleanup)
        return await asyncio.shield(task)

    async def _coach_once(
        self,
        game_id: str,
        request: CoachQuestion,
        request_id: str,
        request_hash: str,
    ) -> dict[str, Any]:
        existing = self.store.coach_exchange(game_id, request_id, request_hash)
        if existing is not None:
            return _coach_exchange_response(existing)
        game, state, lesson = self._load_current(game_id, request.expected_revision)
        analysis, shortlist = await self.analyze(game_id, request.expected_revision)
        evidence = {
            "schema_version": 1,
            "rules": "Chinese area scoring with positional superko",
            "question": request.question,
            "question_kind": request.kind,
            "recent_dialogue": _recent_dialogue(game),
            "lesson": {
                "title": lesson["title"],
                "objective": lesson["objective"],
                "concepts": lesson["concepts"],
                "memory": lesson["memory"],
            },
            "companion": {
                "persona": next(
                    (
                        actor.name
                        for actor in state.actors.actors
                        if actor.role in {ActorRole.COMPANION_AGENT, ActorRole.NARRATOR_AGENT}
                    ),
                    "Lantern",
                ),
                "style": game.get("companion_style", "socratic"),
            },
            "position": {
                "board_size": state.size,
                "to_move": state.to_move.value,
                "move_number": state.move_number,
                "black_stones": [
                    vertex_to_gtp(item, state.size) for item in state.stones(Color.BLACK)
                ],
                "white_stones": [
                    vertex_to_gtp(item, state.size) for item in state.stones(Color.WHITE)
                ],
                "groups": [
                    {
                        "color": group.color.value,
                        "anchor": vertex_to_gtp(group.anchor, state.size),
                        "stones": len(group.stones),
                        "liberties": group.liberty_count,
                        "safety": group.safety.value,
                    }
                    for group in analyze_energy(state).groups
                ],
            },
            "engine": {
                "status": analysis["status"],
                "score_lead_black": analysis["score_lead"],
                "visits": analysis["visits"],
            },
            "candidates": [item.public for item in shortlist],
            "teaching_contract": (
                "Liberties/groups are exact. Engine estimates are uncertain. Energy language is metaphor."
            ),
        }
        draft, source, warning = await self.providers.coach(
            evidence, review=request.kind == "reflection"
        )
        latest, _latest_state, _latest_lesson = self._load_current(
            game_id, request.expected_revision
        )
        if latest["current_node_id"] != game["current_node_id"]:
            raise RevisionConflict("the position changed while the companion was answering")
        text = self._coach_text(draft, state, lesson, warning, shortlist)
        stored_source = f"{source}+engine" if analysis["status"] == "ready" else source
        stored = self.store.add_coach_exchange(
            game_id=game_id,
            node_id=game["current_node_id"],
            expected_revision=request.expected_revision,
            expected_current_node_id=game["current_node_id"],
            request_id=request_id,
            request_hash=request_hash,
            question=request.question,
            content=text,
            source=stored_source,
            response={
                "candidates": analysis["candidates"],
                "facets": analysis["facets"],
            },
        )
        return _coach_exchange_response(stored)

    @staticmethod
    def _coach_text(
        draft: CoachDraft | None,
        state: GameState,
        lesson: dict[str, Any],
        warning: str | None,
        shortlist: list[ShortlistedCandidate],
    ) -> str:
        first_public = shortlist[0].public if shortlist else None
        if draft is None:
            energy = analyze_energy(state)
            urgent = sorted(
                (group for group in energy.groups if group.liberty_count <= 2),
                key=lambda group: (
                    group.liberty_count,
                    group.color.value,
                    group.anchor.x,
                    group.anchor.y,
                ),
            )
            if urgent:
                exact = "; ".join(
                    f"{group.color.value.title()} at "
                    f"{vertex_to_gtp(group.anchor, state.size)} has {group.liberty_count} "
                    f"{'liberty' if group.liberty_count == 1 else 'liberties'}"
                    for group in urgent[:2]
                )
            else:
                exact = "No group is in immediate liberty danger (one or two liberties)."
            parts = [f"Exact board check — {exact}"]
            if first_public is not None:
                verification = (
                    "KataGo-backed option"
                    if first_public.get("verified")
                    else "Legal teaching option"
                )
                parts.append(
                    f"Try {first_public['coordinate']} ({verification}): {first_public['summary']}"
                )
                next_watch = first_public.get("likely_reply") or first_public.get("risk")
                if next_watch:
                    parts.append(f"Next, watch this: {next_watch}")
            parts.append(f"Remember: {lesson['memory']}")
            parts.append(
                "The model companion was unavailable, so this answer uses only "
                "the current board, legal candidates, and deterministic teaching facts."
            )
            return "\n\n".join(parts)

        selected_choice = draft.choices[0] if draft.choices else None
        selected_public = None
        if selected_choice is not None:
            selected_public = next(
                (item.public for item in shortlist if item.ui_id == selected_choice.candidate_id),
                None,
            )
        selected_public = selected_public or first_public
        changes = " ".join(draft.what_changed[:2])
        parts = [f"Now: {draft.headline}"]
        if changes:
            parts.append(f"What changed: {changes}")
        parts.append(f"Why: {draft.principle.name} — {draft.principle.explanation}")
        if selected_public is not None:
            reason = (
                selected_choice.reason
                if selected_choice is not None
                else selected_public["summary"]
            )
            parts.append(f"Try {selected_public['coordinate']}: {reason}")
            next_watch = (
                selected_choice.risk
                if selected_choice is not None
                else selected_public.get("likely_reply") or selected_public.get("risk")
            )
            if next_watch:
                parts.append(f"Then watch: {next_watch}")
        parts.append(f"Remember: {draft.remember}")
        if warning:
            parts.append(warning)
        return "\n\n".join(parts)

    @staticmethod
    def _request_id(*parts: object) -> str:
        encoded = "|".join(repr(part) for part in parts).encode("utf-8")
        return "req_" + hashlib.sha256(encoded).hexdigest()[:32]
