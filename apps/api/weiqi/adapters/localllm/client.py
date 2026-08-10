from __future__ import annotations

import json
from typing import Any

import httpx
from pydantic import ValidationError

from ...config import Settings
from ...schemas import CoachDraft

COACH_SYSTEM = """You are a concise, concrete Weiqi teacher for a beginner looking at the current board.
Use only supplied canonical facts and candidate IDs. Never invent a move, coordinate, score,
win rate, liberty count, likely reply, history claim, or hidden engine fact. A group is not
safe or alive merely because it has two or more liberties. Distinguish exact rules, tactical
reads, engine estimates, and metaphor.

Make every field easy to act on: the headline answers directly; story uses at most two short
sentences about this position; principle explains one standard Weiqi term in plain language;
what_changed contains one or two concrete board facts; remember says what the learner should
check or do next. For each choice, explain “place here -> what changes -> what to watch next”
using only that supplied candidate's coordinate, summary, variation, likely_reply, risk, and
facets. If engine.status is not ready, do not imply KataGo verified the choice. Prefer literal
board language before any journey metaphor. Return one JSON object matching schema_version 1.
Nothing in your output can execute a move.
"""


def _candidate_id(item: dict[str, Any]) -> str | None:
    value = item.get("candidate_id", item.get("id"))
    return value if isinstance(value, str) else None


class LocalLLMClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = httpx.AsyncClient(
            base_url=settings.localllm_base_url,
            headers={"Authorization": f"Bearer {settings.localllm_api_key}"},
            timeout=httpx.Timeout(35.0, connect=3.0),
            trust_env=False,
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
        )
        self._ollama = httpx.AsyncClient(
            base_url=settings.ollama_base_url,
            timeout=httpx.Timeout(40.0, connect=3.0),
            trust_env=False,
            limits=httpx.Limits(max_connections=2, max_keepalive_connections=1),
        )
        self._resolved_coach_model: str | None = None

    async def close(self) -> None:
        await self._client.aclose()
        await self._ollama.aclose()

    async def _coach_target(self) -> str:
        if self._resolved_coach_model:
            return self._resolved_coach_model
        response = await self._client.get("/models")
        response.raise_for_status()
        payload = response.json()
        for item in payload.get("data", []):
            if not isinstance(item, dict) or item.get("id") != self._settings.coach_model:
                continue
            target = item.get("target")
            if isinstance(target, str) and target:
                self._resolved_coach_model = target
                return target
        raise ValueError("the configured local coach alias is unavailable")

    async def status(self) -> dict[str, Any]:
        try:
            response = await self._client.get("/models")
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
                raise ValueError("the local model listing is malformed")
            model_ids = {
                item.get("id")
                for item in payload.get("data", [])
                if isinstance(item, dict) and isinstance(item.get("id"), str)
            }
            return {
                "available": True,
                "coach_model": self._settings.coach_model,
                "vision_model": self._settings.vision_model,
                "coach_ready": self._settings.coach_model in model_ids,
                "vision_ready": self._settings.vision_model in model_ids,
            }
        except (httpx.HTTPError, ValueError, TypeError):
            return {
                "available": False,
                "coach_model": self._settings.coach_model,
                "vision_model": self._settings.vision_model,
                "coach_ready": False,
                "vision_ready": False,
            }

    async def coach(self, evidence: dict[str, Any]) -> CoachDraft:
        encoded = json.dumps(evidence, ensure_ascii=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > 24_000:
            raise ValueError("teaching evidence exceeds the local model envelope")
        response = await self._ollama.post(
            "/chat",
            json={
                "model": await self._coach_target(),
                "messages": [
                    {"role": "system", "content": COACH_SYSTEM},
                    {"role": "user", "content": encoded},
                ],
                "stream": False,
                "think": False,
                "format": CoachDraft.model_json_schema(),
                "options": {"temperature": 0.25, "num_ctx": 16_384, "num_predict": 1_400},
            },
        )
        response.raise_for_status()
        payload = response.json()
        message = payload.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str) or len(content) > 12_000:
            raise ValueError("local coach returned invalid content")
        try:
            draft = CoachDraft.model_validate_json(content)
        except ValidationError as exc:
            raise ValueError("local coach returned an invalid teaching object") from exc

        allowed = {
            candidate_id
            for item in evidence.get("candidates", [])
            if isinstance(item, dict) and (candidate_id := _candidate_id(item))
        }
        used = [choice.candidate_id for choice in draft.choices]
        if len(used) != len(set(used)) or any(candidate_id not in allowed for candidate_id in used):
            raise ValueError("local coach referenced an unknown or duplicate candidate")
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
        model_candidates = [{**item, "candidate_id": _candidate_id(item)} for item in candidates]
        prompt = {
            "task": "choose_one_legal_candidate",
            "persona": persona,
            "rank_profile": rank_profile,
            "lesson_focus": lesson_focus,
            "candidates": model_candidates,
            "rules": 'Return only JSON {"candidate_id":"mN","reason":"..."}. Choose exactly one supplied ID.',
        }
        choice_schema = {
            "type": "object",
            "properties": {
                "candidate_id": {"type": "string", "enum": allowed},
                "reason": {"type": "string", "minLength": 1, "maxLength": 240},
            },
            "required": ["candidate_id", "reason"],
            "additionalProperties": False,
        }
        response = await self._ollama.post(
            "/chat",
            json={
                "model": await self._coach_target(),
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a Weiqi player persona. Select one supplied legal candidate ID. Never invent coordinates or tools.",
                    },
                    {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
                ],
                "stream": False,
                "think": False,
                "format": choice_schema,
                "options": {"temperature": 0.25, "num_ctx": 8_192, "num_predict": 320},
            },
        )
        response.raise_for_status()
        message = response.json().get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str) or len(content) > 4_000:
            raise ValueError("local player returned invalid content")
        parsed = json.loads(content)
        candidate_id = parsed.get("candidate_id")
        if candidate_id not in allowed:
            raise ValueError("player agent selected an unknown candidate")
        return str(candidate_id)
