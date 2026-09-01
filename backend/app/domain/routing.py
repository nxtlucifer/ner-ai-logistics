"""Normalised routing model, independent of any provider.

Deterministic application logic. No I/O, no provider SDK, no model.

WHY A NORMALISED SHAPE

Every routing provider returns a different envelope: OSRM says `duration` in
seconds and `distance` in metres, ORS nests both under `summary`, Mapbox uses
`routes[].legs[]`, Google returns encoded polylines and its own status strings.
If the trip service consumed any of those directly, swapping provider would mean
editing business logic, and a provider outage would mean the feature is simply
gone.

So providers return `RouteCandidate` and nothing else. The rest of the
application never learns which provider answered - except through
`provider`/`provider_route_id`, which exist to trace a displayed number back to
what produced it.

WHAT THIS DELIBERATELY DOES NOT CARRY

No ETA, no fuel litres, no risk score. Those are not routing outputs:

  ETA needs departure time, traffic and stop dwell - none of which a provider
  distance/duration pair supplies. A "duration" is free-flow travel time, and
  presenting it as an arrival time would be inventing evidence.

  Fuel needs a consumption model. `docs/AI_MODELS.md` §0 and the
  `trip_routes.estimated_fuel_litres` column comment both say the same thing:
  NULL means no estimate is available, and it is never defaulted to zero.

`duration_s` is carried because providers do supply it and it is honest as
"free-flow travel time". Turning it into an arrival time is a separate decision
that requires evidence this subsystem does not have.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Final

from app.models.enums import RouteKind

#: A route with fewer points than this is not a road geometry - it is a straight
#: line between the endpoints, which is what several providers return when they
#: cannot route at all. Rendering it would draw a truck through a river.
MIN_GEOMETRY_POINTS: Final[int] = 2

#: Guards against a provider returning an implausible corridor. NER trips are
#: hundreds of kilometres; ten thousand means something went wrong upstream.
MAX_PLAUSIBLE_DISTANCE_M: Final[float] = 10_000_000.0


EARTH_RADIUS_M: Final[float] = 6_371_000.0

#: Maximum separation below which two routes are the same corridor.
#:
#: Two kilometres, because the question being answered is "would a driver
#: sent down this route be somewhere materially different?" - not "do the
#: polylines differ", which they always do by a few metres. Below this, calling
#: the second one an EMERGENCY_BACKUP would be labelling the same road twice.
DISTINCT_CORRIDOR_M: Final[float] = 2_000.0

#: Points sampled along each route when comparing corridors. Enough to catch a
#: divergence in the middle, cheap enough to run per plan.
CORRIDOR_SAMPLES: Final[int] = 12


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres.

    Lives in the domain because it is pure geometry with no I/O, and two
    subsystems need it - telemetry's plausibility check and route corridor
    comparison. Keeping one copy means a fix reaches both.
    """
    import math

    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def _sample(geometry: list[tuple[float, float]], count: int) -> list[tuple[float, float]]:
    """`count` points spread evenly along a polyline by index."""
    if len(geometry) <= count:
        return list(geometry)
    step = (len(geometry) - 1) / (count - 1)
    return [geometry[int(round(i * step))] for i in range(count)]


def sample_positions(
    geometry: list[tuple[float, float]], count: int
) -> list[tuple[float, float]]:
    """`count` points spread along a route, for asking about conditions.

    Public counterpart of the private sampler `is_distinct_corridor` uses. Same
    even-by-index spread: exact spacing does not matter for weather, which
    varies over tens of kilometres, and index sampling needs no cumulative
    distance pass over a geometry that may hold thousands of points.
    """
    if count <= 0:
        return []
    if count == 1:
        return list(geometry[:1])
    return _sample(geometry, count)


def parse_wkt_linestring(wkt: str) -> list[tuple[float, float]]:
    """A PostGIS LINESTRING as (lat, lon) pairs.

    WKT is lon-lat and the rest of this application is lat-lon, so the swap
    happens here, once, rather than at every call site. `to_wkt()` above is the
    inverse and the two are deliberately adjacent - the lon/lat inversion is
    the most common spatial bug there is, and keeping both directions in one
    place is what makes it checkable.
    """
    inner = wkt[wkt.index("(") + 1 : wkt.rindex(")")]
    points: list[tuple[float, float]] = []
    for pair in inner.split(","):
        lon_text, lat_text = pair.split()
        points.append((float(lat_text), float(lon_text)))
    return points


