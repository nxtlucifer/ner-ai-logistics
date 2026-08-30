"""Driver self-service endpoints.

Every route here is scoped to the authenticated driver by
`require_current_driver`. None of them accepts a driver id, so there is nothing
to enumerate: the subject comes from the token, not the URL.

Responses carry only what the app needs. No manager metadata, no salary, no
other drivers, no document contents.
"""

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.deps import CurrentDriver, CurrentUser, DbSession, get_client_ip
from app.core.errors import ConflictError, NotFoundError
from app.domain import telemetry_policy as policy
from app.models.enums import (
    AssignmentStatus,
    DriverStatus,
    TripStatus,
    TripStopKind,
    TripStopStatus,
    TruckStatus,
)
from app.schemas.common import APIModel, ReadModel
from app.schemas.domain import AssignmentVerify, GpsBatchAccepted, GpsBatchIn
from app.services import driver_self, driver_trips, telemetry, trips

router = APIRouter(prefix="/api/driver", tags=["driver"])

ClientIp = Annotated[str | None, Depends(get_client_ip)]


class DriverMe(ReadModel):
    """The driver's own profile. Deliberately narrow.

    `base_salary_monthly` is absent: it is admin-only and has no place in a
    device that may be handed around a depot.
    """

    id: uuid.UUID
    full_name: str
    phone: str
    licence_number: str
    licence_expiry: date
    status: DriverStatus


class TruckSummary(ReadModel):
    """Only what a driver needs to identify and check the vehicle."""

    id: uuid.UUID
    registration_number: str
    truck_type: str | None
    make: str | None
    model: str | None
    max_capacity_kg: Decimal
    status: TruckStatus


class CurrentAssignment(ReadModel):
    id: uuid.UUID
    status: AssignmentStatus
    assigned_at: datetime
    verified_at: datetime | None
    mismatch_flagged: bool
    truck: TruckSummary


class VerifyResult(ReadModel):
    assignment: CurrentAssignment
    #: True when this call was a no-op retry of an earlier identical submission.
    already_verified: bool


class VerifyRequest(AssignmentVerify):
    """Verification payload.

    `assignment_id` is optional and can only ever NARROW the request: the
    assignment is resolved from the authenticated driver, and this is compared
    against it to reject a stale screen. Sending someone else's id cannot widen
    access - it simply fails.
    """

    assignment_id: uuid.UUID | None = None


def _to_current(assignment, truck) -> CurrentAssignment:
    return CurrentAssignment(
        id=assignment.id,
        status=assignment.status,
        assigned_at=assignment.assigned_at,
        verified_at=assignment.verified_at,
        mismatch_flagged=assignment.mismatch_flagged,
        truck=TruckSummary.model_validate(truck),
    )


@router.get("/me", response_model=DriverMe, summary="The signed-in driver")
async def me(driver: CurrentDriver) -> DriverMe:
    return DriverMe.model_validate(driver)


@router.get(
    "/me/assignment",
    response_model=CurrentAssignment | None,
    summary="The driver's current assignment",
)
async def my_assignment(
    driver: CurrentDriver, db: DbSession
) -> CurrentAssignment | None:
    """Returns null when the driver has no assignment.

    An unassigned driver is a normal state, not an error, so this is a 200 with
    a null body rather than a 404 the app would have to special-case.
    """
    found = await driver_self.current_assignment(db, driver)
    return None if found is None else _to_current(*found)


@router.post(
    "/me/assignment/verify",
    response_model=VerifyResult,
    summary="Verify the assigned truck",
)
async def verify_my_assignment(
    payload: VerifyRequest,
    driver: CurrentDriver,
    user: CurrentUser,
    db: DbSession,
    ip: ClientIp,
) -> VerifyResult:
    """Confirm the physical truck matches the assignment.

    A registration mismatch is recorded and flagged for the manager - it never
    blocks the driver. Semantics for repeats, ended and superseded assignments
    are in app/services/driver_self.py.
    """
    assignment, truck, already = await driver_self.verify_current_assignment(
        db,
        driver,
        user,
        AssignmentVerify(
            reported_registration=payload.reported_registration,
            reported_odometer_km=payload.reported_odometer_km,
            reported_fuel_level_pct=payload.reported_fuel_level_pct,
            reported_damage_notes=payload.reported_damage_notes,
        ),
        assignment_id=payload.assignment_id,
        ip=ip,
    )
    return VerifyResult(
        assignment=_to_current(assignment, truck), already_verified=already
    )


