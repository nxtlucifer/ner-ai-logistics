"""Rate limiting on the authentication endpoints.

Two layers, deliberately:

  unit        `FixedWindowLimiter` with an INJECTED clock, so window expiry is
              stepped through rather than slept through (TESTING_STRATEGY §0.5).
  integration the real endpoints, so the thing being proven is what a caller
              actually meets - status, envelope, and the Retry-After header.

The negative cases matter most here. A limiter that throttles GPS ingestion, or
that can be reset by editing a request header, is worse than none: it looks like
a control while removing the throughput the fleet map depends on, or while
providing no bound at all.
"""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import auth as auth_api
from app.core.config import get_settings
from app.core.rate_limit import FixedWindowLimiter
from app.models.enums import UserRole
from tests import factories
from tests.conftest import auth_headers

BASE = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)


class TestFixedWindowLimiter:
    """Pure logic. No database, no HTTP, no sleeping."""

    def test_allows_up_to_the_limit(self) -> None:
        limiter = FixedWindowLimiter(limit=3, window=timedelta(seconds=60))
        for i in range(3):
            decision = limiter.check("k", now=BASE + timedelta(seconds=i))
            assert decision.allowed, f"attempt {i + 1} of 3 should be allowed"
            assert decision.used == i + 1

    def test_refuses_past_the_limit(self) -> None:
        limiter = FixedWindowLimiter(limit=2, window=timedelta(seconds=60))
        limiter.check("k", now=BASE)
        limiter.check("k", now=BASE)
        decision = limiter.check("k", now=BASE)
        assert not decision.allowed
        assert decision.used == 3
        assert decision.limit == 2

    def test_retry_after_is_never_zero(self) -> None:
        """A Retry-After of 0 invites the immediate retry being limited."""
        limiter = FixedWindowLimiter(limit=1, window=timedelta(seconds=60))
        limiter.check("k", now=BASE)
        # Right at the last instant of the window.
        decision = limiter.check("k", now=BASE + timedelta(seconds=59, milliseconds=999))
        assert not decision.allowed
        assert decision.retry_after >= 1

    def test_the_window_reopens(self) -> None:
        limiter = FixedWindowLimiter(limit=1, window=timedelta(seconds=60))
        assert limiter.check("k", now=BASE).allowed
        assert not limiter.check("k", now=BASE + timedelta(seconds=30)).allowed
        assert limiter.check("k", now=BASE + timedelta(seconds=60)).allowed

    def test_keys_are_isolated(self) -> None:
        """One caller exhausting their budget must not lock out everyone else."""
        limiter = FixedWindowLimiter(limit=1, window=timedelta(seconds=60))
        assert limiter.check("a", now=BASE).allowed
        assert not limiter.check("a", now=BASE).allowed
        assert limiter.check("b", now=BASE).allowed, "b was punished for a's attempts"

    def test_reset_clears_one_key_only(self) -> None:
        limiter = FixedWindowLimiter(limit=1, window=timedelta(seconds=60))
        limiter.check("a", now=BASE)
        limiter.check("b", now=BASE)
        limiter.reset("a")
        assert limiter.check("a", now=BASE).allowed
        assert not limiter.check("b", now=BASE).allowed

    def test_a_limited_key_stays_limited_while_it_keeps_trying(self) -> None:
        """Hammering must not be rewarded with a fresh window."""
        limiter = FixedWindowLimiter(limit=1, window=timedelta(seconds=60))
        limiter.check("k", now=BASE)
        for second in range(1, 30):
            assert not limiter.check("k", now=BASE + timedelta(seconds=second)).allowed

    def test_expired_windows_are_pruned(self) -> None:
        """The limiter must not become the memory exhaustion it prevents."""
        from app.core.rate_limit import MAX_TRACKED_KEYS

        limiter = FixedWindowLimiter(limit=1, window=timedelta(seconds=60))
        for i in range(MAX_TRACKED_KEYS + 50):
            limiter.check(f"k{i}", now=BASE)
        # All still inside the window, so nothing is pruned yet.
        before = len(limiter._windows)
        limiter.check("later", now=BASE + timedelta(seconds=120))
        assert len(limiter._windows) < before, "expired windows were not pruned"


