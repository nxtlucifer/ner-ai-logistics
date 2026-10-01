"""A load that is not coming when it was promised.

WHAT THIS DEFENDS

The receiving district staffs a dock against an arrival time. So a delay
notice has to reach them, has to say why, and must never carry an arrival
the system does not actually hold - a fabricated new ETA is worse than no
ETA, because somebody will plan around it.

And it must not repeat. A hold re-reported by a provider refresh is not
news; a hold applied, lifted and applied again is.
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models.enums import (
    NotificationKind,
    NotificationSeverity,
    TripStatus,
    TripStopStatus,
    UserRole,
)
from app.models.notifications import Notification
from app.services import trips as trips_service
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

REASON = "Landslide clearance on NH-6, holding at the checkpoint"


async def _held_trip(session, *, planned_eta=None, current_eta=None):
    origin = await factories.make_district(session, slug="delay-origin")
    dest = await factories.make_district(session, slug="delay-dest")
    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    await factories.make_assignment(session, driver, truck, verified=True)
    shipment = await factories.make_shipment(
        session, origin_district_id=origin.id, destination_district_id=dest.id
    )
    trip = await factories.make_trip(
        session, driver, truck, shipment=shipment, status=TripStatus.ACTIVE
    )
    # HOLD_FOR_INSTRUCTION is a POST-PICKUP disposition: the branch only
    # runs once cargo is actually on the truck. A trip whose pickup is
    # still pending is a plain cancel, and no hold is recorded.
    stops = await trips_service.stops_for(session, trip.id)
    stops[0].status = TripStopStatus.COMPLETED
    if planned_eta:
        trip.planned_eta = planned_eta
    if current_eta:
        trip.current_eta = current_eta
    origin_dm = await factories.make_user(
        session,
        role=UserRole.DISTRICT_MANAGER,
        state_id=origin.state_id,
        district_id=origin.id,
    )
    dest_dm = await factories.make_user(
        session,
        role=UserRole.DISTRICT_MANAGER,
        state_id=dest.state_id,
        district_id=dest.id,
    )
    await session.commit()
    return trip, driver, truck, origin_dm, dest_dm


async def _inbox(session, user):
    return list(
        (
            await session.execute(
                select(Notification).where(Notification.recipient_user_id == user.id)
            )
        )
        .scalars()
        .all()
    )


async def _hold(api, headers, trip, reason=REASON):
    return await api.post(
        f"/api/trips/{trip.id}/cancel",
        headers=headers,
        json={"reason": reason, "disposition": "HOLD_FOR_INSTRUCTION"},
    )


@pytest.fixture
async def manager_headers(api, session):
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


class TestWhoIsTold:
    async def test_both_districts_hear_about_the_hold(
        self, api, session, manager_headers
    ):
        trip, driver, truck, origin_dm, dest_dm = await _held_trip(session)
        r = await _hold(api, manager_headers, trip)
        assert r.status_code == 200, r.text

        for who in (origin_dm, dest_dm):
            kinds = [n.kind for n in await _inbox(session, who)]
            assert NotificationKind.TRIP_DELAYED in kinds

    async def test_the_notice_carries_what_a_manager_acts_on(
        self, api, session, manager_headers
    ):
        trip, driver, truck, origin_dm, _ = await _held_trip(session)
        await _hold(api, manager_headers, trip)

        note = next(
            n for n in await _inbox(session, origin_dm)
            if n.kind is NotificationKind.TRIP_DELAYED
        )
        assert note.payload["trip_code"] == trip.trip_code
        assert note.payload["driver_name"] == driver.full_name
        assert note.payload["truck"] == truck.registration_number
        assert REASON in note.payload["reason"]
        assert note.payload["at"]
        # A delay is a warning, not an emergency: URGENT is reserved for a
        # person asking for help, or it stops meaning anything.
        assert note.severity is NotificationSeverity.WARNING

    async def test_a_trip_with_no_districts_notifies_nobody(
        self, api, session, manager_headers
    ):
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        await factories.make_assignment(session, driver, truck, verified=True)
        trip = await factories.make_trip(
            session, driver, truck, status=TripStatus.ACTIVE
        )
        watcher = await factories.make_user(session, role=UserRole.MANAGER)
        await session.commit()

        await _hold(api, manager_headers, trip)
        assert await _inbox(session, watcher) == []


class TestEtaHonesty:
    async def test_an_eta_the_system_does_not_hold_is_null_not_invented(
        self, api, session, manager_headers
    ):
        trip, *_, origin_dm, _ = await _held_trip(session)
        await _hold(api, manager_headers, trip)

        note = next(
            n for n in await _inbox(session, origin_dm)
            if n.kind is NotificationKind.TRIP_DELAYED
        )
        # Null reads as "not known". A number here would be read as a
        # promise, and the consignee would staff a dock for it.
        assert note.payload["planned_eta"] is None
        assert note.payload["current_eta"] is None

    async def test_a_real_planned_eta_is_passed_through(
        self, api, session, manager_headers
    ):
        due = datetime.now(UTC) + timedelta(hours=4)
        trip, *_, origin_dm, _ = await _held_trip(session, planned_eta=due)
        await _hold(api, manager_headers, trip)

        note = next(
            n for n in await _inbox(session, origin_dm)
            if n.kind is NotificationKind.TRIP_DELAYED
        )
        assert note.payload["planned_eta"] is not None
        # Compare INSTANTS. The stored value comes back in the database
        # session's timezone, so a date-prefix match passes in Europe and
        # fails after 18:30 UTC in India - a green suite that depends on
        # the hour it ran is worse than no test.
        sent = datetime.fromisoformat(note.payload["planned_eta"])
        assert abs((sent - due).total_seconds()) < 1


class TestDedupe:
    async def test_the_same_hold_twice_in_a_day_is_one_notice(
        self, api, session, manager_headers
    ):
        trip, *_, origin_dm, _ = await _held_trip(session)
        await _hold(api, manager_headers, trip)
        await _hold(api, manager_headers, trip, reason="Still holding, same block")

        delays = [
            n for n in await _inbox(session, origin_dm)
            if n.kind is NotificationKind.TRIP_DELAYED
        ]
        assert len(delays) == 1, "a re-reported hold is not news"
