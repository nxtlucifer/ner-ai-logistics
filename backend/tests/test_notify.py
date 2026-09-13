"""Driver push: token registration, dedupe by fingerprint, honest delivery rows,
and the dispatch hook. The Expo relay is never called from tests."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import TripStatus, UserRole
from app.models.operations import DriverNotification
from app.services import notify, trips
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


@pytest.fixture
def relay(monkeypatch):
    sent: list[tuple[str, str]] = []

    async def fake(token, title, body, data):
        sent.append((token, title))
        return "SENT"

    monkeypatch.setattr(notify, "_deliver", fake)
    return sent


async def test_token_registration_dedupe_and_no_token_rows(api: AsyncClient, session: AsyncSession, relay):
    driver, user = await factories.make_driver(session)
    headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)

    assert (await api.post("/api/driver/me/push-token", json={"token": "abc"}, headers=headers)).status_code == 422
    ok = await api.post("/api/driver/me/push-token", json={"token": "ExponentPushToken[xyz]"}, headers=headers)
    assert ok.status_code == 200 and ok.json() == {"registered": True}

    first = await notify.send(session, driver_id=driver.id, event="ROUTE_DANGER_AHEAD", title="High historical landslide exposure ahead", body="b", fingerprint="fp:trip:seg7")
    again = await notify.send(session, driver_id=driver.id, event="ROUTE_DANGER_AHEAD", title="High historical landslide exposure ahead", body="b", fingerprint="fp:trip:seg7")
    await session.commit()
    assert first.delivery == "SENT"
    assert again.delivery == "SKIPPED_COOLDOWN"
    assert relay == [("ExponentPushToken[xyz]", "High historical landslide exposure ahead")]

    gone = await api.post("/api/driver/me/push-token", json={"token": None}, headers=headers)
    assert gone.json() == {"registered": False}
    no_token = await notify.send(session, driver_id=driver.id, event="OFFICIAL_WARNING_NEW", title="t", body="b", fingerprint="fp:other")
    await session.commit()
    assert no_token.delivery == "NO_TOKEN"
    assert len(relay) == 1


async def test_dispatch_pushes_trip_assigned_once(session: AsyncSession, relay, monkeypatch):
    monkeypatch.setenv("PUSH_ENABLED", "true")
    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck)
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    driver.push_token = "ExponentPushToken[phone]"
    trip = await factories.make_trip(session, driver, truck, assignment=assignment, status=TripStatus.DRAFT)
    await session.commit()

    await trips.dispatch(session, trip.id, actor=manager)

    rows = (await session.execute(select(DriverNotification).where(DriverNotification.trip_id == trip.id))).scalars().all()
    assert [r.event for r in rows] == ["TRIP_ASSIGNED"]
    assert rows[0].delivery == "SENT" and relay[0][0] == "ExponentPushToken[phone]"
