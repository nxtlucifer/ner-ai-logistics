"""Route progress: the planned line, the observed truck, and the gap between.

Pure arithmetic, no database, no provider. Two things are being pinned: that
the projection is right, and that nothing here ever calls itself an ETA.
"""

import pytest

from app.domain import route_progress as rp

#: A straight west-to-east line at a constant latitude, so distances along it
#: are easy to reason about by hand.
LINE = [(26.0, 91.0), (26.0, 92.0), (26.0, 93.0)]


class TestProjection:
    def test_at_the_start_nothing_is_travelled(self) -> None:
        result = rp.assess(geometry=LINE, position=(26.0, 91.0))
        assert result.fraction_complete == pytest.approx(0.0, abs=1e-6)
        assert result.travelled_distance_km == pytest.approx(0.0, abs=0.01)
        assert result.on_route is True

    def test_at_the_end_nothing_remains(self) -> None:
        result = rp.assess(geometry=LINE, position=(26.0, 93.0))
        assert result.fraction_complete == pytest.approx(1.0, abs=1e-6)
        assert result.remaining_distance_km == pytest.approx(0.0, abs=0.01)

    def test_halfway_is_halfway(self) -> None:
        result = rp.assess(geometry=LINE, position=(26.0, 92.0))
        assert result.fraction_complete == pytest.approx(0.5, abs=0.01)
        assert result.travelled_distance_km == pytest.approx(
            result.remaining_distance_km, rel=0.01
        )

    def test_a_point_within_a_segment_projects_proportionally(self) -> None:
        result = rp.assess(geometry=LINE, position=(26.0, 91.5))
        assert result.fraction_complete == pytest.approx(0.25, abs=0.01)

    def test_travelled_and_remaining_always_sum_to_the_route(self) -> None:
        total = rp.assess(geometry=LINE, position=(26.0, 93.0)).travelled_distance_km
        for lon in (91.0, 91.3, 92.0, 92.7, 93.0):
            r = rp.assess(geometry=LINE, position=(26.0, lon))
            assert r.travelled_distance_km + r.remaining_distance_km == pytest.approx(
                total, rel=1e-6
            )

    def test_a_point_before_the_start_clamps_rather_than_going_negative(self) -> None:
        """A truck in the depot yard is at zero progress, not minus five."""
        result = rp.assess(geometry=LINE, position=(26.0, 90.5))
        assert result.fraction_complete == pytest.approx(0.0, abs=1e-6)
        assert result.travelled_distance_km == pytest.approx(0.0, abs=0.01)

    def test_a_point_past_the_end_clamps_to_complete(self) -> None:
        result = rp.assess(geometry=LINE, position=(26.0, 93.5))
        assert result.fraction_complete == pytest.approx(1.0, abs=1e-6)
        assert result.remaining_distance_km == pytest.approx(0.0, abs=0.01)


class TestTheGapIsReportedNotHidden:
    def test_a_nearby_fix_is_on_route(self) -> None:
        """Consumer GPS in a valley is routinely tens of metres out."""
        result = rp.assess(geometry=LINE, position=(26.0005, 92.0))
        assert result.off_route_m is not None
        assert result.off_route_m < rp.OFF_ROUTE_THRESHOLD_M
        assert result.on_route is True
        assert rp.REASON_OFF_ROUTE not in result.reason_codes

    def test_a_truck_that_left_the_corridor_is_flagged(self) -> None:
        # ~5.5 km north of the line.
        result = rp.assess(geometry=LINE, position=(26.05, 92.0))
        assert result.on_route is False
        assert rp.REASON_OFF_ROUTE in result.reason_codes
        assert result.off_route_m > 1_000

    def test_the_figures_still_come_back_when_off_route(self) -> None:
        """Reported WITH the warning, not suppressed.

        A dispatcher needs to know both that the truck has left the corridor
        and roughly where along it it was. Withholding the second because of
        the first leaves them with less than they had.
        """
        result = rp.assess(geometry=LINE, position=(26.05, 92.0))
        assert result.fraction_complete is not None
        assert result.remaining_distance_km is not None


