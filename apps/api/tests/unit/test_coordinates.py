from __future__ import annotations

import pytest

from weiqi.domain import (
    Vertex,
    all_vertices,
    gtp_to_vertex,
    index_to_vertex,
    neighbors,
    sgf_to_vertex,
    vertex_to_gtp,
    vertex_to_index,
    vertex_to_sgf,
)


@pytest.mark.parametrize("size", [9, 13, 19])
def test_gtp_and_sgf_coordinates_round_trip_every_intersection(size: int) -> None:
    for vertex in all_vertices(size):
        assert gtp_to_vertex(vertex_to_gtp(vertex, size), size) == vertex
        assert sgf_to_vertex(vertex_to_sgf(vertex, size), size) == vertex
        assert index_to_vertex(vertex_to_index(vertex, size), size) == vertex


def test_gtp_uses_bottom_origin_and_skips_column_i() -> None:
    assert vertex_to_gtp(Vertex(0, 0), 9) == "A9"
    assert vertex_to_gtp(Vertex(8, 8), 9) == "J1"
    assert vertex_to_gtp(Vertex(18, 18), 19) == "T1"
    assert gtp_to_vertex("j1", 9) == Vertex(8, 8)
    assert vertex_to_gtp(None, 9) == "pass"
    assert gtp_to_vertex(" PASS ", 9) is None


def test_sgf_uses_top_left_origin_and_empty_pass() -> None:
    assert vertex_to_sgf(Vertex(0, 0), 9) == "aa"
    assert vertex_to_sgf(Vertex(8, 8), 9) == "ii"
    assert sgf_to_vertex("", 9) is None


def test_neighbor_order_is_stable_and_bounded() -> None:
    assert tuple(neighbors(Vertex(0, 0), 9)) == (Vertex(1, 0), Vertex(0, 1))
    assert tuple(neighbors(Vertex(2, 2), 9)) == (
        Vertex(1, 2),
        Vertex(3, 2),
        Vertex(2, 1),
        Vertex(2, 3),
    )


@pytest.mark.parametrize(
    ("parser", "value", "size"),
    [
        (gtp_to_vertex, "I4", 9),
        (gtp_to_vertex, "A0", 9),
        (gtp_to_vertex, "T1", 9),
        (sgf_to_vertex, "a", 9),
        (sgf_to_vertex, "jj", 9),
    ],
)
def test_invalid_or_out_of_range_coordinates_are_rejected(parser, value: str, size: int) -> None:
    with pytest.raises(ValueError):
        parser(value, size)


def test_vertex_rejects_boolean_float_negative_and_out_of_range_coordinates() -> None:
    with pytest.raises(TypeError):
        Vertex(True, 0)
    with pytest.raises(TypeError):
        Vertex(1.5, 0)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        Vertex(-1, 0)
    with pytest.raises(ValueError):
        vertex_to_index(Vertex(9, 0), 9)
