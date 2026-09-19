"""A driver's stop request is an SOS the manager's emergency surfaces can see.

WHAT THIS DEFENDS

  * `POST /api/driver/me/trip/stop-request` opens (or escalates) the trip's
    Emergency in SOS_ESCALATED, so the console's SOS badge and Fleet's
    incident banner - both fed by GET /api/emergencies/active - show it.
    Before this, the request only wrote an event and a notification.
  * One open emergency per trip: a retry, or a request while Fleet Sentinel's
    check is already open, never makes a second row.
  * A manager closes it the normal way, and the sweep neither downgrades nor
    duplicates it.
  * A scoped manager sees it only where they see the trip.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
import uuid

import pytest
from geoalchemy2.elements import WKTElement
from sqlalchemy import func, select

from app.db.session import get_sessionmaker
from app.domain.sentinel import (
    DRIVER_RESPONSE_WINDOW_SECONDS,
    DriverCheckResponse,
    EmergencyState,
)
from app.models.emergency import Emergency
from app.models.enums import (
    NotificationKind,
    NotificationSeverity,
    TripEventKind,
    TripStatus,
    UserRole,
)
from app.models.notifications import Notification
from app.models.operations import GpsPoint, TripEvent
from app.services import sentinel
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

REASON = "Brake smell and smoke from the rear axle, pulled over"


async def _running_trip(session):
    origin = await factories.make_district(session, slug="sos-emg-origin")
    dest = await factories.make_district(session, slug="sos-emg-dest")
    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    await factories.make_assignment(session, driver, truck, verified=True)
    shipment = await factories.make_shipment(
        session, origin_district_id=origin.id, destination_district_id=dest.id
    )
    trip = await factories.make_trip(
        session, driver, truck, shipment=shipment, status=TripStatus.ACTIVE
    )
    return trip, driver, origin


async def _stop(api, driver, request_id=None, **extra):
    headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
    r = await api.post(
        "/api/driver/me/trip/stop-request",
        headers=headers,
        json={
            "request_id": str(request_id or uuid.uuid4()),
            "reason": REASON,
            "category": "VEHICLE",
            **extra,
        },
    )
    assert r.status_code == 200, r.text
    return r


async def _active_for(api, user, trip_id):
    headers = await auth_headers(api, user.email, factories.TEST_PASSWORD)
    r = await api.get("/api/emergencies/active", headers=headers)
    assert r.status_code == 200, r.text
    return [e for e in r.json() if e["trip_id"] == str(trip_id)]


async def _rows(session, trip_id):
    return (
        await session.execute(
            select(func.count()).select_from(Emergency).where(Emergency.trip_id == trip_id)
        )
    ).scalar_one()


async def test_stop_request_shows_as_one_sos_on_the_active_list(api, session):
    trip, driver, _ = await _running_trip(session)
    manager = await factories.make_user(session, role=UserRole.MANAGER)

    await _stop(api, driver, lat=26.1801, lon=91.7539)

    [emg] = await _active_for(api, manager, trip.id)
    assert emg["state"] == "SOS_ESCALATED"
    assert emg["escalated_at"] is not None
    brief = emg["briefing_snapshot"]
    assert REASON in brief["escalation_reason"]
    assert brief["driver_request"]["reason"] == REASON
    assert brief["driver_request"]["category"] == "VEHICLE"
    assert brief["driver"]["phone"] == driver.phone
    assert (brief["location"]["lat"], brief["location"]["lon"]) == (26.1801, 91.7539)

    # Still a request: the trip itself has not moved.
    await session.refresh(trip)
    assert trip.status is TripStatus.ACTIVE


async def test_the_briefing_names_places_and_asks_for_a_missing_contact(api, session):
    """The final browser proof read 'Pickup -> Delivery' in the dossier: the stop's
    role, not where it is. The address is what a manager on the phone needs.
    A driver with no emergency contact gets an action, not 'unlisted at unlisted'."""
    from sqlalchemy import select
    from app.models.operations import TripStop

    trip, driver, _ = await _running_trip(session)
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    stops = (await session.execute(
        select(TripStop).where(TripStop.trip_id == trip.id).order_by(TripStop.sequence)
    )).scalars().all()
    assert len(stops) >= 2
    stops[0].address, stops[-1].address = "Guwahati, Assam 781001", "Shillong, Meghalaya 793001"
    await session.commit()

    await _stop(api, driver)

    [emg] = await _active_for(api, manager, trip.id)
    brief = emg["briefing_snapshot"]
    assert (brief["route"]["origin"], brief["route"]["destination"]) == (
        "Guwahati, Assam 781001", "Shillong, Meghalaya 793001")
    assert not any("unlisted) at unlisted" in a for a in brief["suggested_actions"])


async def test_a_retry_with_the_same_id_is_still_one_emergency(api, session):
    trip, driver, _ = await _running_trip(session)
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    rid = uuid.uuid4()

    await _stop(api, driver, rid)
    await _stop(api, driver, rid)

    [emg] = await _active_for(api, manager, trip.id)
    assert emg["state"] == "SOS_ESCALATED"
    assert await _rows(session, trip.id) == 1
    # No phone position and no GPS fix: unknown, not a made-up 0,0.
    assert emg["briefing_snapshot"]["location"]["lat"] is None


def _fix(trip, lat, lon, at):
    return GpsPoint(
        trip_id=trip.id, driver_id=trip.driver_id, truck_id=trip.truck_id,
        device_fix_id=uuid.uuid4(),
        location=WKTElement(f"SRID=4326;POINT({lon} {lat})"),
        recorded_at=at, received_at=at, accuracy_m=Decimal("8.0"),
    )


def _check(trip, t0, state=EmergencyState.DRIVER_CHECK_REQUIRED, **kw):
    """Fleet Sentinel's check, sent at t0 after an hour stopped."""
    return Emergency(
        trip_id=trip.id, state=state, triggered_at=t0,
        stationary_since=t0 - timedelta(minutes=60), check_sent_at=t0,
        response_deadline_at=t0 + timedelta(seconds=DRIVER_RESPONSE_WINDOW_SECONDS),
        **kw,
    )


