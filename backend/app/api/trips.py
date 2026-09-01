"""Manager endpoints for shipments, trips and fleet location.

Routes stay thin: validate, authorize, delegate, serialise. Every route declares
the permission it needs and none inspects `user.role`.

Location reads are gated on their own permission (`fleet:location_read`) rather
than on `trip:read`. Where a truck is, is the most sensitive operational data
the system holds, and a role that should see trip progress without seeing a
driver's position must be expressible without editing every route.
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel

from app.api.deps import DbSession, get_client_ip, require_permission
from app.core import permissions as perm
from app.core.errors import PermissionDeniedError
from app.core.permissions import has_permission
from app.domain import telemetry_policy as policy
from app.domain.routing import parse_wkt_linestring
from app.models.enums import (
    CargoPriority,
    RouteKind,
    RouteState,
    TripStatus,
    TripStopKind,
    TripStopStatus,
)
from app.models.identity import User
from app.schemas.common import Coordinate, ReadModel
from app.schemas.domain import (
    ShipmentCreate,
    ShipmentRead,
    TripCreate,
    TripPlanCreate,
    TripRead,
)
from app.services import route_risk as route_risk_service
from app.services import routes as route_service
from app.services import shipments as shipment_service
from app.services import telemetry
from app.services import trips as trip_service

ClientIp = Annotated[str | None, Depends(get_client_ip)]
Limit = Annotated[int | None, Query(ge=1, le=100)]


# --- Shipments ------------------------------------------------------------

shipments_router = APIRouter(prefix="/api/shipments", tags=["shipments"])


class ShipmentPage(BaseModel):
    items: list[ShipmentRead]
    next_cursor: str | None = None


@shipments_router.get("", response_model=ShipmentPage, summary="List shipments")
async def list_shipments(
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.SHIPMENT_READ))],
    limit: Limit = None,
    cursor: str | None = None,
) -> ShipmentPage:
    rows, next_cursor = await shipment_service.list_shipments(
        db, limit=limit, cursor=cursor
    )
    return ShipmentPage(
        items=[ShipmentRead.model_validate(r) for r in rows], next_cursor=next_cursor
    )


@shipments_router.post(
    "",
    response_model=ShipmentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a shipment",
)
async def create_shipment(
    payload: ShipmentCreate,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.SHIPMENT_CREATE))],
    ip: ClientIp,
) -> ShipmentRead:
    """`total_weight_kg` is absent from the request by design.

    It is derived from cargo_items by a database trigger, and it is the number
    the capacity gate is measured against. A client-declared weight could
    disagree with the actual cargo and walk a truck past its safety limit.
    """
    return ShipmentRead.model_validate(
        await shipment_service.create(db, payload, actor=actor, ip=ip)
    )


# --- Trips ----------------------------------------------------------------

trips_router = APIRouter(prefix="/api/trips", tags=["trips"])


class TripPage(BaseModel):
    items: list[TripRead]
    next_cursor: str | None = None


class TripStopRead(ReadModel):
    id: uuid.UUID
    sequence: int
    kind: TripStopKind
    status: TripStopStatus
    name: str | None
    address: str | None
    planned_arrival_at: datetime | None
    actual_arrival_at: datetime | None
    actual_departure_at: datetime | None


class ShipmentSummary(ReadModel):
    """What is on the truck, for an operations screen.

    Carried on trip detail rather than behind a separate shipment lookup: a
    dispatcher asking "what is this truck carrying" is asking about the trip,
    and a second round trip for four fields would be a redundant API.

    `total_weight_kg` is derived by the database from cargo_items and is the
    number the capacity gate was measured against - so this is the load that was
    actually authorised, not a restatement of it.
    """

    id: uuid.UUID
    reference_code: str
    client_name: str
    total_weight_kg: Decimal
    priority: CargoPriority


class TripDetail(TripRead):
    stops: list[TripStopRead]
    shipment: ShipmentSummary


@trips_router.get("", response_model=TripPage, summary="List trips")
async def list_trips(
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.TRIP_READ))],
    limit: Limit = None,
    cursor: str | None = None,
    trip_status: TripStatus | None = None,
) -> TripPage:
    rows, next_cursor = await trip_service.list_trips(
        db, limit=limit, cursor=cursor, status=trip_status
    )
    return TripPage(
        items=[TripRead.model_validate(r) for r in rows], next_cursor=next_cursor
    )


@trips_router.post(
    "",
    response_model=TripRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a trip",
)
async def create_trip(
    payload: TripCreate,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.TRIP_CREATE))],
    ip: ClientIp,
) -> TripRead:
    """Creates in DRAFT. Dispatch is a separate, gated step.

    `status` is absent from TripCreate: letting a client choose the initial
    status would let it skip the capacity and assignment gates that guard the
    path into ACTIVE.
    """
    return TripRead.model_validate(
        await trip_service.create(db, payload, actor=actor, ip=ip)
    )


@trips_router.post(
    "/plan",
    response_model=TripRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a shipment and its trip atomically",
)
async def plan_trip(
    payload: TripPlanCreate,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.TRIP_CREATE))],
    ip: ClientIp,
) -> TripRead:
    """Plan a shipment and its trip in ONE transaction, or neither.

    Registered above `/{trip_id}` so the literal path is matched first.

    Planning is one decision that happens to touch two tables. As two committed
    calls it is not atomic: the shipment commits, the capacity gate then refuses
    the trip, and a cargo record no trip explains stays behind - one more on
    every retry, because each attempt mints a fresh reference code. The refusal
    it fails on is the one the UI advertises, so managers meet it routinely.

    Requires BOTH shipment:create and trip:create. The route declares
    trip:create and the second is asserted below rather than by a second
    dependency, because FastAPI would otherwise resolve two independent gates
    whose failure order is not obvious from the signature.
    """
    if not has_permission(actor.role, perm.SHIPMENT_CREATE):
        raise PermissionDeniedError(
            "You do not have permission to perform this action.",
            details={"required_permission": perm.SHIPMENT_CREATE},
        )
    return TripRead.model_validate(
        await trip_service.plan(
            db,
            shipment_payload=payload.shipment,
            trip_payload=payload.trip,
            actor=actor,
            ip=ip,
        )
    )


@trips_router.get("/{trip_id}", response_model=TripDetail, summary="Get a trip")
async def get_trip(
    trip_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.TRIP_READ))],
) -> TripDetail:
    trip = await trip_service.get(db, trip_id)
    stops = await trip_service.stops_for(db, trip_id)
    shipment = await shipment_service.get(db, trip.shipment_id)
    return TripDetail(
        **TripRead.model_validate(trip).model_dump(),
        stops=[TripStopRead.model_validate(s) for s in stops],
        shipment=ShipmentSummary.model_validate(shipment),
    )


@trips_router.post(
    "/{trip_id}/dispatch", response_model=TripRead, summary="Dispatch a trip"
)
async def dispatch_trip(
    trip_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.TRIP_DISPATCH))],
    ip: ClientIp,
) -> TripRead:
    """DRAFT -> ASSIGNED. Every gate is re-checked at this moment.

    A licence can lapse, a truck can break down, and a driver/truck assignment
    can be ended between planning a trip and dispatching it.
    """
    return TripRead.model_validate(
        await trip_service.dispatch(db, trip_id, actor=actor, ip=ip)
    )


@trips_router.post(
    "/{trip_id}/cancel", response_model=TripRead, summary="Cancel a trip"
)
async def cancel_trip(
    trip_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.TRIP_CANCEL))],
    ip: ClientIp,
    reason: Annotated[str | None, Query(max_length=200)] = None,
) -> TripRead:
    return TripRead.model_validate(
        await trip_service.cancel(db, trip_id, actor=actor, reason=reason, ip=ip)
    )


@trips_router.post(
    "/{trip_id}/close", response_model=TripRead, summary="Close a delivered trip"
)
async def close_trip(
    trip_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.TRIP_CLOSE))],
    ip: ClientIp,
) -> TripRead:
    return TripRead.model_validate(
        await trip_service.close(db, trip_id, actor=actor, ip=ip)
    )


# --- Routes ---------------------------------------------------------------


class TripRouteRead(ReadModel):
    """One planned route.

    `estimated_fuel_litres` is absent from this contract entirely rather than
    returned as null, because no fuel model exists and a field that is always
    null invites a client to render `0`. It appears when there is something to
    put in it - see docs/AI_MODELS.md section 0.

    `estimated_duration_min` is the provider's free-flow travel time. It is NOT
    an ETA: no departure time, traffic or stop dwell is accounted for, and the
    UI must not present it as an arrival time.
    """

    id: uuid.UUID
    kind: RouteKind
    state: RouteState
    distance_km: Decimal | None
    estimated_duration_min: int | None
    routing_provider: str | None
    created_at: datetime
    #: [[lat, lon], ...] in travel order, ready for the map.
    geometry: list[list[float]]


class RiskComponentRead(ReadModel):
    """One named contribution to a route's risk score."""

    code: str
    label: str
    points: int
    detail: str


