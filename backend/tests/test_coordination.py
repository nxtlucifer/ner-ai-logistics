"""More than one API instance (services/coordination.py, MULTI_INSTANCE).

Each "instance" here is a distinct holder or limiter object on its own
session: what two processes would share is only the database, so that is all
these share. The multi-process proof runs the same calls from two processes.
"""

import asyncio
import hashlib
import uuid
from datetime import timedelta

import pytest
import pytest_asyncio
from fastapi import FastAPI
from geoalchemy2 import WKTElement
from sqlalchemy import event, func, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import TimeoutError as PoolTimeout
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import Pool

from app.api import auth as auth_api
from app.core.config import get_settings
from app.core.errors import RateLimitedError
from app.core.rate_limit import GcraLimiter
from app.db import session as db_session
from app.main import lifespan
from app.models.enums import RouteKind, RouteState, TripStatus, UserRole
from app.models.operations import DriverNotification, TripRoute
from app.services import coordination, geocoding, notify, route_watch, simulation
from tests import factories
from tests.test_route_watch import GEOMETRY, _ahead

pytestmark = pytest.mark.requires_db

TABLES = ("instance_leases", "rate_limit_windows", "provider_pacing")


def _multi(monkeypatch, on: bool = True) -> None:
    monkeypatch.setenv("MULTI_INSTANCE", "true" if on else "false")
    get_settings.cache_clear()


@pytest_asyncio.fixture(autouse=True)
async def _own_coordination_pool():
    """The coordination engine is a process singleton, but each test runs on
    its own event loop: once its pool of one has queued a checkout in one
    loop, a queued checkout in the next fails ('bound to a different event
    loop'). So each test starts on a fresh pool, and its connection does not
    outlive the test."""
    yield
    if db_session._coordination_engine is not None:
        await db_session._coordination_engine.dispose()
    db_session._coordination_engine = db_session._coordination_sessionmaker = None


async def _delete(table: str, column: str, value: str) -> None:
    async with db_session.get_sessionmaker()() as db:
        await db.execute(text(f"DELETE FROM {table} WHERE {column} = :v"), {"v": value})
        await db.commit()


async def test_one_leader_renewal_keeps_it_expiry_hands_it_over() -> None:
    name = f"test-lease-{uuid.uuid4().hex[:8]}"
    try:
        assert await coordination.lead(name, 0.6, holder="A")
        assert not await coordination.lead(name, 0.6, holder="B")
        await asyncio.sleep(0.4)
        assert await coordination.lead(name, 0.6, holder="A")  # renewed: now expires ~1.0 s
        await asyncio.sleep(0.4)  # past the FIRST expiry, inside the renewed one
        assert not await coordination.lead(name, 0.6, holder="B")
        await asyncio.sleep(0.7)  # A stopped renewing
        assert await coordination.lead(name, 0.6, holder="B")
        assert not await coordination.lead(name, 0.6, holder="A")
    finally:
        await _delete("instance_leases", "name", name)


async def test_release_hands_this_instances_leases_over_at_once() -> None:
    """Shutdown (lifespan) gives the leases up; otherwise a deploy leaves the
    loops unled until the old lease expires."""
    a, b = (f"test-holder-{uuid.uuid4().hex[:8]}" for _ in range(2))
    mine, theirs = (f"test-lease-{uuid.uuid4().hex[:8]}" for _ in range(2))
    try:
        assert await coordination.lead(mine, 60, holder=a)
        assert await coordination.lead(theirs, 60, holder=b)
        await coordination.release(holder=a)
        assert await coordination.lead(mine, 60, holder=b)  # free now, not in 60 s
        assert not await coordination.lead(theirs, 60, holder=a)  # only a's leases went
    finally:
        await _delete("instance_leases", "name", mine)
        await _delete("instance_leases", "name", theirs)


async def _moving_trip(session):
    """An ACTIVE trip on a selected route, its driver holding a push token."""
    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck)
    trip = await factories.make_trip(session, driver, truck, assignment=assignment, status=TripStatus.ACTIVE)
    wkt = "LINESTRING({})".format(", ".join(f"{lon} {lat}" for lat, lon in GEOMETRY))
    route = TripRoute(trip_id=trip.id, kind=RouteKind.PRIMARY, state=RouteState.SELECTED, geometry=WKTElement(wkt, srid=4326),
                      distance_km=100, estimated_duration_min=180, routing_provider="stub")
    session.add(route)
    await session.flush()
    trip.selected_route_id = route.id
    driver.push_token = "ExponentPushToken[t]"
    await session.commit()
    return trip


