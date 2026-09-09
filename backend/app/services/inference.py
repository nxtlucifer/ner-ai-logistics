"""One local model, three surfaces.

WHAT THIS IS FOR

The driver app has three places that read like AI and were not: the Assistant,
the Safety explanations and the Talk translator. This is the single inference
service all three go through. There is exactly one model deployment, three
prompts, and no second provider - because three deployments of the same model
on one laptop is three times the memory for the same answers.

WHAT IT MAY NOT DO

It may not decide anything. `docs/ARCHITECTURE.md` and `AGENTS.md` both say the
same thing and it is repeated here because this is the file where it would be
convenient to break: route eligibility, hazard refusals, capacity, the review
authorisation and every lifecycle transition are deterministic, and no output
of this module reaches any of them. The API layer hands the model FACTS that
were already computed and renders its prose next to them; it never lets prose
become a fact.

LOCAL ONLY, AND CHECKED

`OLLAMA_BASE_URL` defaults to loopback, and `looks_local()` refuses to send a
driver's trip to anything else unless the operator sets
`AI_ALLOW_NON_LOCAL_HOST=true` deliberately. The failure this prevents is
quiet: point the variable at a hosted endpoint and everything keeps working
while the trip context leaves the building.

STATUS ON THIS MACHINE: NO MODEL IS INSTALLED.

There is no Ollama, no LM Studio, no llama.cpp and no gguf file on this laptop -
checked, not assumed. So `status()` reports UNAVAILABLE, every caller renders
its offline guide, and nothing here has ever produced a token. The request shape
follows Ollama's documented `/api/chat`; it has not been executed.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from app.core.config import get_settings

log = logging.getLogger(__name__)

#: Hosts a driver's trip context may be sent to without an explicit override.
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "0.0.0.0"})

#: Concurrent generations allowed across the whole process.
#:
#: One. A laptop running Postgres, the API, a Vite dev server and Metro has no
#: spare core for a second decode, and GPS ingestion sharing that core is the
#: thing that must not slow down. A second request waits or is refused; it does
#: not compete with a truck reporting its position.
MAX_CONCURRENT_GENERATIONS = 1

_semaphore: asyncio.Semaphore | None = None


def _gate() -> asyncio.Semaphore:
    """Created lazily: a Semaphore binds to the loop that first awaits it."""
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(MAX_CONCURRENT_GENERATIONS)
    return _semaphore


class InferenceUnavailable(RuntimeError):
    """No model server, no model, or it refused. Never a fabricated answer."""


class InferenceBusy(RuntimeError):
    """Something else is generating. Deliberately not a queue."""


@dataclass(frozen=True, slots=True)
class ModelStatus:
    available: bool
    #: `LOCAL_OLLAMA`, or null when nothing answered.
    provider: str | None
    model: str | None
    #: Why not, for the screen. Never a stack trace.
    detail: str | None


def looks_local(base_url: str) -> bool:
    host = urlparse(base_url).hostname or ""
    return host in LOCAL_HOSTS


def _check_local(base_url: str) -> None:
    if looks_local(base_url):
        return
    if get_settings().AI_ALLOW_NON_LOCAL_HOST:
        log.warning("AI host %s is not loopback; allowed by configuration", base_url)
        return
    raise InferenceUnavailable(
        "the configured model host is not local, and non-local hosts are not allowed"
    )


async def status() -> ModelStatus:
    """Is a model actually there, right now.

    Asks the server which models it holds rather than trusting the setting: a
    configured model name that was never pulled produces a confident status and
    a failure on the first question, which is the worst time to find out.
    """
    settings = get_settings()
    if not settings.AI_ENABLED:
        return ModelStatus(False, None, None, "AI features are switched off.")

    base = settings.OLLAMA_BASE_URL
    try:
        _check_local(base)
    except InferenceUnavailable as exc:
        return ModelStatus(False, None, None, str(exc))

    try:
        async with httpx.AsyncClient(timeout=settings.AI_STATUS_TIMEOUT_SECONDS) as c:
            response = await c.get(f"{base}/api/tags")
    except httpx.HTTPError:
        return ModelStatus(
            False,
            None,
            None,
            "No local model server is running. Start Ollama to enable AI answers.",
        )

    if response.status_code != 200:
        return ModelStatus(False, None, None, "The local model server refused.")

    names = [m.get("name", "") for m in response.json().get("models", [])]
    wanted = settings.AI_MODEL
    # Ollama reports "llama3.2:3b"; a setting of "llama3.2" should match it.
    match = next((n for n in names if n == wanted or n.startswith(f"{wanted}:")), None)
    if match is None:
        return ModelStatus(
            False,
            "LOCAL_OLLAMA",
            None,
            f"The model server is running but does not have {wanted}.",
        )
    return ModelStatus(True, "LOCAL_OLLAMA", match, None)


async def generate(
    *,
    system: str,
    user: str,
    max_output_tokens: int | None = None,
) -> str:
    """One answer, or an exception. Never a partial answer presented as whole.

    Bounded at both ends: the caller has already trimmed what it sends, and
    `num_predict` bounds what comes back, because an unbounded local decode on
    a shared laptop is how the GPS ingestion path starts timing out.
    """
    settings = get_settings()
    base = settings.OLLAMA_BASE_URL
    _check_local(base)

    if len(user) > settings.AI_MAX_PROMPT_CHARS:
        raise InferenceUnavailable("the question is too long to send")

    gate = _gate()
    if gate.locked():
        raise InferenceBusy("another answer is being generated")

    async with gate:
        body = {
            "model": settings.AI_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "options": {
                "num_predict": max_output_tokens or settings.AI_MAX_OUTPUT_TOKENS,
                # Low, not zero: these answers restate supplied facts, and
                # sampling wide is how a model starts adding ones that were not
                # supplied.
                "temperature": 0.2,
            },
        }
        try:
            async with httpx.AsyncClient(
                timeout=settings.AI_TIMEOUT_SECONDS
            ) as client:
                response = await client.post(f"{base}/api/chat", json=body)
        except httpx.TimeoutException as exc:
            raise InferenceUnavailable("the model took too long to answer") from exc
        except httpx.HTTPError as exc:
            raise InferenceUnavailable(f"the model server could not be reached: {exc}") from exc

    if response.status_code != 200:
        log.warning("inference refused: %s %s", response.status_code, response.text[:300])
        raise InferenceUnavailable("the model server refused the request")

    text = parse_reply(response.json())
    if not text:
        raise InferenceUnavailable("the model returned nothing")
    return text


def parse_reply(payload: dict) -> str:
    """Pull the message text out of an Ollama `/api/chat` response."""
    message = payload.get("message") or {}
    content = message.get("content")
    return content.strip() if isinstance(content, str) else ""
