"""Deterministic route risk V1.

No database, no network, no clock of its own - `now` is injected, so staleness
is stepped through rather than slept through.

The tests that carry real weight here are the negative ones. A risk engine that
scores a route as calm because the weather provider was down, or that lets a
four-hour-old reading lower a score, is worse than no risk engine: it puts a
confident number next to a truck and a dispatcher acts on it.
"""

from datetime import UTC, datetime, timedelta

from app.domain.route_risk import (
    AVAILABLE,
    BAND_HIGH,
    BAND_LOW,
    CONDITION_COMPONENT_CODES,
    EXPOSURE_COMPONENT_CODES,
    FACTOR_DISTANCE,
    FACTOR_DURATION,
    FACTOR_FUEL,
    FACTOR_LANDSLIDE,
    FACTOR_ROAD_QUALITY,
    FACTOR_TRUCK_RESTRICTIONS,
    FACTOR_WEATHER,
    NOT_AVAILABLE,
    REASON_HEAVY_RAIN,
    REASON_HIGH_WIND,
    RAIN_HEAVY_MM,
    RAIN_MODERATE_MM,
    REASON_MODERATE_RAIN,
    REASON_WEATHER_STALE,
    REASON_WEATHER_UNAVAILABLE,
    assess,
)
from app.domain.weather import WeatherObservation

BASE = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)

# A real corridor in the target region, so the numbers stay recognisable.
GUWAHATI = (26.1445, 91.7362)
JORHAT = (26.7509, 94.2037)


def obs(
    *,
    lat: float = 26.1445,
    lon: float = 91.7362,
    rain: float | None = None,
    gust: float | None = None,
    at: datetime = BASE,
) -> WeatherObservation:
    return WeatherObservation(
        lat=lat,
        lon=lon,
        provider="test",
        observed_at=at,
        precipitation_mm=rain,
        wind_gust_kmh=gust,
    )


class TestInputAvailability:
    def test_absent_datasets_are_named_not_omitted(self) -> None:
        """The difference between "risk 37" and "risk 37, computed with no
        landslide data" is the whole honesty of this feature."""
        risk = assess(distance_km=305, duration_min=360, observations=[obs()])

        for factor in (
            FACTOR_LANDSLIDE,
            FACTOR_ROAD_QUALITY,
            FACTOR_TRUCK_RESTRICTIONS,
            FACTOR_FUEL,
        ):
            assert risk.inputs[factor] == NOT_AVAILABLE
            assert factor in risk.unavailable

    def test_available_inputs_are_marked_available(self) -> None:
        # `now` pinned to BASE: without it the fixture observation is months
        # old against the real clock and is correctly rejected as stale, which
        # is the engine working, not a failure.
        risk = assess(
            distance_km=305, duration_min=360, observations=[obs(rain=0.0)], now=BASE
        )
        assert risk.inputs[FACTOR_DISTANCE] == AVAILABLE
        assert risk.inputs[FACTOR_DURATION] == AVAILABLE
        assert risk.inputs[FACTOR_WEATHER] == AVAILABLE

    def test_fuel_marked_available_when_provided(self) -> None:
        from app.domain.fuel_model import estimate_fuel

        fuel = estimate_fuel(distance_km=305, payload_kg=8000)
        risk = assess(
            distance_km=305,
            duration_min=360,
            observations=[obs(rain=0.0)],
            fuel=fuel,
            now=BASE,
        )
        assert risk.inputs[FACTOR_FUEL] == AVAILABLE
        assert FACTOR_FUEL not in risk.unavailable
        assert risk.fuel is not None
        assert risk.fuel.litres is not None

    def test_no_observations_marks_weather_unavailable_not_calm(self) -> None:
        """The failure this check exists for.

        A provider outage must not read as "no rain". Those are opposite facts
        and only one of them is safe to act on.
        """
        risk = assess(distance_km=305, duration_min=360, observations=[])

        assert risk.inputs[FACTOR_WEATHER] == NOT_AVAILABLE
        assert REASON_WEATHER_UNAVAILABLE in risk.reason_codes
        assert not risk.weather_available
        assert all(c.code != "RAIN_EXPOSURE" for c in risk.components)


