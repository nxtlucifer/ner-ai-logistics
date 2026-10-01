"""A driver on a hill road asks to stop, and a human answers.

WHAT THIS DEFENDS

  * A driver cannot end a loaded job alone. The request records a reason and
    alerts a person; it does not cancel anything.
  * A reason is mandatory and must say something. A manager acts on it
    before they get the driver on the phone.
  * A retry after a lost response does not raise the emergency twice.
  * The manager's inbox carries the number to call, so the first action does
    not need a second request.
"""

import uuid

import pytest
from sqlalchemy import select

from app.models.enums import (
    NotificationKind,
    NotificationSeverity,
    TripEventKind,
    TripStatus,
    UserRole,
)
from app.models.notifications import Notification
from app.models.operations import TripEvent
from app.services import driver_trips
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

REASON = "Rock fall across the road just past the bridge, cannot pass"


async def _running_trip(session, *, with_districts=True):
    origin = dest = None
    if with_districts:
        origin = await factories.make_district(session, slug="sos-origin")
        dest = await factories.make_district(session, slug="sos-dest")
    driver, user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    await factories.make_assignment(session, driver, truck, verified=True)
    shipment = await factories.make_shipment(
        session,
        origin_district_id=origin.id if origin else None,
        destination_district_id=dest.id if dest else None,
    )
    trip = await factories.make_trip(
        session, driver, truck, shipment=shipment, status=TripStatus.ACTIVE
    )
    return trip, driver, user, origin, dest


async def _events(session, trip_id):
    return list(
        (
            await session.execute(
                select(TripEvent).where(
                    TripEvent.trip_id == trip_id,
                    TripEvent.kind == TripEventKind.INCIDENT_OPENED,
                )
            )
        )
        .scalars()
        .all()
    )


class TestTheRequest:
    async def test_records_the_reason_and_leaves_the_trip_running(
        self, api, session
    ):
        trip, driver, user, origin, _ = await _running_trip(session)
        headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)

        r = await api.post(
            "/api/driver/me/trip/stop-request",
            headers=headers,
            json={
                "request_id": str(uuid.uuid4()),
                "reason": REASON,
                "category": "ROAD_BLOCKED",
            },
        )
        assert r.status_code == 200, r.text

        events = await _events(session, trip.id)
        assert len(events) == 1
        payload = events[0].payload
        assert payload["kind"] == "DRIVER_STOP_REQUEST"
        assert payload["reason"] == REASON
        assert payload["category"] == "ROAD_BLOCKED"

        # The truck has not moved and nothing has been decided: the trip is
        # exactly as it was, waiting for a human.
        await session.refresh(trip)
        assert trip.status is TripStatus.ACTIVE

    async def test_a_reason_that_says_nothing_is_refused(self, api, session):
        trip, driver, *_ = await _running_trip(session)
        headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
        r = await api.post(
            "/api/driver/me/trip/stop-request",
            headers=headers,
            json={"request_id": str(uuid.uuid4()), "reason": "help"},
        )
        assert r.status_code == 422
        assert await _events(session, trip.id) == []

    async def test_a_retry_with_the_same_id_does_not_raise_it_twice(
        self, api, session
    ):
        """A lost response on a hill road is the normal case, not the odd one."""
        trip, driver, *_ = await _running_trip(session)
        headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
        body = {"request_id": str(uuid.uuid4()), "reason": REASON}

        first = await api.post(
            "/api/driver/me/trip/stop-request", headers=headers, json=body
        )
        second = await api.post(
            "/api/driver/me/trip/stop-request", headers=headers, json=body
        )
        assert first.status_code == second.status_code == 200
        assert len(await _events(session, trip.id)) == 1

    async def test_a_second_genuine_emergency_is_a_second_record(
        self, api, session
    ):
        trip, driver, *_ = await _running_trip(session)
        headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
        for reason in (REASON, "Engine temperature warning, pulling over now"):
            r = await api.post(
                "/api/driver/me/trip/stop-request",
                headers=headers,
                json={"request_id": str(uuid.uuid4()), "reason": reason},
            )
            assert r.status_code == 200
        assert len(await _events(session, trip.id)) == 2

    async def test_a_trip_that_is_not_under_way_cannot_be_stopped(
        self, api, session
    ):
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        await factories.make_assignment(session, driver, truck, verified=True)
        await factories.make_trip(
            session, driver, truck, status=TripStatus.ASSIGNED
        )
        headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
        r = await api.post(
            "/api/driver/me/trip/stop-request",
            headers=headers,
            json={"request_id": str(uuid.uuid4()), "reason": REASON},
        )
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "TRIP_NOT_IN_PROGRESS"


