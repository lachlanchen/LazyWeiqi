from __future__ import annotations

import asyncio
import json
import sqlite3
from typing import Any

import pytest
from conftest import FakeKataGo, FakeKataGo19, FakeModelClient
from fastapi.testclient import TestClient

from weiqi.adapters.store.sqlite import GameStore, RevisionConflict
from weiqi.config import Settings
from weiqi.main import create_app
from weiqi.schemas import CoachDraft, CoachQuestion, MoveRequest
from weiqi.services import game_service as game_service_module


def _deep_study_draft(*, candidate_id: str | None = None) -> CoachDraft:
    choices = []
    if candidate_id is not None:
        choices = [
            {
                "candidate_id": candidate_id,
                "intent": "build",
                "title": "Develop the corner",
                "reason": "This explains only the supplied selected candidate.",
                "risk": "The opponent can still approach from an open side.",
            }
        ]
    return CoachDraft.model_validate(
        {
            "schema_version": 1,
            "headline": "Compare the corner directions",
            "story": "The selected point reaches toward two open sides.",
            "principle": {
                "name": "Fuseki",
                "explanation": "Fuseki compares local shape with whole-board direction.",
            },
            "what_changed": ["One legal stone is previewed but not played."],
            "remember": "Recount after the opponent's actual reply.",
            "choices": choices,
            "reflection_question": "Which approach would change your plan?",
            "uncertainty": "The future continuation is not forced.",
            "study": {
                "phase": "fuseki",
                "why_now": "The empty-board opening asks which direction should develop first.",
                "mechanism": "The local stone projects along open lines without securing them.",
                "gain": "It preserves more than one development direction.",
                "tradeoff": "The corner remains open to an approach.",
                "opponent_response": "Compare only the supplied response anchors.",
                "next_steps": [
                    "Read the opponent's actual reply.",
                    "Recount liberties and compare whole-board urgency.",
                ],
                "reconsider_when": "A nearby weak group becomes urgent.",
                "transferable_principle": "Opening value depends on local shape and global direction.",
            },
        }
    )


