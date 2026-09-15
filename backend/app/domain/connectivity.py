"""RASTA FLEET CONNECTIVITY - where this fleet's phones have lost their data path.

NOT a carrier coverage map. No operator publishes one this project could
verify, and a corridor nobody has measured must not be painted green because
a marketing map says so. The evidence here is the fleet's own telemetry:
every GPS fix carries the device clock (`recorded_at`) and the server clock
(`received_at`). A fix uploaded moments after it was taken travelled on a
working data path. A fix that waited ten minutes was sitting in the phone's
bounded offline queue (driver-app/src/tracking/tracker.ts) because there was
no path at the place it was recorded - and the queue is what makes that wait
observable at all.

THE RULE (published constants, no model)

  route split into SEGMENT_KM buckets along the line
  per bucket: fixes received within MAX_AGE_DAYS, map-matched within
              MATCH_DISTANCE_M of the line (`app/services/connectivity.py`)
  queued share = fixes whose upload waited more than QUEUED_DELAY_S / fixes
  median wait  = median upload delay of the bucket, seconds
  state        fewer than MIN_SAMPLES fixes                        UNKNOWN
               queued share >= DEAD_QUEUED_SHARE
                 and median wait >= DEAD_DELAY_S                   DEAD_ZONE
               queued share >= WEAK_QUEUED_SHARE                   WEAK
               queued share >= UNSTABLE_QUEUED_SHARE               UNSTABLE
               otherwise                                          GOOD
  evidence     LOW one trip, MEDIUM two, HIGH three or more trips and at
               least STRONG_EVIDENCE_SAMPLES fixes. A count of independent
               journeys, deliberately NOT called confidence and deliberately
               not a number: this project refuses a confidence score, because
               one implies a trained, validated model and there is none here
               (the same refusal app/domain/landslide.py makes).

UNKNOWN is the default, and UNKNOWN is never GOOD. A stretch no fleet phone
has reported from is a stretch we know nothing about; it is reported as
UNKNOWN with zero samples, never inferred from its neighbours.

WHAT THE DELAY CANNOT TELL, STATED RATHER THAN HIDDEN

  - Silence is not evidence. A phone that was switched off, an app the OS
    killed, a trip that never uploaded: none of those produce fixes, so none
    of them produce a DEAD_ZONE. They produce UNKNOWN. (The same rule
    `app/domain/road_memory.py` applies to hazards.)
  - The delay is measured against the device clock. A phone running slow
    makes a delay look longer; one running fast makes it negative. Negative
    waits are clamped to zero and waits beyond MAX_DELAY_S are capped, and the
    telemetry policy already refuses fixes more than MAX_CLOCK_SKEW in the
    future, so a wrong clock can add noise to a segment but cannot invent a
    dead zone on its own: the state needs a SHARE of queued fixes, not one.
  - Which carrier, which band, which handset: not known and not claimed. The
    provenance says "this fleet's phones".

Nothing here scores risk points itself. `app/domain/route_risk.py` turns
exposure to WEAK and DEAD_ZONE kilometres into a MODERATE penalty with
published constants, and an UNKNOWN corridor carries a reason code and a
NOT_AVAILABLE input - never a benefit.

ponytail: thresholds are calibration knobs set from one fleet's queue
behaviour (60 s batching, 2-60 s backoff); revisit after a season of roads.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from statistics import median
from typing import Final

from app.domain.routing import haversine_m

VERSION: Final[str] = "fleet-connectivity-v1"
PROVIDER: Final[str] = "RASTA fleet telemetry (upload delay)"
#: Source label a simulated segment carries. Never confused with the fleet.
SOURCE_DEMO_SIMULATION: Final[str] = "DEMO_SIMULATION"

STATE_GOOD: Final[str] = "GOOD"
STATE_UNSTABLE: Final[str] = "UNSTABLE"
STATE_WEAK: Final[str] = "WEAK"
STATE_DEAD_ZONE: Final[str] = "DEAD_ZONE"
STATE_UNKNOWN: Final[str] = "UNKNOWN"

#: Worst-first, for choosing a route's headline state.
STATE_RANK: Final[dict[str, int]] = {
    STATE_UNKNOWN: 0,
    STATE_GOOD: 1,
    STATE_UNSTABLE: 2,
    STATE_WEAK: 3,
    STATE_DEAD_ZONE: 4,
}

#: States a driver should prepare for before entering. UNKNOWN is included
#: on purpose: preparing a trip kit for a stretch nobody has measured is cheap,
#: and assuming coverage there is the failure this whole layer exists to end.
PREPARE_STATES: Final[frozenset[str]] = frozenset({STATE_WEAK, STATE_DEAD_ZONE, STATE_UNKNOWN})
#: States that count as exposure in the risk penalty.
EXPOSURE_STATES: Final[frozenset[str]] = frozenset({STATE_WEAK, STATE_DEAD_ZONE})

EVIDENCE_LOW: Final[str] = "LOW"
EVIDENCE_MEDIUM: Final[str] = "MEDIUM"
EVIDENCE_HIGH: Final[str] = "HIGH"
EVIDENCE_SIMULATED: Final[str] = "SIMULATED"

#: Same bucket as fleet traffic, so the two layers line up on a map.
SEGMENT_KM: Final[float] = 5.0
#: Same corridor as fleet traffic: a fix further from the line than this is on
#: a different road.
MATCH_DISTANCE_M: Final[float] = 60.0
#: Coverage does not change hour to hour the way weather does, so the window
#: is long enough to accumulate journeys and short enough that a tower that
#: went up in spring is not still reported dead in autumn.
MAX_AGE_DAYS: Final[int] = 30
#: A fix normally waits at most one batch (6 fixes at 10 s) plus one backoff
#: (up to 60 s) before it is uploaded. Longer than this and it was stuck
#: behind a failed upload - the phone had no usable data path.
QUEUED_DELAY_S: Final[float] = 120.0
#: A bucket whose typical fix waited this long is a stretch with no path at
#: all. Matches LOCATION_STALE_SECONDS: the same silence the manager's map
#: calls NO CONTACT.
DEAD_DELAY_S: Final[float] = 600.0
#: Waits beyond this are capped: they say "queued a very long time", and
#: beyond a day the telemetry policy would have refused the fix anyway.
MAX_DELAY_S: Final[float] = 24 * 3600.0
MIN_SAMPLES: Final[int] = 4
STRONG_EVIDENCE_SAMPLES: Final[int] = 12
UNSTABLE_QUEUED_SHARE: Final[float] = 0.2
WEAK_QUEUED_SHARE: Final[float] = 0.5
DEAD_QUEUED_SHARE: Final[float] = 0.8

REASON_CONNECTIVITY_UNKNOWN: Final[str] = "CONNECTIVITY_UNKNOWN"
REASON_CONNECTIVITY_PARTIAL: Final[str] = "CONNECTIVITY_COVERAGE_PARTIAL"
REASON_CONNECTIVITY_GOOD: Final[str] = "CONNECTIVITY_GOOD_ON_ROUTE"
REASON_CONNECTIVITY_UNSTABLE: Final[str] = "CONNECTIVITY_UNSTABLE_ON_ROUTE"
REASON_CONNECTIVITY_WEAK: Final[str] = "CONNECTIVITY_WEAK_ZONES_ON_ROUTE"
REASON_CONNECTIVITY_DEAD: Final[str] = "CONNECTIVITY_DEAD_ZONE_ON_ROUTE"


@dataclass(frozen=True)
class ConnectivitySample:
    """One map-matched fix: where along the line, how long its upload waited."""

    #: Position along the route line, 0..1.
    fraction: float
    #: `received_at - recorded_at`, seconds. Clamped in `estimate`.
    upload_delay_s: float
    #: Age of the fix by the server clock, seconds.
    age_seconds: float
    #: Distinct journey, for the confidence rule.
    trip: str
    #: Distinct vehicle, reported alongside.
    vehicle: str


@dataclass(frozen=True)
class ConnectivitySegment:
    start_m: float
    end_m: float
    state: str
    sample_count: int
    trip_count: int
    #: Share of fixes that waited longer than QUEUED_DELAY_S. None when empty.
    queued_share: float | None
    #: Typical wait, seconds. None when empty.
    median_delay_s: float | None
    #: Age of the newest fix in this bucket, seconds. None when empty.
    newest_age_seconds: float | None
    #: How much independent evidence stands behind this segment's state:
    #: LOW / MEDIUM / HIGH / SIMULATED. UNKNOWN segments carry LOW. A count of
    #: journeys, never a probability - see the module docstring.
    evidence: str
    #: Where the evidence came from. The fleet, or a labelled simulation.
    source: str = PROVIDER

    @property
    def length_m(self) -> float:
        return max(0.0, self.end_m - self.start_m)


@dataclass(frozen=True)
class ConnectivityProfile:
    """A route's connectivity, per segment, with every gap stated."""

    #: Worst known state on the route; UNKNOWN when nothing is known.
    status: str
    segments: tuple[ConnectivitySegment, ...]
    #: Fraction of route length with a known state, 0..1.
    coverage: float
    #: Fraction with NO evidence, 0..1. Carried explicitly because the risk
    #: engine charges for it: an unmeasured road must not out-rank a measured
    #: one just because nobody has driven it.
    unknown_share: float
    weak_km: float
    dead_km: float
    unknown_km: float
    #: Longest contiguous WEAK/DEAD_ZONE run, km. The figure a driver needs
    #: for "how long will I be without signal".
    longest_gap_km: float
    sample_count: int
    trip_count: int
    #: Age of the newest fix on the whole route, seconds. None without any.
    newest_age_seconds: float | None
    reason_codes: tuple[str, ...]
    provider: str = PROVIDER
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    version: str = VERSION

    @property
    def is_known(self) -> bool:
        return self.coverage > 0.0

    @property
    def exposure_km(self) -> float:
        """Kilometres the truck will spend without a dependable data path."""
        return self.weak_km + self.dead_km


