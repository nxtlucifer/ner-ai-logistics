"""Online AI router: Gemini first, OpenRouter second, deterministic last.

Implements the server-side proxy with:
- Server-side API key protection (keys NEVER exposed to clients)
- Free-Tier rate limit management (10 RPM per driver)
- Prompt injection & secret exfiltration defenses
- Medical diagnosis & navigation authority refusals
- Failover: Gemini 429/5xx/timeout/network error -> OpenRouter (free models,
  in configured order) -> the deterministic offline library. The answer says
  which provider produced it; provider health is kept in memory for /status.
- The model explains; it never decides. Facts arrive in the prompt from the
  deterministic engine, and the answer is validated (non-empty, bounded) only.
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
    #: GOOGLE_GEMINI | OPENROUTER | OFFLINE_ASSISTANT - which one answered.
    provider: str = "OFFLINE_ASSISTANT"


#: Provider health, in memory, for /api/ai/status. CONFIGURED means a key
#: exists and nothing has been tried yet; the rest are the last outcome.
#: Values: NOT_CONFIGURED | CONFIGURED | HEALTHY | FAILED | RATE_LIMITED
HEALTH: dict[str, dict[str, Any]] = {
    "GOOGLE_GEMINI": {"state": "NOT_CONFIGURED", "detail": None, "at": None},
    "OPENROUTER": {"state": "NOT_CONFIGURED", "detail": None, "at": None},
}

#: Answers longer than this are cut: a screen reads three sentences, not an essay.
MAX_ANSWER_CHARS: Final = 1200


def _mark(provider: str, state: str, detail: str | None = None) -> None:
    HEALTH[provider] = {"state": state, "detail": detail, "at": time.time()}


def _clean(text: str) -> str:
    text = text.strip()
    return text if len(text) <= MAX_ANSWER_CHARS else text[:MAX_ANSWER_CHARS].rsplit(" ", 1)[0] + "…"


async def _openrouter(system: str, user: str, max_tokens: int) -> GeminiResponse | None:
    """One answer from the first configured OpenRouter model that works, else None."""
    settings = get_settings()
    key = settings.OPENROUTER_API_KEY
    if not key or not key.strip():
        return None
    models = [m.strip() for m in settings.OPENROUTER_MODELS.split(",") if m.strip()]
    headers = {"Authorization": f"Bearer {key}", "HTTP-Referer": "https://ner-manager.onrender.com", "X-Title": "RASTA AI"}
    last: str | None = None
    for model in models:
        payload = {
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "max_tokens": max_tokens,
            "temperature": 0.2,
            "reasoning": {"enabled": False},
        }
        try:
            async with httpx.AsyncClient(timeout=settings.OPENROUTER_TIMEOUT_SECONDS) as client:
                resp = await client.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload)
            if resp.status_code == 429:
                last = f"{model}: rate-limited"
                continue
            if resp.status_code != 200:
                last = f"{model}: HTTP {resp.status_code}"
                continue
            choices = resp.json().get("choices") or []
            text = _clean(((choices[0].get("message") or {}).get("content") or "") if choices else "")
            if not text:
                last = f"{model}: empty"
                continue
            _mark("OPENROUTER", "HEALTHY")
            return GeminiResponse(answer=text, model=model, provider="OPENROUTER")
        except httpx.TimeoutException:
            last = f"{model}: timed out"
        except Exception as exc:  # noqa: BLE001
            last = f"{model}: {type(exc).__name__}"
    _mark("OPENROUTER", "RATE_LIMITED" if last and "rate-limited" in last else "FAILED", last)
    log.warning("OpenRouter: no model answered (%s)", last)
    return None


async def _fallback(user: str, mode: str, reason: str, system: str = "", max_tokens: int = 0) -> GeminiResponse:
    """Gemini could not answer: the second provider, then the offline library."""
    if system:
        second = await _openrouter(system, user, max_tokens or 400)
        if second is not None:
            return GeminiResponse(answer=second.answer, model=second.model, provider="OPENROUTER", disclaimer=reason)
    return _deterministic_offline_answer(user, mode=mode, reason=reason)


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

    if HEALTH["GOOGLE_GEMINI"]["state"] == "NOT_CONFIGURED":
        _mark("GOOGLE_GEMINI", "CONFIGURED")
    if settings.OPENROUTER_API_KEY and HEALTH["OPENROUTER"]["state"] == "NOT_CONFIGURED":
        _mark("OPENROUTER", "CONFIGURED")
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
        return await _fallback(user, mode, "Gemini API key is not configured on the server. Showing offline guidance.", system, max_output_tokens or settings.GEMINI_MAX_OUTPUT_TOKENS)

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
            _mark("GOOGLE_GEMINI", "RATE_LIMITED", "HTTP 429")
            return await _fallback(user, mode, "Gemini free-tier quota exhausted. Offline assistant is active.", system, max_tokens)

        if resp.status_code != 200:
            log.warning("Gemini API returned HTTP %d: %s", resp.status_code, resp.text[:100])
            _mark("GOOGLE_GEMINI", "FAILED", f"HTTP {resp.status_code}")
            return await _fallback(user, mode, f"Gemini service returned HTTP {resp.status_code}. Offline assistant active.", system, max_tokens)

        data = resp.json()
        candidates = data.get("candidates", [])
        text = _clean(candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")) if candidates else ""
        if not text:
            _mark("GOOGLE_GEMINI", "FAILED", "empty answer")
            return await _fallback(user, mode, "No answer candidate returned.", system, max_tokens)

        _mark("GOOGLE_GEMINI", "HEALTHY")
        return GeminiResponse(
            answer=text,
            severity="INFO",
            source_mode="LIVE_DATA",
            actions=[],
            disclaimer=None,
            model=model,
            provider="GOOGLE_GEMINI",
        )

    except httpx.TimeoutException:
        log.warning("Gemini API request timed out after %.1fs. Falling back.", timeout)
        _mark("GOOGLE_GEMINI", "FAILED", "timed out")
        return await _fallback(user, mode, "Gemini request timed out. Showing offline assistant response.", system, max_tokens)
    except Exception as exc:  # noqa: BLE001
        log.warning("Gemini request failed: %s", exc)
        _mark("GOOGLE_GEMINI", "FAILED", type(exc).__name__)
        return await _fallback(user, mode, "Network error reaching Gemini. Showing offline assistant response.", system, max_tokens)