def _play_19(
    client: TestClient,
    game: dict[str, Any],
    *,
    x: int,
    y: int,
    actor_id: str,
    request_id: str,
) -> dict[str, Any]:
    response = client.post(
        f"/api/games/{game['id']}/moves",
        json={
            "actor_id": actor_id,
            "expected_revision": game["revision"],
            "kind": "play",
            "point": {"x": x, "y": y},
            "client_request_id": request_id,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_status_and_curriculum_expose_ordinary_19_but_keep_13_hidden(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        status = client.get("/api/status")
        assert status.status_code == 200, status.text
        assert status.json()["supported_board_sizes"] == [5, 7, 9, 19]

        response = client.get("/api/curriculum")
        assert response.status_code == 200, response.text
        lessons = response.json()["lessons"]
        assert 13 not in {lesson["board_size"] for lesson in lessons}

        full_board = next(lesson for lesson in lessons if lesson["id"] == "full-landscape-19")
        assert full_board == {
            "id": "full-landscape-19",
            "order": 8,
            "title": "The Full Landscape",
            "subtitle": "A normal game on the full board",
            "story": (
                "The full landscape opens. Corners, sides, and center now belong to one "
                "connected journey."
            ),
            "board_size": 19,
            "duration_minutes": 60,
            "concepts": ["Whole Board", "Opening", "Large Scale Strategy"],
            "difficulty": "growing",
            "status": "available",
            "training_variant": None,
            "memory_line": (
                "Board size changes scale, not the meaning of liberties, connection, or honest "
                "counting."
            ),
        }

        hidden = client.post(
            "/api/games",
            json={
                "lesson_id": "wide-river-13",
                "board_size": 13,
                "mode": "two_player",
            },
        )
        assert hidden.status_code == 400, hidden.text
        assert hidden.json()["code"] == "invalid_game_request"


def test_ordinary_19_game_supports_preview_moves_endings_history_and_persistence(
    app_client_factory: Any,
) -> None:
    out_of_domain_engine = {
        "rootInfo": {"currentPlayer": "B", "scoreLead": 99.0, "visits": 999},
        "moveInfos": [{"move": "K10", "order": 0, "pv": ["K10"]}],
        "ownership": [0.5] * 361,
    }
    with app_client_factory(katago_analysis=out_of_domain_engine) as (
        client,
        katago,
        _openai,
        _local,
    ):
        created_response = client.post(
            "/api/games",
            json={"board_size": 19, "mode": "two_player"},
        )
        assert created_response.status_code == 201, created_response.text
        created = created_response.json()
        game_id = created["id"]
        assert created["board_size"] == 19
        assert created["lesson_id"] == "full-landscape-19"
        assert created["title"] == "The Full Landscape"
        assert created["objective"] == (
            "Play a normal 19×19 game under Chinese area rules with positional superko, "
            "from the opening through passes or resignation."
        )
        assert created["rules"] == {
            "name": "Chinese area rules",
            "scoring": "chinese_area",
            "ko_rule": "positional_superko",
            "komi": 7.5,
            "training_variant": None,
        }
        assert created["area_snapshot"]["neutral_points"] == 361

        analysis_response = client.post(
            f"/api/games/{game_id}/analysis",
            json={"expected_revision": 1},
        )
        assert analysis_response.status_code == 200, analysis_response.text
        analysis = analysis_response.json()["analysis"]
        assert analysis["status"] == "fallback"
        assert analysis["ownership"] == []
        assert [candidate["coordinate"] for candidate in analysis["candidates"]] == [
            "D16",
            "Q16",
            "D4",
        ]
        assert katago.queries == []

        preview = client.post(
            f"/api/games/{game_id}/preview",
            json={
                "x": 18,
                "y": 18,
                "actor_id": "black-human",
                "expected_revision": 1,
            },
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["coordinate"] == "T1"
        assert preview.json()["legal"] is True
        assert preview.json()["if_played_area_snapshot"]["black_stones"] == 1
        assert client.get(f"/api/games/{game_id}").json()["revision"] == 1
        assert katago.queries == []

        played = client.post(
            f"/api/games/{game_id}/moves",
            json={
                "actor_id": "black-human",
                "expected_revision": 1,
                "kind": "play",
                "point": {"x": 18, "y": 18},
                "client_request_id": "full-board-play-0001",
            },
        )
        assert played.status_code == 200, played.text
        assert played.json()["revision"] == 2
        assert played.json()["stones"] == [{"x": 18, "y": 18, "color": "black", "move_number": 1}]

        white_pass = client.post(
            f"/api/games/{game_id}/moves",
            json={
                "actor_id": "white-human",
                "expected_revision": 2,
                "kind": "pass",
                "client_request_id": "full-board-white-pass-0001",
            },
        )
        assert white_pass.status_code == 200, white_pass.text
        assert white_pass.json()["phase"] == "playing"

        black_pass = client.post(
            f"/api/games/{game_id}/moves",
            json={
                "actor_id": "black-human",
                "expected_revision": 3,
                "kind": "pass",
                "client_request_id": "full-board-black-pass-0001",
            },
        )
        assert black_pass.status_code == 200, black_pass.text
        ended = black_pass.json()
        assert ended["revision"] == 4
        assert ended["phase"] == "finished"
        assert ended["result"] is None
        assert [move["kind"] for move in ended["moves"]] == ["play", "pass", "pass"]
        area = ended["area_snapshot"]
        assert area["status"] == "mechanical_all_stones_alive"
        assert area["adjudicated"] is False
        assert (
            area["black_stones"]
            + area["black_enclosed_empty"]
            + area["white_stones"]
            + area["white_enclosed_empty"]
            + area["neutral_points"]
            == 361
        )

        loaded = client.get(f"/api/games/{game_id}")
        assert loaded.status_code == 200, loaded.text
        assert loaded.json() == ended
        listing = client.get("/api/games")
        assert listing.status_code == 200, listing.text
        summary = next(item for item in listing.json()["games"] if item["id"] == game_id)
        assert summary["board_size"] == 19
        assert summary["move_count"] == 3
        assert summary["phase"] == "finished"

        data_dir = client.app.state.game_store.path.parent
        reopened_app = create_app(
            Settings(data_dir=data_dir, openai_api_key=None),
            store=GameStore(data_dir),
            katago=FakeKataGo(),  # type: ignore[arg-type]
            katago19=FakeKataGo19(),  # type: ignore[arg-type]
            openai=FakeModelClient(),  # type: ignore[arg-type]
            local=FakeModelClient(),  # type: ignore[arg-type]
        )
        with TestClient(reopened_app) as reopened_client:
            persisted = reopened_client.get(f"/api/games/{game_id}")
            assert persisted.status_code == 200, persisted.text
            assert persisted.json() == ended

        resign_game = client.post(
            "/api/games",
            json={"board_size": 19, "mode": "two_player"},
        ).json()
        resigned = client.post(
            f"/api/games/{resign_game['id']}/moves",
            json={
                "actor_id": "black-human",
                "expected_revision": 1,
                "kind": "resign",
                "client_request_id": "full-board-resign-0001",
            },
        )
        assert resigned.status_code == 200, resigned.text
        assert resigned.json()["phase"] == "finished"
        assert resigned.json()["result"] == "W+R"


def test_19_shortlist_builds_full_visual_impact_only_for_public_candidates(
    app_client_factory: Any,
    monkeypatch: Any,
) -> None:
    original = game_service_module.explain_move_impact
    calls: list[tuple[int, int]] = []

    def tracked_impact(before: Any, after: Any) -> Any:
        calls.append((before.size, after.size))
        return original(before, after)

    monkeypatch.setattr(game_service_module, "explain_move_impact", tracked_impact)
    with app_client_factory() as (client, katago, _openai, _local):
        game = client.post(
            "/api/games",
            json={"board_size": 19, "mode": "two_player"},
        ).json()
        calls.clear()

        response = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": 1},
        )

        assert response.status_code == 200, response.text
        assert [
            candidate["coordinate"] for candidate in response.json()["analysis"]["candidates"]
        ] == ["D16", "Q16", "D4"]
        assert calls == [(19, 19)] * 3
        assert katago.queries == []


def test_19_opening_analysis_separates_exact_geometry_and_authored_evidence(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, katago, _openai, _local):
        game = client.post(
            "/api/games",
            json={"board_size": 19, "mode": "two_player"},
        ).json()

        response = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": game["revision"]},
        )

        assert response.status_code == 200, response.text
        payload = response.json()
        analysis = payload["analysis"]
        landscape = analysis["opening_landscape"]
        assert landscape["schema_version"] == 1
        assert set(landscape["binding"]) == {
            "state_token",
            "position_hash",
            "move_number",
            "to_move",
        }
        assert landscape["binding"]["move_number"] == 0
        assert landscape["binding"]["to_move"] == "black"
        assert len(landscape["binding"]["state_token"]) == 64
        assert len(landscape["binding"]["position_hash"]) == 64
        assert landscape["phase_id"] == "empty_board_opening"
        assert landscape["field"] == {
            "evidence": "calculated_potential",
            "source": "deterministic_opening_geometry_v1",
            "cells": [],
            "cell_limit": 241,
            "not_ownership": True,
            "not_secured_territory": True,
        }
        assert landscape["provenance"] == {
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
        assert len(landscape["region_balance"]) == 9
        assert all(
            region["black_stones"] == region["white_stones"] == 0
            for region in landscape["region_balance"]
        )
        assert all(corner["open"] is True for corner in landscape["corner_status"])

        candidates = analysis["candidates"]
        assert [candidate["coordinate"] for candidate in candidates] == ["D16", "Q16", "D4"]
        expected = {
            "D16": {
                "role": "upper_left_framework_seed",
                "purpose": "claim_upper_left_with_two_open_directions",
                "balance": "adds_upper_left_option",
                "directions": ["along_top", "along_left", "toward_center"],
                "follow": ["K16", "D10"],
                "reply": ["F17", "C14"],
                "side_gain": "left_side_option",
                "directional_loss": "upper_left_plan_can_be_reduced_from_two_sides",
            },
            "Q16": {
                "role": "upper_right_framework_seed",
                "purpose": "claim_upper_right_with_two_open_directions",
                "balance": "adds_upper_right_option",
                "directions": ["along_top", "along_right", "toward_center"],
                "follow": ["K16", "Q10"],
                "reply": ["O17", "R14"],
                "side_gain": "right_side_option",
                "directional_loss": "upper_right_plan_can_be_reduced_from_two_sides",
            },
            "D4": {
                "role": "lower_left_framework_seed",
                "purpose": "claim_lower_left_with_two_open_directions",
                "balance": "adds_lower_left_option",
                "directions": ["along_bottom", "along_left", "toward_center"],
                "follow": ["K4", "D10"],
                "reply": ["F3", "C6"],
                "side_gain": "bottom_side_option",
                "directional_loss": "lower_left_plan_can_be_reduced_from_two_sides",
            },
        }
        for candidate in candidates:
            assert candidate["engine_analyzed"] is False
            assert "score" not in candidate
            assert "evaluation" not in candidate
            assert "ownership_after" not in candidate
            teaching = candidate["opening_teaching"]
            contract = expected[candidate["coordinate"]]
            assert teaching["binding"]["candidate_id"] == candidate["id"]
            assert teaching["binding"]["state_token"] == landscape["binding"]["state_token"]
            assert teaching["binding"]["position_hash"] == landscape["binding"]["position_hash"]
            assert teaching["binding"]["move_number"] == payload["revision"] - 1 == 0
            assert teaching["binding"]["to_move"] == "black"
            assert teaching["role_id"] == contract["role"]
            assert teaching["family_id"] == "corner_star_point"
            assert teaching["purpose_id"] == contract["purpose"]
            assert teaching["why_id"] == "fourth_line_balances_corner_access_and_outward_reach"
            assert contract["side_gain"] in teaching["gain_ids"]
            assert contract["directional_loss"] in teaching["loss_ids"]
            assert teaching["mechanism"]["exact"] == {
                "region_id": f"{candidate['opening_teaching']['role_id'].removesuffix('_framework_seed')}_corner",
                "line_from_nearest_edge": 4,
                "resulting_liberties": 4,
                "resulting_group_size": 1,
                "connections": 0,
            }
            assert teaching["mechanism"]["shape_assessment"] == {
                "evidence": "calculated_potential",
                "thickness_id": "single_stone_not_thick",
                "weakness_ids": ["can_be_approached_from_open_side"],
            }
            assert teaching["whole_board"] == {
                "evidence": "calculated_potential",
                "balance_effect_id": contract["balance"],
                "open_corners": 3,
            }
            assert [item["direction_id"] for item in teaching["influence"]["vectors"]] == contract[
                "directions"
            ]
            assert 1 <= len(teaching["influence"]["change_cells"]) <= 160
            assert teaching["influence"]["not_ownership"] is True
            assert teaching["territory"]["not_secured"] is True
            assert [item["coordinate"] for item in teaching["follow_ups"]] == contract["follow"]
            assert [item["coordinate"] for item in teaching["reply_anchors"]] == contract["reply"]
            assert all(item["timing_id"] == "future_big_point" for item in teaching["follow_ups"])
            assert all(
                item["timing_id"] == "opponent_reply_space" for item in teaching["reply_anchors"]
            )
            assert teaching["initiative"] == {
                "evidence": "authored",
                "sente_status_id": "open_board_not_forced",
                "not_forced": True,
            }
            assert teaching["joseki"] == {
                "term": "Joseki",
                "original": "定式",
                "relation": "entry_point",
                "note_id": "star_point_can_begin_joseki_context",
                "evidence": "authored",
                "guaranteed_sequence": False,
            }
            assert 1 <= len(teaching["teaching_diagrams"]) <= 4
            for diagram in teaching["teaching_diagrams"]:
                assert diagram["verified_current_stones"] == []
                assert diagram["candidate"] == {
                    "point": candidate["point"],
                    "color": "black",
                }
                assert diagram["line_kind"] == "authored_context"
                assert diagram["not_forced"] is True
                assert len(diagram["steps"]) <= 8
                assert all(step["evidence"] == "authored" for step in diagram["steps"])
        assert (
            len({tuple(item["gain_ids"]) for item in (c["opening_teaching"] for c in candidates)})
            == 3
        )
        assert (
            len({tuple(item["loss_ids"]) for item in (c["opening_teaching"] for c in candidates)})
            == 3
        )
        assert katago.queries == []


def test_19_opening_guidance_rebinds_after_moves_and_skips_occupied_featured_points(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, katago, _openai, _local):
        game = client.post(
            "/api/games",
            json={"board_size": 19, "mode": "two_player"},
        ).json()
        initial = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": game["revision"]},
        ).json()["analysis"]
        initial_token = initial["opening_landscape"]["binding"]["state_token"]

        game = _play_19(
            client,
            game,
            x=3,
            y=3,
            actor_id="black-human",
            request_id="opening-contract-black-d16",
        )
        game = _play_19(
            client,
            game,
            x=15,
            y=15,
            actor_id="white-human",
            request_id="opening-contract-white-q4",
        )
        response = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": game["revision"]},
        )
        assert response.status_code == 200, response.text
        analysis = response.json()["analysis"]
        landscape = analysis["opening_landscape"]
        assert landscape["binding"]["state_token"] != initial_token
        assert landscape["binding"]["move_number"] == 2
        assert landscape["phase_id"] == "early_whole_board_opening"
        assert 1 <= len(landscape["field"]["cells"]) <= 241
        assert sum(item["black_stones"] for item in landscape["region_balance"]) == 1
        assert sum(item["white_stones"] for item in landscape["region_balance"]) == 1
        assert (
            next(item for item in landscape["corner_status"] if item["corner_id"] == "upper_left")[
                "open"
            ]
            is False
        )
        assert (
            next(item for item in landscape["corner_status"] if item["corner_id"] == "lower_right")[
                "open"
            ]
            is False
        )

        coordinates = [candidate["coordinate"] for candidate in analysis["candidates"]]
        assert "D16" not in coordinates
        assert "Q4" not in coordinates
        assert coordinates[:2] == ["Q16", "D4"]
        for candidate in analysis["candidates"]:
            teaching = candidate["opening_teaching"]
            assert teaching["binding"]["state_token"] == landscape["binding"]["state_token"]
            assert teaching["binding"]["move_number"] == 2
            current_stones = {(stone["x"], stone["y"], stone["color"]) for stone in game["stones"]}
            assert all(
                (stone["point"]["x"], stone["point"]["y"], stone["color"]) in current_stones
                for diagram in teaching["teaching_diagrams"]
                for stone in diagram["verified_current_stones"]
            )
            assert teaching["joseki"]["guaranteed_sequence"] is False
        assert katago.queries == []


def test_19_arbitrary_preview_gets_candidate_bound_opening_teaching_without_mutation(
    app_client_factory: Any,
) -> None:
    with app_client_factory() as (client, katago, _openai, _local):
        game = client.post(
            "/api/games",
            json={"board_size": 19, "mode": "two_player"},
        ).json()
        response = client.post(
            f"/api/games/{game['id']}/preview",
            json={
                "x": 9,
                "y": 9,
                "actor_id": "black-human",
                "expected_revision": game["revision"],
            },
        )
        assert response.status_code == 200, response.text
        preview = response.json()
        teaching = preview["teaching"]
        opening = teaching["opening_teaching"]
        assert teaching["coordinate"] == "K10"
        assert opening["binding"]["candidate_id"] == teaching["id"]
        assert opening["binding"]["move_number"] == 0
        assert opening["family_id"] == "center_influence"
        assert opening["joseki"]["relation"] == "not_applicable"
        assert opening["joseki"]["note_id"] == "not_a_joseki_position"
        assert opening["mechanism"]["exact"]["resulting_liberties"] == 4
        assert client.get(f"/api/games/{game['id']}").json()["revision"] == game["revision"]
        assert katago.queries == []


def test_opening_contract_is_absent_from_non_19_analysis(app_client_factory: Any) -> None:
    with app_client_factory() as (client, _katago, _openai, _local):
        game = client.post(
            "/api/games",
            json={"board_size": 9, "mode": "two_player"},
        ).json()
        response = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": game["revision"]},
        )
        assert response.status_code == 200, response.text
        analysis = response.json()["analysis"]
        assert "opening_landscape" not in analysis
        assert all("opening_teaching" not in candidate for candidate in analysis["candidates"])


