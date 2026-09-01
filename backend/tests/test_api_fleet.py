"""Driver, truck and assignment CRUD over real HTTP."""

import uuid
from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import TripStatus, TruckStatus, UserRole
from app.models.fleet import DriverTruckAssignment
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


def driver_payload(**overrides: object) -> dict:
    payload = {
        "full_name": "Bipul Das",
        "initial_password": "driver-initial-pass",
        # The marker email is what lets cleanup find rows the API created.
        # Without it these users are invisible to cleanup, their assignments
        # survive, and RESTRICT then blocks every truck delete.
        "email": factories.unique_email("apidriver"),
        "phone": factories.unique_phone(),
        "licence_number": factories.unique_licence(),
        "licence_expiry": (date.today() + timedelta(days=400)).isoformat(),
    }
    payload.update(overrides)  # type: ignore[arg-type]
    return payload


def truck_payload(**overrides: object) -> dict:
    payload = {
        "registration_number": factories.unique_registration(),
        "max_capacity_kg": "16000.00",
    }
    payload.update(overrides)  # type: ignore[arg-type]
    return payload


class TestDriverCrud:
    async def test_create_returns_201_and_the_driver(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        r = await api.post("/api/drivers", headers=manager_headers, json=driver_payload())
        assert r.status_code == 201
        body = r.json()
        assert body["full_name"] == "Bipul Das"
        assert body["status"] == "AVAILABLE"

    async def test_create_never_echoes_the_initial_password(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        payload = driver_payload()
        r = await api.post("/api/drivers", headers=manager_headers, json=payload)
        assert payload["initial_password"] not in r.text

    async def test_created_driver_can_sign_in(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        """Proves the login and profile were created together."""
        payload = driver_payload()
        assert (
            await api.post("/api/drivers", headers=manager_headers, json=payload)
        ).status_code == 201

        login = await api.post(
            "/api/auth/login",
            json={
                "identifier": payload["phone"],
                "password": payload["initial_password"],
            },
        )
        assert login.status_code == 200
        assert login.json()["user"]["role"] == "DRIVER"

    async def test_duplicate_licence_is_409(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        first = driver_payload()
        await api.post("/api/drivers", headers=manager_headers, json=first)
        second = driver_payload(licence_number=first["licence_number"])
        r = await api.post("/api/drivers", headers=manager_headers, json=second)
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "LICENCE_EXISTS"

    async def test_duplicate_phone_is_409(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        first = driver_payload()
        await api.post("/api/drivers", headers=manager_headers, json=first)
        r = await api.post(
            "/api/drivers", headers=manager_headers, json=driver_payload(phone=first["phone"])
        )
        assert r.status_code == 409

    async def test_invalid_phone_is_422(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        r = await api.post(
            "/api/drivers", headers=manager_headers, json=driver_payload(phone="nope")
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "VALIDATION_ERROR"

    async def test_server_managed_field_rejected(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        r = await api.post(
            "/api/drivers",
            headers=manager_headers,
            json=driver_payload(id=str(uuid.uuid4())),
        )
        assert r.status_code == 422

    async def test_get_and_update(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        created = (
            await api.post("/api/drivers", headers=manager_headers, json=driver_payload())
        ).json()

        got = await api.get(f"/api/drivers/{created['id']}", headers=manager_headers)
        assert got.status_code == 200

        updated = await api.patch(
            f"/api/drivers/{created['id']}",
            headers=manager_headers,
            json={"full_name": "Bipul Kumar Das"},
        )
        assert updated.status_code == 200
        assert updated.json()["full_name"] == "Bipul Kumar Das"

    async def test_update_of_missing_driver_is_404(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        r = await api.patch(
            f"/api/drivers/{uuid.uuid4()}",
            headers=manager_headers,
            json={"full_name": "Nobody"},
        )
        assert r.status_code == 404

    async def test_deactivate_hides_the_driver_and_disables_login(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        payload = driver_payload()
        created = (
            await api.post("/api/drivers", headers=manager_headers, json=payload)
        ).json()

        r = await api.post(
            f"/api/drivers/{created['id']}/deactivate", headers=manager_headers
        )
        assert r.status_code == 200

        assert (
            await api.get(f"/api/drivers/{created['id']}", headers=manager_headers)
        ).status_code == 404

        login = await api.post(
            "/api/auth/login",
            json={
                "identifier": payload["phone"],
                "password": payload["initial_password"],
            },
        )
        assert login.status_code == 401

    async def test_list_is_paginated_with_a_bounded_page_size(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        for _ in range(3):
            await api.post("/api/drivers", headers=manager_headers, json=driver_payload())

        page = (
            await api.get("/api/drivers?limit=2", headers=manager_headers)
        ).json()
        assert len(page["items"]) == 2
        assert page["next_cursor"]

        second = (
            await api.get(
                f"/api/drivers?limit=2&cursor={page['next_cursor']}",
                headers=manager_headers,
            )
        ).json()
        first_ids = {i["id"] for i in page["items"]}
        second_ids = {i["id"] for i in second["items"]}
        assert not (first_ids & second_ids), "pages overlap - ordering is not total"

    async def test_oversized_limit_rejected(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        assert (
            await api.get("/api/drivers?limit=5000", headers=manager_headers)
        ).status_code == 422

    async def test_malformed_cursor_is_400_not_500(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        r = await api.get("/api/drivers?cursor=not-a-cursor", headers=manager_headers)
        assert r.status_code == 400
        assert r.json()["error"]["code"] == "INVALID_CURSOR"


class TestTruckCrud:
    async def test_create_normalises_registration(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        canonical = factories.unique_registration()
        messy = f"{canonical[:2]}-{canonical[2:4]}-{canonical[4:6]}-{canonical[6:]}".lower()
        r = await api.post(
            "/api/trucks",
            headers=manager_headers,
            json=truck_payload(registration_number=messy),
        )
        assert r.status_code == 201
        assert r.json()["registration_number"] == canonical

    async def test_duplicate_registration_is_409(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        payload = truck_payload()
        await api.post("/api/trucks", headers=manager_headers, json=payload)
        r = await api.post("/api/trucks", headers=manager_headers, json=payload)
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "REGISTRATION_EXISTS"

    async def test_duplicate_detected_regardless_of_formatting(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        """Normalisation happens before the uniqueness check."""
        canonical = factories.unique_registration()
        await api.post(
            "/api/trucks",
            headers=manager_headers,
            json=truck_payload(registration_number=canonical),
        )
        spaced = f"{canonical[:2]} {canonical[2:4]} {canonical[4:6]} {canonical[6:]}".lower()
        r = await api.post(
            "/api/trucks",
            headers=manager_headers,
            json=truck_payload(registration_number=spaced),
        )
        assert r.status_code == 409

    async def test_invalid_registration_is_422(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        r = await api.post(
            "/api/trucks",
            headers=manager_headers,
            json=truck_payload(registration_number="NOT A PLATE!"),
        )
        assert r.status_code == 422

    async def test_zero_capacity_is_422(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        r = await api.post(
            "/api/trucks", headers=manager_headers, json=truck_payload(max_capacity_kg="0")
        )
        assert r.status_code == 422

    async def test_current_load_cannot_be_set_by_a_client(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        """Otherwise a client could walk around the capacity gate."""
        created = (
            await api.post("/api/trucks", headers=manager_headers, json=truck_payload())
        ).json()
        r = await api.patch(
            f"/api/trucks/{created['id']}",
            headers=manager_headers,
            json={"current_load_kg": "99999"},
        )
        assert r.status_code == 422

    async def test_capacity_cannot_drop_below_current_load(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        """422, not 403: a safety limit no role may authorise around."""
        truck = await factories.make_truck(session, capacity=16000)
        truck.current_load_kg = 12000  # type: ignore[assignment]
        await session.commit()

        r = await api.patch(
            f"/api/trucks/{truck.id}",
            headers=manager_headers,
            json={"max_capacity_kg": "8000"},
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "CAPACITY_BELOW_CURRENT_LOAD"

    async def test_retire_then_absent_from_listing(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        created = (
            await api.post("/api/trucks", headers=manager_headers, json=truck_payload())
        ).json()
        assert (
            await api.post(f"/api/trucks/{created['id']}/retire", headers=manager_headers)
        ).status_code == 200
        assert (
            await api.get(f"/api/trucks/{created['id']}", headers=manager_headers)
        ).status_code == 404

    async def test_filter_by_status(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        await factories.make_truck(session, status=TruckStatus.MAINTENANCE)
        await factories.make_truck(session, status=TruckStatus.AVAILABLE)
        body = (
            await api.get("/api/trucks?truck_status=MAINTENANCE", headers=manager_headers)
        ).json()
        assert body["items"]
        assert all(i["status"] == "MAINTENANCE" for i in body["items"])


class TestAssignmentWorkflow:
    async def test_assign_driver_to_truck(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)

        r = await api.post(
            "/api/assignments",
            headers=manager_headers,
            json={"driver_id": str(driver.id), "truck_id": str(truck.id)},
        )
        assert r.status_code == 201
        assert r.json()["status"] == "ACTIVE"

    async def test_expired_licence_blocks_assignment(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        """A compliance fact - 422, since no role may override it."""
        driver, _ = await factories.make_driver(
            session, licence_expiry=date.today() - timedelta(days=1)
        )
        truck = await factories.make_truck(session)

        r = await api.post(
            "/api/assignments",
            headers=manager_headers,
            json={"driver_id": str(driver.id), "truck_id": str(truck.id)},
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "LICENCE_EXPIRED"

    async def test_retired_truck_cannot_be_assigned(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session, status=TruckStatus.BREAKDOWN)

        r = await api.post(
            "/api/assignments",
            headers=manager_headers,
            json={"driver_id": str(driver.id), "truck_id": str(truck.id)},
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "TRUCK_NOT_OPERATIONAL"

    async def test_missing_driver_is_404(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        truck = await factories.make_truck(session)
        r = await api.post(
            "/api/assignments",
            headers=manager_headers,
            json={"driver_id": str(uuid.uuid4()), "truck_id": str(truck.id)},
        )
        assert r.status_code == 404

    async def test_reassignment_ends_the_previous_assignment(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        """The one-active-assignment invariant, exercised through the API."""
        driver, _ = await factories.make_driver(session)
        first_truck = await factories.make_truck(session)
        second_truck = await factories.make_truck(session)

        first = (
            await api.post(
                "/api/assignments",
                headers=manager_headers,
                json={"driver_id": str(driver.id), "truck_id": str(first_truck.id)},
            )
        ).json()
        second = await api.post(
            "/api/assignments",
            headers=manager_headers,
            json={"driver_id": str(driver.id), "truck_id": str(second_truck.id)},
        )
        assert second.status_code == 201

        previous = (
            await api.get(f"/api/assignments/{first['id']}", headers=manager_headers)
        ).json()
        assert previous["status"] == "ENDED"
        assert previous["ended_at"] is not None

    async def test_reassigning_the_same_truck_is_409(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        body = {"driver_id": str(driver.id), "truck_id": str(truck.id)}

        await api.post("/api/assignments", headers=manager_headers, json=body)
        r = await api.post("/api/assignments", headers=manager_headers, json=body)
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "ASSIGNMENT_UNCHANGED"

    async def test_ending_an_assignment_sets_ended_at(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        """`POST /api/assignments/{id}/end` had no direct test until now.

        It is reached indirectly by reassignment (which ends the previous one),
        but the explicit manager-initiated end - its permission, its conflict
        behaviour and its effect on the current-assignment slot - was never
        exercised through the endpoint itself.
        """
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        created = (
            await api.post(
                "/api/assignments",
                headers=manager_headers,
                json={"driver_id": str(driver.id), "truck_id": str(truck.id)},
            )
        ).json()

        r = await api.post(
            f"/api/assignments/{created['id']}/end", headers=manager_headers
        )

        assert r.status_code == 200, r.text
        assert r.json()["status"] == "ENDED"
        assert r.json()["ended_at"] is not None

    async def test_ending_twice_is_409_not_a_silent_success(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        """Not idempotent, deliberately.

        A second end would write a second audit row and move `ended_at`,
        rewriting when the pairing actually stopped - which is evidence in an
        incident review.
        """
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        created = (
            await api.post(
                "/api/assignments",
                headers=manager_headers,
                json={"driver_id": str(driver.id), "truck_id": str(truck.id)},
            )
        ).json()
        await api.post(f"/api/assignments/{created['id']}/end", headers=manager_headers)

        again = await api.post(
            f"/api/assignments/{created['id']}/end", headers=manager_headers
        )

        assert again.status_code == 409
        assert again.json()["error"]["code"] == "ALREADY_ENDED"

    async def test_ending_an_unknown_assignment_is_404(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        r = await api.post(
            f"/api/assignments/{uuid.uuid4()}/end", headers=manager_headers
        )
        assert r.status_code == 404

    async def test_a_driver_may_not_end_an_assignment(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        """`assignment:end` is a manager/admin permission.

        A driver ending their own pairing would let them release themselves
        from a truck mid-shift with no manager involved.
        """
        driver, driver_user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        created = (
            await api.post(
                "/api/assignments",
                headers=manager_headers,
                json={"driver_id": str(driver.id), "truck_id": str(truck.id)},
            )
        ).json()
        driver_headers = await auth_headers(
            api, driver_user.phone, factories.TEST_PASSWORD
        )

        r = await api.post(
            f"/api/assignments/{created['id']}/end", headers=driver_headers
        )

        assert r.status_code == 403

    async def test_ending_frees_the_current_assignment_slot(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        """The partial unique index from migration 0006 permits one CURRENT
        assignment per driver. Ending must release that slot, or a driver whose
        pairing ended could never be assigned again."""
        driver, _ = await factories.make_driver(session)
        first_truck = await factories.make_truck(session)
        second_truck = await factories.make_truck(session)
        created = (
            await api.post(
                "/api/assignments",
                headers=manager_headers,
                json={"driver_id": str(driver.id), "truck_id": str(first_truck.id)},
            )
        ).json()
        await api.post(f"/api/assignments/{created['id']}/end", headers=manager_headers)

        r = await api.post(
            "/api/assignments",
            headers=manager_headers,
            json={"driver_id": str(driver.id), "truck_id": str(second_truck.id)},
        )

        assert r.status_code == 201, r.text
        assert r.json()["status"] == "ACTIVE"

    async def test_driver_verifies_own_assignment(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        driver, driver_user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = (
            await api.post(
                "/api/assignments",
                headers=manager_headers,
                json={"driver_id": str(driver.id), "truck_id": str(truck.id)},
            )
        ).json()

        driver_headers = await auth_headers(
            api, driver_user.phone, factories.TEST_PASSWORD
        )
        r = await api.post(
            f"/api/assignments/{assignment['id']}/verify",
            headers=driver_headers,
            json={
                "reported_registration": truck.registration_number,
                "reported_odometer_km": "184203.0",
                "reported_fuel_level_pct": 65,
            },
        )
        assert r.status_code == 200
        assert r.json()["mismatch_flagged"] is False
        assert r.json()["verified_at"] is not None

    async def test_registration_mismatch_flags_but_does_not_block(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        """A driver stranded at 04:00 over a typo is the worse outcome."""
        driver, driver_user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = (
            await api.post(
                "/api/assignments",
                headers=manager_headers,
                json={"driver_id": str(driver.id), "truck_id": str(truck.id)},
            )
        ).json()

        driver_headers = await auth_headers(
            api, driver_user.phone, factories.TEST_PASSWORD
        )
        r = await api.post(
            f"/api/assignments/{assignment['id']}/verify",
            headers=driver_headers,
            json={"reported_registration": "AS99XX0000"},
        )
        assert r.status_code == 200, "a mismatch must not block the driver"
        assert r.json()["mismatch_flagged"] is True
        assert r.json()["status"] == "PENDING_VERIFICATION"

    async def test_a_driver_cannot_verify_someone_elses_assignment(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        driver_a, _ = await factories.make_driver(session)
        _, user_b = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = (
            await api.post(
                "/api/assignments",
                headers=manager_headers,
                json={"driver_id": str(driver_a.id), "truck_id": str(truck.id)},
            )
        ).json()

        headers_b = await auth_headers(api, user_b.phone, factories.TEST_PASSWORD)
        r = await api.post(
            f"/api/assignments/{assignment['id']}/verify",
            headers=headers_b,
            json={"reported_registration": truck.registration_number},
        )
        assert r.status_code == 404  # not even visible to them


class TestAssignmentEndVersusLiveTrip:
    """A driver must not be released from a truck while a trip is still on it.

    The one-current-assignment invariant (migration 0006's partial unique
    indexes) says a driver holds one truck at a time. Ending an assignment
    frees that slot. If the assignment can be ended while its trip is still
    running, the invariant stops meaning anything: the driver is reassigned to
    a second truck while the fleet map still shows them executing a trip on the
    first. Both facts are then true in the database at once.

    There are TWO ways to reach it and both are covered here, because a guard
    on only one of them would be a fix in name only:

        1. POST /api/assignments/{id}/end        - explicit
        2. POST /api/assignments (reassignment)  - `create()` ends the driver's
           open assignments inline, so this reaches the same state in ONE call
           and without anyone naming the word "end"

    "Live" means the trip has STARTED and has not finished -
    `app/domain/trip_state.py::COMMITS_DRIVER_TO_TRUCK`
    (ACTIVE, DELAYED, INCIDENT, DELIVERED).

    The boundary is deliberate and sits at ACTIVE, not at "non-terminal":

      before ACTIVE  DRAFT / ASSIGNED / VERIFICATION_PENDING / MANAGER_REVIEW
                     mean the driver has not started. Moving a driver at the
                     planning stage is ordinary dispatch work and must stay
                     allowed, or a mis-planned trip would pin a driver to a
                     truck until someone cancelled it.

      ACTIVE onward  the driver is with that truck. DELIVERED is included
                     because the trip is not closed yet and the pairing is
                     still the record of who was driving what.

    The escape hatch is the ordinary one: close or cancel the trip first.
    """

    async def _driver_on_a_trip(self, api, manager_headers, session, status):
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        created = (
            await api.post(
                "/api/assignments",
                headers=manager_headers,
                json={"driver_id": str(driver.id), "truck_id": str(truck.id)},
            )
        ).json()
        assignment = await session.get(
            DriverTruckAssignment, uuid.UUID(created["id"])
        )
        trip = await factories.make_trip(
            session, driver, truck, assignment=assignment, status=status
        )
        return driver, truck, created, trip

    async def test_an_active_trip_blocks_ending_its_assignment(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        driver, truck, created, trip = await self._driver_on_a_trip(
            api, manager_headers, session, TripStatus.ACTIVE
        )

        r = await api.post(
            f"/api/assignments/{created['id']}/end", headers=manager_headers
        )

        assert r.status_code == 409, r.text
        assert r.json()["error"]["code"] == "ASSIGNMENT_HAS_LIVE_TRIP"

        still = (
            await api.get(f"/api/assignments/{created['id']}", headers=manager_headers)
        ).json()
        assert still["status"] == "ACTIVE", "the assignment was ended anyway"
        assert still["ended_at"] is None

        trip_after = (
            await api.get(f"/api/trips/{trip.id}", headers=manager_headers)
        ).json()
        assert trip_after["status"] == TripStatus.ACTIVE.value

    async def test_a_refused_end_does_not_free_the_driver_for_a_second_truck(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        """The consequence the guard exists to prevent."""
        driver, _truck, created, _trip = await self._driver_on_a_trip(
            api, manager_headers, session, TripStatus.ACTIVE
        )
        await api.post(f"/api/assignments/{created['id']}/end", headers=manager_headers)

        second_truck = await factories.make_truck(session)
        r = await api.post(
            "/api/assignments",
            headers=manager_headers,
            json={"driver_id": str(driver.id), "truck_id": str(second_truck.id)},
        )

        assert r.status_code == 409, (
            "the driver was paired to a second truck while still executing a "
            f"trip on the first (got {r.status_code})"
        )
        assert r.json()["error"]["code"] == "ASSIGNMENT_HAS_LIVE_TRIP"

    async def test_reassignment_cannot_end_a_live_assignment_in_one_call(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        """The second path, which never mentions "end" at all.

        `create()` ends the driver's open assignments inline. Without a guard
        there, blocking the explicit endpoint would only make the bypass
        shorter.
        """
        driver, _truck, _created, _trip = await self._driver_on_a_trip(
            api, manager_headers, session, TripStatus.ACTIVE
        )
        second_truck = await factories.make_truck(session)

        r = await api.post(
            "/api/assignments",
            headers=manager_headers,
            json={"driver_id": str(driver.id), "truck_id": str(second_truck.id)},
        )

        assert r.status_code == 409, r.text
        assert r.json()["error"]["code"] == "ASSIGNMENT_HAS_LIVE_TRIP"

    async def test_a_closed_trip_does_not_block_ending(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        """The guard must not make assignments impossible to close after the
        work is legitimately finished."""
        _driver, _truck, created, _trip = await self._driver_on_a_trip(
            api, manager_headers, session, TripStatus.CLOSED
        )

        r = await api.post(
            f"/api/assignments/{created['id']}/end", headers=manager_headers
        )

        assert r.status_code == 200, r.text
        assert r.json()["status"] == "ENDED"

    async def test_a_cancelled_trip_does_not_block_ending(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        _driver, _truck, created, _trip = await self._driver_on_a_trip(
            api, manager_headers, session, TripStatus.CANCELLED
        )

        r = await api.post(
            f"/api/assignments/{created['id']}/end", headers=manager_headers
        )

        assert r.status_code == 200, r.text
        assert r.json()["status"] == "ENDED"

    async def test_a_delivered_but_unclosed_trip_still_blocks(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        """DELIVERED is not terminal. The paperwork is not done, the trip still
        references the pairing, and CLOSED is one ordinary call away."""
        _driver, _truck, created, _trip = await self._driver_on_a_trip(
            api, manager_headers, session, TripStatus.DELIVERED
        )

        r = await api.post(
            f"/api/assignments/{created['id']}/end", headers=manager_headers
        )

        assert r.status_code == 409, r.text
        assert r.json()["error"]["code"] == "ASSIGNMENT_HAS_LIVE_TRIP"

    async def test_a_planned_but_unstarted_trip_does_not_block_reassignment(
        self, api: AsyncClient, manager_headers: dict, session: AsyncSession
    ) -> None:
        """The other side of the boundary, pinned so it cannot drift.

        A trip that is merely ASSIGNED has not started. Blocking reassignment
        here would mean a trip planned onto the wrong truck pins the driver
        until a manager cancels it - a worse failure than the one being fixed.
        """
        driver, _truck, _created, _trip = await self._driver_on_a_trip(
            api, manager_headers, session, TripStatus.ASSIGNED
        )
        second_truck = await factories.make_truck(session)

        r = await api.post(
            "/api/assignments",
            headers=manager_headers,
            json={"driver_id": str(driver.id), "truck_id": str(second_truck.id)},
        )

        assert r.status_code == 201, r.text
