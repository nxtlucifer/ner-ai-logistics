"""Dynamic reroute: when to speak, and what to say.

Pure domain tests. The three outcomes are the contract, and ALERT_ONLY is the
one worth reading first - it is what the system says on a single corridor that
has gone bad, which is the situation this project actually exists for and the
one a propose-or-stay-silent design has no words for.
"""

from datetime import UTC, datetime

import pytest

from app.domain import reroute
from app.domain import route_recommendation as rr
from app.domain.route_risk import NOT_AVAILABLE, RiskComponent, RouteRisk

NOW = datetime(2026, 9, 1, 6, 0, tzinfo=UTC)


def _risk(score: int, *, unavailable: tuple[str, ...] = ("landslide",)) -> RouteRisk:
    """A RouteRisk with a chosen score.

    LS-7: carries sufficient landslide evidence. These tests are about the
    reroute DECISION rule, and without it every candidate would be
    REQUIRES_REVIEW - correct policy, but it would quietly turn this suite
    into a test of the eligibility gate. Absence-of-evidence behaviour lives
    in tests/test_route_eligibility.py.
    """
    from app.domain.landslide import DataStatus, LandslideAssessment, LandslideRisk

    return RouteRisk(
        landslide=LandslideAssessment(
            risk=LandslideRisk.LOW, data_status=DataStatus.AVAILABLE
        ),
        score=score,
        band="HIGH" if score >= 60 else ("MODERATE" if score >= 30 else "LOW"),
        components=(),
        inputs={f: NOT_AVAILABLE for f in unavailable},
        unavailable=unavailable,
        reason_codes=(),
        observations_used=5,
        observations_stale=0,
        assessed_at=NOW,
    )


def rr_component(code: str, points: int) -> RiskComponent:
    """A scoring component with a chosen code and weight.

    Built directly so a test can say "45 points of rain" without reverse
    engineering it from millimetres and sample coverage.
    """
    return RiskComponent(code=code, label=code, points=points, detail="")


def _route(
    route_id: str,
    kind: str,
    *,
    score: int,
    duration_min: float | None = 220.0,
    distance_km: float | None = 300.0,
    unavailable: tuple[str, ...] = ("landslide",),
) -> rr.RouteCandidate:
    return rr.RouteCandidate(
        route_id=route_id,
        kind=kind,
        distance_km=distance_km,
        duration_min=duration_min,
        risk=_risk(score, unavailable=unavailable),
    )


class TestNothingHappensWhenNothingShould:
    def test_a_trip_not_in_transit_is_not_rerouted(self) -> None:
        """Changing a route before departure is planning, not rerouting."""
        result = reroute.assess(
            in_transit=False,
            selected=_route("s", "PRIMARY", score=95),
            alternatives=[_route("b", "EMERGENCY_BACKUP", score=5)],
        )
        assert result.outcome == reroute.OUTCOME_NO_ACTION
        assert result.reason_codes == (reroute.REASON_TRIP_NOT_IN_TRANSIT,)
        assert result.requires_a_human is False

    def test_no_selected_route_is_a_planning_gap_not_a_proposal(self) -> None:
        result = reroute.assess(
            in_transit=True,
            selected=None,
            alternatives=[_route("b", "EMERGENCY_BACKUP", score=5)],
        )
        assert result.outcome == reroute.OUTCOME_NO_ACTION
        assert result.reason_codes == (reroute.REASON_NO_SELECTED_ROUTE,)
        assert result.proposed_route_id is None

    def test_a_good_road_is_left_alone_even_with_a_better_one_beside_it(self) -> None:
        """The floor. Without it every parallel road becomes an interruption."""
        result = reroute.assess(
            in_transit=True,
            selected=_route("s", "PRIMARY", score=reroute.DETERIORATION_FLOOR - 1),
            alternatives=[_route("b", "EMERGENCY_BACKUP", score=0)],
        )
        assert result.outcome == reroute.OUTCOME_NO_ACTION
        assert reroute.REASON_WITHIN_TOLERANCE in result.reason_codes
        assert result.proposed_route_id is None
        assert result.selected_risk_score == reroute.DETERIORATION_FLOOR - 1


