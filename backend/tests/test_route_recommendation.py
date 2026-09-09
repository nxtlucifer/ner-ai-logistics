"""Explainable Route Recommendation V1: the comparison rule.

Pure domain tests - no database, no provider, no HTTP. The rule is a published
comparison over deterministic inputs, so it can be pinned exactly, including
the cases where it must REFUSE to recommend rather than guess.

The refusals are the tests that matter. Any rule can pick the smaller number;
what makes this one defensible is that it declines when the two numbers were
not measured the same way, and that it never turns a point difference into a
percentage it cannot support.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.domain import route_recommendation as rr
from app.domain.route_risk import (
    NOT_AVAILABLE,
    RouteRisk,
    assess,
)
from app.domain.weather import WeatherObservation

NOW = datetime(2026, 9, 1, 6, 0, tzinfo=UTC)


def _risk(score: int, *, unavailable: tuple[str, ...] = ("landslide",)) -> RouteRisk:
    """A RouteRisk with a chosen score and a chosen evidence set.

    Built directly rather than through `assess` because these tests are about
    the comparison, not the scoring - and constructing the exact score makes
    the margin arithmetic legible instead of reverse-engineered from weather.

    LS-7: it also carries a SUFFICIENT-EVIDENCE landslide assessment. These
    tests are about ranking, and without it every candidate would be
    REQUIRES_REVIEW and nothing would ever be recommended - which is correct
    policy but would silently turn this whole suite into a test of the
    eligibility gate instead of the comparison. Absence-of-evidence behaviour
    is covered in tests/test_route_eligibility.py.
    """
    from app.domain.landslide import DataStatus, LandslideAssessment, LandslideRisk

    return RouteRisk(
        landslide=LandslideAssessment(
            risk=LandslideRisk.LOW, data_status=DataStatus.AVAILABLE
        ),
        score=score,
        band="LOW",
        components=(),
        inputs={f: NOT_AVAILABLE for f in unavailable},
        unavailable=unavailable,
        reason_codes=(),
        observations_used=5,
        observations_stale=0,
        assessed_at=NOW,
    )


def _candidate(
    route_id: str,
    kind: str,
    *,
    score: int,
    distance_km: float | None = 300.0,
    duration_min: float | None = 220.0,
    unavailable: tuple[str, ...] = ("landslide",),
) -> rr.RouteCandidate:
    return rr.RouteCandidate(
        route_id=route_id,
        kind=kind,
        distance_km=distance_km,
        duration_min=duration_min,
        risk=_risk(score, unavailable=unavailable),
    )


class TestNothingIsInvented:
    def test_no_routes_recommends_nothing(self) -> None:
        result = rr.recommend([])
        assert result.recommended_route_id is None
        assert result.reason_codes == (rr.REASON_NO_ROUTES,)
        assert result.comparable is False
        assert result.tradeoff is None

    def test_one_route_is_a_truthful_answer_not_a_degraded_one(self) -> None:
        """A single-road corridor must not produce a fabricated backup."""
        only = _candidate("a", "PRIMARY", score=61)
        result = rr.recommend([only])

        assert result.recommended_route_id == "a"
        assert rr.REASON_ONLY_ONE_ROUTE in result.reason_codes
        assert result.comparable is False, (
            "a comparison was claimed where there was nothing to compare"
        )
        assert result.tradeoff is None

    def test_missing_primary_is_stated_not_papered_over(self) -> None:
        result = rr.recommend([_candidate("b", "EMERGENCY_BACKUP", score=40)])
        assert rr.REASON_NO_PRIMARY in result.reason_codes


class TestTheComparison:
    def test_a_clearly_safer_backup_is_recommended_with_its_cost(self) -> None:
        """The worked example: safer but slower, stated in minutes and points."""
        primary = _candidate(
            "p", "PRIMARY", score=61, distance_km=305.0, duration_min=221.0
        )
        backup = _candidate(
            "b", "EMERGENCY_BACKUP", score=28, distance_km=326.0, duration_min=244.0
        )

        result = rr.recommend([primary, backup])

        assert result.recommended_route_id == "b"
        assert result.baseline_route_id == "p"
        assert result.comparable is True
        assert rr.REASON_LOWER_RISK_ALTERNATIVE in result.reason_codes
        assert rr.REASON_SLOWER in result.reason_codes
        assert rr.REASON_LONGER in result.reason_codes

        assert result.tradeoff is not None
        assert result.tradeoff.risk_delta_points == -33
        assert result.tradeoff.duration_delta_min == pytest.approx(23.0)
        assert result.tradeoff.distance_delta_km == pytest.approx(21.0)

    def test_a_small_gap_keeps_the_primary(self) -> None:
        """Below the margin the difference is noise, and a detour is not free."""
        primary = _candidate("p", "PRIMARY", score=40)
        backup = _candidate("b", "EMERGENCY_BACKUP", score=33)

        result = rr.recommend([primary, backup])

        assert result.recommended_route_id == "p"
        assert rr.REASON_WITHIN_MARGIN in result.reason_codes
        assert rr.REASON_LOWER_RISK_ALTERNATIVE not in result.reason_codes

    def test_the_declined_alternative_still_reports_its_figures(self) -> None:
        """A manager overruling the rule gets the numbers the rule used."""
        result = rr.recommend(
            [
                _candidate("p", "PRIMARY", score=40, duration_min=200.0),
                _candidate("b", "EMERGENCY_BACKUP", score=33, duration_min=260.0),
            ]
        )
        assert result.tradeoff is not None
        assert result.tradeoff.risk_delta_points == -7
        assert result.tradeoff.duration_delta_min == pytest.approx(60.0)

    def test_exactly_at_the_margin_switches(self) -> None:
        """The boundary is inclusive, and pinned so it cannot drift silently."""
        result = rr.recommend(
            [
                _candidate("p", "PRIMARY", score=50),
                _candidate(
                    "b",
                    "EMERGENCY_BACKUP",
                    score=50 - rr.MIN_RISK_MARGIN_POINTS,
                ),
            ]
        )
        assert result.recommended_route_id == "b"

    def test_a_riskier_alternative_never_wins(self) -> None:
        result = rr.recommend(
            [
                _candidate("p", "PRIMARY", score=20),
                _candidate("b", "EMERGENCY_BACKUP", score=80),
            ]
        )
        assert result.recommended_route_id == "p"
        assert rr.REASON_WITHIN_MARGIN in result.reason_codes


class TestEvidenceMustMatch:
    """The failure a naive comparison walks straight into."""

    def test_a_route_scored_without_weather_is_not_recommended(self) -> None:
        """Its lower score measures the missing factor, not a safer road.

        Weather only ever ADDS points, so the route the provider failed on will
        usually look calmer. Recommending it would be recommending the route we
        know least about, in the exact conditions - a storm knocking a free API
        about - where that is most likely to happen.
        """
        primary = _candidate("p", "PRIMARY", score=61, unavailable=("landslide",))
        unmeasured = _candidate(
            "b",
            "EMERGENCY_BACKUP",
            score=12,
            unavailable=("landslide", "weather"),
        )

        result = rr.recommend([primary, unmeasured])

        assert result.recommended_route_id == "p", (
            "recommended a route on the strength of evidence it did not have"
        )
        assert rr.REASON_NOT_COMPARABLE in result.reason_codes
        assert result.comparable is False
        assert result.tradeoff is None
        assert "weather" in result.unavailable_inputs

    def test_equally_blind_routes_are_still_comparable(self) -> None:
        """Symmetric ignorance is fair; the distance and duration are real."""
        blind = ("landslide", "weather")
        result = rr.recommend(
            [
                _candidate("p", "PRIMARY", score=30, unavailable=blind),
                _candidate("b", "EMERGENCY_BACKUP", score=15, unavailable=blind),
            ]
        )
        assert result.recommended_route_id == "b"
        assert result.comparable is True
        assert set(result.unavailable_inputs) == set(blind)


class TestMissingEstimatesStayMissing:
    def test_a_null_duration_is_never_treated_as_zero(self) -> None:
        result = rr.recommend(
            [
                _candidate("p", "PRIMARY", score=60, duration_min=200.0),
                _candidate("b", "EMERGENCY_BACKUP", score=20, duration_min=None),
            ]
        )
        assert result.recommended_route_id == "b"
        assert result.tradeoff is not None
        assert result.tradeoff.duration_delta_min is None, (
            "a missing estimate was rendered as a number"
        )
        assert rr.REASON_DURATION_UNKNOWN in result.reason_codes
        assert rr.REASON_FASTER not in result.reason_codes

    def test_a_route_with_no_duration_does_not_win_a_tie(self) -> None:
        """Sorting must not let an absent estimate behave like zero minutes."""
        known = _candidate("a-known", "EMERGENCY_BACKUP", score=10, duration_min=100.0)
        unknown = _candidate(
            "b-unknown", "EMERGENCY_BACKUP", score=10, duration_min=None
        )
        result = rr.recommend(
            [_candidate("p", "PRIMARY", score=90), unknown, known]
        )
        assert result.recommended_route_id == "a-known"


class TestDeterminism:
    def test_identical_candidates_resolve_the_same_way_every_time(self) -> None:
        """A screen that changes its mind between refreshes is not trusted."""
        primary = _candidate("p", "PRIMARY", score=90)
        first = _candidate("aaa", "EMERGENCY_BACKUP", score=10)
        second = _candidate("bbb", "EMERGENCY_BACKUP", score=10)

        forward = rr.recommend([primary, first, second])
        backward = rr.recommend([primary, second, first])

        assert forward.recommended_route_id == backward.recommended_route_id == "aaa"


class TestItDoesNotPretendToBeAI:
    def test_no_field_implies_a_model_or_a_probability(self) -> None:
        result = rr.recommend(
            [
                _candidate("p", "PRIMARY", score=61),
                _candidate("b", "EMERGENCY_BACKUP", score=28),
            ]
        )
        forbidden = {
            "confidence",
            "probability",
            "prediction",
            "predicted",
            "model_version",
            "accuracy",
            "percent",
            "percentage",
        }
        present = set(vars(result))
        assert not (present & forbidden), (
            f"{sorted(present & forbidden)} claims validation that never happened"
        )
        # The version string is the claim the output makes about itself, so it
        # is pinned exactly rather than pattern-matched: a rename to anything
        # implying a trained model has to break this test to happen.
        assert result.version == "explainable-route-recommendation-v1"


class TestAgainstRealScores:
    """One end-to-end pass through the real scorer, not hand-built RouteRisk."""

    def test_a_wet_route_loses_to_a_dry_one_of_similar_length(self) -> None:
        def obs(precip: float) -> WeatherObservation:
            return WeatherObservation(
                lat=26.1,
                lon=91.7,
                provider="test",
                observed_at=NOW - timedelta(minutes=5),
                temperature_c=27.0,
                precipitation_mm=precip,
                wind_gust_kmh=10.0,
            )

        # LS-7: both routes carry sufficient landslide evidence, so this test
        # exercises the WEATHER comparison it is named for rather than the
        # eligibility gate. Identical on both sides, so it cannot tilt the result.
        from app.domain.landslide import DataStatus, LandslideAssessment, LandslideRisk

        checked = LandslideAssessment(
            risk=LandslideRisk.LOW, data_status=DataStatus.AVAILABLE
        )
        wet = assess(
            distance_km=305.0,
            duration_min=221.0,
            observations=[obs(9.0) for _ in range(5)],
            landslide=checked,
            now=NOW,
        )
        dry = assess(
            distance_km=326.0,
            duration_min=244.0,
            observations=[obs(0.0) for _ in range(5)],
            landslide=checked,
            now=NOW,
        )
        assert wet.score > dry.score

        result = rr.recommend(
            [
                rr.RouteCandidate("p", "PRIMARY", 305.0, 221.0, wet),
                rr.RouteCandidate("b", "EMERGENCY_BACKUP", 326.0, 244.0, dry),
            ]
        )
        assert result.recommended_route_id == "b"
        assert result.tradeoff is not None
        assert result.tradeoff.risk_delta_points == dry.score - wet.score
        assert result.tradeoff.risk_delta_points < 0


class TestPropertiesHoldAcrossTheWholeInputRange:
    """A sweep, not an example.

    The tests above pin chosen cases. These assert the properties that must
    hold for EVERY pair the rule can be handed, because a comparison rule fails
    in the gaps between the examples somebody thought to write - and a
    dispatcher acting on a recommendation cannot check it against the
    components the way a reviewer can.
    """

    SCORES = (0, 10, 20, 30, 40, 50, 60, 70, 85, 100)
    SHAPES = ((100.0, 90.0), (150.0, 130.0), (305.0, 221.0), (400.0, 300.0))

    def _pairs(self):
        import itertools

        for (sa, sb), (da, db) in itertools.product(
            itertools.product(self.SCORES, repeat=2),
            itertools.product(self.SHAPES, repeat=2),
        ):
            yield (
                _candidate("p", "PRIMARY", score=sa, distance_km=da[0], duration_min=da[1]),
                _candidate(
                    "b", "EMERGENCY_BACKUP", score=sb, distance_km=db[0], duration_min=db[1]
                ),
            )

    def test_it_never_advises_the_riskier_route(self) -> None:
        for baseline, other in self._pairs():
            result = rr.recommend([baseline, other])
            chosen = baseline if result.recommended_route_id == "p" else other
            rejected = other if chosen is baseline else baseline
            assert chosen.risk.score <= rejected.risk.score, (
                f"advised {chosen.risk.score} over {rejected.risk.score}"
            )

    def test_it_never_switches_below_the_published_margin(self) -> None:
        """The margin is the promise. A switch costs real fuel and hours."""
        for baseline, other in self._pairs():
            result = rr.recommend([baseline, other])
            if result.recommended_route_id == "p":
                continue
            gain = baseline.risk.score - other.risk.score
            assert gain >= rr.MIN_RISK_MARGIN_POINTS, (
                f"switched on a {gain}-point gain"
            )

    def test_every_switch_carries_its_tradeoff(self) -> None:
        """A manager told to take a different road gets the cost of taking it."""
        for baseline, other in self._pairs():
            result = rr.recommend([baseline, other])
            if result.recommended_route_id != "p":
                assert result.tradeoff is not None

    def test_asymmetric_evidence_never_switches_at_any_gap(self) -> None:
        """Not at 10 points, not at 100.

        The comparability rule has to hold across the whole range, because the
        gap it produces is largest exactly when the missing factor matters
        most - weather only ever ADDS points, so the unmeasured route looks
        best when the storm is worst.
        """
        for score_a in self.SCORES:
            for score_b in self.SCORES:
                result = rr.recommend(
                    [
                        _candidate(
                            "p", "PRIMARY", score=score_a, unavailable=("landslide",)
                        ),
                        _candidate(
                            "b",
                            "EMERGENCY_BACKUP",
                            score=score_b,
                            unavailable=("landslide", "weather"),
                        ),
                    ]
                )
                assert result.recommended_route_id == "p"
                assert rr.REASON_NOT_COMPARABLE in result.reason_codes
