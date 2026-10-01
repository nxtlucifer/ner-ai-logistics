"""Worker-level hardening: Argon2 off the loop, pushes after commit, the
sentinel's emergency lock, request ids, and the audit client address."""

import asyncio
import logging
import threading
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.core import security
from app.core.errors import ServiceUnavailableError
from app.db import session as db_session
from app.domain.sentinel import DriverCheckResponse, EmergencyState
from app.models.emergency import Emergency
from app.models.enums import TripEventKind, TripStatus, UserRole
from app.models.operations import DriverNotification, TripEvent
from app.services import notify, sentinel, trips
from tests import factories
from tests.conftest import auth_headers
from tests.test_sentinel_concurrency import _seed_stationary_active_trip


async def _verify_blocks_nothing(api: AsyncClient, monkeypatch: pytest.MonkeyPatch, request) -> int:  # noqa: ANN001
    """Run `request` with a verify that blocks until released. While it blocks
    the loop must serve /health and the request must hold no pooled
    connection. Returns the response status."""
    entered, release = threading.Event(), threading.Event()
    released: list[bool] = []
    real = security.verify_password

    def slow_verify(password: str, password_hash: str) -> bool:
        entered.set()
        released.append(release.wait(5))
        return real(password, password_hash)

    monkeypatch.setattr(security, "verify_password", slow_verify)
    # Fresh per test loop; the module one binds to the first loop that waits.
    monkeypatch.setattr(security, "_argon2_slots", asyncio.Semaphore(2))
    pool = db_session.get_engine().pool
    baseline = pool.checkedout()

    task = asyncio.create_task(request)
    for _ in range(500):
        if entered.is_set():
            break
        await asyncio.sleep(0.01)
    assert entered.is_set()

    assert (await api.get("/health")).status_code == 200
    assert pool.checkedout() == baseline
    release.set()
    status = (await task).status_code
    assert released == [True], "verify ran on the event loop"
    return status


