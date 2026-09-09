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
from pydantic import BaseModel, Field

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
from app.schemas.common import APIModel, Coordinate, ReadModel
from app.schemas.domain import (
    ShipmentCreate,
    ShipmentRead,
    TripCreate,
    TripPlanCreate,
    TripRead,
)
from app.services import reroute as reroute_service
from app.services import route_recommendation as route_recommendation_service
from app.services import route_review as review_service
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
    #: Whether this is the route the trip is ACTUALLY following, i.e. the row
    #: `trips.selected_route_id` points at.
    #:
    #: Server-computed, and not the same question as `state == SELECTED`
    #: (LS-10). A client that infers "current" from the lifecycle state gets it
    #: wrong for any trip whose assignment was retired by a planning request
    #: before that was fixed: those rows are still the trip's selection while
    #: reading SUPERSEDED. The trip row is the authority on what is current, so
    #: the answer comes from there rather than from each client's guess.
    is_current: bool = False


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


class RouteComparisonRead(ReadModel):
    """One route as the recommendation weighed it.

    Absolute figures, not deltas. The deltas live on `tradeoff`, once, against
    the baseline; repeating them per candidate is how two numbers that should
    agree come to disagree after a refactor.
    """

    route_id: uuid.UUID
    kind: RouteKind
    distance_km: float | None
    #: Typed to match `TripRouteRead`, which describes the same column. Two
    #: schemas rendering one integer column differently is how a UI comes to
    #: show "221" on one screen and "221.0" on another.
    estimated_duration_min: int | None
    risk: RouteRiskRead
    #: ELIGIBLE / REQUIRES_REVIEW / REJECTED / NOT_ASSESSED, derived server-side
    #: from this candidate's own hazard evidence.
    #:
    #: Sent explicitly (LS-10) so a chooser does not have to re-derive it by
    #: pattern-matching reason codes. That derivation is the eligibility rule,
    #: and a client that owns a copy of it is a client asserting its own
    #: eligibility - the exact thing `eligibility_for_route` exists to prevent.
    #: `risk.reason_codes` still carries WHY; this says WHAT.
    eligibility: str


class RouteTradeoffRead(ReadModel):
    """What the recommendation costs against the baseline, in real units.

    Signs are from the baseline's point of view: positive duration means the
    recommendation takes longer, negative risk means it is safer.

    There is deliberately no percentage. "33 points lower" is checkable against
    the components that produced it; "54% safer" is a claim about probability
    of harm, and nothing in this system measures that.

    `None` means the underlying estimate was absent. It is never rendered as
    zero - a route with no duration estimate is not an instant one.
    """

    duration_delta_min: float | None
    distance_delta_km: float | None
    risk_delta_points: int


class RouteRecommendationRead(ReadModel):
    """Which route to take, why, and what the answer could not see.

    Explainable Route Recommendation V1: a published comparison rule over
    deterministic inputs (app/domain/route_recommendation.py). NOT a model.
    There is no `confidence` and no `model_version`, for the same reason
    `RouteRiskRead` has none.

    `comparable` is the field to read first. False means the answer does not
    rest on a like-for-like comparison - either there was only one route, or
    the candidates were scored from different evidence and comparing their
    scores would measure the gap in what we know rather than a difference
    between the roads. A single-road corridor returning one route is a truthful
    answer, not a degraded one, and no backup is invented to fill the space.
    """

    recommended_route_id: uuid.UUID | None
    baseline_route_id: uuid.UUID | None
    comparable: bool
    reason_codes: list[str]
    tradeoff: RouteTradeoffRead | None
    candidates: list[RouteComparisonRead]
    #: Every factor missing from any candidate, so a partial answer reads as
    #: partial rather than as a complete one.
    unavailable_inputs: list[str]
    #: The published margin the decision used, in risk points.
    margin_points: int
    version: str


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


