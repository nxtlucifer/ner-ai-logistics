"""Offline corridor package: everything a driver needs when the network goes.

Assembled from data this system already owns - the route it planned, the stops
it set, the risk it scored - so that a phone in a valley on NH-715 has the
journey in front of it without a single request succeeding.

OFFLINE MAP AND OFFLINE ROUTING ARE DIFFERENT PROBLEMS

Worth stating plainly because conflating them is how this feature gets
overclaimed:

    offline ROUTE     the corridor already chosen, its geometry and its stops.
                      Computed online, carried offline. THIS is what the
                      package contains, and it is genuinely useful on its own -
                      a driver following a known road needs the road, not a
                      solver.

    offline ROUTING   computing a NEW route with no network. Needs a routing
                      engine and a road graph on the device. NOT built, not
                      claimed, and not needed for the journey the driver is
                      already on.

    offline BASEMAP   the map imagery underneath. NOT included, and the reason
                      is legal rather than technical: the OSM Foundation tile
                      usage policy prohibits prefetch and "download area for
                      offline use" against tile.openstreetmap.org, which is the
                      tile source this project uses. Bulk-caching it would be a
                      policy violation dressed up as a feature. The package
                      says so in `basemap`, rather than staying quiet about a
                      gap the driver will discover in a valley.

EVERYTHING TIME-SENSITIVE IS A SNAPSHOT, AND SAYS SO

The failure this guards against is the same one the whole project keeps
guarding against, arriving through a new door: a weather panel rendered at 06:00
still reading "LIGHT RAIN" at 16:00 because the phone has had no signal since
breakfast. Every block that can go out of date carries `captured_at`, and the
package as a whole carries `captured_at` - so the app can age them on screen
using the device clock alone, with nothing to ask the server.

NOTHING IS FABRICATED TO FILL THE PACKAGE

A backup route appears only when a genuinely distinct corridor was persisted.
On a single-road corridor - most of this region - `backup_route` is null and
`reason_codes` says why. A package that invented one would be handing a driver
an escape road that does not exist, at the moment they most need it to.
"""

import hashlib
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Final

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.route_risk import RouteRisk
from app.domain.routing import parse_wkt_linestring, parse_wkt_point
from app.models.enums import RouteKind, RouteState
from app.models.operations import Trip, TripRoute, TripStop
from app.services import route_risk as route_risk_service

logger = logging.getLogger(__name__)

VERSION: Final[str] = "offline-corridor-package-v1"

#: Why the basemap is absent. A code rather than a sentence, so the driver app
#: renders it in Hindi or Assamese from local files - the same rule every other
#: reason code in this system follows.
REASON_NO_BASEMAP: Final[str] = "BASEMAP_NOT_BUNDLED_LICENCE"
REASON_NO_BACKUP: Final[str] = "NO_DISTINCT_BACKUP_CORRIDOR"
REASON_NO_SELECTED_ROUTE: Final[str] = "NO_ROUTE_SELECTED"
REASON_RISK_UNAVAILABLE: Final[str] = "RISK_SNAPSHOT_UNAVAILABLE"

#: What the app must be told about the basemap, once, in structured form.
#:
#: `BUNDLED_NONE` is not a TODO. It is the correct answer under the tile policy
#: this project's map source publishes, and the honest thing to send is the
#: answer plus the reason - not silence, and not a promise the next release will
#: fix it.
BASEMAP_BUNDLED_NONE: Final[str] = "BUNDLED_NONE"


@dataclass(frozen=True)
class OfflineRoute:
    """One corridor, as coordinates a phone can draw with no network."""

    route_id: uuid.UUID
    kind: RouteKind
    distance_km: float | None
    estimated_duration_min: int | None
    #: [[lat, lon], ...] in travel order.
    geometry: list[list[float]]


@dataclass(frozen=True)
class OfflineStop:
    stop_id: uuid.UUID
    sequence: int
    kind: str
    name: str | None
    address: str | None
    lat: float | None
    lon: float | None


@dataclass(frozen=True)
class OfflinePackage:
    """A whole journey, carried offline, with every staleness stated.

    `package_hash` is a digest of the parts that do NOT expire - identity,
    stops, route geometry. A device compares it to decide whether to re-download
    the corridor at all. It deliberately excludes the risk snapshot, because
    otherwise the package would appear to change every time the weather did,
    and a driver on a thin connection would re-download a route that had not
    moved.
    """

    trip_id: uuid.UUID
    trip_code: str
    captured_at: datetime
    selected_route: OfflineRoute | None
    backup_route: OfflineRoute | None
    stops: tuple[OfflineStop, ...]
    #: Scored when the package was built. NEVER live, and the app must render
    #: it against `risk_captured_at` rather than as a current reading.
    risk: RouteRisk | None
    risk_captured_at: datetime | None
    basemap: str = BASEMAP_BUNDLED_NONE
    reason_codes: tuple[str, ...] = field(default_factory=tuple)
    package_hash: str = ""
    version: str = VERSION


def _geometry_from_wkt(wkt: str) -> list[list[float]]:
    """WKT LINESTRING -> [[lat, lon], ...].

    Reuses the domain parser rather than splitting the string here, so the
    lon/lat ordering is decided in exactly one place. Getting that backwards is
    the most common spatial bug there is and it fails silently on a map.
    """
    return [[lat, lon] for lat, lon in parse_wkt_linestring(wkt)]


def _hash(payload: dict) -> str:
    """A stable digest of the durable parts of a package.

    `sort_keys` because a dict that serialises in a different order is the same
    package, and a hash that changed with key order would make every fetch look
    like a change.
    """
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


