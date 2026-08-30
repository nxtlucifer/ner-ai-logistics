"""Audit logging: coverage, immutability and the absence of secrets."""

import uuid
from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.enums import AuditAction, UserRole
from app.services.audit import REDACTED_PLACEHOLDER, scrub
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


async def _entries(
    session: AsyncSession, entity_type: str, entity_id: uuid.UUID
) -> list[AuditLog]:
    return list(
        (
            await session.execute(
                select(AuditLog).where(
                    AuditLog.entity_type == entity_type,
                    AuditLog.entity_id == entity_id,
                )
            )
        ).scalars().all()
    )


@pytest.fixture
async def manager(api: AsyncClient, session: AsyncSession):
    user = await factories.make_user(session, role=UserRole.MANAGER)
    headers = await auth_headers(api, user.email, factories.TEST_PASSWORD)
    return user, headers


class TestScrubbing:
    """Pure logic - the guard that stops secrets reaching an immutable table."""

    def test_sensitive_keys_replaced(self) -> None:
        cleaned = scrub(
            {
                "password": "hunter2",
                "password_hash": "$argon2id$...",
                "token": "abc",
                "database_url": "postgresql://u:p@h/db",
                "full_name": "Bipul Das",
            }
        )
        assert cleaned is not None
        assert cleaned["password"] == REDACTED_PLACEHOLDER
        assert cleaned["password_hash"] == REDACTED_PLACEHOLDER
        assert cleaned["token"] == REDACTED_PLACEHOLDER
        assert cleaned["database_url"] == REDACTED_PLACEHOLDER
        assert cleaned["full_name"] == "Bipul Das"

    def test_nested_dictionaries_scrubbed(self) -> None:
        cleaned = scrub({"outer": {"secret": "s3cr3t", "keep": 1}})
        assert cleaned is not None
        assert cleaned["outer"]["secret"] == REDACTED_PLACEHOLDER
        assert cleaned["outer"]["keep"] == 1

    def test_case_insensitive(self) -> None:
        cleaned = scrub({"PASSWORD": "x", "Secret_Key": "y"})
        assert cleaned is not None
        assert cleaned["PASSWORD"] == REDACTED_PLACEHOLDER
        assert cleaned["Secret_Key"] == REDACTED_PLACEHOLDER

    def test_none_passes_through(self) -> None:
        assert scrub(None) is None