def cumulative_metres(geometry: list[tuple[float, float]]) -> list[float]:
    out = [0.0]
    for i in range(1, len(geometry)):
        out.append(
            out[-1]
            + haversine_m(geometry[i - 1][0], geometry[i - 1][1], geometry[i][0], geometry[i][1])
        )
    return out


def _evidence(sample_count: int, trip_count: int) -> str:
    if trip_count >= 3 and sample_count >= STRONG_EVIDENCE_SAMPLES:
        return EVIDENCE_HIGH
    if trip_count >= 2:
        return EVIDENCE_MEDIUM
    return EVIDENCE_LOW


def _state(queued_share: float, median_delay: float) -> str:
    if queued_share >= DEAD_QUEUED_SHARE and median_delay >= DEAD_DELAY_S:
        return STATE_DEAD_ZONE
    if queued_share >= WEAK_QUEUED_SHARE:
        return STATE_WEAK
    if queued_share >= UNSTABLE_QUEUED_SHARE:
        return STATE_UNSTABLE
    return STATE_GOOD


def _aggregate(
    segments: list[ConnectivitySegment],
    total_m: float,
    *,
    sample_count: int,
    trip_count: int,
    newest: float | None,
    moment: datetime,
) -> ConnectivityProfile:
    """Route-level figures from segments. One place, so every builder agrees."""
    known_m = weak_m = dead_m = unknown_m = 0.0
    longest_m = run_m = 0.0
    worst = STATE_UNKNOWN
    for seg in segments:
        length = seg.length_m
        if seg.state == STATE_UNKNOWN:
            unknown_m += length
        else:
            known_m += length
        if seg.state == STATE_WEAK:
            weak_m += length
        elif seg.state == STATE_DEAD_ZONE:
            dead_m += length
        if seg.state in EXPOSURE_STATES:
            run_m += length
            longest_m = max(longest_m, run_m)
        else:
            run_m = 0.0
        if STATE_RANK[seg.state] > STATE_RANK[worst]:
            worst = seg.state

    codes: list[str] = []
    if known_m <= 0.0:
        codes.append(REASON_CONNECTIVITY_UNKNOWN)
    else:
        if dead_m > 0.0:
            codes.append(REASON_CONNECTIVITY_DEAD)
        if weak_m > 0.0:
            codes.append(REASON_CONNECTIVITY_WEAK)
        if worst == STATE_UNSTABLE:
            codes.append(REASON_CONNECTIVITY_UNSTABLE)
        if worst == STATE_GOOD:
            codes.append(REASON_CONNECTIVITY_GOOD)
        if unknown_m > 0.0:
            codes.append(REASON_CONNECTIVITY_PARTIAL)

    return ConnectivityProfile(
        status=worst,
        segments=tuple(segments),
        coverage=round(known_m / total_m, 3) if total_m > 0 else 0.0,
        # 1.0 when nothing is known, including a route with no geometry: the
        # honest reading of "we have no evidence about this road at all".
        unknown_share=round(unknown_m / total_m, 3) if total_m > 0 else 1.0,
        weak_km=round(weak_m / 1000.0, 1),
        dead_km=round(dead_m / 1000.0, 1),
        unknown_km=round(unknown_m / 1000.0, 1),
        longest_gap_km=round(longest_m / 1000.0, 1),
        sample_count=sample_count,
        trip_count=trip_count,
        newest_age_seconds=newest,
        reason_codes=tuple(codes),
        updated_at=moment,
    )