class TestStaleObservations:
    def test_a_stale_reading_is_never_scored(self) -> None:
        """Weather from four hours ago describes weather that has moved on."""
        stale = obs(rain=20.0, at=BASE - timedelta(hours=4))

        risk = assess(
            distance_km=100, duration_min=120, observations=[stale], now=BASE
        )

        assert risk.observations_stale == 1
        assert risk.observations_used == 0
        assert risk.inputs[FACTOR_WEATHER] == NOT_AVAILABLE
        assert all(c.code != "RAIN_EXPOSURE" for c in risk.components)
        assert REASON_WEATHER_STALE in risk.reason_codes

    def test_a_stale_reading_cannot_lower_a_score(self) -> None:
        """Specifically: a stale CALM reading must not dilute live heavy rain.

        If staleness were merely averaged in, an old dry sample would pull the
        score down exactly when conditions were deteriorating.
        """
        live_storm = obs(rain=20.0, at=BASE)
        stale_calm = obs(rain=0.0, at=BASE - timedelta(hours=5))

        alone = assess(distance_km=100, duration_min=120, observations=[live_storm], now=BASE)
        with_stale = assess(
            distance_km=100,
            duration_min=120,
            observations=[live_storm, stale_calm],
            now=BASE,
        )

        assert with_stale.score >= alone.score
        assert with_stale.observations_stale == 1


class TestRain:
    def test_heavy_rain_scores_above_moderate_rain(self) -> None:
        moderate = assess(
            distance_km=100, duration_min=120, observations=[obs(rain=3.0)], now=BASE
        )
        heavy = assess(
            distance_km=100, duration_min=120, observations=[obs(rain=20.0)], now=BASE
        )

        assert heavy.score > moderate.score
        assert REASON_MODERATE_RAIN in moderate.reason_codes
        assert REASON_HEAVY_RAIN in heavy.reason_codes

    def test_coverage_matters_not_just_peak(self) -> None:
        """One wet sample of twelve is a different operational fact from a
        corridor that is wet end to end, and a score that could not tell them
        apart would be useless for choosing between two routes."""
        one_wet = [obs(rain=10.0)] + [obs(rain=0.0) for _ in range(11)]
        all_wet = [obs(rain=10.0) for _ in range(12)]

        patchy = assess(
            distance_km=100, duration_min=120, observations=one_wet, now=BASE
        )
        soaked = assess(
            distance_km=100, duration_min=120, observations=all_wet, now=BASE
        )

        assert soaked.score > patchy.score

    def test_dry_weather_adds_no_rain_component(self) -> None:
        risk = assess(
            distance_km=100, duration_min=120, observations=[obs(rain=0.0)], now=BASE
        )
        assert all(c.code != "RAIN_EXPOSURE" for c in risk.components)
        assert risk.inputs[FACTOR_WEATHER] == AVAILABLE

    def test_a_missing_precipitation_field_is_not_read_as_zero(self) -> None:
        """`None` means the provider did not supply it."""
        risk = assess(
            distance_km=100, duration_min=120, observations=[obs(rain=None)], now=BASE
        )
        assert all(c.code != "RAIN_EXPOSURE" for c in risk.components)


class TestWind:
    def test_severe_gusts_score_above_notable_gusts(self) -> None:
        light = assess(
            distance_km=100, duration_min=120, observations=[obs(gust=45.0)], now=BASE
        )
        severe = assess(
            distance_km=100, duration_min=120, observations=[obs(gust=90.0)], now=BASE
        )
        assert severe.score > light.score
        assert REASON_HIGH_WIND in severe.reason_codes

    def test_a_calm_breeze_adds_nothing(self) -> None:
        risk = assess(
            distance_km=100, duration_min=120, observations=[obs(gust=12.0)], now=BASE
        )
        assert all(c.code != "WIND_EXPOSURE" for c in risk.components)


