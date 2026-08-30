"""Authorization: the permission matrix and the escalation attempts it must stop.

RLS cannot help here. The backend connects to Supabase as `postgres`, which has
rolbypassrls = true (proven in tests/test_rls_boundary.py), so every one of
these checks is enforced by FastAPI or not at all.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import permissions as perm
from app.core.permissions import ROLE_PERMISSIONS, has_permission, permissions_for
from app.models.enums import UserRole
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


class TestPermissionTable:
    """Pure logic - no database needed."""

    def test_every_role_has_an_entry(self) -> None:
        assert set(ROLE_PERMISSIONS) == set(UserRole)

    def test_unknown_role_gets_nothing(self) -> None:
        """Fail closed: a role added to the enum but not here must be powerless."""
        assert permissions_for("NOT_A_ROLE") == frozenset()  # type: ignore[arg-type]

    def test_driver_cannot_mutate_fleet(self) -> None:
        for permission in (
            perm.DRIVER_CREATE, perm.DRIVER_UPDATE, perm.DRIVER_DEACTIVATE,
            perm.TRUCK_CREATE, perm.TRUCK_UPDATE, perm.TRUCK_RETIRE,
            perm.ASSIGNMENT_CREATE, perm.ASSIGNMENT_END,
        ):
            assert not has_permission(UserRole.DRIVER, permission), permission

    def test_manager_cannot_read_salary(self) -> None:
        """Salary is admin-only; MANAGER runs operations, not payroll."""
        assert not has_permission(UserRole.MANAGER, perm.DRIVER_READ_SENSITIVE)
        assert has_permission(UserRole.ADMIN, perm.DRIVER_READ_SENSITIVE)

    def test_admin_holds_every_permission(self) -> None:
        assert permissions_for(UserRole.ADMIN) == perm.ALL_PERMISSIONS


class TestUnauthenticatedAccess:
    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("GET", "/api/drivers"),
            ("POST", "/api/drivers"),
            ("GET", "/api/trucks"),
            ("POST", "/api/trucks"),
            ("GET", "/api/assignments"),
            ("POST", "/api/assignments"),
            ("GET", "/api/auth/me"),
        ],
    )
    async def test_protected_routes_reject_anonymous(
        self, api: AsyncClient, method: str, path: str
    ) -> None:
        r = await api.request(method, path, json={})
        assert r.status_code == 401, f"{method} {path} was reachable without a token"

    async def test_health_stays_public(self, api: AsyncClient) -> None:
        """Probes must not require credentials."""
        assert (await api.get("/health")).status_code == 200


class TestRoleEnforcement:
    async def test_driver_cannot_create_a_truck(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, user = await factories.make_driver(session)
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        r = await api.post(
            "/api/trucks",
            headers=headers,
            json={"registration_number": "AS01AB1234", "max_capacity_kg": "16000.00"},
        )
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "FORBIDDEN"

    async def test_driver_cannot_create_an_assignment(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        r = await api.post(
            "/api/assignments",
            headers=headers,
            json={"driver_id": str(driver.id), "truck_id": str(truck.id)},
        )
        assert r.status_code == 403

    async def test_manager_can_create_a_truck(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, user.email, factories.TEST_PASSWORD)
        r = await api.post(
            "/api/trucks",
            headers=headers,
            json={
                "registration_number": factories.unique_registration(),
                "max_capacity_kg": "16000.00",
            },
        )
        assert r.status_code == 201

    async def test_forbidden_action_does_not_mutate(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A 403 must be a refusal, not a rollback after the fact."""
        _, user = await factories.make_driver(session)
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        registration = factories.unique_registration()

        assert (
            await api.post(
                "/api/trucks",
                headers=headers,
                json={"registration_number": registration, "max_capacity_kg": "16000"},
            )
        ).status_code == 403

        manager = await factories.make_user(session, role=UserRole.MANAGER)
        mgr_headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)
        listing = (
            await api.get(
                f"/api/trucks?search={registration}", headers=mgr_headers
            )
        ).json()
        assert listing["items"] == []


