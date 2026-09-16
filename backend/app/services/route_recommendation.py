"""Score every live route for a trip and compare them.

`app/domain/route_recommendation.py` holds the comparison rule and knows
nothing about HTTP or the database. This module gets it the evidence, under the
same two constraints the rest of the routing stack works to.

THE DATABASE IS RELEASED BEFORE ANY PROVIDER IS CALLED

The rule `routes.plan()` and `route_risk.assess_route()` already follow, and it
binds harder here: this fans out weather for EVERY candidate route, so holding
a pooled connection across it would spend the database budget waiting on a free
API for as long as the slowest of N routes takes. Geometry and estimates for
all candidates are read in ONE statement, the transaction is ended, and only
then does anything leave the process.

`commit` rather than `rollback` ends it, for the reason documented in
`routes.plan()`: rollback expires every object in the session, including the
`actor` the permission dependency loaded, and the next attribute access raises
MissingGreenlet.

THE FAN-OUT IS BOUNDED, AND THE BOUND IS THE POINT

ROUTE_SAMPLES points per route, MAX_CANDIDATE_ROUTES routes: at most 10 weather
requests per call against a free service with no contractual uptime. A UI that
polled this endpoint like telemetry would multiply that by every open browser
tab, so the endpoint is a considered read, not a feed - and the cap is enforced
here rather than left to whatever planning happened to store.

SUPERSEDED ROUTES ARE NOT CANDIDATES

`routes.list_for_trip` deliberately returns history, because history is
evidence. A recommendation is about what to do next, so anything SUPERSEDED or
REJECTED_BLOCKED is filtered out before the comparison. Including them would
let a road already ruled out come back as advice.
"""

import asyncio
import uuid
from decimal import Decimal
from typing import Final

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.route_recommendation import (
    Recommendation,
    RouteCandidate,
    recommend,
)
from app.domain.route_risk import RouteRisk, assess
from app.domain.routing import parse_wkt_linestring, sample_positions
from app.models.enums import RouteKind, RouteState
from app.models.operations import Trip, TripRoute
from app.services import route_risk as route_risk_service
from app.services import simulation
from app.services import traffic as traffic_service
from app.services import connectivity as connectivity_service
from app.domain.traffic import TrafficSample, estimate as traffic_estimate
from app.domain.connectivity import ConnectivitySample
from app.domain.connectivity import estimate as connectivity_estimate
from app.services.route_risk import ROUTE_SAMPLES

#: States in which a route is still something the trip could actually take.
LIVE_ROUTE_STATES: Final[tuple[RouteState, ...]] = (
    RouteState.PROPOSED,
    RouteState.SELECTED,
)

#: Hard ceiling on how many routes one call will score.
#:
#: Planning stores a PRIMARY and every distinct extra the provider offered as
#: EMERGENCY_BACKUP - at most `routes.MAX_ROUTE_OPTIONS` rows per plan - so
#: this matches that. It exists because the cost of this endpoint is
#: `candidates x ROUTE_SAMPLES` requests to a free provider, and a bound that
#: lives in code is the only kind that survives someone later persisting more.
MAX_CANDIDATE_ROUTES: Final[int] = 3


async def _live_route_facts(
    db: AsyncSession, trip_id: uuid.UUID
) -> list[tuple[uuid.UUID, str, str, Decimal | None, int | None]]:
    """Geometry and estimates for every live route on a trip, in one statement.

    Ordered SELECTED first, then PRIMARY, then oldest.

    The SELECTED key is not cosmetic, and it is not for the domain rule's
    benefit - that looks its baseline up explicitly. It is what makes the LIMIT
    safe. `reroute.assess` finds the route the truck is on by matching against
    these candidates, so a trip with more live routes than the cap that ordered
    the selected one last would drop it, and the assessment would then report
    NO_SELECTED_ROUTE -> NO_ACTION. That is not a degraded answer: it is a truck
    on a road that has just gone bad being told nothing at all, in the one case
    the cap was meant to make cheap rather than wrong.

    PRIMARY second, and oldest last, so the planning path keeps the stable
    order its baseline fallback assumes.
    """
    rows = (
        await db.execute(
            select(
                TripRoute.id,
                TripRoute.kind,
                func.ST_AsText(TripRoute.geometry),
                TripRoute.distance_km,
                TripRoute.estimated_duration_min,
            )
            .outerjoin(Trip, Trip.id == TripRoute.trip_id)
            .where(
                TripRoute.trip_id == trip_id,
                TripRoute.state.in_(LIVE_ROUTE_STATES),
            )
            .order_by(
                (Trip.selected_route_id != TripRoute.id),
                (TripRoute.kind != RouteKind.PRIMARY),
                TripRoute.created_at.asc(),
            )
            .limit(MAX_CANDIDATE_ROUTES)
        )
    ).all()
    return [(r[0], r[1].value, r[2], r[3], r[4]) for r in rows]