class RouteRiskRead(ReadModel):
    """A route's risk, with its evidence AND its gaps.

    `score` alone would be dishonest. A dispatcher shown a bare number assumes
    it is complete; `inputs` and `unavailable` say which datasets went into it
    and which do not exist, so a partial answer reads as partial.

    This is a deterministic weighted rule with published constants
    (app/domain/route_risk.py), NOT a model. There is deliberately no
    `confidence` or `model_version` field, because either would imply training
    and validation that have not happened.

    `reason_codes` are codes rather than sentences so the driver app can render
    them in Hindi or Assamese from local translation files - a sentence built
    here would arrive on the phone untranslatable.
    """

    score: int
    band: str
    components: list[RiskComponentRead]
    #: factor name -> "AVAILABLE" / "NOT_AVAILABLE"
    inputs: dict[str, str]
    unavailable: list[str]
    reason_codes: list[str]
    observations_used: int
    observations_stale: int
    assessed_at: datetime


class RoutePlanResult(ReadModel):
    route: TripRouteRead
    #: Which provider answered, and whether the primary had to be skipped. A
    #: manager looking at a fallback route will ask both.
    provider: str
    used_fallback: bool
    providers_attempted: list[str]
    #: True when a genuinely different corridor was also stored as
    #: EMERGENCY_BACKUP. False on a single-road corridor, which is ordinary.
    backup_planned: bool