# =========================================================================
# Trip execution
# =========================================================================
#
# The subject of every route below is the trip resolved from the authenticated
# driver. `trip_id` never appears in a path. Where a body carries one it is
# compared against the resolved trip and can only cause a rejection - the same
# narrowing-only rule as `assignment_id` on verification.


class TripStopView(ReadModel):
    """One stop as the driver's screen needs it."""

    id: uuid.UUID
    sequence: int
    kind: TripStopKind
    status: TripStopStatus
    name: str | None
    address: str | None
    planned_arrival_at: datetime | None
    actual_arrival_at: datetime | None


class LastFix(ReadModel):
    """When the server last heard from this device, by the SERVER clock.

    Reported so the app can show a "last sent" time from what actually landed
    rather than from what it believes it sent. A fix still sitting in the retry
    queue must not look delivered.
    """

    recorded_at: datetime
    received_at: datetime
    age_seconds: float
    freshness: str


class TrackingConfig(ReadModel):
    """Upload cadence, decided by the server.

    Sent to the app rather than compiled into it, so the freshness threshold a
    manager sees and the interval a phone uploads on cannot drift apart. See
    app/domain/telemetry_policy.py.
    """

    moving_interval_seconds: int
    stationary_interval_seconds: int
    stationary_distance_m: int
    batch_size: int
    queue_limit: int
    fresh_seconds: int


class CurrentTrip(ReadModel):
    id: uuid.UUID
    trip_code: str
    status: TripStatus
    dispatched_at: datetime | None
    started_at: datetime | None
    delivered_at: datetime | None
    truck: TruckSummary
    stops: list[TripStopView]
    #: The one stop the driver may act on. Null when every stop is settled.
    next_stop_id: uuid.UUID | None
    #: True only when every start gate passes right now.
    can_start: bool
    #: Why not, when the trip has not started and cannot.
    start_blocked_code: str | None
    start_blocked_reason: str | None
    #: True while the server will accept location for this trip.
    tracking_expected: bool
    tracking: TrackingConfig
    last_fix: LastFix | None


class TripActionRequest(APIModel):
    """Optional narrowing id, exactly like AssignmentVerify.assignment_id."""

    trip_id: uuid.UUID | None = None


def _stop_view(stop) -> TripStopView:
    return TripStopView(
        id=stop.id,
        sequence=stop.sequence,
        kind=stop.kind,
        status=stop.status,
        name=stop.name,
        address=stop.address,
        planned_arrival_at=stop.planned_arrival_at,
        actual_arrival_at=stop.actual_arrival_at,
    )


async def _trip_view(db, driver, trip) -> CurrentTrip:
    """Assemble the driver's trip screen from real state only.

    Nothing here is derived on the client. `can_start` comes from the same
    function the start endpoint uses, so a control the app enables is one the
    server will honour - and one it disables is genuinely unavailable.
    """
    truck = await driver_self.truck_for(db, trip.truck_id)
    stops = await trips.stops_for(db, trip.id)
    next_stop = driver_trips.next_actionable_stop(stops)

    _, blocker = await driver_trips.evaluate_start(db, driver, trip)
    in_progress = trip.status in driver_trips.IN_PROGRESS_STATUSES

    position = await telemetry.latest_position(db, trip.id)
    last_fix = (
        LastFix(
            recorded_at=position.recorded_at,
            received_at=position.received_at,
            age_seconds=position.age_seconds(),
            freshness=position.freshness,
        )
        if position is not None
        else None
    )

    return CurrentTrip(
        id=trip.id,
        trip_code=trip.trip_code,
        status=trip.status,
        dispatched_at=trip.dispatched_at,
        started_at=trip.started_at,
        delivered_at=trip.delivered_at,
        truck=TruckSummary.model_validate(truck),
        stops=[_stop_view(s) for s in stops],
        next_stop_id=next_stop.id if next_stop else None,
        can_start=blocker is None,
        start_blocked_code=(
            None if in_progress else (blocker.code if blocker else None)
        ),
        start_blocked_reason=(
            None if in_progress else (blocker.message if blocker else None)
        ),
        tracking_expected=in_progress,
        tracking=TrackingConfig(**policy.tracking_config()),
        last_fix=last_fix,
    )


