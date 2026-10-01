"""Regression tests for what the Day 2 Task 2 security assessment found and fixed.

Each class is one finding from docs/submission/day2/task2 - the test is the
thing that failed before the fix and must keep failing loudly if the fix is
ever undone.
"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.files import MAX_BYTES
from app.models.enums import AssignmentStatus, UserRole
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


async def _driver(api, session):
    driver, user = await factories.make_driver(session)
    return driver, await auth_headers(api, user.phone, factories.TEST_PASSWORD)


class TestSecurityHeaders:
    """SEC-001: the API answered with no hardening headers at all."""

    async def test_every_response_carries_the_hardening_set(self, api: AsyncClient) -> None:
        for path in ("/health", "/api/auth/me", "/api/trips/not-a-uuid"):
            r = await api.get(path)
            assert r.headers["x-content-type-options"] == "nosniff", path
            assert r.headers["x-frame-options"] == "DENY", path
            assert "frame-ancestors 'none'" in r.headers["content-security-policy"], path
            assert r.headers["referrer-policy"] == "no-referrer", path

    async def test_api_bodies_are_never_cached_but_avatars_keep_their_own_policy(self, api, session) -> None:
        driver, headers = await _driver(api, session)
        me = await api.get("/api/driver/me", headers=headers)
        assert me.headers["cache-control"] == "no-store"
        up = await api.post("/api/files?kind=PROFILE_PHOTO", headers=headers, content=PNG)
        assert up.status_code == 201
        served = await api.get(up.json()["url"], headers=headers)
        assert served.headers["cache-control"] == "private, max-age=3600"  # route-set, middleware leaves it
        assert served.headers["x-content-type-options"] == "nosniff"  # a stored polyglot is never sniffed into HTML


class TestDriverDocumentsAreScoped:
    """SEC-002: any driver could read any other driver's document metadata by id."""

    async def test_another_drivers_documents_are_404(self, api, session) -> None:
        a, headers_a = await _driver(api, session)
        b, headers_b = await _driver(api, session)
        assert (await api.get(f"/api/drivers/{a.id}/documents", headers=headers_a)).status_code == 200
        r = await api.get(f"/api/drivers/{b.id}/documents", headers=headers_a)
        assert r.status_code == 404, r.text  # not 403: the id space is not an oracle
        assert (await api.get(f"/api/drivers/{b.id}/documents", headers=headers_b)).status_code == 200

    async def test_manager_still_reads_any_drivers_documents(self, api, session) -> None:
        driver, _ = await _driver(api, session)
        user = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, user.email, factories.TEST_PASSWORD)
        assert (await api.get(f"/api/drivers/{driver.id}/documents", headers=headers)).status_code == 200


class TestTruckRegisterIsScopedForDrivers:
    """SEC-003: TRUCK_READ let a driver page through the whole fleet register."""

    async def test_driver_sees_only_the_assigned_truck(self, api, session) -> None:
        driver, headers = await _driver(api, session)
        mine = await factories.make_truck(session)
        other = await factories.make_truck(session)
        await factories.make_assignment(session, driver, mine, status=AssignmentStatus.PENDING_VERIFICATION)
        page = (await api.get("/api/trucks?limit=100", headers=headers)).json()["items"]
        assert [t["id"] for t in page] == [str(mine.id)]
        assert (await api.get(f"/api/trucks/{mine.id}", headers=headers)).status_code == 200
        assert (await api.get(f"/api/trucks/{other.id}", headers=headers)).status_code == 404

    async def test_manager_still_sees_the_fleet(self, api, session) -> None:
        user = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, user.email, factories.TEST_PASSWORD)
        a, b = await factories.make_truck(session), await factories.make_truck(session)
        ids = {t["id"] for t in (await api.get("/api/trucks?limit=100", headers=headers)).json()["items"]}
        assert {str(a.id), str(b.id)} <= ids


