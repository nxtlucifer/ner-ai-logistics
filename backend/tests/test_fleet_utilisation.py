"""A utilisation figure needs a denominator that means something.

WHAT THIS DEFENDS

Fleet Command shows ACTIVE TRIPS, ACTIVE DRIVERS, UTILISATION and
ATTENTION. Three of those are counts of rows. The fourth is a ratio, and a
ratio is where a dashboard lies most easily.

A truck belongs to the fleet; only a TRIP carries districts. So for a
district manager the numerator ("trucks of mine that are moving") is
scoped and the denominator ("trucks there are") is not. Dividing one by
the other yields a confident percentage that describes nothing - a
district manager with one moving truck out of a nine-truck national fleet
would read 11% utilisation of a fleet they do not have.

So the server sends `trucks_total: null` to a scoped role, and the client
omits the card. Null is not zero, and it is not a rounding-down of a
number nobody can compute.
"""

import pytest

from app.models.enums import TripStatus, TruckStatus, UserRole
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


async def _snapshot(api, user):
    headers = await auth_headers(api, user.email or user.phone, factories.TEST_PASSWORD)
    r = await api.get("/api/fleet/active", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


class TestTheDenominator:
    async def test_an_unscoped_manager_gets_a_truck_count(self, api, session):
        await factories.make_truck(session)
        boss = await factories.make_user(session, role=UserRole.MANAGER)

        body = await _snapshot(api, boss)
        assert body["trucks_total"] is not None
        assert body["trucks_total"] >= 1

    async def test_the_regional_manager_gets_one_too(self, api, session):
        boss = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        assert (await _snapshot(api, boss))["trucks_total"] is not None

    async def test_a_state_manager_gets_null_not_zero(self, api, session):
        """The question has no answer for them, and null says so.

        Zero would be read as "no trucks", which is false and worse than
        saying nothing."""
        district = await factories.make_district(session, slug="util-sm")
        sm = await factories.make_user(
            session, role=UserRole.STATE_MANAGER, state_id=district.state_id
        )
        assert (await _snapshot(api, sm))["trucks_total"] is None

    async def test_a_district_manager_gets_null_too(self, api, session):
        district = await factories.make_district(session, slug="util-dm")
        dm = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=district.state_id,
            district_id=district.id,
        )
        assert (await _snapshot(api, dm))["trucks_total"] is None


class TestWhatIsCounted:
    async def test_a_retired_truck_is_not_in_the_denominator(self, api, session):
        """Utilisation over trucks that have left the fleet would fall every
        time one was retired, which is the opposite of what happened."""
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        before = (await _snapshot(api, boss))["trucks_total"]

        await factories.make_truck(session, status=TruckStatus.RETIRED)
        assert (await _snapshot(api, boss))["trucks_total"] == before

        await factories.make_truck(session, status=TruckStatus.AVAILABLE)
        assert (await _snapshot(api, boss))["trucks_total"] == before + 1


class TestTheNumeratorStillScopes:
    async def test_the_trip_list_is_scoped_even_though_the_count_is_not(
        self, api, session
    ):
        """The denominator being fleet-wide must not leak the fleet's TRIPS.

        This is the failure the whole feature invites: adding a global count
        to a scoped payload, and quietly globalising the rest of it.
        """
        mine = await factories.make_district(session, slug="util-mine")
        theirs = await factories.make_district(session, slug="util-theirs")
        dm = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )

        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        await factories.make_assignment(session, driver, truck, verified=True)
        shipment = await factories.make_shipment(
            session, origin_district_id=theirs.id, destination_district_id=theirs.id
        )
        elsewhere = await factories.make_trip(
            session, driver, truck, shipment=shipment, status=TripStatus.ACTIVE
        )
        await session.commit()

        body = await _snapshot(api, dm)
        codes = {t["trip_code"] for t in body["trips"]}
        assert elsewhere.trip_code not in codes, (
            "a fleet-wide truck count came with fleet-wide trips"
        )
