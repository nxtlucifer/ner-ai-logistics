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

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import AssignmentStatus, UserRole
from app.models.fleet import DriverTruckAssignment
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
        uq_active_assignment_truck, and asserted directly here.
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
