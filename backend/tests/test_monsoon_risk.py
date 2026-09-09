"""Monsoon Risk Engine V1: the weighting, and the things it refuses to fold in.

Pure domain, clock injected. Two properties carry the weight here:

  - passability is NOT the score, so a closed road can never lose a comparison
    narrowly to an open one;
  - an absent input is named, never scored as zero, so a segment with no
    inventory coverage does not read as a segment with a clean record.
"""

from datetime import UTC, datetime, timedelta

from app.domain import monsoon_risk as mr
from app.domain.road_memory import (
    Evidence,
    EvidenceKind,
    EvidenceSource,
    RoadStatus,
    apply,
)

JULY = datetime(2026, 7, 15, 6, 0, tzinfo=UTC)
JANUARY = datetime(2026, 1, 15, 6, 0, tzinfo=UTC)
MAY = datetime(2026, 5, 15, 6, 0, tzinfo=UTC)


def _knowledge(kind: EvidenceKind, source: EvidenceSource, *, at: datetime, now):
    return apply(
        [Evidence(kind=kind, source=source, observed_at=at)], now=now
    )


def _open(now: datetime, *, age_days: int = 1):
    return _knowledge(
        EvidenceKind.PASSAGE_OBSERVED,
        EvidenceSource.FLEET_TRAVERSAL,
        at=now - timedelta(days=age_days),
        now=now,
    )


class TestPassabilityIsNotAScore:
    """The structural decision, and the reason for it."""

    def test_a_closed_road_is_refused_not_merely_scored_high(self) -> None:
        closed = _knowledge(
            EvidenceKind.CLOSURE_DECLARED,
            EvidenceSource.OFFICIAL_AGENCY,
            at=JULY - timedelta(hours=6),
            now=JULY,
        )
        result = mr.assess(knowledge=closed, now=JULY)

        assert result.passable == mr.NOT_PASSABLE
        assert mr.REASON_ROAD_CLOSED in result.reason_codes

    def test_a_closed_road_cannot_lose_a_comparison_to_an_open_one(self) -> None:
        """The failure the separate field exists to make impossible.

        A closed segment scoring 100 against an open one scoring 96 would be a
        four-point preference for the road that exists. Passability is read
        first and is not a number, so there is nothing to compare.
        """
        closed = mr.assess(
            knowledge=_knowledge(
                EvidenceKind.CLOSURE_DECLARED,
                EvidenceSource.OFFICIAL_AGENCY,
                at=JANUARY,
                now=JANUARY,
            ),
            now=JANUARY,
        )
        wide_open = mr.assess(
            history=mr.SegmentHistory(recorded_incidents=4),
            knowledge=_open(JULY),
            recent_rainfall_mm=200.0,
            now=JULY,
        )

        assert wide_open.score > closed.score, (
            "the fixture is not exercising the case it claims to"
        )
        assert closed.passable == mr.NOT_PASSABLE
        assert wide_open.passable == mr.PASSABLE

    def test_a_repair_claim_is_not_passable(self) -> None:
        """The state that most looks like a yes."""
        result = mr.assess(
            knowledge=_knowledge(
                EvidenceKind.REPAIR_CLAIMED,
                EvidenceSource.OFFICIAL_AGENCY,
                at=JULY - timedelta(hours=1),
                now=JULY,
            ),
            now=JULY,
        )
        assert result.passable == mr.UNVERIFIED
        assert mr.REASON_REPAIR_UNCONFIRMED in result.reason_codes

    def test_an_unobserved_segment_is_unverified_not_passable(self) -> None:
        result = mr.assess(now=JULY)
        assert result.passable == mr.UNVERIFIED
        assert mr.REASON_ROAD_UNVERIFIED in result.reason_codes

    def test_a_stale_open_observation_stops_being_passable(self) -> None:
        result = mr.assess(knowledge=_open(JULY, age_days=60), now=JULY)
        assert result.passable == mr.UNVERIFIED
        assert mr.REASON_STATUS_STALE in result.reason_codes


class TestAbsentInputsAreNamed:
    def test_no_inventory_coverage_is_not_a_clean_record(self) -> None:
        """`None` and `0` are different facts, and the rarer one is `0`."""
        unknown = mr.assess(knowledge=_open(JULY), now=JULY)
        assert unknown.inputs[mr.FACTOR_RECURRENCE] == "NOT_AVAILABLE"
        assert mr.REASON_NO_HISTORY in unknown.reason_codes
        assert mr.FACTOR_RECURRENCE in unknown.unavailable

        surveyed = mr.assess(
            history=mr.SegmentHistory(recorded_incidents=0),
            knowledge=_open(JULY),
            now=JULY,
        )
        assert surveyed.inputs[mr.FACTOR_RECURRENCE] == "AVAILABLE"
        assert mr.REASON_NO_HISTORY not in surveyed.reason_codes

    def test_missing_rainfall_is_reported_not_scored_as_dry(self) -> None:
        result = mr.assess(knowledge=_open(JULY), now=JULY)
        assert result.inputs[mr.FACTOR_RAINFALL] == "NOT_AVAILABLE"
        assert mr.REASON_NO_RAINFALL in result.reason_codes
        assert not any(
            c.code == "RAINFALL_ACCUMULATION" for c in result.components
        )

    def test_season_is_always_available_because_it_is_a_calendar_fact(self) -> None:
        assert mr.assess(now=JULY).inputs[mr.FACTOR_SEASON] == "AVAILABLE"