class TestUploadIsBoundedBeforeItIsBuffered:
    """SEC-004: the whole body was read into memory before the 5 MB check ran."""

    async def test_declared_oversize_is_refused_without_reading_the_body(self, api, session) -> None:
        _, headers = await _driver(api, session)
        pulled = 0

        async def body():
            nonlocal pulled
            for _ in range(20):  # 20 MB on offer
                pulled += 1
                yield b"\x00" * (1024 * 1024)

        r = await api.post("/api/files?kind=DRIVER_DOCUMENT", headers={**headers, "Content-Length": str(20 * 1024 * 1024)}, content=body())
        assert r.status_code == 413 and r.json()["error"]["code"] == "FILE_TOO_LARGE"
        assert pulled == 0

    async def test_chunked_oversize_stops_at_the_cap(self, api, session) -> None:
        _, headers = await _driver(api, session)
        pulled = 0

        async def body():
            nonlocal pulled
            for _ in range(20):
                pulled += 1
                yield b"\x00" * (1024 * 1024)

        r = await api.post("/api/files?kind=DRIVER_DOCUMENT", headers={**headers, "Transfer-Encoding": "chunked"}, content=body())
        assert r.status_code == 413
        assert pulled <= MAX_BYTES // (1024 * 1024) + 1  # 6 chunks, never 20

class TestScopedManagerIdor:
    """SEC-007: the district hierarchy, attacked from the URL bar.

    A filtered list beside an unfiltered detail endpoint is the classic shape
    of this bug, and it is the one a role hierarchy invites: the screen looks
    right and `GET /api/trips/{id}` hands over the row anyway. Every
    assertion here is made twice - once on the list, once on the direct id -
    because passing only the first IS the failure.

    Out of scope answers 404, not 403. A 403 would confirm the trip exists.
    """

    async def _trip_between(self, session, origin, dest):
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        shipment = await factories.make_shipment(
            session,
            origin_district_id=origin.id,
            destination_district_id=dest.id,
        )
        return await factories.make_trip(session, driver, truck, shipment=shipment)

    async def test_another_districts_trip_is_invisible_and_unreachable(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        mine = await factories.make_district(session, slug="sec-mine")
        theirs = await factories.make_district(session, slug="sec-theirs")
        far = await factories.make_district(session, slug="sec-far")
        me = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )
        headers = await auth_headers(api, me.email, factories.TEST_PASSWORD)
        not_mine = await self._trip_between(session, theirs, far)

        listed = await api.get("/api/trips?limit=100", headers=headers)
        assert listed.status_code == 200
        assert not_mine.trip_code not in {
            t["trip_code"] for t in listed.json()["items"]
        }

        # The URL bar, which is where this bug actually gets exploited.
        direct = await api.get(f"/api/trips/{not_mine.id}", headers=headers)
        assert direct.status_code == 404
        assert direct.json()["error"]["code"] == "NOT_FOUND"

    async def test_a_trip_arriving_in_my_district_is_mine_to_see(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The other half of the rule: scoping must not over-refuse either."""
        mine = await factories.make_district(session, slug="sec-arriving-mine")
        elsewhere = await factories.make_district(session, slug="sec-arriving-from")
        me = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )
        headers = await auth_headers(api, me.email, factories.TEST_PASSWORD)
        incoming = await self._trip_between(session, elsewhere, mine)

        listed = await api.get("/api/trips?limit=100", headers=headers)
        assert incoming.trip_code in {t["trip_code"] for t in listed.json()["items"]}
        assert (
            await api.get(f"/api/trips/{incoming.id}", headers=headers)
        ).status_code == 200

    async def test_a_state_manager_cannot_reach_another_state(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        home = await factories.make_district(
            session, state_slug="assam", slug="sec-sm-home"
        )
        away_a = await factories.make_district(
            session, state_slug="mizoram", slug="sec-sm-away-a"
        )
        away_b = await factories.make_district(
            session, state_slug="mizoram", slug="sec-sm-away-b"
        )
        me = await factories.make_user(
            session, role=UserRole.STATE_MANAGER, state_id=home.state_id
        )
        headers = await auth_headers(api, me.email, factories.TEST_PASSWORD)
        foreign = await self._trip_between(session, away_a, away_b)

        listed = await api.get("/api/trips?limit=100", headers=headers)
        assert foreign.trip_code not in {t["trip_code"] for t in listed.json()["items"]}
        assert (
            await api.get(f"/api/trips/{foreign.id}", headers=headers)
        ).status_code == 404

    async def test_a_scoped_manager_cannot_reach_another_managers_inbox(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A notification is addressed. Marking someone else's read must not
        work, and must not confirm the id exists either."""
        from app.models.enums import NotificationKind
        from app.services import notifications as notify_service

        mine = await factories.make_district(session, slug="sec-inbox-mine")
        theirs = await factories.make_district(session, slug="sec-inbox-theirs")
        me = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )
        other = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=theirs.state_id,
            district_id=theirs.id,
        )
        trip = await self._trip_between(session, theirs, theirs)
        await notify_service.notify(
            session,
            recipients=[other],
            kind=NotificationKind.TRIP_DISPATCHED,
            dedupe_key=f"sec:{trip.id}",
            trip_id=trip.id,
        )
        await session.commit()
        theirs_row = (await notify_service.inbox(session, other))[0]

        headers = await auth_headers(api, me.email, factories.TEST_PASSWORD)
        assert (await api.get("/api/notifications", headers=headers)).json() == []
        stolen = await api.post(
            "/api/notifications/read",
            headers=headers,
            json={"ids": [str(theirs_row.id)]},
        )
        assert stolen.status_code == 200
        assert stolen.json()["marked"] == 0
        await session.refresh(theirs_row)
        assert theirs_row.is_read is False