async def test_without_a_phone_position_the_last_gps_fix_is_used(api, session):
    trip, driver, _ = await _running_trip(session)
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    fix = _fix(trip, 26.4, 91.9, datetime.now(UTC) - timedelta(minutes=2))
    session.add(fix)
    await session.commit()

    await _stop(api, driver)

    [emg] = await _active_for(api, manager, trip.id)
    assert emg["last_gps_point_id"] == fix.id
    assert (emg["briefing_snapshot"]["location"]["lat"],
            emg["briefing_snapshot"]["location"]["lon"]) == (26.4, 91.9)


async def test_an_open_sentinel_check_is_escalated_not_duplicated(api, session):
    trip, driver, _ = await _running_trip(session)
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    t0 = datetime.now(UTC) - timedelta(minutes=5)
    check = Emergency(
        trip_id=trip.id,
        state=EmergencyState.DRIVER_CHECK_REQUIRED,
        triggered_at=t0,
        stationary_since=t0 - timedelta(minutes=60),
        check_sent_at=t0,
        response_deadline_at=t0 + timedelta(seconds=DRIVER_RESPONSE_WINDOW_SECONDS),
    )
    session.add(check)
    await session.commit()

    await _stop(api, driver)

    [emg] = await _active_for(api, manager, trip.id)
    assert emg["id"] == str(check.id)
    assert emg["state"] == "SOS_ESCALATED"
    assert REASON in emg["briefing_snapshot"]["escalation_reason"]
    # Its history is kept: when Sentinel saw the truck stop and asked.
    await session.refresh(check)
    assert check.stationary_since == t0 - timedelta(minutes=60)
    assert check.check_sent_at == t0
    # Sentinel measured this stop, so the briefing states it.
    stopped = emg["briefing_snapshot"]["location"]["stopped_since"]
    assert datetime.fromisoformat(stopped) == t0 - timedelta(minutes=60)
    assert await _rows(session, trip.id) == 1

    # A sweep past the original deadline neither downgrades nor re-escalates.
    await sentinel.run_sentinel_sweep(session, now=t0 + timedelta(hours=2))
    await session.refresh(check)
    await session.refresh(trip)
    assert check.state == EmergencyState.SOS_ESCALATED
    assert trip.status is TripStatus.ACTIVE
    assert await _rows(session, trip.id) == 1