class TestTheManagerSide:
    async def test_the_alert_is_urgent_and_carries_the_number_to_call(
        self, api, session
    ):
        trip, driver, user, origin, dest = await _running_trip(session)
        dm = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=origin.state_id,
            district_id=origin.id,
        )
        headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
        await api.post(
            "/api/driver/me/trip/stop-request",
            headers=headers,
            json={
                "request_id": str(uuid.uuid4()),
                "reason": REASON,
                "category": "ROAD_BLOCKED",
            },
        )

        rows = (
            (
                await session.execute(
                    select(Notification).where(
                        Notification.recipient_user_id == dm.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        alert = rows[0]
        assert alert.kind is NotificationKind.DRIVER_EMERGENCY_STOP
        assert alert.severity is NotificationSeverity.URGENT
        assert alert.payload["reason"] == REASON
        # The first thing a manager does is call. The number is already here,
        # so the inbox does not have to fetch the driver to offer the button.
        assert alert.payload["driver_phone"] == driver.phone
        assert alert.payload["driver_name"] == driver.full_name

    async def test_the_manager_reads_it_through_their_own_inbox(
        self, api, session
    ):
        trip, driver, user, origin, dest = await _running_trip(session)
        dm = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=dest.state_id,
            district_id=dest.id,
        )
        dheaders = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
        await api.post(
            "/api/driver/me/trip/stop-request",
            headers=dheaders,
            json={"request_id": str(uuid.uuid4()), "reason": REASON},
        )

        mheaders = await auth_headers(api, dm.email, factories.TEST_PASSWORD)
        r = await api.get("/api/notifications?unread_only=true", headers=mheaders)
        assert r.status_code == 200
        body = r.json()
        assert [n["kind"] for n in body] == ["DRIVER_EMERGENCY_STOP"]
        assert body[0]["severity"] == "URGENT"

        marked = await api.post(
            "/api/notifications/read", headers=mheaders, json={"ids": [body[0]["id"]]}
        )
        assert marked.status_code == 200 and marked.json()["marked"] == 1
        assert (
            await api.get("/api/notifications?unread_only=true", headers=mheaders)
        ).json() == []

    async def test_resolution_uses_the_existing_journey_governance(
        self, api, session
    ):
        """No parallel cancellation path was built, and that is the point.

        The manager answers with the controls that already exist - hold,
        return to depot, change destination, cancel with a disposition - so
        the cargo rules cannot be bypassed by going through the emergency.
        """
        from app.services import trips as trip_service

        assert "HOLD_FOR_INSTRUCTION" in trip_service.DISPOSITIONS
        assert "RETURN_TO_DEPOT" in trip_service.DISPOSITIONS
        assert not hasattr(driver_trips, "cancel_trip")
        assert not hasattr(driver_trips, "cancel")


class TestNobodyIsLeftOut:
    """A trip whose geography is unknown has no scoped manager. An emergency
    must still reach someone, and the driver must not be told it did when it
    did not."""

    async def test_an_unplaced_trip_still_reaches_the_regional_manager(self, api, session):
        trip, driver, user, _, _ = await _running_trip(session, with_districts=False)
        regional = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
        r = await api.post(
            "/api/driver/me/trip/stop-request",
            headers=headers,
            json={"request_id": str(uuid.uuid4()), "reason": REASON, "category": "ROAD_BLOCKED"},
        )
        assert r.status_code == 200, r.text
        rows = (
            await session.execute(select(Notification).where(Notification.recipient_user_id == regional.id))
        ).scalars().all()
        assert [n.kind for n in rows] == [NotificationKind.DRIVER_EMERGENCY_STOP]

    async def test_the_driver_is_not_told_a_manager_was_alerted_when_none_was(
        self, api, session, monkeypatch
    ):
        from app.services import notifications

        async def nobody(db):
            return []

        monkeypatch.setattr(notifications, "regional_managers", nobody)
        trip, driver, user, _, _ = await _running_trip(session, with_districts=False)
        headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
        await api.post(
            "/api/driver/me/trip/stop-request",
            headers=headers,
            json={"request_id": str(uuid.uuid4()), "reason": REASON, "category": "ROAD_BLOCKED"},
        )
        from app.models.operations import DriverNotification

        acks = (
            await session.execute(select(DriverNotification).where(DriverNotification.driver_id == driver.id))
        ).scalars().all()
        assert acks, "the driver is still told the request was recorded"
        assert all("has been alerted" not in (a.body or "") for a in acks)
