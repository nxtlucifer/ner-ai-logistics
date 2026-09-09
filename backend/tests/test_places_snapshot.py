"""Roadside place lookup: normalisation, dedupe, corridor filtering, states.

No database and no network - the snapshot is a file, which is the point. These
run in the default suite.
"""

import math

import pytest

from app.domain.places import (
    BoundingBox,
    PlaceCategory,
    PlaceQueryError,
    PlacesSourceState,
    SearchAnchor,
)
from app.services.places import snapshot as places

# The real corridor, as the demo trip uses it.
GUWAHATI = (26.144276, 91.736153)
JORHAT = (26.75091, 94.203682)
WHOLE_CORRIDOR = BoundingBox(
    min_lat=25.90, min_lon=91.40, max_lat=27.10, max_lon=94.50
)


def _find(category=PlaceCategory.EMERGENCY, **kwargs):
    kwargs.setdefault("box", WHOLE_CORRIDOR)
    kwargs.setdefault("anchor", SearchAnchor.MAP_AREA)
    return places.find(category=category, **kwargs)


class TestNormalisation:
    def test_absent_facts_stay_absent(self) -> None:
        """Most records have no phone and no hours. None, never "" or "open"."""
        result = _find(PlaceCategory.HOTEL, limit=60)
        assert result.usable
        no_phone = [p for p in result.places if p.contact.phone is None]
        assert no_phone, "expected records without a phone in this extract"
        for place in no_phone:
            assert place.contact.phone is None
            # The dangerous default: an empty string renders as a place with no
            # phone rather than a place whose phone nobody recorded.
            assert place.contact.phone != ""

    def test_no_place_claims_hours_it_does_not_have(self) -> None:
        result = _find(PlaceCategory.TYRES, limit=60)
        for place in result.places:
            if "opening_hours" not in place.osm_tags:
                assert place.contact.opening_hours is None

    def test_access_is_mapped_never_inferred(self) -> None:
        """A lay-by with no `hgv` tag is unknown, not permitted."""
        result = _find(PlaceCategory.REST, limit=60)
        for place in result.places:
            if "hgv" not in place.osm_tags:
                assert place.access.hgv is None

    def test_provider_ids_are_stable_and_unique(self) -> None:
        seen = set()
        for category in PlaceCategory:
            for place in _find(category, limit=60).places:
                assert place.provider_id.startswith("osm:")
                assert place.provider_id not in seen
                seen.add(place.provider_id)


