"""Road memory: the rules about what silence is allowed to mean.

Pure domain tests, clock injected. The tests worth reading are the ones about
time, because "nothing further was heard" is the input this model exists to
handle correctly and the one every naive version gets wrong in one direction or
the other.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.domain.road_memory import (
    CAN_OPEN,
    FRESHNESS_CURRENT,
    FRESHNESS_STALE,
    REPAIR_VERIFICATION_WINDOW,
    Evidence,
    EvidenceKind,
    EvidenceSource,
    RoadMemoryViolation,
    RoadStatus,
    apply,
    recurrence,
)

MONDAY = datetime(2026, 7, 6, 8, 0, tzinfo=UTC)


def _ev(
    kind: EvidenceKind,
    source: EvidenceSource,
    *,
    at: datetime = MONDAY,
    reference: str | None = "bulletin-1",
) -> Evidence:
    return Evidence(kind=kind, source=source, observed_at=at, reference=reference)


class TestSilenceNeverRepairsARoad:
    """The rule the whole module exists for."""

    def test_an_incident_left_alone_stays_an_incident_forever(self) -> None:
        history = [
            _ev(EvidenceKind.INCIDENT_REPORTED, EvidenceSource.OFFICIAL_AGENCY)
        ]
        for months in (0, 1, 6, 24):
            later = MONDAY + timedelta(days=30 * months)
            assert apply(history, now=later).status is RoadStatus.REPORTED_INCIDENT

    def test_a_closure_left_alone_stays_closed_forever(self) -> None:
        history = [_ev(EvidenceKind.CLOSURE_DECLARED, EvidenceSource.OFFICIAL_AGENCY)]
        assert (
            apply(history, now=MONDAY + timedelta(days=365)).status
            is RoadStatus.CLOSED
        )

    def test_an_unconfirmed_repair_claim_escalates_it_does_not_resolve(self) -> None:
        """Time is only ever allowed to increase doubt.

        AWAITING_VERIFICATION is LESS usable than REPAIR_REPORTED, not more.
        A version of this that let the window expire into VERIFIED_OPEN would
        be the exact failure the state machine was drawn to prevent.
        """
        history = [_ev(EvidenceKind.REPAIR_CLAIMED, EvidenceSource.OFFICIAL_AGENCY)]

        inside = MONDAY + REPAIR_VERIFICATION_WINDOW - timedelta(minutes=1)
        assert apply(history, now=inside).status is RoadStatus.REPAIR_REPORTED

        outside = MONDAY + REPAIR_VERIFICATION_WINDOW + timedelta(minutes=1)
        escalated = apply(history, now=outside)
        assert escalated.status is RoadStatus.AWAITING_VERIFICATION
        assert escalated.is_usable(outside) is False

    def test_no_elapsed_time_reaches_verified_open_from_anything(self) -> None:
        """Exhaustive over the states silence could plausibly be argued to fix."""
        starts = [
            EvidenceKind.INCIDENT_REPORTED,
            EvidenceKind.CLOSURE_DECLARED,
            EvidenceKind.REPAIR_CLAIMED,
        ]
        for kind in starts:
            history = [_ev(kind, EvidenceSource.OFFICIAL_AGENCY)]
            for days in (1, 3, 30, 400):
                status = apply(history, now=MONDAY + timedelta(days=days)).status
                assert status is not RoadStatus.VERIFIED_OPEN, (
                    f"{kind.value} became open after {days} days of silence"
                )


class TestSilenceNeverClosesARoadEither:
    def test_an_old_open_road_stays_open_but_goes_stale(self) -> None:
        """The other direction. Inventing a closure strands cargo.

        A dispatcher must see the belief aging - not a status that changed
        without anybody observing anything.
        """
        history = [
            _ev(EvidenceKind.PASSAGE_OBSERVED, EvidenceSource.FLEET_TRAVERSAL)
        ]
        much_later = MONDAY + timedelta(days=90)

        knowledge = apply(history, now=much_later)
        assert knowledge.status is RoadStatus.VERIFIED_OPEN
        assert knowledge.freshness(much_later) == FRESHNESS_STALE
        assert knowledge.is_usable(much_later) is False, (
            "a three-month-old observation was treated as a current one"
        )

        assert knowledge.freshness(MONDAY + timedelta(days=1)) == FRESHNESS_CURRENT
        assert knowledge.is_usable(MONDAY + timedelta(days=1)) is True


class TestOnlyObservationOpensARoad:
    def test_a_truck_that_drove_through_can_open_it(self) -> None:
        """The strongest evidence available, and it is our own."""
        history = [
            _ev(EvidenceKind.CLOSURE_DECLARED, EvidenceSource.OFFICIAL_AGENCY),
            _ev(
                EvidenceKind.PASSAGE_OBSERVED,
                EvidenceSource.FLEET_TRAVERSAL,
                at=MONDAY + timedelta(days=2),
            ),
        ]
        knowledge = apply(history, now=MONDAY + timedelta(days=2, hours=1))
        assert knowledge.status is RoadStatus.VERIFIED_OPEN
        assert knowledge.source is EvidenceSource.FLEET_TRAVERSAL

    def test_hearsay_cannot_open_a_road(self) -> None:
        """A driver repeating what they heard is not a driver who drove it."""
        for source in (
            EvidenceSource.UNVERIFIED_REPORT,
            EvidenceSource.OPERATOR_REPORT,
        ):
            assert source not in CAN_OPEN
            with pytest.raises(RoadMemoryViolation) as exc:
                apply(
                    [
                        _ev(
                            EvidenceKind.REOPENING_DECLARED,
                            source,
                            at=MONDAY + timedelta(days=1),
                        )
                    ],
                    now=MONDAY + timedelta(days=1),
                )
            assert source.value in str(exc.value)

    def test_an_unverified_report_may_still_close_a_road(self) -> None:
        """The asymmetry is deliberate.

        Weak evidence is enough to raise doubt and never enough to remove it.
        Refusing to record a rumoured landslide until it is confirmed is how a
        truck gets sent into one.
        """
        knowledge = apply(
            [
                _ev(
                    EvidenceKind.INCIDENT_REPORTED,
                    EvidenceSource.UNVERIFIED_REPORT,
                )
            ],
            now=MONDAY,
        )
        assert knowledge.status is RoadStatus.REPORTED_INCIDENT


class TestUnknownIsNotOpen:
    def test_a_road_nobody_looked_at_is_unknown(self) -> None:
        knowledge = apply([], now=MONDAY)
        assert knowledge.status is RoadStatus.UNKNOWN
        assert knowledge.as_of is None
        assert knowledge.is_usable(MONDAY) is False, (
            "an unobserved road was treated as a passable one"
        )
        assert knowledge.freshness(MONDAY) == FRESHNESS_STALE


class TestTheLogIsTheProduct:
    def test_belief_follows_observation_order_not_insertion_order(self) -> None:
        """Evidence arriving late must not overwrite a newer observation."""
        early_closure = _ev(
            EvidenceKind.CLOSURE_DECLARED, EvidenceSource.OFFICIAL_AGENCY, at=MONDAY
        )
        later_passage = _ev(
            EvidenceKind.PASSAGE_OBSERVED,
            EvidenceSource.FLEET_TRAVERSAL,
            at=MONDAY + timedelta(days=3),
        )
        now = MONDAY + timedelta(days=4)

        assert apply([early_closure, later_passage], now=now).status is (
            RoadStatus.VERIFIED_OPEN
        )
        # Same facts, delivered out of order.
        assert apply([later_passage, early_closure], now=now).status is (
            RoadStatus.VERIFIED_OPEN
        )

    def test_every_observation_is_counted_not_just_the_decisive_one(self) -> None:
        history = [
            _ev(EvidenceKind.INCIDENT_REPORTED, EvidenceSource.UNVERIFIED_REPORT),
            _ev(
                EvidenceKind.CLOSURE_DECLARED,
                EvidenceSource.OFFICIAL_AGENCY,
                at=MONDAY + timedelta(hours=2),
            ),
        ]
        assert apply(history, now=MONDAY + timedelta(hours=3)).evidence_count == 2

    def test_recurrence_counts_incidents_not_the_closures_they_caused(self) -> None:
        """One slide reported twice is one event.

        The figure a monsoon risk engine will lean on, so it is computed from
        the log rather than kept as a counter that can drift away from it.
        """
        history = [
            _ev(EvidenceKind.INCIDENT_REPORTED, EvidenceSource.OFFICIAL_AGENCY),
            _ev(
                EvidenceKind.CLOSURE_DECLARED,
                EvidenceSource.OFFICIAL_AGENCY,
                at=MONDAY + timedelta(hours=1),
            ),
            _ev(
                EvidenceKind.REPAIR_CLAIMED,
                EvidenceSource.OFFICIAL_AGENCY,
                at=MONDAY + timedelta(days=5),
            ),
            _ev(
                EvidenceKind.INCIDENT_REPORTED,
                EvidenceSource.OPERATOR_REPORT,
                at=MONDAY + timedelta(days=400),
            ),
        ]
        assert recurrence(history) == 2
        assert recurrence(history, since=MONDAY + timedelta(days=100)) == 1


class TestNoPredictionIsMade:
    def test_knowledge_carries_no_probability_or_model(self) -> None:
        knowledge = apply(
            [_ev(EvidenceKind.PASSAGE_OBSERVED, EvidenceSource.FLEET_TRAVERSAL)],
            now=MONDAY,
        )
        forbidden = {
            "confidence",
            "probability",
            "predicted_reopen_at",
            "model_version",
            "estimated_status",
        }
        assert not (set(vars(knowledge)) & forbidden)
        assert knowledge.version == "road-memory-v1"
