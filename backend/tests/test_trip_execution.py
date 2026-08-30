"""Trip execution: current trip, start gates, stop progress, completion.

The question this file answers is the same one P4 asked of assignments, applied
to trips: holding a perfectly valid token, can a driver act on anything that is
not theirs, or move a trip through a sequence the lifecycle forbids?

Every route under /api/driver/me/trip takes its subject from the token. No trip
id appears in a path, and the one that may appear in a body is compared against
the resolved trip and can only cause a rejection - so the tests probe every
parameter an attacker could try to bend, and every ordering a flaky network
could produce.
"""

import asyncio
import uuid
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import (
    AssignmentStatus,
    DriverStatus,
    TripEventKind,
    TripStatus,
    TripStopStatus,
    TruckStatus,
    UserRole,
)
from app.models.operations import Trip, TripEvent, TripStop
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


async def _crew(session: AsyncSession, *, verified: bool = True, stops: int = 2):
    """A driver with a verified truck and an ASSIGNED trip ready to start."""
    driver, user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(
        session, driver, truck, verified=verified
    )
    trip = await factories.make_trip(
        session, driver, truck, assignment=assignment, stops=stops
    )
    return driver, user, truck, assignment, trip


async def _headers(api: AsyncClient, user) -> dict:
    return await auth_headers(api, user.phone, factories.TEST_PASSWORD)


async def _fresh_clients(count: int) -> list[AsyncClient]:
    """Independent clients over independent app instances.

    Separate apps because a single AsyncClient serialises requests on one
    connection; concurrency tests that share one prove nothing.
    """
    from app.main import create_app

    return [
        AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://t")
        for _ in range(count)
    ]


# --- Current trip ---------------------------------------------------------


