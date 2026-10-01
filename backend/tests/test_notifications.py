"""A dispatch reaches the people either end of the corridor, once.

WHAT THIS DEFENDS

Three separate failures, each of which makes an inbox worthless:

  * addressing the wrong people - a truck's own fleet manager is not the
    same person as the district it is arriving in;
  * telling everyone the same thing - "a truck left" is the origin's fact,
    "a truck is coming" is the destination's, and only the second changes
    what the destination does today;
  * repetition - a provider refresh must not raise the same event again.
"""

import pytest
from sqlalchemy import select

from app.models.enums import NotificationKind, NotificationSeverity, TripStatus, UserRole
from app.models.notifications import Notification
from app.services import notifications, trips as trip_service
from tests import factories

pytestmark = pytest.mark.requires_db


async def _corridor(session, *, origin_state="assam", dest_state="assam"):
    origin = await factories.make_district(
        session, state_slug=origin_state, slug=f"n-{origin_state}-origin"
    )
    dest = await factories.make_district(
        session, state_slug=dest_state, slug=f"n-{dest_state}-dest"
    )
    return origin, dest


async def _trip(session, origin, dest, *, status=TripStatus.DRAFT):
    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    await factories.make_assignment(session, driver, truck, verified=True)
    shipment = await factories.make_shipment(
        session, origin_district_id=origin.id, destination_district_id=dest.id
    )
    trip = await factories.make_trip(
        session, driver, truck, shipment=shipment, status=status
    )
    return trip


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


class TestRecipients:
    async def test_both_district_managers_are_recipients(self, session):
        origin, dest = await _corridor(session)
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
        trip = await _trip(session, origin, dest)

        ids = {u.id for u in await notifications.recipients_for_trip(session, trip)}
        assert {origin_dm.id, dest_dm.id} <= ids

    async def test_a_state_manager_appears_once_for_an_internal_trip(self, session):
        """Both districts in one state must not mean two notifications."""
        origin, dest = await _corridor(session)
        sm = await factories.make_user(
            session, role=UserRole.STATE_MANAGER, state_id=origin.state_id
        )
        trip = await _trip(session, origin, dest)

        people = await notifications.recipients_for_trip(session, trip)
        assert [u.id for u in people].count(sm.id) == 1

    async def test_an_unscoped_manager_is_not_a_recipient(self, session):
        """ADMIN and MANAGER see every trip already; an inbox full of every
        dispatch in the region is an inbox nobody reads."""
        origin, dest = await _corridor(session)
        legacy = await factories.make_user(session, role=UserRole.MANAGER)
        trip = await _trip(session, origin, dest)

        ids = {u.id for u in await notifications.recipients_for_trip(session, trip)}
        assert legacy.id not in ids

    async def test_a_trip_with_no_districts_reaches_nobody(self, session):
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        trip = await factories.make_trip(session, driver, truck)
        assert await notifications.recipients_for_trip(session, trip) == []

    async def test_a_deactivated_manager_stops_receiving(self, session):
        origin, dest = await _corridor(session)
        retired = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=origin.state_id,
            district_id=origin.id,
        )
        retired.is_active = False
        await session.commit()
        trip = await _trip(session, origin, dest)

        ids = {u.id for u in await notifications.recipients_for_trip(session, trip)}
        assert retired.id not in ids


