"""Bounded, provenance-preserving evidence for model-assisted teaching.

The browser needs dense board fields for visualization.  A language model does
not: sending hundreds of cells obscures the teaching question and can exceed
the provider envelope.  This module projects only the state-bound facts and
finite teaching IDs needed to explain *why*, trade-offs, responses, and next
steps.  It never creates legal moves or diagram stones.
"""

from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

from ..domain import Color, GamePhase, GameState, MoveKind, analyze_energy, vertex_to_gtp

MODEL_EVIDENCE_MAX_BYTES = 22_000
MODEL_GROUP_DETAIL_LIMIT = 48
MODEL_REVIEW_TIMELINE_LIMIT = 32

CURRICULUM_PATH: tuple[str, ...] = (
    "rules",
    "life_and_death",
    "tesuji",
    "shape",
    "joseki",
    "fuseki",
    "middle_game",
    "endgame",
    "positional_judgment",
    "game_review",
)


def teaching_focus(state: GameState, *, deep_study: bool) -> dict[str, Any]:
    """Select a deterministic teaching phase without claiming strategic truth.

    The phase only organizes an explanation.  Exact urgency comes from group
    liberties; broad opening/endgame boundaries are explicitly pedagogical
    heuristics and do not affect rules, candidate order, or scoring.
    """

    energy = analyze_energy(state)
    groups_in_atari = sum(group.liberty_count == 1 for group in energy.groups)
    fragile_groups = sum(group.liberty_count == 2 for group in energy.groups)
    black_stones = len(state.stones(Color.BLACK))
    white_stones = len(state.stones(Color.WHITE))
    empty_points = state.size * state.size - black_stones - white_stones
    empty_ratio = empty_points / (state.size * state.size)
    opening_limit = 60 if state.size == 19 else max(10, state.size * 2)
    endgame_move = 240 if state.size == 19 else max(35, state.size * state.size * 2 // 3)

    if state.phase is GamePhase.FINISHED:
        primary = "game_review"
        supporting = ["positional_judgment", "endgame"]
        reason_id = "finished_position_review"
    elif groups_in_atari:
        primary = "life_and_death"
        supporting = ["tesuji", "shape", "middle_game"]
        reason_id = "exact_atari_requires_local_reading"
    elif state.move_number < opening_limit:
        primary = "fuseki" if state.size >= 9 else "shape"
        supporting = ["joseki", "shape", "positional_judgment"]
        reason_id = "early_position_links_local_shape_to_whole_board_direction"
    elif fragile_groups:
        primary = "tesuji"
        supporting = ["life_and_death", "shape", "middle_game"]
        reason_id = "fragile_groups_make_tactical_reading_relevant"
    elif state.move_number >= endgame_move or empty_ratio <= 0.28:
        primary = "endgame"
        supporting = ["positional_judgment", "game_review"]
        reason_id = "late_position_needs_value_and_boundary_comparison"
    else:
        primary = "middle_game"
        supporting = ["shape", "positional_judgment", "tesuji"]
        reason_id = "developed_position_links_local_fights_to_whole_board_value"

    return {
        "curriculum_path": list(CURRICULUM_PATH),
        "primary": primary,
        "supporting": supporting,
        "reason_id": reason_id,
        "study_depth": "deep" if deep_study else "standard",
        "pedagogical_phase_only": True,
        "position_signals": {
            "move_number": state.move_number,
            "empty_points": empty_points,
            "groups_in_atari": groups_in_atari,
            "groups_with_two_liberties": fragile_groups,
            "finished": state.phase is GamePhase.FINISHED,
            "evidence": "exact",
        },
        "required_explanation": [
            "why_now",
            "mechanism_before_and_after",
            "gain",
            "tradeoff_or_loss",
            "opponent_response_space",
            "subsequent_steps",
            "reconsider_condition",
            "transferable_principle",
        ],
    }


def _opening_projection(value: object) -> dict[str, Any] | None:
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        return None
    mechanism = value.get("mechanism")
    influence = value.get("influence")
    territory = value.get("territory")
    diagrams = value.get("teaching_diagrams")
    projected_diagrams: list[dict[str, Any]] = []
    for diagram in diagrams if isinstance(diagrams, list) else []:
        if not isinstance(diagram, dict):
            continue
        steps: list[dict[str, Any]] = []
        raw_steps = diagram.get("steps")
        for step in raw_steps[:8] if isinstance(raw_steps, list) else []:
            if not isinstance(step, dict):
                continue
            steps.append(
                {
                    key: step.get(key)
                    for key in (
                        "order",
                        "kind",
                        "label_id",
                        "coordinate",
                        "why_id",
                        "gain_id",
                        "loss_id",
                        "evidence",
                    )
                }
            )
        projected_diagrams.append(
            {
                "diagram_type": diagram.get("diagram_type"),
                "line_kind": diagram.get("line_kind"),
                "not_forced": diagram.get("not_forced"),
                "steps": steps,
                # Stones and coordinates for the rendered diagram remain owned
                # by deterministic code; the model receives no drawing task.
                "rendered_from_verified_board_data": True,
            }
        )
        if len(projected_diagrams) == 4:
            break

    projected: dict[str, Any] = {
        key: value.get(key)
        for key in (
            "schema_version",
            "role_id",
            "family_id",
            "purpose_id",
            "why_id",
            "gain_ids",
            "loss_ids",
            "whole_board",
            "initiative",
            "follow_ups",
            "reply_anchors",
            "joseki",
            "caution_ids",
            "limitations_ids",
        )
    }
    binding = value.get("binding")
    if isinstance(binding, dict):
        projected["binding"] = {
            key: binding.get(key) for key in ("move_number", "to_move", "candidate_id")
        }
    provenance = value.get("provenance")
    if isinstance(provenance, dict):
        projected["provenance"] = provenance
    if isinstance(mechanism, dict):
        projected["mechanism"] = {
            key: mechanism.get(key)
            for key in (
                "fact_ids",
                "exact",
                "before_shape_id",
                "after_shape_id",
                "reconsider_condition_ids",
                "shape_assessment",
            )
        }
    if isinstance(influence, dict):
        projected["influence"] = {
            key: influence.get(key)
            for key in ("evidence", "source", "vectors", "regions", "not_ownership")
        }
    if isinstance(territory, dict):
        projected["territory"] = {
            key: territory.get(key) for key in ("evidence", "zones", "note_id", "not_secured")
        }
    projected["teaching_diagrams"] = projected_diagrams
    return projected


def _tactics_projection(value: object) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    projected = {
        key: value.get(key)
        for key in (
            "resulting_liberties",
            "resulting_group_size",
            "friendly_groups_joined",
            "opponent_groups_newly_in_atari",
            "friendly_groups_escaped_atari",
            "self_atari",
            "ends_play",
            "evidence",
        )
        if key in value
    }
    for key in ("captures", "connects", "cuts"):
        raw = value.get(key)
        if not isinstance(raw, list):
            continue
        limit = 16 if key == "captures" else 8
        projected[key] = raw[:limit]
        projected[f"{key}_count"] = len(raw)
        if len(raw) > limit:
            projected[f"{key}_omitted"] = len(raw) - limit
    return projected


def candidate_model_evidence(public: dict[str, Any]) -> dict[str, Any]:
    """Return a bounded candidate record for model explanation.

    Dense ownership and geometry cells are browser visualization data.  The
    projection keeps their provenance and structural summaries while dropping
    every full-board cell list.
    """

    projected = {
        key: public.get(key)
        for key in (
            "id",
            "kind",
            "point",
            "coordinate",
            "intent",
            "intent_evidence",
            "title",
            "summary",
            "main_line_reply",
            "risk",
            "variation",
            "verified",
            "legal_verified",
            "engine_analyzed",
            "tactics",
            "why_here",
            "what_changes",
            "next_calculation",
            "score",
            "evaluation",
            "analysis_source",
            "candidate_analysis",
            "engine_provenance",
            "ownership_perspective",
        )
        if key in public
    }
    tactics = _tactics_projection(public.get("tactics"))
    if tactics is not None:
        projected["tactics"] = tactics
    variation = projected.get("variation")
    if isinstance(variation, list):
        projected["variation"] = variation[:6]
    opening = _opening_projection(public.get("opening_teaching"))
    if opening is not None:
        projected["opening_teaching"] = opening
    return projected


def game_review_evidence(state: GameState) -> dict[str, Any]:
    """Project a bounded, ordered rules-history timeline for finished review.

    The timeline is not an engine principal variation.  It is a deterministic
    record of moves that actually happened, sampled in stable chronological
    order when a long 19x19 game exceeds the model budget.
    """

    history = list(state.history)
    if len(history) <= MODEL_REVIEW_TIMELINE_LIMIT:
        selected = history
    else:
        first = history[:8]
        last = history[-16:]
        middle = history[8:-16]
        sample_count = MODEL_REVIEW_TIMELINE_LIMIT - len(first) - len(last)
        sampled = [middle[index * len(middle) // sample_count] for index in range(sample_count)]
        selected = sorted(
            {move.number: move for move in [*first, *sampled, *last]}.values(),
            key=lambda move: move.number,
        )

    timeline: list[dict[str, Any]] = []
    for move in selected:
        if move.kind is MoveKind.PLAY:
            assert move.vertex is not None
            coordinate: str | None = vertex_to_gtp(move.vertex, state.size)
        elif move.kind is MoveKind.PASS:
            coordinate = "pass"
        else:
            coordinate = "resign"
        timeline.append(
            {
                "move_number": move.number,
                "color": move.color.value,
                "kind": move.kind.value,
                "coordinate": coordinate,
                "captured_count": len(move.captured),
            }
        )

    return {
        "binding": {
            "state_token": state.state_token,
            "position_hash": state.position_hash,
            "move_number": state.move_number,
            "board_size": state.size,
            "side_to_move": state.to_move.value,
            "phase": state.phase.value,
        },
        "result": {
            "reason": state.result_reason.value if state.result_reason is not None else None,
            "winner": state.winner.value if state.winner is not None else None,
            "resigned_by": state.resigned_by.value if state.resigned_by is not None else None,
        },
        "timeline": timeline,
        "timeline_order": "chronological",
        "timeline_source": "deterministic_rules_history",
        "total_moves": len(history),
        "listed_moves": len(timeline),
        "omitted_moves": len(history) - len(timeline),
        "complete": len(history) == len(timeline),
        "no_candidate_choices_after_finish": True,
    }


def _encoded_size(value: object) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _record_encoded_size(evidence: dict[str, Any]) -> int:
    budget = evidence.get("evidence_budget")
    if not isinstance(budget, dict):
        return _encoded_size(evidence)
    for _ in range(4):
        actual = _encoded_size(evidence)
        if budget.get("encoded_bytes") == actual:
            return actual
        budget["encoded_bytes"] = actual
    return _encoded_size(evidence)


def _clip_utf8(value: object, maximum: int) -> object:
    if not isinstance(value, str):
        return value
    encoded = value.encode("utf-8")
    if len(encoded) <= maximum:
        return value
    return encoded[: maximum - 3].decode("utf-8", errors="ignore").rstrip() + "…"


def _group_key(group: dict[str, Any]) -> tuple[int, str, str]:
    liberties = group.get("liberties")
    exact_liberties = liberties if type(liberties) is int else 10_000
    return exact_liberties, str(group.get("color", "")), str(group.get("anchor", ""))


def _group_summary(groups: list[dict[str, Any]], listed: int) -> dict[str, Any]:
    by_color = {"black": 0, "white": 0}
    by_liberties = {"one": 0, "two": 0, "three": 0, "four_or_more": 0}
    for group in groups:
        color = group.get("color")
        if color in by_color:
            by_color[color] += 1
        liberties = group.get("liberties")
        if liberties == 1:
            by_liberties["one"] += 1
        elif liberties == 2:
            by_liberties["two"] += 1
        elif liberties == 3:
            by_liberties["three"] += 1
        elif type(liberties) is int and liberties >= 4:
            by_liberties["four_or_more"] += 1
    return {
        "evidence": "exact",
        "total": len(groups),
        "by_color": by_color,
        "by_liberties": by_liberties,
        "listed": min(listed, len(groups)),
        "omitted": max(0, len(groups) - listed),
        "detail_order": "fewest_liberties_then_color_then_anchor",
    }


def _compact_opening(value: object, level: int) -> object:
    if not isinstance(value, dict):
        return value
    opening = deepcopy(value)
    for key, limit in (
        ("gain_ids", 4),
        ("loss_ids", 4),
        ("caution_ids", 4),
        ("limitations_ids", 4),
        ("follow_ups", 2),
        ("reply_anchors", 2),
    ):
        raw = opening.get(key)
        if isinstance(raw, list):
            opening[key] = raw[:limit]
    influence = opening.get("influence")
    if isinstance(influence, dict):
        for key in ("vectors", "regions"):
            raw = influence.get(key)
            if isinstance(raw, list):
                influence[key] = raw[:3]
    territory = opening.get("territory")
    if isinstance(territory, dict) and isinstance(territory.get("zones"), list):
        territory["zones"] = territory["zones"][:3]

    diagrams = opening.get("teaching_diagrams")
    if isinstance(diagrams, list):
        diagram_limit = 4 if level == 0 else 2 if level == 1 else 1 if level == 2 else 0
        opening["teaching_diagrams"] = diagrams[:diagram_limit]
        for diagram in opening["teaching_diagrams"]:
            if isinstance(diagram, dict) and isinstance(diagram.get("steps"), list):
                diagram["steps"] = diagram["steps"][:4]

    if level >= 3:
        mechanism = opening.get("mechanism")
        if isinstance(mechanism, dict):
            mechanism = {
                key: mechanism.get(key)
                for key in (
                    "fact_ids",
                    "exact",
                    "before_shape_id",
                    "after_shape_id",
                    "reconsider_condition_ids",
                    "shape_assessment",
                )
                if key in mechanism
            }
        keep = (
            "schema_version",
            "binding",
            "provenance",
            "role_id",
            "family_id",
            "purpose_id",
            "why_id",
            "gain_ids",
            "loss_ids",
            "mechanism",
            "whole_board",
            "initiative",
            "follow_ups",
            "reply_anchors",
            "joseki",
            "caution_ids",
            "limitations_ids",
        )
        opening = {key: opening.get(key) for key in keep if key in opening}
        if mechanism is not None:
            opening["mechanism"] = mechanism
    return opening


def _compact_candidates(candidates: object, level: int) -> list[dict[str, Any]]:
    if not isinstance(candidates, list):
        return []
    result: list[dict[str, Any]] = []
    for raw in candidates[:3]:
        if not isinstance(raw, dict):
            continue
        candidate = deepcopy(raw)
        candidate["opening_teaching"] = _compact_opening(candidate.get("opening_teaching"), level)
        if candidate["opening_teaching"] is None:
            candidate.pop("opening_teaching")
        variation = candidate.get("variation")
        if isinstance(variation, list):
            candidate["variation"] = variation[: 6 if level <= 1 else 4]
        if level >= 4:
            keep = (
                "id",
                "kind",
                "point",
                "coordinate",
                "main_line_reply",
                "verified",
                "legal_verified",
                "engine_analyzed",
                "tactics",
                "score",
                "evaluation",
                "analysis_source",
                "candidate_analysis",
                "engine_provenance",
                "variation",
                "opening_teaching",
            )
            candidate = {key: candidate.get(key) for key in keep if key in candidate}
        result.append(candidate)
    return result


def bound_teaching_evidence(
    evidence: dict[str, Any], *, maximum_bytes: int = MODEL_EVIDENCE_MAX_BYTES
) -> dict[str, Any]:
    """Deterministically fit aggregate teaching evidence below provider limits.

    Candidate IDs, position/candidate bindings, exact tactical facts, teaching
    focus, and engine/rules provenance survive every compaction stage.  Dense
    visualization arrays never enter this contract.
    """

    if maximum_bytes < 8_000:
        raise ValueError("teaching evidence budget is too small for the required contract")
    bounded = deepcopy(evidence)
    bounded["question"] = _clip_utf8(bounded.get("question"), 4_000)
    candidates = bounded.get("candidates")
    bounded["candidates"] = _compact_candidates(candidates, 0)

    position = bounded.get("position")
    all_groups: list[dict[str, Any]] = []
    if isinstance(position, dict):
        raw_groups = position.get("groups")
        all_groups = (
            [item for item in raw_groups if isinstance(item, dict)]
            if isinstance(raw_groups, list)
            else []
        )
        all_groups.sort(key=_group_key)

    stages = (
        (MODEL_GROUP_DETAIL_LIMIT, 4, 0),
        (32, 3, 1),
        (20, 1, 3),
        (8, 0, 4),
    )
    for group_limit, dialogue_limit, candidate_level in stages:
        if isinstance(position, dict):
            position["groups"] = all_groups[:group_limit]
            position["group_summary"] = _group_summary(all_groups, group_limit)
        dialogue = bounded.get("recent_dialogue")
        if isinstance(dialogue, list):
            bounded["recent_dialogue"] = dialogue[-dialogue_limit:] if dialogue_limit else []
        bounded["candidates"] = _compact_candidates(candidates, candidate_level)
        bounded["evidence_budget"] = {
            "maximum_bytes": maximum_bytes,
            "group_detail_limit": group_limit,
            "recent_dialogue_limit": dialogue_limit,
            "candidate_compaction_level": candidate_level,
        }
        size = _record_encoded_size(bounded)
        if size <= maximum_bytes:
            return bounded

    # Optional lesson/persona prose is the last budget lane. Required exact
    # board facts, bindings, focus, candidate IDs, and provenance remain.
    lesson = bounded.get("lesson")
    if isinstance(lesson, dict):
        bounded["lesson"] = {
            key: _clip_utf8(lesson.get(key), 500)
            for key in ("title", "objective", "memory")
            if key in lesson
        }
    bounded.pop("companion", None)
    bounded["evidence_budget"]["optional_prose_compacted"] = True
    size = _record_encoded_size(bounded)
    if size > maximum_bytes:
        raise ValueError("required teaching evidence exceeds the configured model envelope")
    return bounded