async def _tick(holder: str, now: float) -> list[dict]:
    """What main.py's _watch_loop does each tick, as instance `holder`."""
    async with db_session.get_sessionmaker()() as db:
        return await route_watch.run_tick(db, now=now, holder=holder)


async def test_two_instances_ticking_route_watch_push_once(session, monkeypatch) -> None:
    """A standing hazard, two instances ticking at the same moment: exactly one
    push attempt. Ungated, both pass notify's check-then-insert cooldown before
    either row exists, and the driver gets it twice."""
    trip = await _moving_trip(session)
    attempts = []

    async def relay(token, title, body, data):
        if data.get("trip_id") == str(trip.id):
            attempts.append(title)
        await asyncio.sleep(0.3)  # a real push takes time; the other instance runs meanwhile
        return "SENT"

    async def fake_look(db, trip_id, route_id):
        return _ahead("CONTINUE", ("OFFICIAL_WARNING_ON_ROUTE",), "LOW"), None

    monkeypatch.setattr(notify, "_deliver", relay)
    monkeypatch.setattr(route_watch, "look_ahead", fake_look)
    monkeypatch.setenv("PUSH_ENABLED", "true")
    _multi(monkeypatch)
    route_watch._STATE.clear()
    await _delete("instance_leases", "name", "route_watch")

    try:
        ran = await asyncio.gather(_tick("A", 1_000_000.0), _tick("B", 1_000_000.0))
        assert attempts == ["Official warning on your route"]
        assert sorted(map(len, ran)) == [0, 1]  # one instance ticked, the other skipped
    finally:
        route_watch._STATE.clear()
        await _delete("instance_leases", "name", "route_watch")


async def test_a_leader_that_loses_the_lease_mid_tick_stops_at_the_next_trip(session, monkeypatch) -> None:
    """The first pass after a takeover has every trip due, each waiting on
    provider timeouts, so it can outlast the lease. Renewed per trip, a leader
    that lost it stops before the next trip instead of pushing alongside the
    new one, and forgets what it saw."""
    for _ in range(2):
        await _moving_trip(session)
    looked = []

    async def look_while_b_takes_over(db, trip_id, route_id):
        looked.append(trip_id)
        async with db_session.get_sessionmaker()() as other:
            await other.execute(text("UPDATE instance_leases SET holder = 'B' WHERE name = 'route_watch'"))
            await other.commit()
        return _ahead(), None

    monkeypatch.setattr(route_watch, "look_ahead", look_while_b_takes_over)
    _multi(monkeypatch)
    route_watch._STATE.clear()
    await _delete("instance_leases", "name", "route_watch")
    try:
        done = await _tick("A", 1_000_000.0)
        assert len(looked) == len(done) == 1  # the second trip was left to B
        assert route_watch._STATE == {}
    finally:
        route_watch._STATE.clear()
        await _delete("instance_leases", "name", "route_watch")


