"""The local-model service, with no local model.

THAT IS THE POINT OF THESE TESTS. This laptop has no Ollama, no gguf and no
torch - checked on 2026-09-06, not assumed - so the behaviour that actually
ships today is the unavailable path, and it is the path that must not lie. A
suite that only covered the happy path would be green on a machine where the
feature does not work at all.

What is proven here: the local-host guard, the concurrency gate, the parsing,
and that an absent model server produces an honest status rather than a
plausible answer. What is NOT proven: that the request shape is right. No token
has been generated. The first real answer may still need the body corrected.
"""

import asyncio

import pytest

from app.core.config import get_settings
from app.domain import ai_prompts
from app.services import inference


class TestLocalOnly:
    """Trip context must not leave the machine by configuration accident."""

    def test_loopback_hosts_are_local(self) -> None:
        for url in (
            "http://127.0.0.1:11434",
            "http://localhost:11434",
            "http://[::1]:11434",
        ):
            assert inference.looks_local(url) is True

    def test_a_hosted_endpoint_is_not_local(self) -> None:
        assert inference.looks_local("https://api.example.com") is False
        # The near-miss that would pass a naive substring check.
        assert inference.looks_local("https://localhost.example.com") is False

    @pytest.mark.anyio
    async def test_a_non_local_host_is_refused_by_default(self, monkeypatch) -> None:
        settings = get_settings()
        monkeypatch.setattr(settings, "OLLAMA_BASE_URL", "https://api.example.com")
        monkeypatch.setattr(settings, "AI_ALLOW_NON_LOCAL_HOST", False)
        with pytest.raises(inference.InferenceUnavailable, match="not local"):
            await inference.generate(system="s", user="u")

    @pytest.mark.anyio
    async def test_status_reports_the_non_local_host_rather_than_calling_it(
        self, monkeypatch
    ) -> None:
        settings = get_settings()
        monkeypatch.setattr(settings, "OLLAMA_BASE_URL", "https://api.example.com")
        monkeypatch.setattr(settings, "AI_ALLOW_NON_LOCAL_HOST", False)
        result = await inference.status()
        assert result.available is False
        assert "not local" in (result.detail or "")


class TestUnavailable:
    """The state this machine is in."""

    @pytest.mark.anyio
    async def test_no_model_server_is_honest_not_empty(self) -> None:
        result = await inference.status()
        assert result.available is False
        assert result.model is None
        # A detail a driver can act on, not a stack trace.
        assert result.detail
        assert "Traceback" not in result.detail

    @pytest.mark.anyio
    async def test_disabled_says_so(self, monkeypatch) -> None:
        monkeypatch.setattr(get_settings(), "AI_ENABLED", False)
        result = await inference.status()
        assert result.available is False
        assert "switched off" in (result.detail or "")

    @pytest.mark.anyio
    async def test_generate_raises_rather_than_returning_a_guess(self) -> None:
        with pytest.raises(inference.InferenceUnavailable):
            await inference.generate(system="s", user="u")


class TestBounds:
    @pytest.mark.anyio
    async def test_an_over_long_prompt_is_refused_before_the_network(
        self, monkeypatch
    ) -> None:
        monkeypatch.setattr(get_settings(), "AI_MAX_PROMPT_CHARS", 10)
        with pytest.raises(inference.InferenceUnavailable, match="too long"):
            await inference.generate(system="s", user="x" * 11)

    @pytest.mark.anyio
    async def test_a_second_generation_is_refused_rather_than_queued(self) -> None:
        """Waiting is worse than being told to retry.

        A queue on a single-core decode makes the second driver wait for the
        first driver's whole answer with no indication anything is happening.
        """
        gate = inference._gate()
        await gate.acquire()
        try:
            with pytest.raises(inference.InferenceBusy):
                await inference.generate(system="s", user="u")
        finally:
            gate.release()


class TestParsing:
    def test_reads_the_message_content(self) -> None:
        payload = {"message": {"role": "assistant", "content": "  Two stops left. "}}
        assert inference.parse_reply(payload) == "Two stops left."

    def test_a_response_with_no_message_is_empty_not_an_exception(self) -> None:
        assert inference.parse_reply({}) == ""
        assert inference.parse_reply({"message": {}}) == ""
        assert inference.parse_reply({"message": {"content": None}}) == ""


