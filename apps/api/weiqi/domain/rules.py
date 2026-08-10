"""Pure, deterministic Go rules with immutable game snapshots.

The rules engine is the sole authority for state mutation. KataGo may analyze a
snapshot and an LLM player may select a supplied candidate ID, but neither may
submit an arbitrary board mutation.
"""

from __future__ import annotations

import hashlib
import math
import re
from dataclasses import dataclass
from enum import Enum
from typing import TypeAlias

from .actors import GameActors, default_game_actors
from .coordinates import all_vertices, neighbors, vertex_to_gtp, vertex_to_index
from .core_types import Color, GamePhase, MoveKind, Vertex, require_board_size, require_vertex

BoardPoint: TypeAlias = Color | None
Board: TypeAlias = tuple[BoardPoint, ...]
_HASH = re.compile(r"^[0-9a-f]{64}$")
_CANDIDATE_ID = re.compile(r"^cand_[0-9a-f]{32}$")


class IllegalMoveReason(str, Enum):
    GAME_FINISHED = "game_finished"
    WRONG_TURN = "wrong_turn"
    OUT_OF_BOUNDS = "out_of_bounds"
    OCCUPIED = "occupied"
    SUICIDE = "suicide"
    SUPERKO = "superko"
    INVALID_ACTION = "invalid_action"
    STALE_POSITION = "stale_position"
    UNKNOWN_CANDIDATE = "unknown_candidate"


class IllegalMoveError(ValueError):
    def __init__(self, reason: IllegalMoveReason, message: str):
        super().__init__(message)
        self.reason = reason


class ResultReason(str, Enum):
    TWO_PASSES = "two_passes"
    RESIGNATION = "resignation"


@dataclass(frozen=True, slots=True)
class BoardGroup:
    color: Color
    stones: frozenset[Vertex]
    liberties: frozenset[Vertex]

    @property
    def anchor(self) -> Vertex:
        return min(self.stones, key=lambda vertex: (vertex.y, vertex.x))

    @property
    def in_atari(self) -> bool:
        return len(self.liberties) == 1


@dataclass(frozen=True, slots=True)
class Move:
    number: int
    color: Color
    kind: MoveKind
    vertex: Vertex | None
    actor_id: str
    candidate_id: str
    captured: tuple[Vertex, ...]
    position_hash_before: str
    position_hash_after: str


@dataclass(frozen=True, slots=True)
class LegalCandidate:
    id: str
    state_token: str
    position_hash: str
    color: Color
    kind: MoveKind
    vertex: Vertex | None

    @property
    def gtp_vertex(self) -> str:
        # Candidate construction validates the board size separately; this is
        # intentionally not exposed because a size is needed for conversion.
        return "pass" if self.vertex is None else f"({self.vertex.x},{self.vertex.y})"


@dataclass(frozen=True, slots=True)
class CandidateSelection:
    state_token: str
    candidate_id: str
    actor_id: str


