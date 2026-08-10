"""Bounded SGF main-line import and deterministic export helpers."""

from __future__ import annotations

from dataclasses import dataclass

from .coordinates import escape_sgf_value, sgf_to_vertex, vertex_to_sgf
from .core_types import Color, MoveKind
from .rules import GameState, new_game, pass_turn, play, resign
from .scoring import chinese_area_score

MAX_SGF_CHARS = 1_048_576
MAX_SGF_NODES = 1_000
MAX_SGF_PROPERTY_CHARS = 65_536


@dataclass(frozen=True, slots=True)
class ParsedSgf:
    state: GameState
    game_name: str | None
    black_name: str | None
    white_name: str | None
    comments: tuple[str, ...]


def _property(name: str, values: tuple[str, ...]) -> str:
    return name + "".join(f"[{escape_sgf_value(value)}]" for value in values)


def export_sgf(
    state: GameState,
    *,
    game_name: str | None = None,
    application: str = "WeiqiTeacher:1",
) -> str:
    root = [
        _property("GM", ("1",)),
        _property("FF", ("4",)),
        _property("CA", ("UTF-8",)),
        _property("AP", (application,)),
        _property("ST", ("2",)),
        _property("SZ", (str(state.size),)),
        _property("KM", (f"{state.komi:g}",)),
        _property("RU", ("Chinese",)),
    ]
    if game_name:
        root.append(_property("GN", (game_name,)))
    root.append(_property("PB", (state.actors.player_for(Color.BLACK).name,)))
    root.append(_property("PW", (state.actors.player_for(Color.WHITE).name,)))
    black_setup = tuple(
        vertex_to_sgf(vertex, state.size) for vertex in state.initial_stones(Color.BLACK)
    )
    white_setup = tuple(
        vertex_to_sgf(vertex, state.size) for vertex in state.initial_stones(Color.WHITE)
    )
    if black_setup:
        root.append(_property("AB", black_setup))
    if white_setup:
        root.append(_property("AW", white_setup))
    if state.history and state.history[0].color is Color.WHITE:
        root.append(_property("PL", ("W",)))
    if state.result_reason is not None:
        root.append(_property("RE", (chinese_area_score(state).result,)))

    nodes = [";" + "".join(root)]
    for move in state.history:
        if move.kind in {MoveKind.PLAY, MoveKind.PASS}:
            nodes.append(f";{move.color.sgf}[{vertex_to_sgf(move.vertex, state.size)}]")
    return "(" + "".join(nodes) + ")"


def _parse_nodes(text: str) -> list[dict[str, tuple[str, ...]]]:
    if not isinstance(text, str):
        raise TypeError("SGF must be text")
    if not text or len(text) > MAX_SGF_CHARS:
        raise ValueError("SGF is empty or exceeds the size limit")
    cursor = 0
    depth = 0
    nodes: list[dict[str, tuple[str, ...]]] = []
    current: dict[str, tuple[str, ...]] | None = None

    def skip_space(index: int) -> int:
        while index < len(text) and text[index].isspace():
            index += 1
        return index

    cursor = skip_space(cursor)
    if cursor >= len(text) or text[cursor] != "(":
        raise ValueError("SGF collection must begin with a game tree")

    while cursor < len(text):
        character = text[cursor]
        if character.isspace():
            cursor += 1
            continue
        if character == "(":
            depth += 1
            cursor += 1
            continue
        if character == ")":
            if depth <= 0:
                raise ValueError("SGF has an unmatched closing parenthesis")
            depth -= 1
            current = None
            cursor += 1
            if depth == 0:
                if text[cursor:].strip():
                    raise ValueError("only one SGF game tree is supported")
                break
            continue
        if character == ";":
            current = {}
            if depth == 1:
                if len(nodes) >= MAX_SGF_NODES:
                    raise ValueError("SGF exceeds the node limit")
                nodes.append(current)
            cursor += 1
            continue
        if not character.isalpha() or not character.isupper():
            raise ValueError(f"unexpected SGF token at character {cursor}")

        start = cursor
        while cursor < len(text) and text[cursor].isalpha() and text[cursor].isupper():
            cursor += 1
        identifier = text[start:cursor]
        values: list[str] = []
        cursor = skip_space(cursor)
        while cursor < len(text) and text[cursor] == "[":
            cursor += 1
            value: list[str] = []
            while cursor < len(text):
                token = text[cursor]
                if token == "]":
                    cursor += 1
                    break
                if token == "\\":
                    cursor += 1
                    if cursor >= len(text):
                        raise ValueError("SGF property ends with an escape")
                    escaped = text[cursor]
                    if escaped == "\r":
                        cursor += 1
                        if cursor < len(text) and text[cursor] == "\n":
                            cursor += 1
                        continue
                    if escaped == "\n":
                        cursor += 1
                        continue
                    value.append(escaped)
                    cursor += 1
                    continue
                value.append(token)
                cursor += 1
                if len(value) > MAX_SGF_PROPERTY_CHARS:
                    raise ValueError("SGF property exceeds the value limit")
            else:
                raise ValueError("SGF property is missing a closing bracket")
            values.append("".join(value))
            cursor = skip_space(cursor)
        if not values:
            raise ValueError(f"SGF property {identifier} has no value")
        if depth == 1 and current is not None:
            if identifier in current:
                raise ValueError(f"duplicate SGF property {identifier} in one node")
            current[identifier] = tuple(values)

    if depth != 0:
        raise ValueError("SGF has an unclosed game tree")
    if not nodes:
        raise ValueError("SGF contains no main-line nodes")
    return nodes


