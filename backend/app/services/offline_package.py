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

from app.domain import weather as weather_domain
from app.domain.places import (
    BoundingBox,
    PlaceCategory,
    PlaceQueryError,
    PlacesSourceState,
    SearchAnchor,
)
from app.domain.route_risk import (
    AVAILABLE,
    FACTOR_CONNECTIVITY,
    FACTOR_ELEVATION,
    FACTOR_FLOOD,
    FACTOR_HISTORICAL_INCIDENTS,
    FACTOR_OFFICIAL_WARNINGS,
    FACTOR_WEATHER,
    RouteRisk,
)
from app.domain.routing import parse_wkt_linestring, parse_wkt_point
from app.models.enums import RouteKind, RouteState
from app.models.operations import Trip, TripRoute, TripStop
from app.services import navigation
from app.services import route_risk as route_risk_service
from app.services.places import snapshot as places_snapshot

logger = logging.getLogger(__name__)

VERSION: Final[str] = "offline-corridor-package-v2"

#: How long each block stays usable on a phone with no way to refresh it.
#:
#: These are PRODUCT decisions about a package sitting in a valley, not the
#: providers' own cache windows, and they differ from each other because the
#: things they describe age at completely different rates:
#:
#:   route       a road is where it was this morning. Long, because the
#:               geometry does not spoil - what spoils is everything travelling
#:               beside it, and each of those is aged separately below.
#:   guidance    tied to the route, and superseded only by a reroute, which the
#:               phone learns about from the trip poll rather than from age.
#:   weather     one hour, matching WEATHER_FRESH_SECONDS. The engine already
#:               refuses to SCORE an observation older than that; a driver must
#:               not be shown one as current either.
#:   warnings    an official alert carries its own `expires`; this is the
#:               fallback for the feed itself having been read a while ago.
#:   flood       daily discharge against a 30-day mean. A day.
#:   terrain     a DEM. Elevation does not change on the timescale of a trip.
#:   history     a static 2007-2017 inventory. It cannot go stale within a trip.
#:   connectivity  measured over 30 days of fleet journeys; a day-old reading
#:               of where signal dies is still a useful reading.
#:   traffic     fifteen minutes, and it is the fleet's own probes - offline it
#:               is worthless almost immediately, which is why it is short.
#:   places      a bundled OSM snapshot. It ages with releases, not with hours.
#:
#: A block past its window is not deleted and not hidden. It is marked STALE
#: and stays on screen, because a four-hour-old forecast is still the best
#: thing a driver in a valley has - as long as nothing calls it current.
DATASET_VALIDITY_SECONDS: Final[dict[str, int]] = {
    "route": 7 * 24 * 3600,
    "guidance": 7 * 24 * 3600,
    "weather": weather_domain.WEATHER_FRESH_SECONDS,
    "official_warnings": 6 * 3600,
    "flood": 24 * 3600,
    "terrain": 30 * 24 * 3600,
    "landslide_history": 30 * 24 * 3600,
    "connectivity": 24 * 3600,
    "traffic": 15 * 60,
    "places": 30 * 24 * 3600,
}

#: What a block's state can be, and what each one obliges a screen to do.
#:
#: AVAILABLE      it was captured and is inside its window.
#: STALE          captured, past its window. Show it, mark it, never call it
#:                current.
#: NOT_AVAILABLE  nobody could produce it. NOT the same as "nothing to report",
#:                and never rendered as a zero or a clear reading.
#: BUNDLED_IN_APP shipped with the build rather than downloaded, so it is
#:                always present and never ages with the package.
STATE_AVAILABLE: Final[str] = "AVAILABLE"
STATE_STALE: Final[str] = "STALE"
STATE_NOT_AVAILABLE: Final[str] = "NOT_AVAILABLE"
STATE_BUNDLED: Final[str] = "BUNDLED_IN_APP"

#: Roadside categories worth carrying into a dead zone, in the order a driver
#: in trouble needs them. Hotels are deliberately absent: a bed is a comfort
#: decision that can wait for signal, and every place carried is bytes a phone
#: on a thin connection has to download before a weak segment.
KIT_PLACE_CATEGORIES: Final[tuple[PlaceCategory, ...]] = (
    PlaceCategory.EMERGENCY,
    PlaceCategory.TYRES,
    PlaceCategory.REST,
)

#: Places per category. Bounded because this travels over a connection that is
#: about to disappear - the point of the package is to arrive before the dead
#: zone, and an unbounded list of fuel stops is how it fails to.
KIT_PLACES_PER_CATEGORY: Final[int] = 12

