from __future__ import annotations

import random
from dataclasses import FrozenInstanceError

import pytest

from weiqi.domain import (
    Color,
    GamePhase,
    IllegalMoveError,
    IllegalMoveReason,
    ResultReason,
    Vertex,
    board_groups,
    chinese_area_score,
    group_at,
    legal_vertices,
    new_game,
    pass_turn,
    play,
    point_at,
    replay_and_validate,
    resign,
)


def test_new_9x9_game_is_an_immutable_snapshot_with_every_point_legal() -> None:
    state = new_game()

    assert state.size == 9
    assert state.to_move is Color.BLACK
    assert state.board == (None,) * 81
    assert len(legal_vertices(state)) == 81
    assert state.position_hash in state.seen_position_hashes
    with pytest.raises(FrozenInstanceError):
        state.to_move = Color.WHITE  # type: ignore[misc]


def test_play_returns_a_new_state_and_preserves_the_parent() -> None:
    before = new_game()
    after = play(before, Vertex(4, 4), actor_id="human")

    assert point_at(before, Vertex(4, 4)) is None
    assert point_at(after, Vertex(4, 4)) is Color.BLACK
    assert after.to_move is Color.WHITE
    assert after.move_number == 1
    assert after.last_move is not None
    assert after.last_move.actor_id == "human"
    assert after.last_move.position_hash_before == before.position_hash
    assert after.history == (after.last_move,)


def test_single_stone_capture_updates_board_capture_count_and_history() -> None:
    state = new_game(
        size=5,
        komi=0,
        to_move=Color.BLACK,
        initial_black=(Vertex(0, 1), Vertex(1, 0), Vertex(2, 1)),
        initial_white=(Vertex(1, 1),),
    )
    after = play(state, Vertex(1, 2))

    assert point_at(after, Vertex(1, 1)) is None
    assert after.black_captures == 1
    assert after.last_move is not None
    assert after.last_move.captured == (Vertex(1, 1),)
    assert group_at(after, Vertex(1, 2)).liberties  # type: ignore[union-attr]


def test_multi_group_capture_can_make_an_apparent_suicide_legal() -> None:
    state = new_game(
        size=3,
        komi=0,
        to_move=Color.BLACK,
        initial_black=(Vertex(2, 0), Vertex(1, 1), Vertex(0, 2)),
        initial_white=(Vertex(1, 0), Vertex(0, 1)),
    )
    after = play(state, Vertex(0, 0))

    assert set(after.last_move.captured) == {Vertex(1, 0), Vertex(0, 1)}  # type: ignore[union-attr]
    assert after.black_captures == 2
    assert point_at(after, Vertex(0, 0)) is Color.BLACK


def test_suicide_occupied_and_out_of_bounds_moves_are_rejected_with_reasons() -> None:
    state = new_game(
        size=3,
        komi=0,
        initial_white=(Vertex(0, 1), Vertex(1, 0), Vertex(2, 1), Vertex(1, 2)),
    )
    with pytest.raises(IllegalMoveError) as suicide:
        play(state, Vertex(1, 1))
    assert suicide.value.reason is IllegalMoveReason.SUICIDE

    occupied = new_game(size=3, initial_black=(Vertex(0, 0),))
    with pytest.raises(IllegalMoveError) as occupied_error:
        play(occupied, Vertex(0, 0))
    assert occupied_error.value.reason is IllegalMoveReason.OCCUPIED

    with pytest.raises(IllegalMoveError) as bounds:
        play(new_game(size=3), Vertex(3, 0))
    assert bounds.value.reason is IllegalMoveReason.OUT_OF_BOUNDS


