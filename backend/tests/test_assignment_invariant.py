"""One current assignment per driver, and per truck.

A regression suite for a defect that survived P3 and P4 and only became unsafe
in P5.

The invariant was written as "at most one ACTIVE assignment", in both the
service pre-check and the partial unique indexes. But ACTIVE is not the only
status in which a driver holds a truck: a reported registration mismatch moves
the assignment to PENDING_VERIFICATION and the driver keeps driving - that is
deliberate, a mismatch must never strand anyone. So a reassignment slipped past
the pending row and left one driver holding two trucks, with nothing objecting.

P5 made it dangerous rather than merely untidy: `open_assignment_for()` accepts
either status, so a trip on the abandoned truck stayed startable by a driver who
had been moved to a different one.

These tests pin the fix at both levels. The service check produces a clear
message; the DATABASE is the authority, because a SELECT-then-INSERT pre-check
cannot survive two concurrent requests.
"""

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import AssignmentStatus, TripStatus, UserRole
from app.models.fleet import DriverTruckAssignment
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

OPEN = (AssignmentStatus.ACTIVE, AssignmentStatus.PENDING_VERIFICATION)


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


async def _open_assignments(session: AsyncSession, driver_id) -> list:
    return list(
        (
            await session.execute(
                select(DriverTruckAssignment).where(
                    DriverTruckAssignment.driver_id == driver_id,
                    DriverTruckAssignment.status.in_(OPEN),
                )
            )
        )
        .scalars()
        .all()
    )