def _route_read(
    row, geometry_wkt: str, *, current_route_id: uuid.UUID | None = None
) -> TripRouteRead:
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
        is_current=current_route_id is not None and row.id == current_route_id,
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
    trip = await trip_service.get(db, trip_id)  # 404 before disclosing anything
    rows = await route_service.list_for_trip(db, trip_id)
    return [
        _route_read(
            r,
            await route_service.geometry_wkt(db, r.id),
            current_route_id=trip.selected_route_id,
        )
        for r in rows
    ]


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
    detailed: Annotated[
        bool,
        Query(
            description=(
                "Ask the provider for full geometry and turn-by-turn steps in "
                "the same response, so the new candidate can drive navigation."
            )
        ),
    ] = False,
) -> RoutePlanResult:
    """Insert a new route and supersede the previous one. Never an update.

    `detailed` is OFF by default, and the default is a cost decision rather
    than an oversight: full geometry plus steps is a far larger provider
    response than the simplified overview a planning screen needs, and most
    plans are comparisons that are never driven. A route meant to be navigated
    is planned with `detailed=true`, which stores the maneuvers alongside the
    geometry they describe.

    The two arrive TOGETHER, from one provider response, which is the property
    that matters: it is what makes it impossible for a route to end up carrying
    directions for a different road.

    Planning does not select. A detailed candidate is a candidate - it goes
    through the same assessment and acceptance as any other before a driver
    follows it.

    Errors follow docs/API_CONTRACTS.md section 9:
      503 ROUTING_UNAVAILABLE - every provider is unreachable; retrying may work
      422 NO_VIABLE_ROUTE     - a provider answered and no route exists
    Those are different answers and must stay distinguishable to the manager.
    """
    result = await route_service.plan(
        db, trip_id, actor=actor, ip=ip, detailed=detailed
    )
    # Read back rather than assuming. Planning does not select (LS-10), so this
    # is False today - but stating it from the trip row means the contract stays
    # honest if that ever changes, instead of hard-coding a fact about a
    # different function.
    trip = await trip_service.get(db, trip_id)
    return RoutePlanResult(
        route=_route_read(
            result.route,
            await route_service.geometry_wkt(db, result.route.id),
            current_route_id=trip.selected_route_id,
        ),
        provider=result.provider,
        used_fallback=result.used_fallback,
        providers_attempted=list(result.attempted),
        backup_planned=result.backup_planned,
    )


class ReviewAuthorizationRequest(APIModel):
    """A reviewer accepting incomplete hazard evidence for one selection.

    `rationale` is the ONLY field. Everything that is bound - the trip, the
    route, the evidence digest and snapshot, the policy and evidence versions,
    the basis, the issue and expiry times - is computed server-side from the
    route's own assessment. There is deliberately no field by which a client
    could assert what it is authorising, which is the same rule
    `eligibility_for_route` follows.
    """

    rationale: Annotated[str, Field(min_length=20, max_length=2000)]


class ReviewAuthorizationRead(ReadModel):
    """An issued authorisation, as the manager and reviewer screens show it.

    Note what is NOT here: any statement that the route is safe. The evidence
    snapshot is reported exactly as assessed, and the route continues to report
    UNKNOWN to every other endpoint after this is consumed.
    """

    id: uuid.UUID
    trip_id: uuid.UUID
    route_id: uuid.UUID
    basis: str
    rationale: str
    reviewer_user_id: uuid.UUID
    issued_at: datetime
    expires_at: datetime
    consumed_at: datetime | None
    revoked_at: datetime | None
    policy_version: str
    evidence_version: str
    #: The assessment as the reviewer saw it. Incomplete evidence, shown as
    #: incomplete.
    evidence_snapshot: dict


def _review_read(row) -> ReviewAuthorizationRead:
    return ReviewAuthorizationRead(
        id=row.id,
        trip_id=row.trip_id,
        route_id=row.route_id,
        basis=row.basis.value,
        rationale=row.rationale,
        reviewer_user_id=row.reviewer_user_id,
        issued_at=row.issued_at,
        expires_at=row.expires_at,
        consumed_at=row.consumed_at,
        revoked_at=row.revoked_at,
        policy_version=row.policy_version,
        evidence_version=row.evidence_version,
        evidence_snapshot=row.evidence_snapshot,
    )


