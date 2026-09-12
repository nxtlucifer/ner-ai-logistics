"""Terrain along a route: elevation samples, grades, and what they add to risk.

Pure. No HTTP, no database. The service layer samples the route, asks a DEM
for heights, and hands the answers here - which is what makes this testable
without a hillside.

WHAT A GRADE IS HERE

Rise over run between two consecutive samples, as a percentage, SIGNED.
Positive is a climb, negative a descent, and both count as steep: for a loaded
truck the descent is the brake-fade case, and a profile that only counted
climbs would call a 12% drop into a valley "flat".

Samples are ~500 m apart on a 90 m DEM (Copernicus GLO-90 via Open-Meteo), so
a grade here is a 500 m average, not a hairpin. That understates the sharpest
pitches and it is the honest resolution of the data: a finer number would be
this file inventing precision the DEM does not have.

A MISSING SAMPLE IS A GAP, NOT SEA LEVEL

A DEM answers `null` over water and at the edge of coverage. Reading that as
0 m would put a 500 m cliff on either side of every river crossing. Segments
that touch a gap are left unclassified, and `coverage` says how much of the
route was actually seen, so a partial profile reads as partial.

PROJECT-DEFINED THRESHOLDS, NOT A STANDARD

The class boundaries below are operational constants for a loaded truck on a
NER highway. Indian hill-road design practice keeps ruling gradients around
5-6% with limiting gradients to ~7% (IRC:SP:48 / IRC:52); anything at 10% and
above over 500 m is a stretch a driver should know is coming. They are
published here as numbers, not learned, so a reviewer can read them and argue
with them.
"""

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Final

from app.domain.route_risk import RiskComponent
from app.domain.routing import haversine_m

VERSION: Final[str] = "terrain-profile-v1"

#: Grade class boundaries, percent, applied to |grade|.
FLAT_MAX_GRADE_PCT: Final[float] = 3.0
ROLLING_MAX_GRADE_PCT: Final[float] = 6.0
HILLY_MAX_GRADE_PCT: Final[float] = 10.0
STEEP_MIN_GRADE_PCT: Final[float] = HILLY_MAX_GRADE_PCT

#: Exposure grows with how much of the route is steep, capped so terrain can
#: never outrank a road closure. 20 km of >=10% grade saturates it.
STEEP_REFERENCE_KM: Final[float] = 20.0
MAX_TERRAIN_POINTS: Final[int] = 15

#: Below this share of answered samples the profile is not trustworthy enough
#: to score, and the factor is reported NOT_AVAILABLE instead of guessed.
MIN_COVERAGE: Final[float] = 0.8

REASON_STEEP_GRADIENT: Final[str] = "STEEP_GRADIENT_ON_ROUTE"
REASON_TERRAIN_UNAVAILABLE: Final[str] = "TERRAIN_DATA_UNAVAILABLE"


