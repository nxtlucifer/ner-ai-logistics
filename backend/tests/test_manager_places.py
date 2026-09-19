"""Roadside services for the manager map.

The driver has had this for a while, scoped to their own authorised route.
A manager planning a corridor needs the same answer for a map area, and
there was no endpoint for it.

WHAT THESE TESTS ARE ABOUT

Not "does it return places" — that is the snapshot's job and it already
has tests. These cover the three ways a place-finder on an operational
console goes wrong:

  * it answers someone who should not be asking,
  * it accepts a query that asks for the whole region,
  * it says something about a place that the data does not support.
"""

import pytest

from app.models.enums import UserRole
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

# A small box over Guwahati. Inside the snapshot's coverage and well inside
# the provider's size bound.
BOX = {"south": 26.05, "west": 91.65, "north": 26.25, "east": 91.85}

# The snapshot holds four categories and 720 records: EMERGENCY (281),
# HOTEL (311), TYRES (118), REST (10).
#
# **There is no FUEL category, and none is invented here.** The mission
# brief asks for a fuel layer and it is the single most useful one for a
# truck, but the extract in `app/services/places/data/corridor_snapshot.json`
# contains no `amenity=fuel` records. Adding the enum value without the data
# would give a manager an empty layer that looks like "no petrol stations on
# this corridor" rather than "we did not collect them". Recorded as a gap in
# docs/FINAL_SOURCE_ADMISSION_LEDGER.md; it needs a new Overpass extract,
# not a code change.
CATEGORIES = ("EMERGENCY", "TYRES", "HOTEL", "REST")


async def _get(api, user, **params):
    headers = await auth_headers(api, user.email or user.phone, factories.TEST_PASSWORD)
    query = "&".join(f"{k}={v}" for k, v in {**BOX, **params}.items())
    return await api.get(f"/api/places?{query}", headers=headers)


class TestWhoMayAsk:
    async def test_a_manager_may(self, api, session):
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        r = await _get(api, boss, category="EMERGENCY")
        assert r.status_code == 200, r.text

    async def test_every_scoped_manager_may_too(self, api, session):
        """A corridor that crosses a border needs the services on both
        sides of it. A petrol station is a public fact about a road, not a
        record belonging to a state."""
        district = await factories.make_district(session, slug="places-dm")
        for role, extra in (
            (UserRole.NORTH_EAST_MANAGER, {}),
            (UserRole.STATE_MANAGER, {"state_id": district.state_id}),
            (
                UserRole.DISTRICT_MANAGER,
                {"state_id": district.state_id, "district_id": district.id},
            ),
        ):
            user = await factories.make_user(session, role=role, **extra)
            r = await _get(api, user, category="EMERGENCY")
            assert r.status_code == 200, f"{role}: {r.text}"

    async def test_an_anonymous_caller_may_not(self, api):
        query = "&".join(f"{k}={v}" for k, v in BOX.items())
        r = await api.get(f"/api/places?category=EMERGENCY&{query}")
        assert r.status_code == 401

    async def test_a_driver_may_not_use_the_manager_endpoint(self, api, session):
        """Drivers have their own, scoped to their own route. This one
        takes an arbitrary box, which is a different question."""
        _, user = await factories.make_driver(session)
        r = await _get(api, user, category="EMERGENCY")
        assert r.status_code == 403


class TestTheQueryIsBounded:
    async def test_a_region_sized_box_is_refused_with_a_next_step(self, api, session):
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, boss.email, factories.TEST_PASSWORD)
        r = await api.get(
            "/api/places?category=EMERGENCY&south=6&west=68&north=36&east=98",
            headers=headers,
        )
        # 422 is this codebase's status for a business-rule refusal; the
        # CODE is what distinguishes it from a malformed request.
        assert r.status_code == 422, r.text
        body = r.json()["error"]
        assert body["code"] == "BUSINESS_RULE_VIOLATION"
        # The manager is told what to do, not told the provider's limit.
        assert "zoom in" in body["message"].lower()
        assert "degree" not in body["message"].lower()

    async def test_an_inverted_box_is_refused(self, api, session):
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, boss.email, factories.TEST_PASSWORD)
        r = await api.get(
            "/api/places?category=EMERGENCY&south=26.25&west=91.85&north=26.05&east=91.65",
            headers=headers,
        )
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == "BUSINESS_RULE_VIOLATION"

    async def test_an_unknown_category_is_rejected_before_any_lookup(self, api, session):
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, boss.email, factories.TEST_PASSWORD)
        query = "&".join(f"{k}={v}" for k, v in BOX.items())
        r = await api.get(f"/api/places?category=DEFINITELY_NOT&{query}", headers=headers)
        assert r.status_code == 422
        # A different cause from the bounded-box refusal above, and the
        # code says so rather than both looking like the same failure.
        assert r.json()["error"]["code"] == "VALIDATION_ERROR"


class TestTheAnswerIsHonest:
    async def test_it_names_its_source_and_when_it_was_taken(self, api, session):
        """A snapshot with no date on it is indistinguishable from live
        data, and this one is neither live nor recent."""
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        body = (await _get(api, boss, category="EMERGENCY")).json()
        if body["places"]:
            source = body["source"]
            assert source is not None
            assert source["attribution"]
            assert source["licence"]
            assert source["retrieved_at"]
            assert source["is_live"] is False

    async def test_no_place_is_described_as_safe(self, api, session):
        """A mapped hospital is a hospital on a map. It is not a promise
        that it is open, reachable, or equipped."""
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        body = (await _get(api, boss, category="EMERGENCY")).json()
        blob = str(body).lower()
        for word in ("guaranteed", "safe stop", "verified safe", "always open"):
            assert word not in blob, f"the response claims {word!r}"

    async def test_distance_is_labelled_straight_line(self, api, session):
        # A shop across a river is 200 m away and 20 km to reach. The field
        # name is the whole mitigation.
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        body = (await _get(api, boss, category="EMERGENCY")).json()
        for place in body["places"]:
            assert "straight_line_m" in place
            assert "driving_distance" not in place
            assert "eta" not in place
