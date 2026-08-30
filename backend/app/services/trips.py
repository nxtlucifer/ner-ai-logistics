"""Trip service: the manager side of the trip lifecycle.

Creation, dispatch, cancellation and closure. The driver side - start, stops,
completion - is app/services/driver_trips.py, because those operations resolve
their subject from the authenticated driver rather than from an id in the URL,
and mixing the two authorization shapes in one module is how a driver-scoped
check ends up guarding a manager route.

Every status write goes through `transition()`, which asserts the move against
app/domain/trip_state.py before writing. There is no other way to change a trip
status in this codebase: a direct assignment somewhere would be a trip that
jumps from DRAFT to DELIVERED while passing every column constraint.

Two records are written for every transition, and they are not duplicates:

    trip_events  - what happened on the road, for the operational timeline
    audit_logs   - who changed what, for compliance

See docs/DATA_MODEL.md and the comment on TripEvent.
"""

import uuid
from datetime import UTC, date, datetime

from geoalchemy2 import WKTElement
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BusinessRuleError, ConflictError, NotFoundError
from app.domain.trip_state import IllegalTripTransition, assert_transition
from app.models.enums import (
    AssignmentStatus,
    AuditAction,
    DriverStatus,
    TripEventKind,
    TripStatus,
    TripStopKind,
    TripStopStatus,
    TruckStatus,
)
from app.models.fleet import DriverTruckAssignment, Truck
from app.models.identity import Driver, User
from app.models.operations import Shipment, Trip, TripEvent, TripStop
from app.schemas.domain import ShipmentCreate, TripCreate, TripPlanTrip
from app.services import audit, shipments
from app.services.pagination import (
    build_page,
    clamp_limit,
    cursor_predicate,
    decode_cursor,
)

AUDITED_FIELDS = (
    "id", "trip_code", "shipment_id", "truck_id", "driver_id", "assignment_id",
    "status", "dispatched_at", "started_at", "delivered_at", "closed_at",
)

#: Statuses in which a trip is a driver's concern: it is theirs to start, or
#: already running. Matches the partial index ix_trips_active for the two
#: in-transit ones.
OPEN_TRIP_STATUSES = (
    TripStatus.ASSIGNED,
    TripStatus.ACTIVE,
    TripStatus.DELAYED,
)

#: Truck states that make a trip physically impossible.
UNUSABLE_TRUCK_STATUSES = (
    TruckStatus.RETIRED,
    TruckStatus.BREAKDOWN,
    TruckStatus.MAINTENANCE,
)


# --- Shared primitives ----------------------------------------------------


async def record_event(
    db: AsyncSession,
    trip: Trip,
    *,
    kind: TripEventKind,
    description: str | None = None,
    payload: dict | None = None,
    actor_user_id: uuid.UUID | None = None,
    location: WKTElement | None = None,
) -> TripEvent:
    """Append to the trip's operational timeline.

    Does not commit - the caller owns the transaction, so the event and the
    change it narrates land together or not at all.
    """
    event = TripEvent(
        trip_id=trip.id,
        kind=kind,
        description=description,
        payload=payload,
        location=location,
        actor_user_id=actor_user_id,
        occurred_at=datetime.now(UTC),
    )
    db.add(event)
    return event


def transition(trip: Trip, target: TripStatus) -> None:
    """Assert and apply a status change.

    Raises ConflictError - not the raw IllegalTripTransition - so an illegal
    move is a 409 the client can act on rather than a 500. The message names
    both states, because "cannot do that" without saying what the current state
    is leaves a driver with no next action.
    """
    try:
        assert_transition(trip.status, target)
    except IllegalTripTransition as exc:
        raise ConflictError(
            str(exc),
            code="ILLEGAL_TRIP_TRANSITION",
            details={"current": trip.status.value, "requested": target.value},
        ) from exc
    trip.status = target


