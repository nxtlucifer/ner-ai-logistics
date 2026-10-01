"""Driver breaks (0017): a planned 15/30-minute stop that the managers see.

WHAT THIS DEFENDS

  * Start and resume are real writes: a `trip_breaks` row, timeline events,
    an audit trail and one inbox note per manager - never a UI-only flag.
  * The trip does not move: still ACTIVE, same selected route.
  * Idempotent both ways: a retried start is one break, a second break while
    one is open is refused, a repeated resume changes nothing.
  * Where: the phone's fix, else the trip's newest GPS point.
  * Overdue is visible on read at once, and the sweep alerts exactly once.
  * Fleet shows the break; the history carries the place; scope still holds.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
import uuid

import pytest
from geoalchemy2.elements import WKTElement
from sqlalchemy import func, select, update

from app.models.enums import NotificationKind, NotificationSeverity, TripEventKind, TripStatus, UserRole
from app.models.notifications import Notification
from app.models.operations import GpsPoint, TripBreak, TripEvent
from app.services import breaks
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


async def _running(session, status=TripStatus.ACTIVE):
    origin = await factories.make_district(session, slug=f"brk-o-{uuid.uuid4().hex[:6]}")
    dest = await factories.make_district(session, slug=f"brk-d-{uuid.uuid4().hex[:6]}")
    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    await factories.make_assignment(session, driver, truck, verified=True)
    shipment = await factories.make_shipment(session, origin_district_id=origin.id, destination_district_id=dest.id)
    trip = await factories.make_trip(session, driver, truck, shipment=shipment, status=status)
    await session.commit()
    return trip, driver


async def _driver_headers(api, driver):
    return await auth_headers(api, driver.phone, factories.TEST_PASSWORD)


async def _start(api, headers, *, request_id=None, minutes=15, reason="TEA_REST", expect=200, **extra):
    r = await api.post(
        "/api/driver/me/trip/break",
        headers=headers,
        json={"request_id": str(request_id or uuid.uuid4()), "minutes": minutes, "reason": reason, **extra},
    )
    assert r.status_code == expect, r.text
    return r.json()


async def _count(session, model, *where):
    return (await session.execute(select(func.count()).select_from(model).where(*where))).scalar_one()


async def test_a_15_minute_break_is_saved_shown_and_leaves_the_trip_running(api, session):
    trip, driver = await _running(session)
    regional = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
    h = await _driver_headers(api, driver)
    body = await _start(api, h, minutes=15, reason="TEA_REST", lat=26.13, lon=91.75, fix_at=datetime.now(UTC).isoformat())

    assert body["status"] == "ACTIVE"
    assert body["selected_route_id"] == (str(trip.selected_route_id) if trip.selected_route_id else None)
    b = body["active_break"]
    assert b["status"] == "ACTIVE" and b["planned_minutes"] == 15 and b["reason"] == "TEA_REST"
    assert b["location"] == {"lat": pytest.approx(26.13), "lon": pytest.approx(91.75)}
    assert b["location_source"] == "PHONE"
    assert b["truck_id"] == str(trip.truck_id) and b["driver_id"] == str(driver.id)

    row = (await session.execute(select(TripBreak).where(TripBreak.trip_id == trip.id))).scalar_one()
    assert row.nav_state["trip_status"] == "ACTIVE"
    assert await _count(session, TripEvent, TripEvent.trip_id == trip.id, TripEvent.kind == TripEventKind.BREAK_STARTED) == 1

    note = (
        await session.execute(
            select(Notification).where(
                Notification.recipient_user_id == regional.id, Notification.kind == NotificationKind.DRIVER_BREAK_STARTED
            )
        )
    ).scalar_one()
    assert note.trip_id == trip.id
    assert note.payload["reason"] == "Tea / rest" and note.payload["planned_minutes"] == 15
    assert note.payload["lat"] == pytest.approx(26.13) and "expected_end_at" in note.payload


async def test_a_30_minute_break_without_a_phone_fix_uses_the_last_gps_point(api, session):
    trip, driver = await _running(session)
    at = datetime.now(UTC) - timedelta(seconds=40)
    session.add(GpsPoint(
        trip_id=trip.id, driver_id=trip.driver_id, truck_id=trip.truck_id, device_fix_id=uuid.uuid4(),
        location=WKTElement("SRID=4326;POINT(91.8 26.1)"), recorded_at=at, received_at=at, accuracy_m=Decimal("8"),
    ))
    await session.commit()
    b = (await _start(api, await _driver_headers(api, driver), minutes=30, reason="FOOD"))["active_break"]
    assert b["planned_minutes"] == 30 and b["location_source"] == "LAST_FIX"
    assert b["location"]["lat"] == pytest.approx(26.1)


async def test_a_retried_start_is_one_break_and_a_second_break_is_refused(api, session):
    trip, driver = await _running(session)
    regional = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
    h = await _driver_headers(api, driver)
    rid = uuid.uuid4()
    first = await _start(api, h, request_id=rid)
    again = await _start(api, h, request_id=rid)
    assert first["active_break"]["id"] == again["active_break"]["id"]
    assert await _count(session, TripBreak, TripBreak.trip_id == trip.id) == 1
    assert await _count(session, TripEvent, TripEvent.trip_id == trip.id, TripEvent.kind == TripEventKind.BREAK_STARTED) == 1
    assert await _count(session, Notification, Notification.recipient_user_id == regional.id, Notification.trip_id == trip.id) == 1
    r = await api.post("/api/driver/me/trip/break", headers=h, json={"request_id": str(uuid.uuid4()), "minutes": 30, "reason": "FUEL"})
    assert r.status_code == 409 and "BREAK_ALREADY_ACTIVE" in r.text


async def test_resume_ends_it_once_and_tells_the_managers(api, session):
    trip, driver = await _running(session)
    regional = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
    h = await _driver_headers(api, driver)
    bid = (await _start(api, h))["active_break"]["id"]
    for _ in range(2):  # a double tap or a retry after a lost response
        r = await api.post("/api/driver/me/trip/break/resume", headers=h, json={"break_id": bid})
        assert r.status_code == 200, r.text
        assert r.json()["active_break"] is None and r.json()["status"] == "ACTIVE"
    row = await session.get(TripBreak, uuid.UUID(bid))
    await session.refresh(row)
    assert row.ended_at is not None and row.ended_at >= row.started_at
    assert await _count(session, TripEvent, TripEvent.trip_id == trip.id, TripEvent.kind == TripEventKind.BREAK_ENDED) == 1
    ended = (
        await session.execute(
            select(Notification).where(Notification.recipient_user_id == regional.id, Notification.kind == NotificationKind.DRIVER_BREAK_ENDED)
        )
    ).scalar_one()
    assert ended.payload["overdue"] is False and ended.payload["actual_seconds"] >= 0
    # Another break may start after the first ended.
    await _start(api, h, minutes=30, reason="WASHROOM")


async def test_resume_of_a_break_not_on_this_trip_is_404(api, session):
    _, driver = await _running(session)
    r = await api.post("/api/driver/me/trip/break/resume", headers=await _driver_headers(api, driver), json={"break_id": str(uuid.uuid4())})
    assert r.status_code == 404


async def test_a_break_needs_a_running_trip_and_a_valid_length_and_reason(api, session):
    _, driver = await _running(session, status=TripStatus.ASSIGNED)
    h = await _driver_headers(api, driver)
    r = await api.post("/api/driver/me/trip/break", headers=h, json={"request_id": str(uuid.uuid4()), "minutes": 15, "reason": "FOOD"})
    assert r.status_code == 409 and "TRIP_NOT_IN_PROGRESS" in r.text
    for bad in ({"minutes": 20, "reason": "FOOD"}, {"minutes": 15, "reason": "NAP"}):
        r = await api.post("/api/driver/me/trip/break", headers=h, json={"request_id": str(uuid.uuid4()), **bad})
        assert r.status_code == 422


async def test_overdue_shows_at_once_and_the_sweep_alerts_exactly_once(api, session):
    trip, driver = await _running(session)
    regional = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
    h = await _driver_headers(api, driver)
    bid = (await _start(api, h, minutes=30, reason="OTHER"))["active_break"]["id"]
    await session.execute(
        update(TripBreak).where(TripBreak.id == uuid.UUID(bid)).values(started_at=datetime.now(UTC) - timedelta(minutes=41))
    )
    await session.commit()

    me = (await api.get("/api/driver/me/trip", headers=h)).json()
    assert me["active_break"]["status"] == "OVERDUE" and me["active_break"]["overdue"] is True

    assert await breaks.flag_overdue(session) >= 1
    assert await breaks.flag_overdue(session) == 0
    assert await _count(session, TripEvent, TripEvent.trip_id == trip.id, TripEvent.kind == TripEventKind.BREAK_OVERDUE) == 1
    alert = (
        await session.execute(
            select(Notification).where(Notification.recipient_user_id == regional.id, Notification.kind == NotificationKind.DRIVER_BREAK_OVERDUE)
        )
    ).scalar_one()
    assert alert.severity == NotificationSeverity.WARNING
    # Resuming late keeps the fact in the history.
    r = await api.post("/api/driver/me/trip/break/resume", headers=h, json={"break_id": bid})
    assert r.status_code == 200
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    mh = await auth_headers(api, manager.email, factories.TEST_PASSWORD)
    [hist] = (await api.get(f"/api/trips/{trip.id}/breaks", headers=mh)).json()
    assert hist["status"] == "ENDED" and hist["overdue"] is True and hist["actual_seconds"] >= 41 * 60


async def test_fleet_history_and_timeline_show_the_break_and_scope_holds(api, session):
    trip, driver = await _running(session)
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    mh = await auth_headers(api, manager.email, factories.TEST_PASSWORD)
    await _start(api, await _driver_headers(api, driver), minutes=15, reason="FUEL", lat=26.2, lon=91.7)

    fleet = (await api.get("/api/fleet/active", headers=mh)).json()["trips"]
    [row] = [t for t in fleet if t["trip_id"] == str(trip.id)]
    assert row["on_break"]["reason"] == "FUEL" and row["on_break"]["status"] == "ACTIVE"
    assert row["trip_status"] == "ACTIVE"  # stopped on purpose, not a new state

    [hist] = (await api.get(f"/api/trips/{trip.id}/breaks", headers=mh)).json()
    assert hist["location"]["lon"] == pytest.approx(91.7) and hist["planned_minutes"] == 15

    kinds = [e["kind"] for e in (await api.get(f"/api/trips/{trip.id}/events", headers=mh)).json()]
    assert "BREAK_STARTED" in kinds

    other = await factories.make_district(session, slug=f"brk-x-{uuid.uuid4().hex[:6]}")
    outsider = await factories.make_user(session, role=UserRole.DISTRICT_MANAGER, state_id=other.state_id, district_id=other.id)
    oh = await auth_headers(api, outsider.email, factories.TEST_PASSWORD)
    assert (await api.get(f"/api/trips/{trip.id}/breaks", headers=oh)).status_code == 404