async def test_a_regained_lease_starts_from_empty_state(session, monkeypatch) -> None:
    """Reviewer's case: A pushes W, loses the lease to B, B sees W clear, W
    returns and B dies. A regains the lease and must push W again; remembering
    its own stale look (W already told), it said nothing. Each instance has its
    own _STATE, as two processes would."""
    trip = await _moving_trip(session)
    pushes, world = [], {"codes": ("OFFICIAL_WARNING_ON_ROUTE",)}

    async def relay(token, title, body, data):
        if data.get("trip_id") == str(trip.id):
            pushes.append(title)
        return "SENT"

    async def fake_look(db, trip_id, route_id):
        return _ahead("CONTINUE", world["codes"], "LOW"), None

    monkeypatch.setattr(notify, "_deliver", relay)
    monkeypatch.setattr(notify, "DEFAULT_COOLDOWN_S", 0)  # the return is long after the last push
    monkeypatch.setattr(route_watch, "look_ahead", fake_look)
    monkeypatch.setenv("PUSH_ENABLED", "true")
    monkeypatch.setenv("ROUTE_WATCH_TICK_SECONDS", "1")
    monkeypatch.setattr(coordination, "LEASE_INTERVALS", 1.0)  # lease: 1 s
    _multi(monkeypatch)
    state, shared = {"A": {}, "B": {}}, route_watch._STATE
    await _delete("instance_leases", "name", "route_watch")

    async def tick(holder: str, now: float) -> list[dict]:
        route_watch._STATE = state[holder]
        try:
            return await _tick(holder, now)
        finally:
            route_watch._STATE = shared

    try:
        assert await tick("A", 1_000.0) and len(pushes) == 1  # A leads, pushes W
        await asyncio.sleep(1.1)  # A stalls past its lease
        assert await tick("B", 2_000.0) and len(pushes) == 2  # B takes over, re-pushes as after a restart
        assert await tick("A", 2_001.0) == []  # A is back while B leads: skips
        world["codes"] = ()
        assert await tick("B", 3_000.0)  # W clears; B sees it
        world["codes"] = ("OFFICIAL_WARNING_ON_ROUTE",)
        await asyncio.sleep(1.1)  # W returns, and B dies
        assert await tick("A", 4_000.0)  # A regains the lease
        assert len(pushes) == 3, "W is back on the road ahead and nobody told the driver"
    finally:
        route_watch._STATE.clear()
        await _delete("instance_leases", "name", "route_watch")


async def test_a_win_more_than_a_lease_after_the_last_forgets_state(monkeypatch) -> None:
    """A stall past the lease that never sees a refusal or an error: the next
    win may be a re-acquisition after another leader came and went, so what
    this instance remembers goes, as on a lost lease."""
    monkeypatch.setenv("ROUTE_WATCH_TICK_SECONDS", "1")
    monkeypatch.setattr(coordination, "LEASE_INTERVALS", 1.0)  # lease: 1 s
    monkeypatch.setattr(route_watch, "_renewed_at", None)
    holder, seen = f"test-holder-{uuid.uuid4().hex[:8]}", uuid.uuid4()
    await _delete("instance_leases", "name", "route_watch")
    try:
        # One instance: no lease, so no gap rule; state survives a slow tick.
        _multi(monkeypatch, on=False)
        route_watch._STATE[seen] = route_watch.Watched(last_assessed=0.0, ahead=_ahead())
        monkeypatch.setattr(route_watch, "_renewed_at", 0.0)
        assert await route_watch._still_leading(holder) and seen in route_watch._STATE

        _multi(monkeypatch)
        monkeypatch.setattr(route_watch, "_renewed_at", None)
        assert await route_watch._still_leading(holder)
        assert await route_watch._still_leading(holder) and seen in route_watch._STATE  # renewed in time
        await asyncio.sleep(1.1)  # stalled past the lease
        assert await route_watch._still_leading(holder)  # won, maybe not as a renewal
        assert route_watch._STATE == {}
    finally:
        route_watch._STATE.clear()
        await _delete("instance_leases", "name", "route_watch")


async def _sent(trip_ids) -> int:
    async with db_session.get_sessionmaker()() as db:
        return await db.scalar(
            select(func.count()).select_from(DriverNotification)
            .where(DriverNotification.trip_id.in_(trip_ids), DriverNotification.delivery == "SENT")
        )


async def test_a_lease_error_between_trips_stands_down_and_keeps_the_push(session, monkeypatch, caplog) -> None:
    """The lease check before the second trip fails (a pool timeout). The
    leader stands down as on a lost lease instead of failing the tick, and the
    push it already delivered stays on record, so the next leader's cooldown
    holds it back: the driver hears each warning once."""
    trips = [await _moving_trip(session) for _ in range(2)]
    ids = {str(t.id) for t in trips}
    pushes, calls = [], []

    async def relay(token, title, body, data):
        if data.get("trip_id") in ids:
            pushes.append(data["trip_id"])
        return "SENT"

    async def fake_look(db, trip_id, route_id):
        return _ahead("CONTINUE", ("OFFICIAL_WARNING_ON_ROUTE",), "LOW"), None

    async def flaky_turn(name, interval_s, *, holder=None):
        calls.append(holder)
        if holder == "A" and len(calls) == 3:  # top of the tick, trip 1, then before trip 2
            raise PoolTimeout("QueuePool limit reached, connection timed out")
        return True

    monkeypatch.setattr(notify, "_deliver", relay)
    monkeypatch.setattr(route_watch, "look_ahead", fake_look)
    monkeypatch.setattr(coordination, "my_turn", flaky_turn)
    monkeypatch.setenv("PUSH_ENABLED", "true")
    _multi(monkeypatch)
    route_watch._STATE.clear()
    try:
        done = await _tick("A", 1_000_000.0)
        assert len(done) == len(pushes) == 1 and route_watch._STATE == {}
        assert "lease check failed" in caplog.text
        assert await _sent([t.id for t in trips]) == 1
        await _tick("B", 1_000_100.0)  # the next leader, empty state as after a restart
        assert sorted(pushes) == sorted(ids)  # B pushed only the trip A never reached
    finally:
        route_watch._STATE.clear()


