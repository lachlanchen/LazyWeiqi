from __future__ import annotations

import hashlib
import json
import os
import secrets
from copy import deepcopy
from pathlib import Path
from typing import Any

import httpx
from pydantic import ValidationError

from ...config import Settings
from ...schemas import CoachDraft
from ..localllm.client import COACH_SYSTEM


def _candidate_id(item: dict[str, Any]) -> str | None:
    value = item.get("candidate_id", item.get("id"))
    return value if isinstance(value, str) else None


def _safety_identifier(data_dir: Path) -> str:
    marker = data_dir / ".provider-instance"
    if marker.exists() and marker.is_file() and not marker.is_symlink():
        raw = marker.read_text(encoding="ascii").strip()
    else:
        raw = secrets.token_hex(32)
        temporary = marker.with_suffix(".tmp")
        temporary.write_text(raw, encoding="ascii")
        os.chmod(temporary, 0o600)
        temporary.replace(marker)
        os.chmod(marker, 0o600)
    return "weiqi_" + hashlib.sha256(raw.encode("ascii")).hexdigest()[:32]


def _output_text(payload: dict[str, Any]) -> str:
    pieces: list[str] = []
    for item in payload.get("output", []):
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if isinstance(content, dict) and content.get("type") == "output_text":
                text = content.get("text")
                if isinstance(text, str):
                    pieces.append(text)
    result = "".join(pieces)
    if not result:
        raise ValueError("GPT-5.6 Sol returned no visible teaching object")
    return result


def _strict_response_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Normalize Pydantic JSON Schema for strict Responses structured output.

    Strict structured outputs require every object property to be listed in
    ``required``. Optional values remain nullable; collection defaults are sent
    explicitly by the model. JSON Schema ``default`` annotations are not part of
    the strict subset and are removed recursively.
    """

    normalized = deepcopy(schema)

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            node.pop("default", None)
            properties = node.get("properties")
            if node.get("type") == "object" and isinstance(properties, dict):
                node["additionalProperties"] = False
                node["required"] = list(properties)
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for value in node:
                visit(value)

    visit(normalized)
    return normalized


class OpenAIClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._enabled = settings.openai_api_key is not None
        key = settings.openai_api_key.get_secret_value() if settings.openai_api_key else "disabled"
        self._client = httpx.AsyncClient(
            base_url=settings.openai_base_url,
            headers={"Authorization": f"Bearer {key}"},
            timeout=httpx.Timeout(75.0, connect=5.0),
            trust_env=False,
            limits=httpx.Limits(max_connections=3, max_keepalive_connections=2),
        )
        self._safety_identifier = _safety_identifier(settings.prepare_data_dir())

    async def close(self) -> None:
        await self._client.aclose()

    async def status(self) -> dict[str, Any]:
        if not self._enabled:
            return {
                "available": False,
                "configured": False,
                "model": self._settings.openai_model,
                "reasoning_effort": self._settings.openai_reasoning_effort,
            }
        try:
            response = await self._client.get(f"/models/{self._settings.openai_model}")
            response.raise_for_status()
            return {
                "available": True,
                "configured": True,
                "model": self._settings.openai_model,
                "reasoning_effort": self._settings.openai_reasoning_effort,
            }
        except (httpx.HTTPError, ValueError):
            return {
                "available": False,
                "configured": True,
                "model": self._settings.openai_model,
                "reasoning_effort": self._settings.openai_reasoning_effort,
            }

    async def _response(
        self,
        *,
        instructions: str,
        input_text: str,
        schema_name: str,
        schema: dict[str, Any],
        max_output_tokens: int,
        effort: str | None = None,
    ) -> dict[str, Any]:
        if not self._enabled:
            raise RuntimeError("GPT-5.6 Sol is not configured")
        response = await self._client.post(
            "/responses",
            json={
                "model": self._settings.openai_model,
                "instructions": instructions,
                "input": input_text,
                "reasoning": {"effort": effort or self._settings.openai_reasoning_effort},
                "text": {
                    "verbosity": "low",
                    "format": {
                        "type": "json_schema",
                        "name": schema_name,
                        "strict": True,
                        "schema": schema,
                    },
                },
                "max_output_tokens": max_output_tokens,
                "store": False,
                "safety_identifier": self._safety_identifier,
            },
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("status") not in (None, "completed"):
            raise ValueError("GPT-5.6 Sol did not complete the teaching response")
        return json.loads(_output_text(payload))

    async def coach(self, evidence: dict[str, Any], *, review: bool = False) -> CoachDraft:
        encoded = json.dumps(evidence, ensure_ascii=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > 32_000:
            raise ValueError("teaching evidence exceeds the GPT-5.6 Sol envelope")
        parsed = await self._response(
            instructions=COACH_SYSTEM,
            input_text=encoded,
            schema_name="weiqi_coach",
            schema=_strict_response_schema(CoachDraft.model_json_schema()),
            max_output_tokens=2200,
            effort="high" if review else None,
        )
        try:
            draft = CoachDraft.model_validate(parsed)
        except ValidationError as exc:
            raise ValueError("GPT-5.6 Sol returned an invalid teaching object") from exc
        allowed = {
            candidate_id
            for item in evidence.get("candidates", [])
            if isinstance(item, dict) and (candidate_id := _candidate_id(item))
        }
        used = [choice.candidate_id for choice in draft.choices]
        if len(used) != len(set(used)) or any(candidate_id not in allowed for candidate_id in used):
            raise ValueError("GPT-5.6 Sol referenced an unknown or duplicate candidate")
        return draft

    async def choose_candidate(
        self,
        *,
        persona: str,
        rank_profile: str,
        candidates: list[dict[str, Any]],
        lesson_focus: str,
    ) -> str:
        allowed = [candidate_id for item in candidates if (candidate_id := _candidate_id(item))]
        if not allowed:
            raise ValueError("player selection requires at least one candidate")
        schema = {
            "type": "object",
            "properties": {
                "candidate_id": {"type": "string", "enum": allowed},
                "reason": {"type": "string", "minLength": 1, "maxLength": 240},
            },
            "required": ["candidate_id", "reason"],
            "additionalProperties": False,
        }
        prompt = json.dumps(
            {
                "task": "choose_one_legal_candidate",
                "persona": persona,
                "rank_profile": rank_profile,
                "lesson_focus": lesson_focus,
                "candidates": [
                    {**item, "candidate_id": _candidate_id(item)} for item in candidates
                ],
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        parsed = await self._response(
            instructions=(
                "You are a Weiqi player persona. Select exactly one supplied legal candidate ID. "
                "Prefer a level-appropriate move expressing the persona, not microscopic engine gain. "
                "Never invent coordinates, moves, tools, or rules."
            ),
            input_text=prompt,
            schema_name="weiqi_player_choice",
            schema=schema,
            max_output_tokens=300,
            effort="low",
        )
        candidate_id = parsed.get("candidate_id")
        if candidate_id not in allowed:
            raise ValueError("GPT-5.6 Sol selected an unknown candidate")
        return str(candidate_id)