#: How far either side of the corridor a place still counts as roadside.
KIT_PLACE_CORRIDOR_M: Final[float] = 3_000.0

#: Why the basemap is absent. A code rather than a sentence, so the driver app
#: renders it in Hindi or Assamese from local files - the same rule every other
#: reason code in this system follows.
REASON_NO_BASEMAP: Final[str] = "BASEMAP_NOT_BUNDLED_LICENCE"
REASON_NO_BACKUP: Final[str] = "NO_DISTINCT_BACKUP_CORRIDOR"
REASON_NO_SELECTED_ROUTE: Final[str] = "NO_ROUTE_SELECTED"
REASON_RISK_UNAVAILABLE: Final[str] = "RISK_SNAPSHOT_UNAVAILABLE"

#: Emergency numbers are NOT downloaded. They are bundled in the app, in every
#: language it speaks, and they work with the radio off - see
#: driver-app/src/safety/guide.json. Shipping a second copy in this package
#: would be two catalogues of the numbers a driver calls in an emergency, and
#: two catalogues drift. The package declares where they live instead.
REASON_EMERGENCY_CONTACTS_BUNDLED: Final[str] = "EMERGENCY_CONTACTS_BUNDLED_IN_APP"

#: Roadside services could not be read. Distinct from "none are mapped here".
REASON_PLACES_UNAVAILABLE: Final[str] = "ROADSIDE_PLACES_UNAVAILABLE"

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
class OfflineManeuver:
    """One turn instruction, carried offline.

    The same shape `app/services/navigation.py` publishes, because it IS that
    package's data: the kit carries it rather than computing a second set, so
    the turns a driver follows offline and the turns they followed a minute
    earlier online cannot disagree.
    """

    type: str
    modifier: str | None
    lat: float
    lon: float
    geometry_index: int
    distance_from_start_m: float
    step_distance_m: float
    name: str | None


@dataclass(frozen=True)
class OfflinePlace:
    """One roadside service, as a phone with no network can use it."""

    provider_id: str
    category: str
    name: str | None
    lat: float
    lon: float
    phone: str | None
    #: Straight-line metres from the corridor. NEVER a driving distance.
    straight_line_m: float | None


@dataclass(frozen=True)
class OfflineDataset:
    """One block of the kit, and how far it can be trusted.

    This is the manifest the mission asks for in as many words: which safety
    datasets are stale or unavailable, visible to the driver rather than
    inferred. Every field here exists so a screen can age the block itself,
    with no network and no server clock - `captured_at` plus
    `valid_for_seconds` against the device clock is the whole computation.
    """

    name: str
    #: AVAILABLE / STALE / NOT_AVAILABLE / BUNDLED_IN_APP.
    state: str
    #: When this block was captured. Null for a bundled or absent block.
    captured_at: datetime | None
    #: How long it stays current after that. Null when it does not age.
    valid_for_seconds: int | None
    #: Who produced it, in words a dispatcher can check.
    source: str | None
    #: Why it is absent, when it is. A reason, never a silent gap.
    detail: str | None = None


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
    #: Turn instructions for the selected corridor. Empty when the route has
    #: none stored - which is "this corridor cannot drive guidance", not "this
    #: road has no turns", and `reason_codes` says which.
    maneuvers: tuple[OfflineManeuver, ...] = field(default_factory=tuple)
    #: Roadside services along the corridor, from the bundled OSM snapshot.
    places: tuple[OfflinePlace, ...] = field(default_factory=tuple)
    #: Every block of the kit with its own freshness. See `OfflineDataset`.
    datasets: tuple[OfflineDataset, ...] = field(default_factory=tuple)
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


def _dataset(
    name: str,
    *,
    available: bool,
    captured_at: datetime | None,
    now: datetime,
    source: str | None,
    detail: str | None = None,
) -> OfflineDataset:
    """One manifest row, with its state decided in one place.

    STALE is computed HERE, at capture time, against the package's own clock -
    and recomputed on the device against the device clock, because that is the
    only clock a phone in a valley has. Both answers exist on purpose: the
    server's says whether it was already stale when it was handed over, the
    device's says whether it has gone stale since.
    """
    validity = DATASET_VALIDITY_SECONDS.get(name)
    if not available:
        return OfflineDataset(
            name=name,
            state=STATE_NOT_AVAILABLE,
            captured_at=None,
            valid_for_seconds=validity,
            source=source,
            detail=detail,
        )
    state = STATE_AVAILABLE
    if captured_at is not None and validity is not None:
        age = (now - captured_at).total_seconds()
        if age > validity:
            state = STATE_STALE
    return OfflineDataset(
        name=name,
        state=state,
        captured_at=captured_at,
        valid_for_seconds=validity,
        source=source,
        detail=detail,
    )