@trips_router.get(
    "/{trip_id}/routes/{route_id}/review-authorization",
    response_model=ReviewAuthorizationRead | None,
    summary="The live review authorisation for a route, if any",
)
async def get_review_authorization(
    trip_id: uuid.UUID,
    route_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.ROUTE_READ))],
) -> ReviewAuthorizationRead | None:
    """Null when none exists. An expired one is still returned, so a screen can
    say "this expired" rather than showing nothing - which looks identical to
    never having been reviewed."""
    await trip_service.get(db, trip_id)
    await route_service.ensure_belongs_to_trip(db, trip_id, route_id)
    row = await review_service.live_for_route(db, trip_id, route_id)
    return _review_read(row) if row is not None else None


@trips_router.post(
    "/{trip_id}/routes/{route_id}/review-authorization",
    response_model=ReviewAuthorizationRead,
    status_code=status.HTTP_201_CREATED,
    summary="Authorise one selection of a route with incomplete hazard evidence",
)
async def create_review_authorization(
    trip_id: uuid.UUID,
    route_id: uuid.UUID,
    payload: ReviewAuthorizationRequest,
    db: DbSession,
    actor: Annotated[
        User, Depends(require_permission(perm.ROUTE_REVIEW_AUTHORIZE))
    ],
    ip: ClientIp,
) -> ReviewAuthorizationRead:
    """A named person accepts THIS evidence for ONE selection of THIS route.

    Refuses 422 when the route is REJECTED (a closed road is not reviewable),
    NOT_ASSESSED (an integration failure to fix, not uncertainty to approve),
    already ELIGIBLE (nothing to authorise), or its evidence is of a kind the
    approved policy does not permit - today, anything other than UNKNOWN.

    This does NOT change the assessment. The route still reports UNKNOWN
    afterwards and every screen still says the evidence is incomplete.
    """
    await trip_service.get(db, trip_id)
    await route_service.ensure_belongs_to_trip(db, trip_id, route_id)

    decision, assessment = (
        await route_risk_service.eligibility_and_evidence_for_route(db, route_id)
    )
    route_state = await route_service.state_of(db, route_id)
    row = await review_service.issue(
        db,
        trip_id,
        route_id,
        reviewer=actor,
        rationale=payload.rationale,
        decision=decision,
        assessment=assessment,
        route_state=route_state,
        ip=ip,
    )
    return _review_read(row)


@trips_router.delete(
    "/{trip_id}/routes/{route_id}/review-authorization/{authorization_id}",
    response_model=ReviewAuthorizationRead,
    summary="Revoke an unspent review authorisation",
)
async def revoke_review_authorization(
    trip_id: uuid.UUID,
    route_id: uuid.UUID,
    authorization_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[
        User, Depends(require_permission(perm.ROUTE_REVIEW_AUTHORIZE))
    ],
    ip: ClientIp,
) -> ReviewAuthorizationRead:
    """Withdraw it before it is used. A consumed one cannot be revoked."""
    await trip_service.get(db, trip_id)
    await route_service.ensure_belongs_to_trip(db, trip_id, route_id)
    row = await review_service.revoke(
        db, authorization_id, actor=actor, reason="revoked by reviewer", ip=ip
    )
    return _review_read(row)


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
    authorization_id: uuid.UUID | None = None,
) -> TripRouteRead:
    """`route_id` is scoped by `trip_id`, so another trip's route is a 404.

    `authorization_id` is optional and only ever RELAXES REQUIRES_REVIEW, never
    REJECTED or NOT_ASSESSED. It is validated and spent server-side against the
    live evidence, inside this selection's own transaction - presenting an id
    asserts nothing.
    """
    row = await route_service.select_route(
        db,
        trip_id,
        route_id,
        actor=actor,
        ip=ip,
        authorization_id=authorization_id,
    )
    # This call is what made it current, so it is current by construction.
    return _route_read(
        row, await route_service.geometry_wkt(db, row.id), current_route_id=row.id
    )


def risk_read(risk) -> RouteRiskRead:
    """RouteRisk -> wire. One implementation, so the standalone risk endpoint,
    the per-candidate blocks inside a recommendation and the driver's offline
    package can never drift into describing the same score three different
    ways.

    Public rather than underscored because `app/api/driver.py` uses it too: a
    helper shared across routers is not a private one, and importing a private
    name across modules is how a refactor quietly breaks a caller it could not
    see.
    """
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

    return risk_read(await route_risk_service.assess_route(db, route_id))


