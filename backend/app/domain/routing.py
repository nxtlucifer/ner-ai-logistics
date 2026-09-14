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
    """`count` points spread along a route BY DISTANCE, for asking conditions.

    By distance, not by index, and the difference is not academic. This project
    asks OSRM for `overview=simplified`, which keeps more vertices where the
    road bends and few on long straight legs - so on a NER corridor the
    vertices crowd into the hills. Sampling by index then follows them there.

    Measured on a corridor shaped like that: index sampling put FOUR of five
    points inside the first 43.6 km of a 263.7 km route, leaving 220 km - 83%
    of it - represented by a single reading. `route_risk` scores from these
    samples, and the recommendation and reroute assessment score from that, so
    a storm sitting on the unsampled stretch would be seen once out of five
    times and scored as if it were a local shower.

    The docstring this replaces argued that exact spacing does not matter
    because weather varies over tens of kilometres. That is true of mild
    unevenness and false of a 4-in-17% cluster. It also worried about a
    cumulative pass over "thousands of points" - but `simplified` returns
    hundreds, and one O(n) walk is nothing beside the five HTTP requests these
    samples exist to make.

    Endpoints are always included: origin and destination are the two places a
    dispatcher assumes were looked at.

    `is_distinct_corridor` deliberately still uses the by-index sampler. It
    compares two routes against each other rather than covering one, and its
    threshold is tuned against that behaviour.
    """
    if count <= 0:
        return []
    if not geometry:
        return []
    if count == 1:
        return list(geometry[:1])
    if len(geometry) <= count:
        return list(geometry)

    cumulative = [0.0]
    for i in range(1, len(geometry)):
        cumulative.append(
            cumulative[-1]
            + haversine_m(
                geometry[i - 1][0], geometry[i - 1][1], geometry[i][0], geometry[i][1]
            )
        )
    total = cumulative[-1]
    if total <= 0:
        # Every vertex in the same place. Nothing to spread along, and the
        # by-index answer is as good as any.
        return _sample(geometry, count)

    out: list[tuple[float, float]] = []
    cursor = 0
    for i in range(count):
        target = total * i / (count - 1)
        while cursor + 1 < len(geometry) and cumulative[cursor + 1] < target:
            cursor += 1
        if cursor + 1 >= len(geometry):
            out.append(geometry[-1])
            continue

        # INTERPOLATED along the segment, not snapped to the nearer vertex.
        # Snapping seems tidier - every sample is then a point the provider
        # literally returned - but on a sparse leg it collapses: with no vertex
        # between 128 km and 263 km, two different targets snap to the same
        # endpoint and one of five weather requests is spent asking about a
        # place already asked about. An interpolated point is still ON the
        # route, and where it is on the road is the only thing the weather
        # query cares about.
        #
        # Linear in degrees rather than great-circle. Over a segment of this
        # length at 26 N the two differ by a few hundred metres, which is far
        # inside the scale weather varies on.
        span = cumulative[cursor + 1] - cumulative[cursor]
        t = 0.0 if span <= 0 else (target - cumulative[cursor]) / span
        lat_a, lon_a = geometry[cursor]
        lat_b, lon_b = geometry[cursor + 1]
        out.append((lat_a + t * (lat_b - lat_a), lon_a + t * (lon_b - lon_a)))
    return out


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


def parse_wkt_point(wkt: str) -> tuple[float, float]:
    """A PostGIS POINT as (lat, lon).

    Same swap and the same reason as `parse_wkt_linestring`: WKT is lon-lat and
    this application is lat-lon. Kept here beside it rather than inline at each
    call site, because two hand-rolled parsers eventually disagree and the way
    they disagree is by putting a truck in the Arctic Ocean.
    """
    inner = wkt[wkt.index("(") + 1 : wkt.rindex(")")]
    lon_text, lat_text = inner.split()[0], inner.split()[1]
    return float(lat_text), float(lon_text)


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


#: How far a provider's route may start or end from the point it was asked
#: for. OSRM snaps to the nearest routable way, and a depot behind a gate is a
#: few hundred metres from it - never tens of kilometres.
ENDPOINT_TOLERANCE_M: Final[float] = 10_000.0
#: A road is longer than the straight line between its ends, in hills much
#: longer, but not without bound. Ratio plus an additive slack, so a 2 km hop
#: whose bridge is 8 km upstream is not refused on ratio alone.
MAX_DETOUR_RATIO: Final[float] = 3.0
DETOUR_SLACK_M: Final[float] = 20_000.0

REASON_STARTS_AWAY_FROM_ORIGIN: Final[str] = "ROUTE_STARTS_AWAY_FROM_ORIGIN"
REASON_ENDS_AWAY_FROM_DESTINATION: Final[str] = "ROUTE_ENDS_AWAY_FROM_DESTINATION"
REASON_SHORTER_THAN_STRAIGHT_LINE: Final[str] = "ROUTE_SHORTER_THAN_STRAIGHT_LINE"
REASON_IMPLAUSIBLY_LONG: Final[str] = "ROUTE_IMPLAUSIBLY_LONG"