def _route_read(row, geometry_wkt: str) -> TripRouteRead:
    # WKT is lon-lat; the API speaks lat-lon everywhere else. The swap lives in
    # `parse_wkt_linestring` next to its inverse `to_wkt`, so there is exactly
    # one place to check the ordering rather than a second copy here.
    points = [[lat, lon] for lat, lon in parse_wkt_linestring(geometry_wkt)]
    return TripRouteRead(
        id=row.id,
        kind=row.kind,
        state=row.state,
        distance_km=row.distance_km,
        estimated_duration_min=row.estimated_duration_min,
        routing_provider=row.routing_provider,
        created_at=row.created_at,
        geometry=points,
    )


@trips_router.get(
    "/{trip_id}/routes",
    response_model=list[TripRouteRead],
    summary="Routes planned for a trip",
)
async def list_routes(
    trip_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.ROUTE_READ))],
) -> list[TripRouteRead]:
    """Newest first, including SUPERSEDED rows.

    History is included deliberately: what a driver was previously told to do is
    evidence in an incident review, and hiding it here would make the API look
    like rerouting overwrites.
    """
    await trip_service.get(db, trip_id)  # 404 before disclosing anything
    rows = await route_service.list_for_trip(db, trip_id)
    return [_route_read(r, await route_service.geometry_wkt(db, r.id)) for r in rows]


