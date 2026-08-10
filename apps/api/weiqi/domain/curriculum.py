"""Validated authored curriculum used by the teaching journey."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

_SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


@dataclass(frozen=True, slots=True)
class Lesson:
    id: str
    chapter: int
    title: str
    story_hook: str
    objective: str
    concepts: tuple[str, ...]
    remember: tuple[str, ...]
    reflection: str


@dataclass(frozen=True, slots=True)
class Curriculum:
    schema_version: int
    id: str
    title: str
    summary: str
    default_board_size: int
    lessons: tuple[Lesson, ...]

    def lesson(self, lesson_id: str) -> Lesson:
        for lesson in self.lessons:
            if lesson.id == lesson_id:
                return lesson
        raise KeyError(f"unknown lesson {lesson_id!r}")


def _strict_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    keys = set(value)
    if keys != expected:
        missing = sorted(expected - keys)
        extra = sorted(keys - expected)
        raise ValueError(f"{label} fields are invalid; missing={missing}, extra={extra}")


def _text(value: object, label: str, *, maximum: int = 800) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be text")
    normalized = " ".join(value.split())
    if not normalized or len(normalized) > maximum:
        raise ValueError(f"{label} must contain 1 to {maximum} visible characters")
    return normalized


def _text_list(value: object, label: str, *, maximum_items: int = 8) -> tuple[str, ...]:
    if not isinstance(value, list) or not 1 <= len(value) <= maximum_items:
        raise ValueError(f"{label} must contain 1 to {maximum_items} entries")
    result = tuple(_text(item, f"{label} item", maximum=240) for item in value)
    if len(result) != len(set(result)):
        raise ValueError(f"{label} cannot contain duplicates")
    return result


def parse_curriculum(payload: object) -> Curriculum:
    if not isinstance(payload, dict):
        raise ValueError("curriculum root must be an object")
    _strict_keys(
        payload,
        {"schema_version", "id", "title", "summary", "default_board_size", "lessons"},
        "curriculum",
    )
    if payload["schema_version"] != 1:
        raise ValueError("unsupported curriculum schema version")
    curriculum_id = _text(payload["id"], "curriculum id", maximum=64)
    if not _SAFE_ID.fullmatch(curriculum_id):
        raise ValueError("curriculum id is invalid")
    board_size = payload["default_board_size"]
    if isinstance(board_size, bool) or board_size not in {9, 13, 19}:
        raise ValueError("default board size must be 9, 13, or 19")
    raw_lessons = payload["lessons"]
    if not isinstance(raw_lessons, list) or not 1 <= len(raw_lessons) <= 30:
        raise ValueError("curriculum must contain 1 to 30 lessons")

    lessons = []
    seen_ids: set[str] = set()
    for index, raw_lesson in enumerate(raw_lessons, start=1):
        if not isinstance(raw_lesson, dict):
            raise ValueError("lesson must be an object")
        _strict_keys(
            raw_lesson,
            {
                "id",
                "chapter",
                "title",
                "story_hook",
                "objective",
                "concepts",
                "remember",
                "reflection",
            },
            f"lesson {index}",
        )
        lesson_id = _text(raw_lesson["id"], "lesson id", maximum=64)
        if not _SAFE_ID.fullmatch(lesson_id) or lesson_id in seen_ids:
            raise ValueError("lesson ids must be unique safe identifiers")
        seen_ids.add(lesson_id)
        if raw_lesson["chapter"] != index:
            raise ValueError("lesson chapters must be consecutive and ordered")
        lessons.append(
            Lesson(
                id=lesson_id,
                chapter=index,
                title=_text(raw_lesson["title"], "lesson title", maximum=100),
                story_hook=_text(raw_lesson["story_hook"], "story hook"),
                objective=_text(raw_lesson["objective"], "lesson objective"),
                concepts=_text_list(raw_lesson["concepts"], "lesson concepts"),
                remember=_text_list(raw_lesson["remember"], "lesson memory"),
                reflection=_text(raw_lesson["reflection"], "lesson reflection"),
            )
        )
    return Curriculum(
        schema_version=1,
        id=curriculum_id,
        title=_text(payload["title"], "curriculum title", maximum=120),
        summary=_text(payload["summary"], "curriculum summary"),
        default_board_size=board_size,
        lessons=tuple(lessons),
    )


@lru_cache(maxsize=1)
def load_curriculum() -> Curriculum:
    path = Path(__file__).with_name("curriculum.json")
    try:
        raw = path.read_text(encoding="utf-8")
        payload = json.loads(raw)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("authored curriculum could not be loaded") from exc
    return parse_curriculum(payload)