async def load_for_update(db: AsyncSession, trip_id: uuid.UUID) -> Trip:
    """Load a trip with a row lock.

    Every mutating path takes this. Without it, two requests both read the same
    status, both pass the state-machine check, and both write - which is how a
    trip gets started twice, or completed by one caller while another cancels it.
    """
    trip = (
        await db.execute(
            select(Trip).where(Trip.id == trip_id).with_for_update()
        )
    ).scalar_one_or_none()
    if trip is None:
        raise NotFoundError("Trip not found.")
    return trip


# --- Reads ----------------------------------------------------------------


async def get(db: AsyncSession, trip_id: uuid.UUID) -> Trip:
    trip = (
        await db.execute(select(Trip).where(Trip.id == trip_id))
    ).scalar_one_or_none()
    if trip is None:
        raise NotFoundError("Trip not found.")
    return trip


async def stops_for(db: AsyncSession, trip_id: uuid.UUID) -> list[TripStop]:
    """A trip's stops in execution order.

    Ordered by sequence, which is unique per trip (uq_trip_stops_sequence), so
    the order is total and the driver sees the same list every time.
    """
    return list(
        (
            await db.execute(
                select(TripStop)
                .where(TripStop.trip_id == trip_id)
                .order_by(TripStop.sequence)
            )
        )
        .scalars()
        .all()
    )


async def list_trips(
    db: AsyncSession,
    *,
    limit: int | None = None,
    cursor: str | None = None,
    status: TripStatus | None = None,
    driver_id: uuid.UUID | None = None,
) -> tuple[list[Trip], str | None]:
    page_size = clamp_limit(limit)
    stmt = select(Trip)
    if status is not None:
        stmt = stmt.where(Trip.status == status)
    if driver_id is not None:
        stmt = stmt.where(Trip.driver_id == driver_id)
    if cursor:
        stmt = stmt.where(
            cursor_predicate(Trip.created_at, Trip.id, decode_cursor(cursor))
        )
    stmt = stmt.order_by(Trip.created_at.desc(), Trip.id.desc()).limit(page_size + 1)
    rows = list((await db.execute(stmt)).scalars().all())
    return build_page(rows, page_size)


# --- Creation -------------------------------------------------------------


async def _shipment_endpoints(
    db: AsyncSession, shipment_id: uuid.UUID
) -> tuple[WKTElement, WKTElement]:
    """A shipment's pickup and destination, ready to reuse as stop locations.

    Read back as WKT rather than passing the loaded geography value straight
    through. The round trip through text is explicit about what is being copied,
    and ST_AsText emits POINT(lon lat) which is exactly what WKTElement expects -
    so there is no point at which an ordering could silently invert.
    """
    pickup, destination = (
        await db.execute(
            select(
                func.ST_AsText(Shipment.pickup_location),
                func.ST_AsText(Shipment.destination_location),
            ).where(Shipment.id == shipment_id)
        )
    ).one()
    return (
        WKTElement(pickup, srid=shipments.SRID),
        WKTElement(destination, srid=shipments.SRID),
    )