async def test_a_sentinel_insert_racing_the_request_is_escalated(
    api, session, monkeypatch
):
    """The sweep commits its check between our emergency read and trip lock."""
    trip, driver, _ = await _running_trip(session)
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    now = datetime.now(UTC)
    raced = Emergency(
        trip_id=trip.id, state=EmergencyState.DRIVER_CHECK_REQUIRED,
        triggered_at=now, stationary_since=now, check_sent_at=now,
        response_deadline_at=now + timedelta(seconds=DRIVER_RESPONSE_WINDOW_SECONDS),
    )
    session.add(raced)
    await session.commit()

    real = sentinel.get_active_emergency
    calls = []

    async def first_read_misses_it(db, trip_id, **kw):
        calls.append(trip_id)
        return None if len(calls) == 1 else await real(db, trip_id, **kw)

    monkeypatch.setattr(sentinel, "get_active_emergency", first_read_misses_it)

    await _stop(api, driver)

    [emg] = await _active_for(api, manager, trip.id)
    assert emg["id"] == str(raced.id)
    assert emg["state"] == "SOS_ESCALATED"
    assert await _rows(session, trip.id) == 1


async def test_resolve_clears_it_and_a_sweep_does_not_bring_it_back(api, session):
    trip, driver, _ = await _running_trip(session)
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    await _stop(api, driver)
    [emg] = await _active_for(api, manager, trip.id)

    # Open: a sweep leaves it exactly as it is.
    await sentinel.run_sentinel_sweep(session, now=datetime.now(UTC) + timedelta(hours=2))
    [still] = await _active_for(api, manager, trip.id)
    assert (still["id"], still["state"]) == (emg["id"], "SOS_ESCALATED")

    headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)
    r = await api.post(
        f"/api/emergencies/{emg['id']}/resolve",
        headers=headers,
        json={"note": "Called the driver; mechanic on the way.", "is_false_alarm": False},
    )
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "RESOLVED"
    assert await _active_for(api, manager, trip.id) == []

    await sentinel.run_sentinel_sweep(session)
    assert await _active_for(api, manager, trip.id) == []
    assert await _rows(session, trip.id) == 1
    await session.refresh(trip)
    assert trip.status is TripStatus.ACTIVE


async def test_a_scoped_manager_sees_it_only_where_they_see_the_trip(api, session):
    trip, driver, origin = await _running_trip(session)
    elsewhere = await factories.make_district(session, slug="sos-emg-elsewhere")
    mine = await factories.make_user(
        session, role=UserRole.DISTRICT_MANAGER,
        state_id=origin.state_id, district_id=origin.id,
    )
    other = await factories.make_user(
        session, role=UserRole.DISTRICT_MANAGER,
        state_id=elsewhere.state_id, district_id=elsewhere.id,
    )
    await _stop(api, driver)

    assert len(await _active_for(api, mine, trip.id)) == 1
    assert await _active_for(api, other, trip.id) == []


async def test_an_escalated_check_reports_the_latest_fix_not_its_stored_one(api, session):
    """SOS-R1. A DRIVER_RESPONDED check never closes by itself, so the fix it
    stored can be hours old. The phone sends no position, so the briefing must
    point the manager at the trip's newest fix, not that one."""
    trip, driver, _ = await _running_trip(session)
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    now = datetime.now(UTC)
    old = _fix(trip, 26.0, 91.0, now - timedelta(hours=3))
    new = _fix(trip, 26.5, 92.0, now - timedelta(minutes=1))
    session.add_all([old, new])
    await session.commit()
    t0 = now - timedelta(hours=3)
    check = _check(
        trip, t0, EmergencyState.DRIVER_RESPONDED, last_gps_point_id=old.id,
        driver_response=DriverCheckResponse.TRAFFIC, responded_at=t0 + timedelta(minutes=5),
    )
    session.add(check)
    await session.commit()

    await _stop(api, driver)

    [emg] = await _active_for(api, manager, trip.id)
    loc = emg["briefing_snapshot"]["location"]
    assert (loc["lat"], loc["lon"]) == (26.5, 92.0), loc
    assert loc["fix_age_seconds"] < 600
    assert emg["last_gps_point_id"] == new.id
    # Sentinel's history stays.
    await session.refresh(check)
    assert (check.stationary_since, check.check_sent_at) == (t0 - timedelta(minutes=60), t0)
    assert check.driver_response == DriverCheckResponse.TRAFFIC


