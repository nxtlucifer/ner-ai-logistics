"""The turn instructions for the route a driver was actually given.

WHAT THIS IS FOR

A polyline tells a driver where the road goes. It does not tell them to take
the second exit. This assembles the one thing a next-turn panel needs and
cannot safely derive on its own: the provider's own maneuvers, tied to the
geometry of the route the trip is currently assigned.

WHY IT IS NOT DERIVED FROM THE LINE

Nothing here infers a turn from geometry, and the temptation to is real: the
selected corridor is a 52-vertex overview, its corners look like junctions, and
interpolating between them would produce something that renders. It would also
be fiction. A simplified overview has vertices where the encoder put them, and
"the line bends here" is not "turn right at the roundabout". A route without
stored maneuvers reports guidance UNAVAILABLE and keeps its overview, which is
the honest failure.

THE PACKAGE IS BOUND TO ONE ROUTE

`route_id` and `route_revision` identify exactly which corridor these
instructions describe. The client sends the revision back with any cached
package and the server refuses a mismatch, so directions from a superseded
route can never be drawn over a newly accepted one - the failure mode that
matters most here, because it is silent and looks correct.

DISTANCE TO A TURN IS NOT A STEP LENGTH

The subtle one, and the reason this module exists rather than the client
reading `trip_routes.maneuvers` directly.

OSRM's `step.distance` is "the distance of travel from the maneuver to the
subsequent step's maneuver" - it measures FORWARD from its own maneuver. It is
therefore NOT the answer to "how far until I turn". A panel rendering it as
such is wrong by one step, which on the Guwahati sample below means announcing
1,415 m for a turn that is 257 m away.

Verified against the provider rather than taken from the documentation. One
5,942 m route through Guwahati returns 17 steps whose distances sum to 5,942.5 m
and whose final `arrive` step is **0.0 m**. A backward-measured step could not
be zero at arrival, and the sum could not close.

So each maneuver is published with `distance_from_start_m`: the distance along
this route from its beginning to that maneuver, accumulated from the provider's
own step distances. Distance to the next turn is then

    distance_from_start_m - distance_already_travelled

which is remaining path length, needs no step arithmetic on the client, and has
no off-by-one to get wrong. `step_distance_m` is published too, labelled as what
it is, because leg lengths are legitimately useful - but the field a panel wants
is the cumulative one.

NO ETA

`duration_s` is the provider's free-flow figure and is labelled as such,
consistent with `app/domain/route_progress.py`. It is not an arrival time and
nothing here converts it into one.
"""

import hashlib
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.routing import parse_wkt_linestring
from app.models.enums import RouteState
from app.models.operations import Trip, TripRoute

logger = logging.getLogger(__name__)

VERSION: Final[str] = "navigation-package-v1"

#: No current route is assigned, so there is nothing to navigate. Distinct from
#: having a route whose directions are missing - one is "not dispatched yet",
#: the other is "dispatched, but this corridor cannot drive guidance", and a
#: driver needs to be told which.
REASON_NO_SELECTED_ROUTE: Final[str] = "NO_SELECTED_ROUTE"

#: The selected route carries no stored maneuvers. NOT "this road has no turns".
REASON_GUIDANCE_NOT_AVAILABLE: Final[str] = "GUIDANCE_NOT_AVAILABLE"

#: Stored maneuvers exist but do not describe this geometry. Refused rather
#: than rendered - see `_maneuvers_from_json`.
REASON_GUIDANCE_INCONSISTENT: Final[str] = "GUIDANCE_INCONSISTENT_WITH_ROUTE"

#: `duration_s` is free-flow provider time, not an arrival estimate. Always
#: present when a duration is, so a screen cannot show the number without the
#: caveat travelling beside it.
REASON_DURATION_IS_FREE_FLOW: Final[str] = "DURATION_IS_FREE_FLOW_NOT_AN_ETA"


@dataclass(frozen=True)
class NavigationManeuver:
    """One instruction, positioned along this route."""

    #: Provider verb: turn, merge, roundabout, arrive, depart, fork.
    type: str
    modifier: str | None
    lat: float
    lon: float
    #: Where the maneuver point falls in `geometry`.
    geometry_index: int
    #: Distance along the route from its start to this maneuver. THIS is what a
    #: next-turn panel subtracts travelled distance from.
    distance_from_start_m: float
    #: Distance from this maneuver to the next. 0.0 at arrival. Published for
    #: leg display; not the distance to this turn.
    step_distance_m: float
    #: Free-flow seconds for that leg. Not an ETA.
    duration_s: float | None
    name: str | None
    exit: int | None


