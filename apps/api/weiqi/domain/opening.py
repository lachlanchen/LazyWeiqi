"""Bounded, deterministic 19x19 opening teaching geometry.

This module deliberately keeps three kinds of evidence separate:

* the rules engine supplies exact stones, groups, liberties, and legality;
* a documented geometry heuristic supplies visual *potential* only;
* a finite authored vocabulary supplies opening and joseki teaching context.

The calculated fields are not KataGo ownership, secured territory, score,
probability, or a best-move claim.  They are intended to make the direction
and trade-offs of a legal candidate visible without granting the heuristic
any authority over play.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from functools import lru_cache
from typing import Any, Literal, TypedDict

from .coordinates import all_vertices, vertex_to_gtp
from .core_types import Color, MoveKind, Vertex
from .energy import MoveImpact, group_metrics
from .rules import GameState, IllegalMoveError, LegalCandidate, candidate_for_action, point_at

OPENING_BOARD_SIZE = 19
OPENING_SCHEMA_VERSION = 1
MAX_FIELD_CELLS = 241
MAX_CHANGE_CELLS = 160
MAX_TEACHING_DIAGRAMS = 4
MAX_DIAGRAM_STEPS = 8

Evidence = Literal["exact", "calculated_potential", "authored"]


class PointPayload(TypedDict):
    x: int
    y: int


class OpeningBinding(TypedDict):
    state_token: str
    position_hash: str
    move_number: int
    to_move: str


class OpeningLandscapePayload(TypedDict):
    schema_version: Literal[1]
    binding: OpeningBinding
    provenance: dict[str, dict[str, Any]]
    phase_id: str
    field: dict[str, Any]
    region_balance: list[dict[str, Any]]
    corner_status: list[dict[str, Any]]
    limitations_ids: list[str]


class OpeningTeachingPayload(TypedDict):
    schema_version: Literal[1]
    binding: dict[str, Any]
    provenance: dict[str, dict[str, Any]]
    role_id: str
    family_id: str
    purpose_id: str
    why_id: str
    gain_ids: list[str]
    loss_ids: list[str]
    mechanism: dict[str, Any]
    influence: dict[str, Any]
    territory: dict[str, Any]
    whole_board: dict[str, Any]
    initiative: dict[str, Any]
    follow_ups: list[dict[str, Any]]
    reply_anchors: list[dict[str, Any]]
    joseki: dict[str, Any]
    teaching_diagrams: list[dict[str, Any]]
    caution_ids: list[str]
    limitations_ids: list[str]


class _GeometryCell(TypedDict):
    point: PointPayload
    black_influence: float
    white_influence: float
    black_territory_potential: float
    white_territory_potential: float
    contested: float


def _point(vertex: Vertex) -> PointPayload:
    return {"x": vertex.x, "y": vertex.y}


def _clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def _rounded(value: float) -> float:
    rounded = round(value, 6)
    return 0.0 if rounded == -0.0 else rounded


def _provenance() -> dict[str, dict[str, Any]]:
    return {
        "rules_facts": {"evidence": "exact", "source": "deterministic_rules"},
        "geometry": {
            "evidence": "calculated_potential",
            "source": "deterministic_opening_geometry_v1",
        },
        "strategy": {
            "evidence": "authored",
            "source": "authored_opening_principles_v1",
        },
        "engine": {
            "available": False,
            "reason_id": "engine_evidence_not_attached",
        },
    }


def _binding(state: GameState) -> OpeningBinding:
    return {
        "state_token": state.state_token,
        "position_hash": state.position_hash,
        "move_number": state.move_number,
        "to_move": state.to_move.value,
    }


@lru_cache(maxsize=48)
def _geometry_field(state: GameState) -> tuple[_GeometryCell, ...]:
    """Calculate shape-aware visual potential for each intersection.

    A connected group's contribution depends on its exact size and liberties,
    then falls continuously across board geometry.  Edge proximity changes the
    *territory-potential* lane, while opposing contributions create a separate
    contested lane.  No result is fed back into the rules or move authority.
    """

    metrics = group_metrics(state)
    stone_context: list[tuple[Color, Vertex, float]] = []
    for group in metrics:
        liberty_factor = 0.7 + min(group.liberty_count, 8) * 0.045
        group_factor = 1.0 + min(max(group.size - 1, 0), 6) * 0.035
        per_stone = liberty_factor * group_factor / math.sqrt(group.size)
        for stone in group.stones:
            stone_context.append((group.color, stone, per_stone))

    cells: list[_GeometryCell] = []
    center = (state.size - 1) / 2
    for vertex in all_vertices(state.size):
        black_raw = 0.0
        white_raw = 0.0
        for color, stone, shape_weight in stone_context:
            dx = vertex.x - stone.x
            dy = vertex.y - stone.y
            distance = math.sqrt(dx * dx + dy * dy)
            contribution = math.exp(-distance / 3.15) * shape_weight
            if color is Color.BLACK:
                black_raw += contribution
            else:
                white_raw += contribution

        black = 1.0 - math.exp(-black_raw)
        white = 1.0 - math.exp(-white_raw)
        contested = 0.0
        if black + white:
            contested = _clamp(2.0 * min(black, white) / (black + white)) * min(black, white)

        nearest_edge = min(vertex.x, vertex.y, state.size - 1 - vertex.x, state.size - 1 - vertex.y)
        edge_efficiency = 1.0 - min(nearest_edge, center) / center
        edge_weight = 0.32 + 0.68 * edge_efficiency
        black_ground = black * edge_weight * (1.0 - 0.72 * white)
        white_ground = white * edge_weight * (1.0 - 0.72 * black)
        cells.append(
            {
                "point": _point(vertex),
                "black_influence": _rounded(black),
                "white_influence": _rounded(white),
                "black_territory_potential": _rounded(_clamp(black_ground)),
                "white_territory_potential": _rounded(_clamp(white_ground)),
                "contested": _rounded(_clamp(contested)),
            }
        )
    return tuple(cells)


_REGIONS: tuple[tuple[str, str, tuple[int, int, int, int]], ...] = (
    ("upper_left", "corner", (0, 0, 5, 5)),
    ("upper_side", "side", (6, 0, 12, 5)),
    ("upper_right", "corner", (13, 0, 18, 5)),
    ("left_side", "side", (0, 6, 5, 12)),
    ("center", "center", (6, 6, 12, 12)),
    ("right_side", "side", (13, 6, 18, 12)),
    ("lower_left", "corner", (0, 13, 5, 18)),
    ("lower_side", "side", (6, 13, 12, 18)),
    ("lower_right", "corner", (13, 13, 18, 18)),
)


def _in_bounds(vertex: Vertex, bounds: tuple[int, int, int, int]) -> bool:
    min_x, min_y, max_x, max_y = bounds
    return min_x <= vertex.x <= max_x and min_y <= vertex.y <= max_y


def _region_balance(state: GameState, cells: Sequence[_GeometryCell]) -> list[dict[str, Any]]:
    black_stones = set(state.stones(Color.BLACK))
    white_stones = set(state.stones(Color.WHITE))
    result: list[dict[str, Any]] = []
    for region_id, kind, bounds in _REGIONS:
        region_cells = [cell for cell in cells if _in_bounds(Vertex(**cell["point"]), bounds)]
        count = len(region_cells)
        result.append(
            {
                "region_id": region_id,
                "kind": kind,
                "bounds": {
                    "min_x": bounds[0],
                    "min_y": bounds[1],
                    "max_x": bounds[2],
                    "max_y": bounds[3],
                },
                "black_stones": sum(_in_bounds(stone, bounds) for stone in black_stones),
                "white_stones": sum(_in_bounds(stone, bounds) for stone in white_stones),
                "black_influence": _rounded(
                    sum(cell["black_influence"] for cell in region_cells) / count
                ),
                "white_influence": _rounded(
                    sum(cell["white_influence"] for cell in region_cells) / count
                ),
                "black_territory_potential": _rounded(
                    sum(cell["black_territory_potential"] for cell in region_cells) / count
                ),
                "white_territory_potential": _rounded(
                    sum(cell["white_territory_potential"] for cell in region_cells) / count
                ),
                "evidence": {
                    "stone_counts": "exact",
                    "influence_and_territory_potential": "calculated_potential",
                },
            }
        )
    return result


def _corner_status(state: GameState) -> list[dict[str, Any]]:
    corners = (
        ("upper_left", (0, 0, 6, 6)),
        ("upper_right", (12, 0, 18, 6)),
        ("lower_left", (0, 12, 6, 18)),
        ("lower_right", (12, 12, 18, 18)),
    )
    black = state.stones(Color.BLACK)
    white = state.stones(Color.WHITE)
    return [
        {
            "corner_id": corner_id,
            "black_stones": sum(_in_bounds(stone, bounds) for stone in black),
            "white_stones": sum(_in_bounds(stone, bounds) for stone in white),
            "open": not any(_in_bounds(stone, bounds) for stone in (*black, *white)),
            "evidence": "exact",
        }
        for corner_id, bounds in corners
    ]


def opening_landscape(state: GameState) -> OpeningLandscapePayload | None:
    if state.size != OPENING_BOARD_SIZE:
        return None
    cells = _geometry_field(state)
    visible = [
        cell
        for cell in cells
        if max(
            cell["black_influence"],
            cell["white_influence"],
            cell["black_territory_potential"],
            cell["white_territory_potential"],
            cell["contested"],
        )
        >= 0.012
    ]
    if len(visible) > MAX_FIELD_CELLS:
        visible = sorted(
            visible,
            key=lambda cell: (
                -max(
                    cell["black_influence"],
                    cell["white_influence"],
                    cell["black_territory_potential"],
                    cell["white_territory_potential"],
                    cell["contested"],
                ),
                cell["point"]["y"],
                cell["point"]["x"],
            ),
        )[:MAX_FIELD_CELLS]
        visible.sort(key=lambda cell: (cell["point"]["y"], cell["point"]["x"]))

    phase_id = (
        "empty_board_opening"
        if state.move_number == 0
        else "early_whole_board_opening"
        if state.move_number < 40
        else "developed_whole_board_position"
    )
    return {
        "schema_version": OPENING_SCHEMA_VERSION,
        "binding": _binding(state),
        "provenance": _provenance(),
        "phase_id": phase_id,
        "field": {
            "evidence": "calculated_potential",
            "source": "deterministic_opening_geometry_v1",
            "cells": visible,
            "cell_limit": MAX_FIELD_CELLS,
            "not_ownership": True,
            "not_secured_territory": True,
        },
        "region_balance": _region_balance(state, cells),
        "corner_status": _corner_status(state),
        "limitations_ids": [
            "potential_not_secured_territory",
            "influence_not_ownership",
            "geometry_not_best_move",
            "engine_evidence_not_attached",
        ],
    }


def _corner_id(vertex: Vertex) -> str | None:
    horizontal = "left" if vertex.x <= 5 else "right" if vertex.x >= 13 else None
    vertical = "upper" if vertex.y <= 5 else "lower" if vertex.y >= 13 else None
    return f"{vertical}_{horizontal}" if horizontal and vertical else None


def _region_id(vertex: Vertex) -> str:
    corner = _corner_id(vertex)
    if corner:
        return f"{corner}_corner"
    if vertex.y <= 5:
        return "upper_side"
    if vertex.x >= 13:
        return "right_side"
    if vertex.y >= 13:
        return "lower_side"
    if vertex.x <= 5:
        return "left_side"
    return "center"


def _family(vertex: Vertex) -> str:
    if vertex.x in {3, 15} and vertex.y in {3, 15}:
        return "corner_star_point"
    return (
        "side_development"
        if min(vertex.x, vertex.y, 18 - vertex.x, 18 - vertex.y) <= 5
        else "center_influence"
    )


def _role_purpose_why(vertex: Vertex) -> tuple[str, str, str]:
    corner = _corner_id(vertex)
    if _family(vertex) == "corner_star_point" and corner:
        return (
            f"{corner}_framework_seed",
            f"claim_{corner}_with_two_open_directions",
            "fourth_line_balances_corner_access_and_outward_reach",
        )
    line = min(vertex.x, vertex.y, 18 - vertex.x, 18 - vertex.y) + 1
    if corner:
        why_id = (
            "third_line_emphasizes_corner_ground"
            if line <= 3
            else "high_corner_move_emphasizes_outward_reach"
            if line >= 5
            else "corner_move_keeps_adjacent_sides_available"
        )
        return (
            "corner_development",
            "develop_corner_with_two_open_directions",
            why_id,
        )
    if _family(vertex) == "side_development":
        return (
            "side_development_point",
            "develop_side_with_outward_connection",
            "side_point_links_local_shape_to_open_direction",
        )
    return (
        "center_influence_probe",
        "build_center_facing_flexibility",
        "center_point_offers_reach_but_little_immediate_ground",
    )


def _side_ids(vertex: Vertex) -> list[str]:
    sides: list[str] = []
    if vertex.y <= 5:
        sides.append("top_side_option")
    if vertex.x >= 13:
        sides.append("right_side_option")
    if vertex.y >= 13:
        sides.append("bottom_side_option")
    if vertex.x <= 5:
        sides.append("left_side_option")
    return sides


def _gain_loss_ids(vertex: Vertex) -> tuple[list[str], list[str]]:
    family = _family(vertex)
    if family == "corner_star_point":
        corner = _corner_id(vertex)
        assert corner is not None
        return (
            ["corner_entry", *_side_ids(vertex), "central_reach"],
            [
                "corner_not_secured",
                "opponent_keeps_approach_choice",
                f"{corner}_plan_can_be_reduced_from_two_sides",
            ],
        )
    if family == "side_development":
        return (
            ["side_framework_option", "connection_option", "central_reach"],
            ["less_immediate_corner_efficiency", "can_become_overconcentrated"],
        )
    return (
        ["central_reach", "multi_direction_option"],
        ["little_immediate_edge_efficiency", "can_become_overconcentrated"],
    )


def _valid_empty(state: GameState, x: int, y: int) -> Vertex | None:
    if not 0 <= x < state.size or not 0 <= y < state.size:
        return None
    vertex = Vertex(x, y)
    return vertex if point_at(state, vertex) is None else None


def _anchor(
    vertex: Vertex,
    *,
    size: int,
    label_id: str,
    role: str,
    reason_id: str,
    timing_id: str,
) -> dict[str, Any]:
    return {
        "label_id": label_id,
        "point": _point(vertex),
        "coordinate": vertex_to_gtp(vertex, size),
        "role": role,
        "reason_id": reason_id,
        "timing_id": timing_id,
        "evidence": "authored",
    }


def _anchors(
    state: GameState, after: GameState, vertex: Vertex
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    center = 9
    horizontal_in = 1 if vertex.x < center else -1 if vertex.x > center else 0
    vertical_in = 1 if vertex.y < center else -1 if vertex.y > center else 0
    follow_specs: list[tuple[int, int, str]] = []
    reply_specs: list[tuple[int, int, str]] = []
    corner = _corner_id(vertex)
    if corner:
        if horizontal_in:
            follow_specs.append(
                (center, vertex.y, "extend_top" if vertex.y < center else "extend_bottom")
            )
        if vertical_in:
            follow_specs.append(
                (vertex.x, center, "extend_left" if vertex.x < center else "extend_right")
            )
        reply_specs.extend(
            [
                (vertex.x + 2 * horizontal_in, vertex.y - vertical_in, "opponent_approach"),
                (vertex.x - horizontal_in, vertex.y + 2 * vertical_in, "opponent_approach"),
            ]
        )
    elif _family(vertex) == "side_development":
        if vertex.y <= 5 or vertex.y >= 13:
            follow_specs.extend(
                [
                    (max(0, vertex.x - 5), vertex.y, "extend_left"),
                    (min(18, vertex.x + 5), vertex.y, "extend_right"),
                ]
            )
            reply_specs.append((vertex.x, vertex.y + 3 * vertical_in, "local_reply"))
        else:
            follow_specs.extend(
                [
                    (vertex.x, max(0, vertex.y - 5), "extend_top"),
                    (vertex.x, min(18, vertex.y + 5), "extend_bottom"),
                ]
            )
            reply_specs.append((vertex.x + 3 * horizontal_in, vertex.y, "local_reply"))
    else:
        follow_specs.extend(
            [
                (max(0, vertex.x - 4), vertex.y, "extend_left"),
                (min(18, vertex.x + 4), vertex.y, "extend_right"),
            ]
        )
        reply_specs.extend(
            [
                (vertex.x, max(0, vertex.y - 4), "local_reply"),
                (vertex.x, min(18, vertex.y + 4), "local_reply"),
            ]
        )

    follow: list[dict[str, Any]] = []
    for x, y, label_id in follow_specs:
        point = _valid_empty(after, x, y)
        if (
            point is None
            or point == vertex
            or any(item["point"] == _point(point) for item in follow)
        ):
            continue
        authored_follow = _anchor(
            point,
            size=state.size,
            label_id=label_id,
            role="extension" if label_id.startswith("extend") else "direction",
            reason_id="extend_along_open_side",
            timing_id="future_big_point",
        )
        # A future anchor is an authored planning landmark, not a claim that
        # the point is legal in the immediate child position or will remain
        # legal after the opponent's intervening move.
        authored_follow["legality_scope"] = "authored_future_not_current_legality"
        authored_follow["current_legality_checked"] = False
        follow.append(authored_follow)
        if len(follow) == 2:
            break

    replies: list[dict[str, Any]] = []
    for x, y, label_id in reply_specs:
        point = _valid_empty(after, x, y)
        if (
            point is None
            or point == vertex
            or any(item["point"] == _point(point) for item in replies)
        ):
            continue
        try:
            # Resolve the exact action candidate in the rules engine. This is
            # equivalent to intersecting the authored anchors with the legal
            # PLAY candidate set for `after`, without enumerating all 361
            # points merely to validate at most two anchors.
            candidate_for_action(after, MoveKind.PLAY, point)
        except IllegalMoveError:
            continue
        role = "approach" if label_id == "opponent_approach" else "reply"
        legal_reply = _anchor(
            point,
            size=state.size,
            label_id=label_id,
            role=role,
            reason_id=(
                "approach_tests_corner_response"
                if role == "approach"
                else "reply_preserves_local_options"
            ),
            timing_id="opponent_reply_space",
        )
        legal_reply["legality_scope"] = "immediate_opponent_response"
        legal_reply["current_legality_checked"] = True
        replies.append(legal_reply)
        if len(replies) == 2:
            break
    return follow, replies


def _vector(vertex: Vertex, to: Vertex, strength: float, direction_id: str) -> dict[str, Any]:
    return {
        "from": _point(vertex),
        "to": _point(to),
        "strength": strength,
        "direction_id": direction_id,
    }


def _vectors_and_regions(vertex: Vertex) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    center = Vertex(9, 9)
    vectors: list[dict[str, Any]] = []
    region_id = _region_id(vertex)
    if vertex.y <= 5:
        vectors.append(_vector(vertex, Vertex(9, vertex.y), 0.76, "along_top"))
    if vertex.x >= 13:
        vectors.append(_vector(vertex, Vertex(vertex.x, 9), 0.76, "along_right"))
    if vertex.y >= 13:
        vectors.append(_vector(vertex, Vertex(9, vertex.y), 0.76, "along_bottom"))
    if vertex.x <= 5:
        vectors.append(_vector(vertex, Vertex(vertex.x, 9), 0.76, "along_left"))
    if vertex != center:
        dx = center.x - vertex.x
        dy = center.y - vertex.y
        length = max(abs(dx), abs(dy), 1)
        step = min(5, length)
        inward = Vertex(
            vertex.x + round(dx * step / length),
            vertex.y + round(dy * step / length),
        )
        vectors.append(_vector(vertex, inward, 0.58, "toward_center"))
    vectors = vectors[:3]
    regions = [
        {
            "center": _point(vertex),
            "radius": 3,
            "strength": 0.82 if _family(vertex) == "corner_star_point" else 0.68,
            "direction_id": "inward",
            "region_id": region_id,
        }
    ]
    for vector in vectors[:2]:
        destination = Vertex(**vector["to"])
        regions.append(
            {
                "center": _point(destination),
                "radius": 4,
                "strength": _rounded(float(vector["strength"]) * 0.72),
                "direction_id": vector["direction_id"],
                "region_id": _region_id(destination),
            }
        )
    return vectors, regions


def _change_cells(state: GameState, after: GameState) -> list[dict[str, Any]]:
    before_field = _geometry_field(state)
    after_field = _geometry_field(after)
    mover = state.to_move
    changes: list[dict[str, Any]] = []
    for before, child in zip(before_field, after_field, strict=True):
        before_influence = (
            before["black_influence"] - before["white_influence"]
            if mover is Color.BLACK
            else before["white_influence"] - before["black_influence"]
        )
        after_influence = (
            child["black_influence"] - child["white_influence"]
            if mover is Color.BLACK
            else child["white_influence"] - child["black_influence"]
        )
        before_ground = (
            before["black_territory_potential"] - before["white_territory_potential"]
            if mover is Color.BLACK
            else before["white_territory_potential"] - before["black_territory_potential"]
        )
        after_ground = (
            child["black_territory_potential"] - child["white_territory_potential"]
            if mover is Color.BLACK
            else child["white_territory_potential"] - child["black_territory_potential"]
        )
        influence_delta = _rounded(_clamp(after_influence - before_influence, -1.0, 1.0))
        territory_delta = _rounded(_clamp(after_ground - before_ground, -1.0, 1.0))
        if max(abs(influence_delta), abs(territory_delta)) < 0.012:
            continue
        changes.append(
            {
                "point": before["point"],
                "influence_delta": influence_delta,
                "territory_potential_delta": territory_delta,
            }
        )
    if len(changes) > MAX_CHANGE_CELLS:
        changes = sorted(
            changes,
            key=lambda cell: (
                -max(abs(cell["influence_delta"]), abs(cell["territory_potential_delta"])),
                cell["point"]["y"],
                cell["point"]["x"],
            ),
        )[:MAX_CHANGE_CELLS]
        changes.sort(key=lambda cell: (cell["point"]["y"], cell["point"]["x"]))
    return changes


def _territory_zones(vertex: Vertex) -> list[dict[str, Any]]:
    family = _family(vertex)
    corner = _corner_id(vertex)
    zones: list[dict[str, Any]] = []
    if corner:
        center_x = 3 if vertex.x < 9 else 15
        center_y = 3 if vertex.y < 9 else 15
        zones.append(
            {
                "kind": "corner",
                "center": {"x": center_x, "y": center_y},
                "radius": 3,
                "potential": "efficient" if family == "corner_star_point" else "developing",
            }
        )
        zones.extend(
            {
                "kind": "side",
                "center": vector["to"],
                "radius": 3,
                "potential": "developing",
            }
            for vector in _vectors_and_regions(vertex)[0][:2]
        )
    elif family == "side_development":
        zones.append(
            {
                "kind": "side",
                "center": _point(vertex),
                "radius": 4,
                "potential": "developing",
            }
        )
    else:
        zones.append(
            {
                "kind": "center",
                "center": _point(vertex),
                "radius": 4,
                "potential": "open",
            }
        )
    return zones[:3]


def _balance_effect_id(vertex: Vertex) -> str:
    corner = _corner_id(vertex)
    if corner:
        return f"adds_{corner}_option"
    return "adds_local_option_without_settling_board"


def _shape_after_id(vertex: Vertex) -> str:
    directions = {
        (3, 3): "upper_left_seed_projects_right_and_down",
        (15, 3): "upper_right_seed_projects_left_and_down",
        (3, 15): "lower_left_seed_projects_right_and_up",
        (15, 15): "lower_right_seed_projects_left_and_up",
    }
    return directions.get((vertex.x, vertex.y), "local_shape_extends_toward_open_space")


def _crop(vertex: Vertex, radius: int, size: int) -> dict[str, int]:
    return {
        "min_x": max(0, vertex.x - radius),
        "min_y": max(0, vertex.y - radius),
        "max_x": min(size - 1, vertex.x + radius),
        "max_y": min(size - 1, vertex.y + radius),
    }


def _diagram_stones(state: GameState, crop: dict[str, int]) -> list[dict[str, Any]]:
    stones: list[dict[str, Any]] = []
    for color in (Color.BLACK, Color.WHITE):
        for stone in state.stones(color):
            if (
                crop["min_x"] <= stone.x <= crop["max_x"]
                and crop["min_y"] <= stone.y <= crop["max_y"]
            ):
                stones.append({"point": _point(stone), "color": color.value})
    return stones


def _diagrams(
    state: GameState,
    vertex: Vertex,
    follow: list[dict[str, Any]],
    replies: list[dict[str, Any]],
    gains: list[str],
    losses: list[str],
) -> list[dict[str, Any]]:
    diagrams: list[dict[str, Any]] = []
    specs = [
        ("local_shape", _crop(vertex, 4, state.size), []),
        (
            "whole_board_direction",
            {"min_x": 0, "min_y": 0, "max_x": state.size - 1, "max_y": state.size - 1},
            follow,
        ),
    ]
    if _corner_id(vertex):
        specs.append(("corner_sequence", _crop(vertex, 6, state.size), [*follow, *replies]))
    if replies:
        specs.append(("reply_branch", _crop(vertex, 6, state.size), replies))

    for diagram_type, crop, anchors in specs[:MAX_TEACHING_DIAGRAMS]:
        steps = []
        for order, anchor in enumerate(anchors[:MAX_DIAGRAM_STEPS], start=1):
            steps.append(
                {
                    "order": order,
                    "kind": anchor["role"],
                    "label_id": anchor["label_id"],
                    "point": anchor["point"],
                    "coordinate": anchor["coordinate"],
                    "why_id": anchor["reason_id"],
                    "gain_id": gains[(order - 1) % len(gains)],
                    "loss_id": losses[(order - 1) % len(losses)],
                    "evidence": "authored",
                }
            )
        diagrams.append(
            {
                "diagram_type": diagram_type,
                "crop": crop,
                "verified_current_stones": _diagram_stones(state, crop),
                "candidate": {"point": _point(vertex), "color": state.to_move.value},
                "steps": steps,
                "line_kind": "authored_context",
                "not_forced": True,
            }
        )
    return diagrams


def opening_candidate_priority(state: GameState, candidate: LegalCandidate) -> float:
    """Prefer canonical whole-board anchors only in ordinary 19x19 openings."""

    if state.size != OPENING_BOARD_SIZE or candidate.vertex is None or state.move_number >= 60:
        return 0.0
    if any(group.liberty_count <= 2 for group in group_metrics(state)):
        # Once an exact low-liberty group exists, the ordinary tactical scorer
        # must speak first; a whole-board opening anchor may not drown it out.
        return 0.0
    anchors = (
        Vertex(3, 3),
        Vertex(15, 3),
        Vertex(3, 15),
        Vertex(15, 15),
        Vertex(9, 3),
        Vertex(15, 9),
        Vertex(9, 15),
        Vertex(3, 9),
        Vertex(9, 9),
    )
    try:
        rank = anchors.index(candidate.vertex)
    except ValueError:
        return 0.0
    return 700.0 - rank * 8.0


def opening_teaching(
    state: GameState,
    candidate: LegalCandidate,
    public_candidate_id: str,
    after: GameState,
    impact: MoveImpact,
) -> OpeningTeachingPayload | None:
    if state.size != OPENING_BOARD_SIZE or candidate.vertex is None:
        return None
    vertex = candidate.vertex
    role_id, purpose_id, why_id = _role_purpose_why(vertex)
    family_id = _family(vertex)
    gains, losses = _gain_loss_ids(vertex)
    follow, replies = _anchors(state, after, vertex)
    vectors, regions = _vectors_and_regions(vertex)
    open_corners = sum(item["open"] for item in _corner_status(after))
    line = min(vertex.x, vertex.y, 18 - vertex.x, 18 - vertex.y) + 1
    exact = {
        "region_id": _region_id(vertex),
        "line_from_nearest_edge": line,
        "resulting_liberties": impact.self_liberties,
        "resulting_group_size": impact.self_group_size,
        "connections": impact.friendly_groups_joined,
    }
    reconsider = [
        "nearby_contact_makes_local_reply_urgent",
        "weak_group_makes_global_plan_secondary",
        "opponent_stone_reduces_planned_direction",
    ]
    if impact.self_liberties <= 2:
        reconsider.insert(0, "low_liberty_group_requires_immediate_reading")
    thickness_id = (
        "developing_shape_not_confirmed_thick"
        if impact.self_group_size >= 3 and impact.self_liberties >= 5
        else "connected_shape_not_yet_thick"
        if impact.self_group_size >= 2
        else "single_stone_not_thick"
    )
    weakness_ids = ["can_be_approached_from_open_side"]
    if impact.self_liberties <= 2:
        weakness_ids.insert(0, "low_liberties_are_urgent")
    initiative_id = (
        "local_tactical_reply_may_be_urgent_not_forced"
        if impact.newly_atari_opponent_groups or impact.captured
        else "open_board_not_forced"
    )
    joseki_relation = (
        "entry_point"
        if family_id == "corner_star_point"
        else "context"
        if _corner_id(vertex)
        else "not_applicable"
    )
    joseki_note_id = (
        "star_point_can_begin_joseki_context"
        if joseki_relation == "entry_point"
        else "joseki_depends_on_nearby_stones_and_direction"
        if joseki_relation == "context"
        else "not_a_joseki_position"
    )
    candidate_binding: dict[str, Any] = _binding(state)
    candidate_binding["candidate_id"] = public_candidate_id
    return {
        "schema_version": OPENING_SCHEMA_VERSION,
        "binding": candidate_binding,
        "provenance": _provenance(),
        "role_id": role_id,
        "family_id": family_id,
        "purpose_id": purpose_id,
        "why_id": why_id,
        "gain_ids": gains,
        "loss_ids": losses,
        "mechanism": {
            "fact_ids": [
                "stone_has_exact_resulting_liberties",
                "geometry_spreads_toward_open_lines",
                "two_open_development_directions"
                if _corner_id(vertex)
                else "local_direction_depends_on_nearby_stones",
            ],
            "exact": exact,
            "before_shape_id": (
                "empty_board_uncommitted"
                if not state.stones(Color.BLACK) and not state.stones(Color.WHITE)
                else "current_shape_before_candidate"
            ),
            "after_shape_id": _shape_after_id(vertex),
            "reconsider_condition_ids": reconsider,
            "shape_assessment": {
                "evidence": "calculated_potential",
                "thickness_id": thickness_id,
                "weakness_ids": weakness_ids,
            },
        },
        "influence": {
            "evidence": "calculated_potential",
            "source": "deterministic_opening_geometry_v1",
            "vectors": vectors,
            "regions": regions,
            "change_cells": _change_cells(state, after),
            "not_ownership": True,
        },
        "territory": {
            "evidence": "calculated_potential",
            "zones": _territory_zones(vertex),
            "note_id": "potential_only_requires_boundaries",
            "not_secured": True,
        },
        "whole_board": {
            "evidence": "calculated_potential",
            "balance_effect_id": _balance_effect_id(vertex),
            "open_corners": open_corners,
        },
        "initiative": {
            "evidence": "authored",
            "sente_status_id": initiative_id,
            "not_forced": True,
        },
        "follow_ups": follow,
        "reply_anchors": replies,
        "joseki": {
            "term": "Joseki",
            "original": "定式",
            "relation": joseki_relation,
            "note_id": joseki_note_id,
            "evidence": "authored",
            "guaranteed_sequence": False,
        },
        "teaching_diagrams": _diagrams(state, vertex, follow, replies, gains, losses),
        "caution_ids": [
            "potential_not_secured_territory",
            "influence_not_ownership",
            "authored_context_not_best_move",
            "joseki_not_forced_sequence",
        ],
        "limitations_ids": [
            "engine_evidence_not_attached",
            "calculated_geometry_not_engine_reading",
        ],
    }
