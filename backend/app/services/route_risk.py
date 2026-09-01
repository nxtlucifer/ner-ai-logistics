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
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.domain.route_risk import RouteRisk, assess
from app.domain.routing import parse_wkt_linestring, sample_positions
from app.domain.weather import WeatherError, WeatherObservation
from app.models.operations import TripRoute
from app.services.weather import OpenMeteoWeatherProvider

logger = logging.getLogger(__name__)

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
    results = await asyncio.gather(
        *(provider.current(lat, lon) for lat, lon in positions),
        return_exceptions=True,
    )

    observations: list[WeatherObservation] = []
    for position, result in zip(positions, results, strict=True):
        if isinstance(result, WeatherObservation):
            observations.append(result)
        elif isinstance(result, WeatherError):
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


async def assess_route(db: AsyncSession, route_id: uuid.UUID) -> RouteRisk:
    """Score one persisted route against current conditions.

    Read-only. Nothing is stored: a risk score is a statement about *now*, and
    persisting one would create a number that looks current long after it
    stopped being true. The client asks again when it wants a fresh answer.
    """
    wkt, distance_km, duration_min = await _route_facts(db, route_id)
    geometry = parse_wkt_linestring(wkt)
    positions = sample_positions(geometry, ROUTE_SAMPLES)

    # Release the connection BEFORE the provider fan-out. See module docstring.
    await db.commit()

    observations = await observations_for(positions)

    return assess(
        distance_km=float(distance_km) if distance_km is not None else 0.0,
        duration_min=float(duration_min) if duration_min is not None else 0.0,
        observations=observations,
    )