def test_19_fast_engine_evidence_is_attested_bound_and_intersects_legal_candidates(
    app_client_factory: Any,
) -> None:
    ownership = [0.0] * 361
    engine = {
        "rootInfo": {
            "currentPlayer": "B",
            "scoreLead": 0.75,
            "winrate": 0.51,
            "visits": 24,
        },
        "ownership": ownership,
        "ownershipStdev": [0.1] * 361,
        "policy": [0.0] * 362,
        "moveInfos": [
            {
                "move": "D16",
                "order": 0,
                "visits": 18,
                "scoreLead": 1.0,
                "winrate": 0.52,
                "prior": 0.2,
                "pv": ["D16", "Q4"],
                "ownership": [0.05] * 361,
                "ownershipStdev": [0.12] * 361,
            },
            {
                # Malformed/out-of-board engine suggestions may never become
                # candidates outside the canonical deterministic legal set.
                "move": "T20",
                "order": 1,
                "visits": 6,
                "pv": ["T20"],
            },
        ],
    }
    with app_client_factory(katago19_analysis=engine) as (
        client,
        katago9,
        _openai,
        _local,
    ):
        game = client.post(
            "/api/games",
            json={"board_size": 19, "mode": "two_player"},
        ).json()
        response = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": game["revision"]},
        )
        assert response.status_code == 200, response.text
        analysis = response.json()["analysis"]
        assert analysis["status"] == "ready"
        assert analysis["network"] == "b10c384h6nbttflrs.bin.gz"
        assert analysis["visits"] == 24
        assert analysis["score_perspective"] == "black"
        assert len(analysis["ownership"]) == 361
        provenance = analysis["engine_provenance"]
        assert provenance["profile"] == "fast"
        assert provenance["model"] == {
            "name": "b10c384h6nbttflrs.bin.gz",
            "size": 38_245_488,
            "sha256": "0ba27eced5180b3e3d0b898b280c541112989765e789d1eb6cd0d31b2b2c1229",
        }
        assert provenance["requested_visits"] == provenance["actual_visits"] == 24
        assert provenance["perspective"] == "black"
        assert provenance["cache_hit"] is False
        assert provenance["binding"]["move_number"] == 0
        assert provenance["binding"]["side_to_move"] == "black"
        assert len(provenance["binding"]["state_token"]) == 64
        assert len(provenance["binding"]["position_hash"]) == 64
        assert len(provenance["binding"]["history_digest"]) == 64
        assert len(provenance["binding"]["query_sha256"]) == 64

        offered = analysis["candidates"]
        assert offered[0]["coordinate"] == "D16"
        assert all(candidate["coordinate"] != "T20" for candidate in offered)
        assert all(candidate["legal_verified"] is True for candidate in offered)
        assert offered[0]["engine_analyzed"] is True
        opening_engine = offered[0]["opening_teaching"]["provenance"]["engine"]
        assert opening_engine["available"] is True
        assert opening_engine["profile"] == "fast"
        assert opening_engine["model_sha256"] == provenance["model"]["sha256"]
        assert opening_engine["candidate_analyzed"] is True
        assert analysis["opening_landscape"]["provenance"]["engine"]["available"] is True
        assert (
            "engine_evidence_not_attached" not in analysis["opening_landscape"]["limitations_ids"]
        )
        assert (
            "engine_evidence_not_attached" not in offered[0]["opening_teaching"]["limitations_ids"]
        )
        assert katago9.queries == []

        cached = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": game["revision"]},
        ).json()["analysis"]
        assert cached["engine_provenance"]["cache_hit"] is True