class TestAlertOnly:
    """A bad road with nowhere to go still has to be said out loud."""

    def test_a_deteriorated_single_corridor_alerts_without_proposing(self) -> None:
        result = reroute.assess(
            in_transit=True,
            selected=_route("s", "PRIMARY", score=88),
            alternatives=[],
        )
        assert result.outcome == reroute.OUTCOME_ALERT_ONLY
        assert result.requires_a_human is True
        assert reroute.REASON_DETERIORATED in result.reason_codes
        assert reroute.REASON_NO_BETTER_ALTERNATIVE in result.reason_codes
        assert result.proposed_route_id is None, (
            "an alert offered a road to take, which is a proposal wearing "
            "the wrong label"
        )

    def test_a_worse_alternative_does_not_become_a_proposal(self) -> None:
        result = reroute.assess(
            in_transit=True,
            selected=_route("s", "PRIMARY", score=70),
            alternatives=[_route("b", "EMERGENCY_BACKUP", score=95)],
        )
        assert result.outcome == reroute.OUTCOME_ALERT_ONLY
        assert result.proposed_route_id is None

    def test_a_marginally_better_alternative_does_not_become_a_proposal(self) -> None:
        """Below the margin, moving a moving truck is not justified."""
        result = reroute.assess(
            in_transit=True,
            selected=_route("s", "PRIMARY", score=70),
            alternatives=[
                _route(
                    "b",
                    "EMERGENCY_BACKUP",
                    score=70 - rr.MIN_RISK_MARGIN_POINTS + 1,
                )
            ],
        )
        assert result.outcome == reroute.OUTCOME_ALERT_ONLY
        assert reroute.REASON_NO_BETTER_ALTERNATIVE in result.reason_codes

    def test_an_alternative_scored_on_different_evidence_is_not_proposed(self) -> None:
        """The comparability rule reaches the reroute path too.

        This is the dangerous shape: a storm bad enough to push the selected
        route over the floor is also what knocks the weather provider about, so
        the alternative gets scored blind, scores lower for that reason alone,
        and looks like an escape route. It is not offered.
        """
        result = reroute.assess(
            in_transit=True,
            selected=_route("s", "PRIMARY", score=85, unavailable=("landslide",)),
            alternatives=[
                _route(
                    "b",
                    "EMERGENCY_BACKUP",
                    score=10,
                    unavailable=("landslide", "weather"),
                )
            ],
        )
        assert result.outcome == reroute.OUTCOME_ALERT_ONLY
        assert result.proposed_route_id is None
        assert rr.REASON_NOT_COMPARABLE in result.reason_codes
        assert "weather" in result.unavailable_inputs


class TestPropose:
    def test_a_clearly_better_road_is_proposed_with_its_evidence(self) -> None:
        selected = _route("s", "PRIMARY", score=85, duration_min=221.0)
        better = _route("b", "EMERGENCY_BACKUP", score=28, duration_min=244.0)

        result = reroute.assess(
            in_transit=True, selected=selected, alternatives=[better]
        )

        assert result.outcome == reroute.OUTCOME_PROPOSE
        assert result.requires_a_human is True
        assert result.proposed_route_id == "b"
        assert result.selected_route_id == "s"
        assert result.selected_risk_score == 85
        assert result.selected_risk_band == "HIGH"
        assert reroute.REASON_BETTER_ROUTE_AVAILABLE in result.reason_codes

        # The proposal arrives with the cost of taking it.
        assert result.comparison is not None
        assert result.comparison.tradeoff is not None
        assert result.comparison.tradeoff.risk_delta_points == -57
        assert result.comparison.tradeoff.duration_delta_min == pytest.approx(23.0)

    def test_the_road_the_truck_is_on_is_the_baseline_not_the_primary(self) -> None:
        """A trip already rerouted once must not be compared to the road it left.

        The truck is on the backup. The primary it abandoned may well score
        lower now that the storm has moved - proposing a switch back to it on
        that basis would be measuring the wrong gap, and would send a driver
        back down a road that was abandoned for a reason.
        """
        abandoned_primary = _route("p", "PRIMARY", score=20)
        on_this_road = _route("b", "EMERGENCY_BACKUP", score=75)
        genuinely_better = _route("c", "EMERGENCY_BACKUP", score=30)

        result = reroute.assess(
            in_transit=True,
            selected=on_this_road,
            alternatives=[abandoned_primary, genuinely_better],
        )

        assert result.comparison is not None
        assert result.comparison.baseline_route_id == "b", (
            "the comparison was anchored to a road the truck is not on"
        )
        # The abandoned primary is the lowest-risk candidate, so it legitimately
        # wins on the figures - the point is that it won against the CURRENT
        # road, not that it was excluded.
        assert result.outcome == reroute.OUTCOME_PROPOSE
        assert result.proposed_route_id == "p"
        assert result.comparison.tradeoff is not None
        assert result.comparison.tradeoff.risk_delta_points == -55


