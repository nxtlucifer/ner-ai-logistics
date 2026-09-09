"""Concurrency: the assignment invariant must survive competing writes.

A SELECT-then-INSERT pre-check cannot hold on its own:

    request A: SELECT -> free -> INSERT
    request B: SELECT -> free -> INSERT      <- both pre-checks passed

Both transactions see a clean pre-check and both attempt the insert. The
authority is therefore the partial unique indexes from migration 0002.

These tests fire genuinely simultaneous requests and assert the INVARIANT, not
the response codes. That distinction matters: reassignment is a supported
operation, so two racing requests for the same truck may both legitimately
return 201 - the second ends the first assignment and takes over. What must
never happen is two ACTIVE rows for one truck, or one driver holding two.
"""

import asyncio
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import AssignmentStatus, TripStatus, UserRole
from app.models.fleet import DriverTruckAssignment
from app.models.identity import Driver, User
from app.models.operations import Trip
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


async def _client() -> AsyncClient:
    """A separate client, so requests do not serialise on one connection."""
    from app.main import create_app

    return AsyncClient(
        transport=ASGITransport(app=create_app()), base_url="http://test"
    )


class TestAssignmentRaces:
    async def test_two_drivers_racing_for_one_truck(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """One truck must end up with exactly one active assignment.

        Both requests may return 201 - see the comment below - but the database
        must never hold two ACTIVE rows for the same truck. That is enforced by
        uq_current_assignment_truck, and asserted directly here.
        """
        manager = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)

        driver_a, _ = await factories.make_driver(session)
        driver_b, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)

        client_a, client_b = await _client(), await _client()
        try:
            responses = await asyncio.gather(
                client_a.post(
                    "/api/assignments",
                    headers=headers,
                    json={"driver_id": str(driver_a.id), "truck_id": str(truck.id)},
                ),
                client_b.post(
                    "/api/assignments",
                    headers=headers,
                    json={"driver_id": str(driver_b.id), "truck_id": str(truck.id)},
                ),
                return_exceptions=True,
            )
        finally:
            await client_a.aclose()
            await client_b.aclose()

        codes = [
            r.status_code if hasattr(r, "status_code") else 500 for r in responses
        ]
        assert 201 in codes, f"neither request succeeded: {codes}"

        # Both requests MAY legitimately return 201. Reassignment is a supported
        # operation: whichever request runs second ends the first assignment and
        # takes the truck over. That is last-write-wins, not corruption.
        #
        # The property under test is therefore not "one request fails" but the
        # invariant itself, asserted below. Any request that does fail must fail
        # cleanly rather than with a 500.
        for code in codes:
            assert code in (201, 409, 422), (
                f"a racing request returned {code}; expected 201 or a clean "
                f"conflict. All codes: {codes}"
            )

        active = (
            await session.execute(
                select(func.count())
                .select_from(DriverTruckAssignment)
                .where(
                    DriverTruckAssignment.truck_id == truck.id,
                    DriverTruckAssignment.status == AssignmentStatus.ACTIVE,
                )
            )
        ).scalar_one()
        assert active == 1, f"{active} active assignments for one truck"

    async def test_one_driver_racing_for_two_trucks(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The mirror invariant: a driver cannot hold two trucks."""
        manager = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)

        driver, _ = await factories.make_driver(session)
        truck_a = await factories.make_truck(session)
        truck_b = await factories.make_truck(session)

        client_a, client_b = await _client(), await _client()
        try:
            await asyncio.gather(
                client_a.post(
                    "/api/assignments",
                    headers=headers,
                    json={"driver_id": str(driver.id), "truck_id": str(truck_a.id)},
                ),
                client_b.post(
                    "/api/assignments",
                    headers=headers,
                    json={"driver_id": str(driver.id), "truck_id": str(truck_b.id)},
                ),
                return_exceptions=True,
            )
        finally:
            await client_a.aclose()
            await client_b.aclose()

        active = (
            await session.execute(
                select(func.count())
                .select_from(DriverTruckAssignment)
                .where(
                    DriverTruckAssignment.driver_id == driver.id,
                    DriverTruckAssignment.status == AssignmentStatus.ACTIVE,
                )
            )
        ).scalar_one()
        assert active == 1, f"driver holds {active} active assignments"

    async def test_identical_requests_do_not_double_assign(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Double-submit from an impatient UI must not create two rows."""
        manager = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)

        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        body = {"driver_id": str(driver.id), "truck_id": str(truck.id)}

        clients = [await _client() for _ in range(3)]
        try:
            await asyncio.gather(
                *(c.post("/api/assignments", headers=headers, json=body) for c in clients),
                return_exceptions=True,
            )
        finally:
            for c in clients:
                await c.aclose()

        active = (
            await session.execute(
                select(func.count())
                .select_from(DriverTruckAssignment)
                .where(
                    DriverTruckAssignment.driver_id == driver.id,
                    DriverTruckAssignment.status == AssignmentStatus.ACTIVE,
                )
            )
        ).scalar_one()
        assert active == 1


