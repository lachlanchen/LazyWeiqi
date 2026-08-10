from __future__ import annotations

from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

SafeText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
SafeActorId = Annotated[
    str, StringConstraints(strip_whitespace=True, pattern=r"^[a-z0-9][a-z0-9_-]{0,63}$")
]
SafeRequestId = Annotated[
    str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9_-]{8,100}$")
]
GameId = Annotated[str, StringConstraints(pattern=r"^game_[0-9a-f]{32}$")]
NodeId = Annotated[str, StringConstraints(pattern=r"^node_[0-9a-f]{32}$")]
BoardSize = Literal[5, 7, 9, 13, 19]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GameMode(str, Enum):
    HUMAN_VS_AGENT = "human_vs_agent"
    HUMAN_COMPANION = "human_companion"
    AGENT_VS_AGENT = "agent_vs_agent"
    TWO_PLAYER = "two_player"


class AgentDoctrine(str, Enum):
    BALANCED = "balanced"
    TERRITORY = "territory"
    INFLUENCE = "influence"
    FIGHTING = "fighting"
    LIGHT = "light"


class CompanionStyle(str, Enum):
    SOCRATIC = "socratic"
    ENCOURAGING = "encouraging"
    CONCISE = "concise"


class Intent(str, Enum):
    CLAIM = "claim"
    CONNECT = "connect"
    CUT = "cut"
    PRESSURE = "pressure"
    ESCAPE = "escape"
    SETTLE = "settle"
    INVADE = "invade"
    REDUCE = "reduce"
    SACRIFICE = "sacrifice"
    ENDGAME = "endgame"
    UNSURE = "unsure"


class Point(StrictModel):
    x: int = Field(ge=0, le=18)
    y: int = Field(ge=0, le=18)


class AgentConfiguration(StrictModel):
    persona: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    doctrine: AgentDoctrine = AgentDoctrine.BALANCED


class CompanionConfiguration(StrictModel):
    persona: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    style: CompanionStyle = CompanionStyle.SOCRATIC


class GameCreate(StrictModel):
    lesson_id: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, pattern=r"^[a-z0-9][a-z0-9._-]{0,79}$")
        ]
        | None
    ) = None
    board_size: BoardSize = 9
    mode: GameMode = GameMode.HUMAN_COMPANION
    human_color: Literal["black", "white"] = "black"
    black_agent: AgentConfiguration = Field(
        default_factory=lambda: AgentConfiguration(persona="Mountain", doctrine="territory")
    )
    white_agent: AgentConfiguration = Field(
        default_factory=lambda: AgentConfiguration(persona="River", doctrine="balanced")
    )
    companion: CompanionConfiguration = Field(
        default_factory=lambda: CompanionConfiguration(persona="Lantern", style="socratic")
    )


class GameDeleteRequest(StrictModel):
    expected_revision: int = Field(ge=1)


class PreviewRequest(StrictModel):
    x: int = Field(ge=0, le=18)
    y: int = Field(ge=0, le=18)
    actor_id: SafeActorId
    expected_revision: int = Field(ge=1)
    intent: Intent = Intent.UNSURE


class MoveRequest(StrictModel):
    actor_id: SafeActorId
    expected_revision: int = Field(ge=1)
    kind: Literal["play", "pass", "resign"] = "play"
    point: Point | None = None
    intent: Intent = Intent.UNSURE
    client_request_id: SafeRequestId | None = None

    @model_validator(mode="after")
    def validate_kind_point(self) -> MoveRequest:
        if self.kind == "play" and self.point is None:
            raise ValueError("play requires a point")
        if self.kind != "play" and self.point is not None:
            raise ValueError("pass and resign do not accept a point")
        return self


class AgentTurnRequest(StrictModel):
    expected_revision: int = Field(ge=1)
    actor_id: SafeActorId | None = None
    doctrine: AgentDoctrine | None = None
    delegated_by: SafeActorId | None = None
    candidate_id: Annotated[str, StringConstraints(pattern=r"^m[0-9]{1,2}$")] | None = None
    client_request_id: SafeRequestId | None = None


class RewindRequest(StrictModel):
    expected_revision: int = Field(ge=1)
    to_move_number: int = Field(ge=0, le=1000)


class CoachQuestion(StrictModel):
    expected_revision: int = Field(ge=1)
    question: SafeText
    selected_point: Point | None = None
    intent: Intent = Intent.UNSURE
    kind: Literal["hint", "explain", "narrate", "reflection"] = "explain"
    client_request_id: SafeRequestId | None = None


class CandidateChoice(StrictModel):
    candidate_id: Annotated[str, StringConstraints(pattern=r"^m[0-9]{1,2}$")]
    intent: Literal["build", "fight", "escape", "connect", "reduce", "tenuki"]
    title: Annotated[str, StringConstraints(min_length=1, max_length=60)]
    reason: Annotated[str, StringConstraints(min_length=1, max_length=300)]
    risk: Annotated[str, StringConstraints(min_length=1, max_length=240)]


class CoachPrinciple(StrictModel):
    name: Annotated[str, StringConstraints(min_length=1, max_length=60)]
    explanation: Annotated[str, StringConstraints(min_length=1, max_length=500)]


class CoachDraft(StrictModel):
    schema_version: Literal[1]
    headline: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    story: Annotated[str, StringConstraints(min_length=1, max_length=700)]
    principle: CoachPrinciple
    what_changed: list[Annotated[str, StringConstraints(min_length=1, max_length=240)]] = Field(
        min_length=1, max_length=3
    )
    remember: Annotated[str, StringConstraints(min_length=1, max_length=240)]
    choices: list[CandidateChoice] = Field(default_factory=list, max_length=3)
    reflection_question: Annotated[str, StringConstraints(min_length=1, max_length=240)]
    uncertainty: Annotated[str, StringConstraints(max_length=240)] | None = None


class ApiError(StrictModel):
    detail: str
    code: str | None = None


JsonObject = dict[str, Any]