@trips_router.post(
    "/{trip_id}/routes/recalculate",
    response_model=RoutePlanResult,
    status_code=status.HTTP_201_CREATED,
    summary="Plan a route for a trip",
)
async def recalculate_route(
    trip_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.ROUTE_PLAN))],
    ip: ClientIp,
) -> RoutePlanResult:
    """Insert a new route and supersede the previous one. Never an update.

    Errors follow docs/API_CONTRACTS.md section 9:
      503 ROUTING_UNAVAILABLE - every provider is unreachable; retrying may work
      422 NO_VIABLE_ROUTE     - a provider answered and no route exists
    Those are different answers and must stay distinguishable to the manager.
    """
    result = await route_service.plan(db, trip_id, actor=actor, ip=ip)
    return RoutePlanResult(
        route=_route_read(
            result.route, await route_service.geometry_wkt(db, result.route.id)
        ),
        provider=result.provider,
        used_fallback=result.used_fallback,
        providers_attempted=list(result.attempted),
        backup_planned=result.backup_planned,
    )


@trips_router.post(
    "/{trip_id}/routes/{route_id}/select",
    response_model=TripRouteRead,
    summary="Select one of a trip's routes",
)
async def select_route(
    trip_id: uuid.UUID,
    route_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.ROUTE_SELECT))],
    ip: ClientIp,
) -> TripRouteRead:
    """`route_id` is scoped by `trip_id`, so another trip's route is a 404."""
    row = await route_service.select_route(
        db, trip_id, route_id, actor=actor, ip=ip
    )
    return _route_read(row, await route_service.geometry_wkt(db, row.id))


@trips_router.get(
    "/{trip_id}/routes/{route_id}/risk",
    response_model=RouteRiskRead,
    summary="Assess a route against current conditions",
)
async def route_risk(
    trip_id: uuid.UUID,
    route_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.ROUTE_READ))],
) -> RouteRiskRead:
    """Weather sampled along the route, scored by a deterministic rule.

    Read-only and NOT persisted. A risk score is a statement about *now*;
    storing one would leave a number that looks current long after it stopped
    being true, which is the same failure as a stale GPS fix rendered as LIVE.

    A weather outage does not fail this request. The assessment returns with
    `inputs.weather = NOT_AVAILABLE` and a `WEATHER_UNAVAILABLE` reason code,
    because distance and duration are still real evidence and showing nothing
    at all would be a worse answer than showing a partial one.
    """
    await trip_service.get(db, trip_id)  # 404 before disclosing anything
    await route_service.ensure_belongs_to_trip(db, trip_id, route_id)

    risk = await route_risk_service.assess_route(db, route_id)
    return RouteRiskRead(
        score=risk.score,
        band=risk.band,
        components=[
            RiskComponentRead(
                code=c.code, label=c.label, points=c.points, detail=c.detail
            )
            for c in risk.components
        ],
        inputs=risk.inputs,
        unavailable=list(risk.unavailable),
        reason_codes=list(risk.reason_codes),
        observations_used=risk.observations_used,
        observations_stale=risk.observations_stale,
        assessed_at=risk.assessed_at,
    )


# --- Location -------------------------------------------------------------


class PositionRead(ReadModel):
    """One observation.

    Both timestamps are present and they are not interchangeable. `recorded_at`
    is the device clock - when the truck was there. `received_at` is the server
    clock, and `age_seconds` is measured from it, so a phone with a wrong or
    manipulated clock cannot make an old position look current.
    """

    location: Coordinate
    recorded_at: datetime
    received_at: datetime
    age_seconds: float
    freshness: str
    speed_kmph: float | None
    heading_deg: float | None
    accuracy_m: float | None
    #: Reported by Android. Surfaced, never used to auto-reject a fix.
    is_mock_location: bool


class TrackRead(ReadModel):
    trip_id: uuid.UUID
    points: list[PositionRead]
    #: True when the cap was hit and older points exist. Page with `since`.
    truncated: bool