def _one(
    properties: dict[str, tuple[str, ...]], name: str, default: str | None = None
) -> str | None:
    values = properties.get(name)
    if values is None:
        return default
    if len(values) != 1:
        raise ValueError(f"SGF property {name} must contain one value")
    return values[0]


def import_sgf(text: str) -> ParsedSgf:
    nodes = _parse_nodes(text)
    root = nodes[0]
    if _one(root, "GM", "1") != "1":
        raise ValueError("SGF game is not Go")
    try:
        size = int(_one(root, "SZ", "19") or "19")
        komi = float(_one(root, "KM", "0") or "0")
    except ValueError as exc:
        raise ValueError("SGF board size and komi must be numeric") from exc
    rules = (_one(root, "RU", "Chinese") or "Chinese").lower()
    if rules not in {"chinese", "cn", "tromp-taylor", "tromp_taylor"}:
        raise ValueError("only Chinese-area-compatible SGF rules are supported")
    initial_black = tuple(sgf_to_vertex(value, size) for value in root.get("AB", ()))
    initial_white = tuple(sgf_to_vertex(value, size) for value in root.get("AW", ()))
    if any(vertex is None for vertex in (*initial_black, *initial_white)):
        raise ValueError("setup stones cannot use the SGF pass coordinate")
    player = (_one(root, "PL", "B") or "B").upper()
    if player not in {"B", "W"}:
        raise ValueError("SGF PL must be B or W")
    state = new_game(
        size=size,
        komi=komi,
        to_move=Color.BLACK if player == "B" else Color.WHITE,
        initial_black=tuple(vertex for vertex in initial_black if vertex is not None),
        initial_white=tuple(vertex for vertex in initial_white if vertex is not None),
    )
    comments: list[str] = []
    if comment := _one(root, "C"):
        comments.append(comment)

    for node in nodes[1:]:
        move_properties = [(name, node[name]) for name in ("B", "W") if name in node]
        if len(move_properties) > 1:
            raise ValueError("an SGF node cannot contain both B and W moves")
        if move_properties:
            name, values = move_properties[0]
            if len(values) != 1:
                raise ValueError("an SGF move property must contain one value")
            color = Color.BLACK if name == "B" else Color.WHITE
            if color is not state.to_move:
                raise ValueError("SGF move color does not match the deterministic turn")
            vertex = sgf_to_vertex(values[0], state.size)
            state = pass_turn(state) if vertex is None else play(state, vertex)
        if comment := _one(node, "C"):
            comments.append(comment)

    result = (_one(root, "RE") or "").upper()
    if result in {"B+R", "W+R", "B+RESIGN", "W+RESIGN"} and state.result_reason is None:
        winner = Color.BLACK if result.startswith("B+") else Color.WHITE
        if state.to_move is not winner.opponent:
            raise ValueError("SGF resignation result conflicts with the side to move")
        state = resign(state)

    return ParsedSgf(
        state=state,
        game_name=_one(root, "GN"),
        black_name=_one(root, "PB"),
        white_name=_one(root, "PW"),
        comments=tuple(comments),
    )