class TestDuplicateCreationRaces:
    async def test_concurrent_identical_truck_registrations(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The unique index is the authority, not the service pre-check."""
        manager = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)
        payload = {
            "registration_number": factories.unique_registration(),
            "max_capacity_kg": "16000.00",
        }

        clients = [await _client() for _ in range(3)]
        try:
            responses = await asyncio.gather(
                *(c.post("/api/trucks", headers=headers, json=payload) for c in clients),
                return_exceptions=True,
            )
        finally:
            for c in clients:
                await c.aclose()

        codes = [r.status_code if hasattr(r, "status_code") else 500 for r in responses]
        assert codes.count(201) == 1, f"expected exactly one creation, got {codes}"
        assert all(c in (201, 409) for c in codes), (
            f"a racing duplicate produced something other than 409: {codes}"
        )


class TestDispatchabilityRaces:
    """Deactivating a login and dispatching a trip must not both win.

    The manager UI cannot close this window: it renders a driver list, and by
    the time the dispatch click arrives the login behind a row may already be
    disabled. Exactly one of the two operations may take effect, and whichever
    loses must leave no trip that its driver can never start.
    """

    async def test_deactivation_racing_dispatch_leaves_no_stranded_trip(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        manager = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)

        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        await factories.make_assignment(session, driver, truck)
        shipment = await factories.make_shipment(session)

        created = await api.post(
            "/api/trips",
            headers=headers,
            json={
                "trip_code": f"{factories.TEST_TRIP_PREFIX}{uuid.uuid4().hex[:8].upper()}",
                "shipment_id": str(shipment.id),
                "truck_id": str(truck.id),
                "driver_id": str(driver.id),
            },
        )
        assert created.status_code == 201, created.text
        trip_id = created.json()["id"]

        client_a, client_b = await _client(), await _client()
        try:
            dispatched, deactivated = await asyncio.gather(
                client_a.post(f"/api/trips/{trip_id}/dispatch", headers=headers),
                client_b.post(f"/api/drivers/{driver.id}/deactivate", headers=headers),
            )
        finally:
            await client_a.aclose()
            await client_b.aclose()

        # Response codes are not the invariant - either order is legitimate.
        # What must hold is that the two outcomes agree with each other.
        trip = await session.get(Trip, uuid.UUID(trip_id))
        await session.refresh(trip)
        user_active = (
            await session.execute(
                select(User.is_active)
                .join(Driver, Driver.user_id == User.id)
                .where(Driver.id == driver.id)
            )
        ).scalar_one()

        if trip.status is TripStatus.ASSIGNED:
            assert user_active is True, (
                "trip was dispatched to a driver whose login was disabled - "
                f"dispatch={dispatched.status_code} deactivate={deactivated.status_code}"
            )
        else:
            assert trip.status is TripStatus.DRAFT

    async def test_dispatch_takes_the_login_lock_before_the_trip_lock(
        self, api: AsyncClient, session: AsyncSession, monkeypatch
    ) -> None:
        """Lock ORDER, asserted directly rather than raced for.

        `drivers.deactivate()` locks the users row and then the trip rows.
        Dispatch touches the same two rows, so if it took them in the opposite
        order the two would deadlock:

            dispatch    holds trips, waits for users
            deactivate  holds users, waits for trips

        PostgreSQL breaks that by aborting one side with SQLSTATE 40P01, which
        nothing here handles - the caller would meet a 500 exactly where the
        design promises a clean 409. A racing test only catches this when the
        interleaving happens to land; asserting the order catches it every run.
        """
        from app.services import trips as trips_service

        order: list[str] = []
        real_driver = trips_service._load_driver
        real_trip = trips_service.load_for_update

        async def spy_driver(*args, **kwargs):
            order.append("users")
            return await real_driver(*args, **kwargs)

        async def spy_trip(*args, **kwargs):
            order.append("trips")
            return await real_trip(*args, **kwargs)

        monkeypatch.setattr(trips_service, "_load_driver", spy_driver)
        monkeypatch.setattr(trips_service, "load_for_update", spy_trip)

        manager = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        await factories.make_assignment(session, driver, truck)
        shipment = await factories.make_shipment(session)

        created = await api.post(
            "/api/trips",
            headers=headers,
            json={
                "trip_code": f"{factories.TEST_TRIP_PREFIX}{uuid.uuid4().hex[:8].upper()}",
                "shipment_id": str(shipment.id),
                "truck_id": str(truck.id),
                "driver_id": str(driver.id),
            },
        )
        assert created.status_code == 201, created.text

        order.clear()
        r = await api.post(
            f"/api/trips/{created.json()['id']}/dispatch", headers=headers
        )
        assert r.status_code == 200, r.text

        assert "users" in order and "trips" in order, order
        assert order.index("users") < order.index("trips"), (
            "dispatch locked the trip before the login; drivers.deactivate() "
            f"takes them the other way round, which deadlocks. order={order}"
        )

    async def test_the_race_never_answers_with_a_server_error(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A deadlock does not corrupt data - it produces a 500.

        The invariant test above accepts either winner, so an ABBA deadlock
        would slip past it: the loser aborts, no bad row is written, and the
        final state still looks consistent. What the operator actually meets is
        a 500 on a perfectly ordinary click. That is the symptom worth pinning.
        """
        manager = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)

        for _ in range(3):
            driver, _u = await factories.make_driver(session)
            truck = await factories.make_truck(session)
            await factories.make_assignment(session, driver, truck)
            shipment = await factories.make_shipment(session)
            created = await api.post(
                "/api/trips",
                headers=headers,
                json={
                    "trip_code": f"{factories.TEST_TRIP_PREFIX}{uuid.uuid4().hex[:8].upper()}",
                    "shipment_id": str(shipment.id),
                    "truck_id": str(truck.id),
                    "driver_id": str(driver.id),
                },
            )
            assert created.status_code == 201, created.text
            trip_id = created.json()["id"]

            client_a, client_b = await _client(), await _client()
            try:
                dispatched, deactivated = await asyncio.gather(
                    client_a.post(f"/api/trips/{trip_id}/dispatch", headers=headers),
                    client_b.post(
                        f"/api/drivers/{driver.id}/deactivate", headers=headers
                    ),
                )
            finally:
                await client_a.aclose()
                await client_b.aclose()

            for label, response in (
                ("dispatch", dispatched),
                ("deactivate", deactivated),
            ):
                assert response.status_code < 500, (
                    f"{label} answered {response.status_code} - a deadlock or "
                    f"unhandled error, not a decision: {response.text[:300]}"
                )

    async def test_overlapping_trip_row_locks_take_a_stable_order(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Row-order deadlock, one level below the table-order one.

        `drivers.deactivate()` and `assignments._refuse_if_a_trip_is_underway()`
        both lock a SET of one driver's trips FOR UPDATE, and the sets overlap.
        Agreeing on users-then-trips is not enough: two transactions taking the
        same rows in different orders deadlock on row order alone.

        The precondition is real and is asserted below rather than assumed - a
        driver may hold more than one non-terminal trip. Nothing forbids it:
        `trips.create()` guards only `trip_code`, and `ix_trips_active` is not a
        unique index. With one row the order cannot differ; with two it can.

        Both queries now sort by `Trip.id`, so the sequence is identical on both
        sides. This test would be silent about ordering if it only checked the
        final rows, so what it asserts is the symptom a deadlock actually
        produces: a 5xx on an ordinary click.
        """
        manager = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)

        driver, _u = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await factories.make_assignment(session, driver, truck)

        # Two trips in a state BOTH filters select (ASSIGNED is in
        # REQUIRES_DRIVER_LOGIN and is not terminal), so the locked sets overlap.
        trips = [
            await factories.make_trip(
                session, driver, truck, assignment=assignment,
                status=TripStatus.ASSIGNED,
            )
            for _ in range(2)
        ]
        assert len({t.id for t in trips}) == 2, (
            "precondition: a driver must be able to hold more than one "
            "non-terminal trip for the row order to matter at all"
        )

        client_a, client_b = await _client(), await _client()
        try:
            deactivated, ended = await asyncio.gather(
                client_a.post(f"/api/drivers/{driver.id}/deactivate", headers=headers),
                client_b.post(f"/api/assignments/{assignment.id}/end", headers=headers),
            )
        finally:
            await client_a.aclose()
            await client_b.aclose()

        for label, response in (("deactivate", deactivated), ("end", ended)):
            assert response.status_code < 500, (
                f"{label} answered {response.status_code} - a deadlock or "
                f"unhandled error rather than a decision: {response.text[:300]}"
            )
