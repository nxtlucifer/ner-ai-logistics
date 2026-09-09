"""Gemini Developer API Server-Side Proxy Service.

Implements the official Gemini Developer API proxy with:
- Server-side API key protection (key NEVER exposed to clients)
- Free-Tier rate limit management (10 RPM per driver)
- Prompt injection & secret exfiltration defenses
- Medical diagnosis & navigation authority refusals
- Structured JSON output contract
- Deterministic offline fallback on 429 quota exhaustion or network timeout
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Final, Literal

import httpx

from app.core.config import get_settings
from app.domain import ai_prompts

log = logging.getLogger(__name__)

GEMINI_API_BASE: Final = "https://generativelanguage.googleapis.com/v1beta/models"

SeverityKind = Literal["INFO", "WARNING", "CRITICAL"]
SourceModeKind = Literal["LIVE_DATA", "CACHED_DATA", "GENERAL"]


@dataclass(frozen=True, slots=True)
class GeminiStatus:
    available: bool
    provider: str | None
    model: str | None
    detail: str | None
    free_tier: bool = True


@dataclass(frozen=True, slots=True)
class GeminiResponse:
    answer: str
    severity: SeverityKind = "INFO"
    source_mode: SourceModeKind = "LIVE_DATA"
    actions: list[str] = field(default_factory=list)
    disclaimer: str | None = None
    model: str | None = None


class RateLimiter:
    """Sliding-window in-memory rate limiter per driver."""

    def __init__(self, max_requests: int = 10, window_seconds: float = 60.0):
        self._max = max_requests
        self._window = window_seconds
        self._history: dict[str, list[float]] = {}
        self._lock = asyncio.Lock()

    async def acquire(self, key: str) -> bool:
        now = time.monotonic()
        async with self._lock:
            timestamps = self._history.setdefault(key, [])
            # Prune old timestamps
            self._history[key] = [t for t in timestamps if now - t < self._window]
            if len(self._history[key]) >= self._max:
                return False
            self._history[key].append(now)
            return True


_limiter = RateLimiter(max_requests=10, window_seconds=60.0)


async def status() -> GeminiStatus:
    """Check whether Gemini is configured on this server."""
    settings = get_settings()
    if not settings.AI_ENABLED:
        return GeminiStatus(
            available=False,
            provider=None,
            model=None,
            detail="AI features are disabled by configuration.",
        )

    key = settings.GEMINI_API_KEY
    if not key or not key.strip():
        return GeminiStatus(
            available=False,
            provider="OFFLINE_ASSISTANT",
            model=None,
            detail="Gemini API key is not configured on the server. Offline driver assistant is active.",
        )

    return GeminiStatus(
        available=True,
        provider="GOOGLE_GEMINI",
        model=settings.GEMINI_MODEL,
        detail=None,
        free_tier=True,
    )


def _deterministic_offline_answer(
    user_query: str,
    mode: str,
    reason: str = "Operating in offline assistant mode.",
) -> GeminiResponse:
    """Deterministic local fallback library for offline or quota-exhausted states."""
    lower = user_query.lower()

    if "emergency" in lower or "accident" in lower or "sos" in lower:
        return GeminiResponse(
            answer="In an emergency, stop safely and call 112 immediately. For medical emergencies call 108, and for highway assistance call 1033.",
            severity="CRITICAL",
            source_mode="CACHED_DATA",
            actions=["OPEN_SAFETY_GUIDE", "CONTACT_DISPATCH"],
            disclaimer=reason,
        )

    if "weather" in lower or "rain" in lower or "monsoon" in lower:
        return GeminiResponse(
            answer="Live weather data is currently unavailable. General heavy-rain precautions: exercise extreme caution on ghat sections and watch for slope movement during rainfall.",
            severity="WARNING",
            source_mode="CACHED_DATA",
            actions=["OPEN_SAFETY_GUIDE"],
            disclaimer=reason,
        )

    if "landslide" in lower or "risk" in lower or "hazard" in lower:
        return GeminiResponse(
            answer="Live terrain and landslide reports are currently unavailable. General hill-driving guidance: stay on the approved corridor, keep safe following distance, and reduce speed on blind curves.",
            severity="WARNING",
            source_mode="CACHED_DATA",
            actions=["OPEN_SAFETY_GUIDE"],
            disclaimer=reason,
        )

    if "break" in lower or "rest" in lower or "tired" in lower or "fatigue" in lower:
        return GeminiResponse(
            answer="Driver safety regulations recommend a 30-minute rest break after every 4 hours of continuous driving. Hydrate and check your vehicle.",
            severity="INFO",
            source_mode="CACHED_DATA",
            actions=["RECORD_BREAK", "OPEN_SAFETY_GUIDE"],
            disclaimer=reason,
        )

    if "trip" in lower or "status" in lower or "stop" in lower:
        return GeminiResponse(
            answer="Review your active trip details, assigned vehicle, and delivery stops in the Trip tab.",
            severity="INFO",
            source_mode="CACHED_DATA",
            actions=["OPEN_TRIP"],
            disclaimer=reason,
        )

    return GeminiResponse(
        answer="I am your offline logistics assistant. You can check trip status, view safety guides, log rest breaks, or access emergency helplines.",
        severity="INFO",
        source_mode="CACHED_DATA",
        actions=["OPEN_SAFETY_GUIDE"],
        disclaimer=reason,
    )


async def generate(
    *,
    system: str,
    user: str,
    driver_id: str = "anonymous",
    mode: str = "assistant",
    max_output_tokens: int | None = None,
) -> GeminiResponse:
    """Generate a response using Gemini API with security, rate-limiting, and offline fallback."""
    settings = get_settings()

    # 1. Security Filter: Prompt Injection
    if ai_prompts.is_injection_attempt(user):
        log.warning("Blocked prompt injection attempt: %s...", user[:50])
        return GeminiResponse(
            answer="I am your logistics helper and follow strict safety boundaries. I cannot ignore my operating guidelines.",
            severity="WARNING",
            source_mode="GENERAL",
            disclaimer="Prompt injection filter triggered.",
        )

    # 2. Security Filter: Credential Exfiltration
    if ai_prompts.is_credential_request(user):
        log.warning("Blocked credential request: %s...", user[:50])
        return GeminiResponse(
            answer="Access to internal database credentials, secret keys, and system tokens is strictly prohibited.",
            severity="WARNING",
            source_mode="GENERAL",
            disclaimer="Security policy restriction.",
        )

    # 3. Safety Filter: Medical Diagnosis Refusal
    if ai_prompts.is_medical_diagnosis_attempt(user):
        return GeminiResponse(
            answer="I cannot provide medical diagnoses, medicine dosages, or prescriptions. If you or someone nearby is unwell, please contact 108 (Ambulance) or 112 immediately.",
            severity="CRITICAL",
            source_mode="GENERAL",
            actions=["OPEN_SAFETY_GUIDE"],
            disclaimer="Medical safety protocol.",
        )

    # 4. Safety Filter: Navigation Authority Usurpation Refusal
    if ai_prompts.is_navigation_authority_attempt(user):
        return GeminiResponse(
            answer="Turn-by-turn guidance and official road closure decisions are managed strictly by the deterministic navigation engine and fleet dispatch. Please follow the Navigate tab.",
            severity="WARNING",
            source_mode="GENERAL",
            actions=["OPEN_SAFETY_GUIDE", "CONTACT_DISPATCH"],
            disclaimer="Navigation authority protocol.",
        )

    # 5. Rate Limiting Check (Free-Tier Protection)
    allowed = await _limiter.acquire(driver_id)
    if not allowed:
        log.info("Driver %s exceeded rate limit; falling back to offline answer", driver_id)
        return _deterministic_offline_answer(
            user,
            mode=mode,
            reason="Free-tier rate limit reached (10 requests/min). Showing offline assistance.",
        )

    # 6. Check if Gemini API key is available
    key = settings.GEMINI_API_KEY
    if not key or not key.strip():
        return _deterministic_offline_answer(
            user,
            mode=mode,
            reason="Gemini API key is not configured on the server. Showing offline guidance.",
        )

    # 7. Construct Request to Gemini Developer API
    model = settings.GEMINI_MODEL
    url = f"{GEMINI_API_BASE}/{model}:generateContent?key={key}"
    timeout = settings.GEMINI_TIMEOUT_SECONDS
    max_tokens = max_output_tokens or settings.GEMINI_MAX_OUTPUT_TOKENS

    payload: dict[str, Any] = {
        "system_instruction": {
            "parts": [{"text": system}],
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user}],
            }
        ],
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "temperature": 0.2,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=payload)

        if resp.status_code == 429:
            log.warning("Gemini API quota exhausted (HTTP 429). Falling back gracefully.")
            return _deterministic_offline_answer(
                user,
                mode=mode,
                reason="Gemini free-tier quota exhausted. Offline assistant is active.",
            )

        if resp.status_code != 200:
            log.warning("Gemini API returned HTTP %d: %s", resp.status_code, resp.text[:100])
            return _deterministic_offline_answer(
                user,
                mode=mode,
                reason=f"Gemini service returned HTTP {resp.status_code}. Offline assistant active.",
            )

        data = resp.json()
        candidates = data.get("candidates", [])
        if not candidates:
            return _deterministic_offline_answer(user, mode=mode, reason="No answer candidate returned.")

        text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
        if not text:
            return _deterministic_offline_answer(user, mode=mode, reason="Empty text returned.")

        return GeminiResponse(
            answer=text,
            severity="INFO",
            source_mode="LIVE_DATA",
            actions=[],
            disclaimer=None,
            model=model,
        )

    except httpx.TimeoutException:
        log.warning("Gemini API request timed out after %.1fs. Falling back.", timeout)
        return _deterministic_offline_answer(
            user,
            mode=mode,
            reason="Gemini request timed out. Showing offline assistant response.",
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("Gemini request failed: %s", exc)
        return _deterministic_offline_answer(
            user,
            mode=mode,
            reason="Network error reaching Gemini. Showing offline assistant response.",
        )