def test_19_rejects_engine_evidence_with_wrong_state_binding(app_client_factory: Any) -> None:
    engine = {
        "rootInfo": {"currentPlayer": "B", "scoreLead": 99.0, "visits": 24},
        "ownership": [0.5] * 361,
        "moveInfos": [{"move": "D16", "order": 0, "pv": ["D16"]}],
    }

    def mismatched(query: dict[str, Any]) -> dict[str, Any]:
        response = dict(engine)
        response["_weiqi_provenance"] = {
            "schema_version": 1,
            "engine": "KataGo",
            "engine_version": "1.17.2",
            "profile": "fast",
            "model": {
                "name": "b10c384h6nbttflrs.bin.gz",
                "size": 38_245_488,
                "sha256": "0ba27eced5180b3e3d0b898b280c541112989765e789d1eb6cd0d31b2b2c1229",
            },
            "config": {
                "name": "katago-analysis-19x19.cfg",
                "size": 1_247,
                "sha256": "c6c4b5d9d3c1a1b572ac4eeb0a1ab1ab8a024995c8aacf03e5728d1e114b2305",
            },
            "binary": {
                "size": 20_569_624,
                "sha256": "fa73f1190626bf2c2736732f4774da2087b6ab899bd123a7c1f0a1a1edbfce7c",
                "source_commit": "6a1fc5de9fc253723ac475a0683bf0b9d9b7bd19",
            },
            "requested_visits": 24,
            "actual_visits": 24,
            "elapsed_ms": 1.0,
            "cache_hit": False,
            "perspective": "black",
            "binding": {
                "state_token": "f" * 64,
                "position_hash": query["position_hash"],
                "history_digest": query["history_digest"],
                "move_number": 0,
                "side_to_move": "black",
                "board_size": 19,
                "query_sha256": "0" * 64,
            },
        }
        return response

    with app_client_factory(katago19_analysis=mismatched) as (
        client,
        _katago9,
        _openai,
        _local,
    ):
        game = client.post(
            "/api/games",
            json={"board_size": 19, "mode": "two_player"},
        ).json()
        analysis = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": game["revision"]},
        ).json()["analysis"]
        assert analysis["status"] == "fallback"
        assert analysis["ownership"] == []
        assert "engine_provenance" not in analysis
        assert analysis["opening_landscape"]["provenance"]["engine"] == {
            "available": False,
            "reason_id": "engine_evidence_not_attached",
        }
        assert "engine_evidence_not_attached" in analysis["opening_landscape"]["limitations_ids"]