class TestItIsNotAnETA:
    def test_no_field_is_named_like_an_arrival_time(self) -> None:
        result = rp.assess(
            geometry=LINE, position=(26.0, 92.0), planned_duration_min=120.0
        )
        names = " ".join(vars(result)).lower()
        for forbidden in ("eta", "arrival", "arrives", "due_at", "arrive"):
            assert forbidden not in names, (
                f"{forbidden!r} promises an arrival time nothing here stands behind"
            )

    def test_the_remaining_time_names_its_assumption(self) -> None:
        result = rp.assess(
            geometry=LINE, position=(26.0, 92.0), planned_duration_min=120.0
        )
        assert result.remaining_at_planned_pace_min == pytest.approx(60.0, rel=0.02)
        assert result.planned_average_speed_kmph is not None
        assert rp.REASON_PACE_IS_PLANNED in result.reason_codes, (
            "a derived time was published without stating what it assumes"
        )

    def test_no_provider_duration_means_no_remaining_time(self) -> None:
        """Not zero, and not a guess from an invented default speed.

        An assumed speed produces a number indistinguishable on screen from a
        measured one.
        """
        result = rp.assess(geometry=LINE, position=(26.0, 92.0))
        assert result.remaining_at_planned_pace_min is None
        assert result.planned_average_speed_kmph is None
        assert rp.REASON_NO_PACE in result.reason_codes

    def test_a_zero_duration_is_treated_as_absent(self) -> None:
        result = rp.assess(
            geometry=LINE, position=(26.0, 92.0), planned_duration_min=0.0
        )
        assert result.remaining_at_planned_pace_min is None
        assert rp.REASON_NO_PACE in result.reason_codes


class TestUnknownIsNotZero:
    def test_no_position_yields_nulls_not_zeroes(self) -> None:
        """A truck with no fix has not arrived."""
        result = rp.assess(geometry=LINE, position=None)
        assert result.remaining_distance_km is None
        assert result.fraction_complete is None
        assert result.on_route is None
        assert rp.REASON_NO_POSITION in result.reason_codes

    def test_a_degenerate_geometry_is_refused(self) -> None:
        for geometry in ([], [(26.0, 91.0)]):
            result = rp.assess(geometry=geometry, position=(26.0, 91.0))
            assert result.fraction_complete is None
            assert rp.REASON_NO_GEOMETRY in result.reason_codes

    def test_a_zero_length_line_is_refused_rather_than_dividing_by_zero(self) -> None:
        result = rp.assess(
            geometry=[(26.0, 91.0), (26.0, 91.0)], position=(26.0, 91.0)
        )
        assert result.fraction_complete is None
        assert rp.REASON_NO_GEOMETRY in result.reason_codes


class TestAWindingRoute:
    def test_progress_follows_the_line_not_the_straight_line_distance(self) -> None:
        """The point of measuring ALONG the route.

        A dog-leg that doubles back means a truck near the end of the line can
        be physically close to the start. Straight-line distance would call it
        barely started.
        """
        dogleg = [(26.0, 91.0), (26.0, 92.0), (26.5, 92.0), (26.5, 91.0)]
        near_the_end = rp.assess(geometry=dogleg, position=(26.5, 91.05))

        assert near_the_end.fraction_complete > 0.9
        assert near_the_end.on_route is True

    def test_the_nearest_segment_wins_when_the_route_passes_itself(self) -> None:
        parallel = [(26.0, 91.0), (26.0, 92.0), (26.01, 92.0), (26.01, 91.0)]
        # Sitting on the return leg, not the outbound one.
        result = rp.assess(geometry=parallel, position=(26.01, 91.5))
        assert result.fraction_complete > 0.5


