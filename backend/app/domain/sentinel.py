"""Fleet Sentinel: deterministic safety monitoring and emergency escalation.

WHY THIS EXISTS

docs/ARCHITECTURE.md Diagram F, docs/DATA_MODEL.md section 11, docs/AI_MODELS.md
section 4.

A truck that stops moving on a remote North East corridor and goes silent is the
critical failure mode this platform exists to catch. It is not an anomaly score
or a statistical prediction: it is a set of hard deterministic thresholds
evaluated over GPS telemetry and trip state:

    - 60-minute stationary window outside approved geofenced stops
    - COMMS_LOST distinguished from SOS (signal gap vs confirmed stationary)
    - 30-minute driver check-in response deadline
    - Immediate escalation on NEED_HELP
    - Automated escalation on expired deadline
    - Frozen briefing snapshot at escalation time

NO LLM APPEARS ANYWHERE IN THIS MODULE, AND NONE MAY BE ADDED.
Every branch is an arithmetic comparison against configured constants.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Any, Final, Sequence
import uuid

from app.domain.routing import haversine_m
from app.models.enums import _StrEnum


# --- Enums matching DATA_MODEL.md §2 --------------------------------------


class EmergencyState(_StrEnum):
    """Lifecycle of a safety incident."""

    DRIVER_CHECK_REQUIRED = "DRIVER_CHECK_REQUIRED"
    DRIVER_RESPONDED = "DRIVER_RESPONDED"
    SOS_ESCALATED = "SOS_ESCALATED"
    RESOLVED = "RESOLVED"
    FALSE_ALARM = "FALSE_ALARM"


class DriverCheckResponse(_StrEnum):
    """Driver button set for the check-in response."""

    I_AM_SAFE = "I_AM_SAFE"
    TRAFFIC = "TRAFFIC"
    ROAD_BLOCKED = "ROAD_BLOCKED"
    BREAKDOWN = "BREAKDOWN"
    REST_STOP = "REST_STOP"
    LOADING = "LOADING"
    UNLOADING = "UNLOADING"
    MEDICAL_ISSUE = "MEDICAL_ISSUE"
    OTHER = "OTHER"
    NEED_HELP = "NEED_HELP"


# --- Deterministic Thresholds ---------------------------------------------

#: Window over which fixes are examined for stationary state.
STATIONARY_WINDOW_SECONDS: Final[int] = 3600  # 60 minutes

#: Radius within which fixes must remain to be considered stationary.
STATIONARY_RADIUS_M: Final[float] = 100.0  # 100 metres

#: How long a driver has to respond before automatic SOS escalation.
DRIVER_RESPONSE_WINDOW_SECONDS: Final[int] = 1800  # 30 minutes

#: Radius around an approved stop (rest/fuel/checkpoint/depot) that is exempt.
APPROVED_STOP_RADIUS_M: Final[float] = 300.0  # 300 metres

#: How long without ANY GPS fix before comms are declared lost (NOT an SOS).
COMMS_LOST_THRESHOLD_SECONDS: Final[int] = 3600  # 60 minutes


# --- Domain Data Structures ----------------------------------------------


@dataclass(frozen=True, slots=True)
class TelemetryPoint:
    """A GPS fix with coordinates and timestamps."""

    id: int | None
    lat: float
    lon: float
    recorded_at: datetime
    received_at: datetime
    accuracy_m: float | None = None


@dataclass(frozen=True, slots=True)
class ApprovedStop:
    """A planned or operational stop where stationary dwell is expected."""

    id: uuid.UUID | str
    kind: str  # e.g., 'REST', 'FUEL', 'CHECKPOINT', 'PICKUP', 'DROPOFF'
    lat: float
    lon: float
    name: str | None = None


class SentinelDecisionKind(str, Enum):
    """The outcome of a periodic sentinel evaluation."""

    HEALTHY_MOVING = "HEALTHY_MOVING"
    HEALTHY_AT_APPROVED_STOP = "HEALTHY_AT_APPROVED_STOP"
    COMMS_LOST = "COMMS_LOST"
    DRIVER_CHECK_REQUIRED = "DRIVER_CHECK_REQUIRED"
    ALREADY_ACTIVE_CHECK = "ALREADY_ACTIVE_CHECK"


@dataclass(frozen=True, slots=True)
class SentinelDecision:
    """The result of evaluating one trip."""

    kind: SentinelDecisionKind
    stationary_since: datetime | None = None
    last_fix: TelemetryPoint | None = None
    reason: str = ""
    details: dict[str, Any] = field(default_factory=dict)


# --- Deterministic Domain Logic -------------------------------------------


def is_inside_approved_stop(
    lat: float,
    lon: float,
    stops: Sequence[ApprovedStop],
    radius_m: float = APPROVED_STOP_RADIUS_M,
) -> tuple[bool, ApprovedStop | None]:
    """Check whether a coordinate is within `radius_m` of an approved stop.

    Approved stops include rest areas, fuel points, checkpoints, pickups, and
    dropoffs where prolonged dwell is legitimate operations rather than an
    incident.
    """
    for stop in stops:
        dist = haversine_m(lat, lon, stop.lat, stop.lon)
        if dist <= radius_m:
            return True, stop
    return False, None


def evaluate_stationary_window(
    fixes: Sequence[TelemetryPoint],
    now: datetime,
    window_seconds: int = STATIONARY_WINDOW_SECONDS,
    max_radius_m: float = STATIONARY_RADIUS_M,
) -> tuple[bool, datetime | None, TelemetryPoint | None]:
    """Check if all fixes in the last `window_seconds` are within `max_radius_m`.

    Uses `received_at` (server clock), not device clock, per DATA_MODEL.md §5:
    a phone clock skewed by hours cannot trick or bypass the stationary check.

    Returns:
        (is_stationary, stationary_since, latest_fix)
    """
    if not fixes:
        return False, None, None

    sorted_fixes = sorted(fixes, key=lambda f: f.received_at)
    latest_fix = sorted_fixes[-1]

    # If the latest fix is too stale, cannot confirm current state
    if (now - latest_fix.received_at).total_seconds() > window_seconds:
        return False, None, latest_fix

    # Look back from now
    cutoff = now - timedelta(seconds=window_seconds)

    # Need telemetry that reaches back to at least cutoff (with 60s tolerance)
    if sorted_fixes[0].received_at > (cutoff + timedelta(seconds=60)):
        return False, None, latest_fix

    anchor_lat, anchor_lon = latest_fix.lat, latest_fix.lon
    stationary_since = latest_fix.received_at

    # Scan backwards to find how long the truck has been within max_radius_m
    for f in reversed(sorted_fixes):
        dist = haversine_m(anchor_lat, anchor_lon, f.lat, f.lon)
        if dist > max_radius_m:
            break
        stationary_since = f.received_at

    duration = (now - stationary_since).total_seconds()
    if duration >= (window_seconds - 60):
        return True, stationary_since, latest_fix

    return False, None, latest_fix


def evaluate_trip_sentinel(
    fixes: Sequence[TelemetryPoint],
    approved_stops: Sequence[ApprovedStop],
    has_open_emergency: bool,
    now: datetime,
) -> SentinelDecision:
    """Evaluate one active trip against Fleet Sentinel rules.

    Pure deterministic application logic. No database access or network I/O.
    """
    if not fixes:
        return SentinelDecision(
            kind=SentinelDecisionKind.COMMS_LOST,
            reason="No telemetry received for active trip",
        )

    latest_fix = max(fixes, key=lambda f: f.received_at)
    time_since_last_fix = (now - latest_fix.received_at).total_seconds()

    # 1. Comms lost check: no fix for over 60 minutes
    if time_since_last_fix >= COMMS_LOST_THRESHOLD_SECONDS:
        return SentinelDecision(
            kind=SentinelDecisionKind.COMMS_LOST,
            last_fix=latest_fix,
            reason=f"No GPS signal received for {int(time_since_last_fix // 60)} minutes",
            details={"silence_minutes": round(time_since_last_fix / 60, 1)},
        )

    # 2. Stationary window check
    is_stationary, stationary_since, _ = evaluate_stationary_window(fixes, now)

    if not is_stationary:
        return SentinelDecision(
            kind=SentinelDecisionKind.HEALTHY_MOVING,
            last_fix=latest_fix,
            reason="Vehicle is moving normally",
        )

    # 3. Approved stop check
    at_stop, stop = is_inside_approved_stop(latest_fix.lat, latest_fix.lon, approved_stops)
    if at_stop and stop is not None:
        return SentinelDecision(
            kind=SentinelDecisionKind.HEALTHY_AT_APPROVED_STOP,
            last_fix=latest_fix,
            stationary_since=stationary_since,
            reason=f"Stationary at approved {stop.kind} stop: {stop.name or 'unnamed'}",
            details={"stop_kind": stop.kind, "stop_id": str(stop.id)},
        )

    # 4. Open check deduplication: partial unique index protection in application logic
    if has_open_emergency:
        return SentinelDecision(
            kind=SentinelDecisionKind.ALREADY_ACTIVE_CHECK,
            last_fix=latest_fix,
            stationary_since=stationary_since,
            reason="Stationary but open emergency check is already in progress",
        )

    # 5. Outside approved stop and no open check -> DRIVER_CHECK_REQUIRED
    return SentinelDecision(
        kind=SentinelDecisionKind.DRIVER_CHECK_REQUIRED,
        last_fix=latest_fix,
        stationary_since=stationary_since,
        reason=(
            f"Stationary for >= {STATIONARY_WINDOW_SECONDS // 60} minutes outside "
            f"approved stops ({int(latest_fix.lat * 1000) / 1000}, {int(latest_fix.lon * 1000) / 1000})"
        ),
        details={
            "stationary_since": stationary_since.isoformat() if stationary_since else None,
            "stationary_radius_m": STATIONARY_RADIUS_M,
        },
    )


def should_escalate_emergency(
    state: EmergencyState,
    check_sent_at: datetime,
    response_deadline_at: datetime,
    driver_response: DriverCheckResponse | None,
    now: datetime,
) -> bool:
    """Determine whether an emergency must escalate to SOS_ESCALATED.

    Triggers:
    1. Driver explicitly responded NEED_HELP (immediate escalation).
    2. In DRIVER_CHECK_REQUIRED, no response, and `now >= response_deadline_at` (silence escalation).
    """
    if state == EmergencyState.SOS_ESCALATED:
        return False  # Already escalated

    if driver_response == DriverCheckResponse.NEED_HELP:
        return True

    # If driver provided any other response, silence escalation does not apply
    if driver_response is not None:
        return False

    if state == EmergencyState.DRIVER_CHECK_REQUIRED:
        if now >= response_deadline_at:
            return True

    return False


def build_briefing_snapshot(
    *,
    trip_code: str,
    driver_name: str,
    driver_phone: str | None,
    emergency_contact_name: str | None,
    emergency_contact_phone: str | None,
    truck_registration: str,
    truck_model: str | None,
    cargo_priority: str | None,
    cargo_weight_kg: Decimal | float | None,
    origin_name: str | None,
    destination_name: str | None,
    last_lat: float,
    last_lon: float,
    last_fix_at: datetime,
    stationary_since: datetime,
    escalation_reason: str,
    now: datetime,
) -> dict[str, Any]:
    """Assemble frozen incident briefing snapshot for managers.

    Freezes all operational facts at the exact moment of escalation so later
    truck movements or changes do not rewrite the historical incident record.
    """
    age_seconds = max(0.0, (now - last_fix_at).total_seconds())
    stopped_minutes = max(0.0, (now - stationary_since).total_seconds() / 60.0)

    suggested_actions = [
        f"1. Attempt voice contact with driver at {driver_phone or 'unlisted'}",
        (
            f"2. Contact secondary emergency contact ({emergency_contact_name or 'unlisted'}) "
            f"at {emergency_contact_phone or 'unlisted'}"
        ),
        "3. Notify regional transport authority / highway patrol with truck registration and coordinates",
        "4. Dispatch nearest field assist or arrange standby recovery vehicle",
    ]

    return {
        "trip_code": trip_code,
        "escalated_at": now.isoformat(),
        "escalation_reason": escalation_reason,
        "driver": {
            "name": driver_name,
            "phone": driver_phone,
            "emergency_contact_name": emergency_contact_name,
            "emergency_contact_phone": emergency_contact_phone,
        },
        "truck": {
            "registration": truck_registration,
            "model": truck_model,
        },
        "cargo": {
            "priority": cargo_priority,
            "weight_kg": float(cargo_weight_kg) if cargo_weight_kg is not None else None,
        },
        "route": {
            "origin": origin_name,
            "destination": destination_name,
        },
        "location": {
            "lat": last_lat,
            "lon": last_lon,
            "fix_recorded_at": last_fix_at.isoformat(),
            "fix_age_seconds": round(age_seconds, 1),
            "stopped_since": stationary_since.isoformat(),
            "stopped_duration_minutes": round(stopped_minutes, 1),
        },
        "suggested_actions": suggested_actions,
    }