def test_19_quality_profile_is_reserved_for_explicit_reflection(app_client_factory: Any) -> None:
    def engine(query: dict[str, Any]) -> dict[str, Any]:
        visits = 64 if query["profile"] == "quality" else 24
        return {
            "rootInfo": {
                "currentPlayer": "B",
                "scoreLead": 0.25,
                "visits": visits,
            },
            "ownership": [0.0] * 361,
            "ownershipStdev": [0.1] * 361,
            "moveInfos": [
                {
                    "move": "D16",
                    "order": 0,
                    "visits": visits,
                    "scoreLead": 0.25,
                    "pv": ["D16", "Q4"],
                    "ownership": [0.05] * 361,
                }
            ],
        }

    with app_client_factory(katago19_analysis=engine) as (
        client,
        _katago9,
        _openai,
        _local,
    ):
        game = client.post(
            "/api/games",
            json={"board_size": 19, "mode": "human_companion"},
        ).json()
        normal = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": game["revision"]},
        )
        assert normal.status_code == 200, normal.text
        assert normal.json()["analysis"]["engine_provenance"]["profile"] == "fast"

        hint = client.post(
            f"/api/games/{game['id']}/coach",
            json={
                "expected_revision": game["revision"],
                "question": "Give me a bounded hint.",
                "kind": "hint",
                "client_request_id": "full-board-fast-hint-0001",
            },
        )
        assert hint.status_code == 200, hint.text
        assert hint.json()["engine_provenance"]["profile"] == "fast"

        reflection = client.post(
            f"/api/games/{game['id']}/coach",
            json={
                "expected_revision": game["revision"],
                "question": "Run the deliberate deep reflection.",
                "kind": "reflection",
                "client_request_id": "full-board-quality-reflection-0001",
            },
        )
        assert reflection.status_code == 200, reflection.text
        provenance = reflection.json()["engine_provenance"]
        assert provenance["profile"] == "quality"
        assert provenance["model"]["name"] == "b11c768h12nbt3tflrs-fson-silu.bin.gz"
        assert provenance["model"]["sha256"] == (
            "1881600caab9e9d85a3dd6a019e9b8e7d2c237b5f984e13ed49a8645be3077c6"
        )
        assert provenance["requested_visits"] == provenance["actual_visits"] == 64
        assert client.app.state.katago19.queries[-1]["profile"] == "quality"
        assert [query["profile"] for query in client.app.state.katago19.queries] == [
            "fast",
            "quality",
        ]


