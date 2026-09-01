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
from app.domain.routing import Coordinate as RouteCoordinate
from app.domain.routing import (
    RouteCandidate,
    RoutingError,
    RoutingRejected,
    RoutingUnavailable,
    is_distinct_corridor,
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
        inner = wkt[wkt.index("(") + 1 : wkt.rindex(")")]
        lon_text, lat_text = inner.split()[0], inner.split()[1]
        return RouteCoordinate(lat=float(lat_text), lon=float(lon_text))

    pickup = next((r for r in rows if r[1] is TripStopKind.PICKUP), rows[0])
    dropoff = next(
        (r for r in reversed(rows) if r[1] is TripStopKind.DROPOFF), rows[-1]
    )
    return parse(pickup[2]), parse(dropoff[2])


async def plan(
    db: AsyncSession, trip_id: uuid.UUID, *, actor: User, ip: str | None = None
) -> PlanResult:
    """Plan a PRIMARY route for a trip and persist it.

    Any previously proposed or selected route for this trip is marked
    SUPERSEDED rather than deleted - see the module docstring.
    """
    settings = get_settings()
    if not settings.ROUTING_ENABLED:
        raise BusinessRuleError(
            "Route planning is disabled in this environment.",
            code="ROUTING_DISABLED",
        )

    await trips.get(db, trip_id)  # 404 before anything external is called
    origin, destination = await _endpoints(db, trip_id)

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
            origin, destination, kind=RouteKind.PRIMARY, limit=2
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
    for other in result.candidates[1:]:
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
    await trips.load_for_update(db, trip_id)

    superseded = (
        await db.execute(
            select(TripRoute).where(
                TripRoute.trip_id == trip_id,
                TripRoute.state.in_((RouteState.PROPOSED, RouteState.SELECTED)),
            )
        )
    ).scalars().all()

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
            + (" (fallback)" if result.used_fallback else "")
        ),
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(route)

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


async def select_route(
    db: AsyncSession,
    trip_id: uuid.UUID,
    route_id: uuid.UUID,
    *,
    actor: User,
    ip: str | None = None,
) -> TripRoute:
    """Mark one proposed route as the selected one.

    Scoped by trip_id as well as route_id, so a route belonging to another trip
    is a 404 rather than a cross-trip write.
    """
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
        reason="route selected",
        ip_address=ip,
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
