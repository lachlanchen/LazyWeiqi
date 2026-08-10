from __future__ import annotations

import pytest

from weiqi.domain import (
    Actor,
    ActorAuthorityError,
    ActorRole,
    CandidateSelection,
    Color,
    GameActors,
    GameMode,
    IllegalMoveError,
    IllegalMoveReason,
    MoveKind,
    Vertex,
    apply_candidate,
    candidate_for_action,
    default_game_actors,
    legal_candidates,
    new_game,
    pass_turn,
    point_at,
)


def test_default_human_companion_has_distinct_player_and_companion_agents() -> None:
    actors = default_game_actors()

    assert actors.mode is GameMode.HUMAN_COMPANION
    assert actors.player_for(Color.BLACK).role is ActorRole.HUMAN
    assert actors.player_for(Color.WHITE).role is ActorRole.PLAYER_AGENT
    companion = actors.actor("companion")
    assert companion.role is ActorRole.COMPANION_AGENT
    assert companion.color is None
    assert companion.aligned_with is Color.BLACK


def test_companion_and_narrator_agents_cannot_submit_moves() -> None:
    state = new_game()
    candidate = candidate_for_action(state, MoveKind.PLAY, Vertex(4, 4))
    selection = CandidateSelection(state.state_token, candidate.id, "companion")

    with pytest.raises(ActorAuthorityError, match="cannot submit"):
        apply_candidate(state, selection)

    narrated = new_game(actors=default_game_actors(GameMode.AGENT_VS_AGENT))
    narrated_candidate = candidate_for_action(narrated, MoveKind.PLAY, Vertex(4, 4))
    with pytest.raises(ActorAuthorityError, match="cannot submit"):
        apply_candidate(
            narrated,
            CandidateSelection(narrated.state_token, narrated_candidate.id, "narrator"),
        )


def test_player_agent_can_select_only_a_supplied_position_bound_candidate() -> None:
    state = new_game(actors=default_game_actors(GameMode.AGENT_VS_AGENT))
    candidates = legal_candidates(state)
    target = next(candidate for candidate in candidates if candidate.vertex == Vertex(4, 4))
    after = apply_candidate(
        state,
        CandidateSelection(state.state_token, target.id, "black-agent"),
    )

    assert point_at(after, Vertex(4, 4)) is Color.BLACK
    assert after.last_move.actor_id == "black-agent"  # type: ignore[union-attr]
    assert after.last_move.candidate_id == target.id  # type: ignore[union-attr]

    with pytest.raises(IllegalMoveError) as stale:
        apply_candidate(
            after,
            CandidateSelection(state.state_token, target.id, "white-agent"),
        )
    assert stale.value.reason is IllegalMoveReason.STALE_POSITION

    with pytest.raises(IllegalMoveError) as invented:
        apply_candidate(
            after,
            CandidateSelection(after.state_token, "cand_invented", "white-agent"),
        )
    assert invented.value.reason is IllegalMoveReason.UNKNOWN_CANDIDATE


def test_candidate_ids_are_unique_deterministic_and_change_with_position() -> None:
    state = new_game(size=9)
    first = legal_candidates(state)
    repeated = legal_candidates(state)

    assert first == repeated
    assert len(first) == 82  # 81 intersections plus pass; resignation is opt-in.
    assert len({candidate.id for candidate in first}) == len(first)
    assert all(candidate.position_hash == state.position_hash for candidate in first)
    assert all(candidate.state_token == state.state_token for candidate in first)

    move = next(candidate for candidate in first if candidate.vertex == Vertex(0, 0))
    after = apply_candidate(state, CandidateSelection(state.state_token, move.id, "human"))
    assert not {candidate.id for candidate in first} & {
        candidate.id for candidate in legal_candidates(after)
    }


def test_candidate_binding_changes_even_when_a_pass_leaves_board_hash_unchanged() -> None:
    state = new_game()
    before = legal_candidates(state)
    after_pass = pass_turn(state, actor_id="human")
    after = legal_candidates(after_pass)

    assert after_pass.position_hash == state.position_hash
    assert after_pass.state_token != state.state_token
    assert not {candidate.id for candidate in before} & {candidate.id for candidate in after}


def test_wrong_color_actor_cannot_take_the_turn() -> None:
    state = new_game()
    candidate = candidate_for_action(state, MoveKind.PASS)
    with pytest.raises(ActorAuthorityError, match="does not control"):
        apply_candidate(
            state,
            CandidateSelection(state.state_token, candidate.id, "sparring-agent"),
        )


def test_resignation_is_not_available_to_an_agent_unless_explicitly_allowed() -> None:
    state = new_game(actors=default_game_actors(GameMode.AGENT_VS_AGENT))
    resign_candidate = candidate_for_action(state, MoveKind.RESIGN)
    selection = CandidateSelection(state.state_token, resign_candidate.id, "black-agent")

    with pytest.raises(IllegalMoveError) as blocked:
        apply_candidate(state, selection)
    assert blocked.value.reason is IllegalMoveReason.UNKNOWN_CANDIDATE
    finished = apply_candidate(state, selection, allow_resign=True)
    assert finished.winner is Color.WHITE


def test_game_actor_schema_rejects_role_confusion_and_invalid_modes() -> None:
    with pytest.raises(ValueError, match="do not occupy"):
        Actor("helper", ActorRole.COMPANION_AGENT, "Helper", color=Color.BLACK)
    with pytest.raises(ValueError, match="safe lowercase"):
        Actor("BAD ID", ActorRole.HUMAN, "Player", color=Color.BLACK)

    black = Actor("black", ActorRole.HUMAN, "Black", color=Color.BLACK)
    white = Actor("white", ActorRole.PLAYER_AGENT, "White", color=Color.WHITE)
    with pytest.raises(ValueError, match="companion"):
        GameActors(GameMode.HUMAN_COMPANION, (black, white))