class TestPendingVerificationCountsAsCurrent:
    async def test_reassignment_ends_an_assignment_awaiting_review(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """The exact sequence that produced two current assignments."""
        driver, user = await factories.make_driver(session)
        truck_a = await factories.make_truck(session)
        truck_b = await factories.make_truck(session)

        first = await api.post(
            "/api/assignments",
            headers=manager_headers,
            json={"driver_id": str(driver.id), "truck_id": str(truck_a.id)},
        )
        assert first.status_code == 201

        # A mismatch flags for review and leaves the driver holding truck A.
        drv = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        verified = await api.post(
            "/api/driver/me/assignment/verify",
            headers=drv,
            json={"reported_registration": "AS99XX0000"},
        )
        assert verified.status_code == 200
        assert verified.json()["assignment"]["status"] == "PENDING_VERIFICATION"

        second = await api.post(
            "/api/assignments",
            headers=manager_headers,
            json={"driver_id": str(driver.id), "truck_id": str(truck_b.id)},
        )
        assert second.status_code == 201, second.text

        rows = await _open_assignments(session, driver.id)
        assert len(rows) == 1, (
            "driver holds "
            f"{[(str(r.truck_id), r.status.value) for r in rows]}"
        )
        assert rows[0].truck_id == truck_b.id

    async def test_reassigning_the_same_truck_while_pending_is_a_conflict(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """The driver already holds it; re-issuing is a no-op, not a new row."""
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        body = {"driver_id": str(driver.id), "truck_id": str(truck.id)}

        await api.post("/api/assignments", headers=manager_headers, json=body)
        drv = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        await api.post(
            "/api/driver/me/assignment/verify",
            headers=drv,
            json={"reported_registration": "AS99XX0000"},
        )

        again = await api.post(
            "/api/assignments", headers=manager_headers, json=body
        )
        assert again.status_code == 409
        assert again.json()["error"]["code"] == "ASSIGNMENT_UNCHANGED"
        assert len(await _open_assignments(session, driver.id)) == 1

    async def test_a_truck_awaiting_review_is_released_to_a_new_driver(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """The same hole existed per-truck, not only per-driver."""
        driver_a, user_a = await factories.make_driver(session)
        driver_b, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)

        await api.post(
            "/api/assignments",
            headers=manager_headers,
            json={"driver_id": str(driver_a.id), "truck_id": str(truck.id)},
        )
        drv = await auth_headers(api, user_a.phone, factories.TEST_PASSWORD)
        await api.post(
            "/api/driver/me/assignment/verify",
            headers=drv,
            json={"reported_registration": "AS99XX0000"},
        )

        moved = await api.post(
            "/api/assignments",
            headers=manager_headers,
            json={"driver_id": str(driver_b.id), "truck_id": str(truck.id)},
        )
        assert moved.status_code == 201, moved.text

        holders = list(
            (
                await session.execute(
                    select(DriverTruckAssignment).where(
                        DriverTruckAssignment.truck_id == truck.id,
                        DriverTruckAssignment.status.in_(OPEN),
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(holders) == 1
        assert holders[0].driver_id == driver_b.id


class TestTheDatabaseIsTheAuthority:
    async def test_the_index_refuses_a_second_current_row_for_a_driver(
        self, session: AsyncSession
    ) -> None:
        """Proven by writing straight past the service layer.

        The service pre-check produces a good error message; it is not the
        guarantee. Two concurrent requests both pass a pre-check, so the index
        has to be the thing that says no.
        """
        driver, _ = await factories.make_driver(session)
        truck_a = await factories.make_truck(session)
        truck_b = await factories.make_truck(session)

        session.add(
            DriverTruckAssignment(
                driver_id=driver.id,
                truck_id=truck_a.id,
                status=AssignmentStatus.PENDING_VERIFICATION,
            )
        )
        await session.commit()

        session.add(
            DriverTruckAssignment(
                driver_id=driver.id,
                truck_id=truck_b.id,
                status=AssignmentStatus.ACTIVE,
            )
        )
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()

    async def test_the_index_refuses_a_second_current_row_for_a_truck(
        self, session: AsyncSession
    ) -> None:
        driver_a, _ = await factories.make_driver(session)
        driver_b, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)

        session.add(
            DriverTruckAssignment(
                driver_id=driver_a.id,
                truck_id=truck.id,
                status=AssignmentStatus.PENDING_VERIFICATION,
            )
        )
        await session.commit()

        session.add(
            DriverTruckAssignment(
                driver_id=driver_b.id,
                truck_id=truck.id,
                status=AssignmentStatus.ACTIVE,
            )
        )
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()

    async def test_an_ended_assignment_does_not_occupy_the_slot(
        self, session: AsyncSession
    ) -> None:
        """History is retained in the same table, so ENDED must be excluded."""
        driver, _ = await factories.make_driver(session)
        truck_a = await factories.make_truck(session)
        truck_b = await factories.make_truck(session)

        session.add(
            DriverTruckAssignment(
                driver_id=driver.id,
                truck_id=truck_a.id,
                status=AssignmentStatus.ENDED,
            )
        )
        session.add(
            DriverTruckAssignment(
                driver_id=driver.id,
                truck_id=truck_b.id,
                status=AssignmentStatus.ACTIVE,
            )
        )
        await session.commit()  # must not raise

        assert len(await _open_assignments(session, driver.id)) == 1

    async def test_the_index_predicate_covers_both_current_statuses(
        self, session: AsyncSession
    ) -> None:
        """Reads the predicate out of PostgreSQL rather than trusting the model."""
        rows = (
            await session.execute(
                text(
                    "SELECT indexname, indexdef FROM pg_indexes "
                    "WHERE tablename = 'driver_truck_assignments' "
                    "AND indexname LIKE 'uq_current_assignment_%'"
                )
            )
        ).all()
        assert len(rows) == 2, f"expected two current-assignment indexes, got {rows}"
        for _, definition in rows:
            assert "ACTIVE" in definition
            assert "PENDING_VERIFICATION" in definition, (
                f"index predicate still excludes pending review: {definition}"
            )


class TestConcurrency:
    async def test_simultaneous_assignments_cannot_both_win(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """Two managers assigning the same driver at the same moment."""
        from app.main import create_app

        driver, _ = await factories.make_driver(session)
        trucks = [await factories.make_truck(session) for _ in range(3)]
        clients = [
            AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://t")
            for _ in range(3)
        ]

        try:
            responses = await asyncio.gather(
                *(
                    c.post(
                        "/api/assignments",
                        headers=manager_headers,
                        json={
                            "driver_id": str(driver.id),
                            "truck_id": str(truck.id),
                        },
                    )
                    for c, truck in zip(clients, trucks, strict=True)
                ),
                return_exceptions=True,
            )
        finally:
            for c in clients:
                await c.aclose()

        codes = [getattr(r, "status_code", 500) for r in responses]
        assert all(c in (201, 409) for c in codes), codes
        assert 201 in codes

        rows = await _open_assignments(session, driver.id)
        assert len(rows) == 1, (
            f"{len(rows)} current assignments survived a race: "
            f"{[(str(r.truck_id), r.status.value) for r in rows]}"
        )


class TestP5SafetyConsequence:
    async def test_a_trip_on_a_reassigned_truck_can_no_longer_be_started(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """Why this stopped being cosmetic.

        `open_assignment_for()` accepts either current status. While a stale
        PENDING_VERIFICATION row survived a reassignment, the start gate would
        find it and confirm a valid assignment for a truck the driver had been
        moved off - so a trip on that truck stayed startable.
        """
        driver, user = await factories.make_driver(session)
        truck_a = await factories.make_truck(session)
        truck_b = await factories.make_truck(session)

        await api.post(
            "/api/assignments",
            headers=manager_headers,
            json={"driver_id": str(driver.id), "truck_id": str(truck_a.id)},
        )
        drv = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        await api.post(
            "/api/driver/me/assignment/verify",
            headers=drv,
            json={"reported_registration": "AS99XX0000"},
        )

        # A trip planned on truck A, which the driver is about to be moved off.
        trip_a = await factories.make_trip(
            session, driver, truck_a, status=TripStatus.ASSIGNED
        )

        await api.post(
            "/api/assignments",
            headers=manager_headers,
            json={"driver_id": str(driver.id), "truck_id": str(truck_b.id)},
        )

        response = await api.post(
            "/api/driver/me/trip/start",
            headers=drv,
            json={"trip_id": str(trip_a.id)},
        )
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "NO_ACTIVE_ASSIGNMENT"

        await session.refresh(trip_a)
        assert trip_a.status is TripStatus.ASSIGNED, (
            "a trip was started on a truck the driver had been reassigned off"
        )
