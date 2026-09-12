"""Route planning: ask a provider, persist candidates against a trip.

Sits between `app/services/routing/` (which talks to providers and knows
nothing about trips) and the API layer (which knows nothing about providers).

WHAT IS PERSISTED, AND WHAT IS NOT

`trip_routes` has three kinds - PRIMARY, FUEL_EFFICIENT, EMERGENCY_BACKUP.

  PRIMARY is always written when a provider answers.

  EMERGENCY_BACKUP is written ONLY when the provider returns an alternative
  that is a genuinely different corridor, judged by sampled separation
  (`is_distinct_corridor`). Providers routinely offer an "alternative" that
  leaves the highway for a few hundred metres and rejoins it; persisting that
  would put a choice in front of a dispatcher that is not a choice. On most NER
  corridors there is one sensible road and no alternative comes back - which is
  the honest answer, not a shortfall.

  FUEL_EFFICIENT is NOT produced, and that is a deliberate refusal. Ranking by
  consumption needs a fuel model; there is no trained model (`ml/` is a README)
  and `docs/AI_MODELS.md` §0 forbids stating a number that came from no
  evaluation. Relabelling the primary route would be a fabricated feature that
  looks exactly like a working one.

`estimated_fuel_litres` is therefore left NULL, which the column comment defines
as "no estimate available" and which the UI must render as such. It is never
defaulted to zero.

REROUTING IS INSERT, NEVER UPDATE. A previous route is marked SUPERSEDED and
kept. Route history is evidence in an incident review, and overwriting it would
destroy the only record of what the driver was told to do.
"""

import logging
import uuid
from dataclasses import dataclass

from geoalchemy2 import WKTElement
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import (
    BusinessRuleError,
    NotFoundError,
    ServiceUnavailableError,
)
from app.domain.route_eligibility import Eligibility, EligibilityDecision
from app.domain.routing import Coordinate as RouteCoordinate
from app.domain.routing import (
    RouteCandidate,
    RoutingError,
    RoutingRejected,
    RoutingUnavailable,
    is_distinct_corridor,
    parse_wkt_point,
)
from app.models.enums import AuditAction, RouteKind, RouteState, TripStopKind
from app.models.identity import User
from app.models.operations import TripRoute, TripStop
from app.services import audit, trips
from app.services.routing import OsrmRoutingProvider, RoutingChain
from app.services.shipments import SRID

logger = logging.getLogger(__name__)

AUDITED_FIELDS = (
    "id", "trip_id", "kind", "state", "distance_km", "estimated_duration_min",
    "routing_provider",
)


@dataclass(frozen=True)
class PlanResult:
    """What planning produced, including which providers were tried."""

    route: TripRoute
    provider: str
    used_fallback: bool
    attempted: tuple[str, ...]
    #: True when the provider also offered a genuinely different corridor and
    #: it was persisted as EMERGENCY_BACKUP. False is the ordinary answer on a
    #: single-road corridor and is not a failure.
    backup_planned: bool = False


def build_chain() -> RoutingChain:
    """Assemble the provider chain from configuration.

    Built per call rather than cached so a settings change takes effect without
    a restart, and so tests can repoint it. The objects are cheap - each holds a
    URL and a timeout, and opens its own connection per request.
    """
    settings = get_settings()
    providers = []
    if settings.ROUTING_PRIMARY_URL:
        providers.append(
            OsrmRoutingProvider(
                settings.ROUTING_PRIMARY_URL,
                timeout_s=settings.ROUTING_TIMEOUT_SECONDS,
                name="primary",
            )
        )
    providers.append(
        OsrmRoutingProvider(
            settings.ROUTING_FALLBACK_URL,
            timeout_s=settings.ROUTING_TIMEOUT_SECONDS,
            name="osrm",
        )
    )
    return RoutingChain(providers)