@dataclass(frozen=True)
class NavigationPackage:
    """Everything needed to drive one route, and what is missing when it is."""

    trip_id: uuid.UUID
    trip_code: str
    route_id: uuid.UUID | None
    #: Digest over the geometry and maneuvers. Changes when, and only when, the
    #: thing being navigated changes - so a client can cache against it.
    route_revision: str | None
    available: bool
    reason_codes: tuple[str, ...]
    #: [(lat, lon), ...] in travel order. Same ordering as the rest of the API.
    geometry: list[list[float]]
    maneuvers: tuple[NavigationManeuver, ...]
    distance_m: float | None
    #: Provider free-flow duration. NOT an ETA - see REASON_DURATION_IS_FREE_FLOW.
    duration_s: float | None
    provider: str | None
    provider_route_id: str | None
    #: When this package was assembled. Distinct from when the route was
    #: approved and from how fresh any location fix is.
    captured_at: datetime
    coordinate_format: str = "lat_lon"
    distance_unit: str = "m"
    duration_unit: str = "s"
    version: str = VERSION


def _revision(geometry: list[list[float]], maneuvers: list[dict] | None) -> str:
    """Digest of what is actually being navigated.

    Geometry and maneuvers only. Risk scores, weather and stop names change on
    their own schedule and do not alter the road being driven; folding them in
    would invalidate a cached package every time the forecast moved.
    """
    return hashlib.sha256(
        json.dumps(
            {"geometry": geometry, "maneuvers": maneuvers},
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()


def _maneuvers_from_json(
    stored: list | None, geometry_points: int
) -> tuple[tuple[NavigationManeuver, ...], tuple[str, ...]]:
    """Stored JSONB -> positioned maneuvers, or nothing with a reason.

    All or nothing. A partial set is worse than none: it runs out mid-journey
    and the last instruction reads as an arrival.

    `distance_from_start_m` accumulates the provider's own forward-measured step
    distances, so maneuver 0 (depart) is at 0.0 and each subsequent one is the
    sum of the steps before it. That arithmetic is exact - OSRM's step distances
    sum to the route distance - which is why it is preferred to walking the
    polyline with haversine.

    Reads `step_distance_m` and falls back to the old `distance_m` key, because
    rows written before the field was renamed are still valid data. The name was
    wrong; the number never was.
    """
    if stored is None:
        return (), (REASON_GUIDANCE_NOT_AVAILABLE,)
    if not isinstance(stored, list) or not stored:
        # An empty list is not "no turns" - a persisted route always has at
        # least a depart and an arrive. It means something wrote a shape this
        # code does not understand.
        return (), (REASON_GUIDANCE_INCONSISTENT,)

    out: list[NavigationManeuver] = []
    cumulative = 0.0
    for entry in stored:
        if not isinstance(entry, dict):
            return (), (REASON_GUIDANCE_INCONSISTENT,)
        try:
            index = int(entry["geometry_index"])
            lat = float(entry["lat"])
            lon = float(entry["lon"])
            step = float(
                entry.get("step_distance_m", entry.get("distance_m", 0.0)) or 0.0
            )
        except (KeyError, TypeError, ValueError):
            return (), (REASON_GUIDANCE_INCONSISTENT,)

        # The index must address THIS geometry. A maneuver pointing past the end
        # of the line is the signature of directions belonging to a different
        # route, which is the one thing this package must never render.
        if not 0 <= index < geometry_points:
            return (), (REASON_GUIDANCE_INCONSISTENT,)
        if step < 0:
            return (), (REASON_GUIDANCE_INCONSISTENT,)

        duration = entry.get("duration_s")
        exit_number = entry.get("exit")
        out.append(
            NavigationManeuver(
                type=str(entry.get("type") or "unknown"),
                modifier=(
                    str(entry["modifier"]) if entry.get("modifier") else None
                ),
                lat=lat,
                lon=lon,
                geometry_index=index,
                distance_from_start_m=cumulative,
                step_distance_m=step,
                duration_s=(
                    float(duration) if isinstance(duration, (int, float)) else None
                ),
                name=str(entry["name"]) if entry.get("name") else None,
                exit=int(exit_number) if isinstance(exit_number, int) else None,
            )
        )
        cumulative += step

    # Maneuvers are in travel order, so their indexes must not go backwards.
    # Out-of-order steps would send a navigator to an earlier turn.
    if any(
        b.geometry_index < a.geometry_index for a, b in zip(out, out[1:], strict=False)
    ):
        return (), (REASON_GUIDANCE_INCONSISTENT,)

    return tuple(out), ()


def _unavailable(
    trip: Trip,
    *codes: str,
    route_id: uuid.UUID | None = None,
    route_revision: str | None = None,
    geometry: list[list[float]] | None = None,
    distance_m: float | None = None,
    duration_s: float | None = None,
    provider: str | None = None,
    provider_route_id: str | None = None,
) -> NavigationPackage:
    """Guidance off, overview kept.

    The geometry is deliberately still returned when there is a route. Losing
    turn instructions is not losing the road, and a map that goes blank because
    directions are missing has turned a degraded feature into a broken screen.
    """
    return NavigationPackage(
        trip_id=trip.id,
        trip_code=trip.trip_code,
        route_id=route_id,
        route_revision=route_revision,
        available=False,
        reason_codes=codes,
        geometry=geometry or [],
        maneuvers=(),
        distance_m=distance_m,
        duration_s=duration_s,
        provider=provider,
        provider_route_id=provider_route_id,
        captured_at=datetime.now(UTC),
    )


async def build_for_trip(db: AsyncSession, trip: Trip) -> NavigationPackage:
    """The navigation package for whichever route this trip currently follows.

    Reads `trip.selected_route_id` rather than looking for a route in a
    particular lifecycle state. Which corridor is current is a fact on the trip
    row - the same source `is_current` comes from everywhere else - and deriving
    it from route state instead is how a superseded route ends up being
    navigated.
    """
    if trip.selected_route_id is None:
        return _unavailable(trip, REASON_NO_SELECTED_ROUTE)

    row = (
        await db.execute(
            select(
                TripRoute.id,
                TripRoute.state,
                TripRoute.distance_km,
                TripRoute.estimated_duration_min,
                TripRoute.maneuvers,
                TripRoute.routing_provider,
                TripRoute.provider_route_id,
                func.ST_AsText(TripRoute.geometry),
            ).where(TripRoute.id == trip.selected_route_id)
        )
    ).first()

    if row is None:
        # The trip points at a route that is not there. Reported rather than
        # crashed, because the map still has a trip to show.
        logger.warning(
            "trip %s selects route %s, which does not exist",
            trip.id,
            trip.selected_route_id,
        )
        return _unavailable(trip, REASON_NO_SELECTED_ROUTE)

    (
        route_id,
        state,
        distance_km,
        duration_min,
        stored_maneuvers,
        provider,
        provider_route_id,
        wkt,
    ) = row

    if state is RouteState.SUPERSEDED:
        # SUPERSEDED is terminal. A trip should not be pointing at one, and
        # navigating it would be following a corridor that was replaced.
        logger.warning("trip %s selects superseded route %s", trip.id, route_id)
        return _unavailable(trip, REASON_NO_SELECTED_ROUTE)

    geometry = [[lat, lon] for lat, lon in parse_wkt_linestring(wkt)]
    distance_m = float(distance_km) * 1000.0 if distance_km is not None else None
    duration_s = float(duration_min) * 60.0 if duration_min is not None else None
    revision = _revision(geometry, stored_maneuvers)

    maneuvers, refusal = _maneuvers_from_json(stored_maneuvers, len(geometry))
    if refusal:
        return _unavailable(
            trip,
            *refusal,
            route_id=route_id,
            route_revision=revision,
            geometry=geometry,
            distance_m=distance_m,
            duration_s=duration_s,
            provider=provider,
            provider_route_id=provider_route_id,
        )

    codes = (REASON_DURATION_IS_FREE_FLOW,) if duration_s is not None else ()
    return NavigationPackage(
        trip_id=trip.id,
        trip_code=trip.trip_code,
        route_id=route_id,
        route_revision=revision,
        available=True,
        reason_codes=codes,
        geometry=geometry,
        maneuvers=maneuvers,
        distance_m=distance_m,
        duration_s=duration_s,
        provider=provider,
        provider_route_id=provider_route_id,
        captured_at=datetime.now(UTC),
    )