class TestTrustedProxyHandled:
    """SEC-006: closed.

    The login limiter and the audit IP both read the caller through
    `app/core/rate_limit.client_address`: the TCP peer, or with
    TRUSTED_PROXY_HOPS set, the X-Forwarded-For entry that many trusted
    proxies appended, counted from the right. The forged left-most entry
    reaches neither. tests/test_trusted_proxy.py walks client_address hop by
    hop; these hold the two call sites to it end to end, behind one proxy as
    on Render.
    """

    FORGED, CLIENT = "1.2.3.4", "203.0.113.9"

    @pytest.fixture(autouse=True)
    def _one_trusted_proxy(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from app.core.config import get_settings

        monkeypatch.setenv("TRUSTED_PROXY_HOPS", "1")
        get_settings.cache_clear()

    async def test_the_rate_limiter_ignores_a_forged_forwarded_header(
        self, api: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import inspect

        from app.core.config import get_settings
        from app.core.rate_limit import GcraLimiter

        # The limiter only counts keys; the header is read in one place.
        source = inspect.getsource(GcraLimiter)
        assert "x-forwarded-for" not in source.lower()

        # A fresh forged prefix per request buys no fresh per-IP budget.
        monkeypatch.setenv("LOGIN_RATE_LIMIT_PER_IP", "1")
        get_settings.cache_clear()
        codes = [
            (
                await api.post(
                    "/api/auth/login",
                    json={"identifier": f"nobody-{i}@example.invalid", "password": "x" * 12},
                    headers={"X-Forwarded-For": f"{forged}, {self.CLIENT}"},
                )
            ).status_code
            for i, forged in enumerate((self.FORGED, "5.6.7.8"))
        ]
        assert codes == [401, 429]

    async def test_the_audit_row_records_the_proxy_appended_address(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        from sqlalchemy import select

        from app.models.audit import AuditLog
        from app.models.enums import AuditAction

        user = await factories.make_user(session, role=UserRole.MANAGER)
        r = await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": "wrong-password-1"},
            headers={"X-Forwarded-For": f"{self.FORGED}, {self.CLIENT}"},
        )
        assert r.status_code == 401
        recorded = await session.scalar(
            select(AuditLog.ip_address).where(
                AuditLog.entity_id == user.id, AuditLog.action == AuditAction.LOGIN_FAILED
            )
        )
        assert str(recorded) == self.CLIENT

    def test_the_audit_ip_is_still_documented_as_a_hint(self) -> None:
        """Hop-aware is not proof: an audit IP never authorises anything."""
        from app.api.deps import get_client_ip

        assert get_client_ip.__doc__
        assert "never used for an authorization" in get_client_ip.__doc__