class TestArgon2OffTheLoop:
    @pytest.mark.requires_db
    async def test_other_requests_run_while_a_login_verifies(
        self, api: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A (slow) verify in flight must neither freeze the loop nor keep
        the login's pooled connection checked out while it runs."""
        login = api.post(
            "/api/auth/login",
            json={"identifier": "nobody@example.invalid", "password": "x" * 12},
        )
        assert await _verify_blocks_nothing(api, monkeypatch, login) == 401

    @pytest.mark.requires_db
    async def test_a_password_change_verifies_without_holding_a_connection(
        self, api: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        user = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, user.email, factories.TEST_PASSWORD)
        change = api.post(
            "/api/auth/password",
            headers=headers,
            json={"current_password": factories.TEST_PASSWORD, "new_password": "a-new-one-9x"},
        )
        assert await _verify_blocks_nothing(api, monkeypatch, change) == 200


class TestCancelPushAfterCommit:
    @pytest.mark.requires_db
    async def test_a_failed_commit_sends_no_push(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manager = await factories.make_user(session, role=UserRole.MANAGER)
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await factories.make_assignment(session, driver, truck, verified=True)
        trip = await factories.make_trip(session, driver, truck, assignment=assignment)

        sent: list[dict] = []

        async def record(db, **kwargs):  # noqa: ANN001
            sent.append(kwargs)

        async def boom() -> None:
            raise RuntimeError("commit failed")

        with monkeypatch.context() as m:
            m.setattr(trips.notify, "send", record)
            m.setattr(session, "commit", boom)
            with pytest.raises(RuntimeError):
                await trips.cancel(session, trip.id, actor=manager, reason="no longer needed")
        await session.rollback()
        assert sent == []


class TestPushHoldsNoConnection:
    """notify.send after the caller's commit ends its own read transaction
    before the push; inside the caller's transaction it commits nothing."""

    @pytest.fixture(autouse=True)
    def _push_on(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(notify, "configured", lambda: True)

    async def _driver_with_token(self, session: AsyncSession):  # noqa: ANN202
        driver, _ = await factories.make_driver(session)
        driver.push_token = "ExponentPushToken[test]"
        await session.commit()
        return driver

    @pytest.mark.requires_db
    async def test_after_the_callers_commit_the_push_holds_no_connection(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        driver = await self._driver_with_token(session)
        pool = db_session.get_engine().pool
        baseline = pool.checkedout()
        during: list[int] = []

        async def deliver(*_args) -> str:  # noqa: ANN002
            during.append(pool.checkedout())
            return "SENT"

        monkeypatch.setattr(notify, "_deliver", deliver)
        async with db_session.get_sessionmaker()() as db:
            row = await notify.send(
                db, driver_id=driver.id, event="TRIP_CANCELLED", title="t", body="b",
                fingerprint=f"test:{driver.id}",
            )
            await db.commit()
        assert during == [baseline]
        assert row.delivery == "SENT"

    @pytest.mark.requires_db
    @pytest.mark.parametrize("flushed", [True, False])
    async def test_inside_the_callers_transaction_nothing_is_committed(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch, flushed: bool
    ) -> None:
        driver = await self._driver_with_token(session)

        async def deliver(*_args) -> str:  # noqa: ANN002
            return "SENT"

        monkeypatch.setattr(notify, "_deliver", deliver)
        async with db_session.get_sessionmaker()() as db:
            db.add(
                DriverNotification(
                    driver_id=driver.id, event="TRIP_CANCELLED", fingerprint=f"caller:{driver.id}",
                    title="t", body="b", delivery="SENT",
                )
            )
            if flushed:
                await db.flush()
            await notify.send(
                db, driver_id=driver.id, event="TRIP_CANCELLED", title="t", body="b",
                fingerprint=f"test:{driver.id}",
            )
            await db.rollback()
        kept = await session.scalar(
            select(func.count())
            .select_from(DriverNotification)
            .where(DriverNotification.driver_id == driver.id)
        )
        assert kept == 0


async def _until_waiting_on_a_lock(observer: AsyncSession, pid: int) -> None:
    """Return once backend `pid` waits on a lock; fail if it never does."""
    for _ in range(200):
        waiting = await observer.scalar(
            text("SELECT wait_event_type = 'Lock' FROM pg_stat_activity WHERE pid = :pid"),
            {"pid": pid},
        )
        await observer.commit()  # pg_stat_activity is cached per transaction
        if waiting:
            return
        await asyncio.sleep(0.05)
    pytest.fail(f"backend {pid} never waited on a lock")


class TestSentinelLocksTheEmergency:
    NOW = datetime(2026, 9, 9, 12, 0, tzinfo=UTC)

    async def _overdue_check(self, session: AsyncSession):  # noqa: ANN202
        """An ACTIVE trip whose driver check-in deadline passed 10 min ago."""
        now = self.NOW
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await factories.make_assignment(session, driver, truck, verified=True)
        trip = await factories.make_trip(
            session, driver, truck, assignment=assignment, status=TripStatus.ACTIVE
        )
        session.add(
            Emergency(
                trip_id=trip.id,
                state=EmergencyState.DRIVER_CHECK_REQUIRED,
                triggered_at=now - timedelta(minutes=40),
                stationary_since=now - timedelta(minutes=100),
                check_sent_at=now - timedelta(minutes=40),
                response_deadline_at=now - timedelta(minutes=10),
            )
        )
        await session.commit()
        return driver, trip

    @pytest.mark.requires_db
    async def test_sweep_waits_for_a_check_in_and_keeps_the_answer(
        self, session: AsyncSession
    ) -> None:
        now = self.NOW
        _, trip = await self._overdue_check(session)
        maker = db_session.get_sessionmaker()
        async with maker() as check_in, maker() as sweeper:
            # A check-in mid-transaction: row locked, answer not yet committed.
            row = (
                await check_in.execute(
                    select(Emergency).where(Emergency.trip_id == trip.id).with_for_update()
                )
            ).scalar_one()
            row.state = EmergencyState.DRIVER_RESPONDED
            row.driver_response = DriverCheckResponse.REST_STOP
            row.responded_at = now
            await check_in.flush()

            pid = await sweeper.scalar(text("SELECT pg_backend_pid()"))
            sweep = asyncio.create_task(sentinel.run_sentinel_sweep(sweeper, now=now))
            await _until_waiting_on_a_lock(session, pid)
            await check_in.commit()
            swept = await sweep

        assert trip.id not in {e.trip_id for e in swept}
        final = (
            await session.execute(
                select(Emergency)
                .where(Emergency.trip_id == trip.id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert final.state == EmergencyState.DRIVER_RESPONDED
        assert final.driver_response == DriverCheckResponse.REST_STOP

    @pytest.mark.requires_db
    async def test_a_check_in_during_an_escalation_waits_instead_of_deadlocking(
        self, session: AsyncSession
    ) -> None:
        """The sweep holds the emergency and then writes the trip. A check-in
        that locked the trip first deadlocked with it; one lock order means
        the check-in waits and records its late answer on the SOS."""
        driver, trip = await self._overdue_check(session)
        maker = db_session.get_sessionmaker()
        async with maker() as check_in, maker() as sweeper:
            await sentinel.get_active_emergency(sweeper, trip.id, for_update=True)
            pid = await check_in.scalar(text("SELECT pg_backend_pid()"))
            answer = asyncio.create_task(
                sentinel.record_driver_check_in(
                    check_in, driver, trip.id, DriverCheckResponse.REST_STOP, now=self.NOW
                )
            )
            await _until_waiting_on_a_lock(session, pid)
            swept = await sentinel.run_sentinel_sweep(sweeper, now=self.NOW)
            answered = await answer

        assert trip.id in {e.trip_id for e in swept}
        assert answered.state == EmergencyState.SOS_ESCALATED
        assert answered.driver_response == DriverCheckResponse.REST_STOP


    @pytest.mark.requires_db
    async def test_a_trip_cancelled_after_the_sweep_read_it_is_not_escalated(
        self, session: AsyncSession
    ) -> None:
        """The sweep lists trips unlocked. A cancel that commits after that read
        must win: the escalation re-reads the trip under its lock."""
        _, trip = await self._overdue_check(session)
        maker = db_session.get_sessionmaker()
        async with maker() as canceller, maker() as sweeper:
            locked = await trips.load_for_update(canceller, trip.id)
            locked.status = TripStatus.CANCELLED
            await canceller.flush()

            pid = await sweeper.scalar(text("SELECT pg_backend_pid()"))
            sweep = asyncio.create_task(sentinel.run_sentinel_sweep(sweeper, now=self.NOW))
            await _until_waiting_on_a_lock(session, pid)
            await canceller.commit()
            swept = await sweep
            await sweeper.commit()

        assert trip.id not in {e.trip_id for e in swept}
        status = await session.scalar(
            text("SELECT status FROM trips WHERE id = :id"), {"id": trip.id}
        )
        assert status == TripStatus.CANCELLED.value

    @pytest.mark.requires_db
    async def test_a_trip_cancelled_after_the_sweep_read_it_gets_no_new_check(
        self, session: AsyncSession
    ) -> None:
        """No open emergency: a new check-in is decided from the unlocked list.
        A cancel that commits first must leave no emergency and no
        DELAY_DETECTED behind, since nothing would ever close them."""
        trip = await _seed_stationary_active_trip(session, self.NOW)
        maker = db_session.get_sessionmaker()
        async with maker() as canceller, maker() as sweeper:
            locked = await trips.load_for_update(canceller, trip.id)
            locked.status = TripStatus.CANCELLED
            await canceller.flush()

            pid = await sweeper.scalar(text("SELECT pg_backend_pid()"))
            sweep = asyncio.create_task(sentinel.run_sentinel_sweep(sweeper, now=self.NOW))
            await _until_waiting_on_a_lock(session, pid)
            await canceller.commit()
            swept = await sweep

        assert trip.id not in {e.trip_id for e in swept}
        emergencies = await session.scalar(
            select(func.count()).select_from(Emergency).where(Emergency.trip_id == trip.id)
        )
        delays = await session.scalar(
            select(func.count())
            .select_from(TripEvent)
            .where(TripEvent.trip_id == trip.id, TripEvent.kind == TripEventKind.DELAY_DETECTED)
        )
        assert (emergencies, delays) == (0, 0)


class TestRequestId:
    async def test_generated_when_absent_and_kept_when_sane(self, api: AsyncClient) -> None:
        fresh = await api.get("/health")
        assert len(fresh.headers["x-request-id"]) == 36
        kept = await api.get("/health", headers={"X-Request-ID": "edge-abc-123"})
        assert kept.headers["x-request-id"] == "edge-abc-123"
        for bad in ("has space", "semi;colon", "a" * 65):
            r = await api.get("/health", headers={"X-Request-ID": bad})
            assert r.headers["x-request-id"] != bad

    async def test_the_error_envelope_carries_the_same_id(self, api: AsyncClient) -> None:
        r = await api.get("/api/auth/me", headers={"X-Request-ID": "trace-1"})
        assert r.status_code == 401
        assert r.json()["error"]["request_id"] == "trace-1"
        assert r.headers["x-request-id"] == "trace-1"

    async def test_cors_lets_the_browser_send_and_read_it(self, api: AsyncClient) -> None:
        origin = "http://localhost:5173"
        pre = await api.options(
            "/api/auth/me",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "x-request-id",
            },
        )
        assert pre.status_code == 200
        got = await api.get("/health", headers={"Origin": origin})
        assert "x-request-id" in got.headers["access-control-expose-headers"].lower()

    async def test_a_500_logs_and_returns_the_id(self, caplog: pytest.LogCaptureFixture) -> None:
        from app.main import create_app

        app = create_app()

        async def boom() -> None:
            raise RuntimeError("kaboom")

        async def down() -> None:
            raise ServiceUnavailableError("Routing provider unreachable.")

        app.add_api_route("/boom", boom)
        app.add_api_route("/down", down)
        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            with caplog.at_level(logging.WARNING, logger="app.core.errors"):
                r = await c.get("/boom", headers={"X-Request-ID": "trace-500"})
                unavailable = await c.get("/down", headers={"X-Request-ID": "trace-503"})
        assert r.status_code == 500
        assert r.json()["error"]["request_id"] == "trace-500"
        assert r.headers["x-request-id"] == "trace-500"
        assert "request_id=trace-500" in caplog.text
        # A 5xx APIError is traceable in the log too, not only in the envelope.
        assert unavailable.status_code == 503
        assert unavailable.json()["error"]["request_id"] == "trace-503"
        assert "SERVICE_UNAVAILABLE on /down request_id=trace-503" in caplog.text


def _request(peer: str | None, forwarded: str | None) -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    return Request(
        {"type": "http", "headers": headers, "client": (peer, 1234) if peer else None}
    )


class TestAuditClientAddress:
    async def test_the_forged_left_most_entry_is_never_recorded(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.api.deps import get_client_ip
        from app.core.config import get_settings

        forged = "1.2.3.4, 203.0.113.9"
        monkeypatch.setenv("TRUSTED_PROXY_HOPS", "0")
        get_settings.cache_clear()
        assert await get_client_ip(_request("10.0.0.7", forged)) == "10.0.0.7"

        monkeypatch.setenv("TRUSTED_PROXY_HOPS", "1")
        get_settings.cache_clear()
        assert await get_client_ip(_request("10.0.0.7", forged)) == "203.0.113.9"
        # Not an address: dropped, not written into the INET column.
        assert await get_client_ip(_request("10.0.0.7", "not-an-ip")) is None
        assert await get_client_ip(_request(None, None)) is None
