"""Historical landslide exposure invariants.

History is a different question from a current incident, and the two must
never share a code path: a 2017 slide near Jorabat is evidence that the
corridor is hazardous, not a report that the road is shut today. These cases
pin the things a naive implementation gets wrong - counting an event whose
own position is only known to 50 km as "on the road", and reading an empty
inventory as a clean corridor when nobody looked.
"""

from datetime import UTC, datetime

from app.domain.landslide import (
    DataStatus,
    HistoryExposure,
    IncidentQueryResult,
    IncidentSource,
    LandslideIncident,
    SourceState,
    SourceType,
    assess_history,
)

# Along NH-27 between Guwahati and Jorhat, sampled coarsely.
ROUTE = [(26.14, 91.74), (26.2, 92.2), (26.4, 92.9), (26.6, 93.6), (26.75, 94.2)]

GLC = IncidentSource(name="NASA GLC", source_type=SourceType.NEWS, reference="glc")


def event(lat, lon, *, accuracy_m=1_000.0, year=2017, ident="x"):
    return LandslideIncident(
        incident_id=ident,
        event_date=datetime(year, 7, 3, tzinfo=UTC),
        latitude=lat,
        longitude=lon,
        location_accuracy_m=accuracy_m,
        sources=(GLC,),
    )


def answered(*events):
    return IncidentQueryResult(
        state=SourceState.AVAILABLE, incidents=tuple(events), provider="glc-snapshot"
    )


class TestSourceStateComesFirst:
    def test_nobody_looked_is_unknown_not_low(self) -> None:
        h = assess_history(IncidentQueryResult(state=SourceState.NOT_CONFIGURED), route=ROUTE)
        assert h.exposure is HistoryExposure.UNKNOWN
        assert h.data_status is DataStatus.NOT_CONFIGURED
        assert "LANDSLIDE_HISTORY_NOT_CONFIGURED" in h.reason_codes

    def test_a_broken_source_is_unknown_too(self) -> None:
        h = assess_history(IncidentQueryResult(state=SourceState.UNAVAILABLE), route=ROUTE)
        assert h.exposure is HistoryExposure.UNKNOWN
        assert h.data_status is DataStatus.SOURCE_FAILED


class TestExposure:
    def test_an_empty_inventory_that_answered_is_low(self) -> None:
        h = assess_history(answered(), route=ROUTE)
        assert h.exposure is HistoryExposure.LOW
        assert "LANDSLIDE_HISTORY_NONE_RECORDED" in h.reason_codes
        assert h.on_route_count == 0

    def test_events_on_the_corridor_raise_exposure_by_count(self) -> None:
        two = assess_history(
            answered(event(26.20, 92.2, ident="a"), event(26.21, 92.21, ident="b")), route=ROUTE
        )
        assert two.exposure is HistoryExposure.MODERATE
        assert two.on_route_count == 2
        assert "LANDSLIDE_HISTORY_ON_ROUTE" in two.reason_codes

        three = assess_history(
            answered(
                event(26.20, 92.2, ident="a"),
                event(26.21, 92.21, ident="b"),
                event(26.6, 93.6, ident="c"),
            ),
            route=ROUTE,
        )
        assert three.exposure is HistoryExposure.HIGH

    def test_an_event_far_from_the_route_does_not_count(self) -> None:
        # Shillong is ~60 km south of the corridor.
        h = assess_history(answered(event(25.57, 91.88)), route=ROUTE)
        assert h.on_route_count == 0
        assert h.exposure is HistoryExposure.LOW
        assert h.considered_count == 1

    def test_a_coarsely_located_event_is_counted_but_not_placed(self) -> None:
        # Position known only to 50 km cannot be said to be ON a 5 km corridor.
        # It is evidence for the region, reported separately, never scored as
        # on-route.
        h = assess_history(answered(event(26.20, 92.2, accuracy_m=50_000.0)), route=ROUTE)
        assert h.on_route_count == 0
        assert h.imprecise_count == 1
        assert h.exposure is HistoryExposure.LOW

    def test_nearest_distance_and_inventory_years_travel_with_the_answer(self) -> None:
        h = assess_history(
            answered(event(26.20, 92.2, year=2012), event(26.60, 93.6, year=2017)),
            route=ROUTE,
        )
        assert h.nearest_km is not None and h.nearest_km < 5.0
        assert (h.inventory_from_year, h.inventory_to_year) == (2012, 2017)
        assert "LANDSLIDE_HISTORY_INVENTORY_AGED" in h.reason_codes