class TestScoreShape:
    def test_the_score_never_exceeds_one_hundred(self) -> None:
        extreme = [obs(rain=200.0, gust=180.0) for _ in range(12)]
        risk = assess(
            distance_km=5_000, duration_min=6_000, observations=extreme, now=BASE
        )
        assert 0 <= risk.score <= 100

    def test_a_short_calm_trip_is_low_band(self) -> None:
        risk = assess(
            distance_km=20, duration_min=30, observations=[obs(rain=0.0)], now=BASE
        )
        assert risk.band == BAND_LOW

    def test_a_long_storm_trip_is_high_band(self) -> None:
        wet = [obs(rain=25.0, gust=70.0) for _ in range(8)]
        risk = assess(distance_km=600, duration_min=700, observations=wet, now=BASE)
        assert risk.band == BAND_HIGH

    def test_components_sum_to_the_score(self) -> None:
        """The explanation must actually add up to the number shown, or the
        breakdown is decoration."""
        risk = assess(
            distance_km=305,
            duration_min=360,
            observations=[obs(rain=9.0, gust=55.0)],
            now=BASE,
        )
        assert sum(c.points for c in risk.components) == risk.score

    def test_every_component_carries_a_human_detail(self) -> None:
        risk = assess(
            distance_km=305,
            duration_min=360,
            observations=[obs(rain=9.0, gust=55.0)],
            now=BASE,
        )
        assert risk.components
        for c in risk.components:
            assert c.label and c.detail
            assert c.points > 0

    def test_reason_codes_are_unique_and_stable(self) -> None:
        """Codes, not sentences. The driver app translates them into Hindi or
        Assamese locally; a sentence built here would arrive untranslatable."""
        risk = assess(
            distance_km=600,
            duration_min=700,
            observations=[obs(rain=20.0), obs(rain=20.0)],
            now=BASE,
        )
        assert len(risk.reason_codes) == len(set(risk.reason_codes))
        for code in risk.reason_codes:
            assert code.isupper()


class TestNoFabricatedIntelligence:
    def test_there_is_no_confidence_or_prediction_field(self) -> None:
        """This is a weighted rule with published constants. A `confidence` or
        `predicted_delay` field would imply a trained model that does not
        exist, and the absence is the honest signal."""
        risk = assess(distance_km=100, duration_min=120, observations=[obs()])
        for forbidden in (
            "confidence",
            "predicted_delay_min",
            "model_version",
            "probability",
        ):
            assert not hasattr(risk, forbidden), f"{forbidden} implies a model"

    def test_zero_distance_and_duration_score_nothing(self) -> None:
        risk = assess(distance_km=0, duration_min=0, observations=[obs(rain=0.0)])
        assert risk.score == 0
        assert risk.components == ()