def datasets_for(
    *,
    now: datetime,
    has_route: bool,
    guidance: bool,
    risk: RouteRisk | None,
    risk_captured_at: datetime | None,
    places_state: str | None,
) -> tuple[OfflineDataset, ...]:
    """The freshness manifest for one package. Pure, so it can be tested alone.

    Every block the driver's safety depends on appears here exactly once, with
    a state that is never inferred from silence: a provider that did not answer
    is NOT_AVAILABLE, which is a different fact from a provider that answered
    and found nothing.
    """
    inputs = risk.inputs if risk is not None else {}

    def evidence(factor: str) -> bool:
        return inputs.get(factor) == AVAILABLE

    rows = [
        _dataset(
            "route",
            available=has_route,
            captured_at=now if has_route else None,
            now=now,
            source="This service's routing provider",
            detail=None if has_route else "No route is selected for this trip.",
        ),
        _dataset(
            "guidance",
            available=guidance,
            captured_at=now if guidance else None,
            now=now,
            source="Routing provider turn instructions",
            detail=None
            if guidance
            else "This corridor has no stored turn instructions. The road still draws.",
        ),
        _dataset(
            "weather",
            available=evidence(FACTOR_WEATHER),
            captured_at=risk_captured_at,
            now=now,
            source="Open-Meteo / MET Norway",
            detail=None
            if evidence(FACTOR_WEATHER)
            else "No current observation was available for this corridor.",
        ),
        _dataset(
            "official_warnings",
            available=evidence(FACTOR_OFFICIAL_WARNINGS),
            captured_at=(
                risk.warnings.fetched_at
                if risk is not None and risk.warnings is not None
                else None
            ),
            now=now,
            source="NDMA SACHET (CAP)",
            detail=None
            if evidence(FACTOR_OFFICIAL_WARNINGS)
            else "The official alert feed could not be read.",
        ),
        _dataset(
            "flood",
            available=evidence(FACTOR_FLOOD),
            captured_at=risk_captured_at,
            now=now,
            source="GloFAS river discharge",
            detail=None if evidence(FACTOR_FLOOD) else "No discharge context for this corridor.",
        ),
        _dataset(
            "terrain",
            available=evidence(FACTOR_ELEVATION),
            captured_at=risk_captured_at,
            now=now,
            source="Copernicus DEM / OpenTopoData",
            detail=None if evidence(FACTOR_ELEVATION) else "No elevation profile for this corridor.",
        ),
        _dataset(
            "landslide_history",
            available=evidence(FACTOR_HISTORICAL_INCIDENTS),
            captured_at=risk_captured_at,
            now=now,
            source="NASA Global Landslide Catalog 2007-2017 (static inventory)",
            detail=None
            if evidence(FACTOR_HISTORICAL_INCIDENTS)
            else "The recorded-landslide inventory could not be read.",
        ),
        _dataset(
            "connectivity",
            available=evidence(FACTOR_CONNECTIVITY),
            captured_at=risk_captured_at,
            now=now,
            source="RASTA fleet telemetry (upload delay)",
            detail=None
            if evidence(FACTOR_CONNECTIVITY)
            else "No fleet phone has reported from this road recently. Signal is UNKNOWN, which is not coverage.",
        ),
        _dataset(
            "traffic",
            available=risk is not None and risk.traffic is not None and risk.traffic.is_known,
            captured_at=risk_captured_at,
            now=now,
            source="RASTA fleet telemetry (observed pace)",
            detail=None
            if risk is not None and risk.traffic is not None and risk.traffic.is_known
            else "No fleet truck has driven this road recently.",
        ),
        _dataset(
            "places",
            available=places_state == PlacesSourceState.AVAILABLE.value,
            captured_at=now if places_state == PlacesSourceState.AVAILABLE.value else None,
            now=now,
            source="OpenStreetMap corridor snapshot (bundled)",
            detail=None
            if places_state == PlacesSourceState.AVAILABLE.value
            else f"Roadside services could not be read ({places_state or 'no answer'}).",
        ),
        # Bundled, not downloaded, and therefore never stale and never absent.
        OfflineDataset(
            name="emergency_contacts",
            state=STATE_BUNDLED,
            captured_at=None,
            valid_for_seconds=None,
            source="Bundled in the driver app (112 / 108 / 1033), every language",
            detail="Works with the radio off. Not downloaded, so it cannot go stale.",
        ),
    ]
    return tuple(rows)


