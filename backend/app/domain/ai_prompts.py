"""What each of the three surfaces is allowed to ask the model, and how.

Separate from `services/inference.py` on purpose: that file is the transport,
this one is the policy, and the policy is the part with the safety properties
in it. It is pure text assembly - no I/O, no model, no database - so the rules
below are testable without a model installed, which is the state this machine
is in.

THE ONE RULE ALL THREE SHARE

The model never establishes a fact. Facts are computed by the deterministic
code that already exists - route eligibility, progress, freshness, the bundled
safety guide - and are handed to the model as text it may only restate. So
every prompt says the same thing in the same place: if it is not in the facts,
say you do not know. A model that fills a gap plausibly is more dangerous here
than one that refuses, because the gaps are things like whether a road is open.
"""

from typing import Final

#: Prepended to every mode. Repeated per request rather than assumed from a
#: previous turn, because a stateless call has no previous turn to rely on.
_BASE: Final = (
    "You are a helper inside a truck fleet application in North East India.\n"
    "You must only use the FACTS given below. If the answer is not in the "
    "facts, say you do not have that information. Never guess a distance, a "
    "time, a road name, a phone number or whether a road is open.\n"
    "You cannot change anything: you cannot start, stop, reroute or accept a "
    "trip. If the driver asks for that, tell them which button to use.\n"
    "Answer in at most three short sentences, in plain language."
)

ASSISTANT_SYSTEM: Final = (
    _BASE
    + "\n\nYou are answering the driver's question about their own current "
    "trip. The facts come from the app and are already correct - restate them, "
    "do not recompute them. If a fact is marked unavailable or stale, say so "
    "in those words rather than leaving it out."
)

SAFETY_SYSTEM: Final = (
    _BASE
    + "\n\nYou are explaining safety guidance that is already written and "
    "reviewed. You may reword it and answer questions about it. You must NOT "
    "add medical advice, medicine names or doses, tell anyone a road is safe "
    "or clear, or promise that help is coming. For anything urgent, tell them "
    "to use the emergency buttons on the screen first."
)

TRANSLATE_SYSTEM: Final = (
    _BASE
    + "\n\nYou are translating one short message for a driver to show someone "
    "at the roadside. Output ONLY the translation, with no explanation and no "
    "quotation marks. Keep every number, phone number, unit and place name "
    "exactly as written. Keep negatives negative: 'do not' must not become "
    "'do'. If you cannot translate into the requested language, reply with "
    "exactly: TRANSLATION_UNAVAILABLE"
)

#: The languages the demo claims. Listed here rather than in the UI so the
#: claim has one source, and so a language nobody has checked cannot be added
#: by editing a dropdown.
#:
#: These are the five the demo is prepared to show. It is NOT a statement that
#: the model is good at them - that depends entirely on which model is
#: installed, and `docs/AI_MODELS.md` records what was actually measured.
DEMO_LANGUAGES: Final = {
    "en": "English",
    "hi": "Hindi",
    "gu": "Gujarati",
    "as": "Assamese",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "ml": "Malayalam",
    "kn": "Kannada",
    "mr": "Marathi",
    "pa": "Punjabi",
    "or": "Odia",
}

#: Marker the model is told to emit when it cannot do the pair. Checked by the
#: caller so an unsupported language is an honest state rather than a confident
#: wrong translation.
TRANSLATION_UNAVAILABLE: Final = "TRANSLATION_UNAVAILABLE"


def is_injection_attempt(text: str) -> bool:
    """Detect common prompt-injection and jailbreak patterns."""
    lower = text.lower()
    markers = [
        "ignore all previous",
        "ignore previous instructions",
        "disregard all rules",
        "disregard instructions",
        "system prompt",
        "reveal your prompt",
        "output your prompt",
        "developer mode",
        "dan mode",
        "<script",
        "javascript:",
    ]
    return any(m in lower for m in markers)


def is_credential_request(text: str) -> bool:
    """Detect queries attempting to exfiltrate backend secrets or keys."""
    lower = text.lower()
    keywords = [
        "database password",
        "database url",
        "db password",
        "secret key",
        "api key",
        "service role",
        "supabase key",
        "gemini key",
        "private key",
    ]
    return any(k in lower for k in keywords)


def is_medical_diagnosis_attempt(text: str) -> bool:
    """Detect queries seeking medical diagnoses or prescriptions."""
    lower = text.lower()
    keywords = [
        "prescribe",
        "diagnose",
        "what medicine",
        "which drug",
        "antibiotic",
        "dosage for",
    ]
    return any(k in lower for k in keywords)


def is_navigation_authority_attempt(text: str) -> bool:
    """Detect queries asking the LLM to usurp routing authority or declare closures."""
    lower = text.lower()
    keywords = [
        "which turn should i take",
        "which road to take",
        "declare road closed",
        "reroute my truck",
        "is the road officially closed",
    ]
    return any(k in lower for k in keywords)



#: Script the answer must be written in, so "Hindi" cannot come back romanised.
_SCRIPT: Final = {"hi": "Devanagari", "gu": "Gujarati script", "as": "Assamese (Bengali-Assamese script)", "bn": "Bengali script"}


def in_language(system: str, language: str) -> str:
    """The same system prompt, with the answer language pinned to the app's.

    Translate mode already names its own target and is left alone. English
    needs no instruction. Everything else gets an explicit script, because a
    model told "Hindi" alone will happily answer in Latin letters.
    """
    if language == "en" or "TRANSLATION_UNAVAILABLE" in system:
        return system
    name = DEMO_LANGUAGES.get(language)
    if not name:
        return system
    script = _SCRIPT.get(language)
    suffix = f" ({script})" if script else ""
    return f"{system}\n\nAnswer ONLY in {name}{suffix}. Keep numbers, units, place names and phone numbers as written."


def translation_prompt(text: str, source: str, target: str) -> str:
    """The user half of a translation request."""
    src = DEMO_LANGUAGES.get(source, source)
    dst = DEMO_LANGUAGES.get(target, target)
    return f"Translate from {src} to {dst}.\n\nMESSAGE:\n{text}"


def assistant_prompt(question: str, facts: str) -> str:
    """The user half of an assistant request.

    Facts first, then the question. The order matters for a small model: a
    question read before its facts is answered from whatever the model already
    believes about trucks in Assam.
    """
    return f"FACTS:\n{facts}\n\nDRIVER'S QUESTION:\n{question}"


def safety_prompt(question: str, guidance: str) -> str:
    """The user half of a safety request. `guidance` is bundled, reviewed text."""
    return f"GUIDANCE:\n{guidance}\n\nDRIVER'S QUESTION:\n{question}"