def is_distinct_corridor(
    a: "RouteCandidate", b: "RouteCandidate", *, threshold_m: float = DISTINCT_CORRIDOR_M
) -> bool:
    """Whether two routes are different enough to be called different routes.

    Sampled point-to-point separation, taking the maximum. A provider may return
    an "alternative" that rejoins the same highway after a two-hundred-metre
    detour around a roundabout; persisting that as an EMERGENCY_BACKUP would put
    a second option in front of a dispatcher that is not actually an option.
    Only a genuinely separate corridor earns the label.

    Compared by position rather than by distance totals, because two routes can
    share a length and go different ways - and a backup route's whole value is
    going a different way.
    """
    sa, sb = _sample(a.geometry, CORRIDOR_SAMPLES), _sample(b.geometry, CORRIDOR_SAMPLES)
    pairs = min(len(sa), len(sb))
    if pairs < 2:
        return False
    return any(
        haversine_m(sa[i][0], sa[i][1], sb[i][0], sb[i][1]) >= threshold_m
        for i in range(pairs)
    )


class RoutingError(Exception):
    """Base for every routing failure, so callers catch one thing."""


class RoutingUnavailable(RoutingError):
    """The provider could not be reached, timed out, or returned 5xx.

    Retryable in principle, and the reason a fallback provider exists.
    """


class RoutingRejected(RoutingError):
    """The provider was reached and refused: no route exists, bad coordinates.

    NOT retryable and NOT a reason to try the fallback - a second provider will
    also fail to route from a point in the sea. Distinguishing this from
    `RoutingUnavailable` is what stops a fallback chain from spending every
    provider's budget on a request that cannot succeed.
    """


class RoutingMalformed(RoutingError):
    """The provider answered, but not with something usable.

    Treated as unavailable for fallback purposes - a provider returning
    nonsense is as useful as one that is down - but kept distinct so it can be
    logged as a provider defect rather than an outage.
    """


@dataclass(frozen=True)
class Coordinate:
    """WGS84 point. Same lat/lon ordering as the rest of the API."""

    lat: float
    lon: float


@dataclass(frozen=True)
class RouteCandidate:
    """One route option, normalised.

    Frozen because a candidate is evidence of what a provider said at a moment.
    Scoring and persistence derive from it; nothing edits it in place.
    """

    kind: RouteKind
    provider: str
    #: [(lat, lon), ...] in travel order. Stored as a LineString by the service.
    geometry: list[tuple[float, float]]
    distance_m: float
    #: Free-flow travel time. NOT an ETA - see the module docstring.
    duration_s: float | None
    provider_route_id: str | None = None
    #: Provider notes worth surfacing (toll, ferry, restricted). Bounded, since
    #: it is persisted and a provider could otherwise return unbounded text.
    warnings: tuple[str, ...] = ()
    #: Bounded provider metadata, for tracing a number back to its source.
    metadata: dict[str, str] = field(default_factory=dict)
    fetched_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def __post_init__(self) -> None:
        if len(self.geometry) < MIN_GEOMETRY_POINTS:
            raise RoutingMalformed(
                f"route geometry has {len(self.geometry)} points; "
                f"at least {MIN_GEOMETRY_POINTS} are needed to draw a line"
            )
        if not (0 < self.distance_m <= MAX_PLAUSIBLE_DISTANCE_M):
            raise RoutingMalformed(
                f"route distance {self.distance_m} m is not plausible"
            )
        if self.duration_s is not None and self.duration_s < 0:
            raise RoutingMalformed(f"negative duration {self.duration_s}")
        for lat, lon in self.geometry:
            if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
                raise RoutingMalformed(
                    "route geometry contains an out-of-range coordinate; "
                    "this is the shape of a latitude/longitude inversion"
                )

    @property
    def distance_km(self) -> Decimal:
        """Kilometres, quantised to the two decimals `trip_routes` stores."""
        return Decimal(str(round(self.distance_m / 1000.0, 2)))

    @property
    def duration_min(self) -> int | None:
        """Whole minutes, or None when the provider gave no duration.

        None is a legitimate value meaning "not available" and must render as
        such. It is never zero.
        """
        if self.duration_s is None:
            return None
        return int(round(self.duration_s / 60.0))

    def to_wkt(self) -> str:
        """LINESTRING for PostGIS, in lon-lat order.

        WKT is x-then-y, so longitude comes first - the opposite of how the
        pair is spoken and stored above. One conversion, in one place, for the
        same reason `Coordinate.to_wkt` in app/schemas/common.py is the only
        place a point is inverted.
        """
        points = ", ".join(f"{lon} {lat}" for lat, lon in self.geometry)
        return f"LINESTRING({points})"
