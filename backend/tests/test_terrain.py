"""Terrain profile invariants.

The elevations are injected, so the whole thing runs without a DEM. The
cases that matter are the ones where a naive profile would UNDERSTATE the
road: a missing sample read as sea level, a steep climb smoothed into the
average, or a partial answer reported as a complete one.
"""

from datetime import UTC, datetime

import pytest

from app.domain.terrain import (
    FLAT_MAX_GRADE_PCT,
    STEEP_MIN_GRADE_PCT,
    TerrainClass,
    build_profile,
    terrain_component,
)

NOW = datetime(2026, 9, 11, 12, 0, tzinfo=UTC)

# A straight 5 km line at 500 m spacing, 11 points, due east along 26.5N.
POINTS = [(26.5, 91.0 + i * 0.005) for i in range(11)]


def profile(elevations, spacing_m=500.0):
    return build_profile(
        POINTS, elevations, spacing_m=spacing_m, source="test-dem", fetched_at=NOW
    )


class TestGrades:
    def test_flat_road_is_flat(self) -> None:
        p = profile([100.0] * 11)
        assert all(s.terrain_class is TerrainClass.FLAT for s in p.segments)
        assert p.max_grade_pct == 0.0
        assert p.steep_km == 0.0
        assert p.total_ascent_m == 0.0

    def test_a_climb_is_measured_not_averaged(self) -> None:
        # 60 m over one 500 m segment is a 12% grade. The rest is flat. A
        # profile that averaged over the whole 5 km would call this 1.2%.
        elev = [100.0] * 5 + [160.0] * 6
        p = profile(elev)
        assert p.max_grade_pct == pytest.approx(12.0)
        assert p.segments[4].terrain_class is TerrainClass.STEEP
        assert p.steep_km == pytest.approx(0.5)
        assert p.total_ascent_m == pytest.approx(60.0)

    def test_descent_counts_as_steep_too(self) -> None:
        # A loaded truck going DOWN a 12% grade is the brake-fade case.
        elev = [160.0] * 5 + [100.0] * 6
        p = profile(elev)
        assert p.segments[4].terrain_class is TerrainClass.STEEP
        assert p.segments[4].grade_pct == pytest.approx(-12.0)
        assert p.total_descent_m == pytest.approx(60.0)

    def test_class_boundaries_are_the_published_constants(self) -> None:
        rise_flat = FLAT_MAX_GRADE_PCT / 100 * 500 - 0.01
        rise_steep = STEEP_MIN_GRADE_PCT / 100 * 500
        p = profile([0.0, rise_flat, rise_flat, rise_flat + rise_steep] + [rise_flat + rise_steep] * 7)
        assert p.segments[0].terrain_class is TerrainClass.FLAT
        assert p.segments[2].terrain_class is TerrainClass.STEEP


class TestGaps:
    def test_a_missing_sample_is_a_gap_not_sea_level(self) -> None:
        elev = [100.0] * 5 + [None] + [100.0] * 5
        p = profile(elev)
        # Segments touching the gap are not classified, and the profile says
        # how much of the route it actually saw.
        assert p.samples_requested == 11
        assert p.samples_answered == 10
        assert p.coverage < 1.0
        assert all(s.terrain_class is not TerrainClass.STEEP for s in p.segments)
        assert len(p.segments) == 8

    def test_no_answers_at_all_is_not_a_profile(self) -> None:
        p = profile([None] * 11)
        assert p.samples_answered == 0
        assert p.segments == ()
        assert p.usable is False


class TestComponent:
    def test_flat_route_contributes_nothing_and_says_nothing(self) -> None:
        component, codes = terrain_component(profile([100.0] * 11))
        assert component is None
        assert codes == []

    def test_steep_route_scores_and_names_the_reason(self) -> None:
        elev = [100.0 + i * 60.0 for i in range(11)]  # 12% the whole way
        component, codes = terrain_component(profile(elev))
        assert component is not None
        assert component.code == "TERRAIN_EXPOSURE"
        assert component.points > 0
        assert "STEEP_GRADIENT_ON_ROUTE" in codes
        assert "12" in component.detail

    def test_an_unusable_profile_scores_nothing(self) -> None:
        component, codes = terrain_component(profile([None] * 11))
        assert component is None
        assert codes == []
