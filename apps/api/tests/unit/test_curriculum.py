from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from weiqi.domain import load_curriculum, parse_curriculum


def test_authored_curriculum_is_ordered_complete_and_beginner_first() -> None:
    curriculum = load_curriculum()

    assert curriculum.id == "first-journey"
    assert curriculum.default_board_size == 9
    assert len(curriculum.lessons) == 6
    assert [lesson.chapter for lesson in curriculum.lessons] == list(range(1, 7))
    assert curriculum.lessons[0].id == "open-ground"
    assert "liberty" in curriculum.lessons[0].concepts
    assert curriculum.lessons[-1].id == "finish-the-story"
    assert "area scoring" in curriculum.lessons[-1].concepts
    assert load_curriculum() is curriculum
    with pytest.raises(FrozenInstanceError):
        curriculum.title = "Changed"  # type: ignore[misc]


def test_lesson_lookup_is_strict() -> None:
    curriculum = load_curriculum()
    assert curriculum.lesson("pressure-and-escape").chapter == 3
    with pytest.raises(KeyError):
        curriculum.lesson("invented")


def test_curriculum_parser_rejects_unknown_fields_duplicate_ids_and_bad_order() -> None:
    valid = {
        "schema_version": 1,
        "id": "test-course",
        "title": "Test",
        "summary": "A small validated course.",
        "default_board_size": 9,
        "lessons": [
            {
                "id": "one",
                "chapter": 1,
                "title": "One",
                "story_hook": "Begin here.",
                "objective": "Learn one thing.",
                "concepts": ["liberty"],
                "remember": ["Count liberties."],
                "reflection": "What changed?",
            }
        ],
    }
    assert parse_curriculum(valid).lesson("one").title == "One"

    with pytest.raises(ValueError, match="extra"):
        parse_curriculum({**valid, "unexpected": True})

    duplicate = {**valid, "lessons": [valid["lessons"][0], valid["lessons"][0]]}
    with pytest.raises(ValueError, match="unique"):
        parse_curriculum(duplicate)

    wrong_order = {
        **valid,
        "lessons": [{**valid["lessons"][0], "chapter": 2}],
    }
    with pytest.raises(ValueError, match="consecutive"):
        parse_curriculum(wrong_order)