@router.get(
    "/me/trip",
    response_model=CurrentTrip | None,
    summary="The driver's current trip",
)
async def my_trip(driver: CurrentDriver, db: DbSession) -> CurrentTrip | None:
    """Returns null when the driver has no trip.

    A driver between trips is a normal state, not an error - 200 with a null
    body, so the app renders an empty screen rather than special-casing a 404.
    """
    trip = await driver_trips.current_trip(db, driver)
    return None if trip is None else await _trip_view(db, driver, trip)


@router.post("/me/trip/start", response_model=CurrentTrip, summary="Start the trip")
async def start_my_trip(
    payload: TripActionRequest,
    driver: CurrentDriver,
    user: CurrentUser,
    db: DbSession,
    ip: ClientIp,
) -> CurrentTrip:
    trip = await driver_trips.start(db, driver, user, trip_id=payload.trip_id, ip=ip)
    return await _trip_view(db, driver, trip)


@router.post(
    "/me/trip/stops/{stop_id}/arrive",
    response_model=CurrentTrip,
    summary="Mark arrival at the current stop",
)
async def arrive_at_stop(
    stop_id: uuid.UUID,
    driver: CurrentDriver,
    user: CurrentUser,
    db: DbSession,
    ip: ClientIp,
) -> CurrentTrip:
    """`stop_id` is checked for membership of the driver's OWN trip.

    A stop belonging to another trip is a 404, not a 403: confirming the id
    exists would disclose something about a trip that is not theirs.
    """
    trip, _ = await driver_trips.arrive_at_stop(db, driver, user, stop_id, ip=ip)
    return await _trip_view(db, driver, trip)


@router.post(
    "/me/trip/stops/{stop_id}/complete",
    response_model=CurrentTrip,
    summary="Complete the current stop",
)
async def complete_stop(
    stop_id: uuid.UUID,
    driver: CurrentDriver,
    user: CurrentUser,
    db: DbSession,
    ip: ClientIp,
) -> CurrentTrip:
    trip, _ = await driver_trips.complete_stop(db, driver, user, stop_id, ip=ip)
    return await _trip_view(db, driver, trip)


@router.post(
    "/me/trip/complete", response_model=CurrentTrip, summary="Complete the trip"
)
async def complete_my_trip(
    payload: TripActionRequest,
    driver: CurrentDriver,
    user: CurrentUser,
    db: DbSession,
    ip: ClientIp,
) -> CurrentTrip:
    trip = await driver_trips.complete(
        db, driver, user, trip_id=payload.trip_id, ip=ip
    )
    return await _trip_view(db, driver, trip)


# =========================================================================
# Location
# =========================================================================


@router.post(
    "/me/location",
    response_model=GpsBatchAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit position fixes for the current trip",
)
async def submit_location(
    payload: GpsBatchIn,
    driver: CurrentDriver,
    db: DbSession,
) -> GpsBatchAccepted:
    """Ingest a batch of fixes for the driver's own in-progress trip.

    202, not 201: the fixes are accepted for processing, and the response
    reports per-fix dispositions rather than pretending each one created a
    resource.

    Collection is bound to an in-progress trip, enforced here rather than in the
    app (docs/SECURITY.md section 3). A tampered client, or a background task
    the app failed to stop, cannot produce off-duty tracking: there is no trip
    to attach it to and the request is refused.

    No audit row is written. One `audit_logs` entry per GPS point would bury the
    compliance trail under telemetry - see app/services/telemetry.py.
    """
    trip = await driver_trips.current_trip(db, driver)
    if trip is None:
        raise NotFoundError("You have no trip to send location for.")

    if payload.trip_id is not None and payload.trip_id != trip.id:
        raise ConflictError(
            "Those fixes are for a different trip.",
            code="TRIP_SUPERSEDED",
            details={"current_trip_id": str(trip.id)},
        )

    if trip.status not in driver_trips.IN_PROGRESS_STATUSES:
        raise ConflictError(
            "Location is only collected while a trip is in progress.",
            code="TRIP_NOT_IN_PROGRESS",
            details={"current": trip.status.value},
        )

    result = await telemetry.ingest(
        db, trip=trip, driver=driver, fixes=payload.fixes
    )
    return GpsBatchAccepted(
        trip_id=trip.id,
        accepted=result.accepted,
        duplicates_ignored=result.duplicates_ignored,
        rejected=result.rejected,
        rejected_reasons=result.rejected_reasons,
        anomalies=sorted(result.anomalies),
        server_time=datetime.now(UTC),
    )