async def _endpoints(
    db: AsyncSession, trip_id: uuid.UUID
) -> tuple[RouteCoordinate, RouteCoordinate]:
    """The trip's first and last stop, as routing endpoints.

    Read back through ST_AsText rather than passing the loaded geography value
    around, for the same reason `trips._shipment_endpoints` does: the round trip
    through text makes the lon/lat ordering explicit at exactly one point.
    """
    rows = (
        await db.execute(
            select(TripStop.sequence, TripStop.kind, func.ST_AsText(TripStop.location))
            .where(TripStop.trip_id == trip_id)
            .order_by(TripStop.sequence)
        )
    ).all()
    if len(rows) < 2:
        raise BusinessRuleError(
            "A trip needs at least two stops before a route can be planned.",
            code="TRIP_HAS_NO_ROUTE_ENDPOINTS",
        )

    def parse(wkt: str) -> RouteCoordinate:
        lat, lon = parse_wkt_point(wkt)
        return RouteCoordinate(lat=lat, lon=lon)

    pickup = next((r for r in rows if r[1] is TripStopKind.PICKUP), rows[0])
    dropoff = next(
        (r for r in reversed(rows) if r[1] is TripStopKind.DROPOFF), rows[-1]
    )
    return parse(pickup[2]), parse(dropoff[2])


def _maneuvers_json(candidate) -> list[dict] | None:
    """A candidate's turn instructions, ready for the JSONB column.

    None - not `[]` - when the candidate carries none. The column's whole
    contract is that NULL means "this route cannot drive guidance", and an
    empty list would read as "this road has no turns", which is never true of
    a 305 km corridor. See migration 0009.
    """
    if not candidate.maneuvers:
        return None
    return [
        {
            "type": m.type,
            "modifier": m.modifier,
            "lat": m.at[0],
            "lon": m.at[1],
            "geometry_index": m.geometry_index,
            "step_distance_m": m.step_distance_m,
            "duration_s": m.duration_s,
            "name": m.name,
            "exit": m.exit,
        }
        for m in candidate.maneuvers
    ]


