"""Small immutable value types shared by the deterministic Weiqi domain."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Color(str, Enum):
    BLACK = "black"
    WHITE = "white"

    @property
    def opponent(self) -> Color:
        return Color.WHITE if self is Color.BLACK else Color.BLACK

    @property
    def gtp(self) -> str:
        return "B" if self is Color.BLACK else "W"

    @property
    def sgf(self) -> str:
        return "B" if self is Color.BLACK else "W"


class GamePhase(str, Enum):
    PLAYING = "playing"
    FINISHED = "finished"


class MoveKind(str, Enum):
    PLAY = "play"
    PASS = "pass"
    RESIGN = "resign"


@dataclass(frozen=True, order=True, slots=True)
class Vertex:
    """A zero-based board point: x from left, y from top."""

    x: int
    y: int

    def __post_init__(self) -> None:
        if isinstance(self.x, bool) or isinstance(self.y, bool):
            raise TypeError("vertex coordinates must be integers")
        if not isinstance(self.x, int) or not isinstance(self.y, int):
            raise TypeError("vertex coordinates must be integers")
        if self.x < 0 or self.y < 0:
            raise ValueError("vertex coordinates cannot be negative")


def require_board_size(size: int) -> int:
    if isinstance(size, bool) or not isinstance(size, int):
        raise TypeError("board size must be an integer")
    if not 2 <= size <= 19:
        raise ValueError("board size must be between 2 and 19")
    return size


def require_vertex(vertex: Vertex, size: int) -> Vertex:
    require_board_size(size)
    if not isinstance(vertex, Vertex):
        raise TypeError("vertex must be a Vertex")
    if vertex.x >= size or vertex.y >= size:
        raise ValueError(f"vertex ({vertex.x}, {vertex.y}) is outside a {size}x{size} board")
    return vertex