async def test_a_later_trip_failing_keeps_the_push_already_delivered(session, monkeypatch) -> None:
    """Trip 2's evidence fails and the tick rolls back to go on. Trip 1's push
    went out, so its row (and with it the cooldown) was committed first."""
    trips = [await _moving_trip(session) for _ in range(2)]
    looked = []

    async def relay(token, title, body, data):
        return "SENT"

    async def look_then_fail(db, trip_id, route_id):
        looked.append(trip_id)
        if len(looked) == 2:
            raise RuntimeError("provider down")
        return _ahead("CONTINUE", ("OFFICIAL_WARNING_ON_ROUTE",), "LOW"), None

    monkeypatch.setattr(notify, "_deliver", relay)
    monkeypatch.setattr(route_watch, "look_ahead", look_then_fail)
    monkeypatch.setenv("PUSH_ENABLED", "true")
    route_watch._STATE.clear()
    try:
        async with db_session.get_sessionmaker()() as db:
            done = await route_watch.run_tick(db, now=1_000_000.0)
        assert len(looked) == 2 and len(done) == 1
        assert await _sent([t.id for t in trips]) == 1
    finally:
        route_watch._STATE.clear()


async def test_two_instances_share_one_login_budget_and_one_reset(monkeypatch) -> None:
    _multi(monkeypatch)
    key = f"id:test-{uuid.uuid4().hex[:8]}"
    # Two processes' module-level limiters: same policy, separate memory.
    a = GcraLimiter(limit=3, window=timedelta(seconds=60))
    b = GcraLimiter(limit=3, window=timedelta(seconds=60))
    try:
        await auth_api._enforce(a, key)
        await auth_api._enforce(b, key)
        await auth_api._enforce(a, key)
        with pytest.raises(RateLimitedError):
            await auth_api._enforce(b, key)  # the 4th attempt, whichever instance takes it
        assert await _stored(key) == [hashlib.sha256(key.encode()).hexdigest()]  # never the identifier itself
        await auth_api._reset(a, key)  # a success on A...
        await auth_api._enforce(b, key)  # ...clears the budget on B too
        assert a._windows == b._windows == {}  # nothing was counted in memory

        # The same rule as GcraLimiter.check, refill included.
        mem = GcraLimiter(limit=2, window=timedelta(seconds=0.5))
        shared = [await coordination.allow(f"{key}:parity", 2, 0.5) for _ in range(4)]
        local = [mem.check("k") for _ in range(4)]
        assert [(d.allowed, d.used) for d in shared] == [(d.allowed, d.used) for d in local]
        assert shared[-1].retry_after >= 1
        await asyncio.sleep(0.6)
        again = await coordination.allow(f"{key}:parity", 2, 0.5)
        assert again.allowed and again.used == 1
        assert await _stored(key)  # that call's short window did not prune the 60 s budget
    finally:
        await coordination.reset(key)
        await coordination.reset(f"{key}:parity")


async def test_rate_limit_calls_leave_the_lease_pool_alone(monkeypatch) -> None:
    """Login traffic is anyone's to drive. With the coordination pool's only
    connection taken (a lease renewal in flight), allow() and reset() still
    finish: they run on the request pool, so a login flood never queues ahead
    of a lease renewal."""
    _multi(monkeypatch)
    key = f"id:test-{uuid.uuid4().hex[:8]}"
    try:
        async with db_session.get_coordination_sessionmaker()() as renewal:
            await renewal.execute(text("SELECT 1"))
            decisions = await asyncio.wait_for(asyncio.gather(*(coordination.allow(key, 3, 60) for _ in range(5))), 3)
            # Every call finished. GCRA: three pass; the refused two do not
            # advance the TAT, so each reports the 4th unit it would have been.
            assert sorted((not d.allowed, d.used) for d in decisions) == [
                (False, 1), (False, 2), (False, 3), (True, 4), (True, 4)]
            await asyncio.wait_for(coordination.reset(key), 3)
            assert await _stored(key) == []
    finally:
        await coordination.reset(key)


