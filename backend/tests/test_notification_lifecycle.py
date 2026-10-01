"""Arrival and delivery reach the districts; a fuel stop does not.

WHAT THIS DEFENDS

An inbox that reports every event on every trip is an inbox nobody opens,
and the first thing that stops being read is the one that mattered. So the
rule is narrow on purpose: the LAST stop is an arrival the destination has
been waiting for, and every other stop is trip-timeline detail.

The transactional rule matters just as much: these rows are written inside
the business transaction. A delivery that rolls back must not leave four
managers believing a load arrived.
"""

import pytest
from sqlalchemy import select

from app.models.enums import NotificationKind, TripStatus, UserRole
from app.models.notifications import Notification
from app.models.operations import TripStop
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


async def _running_trip(session, *, stops=3):
    origin = await factories.make_district(session, slug="life-origin")
    dest = await factories.make_district(session, slug="life-dest")
    driver, user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    await factories.make_assignment(session, driver, truck, verified=True)
    shipment = await factories.make_shipment(
        session, origin_district_id=origin.id, destination_district_id=dest.id
    )
    trip = await factories.make_trip(
        session, driver, truck, shipment=shipment, status=TripStatus.ACTIVE, stops=stops
    )
    dm = await factories.make_user(
        session,
        role=UserRole.DISTRICT_MANAGER,
        state_id=dest.state_id,
        district_id=dest.id,
    )
    return trip, driver, user, dm


async def _kinds(session, user):
    rows = (
        await session.execute(
            select(Notification.kind).where(Notification.recipient_user_id == user.id)
        )
    ).scalars().all()
    return list(rows)


async def _stops(session, trip_id):
    return list(
        (
            await session.execute(
                select(TripStop)
                .where(TripStop.trip_id == trip_id)
                .order_by(TripStop.sequence)
            )
        )
        .scalars()
        .all()
    )


class TestArrival:
    async def test_the_final_stop_tells_the_districts_and_earlier_ones_do_not(
        self, api, session
    ):
        trip, driver, user, dm = await _running_trip(session, stops=3)
        headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
        stops = await _stops(session, trip.id)

        # First stop: arrive and finish. Nobody's inbox should move.
        for stop in stops[:-1]:
            assert (
                await api.post(
                    f"/api/driver/me/trip/stops/{stop.id}/arrive", headers=headers
                )
            ).status_code == 200
            assert (
                await api.post(
                    f"/api/driver/me/trip/stops/{stop.id}/complete", headers=headers
                )
            ).status_code == 200
        assert await _kinds(session, dm) == [], (
            "an inbox that reports every fuel stop is an inbox nobody reads"
        )

        # The last one is the arrival the destination has been waiting for.
        assert (
            await api.post(
                f"/api/driver/me/trip/stops/{stops[-1].id}/arrive", headers=headers
            )
        ).status_code == 200
        assert await _kinds(session, dm) == [NotificationKind.TRIP_ARRIVED]

    async def test_arriving_twice_is_one_notification(self, api, session):
        """A retry after a lost response must not raise a second arrival."""
        trip, driver, user, dm = await _running_trip(session, stops=1)
        headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
        stop = (await _stops(session, trip.id))[0]
        for _ in range(2):
            await api.post(
                f"/api/driver/me/trip/stops/{stop.id}/arrive", headers=headers
            )
        assert await _kinds(session, dm) == [NotificationKind.TRIP_ARRIVED]


class TestDelivery:
    async def test_completing_the_trip_tells_the_districts(self, api, session):
        trip, driver, user, dm = await _running_trip(session, stops=1)
        headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
        stop = (await _stops(session, trip.id))[0]
        await api.post(f"/api/driver/me/trip/stops/{stop.id}/arrive", headers=headers)
        await api.post(f"/api/driver/me/trip/stops/{stop.id}/complete", headers=headers)

        done = await api.post(
            "/api/driver/me/trip/complete",
            headers=headers,
            json={"trip_id": str(trip.id)},
        )
        assert done.status_code == 200, done.text
        assert NotificationKind.TRIP_DELIVERED in await _kinds(session, dm)

    async def test_a_trip_with_no_districts_notifies_nobody(self, api, session):
        """Null is "nobody said", not "tell everyone"."""
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        await factories.make_assignment(session, driver, truck, verified=True)
        trip = await factories.make_trip(
            session, driver, truck, status=TripStatus.ACTIVE, stops=1
        )
        watcher = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
        stop = (await _stops(session, trip.id))[0]

        await api.post(f"/api/driver/me/trip/stops/{stop.id}/arrive", headers=headers)
        assert await _kinds(session, watcher) == []