async def create(
    db: AsyncSession,
    payload: TripCreate,
    *,
    actor: User,
    ip: str | None = None,
    commit: bool = True,
) -> Trip:
    """Create a trip in DRAFT.

    `commit=False` leaves the transaction open for a caller that is making this
    and something else atomic - see `plan()`.

    DRAFT is not negotiable and `status` is absent from TripCreate: letting a
    client choose the initial status would let it skip the capacity and
    assignment gates that guard the path into ACTIVE.

    When no stops are supplied the shipment's own pickup and destination become
    stops 0 and 1. That is the ordinary case - a trip that visits the two places
    the shipment names - and requiring the manager to retype coordinates they
    have already given would invite them to be retyped wrongly.
    """
    shipment = await shipments.get(db, payload.shipment_id)
    driver = await _load_driver(db, payload.driver_id)
    truck = await _load_truck(db, payload.truck_id)

    clash = (
        await db.execute(select(Trip.id).where(Trip.trip_code == payload.trip_code))
    ).first()
    if clash:
        raise ConflictError(
            "A trip with that code already exists.", code="TRIP_EXISTS"
        )

    _assert_capacity(shipment, truck)

    trip = Trip(
        trip_code=payload.trip_code,
        shipment_id=shipment.id,
        truck_id=truck.id,
        driver_id=driver.id,
        status=TripStatus.DRAFT,
        created_by=actor.id,
    )
    db.add(trip)
    await db.flush()

    stops = payload.stops
    if stops:
        for stop in stops:
            db.add(
                TripStop(
                    trip_id=trip.id,
                    sequence=stop.sequence,
                    kind=stop.kind,
                    location=shipments.point(stop.location),
                    name=stop.name,
                    address=stop.address,
                    geofence_radius_m=stop.geofence_radius_m,
                    planned_arrival_at=stop.planned_arrival_at,
                )
            )
    else:
        pickup, destination = await _shipment_endpoints(db, shipment.id)
        db.add(
            TripStop(
                trip_id=trip.id,
                sequence=0,
                kind=TripStopKind.PICKUP,
                location=pickup,
                name="Pickup",
                address=shipment.pickup_address,
                planned_arrival_at=shipment.scheduled_pickup_at,
            )
        )
        db.add(
            TripStop(
                trip_id=trip.id,
                sequence=1,
                kind=TripStopKind.DROPOFF,
                location=destination,
                name="Delivery",
                address=shipment.destination_address,
                planned_arrival_at=shipment.expected_delivery_at,
            )
        )

    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError(
            "That trip conflicts with existing data.", code="TRIP_CONFLICT"
        ) from exc

    await record_event(
        db,
        trip,
        kind=TripEventKind.CREATED,
        description=f"trip {trip.trip_code} created for shipment {shipment.reference_code}",
        actor_user_id=actor.id,
    )
    await audit.record(
        db,
        action=AuditAction.CREATE,
        entity_type="trips",
        entity_id=trip.id,
        actor_user_id=actor.id,
        after=audit.snapshot(trip, AUDITED_FIELDS),
        ip_address=ip,
    )
    if commit:
        await db.commit()
        await db.refresh(trip)
    return trip


async def plan(
    db: AsyncSession,
    *,
    shipment_payload: ShipmentCreate,
    trip_payload: TripPlanTrip,
    actor: User,
    ip: str | None = None,
) -> Trip:
    """Create a shipment and its trip atomically, or neither.

    Planning is one decision that happens to touch two tables. Done as two
    committed API calls it is not: the shipment commits, the trip is then
    refused by the capacity gate, and a cargo record no trip explains is left
    behind - one more per retry, because each attempt mints a fresh reference.
    And the refusal it fails on is the *advertised* one, so managers meet it
    routinely rather than exceptionally.

    Both writes therefore share one transaction. Neither inner call commits;
    this function does, once, after both have passed every gate. Any exception
    - CAPACITY_EXCEEDED from the trip, a 404 from a gate, an IntegrityError -
    propagates with the transaction unfinished, and the session dependency in
    app/db/session.py rolls it back, taking the shipment with it.

    The single-resource endpoints are untouched. Creating a shipment with no
    trip is a legitimate deliberate act; what this removes is doing it by
    accident.
    """
    shipment = await shipments.create(
        db, shipment_payload, actor=actor, ip=ip, commit=False
    )
    trip = await create(
        db,
        TripCreate(
            trip_code=trip_payload.trip_code,
            shipment_id=shipment.id,
            truck_id=trip_payload.truck_id,
            driver_id=trip_payload.driver_id,
            stops=trip_payload.stops,
        ),
        actor=actor,
        ip=ip,
        commit=False,
    )
    await db.commit()
    await db.refresh(trip)
    return trip