def test_19_selected_point_deep_study_is_bound_bounded_and_does_not_play(
    app_client_factory: Any,
) -> None:
    def engine(query: dict[str, Any]) -> dict[str, Any]:
        visits = 64 if query["profile"] == "quality" else 24
        if query["moves"]:
            assert query["moves"] == [["B", "C16"]]
            return {
                "rootInfo": {
                    "currentPlayer": "W",
                    "scoreLead": -0.1,
                    "scoreStdev": 1.1,
                    "winrate": 0.48,
                    "visits": visits,
                },
                "ownership": [-0.02] * 361,
                "ownershipStdev": [0.12] * 361,
                "moveInfos": [
                    {
                        "move": "O17",
                        "order": 0,
                        "visits": visits,
                        "scoreLead": -0.1,
                        "winrate": 0.48,
                        "pv": ["O17", "D4"],
                    }
                ],
            }
        return {
            "rootInfo": {
                "currentPlayer": "B",
                "scoreLead": 0.25,
                "scoreStdev": 1.3,
                "winrate": 0.52,
                "visits": visits,
            },
            "ownership": [0.0] * 361,
            "ownershipStdev": [0.1] * 361,
            "moveInfos": [
                {
                    "move": "R16",
                    "order": 0,
                    "visits": visits,
                    "scoreLead": 0.25,
                    "pv": ["R16", "D4"],
                    "ownership": [0.05] * 361,
                }
            ],
        }

    with app_client_factory(
        katago19_analysis=engine,
        openai_draft=_deep_study_draft(),
    ) as (client, _katago9, openai, _local):
        game = client.post(
            "/api/games",
            json={"board_size": 19, "mode": "human_companion"},
        ).json()
        response = client.post(
            f"/api/games/{game['id']}/coach",
            json={
                "expected_revision": game["revision"],
                "question": "Why would C16 develop this corner?",
                "selected_point": {"x": 2, "y": 3},
                "kind": "reflection",
                "client_request_id": "selected-c16-reflection-0001",
            },
        )

        assert response.status_code == 200, response.text
        payload = response.json()
        text = payload["message"]["text"]
        assert "Candidate coordinate: C16." in text
        assert "Candidate coordinate: R16." not in text
        assert "Study focus: fuseki" in text
        assert "Why now: The empty-board opening" in text
        assert "How it works: The local stone projects" in text
        assert "Gain: It preserves" in text
        assert "Tradeoff: The corner remains" in text
        assert "Opponent response: Compare only" in text
        assert "Next steps: 1. Read the opponent" in text
        assert "Reconsider when: A nearby weak group" in text
        assert "Transferable principle: Opening value" in text
        assert payload["message"]["prompt"] == "Which approach would change your plan?"
        assert payload["engine_provenance"]["profile"] == "quality"
        assert [candidate["coordinate"] for candidate in payload["candidates"]] == ["C16"]
        selected = payload["candidates"][0]
        assert selected["candidate_analysis"]["status"] == "ready"
        assert selected["candidate_analysis"]["profile"] == "quality"
        assert selected["analysis_source"] == "child_root"
        assert selected["score"] == {
            "before": 0.25,
            "after": -0.1,
            "delta": -0.35,
            "mover_delta": -0.35,
            "perspective": "black",
            "evidence": "engine",
            "outcome_spread_before": 1.3,
            "outcome_spread_after": 1.1,
        }
        assert selected["evaluation"]["winrate_before"] == 0.52
        assert selected["evaluation"]["winrate_after"] == 0.48
        assert selected["variation"] == [
            {"color": "black", "kind": "play", "point": {"x": 2, "y": 3}},
            {"color": "white", "kind": "play", "point": {"x": 13, "y": 2}},
            {"color": "black", "kind": "play", "point": {"x": 3, "y": 15}},
        ]
        reflection_binding = selected["engine_provenance"]["reflection_binding"]
        assert (
            reflection_binding["parent"]["state_token"]
            != reflection_binding["child"]["state_token"]
        )
        assert reflection_binding["parent"]["move_number"] == 0
        assert reflection_binding["candidate"] == {
            "candidate_id": selected["id"],
            "coordinate": "C16",
            "kind": "play",
            "legal_verified": True,
        }
        assert reflection_binding["child"]["move_number"] == 1
        assert reflection_binding["expected_revision"] == game["revision"]
        quality_queries = client.app.state.katago19.queries
        assert [query["profile"] for query in quality_queries] == ["quality", "quality"]
        assert [query["moves"] for query in quality_queries] == [[], [["B", "C16"]]]

        evidence = openai.coach_calls[-1]
        assert evidence["question"] == "Why would C16 develop this corner?"
        assert evidence["question_kind"] == "reflection"
        assert evidence["question_target"] == {
            "status": "legal_candidate",
            "point": {"x": 2, "y": 3},
            "coordinate": "C16",
            "candidate_id": evidence["candidates"][0]["id"],
        }
        assert evidence["teaching_focus"]["primary"] == "fuseki"
        assert evidence["teaching_focus"]["study_depth"] == "deep"
        assert evidence["engine_provenance"]["profile"] == "quality"
        assert evidence["engine_provenance"]["binding"]["board_size"] == 19
        assert [candidate["coordinate"] for candidate in evidence["candidates"]] == ["C16"]
        assert evidence["candidates"][0]["candidate_analysis"]["status"] == "ready"
        assert evidence["candidates"][0]["engine_provenance"]["reflection_binding"] == (
            reflection_binding
        )
        encoded = json.dumps(evidence)
        for dense_field in (
            "ownership_before",
            "ownership_after",
            "ownership_delta",
            "change_cells",
            "verified_current_stones",
        ):
            assert dense_field not in encoded
        assert len(encoded.encode()) <= 22_000

        loaded = client.get(f"/api/games/{game['id']}").json()
        assert loaded["revision"] == game["revision"]
        assert loaded["moves"] == []
        assert loaded["stones"] == []


def test_19_selected_authored_shortlist_fallback_gets_quality_child_evidence(
    app_client_factory: Any,
) -> None:
    def engine(query: dict[str, Any]) -> dict[str, Any]:
        if query["moves"]:
            assert query["moves"] == [["B", "D16"]]
            return {
                "rootInfo": {
                    "currentPlayer": "W",
                    "scoreLead": 0.05,
                    "winrate": 0.51,
                    "visits": 64,
                },
                "moveInfos": [{"move": "Q4", "order": 0, "visits": 64, "pv": ["Q4"]}],
            }
        return {
            "rootInfo": {
                "currentPlayer": "B",
                "scoreLead": 0.2,
                "winrate": 0.53,
                "visits": 64,
            },
            # Only R16 is engine-ranked. D16 is nevertheless one of the three
            # public authored fallback choices and still needs its own child
            # query when the learner explicitly inspects it.
            "moveInfos": [{"move": "R16", "order": 0, "visits": 64, "pv": ["R16"]}],
        }

    with app_client_factory(katago19_analysis=engine) as (
        client,
        _katago9,
        _openai,
        _local,
    ):
        game = client.post(
            "/api/games",
            json={"board_size": 19, "mode": "human_companion"},
        ).json()
        response = client.post(
            f"/api/games/{game['id']}/coach",
            json={
                "expected_revision": game["revision"],
                "question": "Study the authored D16 fallback with real child evidence.",
                "selected_point": {"x": 3, "y": 3},
                "kind": "reflection",
                "client_request_id": "selected-d16-fallback-child-0001",
            },
        )

        assert response.status_code == 200, response.text
        payload = response.json()
        assert [item["coordinate"] for item in payload["candidates"]] == ["D16"]
        selected = payload["candidates"][0]
        assert selected["candidate_analysis"]["status"] == "ready"
        assert selected["engine_analyzed"] is True
        assert selected["score"]["before"] == 0.2
        assert selected["score"]["after"] == 0.05
        assert (
            selected["engine_provenance"]["reflection_binding"]["candidate"]["candidate_id"]
            == selected["id"]
        )
        assert [query["profile"] for query in client.app.state.katago19.queries] == [
            "quality",
            "quality",
        ]
        assert [query["moves"] for query in client.app.state.katago19.queries] == [
            [],
            [["B", "D16"]],
        ]
        loaded = client.get(f"/api/games/{game['id']}").json()
        assert loaded["revision"] == game["revision"]
        assert loaded["moves"] == []
        assert loaded["stones"] == []


