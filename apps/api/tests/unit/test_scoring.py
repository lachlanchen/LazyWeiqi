from __future__ import annotations

from weiqi.domain import (
    Color,
    Vertex,
    chinese_area_score,
    empty_regions,
    new_game,
    pass_turn,
    play,
    resign,
)


def test_empty_board_is_neutral_and_komi_wins_for_white() -> None:
    state = new_game(size=9, komi=7.5)
    score = chinese_area_score(state)

    assert score.black_total == 0
    assert score.white_total == 7.5
    assert score.neutral_points == 81
    assert score.winner is Color.WHITE
    assert score.margin == 7.5
    assert score.result == "W+7.5"


def test_chinese_area_counts_stones_surrounded_space_and_neutral_regions() -> None:
    state = new_game(
        size=3,
        komi=0,
        initial_black=(Vertex(0, 1), Vertex(1, 0)),
        initial_white=(Vertex(2, 1), Vertex(1, 2)),
    )
    score = chinese_area_score(state)

    assert score.black_stones == 2
    assert score.white_stones == 2
    assert score.black_territory == 1
    assert score.white_territory == 1
    assert score.neutral_points == 3
    assert score.black_total == score.white_total == 3
    assert score.winner is None
    assert score.result == "0"
    assert Vertex(0, 0) in score.black_owned
    assert Vertex(2, 2) in score.white_owned
    assert Vertex(1, 1) in score.neutral


def test_region_boundaries_are_reported_for_explanation() -> None:
    state = new_game(
        size=3,
        komi=0,
        initial_black=(Vertex(0, 1), Vertex(1, 0)),
        initial_white=(Vertex(2, 1), Vertex(1, 2)),
    )
    regions = empty_regions(state)

    black_corner = next(region for region in regions if Vertex(0, 0) in region.points)
    center = next(region for region in regions if Vertex(1, 1) in region.points)
    assert black_corner.owner is Color.BLACK
    assert center.owner is None
    assert center.bordering_colors == frozenset({Color.BLACK, Color.WHITE})


def test_capture_counts_do_not_add_prisoner_points_under_chinese_area_scoring() -> None:
    state = new_game(
        size=5,
        komi=0,
        initial_black=(Vertex(0, 1), Vertex(1, 0), Vertex(2, 1)),
        initial_white=(Vertex(1, 1),),
    )
    state = play(state, Vertex(1, 2))
    score = chinese_area_score(state)

    assert state.black_captures == 1
    assert score.black_total == score.black_stones + score.black_territory
    assert score.black_total != score.black_stones + score.black_territory + state.black_captures


def test_two_passes_allow_a_mechanical_area_snapshot_and_resignation_uses_r() -> None:
    two_passes = pass_turn(pass_turn(new_game(size=9, komi=7.5)))
    # All stones are treated as present. This is useful for teaching the area
    # count, but is not an adjudicated result until dead stones are settled.
    assert chinese_area_score(two_passes).result == "W+7.5"

    resigned = resign(new_game(size=9), actor_id="human")
    score = chinese_area_score(resigned)
    assert score.winner is Color.WHITE
    assert score.margin is None
    assert score.result == "W+R"