class FleetTripRead(ReadModel):
    trip_id: uuid.UUID
    trip_code: str
    trip_status: TripStatus
    driver_id: uuid.UUID
    driver_name: str
    truck_id: uuid.UUID
    registration_number: str
    started_at: datetime | None
    #: Null when no fix has ever been received. Distinct from a stale one.
    position: PositionRead | None
    freshness: str
    next_stop_sequence: int | None
    next_stop_name: str | None
    stops_done: int
    stops_total: int


class FleetRead(ReadModel):
    trips: list[FleetTripRead]
    #: The threshold behind the freshness labels, so the UI never invents one.
    fresh_seconds: int
    stale_seconds: int
    server_time: datetime


def _position_read(position: telemetry.Position | None) -> PositionRead | None:
    if position is None:
        return None
    return PositionRead(
        location=Coordinate(lat=position.lat, lon=position.lon),
        recorded_at=position.recorded_at,
        received_at=position.received_at,
        age_seconds=position.age_seconds(),
        freshness=position.freshness,
        speed_kmph=position.speed_kmph,
        heading_deg=position.heading_deg,
        accuracy_m=position.accuracy_m,
        is_mock_location=position.is_mock_location,
    )


fleet_router = APIRouter(prefix="/api/fleet", tags=["fleet"])


@fleet_router.get(
    "/active", response_model=FleetRead, summary="Trips currently on the road"
)
async def active_fleet(
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.FLEET_LOCATION_READ))],
    limit: Limit = None,
) -> FleetRead:
    """Every in-transit trip with its last known position and freshness.

    The freshness label is computed server-side and the threshold behind it is
    returned alongside. A client that decided for itself what "live" meant would
    eventually disagree with the server, and a dispatcher would be acting on a
    green dot that the system does not consider current.
    """
    rows = await telemetry.active_fleet(db, limit=limit or 100)
    return FleetRead(
        trips=[
            FleetTripRead(
                trip_id=row.trip_id,
                trip_code=row.trip_code,
                trip_status=row.trip_status,
                driver_id=row.driver_id,
                driver_name=row.driver_name,
                truck_id=row.truck_id,
                registration_number=row.registration_number,
                started_at=row.started_at,
                position=_position_read(row.position),
                freshness=row.freshness,
                next_stop_sequence=row.next_stop_sequence,
                next_stop_name=row.next_stop_name,
                stops_done=row.stops_done,
                stops_total=row.stops_total,
            )
            for row in rows
        ],
        fresh_seconds=policy.LOCATION_FRESH_SECONDS,
        stale_seconds=policy.LOCATION_STALE_SECONDS,
        server_time=datetime.now(UTC),
    )


@trips_router.get(
    "/{trip_id}/track", response_model=TrackRead, summary="Recent track for a trip"
)
async def trip_track(
    trip_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.FLEET_LOCATION_READ))],
    limit: Annotated[int, Query(ge=1, le=1000)] = 500,
    since: datetime | None = None,
) -> TrackRead:
    """A bounded window of a trip's track, newest first.

    There is deliberately no all-history mode. An unrestricted GPS dump turns an
    authorised "where is this truck" read into a complete movement profile of a
    person - see docs/SECURITY.md section 3. Callers page backwards with
    `since` instead.
    """
    await trip_service.get(db, trip_id)  # 404 before disclosing anything

    # Over-fetch by one to answer `truncated` honestly. Reporting
    # `len(points) == limit` would claim truncation for a trip whose track is
    # exactly `limit` points long - telling a manager that history is being
    # withheld when all of it is on screen.
    points = await telemetry.track(db, trip_id, limit=limit + 1, since=since)
    truncated = len(points) > limit

    return TrackRead(
        trip_id=trip_id,
        points=[
            p
            for p in (_position_read(p) for p in points[:limit])
            if p is not None
        ],
        truncated=truncated,
    )
