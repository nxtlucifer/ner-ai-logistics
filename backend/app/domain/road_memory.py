"""Road memory: what is known about a stretch of road, and how well.

The question this answers is not "is the road open". It is "what is the last
thing anybody actually observed about this road, who observed it, and how long
ago" - because the first question has no honest answer most of the time, and a
system that produces one anyway will eventually route a loaded truck onto a
washed-out hillside.

THE RULE THIS MODULE EXISTS TO ENFORCE

    Silence is not evidence.

No amount of elapsed time may improve a road's status. A landslide reported on
Tuesday with nothing further heard by Friday is not a repaired road; it is a
landslide nobody has followed up. Every path toward VERIFIED_OPEN requires a
POSITIVE observation, and `apply` refuses any other route to it.

The reverse also holds, and is easier to get wrong in the other direction:
silence must not close a road either. Inventing a closure strands cargo and
teaches dispatchers to ignore the system, which costs more than it saves. What
silence changes is FRESHNESS, never STATUS - see `Knowledge.freshness`.

WHY THE STATE MACHINE HAS FIVE STATES AND NOT TWO

    VERIFIED_OPEN          somebody observed traffic passing
    REPORTED_INCIDENT      something happened; passability unknown
    CLOSED                 an authority said it is shut
    REPAIR_REPORTED        somebody claims it is fixed - unconfirmed
    AWAITING_VERIFICATION  a repair claim has gone unconfirmed long enough
                           that acting on it needs a decision, not a default

REPAIR_REPORTED and AWAITING_VERIFICATION are the two that carry the weight. A
repair claim is exactly the kind of evidence that looks like an answer and is
not one: it usually arrives from a source with an interest in the road being
open, and it is the point where a naive system would flip to OPEN and route a
truck. Keeping the claim and the confirmation as separate states is what makes
the gap visible instead of assumed.

WHY EVIDENCE CARRIES A SOURCE

Not all observations are equal, and the strongest one available here is not an
official bulletin - it is `FLEET_TRAVERSAL`: one of our own trucks recorded GPS
fixes along the segment and came out the other side. That is a fact about the
physical world observed by this system, and it is the only evidence that can
open a CLOSED road without an authority saying so.

NO MODEL PARTICIPATES

Deterministic transitions over typed evidence. Nothing here predicts anything,
and `docs/ROAD_MEMORY.md` records why the sources available today do not yet
support a model that could.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from typing import Final

VERSION: Final[str] = "road-memory-v1"


class RoadStatus(str, Enum):
    """What is believed about a segment, in order of how usable it is."""

    VERIFIED_OPEN = "VERIFIED_OPEN"
    REPAIR_REPORTED = "REPAIR_REPORTED"
    AWAITING_VERIFICATION = "AWAITING_VERIFICATION"
    REPORTED_INCIDENT = "REPORTED_INCIDENT"
    CLOSED = "CLOSED"
    #: Nothing has ever been observed. Distinct from VERIFIED_OPEN, which is a
    #: claim: a road nobody has looked at is not a road known to be fine.
    UNKNOWN = "UNKNOWN"


class EvidenceKind(str, Enum):
    """What was observed. Not who said it - that is `EvidenceSource`."""

    INCIDENT_REPORTED = "INCIDENT_REPORTED"
    CLOSURE_DECLARED = "CLOSURE_DECLARED"
    REPAIR_CLAIMED = "REPAIR_CLAIMED"
    #: Positive observation that the road carried traffic.
    PASSAGE_OBSERVED = "PASSAGE_OBSERVED"
    REOPENING_DECLARED = "REOPENING_DECLARED"


class EvidenceSource(str, Enum):
    """Who observed it. Ordering here is not authority, it is provenance."""

    #: GSI, ASDMA, PWD, NHAI, BRO - a body responsible for the road or the
    #: hazard. See docs/ROAD_MEMORY.md for what each actually publishes.
    OFFICIAL_AGENCY = "OFFICIAL_AGENCY"
    #: One of our own trucks, from its GPS track. The only source that can
    #: produce PASSAGE_OBSERVED, because it is the only one this system watches
    #: directly.
    FLEET_TRAVERSAL = "FLEET_TRAVERSAL"
    #: A driver or manager typing what they saw.
    OPERATOR_REPORT = "OPERATOR_REPORT"
    #: Media, social, aggregators. Recorded, never trusted alone to open a road.
    UNVERIFIED_REPORT = "UNVERIFIED_REPORT"


#: How long a repair claim may stand unconfirmed before it is escalated from
#: "somebody says it is fixed" to "somebody needs to check".
#:
#: Note what this does NOT do: it never moves a segment toward OPEN. It moves a
#: claim from REPAIR_REPORTED to AWAITING_VERIFICATION, which is strictly less
#: usable. Time is only ever allowed to increase doubt.
REPAIR_VERIFICATION_WINDOW: Final[timedelta] = timedelta(hours=48)

#: After this, an observation still stands but stops being current. A road
#: driven three weeks ago is evidence about three weeks ago, and in a monsoon
#: that is a different road.
FRESHNESS_WINDOW: Final[timedelta] = timedelta(days=7)

FRESHNESS_CURRENT: Final[str] = "CURRENT"
FRESHNESS_STALE: Final[str] = "STALE"

#: Sources permitted to move a segment to VERIFIED_OPEN.
#:
#: An UNVERIFIED_REPORT cannot open a road, and neither can an OPERATOR_REPORT
#: on its own - a driver saying "I heard it is clear" is hearsay, while the
#: same driver's truck actually going through arrives as FLEET_TRAVERSAL and
#: counts. The distinction is between what someone believes and what was
#: observed.
CAN_OPEN: Final[frozenset[EvidenceSource]] = frozenset(
    {EvidenceSource.OFFICIAL_AGENCY, EvidenceSource.FLEET_TRAVERSAL}
)


class RoadMemoryViolation(ValueError):
    """Raised when a transition would assert more than the evidence supports."""


@dataclass(frozen=True)
class Evidence:
    """One observation about one segment, at one moment, from one source.

    Frozen and append-only by intent: the history is the product. A corrected
    observation is a NEW piece of evidence, never an edit - an incident report
    that turned out to be wrong is itself a fact about how this road is
    reported on.
    """

    kind: EvidenceKind
    source: EvidenceSource
    observed_at: datetime
    #: Free text from the source, kept verbatim. Never parsed for meaning: the
    #: meaning is in `kind`, which a human or an adapter chose deliberately.
    detail: str | None = None
    #: Where the claim came from - a bulletin URL, a trip id, an operator's
    #: user id. Evidence that cannot be traced back is evidence that cannot be
    #: checked when it turns out to matter.
    reference: str | None = None


@dataclass(frozen=True)
class Knowledge:
    """The current belief about a segment, and how much to trust it."""

    status: RoadStatus
    #: When the observation behind `status` was made. None only for UNKNOWN.
    as_of: datetime | None
    source: EvidenceSource | None
    #: Number of observations behind this belief, all of them, not just the
    #: decisive one.
    evidence_count: int
    version: str = VERSION

    def freshness(self, now: datetime) -> str:
        """CURRENT or STALE. Never a different status.

        This is the whole answer to "what does time do here". Time moves a
        belief from current to stale so a dispatcher can see the belief aging.
        It does not reopen roads and it does not close them.
        """
        if self.as_of is None:
            return FRESHNESS_STALE
        return (
            FRESHNESS_CURRENT
            if now - self.as_of <= FRESHNESS_WINDOW
            else FRESHNESS_STALE
        )

    def is_usable(self, now: datetime) -> bool:
        """Whether a route may be planned over this segment without a decision.

        Deliberately strict: only a CURRENT, VERIFIED_OPEN segment qualifies.
        Everything else - including a stale open, and including
        REPAIR_REPORTED - is something a person should look at. A repair claim
        is the case this guards hardest, because it is the one that reads like
        a yes.
        """
        return (
            self.status is RoadStatus.VERIFIED_OPEN
            and self.freshness(now) == FRESHNESS_CURRENT
        )


def _status_for(evidence: Evidence) -> RoadStatus:
    """The status one observation, taken alone, would establish."""
    if evidence.kind is EvidenceKind.INCIDENT_REPORTED:
        return RoadStatus.REPORTED_INCIDENT
    if evidence.kind is EvidenceKind.CLOSURE_DECLARED:
        return RoadStatus.CLOSED
    if evidence.kind is EvidenceKind.REPAIR_CLAIMED:
        return RoadStatus.REPAIR_REPORTED
    # Both remaining kinds assert the road carries traffic, and both are gated
    # on the source by `_assert_may_open`.
    return RoadStatus.VERIFIED_OPEN


def _assert_may_open(evidence: Evidence) -> None:
    if evidence.source not in CAN_OPEN:
        raise RoadMemoryViolation(
            f"{evidence.source.value} may not open a road: "
            f"{evidence.kind.value} needs a direct observation "
            f"({', '.join(sorted(s.value for s in CAN_OPEN))})"
        )


def apply(history: list[Evidence], *, now: datetime) -> Knowledge:
    """Fold an append-only evidence log into a current belief.

    A fold rather than a stored status that gets mutated: the belief is always
    reconstructible from the evidence, so a wrong answer can be traced to the
    observation that caused it instead of to whoever last wrote the row.

    `now` is injected. A function that reads the clock cannot be tested for the
    behaviour that matters most here, which is what it does with the passage of
    time.
    """
    if not history:
        return Knowledge(
            status=RoadStatus.UNKNOWN,
            as_of=None,
            source=None,
            evidence_count=0,
        )

    ordered = sorted(history, key=lambda e: e.observed_at)
    latest = ordered[-1]

    if latest.kind in (
        EvidenceKind.PASSAGE_OBSERVED,
        EvidenceKind.REOPENING_DECLARED,
    ):
        _assert_may_open(latest)

    status = _status_for(latest)

    # The escalation, and the ONLY thing elapsed time is permitted to do. A
    # repair claim nobody confirmed becomes a question rather than an answer.
    # Note the direction: AWAITING_VERIFICATION is less usable than
    # REPAIR_REPORTED, not more.
    if (
        status is RoadStatus.REPAIR_REPORTED
        and now - latest.observed_at > REPAIR_VERIFICATION_WINDOW
    ):
        status = RoadStatus.AWAITING_VERIFICATION

    return Knowledge(
        status=status,
        as_of=latest.observed_at,
        source=latest.source,
        evidence_count=len(ordered),
    )


def recurrence(history: list[Evidence], *, since: datetime | None = None) -> int:
    """How many distinct incidents this segment has had.

    The count a monsoon risk engine needs, computed from the same log rather
    than kept as a counter that can drift from the evidence it summarises.
    Closures are not counted separately from the incidents that caused them -
    a slide that closes a road is one event, reported twice.
    """
    return sum(
        1
        for e in history
        if e.kind is EvidenceKind.INCIDENT_REPORTED
        and (since is None or e.observed_at >= since)
    )
