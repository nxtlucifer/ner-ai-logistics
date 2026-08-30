"""Driver identity, current assignment and verification.

The security question this file answers: can a driver, holding a perfectly valid
token, act on anything that is not theirs? Every route under /api/driver takes
its subject from the token, so the tests probe every parameter an attacker could
try to bend.
"""

import asyncio
import uuid
from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.enums import AssignmentStatus, DriverStatus, TruckStatus, UserRole
from app.models.fleet import DriverTruckAssignment
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


async def _assign(
    session: AsyncSession, driver, truck, status=AssignmentStatus.ACTIVE
) -> DriverTruckAssignment:
    assignment = DriverTruckAssignment(
        driver_id=driver.id, truck_id=truck.id, status=status
    )
    session.add(assignment)
    await session.commit()
    await session.refresh(assignment)
    return assignment


async def _driver_client(api: AsyncClient, user) -> dict:
    return await auth_headers(api, user.phone, factories.TEST_PASSWORD)


# --- Identity binding -----------------------------------------------------


class TestDriverIdentity:
    async def test_driver_resolves_to_own_profile(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        driver, user = await factories.make_driver(session)
        headers = await _driver_client(api, user)

        r = await api.get("/api/driver/me", headers=headers)
        assert r.status_code == 200
        assert r.json()["id"] == str(driver.id)

    async def test_profile_never_exposes_salary(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Admin-only data must not reach a device shared around a depot."""
        _, user = await factories.make_driver(session)
        headers = await _driver_client(api, user)
        body = (await api.get("/api/driver/me", headers=headers)).text
        assert "salary" not in body.lower()

    async def test_manager_cannot_use_driver_endpoints(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A manager has no driver profile; the endpoint must fail closed."""
        manager = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)

        for path in ("/api/driver/me", "/api/driver/me/assignment"):
            r = await api.get(path, headers=headers)
            assert r.status_code == 403, path

    async def test_driver_user_without_profile_fails_closed(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A DRIVER-role user with no drivers row gets 403, not a 500."""
        user = await factories.make_user(
            session, role=UserRole.DRIVER, phone=factories.unique_phone()
        )
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)

        r = await api.get("/api/driver/me", headers=headers)
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "FORBIDDEN"

    async def test_suspended_driver_fails_closed(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        driver, user = await factories.make_driver(session)
        headers = await _driver_client(api, user)
        assert (await api.get("/api/driver/me", headers=headers)).status_code == 200

        driver.status = DriverStatus.SUSPENDED
        await session.commit()

        assert (await api.get("/api/driver/me", headers=headers)).status_code == 403

    async def test_soft_deleted_driver_fails_closed(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        from datetime import UTC, datetime

        driver, user = await factories.make_driver(session)
        headers = await _driver_client(api, user)

        driver.deleted_at = datetime.now(UTC)
        await session.commit()

        assert (await api.get("/api/driver/me", headers=headers)).status_code == 403

    async def test_anonymous_rejected(self, api: AsyncClient) -> None:
        for path in ("/api/driver/me", "/api/driver/me/assignment"):
            assert (await api.get(path)).status_code == 401


# --- Current assignment ---------------------------------------------------


class TestCurrentAssignment:
    async def test_no_assignment_is_null_not_404(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Unassigned is a normal state the app renders, not an error."""
        _, user = await factories.make_driver(session)
        headers = await _driver_client(api, user)

        r = await api.get("/api/driver/me/assignment", headers=headers)
        assert r.status_code == 200
        assert r.json() is None

    async def test_returns_own_assignment_with_truck(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await _assign(session, driver, truck)

        headers = await _driver_client(api, user)
        body = (await api.get("/api/driver/me/assignment", headers=headers)).json()

        assert body["id"] == str(assignment.id)
        assert body["truck"]["registration_number"] == truck.registration_number
        assert body["verified_at"] is None

    async def test_never_leaks_another_drivers_assignment(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Driver B has an assignment; driver A must see nothing."""
        driver_b, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        await _assign(session, driver_b, truck)

        _, user_a = await factories.make_driver(session)
        headers = await _driver_client(api, user_a)

        assert (
            await api.get("/api/driver/me/assignment", headers=headers)
        ).json() is None

    async def test_ended_assignment_is_not_returned(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        await _assign(session, driver, truck, status=AssignmentStatus.ENDED)

        headers = await _driver_client(api, user)
        assert (
            await api.get("/api/driver/me/assignment", headers=headers)
        ).json() is None

    async def test_response_contains_no_manager_metadata(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        await _assign(session, driver, truck)

        headers = await _driver_client(api, user)
        body = (await api.get("/api/driver/me/assignment", headers=headers)).text

        for leaked in ("assigned_by", "manager_review_note", "salary", "password"):
            assert leaked not in body, f"{leaked} leaked to the driver app"


# --- Verification ---------------------------------------------------------


class TestVerification:
    async def _setup(self, api: AsyncClient, session: AsyncSession):
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await _assign(session, driver, truck)
        headers = await _driver_client(api, user)
        return driver, user, truck, assignment, headers

    async def test_matching_registration_verifies(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, _, truck, _, headers = await self._setup(api, session)

        r = await api.post(
            "/api/driver/me/assignment/verify",
            headers=headers,
            json={
                "reported_registration": truck.registration_number,
                "reported_odometer_km": "184203.0",
                "reported_fuel_level_pct": 65,
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["already_verified"] is False
        assert body["assignment"]["verified_at"] is not None
        assert body["assignment"]["mismatch_flagged"] is False
        assert body["assignment"]["status"] == "ACTIVE"

    async def test_mismatch_flags_but_does_not_block(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A driver stranded at 04:00 over a typo is the worse outcome."""
        _, _, _, _, headers = await self._setup(api, session)

        r = await api.post(
            "/api/driver/me/assignment/verify",
            headers=headers,
            json={"reported_registration": "AS99XX0000"},
        )
        assert r.status_code == 200, "a mismatch must never block the driver"
        assert r.json()["assignment"]["mismatch_flagged"] is True
        assert r.json()["assignment"]["status"] == "PENDING_VERIFICATION"

    async def test_registration_normalised_before_comparison(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Spacing and case must not create a false mismatch."""
        _, _, truck, _, headers = await self._setup(api, session)
        messy = f"{truck.registration_number[:4]}-{truck.registration_number[4:]}".lower()

        r = await api.post(
            "/api/driver/me/assignment/verify",
            headers=headers,
            json={"reported_registration": messy},
        )
        assert r.json()["assignment"]["mismatch_flagged"] is False

    async def test_repeat_with_same_readings_is_idempotent(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A retry after a lost response must succeed, not 409.

        The driver app runs on an unreliable network; a retry that returns an
        unrecoverable conflict would strand the driver.
        """
        _, _, truck, _, headers = await self._setup(api, session)
        payload = {
            "reported_registration": truck.registration_number,
            "reported_odometer_km": "184203.0",
            "reported_fuel_level_pct": 65,
        }

        first = await api.post(
            "/api/driver/me/assignment/verify", headers=headers, json=payload
        )
        assert first.status_code == 200
        assert first.json()["already_verified"] is False

        retry = await api.post(
            "/api/driver/me/assignment/verify", headers=headers, json=payload
        )
        assert retry.status_code == 200
        assert retry.json()["already_verified"] is True
        assert (
            retry.json()["assignment"]["verified_at"]
            == first.json()["assignment"]["verified_at"]
        ), "a retry must not move the verification timestamp"

    async def test_retry_below_stored_precision_is_still_idempotent(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A retry must not be called a correction by a rounding artefact.

        `reported_odometer_km` is NUMERIC(10,1). Submitting 184203.05 stores
        184203.1. Comparing the retry's raw submission against the stored value
        made an identical resend look like a changed reading and answered 409 -
        stranding the driver in exactly the case idempotency exists to prevent.
        """
        _, _, truck, _, headers = await self._setup(api, session)
        payload = {
            "reported_registration": truck.registration_number,
            "reported_odometer_km": "184203.05",
            "reported_fuel_level_pct": 65,
        }

        first = await api.post(
            "/api/driver/me/assignment/verify", headers=headers, json=payload
        )
        assert first.status_code == 200, first.text
        assert first.json()["already_verified"] is False

        retry = await api.post(
            "/api/driver/me/assignment/verify", headers=headers, json=payload
        )
        assert retry.status_code == 200, retry.text
        assert retry.json()["already_verified"] is True

    async def test_repeat_with_different_readings_is_409(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A correction is a manager review, never a silent overwrite."""
        _, _, truck, _, headers = await self._setup(api, session)
        await api.post(
            "/api/driver/me/assignment/verify",
            headers=headers,
            json={
                "reported_registration": truck.registration_number,
                "reported_odometer_km": "184203.0",
            },
        )
        r = await api.post(
            "/api/driver/me/assignment/verify",
            headers=headers,
            json={
                "reported_registration": truck.registration_number,
                "reported_odometer_km": "999999.0",
            },
        )
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "ALREADY_VERIFIED"

    async def test_verify_without_assignment_is_404(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, user = await factories.make_driver(session)
        headers = await _driver_client(api, user)

        r = await api.post(
            "/api/driver/me/assignment/verify", headers=headers, json={}
        )
        assert r.status_code == 404

    async def test_stale_assignment_id_is_rejected(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The app was showing an assignment the manager has since replaced."""
        _, _, truck, _, headers = await self._setup(api, session)

        r = await api.post(
            "/api/driver/me/assignment/verify",
            headers=headers,
            json={
                "assignment_id": str(uuid.uuid4()),
                "reported_registration": truck.registration_number,
            },
        )
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "ASSIGNMENT_SUPERSEDED"

    async def test_broken_down_truck_cannot_be_verified(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, _, truck, _, headers = await self._setup(api, session)
        truck.status = TruckStatus.BREAKDOWN
        await session.commit()

        r = await api.post(
            "/api/driver/me/assignment/verify",
            headers=headers,
            json={"reported_registration": truck.registration_number},
        )
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "TRUCK_NOT_OPERATIONAL"

    async def test_impossible_fuel_reading_rejected(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, _, truck, _, headers = await self._setup(api, session)
        r = await api.post(
            "/api/driver/me/assignment/verify",
            headers=headers,
            json={"reported_fuel_level_pct": 150},
        )
        assert r.status_code == 422


# --- The id-addressed alias ----------------------------------------------


class TestIdAddressedAlias:
    """`POST /api/assignments/{id}/verify` must be the same operation.

    It briefly had its own implementation, and the two had already drifted: the
    alias accepted a repeat as a flat 409 with no idempotent retry, and never
    checked that the truck was still operational. These tests pin the two paths
    together so a guard cannot again exist on only one of them.
    """

    async def _setup(self, api: AsyncClient, session: AsyncSession):
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await _assign(session, driver, truck)
        headers = await _driver_client(api, user)
        return driver, truck, assignment, headers

    async def test_alias_retry_is_idempotent_not_conflict(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, truck, assignment, headers = await self._setup(api, session)
        payload = {
            "reported_registration": truck.registration_number,
            "reported_odometer_km": "184203.0",
        }
        path = f"/api/assignments/{assignment.id}/verify"

        assert (await api.post(path, headers=headers, json=payload)).status_code == 200
        retry = await api.post(path, headers=headers, json=payload)
        assert retry.status_code == 200, "the alias lost the idempotent retry"

    async def test_alias_enforces_the_truck_operational_gate(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, truck, assignment, headers = await self._setup(api, session)
        truck.status = TruckStatus.BREAKDOWN
        await session.commit()

        r = await api.post(
            f"/api/assignments/{assignment.id}/verify",
            headers=headers,
            json={"reported_registration": truck.registration_number},
        )
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "TRUCK_NOT_OPERATIONAL"

    async def test_alias_cannot_redirect_to_another_drivers_assignment(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Driver A has their own assignment and puts B's id in the path."""
        driver_b, _ = await factories.make_driver(session)
        truck_b = await factories.make_truck(session)
        b_assignment = await _assign(session, driver_b, truck_b)

        _, truck_a, _, headers_a = await self._setup(api, session)

        r = await api.post(
            f"/api/assignments/{b_assignment.id}/verify",
            headers=headers_a,
            json={"reported_registration": truck_a.registration_number},
        )
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "ASSIGNMENT_SUPERSEDED"

        await session.refresh(b_assignment)
        assert b_assignment.verified_at is None


# --- IDOR and impersonation ----------------------------------------------


class TestIdorAndImpersonation:
    async def test_driver_cannot_verify_another_drivers_assignment(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The central P4 negative proof.

        Driver B holds the truck. Driver A, with a valid token and B's exact
        assignment id, must not touch it.
        """
        driver_b, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        b_assignment = await _assign(session, driver_b, truck)

        _, user_a = await factories.make_driver(session)
        headers_a = await _driver_client(api, user_a)

        r = await api.post(
            "/api/driver/me/assignment/verify",
            headers=headers_a,
            json={
                "assignment_id": str(b_assignment.id),
                "reported_registration": truck.registration_number,
            },
        )
        # Driver A has no assignment of their own, so there is nothing to act on.
        assert r.status_code == 404

        await session.refresh(b_assignment)
        assert b_assignment.verified_at is None, (
            "driver A verified driver B's assignment - horizontal privilege "
            "escalation"
        )

    async def test_assignment_id_of_another_driver_cannot_redirect_verification(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Driver A HAS an assignment and sends driver B's id.

        The subject comes from the token, so B's id can only ever cause a
        rejection - never a write to B's row.
        """
        driver_b, _ = await factories.make_driver(session)
        truck_b = await factories.make_truck(session)
        b_assignment = await _assign(session, driver_b, truck_b)

        driver_a, user_a = await factories.make_driver(session)
        truck_a = await factories.make_truck(session)
        await _assign(session, driver_a, truck_a)
        headers_a = await _driver_client(api, user_a)

        r = await api.post(
            "/api/driver/me/assignment/verify",
            headers=headers_a,
            json={
                "assignment_id": str(b_assignment.id),
                "reported_registration": truck_b.registration_number,
            },
        )
        assert r.status_code == 409

        await session.refresh(b_assignment)
        assert b_assignment.verified_at is None

    async def test_driver_id_in_body_is_rejected(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """extra=forbid means an impersonation attempt is a 422, not ignored."""
        driver_b, _ = await factories.make_driver(session)
        _, user_a = await factories.make_driver(session)
        headers_a = await _driver_client(api, user_a)

        r = await api.post(
            "/api/driver/me/assignment/verify",
            headers=headers_a,
            json={"driver_id": str(driver_b.id)},
        )
        assert r.status_code == 422

    async def test_role_in_body_cannot_escalate(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, user = await factories.make_driver(session)
        headers = await _driver_client(api, user)
        r = await api.post(
            "/api/driver/me/assignment/verify",
            headers=headers,
            json={"role": "ADMIN"},
        )
        assert r.status_code == 422

    async def test_expired_token_cannot_verify(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        from app.core.security import create_access_token

        _, user = await factories.make_driver(session)
        token, _ = create_access_token(
            user_id=user.id, role="DRIVER", expires_delta=timedelta(seconds=-60)
        )
        r = await api.post(
            "/api/driver/me/assignment/verify",
            headers={"Authorization": f"Bearer {token}"},
            json={},
        )
        assert r.status_code == 401

    async def test_tampered_token_cannot_verify(self, api: AsyncClient) -> None:
        r = await api.post(
            "/api/driver/me/assignment/verify",
            headers={"Authorization": "Bearer not.a.real.token"},
            json={},
        )
        assert r.status_code == 401


# --- Concurrency ----------------------------------------------------------


class TestVerificationConcurrency:
    async def test_two_devices_verifying_at_once_leaves_one_state(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A driver with the app open on two devices must not corrupt the row."""
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await _assign(session, driver, truck)
        headers = await _driver_client(api, user)

        from app.main import create_app

        clients = [
            AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://t")
            for _ in range(3)
        ]
        payload = {
            "reported_registration": truck.registration_number,
            "reported_odometer_km": "184203.0",
        }
        try:
            responses = await asyncio.gather(
                *(
                    c.post(
                        "/api/driver/me/assignment/verify",
                        headers=headers,
                        json=payload,
                    )
                    for c in clients
                ),
                return_exceptions=True,
            )
        finally:
            for c in clients:
                await c.aclose()

        codes = [r.status_code if hasattr(r, "status_code") else 500 for r in responses]
        assert all(c in (200, 409) for c in codes), f"unexpected codes: {codes}"
        assert 200 in codes

        await session.refresh(assignment)
        assert assignment.verified_at is not None
        assert assignment.mismatch_flagged is False

    async def test_reassignment_during_verification_is_deterministic(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Manager reassigns; the driver's stale screen must not verify the old row."""
        driver, user = await factories.make_driver(session)
        old_truck = await factories.make_truck(session)
        old = await _assign(session, driver, old_truck)
        headers = await _driver_client(api, user)

        # Manager moves the driver to a different truck.
        old.status = AssignmentStatus.ENDED
        new_truck = await factories.make_truck(session)
        await session.commit()
        new = await _assign(session, driver, new_truck)

        r = await api.post(
            "/api/driver/me/assignment/verify",
            headers=headers,
            json={
                "assignment_id": str(old.id),
                "reported_registration": old_truck.registration_number,
            },
        )
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "ASSIGNMENT_SUPERSEDED"

        await session.refresh(old)
        assert old.verified_at is None
        await session.refresh(new)
        assert new.verified_at is None


# --- Audit ----------------------------------------------------------------


class TestVerificationAudit:
    async def test_verification_is_audited_with_actor(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await _assign(session, driver, truck)
        headers = await _driver_client(api, user)

        await api.post(
            "/api/driver/me/assignment/verify",
            headers=headers,
            json={"reported_registration": truck.registration_number},
        )

        rows = list(
            (
                await session.execute(
                    select(AuditLog).where(
                        AuditLog.entity_type == "driver_truck_assignments",
                        AuditLog.entity_id == assignment.id,
                    )
                )
            ).scalars().all()
        )
        assert rows, "verification produced no audit record"
        entry = rows[-1]
        assert entry.actor_user_id == user.id, "audit did not record WHO verified"
        assert entry.after is not None and entry.after["verified_at"] is not None
        assert entry.reason and "verified" in entry.reason

    async def test_audit_contains_no_credentials(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await _assign(session, driver, truck)
        headers = await _driver_client(api, user)

        await api.post(
            "/api/driver/me/assignment/verify",
            headers=headers,
            json={"reported_registration": truck.registration_number},
        )

        rows = list(
            (
                await session.execute(
                    select(AuditLog).where(AuditLog.entity_id == assignment.id)
                )
            ).scalars().all()
        )
        for entry in rows:
            blob = f"{entry.before} {entry.after} {entry.reason}"
            assert factories.TEST_PASSWORD not in blob
            assert "Bearer" not in blob
            assert "argon2" not in blob.lower()
