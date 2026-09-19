"""The driver's language, both directions.

Two different settings that were being treated as one:

    OUTPUT  the language the driver chose to READ
    INPUT   whatever they reached for while standing beside a truck

A driver whose app is set to Assamese may well type the question in Hindi,
or in Assamese written in Latin letters, because that is what their keyboard
does. The answer still has to come back in Assamese.

These test the PROMPT, which is the only part that is deterministic. What a
model does with a correct instruction is the model's business and is not
asserted here - claiming otherwise would be a test that passes because a
provider was in a good mood.
"""

from app.domain import ai_prompts


class TestOutputLanguage:
    def test_a_non_english_choice_pins_the_answer_and_its_script(self) -> None:
        out = ai_prompts.in_language("BASE", "as")
        assert "Answer ONLY in" in out
        # The script matters: a model told "Assamese" alone answers in Latin
        # letters often enough that a driver cannot read its reply.
        assert "Bengali-Assamese" in out or "script" in out.lower() or "(" in out
        assert "Keep numbers, units, place names and phone numbers as written" in out

    def test_english_pins_nothing_because_the_base_prompt_is_english(self) -> None:
        out = ai_prompts.in_language("BASE", "en")
        assert "Answer ONLY in" not in out

    def test_an_unknown_language_code_does_not_invent_an_instruction(self) -> None:
        """Better to answer in the base language than to name a language the
        catalogue has never heard of and let the model guess."""
        out = ai_prompts.in_language("BASE", "zz")
        assert "Answer ONLY in" not in out


class TestInputLanguage:
    def test_every_mode_is_told_the_question_may_arrive_in_any_language(
        self,
    ) -> None:
        for language in ("en", "hi", "as", "bn", "zz"):
            out = ai_prompts.in_language("BASE", language)
            assert ai_prompts.UNDERSTAND_ANY_INPUT in out, language

    def test_the_model_is_forbidden_from_asking_for_a_rephrase(self) -> None:
        """The failure this prevents: a driver at a roadside being told to
        type the question again in a different language."""
        assert "Never ask them to rephrase" in ai_prompts.UNDERSTAND_ANY_INPUT
        assert "Latin letters" in ai_prompts.UNDERSTAND_ANY_INPUT

    def test_input_and_output_instructions_coexist(self) -> None:
        """The case the bug was about: Hindi typed into an Assamese app."""
        out = ai_prompts.in_language("BASE", "as")
        assert ai_prompts.UNDERSTAND_ANY_INPUT in out
        assert "Answer ONLY in" in out


class TestTranslateModeIsLeftAlone:
    def test_a_translation_prompt_is_never_given_an_answer_language(self) -> None:
        """Translate mode already names its own target. Pinning a second
        output language on top of it is how a translation into Hindi comes
        back in Assamese."""
        system = f"Some system text mentioning {ai_prompts.TRANSLATION_UNAVAILABLE}"
        assert ai_prompts.in_language(system, "as") == system
        assert ai_prompts.in_language(system, "hi") == system