class TestMutationCoverage:
    async def test_driver_creation_is_audited(
        self, api: AsyncClient, session: AsyncSession, manager
    ) -> None:
        user, headers = manager
        created = (
            await api.post(
                "/api/drivers",
                headers=headers,
                json={
                    "full_name": "Bipul Das",
                    "initial_password": "driver-initial-pass",
                    "email": factories.unique_email("apidriver"),
                    "phone": factories.unique_phone(),
                    "licence_number": factories.unique_licence(),
                    "licence_expiry": (date.today() + timedelta(days=400)).isoformat(),
                },
            )
        ).json()

        rows = await _entries(session, "drivers", uuid.UUID(created["id"]))
        assert rows, "driver creation produced no audit record"
        entry = rows[0]
        assert entry.action is AuditAction.CREATE
        assert entry.actor_user_id == user.id, "audit did not record WHO"
        assert entry.after is not None and entry.after["full_name"] == "Bipul Das"

    async def test_update_records_before_and_after(
        self, api: AsyncClient, session: AsyncSession, manager
    ) -> None:
        _, headers = manager
        truck = await factories.make_truck(session)
        await api.patch(
            f"/api/trucks/{truck.id}", headers=headers, json={"make": "Tata"}
        )

        rows = await _entries(session, "trucks", truck.id)
        updates = [r for r in rows if r.action is AuditAction.UPDATE]
        assert updates
        entry = updates[0]
        assert entry.before is not None and entry.after is not None
        assert entry.after["make"] == "Tata"

    async def test_assignment_is_audited(
        self, api: AsyncClient, session: AsyncSession, manager
    ) -> None:
        _, headers = manager
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        created = (
            await api.post(
                "/api/assignments",
                headers=headers,
                json={"driver_id": str(driver.id), "truck_id": str(truck.id)},
            )
        ).json()

        rows = await _entries(
            session, "driver_truck_assignments", uuid.UUID(created["id"])
        )
        assert rows

    async def test_successful_login_is_audited(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session)
        await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": factories.TEST_PASSWORD},
        )
        rows = await _entries(session, "users", user.id)
        assert any(r.action is AuditAction.LOGIN for r in rows)

    async def test_failed_login_is_audited(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A brute-force attempt must leave a trail."""
        user = await factories.make_user(session)
        await api.post(
            "/api/auth/login", json={"identifier": user.email, "password": "wrong-one"}
        )
        rows = await _entries(session, "users", user.id)
        assert any(r.action is AuditAction.LOGIN_FAILED for r in rows)

    async def test_rejected_action_produces_no_mutation_audit(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A 403 must not look like a change in the trail."""
        _, driver_user = await factories.make_driver(session)
        headers = await auth_headers(api, driver_user.phone, factories.TEST_PASSWORD)

        registration = factories.unique_registration()
        r = await api.post(
            "/api/trucks",
            headers=headers,
            json={"registration_number": registration, "max_capacity_kg": "16000"},
        )
        assert r.status_code == 403

        rows = list(
            (
                await session.execute(
                    select(AuditLog).where(
                        AuditLog.entity_type == "trucks",
                        AuditLog.action == AuditAction.CREATE,
                        AuditLog.actor_user_id == driver_user.id,
                    )
                )
            ).scalars().all()
        )
        assert rows == []


class TestNoSecretsInAudit:
    async def test_password_never_stored(
        self, api: AsyncClient, session: AsyncSession, manager
    ) -> None:
        _, headers = manager
        secret = "a-very-distinctive-initial-password"
        created = (
            await api.post(
                "/api/drivers",
                headers=headers,
                json={
                    "full_name": "Bipul Das",
                    "initial_password": secret,
                    "email": factories.unique_email("apidriver"),
                    "phone": factories.unique_phone(),
                    "licence_number": factories.unique_licence(),
                    "licence_expiry": (date.today() + timedelta(days=400)).isoformat(),
                },
            )
        ).json()

        rows = await _entries(session, "drivers", uuid.UUID(created["id"]))
        for entry in rows:
            blob = f"{entry.before} {entry.after} {entry.reason}"
            assert secret not in blob
            assert "argon2" not in blob.lower()

    async def test_login_audit_holds_no_credentials(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session)
        await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": factories.TEST_PASSWORD},
        )
        for entry in await _entries(session, "users", user.id):
            blob = f"{entry.before} {entry.after} {entry.reason}"
            assert factories.TEST_PASSWORD not in blob

    async def test_no_connection_string_in_any_audit_row(
        self, session: AsyncSession
    ) -> None:
        rows = list(
            (await session.execute(select(AuditLog).limit(500))).scalars().all()
        )
        for entry in rows:
            blob = f"{entry.before} {entry.after} {entry.reason}"
            assert "postgresql://" not in blob
            assert "postgresql+psycopg://" not in blob


class TestImmutability:
    async def test_audit_rows_cannot_be_updated(self, session: AsyncSession) -> None:
        """Enforced by trigger, so it holds regardless of the caller."""
        from sqlalchemy import text

        entry = AuditLog(
            action=AuditAction.CREATE, entity_type="trucks", entity_id=uuid.uuid4()
        )
        session.add(entry)
        await session.commit()

        with pytest.raises(Exception) as exc:
            await session.execute(
                text("UPDATE audit_logs SET reason = 'tampered' WHERE id = :i"),
                {"i": entry.id},
            )
            await session.commit()
        assert "append-only" in str(exc.value)
        await session.rollback()

    async def test_actor_cannot_be_erased_by_deleting_the_user(
        self, session: AsyncSession
    ) -> None:
        """audit_logs.actor_user_id is RESTRICT (migration 0004).

        Otherwise anyone able to delete a user could anonymise their own trail,
        which is precisely what the append-only trigger exists to prevent.
        """
        from sqlalchemy import text

        user = await factories.make_user(session)
        session.add(
            AuditLog(
                actor_user_id=user.id,
                action=AuditAction.CREATE,
                entity_type="trucks",
                entity_id=uuid.uuid4(),
            )
        )
        await session.commit()

        with pytest.raises(Exception):
            await session.execute(
                text("DELETE FROM users WHERE id = :i"), {"i": user.id}
            )
            await session.commit()
        await session.rollback()