async def test_a_check_in_holding_the_emergency_lock_does_not_deadlock_a_stop_request(
    api, session, monkeypatch
):
    """SOS-R2. The check-in holds the emergency and pauses before its trip
    lock. The stop request must queue on the emergency WITHOUT holding the
    trip (emergency, then trip), so the check-in finishes, and the request
    then escalates, keeping the driver's answer."""
    trip, driver, _ = await _running_trip(session)
    session.add(_check(trip, datetime.now(UTC)))
    await session.commit()
    headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)

    reached, go = asyncio.Event(), asyncio.Event()
    real_lock = sentinel.load_for_update

    async def paused(db, trip_id, **kw):
        reached.set()
        await go.wait()
        return await real_lock(db, trip_id, **kw)

    monkeypatch.setattr(sentinel, "load_for_update", paused)

    async def check_in():
        async with get_sessionmaker()() as other:
            me = await other.get(type(driver), driver.id)
            return await sentinel.record_driver_check_in(
                other, me, trip.id, DriverCheckResponse.I_AM_SAFE
            )

    answered = asyncio.create_task(check_in())
    await asyncio.wait_for(reached.wait(), 5)
    stop = asyncio.create_task(api.post(
        "/api/driver/me/trip/stop-request", headers=headers,
        json={"request_id": str(uuid.uuid4()), "reason": REASON},
    ))
    await asyncio.sleep(1.5)
    assert not stop.done(), "the stop request should queue on the emergency lock"
    go.set()
    assert (await asyncio.wait_for(answered, 10)).state == EmergencyState.DRIVER_RESPONDED
    r = await asyncio.wait_for(stop, 10)
    assert r.status_code == 200, r.text

    trip_id = trip.id
    session.expire_all()
    [row] = (await session.execute(select(Emergency).where(Emergency.trip_id == trip_id))).scalars()
    assert row.state == EmergencyState.SOS_ESCALATED
    assert row.driver_response == DriverCheckResponse.I_AM_SAFE


async def test_a_second_request_keeps_the_first_escalation_time(api, session):
    """SOS-R2/R4. A second SOS (a new id) on a row already SOS_ESCALATED keeps
    when it was first escalated, and the briefing says the same time."""
    trip, driver, _ = await _running_trip(session)
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    await _stop(api, driver)
    [first] = await _active_for(api, manager, trip.id)

    await _stop(api, driver)

    [again] = await _active_for(api, manager, trip.id)
    assert again["id"] == first["id"]
    assert again["escalated_at"] == first["escalated_at"]
    assert (datetime.fromisoformat(again["briefing_snapshot"]["escalated_at"])
            == datetime.fromisoformat(again["escalated_at"]))


async def test_a_driver_raised_sos_states_no_stop_it_did_not_see(api, session):
    """SOS-R4. Nothing measured a stop: the truck may still be rolling, or
    have stood for an hour. Unknown is null, not "stopped just now, 0 min" -
    also when a second request re-escalates the same row."""
    trip, driver, _ = await _running_trip(session)
    manager = await factories.make_user(session, role=UserRole.MANAGER)

    for _ in range(2):
        await _stop(api, driver, lat=26.1801, lon=91.7539)
        [emg] = await _active_for(api, manager, trip.id)
        loc = emg["briefing_snapshot"]["location"]
        assert loc["stopped_since"] is None, loc
        assert loc["stopped_duration_minutes"] is None, loc


async def test_a_request_after_a_sweep_escalated_is_still_recorded(api, session):
    """SOS-R5. The sweep escalated an unanswered check first, so the trip is
    INCIDENT. The driver's words, the event and the URGENT alert must still be
    written - and the emergency stops saying the driver is uncontactable."""
    trip, driver, origin = await _running_trip(session)
    dm = await factories.make_user(
        session, role=UserRole.DISTRICT_MANAGER,
        state_id=origin.state_id, district_id=origin.id,
    )
    check = _check(trip, datetime.now(UTC) - timedelta(hours=1))
    session.add(check)
    await session.commit()
    await sentinel.run_sentinel_sweep(session)
    await session.refresh(trip)
    await session.refresh(check)
    assert (trip.status, check.state) == (TripStatus.INCIDENT, EmergencyState.SOS_ESCALATED)
    swept_at = check.escalated_at

    rid = uuid.uuid4()
    await _stop(api, driver, rid)

    events = (await session.execute(select(TripEvent).where(
        TripEvent.trip_id == trip.id, TripEvent.kind == TripEventKind.INCIDENT_OPENED,
        TripEvent.payload["request_id"].astext == str(rid),
    ))).scalars().all()
    assert [e.payload["reason"] for e in events] == [REASON]
    [alert] = (await session.execute(select(Notification).where(
        Notification.recipient_user_id == dm.id,
        Notification.kind == NotificationKind.DRIVER_EMERGENCY_STOP,
    ))).scalars().all()
    assert alert.severity is NotificationSeverity.URGENT
    await session.refresh(check)
    assert REASON in check.briefing_snapshot["escalation_reason"]
    assert check.escalated_at == swept_at
    await session.refresh(trip)
    assert trip.status is TripStatus.INCIDENT  # the request still moves nothing