class TestDistanceAgreesWithTheProvider:
    """The polyline is not the road, and the difference is one-directional.

    `overview=simplified` is what this project asks OSRM for - deliberately,
    because `full` returns 5,213 points for Guwahati-Jorhat. A simplified
    polyline is shorter than the road it describes, always, because smoothing
    only ever cuts corners.

    So distances measured along the geometry UNDERSTATE the route. On its own
    that is a rounding concern. What makes it a defect is that the manager's
    screen shows the provider's `distance_km` for the same route: a dispatcher
    reading 305 km and a driver whose remaining plus travelled sums to 255 km
    are looking at one road and two numbers, and neither can tell which is
    wrong.

    The fraction still comes from the geometry - that is the shape, and the
    shape is what a position projects onto. Only the DISTANCES are scaled, to
    the total the provider stated.
    """

    #: Roughly Guwahati -> Jorhat, three vertices. Exaggerates the effect that a
    #: real simplified polyline shows at a percent or two.
    CORRIDOR = [(26.1445, 91.7362), (26.4, 92.9), (26.7509, 94.2037)]
    PROVIDER_KM = 305.0

    def test_travelled_and_remaining_sum_to_the_provider_distance(self) -> None:
        for position in (
            (26.1445, 91.7362),
            (26.4, 92.9),
            (26.6, 93.6),
            (26.7509, 94.2037),
        ):
            result = rp.assess(
                geometry=self.CORRIDOR,
                position=position,
                planned_distance_km=self.PROVIDER_KM,
            )
            assert (
                result.travelled_distance_km + result.remaining_distance_km
                == pytest.approx(self.PROVIDER_KM, rel=1e-6)
            ), "the driver's arithmetic does not agree with the manager's screen"

    def test_the_fraction_still_comes_from_the_geometry(self) -> None:
        """Scaling distances must not move the truck along the road."""
        without = rp.assess(geometry=self.CORRIDOR, position=(26.4, 92.9))
        with_total = rp.assess(
            geometry=self.CORRIDOR,
            position=(26.4, 92.9),
            planned_distance_km=self.PROVIDER_KM,
        )
        assert with_total.fraction_complete == pytest.approx(
            without.fraction_complete
        )
        assert with_total.off_route_m == pytest.approx(without.off_route_m)

    def test_without_a_provider_distance_it_measures_the_polyline(self) -> None:
        """The honest fallback, and it is not silently zero."""
        result = rp.assess(geometry=self.CORRIDOR, position=(26.4, 92.9))
        assert result.remaining_distance_km > 0
        total = (
            result.travelled_distance_km + result.remaining_distance_km
        )
        assert total < self.PROVIDER_KM, (
            "the fixture no longer exercises a simplified polyline"
        )

    def test_the_pace_uses_the_same_distance_the_driver_is_shown(self) -> None:
        """Otherwise remaining time and remaining distance disagree.

        305 km in 221 minutes is ~82.8 km/h. Half way along, the driver is
        shown ~152 km left, and the time must be the time to cover THAT.
        """
        result = rp.assess(
            geometry=self.CORRIDOR,
            position=(26.4, 92.9),
            planned_distance_km=self.PROVIDER_KM,
            planned_duration_min=221.0,
        )
        assert result.planned_average_speed_kmph == pytest.approx(
            self.PROVIDER_KM / (221.0 / 60.0), rel=1e-6
        )
        implied_min = (
            result.remaining_distance_km / result.planned_average_speed_kmph * 60.0
        )
        assert result.remaining_at_planned_pace_min == pytest.approx(
            implied_min, rel=1e-6
        )

    def test_a_zero_or_negative_provider_distance_is_ignored(self) -> None:
        """A nonsense total must not erase the geometry's honest answer."""
        for bad in (0.0, -5.0):
            result = rp.assess(
                geometry=self.CORRIDOR, position=(26.4, 92.9), planned_distance_km=bad
            )
            assert result.remaining_distance_km > 0
