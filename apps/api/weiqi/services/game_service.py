from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import math
import re
from collections import OrderedDict
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
    ResultReason,
    Vertex,
    analyze_energy,
    apply_candidate,
    candidate_for_action,
    chinese_area_score,
    explain_move_impact,
    explain_move_tactics,
    group_at,
    gtp_to_vertex,
    legal_candidates,
    neighbors,
    new_game,
    play,
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
from .curriculum import DEFAULT_LESSON_BY_BOARD_SIZE, PUBLIC_BOARD_SIZES, get_lesson, list_lessons
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
ENGINE_ANALYSIS_CACHE_ENTRIES = 24
CANDIDATE_LIMIT = 3
PV_MOVE_LIMIT = 4
EngineAnalysisCacheKey = tuple[str, int, float, str, str, str, str, str]
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


@dataclass(slots=True)
class _InflightEngineAnalysis:
    task: asyncio.Task[dict[str, Any] | None]
    waiters: int = 0


@dataclass(slots=True)
class _PreviewLane:
    point: tuple[int, int]
    tasks: set[asyncio.Task[Any]]


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
        selected = DEFAULT_LESSON_BY_BOARD_SIZE.get(board_size, "opening-compass")
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
                "intent_evidence": metadata.get("intent_evidence"),
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
        text = (
            "The second consecutive pass ended play. Review unsettled groups before calling a final score."
            if state.phase is GamePhase.FINISHED
            else "You passed, so the opponent has the move. One more consecutive pass would end play."
        )
    elif impact.kind is MoveKind.RESIGN:
        text = "The expedition ends by resignation. The chronicle remains available for review."
    elif "capture" in tags:
        text = f"That move captured {len(impact.captured)} stone(s). Count the liberties that vanished."
    elif "escape" in tags:
        text = "The pressured group found another road. Recount its current liberties after the extension."
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
    black_stones = len(state.stones(Color.BLACK))
    white_stones = len(state.stones(Color.WHITE))
    empty_intersections = state.size * state.size - black_stones - white_stones
    engine_ready = bool(
        _ownership_cells(
            engine.get("ownership") if engine else None,
            engine.get("ownershipStdev") if engine else None,
            state.size,
        )
    )
    facets: list[dict[str, Any]] = [
        {
            "id": "breath",
            "label": "Breath",
            "canonical_term": "Liberties",
            "value": f"{len(atari_groups)} group(s) in atari",
            "change": None,
            "evidence": "exact",
            "explanation": "A group in atari has exactly one distinct liberty.",
        },
        {
            "id": "bonds",
            "label": "Bonds",
            "canonical_term": "Connected groups",
            "value": f"Black {black_groups} · White {white_groups}",
            "change": None,
            "evidence": "exact",
            "explanation": "Orthogonally connected stones form one group and share liberties.",
        },
        {
            "id": "shelter",
            "label": "Shelter",
            "canonical_term": "Life and eyes",
            "value": "Not yet settled" if state.phase is GamePhase.PLAYING else "Read in review",
            "change": None,
            "evidence": "tactical",
            "explanation": "A group needs reliable eye space or enough room to escape; this is not a final life claim.",
        },
        {
            "id": "roads",
            "label": "Roads",
            "canonical_term": "Low-liberty group points",
            "value": f"{len(energy.urgent_vertices)} low-liberty point(s)",
            "change": None,
            "evidence": "exact",
            "explanation": "These are stones or liberties belonging to groups with at most two liberties; this count alone does not decide move priority.",
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
        },
        {
            "id": "area",
            "label": "Board count",
            "canonical_term": "Stones and empty intersections",
            "value": (
                f"Black {black_stones} stone{'s' if black_stones != 1 else ''} · "
                f"White {white_stones} stone{'s' if white_stones != 1 else ''}"
            ),
            "change": None,
            "evidence": "exact",
            "explanation": (
                f"{empty_intersections} intersections are empty. Territory and dead stones are "
                "not settled during live play; engine ownership is a separate forecast."
            ),
        },
        {
            "id": "beat",
            "label": "Turn",
            "canonical_term": "Side to move",
            "value": f"{state.to_move.value.title()} to move",
            "change": None,
            "evidence": "exact",
            "explanation": "The turn is exact; whether a reply is forced is a tactical judgment.",
        },
        {
            "id": "aji",
            "label": "Aji",
            "canonical_term": "Latent possibilities",
            "value": "Ko point present" if state.ko_point else "Unresolved possibilities",
            "change": None,
            "evidence": "tactical",
            "explanation": "Aji names useful possibilities left in a position, not a numeric resource.",
        },
    ]
    return facets


def _impact_facets(impact: MoveImpact) -> list[dict[str, Any]]:
    return [
        {
            "id": "breath",
            "label": "Breath",
            "canonical_term": "Liberties",
            "value": f"{impact.self_liberties} liberties" if impact.vertex else "No stone placed",
            "change": None,
            "evidence": "exact",
            "explanation": (
                "The resulting connected string's distinct liberties are counted exactly."
                if impact.vertex
                else "Pass does not create a string or change any group's liberties."
            ),
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
        },
        {
            "id": "pressure",
            "label": "Pressure",
            "canonical_term": "New atari",
            "value": f"{impact.newly_atari_opponent_groups} new atari",
            "change": None,
            "evidence": "exact",
            "explanation": "Atari means an opposing group has exactly one liberty after the move.",
        },
    ]


def _area_snapshot(state: GameState) -> dict[str, Any]:
    """Expose the mechanical count without pretending dead stones are settled."""

    score = chinese_area_score(state)
    return {
        "status": "mechanical_all_stones_alive",
        "black_stones": score.black_stones,
        "black_enclosed_empty": score.black_territory,
        "black_total": score.black_total,
        "white_stones": score.white_stones,
        "white_enclosed_empty": score.white_territory,
        "komi": score.komi,
        "white_total": score.white_total,
        "neutral_points": score.neutral_points,
        "adjudicated": False,
    }


