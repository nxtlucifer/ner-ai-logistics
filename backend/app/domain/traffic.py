"""RASTA FLEET TRAFFIC - segment speed observed from this fleet's own telemetry.

NOT Google live traffic. The probes are the GPS fixes RASTA drivers already
upload (`gps_points`), map-matched onto the planned route by PostGIS in
`app/services/traffic.py` (`ST_LineLocatePoint` on the route line, within a
corridor of `MATCH_DISTANCE_M`). This module only aggregates what that query
returned, so the rule is testable without a database.

THE RULE (published constants, no model)

  route split into SEGMENT_KM buckets along the line
  per bucket: samples fresh within FRESH_SECONDS, accuracy <= MAX_ACCURACY_M,
              speed plausible (<= MAX_PLAUSIBLE_KMPH: a teleport is not a
              speed), moving (>= MIN_MOVING_KMPH: a parked truck is not
              traffic), heading within HEADING_TOLERANCE_DEG of the line
              (the other carriageway is a different road)
  observed  = median speed of those samples
  baseline  = the provider's own planned average pace for the route
              (distance / duration): a legitimate expectation we already show,
              never an invented posted limit
  ratio     = observed / baseline
              >= NORMAL_RATIO   NORMAL
              >= SLOW_RATIO     SLOW
              else              CONGESTED
  evidence  = at least MIN_SAMPLES samples from at least MIN_VEHICLES trucks,
              otherwise UNKNOWN. One vehicle is one vehicle, not traffic.

UNKNOWN is the default, and UNKNOWN is never NORMAL. A road nobody in the fleet
has driven this quarter-hour is a road we know nothing about.

Traffic never scores risk points and never blocks routing. It carries a delay
estimate that the ranking adds to planned duration, so a congested road loses
on TIME, not on a danger alert it does not deserve.

ponytail: route-average baseline. Per-segment baselines when OSRM annotations
are stored. Thresholds are calibration knobs - set from one fleet, no real
congestion data yet; revisit when the fleet has driven a month of roads.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import UTC, datetime
from statistics import median
from typing import Final

from app.domain.routing import haversine_m

VERSION: Final[str] = "fleet-traffic-v1"
PROVIDER: Final[str] = "RASTA fleet telemetry"

STATE_UNKNOWN: Final[str] = "UNKNOWN"
STATE_NORMAL: Final[str] = "NORMAL"
STATE_SLOW: Final[str] = "SLOW"
STATE_CONGESTED: Final[str] = "CONGESTED"

SEGMENT_KM: Final[float] = 5.0
FRESH_SECONDS: Final[int] = 15 * 60
MATCH_DISTANCE_M: Final[float] = 60.0
MAX_ACCURACY_M: Final[float] = 100.0
MAX_PLAUSIBLE_KMPH: Final[float] = 130.0
MIN_MOVING_KMPH: Final[float] = 2.0
HEADING_TOLERANCE_DEG: Final[float] = 100.0
MIN_SAMPLES: Final[int] = 4
MIN_VEHICLES: Final[int] = 2
NORMAL_RATIO: Final[float] = 0.7
SLOW_RATIO: Final[float] = 0.4
MAX_DELAY_MIN: Final[float] = 240.0

REASON_TRAFFIC_UNKNOWN: Final[str] = "TRAFFIC_UNKNOWN"
REASON_TRAFFIC_NORMAL: Final[str] = "TRAFFIC_NORMAL"
REASON_TRAFFIC_SLOW: Final[str] = "TRAFFIC_SLOW_AHEAD"
REASON_TRAFFIC_CONGESTED: Final[str] = "TRAFFIC_CONGESTED_AHEAD"


@dataclass(frozen=True)
class TrafficSample:
    """One map-matched probe: where along the line, how fast, how trustworthy."""

    fraction: float
    speed_kmph: float | None
    accuracy_m: float | None
    heading_deg: float | None
    age_seconds: float
    #: Distinct vehicle identity, for the MIN_VEHICLES rule.
    vehicle: str


@dataclass(frozen=True)
class TrafficSegment:
    start_m: float
    end_m: float
    state: str
    observed_kmph: float | None
    baseline_kmph: float | None
    sample_count: int
    vehicle_count: int
    #: Age of the newest sample in this bucket, seconds. None when empty.
    newest_age_seconds: float | None


@dataclass(frozen=True)
class TrafficEstimate:
    status: str
    segments: tuple[TrafficSegment, ...]
    #: Fraction of route length with a known state, 0..1.
    coverage: float
    #: Minutes the SLOW/CONGESTED stretches add over the planned pace.
    delay_min: float
    sample_count: int
    vehicle_count: int
    #: Age of the newest probe on the whole route, seconds. None without any.
    newest_age_seconds: float | None
    reason_codes: tuple[str, ...]
    provider: str = PROVIDER
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    version: str = VERSION

    @property
    def is_known(self) -> bool:
        return self.status != STATE_UNKNOWN


def _bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    d_lon = lon2 - lon1
    x = math.sin(d_lon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(d_lon)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def _heading_diff(a: float, b: float) -> float:
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def _bearing_at(geometry: list[tuple[float, float]], cumulative: list[float], along_m: float) -> float | None:
    """Direction of travel of the line at `along_m` metres from its start."""
    if len(geometry) < 2:
        return None
    for i in range(1, len(geometry)):
        if along_m <= cumulative[i] or i == len(geometry) - 1:
            return _bearing(geometry[i - 1], geometry[i])
    return None


def cumulative_metres(geometry: list[tuple[float, float]]) -> list[float]:
    out = [0.0]
    for i in range(1, len(geometry)):
        out.append(out[-1] + haversine_m(geometry[i - 1][0], geometry[i - 1][1], geometry[i][0], geometry[i][1]))
    return out


def _state(ratio: float) -> str:
    if ratio >= NORMAL_RATIO:
        return STATE_NORMAL
    if ratio >= SLOW_RATIO:
        return STATE_SLOW
    return STATE_CONGESTED


def estimate(
    *,
    geometry: list[tuple[float, float]],
    samples: list[TrafficSample],
    distance_km: float | None,
    duration_min: float | None,
    now: datetime | None = None,
) -> TrafficEstimate:
    """Aggregate map-matched probes into per-segment states. Pure."""
    moment = now or datetime.now(UTC)
    cumulative = cumulative_metres(geometry) if len(geometry) > 1 else [0.0]
    total_m = cumulative[-1]
    baseline = (
        distance_km / (duration_min / 60.0)
        if distance_km and duration_min and distance_km > 0 and duration_min > 0
        else None
    )

    fresh = [s for s in samples if 0 <= s.age_seconds <= FRESH_SECONDS]
    newest = min((s.age_seconds for s in fresh), default=None)

    if total_m <= 0 or baseline is None:
        return TrafficEstimate(
            status=STATE_UNKNOWN, segments=(), coverage=0.0, delay_min=0.0,
            sample_count=len(fresh), vehicle_count=len({s.vehicle for s in fresh}),
            newest_age_seconds=newest, reason_codes=(REASON_TRAFFIC_UNKNOWN,), updated_at=moment,
        )

    usable: list[TrafficSample] = []
    for s in fresh:
        if s.speed_kmph is None or s.speed_kmph < MIN_MOVING_KMPH or s.speed_kmph > MAX_PLAUSIBLE_KMPH:
            continue
        if s.accuracy_m is not None and s.accuracy_m > MAX_ACCURACY_M:
            continue
        if not 0.0 <= s.fraction <= 1.0:
            continue
        if s.heading_deg is not None:
            line = _bearing_at(geometry, cumulative, s.fraction * total_m)
            if line is not None and _heading_diff(line, s.heading_deg) > HEADING_TOLERANCE_DEG:
                continue
        usable.append(s)

    segment_m = SEGMENT_KM * 1000.0
    count = max(1, math.ceil(total_m / segment_m))
    buckets: list[list[TrafficSample]] = [[] for _ in range(count)]
    for s in usable:
        # A sample exactly on a boundary belongs to the segment it is entering.
        index = min(count - 1, int((s.fraction * total_m) // segment_m))
        buckets[index].append(s)

    segments: list[TrafficSegment] = []
    known_m = 0.0
    delay_min = 0.0
    worst = STATE_UNKNOWN
    rank = {STATE_UNKNOWN: 0, STATE_NORMAL: 1, STATE_SLOW: 2, STATE_CONGESTED: 3}
    for i, bucket in enumerate(buckets):
        start = i * segment_m
        end = min(total_m, (i + 1) * segment_m)
        vehicles = {s.vehicle for s in bucket}
        state = STATE_UNKNOWN
        observed: float | None = None
        if len(bucket) >= MIN_SAMPLES and len(vehicles) >= MIN_VEHICLES:
            observed = float(median(s.speed_kmph for s in bucket))  # type: ignore[misc]
            state = _state(observed / baseline)
            known_m += end - start
            if state != STATE_NORMAL:
                length_km = (end - start) / 1000.0
                delay_min += max(0.0, (length_km / observed - length_km / baseline) * 60.0)
        if rank[state] > rank[worst]:
            worst = state
        segments.append(
            TrafficSegment(
                start_m=round(start, 1), end_m=round(end, 1), state=state,
                observed_kmph=round(observed, 1) if observed is not None else None,
                baseline_kmph=round(baseline, 1),
                sample_count=len(bucket), vehicle_count=len(vehicles),
                newest_age_seconds=min((s.age_seconds for s in bucket), default=None),
            )
        )

    codes = {
        STATE_UNKNOWN: REASON_TRAFFIC_UNKNOWN,
        STATE_NORMAL: REASON_TRAFFIC_NORMAL,
        STATE_SLOW: REASON_TRAFFIC_SLOW,
        STATE_CONGESTED: REASON_TRAFFIC_CONGESTED,
    }
    return TrafficEstimate(
        status=worst,
        segments=tuple(segments),
        coverage=round(known_m / total_m, 3),
        delay_min=round(min(MAX_DELAY_MIN, delay_min), 1),
        sample_count=len(usable),
        vehicle_count=len({s.vehicle for s in usable}),
        newest_age_seconds=newest,
        reason_codes=(codes[worst],),
        updated_at=moment,
    )