class TestPrompts:
    """The safety properties live in the prompt text, so they are pinned."""

    def test_every_mode_forbids_inventing_facts(self) -> None:
        for system in (
            ai_prompts.ASSISTANT_SYSTEM,
            ai_prompts.SAFETY_SYSTEM,
            ai_prompts.TRANSLATE_SYSTEM,
        ):
            assert "only use the FACTS" in system
            assert "Never guess" in system

    def test_every_mode_denies_the_model_any_authority(self) -> None:
        for system in (
            ai_prompts.ASSISTANT_SYSTEM,
            ai_prompts.SAFETY_SYSTEM,
            ai_prompts.TRANSLATE_SYSTEM,
        ):
            assert "cannot change anything" in system
            assert "reroute" in system

    def test_safety_refuses_medical_and_road_clearance_claims(self) -> None:
        s = ai_prompts.SAFETY_SYSTEM
        assert "doses" in s
        assert "road is safe" in s
        assert "promise that help is coming" in s

    def test_translation_preserves_numbers_and_negation(self) -> None:
        s = ai_prompts.TRANSLATE_SYSTEM
        assert "number" in s
        assert "negative" in s
        assert ai_prompts.TRANSLATION_UNAVAILABLE in s

    def test_facts_come_before_the_question(self) -> None:
        """A small model answers from priors when it reads the question first."""
        prompt = ai_prompts.assistant_prompt("how far?", "- Trip code: T1")
        assert prompt.index("FACTS") < prompt.index("DRIVER'S QUESTION")

    def test_translation_prompt_names_both_languages_in_words(self) -> None:
        prompt = ai_prompts.translation_prompt("No brakes", "en", "as")
        assert "English" in prompt and "Assamese" in prompt
        assert "No brakes" in prompt

    def test_demo_languages_are_the_twelve_that_were_chosen(self) -> None:
        """Widening this is a claim about coverage, so it has to be argued for.

        The list grew from five to twelve. The argument, checked rather than
        asserted: every one of these twelve has a hand-written entry for all
        eight quick driver phrases in
        `driver-app/src/phrasebook/offlineTranslator.ts`, so each is usable with
        no network and no model. That is the coverage claim this set makes.

        It is NOT a claim about the North East specifically. Assamese and
        Bengali are the only NER languages here; Manipuri, Khasi, Mizo, Bodo,
        Nepali and Nagamese are absent, while Tamil, Telugu, Malayalam and
        Kannada are present and are spoken nowhere in the eight NER states.
        For an MDoNER problem statement that is the wrong shape, and it is
        recorded here so the next person widening or narrowing this list argues
        about the right thing.
        """
        # 13 Sep: widened to the 22 scheduled languages of India + English, the
        # same list the driver app's language sheet offers (APP_LANGUAGES).
        # Offline phrasebook coverage is still the twelve below; the rest are
        # online-only for translation and answered in their own script by the
        # model (ai_prompts._SCRIPT), with the app's honest DRAFT / English
        # fallback status shown on the sheet.
        assert {"en", "hi", "gu", "as", "bn", "ta", "te", "ml", "kn", "mr", "pa", "or"} <= set(ai_prompts.DEMO_LANGUAGES)
        assert set(ai_prompts.DEMO_LANGUAGES) == {
            "en", "as", "bn", "brx", "doi", "gu", "hi", "kn", "ks", "kok", "mai", "ml",
            "mni", "mr", "ne", "or", "pa", "sa", "sat", "sd", "ta", "te", "ur",
        }

    def test_edge_function_and_backend_offer_the_same_languages(self) -> None:
        """One list, two runtimes.

        The driver reaches the assistant through the hosted Edge Function, and
        the backend through FastAPI. A language offered by one and not the
        other is a language whose availability depends on which transport the
        build happens to use - which the driver cannot see.
        """
        import pathlib
        import re

        handler = (
            pathlib.Path(__file__).resolve().parents[2]
            / "supabase"
            / "functions"
            / "gemini-ai"
            / "handler.ts"
        ).read_text(encoding="utf-8")
        block = re.search(
            r"DEMO_LANGUAGES: Record<string, string> = \{(.*?)\n\}",
            handler,
            re.S,
        )
        assert block is not None, "DEMO_LANGUAGES not found in the Edge handler"
        edge = set(re.findall(r'^\s*(\w+):\s*"', block.group(1), re.M))
        assert edge == set(ai_prompts.DEMO_LANGUAGES), (
            f"edge-only={sorted(edge - set(ai_prompts.DEMO_LANGUAGES))} "
            f"backend-only={sorted(set(ai_prompts.DEMO_LANGUAGES) - edge)}"
        )
