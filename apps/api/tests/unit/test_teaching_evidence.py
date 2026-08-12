from __future__ import annotations

import json

from weiqi.domain import Color, Vertex, analyze_energy, new_game, pass_turn, vertex_to_gtp
from weiqi.services.teaching_evidence import (
    CURRICULUM_PATH,
    MODEL_EVIDENCE_MAX_BYTES,
    bound_teaching_evidence,
    candidate_model_evidence,
    game_review_evidence,
    teaching_focus,
)


def test_teaching_focus_tracks_full_curriculum_without_changing_authority() -> None:
    opening = new_game(size=19)
    focus = teaching_focus(opening, deep_study=True)

    assert focus["curriculum_path"] == list(CURRICULUM_PATH)
    assert focus["primary"] == "fuseki"
    assert focus["supporting"] == ["joseki", "shape", "positional_judgment"]
    assert focus["study_depth"] == "deep"
    assert focus["pedagogical_phase_only"] is True
    assert focus["position_signals"]["evidence"] == "exact"
    assert opening.move_number == 0

    atari = new_game(
        size=5,
        komi=0,
        initial_black=(Vertex(0, 0),),
        initial_white=(Vertex(1, 0),),
        to_move=Color.BLACK,
    )
    assert teaching_focus(atari, deep_study=False)["primary"] == "life_and_death"

    finished = pass_turn(pass_turn(new_game(size=9)))
    assert teaching_focus(finished, deep_study=True)["primary"] == "game_review"