async def _risk_for(
    route_id: uuid.UUID, wkt: str, distance_km: Decimal | None, duration_min: int | None,
    probes: list[TrafficSample] | None = None,
    delays: list[ConnectivitySample] | None = None,
) -> RouteRisk:
    """Score one route from geometry already read out of the database.

    The SAME four evidence reads as `route_risk.assess_route`, gathered the
    same way. This is the second assessment path (LS-7 below), and it is
    where terrain and history would have been missed a second time: the
    driver's monitor would have shown a DEM profile while the dispatcher's
    review said "terrain not available" for the same road.
    """
    geometry = parse_wkt_linestring(wkt)
    positions = sample_positions(geometry, ROUTE_SAMPLES)
    # Through the module, not bound names: these are the seams the suite
    # stubs, and importing them directly here would silently bypass that patch
    # and reach the real providers from tests.
    #
    # LS-7. This path was missed when landslide evidence was wired into
    # `assess_route`, so every recommendation candidate carried
    # `landslide=None`. Once landslide became REQUIRED evidence that made every
    # candidate REQUIRES_REVIEW and the endpoint stopped recommending anything.
    observations, landslide, terrain, history, flood, warnings = await route_risk_service.evidence_for(
        route_id, geometry, positions
    )
    distance = float(distance_km) if distance_km is not None else 0.0
    duration = float(duration_min) if duration_min is not None else 0.0
    return simulation.apply(route_id, assess(
        distance_km=distance,
        duration_min=duration,
        observations=observations,
        landslide=landslide,
        terrain=terrain,
        history=history,
        flood=flood,
        warnings=warnings,
        traffic=traffic_estimate(geometry=geometry, samples=probes or [], distance_km=distance, duration_min=duration),
        connectivity=connectivity_estimate(geometry=geometry, samples=delays or []),
    ))


async def candidates_for_trip(
    db: AsyncSession, trip_id: uuid.UUID
) -> list[RouteCandidate]:
    """Every live route on a trip, scored against current conditions.

    The evidence-gathering half, shared with `app/services/reroute.py`. Both
    the planning recommendation and a mid-trip reroute need the same figures
    computed the same way; two implementations would eventually disagree about
    the risk of one road, and a dispatcher shown two numbers for one corridor
    has no reason to trust either.

    ENDS THE TRANSACTION. The connection is released before any provider call,
    which means the caller must not be holding a row lock and must not expect
    an open transaction afterwards.
    """
    facts = await _live_route_facts(db, trip_id)
    # Fleet probes per route, while the session is still held.
    probes = {route_id: await traffic_service.samples_for(db, route_id) for route_id, *_ in facts}
    delays = {route_id: await connectivity_service.samples_for(db, route_id) for route_id, *_ in facts}

    # Release the connection BEFORE the provider fan-out. See module docstring.
    await db.commit()

    if not facts:
        return []

    # Concurrent across routes as well as within one: two serial assessments
    # would stack their timeouts, and the routes are independent.
    risks = await asyncio.gather(
        *(_risk_for(route_id, wkt, distance, duration, probes.get(route_id), delays.get(route_id)) for route_id, _, wkt, distance, duration in facts)
    )

    return [
        RouteCandidate(
            route_id=str(route_id),
            kind=kind,
            distance_km=float(distance) if distance is not None else None,
            duration_min=float(duration) if duration is not None else None,
            risk=risk,
        )
        for (route_id, kind, _, distance, duration), risk in zip(
            facts, risks, strict=True
        )
    ]


async def recommend_for_trip(
    db: AsyncSession, trip_id: uuid.UUID
) -> tuple[Recommendation, list[RouteCandidate]]:
    """Advise a route for `trip_id`, with every candidate's evidence.

    Read-only, and nothing is stored. A recommendation is a statement about the
    weather right now; persisting one would leave advice on screen that looked
    current long after the storm it was made in had passed. The caller asks
    again when it wants a fresh answer - which is also why this is not
    something a UI should poll.

    Returns the recommendation AND the candidates it was built from, because a
    recommendation without the figures behind it is exactly the opaque number
    this whole subsystem exists to avoid.
    """
    candidates = await candidates_for_trip(db, trip_id)
    return recommend(candidates), candidates