def sample_by_distance(
    geometry: list[tuple[float, float]], spacing_m: float, *, max_samples: int
) -> list[tuple[float, float, float]]:
    """(lat, lon, distance_m) every `spacing_m` along the line, endpoints included.

    Its own sampler rather than `routing.sample_positions`, because that one
    hands back the raw vertices whenever there are fewer of them than asked
    for - fine for five weather points, wrong for a profile whose grades are
    rise over a run it must actually know. The distance travels with each
    sample so nothing downstream has to assume the spacing was honoured.
    """
    if len(geometry) < 2 or spacing_m <= 0:
        return [(lat, lon, 0.0) for lat, lon in geometry[:1]]
    cumulative = [0.0]
    for (lat1, lon1), (lat2, lon2) in zip(geometry, geometry[1:], strict=False):
        cumulative.append(cumulative[-1] + haversine_m(lat1, lon1, lat2, lon2))
    total = cumulative[-1]
    if total <= 0:
        return [(geometry[0][0], geometry[0][1], 0.0)]
    count = max(2, min(max_samples, int(total // spacing_m) + 1))
    out: list[tuple[float, float, float]] = []
    cursor = 0
    for i in range(count):
        target = total * i / (count - 1)
        while cursor + 1 < len(cumulative) - 1 and cumulative[cursor + 1] < target:
            cursor += 1
        d0, d1 = cumulative[cursor], cumulative[cursor + 1]
        t = 0.0 if d1 <= d0 else (target - d0) / (d1 - d0)
        (lat0, lon0), (lat1, lon1) = geometry[cursor], geometry[cursor + 1]
        out.append((lat0 + (lat1 - lat0) * t, lon0 + (lon1 - lon0) * t, target))
    return out


class TerrainClass(str, Enum):
    FLAT = "FLAT"
    ROLLING = "ROLLING"
    HILLY = "HILLY"
    STEEP = "STEEP"


def classify(grade_pct: float) -> TerrainClass:
    g = abs(grade_pct)
    if g < FLAT_MAX_GRADE_PCT:
        return TerrainClass.FLAT
    if g < ROLLING_MAX_GRADE_PCT:
        return TerrainClass.ROLLING
    if g < HILLY_MAX_GRADE_PCT:
        return TerrainClass.HILLY
    return TerrainClass.STEEP


@dataclass(frozen=True)
class TerrainSample:
    latitude: float
    longitude: float
    #: Distance along the route from its start.
    distance_m: float
    #: None when the DEM did not answer for this point.
    elevation_m: float | None


@dataclass(frozen=True)
class TerrainSegment:
    """One stretch between two ANSWERED samples."""

    start_m: float
    end_m: float
    start_elevation_m: float
    end_elevation_m: float
    grade_pct: float
    terrain_class: TerrainClass

    @property
    def length_m(self) -> float:
        return self.end_m - self.start_m


@dataclass(frozen=True)
class TerrainProfile:
    samples: tuple[TerrainSample, ...]
    segments: tuple[TerrainSegment, ...]
    source: str
    fetched_at: datetime
    spacing_m: float

    @property
    def samples_requested(self) -> int:
        return len(self.samples)

    @property
    def samples_answered(self) -> int:
        return sum(1 for s in self.samples if s.elevation_m is not None)

    @property
    def coverage(self) -> float:
        if not self.samples:
            return 0.0
        return self.samples_answered / len(self.samples)

    @property
    def usable(self) -> bool:
        return bool(self.segments) and self.coverage >= MIN_COVERAGE

    @property
    def min_elevation_m(self) -> float | None:
        heights = [s.elevation_m for s in self.samples if s.elevation_m is not None]
        return min(heights) if heights else None

    @property
    def max_elevation_m(self) -> float | None:
        heights = [s.elevation_m for s in self.samples if s.elevation_m is not None]
        return max(heights) if heights else None

    @property
    def total_ascent_m(self) -> float:
        return sum(
            s.end_elevation_m - s.start_elevation_m
            for s in self.segments
            if s.end_elevation_m > s.start_elevation_m
        )

    @property
    def total_descent_m(self) -> float:
        return sum(
            s.start_elevation_m - s.end_elevation_m
            for s in self.segments
            if s.start_elevation_m > s.end_elevation_m
        )

    @property
    def max_grade_pct(self) -> float:
        return max((abs(s.grade_pct) for s in self.segments), default=0.0)

    @property
    def steep_km(self) -> float:
        return (
            sum(s.length_m for s in self.segments if s.terrain_class is TerrainClass.STEEP)
            / 1000.0
        )

    def class_km(self) -> dict[str, float]:
        out = {c.value: 0.0 for c in TerrainClass}
        for s in self.segments:
            out[s.terrain_class.value] += s.length_m / 1000.0
        return out


def build_profile(
    points: list[tuple[float, float]],
    elevations: list[float | None],
    *,
    spacing_m: float,
    source: str,
    fetched_at: datetime,
    distances_m: list[float] | None = None,
) -> TerrainProfile:
    """Samples and heights -> profile. `elevations[i]` belongs to `points[i]`.

    `distances_m` are the true positions along the route from
    `sample_by_distance`; when absent (tests with a synthetic line) the index
    times the spacing is used. A segment is only formed between two
    consecutive samples that BOTH answered; a gap breaks the chain rather than
    being bridged.
    """
    if len(points) != len(elevations):
        raise ValueError("one elevation per point")
    if distances_m is not None and len(distances_m) != len(points):
        raise ValueError("one distance per point")

    samples = tuple(
        TerrainSample(
            lat,
            lon,
            distances_m[i] if distances_m is not None else i * spacing_m,
            elevations[i],
        )
        for i, (lat, lon) in enumerate(points)
    )
    segments: list[TerrainSegment] = []
    for a, b in zip(samples, samples[1:], strict=False):
        if a.elevation_m is None or b.elevation_m is None:
            continue
        run = b.distance_m - a.distance_m
        if run <= 0:
            continue
        grade = (b.elevation_m - a.elevation_m) / run * 100.0
        segments.append(
            TerrainSegment(
                start_m=a.distance_m,
                end_m=b.distance_m,
                start_elevation_m=a.elevation_m,
                end_elevation_m=b.elevation_m,
                grade_pct=grade,
                terrain_class=classify(grade),
            )
        )
    return TerrainProfile(
        samples=samples,
        segments=tuple(segments),
        source=source,
        fetched_at=fetched_at,
        spacing_m=spacing_m,
    )


def terrain_component(
    profile: TerrainProfile | None,
) -> tuple[RiskComponent | None, list[str]]:
    """What terrain adds to the route score, and why.

    Nothing from an unusable profile - a route the DEM barely saw is reported
    NOT_AVAILABLE by the caller, not scored from the fragments. Nothing from a
    route with no steep stretch either: flat is not a risk, it is the absence
    of one, and silence is the right amount to say about it.
    """
    if profile is None or not profile.usable:
        return None, []
    steep_km = profile.steep_km
    if steep_km <= 0.0:
        return None, []
    points = max(
        1, min(MAX_TERRAIN_POINTS, round(steep_km / STEEP_REFERENCE_KM * MAX_TERRAIN_POINTS))
    )
    return (
        RiskComponent(
            code="TERRAIN_EXPOSURE",
            label="Terrain",
            points=points,
            detail=(
                f"{steep_km:.1f} km at 10% grade or steeper, "
                f"steepest {profile.max_grade_pct:.0f}%"
            ),
        ),
        [REASON_STEEP_GRADIENT],
    )
