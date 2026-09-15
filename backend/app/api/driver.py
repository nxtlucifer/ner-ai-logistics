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
from pydantic import Field
from sqlalchemy import func, select

from app.api.deps import CurrentDriver, CurrentUser, DbSession, get_client_ip
from app.core.errors import BusinessRuleError, ConflictError, NotFoundError
from app.domain import route_progress, telemetry_policy as policy
from app.domain.places import (
    MAX_RESULTS,
    BoundingBox,
    Place,
    PlaceCategory,
    PlaceQueryError,
    PlaceQueryResult,
    PlacesSourceState,
    SearchAnchor,
    corridor_windows,
)
from app.domain.routing import Coordinate as RouteCoordinate
from app.domain.routing import parse_wkt_linestring
from app.models.enums import (
    AssignmentStatus,
    DriverCheckResponse,
    DriverStatus,
    EmergencyState,
    RouteKind,
    TripStatus,
    TripStopKind,
    TripStopStatus,
    TruckStatus,
)
from app.api.trips import RouteRiskRead, risk_read
from app.models.operations import TripRoute
from app.schemas.common import APIModel, ReadModel
from app.schemas.domain import (
    AssignmentVerify,
    DeviceEventBatchAccepted,
    DeviceEventBatchIn,
    EmergencyRead,
    GpsBatchAccepted,
    GpsBatchIn,
)
from app.domain import trip_state
from app.services import (
    device_events,
    driver_self,
    driver_trips,
    navigation,
    offline_package,
    places,
    reroute as reroute_service,
    route_risk as route_risk_service,
    routes as route_service,
    sentinel,
    telemetry,
    trips,
)

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
    verification_photo_url: str | None = None
    verification_source: str | None = None
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
        verification_photo_url=assignment.verification_photo_url,
        verification_source=assignment.verification_source,
        truck=TruckSummary.model_validate(truck),
    )


@router.get("/me", response_model=DriverMe, summary="The signed-in driver")
async def me(driver: CurrentDriver) -> DriverMe:
    return DriverMe.model_validate(driver)


class PushTokenBody(APIModel):
    #: Expo push token ("ExponentPushToken[...]"); null/empty unregisters.
    token: Annotated[str | None, Field(default=None, max_length=200)]


@router.post("/me/push-token", summary="Register this phone for push alerts")
async def register_push_token(body: PushTokenBody, driver: CurrentDriver, db: DbSession) -> dict[str, bool]:
    token = (body.token or "").strip() or None
    if token is not None and not token.startswith(("ExponentPushToken[", "ExpoPushToken[")):
        raise BusinessRuleError("Not an Expo push token")
    driver.push_token = token
    await db.commit()
    return {"registered": token is not None}


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


class RouteProgressRead(ReadModel):
    """How far along the PLANNED corridor the truck is.

    Measured by projecting the last observed fix onto the planned line, which
    is why `off_route_m` is here: the planned route and the observed track are
    different objects, and the distance between them is what says whether the
    rest of these numbers mean anything.

    THERE IS NO ETA HERE, DELIBERATELY. A routing provider's duration is a
    free-flow estimate over a road graph - it knows nothing about this load,
    this driver's break, or a checkpoint queue. `remaining_at_planned_pace_min`
    is the remaining distance at the average speed the provider's own figures
    imply, the name says so, and `REMAINING_TIME_ASSUMES_PLANNED_PACE` travels
    with it. A field called `eta` would be a promise nothing in this system
    stands behind.

    Every value is null rather than zero when it cannot be computed. A truck
    with no fix has not arrived.
    """

    fraction_complete: float | None
    travelled_distance_km: float | None
    remaining_distance_km: float | None
    off_route_m: float | None
    on_route: bool | None
    remaining_at_planned_pace_min: float | None
    planned_average_speed_kmph: float | None
    reason_codes: list[str]
    version: str


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
    #: Null only when the trip has no selected route at all. Otherwise present,
    #: with its own reason codes explaining any gaps inside it.
    progress: RouteProgressRead | None
    #: THE ROUTE IDENTITY, and the only thing on this payload that says WHICH
    #: road the driver is being sent down.
    #:
    #: The geometry itself is deliberately NOT here. It is tens of kilobytes,
    #: it does not change between selections, and this payload is re-read every
    #: ten seconds - sending a polyline on every poll to detect the rare
    #: occasion it changed is the wrong trade. The map fetches geometry from
    #: `/me/trip/offline-package` and re-fetches it exactly when this id moves.
    #:
    #: It is also what lets a client prove the map, the steps and the progress
    #: it is showing all belong to the SAME approved route rather than to three
    #: reads that happened to interleave with a reroute.
    selected_route_id: uuid.UUID | None
    #: When THIS driver acknowledged the job, or null if they have not.
    #:
    #: The app shows **Accept trip** while this is null and **Resume
    #: navigation** once it is set, and it opens the Map page only after the
    #: server has returned a non-null value here - so the redirect follows a
    #: persisted server fact rather than an optimistic local flag.
    #:
    #: It is NOT a start gate. `can_start` above remains the only thing that
    #: says whether travel may begin, and it does not consult this field. A
    #: driver who has accepted a blocked trip still sees the blocker.
    #:
    #: Cleared when the trip is reassigned, so it always means "the driver
    #: reading this payload accepted it" - never an acknowledgment inherited
    #: from whoever held the job before.
    driver_accepted_at: datetime | None
    active_emergency: EmergencyRead | None = None