def test_candidate_model_projection_keeps_teaching_and_drops_dense_maps() -> None:
    public = {
        "id": "m_0123456789abcdef0123456789abcdef",
        "coordinate": "D16",
        "summary": "Teacher summary",
        "legal_verified": True,
        "ownership_before": [
            {"x": index % 19, "y": index // 19, "value": 0.1} for index in range(361)
        ],
        "ownership_after": [
            {"x": index % 19, "y": index // 19, "value": 0.2} for index in range(361)
        ],
        "ownership_delta": [
            {"x": index % 19, "y": index // 19, "value": 0.1} for index in range(361)
        ],
        "opening_teaching": {
            "schema_version": 1,
            "binding": {
                "state_token": "secretly-unneeded-bulk-binding",
                "position_hash": "a" * 64,
                "move_number": 0,
                "to_move": "black",
                "candidate_id": "m_0123456789abcdef0123456789abcdef",
            },
            "provenance": {"rules_facts": {"evidence": "exact"}},
            "role_id": "upper_left_framework_seed",
            "family_id": "corner_star_point",
            "purpose_id": "claim_upper_left_with_two_open_directions",
            "why_id": "fourth_line_balances_corner_access_and_outward_reach",
            "gain_ids": ["corner_entry"],
            "loss_ids": ["corner_not_secured"],
            "mechanism": {
                "fact_ids": ["stone_has_exact_resulting_liberties"],
                "exact": {"resulting_liberties": 4},
                "before_shape_id": "empty_board_uncommitted",
                "after_shape_id": "upper_left_seed_projects_right_and_down",
                "reconsider_condition_ids": ["weak_group_makes_global_plan_secondary"],
                "shape_assessment": {"thickness_id": "single_stone_not_thick"},
            },
            "influence": {
                "evidence": "calculated_potential",
                "source": "deterministic_opening_geometry_v1",
                "vectors": [{"direction_id": "along_top"}],
                "regions": [{"region_id": "upper_left_corner"}],
                "change_cells": [
                    {"point": {"x": index % 19, "y": index // 19}} for index in range(160)
                ],
                "not_ownership": True,
            },
            "territory": {
                "evidence": "calculated_potential",
                "zones": [{"kind": "corner"}],
                "note_id": "potential_only_requires_boundaries",
                "not_secured": True,
            },
            "whole_board": {"open_corners": 3},
            "initiative": {"not_forced": True},
            "follow_ups": [{"coordinate": "K16"}],
            "reply_anchors": [{"coordinate": "F17"}],
            "joseki": {"term": "Joseki", "guaranteed_sequence": False},
            "teaching_diagrams": [
                {
                    "diagram_type": "corner_sequence",
                    "line_kind": "authored_context",
                    "not_forced": True,
                    "verified_current_stones": [{"point": {"x": 0, "y": 0}, "color": "white"}],
                    "steps": [
                        {
                            "order": 1,
                            "kind": "extension",
                            "label_id": "extend_top",
                            "coordinate": "K16",
                            "why_id": "extend_along_open_side",
                            "gain_id": "top_side_option",
                            "loss_id": "corner_not_secured",
                            "evidence": "authored",
                        }
                    ],
                }
            ],
            "caution_ids": ["potential_not_secured_territory"],
            "limitations_ids": ["engine_evidence_not_attached"],
        },
    }

    result = candidate_model_evidence(public)
    encoded = json.dumps(result)

    assert "ownership_before" not in result
    assert "change_cells" not in encoded
    assert "verified_current_stones" not in encoded
    assert "state_token" not in encoded
    assert result["opening_teaching"]["gain_ids"] == ["corner_entry"]
    assert result["opening_teaching"]["teaching_diagrams"][0]["steps"][0]["coordinate"] == "K16"
    assert len(encoded.encode("utf-8")) < 8_000


def test_aggregate_evidence_budget_handles_many_groups_candidates_and_dialogue() -> None:
    provenance = {
        "schema_version": 1,
        "engine": "KataGo",
        "profile": "quality",
        "model": {"name": "quality.bin.gz", "sha256": "1" * 64, "size": 211_660_960},
        "binding": {
            "state_token": "2" * 64,
            "position_hash": "3" * 64,
            "history_digest": "4" * 64,
            "move_number": 200,
            "side_to_move": "black",
            "board_size": 19,
            "query_sha256": "5" * 64,
        },
    }
    diagrams = [
        {
            "diagram_type": "corner_sequence",
            "line_kind": "authored_context",
            "not_forced": True,
            "steps": [
                {
                    "order": order,
                    "kind": "extension",
                    "label_id": f"authored_step_{diagram}_{order}",
                    "coordinate": f"D{order + 1}",
                    "why_id": "compare_local_shape_with_whole_board_direction",
                    "gain_id": "preserve_multiple_future_directions",
                    "loss_id": "does_not_secure_live_territory",
                    "evidence": "authored",
                }
                for order in range(1, 9)
            ],
        }
        for diagram in range(4)
    ]
    candidates: list[dict[str, object]] = []
    for index, coordinate in enumerate(("D16", "Q16", "D4")):
        public = {
            "id": f"m_{index:032x}",
            "kind": "play",
            "point": {"x": index + 3, "y": 3},
            "coordinate": coordinate,
            "intent": "claim",
            "intent_evidence": "teacher",
            "title": "Whole-board candidate",
            "summary": "Authored teaching hypothesis " * 12,
            "main_line_reply": "White F17",
            "risk": "Potential is not secured territory " * 10,
            "variation": [
                {"color": "black", "kind": "play", "point": {"x": 3, "y": 3}},
                {"color": "white", "kind": "play", "point": {"x": 5, "y": 2}},
            ],
            "legal_verified": True,
            "engine_analyzed": True,
            "tactics": {
                "captures": [{"x": x, "y": 10} for x in range(19)],
                "resulting_liberties": 4,
                "resulting_group_size": 1,
                "evidence": "exact",
            },
            "score": {"before": 0.2, "after": 0.1, "evidence": "engine"},
            "evaluation": {"visits": 64, "evidence": "engine"},
            "engine_provenance": provenance,
            "opening_teaching": {
                "schema_version": 1,
                "binding": {
                    "move_number": 200,
                    "to_move": "black",
                    "candidate_id": f"m_{index:032x}",
                },
                "provenance": {
                    "rules_facts": {"evidence": "exact", "source": "deterministic_rules"},
                    "geometry": {
                        "evidence": "calculated_potential",
                        "source": "deterministic_opening_geometry_v1",
                    },
                    "engine": provenance,
                },
                "role_id": "upper_left_framework_seed",
                "family_id": "corner_star_point",
                "purpose_id": "claim_corner_with_open_directions",
                "why_id": "balance_corner_access_and_outward_reach",
                "gain_ids": ["corner_entry", "side_option", "central_reach"],
                "loss_ids": ["corner_not_secured", "can_be_reduced"],
                "mechanism": {
                    "fact_ids": ["stone_has_exact_resulting_liberties"],
                    "exact": {"resulting_liberties": 4, "resulting_group_size": 1},
                    "before_shape_id": "current_shape_before_candidate",
                    "after_shape_id": "candidate_projects_two_directions",
                    "reconsider_condition_ids": ["weak_group_becomes_urgent"],
                },
                "influence": {
                    "evidence": "calculated_potential",
                    "vectors": [{"direction_id": f"direction_{value}"} for value in range(8)],
                    "regions": [{"region_id": f"region_{value}"} for value in range(8)],
                    "not_ownership": True,
                },
                "territory": {
                    "evidence": "calculated_potential",
                    "zones": [{"zone_id": f"zone_{value}"} for value in range(8)],
                    "not_secured": True,
                },
                "whole_board": {"open_corners": 2, "evidence": "calculated_potential"},
                "initiative": {"not_forced": True, "evidence": "authored"},
                "follow_ups": [{"coordinate": f"K{value}"} for value in range(1, 9)],
                "reply_anchors": [{"coordinate": f"F{value}"} for value in range(1, 9)],
                "joseki": {"term": "Joseki", "guaranteed_sequence": False},
                "teaching_diagrams": diagrams,
                "caution_ids": ["potential_not_territory"] * 8,
                "limitations_ids": ["authored_not_best_move"] * 8,
            },
        }
        candidates.append(candidate_model_evidence(public))

    crowded = new_game(
        size=19,
        initial_black=tuple(Vertex(x, y) for y in range(0, 19, 2) for x in range(0, 19, 2)),
        to_move=Color.WHITE,
    )
    groups = [
        {
            "color": group.color.value,
            "anchor": vertex_to_gtp(group.anchor, 19),
            "stones": len(group.stones),
            "liberties": group.liberty_count,
        }
        for group in analyze_energy(crowded).groups
    ]
    assert len(groups) == 100
    evidence = {
        "schema_version": 1,
        "rules": "Chinese area scoring with positional superko",
        "question": "Compare the exact shape and future direction.",
        "question_kind": "reflection",
        "question_target": {
            "status": "legal_candidate",
            "candidate_id": candidates[0]["id"],
            "coordinate": "D16",
        },
        "teaching_focus": {
            "primary": "positional_judgment",
            "supporting": ["middle_game", "game_review"],
            "position_signals": {"groups_in_atari": 25, "evidence": "exact"},
        },
        "recent_dialogue": [
            {"learner_question": "问" * 300, "assistant_answer": "答" * 500} for _ in range(4)
        ],
        "lesson": {"title": "Review", "objective": "Judge the whole board", "memory": "Count"},
        "companion": {"persona": "Lantern", "style": "socratic"},
        "position": {
            "board_size": 19,
            "to_move": "black",
            "move_number": 200,
            "black_stones": [group["anchor"] for group in groups],
            "white_stones": [],
            "groups": groups,
        },
        "engine": {"status": "ready", "score_lead_black": 0.2, "visits": 64},
        "engine_provenance": provenance,
        "candidates": candidates,
        "teaching_contract": "Exact facts stay separate from forecasts and authored plans.",
    }

    assert len(json.dumps(evidence, ensure_ascii=False).encode("utf-8")) > 24_000
    bounded = bound_teaching_evidence(evidence)
    encoded = json.dumps(bounded, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    assert len(encoded) <= MODEL_EVIDENCE_MAX_BYTES
    assert bounded["evidence_budget"]["encoded_bytes"] == len(encoded)
    assert [item["id"] for item in bounded["candidates"]] == [
        f"m_{index:032x}" for index in range(3)
    ]
    assert bounded["question_target"] == evidence["question_target"]
    assert bounded["teaching_focus"] == evidence["teaching_focus"]
    assert bounded["engine_provenance"] == provenance
    assert bounded["position"]["group_summary"]["total"] == 100
    assert bounded["position"]["group_summary"]["evidence"] == "exact"
    assert all(item["engine_provenance"] == provenance for item in bounded["candidates"])
    assert all(
        item["opening_teaching"]["binding"]["candidate_id"] == item["id"]
        for item in bounded["candidates"]
    )
    for dense_field in ("ownership_before", "ownership_after", "ownership_delta"):
        assert dense_field not in encoded.decode("utf-8")


def test_finished_review_timeline_is_ordered_state_bound_and_has_no_choices() -> None:
    finished = pass_turn(pass_turn(new_game(size=19)))
    review = game_review_evidence(finished)

    assert review["binding"] == {
        "state_token": finished.state_token,
        "position_hash": finished.position_hash,
        "move_number": 2,
        "board_size": 19,
        "side_to_move": "black",
        "phase": "finished",
    }
    assert review["result"]["reason"] == "two_passes"
    assert [item["move_number"] for item in review["timeline"]] == [1, 2]
    assert [item["coordinate"] for item in review["timeline"]] == ["pass", "pass"]
    assert review["timeline_source"] == "deterministic_rules_history"
    assert review["complete"] is True
    assert review["no_candidate_choices_after_finish"] is True
