"""Route risk assessment: sample a route, ask the weather, score it.

This is the layer that makes the weather subsystem an application feature
rather than a library nobody calls. `app/domain/route_risk.py` holds the
scoring rule and knows nothing about HTTP or the database; this module gets it
the evidence.

THE DATABASE IS RELEASED BEFORE THE PROVIDER IS CALLED

The same rule `routes.plan()` follows, for the same measured reason: a request
that holds a pooled connection across an external call spends the database
budget waiting on somebody else's server. Here it matters more, not less -
this fans out to several weather requests, so the window is longer than
routing's single call.

`commit` rather than `rollback` releases it: both end the transaction, but
rollback expires every object in the session including the `actor` the
permission dependency loaded, and the next attribute access then raises
MissingGreenlet. See the comment in `routes.plan()`.

WEATHER FAILURE IS NOT REQUEST FAILURE

If the provider is down the assessment still returns, with
`weather: NOT_AVAILABLE` and a reason code saying so. A 503 here would mean a
dispatcher sees nothing at all because one free API had a bad minute, when
distance and duration are still perfectly good evidence.
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.domain.landslide import (
    IncidentQueryResult,
    LandslideAssessment,
    LandslideHistory,
    SourceState,
    assess_corridor,
    assess_history,
)
from app.domain.route_eligibility import (
    EligibilityDecision,
    evaluate as evaluate_eligibility,
    not_assessed,
    within_coverage,
)
from app.domain.route_risk import RouteRisk, assess
from app.domain.routing import parse_wkt_linestring, sample_positions
from app.domain.weather import WeatherError, WeatherObservation
from app.models.operations import TripRoute
from app.services.landslide import build_provider as build_landslide_provider
from app.services.landslide.base import BoundingBox, LandslideQueryError
from app.services.landslide.history import build_inventory
from app.services.flood import flood_for
from app.services.warnings import warnings_for
from app.services.terrain import profile_for as terrain_profile_for
from app.services import geo_classify
from app.services import simulation
from app.services import traffic as traffic_service
from app.domain.traffic import estimate as traffic_estimate
from app.services.weather import OpenMeteoWeatherProvider

logger = logging.getLogger(__name__)

#: Evidence reads still running after their caller stopped waiting. Held here
#: because the loop keeps only a weak reference to a task.
_background: set[asyncio.Task] = set()

#: How many points along the route to ask about. Weather varies over tens of
#: kilometres, not hundreds of metres, so more samples buy precision nobody
#: uses while multiplying calls against a free service. Five spreads across a
#: 300 km corridor at roughly 75 km spacing.
ROUTE_SAMPLES: int = 5


def build_provider() -> OpenMeteoWeatherProvider:
    """The configured weather provider.

    Built per call rather than cached, matching `routes.build_chain()`: the
    object holds a URL and a timeout, and tests repoint it.
    """
    settings = get_settings()
    return OpenMeteoWeatherProvider(
        settings.WEATHER_PROVIDER_URL,
        timeout_s=settings.WEATHER_TIMEOUT_SECONDS,
        fallback_url=settings.WEATHER_FALLBACK_URL,
    )


async def observations_for(
    positions: list[tuple[float, float]],
) -> list[WeatherObservation]:
    """Weather at each sampled position.

    Failures are dropped, not raised. One unreachable point should reduce the
    confidence of an assessment, not destroy it - and `assess()` already
    reports how many observations it actually had.

    Requested concurrently because they are independent and a serial loop would
    turn five 6-second timeouts into a 30-second request.
    """
    if not positions:
        return []
    if not get_settings().WEATHER_ENABLED:
        # Refused here rather than at the endpoint: the assessment still
        # returns, with weather reported NOT_AVAILABLE. An offline demo should
        # show a partial score, not an error.
        return []

    provider = build_provider()
    # Each point on its own deadline: a slow point is dropped below like any
    # other failure, and the points that did answer are still scored.
    limit = get_settings().EVIDENCE_TIMEOUT_SECONDS
    results = await asyncio.gather(
        *(asyncio.wait_for(provider.current(lat, lon), limit) for lat, lon in positions),
        return_exceptions=True,
    )

    observations: list[WeatherObservation] = []
    for position, result in zip(positions, results, strict=True):
        if isinstance(result, WeatherObservation):
            observations.append(result)
        elif isinstance(result, (WeatherError, TimeoutError)):
            logger.info(
                "weather unavailable at %.4f,%.4f: %s",
                position[0],
                position[1],
                type(result).__name__,
            )
        elif isinstance(result, BaseException):
            # Unexpected: log the type, keep the assessment alive.
            logger.warning(
                "unexpected weather failure at %.4f,%.4f: %r", *position, result
            )
    return observations


#: How far back to ask a landslide source for incidents. A corridor's CURRENT
#: exposure is about what is on the road now, not a decade of history -
#: recurrence is a separate question answered from the evidence log.
INCIDENT_WINDOW_DAYS: int = 90

#: Padding around the sampled corridor, in degrees (~11 km at this latitude).
#: Bounded on purpose: a route query must never become a national one.
CORRIDOR_PAD_DEG: float = 0.1


def corridor_box(positions: list[tuple[float, float]]) -> BoundingBox | None:
    """A bounded box around the sampled route, or None if there is nothing to bound.

    Built from the SAMPLED positions rather than the full geometry: the
    samples already span the corridor, and using them keeps the box small
    without a second pass over thousands of vertices.
    """
    if not positions:
        return None
    lats = [lat for lat, _ in positions]
    lons = [lon for _, lon in positions]
    try:
        return BoundingBox(
            min_lat=max(-90.0, min(lats) - CORRIDOR_PAD_DEG),
            min_lon=max(-180.0, min(lons) - CORRIDOR_PAD_DEG),
            max_lat=min(90.0, max(lats) + CORRIDOR_PAD_DEG),
            max_lon=min(180.0, max(lons) + CORRIDOR_PAD_DEG),
        )
    except LandslideQueryError:
        # Wider than one landslide page - a 2,400 km road proposed from a phone
        # far off its corridor, seen on the physical device. That is a source
        # that cannot answer, reported as UNAVAILABLE by the callers, never a
        # 500 from the whole assessment.
        logger.info("corridor spans more than one landslide page; landslide evidence unavailable")
        return None


async def landslide_for(
    positions: list[tuple[float, float]], *, now: datetime | None = None
) -> LandslideAssessment:
    """Landslide exposure for a sampled corridor.

    NEVER RAISES. A landslide source being absent, slow or broken is not a
    reason for trip planning to fail - the same rule the weather fan-out
    follows. Every failure path resolves to UNKNOWN, which is honest, rather
    than to LOW, which would be a lie about a road.
    """
    moment = now or datetime.now(UTC)
    box = corridor_box(positions)
    if box is None:
        return assess_corridor(
            IncidentQueryResult(
                state=SourceState.UNAVAILABLE if positions else SourceState.NOT_CONFIGURED,
                error="corridor_too_wide" if positions else None,
            ),
            route=positions,
        )

    provider = build_landslide_provider()
    try:
        result = await provider.incidents_near(
            box,
            since=moment - timedelta(days=INCIDENT_WINDOW_DAYS),
            until=moment,
        )
    except LandslideQueryError:
        # Our own query was malformed. Log loudly - this is a bug here, not a
        # fact about the road - but still degrade rather than 500.
        logger.warning("landslide query rejected for corridor", exc_info=True)
        result = IncidentQueryResult(
            state=SourceState.UNAVAILABLE, provider=provider.name, error="bad_query"
        )
    except Exception:  # noqa: BLE001 - one feed must not break trip planning
        logger.warning("landslide provider failed", exc_info=True)
        result = IncidentQueryResult(
            state=SourceState.UNAVAILABLE, provider=provider.name, error="provider_error"
        )

    return assess_corridor(result, route=positions)


async def history_for(
    positions: list[tuple[float, float]], *, now: datetime | None = None
) -> LandslideHistory:
    """Recorded-landslide exposure for a sampled corridor. NEVER RAISES.

    Its own function rather than a flag on `landslide_for`, because the two
    ask different sources different questions and only one of them may gate
    selection. See app/services/landslide/history.py.
    """
    box = corridor_box(positions)
    if box is None:
        return assess_history(
            IncidentQueryResult(
                state=SourceState.UNAVAILABLE if positions else SourceState.NOT_CONFIGURED,
                error="corridor_too_wide" if positions else None,
            ),
            route=positions,
            now=now,
        )
    inventory = build_inventory()
    try:
        result = await inventory.events_near(box)
    except Exception:  # noqa: BLE001 - one file must not break trip planning
        logger.warning("landslide inventory failed", exc_info=True)
        result = IncidentQueryResult(
            state=SourceState.UNAVAILABLE, provider=inventory.name, error="inventory_error"
        )
    return assess_history(result, route=positions, now=now)


async def _route_facts(
    db: AsyncSession, route_id: uuid.UUID
) -> tuple[str, Decimal | None, int | None]:
    """Geometry, distance and duration for one route, in one statement."""
    row = (
        await db.execute(
            select(
                func.ST_AsText(TripRoute.geometry),
                TripRoute.distance_km,
                TripRoute.estimated_duration_min,
            ).where(TripRoute.id == route_id)
        )
    ).first()
    if row is None:
        from app.core.errors import NotFoundError

        raise NotFoundError("Route not found.")
    return row[0], row[1], row[2]


async def evidence_for(route_id: uuid.UUID, geometry, positions: list[tuple[float, float]]):
    """Every evidence read an assessment uses, gathered once, in one place.

    Independent questions to independent sources, asked together. Terrain and
    river discharge are cached per route; the others are live. The ONE list:
    `route_recommendation` scores through this too, so a source wired here
    cannot be missed on the second path again (LS-7).

    Each source gets its own deadline (EVIDENCE_TIMEOUT_SECONDS). One that
    runs past it, or an external provider that raises, resolves to what its
    own failure path already returns - no weather, an UNKNOWN landslide read,
    None - so that factor reads NOT_AVAILABLE and the rest still arrives.
    Landslide and history are our own code and never raise by contract; an
    exception from them is a bug and propagates, so eligibility reads
    NOT_ASSESSED (refuse) rather than UNKNOWN (one-step approval).
    """
    timeout = get_settings().EVIDENCE_TIMEOUT_SECONDS
    failed = IncidentQueryResult(state=SourceState.UNAVAILABLE, error="provider_error")

    async def bounded(name: str, coro, fallback, *, internal: bool = False, limit: float = timeout):
        # Shielded: terrain's fetch is ONE task shared by every caller of the
        # route, so cancelling it on this caller's deadline (or the offline
        # package's) would cancel it for all of them. Past the deadline only
        # this caller stops waiting; the read finishes and fills its cache.
        task = asyncio.ensure_future(coro)
        waited = asyncio.shield(task)
        _background.add(task)

        def settle(t: asyncio.Task) -> None:
            _background.discard(t)
            # A failure after this caller stopped waiting has no one left to
            # await it: retrieve and name it here, not as asyncio's anonymous
            # "Task exception was never retrieved".
            if waited.cancelled() and not t.cancelled() and t.exception() is not None:
                logger.warning("evidence source %s failed after its deadline", name, exc_info=t.exception())

        task.add_done_callback(settle)
        try:
            return await asyncio.wait_for(waited, limit)
        except TimeoutError:
            logger.warning("evidence source %s unavailable: TimeoutError", name)
            return fallback()
        except Exception:  # noqa: BLE001 - one provider must not sink the assessment
            if internal:
                raise
            logger.warning("evidence source %s unavailable", name, exc_info=True)
            return fallback()

    return await asyncio.gather(
        # Backstop only: observations_for bounds each point at `timeout`.
        bounded("weather", observations_for(positions), list, limit=timeout + 1),
        bounded("landslide", landslide_for(positions), lambda: assess_corridor(failed, route=positions), internal=True),
        bounded("terrain", terrain_profile_for(route_id, geometry), lambda: None),
        bounded("history", history_for(positions), lambda: assess_history(failed, route=positions), internal=True),
        bounded("flood", flood_for(route_id, positions), lambda: None),
        bounded("warnings", warnings_for(route_id, positions), lambda: None),
    )


async def assess_route(db: AsyncSession, route_id: uuid.UUID) -> RouteRisk:
    """Score one persisted route against current conditions.

    Read-only. Nothing is stored: a risk score is a statement about *now*, and
    persisting one would create a number that looks current long after it
    stopped being true. The client asks again when it wants a fresh answer.
    """
    wkt, distance_km, duration_min = await _route_facts(db, route_id)
    geometry = parse_wkt_linestring(wkt)
    positions = sample_positions(geometry, ROUTE_SAMPLES)
    # NER coverage and fleet probes come from OUR database, so they are read
    # while the session is still held - before the provider fan-out below.
    # Coverage first: it decides eligibility and must fail loudly (NOT_ASSESSED),
    # while a failed probe read is swallowed and would leave the transaction
    # aborted under it.
    coverage = await geo_classify.route_coverage(db, route_id)
    probes = await traffic_service.samples_for(db, route_id)

    # Release the connection BEFORE the provider fan-out. See module docstring.
    await db.commit()

    observations, landslide, terrain, history, flood, warnings = await evidence_for(
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
        traffic=traffic_estimate(geometry=geometry, samples=probes, distance_km=distance, duration_min=duration),
        intelligence_coverage=coverage,
    ))


async def eligibility_and_evidence_for_route(
    db: AsyncSession, route_id: uuid.UUID
) -> tuple[EligibilityDecision, "LandslideAssessment | None"]:
    """The decision AND the evidence it was drawn from.

    The review-authorisation path (LS-11) needs the assessment itself, not just
    the verdict: it digests the evidence so a stale review cannot authorise
    today's mutation. Returning the assessment here keeps that digest computed
    from the SAME evidence the decision came from - deriving it a second time
    would make "the decision" and "the evidence behind it" two reads that can
    disagree.

    `None` for the assessment means no assessment was produced at all, which is
    the NOT_ASSESSED integration failure, not an UNKNOWN road.

    The assessment returned is the reading AS FAR AS IT REACHES
    (`within_coverage`): the one the decision was made on, so a review digests
    what was decided.
    """
    try:
        risk = await assess_route(db, route_id)
    except Exception:  # noqa: BLE001 - refuse rather than guess
        logger.warning("route eligibility could not be assessed", exc_info=True)
        return not_assessed(), None
    coverage = risk.intelligence_coverage
    return (
        evaluate_eligibility(landslide=risk.landslide, coverage=coverage),
        within_coverage(risk.landslide, coverage) if risk.landslide is not None else None,
    )


async def eligibility_for_route(
    db: AsyncSession, route_id: uuid.UUID
) -> EligibilityDecision:
    """THE canonical way to decide whether a route may be selected or applied.

    Trusted because the evidence is gathered HERE, server-side, from the
    route's own persisted geometry - never from anything a client sent. There
    is no parameter a caller could use to assert its own eligibility.

    Call this BEFORE taking a row lock: `assess_route` releases the database
    connection before provider I/O, and holding a lock across a hazard lookup
    would spend the database budget waiting on somebody else's server.

    A failure to assess returns NOT_ASSESSED, which REFUSES the mutation. That
    is deliberate and is the opposite of the old behaviour, where an absent
    decision silently meant "allowed".
    """
    decision, _ = await eligibility_and_evidence_for_route(db, route_id)
    return decision