def test_simple_ko_is_marked_and_positional_superko_rejects_immediate_recapture() -> None:
    state = new_game(
        size=5,
        komi=0,
        to_move=Color.BLACK,
        initial_black=(Vertex(0, 2), Vertex(2, 2), Vertex(1, 3)),
        initial_white=(Vertex(1, 2), Vertex(0, 1), Vertex(2, 1), Vertex(1, 0)),
    )
    captured = play(state, Vertex(1, 1))

    assert captured.ko_point == Vertex(1, 2)
    assert point_at(captured, Vertex(1, 2)) is None
    with pytest.raises(IllegalMoveError) as recapture:
        play(captured, Vertex(1, 2))
    assert recapture.value.reason is IllegalMoveReason.SUPERKO


def test_pass_can_repeat_a_board_play_resets_pass_count_and_two_passes_finish() -> None:
    start = new_game()
    one_pass = pass_turn(start, actor_id="human")
    assert one_pass.position_hash == start.position_hash
    assert one_pass.consecutive_passes == 1
    continued = play(one_pass, Vertex(4, 4), actor_id="sparring-agent")
    assert continued.consecutive_passes == 0

    first = pass_turn(continued, actor_id="human")
    finished = pass_turn(first, actor_id="sparring-agent")
    assert finished.phase is GamePhase.FINISHED
    assert finished.result_reason is ResultReason.TWO_PASSES
    assert finished.winner is None
    with pytest.raises(IllegalMoveError) as error:
        play(finished, Vertex(0, 0))
    assert error.value.reason is IllegalMoveReason.GAME_FINISHED


def test_resignation_records_the_actor_and_opponent_as_winner() -> None:
    state = new_game()
    finished = resign(state, actor_id="human")

    assert finished.phase is GamePhase.FINISHED
    assert finished.result_reason is ResultReason.RESIGNATION
    assert finished.resigned_by is Color.BLACK
    assert finished.winner is Color.WHITE
    assert finished.last_move.actor_id == "human"  # type: ignore[union-attr]
    assert replay_and_validate(finished) is finished


def test_group_collection_reports_shared_liberties_without_duplicates() -> None:
    state = new_game(
        size=5,
        initial_black=(Vertex(1, 1), Vertex(2, 1), Vertex(2, 2)),
        initial_white=(Vertex(4, 4),),
    )
    groups = board_groups(state)
    black = next(group for group in groups if group.color is Color.BLACK)

    assert len(black.stones) == 3
    assert len(black.liberties) == 7
    assert black.anchor == Vertex(1, 1)


def test_invalid_initial_setup_is_rejected() -> None:
    with pytest.raises(ValueError, match="overlap"):
        new_game(size=9, initial_black=(Vertex(0, 0),), initial_white=(Vertex(0, 0),))
    with pytest.raises(ValueError, match="duplicates"):
        new_game(size=9, initial_black=(Vertex(0, 0), Vertex(0, 0)))
    with pytest.raises(ValueError, match="outside"):
        new_game(size=9, initial_black=(Vertex(9, 0),))


@pytest.mark.parametrize("seed", range(12))
def test_seeded_legal_games_preserve_rules_and_scoring_partition_invariants(seed: int) -> None:
    rng = random.Random(seed)
    state = new_game(size=5, komi=5.5)
    for _turn in range(60):
        if state.phase is GamePhase.FINISHED:
            break
        parent_board = state.board
        parent_history = state.history
        vertices = legal_vertices(state)
        if vertices and rng.random() > 0.08:
            state = play(state, rng.choice(vertices))
        else:
            state = pass_turn(state)

        assert parent_board is not state.board or state.last_move.kind.value == "pass"  # type: ignore[union-attr]
        assert len(parent_history) + 1 == len(state.history)
        assert state.position_hash in state.seen_position_hashes
        assert state.move_number == len(state.history)
        assert all(group.liberties for group in board_groups(state))

        score = chinese_area_score(state)
        assert (
            len(score.black_owned) + len(score.white_owned) + len(score.neutral)
            == state.size * state.size
        )
        assert not (score.black_owned & score.white_owned)
        assert not (score.black_owned & score.neutral)
        assert not (score.white_owned & score.neutral)
