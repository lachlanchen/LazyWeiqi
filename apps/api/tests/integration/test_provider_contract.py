from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from weiqi.adapters.localllm.client import LocalLLMClient
from weiqi.adapters.openai.client import OpenAIClient, _strict_response_schema
from weiqi.config import Settings
from weiqi.schemas import CoachDraft


def test_openai_coach_schema_is_normalized_for_strict_structured_output() -> None:
    schema = _strict_response_schema(CoachDraft.model_json_schema())

    assert set(schema["required"]) == set(schema["properties"])
    assert "default" not in schema["properties"]["uncertainty"]
    assert schema["additionalProperties"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("candidate_key", ["id", "candidate_id"])
async def test_openai_player_validates_the_public_candidate_id_field(
    tmp_path: Path, monkeypatch: Any, candidate_key: str
) -> None:
    settings = Settings(data_dir=tmp_path, openai_api_key="test-only-key")
    client = OpenAIClient(settings)

    async def response(**_kwargs: Any) -> dict[str, str]:
        return {"candidate_id": "m1", "reason": "The bridge shares liberties."}

    monkeypatch.setattr(client, "_response", response)
    try:
        selected = await client.choose_candidate(
            persona="River",
            rank_profile="rank_20k",
            candidates=[
                {candidate_key: "m0"},
                {candidate_key: "m1"},
                {candidate_key: "m2"},
            ],
            lesson_focus="Connect two stones.",
        )
    finally:
        await client.close()

    assert selected == "m1"


@pytest.mark.asyncio
async def test_local_player_validates_the_same_public_candidate_contract(
    tmp_path: Path, monkeypatch: Any
) -> None:
    settings = Settings(data_dir=tmp_path, openai_api_key=None)
    client = LocalLLMClient(settings)

    class GatewayResponse:
        @staticmethod
        def raise_for_status() -> None:
            return None

        @staticmethod
        def json() -> dict[str, Any]:
            return {
                "data": [
                    {
                        "id": settings.coach_model,
                        "target": "qwen3.5-test:latest",
                    }
                ]
            }

    class OllamaResponse:
        @staticmethod
        def raise_for_status() -> None:
            return None

        @staticmethod
        def json() -> dict[str, Any]:
            return {"message": {"content": '{"candidate_id":"m2","reason":"Flexible"}'}}

    async def get(*_args: Any, **_kwargs: Any) -> GatewayResponse:
        return GatewayResponse()

    ollama_calls: list[dict[str, Any]] = []

    async def post(*_args: Any, **kwargs: Any) -> OllamaResponse:
        ollama_calls.append(kwargs["json"])
        return OllamaResponse()

    monkeypatch.setattr(client._client, "get", get)
    monkeypatch.setattr(client._ollama, "post", post)
    try:
        selected = await client.choose_candidate(
            persona="River",
            rank_profile="rank_20k",
            candidates=[{"id": "m0"}, {"candidate_id": "m1"}, {"id": "m2"}],
            lesson_focus="Stay flexible.",
        )
    finally:
        await client.close()

    assert selected == "m2"
    assert ollama_calls[0]["model"] == "qwen3.5-test:latest"
    assert ollama_calls[0]["think"] is False
    assert ollama_calls[0]["format"]["properties"]["candidate_id"]["enum"] == [
        "m0",
        "m1",
        "m2",
    ]