def _as_uuid(value: str | None) -> uuid.UUID | None:
    """Domain layers carry route ids as strings; the wire carries UUIDs."""
    return uuid.UUID(value) if value else None


def _recommendation_read(result, candidates) -> RouteRecommendationRead:
    """Recommendation -> wire. Shared by the planning endpoint and the reroute
    assessment, so a proposal and a recommendation cannot come to describe the
    same comparison in two different shapes."""
    return RouteRecommendationRead(
        recommended_route_id=_as_uuid(result.recommended_route_id),
        baseline_route_id=_as_uuid(result.baseline_route_id),
        comparable=result.comparable,
        reason_codes=list(result.reason_codes),
        tradeoff=(
            RouteTradeoffRead(
                duration_delta_min=result.tradeoff.duration_delta_min,
                distance_delta_km=result.tradeoff.distance_delta_km,
                risk_delta_points=result.tradeoff.risk_delta_points,
            )
            if result.tradeoff is not None
            else None
        ),
        candidates=[
            RouteComparisonRead(
                route_id=uuid.UUID(c.route_id),
                kind=RouteKind(c.kind),
                distance_km=c.distance_km,
                estimated_duration_min=c.duration_min,
                risk=risk_read(c.risk),
                # `decision` DERIVES this from the risk the candidate already
                # carries - see RouteCandidate.decision on why it is not an
                # argument anybody can forget to pass.
                eligibility=c.decision.eligibility.value,
            )
            for c in candidates
        ],
        unavailable_inputs=list(result.unavailable_inputs),
        margin_points=result.margin_points,
        version=result.version,
    )


@trips_router.get(
    "/{trip_id}/routes/recommendation",
    response_model=RouteRecommendationRead,
    summary="Compare this trip's live routes and advise one",
)
async def route_recommendation(
    trip_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.ROUTE_READ))],
) -> RouteRecommendationRead:
    """Every live route scored against current conditions, then compared.

    Read-only and NOT persisted, for the same reason the risk endpoint is not:
    advice built on this hour's weather must not still be on screen next hour
    looking current. It is a considered read, not a feed - each call costs up
    to ten requests to a free weather service, so a client must not poll it.

    The route that would be taken anyway is the baseline, and a switch is
    advised only when the alternative is lower risk by a published margin. A
    smaller gap is noise on inputs this coarse, and a detour is not free.

    Superseded and blocked routes are excluded: history is evidence, but advice
    is about what to do next.
    """
    await trip_service.get(db, trip_id)  # 404 before disclosing anything

    result, candidates = await route_recommendation_service.recommend_for_trip(
        db, trip_id
    )
    return _recommendation_read(result, candidates)



class RerouteAssessmentRead(ReadModel):
    """Whether anything should be raised about the road a truck is on.

    Three outcomes, and `ALERT_ONLY` is the one to read first:

        NO_ACTION     nothing to say
        ALERT_ONLY    the road has deteriorated and there is NOTHING better
        PROPOSE       the road has deteriorated and a better one exists

    `ALERT_ONLY` exists because much of the North East is a single corridor.
    A system that can only propose alternatives falls silent in exactly the
    situation that matters most; saying "this road is bad and there is no
    better one" is what makes a dispatcher pick up the phone.

    Read-only. NOTHING here changes a trip. A route changes only when a person
    posts to the accept endpoint - there is no scheduler and no code path from
    this response to a write. This is a deterministic threshold and comparison
    (app/domain/reroute.py), not a model: no `confidence`, no `model_version`.

    `proposed_route_id` is null on `ALERT_ONLY` on purpose. Returning the
    least-bad alternative there would read as advice to take it.
    """

    outcome: str
    selected_route_id: uuid.UUID | None
    selected_risk_score: int | None
    selected_risk_band: str | None
    proposed_route_id: uuid.UUID | None
    reason_codes: list[str]
    #: The full comparison behind a proposal, with the tradeoff of taking it.
    #: Null when no comparison was possible or none was needed.
    comparison: RouteRecommendationRead | None
    unavailable_inputs: list[str]
    #: The risk score the current road must reach before an alternative is even
    #: considered, and how much better that alternative must be. Published so
    #: they can be argued with rather than inferred from behaviour.
    floor_points: int
    #: The second trigger: how severe the CONDITIONS alone must be, regardless
    #: of trip length. `floor_points` is measured against a score that includes
    #: distance and duration, which a short trip cannot reach - and a cloudburst
    #: does not become acceptable because the trip is short.
    severe_conditions_points: int
    margin_points: int
    version: str