@dataclass(frozen=True, slots=True)
class GameState:
    size: int
    komi: float
    board: Board
    initial_board: Board
    to_move: Color
    move_number: int
    black_captures: int
    white_captures: int
    consecutive_passes: int
    phase: GamePhase
    winner: Color | None
    result_reason: ResultReason | None
    resigned_by: Color | None
    last_move: Move | None
    ko_point: Vertex | None
    position_hash: str
    seen_position_hashes: frozenset[str]
    history: tuple[Move, ...]
    actors: GameActors

    def __post_init__(self) -> None:
        require_board_size(self.size)
        if isinstance(self.komi, bool) or not isinstance(self.komi, (int, float)):
            raise TypeError("komi must be numeric")
        if not math.isfinite(self.komi) or not -400 <= self.komi <= 400:
            raise ValueError("komi must be finite and between -400 and 400")
        if not isinstance(self.to_move, Color):
            raise TypeError("side to move must be a Color")
        if not isinstance(self.phase, GamePhase):
            raise TypeError("game phase must be a GamePhase")
        if not isinstance(self.actors, GameActors):
            raise TypeError("actors must be a validated GameActors set")
        expected_points = self.size * self.size
        if len(self.board) != expected_points or len(self.initial_board) != expected_points:
            raise ValueError("board snapshots do not match board size")
        if any(point not in {None, Color.BLACK, Color.WHITE} for point in self.board):
            raise ValueError("board contains an invalid point")
        if any(point not in {None, Color.BLACK, Color.WHITE} for point in self.initial_board):
            raise ValueError("initial board contains an invalid point")
        if self.move_number != len(self.history):
            raise ValueError("move number must equal immutable history length")
        if self.last_move != (self.history[-1] if self.history else None):
            raise ValueError("last move must match immutable history")
        if self.black_captures < 0 or self.white_captures < 0:
            raise ValueError("capture counts cannot be negative")
        if not 0 <= self.consecutive_passes <= 2:
            raise ValueError("consecutive passes must be between zero and two")
        expected_hash = board_position_hash(self.board, self.size)
        if self.position_hash != expected_hash:
            raise ValueError("position hash does not match the board")
        if not _HASH.fullmatch(self.position_hash):
            raise ValueError("position hash is malformed")
        initial_hash = board_position_hash(self.initial_board, self.size)
        expected_seen = {initial_hash}
        prior_hash = initial_hash
        expected_black_captures = 0
        expected_white_captures = 0
        prior_color: Color | None = None
        for index, move in enumerate(self.history, start=1):
            if move.number != index:
                raise ValueError("history move numbers must be consecutive")
            if prior_color is not None and move.color is not prior_color.opponent:
                raise ValueError("history move colors must alternate")
            self.actors.require_turn_actor(move.actor_id, move.color)
            if not _CANDIDATE_ID.fullmatch(move.candidate_id):
                raise ValueError("history candidate id is malformed")
            if move.position_hash_before != prior_hash:
                raise ValueError("history position hashes do not form a chain")
            if not _HASH.fullmatch(move.position_hash_after):
                raise ValueError("history position hash is malformed")
            if move.kind is MoveKind.PLAY:
                if move.vertex is None:
                    raise ValueError("a play history entry requires a vertex")
                require_vertex(move.vertex, self.size)
                if move.position_hash_after == move.position_hash_before:
                    raise ValueError("a play must change the board position")
                if move.position_hash_after in expected_seen:
                    raise ValueError("history violates positional superko")
                expected_seen.add(move.position_hash_after)
                if len(move.captured) != len(set(move.captured)):
                    raise ValueError("a move cannot capture one vertex twice")
                for captured_vertex in move.captured:
                    require_vertex(captured_vertex, self.size)
                if move.color is Color.BLACK:
                    expected_black_captures += len(move.captured)
                else:
                    expected_white_captures += len(move.captured)
            elif move.vertex is not None or move.captured:
                raise ValueError("pass and resignation history cannot contain board effects")
            if move.kind is MoveKind.RESIGN and index != len(self.history):
                raise ValueError("no moves may follow a resignation")
            prior_hash = move.position_hash_after
            prior_color = move.color
        if prior_hash != self.position_hash:
            raise ValueError("history does not finish at the current position")
        if self.seen_position_hashes != frozenset(expected_seen):
            raise ValueError("superko history does not match immutable play history")
        if (
            self.black_captures != expected_black_captures
            or self.white_captures != expected_white_captures
        ):
            raise ValueError("capture counters do not match immutable history")
        if self.history and self.to_move is not self.history[-1].color.opponent:
            raise ValueError("side to move does not follow immutable history")
        trailing_passes = 0
        for move in reversed(self.history):
            if move.kind is not MoveKind.PASS:
                break
            trailing_passes += 1
        if self.result_reason is ResultReason.RESIGNATION:
            trailing_passes = 0
            for move in reversed(self.history[:-1]):
                if move.kind is not MoveKind.PASS:
                    break
                trailing_passes += 1
        if self.consecutive_passes != min(2, trailing_passes):
            raise ValueError("consecutive pass count does not match immutable history")
        if self.ko_point is not None:
            require_vertex(self.ko_point, self.size)
            if point_at(self, self.ko_point) is not None:
                raise ValueError("ko point must be empty")
        if self.phase is GamePhase.PLAYING:
            if (
                self.winner is not None
                or self.result_reason is not None
                or self.resigned_by is not None
            ):
                raise ValueError("a playing game cannot have a result")
        elif self.result_reason is ResultReason.RESIGNATION:
            if (
                self.winner is None
                or self.resigned_by is None
                or self.winner is not self.resigned_by.opponent
            ):
                raise ValueError("resignation result is inconsistent")
            if not self.history or self.history[-1].kind is not MoveKind.RESIGN:
                raise ValueError("resignation result requires a final resignation move")
        elif self.result_reason is ResultReason.TWO_PASSES:
            if self.consecutive_passes != 2 or self.resigned_by is not None:
                raise ValueError("two-pass result is inconsistent")
            if len(self.history) < 2 or any(
                move.kind is not MoveKind.PASS for move in self.history[-2:]
            ):
                raise ValueError("two-pass result requires two final pass moves")
        else:
            raise ValueError("a finished game must have a result reason")

    def stones(self, color: Color) -> tuple[Vertex, ...]:
        return tuple(
            vertex
            for vertex in all_vertices(self.size)
            if self.board[vertex_to_index(vertex, self.size)] is color
        )

    def initial_stones(self, color: Color) -> tuple[Vertex, ...]:
        return tuple(
            vertex
            for vertex in all_vertices(self.size)
            if self.initial_board[vertex_to_index(vertex, self.size)] is color
        )

    @property
    def state_token(self) -> str:
        """Bind external choices to turn, pass state, and superko history."""

        return game_state_token(self)