async def test_an_offline_backlog_sos_points_at_the_newest_recorded_fix(api, session):
    """SOS-R1b. A reconnecting phone uploads its queue oldest first in one
    batch, so every row shares one received_at. The SOS must point at the
    newest recorded fix - what the fleet map shows - not whichever row of that
    tie comes first."""
    trip, driver, _ = await _running_trip(session)
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
    now = datetime.now(UTC)
    fixes = [
        (uuid.uuid4(), lat, lon, now - timedelta(minutes=ago))
        # Unsorted on purpose: the newest recorded fix is not the last row
        # inserted, so an id tiebreak alone cannot pass.
        for lat, lon, ago in [(26.2, 91.8, 20), (26.3, 91.9, 1), (26.1, 91.7, 40)]
    ]
    r = await api.post("/api/driver/me/location", headers=headers, json={"fixes": [
        {"device_fix_id": str(fid), "location": {"lat": lat, "lon": lon},
         "recorded_at": at.isoformat(), "accuracy_m": "8"}
        for fid, lat, lon, at in fixes
    ]})
    assert r.status_code == 202, r.text

    await _stop(api, driver)

    [emg] = await _active_for(api, manager, trip.id)
    newest = (await session.execute(
        select(GpsPoint.id).where(GpsPoint.device_fix_id == max(fixes, key=lambda f: f[3])[0])
    )).scalar_one()
    loc = emg["briefing_snapshot"]["location"]
    assert (loc["lat"], loc["lon"]) == (26.3, 91.9), loc
    assert emg["last_gps_point_id"] == newest


async def test_an_answered_check_states_no_stop_sentinel_no_longer_tracks(api, session):
    """SOS-R4b. The driver answered this check 4 h ago and has driven on (a
    fresh fix ~180 km away). Sentinel no longer tracks that stop, so the
    briefing states none: "stopped 300 min" beside a moving truck's position
    would be invented. The row keeps its stationary_since as history."""
    trip, driver, _ = await _running_trip(session)
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    now = datetime.now(UTC)
    t0 = now - timedelta(hours=4)
    old = _fix(trip, 26.0, 91.0, t0)
    session.add_all([old, _fix(trip, 26.8, 92.6, now - timedelta(minutes=1))])
    await session.commit()
    check = _check(
        trip, t0, EmergencyState.DRIVER_RESPONDED, last_gps_point_id=old.id,
        driver_response=DriverCheckResponse.TRAFFIC, responded_at=t0,
    )
    session.add(check)
    await session.commit()

    await _stop(api, driver)

    [emg] = await _active_for(api, manager, trip.id)
    loc = emg["briefing_snapshot"]["location"]
    assert (loc["stopped_since"], loc["stopped_duration_minutes"]) == (None, None), loc
    await session.refresh(check)
    assert check.stationary_since == t0 - timedelta(minutes=60)


