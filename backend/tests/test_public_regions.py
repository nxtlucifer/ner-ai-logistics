"""The one unauthenticated read in the organisation API.

WHY IT EXISTS

The sign-in screen asks which region to open before anybody has a token.
It used to populate that picker from `/api/org/states`, which requires
TRIP_READ — so "A state" opened a dropdown that was empty every single
time, on every deployment, for every user. A control that cannot work is
worse than no control: it teaches an operator the product is broken.

WHY IT IS SAFE, AND WHAT KEEPS IT THAT WAY

Everything below is a property this endpoint must not lose:

  1. It answers without a token (otherwise it is pointless).
  2. It carries NAMES and IDS and nothing else — no counts, no
     provenance strings, no manager, driver, truck or trip data.
  3. Test and unverified districts never appear, exactly as in the
     authenticated list. The public shape is not a second, laxer filter.
  4. Knowing a region id grants nothing. `_workspace_matches` still
     compares the choice against the account, and a mismatch is refused
     with the same message as a wrong password.
"""

import pytest

from app.api.org import reset_regions_cache
from app.models.enums import DistrictSource, UserRole
from app.models.geography import operational_sources
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


@pytest.fixture(autouse=True)
def _fresh_cache():
    # The endpoint memoises for five minutes so an unauthenticated caller
    # cannot make the database work. Every test here wants a real read.
    reset_regions_cache()
    yield
    reset_regions_cache()


class TestItAnswersWithoutAToken:
    async def test_no_authorization_header_is_fine(self, api):
        r = await api.get("/api/org/regions")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    async def test_the_authenticated_list_still_needs_a_token(self, api):
        """The public shape is an addition, not a hole in the old one."""
        assert (await api.get("/api/org/states")).status_code == 401
        assert (await api.get("/api/org/districts")).status_code == 401

    async def test_it_names_the_eight_states(self, api):
        rows = (await api.get("/api/org/regions")).json()
        names = {r["name"] for r in rows}
        for expected in ("Assam", "Meghalaya", "Nagaland", "Sikkim"):
            assert expected in names


class TestItCarriesNothingElse:
    async def test_a_region_has_exactly_four_keys(self, api):
        rows = (await api.get("/api/org/regions")).json()
        assert rows, "no states seeded"
        for row in rows:
            assert set(row) == {"id", "name", "slug", "districts"}

    async def test_a_district_has_exactly_three_keys(self, api, session):
        await factories.make_district(
            session, state_slug="assam", slug="public-shape-check"
        )
        await session.commit()
        rows = (await api.get("/api/org/regions")).json()
        for row in rows:
            for d in row["districts"]:
                assert set(d) == {"id", "name", "disputed_or_recently_changed"}

    async def test_it_publishes_no_count_and_no_provenance(self, api):
        blob = (await api.get("/api/org/regions")).text
        for leaked in ("district_count", "source_status", "source_name", "TEST"):
            assert leaked not in blob


class TestTheProvenanceFilterIsTheSameOne:
    async def test_a_test_district_is_not_published(self, api, session):
        d = await factories.make_district(
            session, state_slug="sikkim", slug="public-residue"
        )
        await session.commit()
        # The factory marks its districts TEST for exactly this reason.
        assert d.source_status is DistrictSource.TEST
        assert d.source_status not in operational_sources()

        rows = (await api.get("/api/org/regions")).json()
        published = {x["name"] for row in rows for x in row["districts"]}
        assert d.name not in published

    async def test_it_agrees_with_the_authenticated_list(self, api, session):
        boss = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        headers = await auth_headers(api, boss.email, factories.TEST_PASSWORD)
        private = {
            d["name"]
            for d in (await api.get("/api/org/districts", headers=headers)).json()
        }
        rows = (await api.get("/api/org/regions")).json()
        public = {x["name"] for row in rows for x in row["districts"]}
        assert public == private, "the public shape is filtering differently"


class TestKnowingARegionGrantsNothing:
    async def test_a_state_id_read_from_the_public_list_is_still_checked(
        self, api, session
    ):
        """The whole point of the picker being a hint.

        A district manager can now read every state id without signing in.
        Signing in *as* another state must still fail, and fail the same
        way a wrong password does — no clue about which half was wrong.
        """
        rows = (await api.get("/api/org/regions")).json()
        by_name = {r["name"]: r["id"] for r in rows}

        assam = await factories.get_state(session, "assam")
        user = await factories.make_user(
            session, role=UserRole.STATE_MANAGER, state_id=assam.id
        )
        await session.commit()

        wrong = await api.post(
            "/api/auth/login",
            json={
                "identifier": user.email,
                "password": factories.TEST_PASSWORD,
                "workspace": "STATE",
                "workspace_state_id": by_name["Meghalaya"],
            },
        )
        assert wrong.status_code == 401, wrong.text

        right = await api.post(
            "/api/auth/login",
            json={
                "identifier": user.email,
                "password": factories.TEST_PASSWORD,
                "workspace": "STATE",
                "workspace_state_id": by_name["Assam"],
            },
        )
        assert right.status_code == 200, right.text
        # Same message either way: the form cannot be used to discover
        # which state an address manages.
        assert wrong.json()["error"]["message"] == "Invalid credentials."