def board_position_hash(board: Board, size: int) -> str:
    require_board_size(size)
    if len(board) != size * size:
        raise ValueError("board length does not match board size")
    encoded = bytearray([size])
    for point in board:
        if point is None:
            encoded.append(0)
        elif point is Color.BLACK:
            encoded.append(1)
        elif point is Color.WHITE:
            encoded.append(2)
        else:
            raise ValueError("board contains an invalid point")
    return hashlib.sha256(encoded).hexdigest()


def game_state_token(state: GameState) -> str:
    superko_digest = hashlib.sha256(
        "|".join(sorted(state.seen_position_hashes)).encode()
    ).hexdigest()
    payload = (
        "weiqi-state-v1|"
        f"{state.position_hash}|{state.to_move.value}|{state.move_number}|"
        f"{state.consecutive_passes}|{state.phase.value}|{superko_digest}"
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def _empty_board(size: int) -> Board:
    return (None,) * (size * size)


def new_game(
    *,
    size: int = 9,
    komi: float = 7.5,
    to_move: Color = Color.BLACK,
    initial_black: tuple[Vertex, ...] = (),
    initial_white: tuple[Vertex, ...] = (),
    actors: GameActors | None = None,
) -> GameState:
    require_board_size(size)
    if isinstance(komi, bool) or not isinstance(komi, (int, float)):
        raise TypeError("komi must be numeric")
    black = frozenset(initial_black)
    white = frozenset(initial_white)
    if len(black) != len(initial_black) or len(white) != len(initial_white):
        raise ValueError("initial stones cannot contain duplicates")
    if black & white:
        raise ValueError("initial black and white stones cannot overlap")

    mutable: list[BoardPoint] = list(_empty_board(size))
    for color, vertices in ((Color.BLACK, black), (Color.WHITE, white)):
        for vertex in vertices:
            require_vertex(vertex, size)
            mutable[vertex_to_index(vertex, size)] = color
    board = tuple(mutable)
    position_hash = board_position_hash(board, size)
    actor_set = actors or default_game_actors()
    # Validate that both colors are controlled even if the first move is White.
    actor_set.player_for(Color.BLACK)
    actor_set.player_for(Color.WHITE)
    state = GameState(
        size=size,
        komi=float(komi),
        board=board,
        initial_board=board,
        to_move=to_move,
        move_number=0,
        black_captures=0,
        white_captures=0,
        consecutive_passes=0,
        phase=GamePhase.PLAYING,
        winner=None,
        result_reason=None,
        resigned_by=None,
        last_move=None,
        ko_point=None,
        position_hash=position_hash,
        seen_position_hashes=frozenset({position_hash}),
        history=(),
        actors=actor_set,
    )
    for group in board_groups(state):
        if not group.liberties:
            raise ValueError("initial stones cannot contain a group with no liberties")
    return state


def point_at(state: GameState, vertex: Vertex) -> BoardPoint:
    require_vertex(vertex, state.size)
    return state.board[vertex_to_index(vertex, state.size)]


def _point_at_board(board: Board | list[BoardPoint], vertex: Vertex, size: int) -> BoardPoint:
    return board[vertex_to_index(vertex, size)]


def _collect_group(board: Board | list[BoardPoint], size: int, start: Vertex) -> BoardGroup:
    color = _point_at_board(board, start, size)
    if color is None:
        raise ValueError("cannot collect a group from an empty point")
    stones: set[Vertex] = set()
    liberties: set[Vertex] = set()
    pending = [start]
    while pending:
        vertex = pending.pop()
        if vertex in stones:
            continue
        stones.add(vertex)
        for neighbor in neighbors(vertex, size):
            neighbor_color = _point_at_board(board, neighbor, size)
            if neighbor_color is None:
                liberties.add(neighbor)
            elif neighbor_color is color and neighbor not in stones:
                pending.append(neighbor)
    return BoardGroup(color, frozenset(stones), frozenset(liberties))


def group_at(state: GameState, vertex: Vertex) -> BoardGroup | None:
    if point_at(state, vertex) is None:
        return None
    return _collect_group(state.board, state.size, vertex)


def board_groups(state: GameState) -> tuple[BoardGroup, ...]:
    visited: set[Vertex] = set()
    groups: list[BoardGroup] = []
    for vertex in all_vertices(state.size):
        if vertex in visited or point_at(state, vertex) is None:
            continue
        group = _collect_group(state.board, state.size, vertex)
        visited.update(group.stones)
        groups.append(group)
    return tuple(sorted(groups, key=lambda group: (group.anchor.y, group.anchor.x)))


def _candidate_id(
    state_token: str,
    color: Color,
    kind: MoveKind,
    vertex: Vertex | None,
) -> str:
    location = "-" if vertex is None else f"{vertex.x},{vertex.y}"
    digest = hashlib.sha256(
        f"weiqi-candidate-v1|{state_token}|{color.value}|{kind.value}|{location}".encode()
    ).hexdigest()
    return f"cand_{digest[:32]}"


@dataclass(frozen=True, slots=True)
class _PlayResult:
    board: Board
    captured: tuple[Vertex, ...]
    played_group: BoardGroup
    position_hash: str
    ko_point: Vertex | None


def _simulate_play(state: GameState, vertex: Vertex) -> _PlayResult:
    if state.phase is not GamePhase.PLAYING:
        raise IllegalMoveError(IllegalMoveReason.GAME_FINISHED, "the game is already finished")
    try:
        require_vertex(vertex, state.size)
    except (TypeError, ValueError) as exc:
        raise IllegalMoveError(IllegalMoveReason.OUT_OF_BOUNDS, str(exc)) from exc
    if point_at(state, vertex) is not None:
        raise IllegalMoveError(IllegalMoveReason.OCCUPIED, "that intersection is occupied")

    board: list[BoardPoint] = list(state.board)
    board[vertex_to_index(vertex, state.size)] = state.to_move
    captured: set[Vertex] = set()
    checked_opponents: set[Vertex] = set()
    for neighbor in neighbors(vertex, state.size):
        if _point_at_board(board, neighbor, state.size) is not state.to_move.opponent:
            continue
        if neighbor in checked_opponents:
            continue
        opponent_group = _collect_group(board, state.size, neighbor)
        checked_opponents.update(opponent_group.stones)
        if not opponent_group.liberties:
            captured.update(opponent_group.stones)
            for stone in opponent_group.stones:
                board[vertex_to_index(stone, state.size)] = None

    played_group = _collect_group(board, state.size, vertex)
    if not played_group.liberties:
        raise IllegalMoveError(
            IllegalMoveReason.SUICIDE, "a move cannot leave its own group without liberties"
        )

    frozen_board = tuple(board)
    position_hash = board_position_hash(frozen_board, state.size)
    if position_hash in state.seen_position_hashes:
        raise IllegalMoveError(
            IllegalMoveReason.SUPERKO,
            "the move would repeat an earlier board position",
        )
    ordered_captured = tuple(sorted(captured, key=lambda item: (item.y, item.x)))
    ko_point = None
    if (
        len(ordered_captured) == 1
        and len(played_group.stones) == 1
        and played_group.liberties == frozenset(ordered_captured)
    ):
        ko_point = ordered_captured[0]
    return _PlayResult(frozen_board, ordered_captured, played_group, position_hash, ko_point)


def is_legal_play(state: GameState, vertex: Vertex) -> bool:
    try:
        _simulate_play(state, vertex)
    except IllegalMoveError:
        return False
    return True


def legal_vertices(state: GameState) -> tuple[Vertex, ...]:
    if state.phase is not GamePhase.PLAYING:
        return ()
    return tuple(
        vertex
        for vertex in all_vertices(state.size)
        if point_at(state, vertex) is None and is_legal_play(state, vertex)
    )


def legal_candidates(
    state: GameState,
    *,
    include_pass: bool = True,
    include_resign: bool = False,
) -> tuple[LegalCandidate, ...]:
    if state.phase is not GamePhase.PLAYING:
        return ()
    state_token = game_state_token(state)
    candidates = [
        LegalCandidate(
            id=_candidate_id(state_token, state.to_move, MoveKind.PLAY, vertex),
            state_token=state_token,
            position_hash=state.position_hash,
            color=state.to_move,
            kind=MoveKind.PLAY,
            vertex=vertex,
        )
        for vertex in legal_vertices(state)
    ]
    if include_pass:
        candidates.append(
            LegalCandidate(
                id=_candidate_id(state_token, state.to_move, MoveKind.PASS, None),
                state_token=state_token,
                position_hash=state.position_hash,
                color=state.to_move,
                kind=MoveKind.PASS,
                vertex=None,
            )
        )
    if include_resign:
        candidates.append(
            LegalCandidate(
                id=_candidate_id(state_token, state.to_move, MoveKind.RESIGN, None),
                state_token=state_token,
                position_hash=state.position_hash,
                color=state.to_move,
                kind=MoveKind.RESIGN,
                vertex=None,
            )
        )
    return tuple(candidates)


def candidate_for_action(
    state: GameState,
    kind: MoveKind,
    vertex: Vertex | None = None,
    *,
    include_resign: bool = True,
) -> LegalCandidate:
    for candidate in legal_candidates(state, include_resign=include_resign):
        if candidate.kind is kind and candidate.vertex == vertex:
            return candidate
    raise IllegalMoveError(IllegalMoveReason.INVALID_ACTION, "the requested action is not legal")


def resolve_candidate(
    state: GameState,
    candidate_id: str,
    *,
    include_resign: bool = False,
) -> LegalCandidate:
    for candidate in legal_candidates(state, include_resign=include_resign):
        if candidate.id == candidate_id:
            return candidate
    raise IllegalMoveError(
        IllegalMoveReason.UNKNOWN_CANDIDATE,
        "candidate is not in the legal set for this position",
    )


def _move_actor_id(state: GameState, actor_id: str | None) -> str:
    return actor_id or state.actors.player_for(state.to_move).id


def _append_move(
    state: GameState,
    *,
    kind: MoveKind,
    vertex: Vertex | None,
    actor_id: str,
    candidate_id: str,
    captured: tuple[Vertex, ...],
    board: Board,
    position_hash: str,
    ko_point: Vertex | None,
    phase: GamePhase,
    winner: Color | None,
    result_reason: ResultReason | None,
    resigned_by: Color | None,
    consecutive_passes: int,
) -> GameState:
    move = Move(
        number=state.move_number + 1,
        color=state.to_move,
        kind=kind,
        vertex=vertex,
        actor_id=actor_id,
        candidate_id=candidate_id,
        captured=captured,
        position_hash_before=state.position_hash,
        position_hash_after=position_hash,
    )
    black_captures = state.black_captures
    white_captures = state.white_captures
    if state.to_move is Color.BLACK:
        black_captures += len(captured)
    else:
        white_captures += len(captured)
    seen = state.seen_position_hashes
    if kind is MoveKind.PLAY:
        seen = frozenset((*seen, position_hash))
    return GameState(
        size=state.size,
        komi=state.komi,
        board=board,
        initial_board=state.initial_board,
        to_move=state.to_move.opponent,
        move_number=state.move_number + 1,
        black_captures=black_captures,
        white_captures=white_captures,
        consecutive_passes=consecutive_passes,
        phase=phase,
        winner=winner,
        result_reason=result_reason,
        resigned_by=resigned_by,
        last_move=move,
        ko_point=ko_point,
        position_hash=position_hash,
        seen_position_hashes=seen,
        history=(*state.history, move),
        actors=state.actors,
    )


def play(state: GameState, vertex: Vertex, *, actor_id: str | None = None) -> GameState:
    actor_id = _move_actor_id(state, actor_id)
    state.actors.require_turn_actor(actor_id, state.to_move)
    result = _simulate_play(state, vertex)
    candidate_id = _candidate_id(game_state_token(state), state.to_move, MoveKind.PLAY, vertex)
    return _append_move(
        state,
        kind=MoveKind.PLAY,
        vertex=vertex,
        actor_id=actor_id,
        candidate_id=candidate_id,
        captured=result.captured,
        board=result.board,
        position_hash=result.position_hash,
        ko_point=result.ko_point,
        phase=GamePhase.PLAYING,
        winner=None,
        result_reason=None,
        resigned_by=None,
        consecutive_passes=0,
    )


def pass_turn(state: GameState, *, actor_id: str | None = None) -> GameState:
    if state.phase is not GamePhase.PLAYING:
        raise IllegalMoveError(IllegalMoveReason.GAME_FINISHED, "the game is already finished")
    actor_id = _move_actor_id(state, actor_id)
    state.actors.require_turn_actor(actor_id, state.to_move)
    passes = min(2, state.consecutive_passes + 1)
    finished = passes == 2
    return _append_move(
        state,
        kind=MoveKind.PASS,
        vertex=None,
        actor_id=actor_id,
        candidate_id=_candidate_id(game_state_token(state), state.to_move, MoveKind.PASS, None),
        captured=(),
        board=state.board,
        position_hash=state.position_hash,
        ko_point=None,
        phase=GamePhase.FINISHED if finished else GamePhase.PLAYING,
        winner=None,
        result_reason=ResultReason.TWO_PASSES if finished else None,
        resigned_by=None,
        consecutive_passes=passes,
    )


def resign(state: GameState, *, actor_id: str | None = None) -> GameState:
    if state.phase is not GamePhase.PLAYING:
        raise IllegalMoveError(IllegalMoveReason.GAME_FINISHED, "the game is already finished")
    actor_id = _move_actor_id(state, actor_id)
    state.actors.require_turn_actor(actor_id, state.to_move)
    return _append_move(
        state,
        kind=MoveKind.RESIGN,
        vertex=None,
        actor_id=actor_id,
        candidate_id=_candidate_id(game_state_token(state), state.to_move, MoveKind.RESIGN, None),
        captured=(),
        board=state.board,
        position_hash=state.position_hash,
        ko_point=None,
        phase=GamePhase.FINISHED,
        winner=state.to_move.opponent,
        result_reason=ResultReason.RESIGNATION,
        resigned_by=state.to_move,
        consecutive_passes=state.consecutive_passes,
    )


def apply_candidate(
    state: GameState,
    selection: CandidateSelection,
    *,
    allow_resign: bool = False,
) -> GameState:
    if selection.state_token != game_state_token(state):
        raise IllegalMoveError(
            IllegalMoveReason.STALE_POSITION,
            "candidate selection belongs to a different position",
        )
    state.actors.require_turn_actor(selection.actor_id, state.to_move)
    candidate = resolve_candidate(state, selection.candidate_id, include_resign=allow_resign)
    if candidate.kind is MoveKind.PLAY and candidate.vertex is not None:
        return play(state, candidate.vertex, actor_id=selection.actor_id)
    if candidate.kind is MoveKind.PASS:
        return pass_turn(state, actor_id=selection.actor_id)
    if candidate.kind is MoveKind.RESIGN and allow_resign:
        return resign(state, actor_id=selection.actor_id)
    raise IllegalMoveError(IllegalMoveReason.INVALID_ACTION, "unsupported candidate action")


def describe_candidate(candidate: LegalCandidate, size: int) -> str:
    require_board_size(size)
    if candidate.kind is MoveKind.PLAY:
        assert candidate.vertex is not None
        return vertex_to_gtp(candidate.vertex, size)
    return candidate.kind.value


def replay_and_validate(state: GameState) -> GameState:
    """Replay a stored snapshot through the rules engine and require exact equality.

    Services should call this after decoding durable state. Structural
    ``GameState`` validation catches malformed fields; replay additionally
    proves every historical move was legal and every capture/hash was derived
    by this rules version.
    """

    initial_to_move = state.history[0].color if state.history else state.to_move
    replayed = new_game(
        size=state.size,
        komi=state.komi,
        to_move=initial_to_move,
        initial_black=state.initial_stones(Color.BLACK),
        initial_white=state.initial_stones(Color.WHITE),
        actors=state.actors,
    )
    for expected in state.history:
        if expected.kind is MoveKind.PLAY:
            assert expected.vertex is not None
            replayed = play(replayed, expected.vertex, actor_id=expected.actor_id)
        elif expected.kind is MoveKind.PASS:
            replayed = pass_turn(replayed, actor_id=expected.actor_id)
        elif expected.kind is MoveKind.RESIGN:
            replayed = resign(replayed, actor_id=expected.actor_id)
        else:  # pragma: no cover - MoveKind is exhaustive, protects future extensions.
            raise ValueError(f"unsupported stored move kind {expected.kind!r}")
        if replayed.last_move != expected:
            raise ValueError("stored move does not match deterministic replay")
    if replayed != state:
        raise ValueError("stored game snapshot does not match deterministic replay")
    return state