class TestItDecidesNothingByItself:
    def test_the_assessment_carries_no_instruction_to_apply_itself(self) -> None:
        """A proposal is a sentence, not a switch.

        The dataclass is frozen and holds ids and figures only. Nothing in it
        names a session, an actor or a write - applying it is a separate,
        explicit act by a person in `app/services/reroute.py`.
        """
        result = reroute.assess(
            in_transit=True,
            selected=_route("s", "PRIMARY", score=85),
            alternatives=[_route("b", "EMERGENCY_BACKUP", score=20)],
        )
        assert result.outcome == reroute.OUTCOME_PROPOSE

        with pytest.raises(Exception):
            result.outcome = reroute.OUTCOME_NO_ACTION  # type: ignore[misc]

        forbidden = {"confidence", "model_version", "probability", "auto_apply"}
        assert not (set(vars(result)) & forbidden)
        assert result.version == "reroute-assessment-v1"

    def test_the_floor_and_the_margin_travel_with_the_answer(self) -> None:
        """A threshold nobody can see is a threshold nobody can argue with."""
        result = reroute.assess(
            in_transit=True,
            selected=_route("s", "PRIMARY", score=85),
            alternatives=[],
        )
        assert result.floor_points == reroute.DETERIORATION_FLOOR
        assert result.margin_points == rr.MIN_RISK_MARGIN_POINTS


class TestSevereConditionsDoNotNeedALongTrip:
    """A cloudburst does not become acceptable because the trip is short.

    `route_risk.score` mixes CONDITION - weather, up to 70 points - with
    EXPOSURE - distance and duration, up to 30. That mix is right for choosing
    between two routes: a longer detour genuinely costs more time on the road.

    It is the wrong question for "has this road deteriorated". Exposure is a
    property of the journey, not of the weather sitting on it, and gating the
    reroute decision on the total means a short trip can never be bad enough to
    reconsider. Measured against the real scoring rule: heavy rain along the
    WHOLE corridor scores 60 on a 305 km route and only 53 on a 150 km one, so
    the advisory would stay silent on most NER corridors, which run 100-300 km.

    So deterioration has two triggers, and this pins the second. The first is
    unchanged.
    """

    def test_a_short_route_in_severe_conditions_still_deteriorates(self) -> None:
        selected = _route("s", "PRIMARY", score=53)
        # Heavy rain end to end: below the total-score floor on a short route,
        # and severe on its own terms.
        object.__setattr__(
            selected.risk,
            "components",
            (
                rr_component("RAIN_EXPOSURE", 45),
                rr_component("DURATION_EXPOSURE", 5),
                rr_component("DISTANCE_EXPOSURE", 3),
            ),
        )
        assert selected.risk.score < reroute.DETERIORATION_FLOOR

        result = reroute.assess(
            in_transit=True, selected=selected, alternatives=[]
        )
        assert result.outcome == reroute.OUTCOME_ALERT_ONLY
        assert reroute.REASON_SEVERE_CONDITIONS in result.reason_codes

    def test_a_long_dull_route_does_not_deteriorate_on_exposure_alone(self) -> None:
        """The other half of the same point.

        Distance and duration must not be able to raise an alert by themselves:
        a long trip in fine weather is a long trip, not a hazard.
        """
        selected = _route("s", "PRIMARY", score=29)
        object.__setattr__(
            selected.risk,
            "components",
            (
                rr_component("DURATION_EXPOSURE", 20),
                rr_component("DISTANCE_EXPOSURE", 9),
            ),
        )
        result = reroute.assess(
            in_transit=True, selected=selected, alternatives=[]
        )
        assert result.outcome == reroute.OUTCOME_NO_ACTION

    def test_a_passing_shower_does_not_trigger_it(self) -> None:
        """Heavy rain on one sampled point of five is a squall crossing the
        road, not the road going bad."""
        selected = _route("s", "PRIMARY", score=40)
        object.__setattr__(
            selected.risk,
            "components",
            (
                rr_component("RAIN_EXPOSURE", 27),
                rr_component("DURATION_EXPOSURE", 9),
                rr_component("DISTANCE_EXPOSURE", 4),
            ),
        )
        result = reroute.assess(
            in_transit=True, selected=selected, alternatives=[]
        )
        assert result.outcome == reroute.OUTCOME_NO_ACTION

    def test_the_total_score_trigger_is_unchanged(self) -> None:
        """Additive, not a replacement: anything that fired before still does."""
        selected = _route("s", "PRIMARY", score=85)
        result = reroute.assess(
            in_transit=True, selected=selected, alternatives=[]
        )
        assert result.outcome == reroute.OUTCOME_ALERT_ONLY
        assert reroute.REASON_DETERIORATED in result.reason_codes

    def test_severe_conditions_can_also_produce_a_proposal(self) -> None:
        selected = _route("s", "PRIMARY", score=53)
        object.__setattr__(
            selected.risk,
            "components",
            (rr_component("RAIN_EXPOSURE", 45), rr_component("DISTANCE_EXPOSURE", 8)),
        )
        better = _route("b", "EMERGENCY_BACKUP", score=20)
        result = reroute.assess(
            in_transit=True, selected=selected, alternatives=[better]
        )
        assert result.outcome == reroute.OUTCOME_PROPOSE
        assert result.proposed_route_id == "b"