def test_19_selected_point_deep_study_fallback_stays_on_selected_point(
    app_client_factory: Any,
) -> None:
    engine = {
        "rootInfo": {"currentPlayer": "B", "scoreLead": 0.0, "visits": 64},
        "ownership": [0.0] * 361,
        "ownershipStdev": [0.1] * 361,
        "moveInfos": [{"move": "R16", "order": 0, "visits": 64, "pv": ["R16"]}],
    }
    with app_client_factory(katago19_analysis=engine) as (
        client,
        _katago9,
        openai,
        _local,
    ):
        game = client.post("/api/games", json={"board_size": 19, "mode": "human_companion"}).json()
        response = client.post(
            f"/api/games/{game['id']}/coach",
            json={
                "expected_revision": game["revision"],
                "question": "Study C16.",
                "selected_point": {"x": 2, "y": 3},
                "kind": "reflection",
                "client_request_id": "selected-c16-fallback-0001",
            },
        )

        assert response.status_code == 200, response.text
        payload = response.json()
        text = payload["message"]["text"]
        assert "Rules-verified legal candidate: C16." in text
        assert "R16" not in text
        for heading in (
            "Study focus:",
            "Why now:",
            "How it works:",
            "Gain:",
            "Tradeoff:",
            "Opponent response:",
            "Next steps:",
            "Reconsider when:",
            "Transferable principle:",
        ):
            assert heading in text
        assert payload["message"]["prompt"].startswith(
            "Which opponent reply would make you reconsider C16"
        )
        assert [item["coordinate"] for item in payload["candidates"]] == ["C16"]
        selected = payload["candidates"][0]
        assert selected["candidate_analysis"] == {
            "status": "unavailable",
            "profile": "quality",
            "source": "rules_verified_child_root",
            "reason_id": "quality_current_or_child_query_unavailable",
            "binding": selected["candidate_analysis"]["binding"],
        }
        assert selected["engine_analyzed"] is False
        assert "score" not in selected
        assert "evaluation" not in selected
        assert "engine_provenance" not in selected
        assert openai.coach_calls[-1]["candidates"][0]["coordinate"] == "C16"
        assert openai.coach_calls[-1]["candidates"][0]["candidate_analysis"]["status"] == (
            "unavailable"
        )
        loaded = client.get(f"/api/games/{game['id']}").json()
        assert loaded["revision"] == 1
        assert loaded["moves"] == []


@pytest.mark.asyncio
async def test_19_selected_child_reflection_rechecks_revision_after_quality_await(
    app_client_factory: Any,
    monkeypatch: Any,
) -> None:
    def engine(query: dict[str, Any]) -> dict[str, Any]:
        visits = 64
        if query["moves"]:
            return {
                "rootInfo": {"currentPlayer": "W", "scoreLead": 0.1, "visits": visits},
                "moveInfos": [{"move": "O17", "order": 0, "visits": visits, "pv": ["O17"]}],
            }
        return {
            "rootInfo": {"currentPlayer": "B", "scoreLead": 0.2, "visits": visits},
            "moveInfos": [{"move": "R16", "order": 0, "visits": visits, "pv": ["R16"]}],
        }

    with app_client_factory(katago19_analysis=engine) as (
        client,
        _katago9,
        openai,
        _local,
    ):
        game = client.post(
            "/api/games",
            json={"board_size": 19, "mode": "human_companion"},
        ).json()
        katago19 = client.app.state.katago19
        original_query = katago19.query
        child_entered = asyncio.Event()
        child_release = asyncio.Event()

        async def blocked_child(**query: Any) -> dict[str, Any]:
            if query["moves"]:
                child_entered.set()
                await child_release.wait()
            return await original_query(**query)

        monkeypatch.setattr(katago19, "query", blocked_child)
        service = client.app.state.game_service
        pending = asyncio.create_task(
            service.coach(
                game["id"],
                CoachQuestion(
                    expected_revision=game["revision"],
                    question="Analyze C16 without attaching stale child evidence.",
                    selected_point={"x": 2, "y": 3},
                    kind="reflection",
                    client_request_id="selected-child-cas-reflection-0001",
                ),
            )
        )
        await asyncio.wait_for(child_entered.wait(), timeout=1.0)
        moved = service.submit_move(
            game["id"],
            MoveRequest(
                actor_id="human",
                expected_revision=game["revision"],
                kind="play",
                point={"x": 3, "y": 3},
                client_request_id="selected-child-cas-move-0001",
            ),
        )
        assert moved["revision"] == 2
        child_release.set()

        with pytest.raises(RevisionConflict):
            await pending
        assert openai.coach_calls == []
        stored = client.app.state.game_store.get_game(game["id"])
        assert stored is not None
        assert stored["revision"] == 2
        assert stored["coach_messages"] == []


def test_finished_19_reflection_uses_quality_review_evidence_without_choices_or_mutation(
    app_client_factory: Any,
) -> None:
    def engine(query: dict[str, Any]) -> dict[str, Any]:
        assert query["profile"] == "quality"
        assert query["moves"] == [["B", "pass"], ["W", "pass"]]
        return {
            "rootInfo": {
                "currentPlayer": "B",
                "scoreLead": -7.5,
                "scoreStdev": 0.5,
                "winrate": 0.2,
                "visits": 64,
            },
            "ownership": [0.0] * 361,
            "ownershipStdev": [0.1] * 361,
            "moveInfos": [],
        }

    with app_client_factory(katago19_analysis=engine) as (
        client,
        _katago9,
        openai,
        _local,
    ):
        game = client.post(
            "/api/games",
            json={"board_size": 19, "mode": "two_player"},
        ).json()
        first_pass = client.post(
            f"/api/games/{game['id']}/moves",
            json={
                "actor_id": "black-human",
                "expected_revision": game["revision"],
                "kind": "pass",
                "client_request_id": "finished-review-first-pass-0001",
            },
        ).json()
        finished = client.post(
            f"/api/games/{game['id']}/moves",
            json={
                "actor_id": "white-human",
                "expected_revision": first_pass["revision"],
                "kind": "pass",
                "client_request_id": "finished-review-second-pass-0001",
            },
        ).json()
        assert finished["phase"] == "finished"

        response = client.post(
            f"/api/games/{game['id']}/coach",
            json={
                "expected_revision": finished["revision"],
                "question": "Review the finished game without inventing another move.",
                "kind": "reflection",
                "client_request_id": "finished-review-reflection-0001",
            },
        )

        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["engine_provenance"]["profile"] == "quality"
        assert payload["candidates"] == []
        assert "Study focus: game_review" in payload["message"]["text"]
        assert len(client.app.state.katago19.queries) == 1

        evidence = openai.coach_calls[-1]
        assert evidence["teaching_focus"]["primary"] == "game_review"
        assert evidence["engine"]["status"] == "ready"
        assert evidence["engine"]["score_lead_black"] == -7.5
        assert evidence["engine_provenance"]["binding"]["move_number"] == 2
        assert evidence["candidates"] == []
        assert evidence["game_review"]["binding"] == {
            "state_token": evidence["engine_provenance"]["binding"]["state_token"],
            "position_hash": evidence["engine_provenance"]["binding"]["position_hash"],
            "move_number": 2,
            "board_size": 19,
            "side_to_move": "black",
            "phase": "finished",
        }
        assert [item["coordinate"] for item in evidence["game_review"]["timeline"]] == [
            "pass",
            "pass",
        ]
        assert evidence["game_review"]["no_candidate_choices_after_finish"] is True
        encoded = json.dumps(evidence)
        for dense_field in ("ownership", "ownership_before", "ownership_after", "ownership_delta"):
            assert f'"{dense_field}"' not in encoded
        assert len(encoded.encode()) <= 22_000

        loaded = client.get(f"/api/games/{game['id']}").json()
        assert loaded["revision"] == finished["revision"]
        assert loaded["phase"] == "finished"
        assert [move["kind"] for move in loaded["moves"]] == ["pass", "pass"]


