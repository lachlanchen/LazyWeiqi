"""Participant metadata and move-authority checks.

Player agents and companion agents are deliberately different types. A
companion or narrator may explain a position but can never be the actor that
submits a move to the deterministic rules engine.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum

from .core_types import Color

_ACTOR_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


class ActorRole(str, Enum):
    HUMAN = "human"
    PLAYER_AGENT = "player_agent"
    COMPANION_AGENT = "companion_agent"
    NARRATOR_AGENT = "narrator_agent"

    @property
    def can_play(self) -> bool:
        return self in {ActorRole.HUMAN, ActorRole.PLAYER_AGENT}


class GameMode(str, Enum):
    HUMAN_VS_AGENT = "human_vs_agent"
    HUMAN_COMPANION = "human_companion"
    AGENT_VS_AGENT = "agent_vs_agent"
    HUMAN_VS_HUMAN = "human_vs_human"


@dataclass(frozen=True, slots=True)
class Actor:
    id: str
    role: ActorRole
    name: str
    color: Color | None = None
    aligned_with: Color | None = None

    def __post_init__(self) -> None:
        if not _ACTOR_ID.fullmatch(self.id):
            raise ValueError("actor id must be a safe lowercase identifier")
        cleaned_name = " ".join(self.name.split())
        if not cleaned_name or len(cleaned_name) > 80:
            raise ValueError("actor name must contain 1 to 80 visible characters")
        object.__setattr__(self, "name", cleaned_name)

        if self.role.can_play:
            if self.color is None:
                raise ValueError("a human or player agent must occupy a color")
            if self.aligned_with is not None and self.aligned_with is not self.color:
                raise ValueError("a playing actor cannot be aligned with the other color")
        elif self.color is not None:
            raise ValueError("companion and narrator agents do not occupy a color")


@dataclass(frozen=True, slots=True)
class GameActors:
    mode: GameMode
    actors: tuple[Actor, ...]

    def __post_init__(self) -> None:
        if not self.actors:
            raise ValueError("a game must define actors")
        ids = [actor.id for actor in self.actors]
        if len(ids) != len(set(ids)):
            raise ValueError("actor ids must be unique")

        players = [actor for actor in self.actors if actor.role.can_play]
        black = [actor for actor in players if actor.color is Color.BLACK]
        white = [actor for actor in players if actor.color is Color.WHITE]
        if len(black) != 1 or len(white) != 1:
            raise ValueError("exactly one playing actor must occupy each color")

        human_count = sum(actor.role is ActorRole.HUMAN for actor in players)
        player_agent_count = sum(actor.role is ActorRole.PLAYER_AGENT for actor in players)
        companions = [
            actor
            for actor in self.actors
            if actor.role in {ActorRole.COMPANION_AGENT, ActorRole.NARRATOR_AGENT}
        ]

        if self.mode is GameMode.HUMAN_VS_AGENT:
            if human_count != 1 or player_agent_count != 1:
                raise ValueError("human_vs_agent needs one human and one player agent")
        elif self.mode is GameMode.HUMAN_COMPANION:
            if human_count != 1 or player_agent_count != 1:
                raise ValueError("human_companion needs one human and one sparring player agent")
            if not any(actor.role is ActorRole.COMPANION_AGENT for actor in companions):
                raise ValueError("human_companion needs a non-playing companion agent")
            human_color = next(actor.color for actor in players if actor.role is ActorRole.HUMAN)
            if not any(
                actor.role is ActorRole.COMPANION_AGENT and actor.aligned_with is human_color
                for actor in companions
            ):
                raise ValueError("the companion must be aligned with the human player")
        elif self.mode is GameMode.AGENT_VS_AGENT:
            if human_count != 0 or player_agent_count != 2:
                raise ValueError("agent_vs_agent needs two player agents")
            if not any(actor.role is ActorRole.NARRATOR_AGENT for actor in companions):
                raise ValueError("agent_vs_agent needs a non-playing narrator agent")
        elif self.mode is GameMode.HUMAN_VS_HUMAN:
            if human_count != 2 or player_agent_count != 0:
                raise ValueError("human_vs_human needs two human players")

    def actor(self, actor_id: str) -> Actor:
        for actor in self.actors:
            if actor.id == actor_id:
                return actor
        raise ActorAuthorityError(f"unknown actor {actor_id!r}")

    def player_for(self, color: Color) -> Actor:
        return next(actor for actor in self.actors if actor.role.can_play and actor.color is color)

    def require_turn_actor(self, actor_id: str, color: Color) -> Actor:
        actor = self.actor(actor_id)
        if not actor.role.can_play:
            raise ActorAuthorityError(f"{actor.role.value} cannot submit moves")
        if actor.color is not color:
            raise ActorAuthorityError(f"actor {actor.id!r} does not control {color.value}")
        return actor


class ActorAuthorityError(ValueError):
    """Raised when an actor tries to mutate a game without move authority."""


def default_game_actors(
    mode: GameMode = GameMode.HUMAN_COMPANION,
    *,
    human_color: Color = Color.BLACK,
) -> GameActors:
    other = human_color.opponent
    human = Actor("human", ActorRole.HUMAN, "You", color=human_color)
    sparring = Actor("sparring-agent", ActorRole.PLAYER_AGENT, "River", color=other)

    if mode is GameMode.HUMAN_VS_AGENT:
        return GameActors(mode, (human, sparring))
    if mode is GameMode.HUMAN_COMPANION:
        companion = Actor(
            "companion",
            ActorRole.COMPANION_AGENT,
            "Lantern",
            aligned_with=human_color,
        )
        return GameActors(mode, (human, sparring, companion))
    if mode is GameMode.AGENT_VS_AGENT:
        black = Actor("black-agent", ActorRole.PLAYER_AGENT, "Mountain", color=Color.BLACK)
        white = Actor("white-agent", ActorRole.PLAYER_AGENT, "River", color=Color.WHITE)
        narrator = Actor("narrator", ActorRole.NARRATOR_AGENT, "Lantern")
        return GameActors(mode, (black, white, narrator))
    if mode is GameMode.HUMAN_VS_HUMAN:
        black = Actor("black-human", ActorRole.HUMAN, "Black", color=Color.BLACK)
        white = Actor("white-human", ActorRole.HUMAN, "White", color=Color.WHITE)
        return GameActors(mode, (black, white))
    raise ValueError(f"unsupported game mode {mode!r}")
