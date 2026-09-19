"""The fuel layer, and the rule that produced it.

WHY THIS TEST EXISTS

`FUEL` was deliberately absent for a while. The snapshot held four
categories and no `amenity=fuel` records, and adding the enum value
without the data would have rendered an empty layer that a manager reads
as *"there are no petrol stations on this corridor"* rather than *"we did
not collect them"* — the same class of lie as counting 230 pytest
fixtures as configured districts.

It was added on 20 September 2026 together with a bounded Overpass
extract across the eight states. So the invariant worth holding is not
"FUEL exists" but **"every offered category has data behind it"**. If
someone adds a sixth category one afternoon and the extract never
happens, this fails.
"""

import json
from collections import Counter
from pathlib import Path

import pytest

from app.domain.places import PlaceCategory
from app.models.enums import UserRole
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

SNAPSHOT = (
    Path(__file__).resolve().parents[1]
    / "app" / "services" / "places" / "data" / "corridor_snapshot.json"
)

# A box over Guwahati, inside the coverage and inside the provider bound.
BOX = "south=26.05&west=91.65&north=26.25&east=91.85"


def snapshot() -> dict:
    return json.loads(SNAPSHOT.read_text(encoding="utf8"))


class TestEveryOfferedCategoryHasData:
    def test_no_category_is_offered_without_records(self):
        """The invariant. An offered category with no rows is a layer that
        lies about the world rather than about our data collection."""
        counts = Counter(p["category"] for p in snapshot()["places"])
        missing = [c.value for c in PlaceCategory if counts.get(c.value, 0) == 0]
        assert missing == [], (
            f"{missing} is offered by PlaceCategory but has no records in the "
            "snapshot. Either acquire the data "
            "(backend/scripts/acquire_places_snapshot.py) or remove the category."
        )

    def test_fuel_specifically_is_populated(self):
        counts = Counter(p["category"] for p in snapshot()["places"])
        assert counts["FUEL"] > 100, f"only {counts['FUEL']} fuel records"


class TestTheSnapshotDescribesItself:
    def test_it_carries_licence_and_attribution(self):
        source = snapshot()["source"]
        assert "OpenStreetMap" in source["attribution"]
        assert "ODbL" in source["licence"]
        assert source["retrieved_at"]

    def test_it_states_that_absence_is_not_absence(self):
        """The wording that stops a reader treating an empty layer as a
        fact about the road."""
        limits = snapshot()["coverage"]["limits"].lower()
        assert "not mapped" in limits
        assert "not absence in reality" in limits

    def test_it_makes_no_claim_about_any_place(self):
        blob = json.dumps(snapshot()).lower()
        for word in ("guaranteed", "safe stop", "verified safe", "always open"):
            assert word not in blob


class TestCoordinatesAreSane:
    def test_every_place_is_inside_the_region(self):
        # A nonsense coordinate on a dispatcher's map is worse than a
        # missing pin, and Overpass will happily return a node whose
        # `center` is elsewhere if the query is wrong.
        for place in snapshot()["places"]:
            assert 20.0 <= place["lat"] <= 30.5, place
            assert 86.0 <= place["lon"] <= 98.5, place

    def test_provider_ids_are_unique(self):
        ids = [p["provider_id"] for p in snapshot()["places"]]
        assert len(ids) == len(set(ids)), "the same OSM element appears twice"

    def test_every_record_names_its_osm_element(self):
        for place in snapshot()["places"]:
            assert place["provider_id"].startswith("osm:")


class TestServedOverTheApi:
    async def test_a_manager_can_ask_for_fuel(self, api, session):
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, boss.email, factories.TEST_PASSWORD)
        r = await api.get(f"/api/places?category=FUEL&{BOX}", headers=headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["state"] in ("AVAILABLE", "OUTSIDE_COVERAGE")

    async def test_the_answer_still_carries_its_source(self, api, session):
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, boss.email, factories.TEST_PASSWORD)
        body = (await api.get(f"/api/places?category=FUEL&{BOX}", headers=headers)).json()
        if body["places"]:
            assert body["source"]["is_live"] is False
            assert "ODbL" in body["source"]["licence"]