class TripActionRequest(APIModel):
    """Optional narrowing id, exactly like AssignmentVerify.assignment_id."""

    trip_id: uuid.UUID | None = None


class RerouteRequest(APIModel):
    """Where the truck is now - the origin the new road is planned from."""

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class RerouteProposed(ReadModel):
    """The road planned from the truck's position. PROPOSED, not selected."""

    route_id: uuid.UUID
    kind: RouteKind
    distance_km: float | None
    estimated_duration_min: int | None
    provider: str
    has_guidance: bool


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


async def _progress_view(db, trip, position) -> "RouteProgressRead | None":
    """Progress along the trip's SELECTED route, if it has one.

    Null only when no route is selected, because progress along a corridor
    nobody chose is not a degraded answer - there is no corridor. Every other
    gap, including having no position at all, is expressed INSIDE the object
    through its reason codes, so the app has one shape to render rather than
    two.

    ONE extra statement per trip screen, and it has to stay one: this endpoint
    is polled by the driver app over a mobile link, so a second round trip to
    the same row by primary key is a cost paid on every poll, by every driver,
    forever. Geometry and both estimates come back together.

    `distance_km` is the provider's own total, and it is what a manager is
    shown for the same trip; passing it keeps the driver's remaining-plus-
    travelled from disagreeing with that figure, because the stored geometry is
    `overview=simplified` and is therefore shorter than the road.

    The assessment itself is arithmetic - no provider, no write.
    """
    if trip.selected_route_id is None:
        return None

    row = (
        await db.execute(
            select(
                func.ST_AsText(TripRoute.geometry),
                TripRoute.estimated_duration_min,
                TripRoute.distance_km,
            ).where(TripRoute.id == trip.selected_route_id)
        )
    ).first()
    if row is None:
        # `trips.selected_route_id` is a FK, so this is unreachable short of a
        # manual delete. Answered rather than crashed: a driver on the road
        # loses a progress panel, not their trip screen.
        return None

    wkt, duration, distance = row
    geometry = parse_wkt_linestring(wkt) if wkt else []

    result = route_progress.assess(
        geometry=geometry,
        position=(position.lat, position.lon) if position is not None else None,
        planned_duration_min=float(duration) if duration is not None else None,
        planned_distance_km=float(distance) if distance is not None else None,
    )
    return RouteProgressRead(
        fraction_complete=result.fraction_complete,
        travelled_distance_km=result.travelled_distance_km,
        remaining_distance_km=result.remaining_distance_km,
        off_route_m=result.off_route_m,
        on_route=result.on_route,
        remaining_at_planned_pace_min=result.remaining_at_planned_pace_min,
        planned_average_speed_kmph=result.planned_average_speed_kmph,
        reason_codes=list(result.reason_codes),
        version=result.version,
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

    progress = await _progress_view(db, trip, position)

    active_emg = await sentinel.get_active_emergency(db, trip.id)
    active_emergency = EmergencyRead.model_validate(active_emg) if active_emg else None

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
        progress=progress,
        selected_route_id=trip.selected_route_id,
        # Reported ONLY when this driver is the one who accepted. A trip
        # handed to somebody else carries the previous driver's timestamp in
        # the row, and returning it here would open the new driver's app on a
        # job it claimed they had already accepted. Comparing rather than
        # clearing means no reassignment path has to remember to do anything.
        driver_accepted_at=(
            trip.driver_accepted_at
            if trip.driver_accepted_by == driver.id
            else None
        ),
        tracking_expected=in_progress,
        tracking=TrackingConfig(**policy.tracking_config()),
        last_fix=last_fix,
        active_emergency=active_emergency,
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


class OfflineRouteRead(ReadModel):
    """A corridor as coordinates the phone can draw with no network."""

    route_id: uuid.UUID
    kind: str
    distance_km: float | None
    estimated_duration_min: int | None
    #: [[lat, lon], ...] in travel order.
    geometry: list[list[float]]


class OfflineStopRead(ReadModel):
    stop_id: uuid.UUID
    sequence: int
    kind: str
    name: str | None
    address: str | None
    lat: float | None
    lon: float | None


class OfflinePackageRead(ReadModel):
    """Everything the driver needs for this journey with no network.

    WHAT THIS IS AND IS NOT

    It carries the route already chosen - geometry, stops, estimates - so a
    phone in a valley has the journey in front of it. It does NOT contain a
    routing engine: computing a NEW route offline needs a road graph on the
    device and is not built. A driver following a known road needs the road,
    not a solver.

    `basemap` is `BUNDLED_NONE`, and the reason is legal rather than technical:
    the OSM Foundation tile usage policy prohibits prefetch and "download area
    for offline use" against tile.openstreetmap.org, which is this project's
    tile source. The gap is reported rather than filled by a policy violation,
    because a driver discovering it in a valley is worse than being told now.

    EVERYTHING TIME-SENSITIVE CARRIES ITS OWN TIMESTAMP

    `risk` is a SNAPSHOT taken when the package was built, never a live
    reading. The app must render it against `risk_captured_at` and let it go
    stale on screen using the device clock alone. A weather panel that still
    reads LIGHT RAIN ten hours into a signal blackout is the failure this
    field exists to prevent.

    `package_hash` covers only the durable parts - identity, stops, route
    geometry - so a device can ask "has the corridor changed" without the
    answer flipping every time the weather does.
    """

    trip_id: uuid.UUID
    trip_code: str
    captured_at: datetime
    selected_route: OfflineRouteRead | None
    backup_route: OfflineRouteRead | None
    stops: list[OfflineStopRead]
    risk: RouteRiskRead | None
    risk_captured_at: datetime | None
    basemap: str
    reason_codes: list[str]
    package_hash: str
    version: str


@router.get(
    "/me/trip/offline-package",
    response_model=OfflinePackageRead,
    summary="Download this trip for offline use",
)
async def my_offline_package(
    driver: CurrentDriver, db: DbSession
) -> OfflinePackageRead:
    """The driver's own current trip, packaged to survive losing the network.

    Subject taken from the token like every other route here - no trip id in
    the path, nothing to bend.

    404 when there is no current trip. Unlike `GET /me/trip`, which returns
    null because "between trips" is a normal screen, asking to download a
    journey that does not exist is a request that cannot be satisfied, and an
    app that got `null` back would have to guess whether to retry.
    """
    trip = await driver_trips.current_trip(db, driver)
    if trip is None:
        raise NotFoundError("You have no trip to download right now.")

    package = await offline_package.build_for_trip(db, trip)

    def route_read(route) -> OfflineRouteRead | None:
        if route is None:
            return None
        return OfflineRouteRead(
            route_id=route.route_id,
            kind=route.kind.value,
            distance_km=route.distance_km,
            estimated_duration_min=route.estimated_duration_min,
            geometry=route.geometry,
        )

    return OfflinePackageRead(
        trip_id=package.trip_id,
        trip_code=package.trip_code,
        captured_at=package.captured_at,
        selected_route=route_read(package.selected_route),
        backup_route=route_read(package.backup_route),
        stops=[
            OfflineStopRead(
                stop_id=s.stop_id,
                sequence=s.sequence,
                kind=s.kind,
                name=s.name,
                address=s.address,
                lat=s.lat,
                lon=s.lon,
            )
            for s in package.stops
        ],
        risk=risk_read(package.risk) if package.risk is not None else None,
        risk_captured_at=package.risk_captured_at,
        basemap=package.basemap,
        reason_codes=list(package.reason_codes),
        package_hash=package.package_hash,
        version=package.version,
    )


class NavigationManeuverRead(ReadModel):
    """One instruction, positioned along the route it belongs to."""

    type: str
    modifier: str | None
    lat: float
    lon: float
    geometry_index: int
    #: Distance along the route from its start to this maneuver. Subtract
    #: travelled distance from this to get "in X m, turn left".
    distance_from_start_m: float
    #: Distance from this maneuver to the NEXT one; 0.0 at arrival. Published
    #: for leg display. It is NOT the distance to this turn - rendering it as
    #: such is wrong by one step.
    step_distance_m: float
    #: Free-flow provider seconds for that leg. Not an ETA.
    duration_s: float | None
    name: str | None
    exit: int | None


class NavigationPackageRead(ReadModel):
    """Turn instructions for the route this trip currently follows.

    `available` is false whenever guidance cannot be driven, and
    `reason_codes` says why - no selected route, no stored maneuvers, or stored
    maneuvers that do not describe this geometry. `geometry` is still returned
    in those cases: losing directions is not losing the road.

    `route_id` and `route_revision` bind the package to one corridor. A client
    holding a cached package must compare both before drawing it, so
    instructions from a superseded route cannot appear over a new one.

    Units are explicit rather than implied by field names: metres and seconds,
    coordinates as (lat, lon) like the rest of this API.
    """

    trip_id: uuid.UUID
    trip_code: str
    route_id: uuid.UUID | None
    route_revision: str | None
    available: bool
    reason_codes: list[str]
    geometry: list[list[float]]
    maneuvers: list[NavigationManeuverRead]
    distance_m: float | None
    #: Provider free-flow duration. NOT an arrival estimate.
    duration_s: float | None
    provider: str | None
    provider_route_id: str | None
    #: When the package was assembled - not when the route was approved, and not
    #: how fresh any GPS fix is. Three different clocks, kept apart.
    captured_at: datetime
    coordinate_format: str
    distance_unit: str
    duration_unit: str
    version: str


@router.get(
    "/me/trip/navigation",
    response_model=NavigationPackageRead,
    summary="Turn instructions for this driver's current route",
)
async def my_navigation_package(
    driver: CurrentDriver, db: DbSession
) -> NavigationPackageRead:
    """Directions for the corridor this driver's trip is following.

    Subject comes from the token, like every other route in this file. There is
    no trip id in the path and nothing to bend: a driver cannot request another
    driver's guidance because there is no parameter in which to ask.

    404 when there is no current trip, matching `/me/trip/offline-package` - a
    request for directions on a journey that does not exist cannot be satisfied,
    and returning null would leave the app guessing whether to retry.

    Having a trip but no usable guidance is NOT a 404. It is a 200 with
    `available: false` and a reason, because that is a state the map has to
    render rather than an error it should retry.
    """
    trip = await driver_trips.current_trip(db, driver)
    if trip is None:
        raise NotFoundError("You have no trip to navigate right now.")

    package = await navigation.build_for_trip(db, trip)

    return NavigationPackageRead(
        trip_id=package.trip_id,
        trip_code=package.trip_code,
        route_id=package.route_id,
        route_revision=package.route_revision,
        available=package.available,
        reason_codes=list(package.reason_codes),
        geometry=package.geometry,
        maneuvers=[
            NavigationManeuverRead(
                type=m.type,
                modifier=m.modifier,
                lat=m.lat,
                lon=m.lon,
                geometry_index=m.geometry_index,
                distance_from_start_m=m.distance_from_start_m,
                step_distance_m=m.step_distance_m,
                duration_s=m.duration_s,
                name=m.name,
                exit=m.exit,
            )
            for m in package.maneuvers
        ],
        distance_m=package.distance_m,
        duration_s=package.duration_s,
        provider=package.provider,
        provider_route_id=package.provider_route_id,
        captured_at=package.captured_at,
        coordinate_format=package.coordinate_format,
        distance_unit=package.distance_unit,
        duration_unit=package.duration_unit,
        version=package.version,
    )


class PlaceContactRead(ReadModel):
    """Every field independently null. Null means nobody recorded it."""

    phone: str | None
    opening_hours: str | None
    operator: str | None


class PlaceAccessRead(ReadModel):
    """Access as MAPPED. A missing value is unknown, never permitted."""

    hgv: str | None
    max_height: str | None
    access: str | None
    fee: str | None
    toilets: str | None
    lit: str | None


class PlaceRead(ReadModel):
    provider_id: str
    category: str
    name: str | None
    lat: float
    lon: float
    contact: PlaceContactRead
    access: PlaceAccessRead
    #: APPROXIMATE STRAIGHT-LINE metres, or null. Never a driving distance and
    #: never rendered as one - a shop across a river is 200 m away and 20 km
    #: to reach. No road distance or travel time is computed here at all.
    straight_line_m: float | None
    #: Every source element behind this record. More than one means several
    #: mapped elements were judged to be the same place - LIKELY, not
    #: certainly, so the ids travel so the judgement stays checkable.
    provider_ids: list[str]
    #: Fields where merged elements disagreed. Kept rather than resolved; the
    #: UI marks the shown value as disputed.
    conflicts: dict[str, list[str]]


class PlaceSourceRead(ReadModel):
    name: str
    attribution: str
    licence: str
    retrieved_at: datetime
    coverage_description: str
    limits: str
    #: False for the corridor snapshot. The app must not describe it as a live
    #: availability feed.
    is_live: bool
    raw_records: int
    unique_places: int
    merged_duplicates: int


class PlacesResponse(ReadModel):
    """Results AND whether anybody could look.

    `state` is not decoration. AVAILABLE with an empty list means nothing of
    that kind is mapped here; OUTSIDE_COVERAGE means the area was never
    searched; UNAVAILABLE means the lookup failed. Rendering all three as "no
    results" is the defect this field exists to prevent.
    """

    state: str
    anchor: str
    places: list[PlaceRead]
    source: PlaceSourceRead | None
    truncated: bool
    error: str | None


def _place_read(place) -> PlaceRead:
    return PlaceRead(
        provider_id=place.provider_id,
        category=place.category.value,
        name=place.name,
        lat=place.lat,
        lon=place.lon,
        contact=PlaceContactRead(
            phone=place.contact.phone,
            opening_hours=place.contact.opening_hours,
            operator=place.contact.operator,
        ),
        access=PlaceAccessRead(
            hgv=place.access.hgv,
            max_height=place.access.max_height,
            access=place.access.access,
            fee=place.access.fee,
            toilets=place.access.toilets,
            lit=place.access.lit,
        ),
        straight_line_m=place.straight_line_m,
        provider_ids=list(place.provider_ids),
        conflicts={k: list(v) for k, v in place.conflicts.items()},
    )


@router.get(
    "/me/trip/route-risk",
    response_model=RouteRiskRead,
    summary="Deterministic risk for this driver's selected route",
)
async def my_route_risk(driver: CurrentDriver, db: DbSession) -> RouteRiskRead:
    """The same assessment the manager sees, for the driver's own route.

    REUSES `route_risk_service.assess_route` and `risk_read`. A second scoring
    path here would be a second answer to "is this road bad", and the two would
    diverge the first time a constant changed - the manager and the driver must
    be reading one number.

    Subject comes from the token, like every route in this file: there is no
    trip id and no route id in the path, so a driver cannot ask about anybody
    else's corridor. Ownership therefore needs no separate check - the route is
    reached only by walking from the authenticated driver to their current trip
    to that trip's own `selected_route_id`.

    404 with no trip, matching `/me/trip/navigation` and the offline package.

    409 when the trip exists but no route is selected. NOT a 200 with a made-up
    LOW: the whole point of this endpoint is that missing inputs stay missing,
    and an empty assessment rendered as a score is the exact failure mode
    `RouteRiskRead` was shaped to prevent. The app already renders this state.
    """
    trip = await driver_trips.current_trip(db, driver)
    if trip is None:
        raise NotFoundError("You have no trip to assess right now.")
    if trip.selected_route_id is None:
        raise ConflictError(
            "No route has been selected for this trip yet, so there is nothing to assess."
        )

    # In transit, the reroute assessment already scores every live route on
    # the trip - the selected one included - so its figures are reused rather
    # than scored twice, and its outcome is what turns the band into the
    # driver's instruction. Before departure there is nothing to reroute FROM
    # and the instruction follows the band alone.
    if trip.status in driver_trips.IN_PROGRESS_STATUSES:
        assessment, candidates = await reroute_service.assess(db, trip.id)
        selected_id = str(trip.selected_route_id)
        selected = next((c for c in candidates if c.route_id == selected_id), None)
        if selected is not None:
            proposed = next(
                (c for c in candidates if c.route_id == assessment.proposed_route_id),
                None,
            )
            return risk_read(selected.risk, assessment, proposed)

    risk = await route_risk_service.assess_route(db, trip.selected_route_id)
    return risk_read(risk)


def _find_across(
    boxes: list[BoundingBox],
    *,
    category: PlaceCategory,
    anchor: SearchAnchor,
    anchor_lat: float | None,
    anchor_lon: float | None,
    route: list[tuple[float, float]] | None,
    limit: int,
) -> PlaceQueryResult:
    """One answer from several bounded windows: merged, deduplicated, sorted.

    A window that finds nothing is not an error; a window outside coverage is
    only the answer if EVERY window is. The corridor filter still runs against
    the whole route, so a place near the cut between two windows is judged by
    the road, not by which window saw it.
    """
    merged: dict[str, Place] = {}
    states: list[PlaceQueryResult] = []
    for box in boxes:
        part = places.find(
            box=box,
            category=category,
            anchor=anchor,
            anchor_lat=anchor_lat,
            anchor_lon=anchor_lon,
            route=route,
            limit=MAX_RESULTS,
        )
        states.append(part)
        for place in part.places:
            merged.setdefault(place.provider_id, place)
    if not any(s.state is PlacesSourceState.AVAILABLE for s in states):
        return states[0]
    found = list(merged.values())
    if anchor_lat is not None and anchor_lon is not None:
        found.sort(key=lambda p: p.straight_line_m or 0.0)
    capped = min(limit, MAX_RESULTS)
    source = next(s.source for s in states if s.source is not None)
    return PlaceQueryResult(
        state=PlacesSourceState.AVAILABLE,
        places=tuple(found[:capped]),
        source=source,
        anchor=anchor,
        truncated=len(found) > capped or any(s.truncated for s in states),
    )


@router.get(
    "/me/trip/places",
    response_model=PlacesResponse,
    summary="Roadside services near the driver's own trip",
)
async def my_trip_places(
    driver: CurrentDriver,
    db: DbSession,
    category: PlaceCategory,
    south: float | None = None,
    west: float | None = None,
    north: float | None = None,
    east: float | None = None,
    anchor: SearchAnchor = SearchAnchor.MAP_AREA,
    anchor_lat: float | None = None,
    anchor_lon: float | None = None,
    limit: int = 40,
) -> PlacesResponse:
    """Mapped roadside services, scoped to the authenticated driver.

    SERVED FROM A LOCAL SNAPSHOT. No request leaves this process - see
    `app/services/places/snapshot.py` for why the app does not call Overpass at
    runtime. That also makes "changing category issues no external request"
    true by construction.

    BOUNDED. The box is validated on construction (max 5 degrees, no
    inversion) and the result count is capped, so there is no query shape that
    asks for a region.

    `anchor=ROUTE_CORRIDOR` filters to the driver's OWN authorised route, read
    here rather than accepted from the client - a caller cannot pass geometry
    and have services matched against a road they invented. The box is derived
    from that route too, as a chain of windows each inside the bound: the
    phone never has to know the provider's limit, and a 300 km road is never
    one 300 km box.
    """
    route: list[tuple[float, float]] | None = None
    if anchor is SearchAnchor.ROUTE_CORRIDOR:
        trip = await driver_trips.current_trip(db, driver)
        if trip is None or trip.selected_route_id is None:
            raise NotFoundError(
                "You have no selected route to search along right now."
            )
        row = (
            await db.execute(
                select(func.ST_AsText(TripRoute.geometry)).where(
                    TripRoute.id == trip.selected_route_id
                )
            )
        ).first()
        wkt = row[0] if row else None
        route = parse_wkt_linestring(wkt) if wkt else None
        if not route:
            raise NotFoundError("Your selected route has no usable geometry.")
        boxes = corridor_windows(route)
    else:
        if None in (south, west, north, east):
            raise BusinessRuleError("A map area is needed for this search.")
        try:
            boxes = [
                BoundingBox(min_lat=south, min_lon=west, max_lat=north, max_lon=east)
            ]
        except PlaceQueryError as exc:
            # The driver sees a next step, never the provider's bound.
            raise BusinessRuleError(
                "Zoom in to search this area - the map view is too wide."
            ) from exc

    result = _find_across(
        boxes,
        category=category,
        anchor=anchor,
        anchor_lat=anchor_lat,
        anchor_lon=anchor_lon,
        route=route,
        limit=limit,
    )

    source = None
    if result.source is not None:
        counts = places.snapshot_counts()
        source = PlaceSourceRead(
            name=result.source.name,
            attribution=result.source.attribution,
            licence=result.source.licence,
            retrieved_at=result.source.retrieved_at,
            coverage_description=result.source.coverage_description,
            limits=result.source.limits,
            is_live=result.source.is_live,
            raw_records=counts["raw_records"],
            unique_places=counts["unique_places"],
            merged_duplicates=counts["merged_duplicates"],
        )

    return PlacesResponse(
        state=result.state.value,
        anchor=(result.anchor or anchor).value,
        places=[_place_read(p) for p in result.places],
        source=source,
        truncated=result.truncated,
        error=result.error,
    )


@router.post(
    "/me/trip/accept",
    response_model=CurrentTrip,
    summary="Acknowledge the dispatched trip",
)
async def accept_my_trip(
    payload: TripActionRequest,
    driver: CurrentDriver,
    user: CurrentUser,
    db: DbSession,
    ip: ClientIp,
) -> CurrentTrip:
    """The driver accepts the job. This does NOT start travel.

    Subject taken from the token like every other route here, so there is no
    trip id to bend - `payload.trip_id` can only NARROW, and a mismatch is
    refused as a stale screen rather than used to look anything up.

    Idempotent: accepting twice returns the first acceptance unchanged and
    writes one timeline event, so a double tap or a retry after a lost
    response is safe. See `driver_trips.accept` for why this is an
    acknowledgment and not a gate.
    """
    trip = await driver_trips.accept(db, driver, user, trip_id=payload.trip_id, ip=ip)
    return await _trip_view(db, driver, trip)


@router.post(
    "/me/trip/reroute",
    response_model=RerouteProposed,
    status_code=status.HTTP_201_CREATED,
    summary="Plan a road from where the truck is now",
)
async def reroute_my_trip(
    payload: RerouteRequest,
    driver: CurrentDriver,
    user: CurrentUser,
    db: DbSession,
    ip: ClientIp,
) -> RerouteProposed:
    """A driver off the planned road asks for a road from the reported position.

    Plans a real route (turn instructions included) from `payload` to the
    trip's destination and stores it as a PROPOSED EMERGENCY_BACKUP. The trip
    stays on its selected route: eligibility, review authorisation and the
    timeline entry all happen where they already do, in `reroute.accept`, when
    a manager takes the proposal. Until then the phone shows it as the backup
    road. Provider outages surface as 503 and store nothing.
    """
    trip = await driver_trips.current_trip(db, driver)
    if trip is None:
        raise NotFoundError("You have no trip to reroute.")
    if trip.status not in driver_trips.IN_PROGRESS_STATUSES:
        raise ConflictError(
            "A road from your position can only be planned while the trip is under way.",
            code="TRIP_NOT_IN_TRANSIT",
            details={"current": trip.status.value},
        )
    if trip.selected_route_id is None:
        raise ConflictError(
            "This trip has no planned road to reroute from.",
            code="NO_SELECTED_ROUTE",
        )
    result = await route_service.plan(
        db,
        trip.id,
        actor=user,
        ip=ip,
        detailed=True,
        origin=RouteCoordinate(lat=payload.lat, lon=payload.lon),
        kind=RouteKind.EMERGENCY_BACKUP,
    )
    route = result.route
    return RerouteProposed(
        route_id=route.id,
        kind=route.kind,
        distance_km=float(route.distance_km) if route.distance_km is not None else None,
        estimated_duration_min=route.estimated_duration_min,
        provider=result.provider,
        has_guidance=route.maneuvers is not None,
    )


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


class DriverCheckInRequest(APIModel):
    response: DriverCheckResponse
    trip_id: uuid.UUID | None = None


@router.post(
    "/me/trip/check-in",
    response_model=EmergencyRead,
    summary="Submit driver check-in response for an active safety emergency",
)
async def submit_driver_check_in(
    payload: DriverCheckInRequest,
    driver: CurrentDriver,
    db: DbSession,
) -> EmergencyRead:
    """Process driver safety check-in.

    Driver confirms their status (e.g. I_AM_SAFE, TRAFFIC, NEED_HELP).
    Selecting NEED_HELP immediately escalates the emergency to SOS_ESCALATED
    with frozen snapshot briefing and moves the trip to INCIDENT status.
    """
    trip = await driver_trips.current_trip(db, driver)
    if trip is None:
        raise NotFoundError("You have no active trip.")

    if payload.trip_id is not None and payload.trip_id != trip.id:
        raise ConflictError(
            "That check-in is for a different trip.",
            code="TRIP_SUPERSEDED",
            details={"current_trip_id": str(trip.id)},
        )

    emergency = await sentinel.record_driver_check_in(
        db, driver, trip.id, payload.response
    )
    return EmergencyRead.model_validate(emergency)


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

    if trip.status not in trip_state.COLLECTS_TELEMETRY:
        raise ConflictError(
            "Location is only collected while a trip is under way.",
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


@router.post(
    "/me/trip/events",
    response_model=DeviceEventBatchAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Replay events the phone recorded, including while it was offline",
)
async def submit_trip_events(
    payload: DeviceEventBatchIn,
    driver: CurrentDriver,
    db: DbSession,
) -> DeviceEventBatchAccepted:
    """Ingest a batch of device-originated events for the driver's own trip.

    The other half of surviving an outage. GPS says where the truck was;
    this says what happened - it left the corridor, the driver acknowledged a
    warning, the driver pressed SOS, the connection went and came back - for
    the stretch when none of it could be reported at the time.

    202, not 201, and for the same reason `POST /me/location` is: the batch is
    accepted for processing and the response reports per-event dispositions
    rather than pretending each one created a resource.

    SAFE TO SEND TWICE. The server deduplicates on `(trip_id,
    device_event_id)`, and every side effect is bound to a row actually having
    been inserted, so a replayed SOS is counted in `duplicates_ignored` instead
    of opening a second emergency. `settled_event_ids` names exactly what the
    device may now delete; anything absent from it is retried rather than lost.

    Bound to an in-progress trip, enforced here rather than in the app, exactly
    as location collection is (docs/SECURITY.md section 3). An event for a trip
    that has ended is refused rather than appended to a closed timeline.
    """
    trip = await driver_trips.current_trip(db, driver)
    if trip is None:
        raise NotFoundError("You have no trip to report events for.")

    if payload.trip_id is not None and payload.trip_id != trip.id:
        raise ConflictError(
            "Those events are for a different trip.",
            code="TRIP_SUPERSEDED",
            details={"current_trip_id": str(trip.id)},
        )

    if trip.status not in trip_state.COLLECTS_TELEMETRY:
        raise ConflictError(
            "Events are only recorded while a trip is under way.",
            code="TRIP_NOT_IN_PROGRESS",
            details={"current": trip.status.value},
        )

    result = await device_events.ingest(
        db, trip=trip, driver=driver, events=payload.events
    )
    return DeviceEventBatchAccepted(
        trip_id=trip.id,
        accepted=result.accepted,
        duplicates_ignored=result.duplicates_ignored,
        rejected=result.rejected,
        rejected_reasons=result.rejected_reasons,
        settled_event_ids=result.settled,
        server_time=datetime.now(UTC),
    )