class TestWriting:
    async def test_the_same_event_twice_writes_one_row(self, session):
        origin, dest = await _corridor(session)
        dm = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=origin.state_id,
            district_id=origin.id,
        )
        trip = await _trip(session, origin, dest)

        first = await notifications.notify(
            session,
            recipients=[dm],
            kind=NotificationKind.ROUTE_CHANGED,
            dedupe_key=f"route:{trip.id}:r1",
            trip_id=trip.id,
        )
        second = await notifications.notify(
            session,
            recipients=[dm],
            kind=NotificationKind.ROUTE_CHANGED,
            dedupe_key=f"route:{trip.id}:r1",
            trip_id=trip.id,
        )
        await session.commit()

        assert (first, second) == (1, 0)
        assert len(await _inbox(session, dm)) == 1

    async def test_a_new_revision_is_a_new_notification(self, session):
        origin, dest = await _corridor(session)
        dm = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=origin.state_id,
            district_id=origin.id,
        )
        trip = await _trip(session, origin, dest)
        for revision in ("r1", "r2"):
            await notifications.notify(
                session,
                recipients=[dm],
                kind=NotificationKind.ROUTE_CHANGED,
                dedupe_key=f"rev:{trip.id}:{revision}",
                trip_id=trip.id,
            )
        await session.commit()
        assert len(await _inbox(session, dm)) == 2

    async def test_an_emergency_is_urgent_and_a_dispatch_is_not(self, session):
        origin, dest = await _corridor(session)
        dm = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=origin.state_id,
            district_id=origin.id,
        )
        trip = await _trip(session, origin, dest)
        await notifications.notify(
            session,
            recipients=[dm],
            kind=NotificationKind.DRIVER_EMERGENCY_STOP,
            dedupe_key=f"sos:{trip.id}",
            trip_id=trip.id,
        )
        await notifications.notify(
            session,
            recipients=[dm],
            kind=NotificationKind.TRIP_DISPATCHED,
            dedupe_key=f"disp:{trip.id}",
            trip_id=trip.id,
        )
        await session.commit()

        by_kind = {n.kind: n.severity for n in await _inbox(session, dm)}
        assert by_kind[NotificationKind.DRIVER_EMERGENCY_STOP] is NotificationSeverity.URGENT
        assert by_kind[NotificationKind.TRIP_DISPATCHED] is NotificationSeverity.INFO


class TestInbox:
    async def test_reads_only_your_own_and_marks_only_your_own(self, session):
        origin, dest = await _corridor(session)
        mine = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=origin.state_id,
            district_id=origin.id,
        )
        theirs = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=dest.state_id,
            district_id=dest.id,
        )
        trip = await _trip(session, origin, dest)
        await notifications.notify(
            session,
            recipients=[mine, theirs],
            kind=NotificationKind.TRIP_DISPATCHED,
            dedupe_key=f"both:{trip.id}",
            trip_id=trip.id,
        )
        await session.commit()

        theirs_row = (await _inbox(session, theirs))[0]
        # Marking someone else's notification read finds nothing - it is not
        # refused with an error, which would confirm the id exists.
        assert await notifications.mark_read(session, mine, [theirs_row.id]) == 0
        assert (await session.get(Notification, theirs_row.id)).is_read is False

        my_row = (await _inbox(session, mine))[0]
        assert await notifications.mark_read(session, mine, [my_row.id]) == 1
        await session.commit()
        assert (await session.get(Notification, my_row.id)).read_at is not None

    async def test_unread_only_filters(self, session):
        origin, dest = await _corridor(session)
        dm = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=origin.state_id,
            district_id=origin.id,
        )
        trip = await _trip(session, origin, dest)
        for key in ("a", "b"):
            await notifications.notify(
                session,
                recipients=[dm],
                kind=NotificationKind.TRIP_DISPATCHED,
                dedupe_key=f"u:{trip.id}:{key}",
                trip_id=trip.id,
            )
        await session.commit()
        rows = await notifications.inbox(session, dm)
        await notifications.mark_read(session, dm, [rows[0].id])
        await session.commit()

        assert len(await notifications.inbox(session, dm, unread_only=True)) == 1
        assert len(await notifications.inbox(session, dm)) == 2


class TestDispatchTellsEachSideItsOwnFact:
    async def test_origin_hears_dispatched_and_destination_hears_incoming(
        self, session
    ):
        origin, dest = await _corridor(session, dest_state="meghalaya")
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
        dest_sm = await factories.make_user(
            session, role=UserRole.STATE_MANAGER, state_id=dest.state_id
        )
        manager = await factories.make_user(session, role=UserRole.MANAGER)
        trip = await _trip(session, origin, dest, status=TripStatus.DRAFT)

        # A route has to be selected before dispatch, so drive the service the
        # way the API does rather than reaching past its gates.
        await factories.make_selected_route(session, trip.id)
        await trip_service.dispatch(session, trip.id, actor=manager)

        assert [n.kind for n in await _inbox(session, dest_dm)] == [
            NotificationKind.INCOMING_TRIP
        ]
        assert [n.kind for n in await _inbox(session, origin_dm)] == [
            NotificationKind.TRIP_DISPATCHED
        ]
        # The crossing reaches the destination state manager too.
        assert [n.kind for n in await _inbox(session, dest_sm)] == [
            NotificationKind.TRIP_DISPATCHED
        ]
        # And it carries what a manager needs to act, not a frozen sentence.
        payload = (await _inbox(session, dest_dm))[0].payload
        assert payload["trip_code"] == trip.trip_code
        assert payload["driver_name"] and payload["destination"]