@pytest.mark.requires_db
class TestLoginRateLimit:
    async def test_a_normal_login_is_unaffected(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session, role=UserRole.MANAGER)
        r = await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": factories.TEST_PASSWORD},
        )
        assert r.status_code == 200, r.text

    async def test_failures_below_the_threshold_still_get_401(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session, role=UserRole.MANAGER)
        limit = get_settings().LOGIN_RATE_LIMIT_PER_IDENTIFIER
        for _ in range(limit):
            r = await api.post(
                "/api/auth/login",
                json={"identifier": user.email, "password": "wrong-password"},
            )
            assert r.status_code == 401, r.text

    async def test_the_threshold_produces_429_with_retry_after(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session, role=UserRole.MANAGER)
        limit = get_settings().LOGIN_RATE_LIMIT_PER_IDENTIFIER
        for _ in range(limit):
            await api.post(
                "/api/auth/login",
                json={"identifier": user.email, "password": "wrong-password"},
            )

        r = await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": "wrong-password"},
        )
        assert r.status_code == 429, r.text
        assert r.json()["error"]["code"] == "RATE_LIMITED"
        assert "retry-after" in {k.lower() for k in r.headers}
        assert int(r.headers["retry-after"]) >= 1

    async def test_the_correct_password_is_also_refused_once_limited(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The limit is checked BEFORE the password.

        Otherwise the endpoint still runs Argon2 for an attacker, and still
        answers the question they are asking.
        """
        user = await factories.make_user(session, role=UserRole.MANAGER)
        limit = get_settings().LOGIN_RATE_LIMIT_PER_IDENTIFIER
        for _ in range(limit + 1):
            await api.post(
                "/api/auth/login",
                json={"identifier": user.email, "password": "wrong-password"},
            )

        r = await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": factories.TEST_PASSWORD},
        )
        assert r.status_code == 429

    async def test_the_message_does_not_reveal_whether_the_account_exists(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Login spends real effort not being an enumeration oracle.

        A 429 that said "too many attempts for this account" would hand back
        exactly the signal that effort removes.
        """
        user = await factories.make_user(session, role=UserRole.MANAGER)
        limit = get_settings().LOGIN_RATE_LIMIT_PER_IDENTIFIER
        for _ in range(limit + 1):
            await api.post(
                "/api/auth/login",
                json={"identifier": user.email, "password": "wrong-password"},
            )
        real = await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": "wrong-password"},
        )

        auth_api.reset_rate_limits()
        absent = f"nobody-{factories.uuid.uuid4().hex[:8]}@{factories.TEST_MARKER}"
        for _ in range(limit + 1):
            await api.post(
                "/api/auth/login",
                json={"identifier": absent, "password": "wrong-password"},
            )
        unknown = await api.post(
            "/api/auth/login", json={"identifier": absent, "password": "wrong-password"}
        )

        assert real.status_code == unknown.status_code == 429
        assert real.json()["error"]["message"] == unknown.json()["error"]["message"]

    async def test_a_success_clears_the_budget(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Fumbling a password twice must not leave a driver near lockout."""
        user = await factories.make_user(session, role=UserRole.MANAGER)
        limit = get_settings().LOGIN_RATE_LIMIT_PER_IDENTIFIER

        for _ in range(limit - 1):
            await api.post(
                "/api/auth/login",
                json={"identifier": user.email, "password": "wrong-password"},
            )
        ok = await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": factories.TEST_PASSWORD},
        )
        assert ok.status_code == 200

        # Budget cleared, so a fresh run of failures is available again.
        for _ in range(limit):
            r = await api.post(
                "/api/auth/login",
                json={"identifier": user.email, "password": "wrong-password"},
            )
            assert r.status_code == 401, "the window was not cleared by success"

    async def test_a_success_does_not_clear_the_cross_account_budget(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Credential spraying, which the per-IP limit exists to bound.

        The per-identifier limit cannot see this attack: one guess per account
        never approaches 10 attempts against any single account. Only the
        per-IP budget counts attempts across accounts - so if a successful
        login clears it, anyone holding one valid credential (their own driver
        account, say) sprays indefinitely: N-1 guesses at N-1 accounts, one
        login of their own to zero the counter, repeat.

        A success on ONE account says nothing about the failures against the
        others reached from the same address.
        """
        attacker = await factories.make_user(session, role=UserRole.MANAGER)
        ip_limit = get_settings().LOGIN_RATE_LIMIT_PER_IP

        # Distinct identifiers throughout, so the per-identifier limit never
        # trips and a 429 can only come from the per-IP budget.
        for i in range(ip_limit - 1):
            r = await api.post(
                "/api/auth/login",
                json={
                    "identifier": f"sprayed-{i}@example.test",
                    "password": "wrong-password",
                },
            )
            assert r.status_code == 401, f"guess {i + 1} was not counted as a guess"

        ok = await api.post(
            "/api/auth/login",
            json={"identifier": attacker.email, "password": factories.TEST_PASSWORD},
        )
        assert ok.status_code == 200

        # That success consumed the last slot in the per-IP window. The next
        # guess at yet another account must be refused.
        r = await api.post(
            "/api/auth/login",
            json={
                "identifier": "sprayed-after-reset@example.test",
                "password": "wrong-password",
            },
        )
        assert r.status_code == 429, (
            "a successful login cleared the per-IP budget, so one valid "
            "credential buys unlimited guessing against every other account"
        )

    async def test_one_identifier_being_limited_does_not_lock_out_another(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Per-identifier isolation.

        Both users share a client address here, so this also pins that the
        per-IP budget is looser than the per-identifier one - otherwise
        attacking one account would deny service to every other account
        reachable from the same network.
        """
        victim = await factories.make_user(session, role=UserRole.MANAGER)
        bystander = await factories.make_user(session, role=UserRole.MANAGER)

        for _ in range(get_settings().LOGIN_RATE_LIMIT_PER_IDENTIFIER + 1):
            await api.post(
                "/api/auth/login",
                json={"identifier": victim.email, "password": "wrong-password"},
            )

        r = await api.post(
            "/api/auth/login",
            json={"identifier": bystander.email, "password": factories.TEST_PASSWORD},
        )
        assert r.status_code == 200, "an unrelated account was locked out"

    async def test_the_identifier_key_is_case_folded(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Otherwise changing one letter's case buys a fresh budget."""
        user = await factories.make_user(session, role=UserRole.MANAGER)
        limit = get_settings().LOGIN_RATE_LIMIT_PER_IDENTIFIER
        for _ in range(limit + 1):
            await api.post(
                "/api/auth/login",
                json={"identifier": user.email, "password": "wrong-password"},
            )

        r = await api.post(
            "/api/auth/login",
            json={"identifier": user.email.upper(), "password": "wrong-password"},
        )
        assert r.status_code == 429, "case variation escaped the limit"


@pytest.mark.requires_db
class TestTelemetryIsNotThrottled:
    async def test_gps_ingestion_is_never_rate_limited(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The failure mode this design exists to avoid.

        A truck flushing an offline backlog posts many batches in a burst. A
        policy broad enough to cover "the API" would throttle exactly the
        telemetry the fleet map depends on, and it would look like a network
        problem rather than a policy decision.

        Far more batches than any auth limit would permit, so if a global policy
        is ever introduced this fails immediately.
        """
        from app.models.enums import TripStatus

        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await factories.make_assignment(session, driver, truck)
        trip = await factories.make_trip(
            session, driver, truck, assignment=assignment, status=TripStatus.ACTIVE
        )
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)

        ceiling = max(
            get_settings().LOGIN_RATE_LIMIT_PER_IP,
            get_settings().REFRESH_RATE_LIMIT_PER_IP,
        )
        for i in range(ceiling + 10):
            r = await api.post(
                "/api/driver/me/location",
                headers=headers,
                json={
                    "trip_id": str(trip.id),
                    "fixes": [
                        {
                            "device_fix_id": str(factories.uuid.uuid4()),
                            "location": {"lat": 26.1445, "lon": 91.7362},
                            "recorded_at": datetime.now(UTC).isoformat(),
                        }
                    ],
                },
            )
            assert r.status_code == 202, (
                f"GPS batch {i + 1} was refused with {r.status_code} - "
                "telemetry must not be rate limited"
            )