def endpoint_mismatch(
    candidate: "RouteCandidate", origin: "Coordinate", destination: "Coordinate"
) -> str | None:
    """Why a provider's answer does not describe the journey asked for, or None.

    Guards the shapes a wrong route takes: a polyline that starts or ends away
    from the stops (a swapped pair, a reroute origin used by mistake, a route
    from the previous request), a truncated line shorter than the straight
    line, or a distance no road between these two points can have.

    It deliberately does NOT judge whether the journey itself is sensible. The
    2,908 km route on TRP-08726C5F passed every one of these checks because it
    really did connect its two stops; that trip's problem was the stops, and
    the planner refuses those before a route is ever requested.
    """
    first, last = candidate.geometry[0], candidate.geometry[-1]
    if haversine_m(first[0], first[1], origin.lat, origin.lon) > ENDPOINT_TOLERANCE_M:
        return REASON_STARTS_AWAY_FROM_ORIGIN
    if haversine_m(last[0], last[1], destination.lat, destination.lon) > ENDPOINT_TOLERANCE_M:
        return REASON_ENDS_AWAY_FROM_DESTINATION
    straight = haversine_m(origin.lat, origin.lon, destination.lat, destination.lon)
    # Both ends may snap up to the tolerance towards each other.
    if candidate.distance_m < straight - 2 * ENDPOINT_TOLERANCE_M:
        return REASON_SHORTER_THAN_STRAIGHT_LINE
    if candidate.distance_m > straight * MAX_DETOUR_RATIO + DETOUR_SLACK_M:
        return REASON_IMPLAUSIBLY_LONG
    return None


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
class Maneuver:
    """One turn instruction, as the ROUTING PROVIDER described it.

    NOT DERIVED FROM GEOMETRY. Nothing in this system infers a turn from the
    corners of a polyline: a simplified overview has vertices wherever the
    encoder put them, not where the junctions are, and "the line bends here"
    is not "turn right at the roundabout". Every field below comes from the
    provider's own step object or is null.

    `at` is the maneuver point - where the turn happens - and
    `geometry_index` is where that point falls in the route's own geometry, so
    progress along the line and the next instruction cannot drift apart.

    `step_distance_m` MEASURES FORWARD, not backward. It is the distance from
    this maneuver to the NEXT one, which is what OSRM's `step.distance` means:
    "the distance of travel from the maneuver to the subsequent step's
    maneuver". This field was previously called `distance_m` and documented as
    "the length of the step that ENDS at this maneuver, which is what 'in 400 m,
    turn left' is measured against" - the exact opposite of its value, and an
    off-by-one-step error waiting to be rendered on a windscreen.

    Verified against the provider rather than argued from the documentation: a
    Guwahati route returns `sum(step.distance) == route.distance` and a final
    `arrive` step of **0.0 m**. A step measured backward could not be zero at
    arrival, and the sum could not close.

    So this is NOT the number to put in "in X m, turn left". Distance to a
    maneuver is remaining path length from the current position, which is what
    `navigation.build_for_route` publishes as `distance_from_start_m`.
    """

    #: Provider verb: turn, merge, roundabout, arrive, depart, fork...
    type: str
    #: Provider modifier: left, slight right, uturn... None when it has none.
    modifier: str | None
    #: The maneuver point, (lat, lon).
    at: tuple[float, float]
    #: Index of `at` within the route geometry this maneuver belongs to.
    geometry_index: int
    #: Distance from this maneuver to the next. 0.0 at arrival.
    step_distance_m: float
    #: Free-flow seconds for that step. NOT an ETA - see the module docstring.
    duration_s: float | None = None
    #: Road name where the provider gave one. Never invented.
    name: str | None = None
    #: Exit number for roundabouts, when the provider supplied it.
    exit: int | None = None

    def __post_init__(self) -> None:
        lat, lon = self.at
        if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
            raise RoutingMalformed(
                "maneuver coordinate out of range; this is the shape of a "
                "latitude/longitude inversion"
            )
        if self.geometry_index < 0:
            raise RoutingMalformed("maneuver geometry index is negative")
        if self.step_distance_m < 0:
            raise RoutingMalformed("maneuver step distance is negative")


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
    #: Turn instructions from the provider, in travel order. EMPTY when the
    #: route was planned without them.
    #:
    #: Empty is not "this road has no turns" - it is "this candidate was not
    #: asked for directions", and a caller must render guidance-unavailable
    #: rather than fabricating turns from `geometry`. The two are produced by
    #: the same provider response when they are produced at all, so a
    #: candidate can never carry directions belonging to a different line.
    maneuvers: tuple[Maneuver, ...] = ()

    @property
    def has_guidance(self) -> bool:
        """Whether this candidate can drive turn-by-turn navigation."""
        return len(self.maneuvers) > 0

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