class TestRainSaturationIsDeliberateAndBounded:
    """What the rain component can and cannot distinguish.

    `intensity = min(1.0, peak / RAIN_HEAVY_MM)` saturates at 7.5 mm/h. Above
    that, only COVERAGE moves the score - so a heavy shower and a cloudburst,
    both falling along the whole corridor, score the same.

    That is a deliberate consequence of bounded, published component ceilings
    that sum to 100, and it is the same saturation the distance, duration and
    recurrence components use. It is pinned here rather than left implicit,
    because it is also a real LIMIT on what the recommendation can tell apart:
    given two corridors, one under 8 mm/h and one under 40 mm/h, the rain
    component rates them equally and the choice falls through to duration and
    distance. A route with a cloudburst on it can therefore be recommended for
    being half an hour shorter.

    Raising the ceiling is not a free fix. The reroute floor of 60 is
    calibrated against THIS curve - measured, heavy rain end-to-end on a
    305 km / 221 min route scores exactly 60 - so stretching the intensity
    scale would drop heavy rain below the floor and stop the reroute feature
    firing at all. Re-tuning both together needs calibration data this project
    does not have, and doing it by eye would be the kind of unvalidated change
    docs/AI_MODELS.md exists to forbid.
    """

    @staticmethod
    def _score(rain: float, count: int = 5) -> int:
        return assess(
            distance_km=305.0,
            duration_min=221.0,
            observations=[obs(rain=rain) for _ in range(count)],
            now=BASE,
        ).score

    def test_intensity_saturates_at_the_heavy_threshold(self) -> None:
        at_heavy = self._score(RAIN_HEAVY_MM)
        well_past = self._score(RAIN_HEAVY_MM * 6)
        assert at_heavy == well_past, (
            "the saturation this test documents has changed; the reroute floor "
            "of 60 is calibrated against it and must be re-checked"
        )

    def test_the_reroute_floor_is_actually_reachable(self) -> None:
        """The check that matters operationally.

        If realistic monsoon rain could not push a corridor to 60, the whole
        reroute feature would be unreachable in production while every test
        stayed green.
        """
        from app.domain.reroute import DETERIORATION_FLOOR

        assert self._score(RAIN_HEAVY_MM + 0.5) >= DETERIORATION_FLOOR

    def test_calm_and_moderate_stay_below_the_floor(self) -> None:
        """And it must not fire on ordinary weather, or it will be ignored."""
        from app.domain.reroute import DETERIORATION_FLOOR

        assert self._score(0.0) < DETERIORATION_FLOOR
        assert self._score(RAIN_MODERATE_MM) < DETERIORATION_FLOOR

    def test_coverage_still_separates_two_wet_routes(self) -> None:
        """Above saturation, coverage is the only discriminator left - so it
        has to work."""
        soaked = self._score(RAIN_HEAVY_MM * 3, count=5)
        patchy = assess(
            distance_km=305.0,
            duration_min=221.0,
            observations=[
                obs(rain=RAIN_HEAVY_MM * 3),
                *[obs(rain=0.0) for _ in range(4)],
            ],
            now=BASE,
        ).score
        assert soaked > patchy


class TestEveryComponentIsClassified:
    """A new component must land on one side of the conditions/exposure line.

    `RouteRisk.condition_points` drives the reroute trigger, and it sums only
    the CONDITION components. A component that belongs to neither set is
    invisible to that trigger - so a future visibility or flood factor could be
    added, scored, shown on screen, and still never raise an alert.

    That is the same shape of gap as NER-B01, where a trip status was missing
    from the one filter that mattered. This closes it by construction: the two
    sets must together cover everything `assess` can emit.
    """

    def test_the_two_sets_do_not_overlap(self) -> None:
        assert not (CONDITION_COMPONENT_CODES & EXPOSURE_COMPONENT_CODES)

    def test_every_emitted_component_is_on_one_side_or_the_other(self) -> None:
        classified = CONDITION_COMPONENT_CODES | EXPOSURE_COMPONENT_CODES
        emitted: set[str] = set()

        # Every combination that produces a component at all.
        for rain, gust, km, mins in (
            (12.0, 70.0, 500.0, 500.0),
            (3.0, 45.0, 100.0, 90.0),
            (0.0, 0.0, 500.0, 500.0),
        ):
            result = assess(
                distance_km=km,
                duration_min=mins,
                observations=[obs(rain=rain, gust=gust) for _ in range(5)],
                now=BASE,
            )
            emitted.update(c.code for c in result.components)

        assert emitted, "no components were produced; the sweep is not exercising"
        unclassified = emitted - classified
        assert not unclassified, (
            f"{sorted(unclassified)} belong to neither CONDITION nor EXPOSURE, "
            "so the reroute trigger cannot see them"
        )

    def test_condition_points_excludes_exposure(self) -> None:
        """The whole reason the property exists."""
        result = assess(
            distance_km=500.0,
            duration_min=500.0,
            observations=[obs(rain=0.0, gust=0.0) for _ in range(5)],
            now=BASE,
        )
        assert result.score > 0, "distance and duration should have scored"
        assert result.condition_points == 0, (
            "exposure leaked into the conditions total, which would let a long "
            "dull trip raise a severe-weather alert"
        )