async def test_a_failed_budget_reset_does_not_fail_a_committed_login(api, session, monkeypatch, caplog) -> None:
    """The reset runs after the login committed its tokens. A database hiccup
    there leaves the identifier budget uncleared (stricter), not a 503 for a
    login that already happened."""
    _multi(monkeypatch)
    user = await factories.make_user(session, role=UserRole.MANAGER)
    real_reset = coordination.reset

    async def down(key):
        raise PoolTimeout("QueuePool limit reached, connection timed out")

    monkeypatch.setattr(coordination, "reset", down)
    try:
        r = await api.post("/api/auth/login", json={"identifier": user.email, "password": factories.TEST_PASSWORD})
        assert r.status_code == 200, r.text
        assert "login budget reset failed" in caplog.text
    finally:
        await real_reset(f"id:{user.email.strip().casefold()}")
        await real_reset("ip:127.0.0.1")


async def test_a_refused_address_is_turned_away_before_the_database(api, monkeypatch) -> None:
    """F1. With MULTI_INSTANCE every 429 still ran an upsert on the request
    pool, so one address sending attempts past its budget queued every other
    endpoint behind it (an ordinary request went 263 ms -> 6.74 s behind 100
    refusals). The per-address budgets, never reset, are checked in this
    process first: its attempts are part of the shared count, so a local
    refusal takes no connection. The pool's only connection is held
    throughout, so a refusal that needed one would wait and time out, and the
    checkout spy sees any that got one."""
    _multi(monkeypatch)
    auth_api._configure_limiters()
    for limiter, key in ((auth_api._login_ip_limiter, "ip:127.0.0.1"), (auth_api._refresh_ip_limiter, "refresh:127.0.0.1")):
        for _ in range(limiter.limit):
            limiter.check(key)  # this instance's budget for the address, spent
    main = db_session._engine, db_session._sessionmaker
    tiny = create_async_engine(get_settings().effective_database_url, pool_size=1, max_overflow=0)
    db_session._engine, db_session._sessionmaker = tiny, async_sessionmaker(tiny)
    checkouts: list[object] = []

    def spy(*args) -> None:
        checkouts.append(args)

    try:
        async with db_session.get_sessionmaker()() as ordinary:
            await ordinary.execute(text("SELECT 1"))  # an ordinary request holds the pool's only connection
            event.listen(Pool, "checkout", spy)
            flood = [api.post("/api/auth/login", json={"identifier": f"flood{i}@example.com", "password": "wrong-password"})
                     for i in range(50)]
            flood += [api.post("/api/auth/refresh", json={}) for _ in range(50)]
            answers = await asyncio.wait_for(asyncio.gather(*flood), 10)
            assert {r.status_code for r in answers} == {429}
            assert min(int(r.headers["retry-after"]) for r in answers) >= 1
            assert checkouts == []  # no connection taken, so nothing waits behind the flood
    finally:
        if event.contains(Pool, "checkout", spy):
            event.remove(Pool, "checkout", spy)
        db_session._engine, db_session._sessionmaker = main
        await tiny.dispose()


async def test_an_address_still_spends_one_budget_across_instances(monkeypatch) -> None:
    """The local check only sheds; within it, the address still counts in the
    shared window, so instance B refuses what A used up."""
    _multi(monkeypatch)
    key = f"ip:test-{uuid.uuid4().hex[:8]}"
    a = GcraLimiter(limit=2, window=timedelta(seconds=60))
    b = GcraLimiter(limit=2, window=timedelta(seconds=60))
    try:
        await auth_api._enforce(a, key, per_address=True)
        await auth_api._enforce(a, key, per_address=True)
        with pytest.raises(RateLimitedError):
            await auth_api._enforce(b, key, per_address=True)  # B has seen one attempt; the shared window, three
        assert len(b._windows) == 1
    finally:
        await coordination.reset(key)


