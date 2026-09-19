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

import logging
import uuid
from datetime import UTC, date, datetime

from geoalchemy2 import Geometry, WKTElement
from sqlalchemy import cast, func, or_, select
from sqlalchemy import update as sa_update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BusinessRuleError, ConflictError, NotFoundError
from app.domain.trip_state import IllegalTripTransition, assert_transition
from app.models.enums import (
    AssignmentStatus,
    AuditAction,
    DriverStatus,
    RouteState,
    TripEventKind,
    TripStatus,
    TripStopKind,
    TripStopStatus,
    TruckStatus,
)
from app.models.fleet import DriverTruckAssignment, Truck
from app.models.identity import Driver, User
from app.models.operations import Shipment, Trip, TripEvent, TripRoute, TripStop
from app.domain.routing import Coordinate as RouteCoordinate
from app.domain.routing import parse_wkt_point
from app.schemas.common import Coordinate
from app.schemas.domain import ShipmentCreate, TripCreate, TripPlanTrip, in_service_region
from app.services import audit, notify, shipments
from app.services.pagination import (
    build_page,
    clamp_limit,
    cursor_predicate,
    decode_cursor,
)

AUDITED_FIELDS = (
    "id", "trip_code", "shipment_id", "truck_id", "driver_id", "assignment_id",
    "status", "dispatched_at", "driver_accepted_at", "driver_accepted_by",
    "started_at", "delivered_at", "closed_at",
)

#: Statuses in which a trip is a driver's concern: it is theirs to start, or
#: already running. Matches the partial index ix_trips_active for the two
#: in-transit ones.
#:
#: This is the ONLY filter `driver_trips.current_trip` applies, so a status
#: missing here does not merely sort late - it disappears from the driver's
#: app, and the next QUEUED trip takes its place as "current". A driver may
#: hold several non-terminal trips at once (dispatch is a queue; see
#: `current_trip`'s ordering), which is what makes an omission here dangerous
#: rather than merely untidy.
#:
#: INCIDENT is therefore included even though nothing transitions into it yet.
#: COMMITS_DRIVER_TO_TRUCK already declares that during INCIDENT the driver is
#: physically with that truck; leaving it out would let the app hand them a
#: different trip to start, contradicting a fact this codebase asserts
#: elsewhere. It is not startable - `evaluate_start` refuses anything that is
#: not ASSIGNED - so including it makes the trip visible and blocking, which is
#: the correct failure while a stuck truck waits on a human.
#:
#: DELIVERED is deliberately absent. It is committed too, but it is settlement
#: work rather than the thing the driver is doing now, and it is addressed by
#: id through `_own_delivered_trip` instead. Keeping it out is what lets the
#: next trip become current once a delivery is made.
logger = logging.getLogger(__name__)

