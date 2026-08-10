"""Coordinate conversion helpers for the UI, GTP/KataGo, and SGF."""

from __future__ import annotations

import re
from collections.abc import Iterator

from .core_types import Vertex, require_board_size, require_vertex

GTP_COLUMNS = "ABCDEFGHJKLMNOPQRSTUVWXYZ"
SGF_COLUMNS = "abcdefghijklmnopqrstuvwxyz"
_GTP_VERTEX = re.compile(r"^([A-HJ-Z])(\d{1,2})$", re.IGNORECASE)


def vertex_to_index(vertex: Vertex, size: int) -> int:
    require_vertex(vertex, size)
    return vertex.y * size + vertex.x


def index_to_vertex(index: int, size: int) -> Vertex:
    require_board_size(size)
    if isinstance(index, bool) or not isinstance(index, int):
        raise TypeError("board index must be an integer")
    if not 0 <= index < size * size:
        raise ValueError("board index is out of range")
    return Vertex(index % size, index // size)


def all_vertices(size: int) -> tuple[Vertex, ...]:
    require_board_size(size)
    return tuple(Vertex(x, y) for y in range(size) for x in range(size))


def neighbors(vertex: Vertex, size: int) -> Iterator[Vertex]:
    require_vertex(vertex, size)
    if vertex.x > 0:
        yield Vertex(vertex.x - 1, vertex.y)
    if vertex.x + 1 < size:
        yield Vertex(vertex.x + 1, vertex.y)
    if vertex.y > 0:
        yield Vertex(vertex.x, vertex.y - 1)
    if vertex.y + 1 < size:
        yield Vertex(vertex.x, vertex.y + 1)


def vertex_to_gtp(vertex: Vertex | None, size: int) -> str:
    require_board_size(size)
    if vertex is None:
        return "pass"
    require_vertex(vertex, size)
    return f"{GTP_COLUMNS[vertex.x]}{size - vertex.y}"


def gtp_to_vertex(value: str, size: int) -> Vertex | None:
    require_board_size(size)
    if not isinstance(value, str):
        raise TypeError("GTP coordinate must be text")
    normalized = value.strip()
    if normalized.lower() == "pass":
        return None
    match = _GTP_VERTEX.fullmatch(normalized)
    if not match:
        raise ValueError(f"invalid GTP coordinate {value!r}")
    column, row_text = match.groups()
    column_index = GTP_COLUMNS.find(column.upper())
    row = int(row_text)
    if column_index < 0 or column_index >= size or not 1 <= row <= size:
        raise ValueError(f"GTP coordinate {value!r} is outside a {size}x{size} board")
    return Vertex(column_index, size - row)


def vertex_to_sgf(vertex: Vertex | None, size: int) -> str:
    require_board_size(size)
    if vertex is None:
        return ""
    require_vertex(vertex, size)
    return SGF_COLUMNS[vertex.x] + SGF_COLUMNS[vertex.y]


def sgf_to_vertex(value: str, size: int) -> Vertex | None:
    require_board_size(size)
    if not isinstance(value, str):
        raise TypeError("SGF coordinate must be text")
    if value == "":
        return None
    if len(value) != 2 or any(character not in SGF_COLUMNS for character in value):
        raise ValueError(f"invalid SGF coordinate {value!r}")
    vertex = Vertex(SGF_COLUMNS.index(value[0]), SGF_COLUMNS.index(value[1]))
    require_vertex(vertex, size)
    return vertex


def escape_sgf_value(value: str) -> str:
    """Escape a simple-text SGF property value without changing its meaning."""

    if not isinstance(value, str):
        raise TypeError("SGF property values must be text")
    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    return normalized.replace("\\", "\\\\").replace("]", "\\]")