class TestTheWeighting:
    def test_the_score_is_the_sum_of_its_stated_components(self) -> None:
        """No hidden term. A dispatcher can add the breakdown up by hand."""
        result = mr.assess(
            history=mr.SegmentHistory(recorded_incidents=2, monsoon_incidents=2),
            knowledge=_open(JULY),
            recent_rainfall_mm=50.0,
            now=JULY,
        )
        assert result.score == sum(c.points for c in result.components)
        assert 0 <= result.score <= 100

    def test_monsoon_scores_above_pre_monsoon_above_dry_season(self) -> None:
        def season_only(now):
            return mr.assess(knowledge=_open(now), now=now).score

        assert season_only(JULY) > season_only(MAY) > season_only(JANUARY)

    def test_recurrence_saturates_rather_than_growing_without_bound(self) -> None:
        """A stretch with 40 recorded slides is not ten times one with four."""
        four = mr.assess(
            history=mr.SegmentHistory(
                recorded_incidents=mr.RECURRENCE_SATURATION
            ),
            knowledge=_open(JULY),
            now=JULY,
        )
        forty = mr.assess(
            history=mr.SegmentHistory(recorded_incidents=40),
            knowledge=_open(JULY),
            now=JULY,
        )
        assert four.score == forty.score

    def test_repeated_failure_is_called_out_by_code(self) -> None:
        result = mr.assess(
            history=mr.SegmentHistory(recorded_incidents=3),
            knowledge=_open(JULY),
            now=JULY,
        )
        assert mr.REASON_REPEAT_FAILURE in result.reason_codes

    def test_a_quiet_road_in_january_scores_low(self) -> None:
        result = mr.assess(
            history=mr.SegmentHistory(recorded_incidents=0),
            knowledge=_open(JANUARY),
            recent_rainfall_mm=0.0,
            now=JANUARY,
        )
        assert result.score == 0
        assert result.band == "LOW"
        assert result.passable == mr.PASSABLE

    def test_the_worst_case_is_bounded_at_100(self) -> None:
        result = mr.assess(
            history=mr.SegmentHistory(recorded_incidents=99, monsoon_incidents=99),
            knowledge=_knowledge(
                EvidenceKind.INCIDENT_REPORTED,
                EvidenceSource.OFFICIAL_AGENCY,
                at=JULY,
                now=JULY,
            ),
            recent_rainfall_mm=900.0,
            now=JULY,
        )
        assert result.score == 100
        assert result.band == "HIGH"


class TestItIsNotCalledAPrediction:
    def test_no_field_implies_a_trained_model(self) -> None:
        result = mr.assess(
            history=mr.SegmentHistory(recorded_incidents=2),
            knowledge=_open(JULY),
            recent_rainfall_mm=30.0,
            now=JULY,
        )
        forbidden = {
            "confidence",
            "probability",
            "prediction",
            "predicted_failure",
            "model_version",
            "accuracy",
            "forecast",
        }
        assert not (set(vars(result)) & forbidden), (
            "a weighted rule claimed validation that never happened"
        )
        assert result.version == "monsoon-risk-engine-v1"

    def test_the_band_thresholds_match_route_risk(self) -> None:
        """One scale, not two. A dispatcher reads both numbers on one screen."""
        from app.domain.route_risk import BAND_HIGH_AT, BAND_MODERATE_AT

        assert mr._band(BAND_HIGH_AT) == "HIGH"
        assert mr._band(BAND_MODERATE_AT) == "MODERATE"
        assert mr._band(BAND_MODERATE_AT - 1) == "LOW"


class TestComposesWithRoadMemory:
    def test_silence_after_a_closure_never_makes_a_segment_passable(self) -> None:
        """The end-to-end version of road_memory's central rule."""
        closure = [
            Evidence(
                kind=EvidenceKind.CLOSURE_DECLARED,
                source=EvidenceSource.OFFICIAL_AGENCY,
                observed_at=JANUARY,
            )
        ]
        for days in (1, 30, 200, 400):
            now = JANUARY + timedelta(days=days)
            result = mr.assess(knowledge=apply(closure, now=now), now=now)
            assert result.passable == mr.NOT_PASSABLE, (
                f"a closed road became plannable after {days} days of silence"
            )

    def test_a_truck_driving_through_restores_passability(self) -> None:
        history = [
            Evidence(
                kind=EvidenceKind.CLOSURE_DECLARED,
                source=EvidenceSource.OFFICIAL_AGENCY,
                observed_at=JULY - timedelta(days=10),
            ),
            Evidence(
                kind=EvidenceKind.PASSAGE_OBSERVED,
                source=EvidenceSource.FLEET_TRAVERSAL,
                observed_at=JULY - timedelta(hours=3),
            ),
        ]
        result = mr.assess(knowledge=apply(history, now=JULY), now=JULY)
        assert result.passable == mr.PASSABLE
        assert result.inputs[mr.FACTOR_ROAD_STATUS] == "AVAILABLE"