def test_resigned_19_review_discloses_static_position_projection(
    app_client_factory: Any,
) -> None:
    def engine(query: dict[str, Any]) -> dict[str, Any]:
        assert query["profile"] == "quality"
        assert query["moves"] == []
        assert query["initial_stones"] == []
        assert query["initial_player"] == "W"
        return {
            "rootInfo": {"currentPlayer": "W", "scoreLead": -7.5, "visits": 64},
            "moveInfos": [],
        }

    with app_client_factory(katago19_analysis=engine) as (
        client,
        _katago9,
        openai,
        _local,
    ):
        game = client.post(
            "/api/games",
            json={"board_size": 19, "mode": "two_player"},
        ).json()
        resigned = client.post(
            f"/api/games/{game['id']}/moves",
            json={
                "actor_id": "black-human",
                "expected_revision": game["revision"],
                "kind": "resign",
                "client_request_id": "finished-review-resign-0001",
            },
        ).json()
        assert resigned["phase"] == "finished"

        response = client.post(
            f"/api/games/{game['id']}/coach",
            json={
                "expected_revision": resigned["revision"],
                "question": "Review the resignation position honestly.",
                "kind": "reflection",
                "client_request_id": "finished-review-resign-reflection-0001",
            },
        )

        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["candidates"] == []
        assert payload["engine_provenance"]["binding"]["move_number"] == 0
        evidence = openai.coach_calls[-1]
        assert evidence["game_review"]["binding"]["move_number"] == 1
        assert evidence["game_review"]["result"] == {
            "reason": "resignation",
            "winner": "white",
            "resigned_by": "black",
        }
        assert evidence["game_review"]["timeline"] == [
            {
                "move_number": 1,
                "color": "black",
                "kind": "resign",
                "coordinate": "resign",
                "captured_count": 0,
            }
        ]
        assert evidence["engine"]["position_projection"] == {
            "kind": "current_board_setup_after_resignation",
            "same_stones_and_side_to_move": True,
            "historic_ko_context_encoded": False,
            "candidate_generation_allowed": False,
        }
        loaded = client.get(f"/api/games/{game['id']}").json()
        assert loaded["revision"] == resigned["revision"]
        assert [move["kind"] for move in loaded["moves"]] == ["resign"]


def test_19_preview_labels_the_fast_19_network(
    app_client_factory: Any,
    monkeypatch: Any,
) -> None:
    engine = {
        "rootInfo": {"currentPlayer": "B", "scoreLead": 0.0, "visits": 24},
        "ownership": [0.0] * 361,
        "ownershipStdev": [0.1] * 361,
        "moveInfos": [{"move": "D16", "order": 0, "visits": 24, "pv": ["D16"]}],
    }
    networks: list[str] = []
    original = game_service_module.GameService._analysis_payload

    def tracked_analysis_payload(
        state: Any,
        shortlist: Any,
        engine_evidence: Any,
        network: str,
    ) -> dict[str, Any]:
        networks.append(network)
        return original(state, shortlist, engine_evidence, network)

    monkeypatch.setattr(
        game_service_module.GameService,
        "_analysis_payload",
        staticmethod(tracked_analysis_payload),
    )
    with app_client_factory(katago19_analysis=engine) as (
        client,
        _katago9,
        _openai,
        _local,
    ):
        game = client.post("/api/games", json={"board_size": 19, "mode": "human_companion"}).json()
        response = client.post(
            f"/api/games/{game['id']}/preview",
            json={
                "x": 3,
                "y": 3,
                "actor_id": "human",
                "expected_revision": game["revision"],
            },
        )
        assert response.status_code == 200, response.text
        assert networks == ["b10c384h6nbttflrs.bin.gz"]


def test_19_engine_cache_key_is_independent_of_ui_rank_profile(
    app_client_factory: Any,
) -> None:
    engine = {
        "rootInfo": {"currentPlayer": "B", "scoreLead": 0.0, "visits": 24},
        "ownership": [0.0] * 361,
        "ownershipStdev": [0.1] * 361,
        "moveInfos": [{"move": "D16", "order": 0, "visits": 24, "pv": ["D16"]}],
    }
    with app_client_factory(katago19_analysis=engine) as (
        client,
        _katago9,
        _openai,
        _local,
    ):
        game = client.post("/api/games", json={"board_size": 19, "mode": "two_player"}).json()
        first = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": game["revision"]},
        )
        assert first.status_code == 200, first.text
        database = client.app.state.game_store.path
        with sqlite3.connect(database) as connection:
            connection.execute(
                "UPDATE games SET rank_profile=? WHERE id=?",
                ("rank_1d", game["id"]),
            )
        second = client.post(
            f"/api/games/{game['id']}/analysis",
            json={"expected_revision": game["revision"]},
        )
        assert second.status_code == 200, second.text
        assert len(client.app.state.katago19.queries) == 1
