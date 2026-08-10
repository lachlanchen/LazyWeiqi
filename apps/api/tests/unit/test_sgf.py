from __future__ import annotations

import pytest

from weiqi.domain import (
    Color,
    GamePhase,
    Vertex,
    export_sgf,
    import_sgf,
    new_game,
    pass_turn,
    play,
    resign,
)


def test_sgf_round_trip_preserves_setup_moves_passes_board_and_result() -> None:
    state = new_game(
        size=9,
        komi=7.5,
        initial_black=(Vertex(2, 2),),
        initial_white=(Vertex(6, 6),),
    )
    state = play(state, Vertex(4, 4))
    state = play(state, Vertex(4, 5))
    state = pass_turn(state)
    state = pass_turn(state)

    encoded = export_sgf(state, game_name="First ] Journey")
    parsed = import_sgf(encoded)

    assert "GN[First \\] Journey]" in encoded
    assert parsed.game_name == "First ] Journey"
    assert parsed.state.size == state.size
    assert parsed.state.komi == state.komi
    assert parsed.state.board == state.board
    assert parsed.state.initial_board == state.initial_board
    assert parsed.state.phase is GamePhase.FINISHED
    assert [move.kind for move in parsed.state.history] == [move.kind for move in state.history]
    assert "RE[" not in encoded
    assert "no adjudicated result" in encoded


def test_sgf_text_round_trip_preserves_line_breaks_and_escape_characters() -> None:
    state = new_game(size=9)

    parsed = import_sgf(export_sgf(state, game_name="Line one\r\nLine ] two \\"))

    assert parsed.game_name == "Line one\nLine ] two \\"


def test_sgf_import_reads_top_level_main_sequence_and_ignores_variations() -> None:
    parsed = import_sgf(
        "(;GM[1]FF[4]SZ[9]KM[7.5]RU[Chinese]C[root];B[dd]C[first]"
        "(;W[ee]C[variation one])(;W[ff]C[variation two]))"
    )

    assert parsed.state.move_number == 1
    assert parsed.state.stones(Color.BLACK) == (Vertex(3, 3),)
    assert parsed.comments == ("root", "first")


def test_sgf_resignation_round_trip_records_winner() -> None:
    state = resign(new_game(size=9), actor_id="human")
    encoded = export_sgf(state)
    parsed = import_sgf(encoded)

    assert "RE[W+R]" in encoded
    assert parsed.state.winner is Color.WHITE
    assert parsed.state.resigned_by is Color.BLACK
    assert parsed.state.last_move is not None
    assert parsed.state.last_move.kind.value == "resign"


@pytest.mark.parametrize(
    "sgf",
    [
        "",
        "not an sgf",
        "(;GM[2]SZ[9])",
        "(;GM[1]SZ[9]RU[Japanese])",
        "(;GM[1]SZ[9];W[aa])",
        "(;GM[1]SZ[9];B[aa];W[aa])",
        "(;GM[1]SZ[9]C[unterminated)",
        "(;GM[1]SZ[9]) trailing",
    ],
)
def test_malformed_or_unsupported_sgf_is_rejected(sgf: str) -> None:
    with pytest.raises((ValueError, RuntimeError)):
        import_sgf(sgf)


def test_sgf_import_is_bounded() -> None:
    with pytest.raises(ValueError, match="size limit"):
        import_sgf("(" + "x" * 1_048_576 + ")")
