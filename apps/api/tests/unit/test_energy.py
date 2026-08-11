from __future__ import annotations

import pytest

from weiqi.domain import (
    ENERGY_DISCLAIMER,
    Color,
    GroupSafety,
    Vertex,
    analyze_energy,
    explain_move_impact,
    explain_move_tactics,
    group_metrics,
    new_game,
    pass_turn,
    play,
)


def test_empty_board_has_zero_presence_and_tension_with_a_clear_disclaimer() -> None:
    energy = analyze_energy(new_game(size=9))

    assert len(energy.points) == 81
    assert all(point.presence == 0 for point in energy.points)
    assert all(point.tension == 0 for point in energy.points)
    assert energy.groups == ()
    assert energy.urgent_vertices == ()
    assert energy.disclaimer == ENERGY_DISCLAIMER
    assert "not territory" in energy.disclaimer


def test_presence_decays_with_distance_and_contested_points_gain_tension() -> None:
    black_only = analyze_energy(new_game(size=5, komi=0, initial_black=(Vertex(0, 2),)))
    assert black_only.point(Vertex(0, 2)).presence == 1.0
    assert 0 < black_only.point(Vertex(4, 2)).presence < black_only.point(Vertex(1, 2)).presence

    opposed = analyze_energy(
        new_game(
            size=5,
            komi=0,
            initial_black=(Vertex(0, 2),),
            initial_white=(Vertex(4, 2),),
        )
    )
    midpoint = opposed.point(Vertex(2, 2))
    assert midpoint.presence == 0
    assert midpoint.tension > 0
    assert opposed.point(Vertex(0, 2)).presence > 0
    assert opposed.point(Vertex(4, 2)).presence < 0


def test_group_metrics_mark_atari_and_make_stones_and_last_liberty_urgent() -> None:
    state = new_game(
        size=5,
        komi=0,
        initial_black=(Vertex(0, 0),),
        initial_white=(Vertex(1, 0),),
    )
    black = next(metric for metric in group_metrics(state) if metric.color is Color.BLACK)
    energy = analyze_energy(state)

    assert black.safety is GroupSafety.ATARI
    assert black.liberties == (Vertex(0, 1),)
    assert Vertex(0, 0) in energy.urgent_vertices
    assert Vertex(0, 1) in energy.urgent_vertices
    assert energy.point(Vertex(0, 1)).tension == 1.0


def test_capture_impact_is_concrete_and_never_changes_parent_state() -> None:
    before = new_game(
        size=5,
        komi=0,
        to_move=Color.BLACK,
        initial_black=(Vertex(0, 1), Vertex(1, 0), Vertex(2, 1)),
        initial_white=(Vertex(1, 1),),
    )
    after = play(before, Vertex(1, 2))
    impact = explain_move_impact(before, after)

    assert impact.captured == (Vertex(1, 1),)
    assert impact.self_group_size == 1
    assert impact.self_liberties >= 3
    assert "capture" in impact.teaching_tags
    assert "build-liberties" in impact.teaching_tags
    assert impact.mean_presence_change > 0
    assert before.black_captures == 0


def test_move_impact_detects_connection_escape_and_new_atari() -> None:
    connection = new_game(
        size=5,
        komi=0,
        initial_black=(Vertex(1, 2), Vertex(3, 2)),
        initial_white=(Vertex(4, 4),),
    )
    connection_impact = explain_move_impact(connection, play(connection, Vertex(2, 2)))
    assert connection_impact.friendly_groups_joined == 2
    assert "connect" in connection_impact.teaching_tags

    escape = new_game(
        size=5,
        komi=0,
        initial_black=(Vertex(1, 1),),
        initial_white=(Vertex(0, 1), Vertex(1, 0), Vertex(2, 1)),
    )
    escape_impact = explain_move_impact(escape, play(escape, Vertex(1, 2)))
    assert escape_impact.escaped_atari_groups == 1
    assert "escape" in escape_impact.teaching_tags

    pressure = new_game(
        size=5,
        komi=0,
        initial_black=(Vertex(0, 1), Vertex(1, 0)),
        initial_white=(Vertex(1, 1),),
    )
    pressure_impact = explain_move_impact(pressure, play(pressure, Vertex(2, 1)))
    assert pressure_impact.newly_atari_opponent_groups == 1
    assert "atari" in pressure_impact.teaching_tags


def test_pass_impact_is_structured_but_has_no_invented_board_effect() -> None:
    before = new_game()
    impact = explain_move_impact(before, pass_turn(before))

    assert impact.kind.value == "pass"
    assert impact.vertex is None
    assert impact.mean_presence_change == 0
    assert impact.teaching_tags == ("pass",)


def test_lightweight_tactics_match_every_exact_full_impact_field() -> None:
    positions = [
        new_game(
            size=5,
            komi=0,
            initial_black=(Vertex(0, 1), Vertex(1, 0), Vertex(2, 1)),
            initial_white=(Vertex(1, 1),),
        ),
        new_game(
            size=5,
            komi=0,
            initial_black=(Vertex(1, 2), Vertex(3, 2)),
            initial_white=(Vertex(4, 4),),
        ),
        new_game(
            size=5,
            komi=0,
            initial_black=(Vertex(1, 1),),
            initial_white=(Vertex(0, 1), Vertex(1, 0), Vertex(2, 1)),
        ),
        new_game(
            size=5,
            komi=0,
            initial_black=(Vertex(0, 1), Vertex(1, 0)),
            initial_white=(Vertex(1, 1),),
        ),
    ]
    children = [
        play(positions[0], Vertex(1, 2)),
        play(positions[1], Vertex(2, 2)),
        play(positions[2], Vertex(1, 2)),
        play(positions[3], Vertex(2, 1)),
    ]
    exact_fields = (
        "color",
        "kind",
        "vertex",
        "captured",
        "self_group_size",
        "self_liberties",
        "friendly_groups_joined",
        "escaped_atari_groups",
        "newly_atari_opponent_groups",
        "teaching_tags",
    )

    pass_before = new_game()
    cases = [*zip(positions, children, strict=True), (pass_before, pass_turn(pass_before))]
    for before, after in cases:
        tactics = explain_move_tactics(before, after)
        impact = explain_move_impact(before, after)
        assert {field: getattr(tactics, field) for field in exact_fields} == {
            field: getattr(impact, field) for field in exact_fields
        }


def test_impact_requires_a_direct_immutable_parent_child_pair() -> None:
    state = new_game()
    child = play(state, Vertex(0, 0))
    grandchild = play(child, Vertex(1, 0))
    with pytest.raises(ValueError, match="direct immutable child"):
        explain_move_impact(state, grandchild)


@pytest.mark.parametrize("decay", [0, 1, -0.5, 1.5])
def test_energy_rejects_unbounded_distance_decay(decay: float) -> None:
    with pytest.raises(ValueError):
        analyze_energy(new_game(), distance_decay=decay)