OPEN_TRIP_STATUSES = (
    TripStatus.ASSIGNED,
    TripStatus.ACTIVE,
    TripStatus.DELAYED,
    TripStatus.INCIDENT,
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

    `populate_existing` is what makes the lock mean anything (LS-9). Without it,
    a trip already in this session's identity map is handed back with the
    attribute values of the EARLIER read: SQLAlchemy emits the SELECT ... FOR
    UPDATE and really takes the lock, then discards the row it just locked
    because it already has an instance for that primary key. `routes.plan()` is
    a live path with exactly that shape - it loads the trip, commits to release
    the connection, spends up to ROUTING_TIMEOUT_SECONDS at a provider, then
    locks - and `expire_on_commit=False` (app/db/session.py) is set precisely so
    the commit does NOT expire it in between. Re-reading under the lock is the
    whole point of taking one, so it is done here, once, rather than left for
    each of the eight callers to remember.
    """
    trip = (
        await db.execute(
            select(Trip)
            .where(Trip.id == trip_id)
            .with_for_update()
            .execution_options(populate_existing=True)
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


#: Trips nobody is working any more. The console shows these as history:
#: read-only rows, no dispatch or cancel control.
HISTORY_STATUSES = (TripStatus.DELIVERED, TripStatus.CLOSED, TripStatus.CANCELLED)

#: A trip in one of these states OWNS its driver and truck: planning them into
#: a second trip would promise the same person and the same vehicle to two
#: jobs at once.
#:
#: Derived from the lifecycle, not guessed. DRAFT is included because a draft
#: is a commitment a dispatcher has already made on paper - it is the state the
#: console shows as "ready to dispatch", and the screenshot that prompted this
#: had one pair sitting on several drafts at once. DELIVERED is included
#: because `release_resources` runs on CLOSE, not on delivery: until someone
#: closes the job the truck is still standing at the consignee. CLOSED and
#: CANCELLED release, which is exactly where `release_resources` is called.
RESOURCE_BLOCKING_STATUSES = (
    TripStatus.DRAFT,
    TripStatus.ASSIGNED,
    TripStatus.VERIFICATION_PENDING,
    TripStatus.MANAGER_REVIEW,
    TripStatus.ACTIVE,
    TripStatus.DELAYED,
    TripStatus.INCIDENT,
    TripStatus.DELIVERED,
)


async def blocking_trip_for(
    db: AsyncSession,
    *,
    driver_id: uuid.UUID | None = None,
    truck_id: uuid.UUID | None = None,
    exclude_trip_id: uuid.UUID | None = None,
) -> Trip | None:
    """The open trip already holding this driver or truck, if there is one.

    Read with FOR UPDATE so two managers planning the same pair at the same
    moment cannot both find nothing: the second transaction waits on the first
    one's rows and then sees the trip it created. Without the lock the check is
    advisory and the race is real - two requests, two drafts, one driver.
    """
    if driver_id is None and truck_id is None:
        return None
    who = []
    if driver_id is not None:
        who.append(Trip.driver_id == driver_id)
    if truck_id is not None:
        who.append(Trip.truck_id == truck_id)
    stmt = (
        select(Trip)
        .where(or_(*who), Trip.status.in_(RESOURCE_BLOCKING_STATUSES))
        .order_by(Trip.created_at.asc())
        .limit(1)
        .with_for_update()
    )
    if exclude_trip_id is not None:
        stmt = stmt.where(Trip.id != exclude_trip_id)
    return (await db.execute(stmt)).scalar_one_or_none()


async def _assert_resources_free(
    db: AsyncSession, *, driver: Driver, truck: Truck
) -> None:
    """Refuse a trip that would double-book a driver or a truck.

    Inside the caller's transaction and before anything is written, so a
    refusal leaves nothing behind. The message names the trip that holds the
    resource, because "driver unavailable" sends a dispatcher hunting through
    a list while the answer is one row away.
    """
    held = await blocking_trip_for(db, driver_id=driver.id)
    if held is not None:
        raise ConflictError(
            f"{driver.full_name} is already committed to {held.trip_code} "
            f"({held.status.value}). Close or cancel that trip first.",
            code="DRIVER_RESERVED_BY_TRIP",
            details={"trip_code": held.trip_code, "trip_status": held.status.value},
        )
    held = await blocking_trip_for(db, truck_id=truck.id)
    if held is not None:
        raise ConflictError(
            f"{truck.registration_number} is already committed to {held.trip_code} "
            f"({held.status.value}). Close or cancel that trip first.",
            code="TRUCK_RESERVED_BY_TRIP",
            details={"trip_code": held.trip_code, "trip_status": held.status.value},
        )


def _trip_filters(stmt, *, status, driver_id, truck_id, search, open_only):
    """Every filter in one place, so the page query and the count query can
    never disagree about what the page is a page OF."""
    if status is not None:
        stmt = stmt.where(Trip.status == status)
    if driver_id is not None:
        stmt = stmt.where(Trip.driver_id == driver_id)
    if truck_id is not None:
        stmt = stmt.where(Trip.truck_id == truck_id)
    if open_only is True:
        stmt = stmt.where(Trip.status.not_in(HISTORY_STATUSES))
    elif open_only is False:
        stmt = stmt.where(Trip.status.in_(HISTORY_STATUSES))
    text = (search or "").strip()
    if text:
        # Trip code or client name. ILIKE on two columns, not a full-text
        # index: a fleet console searches tens of thousands of rows, not
        # millions, and an index nobody maintains rots.
        like = f"%{text}%"
        stmt = stmt.where(
            or_(
                Trip.trip_code.ilike(like),
                Trip.shipment_id.in_(
                    select(Shipment.id).where(Shipment.client_name.ilike(like))
                ),
            )
        )
    return stmt


async def list_trips(
    db: AsyncSession,
    *,
    limit: int | None = None,
    cursor: str | None = None,
    status: TripStatus | None = None,
    driver_id: uuid.UUID | None = None,
    truck_id: uuid.UUID | None = None,
    search: str | None = None,
    open_only: bool | None = None,
    with_total: bool = False,
):
    """A filtered page of trips, newest first.

    Filtered HERE rather than in the client. The console used to read the
    newest 50 and filter them in the browser, so a trip older than those 50 -
    a 55-hour run, a delivered job from last week - could not be reached or
    searched at all. `with_total` adds one COUNT over the same filters so a
    pager can say which page of how many.
    """
    page_size = clamp_limit(limit)
    # ONE join for the shipment's client and endpoints. Without it every list
    # row knows a shipment_id and nothing a person can read, and the CSV/PDF
    # export wrote 107 rows with Client, Origin and Destination blank while
    # every other column was populated. A per-row detail fetch would be 107
    # requests to draw one table.
    stmt = _trip_filters(
        select(Trip, Shipment.client_name, Shipment.pickup_address, Shipment.destination_address)
        .outerjoin(Shipment, Shipment.id == Trip.shipment_id),
        status=status, driver_id=driver_id, truck_id=truck_id,
        search=search, open_only=open_only,
    )
    if cursor:
        stmt = stmt.where(
            cursor_predicate(Trip.created_at, Trip.id, decode_cursor(cursor))
        )
    stmt = stmt.order_by(Trip.created_at.desc(), Trip.id.desc()).limit(page_size + 1)
    rows = []
    for trip, client_name, pickup, destination in (await db.execute(stmt)).all():
        # Attached to the loaded Trip so the existing read model picks them up
        # without a second shape travelling through every caller.
        trip.client_name = client_name
        trip.origin = pickup
        trip.destination = destination
        rows.append(trip)
    page, next_cursor = build_page(rows, page_size)
    if not with_total:
        return page, next_cursor
    total = (
        await db.execute(
            _trip_filters(
                select(func.count(Trip.id)), status=status, driver_id=driver_id,
                truck_id=truck_id, search=search, open_only=open_only,
            )
        )
    ).scalar_one()
    return page, next_cursor, total


async def events_for(
    db: AsyncSession, trip_id: uuid.UUID, *, limit: int = 100
) -> list[tuple[TripEvent, str | None]]:
    """The trip's timeline with each actor's display name, oldest first.

    Read-only, and it invents nothing: every row was written by the operation
    it describes. The join is to `users` so a screen can say "by Demo Manager"
    without a second round trip per row.
    """
    rows = (
        await db.execute(
            select(TripEvent, User.display_name)
            .outerjoin(User, User.id == TripEvent.actor_user_id)
            .where(TripEvent.trip_id == trip_id)
            .order_by(TripEvent.occurred_at.asc(), TripEvent.id.asc())
            .limit(limit)
        )
    ).all()
    return [(row[0], row[1]) for row in rows]


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
    # A driver and a truck can each be on ONE open job. Checked here, under
    # the same transaction that writes the trip, so two concurrent planners
    # cannot both pass.
    await _assert_resources_free(db, driver=driver, truck=truck)

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
    """Load a driver and assert they may be given a trip.

    Dispatchability is not `drivers.status` alone. The operational status and
    the login behind it are separate columns that can disagree, and only one of
    them decides whether the driver can actually pick the trip up. A driver row
    reading AVAILABLE whose account cannot authenticate yields a trip that is
    ASSIGNED and unreachable - the driver is rejected at login, so the start
    endpoint is never called, and the truck stays held by a trip nobody can
    move. The join is what keeps that combination from being expressible.

    Run for creation AND again for dispatch, deliberately: every fact here can
    change between planning a trip and sending it.
    """
    # FOR UPDATE OF users, not merely a read: the login flag is the one fact
    # here that another request can flip while this one is deciding. Without
    # the lock, a dispatch and a deactivation both pass their pre-checks and
    # both commit - the trip reaches ASSIGNED and the account that owns it is
    # already disabled. Deactivation takes the same row lock first, so the two
    # serialise on it and whichever runs second sees the other's committed
    # result. Only the users row is locked; the driver row is read, not held.
    row = (
        await db.execute(
            select(Driver, User.is_active)
            .join(User, User.id == Driver.user_id)
            .where(Driver.id == driver_id, Driver.deleted_at.is_(None))
            .with_for_update(of=User)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Driver not found.")
    driver, login_is_active = row
    if driver.status is DriverStatus.SUSPENDED:
        raise BusinessRuleError(
            "Driver is suspended and cannot be given a trip.",
            code="DRIVER_SUSPENDED",
        )
    if not login_is_active:
        # 409, not 422: unlike capacity or an expired licence this is a state
        # that can be undone by reactivating the account, so the request is not
        # "nobody may" - it is "not while this is true".
        raise ConflictError(
            "The driver's login is inactive, so they could not start the trip. "
            "Reactivate the account first.",
            code="DRIVER_LOGIN_INACTIVE",
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


async def _assert_dispatchable_route(db: AsyncSession, trip: Trip) -> None:
    """The road the driver will be told to take must exist before dispatch.

    A trip's `selected_route_id` is written by exactly one path, `apply_selection`,
    which runs the eligibility decision and spends any review authorisation
    inside the same transaction that marks the row SELECTED. So "selected,
    belongs to this trip, still SELECTED, has a line" is the whole invariant:
    review is proven by the state the selection left behind, not re-run here
    with a weather fan-out on every dispatch. A disabled button in the console
    is not a control - TRP-08726C5F went ACTIVE with no route through an older
    console, and the driver was navigated by nothing.

    One statement, no ORM load: the route row is not needed, only its facts.
    """
    if trip.selected_route_id is None:
        raise BusinessRuleError(
            "Select a route in the trip review before dispatching. A draft is "
            "not dispatchable without one.",
            code="ROUTE_SELECTION_REQUIRED",
        )
    row = (
        await db.execute(
            select(
                TripRoute.trip_id,
                TripRoute.state,
                func.ST_NPoints(cast(TripRoute.geometry, Geometry)),
            ).where(TripRoute.id == trip.selected_route_id)
        )
    ).one_or_none()
    if row is None or row[0] != trip.id:
        raise BusinessRuleError(
            "The trip's selected route does not belong to this trip. Select a "
            "route again in the trip review.",
            code="ROUTE_INVALID",
        )
    state, points = row[1], row[2]
    if state is RouteState.PROPOSED:
        # Pointed at without passing through selection: no eligibility decision
        # was made and no authorisation spent.
        raise BusinessRuleError(
            "The selected route has not been through selection review. Check "
            "its conditions and select it in the trip review first.",
            code="ROUTE_REVIEW_REQUIRED",
        )
    if state is not RouteState.SELECTED:
        raise BusinessRuleError(
            "The selected route is no longer current "
            f"({state.value.lower().replace('_', ' ')}). Select a route again.",
            code="ROUTE_INVALID",
        )
    if points is None or points < 2:
        raise BusinessRuleError(
            "The selected route has no usable geometry. Re-plan and select a "
            "route again.",
            code="ROUTE_INVALID",
        )


async def dispatch(
    db: AsyncSession, trip_id: uuid.UUID, *, actor: User, ip: str | None = None
) -> Trip:
    """DRAFT -> ASSIGNED. The trip becomes the driver's to start.

    Re-runs every gate rather than trusting what was true at creation: a licence
    can lapse, a truck can break down, and an assignment can be ended between
    planning a trip and dispatching it.

    LOCK ORDER: users, THEN trips. It must match `drivers.deactivate()`,
    which takes the same two locks in that order. Both operations touch both
    rows, so taking them in opposite orders is an ABBA deadlock:

        dispatch    holds trips, waits for users
        deactivate  holds users, waits for trips

    PostgreSQL resolves that by aborting one side with SQLSTATE 40P01, and
    nothing in this application handles 40P01 - so the caller meets a 500
    exactly where the design intends a clean 409. Deactivation cannot yield
    its ordering: it must hold the login before it looks for live trips, or a
    dispatch in flight turns a DRAFT trip into an ASSIGNED one behind its
    check. So dispatch is the side that reorders.

    Reading `driver_id` before the trip is locked is safe because it is
    write-once: it is set when the trip row is created and no code path
    updates it afterwards.
    """
    driver_id = (
        await db.execute(select(Trip.driver_id).where(Trip.id == trip_id))
    ).scalar_one_or_none()
    if driver_id is None:
        raise NotFoundError("Trip not found.")

    # Locks the users row (FOR UPDATE OF users) and refuses an inactive login.
    driver = await _load_driver(db, driver_id)

    trip = await load_for_update(db, trip_id)
    before = audit.snapshot(trip, AUDITED_FIELDS)
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

    await _assert_dispatchable_route(db, trip)

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
    # After the commit: a trip that is assigned is assigned whether or not the
    # phone hears about it now; the push must never roll a dispatch back.
    await notify.send(
        db, driver_id=trip.driver_id, trip_id=trip.id, event="TRIP_ASSIGNED",
        title="New trip assigned", body=f"Trip {trip.trip_code}: open the app to review and accept.",
        data={"screen": "trip"},
    )
    await db.commit()
    await db.refresh(trip)
    return trip


#: What happens to cargo that is already on the truck when a manager stops or
#: changes a trip. A post-pickup "cancel" without one of these is refused: a
#: loaded truck with a cancelled job and no instruction is a driver left
#: guessing at a roadside, which is the silent failure this exists to prevent.
DISPOSITIONS = (
    "RETURN_TO_DEPOT",  # cargo goes back to where it was loaded (the pickup stop)
    "NEW_DESTINATION",  # cargo goes to a new, confirmed, in-region drop-off
    "HOLD_FOR_INSTRUCTION",  # truck waits; trip reads DELAYED until told otherwise
    "COMPLETE_CURRENT_LEG",  # nothing changes on the road; the decision is recorded
    "CARGO_UNLOADED",  # cargo already accounted for off-system; the trip closes as cancelled
)
MIN_REASON_CHARS = 10
#: Kinds whose payload may carry an instruction the driver must acknowledge.
INSTRUCTION_KINDS = (TripEventKind.DELAY_DETECTED, TripEventKind.ROUTE_CHANGED)


async def cargo_loaded(db: AsyncSession, trip_id: uuid.UUID) -> bool:
    """True once the pickup stop is COMPLETED - the cargo is on the truck."""
    stops = await stops_for(db, trip_id)
    pickup = next((s for s in stops if s.kind is TripStopKind.PICKUP), stops[0] if stops else None)
    return pickup is not None and pickup.status is TripStopStatus.COMPLETED


async def pending_instruction(db: AsyncSession, trip_id: uuid.UUID) -> dict | None:
    """The newest manager instruction the driver has not acknowledged, or None.

    Read from the timeline, not from a column: the instruction and its
    acknowledgement are both events, so "sent" and "seen" are told apart by
    the same record an incident review reads. Few rows per trip; filtered in
    Python rather than with a self-join.
    """
    rows = (
        await db.execute(
            select(TripEvent)
            .where(
                TripEvent.trip_id == trip_id,
                TripEvent.kind.in_((*INSTRUCTION_KINDS, TripEventKind.ACCEPTED)),
            )
            .order_by(TripEvent.occurred_at.desc(), TripEvent.id.desc())
        )
    ).scalars().all()
    acked = {
        (e.payload or {}).get("acknowledges")
        for e in rows
        if e.kind is TripEventKind.ACCEPTED and e.payload
    }
    for e in rows:
        p = e.payload or {}
        if e.kind in INSTRUCTION_KINDS and p.get("requires_ack") and e.id not in acked:
            return {
                "event_id": e.id,
                "instruction": p.get("instruction"),
                "reason": p.get("reason"),
                "previous_destination": p.get("previous_destination"),
                "new_destination": p.get("new_destination"),
                "issued_at": e.occurred_at,
            }
    return None


async def _redirect_cargo(
    db: AsyncSession,
    trip: Trip,
    *,
    disposition: str,
    destination: Coordinate | None,
    destination_address: str | None,
) -> tuple[str | None, str]:
    """Skip the pending drop-off and append the new one. History is kept.

    RETURN_TO_DEPOT goes back to the pickup stop's own location - where the
    cargo was loaded is the one place known to accept it. NEW_DESTINATION needs
    a confirmed, in-region point. Neither touches the current route: the
    driver keeps the road they are on until the manager selects a candidate
    for the new destination through the reroute path.
    """
    stops = await stops_for(db, trip.id)
    pickup = next((s for s in stops if s.kind is TripStopKind.PICKUP), stops[0])
    previous = next((s for s in reversed(stops) if s.kind is TripStopKind.DROPOFF and s.status is TripStopStatus.PENDING), None)
    if disposition == "RETURN_TO_DEPOT":
        lat, lon = parse_wkt_point(
            (await db.execute(select(func.ST_AsText(TripStop.location)).where(TripStop.id == pickup.id))).scalar_one()
        )
        destination = Coordinate(lat=lat, lon=lon)
        destination_address = pickup.address or pickup.name or "Pickup point"
        name = "Return to depot"
    else:
        if destination is None or not (destination_address or "").strip():
            raise BusinessRuleError(
                "NEW_DESTINATION needs a confirmed destination (address and coordinates).",
                code="LOCATION_CONFIRMATION_REQUIRED",
            )
        if not in_service_region(destination):
            raise BusinessRuleError(
                f"The new destination ({destination.lat:.4f}, {destination.lon:.4f}) is "
                "outside the North-East service region.",
                code="OUTSIDE_SERVICE_REGION",
            )
        name = "New delivery"
    for s in stops:
        if s.kind is TripStopKind.DROPOFF and s.status is TripStopStatus.PENDING:
            s.status = TripStopStatus.SKIPPED
    db.add(
        TripStop(
            trip_id=trip.id,
            sequence=max(s.sequence for s in stops) + 1,
            kind=TripStopKind.DROPOFF,
            location=shipments.point(destination),
            name=name,
            address=destination_address,
        )
    )
    return (previous.address if previous else None), destination_address


#: Two stops closer than this are the same place for operational purposes, and
#: a second one buys nothing but a confusing arrival geofence.
MIN_STOP_SEPARATION_M = 200
#: Where a new stop may go. Deliberately only two: "next" is what a manager
#: means by a detour, "before the final delivery" is what they mean by a
#: drop on the way. Arbitrary index insertion is a sequence-rewrite feature
#: nobody asked for.
STOP_PLACEMENTS = ("NEXT", "BEFORE_FINAL")


async def add_stop(
    db: AsyncSession,
    trip_id: uuid.UUID,
    *,
    actor: User,
    destination: Coordinate,
    address: str,
    name: str | None = None,
    kind: TripStopKind = TripStopKind.CHECKPOINT,
    placement: str = "NEXT",
    reason: str,
    ip: str | None = None,
) -> Trip:
    """Add an operational stop to a trip that is already under way.

    WHAT IS AND IS NOT CHANGED. Completed and arrived stops are never touched -
    a stop the driver has already served is a fact, and renumbering it would
    rewrite history. The new stop is INSERTED among the stops still pending, and
    the pending ones after it are renumbered to make room. The route is NOT
    changed here: the truck keeps the road it is on until a manager plans and
    approves a new one through the route path, which is where the hazard
    evidence and the governance live.

    The change is announced to the driver as an instruction that must be
    acknowledged - the same mechanism a destination change uses - so "the cab
    was told" is a record rather than an assumption.
    """
    trip = await load_for_update(db, trip_id)
    before = audit.snapshot(trip, AUDITED_FIELDS)

    if trip.status not in (TripStatus.ACTIVE, TripStatus.DELAYED, TripStatus.INCIDENT):
        raise BusinessRuleError(
            "Stops can only be added to a trip that is under way. Change the "
            "plan before dispatch instead.",
            code="TRIP_NOT_IN_TRANSIT",
            details={"current": trip.status.value},
        )
    if trip.driver_id is None or trip.truck_id is None:
        raise BusinessRuleError(
            "This trip has no driver or truck assigned; there is nobody to send to a new stop.",
            code="TRIP_NOT_ASSIGNED",
        )
    reason_text = (reason or "").strip()
    if len(reason_text) < MIN_REASON_CHARS:
        raise BusinessRuleError(
            f"Give a reason of at least {MIN_REASON_CHARS} characters. This is the "
            "only record of why the journey changed.",
            code="CHANGE_REASON_REQUIRED",
        )
    if placement not in STOP_PLACEMENTS:
        raise BusinessRuleError(
            "Say where the stop goes: " + ", ".join(STOP_PLACEMENTS) + ".",
            code="STOP_PLACEMENT_INVALID",
        )
    if not (address or "").strip():
        raise BusinessRuleError(
            "A new stop needs a confirmed location (address and coordinates).",
            code="LOCATION_CONFIRMATION_REQUIRED",
        )
    if not in_service_region(destination):
        raise BusinessRuleError(
            f"That point ({destination.lat:.4f}, {destination.lon:.4f}) is outside "
            "the North-East service region.",
            code="OUTSIDE_SERVICE_REGION",
        )

    stops = await stops_for(db, trip.id)
    if not stops:
        raise BusinessRuleError("This trip has no stops to add to.", code="TRIP_HAS_NO_STOPS")
    pending = [s for s in stops if s.status is TripStopStatus.PENDING]
    if not pending:
        raise BusinessRuleError(
            "Every stop on this trip has been served; there is nothing left to insert before.",
            code="NO_PENDING_STOPS",
        )

    # The same place as a neighbouring stop is not a stop. Measured in the
    # database, against the points as stored, rather than against a client's
    # idea of what is nearby.
    close = (
        await db.execute(
            select(TripStop.id, TripStop.name)
            .where(
                TripStop.trip_id == trip.id,
                TripStop.status == TripStopStatus.PENDING,
                func.ST_DWithin(
                    TripStop.location, shipments.point(destination), MIN_STOP_SEPARATION_M
                ),
            )
            .limit(1)
        )
    ).first()
    if close is not None:
        raise BusinessRuleError(
            f"That point is within {MIN_STOP_SEPARATION_M} m of a stop this trip "
            "already has. Pick a different place.",
            code="STOP_TOO_CLOSE",
        )

    final = pending[-1]
    at = pending[0] if placement == "NEXT" else final
    insert_at = at.sequence
    # Open a gap at `insert_at` in TWO statements. uq_trip_stops_sequence is a
    # plain unique index, not deferrable, so a row-by-row bump collides with
    # itself half way up the list; moving the tail out of the way first and
    # back down after never has two rows on one number.
    bump = 1000
    for delta, where in ((bump, TripStop.sequence >= insert_at), (1 - bump, TripStop.sequence >= bump)):
        await db.execute(
            sa_update(TripStop)
            .where(TripStop.trip_id == trip.id, where)
            .values(sequence=TripStop.sequence + delta)
        )
    await db.flush()

    stop = TripStop(
        trip_id=trip.id,
        sequence=insert_at,
        kind=kind,
        location=shipments.point(destination),
        name=(name or "").strip() or "Added stop",
        address=address.strip(),
    )
    db.add(stop)
    await db.flush()

    event = await record_event(
        db,
        trip,
        kind=TripEventKind.ROUTE_CHANGED,
        description=f"Stop added by manager ({placement.lower().replace('_', ' ')}) - {reason_text}",
        actor_user_id=actor.id,
        payload={
            # ponytail: ROUTE_CHANGED carries this; a STOP_ADDED kind needs a
            # pg_enum migration and PR #1 already holds the next number.
            "instruction": "ADD_STOP",
            "reason": reason_text,
            "requires_ack": True,
            "stop_id": str(stop.id),
            "stop_address": stop.address,
            "stop_name": stop.name,
            "placement": placement,
            "sequence": insert_at,
        },
    )
    await db.flush()
    await audit.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="trip_stops",
        entity_id=stop.id,
        actor_user_id=actor.id,
        before=None,
        after={"trip_id": str(trip.id), "sequence": insert_at, "address": stop.address, "placement": placement},
        reason=f"stop added mid-trip: {reason_text}",
        ip_address=ip,
    )
    await audit.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="trips",
        entity_id=trip.id,
        actor_user_id=actor.id,
        before=before,
        after=audit.snapshot(trip, AUDITED_FIELDS),
        reason=f"stop added mid-trip: {reason_text}",
        ip_address=ip,
    )
    await db.commit()
    await notify.send(
        db,
        driver_id=trip.driver_id,
        trip_id=trip.id,
        event="CRITICAL_ROUTE_CHANGE",
        title="Your manager added a stop",
        body=f"{stop.address}. {reason_text}",
        fingerprint=f"addstop:{trip.id}:{event.id}",
        data={"event_id": str(event.id), "screen": "trip"},
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
    disposition: str | None = None,
    destination: Coordinate | None = None,
    destination_address: str | None = None,
) -> Trip:
    """Cancel a trip - or, once cargo is on the truck, resolve it explicitly.

    BEFORE PICKUP the job simply ends: CANCELLED, resources released, the
    driver told. AFTER PICKUP a reason (>= MIN_REASON_CHARS) and a cargo
    disposition are both required, every outcome writes a timeline event with
    the instruction in its payload, and the driver is notified through the
    real notification path. Nothing about a loaded truck changes silently.
    """
    trip = await load_for_update(db, trip_id)
    before = audit.snapshot(trip, AUDITED_FIELDS)
    reason_text = (reason or "").strip()
    loaded = trip.status in (TripStatus.ACTIVE, TripStatus.DELAYED, TripStatus.INCIDENT) and await cargo_loaded(db, trip.id)

    if loaded:
        if len(reason_text) < MIN_REASON_CHARS:
            raise BusinessRuleError(
                f"Cargo is already on the truck. Give a reason of at least {MIN_REASON_CHARS} "
                "characters before changing this trip.",
                code="CANCEL_REASON_REQUIRED",
            )
        if disposition not in DISPOSITIONS:
            raise BusinessRuleError(
                "Cargo is already on the truck. Say what happens to it: "
                + ", ".join(DISPOSITIONS) + ".",
                code="POST_PICKUP_RESOLUTION_REQUIRED",
            )
        if disposition == "COMPLETE_CURRENT_LEG":
            await audit.record(
                db, action=AuditAction.UPDATE, entity_type="trips", entity_id=trip.id,
                actor_user_id=actor.id, before=before, after=before,
                reason=f"cancel withdrawn - complete current leg: {reason_text}", ip_address=ip,
            )
            await db.commit()
            await db.refresh(trip)
            return trip
        if disposition == "HOLD_FOR_INSTRUCTION":
            if trip.status is not TripStatus.DELAYED:
                transition(trip, TripStatus.DELAYED)
            await db.flush()
            event = await record_event(
                db, trip, kind=TripEventKind.DELAY_DETECTED,
                description=f"Hold for instruction - {reason_text}", actor_user_id=actor.id,
                # ponytail: DELAY_DETECTED carries the hold; a MANAGER_INSTRUCTION
                # kind needs a pg_enum migration and PR #1 already holds 0013.
                payload={"instruction": disposition, "reason": reason_text, "requires_ack": True},
            )
            await db.flush()
            await notify.send(
                db, driver_id=trip.driver_id, event="HOLD_AND_REVIEW", trip_id=trip.id,
                title="Hold - instruction from your manager", body=reason_text,
                fingerprint=f"hold:{trip.id}:{event.id}", data={"event_id": event.id},
            )
        elif disposition in ("RETURN_TO_DEPOT", "NEW_DESTINATION"):
            previous_address, new_address = await _redirect_cargo(
                db, trip, disposition=disposition, destination=destination,
                destination_address=destination_address,
            )
            await db.flush()
            event = await record_event(
                db, trip, kind=TripEventKind.ROUTE_CHANGED,
                description=f"Destination changed by manager ({disposition.lower().replace('_', ' ')}) - {reason_text}",
                actor_user_id=actor.id,
                payload={
                    "instruction": disposition, "reason": reason_text, "requires_ack": True,
                    "previous_destination": previous_address, "new_destination": new_address,
                    "previous_route_id": str(trip.selected_route_id) if trip.selected_route_id else None,
                },
            )
            await db.flush()
            await notify.send(
                db, driver_id=trip.driver_id, event="CRITICAL_ROUTE_CHANGE", trip_id=trip.id,
                title="Destination changed by your manager", body=f"{new_address}. {reason_text}",
                fingerprint=f"redirect:{trip.id}:{event.id}", data={"event_id": event.id},
            )
        else:  # CARGO_UNLOADED - accounted for off-system; the job ends.
            transition(trip, TripStatus.CANCELLED)
            await release_resources(db, trip)
            await db.flush()
            await record_event(
                db, trip, kind=TripEventKind.CANCELLED, description=reason_text,
                actor_user_id=actor.id, payload={"disposition": disposition, "reason": reason_text},
            )
            await notify.send(
                db, driver_id=trip.driver_id, event="TRIP_CANCELLED", trip_id=trip.id,
                title="Trip cancelled by your manager", body=reason_text,
                fingerprint=f"cancel:{trip.id}",
            )
        await audit.record(
            db, action=AuditAction.STATUS_CHANGE, entity_type="trips", entity_id=trip.id,
            actor_user_id=actor.id, before=before, after=audit.snapshot(trip, AUDITED_FIELDS),
            reason=f"{disposition}: {reason_text}", ip_address=ip,
        )
        await db.commit()
        await db.refresh(trip)
        if disposition in ("RETURN_TO_DEPOT", "NEW_DESTINATION"):
            # Candidates for the new destination, planned from the last fresh
            # fix or the pickup. A provider failure leaves the redirect intact:
            # the manager re-plans from the Fleet route tab.
            from app.services import routes as route_service, telemetry

            position = await telemetry.latest_position(db, trip.id)
            origin = (
                RouteCoordinate(lat=position.lat, lon=position.lon)
                if position is not None and position.age_seconds() < 600
                else None
            )
            try:
                await route_service.plan(db, trip.id, actor=actor, ip=ip, detailed=True, origin=origin)
            except Exception as exc:  # noqa: BLE001 - recorded, never fatal to the redirect
                logger.warning("redirect planning for trip %s deferred: %s", trip.id, exc)
                await db.rollback()
            await db.refresh(trip)
        return trip

    had_driver = trip.status in OPEN_TRIP_STATUSES
    transition(trip, TripStatus.CANCELLED)
    await release_resources(db, trip)

    await db.flush()
    await record_event(
        db,
        trip,
        kind=TripEventKind.CANCELLED,
        description=reason_text or "cancelled by manager",
        actor_user_id=actor.id,
        payload={"reason": reason_text or None, "before_pickup": True},
    )
    if had_driver:
        await notify.send(
            db, driver_id=trip.driver_id, event="TRIP_CANCELLED", trip_id=trip.id,
            title="Trip cancelled by your manager",
            body=reason_text or "No pickup required. You are available for the next assignment.",
            fingerprint=f"cancel:{trip.id}",
        )
    await audit.record(
        db,
        action=AuditAction.STATUS_CHANGE,
        entity_type="trips",
        entity_id=trip.id,
        actor_user_id=actor.id,
        before=before,
        after=audit.snapshot(trip, AUDITED_FIELDS),
        reason=reason_text or "cancelled by manager",
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
