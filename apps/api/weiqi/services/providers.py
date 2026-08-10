from __future__ import annotations

import asyncio
from typing import Any

from ..adapters.localllm.client import LocalLLMClient
from ..adapters.openai.client import OpenAIClient
from ..schemas import CoachDraft

PROVIDER_STATUS_TIMEOUT_SECONDS = 6.0


class TeachingProviders:
    """Quality-first provider router with private and deterministic fallbacks."""

    def __init__(
        self,
        openai: OpenAIClient,
        local: LocalLLMClient,
        *,
        allow_local_prose: bool = False,
    ) -> None:
        self.openai = openai
        self.local = local
        self.allow_local_prose = allow_local_prose

    async def status(self) -> dict[str, Any]:
        async def bounded(probe: Any, fallback: dict[str, Any]) -> dict[str, Any]:
            try:
                return await asyncio.wait_for(probe(), timeout=PROVIDER_STATUS_TIMEOUT_SECONDS)
            except asyncio.CancelledError:
                raise
            # Status is advisory and must fail soft even when an optional local
            # provider returns a structurally unexpected payload. Cancellation
            # remains the only exception that crosses this boundary.
            except Exception:
                return fallback

        openai_status, local_status = await asyncio.gather(
            bounded(self.openai.status, {"available": False, "configured": True}),
            bounded(self.local.status, {"available": False, "coach_ready": False}),
        )
        local_model_ready = bool(local_status.get("coach_ready"))
        local_status = {
            **local_status,
            "model_ready": local_model_ready,
            "prose_coaching_enabled": self.allow_local_prose,
            "coach_ready": local_model_ready and self.allow_local_prose,
        }
        return {
            "priority": ["gpt-5.6-sol", "deterministic", "localllm-opt-in"],
            "openai": openai_status,
            "localllm": local_status,
            "privacy_note": (
                "GPT-5.6 Sol requests send bounded board evidence, the current question, and at "
                "most four clipped active-branch dialogue pairs to OpenAI. "
                "LocalLLM and deterministic explanations remain on this workstation."
            ),
        }

    async def coach(
        self, evidence: dict[str, Any], *, review: bool = False
    ) -> tuple[CoachDraft | None, str, str | None]:
        try:
            return await self.openai.coach(evidence, review=review), "gpt-5.6-sol", None
        except Exception as openai_error:
            if self.allow_local_prose:
                try:
                    return (
                        await self.local.coach(evidence),
                        "localllm",
                        "GPT-5.6 Sol was unavailable; opt-in local prose was used and is labeled as model-generated.",
                    )
                except Exception:
                    pass
            return (
                None,
                "deterministic",
                f"Model coaching was unavailable; exact board facts remain usable ({type(openai_error).__name__}).",
            )

    async def choose_candidate(
        self,
        *,
        persona: str,
        rank_profile: str,
        candidates: list[dict[str, Any]],
        lesson_focus: str,
    ) -> tuple[str | None, str]:
        try:
            choice = await self.openai.choose_candidate(
                persona=persona,
                rank_profile=rank_profile,
                candidates=candidates,
                lesson_focus=lesson_focus,
            )
            return choice, "gpt-5.6-sol"
        except Exception:
            try:
                choice = await self.local.choose_candidate(
                    persona=persona,
                    rank_profile=rank_profile,
                    candidates=candidates,
                    lesson_focus=lesson_focus,
                )
                return choice, "localllm"
            except Exception:
                return None, "deterministic"