async def plan(
    db: AsyncSession,
    trip_id: uuid.UUID,
    *,
    actor: User,
    ip: str | None = None,
    detailed: bool = False,
    origin: RouteCoordinate | None = None,
    kind: RouteKind = RouteKind.PRIMARY,
) -> PlanResult:
    """Plan a PRIMARY route for a trip and persist it.

    `origin` overrides the pickup stop: a driver already under way asks for a
    road from where the truck IS, and that candidate is stored as the trip's
    EMERGENCY_BACKUP (`kind`) so it reaches the phone as the backup road and the
    manager as a candidate. No second option is requested for a non-PRIMARY
    plan - a backup of a backup is not a choice anyone is offered.

    `detailed=True` asks the provider for turn instructions and full geometry,
    producing a candidate that CAN drive navigation. It is a new candidate like
    any other: PROPOSED, assessed by `refuse_if_ineligible` and accepted only
    through selection. Nothing attaches directions to a route that was planned
    without them - a route gains guidance by being planned for it, never by
    having instructions calculated later and stapled on because the endpoints
    happen to match.

    Obsolete UNSELECTED candidates are marked SUPERSEDED rather than deleted -
    see the module docstring on why history is kept.

    The route the trip is currently following is NOT touched. Planning offers
    alternatives; it does not change which road the driver is on. Only an
    explicit selection or an accepted reroute does that.
    """
    settings = get_settings()
    if not settings.ROUTING_ENABLED:
        raise BusinessRuleError(
            "Route planning is disabled in this environment.",
            code="ROUTING_DISABLED",
        )

    await trips.get(db, trip_id)  # 404 before anything external is called
    pickup, destination = await _endpoints(db, trip_id)
    origin = origin or pickup

    # Release the database BEFORE calling the provider.
    #
    # Without this the first SELECT's transaction stays open for the whole call:
    # measured at `pool.checkedout() == 1` with `pg_stat_activity.state` at
    # 'idle in transaction'. The routing timeout is 8 s, the pool is
    # DB_POOL_SIZE + DB_MAX_OVERFLOW = 15, and Supabase's session pooler allows
    # 15 clients - so concurrent planning against a slow provider would spend
    # the entire database budget waiting on somebody else's server, and an
    # idle-in-transaction backend also holds back vacuum.
    #
    # Nothing is lost by releasing it. `origin` and `destination` are plain
    # coordinates by this point, the endpoints cannot change underneath a route
    # request in any way that matters, and trip state is re-read under a row
    # lock after the call regardless.
    #
    # `commit` rather than `rollback`, even though everything above is a read
    # and there is nothing to make durable. Both end the transaction and return
    # the connection to the pool, but `rollback` expires every object in the
    # session unconditionally - including the `actor` User that
    # `require_permission` loaded through this same session. The next attribute
    # access on it then triggers a lazy refresh from a non-async context and
    # raises MissingGreenlet, which is exactly what `actor.id` did below. The
    # sessionmaker sets `expire_on_commit=False` (app/db/session.py), so commit
    # releases the connection and leaves already-loaded objects usable.
    await db.commit()

    try:
        # Two options requested. A second is persisted only if it is a
        # genuinely different corridor - see below.
        result = await build_chain().route_options(
            origin,
            destination,
            kind=kind,
            limit=2 if kind is RouteKind.PRIMARY else 1,
            detailed=detailed,
        )
    except RoutingRejected as exc:
        # Reached, and the answer is no. 422 NO_VIABLE_ROUTE, the code
        # docs/API_CONTRACTS.md §9 already specifies: nobody may route this, so
        # it is neither an authorization problem nor a transient one.
        raise BusinessRuleError(
            "No route could be found between this trip's stops.",
            code="NO_VIABLE_ROUTE",
        ) from exc
    except RoutingUnavailable as exc:
        # Every provider is down. 503, per docs/API_CONTRACTS.md §9 - this is a
        # dependency outage and a retry may well succeed, which is a different
        # thing to tell a manager than "this trip cannot be routed".
        raise ServiceUnavailableError(
            "No routing provider is reachable right now.",
            code="ROUTING_UNAVAILABLE",
        ) from exc
    except RoutingError as exc:  # pragma: no cover - defensive
        raise BusinessRuleError(
            "Route planning failed.", code="ROUTING_FAILED"
        ) from exc

    candidate = result.candidates[0]

    # A second option is persisted as EMERGENCY_BACKUP only when it is a
    # genuinely different corridor. Providers routinely return an "alternative"
    # that leaves the highway for a few hundred metres and rejoins it; storing
    # that as a backup would put a choice in front of a dispatcher that is not
    # a choice. On most NER corridors there is one sensible road and no
    # alternative comes back at all - which is the honest answer, not a gap.
    backup: RouteCandidate | None = None
    for other in result.candidates[1:] if kind is RouteKind.PRIMARY else []:
        if is_distinct_corridor(candidate, other):
            backup = other
            break

    # Lock the trip row before touching routes, and only NOW - every other
    # mutating trip path takes this lock, and without it two managers pressing
    # "re-plan" together both read the same set of open routes, both insert, and
    # the trip ends with two PROPOSED routes and one of them superseded by
    # nothing.
    #
    # Taken AFTER the provider call on purpose. Locking first would hold a row
    # lock across an HTTP request to a third party for up to the routing
    # timeout, so one slow provider would block every other write to that trip.
    locked_trip = await trips.load_for_update(db, trip_id)

    # THE CURRENT ASSIGNMENT SURVIVES PLANNING (LS-10).
    #
    # Asking what else is available is not consent to leave the road the truck
    # is on. This previously superseded every PROPOSED *and SELECTED* route,
    # which retired the trip's own `selected_route_id` - and SUPERSEDED is
    # terminal here, not cosmetic: `apply_selection` refuses a superseded route
    # outright, `route_recommendation` drops it from the candidates, and a
    # replaced route is deliberately demoted to PROPOSED rather than SUPERSEDED
    # precisely because superseded means "never again". The trip was left
    # following a route the rest of the system considered unusable, and the
    # manager UI - which finds the current route by looking for SELECTED -
    # could no longer show what the driver was actually on.
    #
    # Read from the trip row just locked, NOT from anything read earlier in this
    # request: `plan` releases the database before calling the provider, so
    # another transaction can accept a replacement while this one is waiting on
    # a third party. `load_for_update` re-reads under the lock
    # (`populate_existing`), so this sees that acceptance rather than the state
    # that was true when the request began.
    #
    # Obsolete UNSELECTED candidates are still superseded. Leaving them alive
    # would be the opposite mistake: a pile of stale options that all look
    # choosable.
    current_route_id = locked_trip.selected_route_id

    obsolete = select(TripRoute).where(
        TripRoute.trip_id == trip_id,
        TripRoute.state.in_((RouteState.PROPOSED, RouteState.SELECTED)),
    )
    if current_route_id is not None:
        obsolete = obsolete.where(TripRoute.id != current_route_id)

    superseded = (await db.execute(obsolete)).scalars().all()

    route = TripRoute(
        trip_id=trip_id,
        kind=candidate.kind,
        state=RouteState.PROPOSED,
        geometry=WKTElement(candidate.to_wkt(), srid=SRID),
        distance_km=candidate.distance_km,
        estimated_duration_min=candidate.duration_min,
        # Deliberately absent: estimated_fuel_litres, estimated_fuel_cost and
        # fuel_estimate_source. No fuel model exists, and NULL is the defined
        # value for "no estimate available".
        routing_provider=candidate.provider,
        provider_route_id=candidate.provider_route_id,
        # None when this candidate was planned without directions. Stored as
        # given - nothing here derives a turn from the geometry.
        maneuvers=_maneuvers_json(candidate),
    )
    db.add(route)
    await db.flush()

    if backup is not None:
        db.add(
            TripRoute(
                trip_id=trip_id,
                kind=RouteKind.EMERGENCY_BACKUP,
                state=RouteState.PROPOSED,
                geometry=WKTElement(backup.to_wkt(), srid=SRID),
                distance_km=backup.distance_km,
                estimated_duration_min=backup.duration_min,
                routing_provider=backup.provider,
                provider_route_id=backup.provider_route_id,
                maneuvers=_maneuvers_json(backup),
            )
        )
        await db.flush()

    for old in superseded:
        old.state = RouteState.SUPERSEDED
        old.superseded_by = route.id

    await audit.record(
        db,
        action=AuditAction.CREATE,
        entity_type="trip_routes",
        entity_id=route.id,
        actor_user_id=actor.id,
        after=audit.snapshot(route, AUDITED_FIELDS),
        reason=(
            f"route planned via {candidate.provider}"
            + (" from reported position" if origin is not pickup else "")
            + (" (fallback)" if result.used_fallback else "")
        ),
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(route)

    # Which districts this road crosses, looked up now so the first assessment
    # does not wait on it. Background; a failure only delays the answer.
    from app.domain.routing import sample_positions
    from app.services import warnings as warnings_service

    warnings_service.warm(route.id, sample_positions(candidate.geometry, 5))

    return PlanResult(
        route=route,
        provider=candidate.provider,
        used_fallback=result.used_fallback,
        attempted=tuple(a.provider for a in result.attempts),
        backup_planned=backup is not None,
    )


async def list_for_trip(db: AsyncSession, trip_id: uuid.UUID) -> list[TripRoute]:
    """Every route ever proposed for a trip, newest first.

    Superseded rows are included on purpose: the history is the point.
    """
    return list(
        (
            await db.execute(
                select(TripRoute)
                .where(TripRoute.trip_id == trip_id)
                .order_by(TripRoute.created_at.desc())
            )
        )
        .scalars()
        .all()
    )


async def ensure_belongs_to_trip(
    db: AsyncSession, trip_id: uuid.UUID, route_id: uuid.UUID
) -> None:
    """404 unless this route belongs to this trip.

    The same scoping `select_route` applies, as its own function so read-only
    callers get it without taking a row lock they do not need. Without it,
    `/trips/{a}/routes/{b}/risk` would happily assess another trip's route -
    an id from one trip used against another is the classic IDOR shape.
    """
    exists = (
        await db.execute(
            select(TripRoute.id).where(
                TripRoute.id == route_id, TripRoute.trip_id == trip_id
            )
        )
    ).scalar_one_or_none()
    if exists is None:
        raise NotFoundError("Route not found for this trip.")


async def state_of(db: AsyncSession, route_id: uuid.UUID) -> str:
    """A route's lifecycle state as a plain string.

    Used to bind a review authorisation to the state the reviewer saw, so one
    issued against a PROPOSED route cannot be spent after that route was
    superseded. A column read, not an entity load - the same reason
    `route_risk._route_facts` reads columns.
    """
    state = (
        await db.execute(
            select(TripRoute.state).where(TripRoute.id == route_id)
        )
    ).scalar_one_or_none()
    if state is None:
        raise NotFoundError("Route not found.")
    return state.value


def refuse_if_ineligible(
    decision: "EligibilityDecision", *, offered_authorization: bool = False
) -> None:
    """Raise if this route may not be applied. Pure, so it can be tested alone.

    LS-4. `apply_selection` previously checked only that the route belonged to
    the trip and was not SUPERSEDED - so a route with a validated active
    closure could be selected directly through the API, bypassing the
    recommendation ranking entirely. A disabled button in the manager UI is not
    a control; the refusal has to live on the server, on the mutation path.

    Refuses REJECTED, REQUIRES_REVIEW and NOT_ASSESSED, each with its own code.

    `offered_authorization` relaxes ONLY the REQUIRES_REVIEW branch, and only
    to the extent of letting the request continue to the place where an
    authorisation is really checked (`route_review.claim`, under the trip lock,
    against the live evidence). REJECTED and NOT_ASSESSED have no parameter
    that can affect them - the hard limit is expressed as "there is no code
    path", not as a check somebody could pass the wrong argument to.
    """
    if decision is None:
        # LS-5. Previously this meant "allowed", and EVERY live caller passed
        # None - so the guard existed and enforced nothing. An omitted
        # assessment is an integration failure in this application, and the
        # safe answer to "did anyone check?" being "no" is to refuse.
        raise BusinessRuleError(
            "Route eligibility was not assessed; the change was refused.",
            code="ROUTE_ELIGIBILITY_NOT_ASSESSED",
        )
    if decision.eligibility is Eligibility.NOT_ASSESSED:
        raise BusinessRuleError(
            "Route eligibility could not be assessed; the change was refused.",
            code="ROUTE_ELIGIBILITY_NOT_ASSESSED",
        )
    if decision.is_rejected:
        raise BusinessRuleError(
            "That route is blocked by an active hazard and cannot be selected.",
            code="ROUTE_REJECTED_ACTIVE_HAZARD",
        )
    if decision.eligibility is Eligibility.REQUIRES_REVIEW and not offered_authorization:
        # A DIFFERENT refusal from a hazard rejection - the road is not known to
        # be blocked, it is not known to be clear - and it carries its own code
        # so a manager is told which of those two things happened.
        #
        # Since LS-11 this is passable, but ONLY by presenting an audited
        # authorisation, and only for evidence that is UNKNOWN. Note what this
        # branch does NOT do: it does not accept the authorisation. It merely
        # declines to refuse here, so the request can reach the point under the
        # trip lock where the authorisation is actually validated and spent
        # against the live evidence. Nothing is approved by getting this far.
        raise BusinessRuleError(
            "This route needs review before it can be selected: required "
            "safety evidence is missing or elevated.",
            code="ROUTE_SELECTION_REQUIRES_REVIEW",
        )


async def apply_selection(
    db: AsyncSession,
    trip_id: uuid.UUID,
    route_id: uuid.UUID,
    *,
    actor: User,
    ip: str | None = None,
    reason: str = "route selected",
    eligibility: "EligibilityDecision",
    authorization_id: uuid.UUID | None = None,
    assessment=None,
) -> tuple[TripRoute, uuid.UUID | None]:
    """Select a route and audit it, WITHOUT committing.

    Split out so a caller that must write more in the same transaction can do
    so. Accepting a reroute is exactly that: the route change and the
    `ROUTE_CHANGED` event on the trip's timeline have to land together or not
    at all, and a version of this that committed would leave a trip whose route
    moved with no record on the timeline saying why.

    Returns the selected route and the id of the route it replaced, which is
    the fact a reroute record needs and which is destroyed by the write itself.

    The caller owns the transaction, and therefore owns the commit.
    """
    # Refused BEFORE the lock is taken. The decision is computed by the caller
    # from evidence gathered outside any transaction, because a hazard lookup
    # is network I/O and holding a row lock across it spends the database
    # budget waiting on somebody else's server - the rule route_risk already
    # follows.
    refuse_if_ineligible(
        eligibility, offered_authorization=authorization_id is not None
    )

    # Lock the trip first. Selecting demotes every other SELECTED route and
    # writes trips.selected_route_id, so two concurrent selections would
    # otherwise each demote the other's choice and leave the trip pointing at
    # one route while a different one is marked SELECTED. No external call
    # happens here, so holding the lock for the whole operation costs nothing.
    await trips.load_for_update(db, trip_id)

    route = (
        await db.execute(
            select(TripRoute).where(
                TripRoute.id == route_id, TripRoute.trip_id == trip_id
            )
        )
    ).scalar_one_or_none()
    if route is None:
        raise NotFoundError("Route not found for this trip.")
    if route.state is RouteState.SUPERSEDED:
        raise BusinessRuleError(
            "That route has been superseded and cannot be selected.",
            code="ROUTE_SUPERSEDED",
        )

    # SPEND THE AUTHORISATION HERE, and only here (LS-11).
    #
    # After the trip lock and after the route has been re-read under it, so the
    # `route_state_at_issue` binding is checked against the state this
    # transaction actually holds. The claim is one conditional UPDATE inside
    # THIS transaction, and the caller commits it together with the route
    # change - so a failure anywhere below rolls the consumption back too and
    # an authorisation is never spent on a selection that did not happen.
    if eligibility.eligibility is Eligibility.REQUIRES_REVIEW:
        if authorization_id is None:  # pragma: no cover - guarded above
            raise BusinessRuleError(
                "This route needs review before it can be selected.",
                code="ROUTE_SELECTION_REQUIRES_REVIEW",
            )
        from app.services import route_review

        await route_review.claim(
            db,
            authorization_id,
            trip_id=trip_id,
            route_id=route_id,
            route_state=route.state.value,
            actor=actor,
            decision=eligibility,
            assessment=assessment,
        )

    before = audit.snapshot(route, AUDITED_FIELDS)
    others = (
        await db.execute(
            select(TripRoute).where(
                TripRoute.trip_id == trip_id,
                TripRoute.id != route_id,
                TripRoute.state == RouteState.SELECTED,
            )
        )
    ).scalars().all()
    # Demoted to PROPOSED, deliberately NOT SUPERSEDED. A superseded route is
    # one that can never be taken again, and weather is not permanent: a
    # corridor abandoned this afternoon may be the right road this evening, and
    # marking it dead would make the reroute a one-way door.
    previous_selected_id = others[0].id if others else None
    for other in others:
        other.state = RouteState.PROPOSED

    route.state = RouteState.SELECTED
    # Already loaded and locked above; `get` here would be a second read of a
    # row this session is holding.
    locked_trip = await trips.load_for_update(db, trip_id)
    locked_trip.selected_route_id = route.id

    await db.flush()
    await audit.record(
        db,
        action=AuditAction.STATUS_CHANGE,
        entity_type="trip_routes",
        entity_id=route.id,
        actor_user_id=actor.id,
        before=before,
        after=audit.snapshot(route, AUDITED_FIELDS),
        reason=reason,
        ip_address=ip,
    )
    return route, previous_selected_id


async def select_route(
    db: AsyncSession,
    trip_id: uuid.UUID,
    route_id: uuid.UUID,
    *,
    actor: User,
    ip: str | None = None,
    authorization_id: uuid.UUID | None = None,
) -> TripRoute:
    """Mark one proposed route as the selected one.

    Scoped by trip_id as well as route_id, so a route belonging to another trip
    is a 404 rather than a cross-trip write.
    """
    # Computed BEFORE apply_selection takes the trip lock, and computed HERE
    # rather than accepted from the caller: the API layer must not be able to
    # hand in an eligibility of its own.
    from app.services import route_risk as route_risk_service

    decision, assessment = await route_risk_service.eligibility_and_evidence_for_route(
        db, route_id
    )
    route, _ = await apply_selection(
        db,
        trip_id,
        route_id,
        actor=actor,
        ip=ip,
        eligibility=decision,
        authorization_id=authorization_id,
        assessment=assessment,
    )
    await db.commit()
    await db.refresh(route)
    return route


async def geometry_wkt(db: AsyncSession, route_id: uuid.UUID) -> str:
    """A route's geometry as WKT.

    Read back through ST_AsText rather than serialising the loaded geography
    value, for the same reason the endpoints are: it makes the lon/lat ordering
    explicit at one point instead of implicit at several.
    """
    return (
        await db.execute(
            select(func.ST_AsText(TripRoute.geometry)).where(TripRoute.id == route_id)
        )
    ).scalar_one()