async def test_a_phone_position_is_timed_by_the_phone_or_not_at_all(api, session):
    """DRV-SOS-5. A phone position is as old as the phone's fix (`fix_at`).
    Without it that time is unknown (null), not the request time and 0 s; a
    fix time further ahead than telemetry admits is no evidence either."""
    trip, driver, _ = await _running_trip(session)
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    fix_at = datetime.now(UTC) - timedelta(seconds=90)

    async def timed(**extra):
        await _stop(api, driver, lat=26.1801, lon=91.7539, **extra)
        [emg] = await _active_for(api, manager, trip.id)
        loc = emg["briefing_snapshot"]["location"]
        assert (loc["lat"], loc["lon"]) == (26.1801, 91.7539), loc
        return loc["fix_recorded_at"], loc["fix_age_seconds"]

    assert await timed() == (None, None)
    ahead = datetime.now(UTC) + timedelta(hours=1)
    assert await timed(fix_at=ahead.isoformat()) == (None, None)
    at, age = await timed(fix_at=fix_at.isoformat())
    assert datetime.fromisoformat(at) == fix_at
    assert 90 <= age < 150
    # A fix time with no offset is read as UTC, as telemetry reads device time;
    # comparing it naive would raise and lose the stop request.
    at, age = await timed(fix_at=fix_at.replace(tzinfo=None).isoformat())
    assert datetime.fromisoformat(at) == fix_at
    assert 90 <= age < 150


async def _resolve(api, manager, emergency_id, **body):
    headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)
    r = await api.post(
        f"/api/emergencies/{emergency_id}/resolve", headers=headers, json=body
    )
    assert r.status_code == 200, r.text
    return r


async def _audit_rows(session, emergency_id):
    from app.models.audit import AuditLog

    return list(
        (
            await session.execute(
                select(AuditLog).where(
                    AuditLog.entity_type == "emergencies",
                    AuditLog.entity_id == uuid.UUID(str(emergency_id)),
                )
            )
        )
        .scalars()
        .all()
    )


async def test_resolving_a_stop_request_closes_it_on_the_timeline_and_in_audit(
    api, session
):
    """E2E-D2. A stop request leaves the trip ACTIVE, so closing it must not
    depend on the trip having been in INCIDENT: the timeline shows it closing
    and the audit trail says who closed it and why. E2E-D6: the driver is named
    as every other screen names them, from the driver record."""
    trip, driver, _ = await _running_trip(session)
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    await _stop(api, driver)
    [emg] = await _active_for(api, manager, trip.id)
    note = "Called the driver; mechanic on the way."

    await _resolve(api, manager, emg["id"], note=note, is_false_alarm=False)

    headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)
    events = (await api.get(f"/api/trips/{trip.id}/events", headers=headers)).json()
    opened = [e for e in events if e["kind"] == "INCIDENT_OPENED"]
    closed = [e for e in events if e["kind"] == "INCIDENT_RESOLVED"]
    assert len(opened) == 1 and len(closed) == 1
    assert opened[0]["actor_name"] == driver.full_name != "Test Driver"
    assert closed[0]["actor_name"] == manager.display_name
    assert note in closed[0]["description"]

    [event] = (
        await session.execute(
            select(TripEvent).where(
                TripEvent.trip_id == trip.id,
                TripEvent.kind == TripEventKind.INCIDENT_RESOLVED,
            )
        )
    ).scalars().all()
    assert event.actor_user_id == manager.id
    assert event.payload == {
        "emergency_id": emg["id"], "note": note, "is_false_alarm": False,
    }

    [row] = await _audit_rows(session, emg["id"])
    assert row.action.value == "STATUS_CHANGE"
    assert row.actor_user_id == manager.id
    assert row.before["state"] == "SOS_ESCALATED"
    assert row.after["state"] == "RESOLVED"
    assert row.after["resolved_by_user_id"] == str(manager.id)
    assert row.reason == note

    # Resolving it again is refused and writes nothing more.
    headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)
    again = await api.post(
        f"/api/emergencies/{emg['id']}/resolve", headers=headers, json={"note": note}
    )
    assert again.status_code == 409
    assert len(await _audit_rows(session, emg["id"])) == 1


async def test_a_false_alarm_without_a_note_claims_no_all_clear(api, session):
    trip, driver, _ = await _running_trip(session)
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    await _stop(api, driver)
    [emg] = await _active_for(api, manager, trip.id)

    await _resolve(api, manager, emg["id"], is_false_alarm=True)

    [event] = (
        await session.execute(
            select(TripEvent).where(
                TripEvent.trip_id == trip.id,
                TripEvent.kind == TripEventKind.INCIDENT_RESOLVED,
            )
        )
    ).scalars().all()
    assert "false alarm" in event.description
    assert "no note given" in event.description
    assert "all clear" not in event.description
    assert event.payload["is_false_alarm"] is True
    [row] = await _audit_rows(session, emg["id"])
    assert row.after["state"] == "FALSE_ALARM"
