"""A driver and a truck can be on ONE open job at a time.

WHAT THIS DEFENDS

The manager's trip list showed one driver/truck pair sitting on several open
DRAFT rows while another trip was already ASSIGNED to them. Nothing refused
it: trip creation checked each resource's OWN status (suspended, licence,
truck operational) and never asked whether another open trip already held
them. A dispatcher could promise one person and one vehicle to three jobs.

  * a second trip for a held driver is refused, and says which trip holds them
  * the same for a truck, including when the driver differs
  * two concurrent planners cannot both win the same pair
  * a refusal writes NOTHING - no orphan shipment behind a rejected trip
  * CANCELLED and CLOSED release; DELIVERED does not, because the truck is
    still at the consignee until someone closes the job
  * rows that already violate the rule are left exactly as they are
"""

import asyncio
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import TripStatus, UserRole
from app.models.operations import Shipment, Trip
from app.services import trips as trip_service
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

PICKUP = {"lat": 26.1445, "lon": 91.7362}
DROP = {"lat": 25.5788, "lon": 91.8933}


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


async def _pair(session: AsyncSession):
    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    await factories.make_assignment(session, driver, truck, verified=True)
    await session.commit()
    return driver, truck


def _plan(api: AsyncClient, headers: dict, driver, truck, code: str):
    """The same one-request planning path the manager console uses."""
    return api.post(
        "/api/trips/plan",
        headers=headers,
        json={
            "shipment": {
                "reference_code": f"SHP-{code[-6:]}",
                "client_name": "Brahmaputra Traders",
                "pickup_address": "Guwahati Depot",
                "pickup": PICKUP,
                "destination_address": "Shillong Depot",
                "destination": DROP,
                "cargo_items": [
                    {"cargo_type": "GENERAL", "cargo_name": "Consignment", "weight_kg": "1000", "quantity": 1}
                ],
            },
            "trip": {
                "trip_code": code,
                "truck_id": str(truck.id),
                "driver_id": str(driver.id),
            },
        },
    )


async def _counts() -> tuple[int, int]:
    from app.db import session as db_session

    async with db_session.get_sessionmaker()() as fresh:
        trips = (await fresh.execute(select(func.count(Trip.id)))).scalar_one()
        shipments = (await fresh.execute(select(func.count(Shipment.id)))).scalar_one()
        return trips, shipments


async def _set_status(trip_id, status: TripStatus) -> None:
    from app.db import session as db_session

    async with db_session.get_sessionmaker()() as writer:
        row = (await writer.execute(select(Trip).where(Trip.id == trip_id))).scalar_one()
        row.status = status
        await writer.commit()


