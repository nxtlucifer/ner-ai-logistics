"""How far along the planned corridor a truck is, and how far is left.

THE PLANNED ROUTE IS NOT THE OBSERVED TRACK

The distinction this module is built around. The planned route is a line a
provider drew before the trip; the observed track is where the truck actually
went. They are different objects and they diverge for ordinary reasons - a
diversion, a fuel stop, a GPS fix bouncing off a hillside. Progress is measured
by PROJECTING the observed position onto the planned line, and the distance
between the two is reported as `off_route_m` rather than quietly discarded,
because that gap is the most useful number here: it is how a dispatcher learns
a truck has left the corridor.

THIS DOES NOT PRODUCE AN ETA

Deliberately, and the naming is part of the guarantee. A routing provider's
`duration` is a free-flow estimate over a road graph; it knows nothing about
this truck's load, the driver's break, a checkpoint queue, or the fact that it
is already two hours behind. Publishing it as "arrival time" would put a
timestamp on a manager's screen that a customer will be told and that nothing
in this system stands behind.

What is published instead is `remaining_at_planned_pace_min`: the remaining
distance divided by the average speed implied by the provider's own distance
and duration. The name says what it assumes, the assumption is returned
alongside it as `planned_average_speed_kmph`, and a reason code states it. A
test asserts no field called `eta` or `arrival` ever appears.

THE POLYLINE IS NOT THE ROAD

This project asks OSRM for `overview=simplified` - deliberately, because `full`
returns over five thousand points for one Guwahati-Jorhat route. A simplified
polyline is always SHORTER than the road it describes, because smoothing only
ever cuts corners.

So distances measured along the geometry understate the route, systematically
and in one direction. On its own that is a rounding concern; what makes it
matter is that the manager's screen shows the provider's `distance_km` for the
same route. A dispatcher reading 305 km and a driver whose travelled plus
remaining comes to 255 km are looking at one road and two numbers, and neither
can tell which is wrong.

`planned_distance_km` fixes that: the FRACTION still comes from the geometry -
that is the shape, and the shape is what a position projects onto - and only
the distances are scaled to the total the provider stated. Without it the
polyline is measured directly, which is the honest fallback rather than a
guess.

NO PROVIDER IS CALLED AND NOTHING IS PERSISTED

Pure arithmetic over a geometry the caller already has. This is the cheapest
thing in the routing stack and is safe to call often.
"""

from dataclasses import dataclass
from typing import Final

from app.domain.routing import haversine_m

VERSION: Final[str] = "route-progress-v1"

#: How far off the planned line a truck may be before it is called off-route.
#:
#: Wide on purpose. Consumer GPS in a hill valley is routinely tens of metres
#: out, a dual carriageway's two directions can be forty metres apart, and a
#: provider's polyline is a simplification of the road rather than a survey of
#: it. Calling a truck off-route because of any of those would produce an alert
#: a dispatcher learns to ignore, which is worse than no alert. Two hundred
#: metres is a project-defined operational threshold, not a standard.
OFF_ROUTE_THRESHOLD_M: Final[float] = 200.0

REASON_NO_POSITION: Final[str] = "NO_POSITION_AVAILABLE"
REASON_NO_GEOMETRY: Final[str] = "ROUTE_HAS_NO_GEOMETRY"
REASON_OFF_ROUTE: Final[str] = "VEHICLE_OFF_PLANNED_ROUTE"
REASON_PACE_IS_PLANNED: Final[str] = "REMAINING_TIME_ASSUMES_PLANNED_PACE"
REASON_NO_PACE: Final[str] = "NO_PLANNED_PACE_AVAILABLE"


@dataclass(frozen=True)
class RouteProgress:
    """Position along a planned corridor, with what it is and is not.

    Every optional field is None rather than zero when it cannot be computed. A
    truck with no fix has `remaining_distance_km = None`, which a screen renders
    as "unknown"; zero would render as "arrived".
    """

    #: 0.0 at the start of the planned line, 1.0 at its end.
    fraction_complete: float | None
    travelled_distance_km: float | None
    remaining_distance_km: float | None
    #: How far the observed position is from the planned line. The number that
    #: says whether any of the above means anything.
    off_route_m: float | None
    on_route: bool | None
    #: NOT an ETA. Remaining distance at the pace the provider's own figures
    #: imply, with the assumption named in `reason_codes`.
    remaining_at_planned_pace_min: float | None
    planned_average_speed_kmph: float | None
    reason_codes: tuple[str, ...]
    version: str = VERSION