class RerouteAcceptRequest(APIModel):
    """A person's decision to move a moving trip onto another route.

    `from_route_id` is required, and is not redundant. It is the route the
    manager was looking at when they decided; if the trip has since been
    rerouted by someone else, applying this would move it off a road this
    manager never saw. Mismatch is a 409 asking them to reload, not a silent
    overwrite.
    """

    from_route_id: uuid.UUID
    to_route_id: uuid.UUID
    #: Optional. Only ever relaxes REQUIRES_REVIEW, and only after the server
    #: revalidates it against the live evidence inside the mutation's own
    #: transaction. A closed road is unaffected by it.
    authorization_id: uuid.UUID | None = None


class RerouteAcceptedRead(ReadModel):
    """What the trip is now following, after a person changed it."""

    trip_id: uuid.UUID
    previous_route_id: uuid.UUID
    selected_route_id: uuid.UUID
    selected_route_kind: RouteKind


@trips_router.get(
    "/{trip_id}/reroute",
    response_model=RerouteAssessmentRead,
    summary="Should this moving trip change route",
)
async def reroute_assessment(
    trip_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.ROUTE_READ))],
) -> RerouteAssessmentRead:
    """Score the road the truck is on, and the roads beside it.

    Read-only and not persisted. An assessment is a statement about current
    conditions; a stored one goes on looking current after it stops being true.

    A trip that is not in transit returns `NO_ACTION` without calling any
    provider at all - it cannot be rerouted, so the weather requests would buy
    an answer already determined. That matters because this is the endpoint a
    fleet view is most tempted to call once per row.
    """
    result, candidates = await reroute_service.assess(db, trip_id)
    return RerouteAssessmentRead(
        outcome=result.outcome,
        selected_route_id=_as_uuid(result.selected_route_id),
        selected_risk_score=result.selected_risk_score,
        selected_risk_band=result.selected_risk_band,
        proposed_route_id=_as_uuid(result.proposed_route_id),
        reason_codes=list(result.reason_codes),
        comparison=(
            _recommendation_read(result.comparison, candidates)
            if result.comparison is not None
            else None
        ),
        unavailable_inputs=list(result.unavailable_inputs),
        floor_points=result.floor_points,
        severe_conditions_points=result.severe_conditions_points,
        margin_points=result.margin_points,
        version=result.version,
    )


@trips_router.post(
    "/{trip_id}/reroute/accept",
    response_model=RerouteAcceptedRead,
    summary="Apply a reroute a person has accepted",
)
async def reroute_accept(
    trip_id: uuid.UUID,
    payload: RerouteAcceptRequest,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.ROUTE_SELECT))],
    ip: ClientIp,
) -> RerouteAcceptedRead:
    """Move a trip that is under way onto a different route.

    The only way a moving trip's route changes. Nothing applies a proposal on
    its own: this endpoint requires an authenticated person with ROUTE_SELECT,
    and the route change plus its timeline event land in one transaction.

    No risk assessment runs here. Re-scoring at the moment of the click would
    let a weather blip between reading the proposal and acting on it override a
    decision that is the manager's to make.
    """
    trip, route = await reroute_service.accept(
        db,
        trip_id,
        from_route_id=payload.from_route_id,
        to_route_id=payload.to_route_id,
        actor=actor,
        ip=ip,
        authorization_id=payload.authorization_id,
    )
    return RerouteAcceptedRead(
        trip_id=trip.id,
        previous_route_id=payload.from_route_id,
        selected_route_id=route.id,
        selected_route_kind=route.kind,
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