async def test_a_new_window_prunes_expired_ones() -> None:
    """F2. Attacker-chosen keys must not pile up: a fresh key's first row
    deletes the rows whose TAT has passed (a full budget is no row at all)."""
    stale, fresh = f"id:test-{uuid.uuid4().hex[:8]}", f"id:test-{uuid.uuid4().hex[:8]}"
    async with db_session.get_sessionmaker()() as db:
        await db.execute(
            text("INSERT INTO rate_limit_windows (key, window_start, hits) "
                 "VALUES (:k, now() - make_interval(secs => :age), 7)"),
            # window_start holds the TAT (GCRA): any time in the past prunes.
            {"k": hashlib.sha256(stale.encode()).hexdigest(),
             "age": max(60, get_settings().RATE_LIMIT_WINDOW_SECONDS) + 5},
        )
        await db.commit()
    try:
        assert await _stored(stale)
        assert (await coordination.allow(fresh, 3, 60)).used == 1
        assert await _stored(stale) == []
    finally:
        await coordination.reset(stale)
        await coordination.reset(fresh)


def _lifespan_env(monkeypatch) -> None:
    """MULTI_INSTANCE on, the three background loops off."""
    for k in ("SENTINEL_SCHEDULER_ENABLED", "WARNINGS_POLL_ENABLED", "ROUTE_WATCH_ENABLED"):
        monkeypatch.setenv(k, "false")
    _multi(monkeypatch)


async def test_shutdown_releases_this_instances_leases(monkeypatch) -> None:
    """F3. lifespan's exit hands this INSTANCE_ID's leases over and disposes
    the coordination pool after it."""
    _lifespan_env(monkeypatch)
    name = f"test-lease-{uuid.uuid4().hex[:8]}"
    try:
        assert await coordination.lead(name, 600)  # held as INSTANCE_ID
        assert db_session._coordination_engine is not None
        async with lifespan(FastAPI()):
            pass
        assert db_session._coordination_engine is None  # disposed, after the release
        assert await coordination.lead(name, 600, holder="B")  # free at once, not in 600 s
    finally:
        await _delete("instance_leases", "name", name)


async def test_a_failing_release_is_logged_and_shutdown_goes_on(monkeypatch, caplog) -> None:
    _lifespan_env(monkeypatch)

    async def down(**_):
        raise RuntimeError("database gone")

    monkeypatch.setattr(coordination, "release", down)
    db_session.get_engine()
    async with lifespan(FastAPI()):
        pass
    assert "lease release failed: RuntimeError" in caplog.text
    assert db_session._engine is None  # dispose_engine still ran


async def _stored(key: str) -> list[str]:
    digest = hashlib.sha256(key.encode()).hexdigest()
    async with db_session.get_sessionmaker()() as db:
        rows = await db.execute(text("SELECT key FROM rate_limit_windows WHERE key IN (:k, :d)"), {"k": key, "d": digest})
        return list(rows.scalars())


async def test_pace_spaces_concurrent_callers_across_sessions() -> None:
    name = f"test-pace-{uuid.uuid4().hex[:8]}"
    loop = asyncio.get_running_loop()

    async def caller():
        slot = await coordination.pace(name, 1.0)
        return slot, loop.time()

    try:
        (s1, t1), (s2, t2) = await asyncio.gather(caller(), caller())
        assert abs(s2 - s1) >= 1.0 - 1e-6
        assert abs(t2 - t1) >= 0.95
    finally:
        await _delete("provider_pacing", "name", name)


async def test_nominatim_pacing_does_not_wait_behind_the_request_pool(monkeypatch) -> None:
    """A geocoding request already holds a connection (get_current_user ran),
    here the main pool's only one. Pacing must still get its slot at once from
    a pool of its own; on the shared pool it waited pool_timeout (30 s), under
    the Nominatim lock, and every other request on the instance waited too."""
    _multi(monkeypatch)
    monkeypatch.setattr(geocoding, "_last_request", 0.0)
    await _delete("provider_pacing", "name", "nominatim")
    main = db_session._engine, db_session._sessionmaker
    tiny = create_async_engine(get_settings().effective_database_url, pool_size=1, max_overflow=0)
    db_session._engine, db_session._sessionmaker = tiny, async_sessionmaker(tiny)
    loop = asyncio.get_running_loop()
    try:
        async with db_session.get_sessionmaker()() as request:
            await request.execute(text("SELECT 1"))  # the request's connection, held
            began = loop.time()
            await asyncio.wait_for(geocoding._throttle(), 5)
            assert loop.time() - began < 1.0
    finally:
        db_session._engine, db_session._sessionmaker = main
        await tiny.dispose()
        await _delete("provider_pacing", "name", "nominatim")