def _project_onto_segment(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> tuple[float, float, float]:
    """Nearest point on a segment, its distance, and how far along it lies.

    Returns `(nearest_lat, nearest_lon, t)` where `t` in [0, 1] is the fraction
    of the segment before the nearest point.

    Treated as planar in degrees, with longitude NOT rescaled by latitude. At
    26 N that understates east-west distance by about ten percent when choosing
    WHICH segment is nearest - and it does not matter, because the choice is
    between segments of a road polyline that are hundreds of metres apart and
    the actual distances are then measured with `haversine_m`. Doing spherical
    projection properly here would be arithmetic nobody could check for a result
    that does not change.
    """
    lat_p, lon_p = point
    lat_a, lon_a = start
    lat_b, lon_b = end

    d_lat = lat_b - lat_a
    d_lon = lon_b - lon_a
    if d_lat == 0.0 and d_lon == 0.0:
        return lat_a, lon_a, 0.0

    t = ((lat_p - lat_a) * d_lat + (lon_p - lon_a) * d_lon) / (
        d_lat * d_lat + d_lon * d_lon
    )
    t = max(0.0, min(1.0, t))
    return lat_a + t * d_lat, lon_a + t * d_lon, t


def _cumulative(geometry: list[tuple[float, float]]) -> list[float]:
    """Distance in metres from the start of the line to each vertex."""
    out = [0.0]
    for i in range(1, len(geometry)):
        out.append(
            out[-1]
            + haversine_m(
                geometry[i - 1][0], geometry[i - 1][1], geometry[i][0], geometry[i][1]
            )
        )
    return out


def _unavailable(*codes: str) -> RouteProgress:
    return RouteProgress(
        fraction_complete=None,
        travelled_distance_km=None,
        remaining_distance_km=None,
        off_route_m=None,
        on_route=None,
        remaining_at_planned_pace_min=None,
        planned_average_speed_kmph=None,
        reason_codes=codes,
    )


def assess(
    *,
    geometry: list[tuple[float, float]],
    position: tuple[float, float] | None,
    planned_duration_min: float | None = None,
    planned_distance_km: float | None = None,
) -> RouteProgress:
    """Where along `geometry` the truck at `position` is.

    `geometry` is the PLANNED route as (lat, lon) vertices. `position` is the
    last observed fix, or None when there is not one - a normal state before a
    trip starts or during a signal blackout, and answered with an honest
    "unknown" rather than a fabricated zero.

    `planned_duration_min` is the provider's estimate for the WHOLE route. It is
    used only to derive an average pace, and never republished as an arrival
    time.

    `planned_distance_km` is the provider's own total. When present the reported
    distances are scaled to it so they agree with what a manager is shown for
    the same route; see the module docstring. A zero or negative value is
    ignored rather than obeyed - a nonsense total must not erase the geometry's
    honest answer.
    """
    if len(geometry) < 2:
        return _unavailable(REASON_NO_GEOMETRY)
    if position is None:
        return _unavailable(REASON_NO_POSITION)

    cumulative = _cumulative(geometry)
    total_m = cumulative[-1]
    if total_m <= 0.0:
        return _unavailable(REASON_NO_GEOMETRY)

    best_m = float("inf")
    best_along_m = 0.0
    for i in range(1, len(geometry)):
        near_lat, near_lon, t = _project_onto_segment(
            position, geometry[i - 1], geometry[i]
        )
        gap = haversine_m(position[0], position[1], near_lat, near_lon)
        if gap < best_m:
            best_m = gap
            segment_m = cumulative[i] - cumulative[i - 1]
            best_along_m = cumulative[i - 1] + t * segment_m

    travelled_m = max(0.0, min(total_m, best_along_m))
    fraction = travelled_m / total_m

    # Scaled to the provider's total when there is one, so the driver's
    # arithmetic and the manager's screen describe the same road. The fraction
    # above is untouched: it came from the shape, and scaling a length must not
    # move the truck along it.
    route_km = (
        planned_distance_km
        if planned_distance_km is not None and planned_distance_km > 0
        else total_m / 1000.0
    )
    travelled_km = fraction * route_km
    remaining_km = route_km - travelled_km
    on_route = best_m <= OFF_ROUTE_THRESHOLD_M

    codes: list[str] = []
    if not on_route:
        # Reported, not corrected. A truck 3 km from the planned line still has
        # a projection onto it, and that projection is meaningless - so the
        # figures are returned WITH the code that says not to trust them,
        # rather than being suppressed. A dispatcher needs to know both that
        # the truck has left the corridor and roughly where along it it was.
        codes.append(REASON_OFF_ROUTE)

    pace_kmph: float | None = None
    remaining_min: float | None = None
    if planned_duration_min and planned_duration_min > 0:
        # Derived from the SAME distance the driver is shown, so remaining time
        # and remaining distance cannot disagree with each other.
        pace_kmph = route_km / (planned_duration_min / 60.0)
        if pace_kmph > 0:
            remaining_min = remaining_km / pace_kmph * 60.0
        codes.append(REASON_PACE_IS_PLANNED)
    else:
        # No duration from the provider means no pace, and no pace means no
        # remaining time. Not a zero, and not a guess from a default speed:
        # an invented speed would produce a number indistinguishable from a
        # measured one.
        codes.append(REASON_NO_PACE)

    return RouteProgress(
        fraction_complete=fraction,
        travelled_distance_km=travelled_km,
        remaining_distance_km=remaining_km,
        off_route_m=best_m,
        on_route=on_route,
        remaining_at_planned_pace_min=remaining_min,
        planned_average_speed_kmph=pace_kmph,
        reason_codes=tuple(dict.fromkeys(codes)),
    )