# --- Gates ----------------------------------------------------------------


async def _load_driver(db: AsyncSession, driver_id: uuid.UUID) -> Driver:
    driver = (
        await db.execute(
            select(Driver).where(Driver.id == driver_id, Driver.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if driver is None:
        raise NotFoundError("Driver not found.")
    if driver.status is DriverStatus.SUSPENDED:
        raise BusinessRuleError(
            "Driver is suspended and cannot be given a trip.",
            code="DRIVER_SUSPENDED",
        )
    if driver.licence_expiry < date.today():
        raise BusinessRuleError(
            "Driver's licence has expired.",
            code="LICENCE_EXPIRED",
            details={"licence_expiry": driver.licence_expiry.isoformat()},
        )
    return driver


async def _load_truck(db: AsyncSession, truck_id: uuid.UUID) -> Truck:
    truck = (
        await db.execute(
            select(Truck).where(Truck.id == truck_id, Truck.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if truck is None:
        raise NotFoundError("Truck not found.")
    if truck.status in UNUSABLE_TRUCK_STATUSES:
        raise BusinessRuleError(
            f"Truck is {truck.status.value.lower().replace('_', ' ')} and cannot run a trip.",
            code="TRUCK_NOT_OPERATIONAL",
        )
    return truck


def _assert_capacity(shipment: Shipment, truck: Truck) -> None:
    """Capacity is a safety limit, not a preference.

    422, not 403: no role may authorise an overloaded truck on a hill road, so
    this is "nobody may", not "you may not".
    """
    if shipment.total_weight_kg > truck.max_capacity_kg:
        raise BusinessRuleError(
            "Shipment weight exceeds the truck's capacity.",
            code="CAPACITY_EXCEEDED",
            details={
                "shipment_weight_kg": str(shipment.total_weight_kg),
                "truck_capacity_kg": str(truck.max_capacity_kg),
            },
        )


async def open_assignment_for(
    db: AsyncSession, *, driver_id: uuid.UUID, truck_id: uuid.UUID
) -> DriverTruckAssignment | None:
    """The driver's current assignment, if it is for this truck.

    Returns None when the driver holds no open assignment, or holds one for a
    different truck. Both mean the same thing to a caller: this driver is not
    currently responsible for this vehicle.
    """
    return (
        await db.execute(
            select(DriverTruckAssignment)
            .where(
                DriverTruckAssignment.driver_id == driver_id,
                DriverTruckAssignment.truck_id == truck_id,
                DriverTruckAssignment.status.in_(
                    (AssignmentStatus.ACTIVE, AssignmentStatus.PENDING_VERIFICATION)
                ),
            )
            .order_by(DriverTruckAssignment.assigned_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


# --- Transitions ----------------------------------------------------------


async def dispatch(
    db: AsyncSession, trip_id: uuid.UUID, *, actor: User, ip: str | None = None
) -> Trip:
    """DRAFT -> ASSIGNED. The trip becomes the driver's to start.

    Re-runs every gate rather than trusting what was true at creation: a licence
    can lapse, a truck can break down, and an assignment can be ended between
    planning a trip and dispatching it.
    """
    trip = await load_for_update(db, trip_id)
    before = audit.snapshot(trip, AUDITED_FIELDS)

    driver = await _load_driver(db, trip.driver_id)
    truck = await _load_truck(db, trip.truck_id)
    shipment = await shipments.get(db, trip.shipment_id)
    _assert_capacity(shipment, truck)

    assignment = await open_assignment_for(
        db, driver_id=trip.driver_id, truck_id=trip.truck_id
    )
    if assignment is None:
        # Never silently create one. A trip whose driver is not actually
        # responsible for the truck is a paperwork fiction, and manufacturing
        # the assignment here would destroy the only record of who was.
        raise ConflictError(
            "That driver is not currently assigned to that truck. "
            "Create the assignment first.",
            code="NO_ACTIVE_ASSIGNMENT",
        )

    transition(trip, TripStatus.ASSIGNED)
    trip.assignment_id = assignment.id
    trip.dispatched_at = datetime.now(UTC)

    await db.flush()
    await record_event(
        db,
        trip,
        kind=TripEventKind.ASSIGNED,
        description=f"dispatched to {driver.full_name} on {truck.registration_number}",
        actor_user_id=actor.id,
    )
    await audit.record(
        db,
        action=AuditAction.STATUS_CHANGE,
        entity_type="trips",
        entity_id=trip.id,
        actor_user_id=actor.id,
        before=before,
        after=audit.snapshot(trip, AUDITED_FIELDS),
        reason="dispatched",
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(trip)
    return trip


async def cancel(
    db: AsyncSession,
    trip_id: uuid.UUID,
    *,
    actor: User,
    reason: str | None = None,
    ip: str | None = None,
) -> Trip:
    """Cancel a trip, releasing the driver and truck if it had started."""
    trip = await load_for_update(db, trip_id)
    before = audit.snapshot(trip, AUDITED_FIELDS)

    transition(trip, TripStatus.CANCELLED)
    await release_resources(db, trip)

    await db.flush()
    await record_event(
        db,
        trip,
        kind=TripEventKind.CANCELLED,
        description=reason or "cancelled by manager",
        actor_user_id=actor.id,
    )
    await audit.record(
        db,
        action=AuditAction.STATUS_CHANGE,
        entity_type="trips",
        entity_id=trip.id,
        actor_user_id=actor.id,
        before=before,
        after=audit.snapshot(trip, AUDITED_FIELDS),
        reason=reason or "cancelled by manager",
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(trip)
    return trip


async def close(
    db: AsyncSession, trip_id: uuid.UUID, *, actor: User, ip: str | None = None
) -> Trip:
    """DELIVERED -> CLOSED. Settlement is done; the trip is history."""
    trip = await load_for_update(db, trip_id)
    before = audit.snapshot(trip, AUDITED_FIELDS)

    transition(trip, TripStatus.CLOSED)
    trip.closed_at = datetime.now(UTC)

    await db.flush()
    await record_event(
        db, trip, kind=TripEventKind.CLOSED, actor_user_id=actor.id
    )
    await audit.record(
        db,
        action=AuditAction.STATUS_CHANGE,
        entity_type="trips",
        entity_id=trip.id,
        actor_user_id=actor.id,
        before=before,
        after=audit.snapshot(trip, AUDITED_FIELDS),
        reason="closed",
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(trip)
    return trip


async def release_resources(db: AsyncSession, trip: Trip) -> None:
    """Return the driver and truck to AVAILABLE if this trip was holding them.

    Conditional on ON_TRIP: another trip, or a manager, may have moved them in
    the meantime, and overwriting that would report a suspended driver as
    available.
    """
    driver = (
        await db.execute(select(Driver).where(Driver.id == trip.driver_id))
    ).scalar_one_or_none()
    if driver is not None and driver.status is DriverStatus.ON_TRIP:
        driver.status = DriverStatus.AVAILABLE

    truck = (
        await db.execute(select(Truck).where(Truck.id == trip.truck_id))
    ).scalar_one_or_none()
    if truck is not None and truck.status is TruckStatus.ON_TRIP:
        truck.status = TruckStatus.AVAILABLE


async def stop_progress(db: AsyncSession, trip_id: uuid.UUID) -> tuple[int, int]:
    """(completed_or_skipped, total) stops, for a progress indicator."""
    total, done = (
        await db.execute(
            select(
                func.count(TripStop.id),
                func.count(TripStop.id).filter(
                    TripStop.status.in_(
                        (TripStopStatus.COMPLETED, TripStopStatus.SKIPPED)
                    )
                ),
            ).where(TripStop.trip_id == trip_id)
        )
    ).one()
    return int(done or 0), int(total or 0)
