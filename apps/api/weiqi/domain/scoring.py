"""Explainable Chinese area scoring for immutable game snapshots."""

from __future__ import annotations

from dataclasses import dataclass

from .coordinates import all_vertices, neighbors
from .core_types import Color, Vertex
from .rules import GameState, ResultReason, point_at


@dataclass(frozen=True, slots=True)
class EmptyRegion:
    points: frozenset[Vertex]
    bordering_colors: frozenset[Color]

    @property
    def owner(self) -> Color | None:
        if len(self.bordering_colors) == 1:
            return next(iter(self.bordering_colors))
        return None


@dataclass(frozen=True, slots=True)
class AreaScore:
    black_stones: int
    white_stones: int
    black_territory: int
    white_territory: int
    neutral_points: int
    komi: float
    black_total: float
    white_total: float
    winner: Color | None
    margin: float | None
    result: str
    black_owned: frozenset[Vertex]
    white_owned: frozenset[Vertex]
    neutral: frozenset[Vertex]


def empty_regions(state: GameState) -> tuple[EmptyRegion, ...]:
    visited: set[Vertex] = set()
    regions: list[EmptyRegion] = []
    for start in all_vertices(state.size):
        if start in visited or point_at(state, start) is not None:
            continue
        points: set[Vertex] = set()
        borders: set[Color] = set()
        pending = [start]
        while pending:
            vertex = pending.pop()
            if vertex in points:
                continue
            points.add(vertex)
            visited.add(vertex)
            for neighbor in neighbors(vertex, state.size):
                color = point_at(state, neighbor)
                if color is None and neighbor not in points:
                    pending.append(neighbor)
                elif color is not None:
                    borders.add(color)
        regions.append(EmptyRegion(frozenset(points), frozenset(borders)))
    return tuple(sorted(regions, key=lambda region: min(region.points)))


def chinese_area_score(state: GameState) -> AreaScore:
    black_stones_set = frozenset(state.stones(Color.BLACK))
    white_stones_set = frozenset(state.stones(Color.WHITE))
    black_territory: set[Vertex] = set()
    white_territory: set[Vertex] = set()
    neutral: set[Vertex] = set()

    for region in empty_regions(state):
        if region.owner is Color.BLACK:
            black_territory.update(region.points)
        elif region.owner is Color.WHITE:
            white_territory.update(region.points)
        else:
            neutral.update(region.points)

    black_area = len(black_stones_set) + len(black_territory)
    white_area = len(white_stones_set) + len(white_territory)
    black_total = float(black_area)
    white_total = float(white_area) + state.komi

    if state.result_reason is ResultReason.RESIGNATION:
        winner = state.winner
        margin = None
        result = f"{winner.gtp}+R" if winner is not None else "Void"
    elif black_total > white_total:
        winner = Color.BLACK
        margin = black_total - white_total
        result = f"B+{margin:g}"
    elif white_total > black_total:
        winner = Color.WHITE
        margin = white_total - black_total
        result = f"W+{margin:g}"
    else:
        winner = None
        margin = 0.0
        result = "0"

    return AreaScore(
        black_stones=len(black_stones_set),
        white_stones=len(white_stones_set),
        black_territory=len(black_territory),
        white_territory=len(white_territory),
        neutral_points=len(neutral),
        komi=state.komi,
        black_total=black_total,
        white_total=white_total,
        winner=winner,
        margin=margin,
        result=result,
        black_owned=frozenset((*black_stones_set, *black_territory)),
        white_owned=frozenset((*white_stones_set, *white_territory)),
        neutral=frozenset(neutral),
    )