def _places_for(route: OfflineRoute | None) -> tuple[tuple[OfflinePlace, ...], str | None]:
    """Roadside services along the corridor, from the bundled snapshot.

    Bounded per category and filtered to the corridor, because this has to
    arrive BEFORE the dead zone: an unbounded list of every fuel stop in the
    region is how a package fails to download on the connection it is meant to
    outlive.

    Returns the places and the snapshot's own state, so the manifest can say
    "the snapshot could not be read" rather than "there are no hospitals".
    """
    if route is None or len(route.geometry) < 2:
        return (), None

    lats = [point[0] for point in route.geometry]
    lons = [point[1] for point in route.geometry]
    # A degree is ~111 km; this pads the corridor bound by roughly its width.
    pad = KIT_PLACE_CORRIDOR_M / 111_000.0
    try:
        box = BoundingBox(
            min_lat=max(-90.0, min(lats) - pad),
            min_lon=max(-180.0, min(lons) - pad),
            max_lat=min(90.0, max(lats) + pad),
            max_lon=min(180.0, max(lons) + pad),
        )
    except ValueError:
        return (), None

    corridor = [(point[0], point[1]) for point in route.geometry]
    out: list[OfflinePlace] = []
    state: str | None = None
    for category in KIT_PLACE_CATEGORIES:
        try:
            result = places_snapshot.find(
                box=box,
                category=category,
                anchor=SearchAnchor.ROUTE_CORRIDOR,
                route=corridor,
                corridor_m=KIT_PLACE_CORRIDOR_M,
                limit=KIT_PLACES_PER_CATEGORY,
            )
        except PlaceQueryError as exc:
            # A corridor wider than the lookup's own bound - a long haul across
            # several states. Reported as unavailable rather than silently
            # returning nothing, which would read as "no hospitals on this
            # road".
            logger.info("places lookup refused for the trip kit: %s", exc)
            return (), PlacesSourceState.UNAVAILABLE.value
        # Every category reads the same snapshot, so any one of them answers
        # the question "could it be read at all".
        state = result.state.value if hasattr(result.state, "value") else str(result.state)
        for place in result.places[:KIT_PLACES_PER_CATEGORY]:
            out.append(
                OfflinePlace(
                    provider_id=place.provider_id,
                    category=place.category.value,
                    name=place.name,
                    lat=place.lat,
                    lon=place.lon,
                    phone=place.contact.phone,
                    straight_line_m=place.straight_line_m,
                )
            )
    return tuple(out), state


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

    # Turn instructions for the corridor, carried rather than recomputed.
    # Read BEFORE the risk assessment, which ends the transaction.
    maneuvers: tuple[OfflineManeuver, ...] = ()
    guidance_codes: tuple[str, ...] = ()
    if selected is not None:
        navigation_package = await navigation.build_for_trip(db, trip)
        if navigation_package.route_id == selected.route_id:
            maneuvers = tuple(
                OfflineManeuver(
                    type=m.type,
                    modifier=m.modifier,
                    lat=m.lat,
                    lon=m.lon,
                    geometry_index=m.geometry_index,
                    distance_from_start_m=m.distance_from_start_m,
                    step_distance_m=m.step_distance_m,
                    name=m.name,
                )
                for m in navigation_package.maneuvers
            )
            if not navigation_package.available:
                guidance_codes = navigation_package.reason_codes
        else:
            # The trip moved under us between reads. Carrying the other
            # corridor's turns is the one thing never to do.
            guidance_codes = (navigation.REASON_GUIDANCE_INCONSISTENT,)
    codes.extend(guidance_codes)

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

    # Roadside services come from a BUNDLED snapshot, so this reads no
    # database and no network - safe after the transaction has ended.
    places, places_state = _places_for(selected)
    if places_state is not None and places_state != PlacesSourceState.AVAILABLE.value:
        codes.append(REASON_PLACES_UNAVAILABLE)
    codes.append(REASON_EMERGENCY_CONTACTS_BUNDLED)

    return OfflinePackage(
        trip_id=trip.id,
        trip_code=trip.trip_code,
        captured_at=now,
        selected_route=selected,
        backup_route=backup,
        stops=stops,
        risk=risk,
        risk_captured_at=risk_captured_at,
        maneuvers=maneuvers,
        places=places,
        datasets=datasets_for(
            now=now,
            has_route=selected is not None,
            guidance=bool(maneuvers),
            risk=risk,
            risk_captured_at=risk_captured_at,
            places_state=places_state,
        ),
        reason_codes=tuple(dict.fromkeys(codes)),
        package_hash=_hash(durable),
    )