class TestDedupe:
    def test_counts_separate_raw_records_from_unique_places(self) -> None:
        counts = places.snapshot_counts()
        assert counts["raw_records"] > counts["unique_places"]
        assert (
            counts["raw_records"] - counts["unique_places"]
            == counts["merged_duplicates"]
        )

    def test_one_place_mapped_as_node_and_way_becomes_one(self) -> None:
        """Jorhat Fire Station is mapped twice, 1 m apart, node and way."""
        result = _find(PlaceCategory.EMERGENCY, limit=60)
        names = [
            p.name.casefold()
            for p in _all(PlaceCategory.EMERGENCY)
            if p.name
        ]
        assert names.count("jorhat fire station") == 1
        assert result.usable

    def test_same_name_far_apart_are_kept_as_different_places(self) -> None:
        """Four Maruti Suzuki dealers up to 48 km apart are four dealers."""
        tyres = [p for p in _all(PlaceCategory.TYRES) if p.name]
        maruti = [p for p in tyres if p.name.casefold() == "maruti suzuki"]
        assert len(maruti) > 1, "distinct branches must not be merged"
        # And they really are far apart, so the test is about distance rather
        # than about the name happening to differ.
        furthest = max(
            places._metres(a.lat, a.lon, b.lat, b.lon)
            for a in maruti
            for b in maruti
        )
        assert furthest > places.DUPLICATE_RADIUS_M

    def test_a_merge_keeps_the_only_phone_even_from_the_sparser_element(
        self,
    ) -> None:
        """The defect a bounded metadata check found.

        The earlier merge kept whichever element had the most tags and threw
        the rest away, so a richly tagged building with hours, operator and
        access but NO phone swallowed the sparse node carrying the only phone
        number. Tag count says nothing about which element holds the one fact
        a driver at a roadside needs.
        """
        rich = places._place_from_record(
            {
                "provider_id": "osm:way/111",
                "category": "TYRES",
                "name": "Brahmaputra Tyre Works",
                "lat": 26.1500,
                "lon": 91.7500,
                "osm_tags": {
                    "shop": "tyres",
                    "operator": "B. Das",
                    "opening_hours": "Mo-Sa 09:00-19:00",
                    "access": "yes",
                    "hgv": "yes",
                    "fee": "no",
                },
            }
        )
        sparse = places._place_from_record(
            {
                "provider_id": "osm:node/222",
                "category": "TYRES",
                "name": "Brahmaputra Tyre Works",
                "lat": 26.15015,
                "lon": 91.75012,
                "osm_tags": {"shop": "tyres", "phone": "+91-361-000000"},
            }
        )

        merged = places._dedupe([rich, sparse])
        assert len(merged) == 1
        one = merged[0]

        # The point of the whole test.
        assert one.contact.phone == "+91-361-000000"
        # And the rich element's own facts are not lost either.
        assert one.contact.opening_hours == "Mo-Sa 09:00-19:00"
        assert one.contact.operator == "B. Das"
        assert one.access.hgv == "yes"

    def test_a_merge_preserves_every_source_identity(self) -> None:
        rich = places._place_from_record(
            {
                "provider_id": "osm:way/111",
                "category": "HOTEL",
                "name": "Hotel Luit",
                "lat": 26.15,
                "lon": 91.75,
                "osm_tags": {"tourism": "hotel", "operator": "X"},
            }
        )
        sparse = places._place_from_record(
            {
                "provider_id": "osm:node/222",
                "category": "HOTEL",
                "name": "Hotel Luit",
                "lat": 26.1501,
                "lon": 91.7501,
                "osm_tags": {"tourism": "hotel"},
            }
        )
        one = places._dedupe([rich, sparse])[0]
        assert set(one.provider_ids) == {"osm:way/111", "osm:node/222"}
        assert one.is_merged is True

    def test_disagreeing_values_are_recorded_not_silently_resolved(self) -> None:
        """Two phones under one name may be two departments - or two shops.

        Picking one and discarding the other hides the second possibility,
        which is the one that matters: this rule is a heuristic, and a
        conflict is the strongest available signal that it may have merged
        places that are not in fact the same.
        """
        def node(pid: str, phone: str, lon: float):
            return places._place_from_record(
                {
                    "provider_id": pid,
                    "category": "TYRES",
                    "name": "Same Name Tyres",
                    "lat": 26.15,
                    "lon": lon,
                    "osm_tags": {"shop": "tyres", "phone": phone},
                }
            )

        one = places._dedupe(
            [node("osm:node/1", "+91-1", 91.7500), node("osm:node/2", "+91-2", 91.75012)]
        )[0]
        assert one.conflicts["phone"] == ("+91-1", "+91-2")
        assert one.contact.phone in ("+91-1", "+91-2")
        assert len(one.provider_ids) == 2

    def test_an_unmerged_record_still_carries_its_own_identity(self) -> None:
        """One shape for callers - never an empty tuple meaning "unknown"."""
        for place in _all(PlaceCategory.HOTEL)[:20]:
            assert place.provider_ids
            assert place.provider_id in place.provider_ids

    def test_unnamed_records_are_never_merged(self) -> None:
        """Two unnamed lay-bys are two places to stop."""
        rest = _all(PlaceCategory.REST)
        unnamed = [p for p in rest if p.name is None]
        ids = {p.provider_id for p in unnamed}
        assert len(ids) == len(unnamed)


class TestSourceStates:
    def test_results_available(self) -> None:
        result = _find(PlaceCategory.EMERGENCY)
        assert result.state is PlacesSourceState.AVAILABLE
        assert result.places
        assert result.source is not None
        # A snapshot is not a live availability feed.
        assert result.source.is_live is False

    def test_valid_search_with_no_mapped_results_is_available_and_empty(
        self,
    ) -> None:
        """Empty INSIDE coverage is a real finding about what is mapped."""
        # A small box on the corridor with nothing of this category in it.
        empty_box = BoundingBox(
            min_lat=26.40, min_lon=92.40, max_lat=26.42, max_lon=92.42
        )
        result = places.find(
            box=empty_box,
            category=PlaceCategory.REST,
            anchor=SearchAnchor.MAP_AREA,
        )
        assert result.state is PlacesSourceState.AVAILABLE
        assert result.places == ()

    def test_outside_coverage_is_not_an_empty_result(self) -> None:
        """Searching Kerala must not report "no hospitals near you"."""
        kerala = BoundingBox(
            min_lat=9.9, min_lon=76.2, max_lat=10.1, max_lon=76.4
        )
        result = places.find(
            box=kerala,
            category=PlaceCategory.EMERGENCY,
            anchor=SearchAnchor.MAP_AREA,
        )
        assert result.state is PlacesSourceState.OUTSIDE_COVERAGE
        assert result.places == ()
        assert not result.usable

    def test_unreadable_snapshot_is_unavailable_not_empty(
        self, monkeypatch
    ) -> None:
        """A file we cannot read tells us nothing about the corridor."""
        places._load.cache_clear()
        monkeypatch.setattr(
            places, "SNAPSHOT_PATH", places.SNAPSHOT_PATH.with_name("missing.json")
        )
        try:
            result = _find(PlaceCategory.EMERGENCY)
            assert result.state is PlacesSourceState.UNAVAILABLE
            assert result.places == ()
            assert result.error is not None
            assert not result.usable
        finally:
            places._load.cache_clear()


