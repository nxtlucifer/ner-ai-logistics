"""State/District scope at the HTTP boundary - the IDOR matrix.

`app/core/scope.py` decides who may see a trip; these tests prove the decision
is applied on every real route a scoped manager can reach, and that the list
and the single read agree. Out-of-scope rows are 404 (never 403), so the id
space is not an oracle. Pre-existing roles keep fleet-wide reach.
"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import TripStatus, UserRole
from tests import factories
from tests.conftest import auth_headers
from tests.test_state_district_scope import _trip_between

pytestmark = pytest.mark.requires_db


async def _manager(api, session, role, district):
    user = await factories.make_user(
        session, role=role, state_id=district.state_id,
        district_id=district.id if role is UserRole.DISTRICT_MANAGER else None,
    )
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


@pytest.fixture
async def world(session: AsyncSession):
    """Two districts in Assam, one in Meghalaya; three trips."""
    a = await factories.make_district(session, state_slug="assam")
    b = await factories.make_district(session, state_slug="assam")
    m = await factories.make_district(session, state_slug="meghalaya")
    return {
        "a": a, "b": b, "m": m,
        "a_to_b": await _trip_between(session, a, b),   # inside Assam
        "b_to_m": await _trip_between(session, b, m),   # crosses the border
        "m_to_m": await _trip_between(session, m, m),   # Meghalaya only
    }


class TestDistrictManager:
    async def test_list_detail_events_and_routes_agree(self, api: AsyncClient, session, world):
        headers = await _manager(api, session, UserRole.DISTRICT_MANAGER, world["a"])
        codes = {t["trip_code"] for t in (await api.get("/api/trips?limit=100", headers=headers)).json()["items"]}
        assert world["a_to_b"].trip_code in codes
        assert world["b_to_m"].trip_code not in codes
        assert world["m_to_m"].trip_code not in codes
        mine, theirs = world["a_to_b"].id, world["m_to_m"].id
        assert (await api.get(f"/api/trips/{mine}", headers=headers)).status_code == 200
        for path in ("", "/events", "/routes", "/reroute"):
            r = await api.get(f"/api/trips/{theirs}{path}", headers=headers)
            assert r.status_code == 404, (path, r.text)

    async def test_arriving_truck_is_visible_to_the_destination(self, api, session, world):
        headers = await _manager(api, session, UserRole.DISTRICT_MANAGER, world["m"])
        codes = {t["trip_code"] for t in (await api.get("/api/trips?limit=100", headers=headers)).json()["items"]}
        assert world["b_to_m"].trip_code in codes, "a truck arriving is the destination district's business"
        assert world["a_to_b"].trip_code not in codes

    async def test_mutations_on_another_districts_trip_are_404(self, api, session, world):
        headers = await _manager(api, session, UserRole.DISTRICT_MANAGER, world["a"])
        theirs = world["m_to_m"].id
        assert (await api.post(f"/api/trips/{theirs}/dispatch", headers=headers)).status_code == 404
        assert (await api.post(f"/api/trips/{theirs}/cancel", headers=headers, json={})).status_code == 404
        assert (await api.post(f"/api/trips/{theirs}/routes/recalculate", headers=headers, json={})).status_code == 404

    async def test_shipments_and_fleet_are_scoped(self, api, session, world):
        headers = await _manager(api, session, UserRole.DISTRICT_MANAGER, world["a"])
        refs = {s["id"] for s in (await api.get("/api/shipments?limit=100", headers=headers)).json()["items"]}
        assert str(world["a_to_b"].shipment_id) in refs
        assert str(world["m_to_m"].shipment_id) not in refs
        for t in ("a_to_b", "m_to_m"):
            world[t].status = TripStatus.ACTIVE
        await session.commit()
        fleet = {t["trip_code"] for t in (await api.get("/api/fleet/active", headers=headers)).json()["trips"]}
        assert world["a_to_b"].trip_code in fleet and world["m_to_m"].trip_code not in fleet


class TestStateManager:
    async def test_sees_the_whole_state_and_the_crossing_trip_only(self, api, session, world):
        headers = await _manager(api, session, UserRole.STATE_MANAGER, world["a"])
        codes = {t["trip_code"] for t in (await api.get("/api/trips?limit=100", headers=headers)).json()["items"]}
        assert world["a_to_b"].trip_code in codes
        assert world["b_to_m"].trip_code in codes
        assert world["m_to_m"].trip_code not in codes
        assert (await api.get(f"/api/trips/{world['m_to_m'].id}", headers=headers)).status_code == 404
        assert (await api.get(f"/api/trips/{world['b_to_m'].id}", headers=headers)).status_code == 200

    async def test_the_other_state_sees_the_crossing_trip_too(self, api, session, world):
        headers = await _manager(api, session, UserRole.STATE_MANAGER, world["m"])
        assert (await api.get(f"/api/trips/{world['b_to_m'].id}", headers=headers)).status_code == 200
        assert (await api.get(f"/api/trips/{world['a_to_b'].id}", headers=headers)).status_code == 404


class TestLegacyManagerUnchanged:
    async def test_manager_still_sees_every_trip(self, api, session, world):
        user = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, user.email, factories.TEST_PASSWORD)
        codes = {t["trip_code"] for t in (await api.get("/api/trips?limit=100", headers=headers)).json()["items"]}
        assert {world[k].trip_code for k in ("a_to_b", "b_to_m", "m_to_m")} <= codes
        assert (await api.get(f"/api/trips/{world['m_to_m'].id}", headers=headers)).status_code == 200
