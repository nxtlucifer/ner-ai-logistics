"""Every reason code the backend can emit must have a translation.

The backend deliberately never builds a sentence. Every explanation it produces
is a CODE - `HEAVY_RAIN_ON_ROUTE`, not "Heavy rain is affecting your route" -
precisely so it can arrive on a phone in Assamese from a local file with no
model in the loop and no network call. That design only holds if the file is
complete.

A code with no entry reaches a driver as raw SHOUTING_SNAKE_CASE. On a safety
alert that is worse than useless: it is unreadable at exactly the moment
someone needs to read it. So this is a drift guard in the same spirit as
`test_schema_drift.py` - adding a reason code without translating it fails the
backend suite rather than surfacing on a truck.

It reads the file at the repository root rather than a copy, because two
catalogues would be two catalogues.
"""

import json
from pathlib import Path

import pytest

#: Modules whose REASON_* constants are rendered to a human.
#:
#: Listed explicitly rather than discovered by walking `app.domain`, so that
#: adding a module with user-facing codes is a deliberate act. A test that
#: silently covers whatever it finds also silently covers nothing when an
#: import moves.
CODE_MODULES = (
    "app.domain.route_risk",
    "app.domain.route_recommendation",
    "app.domain.reroute",
    "app.domain.monsoon_risk",
    "app.domain.landslide",
    "app.domain.route_eligibility",
    "app.domain.route_progress",
    "app.domain.terrain",
    "app.domain.flood",
    "app.domain.warnings",
    "app.domain.traffic",
    "app.domain.connectivity",
    "app.services.simulation",  # DEMO_SIMULATION_ACTIVE - the label every simulated score carries
    "app.services.offline_package",
    "app.services.navigation",
)

_ROOT = Path(__file__).resolve().parents[2]
CATALOGUE = _ROOT / "i18n" / "reason_codes.json"

#: The driver app's copy. It exists because Metro will not resolve imports
#: above the app root without extra configuration, so the app bundles its own -
#: and a mirror nobody checks is a fork with a delay on it.
DRIVER_MIRROR = _ROOT / "driver-app" / "src" / "i18n" / "reasonCodes.json"
MANAGER_MIRROR = _ROOT / "manager-web" / "src" / "i18n" / "reasonCodes.json"


def _catalogue() -> dict:
    assert CATALOGUE.exists(), f"reason-code catalogue missing at {CATALOGUE}"
    return json.loads(CATALOGUE.read_text(encoding="utf-8"))


def _emitted_codes() -> dict[str, str]:
    """Every REASON_* constant, mapped to the module that declares it."""
    import importlib

    found: dict[str, str] = {}
    for name in CODE_MODULES:
        module = importlib.import_module(name)
        for attr in dir(module):
            if not attr.startswith("REASON_"):
                continue
            value = getattr(module, attr)
            if isinstance(value, str):
                found[value] = f"{name}.{attr}"
    return found


class TestCoverage:
    def test_the_catalogue_is_valid_json_with_the_expected_shape(self) -> None:
        data = _catalogue()
        assert data["languages"] == ["en", "hi", "as"]
        assert isinstance(data["codes"], dict)
        assert data["codes"], "the catalogue is empty"

    def test_every_emitted_code_has_an_entry(self) -> None:
        data = _catalogue()
        emitted = _emitted_codes()
        assert emitted, "no reason codes were collected - the discovery broke"

        missing = {
            code: origin
            for code, origin in emitted.items()
            if code not in data["codes"]
        }
        assert not missing, (
            "reason codes with no translation, which reach a driver as raw "
            f"SHOUTING_SNAKE_CASE: {sorted(missing)}"
        )

    def test_every_entry_has_every_language(self) -> None:
        data = _catalogue()
        languages = data["languages"]

        gaps: dict[str, list[str]] = {}
        for code, entry in data["codes"].items():
            absent = [
                lang
                for lang in languages
                if not isinstance(entry.get(lang), str) or not entry[lang].strip()
            ]
            if absent:
                gaps[code] = absent
        assert not gaps, f"codes missing a language: {gaps}"

    def test_every_entry_declares_whether_it_may_be_spoken(self) -> None:
        """Voice is opt-in per code, never inferred.

        A spoken alert competes with the road, so which ones are read aloud is
        a decision someone makes once and writes down - not a side effect of a
        string existing.
        """
        data = _catalogue()
        undeclared = [
            code
            for code, entry in data["codes"].items()
            if not isinstance(entry.get("speak"), bool)
        ]
        assert not undeclared, f"codes with no `speak` decision: {undeclared}"

    def test_the_catalogue_has_no_codes_the_backend_cannot_emit(self) -> None:
        """Dead entries are a smaller problem than missing ones, and still a
        problem: they are a translator's time spent on a string nobody sees,
        and a reader's evidence for a feature that does not exist."""
        data = _catalogue()
        emitted = set(_emitted_codes())
        orphans = sorted(set(data["codes"]) - emitted)
        assert not orphans, f"translated codes no backend module emits: {orphans}"