class TestBounds:
    def test_an_unbounded_box_is_refused(self) -> None:
        with pytest.raises(PlaceQueryError):
            BoundingBox(min_lat=-90, min_lon=-180, max_lat=90, max_lon=180)

    def test_an_inverted_box_is_refused(self) -> None:
        with pytest.raises(PlaceQueryError):
            BoundingBox(min_lat=27.0, min_lon=94.0, max_lat=26.0, max_lon=91.0)

    def test_results_are_capped(self) -> None:
        result = _find(PlaceCategory.HOTEL, limit=5)
        assert len(result.places) == 5
        assert result.truncated is True


class TestCorridorFiltering:
    def test_a_place_between_sparse_vertices_is_found(self) -> None:
        """The whole reason filtering is per-SEGMENT.

        The real corridor has 52 points over 305 km, so consecutive vertices
        are kilometres apart. A vertex-radius filter would reject a service
        sitting directly on the highway between two of them.
        """
        # Two vertices ~270 km apart, and a point on the straight line between
        # them - far from BOTH vertices, but on the route.
        route = [GUWAHATI, JORHAT]
        mid_lat = (GUWAHATI[0] + JORHAT[0]) / 2
        mid_lon = (GUWAHATI[1] + JORHAT[1]) / 2

        to_route = places._distance_to_route(mid_lat, mid_lon, route)
        to_nearest_vertex = min(
            places._metres(mid_lat, mid_lon, *GUWAHATI),
            places._metres(mid_lat, mid_lon, *JORHAT),
        )
        assert to_route < 1.0
        assert to_nearest_vertex > 100_000
        # Which is the defect in one line: vertex distance says 100 km away,
        # segment distance says on the road.

    def test_a_place_off_the_corridor_is_excluded(self) -> None:
        route = [GUWAHATI, JORHAT]
        # ~1 degree north of the corridor midpoint.
        off_lat = (GUWAHATI[0] + JORHAT[0]) / 2 + 1.0
        off_lon = (GUWAHATI[1] + JORHAT[1]) / 2
        assert places._distance_to_route(off_lat, off_lon, route) > 100_000

    def test_along_route_returns_fewer_than_the_whole_box(self) -> None:
        """A bounding-box hit is not automatically "along my route"."""
        box_only = _find(PlaceCategory.HOTEL, limit=60)
        along = _find(
            PlaceCategory.HOTEL,
            limit=60,
            route=[GUWAHATI, JORHAT],
            corridor_m=2000.0,
        )
        assert along.usable
        assert len(along.places) < len(box_only.places)

    def test_nearest_point_is_clamped_to_the_segment(self) -> None:
        """Not its infinite extension - otherwise a place far beyond the end
        of the route measures as if the road continued to meet it."""
        route = [(26.0, 91.0), (26.0, 91.1)]
        beyond = places._distance_to_route(26.0, 95.0, route)
        expected = places._metres(26.0, 95.0, 26.0, 91.1)
        assert math.isclose(beyond, expected, rel_tol=0.02)


class TestDistanceLabelling:
    def test_straight_line_is_measured_from_the_anchor(self) -> None:
        result = _find(
            PlaceCategory.EMERGENCY,
            anchor=SearchAnchor.DRIVER_POSITION,
            anchor_lat=GUWAHATI[0],
            anchor_lon=GUWAHATI[1],
            limit=10,
        )
        assert result.usable
        distances = [p.straight_line_m for p in result.places]
        assert all(d is not None for d in distances)
        assert distances == sorted(distances), "nearest first"

    def test_without_an_anchor_no_distance_is_invented(self) -> None:
        """GPS denied and no anchor: distance is unknown, not zero."""
        result = _find(PlaceCategory.EMERGENCY, limit=10)
        assert all(p.straight_line_m is None for p in result.places)


def _all(category: PlaceCategory):
    """Every unique place of a category, past the result cap."""
    loaded, _, _, _ = places._load()
    return [p for p in loaded if p.category is category]