class TestOneOpenJobPerResource:
    async def test_a_second_draft_for_the_same_pair_is_refused_and_names_the_first(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        driver, truck = await _pair(session)
        first = await _plan(api, manager_headers, driver, truck, f"{factories.TEST_TRIP_PREFIX}AAA1")
        assert first.status_code == 201, first.text

        before = await _counts()
        second = await _plan(api, manager_headers, driver, truck, f"{factories.TEST_TRIP_PREFIX}AAA2")
        assert second.status_code == 409, second.text
        body = second.json()["error"]
        assert body["code"] == "DRIVER_RESERVED_BY_TRIP"
        assert body["details"]["trip_code"] == first.json()["trip_code"]
        assert first.json()["trip_code"] in body["message"]
        assert await _counts() == before, "a refused plan left a shipment or trip behind"

    async def test_a_held_truck_is_refused_even_with_a_different_driver(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        from app.models.enums import AssignmentStatus
        from app.models.fleet import DriverTruckAssignment

        driver, truck = await _pair(session)
        assert (await _plan(api, manager_headers, driver, truck, f"{factories.TEST_TRIP_PREFIX}BBB1")).status_code == 201

        # The truck is re-paired to someone else while its trip is still open -
        # a truck has ONE active pairing, so this is how the case really arises.
        other, _ = await factories.make_driver(session)
        old_pairing = (
            await session.execute(
                select(DriverTruckAssignment).where(
                    DriverTruckAssignment.truck_id == truck.id,
                    DriverTruckAssignment.status == AssignmentStatus.ACTIVE,
                )
            )
        ).scalars().first()
        old_pairing.status = AssignmentStatus.ENDED
        await session.flush()
        await factories.make_assignment(session, other, truck, verified=True)
        await session.commit()
        before = await _counts()
        refused = await _plan(api, manager_headers, other, truck, f"{factories.TEST_TRIP_PREFIX}BBB2")
        assert refused.status_code == 409, refused.text
        assert refused.json()["error"]["code"] == "TRUCK_RESERVED_BY_TRIP"
        assert await _counts() == before

    @pytest.mark.parametrize(
        "status,expected",
        [
            (TripStatus.ASSIGNED, 409),
            (TripStatus.ACTIVE, 409),
            (TripStatus.DELIVERED, 409),  # the truck is still at the consignee
            (TripStatus.CLOSED, 201),
            (TripStatus.CANCELLED, 201),
        ],
    )
    async def test_the_lifecycle_decides_when_the_pair_comes_back(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, status, expected
    ):
        driver, truck = await _pair(session)
        first = await _plan(api, manager_headers, driver, truck, f"{factories.TEST_TRIP_PREFIX}C{status.value[:3]}")
        assert first.status_code == 201, first.text
        await _set_status(uuid.UUID(first.json()["id"]), status)

        again = await _plan(api, manager_headers, driver, truck, f"{factories.TEST_TRIP_PREFIX}D{status.value[:3]}")
        assert again.status_code == expected, f"{status.value}: {again.text}"

    async def test_two_planners_at_once_produce_one_trip(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        """The check and the write are one transaction; the second waits on the
        first one's row lock and then sees the trip it created."""
        driver, truck = await _pair(session)
        first, second = await asyncio.gather(
            _plan(api, manager_headers, driver, truck, f"{factories.TEST_TRIP_PREFIX}RACE1"),
            _plan(api, manager_headers, driver, truck, f"{factories.TEST_TRIP_PREFIX}RACE2"),
        )
        codes = sorted([first.status_code, second.status_code])
        assert codes == [201, 409], f"{first.status_code} {second.status_code}"

        from app.db import session as db_session

        async with db_session.get_sessionmaker()() as fresh:
            held = (
                await fresh.execute(
                    select(func.count(Trip.id)).where(
                        Trip.driver_id == driver.id,
                        Trip.status.in_(trip_service.RESOURCE_BLOCKING_STATUSES),
                    )
                )
            ).scalar_one()
        assert held == 1, f"{held} open trips hold one driver"

    async def test_rows_that_already_break_the_rule_are_left_alone(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        """No destructive cleanup: an existing double-booking predates the gate
        and is the manager's to resolve, not this code's to delete."""
        from app.db import session as db_session

        driver, truck = await _pair(session)
        first = await _plan(api, manager_headers, driver, truck, f"{factories.TEST_TRIP_PREFIX}LEG1")
        assert first.status_code == 201
        # A second trip on the same pair, written straight to the database the
        # way one that predates this gate would look.
        async with db_session.get_sessionmaker()() as writer:
            existing = (await writer.execute(select(Trip).where(Trip.id == uuid.UUID(first.json()["id"])))).scalar_one()
            writer.add(
                Trip(
                    trip_code=f"{factories.TEST_TRIP_PREFIX}LEG2",
                    shipment_id=existing.shipment_id,
                    truck_id=truck.id,
                    driver_id=driver.id,
                    status=TripStatus.DRAFT,
                )
            )
            await writer.commit()

        listed = await api.get("/api/trips?limit=100", headers=manager_headers)
        codes = [t["trip_code"] for t in listed.json()["items"]]
        assert f"{factories.TEST_TRIP_PREFIX}LEG1" in codes
        assert f"{factories.TEST_TRIP_PREFIX}LEG2" in codes, "a legacy conflict was hidden or deleted"

        refused = await _plan(api, manager_headers, driver, truck, f"{factories.TEST_TRIP_PREFIX}LEG3")
        assert refused.status_code == 409, "the gate must still refuse a NEW conflicting trip"


class TestWhoIsFree:
    async def test_the_holding_trip_is_reported_for_a_driver_and_a_truck(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        """The query the console uses to grey out a resource, checked directly
        so the UI and the refusal cannot disagree about who is free."""
        from app.db import session as db_session

        driver, truck = await _pair(session)
        free_driver, free_truck = await _pair(session)
        created = await _plan(api, manager_headers, driver, truck, f"{factories.TEST_TRIP_PREFIX}FREE1")
        assert created.status_code == 201

        async with db_session.get_sessionmaker()() as fresh:
            assert (await trip_service.blocking_trip_for(fresh, driver_id=driver.id)) is not None
            assert (await trip_service.blocking_trip_for(fresh, truck_id=truck.id)) is not None
            assert (await trip_service.blocking_trip_for(fresh, driver_id=free_driver.id)) is None
            assert (await trip_service.blocking_trip_for(fresh, truck_id=free_truck.id)) is None
