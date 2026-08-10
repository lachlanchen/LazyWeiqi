"""Transparent teaching metrics for groups, influence, tension, and move impact.

"Energy" in this module is explicitly a visual metaphor. It is computed from
stones, distance, groups, and liberties; it is not a hidden rule, a claim about
physics, or a replacement for KataGo ownership analysis.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .coordinates import all_vertices, neighbors, vertex_to_index
from .core_types import Color, Vertex, require_vertex
from .rules import GameState, MoveKind, board_groups, group_at, point_at

ENERGY_DISCLAIMER = (
    "Presence and tension are deterministic teaching metaphors derived from stone distance "
    "and liberties; they are not territory, score, or physical energy."
)


class GroupSafety(str, Enum):
    ATARI = "atari"
    FRAGILE = "fragile"
    DEVELOPING = "developing"
    FLEXIBLE = "flexible"


@dataclass(frozen=True, slots=True)
class GroupMetric:
    color: Color
    anchor: Vertex
    stones: tuple[Vertex, ...]
    liberties: tuple[Vertex, ...]
    size: int
    liberty_count: int
    safety: GroupSafety


@dataclass(frozen=True, slots=True)
class EnergyPoint:
    vertex: Vertex
    presence: float
    black_pressure: float
    white_pressure: float
    tension: float


@dataclass(frozen=True, slots=True)
class PositionEnergy:
    size: int
    points: tuple[EnergyPoint, ...]
    groups: tuple[GroupMetric, ...]
    urgent_vertices: tuple[Vertex, ...]
    black_presence: float
    white_presence: float
    disclaimer: str = ENERGY_DISCLAIMER

    def point(self, vertex: Vertex) -> EnergyPoint:
        require_vertex(vertex, self.size)
        return self.points[vertex_to_index(vertex, self.size)]


@dataclass(frozen=True, slots=True)
class MoveImpact:
    color: Color
    kind: MoveKind
    vertex: Vertex | None
    captured: tuple[Vertex, ...]
    self_group_size: int
    self_liberties: int
    friendly_groups_joined: int
    escaped_atari_groups: int
    newly_atari_opponent_groups: int
    mean_presence_change: float
    mean_tension_change: float
    teaching_tags: tuple[str, ...]


def _safety(liberties: int) -> GroupSafety:
    if liberties <= 1:
        return GroupSafety.ATARI
    if liberties == 2:
        return GroupSafety.FRAGILE
    if liberties == 3:
        return GroupSafety.DEVELOPING
    return GroupSafety.FLEXIBLE


def group_metrics(state: GameState) -> tuple[GroupMetric, ...]:
    metrics = []
    for group in board_groups(state):
        stones = tuple(sorted(group.stones, key=lambda vertex: (vertex.y, vertex.x)))
        liberties = tuple(sorted(group.liberties, key=lambda vertex: (vertex.y, vertex.x)))
        metrics.append(
            GroupMetric(
                color=group.color,
                anchor=stones[0],
                stones=stones,
                liberties=liberties,
                size=len(stones),
                liberty_count=len(liberties),
                safety=_safety(len(liberties)),
            )
        )
    return tuple(metrics)


def analyze_energy(state: GameState, *, distance_decay: float = 0.58) -> PositionEnergy:
    if not 0 < distance_decay < 1:
        raise ValueError("distance decay must be between zero and one")
    black_stones = state.stones(Color.BLACK)
    white_stones = state.stones(Color.WHITE)
    groups = group_metrics(state)
    urgency: dict[Vertex, float] = {}
    urgent_vertices: set[Vertex] = set()
    for group in groups:
        if group.liberty_count > 2:
            continue
        weight = 1.0 if group.liberty_count == 1 else 0.7
        for vertex in (*group.stones, *group.liberties):
            urgency[vertex] = max(urgency.get(vertex, 0.0), weight)
            urgent_vertices.add(vertex)

    points: list[EnergyPoint] = []
    for vertex in all_vertices(state.size):
        black_pressure = sum(
            distance_decay ** (abs(vertex.x - stone.x) + abs(vertex.y - stone.y))
            for stone in black_stones
        )
        white_pressure = sum(
            distance_decay ** (abs(vertex.x - stone.x) + abs(vertex.y - stone.y))
            for stone in white_stones
        )
        total = black_pressure + white_pressure
        presence = (
            0.0 if total == 0 else ((black_pressure - white_pressure) / total) * min(1.0, total)
        )
        contested = 0.0
        if total > 0:
            balance = 2 * min(black_pressure, white_pressure) / total
            strength = min(1.0, total / 1.4)
            contested = balance * strength
        tension = max(contested, urgency.get(vertex, 0.0))
        points.append(
            EnergyPoint(
                vertex=vertex,
                presence=round(max(-1.0, min(1.0, presence)), 6),
                black_pressure=round(black_pressure, 6),
                white_pressure=round(white_pressure, 6),
                tension=round(max(0.0, min(1.0, tension)), 6),
            )
        )

    black_presence = sum(max(0.0, point.presence) for point in points)
    white_presence = sum(max(0.0, -point.presence) for point in points)
    return PositionEnergy(
        size=state.size,
        points=tuple(points),
        groups=groups,
        urgent_vertices=tuple(sorted(urgent_vertices, key=lambda vertex: (vertex.y, vertex.x))),
        black_presence=round(black_presence, 6),
        white_presence=round(white_presence, 6),
    )


def explain_move_impact(before: GameState, after: GameState) -> MoveImpact:
    if after.move_number != before.move_number + 1 or after.history[:-1] != before.history:
        raise ValueError("after state must be the direct immutable child of before state")
    move = after.last_move
    assert move is not None
    if move.position_hash_before != before.position_hash:
        raise ValueError("move is not bound to the before position")

    if move.kind is not MoveKind.PLAY or move.vertex is None:
        return MoveImpact(
            color=move.color,
            kind=move.kind,
            vertex=None,
            captured=move.captured,
            self_group_size=0,
            self_liberties=0,
            friendly_groups_joined=0,
            escaped_atari_groups=0,
            newly_atari_opponent_groups=0,
            mean_presence_change=0.0,
            mean_tension_change=0.0,
            teaching_tags=(move.kind.value,),
        )

    adjacent_friendly_before = []
    seen_friendly: set[Vertex] = set()
    escaped_atari = 0
    for neighbor in neighbors(move.vertex, before.size):
        if point_at(before, neighbor) is not move.color or neighbor in seen_friendly:
            continue
        group = group_at(before, neighbor)
        assert group is not None
        seen_friendly.update(group.stones)
        adjacent_friendly_before.append(group)
        if group.in_atari:
            escaped_atari += 1

    played_group = group_at(after, move.vertex)
    assert played_group is not None
    if len(played_group.liberties) <= 1:
        # A capturing move can legally finish with one liberty, but an adjacent
        # prior group did not meaningfully escape if the result is still atari.
        escaped_atari = 0

    before_atari = sum(
        group.in_atari for group in board_groups(before) if group.color is move.color.opponent
    )
    after_atari = sum(
        group.in_atari for group in board_groups(after) if group.color is move.color.opponent
    )
    newly_atari = max(0, after_atari - before_atari)

    before_energy = analyze_energy(before)
    after_energy = analyze_energy(after)
    count = before.size * before.size
    presence_change = (
        sum(
            abs(after_point.presence - before_point.presence)
            for before_point, after_point in zip(
                before_energy.points, after_energy.points, strict=True
            )
        )
        / count
    )
    tension_change = (
        sum(
            after_point.tension - before_point.tension
            for before_point, after_point in zip(
                before_energy.points, after_energy.points, strict=True
            )
        )
        / count
    )

    tags: list[str] = []
    if move.captured:
        tags.append("capture")
    if len(adjacent_friendly_before) >= 2:
        tags.append("connect")
    if escaped_atari:
        tags.append("escape")
    if newly_atari:
        tags.append("atari")
    if len(played_group.liberties) == 1:
        tags.append("self-atari-risk")
    elif len(played_group.liberties) >= 3:
        tags.append("build-liberties")
    if not tags:
        tags.append("develop")

    return MoveImpact(
        color=move.color,
        kind=move.kind,
        vertex=move.vertex,
        captured=move.captured,
        self_group_size=len(played_group.stones),
        self_liberties=len(played_group.liberties),
        friendly_groups_joined=(
            len(adjacent_friendly_before) if len(adjacent_friendly_before) >= 2 else 0
        ),
        escaped_atari_groups=escaped_atari,
        newly_atari_opponent_groups=newly_atari,
        mean_presence_change=round(presence_change, 6),
        mean_tension_change=round(tension_change, 6),
        teaching_tags=tuple(tags),
    )