def _intent_for(state: GameState, candidate: LegalCandidate, impact: MoveImpact) -> tuple[str, str]:
    if candidate.kind is MoveKind.PASS:
        return "endgame", "Possible end-of-game judgment"
    tags = set(impact.teaching_tags)
    if "capture" in tags or "atari" in tags:
        return "pressure", "Possible fighting idea"
    if "escape" in tags:
        return "escape", "Possible escape idea"
    if "connect" in tags:
        return "connect", "Possible connection idea"
    assert candidate.vertex is not None
    edge_distance = min(
        candidate.vertex.x,
        candidate.vertex.y,
        state.size - 1 - candidate.vertex.x,
        state.size - 1 - candidate.vertex.y,
    )
    if edge_distance <= 1:
        return "claim", "Possible base-building idea"
    if edge_distance >= max(1, state.size // 3):
        return "pressure", "Possible influence-building idea"
    return "settle", "Possible flexible-development idea"


def _candidate_copy(public: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in public.items()}


def _candidate_model_copy(public: dict[str, Any]) -> dict[str, Any]:
    """Keep model evidence useful without sending three duplicated board maps."""

    board_fields = {"ownership_before", "ownership_after", "ownership_delta"}
    return {key: value for key, value in public.items() if key not in board_fields}


def _public_candidate_id(candidate: LegalCandidate) -> str:
    """Expose an opaque position-and-action-bound selection token.

    A rank slot such as ``m0`` can name a different coordinate after a fresh
    stochastic engine search. The deterministic domain candidate digest binds
    this public ID to the position, color, action, and coordinate instead.
    """

    return f"m_{candidate.id.removeprefix('cand_')}"


def _engine_history_digest(state: GameState) -> str:
    """Bind HumanSL cache entries to the exact ordered query history."""

    payload = {
        "initial_black": [
            vertex_to_gtp(vertex, state.size) for vertex in state.initial_stones(Color.BLACK)
        ],
        "initial_white": [
            vertex_to_gtp(vertex, state.size) for vertex in state.initial_stones(Color.WHITE)
        ],
        "moves": [
            [move.color.gtp, vertex_to_gtp(move.vertex, state.size)]
            for move in state.history
            if move.kind in {MoveKind.PLAY, MoveKind.PASS}
        ],
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("ascii")
    return hashlib.sha256(encoded).hexdigest()


def _finite_float(
    value: object,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    if not math.isfinite(result):
        return None
    if minimum is not None and result < minimum:
        return None
    if maximum is not None and result > maximum:
        return None
    return result


def _bounded_int(value: object, *, minimum: int, maximum: int) -> int | None:
    if type(value) is not int or not minimum <= value <= maximum:
        return None
    return value


def _ownership_cells(
    values: object,
    variation: object,
    size: int,
) -> list[dict[str, Any]]:
    """Return only a complete, bounded ownership map.

    The pinned KataGo configuration reports all analysis values from Black's
    perspective, so positive cell values mean greater expected Black
    ownership. A malformed or partial map is omitted rather than rendered as
    if missing points were neutral.
    """

    count = size * size
    if not isinstance(values, list) or len(values) != count:
        return []
    normalized: list[float] = []
    for raw in values:
        value = _finite_float(raw, minimum=-1.0, maximum=1.0)
        if value is None:
            return []
        normalized.append(value)

    normalized_variation: list[float] | None = None
    if isinstance(variation, list) and len(variation) == count:
        candidate_variation: list[float] = []
        for raw in variation:
            value = _finite_float(raw, minimum=0.0, maximum=1.0)
            if value is None:
                candidate_variation = []
                break
            candidate_variation.append(value)
        if len(candidate_variation) == count:
            normalized_variation = candidate_variation

    cells: list[dict[str, Any]] = []
    for index, value in enumerate(normalized):
        cell: dict[str, Any] = {
            "x": index % size,
            "y": index // size,
            "value": value,
        }
        if normalized_variation is not None:
            # This is spread across searched continuations, not confidence or
            # model accuracy.
            cell["variation"] = normalized_variation[index]
        cells.append(cell)
    return cells


def _ownership_delta(
    before: list[dict[str, Any]],
    after: list[dict[str, Any]],
    size: int,
) -> list[dict[str, Any]]:
    count = size * size
    if len(before) != count or len(after) != count:
        return []
    delta: list[dict[str, Any]] = []
    for index, (before_cell, after_cell) in enumerate(zip(before, after, strict=True)):
        value = round(float(after_cell["value"]) - float(before_cell["value"]), 6)
        if value == -0.0:
            value = 0.0
        cell = {"x": index % size, "y": index // size, "value": value}
        # The after-map variation describes disagreement across the searched
        # continuations behind this change. Absence remains absence; the client
        # must not silently interpret it as zero variation.
        if "variation" in after_cell:
            cell["variation"] = after_cell["variation"]
        delta.append(cell)
    return delta


def _variation_for_candidate(
    state: GameState,
    candidate: LegalCandidate,
    info: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    if info is None or not isinstance(info.get("pv"), list):
        return []
    pv = info["pv"][:PV_MOVE_LIMIT]
    if not pv or not isinstance(pv[0], str):
        return []
    try:
        first = gtp_to_vertex(pv[0], state.size)
    except ValueError:
        return []
    if first != candidate.vertex:
        return []

    variation: list[dict[str, Any]] = []
    line_state = state
    for coordinate in pv:
        if not isinstance(coordinate, str):
            break
        try:
            vertex = gtp_to_vertex(coordinate, state.size)
        except ValueError:
            break
        color = line_state.to_move
        kind = MoveKind.PASS if vertex is None else MoveKind.PLAY
        try:
            line_candidate = candidate_for_action(line_state, kind, vertex)
            line_state = apply_candidate(
                line_state,
                CandidateSelection(
                    line_state.state_token,
                    line_candidate.id,
                    line_state.actors.player_for(color).id,
                ),
            )
        except (IllegalMoveError, ActorAuthorityError):
            break
        if vertex is None:
            variation.append({"color": color.value, "kind": "pass", "point": None})
        else:
            variation.append(
                {
                    "color": color.value,
                    "kind": "play",
                    "point": {"x": vertex.x, "y": vertex.y},
                }
            )
    return variation


def _adjacent_group_anchors(state: GameState, vertex: Vertex, color: Color) -> list[Vertex]:
    anchors: list[Vertex] = []
    seen: set[Vertex] = set()
    for neighbor in neighbors(vertex, state.size):
        if neighbor in seen:
            continue
        group = group_at(state, neighbor)
        if group is None or group.color is not color:
            continue
        seen.update(group.stones)
        anchors.append(group.anchor)
    return anchors


def _candidate_tactics(
    state: GameState,
    candidate: LegalCandidate,
    impact: MoveImpact,
) -> dict[str, Any]:
    if candidate.kind is MoveKind.PASS:
        return {
            "captures": [],
            "resulting_liberties": None,
            "resulting_group_size": None,
            "connects": [],
            "cuts": [],
            "friendly_groups_joined": 0,
            "opponent_groups_newly_in_atari": 0,
            "friendly_groups_escaped_atari": 0,
            "self_atari": False,
            "ends_play": state.consecutive_passes == 1,
            "evidence": "exact",
        }
    assert candidate.vertex is not None
    friendly = _adjacent_group_anchors(state, candidate.vertex, state.to_move)
    opponent = _adjacent_group_anchors(state, candidate.vertex, state.to_move.opponent)
    # These are deliberately narrow topological meanings. `connects` names
    # groups actually joined through the played stone. `cuts` names distinct
    # opposing groups whose common connection point is occupied; it does not
    # claim that the groups are dead or have no alternate route.
    connects = friendly if len(friendly) >= 2 else []
    cuts = opponent if len(opponent) >= 2 else []
    return {
        "captures": [vertex_to_dict(vertex) for vertex in impact.captured],
        "resulting_liberties": impact.self_liberties,
        "resulting_group_size": impact.self_group_size,
        "connects": [vertex_to_dict(vertex) for vertex in connects],
        "cuts": [vertex_to_dict(vertex) for vertex in cuts],
        "friendly_groups_joined": impact.friendly_groups_joined,
        "opponent_groups_newly_in_atari": impact.newly_atari_opponent_groups,
        "friendly_groups_escaped_atari": impact.escaped_atari_groups,
        "self_atari": impact.self_liberties == 1,
        "evidence": "exact",
    }


def _candidate_engine_fields(
    state: GameState,
    engine: dict[str, Any] | None,
    info: dict[str, Any] | None,
    *,
    compare_score_to_top: bool = True,
) -> dict[str, Any]:
    if engine is None or info is None:
        return {}
    root = engine.get("rootInfo")
    root = root if isinstance(root, dict) else {}
    fields: dict[str, Any] = {}

    before_score = _finite_float(root.get("scoreLead"), minimum=-1_000.0, maximum=1_000.0)
    after_score = _finite_float(info.get("scoreLead"), minimum=-1_000.0, maximum=1_000.0)
    if before_score is not None and after_score is not None:
        delta = round(after_score - before_score, 6)
        score: dict[str, Any] = {
            "before": before_score,
            "after": after_score,
            "delta": delta,
            "mover_delta": delta if state.to_move is Color.BLACK else round(-delta, 6),
            "perspective": "black",
            "evidence": "engine",
        }
        before_outcome_spread = _finite_float(root.get("scoreStdev"), minimum=0.0, maximum=1_000.0)
        after_outcome_spread = _finite_float(info.get("scoreStdev"), minimum=0.0, maximum=1_000.0)
        if before_outcome_spread is not None:
            score["outcome_spread_before"] = before_outcome_spread
        if after_outcome_spread is not None:
            score["outcome_spread_after"] = after_outcome_spread

        move_infos = engine.get("moveInfos") if compare_score_to_top else None
        top_score = None
        if isinstance(move_infos, list):
            for top_info in move_infos:
                if not isinstance(top_info, dict) or top_info.get("order") != 0:
                    continue
                top_score = _finite_float(
                    top_info.get("scoreLead"), minimum=-1_000.0, maximum=1_000.0
                )
                break
        if top_score is not None:
            mover_sign = 1.0 if state.to_move is Color.BLACK else -1.0
            difference_from_top = round(
                mover_sign * after_score - mover_sign * top_score,
                6,
            )
            if difference_from_top == -0.0:
                difference_from_top = 0.0
            score["difference_from_top"] = difference_from_top
            if difference_from_top < 0:
                score["loss_vs_top"] = round(-difference_from_top, 6)
        fields["score"] = score

    evaluation: dict[str, Any] = {"perspective": "black", "evidence": "engine"}
    before_winrate = _finite_float(root.get("winrate"), minimum=0.0, maximum=1.0)
    after_winrate = _finite_float(info.get("winrate"), minimum=0.0, maximum=1.0)
    if before_winrate is not None:
        evaluation["winrate_before"] = before_winrate
    if after_winrate is not None:
        evaluation["winrate_after"] = after_winrate
    if before_winrate is not None and after_winrate is not None:
        winrate_delta = round(after_winrate - before_winrate, 6)
        evaluation["winrate_delta"] = winrate_delta
        evaluation["winrate_mover_delta"] = (
            winrate_delta if state.to_move is Color.BLACK else round(-winrate_delta, 6)
        )

    order = _bounded_int(info.get("order"), minimum=0, maximum=state.size * state.size)
    visits = _bounded_int(info.get("visits"), minimum=0, maximum=10_000_000)
    policy = _finite_float(info.get("prior"), minimum=0.0, maximum=1.0)
    candidate_policy = engine.get("policy")
    if policy is None and candidate_policy:
        if isinstance(candidate_policy, list) and len(candidate_policy) == state.size**2 + 1:
            assert info.get("move") is not None
            try:
                policy_vertex = gtp_to_vertex(str(info["move"]), state.size)
            except ValueError:
                policy_vertex = None
            if str(info["move"]).strip().lower() == "pass":
                policy = _finite_float(
                    candidate_policy[-1],
                    minimum=0.0,
                    maximum=1.0,
                )
            elif policy_vertex is not None:
                policy = _finite_float(
                    candidate_policy[policy_vertex.y * state.size + policy_vertex.x],
                    minimum=0.0,
                    maximum=1.0,
                )
    utility = _finite_float(info.get("utility"), minimum=-100.0, maximum=100.0)
    for key, value in (
        ("order", order),
        ("visits", visits),
        ("policy", policy),
        ("utility", utility),
    ):
        if value is not None:
            evaluation[key] = value
    if len(evaluation) > 2:
        fields["evaluation"] = evaluation

    before_ownership = _ownership_cells(
        engine.get("ownership"), engine.get("ownershipStdev"), state.size
    )
    after_ownership = _ownership_cells(
        info.get("ownership"), info.get("ownershipStdev"), state.size
    )
    if before_ownership:
        fields["ownership_before"] = before_ownership
    if after_ownership:
        fields["ownership_after"] = after_ownership
    delta_ownership = _ownership_delta(before_ownership, after_ownership, state.size)
    if delta_ownership:
        fields["ownership_delta"] = delta_ownership
    if before_ownership or after_ownership:
        fields["ownership_perspective"] = "black"
    return fields


def _engine_info_for_candidate(
    engine: dict[str, Any], candidate: LegalCandidate, size: int
) -> dict[str, Any] | None:
    move_infos = engine.get("moveInfos")
    for info in move_infos if isinstance(move_infos, list) else []:
        if not isinstance(info, dict) or not isinstance(info.get("move"), str):
            continue
        try:
            vertex = gtp_to_vertex(info["move"], size)
        except ValueError:
            continue
        if vertex == candidate.vertex:
            return info
    return None


def _candidate_child_engine_fields(
    state: GameState,
    candidate: LegalCandidate,
    current_engine: dict[str, Any],
    child_engine: dict[str, Any],
) -> dict[str, Any]:
    """Build preview evidence from the analyzed deterministic child root.

    The normal root query may never search an arbitrary clicked move. Appending
    the rules-verified move to the real history and analyzing that child gives
    an honest after-position root ownership and score for every legal point.
    """

    child_root = child_engine.get("rootInfo")
    if not isinstance(child_root, dict):
        return {}
    child_info: dict[str, Any] = {
        "move": vertex_to_gtp(candidate.vertex, state.size),
        "ownership": child_engine.get("ownership"),
        "ownershipStdev": child_engine.get("ownershipStdev"),
    }
    for key in ("scoreLead", "scoreStdev", "winrate", "utility", "visits"):
        child_info[key] = child_root.get(key)

    root_candidate_info = _engine_info_for_candidate(current_engine, candidate, state.size)
    if root_candidate_info is not None:
        # Preserve only parent-root choice metadata. After-position evaluation
        # and maps below always come from the child root.
        child_info["order"] = root_candidate_info.get("order")
        child_info["prior"] = root_candidate_info.get("prior")

    fields = _candidate_engine_fields(
        state,
        current_engine,
        child_info,
        compare_score_to_top=False,
    )
    if root_candidate_info is not None:
        ranked_fields = _candidate_engine_fields(state, current_engine, root_candidate_info)
        ranked_score = ranked_fields.get("score")
        child_score = fields.get("score")
        if isinstance(ranked_score, dict) and isinstance(child_score, dict):
            for key in ("difference_from_top", "loss_vs_top"):
                if key in ranked_score:
                    child_score[key] = ranked_score[key]
    if fields:
        fields["analysis_source"] = "child_root"
    return fields


def _child_root_variation(
    state: GameState,
    candidate: LegalCandidate,
    child_engine: dict[str, Any],
) -> list[dict[str, Any]]:
    move_infos = child_engine.get("moveInfos")
    top: dict[str, Any] | None = None
    for info in move_infos if isinstance(move_infos, list) else []:
        if not isinstance(info, dict) or info.get("order") != 0:
            continue
        top = info
        break
    line: list[object] = [vertex_to_gtp(candidate.vertex, state.size)]
    if top is not None and isinstance(top.get("pv"), list):
        line.extend(top["pv"][: PV_MOVE_LIMIT - 1])
    return _variation_for_candidate(state, candidate, {"pv": line})


def _main_line_reply(variation: list[dict[str, Any]], size: int) -> str | None:
    if len(variation) <= 1:
        return None
    reply_move = variation[1]
    point = reply_move["point"]
    reply_color = str(reply_move["color"]).title()
    if point is None:
        return f"{reply_color} pass"
    return f"{reply_color} {vertex_to_gtp(Vertex(point['x'], point['y']), size)}"


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
    # A complete prose answer mixes rendered facts with explanation. Exact and
    # engine badges belong on the separate structured facets/candidates, never
    # on every sentence in the answer.
    return ["teacher"] if base_source == "deterministic" else ["model"]


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
        self._engine_analysis_cache: OrderedDict[EngineAnalysisCacheKey, dict[str, Any]] = (
            OrderedDict()
        )
        self._engine_analysis_inflight: dict[EngineAnalysisCacheKey, _InflightEngineAnalysis] = {}
        self._preview_lanes: dict[tuple[str, int], _PreviewLane] = {}
        # One bounded engine search at a time keeps rapid board exploration
        # from multiplying GPU work. Distinct cancelled previews leave this
        # queue immediately; identical previews share one task above.
        self._engine_query_slot = asyncio.Semaphore(1)

    async def close(self) -> None:
        """Cancel abandoned engine searches before the process is closed."""

        preview_tasks = {task for lane in self._preview_lanes.values() for task in lane.tasks}
        for task in preview_tasks:
            task.cancel()
        if preview_tasks:
            await asyncio.gather(*preview_tasks, return_exceptions=True)
        self._preview_lanes.clear()

        tasks = {entry.task for entry in self._engine_analysis_inflight.values()}
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._engine_analysis_inflight.clear()

    def curriculum(self) -> dict[str, Any]:
        lessons = []
        for item in list_lessons():
            if item["board_size"] not in PUBLIC_BOARD_SIZES or not item["available"]:
                continue
            lessons.append(
                {
                    "id": item["id"],
                    "order": len(lessons) + 1,
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
        if state.result_reason is ResultReason.RESIGNATION and state.winner is not None:
            result = game.get("result") or f"{state.winner.gtp}+R"
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
            "area_snapshot": _area_snapshot(state),
            "analysis": analysis
            or {
                "status": "fallback",
                "engine": "Exact board facts + authored guidance",
                "side_to_move": state.to_move.value,
                "area_snapshot": _area_snapshot(state),
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
        # Never decorate another board size, including 19x19, with estimates
        # from an out-of-domain net.
        if state.size != 9:
            return None
        network = getattr(getattr(self.katago, "_settings", None), "katago_model", None)
        network_name = getattr(network, "name", "unknown-network")
        cache_key = (
            state.state_token,
            state.size,
            float(state.komi),
            "chinese-area-positional-superko",
            str(network_name),
            rank_profile,
            _engine_history_digest(state),
            "full-evidence-v1",
        )
        if cache_key in self._engine_analysis_cache:
            cached = self._engine_analysis_cache.pop(cache_key)
            self._engine_analysis_cache[cache_key] = cached
            return cached

        inflight = self._engine_analysis_inflight.get(cache_key)
        if inflight is None:
            task = asyncio.create_task(
                self._query_compatible_engine_analysis(
                    state,
                    rank_profile=rank_profile,
                    cache_key=cache_key,
                )
            )
            inflight = _InflightEngineAnalysis(task=task)
            self._engine_analysis_inflight[cache_key] = inflight

            def discard_finished(_task: asyncio.Task[dict[str, Any] | None]) -> None:
                current = self._engine_analysis_inflight.get(cache_key)
                if current is inflight and current.waiters == 0:
                    self._engine_analysis_inflight.pop(cache_key, None)

            task.add_done_callback(discard_finished)

        inflight.waiters += 1
        cancelled = False
        try:
            # One disconnected waiter must not cancel a query still needed by
            # another identical preview. A unique abandoned child query is
            # cancelled below so rapid A -> B clicks do not queue stale work.
            return await asyncio.shield(inflight.task)
        except asyncio.CancelledError:
            cancelled = True
            raise
        finally:
            inflight.waiters -= 1
            if inflight.waiters == 0:
                if cancelled and not inflight.task.done():
                    if self._engine_analysis_inflight.get(cache_key) is inflight:
                        self._engine_analysis_inflight.pop(cache_key, None)
                    inflight.task.cancel()
                elif inflight.task.done():
                    self._engine_analysis_inflight.pop(cache_key, None)

    async def _query_compatible_engine_analysis(
        self,
        state: GameState,
        *,
        rank_profile: str,
        cache_key: EngineAnalysisCacheKey,
    ) -> dict[str, Any] | None:
        moves = [
            [move.color.gtp, vertex_to_gtp(move.vertex, state.size)]
            for move in state.history
            if move.kind in {MoveKind.PLAY, MoveKind.PASS}
        ]
        initial_stones = [
            *[
                ["B", vertex_to_gtp(vertex, state.size)]
                for vertex in state.initial_stones(Color.BLACK)
            ],
            *[
                ["W", vertex_to_gtp(vertex, state.size)]
                for vertex in state.initial_stones(Color.WHITE)
            ],
        ]
        initial_player = moves[0][0] if moves else state.to_move.gtp
        try:
            async with self._engine_query_slot:
                analysis = await self.katago.query(
                    moves=moves,
                    initial_stones=initial_stones,
                    initial_player=initial_player,
                    board_size=state.size,
                    komi=state.komi,
                    rank_profile=rank_profile,
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            return None
        if not isinstance(analysis, dict):
            return None
        root = analysis.get("rootInfo")
        # The pinned Analysis Engine contract always supplies currentPlayer.
        # Missing or mismatched turn identity makes the whole response
        # unsuitable for attachment to this position.
        if not isinstance(root, dict) or root.get("currentPlayer") != state.to_move.gtp:
            return None
        turn_number = analysis.get("turnNumber")
        if type(turn_number) is not int or turn_number != len(moves):
            return None
        self._engine_analysis_cache[cache_key] = analysis
        while len(self._engine_analysis_cache) > ENGINE_ANALYSIS_CACHE_ENTRIES:
            self._engine_analysis_cache.popitem(last=False)
        return analysis

    async def _shortlist(
        self,
        state: GameState,
        *,
        lesson: dict[str, Any],
        rank_profile: str,
    ) -> tuple[list[ShortlistedCandidate], dict[str, Any] | None]:
        all_legal = legal_candidates(state, include_pass=True)
        legal = [candidate for candidate in all_legal if candidate.vertex]
        pass_candidate = next(
            (candidate for candidate in all_legal if candidate.kind is MoveKind.PASS), None
        )
        if not legal and pass_candidate is None:
            return [], None
        by_vertex = {(item.vertex.x, item.vertex.y): item for item in legal if item.vertex}
        engine = await self._compatible_engine_analysis(state, rank_profile=rank_profile)
        ordered: list[tuple[LegalCandidate, dict[str, Any] | None]] = []
        if engine is not None:
            move_infos = engine.get("moveInfos")
            engine_ranked: list[tuple[int, LegalCandidate, dict[str, Any]]] = []
            for info in move_infos if isinstance(move_infos, list) else []:
                if not isinstance(info, dict) or not isinstance(info.get("move"), str):
                    continue
                order = _bounded_int(info.get("order"), minimum=0, maximum=state.size * state.size)
                if order is None:
                    continue
                try:
                    vertex = gtp_to_vertex(info["move"], state.size)
                except ValueError:
                    continue
                if vertex is None:
                    # A pass is offered only when KataGo explicitly ranks it
                    # first. Authored fallback never guesses that the game is
                    # settled enough to pass.
                    domain = pass_candidate if order == 0 else None
                else:
                    domain = by_vertex.get((vertex.x, vertex.y))
                if domain is not None:
                    engine_ranked.append((order, domain, info))
            for _order, domain, info in sorted(engine_ranked, key=lambda item: item[0]):
                if all(existing[0].id != domain.id for existing in ordered):
                    ordered.append((domain, info))
                if len(ordered) == CANDIDATE_LIMIT:
                    break

        if len(ordered) < CANDIDATE_LIMIT:
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
                    # `candidate` was just produced by `legal_candidates` for
                    # this exact state. `play` still rechecks rules and actor
                    # authority without the O(N) candidate-ID re-resolution.
                    after = play(state, candidate.vertex, actor_id=actor_id)
                    impact = explain_move_tactics(state, after)
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
                if len(ordered) == CANDIDATE_LIMIT:
                    break

        shortlist: list[ShortlistedCandidate] = []
        actor_id = state.actors.player_for(state.to_move).id
        for domain, info in ordered[:CANDIDATE_LIMIT]:
            public_id = _public_candidate_id(domain)
            after = apply_candidate(
                state,
                CandidateSelection(state.state_token, domain.id, actor_id),
            )
            impact = explain_move_impact(state, after)
            intent, title = _intent_for(state, domain, impact)
            variation = _variation_for_candidate(state, domain, info)
            reply = None
            if len(variation) > 1:
                reply_move = variation[1]
                point = reply_move["point"]
                reply_color = str(reply_move["color"]).title()
                if point is None:
                    reply = f"{reply_color} pass"
                else:
                    reply = (
                        f"{reply_color} {vertex_to_gtp(Vertex(point['x'], point['y']), state.size)}"
                    )
            summary = self._candidate_summary(impact, intent)
            risk = self._candidate_risk(impact, intent)
            tactics = _candidate_tactics(state, domain, impact)
            what_changes = self._candidate_change_text(impact, tactics)
            public = {
                "id": public_id,
                "kind": domain.kind.value,
                "point": vertex_to_dict(domain.vertex),
                "coordinate": vertex_to_gtp(domain.vertex, state.size),
                "intent": intent,
                "intent_evidence": "teacher",
                "title": title,
                "summary": summary,
                "main_line_reply": reply,
                "risk": risk,
                "variation": variation,
                "facets": _impact_facets(impact),
                "verified": info is not None,
                "legal_verified": True,
                "engine_analyzed": info is not None,
                "tactics": tactics,
                "why_here": summary,
                "what_changes": what_changes,
                "next_calculation": risk,
                **_candidate_engine_fields(state, engine, info),
            }
            shortlist.append(ShortlistedCandidate(public_id, domain, public))
        return shortlist, engine

    @staticmethod
    def _candidate_summary(impact: MoveImpact, intent: str) -> str:
        if impact.kind is MoveKind.PASS:
            return "Passing places no stone. The two-consecutive-pass ending rule applies."
        if impact.captured:
            return f"Capture {len(impact.captured)} stone(s) and change the liberty balance now."
        if impact.escaped_atari_groups:
            return "Give the pressured group another road before the ring closes."
        if impact.friendly_groups_joined:
            return "Join friendly stones so they share breath and options."
        if impact.newly_atari_opponent_groups:
            return "Apply concrete pressure by leaving an opposing group one liberty."
        if intent == "claim":
            return "A teacher hypothesis is to begin a base near the edge while keeping a road toward open space."
        if intent == "pressure":
            return "A teacher hypothesis is to develop central reach; the open area is not territory yet."
        return "A teacher hypothesis is to keep several future directions open."

    @staticmethod
    def _candidate_risk(impact: MoveImpact, intent: str) -> str:
        if impact.kind is MoveKind.PASS:
            return "The opponent may still have a valuable move; passing does not prove the board is settled."
        if "self-atari-risk" in impact.teaching_tags:
            return "The resulting group has only one liberty; read the immediate reply."
        if intent == "claim":
            return "Early ground can become small if the opponent takes the wider direction."
        if intent == "pressure":
            return "Influence is potential, so it still needs a useful target or conversion."
        return (
            "A flexible move may be too quiet if a nearby group currently has very few liberties."
        )

    @staticmethod
    def _candidate_change_text(impact: MoveImpact, tactics: dict[str, Any]) -> str:
        if impact.kind is MoveKind.PASS:
            return "Rules: pass places no stone or captures; the two-consecutive-pass ending rule applies."
        changes: list[str] = []
        if impact.captured:
            changes.append(f"captures {len(impact.captured)} stone(s)")
        if impact.friendly_groups_joined:
            changes.append(f"joins {impact.friendly_groups_joined} friendly groups")
        if impact.escaped_atari_groups:
            changes.append(f"takes {impact.escaped_atari_groups} friendly group(s) out of atari")
        if impact.newly_atari_opponent_groups:
            changes.append(f"puts {impact.newly_atari_opponent_groups} opposing group(s) in atari")
        if tactics["cuts"]:
            changes.append("occupies a shared connection point between opposing groups")
        changes.append(
            f"leaves a {impact.self_group_size}-stone group with {impact.self_liberties} liberties"
        )
        return "Rules: " + "; ".join(changes) + "."

    @staticmethod
    def _analysis_payload(
        state: GameState,
        shortlist: list[ShortlistedCandidate],
        engine: dict[str, Any] | None,
        network: str | None,
    ) -> dict[str, Any]:
        ownership = _ownership_cells(
            engine.get("ownership") if engine else None,
            engine.get("ownershipStdev") if engine else None,
            state.size,
        )
        root = engine.get("rootInfo", {}) if engine else {}
        score_lead = (
            _finite_float(root.get("scoreLead"), minimum=-1_000.0, maximum=1_000.0)
            if isinstance(root, dict)
            else None
        )
        visits = (
            _bounded_int(root.get("visits"), minimum=0, maximum=10_000_000)
            if isinstance(root, dict)
            else None
        )
        return {
            "status": "ready" if engine else "fallback",
            "engine": "KataGo 1.17.2" if engine else "Exact board facts + authored guidance",
            "side_to_move": state.to_move.value,
            "area_snapshot": _area_snapshot(state),
            "network": network if engine else None,
            "visits": visits,
            "score_lead": score_lead,
            "score_perspective": "black" if engine else None,
            "ownership": ownership,
            "ownership_perspective": "black" if ownership else None,
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

    async def analysis_response(self, game_id: str, expected_revision: int) -> dict[str, Any]:
        """Return read-only, revision-bound teaching choices for the current turn."""

        analysis, _shortlist = await self.analyze(game_id, expected_revision)
        # KataGo runs outside the SQLite transaction. Recheck after the await so
        # an old field can never be attached after a concurrent move or rewind.
        game, _state, _lesson = self._load_current(game_id, expected_revision)
        return {
            "game_id": game_id,
            "revision": game["revision"],
            "analysis": analysis,
        }

    async def preview(self, game_id: str, request: PreviewRequest) -> dict[str, Any]:
        """Run one revision's latest distinct point preview.

        Uvicorn does not cancel a handler merely because the browser aborted its
        fetch. A later A -> B click therefore supersedes A here, at the service
        boundary. Identical retries share the same engine work and may both
        finish; a different point cancels every older waiter in this lane.
        """

        current_task = asyncio.current_task()
        if current_task is None:
            return await self._preview_once(game_id, request)
        lane_key = (game_id, request.expected_revision)
        point = (request.x, request.y)
        lane = self._preview_lanes.get(lane_key)
        if lane is None or lane.point != point:
            if lane is not None:
                for task in tuple(lane.tasks):
                    if task is not current_task and not task.done():
                        task.cancel()
            lane = _PreviewLane(point=point, tasks=set())
            self._preview_lanes[lane_key] = lane
        lane.tasks.add(current_task)
        try:
            return await self._preview_once(game_id, request)
        finally:
            lane.tasks.discard(current_task)
            if self._preview_lanes.get(lane_key) is lane and not lane.tasks:
                self._preview_lanes.pop(lane_key, None)

    async def _preview_once(self, game_id: str, request: PreviewRequest) -> dict[str, Any]:
        game, state, lesson = self._load_current(game_id, request.expected_revision)
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
                "candidate_facets": [],
                "position_facets": _global_facets(state),
                "if_played_facets": [],
                "current_area_snapshot": _area_snapshot(state),
                "if_played_area_snapshot": None,
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
                "candidate_facets": [],
                "position_facets": _global_facets(state),
                "if_played_facets": [],
                "current_area_snapshot": _area_snapshot(state),
                "if_played_area_snapshot": None,
                "candidates": [],
                "coach_prompt": "Try another intersection and compare its liberties.",
            }
        shortlist, current_engine = await self._shortlist(
            state,
            lesson=lesson,
            rank_profile=game["rank_profile"],
        )
        analysis = self._analysis_payload(
            state,
            shortlist,
            current_engine,
            self.katago._settings.katago_model.name,
        )
        # Do not spend a child search after this request's revision has already
        # become stale while the current-position query was in flight.
        self._load_current(game_id, request.expected_revision)
        selected_teaching = next(
            (
                _candidate_copy(item)
                for item in analysis["candidates"]
                if item.get("point") == {"x": request.x, "y": request.y}
            ),
            None,
        )
        if selected_teaching is None:
            intent, title = _intent_for(state, candidate, impact)
            tactics = _candidate_tactics(state, candidate, impact)
            summary = self._candidate_summary(impact, intent)
            risk = self._candidate_risk(impact, intent)
            candidate_facets = _impact_facets(impact)
            selected_teaching = {
                "id": _public_candidate_id(candidate),
                "kind": candidate.kind.value,
                "point": {"x": request.x, "y": request.y},
                "coordinate": coordinate,
                "intent": intent,
                "intent_evidence": "teacher",
                "title": title,
                "summary": summary,
                "main_line_reply": None,
                "risk": risk,
                "variation": [],
                "facets": candidate_facets,
                "verified": False,
                "legal_verified": True,
                "engine_analyzed": False,
                "tactics": tactics,
                "why_here": summary,
                "what_changes": self._candidate_change_text(impact, tactics),
                "next_calculation": risk,
            }

        # Preview evidence has one uniform meaning: the `after` values are from
        # a bounded analysis of the rules-verified child position, never an
        # invented estimate for an unsearched root move. The cached current
        # analysis supplies the before map and avoids duplicate root searches.
        child_engine = None
        if current_engine is not None:
            child_engine = await self._compatible_engine_analysis(
                after,
                rank_profile=game["rank_profile"],
            )
            # KataGo runs outside the SQLite transaction. Reject the entire
            # preview if a move or rewind changed the position during either
            # await; never attach an old child field to a new revision.
            self._load_current(game_id, request.expected_revision)
            for key in (
                "score",
                "evaluation",
                "ownership_before",
                "ownership_after",
                "ownership_delta",
                "ownership_perspective",
                "analysis_source",
            ):
                selected_teaching.pop(key, None)
            # A parent-root continuation describes a different search. Never
            # retain it when the child root is missing or rejected.
            selected_teaching["variation"] = []
            selected_teaching["main_line_reply"] = None
            if child_engine is not None:
                child_fields = _candidate_child_engine_fields(
                    state,
                    candidate,
                    current_engine,
                    child_engine,
                )
                selected_teaching.update(child_fields)
                selected_teaching["engine_analyzed"] = bool(child_fields)
                selected_teaching["verified"] = bool(child_fields)
                child_variation = _child_root_variation(state, candidate, child_engine)
                selected_teaching["variation"] = child_variation
                selected_teaching["main_line_reply"] = _main_line_reply(
                    child_variation,
                    state.size,
                )
            else:
                selected_teaching["engine_analyzed"] = False
                selected_teaching["verified"] = False

        # The root query may be unavailable, but a no-engine preview still
        # needs a final CAS check after all awaited work.
        self._load_current(game_id, request.expected_revision)
        candidate_facets = _impact_facets(impact)
        return {
            "game_id": game_id,
            "revision": game["revision"],
            "point": {"x": request.x, "y": request.y},
            "coordinate": coordinate,
            "legal": True,
            "reason": None,
            "captures": [vertex_to_dict(item) for item in impact.captured],
            "resulting_liberties": impact.self_liberties,
            "facets": candidate_facets,
            "candidate_facets": candidate_facets,
            "position_facets": analysis["facets"],
            "if_played_facets": _global_facets(after, child_engine),
            "current_area_snapshot": _area_snapshot(state),
            "if_played_area_snapshot": _area_snapshot(after),
            "if_played_side_to_move": after.to_move.value,
            "candidates": analysis["candidates"],
            "teaching": selected_teaching,
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
        result = (
            f"{after.winner.gtp}+R"
            if after.result_reason is ResultReason.RESIGNATION and after.winner is not None
            else None
        )
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
                "intent_evidence": "learner",
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
            public_intent_evidence = "teacher"
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
                    candidates=[_candidate_model_copy(item.public) for item in shortlist],
                    lesson_focus=lesson["objective"],
                )
                match = next((item for item in shortlist if item.ui_id == selected_id), None)
                if match is None:
                    match = shortlist[0]
                    choice_source = "deterministic"
            domain = match.domain
            public_intent = match.public["intent"]
            public_intent_evidence = match.public["intent_evidence"]
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
                "intent_evidence": public_intent_evidence,
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
                    }
                    for group in analyze_energy(state).groups
                ],
            },
            "engine": {
                "status": analysis["status"],
                "score_lead_black": analysis["score_lead"],
                "visits": analysis["visits"],
            },
            "candidates": [_candidate_model_copy(item.public) for item in shortlist],
            "teaching_contract": (
                "Liberties, captures, groups, side to move, and stone counts are exact facts. "
                "Live territory is not settled. Engine ownership, score forecasts, and lines are "
                "estimates. Candidate intent, title, summary, and risk marked "
                "intent_evidence=teacher are authored hypotheses, not KataGo reasons. Energy "
                "language is metaphor."
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
            groups_by_liberties = sorted(
                energy.groups,
                key=lambda group: (
                    group.liberty_count,
                    group.color.value,
                    group.anchor.x,
                    group.anchor.y,
                ),
            )
            if groups_by_liberties:
                fewest = groups_by_liberties[0].liberty_count
                least_liberties = [
                    group for group in groups_by_liberties if group.liberty_count == fewest
                ]
                exact = "; ".join(
                    f"{group.color.value.title()} at "
                    f"{vertex_to_gtp(group.anchor, state.size)} has {group.liberty_count} "
                    f"{'liberty' if group.liberty_count == 1 else 'liberties'}"
                    for group in least_liberties[:2]
                )
                exact = f"fewest current liberties: {exact}"
            else:
                exact = "there are no stone groups to compare"
            parts = [f"Exact board check — {exact}"]
            if first_public is not None:
                coordinate_source = (
                    "KataGo order candidate"
                    if first_public.get("engine_analyzed")
                    else "Rules-verified legal candidate"
                )
                parts.append(f"{coordinate_source}: {first_public['coordinate']}.")
                parts.append(f"Teacher hypothesis (not KataGo's reason): {first_public['summary']}")
                if first_public.get("main_line_reply"):
                    parts.append(
                        "KataGo reply in one main line (not forced): "
                        f"{first_public['main_line_reply']}"
                    )
                if first_public.get("risk"):
                    parts.append(f"Teacher risk hypothesis: {first_public['risk']}")
            parts.append(f"Remember: {lesson['memory']}")
            parts.append(
                "The model companion was unavailable. This fallback separates exact board facts "
                "from authored teacher guidance."
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
            parts.append(f"Candidate coordinate: {selected_public['coordinate']}.")
            reason_source = (
                "Model explanation" if selected_choice is not None else "Teacher hypothesis"
            )
            parts.append(f"{reason_source}: {reason}")
            next_watch = (
                selected_choice.risk
                if selected_choice is not None
                else selected_public.get("main_line_reply") or selected_public.get("risk")
            )
            if next_watch:
                parts.append(f"Then watch: {next_watch}")
        parts.append(f"Remember: {draft.remember}")
        if draft.uncertainty:
            parts.append(f"Model uncertainty: {draft.uncertainty}")
        if warning:
            parts.append(warning)
        return "\n\n".join(parts)

    @staticmethod
    def _request_id(*parts: object) -> str:
        encoded = "|".join(repr(part) for part in parts).encode("utf-8")
        return "req_" + hashlib.sha256(encoded).hexdigest()[:32]
