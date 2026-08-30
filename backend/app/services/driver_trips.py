"""Driver trip execution: current trip, start, stop progress, completion.

Every function takes an already-resolved `Driver` from `require_current_driver`.
None accepts a driver id, and none accepts a trip id it will act on unchecked:
the trip is looked up FROM the driver, and any id the client sends is compared
against it and can only cause a rejection. That is the same shape as P4's
assignment verification, and it is what makes an IDOR structurally impossible
rather than merely guarded.

    authenticated user
           |
           v
      current driver          (require_current_driver)
           |
           v
      own open trip           (trips.driver_id = driver.id)
           |
           v
      that trip's stops       (trip_stops.trip_id = trip.id)

Concurrency: every mutating path locks the trip row first. Two taps of "Start"
from a driver on a flaky connection, or a manager cancelling while a driver
starts, must not both pass the state-machine check on the same status.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError
from app.models.enums import (
    AuditAction,
    DriverStatus,
    TripEventKind,
    TripStatus,
    TripStopStatus,
    TruckStatus,
)
from app.models.fleet import Truck
from app.models.identity import Driver, User
from app.models.operations import Trip, TripStop
from app.services import audit, trips

AUDITED_FIELDS = trips.AUDITED_FIELDS

STOP_AUDITED_FIELDS = (
    "id", "trip_id", "sequence", "status", "actual_arrival_at",
    "actual_departure_at",
)

#: Statuses in which a driver is executing, as opposed to waiting to start.
IN_PROGRESS_STATUSES = (TripStatus.ACTIVE, TripStatus.DELAYED)

#: A stop nobody needs to act on any more.
SETTLED_STOP_STATUSES = (TripStopStatus.COMPLETED, TripStopStatus.SKIPPED)


async def current_trip(
    db: AsyncSession, driver: Driver, *, for_update: bool = False
) -> Trip | None:
    """The driver's trip right now, or None.

    None is a legitimate answer - a driver between trips is a normal state - so
    the app renders an empty screen rather than an error.

    Ordering makes "current" deterministic when a driver has been given more
    than one trip. An in-progress trip always wins: a driver who is already
    driving must not have the app switch to a different trip underneath them.
    Among trips not yet started, the one dispatched first is next.

    `for_update` locks the trip row. Mutating callers must set it.
    """
    # ASC on a CASE would need a literal; ordering by two booleans is clearer
    # and indexes the same. `status IN (ACTIVE, DELAYED)` sorts True first under
    # DESC, which is the in-progress-wins rule.
    in_progress = Trip.status.in_(IN_PROGRESS_STATUSES)

    stmt = (
        select(Trip)
        .where(
            Trip.driver_id == driver.id,
            Trip.status.in_(trips.OPEN_TRIP_STATUSES),
        )
        .order_by(
            in_progress.desc(),
            Trip.dispatched_at.asc().nullslast(),
            Trip.created_at.asc(),
        )
        .limit(1)
    )
    if for_update:
        stmt = stmt.with_for_update(of=Trip)

    return (await db.execute(stmt)).scalar_one_or_none()


async def _own_trip_for_update(
    db: AsyncSession, driver: Driver, *, trip_id: uuid.UUID | None
) -> Trip:
    """Load and lock the driver's own current trip.

    `trip_id`, when supplied, can only NARROW. It is compared against the trip
    resolved from the driver; a mismatch is a stale screen or an impersonation
    attempt and both get the same refusal. It is never used to look anything up.
    """
    trip = await current_trip(db, driver, for_update=True)
    if trip is None:
        raise NotFoundError("You have no trip to work on right now.")

    if trip_id is not None and trip_id != trip.id:
        raise ConflictError(
            "Your trip changed. Reload before continuing.",
            code="TRIP_SUPERSEDED",
            details={"current_trip_id": str(trip.id)},
        )
    return trip


async def _own_delivered_trip(
    db: AsyncSession, driver: Driver, trip_id: uuid.UUID | None
) -> Trip | None:
    """A trip this driver has already delivered, by id.

    Filtered by `driver_id`, so this can only ever return the caller's own trip -
    it is a narrowing lookup, not a way to address someone else's.
    """
    if trip_id is None:
        return None
    return (
        await db.execute(
            select(Trip).where(
                Trip.id == trip_id,
                Trip.driver_id == driver.id,
                Trip.status == TripStatus.DELIVERED,
            )
        )
    ).scalar_one_or_none()


@dataclass(frozen=True)
class StartBlocker:
    """Why this trip cannot be started right now."""

    code: str
    message: str


async def evaluate_start(
    db: AsyncSession, driver: Driver, trip: Trip
) -> tuple[Truck | None, StartBlocker | None]:
    """Check every prerequisite for actually driving away, without mutating.

    Returned rather than raised so ONE implementation serves both the read
    (`GET /api/driver/me/trip` says why the button is disabled) and the write
    (`POST .../start` refuses). A second copy for the UI is how a screen comes
    to show an enabled button that the server then rejects - or worse, a
    disabled one when the driver could in fact go.

    Re-checked at start time rather than trusted from dispatch: a truck can
    break down and an assignment can be ended between a manager dispatching a
    trip and a driver tapping Start.
    """
    if trip.status is not TripStatus.ASSIGNED:
        return None, StartBlocker(
            "TRIP_NOT_STARTABLE",
            f"This trip is {trip.status.value.lower().replace('_', ' ')}.",
        )

    truck = (
        await db.execute(select(Truck).where(Truck.id == trip.truck_id))
    ).scalar_one_or_none()
    if truck is None:
        return None, StartBlocker(
            "TRUCK_MISSING", "This trip's truck no longer exists."
        )
    if truck.status in trips.UNUSABLE_TRUCK_STATUSES:
        return truck, StartBlocker(
            "TRUCK_NOT_OPERATIONAL",
            f"Truck is {truck.status.value.lower().replace('_', ' ')} "
            "and cannot start a trip.",
        )

    assignment = await trips.open_assignment_for(
        db, driver_id=driver.id, truck_id=trip.truck_id
    )
    if assignment is None:
        return truck, StartBlocker(
            "NO_ACTIVE_ASSIGNMENT",
            "You are no longer assigned to this truck. Speak to your manager.",
        )
    if assignment.verified_at is None:
        # The whole point of P4's verification is that a driver confirms the
        # physical vehicle before driving it. Starting an unverified trip would
        # make that check optional in practice.
        return truck, StartBlocker(
            "ASSIGNMENT_NOT_VERIFIED",
            "Check the truck before starting the trip.",
        )
    return truck, None


async def _assert_startable(db: AsyncSession, driver: Driver, trip: Trip) -> Truck:
    truck, blocker = await evaluate_start(db, driver, trip)
    if blocker is not None:
        raise ConflictError(blocker.message, code=blocker.code)
    assert truck is not None  # no blocker implies a truck was found
    return truck


async def start(
    db: AsyncSession,
    driver: Driver,
    user: User,
    *,
    trip_id: uuid.UUID | None = None,
    ip: str | None = None,
) -> Trip:
    """ASSIGNED -> ACTIVE. The truck is on the road from here."""
    trip = await _own_trip_for_update(db, driver, trip_id=trip_id)

    if trip.status in IN_PROGRESS_STATUSES:
        # Already started - almost always a retry after a lost response rather
        # than a second driver. Idempotent, for the same reason verification is.
        return trip

    before = audit.snapshot(trip, AUDITED_FIELDS)
    truck = await _assert_startable(db, driver, trip)

    trips.transition(trip, TripStatus.ACTIVE)
    trip.started_at = datetime.now(UTC)

    # Both become unavailable to the planner. Conditional, so a manager who has
    # deliberately marked the driver OFF_DUTY is not silently overwritten.
    if driver.status is DriverStatus.AVAILABLE:
        driver.status = DriverStatus.ON_TRIP
    if truck.status is TruckStatus.AVAILABLE:
        truck.status = TruckStatus.ON_TRIP

    await db.flush()
    await trips.record_event(
        db,
        trip,
        kind=TripEventKind.STARTED,
        description=f"{driver.full_name} started trip {trip.trip_code}",
        actor_user_id=user.id,
    )
    await audit.record(
        db,
        action=AuditAction.STATUS_CHANGE,
        entity_type="trips",
        entity_id=trip.id,
        actor_user_id=user.id,
        before=before,
        after=audit.snapshot(trip, AUDITED_FIELDS),
        reason="started by driver",
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(trip)
    return trip


async def _stops_locked(db: AsyncSession, trip: Trip) -> list[TripStop]:
    return list(
        (
            await db.execute(
                select(TripStop)
                .where(TripStop.trip_id == trip.id)
                .order_by(TripStop.sequence)
            )
        )
        .scalars()
        .all()
    )


def next_actionable_stop(stops: list[TripStop]) -> TripStop | None:
    """The one stop the driver may act on.

    Stops are executed in sequence order. Returning a single stop rather than a
    set is deliberate: a driver looking at a list of buttons, any of which might
    work, will eventually press the wrong one at 3am.
    """
    for stop in stops:
        if stop.status not in SETTLED_STOP_STATUSES:
            return stop
    return None


def _find_own_stop(stops: list[TripStop], stop_id: uuid.UUID) -> TripStop:
    """Resolve a stop id within the driver's own trip, or refuse.

    A stop id belonging to a different trip is a 404 and not a 403: confirming
    that the id exists would tell a caller something about a trip that is not
    theirs.
    """
    match = next((s for s in stops if s.id == stop_id), None)
    if match is None:
        raise NotFoundError("That stop is not part of your current trip.")
    return match


def _assert_in_order(stops: list[TripStop], stop: TripStop) -> None:
    """Refuse a stop that is not the one due next.

    Checked AFTER the idempotency test, not before. Ordering ran first once, and
    it made the idempotent path unreachable for a completed stop: finishing stop
    1 settles it, `next_actionable_stop` moves to stop 2, and a retry of the
    finish - the same request, resent because the response was lost - came back
    as "stops are completed in order, stop 2 is next". A conflict for an action
    that had already succeeded, at a depot, which is exactly where the signal is
    worst and the retry most likely.
    """
    expected = next_actionable_stop(stops)
    if expected is None or expected.id != stop.id:
        raise ConflictError(
            "Stops are completed in order. "
            + (
                f"Stop {expected.sequence + 1} is next."
                if expected is not None
                else "Every stop on this trip is already done."
            ),
            code="STOP_OUT_OF_ORDER",
            details={"next_stop_id": str(expected.id) if expected else None},
        )


async def _mutate_stop(
    db: AsyncSession,
    driver: Driver,
    user: User,
    stop_id: uuid.UUID,
    *,
    target: TripStopStatus,
    required_current: TripStopStatus,
    event_kind: TripEventKind,
    ip: str | None,
) -> tuple[Trip, TripStop]:
    """Shared body of arrive and complete.

    The trip row is locked first, which serialises every stop mutation on that
    trip. Two taps of "Arrived" cannot both see PENDING.
    """
    trip = await _own_trip_for_update(db, driver, trip_id=None)

    if trip.status not in IN_PROGRESS_STATUSES:
        raise ConflictError(
            "Start the trip before updating stops.",
            code="TRIP_NOT_IN_PROGRESS",
            details={"current": trip.status.value},
        )

    stops = await _stops_locked(db, trip)
    stop = _find_own_stop(stops, stop_id)

    if stop.status is target:
        # Idempotent retry of a lost response. Tested BEFORE the ordering rule:
        # a stop that already reached the requested state is no longer the one
        # "due next", so an ordering check first would answer a successful
        # retry with a conflict.
        return trip, stop

    _assert_in_order(stops, stop)

    if stop.status is not required_current:
        raise ConflictError(
            f"That stop is {stop.status.value.lower()}; "
            f"it must be {required_current.value.lower()} first.",
            code="ILLEGAL_STOP_TRANSITION",
            details={"current": stop.status.value, "requested": target.value},
        )

    before = audit.snapshot(stop, STOP_AUDITED_FIELDS)
    now = datetime.now(UTC)
    stop.status = target
    if target is TripStopStatus.ARRIVED:
        stop.actual_arrival_at = now
    else:
        stop.actual_departure_at = now

    await db.flush()
    await trips.record_event(
        db,
        trip,
        kind=event_kind,
        description=f"stop {stop.sequence} ({stop.kind.value}) {target.value.lower()}",
        payload={"stop_id": str(stop.id), "sequence": stop.sequence},
        actor_user_id=user.id,
    )
    await audit.record(
        db,
        action=AuditAction.STATUS_CHANGE,
        entity_type="trip_stops",
        entity_id=stop.id,
        actor_user_id=user.id,
        before=before,
        after=audit.snapshot(stop, STOP_AUDITED_FIELDS),
        reason=f"driver marked stop {target.value.lower()}",
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(trip)
    await db.refresh(stop)
    return trip, stop


async def arrive_at_stop(
    db: AsyncSession,
    driver: Driver,
    user: User,
    stop_id: uuid.UUID,
    *,
    ip: str | None = None,
) -> tuple[Trip, TripStop]:
    return await _mutate_stop(
        db,
        driver,
        user,
        stop_id,
        target=TripStopStatus.ARRIVED,
        required_current=TripStopStatus.PENDING,
        event_kind=TripEventKind.STOP_ARRIVED,
        ip=ip,
    )


async def complete_stop(
    db: AsyncSession,
    driver: Driver,
    user: User,
    stop_id: uuid.UUID,
    *,
    ip: str | None = None,
) -> tuple[Trip, TripStop]:
    return await _mutate_stop(
        db,
        driver,
        user,
        stop_id,
        target=TripStopStatus.COMPLETED,
        required_current=TripStopStatus.ARRIVED,
        event_kind=TripEventKind.STOP_COMPLETED,
        ip=ip,
    )


async def complete(
    db: AsyncSession,
    driver: Driver,
    user: User,
    *,
    trip_id: uuid.UUID | None = None,
    ip: str | None = None,
) -> Trip:
    """ACTIVE/DELAYED -> DELIVERED.

    Not a status PATCH. Completion asserts that the work was actually done: a
    trip marked delivered with an outstanding dropoff is a delivery that did not
    happen, and the record would be the only evidence either way.
    """
    trip = await current_trip(db, driver, for_update=True)

    if trip is None:
        # A completed trip is no longer "current", so the ordinary resolution
        # finds nothing. Before answering 404, check whether the trip the client
        # named is one this driver has ALREADY delivered - which is what a retry
        # of a lost response looks like, and it is the very last action of a
        # trip, taken wherever the truck happened to stop.
        #
        # Ownership is still proven: the lookup is filtered by driver_id, so a
        # client naming another driver's delivered trip gets the same 404.
        already = await _own_delivered_trip(db, driver, trip_id)
        if already is not None:
            return already
        raise NotFoundError("You have no trip to work on right now.")

    if trip_id is not None and trip_id != trip.id:
        raise ConflictError(
            "Your trip changed. Reload before continuing.",
            code="TRIP_SUPERSEDED",
            details={"current_trip_id": str(trip.id)},
        )

    if trip.status not in IN_PROGRESS_STATUSES:
        raise ConflictError(
            "This trip is not in progress.",
            code="TRIP_NOT_IN_PROGRESS",
            details={"current": trip.status.value},
        )

    stops = await _stops_locked(db, trip)
    outstanding = [s for s in stops if s.status not in SETTLED_STOP_STATUSES]
    if outstanding:
        raise ConflictError(
            f"{len(outstanding)} stop(s) are not finished yet.",
            code="STOPS_INCOMPLETE",
            details={
                "outstanding_sequences": [s.sequence for s in outstanding],
                "next_stop_id": str(outstanding[0].id),
            },
        )

    before = audit.snapshot(trip, AUDITED_FIELDS)
    trips.transition(trip, TripStatus.DELIVERED)
    # Server clock, never the device's. A phone with a wrong or manipulated
    # clock must not be able to backdate a delivery.
    trip.delivered_at = datetime.now(UTC)
    await trips.release_resources(db, trip)

    await db.flush()
    await trips.record_event(
        db,
        trip,
        kind=TripEventKind.DELIVERED,
        description=f"trip {trip.trip_code} completed by {driver.full_name}",
        actor_user_id=user.id,
    )
    await audit.record(
        db,
        action=AuditAction.STATUS_CHANGE,
        entity_type="trips",
        entity_id=trip.id,
        actor_user_id=user.id,
        before=before,
        after=audit.snapshot(trip, AUDITED_FIELDS),
        reason="completed by driver",
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(trip)
    return trip