class TestPrivilegeEscalation:
    async def test_role_in_request_body_is_ignored(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A client-supplied role must never influence authorization."""
        _, user = await factories.make_driver(session)
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        r = await api.post(
            "/api/trucks",
            headers=headers,
            json={
                "registration_number": factories.unique_registration(),
                "max_capacity_kg": "16000",
                "role": "ADMIN",
            },
        )
        # 422 for the unknown field, or 403 for the role - never 201.
        assert r.status_code in (403, 422)

    async def test_role_header_is_ignored(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, user = await factories.make_driver(session)
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        headers["X-Role"] = "ADMIN"
        headers["X-User-Role"] = "ADMIN"
        r = await api.post(
            "/api/trucks",
            headers=headers,
            json={
                "registration_number": factories.unique_registration(),
                "max_capacity_kg": "16000",
            },
        )
        assert r.status_code == 403

    async def test_actor_id_cannot_be_impersonated(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Identity comes from the signed token, never from the payload."""
        admin = await factories.make_user(session, role=UserRole.ADMIN)
        _, driver_user = await factories.make_driver(session)
        headers = await auth_headers(api, driver_user.phone, factories.TEST_PASSWORD)

        r = await api.post(
            "/api/trucks",
            headers=headers,
            json={
                "registration_number": factories.unique_registration(),
                "max_capacity_kg": "16000",
                "actor_user_id": str(admin.id),
                "created_by": str(admin.id),
            },
        )
        assert r.status_code in (403, 422)

    async def test_demoted_user_loses_access_within_the_token_lifetime(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Authorization reads the role from the database, not the token.

        A token minted while the user was a MANAGER carries role=MANAGER for its
        full 15 minutes. If authorization trusted that claim, a demotion would
        not take effect until the token expired.
        """
        user = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, user.email, factories.TEST_PASSWORD)

        assert (
            await api.post(
                "/api/trucks",
                headers=headers,
                json={
                    "registration_number": factories.unique_registration(),
                    "max_capacity_kg": "16000",
                },
            )
        ).status_code == 201

        user.role = UserRole.DRIVER
        await session.commit()

        after = await api.post(
            "/api/trucks",
            headers=headers,  # same, still-valid token
            json={
                "registration_number": factories.unique_registration(),
                "max_capacity_kg": "16000",
            },
        )
        assert after.status_code == 403, (
            "a demoted user kept manager access - the role is being read from "
            "the token instead of the database"
        )

    async def test_deactivated_user_is_locked_out_immediately(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, user.email, factories.TEST_PASSWORD)
        assert (await api.get("/api/auth/me", headers=headers)).status_code == 200

        user.is_active = False
        await session.commit()

        assert (await api.get("/api/auth/me", headers=headers)).status_code == 401


class TestObjectLevelScoping:
    async def test_driver_cannot_read_another_driver(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """OWASP API #1. Returns 404, not 403 - a 403 confirms existence."""
        _, user_a = await factories.make_driver(session)
        driver_b, _ = await factories.make_driver(session)

        headers = await auth_headers(api, user_a.phone, factories.TEST_PASSWORD)
        r = await api.get(f"/api/drivers/{driver_b.id}", headers=headers)
        assert r.status_code == 404

    async def test_driver_list_shows_only_self(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        driver_a, user_a = await factories.make_driver(session)
        await factories.make_driver(session)

        headers = await auth_headers(api, user_a.phone, factories.TEST_PASSWORD)
        items = (await api.get("/api/drivers", headers=headers)).json()["items"]
        assert [i["id"] for i in items] == [str(driver_a.id)]

    async def test_manager_sees_all_drivers(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        await factories.make_driver(session)
        await factories.make_driver(session)
        manager = await factories.make_user(session, role=UserRole.MANAGER)

        headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)
        items = (await api.get("/api/drivers", headers=headers)).json()["items"]
        assert len(items) >= 2

    async def test_missing_entity_is_404_not_500(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        manager = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)
        r = await api.get(f"/api/drivers/{uuid.uuid4()}", headers=headers)
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "NOT_FOUND"