def estimate(
    *,
    geometry: list[tuple[float, float]],
    samples: list[ConnectivitySample],
    now: datetime | None = None,
) -> ConnectivityProfile:
    """Aggregate map-matched fixes into per-segment states. Pure."""
    moment = now or datetime.now(UTC)
    cumulative = cumulative_metres(geometry) if len(geometry) > 1 else [0.0]
    total_m = cumulative[-1]

    fresh = [
        s
        for s in samples
        if 0.0 <= s.age_seconds <= MAX_AGE_DAYS * 86_400.0 and 0.0 <= s.fraction <= 1.0
    ]
    newest = min((s.age_seconds for s in fresh), default=None)

    if total_m <= 0.0:
        return _aggregate(
            [], 0.0, sample_count=len(fresh), trip_count=len({s.trip for s in fresh}),
            newest=newest, moment=moment,
        )

    segment_m = SEGMENT_KM * 1000.0
    count = max(1, math.ceil(total_m / segment_m))
    buckets: list[list[ConnectivitySample]] = [[] for _ in range(count)]
    for s in fresh:
        # A sample exactly on a boundary belongs to the segment it is entering.
        index = min(count - 1, int((s.fraction * total_m) // segment_m))
        buckets[index].append(s)

    segments: list[ConnectivitySegment] = []
    for i, bucket in enumerate(buckets):
        start = i * segment_m
        end = min(total_m, (i + 1) * segment_m)
        trips = {s.trip for s in bucket}
        state = STATE_UNKNOWN
        queued_share: float | None = None
        median_delay: float | None = None
        if bucket:
            delays = [min(MAX_DELAY_S, max(0.0, s.upload_delay_s)) for s in bucket]
            queued_share = round(sum(1 for d in delays if d > QUEUED_DELAY_S) / len(delays), 3)
            median_delay = round(float(median(delays)), 1)
        if len(bucket) >= MIN_SAMPLES:
            assert queued_share is not None and median_delay is not None
            state = _state(queued_share, median_delay)
        segments.append(
            ConnectivitySegment(
                start_m=round(start, 1),
                end_m=round(end, 1),
                state=state,
                sample_count=len(bucket),
                trip_count=len(trips),
                queued_share=queued_share,
                median_delay_s=median_delay,
                newest_age_seconds=min((s.age_seconds for s in bucket), default=None),
                evidence=_evidence(len(bucket), len(trips)) if state != STATE_UNKNOWN else EVIDENCE_LOW,
            )
        )

    return _aggregate(
        segments, total_m,
        sample_count=len(fresh), trip_count=len({s.trip for s in fresh}),
        newest=newest, moment=moment,
    )


def window(profile: ConnectivityProfile, start_m: float, end_m: float) -> ConnectivityProfile:
    """The part of a profile between two distances along the route.

    Segments are clipped, not merely filtered, so the kilometre figures
    describe the window rather than the whole buckets it touches. The
    route-ahead worker scores the stretch in front of the truck with this.
    """
    lo, hi = max(0.0, min(start_m, end_m)), max(start_m, end_m)
    clipped: list[ConnectivitySegment] = []
    for seg in profile.segments:
        s, e = max(seg.start_m, lo), min(seg.end_m, hi)
        if e <= s:
            continue
        clipped.append(replace(seg, start_m=round(s, 1), end_m=round(e, 1)))
    total = sum(seg.length_m for seg in clipped)
    return _aggregate(
        clipped, total,
        sample_count=sum(seg.sample_count for seg in clipped),
        trip_count=profile.trip_count,
        newest=min((seg.newest_age_seconds for seg in clipped if seg.newest_age_seconds is not None), default=None),
        moment=profile.updated_at,
    )


def next_gap_from(
    profile: ConnectivityProfile, along_m: float, *, states: frozenset[str] = PREPARE_STATES
) -> tuple[ConnectivitySegment, float] | None:
    """The first segment ahead of `along_m` in one of `states`, and how far.

    Zero distance when the truck is already inside it. None when the rest of
    the route is in none of those states.
    """
    for seg in profile.segments:
        if seg.end_m <= along_m:
            continue
        if seg.state in states:
            return seg, max(0.0, seg.start_m - along_m)
    return None


def simulate_dead_zone(
    profile: ConnectivityProfile, *, start_fraction: float = 0.4, end_fraction: float = 0.7
) -> ConnectivityProfile:
    """A labelled DEAD_ZONE over a middle stretch, for a demonstration.

    Every segment it touches carries `source` DEMO_SIMULATION and evidence
    SIMULATED, so a map, a package and a judge can all see which world the
    state came from. Segments outside the stretch keep their real evidence.
    """
    total = sum(seg.length_m for seg in profile.segments)
    if total <= 0.0:
        return profile
    lo, hi = start_fraction * total, end_fraction * total
    out: list[ConnectivitySegment] = []
    for seg in profile.segments:
        if seg.end_m > lo and seg.start_m < hi:
            out.append(
                replace(
                    seg,
                    state=STATE_DEAD_ZONE,
                    evidence=EVIDENCE_SIMULATED,
                    source=SOURCE_DEMO_SIMULATION,
                )
            )
        else:
            out.append(seg)
    return _aggregate(
        out, total,
        sample_count=profile.sample_count, trip_count=profile.trip_count,
        newest=profile.newest_age_seconds, moment=profile.updated_at,
    )