async def _routes_for(
    db: AsyncSession, trip: Trip
) -> tuple[OfflineRoute | None, OfflineRoute | None]:
    """The selected corridor and a real backup, if one exists.

    Ordered by nothing and matched explicitly: the selected route is the one
    the trip points at, and the backup is a live EMERGENCY_BACKUP that is not
    it. No fallback to "whatever else is there" - a superseded corridor handed
    to a driver as an escape road is worse than no escape road.
    """
    rows = (
        await db.execute(
            select(
                TripRoute.id,
                TripRoute.kind,
                TripRoute.distance_km,
                TripRoute.estimated_duration_min,
                func.ST_AsText(TripRoute.geometry),
            ).where(
                TripRoute.trip_id == trip.id,
                TripRoute.state.in_((RouteState.PROPOSED, RouteState.SELECTED)),
            )
        )
    ).all()

    def build(row) -> OfflineRoute:
        return OfflineRoute(
            route_id=row[0],
            kind=row[1],
            distance_km=float(row[2]) if row[2] is not None else None,
            estimated_duration_min=row[3],
            geometry=_geometry_from_wkt(row[4]),
        )

    selected = next((build(r) for r in rows if r[0] == trip.selected_route_id), None)
    backup = next(
        (
            build(r)
            for r in rows
            if r[1] is RouteKind.EMERGENCY_BACKUP and r[0] != trip.selected_route_id
        ),
        None,
    )
    return selected, backup


async def _stops_for(db: AsyncSession, trip_id: uuid.UUID) -> tuple[OfflineStop, ...]:
    """Every stop on the trip, in order. DELIBERATELY UNLIMITED.

    Reviewed and accepted rather than capped. A LIMIT here would silently drop
    a driver's last stops from the package they rely on offline, which is a
    far worse failure than a large download - the point of the package is that
    it is complete.

    Served by `uq_trip_stops_sequence (trip_id, sequence)`, which satisfies both
    the filter and the ORDER BY, so this is an index-ordered scan rather than a
    sort.

    The count is not bounded by the product model today - `TripPlanTrip.stops`
    carries no `max_length` - so a manager could in principle plan a trip with
    thousands of stops and inflate the package. If that ever matters the fix
    belongs at the DOOR, as a `max_length` on the request schema, not here:
    bound what may be created, never truncate what was.
    """
    rows = (
        await db.execute(
            select(
                TripStop.id,
                TripStop.sequence,
                TripStop.kind,
                TripStop.name,
                TripStop.address,
                # ST_AsText and parse, the convention the rest of this codebase
                # follows: the lon/lat swap happens in one function instead of
                # once per query.
                func.ST_AsText(TripStop.location),
            )
            .where(TripStop.trip_id == trip_id)
            .order_by(TripStop.sequence.asc())
        )
    ).all()
    def build(row) -> OfflineStop:
        lat, lon = parse_wkt_point(row[5]) if row[5] else (None, None)
        return OfflineStop(
            stop_id=row[0],
            sequence=row[1],
            kind=row[2].value,
            name=row[3],
            address=row[4],
            lat=lat,
            lon=lon,
        )

    return tuple(build(r) for r in rows)


async def build_for_trip(db: AsyncSession, trip: Trip) -> OfflinePackage:
    """Assemble the whole corridor for one trip.

    The risk snapshot is scored LAST and its failure is absorbed: a weather
    provider having a bad minute must not stop a driver downloading the route
    they are about to drive, which is the part that cannot be recomputed on the
    roadside. The package returns with `risk: null` and a reason code instead.

    Scoring the route releases the database connection - see
    `route_risk.assess_route` - so everything that needs the database is read
    BEFORE that call, and nothing after it touches the session.
    """
    now = datetime.now(UTC)
    codes: list[str] = [REASON_NO_BASEMAP]

    selected, backup = await _routes_for(db, trip)
    stops = await _stops_for(db, trip.id)

    if selected is None:
        codes.append(REASON_NO_SELECTED_ROUTE)
    if backup is None:
        codes.append(REASON_NO_BACKUP)

    durable = {
        "trip_id": str(trip.id),
        "trip_code": trip.trip_code,
        "selected_route_id": str(selected.route_id) if selected else None,
        "selected_geometry": selected.geometry if selected else None,
        "backup_route_id": str(backup.route_id) if backup else None,
        "backup_geometry": backup.geometry if backup else None,
        "stops": [
            [str(s.stop_id), s.sequence, s.lat, s.lon] for s in stops
        ],
    }

    risk: RouteRisk | None = None
    risk_captured_at: datetime | None = None
    if selected is not None:
        try:
            # LAST, and after every other read: this ends the transaction.
            risk = await route_risk_service.assess_route(db, selected.route_id)
            risk_captured_at = risk.assessed_at
        except Exception:  # noqa: BLE001
            # Deliberately broad: the driver's need is the ROUTE, and a risk
            # score that cannot be produced is a missing field rather than a
            # failed download.
            #
            # Logged with a traceback all the same. A bare `pass` here would
            # swallow an AttributeError in this module just as quietly as a
            # weather timeout, and the two need very different responses - one
            # is a free API having a bad minute, the other is a bug that would
            # then only ever surface as a field that is mysteriously always
            # absent.
            logger.exception(
                "risk snapshot failed for route %s; package returned without it",
                selected.route_id,
            )
            codes.append(REASON_RISK_UNAVAILABLE)

    return OfflinePackage(
        trip_id=trip.id,
        trip_code=trip.trip_code,
        captured_at=now,
        selected_route=selected,
        backup_route=backup,
        stops=stops,
        risk=risk,
        risk_captured_at=risk_captured_at,
        reason_codes=tuple(dict.fromkeys(codes)),
        package_hash=_hash(durable),
    )
