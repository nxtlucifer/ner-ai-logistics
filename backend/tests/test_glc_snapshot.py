"""The bundled inventory is what PROVENANCE.md says it is.

These are the checks that catch a bad refresh: a file that parses but is the
wrong region, an accuracy vocabulary the loader no longer recognises, or a
corridor that stopped seeing the events that are visibly on it.
"""

import pytest

from app.domain.landslide import HistoryExposure, SourceState, assess_history
from app.services.landslide.base import BoundingBox
from app.services.landslide.history import (
    SNAPSHOT,
    GlcSnapshotInventory,
    build_inventory,
    load_snapshot,
)

# NH-27 Guwahati -> Jorhat, the demo corridor, coarsely sampled.
NH27 = [(26.14, 91.74), (26.20, 91.95), (26.25, 92.30), (26.40, 92.90), (26.60, 93.60), (26.75, 94.20)]


class TestTheFile:
    def test_it_is_bundled_and_the_seam_picks_it_up(self) -> None:
        assert SNAPSHOT.exists()
        assert isinstance(build_inventory(), GlcSnapshotInventory)

    def test_every_event_is_in_the_documented_box_with_a_year(self) -> None:
        events = load_snapshot()
        assert 400 <= len(events) <= 600  # 471 at fetch; a refresh may drift a little
        for e in events:
            assert 23.5 <= e.latitude <= 29.5 and 89.0 <= e.longitude <= 97.5
            assert e.event_date is not None and 2000 <= e.event_date.year <= 2030
            assert e.sources and e.sources[0].name

    def test_location_accuracy_is_read_not_assumed(self) -> None:
        events = load_snapshot()
        known = [e.location_accuracy_m for e in events if e.location_accuracy_m is not None]
        assert known, "the GLC publishes accuracy on nearly every row"
        assert {100.0, 1_000.0, 5_000.0} & set(known)
        # 'unknown' rows must stay None, never be promoted to exact.
        assert any(e.location_accuracy_m is None for e in events)


class TestTheCorridor:
    @pytest.mark.asyncio
    async def test_the_demo_corridor_has_recorded_history(self) -> None:
        box = BoundingBox(min_lat=26.0, min_lon=91.6, max_lat=26.9, max_lon=94.4)
        result = await GlcSnapshotInventory().events_near(box)
        assert result.state is SourceState.AVAILABLE
        assert result.provider == "nasa-glc-2007-2017-snapshot"
        assert len(result.incidents) >= 30

        history = assess_history(result, route=NH27)
        # Jorabat, Panikhaiti and Chandrapur (July 2017) sit on the road out of
        # Guwahati and are placed to 1-5 km. This is the evidence the demo
        # stands on, so if it goes missing the suite must say so.
        assert history.on_route_count >= 3
        assert history.exposure is HistoryExposure.HIGH
        assert history.imprecise_count >= 1
        assert history.inventory_to_year == 2017
        assert "LANDSLIDE_HISTORY_INVENTORY_AGED" in history.reason_codes

    @pytest.mark.asyncio
    async def test_a_box_with_nothing_in_it_answers_empty_not_unknown(self) -> None:
        box = BoundingBox(min_lat=28.9, min_lon=89.0, max_lat=29.4, max_lon=89.4)
        result = await GlcSnapshotInventory().events_near(box)
        assert result.state is SourceState.AVAILABLE
        assert result.incidents == ()