class TestNoSentencesLeakFromTheBackend:
    @pytest.mark.parametrize("module_name", CODE_MODULES)
    def test_reason_codes_are_codes_not_prose(self, module_name: str) -> None:
        """A code with a space in it is a sentence that escaped.

        The moment one does, it arrives on a phone untranslatable - which is
        the failure this whole convention exists to prevent.
        """
        import importlib

        module = importlib.import_module(module_name)
        prose = [
            f"{attr}={getattr(module, attr)!r}"
            for attr in dir(module)
            if attr.startswith("REASON_")
            and isinstance(getattr(module, attr), str)
            and (
                " " in getattr(module, attr)
                or getattr(module, attr) != getattr(module, attr).upper()
            )
        ]
        assert not prose, f"reason codes that are not codes: {prose}"


class TestVoiceScope:
    def test_only_deliberate_codes_are_spoken(self) -> None:
        """Phase 12 limits voice to a short list of genuinely urgent things.

        Reading every reason code aloud would bury the ones that matter under
        narration about missing rainfall datasets, and a driver who learns to
        tune the voice out has lost the feature entirely.
        """
        data = _catalogue()
        spoken = {c for c, e in data["codes"].items() if e["speak"]}

        # Informational gaps must never be read aloud.
        for quiet in (
            "MONSOON_SEASON",
            "PRE_MONSOON_SEASON",
            "NO_LANDSLIDE_HISTORY_AVAILABLE",
            "RAINFALL_NOT_AVAILABLE",
            "DISTANCE_NOT_ESTIMATED",
            "DURATION_NOT_ESTIMATED",
            "WEATHER_OBSERVATIONS_STALE",
        ):
            assert quiet not in spoken, f"{quiet} is narration, not an alert"

        # The ones a driver must hear.
        for loud in (
            "ROAD_DECLARED_CLOSED",
            "SELECTED_ROUTE_DETERIORATED",
            "VEHICLE_OFF_PLANNED_ROUTE",
            "BETTER_ROUTE_AVAILABLE",
            "NO_BETTER_ALTERNATIVE",
        ):
            assert loud in spoken, f"{loud} should reach a driver who is driving"

    def test_the_spoken_set_stays_small(self) -> None:
        data = _catalogue()
        spoken = [c for c, e in data["codes"].items() if e["speak"]]
        assert len(spoken) <= 20, (
            f"{len(spoken)} spoken codes is a monologue, not an alert system"
        )


class TestTheMirrorsDoNotDrift:
    """One catalogue, three locations, byte for byte.

    Neither client bundler resolves imports above its own root without extra
    configuration, so each app ships a copy. A copy that is allowed to diverge
    is how a warning ends up saying one thing on a manager's screen and
    another on the phone of the driver it is about - which is the exact
    failure a shared catalogue exists to prevent.
    """

    @pytest.mark.parametrize(
        ("name", "mirror"),
        [("driver-app", DRIVER_MIRROR), ("manager-web", MANAGER_MIRROR)],
    )
    def test_the_copy_is_identical(self, name: str, mirror: Path) -> None:
        assert mirror.exists(), f"{name} mirror missing at {mirror}"
        assert mirror.read_bytes() == CATALOGUE.read_bytes(), (
            f"{name}'s reason-code catalogue has drifted from "
            "i18n/reason_codes.json - copy the root file over it"
        )
