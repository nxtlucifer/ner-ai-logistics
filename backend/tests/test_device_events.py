"""Replay of what the phone saw while it had no network.

The acceptance matrix this file pins is the mission's own: internet disappears,
events are stored locally, the connection returns, the backlog syncs, duplicate
requests do not create duplicate domain records, one poison event does not
block the queue, and a device clock that is wrong cannot corrupt the order or
the deadlines of a safety timeline.

The test that carries the most weight is the duplicate SOS. A driver in trouble
presses once; a flaky connection sends the batch twice. Two emergencies would
mean two dossiers, two escalations and a dispatcher who cannot tell whether
something happened once or twice.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain import telemetry_policy as policy
from app.models.emergency import Emergency
from app.models.enums import EmergencyState, TripStatus, UserRole
from app.models.operations import TripEvent
from app.services import device_events
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

GUWAHATI = {"lat": 26.1445, "lon": 91.7362}
ENDPOINT = "/api/driver/me/trip/events"


def event(**overrides) -> dict:
    payload = {
        "device_event_id": str(uuid.uuid4()),
        "kind": "ROUTE_DEVIATION",
        "recorded_at": datetime.now(UTC).isoformat(),
        "location": dict(GUWAHATI),
        "accuracy_m": "12.0",
        "payload": {"off_route_m": 412.0},
    }
    payload.update(overrides)
    return payload


async def _driving(session: AsyncSession, api: AsyncClient):
    """A driver on an ACTIVE trip, ready to report events."""
    driver, user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck)
    trip = await factories.make_trip(session, driver, truck, assignment=assignment)
    headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
    started = await api.post("/api/driver/me/trip/start", headers=headers, json={})
    assert started.status_code == 200, started.text
    return driver, user, trip, headers


async def _events_of(session: AsyncSession, trip_id, kind: str | None = None):
    stmt = select(TripEvent).where(TripEvent.trip_id == trip_id)
    if kind is not None:
        stmt = stmt.where(TripEvent.kind == kind)
    return list((await session.execute(stmt.order_by(TripEvent.id))).scalars().all())


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


class TestAuthorization:
    async def test_anonymous_replay_is_401(self, api: AsyncClient) -> None:
        r = await api.post(ENDPOINT, json={"events": [event()]})
        assert r.status_code == 401

    async def test_manager_cannot_report_as_a_driver(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        r = await api.post(ENDPOINT, headers=manager_headers, json={"events": [event()]})
        assert r.status_code == 403

    async def test_driver_without_a_trip_has_nowhere_to_report(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _driver, user = await factories.make_driver(session)
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        r = await api.post(ENDPOINT, headers=headers, json={"events": [event()]})
        assert r.status_code == 404

    async def test_another_trips_id_cannot_redirect_the_batch(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The id in the body may only NARROW, exactly as on a GPS batch."""
        _driver, _user, _trip, headers = await _driving(session, api)
        r = await api.post(
            ENDPOINT,
            headers=headers,
            json={"trip_id": str(uuid.uuid4()), "events": [event()]},
        )
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "TRIP_SUPERSEDED"

    async def test_a_trip_not_in_progress_refuses_events(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await factories.make_assignment(session, driver, truck)
        await factories.make_trip(session, driver, truck, assignment=assignment)
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        r = await api.post(ENDPOINT, headers=headers, json={"events": [event()]})
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "TRIP_NOT_IN_PROGRESS"

    async def test_a_device_may_not_write_an_office_fact(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """DISPATCHED, DELIVERED and CLOSED are things the SERVER did."""
        _driver, _user, _trip, headers = await _driving(session, api)
        r = await api.post(
            ENDPOINT, headers=headers, json={"events": [event(kind="DELIVERED")]}
        )
        assert r.status_code == 422
        assert "not a kind a device may report" in r.text


class TestReplay:
    async def test_a_backlog_lands_on_the_timeline(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _driver, _user, trip, headers = await _driving(session, api)
        now = datetime.now(UTC)
        batch = [
            event(
                kind="COMMS_LOST",
                recorded_at=(now - timedelta(minutes=9)).isoformat(),
                payload=None,
                location=None,
            ),
            event(
                kind="ROUTE_DEVIATION",
                recorded_at=(now - timedelta(minutes=7)).isoformat(),
                payload={"off_route_m": 412.0},
            ),
            event(
                kind="ALERT_ACKNOWLEDGED",
                recorded_at=(now - timedelta(minutes=5)).isoformat(),
                payload={"level": "CRITICAL", "alert_key": "route:steep:9100"},
            ),
            event(
                kind="COMMS_RESTORED",
                recorded_at=(now - timedelta(seconds=10)).isoformat(),
                payload={"queued_events": 3},
                location=None,
            ),
        ]
        r = await api.post(ENDPOINT, headers=headers, json={"events": batch})
        assert r.status_code == 202, r.text
        body = r.json()
        assert body["accepted"] == 4
        assert body["duplicates_ignored"] == 0
        assert body["rejected"] == 0
        assert len(body["settled_event_ids"]) == 4

        rows = await _events_of(session, trip.id)
        kinds = [row.kind.value for row in rows]
        for expected in (
            "COMMS_LOST",
            "ROUTE_DEVIATION",
            "ALERT_ACKNOWLEDGED",
            "COMMS_RESTORED",
        ):
            assert expected in kinds

        deviation = next(r for r in rows if r.kind.value == "ROUTE_DEVIATION")
        assert deviation.device_event_id is not None
        assert deviation.device_reported_at is not None
        assert "412 m" in (deviation.description or "")
        assert deviation.payload["off_route_m"] == 412.0
        # The driver is the actor: a person on the road did this.
        assert deviation.actor_user_id is not None

    async def test_the_server_clock_owns_the_timeline_position(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A device clock that is behind must not backdate the timeline.

        `device_reported_at` records what the phone said. `occurred_at` is when
        the server heard it, and the gap between them is how long the event sat
        in the offline queue - the measurement the connectivity layer reads.
        """
        _driver, _user, trip, headers = await _driving(session, api)
        reported = datetime.now(UTC) - timedelta(hours=3)
        r = await api.post(
            ENDPOINT,
            headers=headers,
            json={"events": [event(recorded_at=reported.isoformat())]},
        )
        assert r.status_code == 202, r.text

        row = (await _events_of(session, trip.id, "ROUTE_DEVIATION"))[0]
        assert abs((row.device_reported_at - reported).total_seconds()) < 2
        # Hours newer than the device's own stamp.
        assert (row.occurred_at - row.device_reported_at).total_seconds() > 3600

    async def test_events_apply_in_device_order_not_array_order(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _driver, _user, trip, headers = await _driving(session, api)
        now = datetime.now(UTC)
        late = event(
            kind="COMMS_RESTORED",
            recorded_at=now.isoformat(),
            payload=None,
            location=None,
        )
        early = event(
            kind="COMMS_LOST",
            recorded_at=(now - timedelta(minutes=20)).isoformat(),
            payload=None,
            location=None,
        )
        # Deliberately out of order in the request.
        r = await api.post(ENDPOINT, headers=headers, json={"events": [late, early]})
        assert r.status_code == 202, r.text

        rows = await _events_of(session, trip.id)
        ordered = [row.kind.value for row in rows if row.kind.value.startswith("COMMS")]
        assert ordered == ["COMMS_LOST", "COMMS_RESTORED"]


class TestIdempotence:
    async def test_resending_a_batch_duplicates_nothing(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _driver, _user, trip, headers = await _driving(session, api)
        batch = [event(), event(kind="COMMS_LOST", payload=None, location=None)]

        first = await api.post(ENDPOINT, headers=headers, json={"events": batch})
        assert first.status_code == 202, first.text
        assert first.json()["accepted"] == 2

        # The acknowledgement was lost; the device sends exactly the same batch.
        second = await api.post(ENDPOINT, headers=headers, json={"events": batch})
        assert second.status_code == 202, second.text
        body = second.json()
        assert body["accepted"] == 0
        assert body["duplicates_ignored"] == 2
        # Still settled: the device may delete them.
        assert len(body["settled_event_ids"]) == 2

        count = await session.scalar(
            select(func.count())
            .select_from(TripEvent)
            .where(TripEvent.trip_id == trip.id, TripEvent.device_event_id.is_not(None))
        )
        assert count == 2

    async def test_a_duplicate_sos_does_not_open_a_second_emergency(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The failure this whole replay path is built to prevent."""
        _driver, _user, trip, headers = await _driving(session, api)
        sos = event(kind="SOS_TRIGGERED", payload={"reason": "BREAKDOWN"})

        for _ in range(3):
            r = await api.post(ENDPOINT, headers=headers, json={"events": [sos]})
            assert r.status_code == 202, r.text

        emergencies = list(
            (
                await session.execute(
                    select(Emergency).where(Emergency.trip_id == trip.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(emergencies) == 1
        assert emergencies[0].state is EmergencyState.SOS_ESCALATED

        sos_rows = await _events_of(session, trip.id, "SOS_TRIGGERED")
        assert len(sos_rows) == 1

    async def test_two_distinct_presses_are_two_events_and_one_emergency(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A driver who presses twice is recorded twice and escalated once."""
        _driver, _user, trip, headers = await _driving(session, api)
        r = await api.post(
            ENDPOINT,
            headers=headers,
            json={
                "events": [
                    event(kind="SOS_TRIGGERED", payload=None),
                    event(
                        kind="SOS_TRIGGERED",
                        recorded_at=(datetime.now(UTC) + timedelta(seconds=1)).isoformat(),
                        payload=None,
                    ),
                ]
            },
        )
        assert r.status_code == 202, r.text
        assert r.json()["accepted"] == 2

        assert len(await _events_of(session, trip.id, "SOS_TRIGGERED")) == 2
        emergencies = list(
            (
                await session.execute(
                    select(Emergency).where(Emergency.trip_id == trip.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(emergencies) == 1


class TestSos:
    async def test_sos_opens_an_incident_with_the_device_position(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _driver, _user, trip, headers = await _driving(session, api)
        r = await api.post(
            ENDPOINT,
            headers=headers,
            json={"events": [event(kind="SOS_TRIGGERED", payload=None)]},
        )
        assert r.status_code == 202, r.text

        emergency = (
            await session.execute(select(Emergency).where(Emergency.trip_id == trip.id))
        ).scalar_one()
        assert emergency.state is EmergencyState.SOS_ESCALATED
        assert emergency.escalated_at is not None

        # No Sentinel measurement is invented for a driver-pressed SOS.
        assert emergency.stationary_since is None
        assert emergency.check_sent_at is None
        assert emergency.response_deadline_at is None

        location = emergency.briefing_snapshot["location"]
        assert location["source"] == "DEVICE_AT_SOS"
        assert location["lat"] == pytest.approx(GUWAHATI["lat"])
        assert location["lon"] == pytest.approx(GUWAHATI["lon"])
        assert location["stopped_since"] is None
        assert location["stopped_duration_minutes"] is None

        await session.refresh(trip)
        assert trip.status is TripStatus.INCIDENT
        assert await _events_of(session, trip.id, "INCIDENT_OPENED")

    async def test_sos_without_a_position_never_invents_one(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A phone with no fix must not put the truck at 0,0.

        Null Island is a plausible-looking coordinate in a dossier, and a
        rescue coordinated from one is worse than a rescue that starts by
        admitting the position is unknown.
        """
        _driver, _user, trip, headers = await _driving(session, api)
        r = await api.post(
            ENDPOINT,
            headers=headers,
            json={"events": [event(kind="SOS_TRIGGERED", location=None, payload=None)]},
        )
        assert r.status_code == 202, r.text

        emergency = (
            await session.execute(select(Emergency).where(Emergency.trip_id == trip.id))
        ).scalar_one()
        location = emergency.briefing_snapshot["location"]
        assert location["lat"] is None
        assert location["lon"] is None
        assert location["source"] == "UNKNOWN"
        assert location["fix_recorded_at"] is None
        assert location["fix_age_seconds"] is None

    async def test_sos_escalates_an_open_check_in_rather_than_stacking(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _driver, _user, trip, headers = await _driving(session, api)
        now = datetime.now(UTC)
        open_check = Emergency(
            trip_id=trip.id,
            state=EmergencyState.DRIVER_CHECK_REQUIRED,
            triggered_at=now - timedelta(minutes=5),
            stationary_since=now - timedelta(minutes=70),
            check_sent_at=now - timedelta(minutes=5),
            response_deadline_at=now + timedelta(minutes=25),
        )
        session.add(open_check)
        await session.commit()

        r = await api.post(
            ENDPOINT,
            headers=headers,
            json={"events": [event(kind="SOS_TRIGGERED", payload=None)]},
        )
        assert r.status_code == 202, r.text

        # This session added the emergency, so it holds the pre-API copy in its
        # identity map and a plain select would hand that back rather than what
        # the endpoint wrote. `populate_existing` overwrites it from the row.
        emergencies = list(
            (
                await session.execute(
                    select(Emergency)
                    .where(Emergency.trip_id == trip.id)
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )
        assert len(emergencies) == 1
        assert emergencies[0].state is EmergencyState.SOS_ESCALATED
        assert emergencies[0].driver_response.value == "NEED_HELP"
        # The Sentinel measurements it DID have are untouched.
        assert emergencies[0].stationary_since is not None


class TestClockAndPoison:
    async def test_a_future_timestamp_is_refused_without_losing_the_batch(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _driver, _user, trip, headers = await _driving(session, api)
        ahead = datetime.now(UTC) + policy.MAX_CLOCK_SKEW + timedelta(minutes=10)
        good = event(kind="SOS_TRIGGERED", payload=None)
        r = await api.post(
            ENDPOINT,
            headers=headers,
            json={"events": [event(recorded_at=ahead.isoformat()), good]},
        )
        assert r.status_code == 202, r.text
        body = r.json()
        assert body["accepted"] == 1
        assert body["rejected"] == 1
        assert body["rejected_reasons"] == {"FUTURE_TIMESTAMP": 1}
        # Both settled: a refused event is refused for good and must not be
        # retried in front of everything behind it.
        assert len(body["settled_event_ids"]) == 2
        assert await _events_of(session, trip.id, "SOS_TRIGGERED")

    async def test_an_ancient_timestamp_is_refused(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _driver, _user, _trip, headers = await _driving(session, api)
        old = datetime.now(UTC) - policy.MAX_BACKDATE - timedelta(hours=1)
        r = await api.post(
            ENDPOINT, headers=headers, json={"events": [event(recorded_at=old.isoformat())]}
        )
        assert r.status_code == 202, r.text
        assert r.json()["rejected_reasons"] == {"STALE": 1}

    async def test_a_day_old_event_still_lands(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A truck out of coverage for a shift must be able to flush."""
        _driver, _user, trip, headers = await _driving(session, api)
        yesterday = datetime.now(UTC) - timedelta(hours=23)
        r = await api.post(
            ENDPOINT,
            headers=headers,
            json={"events": [event(recorded_at=yesterday.isoformat())]},
        )
        assert r.status_code == 202, r.text
        assert r.json()["accepted"] == 1

    async def test_one_poison_event_does_not_block_the_sos_behind_it(
        self, api: AsyncClient, session: AsyncSession, monkeypatch
    ) -> None:
        """The queue-head failure mode, forced.

        A deviation whose side effect explodes must not stop the SOS that was
        queued after it - which is exactly what a batch-wide transaction would
        have done.
        """
        _driver, _user, trip, headers = await _driving(session, api)
        real = device_events._side_effects

        async def explode(db, *, trip, driver, event, now):  # noqa: ANN001
            if event.kind.value == "ROUTE_DEVIATION":
                raise RuntimeError("synthetic failure inside the side effect")
            return await real(db, trip=trip, driver=driver, event=event, now=now)

        monkeypatch.setattr(device_events, "_side_effects", explode)

        now = datetime.now(UTC)
        r = await api.post(
            ENDPOINT,
            headers=headers,
            json={
                "events": [
                    event(recorded_at=(now - timedelta(minutes=2)).isoformat()),
                    event(
                        kind="SOS_TRIGGERED",
                        recorded_at=(now - timedelta(minutes=1)).isoformat(),
                        payload=None,
                    ),
                ]
            },
        )
        assert r.status_code == 202, r.text
        body = r.json()
        assert body["accepted"] == 1
        assert body["rejected"] == 1
        assert body["rejected_reasons"] == {"UNPROCESSABLE": 1}
        assert len(body["settled_event_ids"]) == 2

        # The SOS landed and opened its emergency.
        assert await _events_of(session, trip.id, "SOS_TRIGGERED")
        assert (
            await session.execute(select(Emergency).where(Emergency.trip_id == trip.id))
        ).scalar_one() is not None
        # The poison event was rolled back to its savepoint, not half-written.
        assert not await _events_of(session, trip.id, "ROUTE_DEVIATION")


class TestBounds:
    async def test_a_batch_larger_than_the_device_queue_is_refused(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _driver, _user, _trip, headers = await _driving(session, api)
        r = await api.post(
            ENDPOINT, headers=headers, json={"events": [event() for _ in range(201)]}
        )
        assert r.status_code == 422

    async def test_a_repeated_id_within_one_batch_is_refused(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _driver, _user, _trip, headers = await _driving(session, api)
        one = event()
        r = await api.post(ENDPOINT, headers=headers, json={"events": [one, dict(one)]})
        assert r.status_code == 422
        assert "unique within a batch" in r.text

    async def test_an_unbounded_payload_is_refused(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The payload is written straight into JSONB from a device this
        service does not control."""
        _driver, _user, _trip, headers = await _driving(session, api)
        r = await api.post(
            ENDPOINT,
            headers=headers,
            json={"events": [event(payload={f"k{i}": i for i in range(21)})]},
        )
        assert r.status_code == 422
        assert "at most 20 keys" in r.text

        r = await api.post(
            ENDPOINT,
            headers=headers,
            json={"events": [event(payload={"note": "x" * 201})]},
        )
        assert r.status_code == 422