async def test_nominatim_pacing_failure_falls_back_to_the_local_second(monkeypatch, caplog) -> None:
    """No shared slot (pool timeout, database down): the search goes ahead on
    this instance's own one-per-second wait instead of failing as a 500."""
    _multi(monkeypatch)

    async def down(name, spacing_s, **_):
        raise PoolTimeout("QueuePool limit reached, connection timed out")

    monkeypatch.setattr(coordination, "pace", down)
    monkeypatch.setattr(geocoding, "_last_request", 0.0)
    await geocoding._throttle()
    assert "local 1 s only: TimeoutError" in caplog.text  # the pool's error, not a bad call
    assert geocoding._last_request > 0  # the next caller still waits its second


async def test_nominatim_pacing_gives_up_on_a_busy_pool_within_a_second(monkeypatch, caplog) -> None:
    """The coordination pool's connection is taken. The search waits at most
    1 s for a slot, not the pool's 5 s timeout: it holds the Nominatim lock
    meanwhile, and every search on the instance queues behind it."""
    _multi(monkeypatch)
    monkeypatch.setattr(geocoding, "_last_request", 0.0)
    loop = asyncio.get_running_loop()
    async with db_session.get_coordination_sessionmaker()() as renewal:
        await renewal.execute(text("SELECT 1"))
        began = loop.time()
        await geocoding._throttle()
        took = loop.time() - began
    assert 0.9 <= took < 2.0
    assert "nominatim pacing unavailable" in caplog.text


async def test_nominatim_pacing_still_waits_for_a_slot_further_off(monkeypatch, caplog) -> None:
    """The 1 s bound is on the reservation, not the wait. Other instances hold
    the next 1.6 s of slots: this search waits its turn instead of giving up
    at 1 s and going early."""
    _multi(monkeypatch)
    monkeypatch.setattr(geocoding, "_last_request", 0.0)
    async with db_session.get_sessionmaker()() as db:
        await db.execute(text(
            "INSERT INTO provider_pacing (name, next_at) VALUES ('nominatim', now() + interval '1.6 seconds') "
            "ON CONFLICT (name) DO UPDATE SET next_at = excluded.next_at"
        ))
        await db.commit()
    loop = asyncio.get_running_loop()
    try:
        began = loop.time()
        await geocoding._throttle()
        assert loop.time() - began >= 1.5
        assert "nominatim pacing unavailable" not in caplog.text
    finally:
        await _delete("provider_pacing", "name", "nominatim")


async def test_single_instance_never_touches_the_coordination_tables(api, session, monkeypatch) -> None:
    _multi(monkeypatch, on=False)
    monkeypatch.setenv("DEMO_SIMULATION_ENABLED", "true")
    seen: list[str] = []

    def spy(conn, cursor, statement, *args):
        if any(t in statement for t in TABLES):
            seen.append(statement)

    # Every engine, the coordination pool included.
    event.listen(Engine, "before_cursor_execute", spy)
    try:
        user = await factories.make_user(session, role=UserRole.MANAGER)
        assert await coordination.my_turn("route_watch", 60)
        bad = await api.post("/api/auth/login", json={"identifier": user.email, "password": "wrong-password"})
        good = await api.post("/api/auth/login", json={"identifier": user.email, "password": factories.TEST_PASSWORD})
        assert (bad.status_code, good.status_code) == (401, 200)
        await api.post("/api/auth/refresh", json={})  # the refresh limiter (cookie from the login above)
        monkeypatch.setattr(geocoding, "_last_request", 0.0)
        await geocoding._throttle()
        assert simulation.enabled()
        assert seen == []

        # The spy does see the tables once the switch is on, so the silence above is real.
        _multi(monkeypatch)
        assert not simulation.enabled()
        assert await coordination.my_turn("test-spy", 60)
        assert seen
    finally:
        event.remove(Engine, "before_cursor_execute", spy)
        await _delete("instance_leases", "name", "test-spy")