class TestCurrentTrip:
    async def test_no_trip_is_null_not_404(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A driver between trips is a normal state the app renders."""
        _, user = await factories.make_driver(session)
        headers = await _headers(api, user)

        response = await api.get("/api/driver/me/trip", headers=headers)
        assert response.status_code == 200
        assert response.json() is None

    async def test_returns_own_trip_with_stops_in_sequence(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, user, truck, _, trip = await _crew(session, stops=3)
        headers = await _headers(api, user)

        body = (await api.get("/api/driver/me/trip", headers=headers)).json()

        assert body["id"] == str(trip.id)
        assert body["truck"]["registration_number"] == truck.registration_number
        assert [s["sequence"] for s in body["stops"]] == [0, 1, 2]
        assert body["next_stop_id"] == body["stops"][0]["id"]
        assert body["status"] == "ASSIGNED"

    async def test_never_leaks_another_drivers_trip(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        await _crew(session)  # driver B has a trip
        _, user_a = await factories.make_driver(session)
        headers = await _headers(api, user_a)

        assert (await api.get("/api/driver/me/trip", headers=headers)).json() is None

    async def test_cancelled_trip_is_not_current(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        driver, user, truck, assignment, _ = await _crew(session)
        await factories.make_trip(
            session,
            driver,
            truck,
            assignment=assignment,
            status=TripStatus.CANCELLED,
        )
        headers = await _headers(api, user)

        body = (await api.get("/api/driver/me/trip", headers=headers)).json()
        assert body is not None
        assert body["status"] == "ASSIGNED", "a cancelled trip must not be current"

    async def test_in_progress_trip_wins_over_a_newly_assigned_one(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A driver already driving must not have the app switch trips."""
        driver, user, truck, assignment, first = await _crew(session)
        headers = await _headers(api, user)
        assert (
            await api.post("/api/driver/me/trip/start", headers=headers, json={})
        ).status_code == 200

        await factories.make_trip(session, driver, truck, assignment=assignment)

        body = (await api.get("/api/driver/me/trip", headers=headers)).json()
        assert body["id"] == str(first.id)

    async def test_response_carries_no_manager_metadata(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, user, _, _, _ = await _crew(session)
        headers = await _headers(api, user)
        body = (await api.get("/api/driver/me/trip", headers=headers)).text

        for leaked in ("created_by", "salary", "password", "assigned_by"):
            assert leaked not in body, f"{leaked} leaked to the driver app"

    async def test_anonymous_rejected(self, api: AsyncClient) -> None:
        assert (await api.get("/api/driver/me/trip")).status_code == 401

    async def test_manager_cannot_use_driver_trip_routes(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        assert (
            await api.get("/api/driver/me/trip", headers=manager_headers)
        ).status_code == 403
        assert (
            await api.post(
                "/api/driver/me/trip/start", headers=manager_headers, json={}
            )
        ).status_code == 403


# --- Start gates ----------------------------------------------------------


class TestStartGates:
    async def test_driver_starts_own_trip(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        driver, user, truck, _, trip = await _crew(session)
        headers = await _headers(api, user)

        response = await api.post(
            "/api/driver/me/trip/start", headers=headers, json={}
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "ACTIVE"
        assert body["started_at"] is not None
        assert body["tracking_expected"] is True

        await session.refresh(trip)
        await session.refresh(driver)
        await session.refresh(truck)
        assert trip.status is TripStatus.ACTIVE
        assert driver.status is DriverStatus.ON_TRIP
        assert truck.status is TruckStatus.ON_TRIP

    async def test_start_writes_a_trip_event_and_an_audit_row(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Two records, and they are not duplicates.

        trip_events is the operational narrative; audit_logs is who changed
        what. Losing either loses a different question's answer.
        """
        from app.models.audit import AuditLog

        _, user, _, _, trip = await _crew(session)
        headers = await _headers(api, user)
        await api.post("/api/driver/me/trip/start", headers=headers, json={})

        events = list(
            (
                await session.execute(
                    select(TripEvent).where(
                        TripEvent.trip_id == trip.id,
                        TripEvent.kind == TripEventKind.STARTED,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(events) == 1
        assert events[0].actor_user_id == user.id

        audits = list(
            (
                await session.execute(
                    select(AuditLog).where(
                        AuditLog.entity_type == "trips", AuditLog.entity_id == trip.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert audits, "starting a trip produced no audit record"
        assert audits[-1].actor_user_id == user.id

    async def test_unverified_assignment_blocks_start(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """P4's truck check would be optional in practice if this passed."""
        _, user, _, _, _ = await _crew(session, verified=False)
        headers = await _headers(api, user)

        view = (await api.get("/api/driver/me/trip", headers=headers)).json()
        assert view["can_start"] is False
        assert view["start_blocked_code"] == "ASSIGNMENT_NOT_VERIFIED"

        response = await api.post(
            "/api/driver/me/trip/start", headers=headers, json={}
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "ASSIGNMENT_NOT_VERIFIED"

    async def test_broken_down_truck_blocks_start(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, user, truck, _, _ = await _crew(session)
        truck.status = TruckStatus.BREAKDOWN
        await session.commit()
        headers = await _headers(api, user)

        response = await api.post(
            "/api/driver/me/trip/start", headers=headers, json={}
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "TRUCK_NOT_OPERATIONAL"

    async def test_ended_assignment_blocks_start(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, user, _, assignment, _ = await _crew(session)
        assignment.status = AssignmentStatus.ENDED
        await session.commit()
        headers = await _headers(api, user)

        response = await api.post(
            "/api/driver/me/trip/start", headers=headers, json={}
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "NO_ACTIVE_ASSIGNMENT"

    async def test_suspended_driver_cannot_start(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        driver, user, _, _, _ = await _crew(session)
        headers = await _headers(api, user)
        driver.status = DriverStatus.SUSPENDED
        await session.commit()

        response = await api.post(
            "/api/driver/me/trip/start", headers=headers, json={}
        )
        assert response.status_code == 403

    async def test_start_is_idempotent(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A retry after a lost response must not be a dead end."""
        _, user, _, _, trip = await _crew(session)
        headers = await _headers(api, user)

        first = await api.post("/api/driver/me/trip/start", headers=headers, json={})
        second = await api.post("/api/driver/me/trip/start", headers=headers, json={})

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["started_at"] == second.json()["started_at"], (
            "a retry moved the start time"
        )

    async def test_another_drivers_trip_id_cannot_redirect_start(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, _, _, _, trip_b = await _crew(session)
        _, user_a, _, _, _ = await _crew(session)
        headers_a = await _headers(api, user_a)

        response = await api.post(
            "/api/driver/me/trip/start",
            headers=headers_a,
            json={"trip_id": str(trip_b.id)},
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "TRIP_SUPERSEDED"

        await session.refresh(trip_b)
        assert trip_b.status is TripStatus.ASSIGNED, (
            "driver A started driver B's trip - horizontal privilege escalation"
        )

    async def test_driver_id_in_body_is_rejected(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        driver_b, _ = await factories.make_driver(session)
        _, user_a, _, _, _ = await _crew(session)
        headers = await _headers(api, user_a)

        response = await api.post(
            "/api/driver/me/trip/start",
            headers=headers,
            json={"driver_id": str(driver_b.id)},
        )
        assert response.status_code == 422, "extra=forbid must reject impersonation"


# --- Stop execution -------------------------------------------------------


class TestStopExecution:
    async def _started(self, api: AsyncClient, session: AsyncSession, stops: int = 2):
        driver, user, truck, assignment, trip = await _crew(session, stops=stops)
        headers = await _headers(api, user)
        body = (
            await api.post("/api/driver/me/trip/start", headers=headers, json={})
        ).json()
        return driver, user, trip, headers, body

    async def test_arrive_then_complete_moves_the_stop_forward(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, _, trip, headers, body = await self._started(api, session)
        stop_id = body["next_stop_id"]

        arrived = await api.post(
            f"/api/driver/me/trip/stops/{stop_id}/arrive", headers=headers
        )
        assert arrived.status_code == 200
        first = next(s for s in arrived.json()["stops"] if s["id"] == stop_id)
        assert first["status"] == "ARRIVED"
        assert first["actual_arrival_at"] is not None

        completed = await api.post(
            f"/api/driver/me/trip/stops/{stop_id}/complete", headers=headers
        )
        assert completed.status_code == 200
        done = next(s for s in completed.json()["stops"] if s["id"] == stop_id)
        assert done["status"] == "COMPLETED"
        # The next stop becomes actionable, and only that one.
        assert completed.json()["next_stop_id"] != stop_id

    async def test_completing_before_arriving_is_refused(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, _, _, headers, body = await self._started(api, session)
        stop_id = body["next_stop_id"]

        response = await api.post(
            f"/api/driver/me/trip/stops/{stop_id}/complete", headers=headers
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "ILLEGAL_STOP_TRANSITION"

    async def test_stops_must_be_done_in_order(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, _, _, headers, body = await self._started(api, session, stops=3)
        third = body["stops"][2]["id"]

        response = await api.post(
            f"/api/driver/me/trip/stops/{third}/arrive", headers=headers
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "STOP_OUT_OF_ORDER"

    async def test_stops_cannot_be_touched_before_the_trip_starts(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, user, _, _, trip = await _crew(session)
        headers = await _headers(api, user)
        view = (await api.get("/api/driver/me/trip", headers=headers)).json()

        response = await api.post(
            f"/api/driver/me/trip/stops/{view['next_stop_id']}/arrive",
            headers=headers,
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "TRIP_NOT_IN_PROGRESS"

    async def test_another_trips_stop_is_404(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """404 and not 403: confirming the id exists is itself a disclosure."""
        _, _, trip_b, headers_b, body_b = await self._started(api, session)
        stop_b = body_b["next_stop_id"]

        _, _, _, headers_a, _ = await self._started(api, session)

        response = await api.post(
            f"/api/driver/me/trip/stops/{stop_b}/arrive", headers=headers_a
        )
        assert response.status_code == 404

        row = (
            await session.execute(
                select(TripStop).where(TripStop.id == uuid.UUID(stop_b))
            )
        ).scalar_one()
        assert row.status is TripStopStatus.PENDING, (
            "driver A mutated driver B's stop"
        )

    async def test_unknown_stop_id_is_404(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, _, _, headers, _ = await self._started(api, session)
        response = await api.post(
            f"/api/driver/me/trip/stops/{uuid.uuid4()}/arrive", headers=headers
        )
        assert response.status_code == 404

    async def test_arrive_is_idempotent(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, _, _, headers, body = await self._started(api, session)
        stop_id = body["next_stop_id"]

        first = await api.post(
            f"/api/driver/me/trip/stops/{stop_id}/arrive", headers=headers
        )
        second = await api.post(
            f"/api/driver/me/trip/stops/{stop_id}/arrive", headers=headers
        )
        assert (first.status_code, second.status_code) == (200, 200)

    async def test_completing_a_stop_twice_is_idempotent(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A lost response on the LAST action at a stop must be safe to resend.

        Regression: the ordering rule was checked before the idempotency test,
        which made the idempotent path unreachable for a completed stop.
        Finishing stop 1 settles it, so `next_actionable_stop` moves to stop 2,
        and the resend came back `409 STOP_OUT_OF_ORDER` - a conflict for an
        action that had already succeeded, raised at a depot where the signal is
        worst and the retry most likely.
        """
        _, _, _, headers, body = await self._started(api, session)
        stop_id = body["next_stop_id"]
        await api.post(
            f"/api/driver/me/trip/stops/{stop_id}/arrive", headers=headers
        )

        first = await api.post(
            f"/api/driver/me/trip/stops/{stop_id}/complete", headers=headers
        )
        retry = await api.post(
            f"/api/driver/me/trip/stops/{stop_id}/complete", headers=headers
        )
        assert first.status_code == 200, first.text
        assert retry.status_code == 200, retry.text

        completed = next(
            s for s in retry.json()["stops"] if s["id"] == stop_id
        )
        assert completed["status"] == "COMPLETED"

    async def test_a_stop_already_passed_still_refuses_a_new_transition(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Idempotence must not become a way to reopen a settled stop.

        Re-sending the SAME transition is a retry. Sending a DIFFERENT one to a
        stop the trip has moved past is out of order, and stays refused.
        """
        _, _, _, headers, body = await self._started(api, session, stops=2)
        first_stop = body["next_stop_id"]
        await api.post(
            f"/api/driver/me/trip/stops/{first_stop}/arrive", headers=headers
        )
        await api.post(
            f"/api/driver/me/trip/stops/{first_stop}/complete", headers=headers
        )

        response = await api.post(
            f"/api/driver/me/trip/stops/{first_stop}/arrive", headers=headers
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "STOP_OUT_OF_ORDER"


# --- Completion -----------------------------------------------------------


class TestTripCompletion:
    async def _run_stops(self, api: AsyncClient, headers: dict, body: dict) -> dict:
        current = body
        while current["next_stop_id"]:
            stop_id = current["next_stop_id"]
            await api.post(
                f"/api/driver/me/trip/stops/{stop_id}/arrive", headers=headers
            )
            current = (
                await api.post(
                    f"/api/driver/me/trip/stops/{stop_id}/complete", headers=headers
                )
            ).json()
        return current

    async def test_completion_requires_every_stop(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Not a status PATCH: a delivery that did not happen must not be recorded."""
        _, user, _, _, _ = await _crew(session, stops=2)
        headers = await _headers(api, user)
        await api.post("/api/driver/me/trip/start", headers=headers, json={})

        response = await api.post(
            "/api/driver/me/trip/complete", headers=headers, json={}
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "STOPS_INCOMPLETE"

    async def test_full_run_completes_and_releases_the_crew(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        driver, user, truck, _, trip = await _crew(session, stops=2)
        headers = await _headers(api, user)
        body = (
            await api.post("/api/driver/me/trip/start", headers=headers, json={})
        ).json()
        await self._run_stops(api, headers, body)

        response = await api.post(
            "/api/driver/me/trip/complete", headers=headers, json={}
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "DELIVERED"
        assert response.json()["delivered_at"] is not None
        assert response.json()["tracking_expected"] is False

        await session.refresh(trip)
        await session.refresh(driver)
        await session.refresh(truck)
        assert trip.status is TripStatus.DELIVERED
        assert driver.status is DriverStatus.AVAILABLE
        assert truck.status is TruckStatus.AVAILABLE

    async def test_completing_the_trip_twice_is_idempotent(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The very last action of a trip must be safe to resend.

        Regression: `complete()` had an unreachable `DELIVERED` early-return -
        `current_trip()` excludes DELIVERED, so a resend never reached it and
        answered 404 "you have no trip to work on right now" to a driver whose
        delivery had in fact been recorded.
        """
        _, user, _, _, trip = await _crew(session, stops=1)
        headers = await _headers(api, user)
        body = (
            await api.post("/api/driver/me/trip/start", headers=headers, json={})
        ).json()
        await self._run_stops(api, headers, body)

        first = await api.post(
            "/api/driver/me/trip/complete",
            headers=headers,
            json={"trip_id": str(trip.id)},
        )
        retry = await api.post(
            "/api/driver/me/trip/complete",
            headers=headers,
            json={"trip_id": str(trip.id)},
        )
        assert first.status_code == 200, first.text
        assert retry.status_code == 200, retry.text
        assert retry.json()["status"] == "DELIVERED"
        assert retry.json()["delivered_at"] == first.json()["delivered_at"], (
            "a retry moved the delivery timestamp"
        )

    async def test_the_delivered_trip_lookup_cannot_reach_another_driver(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The idempotent-completion path must not become an addressing hole.

        It resolves a trip by id rather than from the driver's open trip, so it
        is the one place in the driver API where an id reaches a lookup. It is
        filtered by driver_id; this proves that filter holds.
        """
        # Driver B delivers a trip of their own.
        _, user_b, _, _, trip_b = await _crew(session, stops=1)
        headers_b = await _headers(api, user_b)
        body_b = (
            await api.post("/api/driver/me/trip/start", headers=headers_b, json={})
        ).json()
        await self._run_stops(api, headers_b, body_b)
        assert (
            await api.post(
                "/api/driver/me/trip/complete", headers=headers_b, json={}
            )
        ).status_code == 200

        # Driver A, with no trip of their own, names B's delivered trip.
        _, user_a = await factories.make_driver(session)
        headers_a = await _headers(api, user_a)
        response = await api.post(
            "/api/driver/me/trip/complete",
            headers=headers_a,
            json={"trip_id": str(trip_b.id)},
        )
        assert response.status_code == 404, response.text
        assert str(trip_b.id) not in response.text

    async def test_completed_trip_is_no_longer_current(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, user, _, _, _ = await _crew(session, stops=1)
        headers = await _headers(api, user)
        body = (
            await api.post("/api/driver/me/trip/start", headers=headers, json={})
        ).json()
        await self._run_stops(api, headers, body)
        await api.post("/api/driver/me/trip/complete", headers=headers, json={})

        assert (await api.get("/api/driver/me/trip", headers=headers)).json() is None

    async def test_a_delivered_trip_cannot_be_mutated(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, user, _, _, trip = await _crew(session, stops=1)
        headers = await _headers(api, user)
        body = (
            await api.post("/api/driver/me/trip/start", headers=headers, json={})
        ).json()
        stop_id = body["next_stop_id"]
        await self._run_stops(api, headers, body)
        await api.post("/api/driver/me/trip/complete", headers=headers, json={})

        # No current trip any more, so every driver route refuses.
        for path in (
            f"/api/driver/me/trip/stops/{stop_id}/arrive",
            f"/api/driver/me/trip/stops/{stop_id}/complete",
        ):
            assert (await api.post(path, headers=headers)).status_code == 404

        await session.refresh(trip)
        assert trip.status is TripStatus.DELIVERED, (
            "a delivered trip was resurrected"
        )


# --- Concurrency ----------------------------------------------------------


class TestConcurrency:
    async def test_two_devices_starting_at_once_start_once(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, user, _, _, trip = await _crew(session)
        headers = await _headers(api, user)
        clients = await _fresh_clients(3)

        try:
            responses = await asyncio.gather(
                *(
                    c.post("/api/driver/me/trip/start", headers=headers, json={})
                    for c in clients
                ),
                return_exceptions=True,
            )
        finally:
            for c in clients:
                await c.aclose()

        codes = [getattr(r, "status_code", 500) for r in responses]
        assert all(c in (200, 409) for c in codes), codes

        await session.refresh(trip)
        assert trip.status is TripStatus.ACTIVE

        started = (
            await session.execute(
                select(func.count(TripEvent.id)).where(
                    TripEvent.trip_id == trip.id,
                    TripEvent.kind == TripEventKind.STARTED,
                )
            )
        ).scalar_one()
        assert started == 1, f"trip recorded {started} starts"

    async def test_two_devices_completing_a_stop_at_once(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, user, _, _, trip = await _crew(session, stops=2)
        headers = await _headers(api, user)
        body = (
            await api.post("/api/driver/me/trip/start", headers=headers, json={})
        ).json()
        stop_id = body["next_stop_id"]
        await api.post(
            f"/api/driver/me/trip/stops/{stop_id}/arrive", headers=headers
        )

        clients = await _fresh_clients(3)
        try:
            responses = await asyncio.gather(
                *(
                    c.post(
                        f"/api/driver/me/trip/stops/{stop_id}/complete",
                        headers=headers,
                    )
                    for c in clients
                ),
                return_exceptions=True,
            )
        finally:
            for c in clients:
                await c.aclose()

        codes = [getattr(r, "status_code", 500) for r in responses]
        assert all(c in (200, 409) for c in codes), codes

        events = (
            await session.execute(
                select(func.count(TripEvent.id)).where(
                    TripEvent.trip_id == trip.id,
                    TripEvent.kind == TripEventKind.STOP_COMPLETED,
                )
            )
        ).scalar_one()
        assert events == 1, f"stop recorded {events} completions"

    async def test_two_devices_completing_the_trip_at_once(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, user, _, _, trip = await _crew(session, stops=1)
        headers = await _headers(api, user)
        body = (
            await api.post("/api/driver/me/trip/start", headers=headers, json={})
        ).json()
        stop_id = body["next_stop_id"]
        await api.post(
            f"/api/driver/me/trip/stops/{stop_id}/arrive", headers=headers
        )
        await api.post(
            f"/api/driver/me/trip/stops/{stop_id}/complete", headers=headers
        )

        clients = await _fresh_clients(3)
        try:
            responses = await asyncio.gather(
                *(
                    c.post("/api/driver/me/trip/complete", headers=headers, json={})
                    for c in clients
                ),
                return_exceptions=True,
            )
        finally:
            for c in clients:
                await c.aclose()

        codes = [getattr(r, "status_code", 500) for r in responses]
        assert all(c in (200, 409, 404) for c in codes), codes

        await session.refresh(trip)
        assert trip.status is TripStatus.DELIVERED

        delivered = (
            await session.execute(
                select(func.count(TripEvent.id)).where(
                    TripEvent.trip_id == trip.id,
                    TripEvent.kind == TripEventKind.DELIVERED,
                )
            )
        ).scalar_one()
        assert delivered == 1, f"trip recorded {delivered} deliveries"

    async def test_manager_cancel_racing_a_driver_start_leaves_one_state(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """Whoever wins, the trip must be in exactly one legal state."""
        _, user, _, _, trip = await _crew(session)
        driver_headers = await _headers(api, user)
        clients = await _fresh_clients(2)

        try:
            start, cancel = await asyncio.gather(
                clients[0].post(
                    "/api/driver/me/trip/start", headers=driver_headers, json={}
                ),
                clients[1].post(
                    f"/api/trips/{trip.id}/cancel", headers=manager_headers
                ),
                return_exceptions=True,
            )
        finally:
            for c in clients:
                await c.aclose()

        await session.refresh(trip)
        assert trip.status in (TripStatus.ACTIVE, TripStatus.CANCELLED)

        start_code = getattr(start, "status_code", 500)
        cancel_code = getattr(cancel, "status_code", 500)
        if trip.status is TripStatus.CANCELLED:
            assert cancel_code == 200
        else:
            assert start_code == 200
        # Neither may 500: a lost race is a conflict, not a crash.
        assert start_code in (200, 404, 409), start_code
        assert cancel_code in (200, 409), cancel_code


# --- Manager view ---------------------------------------------------------


class TestManagerTripView:
    async def test_manager_sees_actual_trip_state(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        _, user, _, _, trip = await _crew(session)
        headers = await _headers(api, user)
        await api.post("/api/driver/me/trip/start", headers=headers, json={})

        body = (
            await api.get(f"/api/trips/{trip.id}", headers=manager_headers)
        ).json()
        assert body["status"] == "ACTIVE"
        assert body["started_at"] is not None
        assert [s["sequence"] for s in body["stops"]] == [0, 1]

    async def test_trip_detail_carries_what_the_truck_is_actually_hauling(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """The operations map needs cargo and load without a second lookup.

        `total_weight_kg` is the trigger-derived figure the capacity gate was
        measured against, so this is the load that was actually authorised -
        not a restatement a client could disagree with.
        """
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        shipment = await factories.make_shipment(session, weight_kg=7500)
        trip = await factories.make_trip(
            session, driver, truck, shipment=shipment
        )

        body = (
            await api.get(f"/api/trips/{trip.id}", headers=manager_headers)
        ).json()

        assert body["shipment"]["id"] == str(shipment.id)
        assert body["shipment"]["reference_code"] == shipment.reference_code
        assert body["shipment"]["client_name"] == "Test Client"
        assert Decimal(body["shipment"]["total_weight_kg"]) == Decimal("7500")

    async def test_a_driver_cannot_read_trip_detail(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Cargo, client and load are manager data, not driver data."""
        _, user, _, _, trip = await _crew(session)
        headers = await _headers(api, user)
        assert (
            await api.get(f"/api/trips/{trip.id}", headers=headers)
        ).status_code == 403

    async def test_driver_cannot_read_the_trip_list(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, user, _, _, _ = await _crew(session)
        headers = await _headers(api, user)
        assert (await api.get("/api/trips", headers=headers)).status_code == 403

    async def test_closing_an_undelivered_trip_is_refused(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        _, _, _, _, trip = await _crew(session)
        response = await api.post(
            f"/api/trips/{trip.id}/close", headers=manager_headers
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "ILLEGAL_TRIP_TRANSITION"

    async def test_cancelling_a_started_trip_releases_the_crew(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        driver, user, truck, _, trip = await _crew(session)
        headers = await _headers(api, user)
        await api.post("/api/driver/me/trip/start", headers=headers, json={})

        response = await api.post(
            f"/api/trips/{trip.id}/cancel", headers=manager_headers
        )
        assert response.status_code == 200

        await session.refresh(driver)
        await session.refresh(truck)
        assert driver.status is DriverStatus.AVAILABLE
        assert truck.status is TruckStatus.AVAILABLE


# --- Manager dispatch -----------------------------------------------------


class TestDispatch:
    async def test_dispatch_requires_an_active_assignment(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """Never silently manufacture the assignment to make dispatch work."""
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        shipment = await factories.make_shipment(session)

        created = await api.post(
            "/api/trips",
            headers=manager_headers,
            json={
                "trip_code": f"{factories.TEST_TRIP_PREFIX}{uuid.uuid4().hex[:8].upper()}",
                "shipment_id": str(shipment.id),
                "truck_id": str(truck.id),
                "driver_id": str(driver.id),
            },
        )
        assert created.status_code == 201, created.text
        assert created.json()["status"] == "DRAFT"

        response = await api.post(
            f"/api/trips/{created.json()['id']}/dispatch", headers=manager_headers
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "NO_ACTIVE_ASSIGNMENT"

    async def test_dispatch_refuses_an_overloaded_truck(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """422, not 403 - no role may authorise an overloaded truck."""
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session, capacity=1000)
        await factories.make_assignment(session, driver, truck)
        shipment = await factories.make_shipment(session, weight_kg=5000)

        response = await api.post(
            "/api/trips",
            headers=manager_headers,
            json={
                "trip_code": f"{factories.TEST_TRIP_PREFIX}{uuid.uuid4().hex[:8].upper()}",
                "shipment_id": str(shipment.id),
                "truck_id": str(truck.id),
                "driver_id": str(driver.id),
            },
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "CAPACITY_EXCEEDED"

    async def test_created_trip_defaults_to_the_shipment_endpoints(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        shipment = await factories.make_shipment(session)

        created = (
            await api.post(
                "/api/trips",
                headers=manager_headers,
                json={
                    "trip_code": f"{factories.TEST_TRIP_PREFIX}{uuid.uuid4().hex[:8].upper()}",
                    "shipment_id": str(shipment.id),
                    "truck_id": str(truck.id),
                    "driver_id": str(driver.id),
                },
            )
        ).json()

        detail = (
            await api.get(f"/api/trips/{created['id']}", headers=manager_headers)
        ).json()
        assert [s["kind"] for s in detail["stops"]] == ["PICKUP", "DROPOFF"]
        assert detail["stops"][0]["address"] == "Depot, Guwahati"

    async def test_client_cannot_choose_the_initial_status(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        shipment = await factories.make_shipment(session)

        response = await api.post(
            "/api/trips",
            headers=manager_headers,
            json={
                "trip_code": f"{factories.TEST_TRIP_PREFIX}{uuid.uuid4().hex[:8].upper()}",
                "shipment_id": str(shipment.id),
                "truck_id": str(truck.id),
                "driver_id": str(driver.id),
                "status": "ACTIVE",
            },
        )
        assert response.status_code == 422, "status must not be settable by a client"

    async def test_full_dispatch_path_reaches_assigned(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await factories.make_assignment(session, driver, truck)
        shipment = await factories.make_shipment(session)

        created = (
            await api.post(
                "/api/trips",
                headers=manager_headers,
                json={
                    "trip_code": f"{factories.TEST_TRIP_PREFIX}{uuid.uuid4().hex[:8].upper()}",
                    "shipment_id": str(shipment.id),
                    "truck_id": str(truck.id),
                    "driver_id": str(driver.id),
                },
            )
        ).json()

        dispatched = await api.post(
            f"/api/trips/{created['id']}/dispatch", headers=manager_headers
        )
        assert dispatched.status_code == 200, dispatched.text
        assert dispatched.json()["status"] == "ASSIGNED"

        row = (
            await session.execute(
                select(Trip).where(Trip.id == uuid.UUID(created["id"]))
            )
        ).scalar_one()
        assert row.assignment_id == assignment.id
        assert row.dispatched_at is not None
