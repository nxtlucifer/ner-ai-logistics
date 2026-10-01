"""docs/RATE_LIMIT_POLICY.md, proven (P0-B).

  unit   GCRA with an injected clock: the window edge, cost, the GPS cadence.
  wiring every limited route carries the bucket the policy names, read from
         the routes themselves.
  http   the real endpoints answer 429 + Retry-After at the documented budget,
         and the callers who must NOT meet one do not: many users behind one
         NAT, the first SOS of a trip, a truck at its tracker cadence, /health.
  multi  MULTI_INSTANCE: two instances spend one budget, and it outlives a
         restart.

Before this lane only login and refresh were limited (audit AG-13): the plan,
geocoding, AI, upload, password and reroute cases below all answered 2xx/4xx
without end.
"""

import asyncio
import hashlib
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.api import ai as ai_api
from app.api import deps
from app.api.driver import CHECK_IN_REFUSED, SOS_ALREADY_OPEN
from app.core import rate_limit as rl
from app.core.config import get_settings
from app.core.errors import RateLimitedError
from app.core.rate_limit import POLICIES, GcraLimiter, limiter_for
from app.db import session as db_session
from app.models.emergency import Emergency
from app.models.enums import EmergencyState, TripStatus, UserRole
from app.services import coordination, gemini, geocoding
from tests import factories
from tests.conftest import auth_headers

T0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)


def _is_429(r) -> None:
    assert r.status_code == 429, r.text
    assert r.json()["error"]["code"] == "RATE_LIMITED"
    assert int(r.headers["retry-after"]) >= 1


def _spend(bucket: str, subject: object, units: int) -> None:
    """Use up `units` of a user's in-process budget, as earlier traffic would."""
    limiter = deps._USER_LIMITERS[bucket]
    for _ in range(units):
        limiter.check(f"{bucket}:{subject}")


# --------------------------------------------------------------------------
# unit: the algorithm


class TestGcra:
    def test_a_window_edge_no_longer_doubles_the_limit(self) -> None:
        """Audit case C. The fixed window let 20 through just before its edge
        and 20 more just after: 40 inside 20 ms. GCRA has no edge."""
        limiter = GcraLimiter(limit=20, window=timedelta(seconds=4))
        assert limiter.check("k", now=T0).allowed  # the old window starts here
        edge = T0 + timedelta(seconds=4)
        before = sum(limiter.check("k", now=edge - timedelta(milliseconds=10)).allowed for _ in range(20))
        after = sum(limiter.check("k", now=edge + timedelta(milliseconds=10)).allowed for _ in range(20))
        assert before + after <= 20, f"{before} + {after} passed across one edge"

    def test_no_interval_admits_more_than_burst_plus_rate(self) -> None:
        """The whole claim: any interval of length t, wherever it falls, holds
        at most burst + t / interval allowed attempts."""
        limiter = GcraLimiter(limit=20, window=timedelta(seconds=4), burst=20)
        interval = 4 / 20
        passed = [
            i * 0.05
            for i in range(400)  # an attempt every 50 ms for 20 s
            if limiter.check("k", now=T0 + timedelta(seconds=i * 0.05)).allowed
        ]
        for length in (0.1, 1.0, 4.0, 10.0):
            worst = max(sum(1 for t in passed if a <= t < a + length) for a in passed)
            assert worst <= 20 + length / interval + 1, (length, worst)

    def test_refusals_do_not_push_the_budget_away(self) -> None:
        """A caller who keeps retrying gets the sustained rate - no reset, and
        no lock-out that grows with each refused attempt."""
        limiter = GcraLimiter(limit=6, window=timedelta(seconds=60))  # one per 10 s
        for _ in range(6):
            assert limiter.check("k", now=T0).allowed
        refused = limiter.check("k", now=T0 + timedelta(seconds=1))
        assert not refused.allowed and refused.retry_after == 9
        for s in range(2, 10):
            assert not limiter.check("k", now=T0 + timedelta(seconds=s)).allowed
        assert limiter.check("k", now=T0 + timedelta(seconds=10)).allowed

    def test_cost_is_units_and_a_cost_above_the_burst_is_charged_as_the_burst(self) -> None:
        limiter = GcraLimiter(limit=60, window=timedelta(seconds=60), burst=1000)
        assert limiter.check("k", now=T0, cost=500).used == 500
        assert limiter.check("k", now=T0, cost=500).allowed
        assert not limiter.check("k", now=T0, cost=1).allowed  # 1000 spent
        # One request larger than the whole bucket is not refused forever.
        huge = GcraLimiter(limit=1, window=timedelta(seconds=1), burst=5)
        assert huge.check("k", now=T0, cost=50).allowed

    def test_the_tracker_cadence_is_never_refused(self) -> None:
        """Class D. The server's cadence (1 fix / 10 s moving, 1 / 60 s parked),
        a 6 h dead zone whose 500-fix queue is flushed 100 at a time within
        five seconds, then the cadence again: nothing is refused."""
        gps = limiter_for(POLICIES["gps"])
        t = T0
        for _ in range(6 * 360):  # 6 h moving, one fix per upload
            assert gps.check("d", now=t, cost=1).allowed
            t += timedelta(seconds=10)
        t += timedelta(hours=6)  # dead zone: nothing sent, queue fills to 500
        for i in range(5):
            assert gps.check("d", now=t + timedelta(seconds=i), cost=100).allowed
        t += timedelta(seconds=10)
        for _ in range(360):  # an hour parked, then an hour moving
            assert gps.check("d", now=t, cost=1).allowed
            t += timedelta(seconds=60)
        for _ in range(360):
            assert gps.check("d", now=t, cost=1).allowed
            t += timedelta(seconds=10)

    def test_a_runaway_tracker_is_turned_back_with_a_retry_time(self) -> None:
        gps = limiter_for(POLICIES["gps"])
        assert gps.check("d", now=T0, cost=500).allowed
        assert gps.check("d", now=T0, cost=500).allowed
        refused = gps.check("d", now=T0, cost=500)
        assert not refused.allowed and refused.retry_after == 500  # 1 fix/s


class TestIpGuard:
    async def test_the_per_ip_guard_binds_past_twenty_users_worth_and_only_counts_admitted_users(self) -> None:
        """The coarse guard exists: an address spending 20 users' full budgets
        is refused even for a fresh user. And user first: attempts a user's
        own budget refuses do not spend the address's guard."""
        from starlette.requests import Request

        nat = Request({"type": "http", "method": "GET", "path": "/", "headers": [], "client": ("203.0.113.9", 1)})
        policy = POLICIES["geocoding"]
        guard = policy.burst * policy.ip_multiple
        for i in range(guard - 1):
            await deps.charge("geocoding", nat, f"user-{i // policy.burst}")
        for _ in range(5):  # user-0 is out of budget: refused, and the guard is not spent
            with pytest.raises(RateLimitedError):
                await deps.charge("geocoding", nat, "user-0")
        await deps.charge("geocoding", nat, "fresh-1")  # the guard's last unit
        with pytest.raises(RateLimitedError):
            await deps.charge("geocoding", nat, "fresh-2")


# --------------------------------------------------------------------------
# wiring: the routes carry the policy

#: docs/RATE_LIMIT_POLICY.md section 5, as route dependencies.
ROUTE_BUCKETS = {
    ("POST", "/api/auth/logout"): "public",
    ("POST", "/api/auth/password"): "password",
    ("GET", "/ready"): "public",
    ("GET", "/api/org/regions"): "public",
    ("POST", "/api/trips/plan"): "route_plan",
    ("POST", "/api/shipments"): "route_plan",
    ("POST", "/api/trips/{trip_id}/routes/recalculate"): "route_plan",
    ("GET", "/api/trips/{trip_id}/routes/{route_id}/risk"): "route_assess",
    ("GET", "/api/trips/{trip_id}/routes/recommendation"): "route_assess",
    ("GET", "/api/trips/{trip_id}/reroute"): "route_assess",
    ("GET", "/api/geocoding/suggest"): "geocoding",
    ("GET", "/api/geocoding/details"): "geocoding",
    ("POST", "/api/geocoding/resolve-link"): "geocoding",
    ("GET", "/api/driver/me/trip/route-risk"): "driver_route",
    ("GET", "/api/driver/me/trip/navigation"): "driver_route",
    ("GET", "/api/driver/me/trip/offline-package"): "driver_route",
    ("POST", "/api/driver/me/trip/reroute"): "driver_reroute",
    ("GET", "/api/places"): "places",
    ("GET", "/api/driver/me/trip/places"): "places",
    ("POST", "/api/ai/ask"): "ai_ask",
    ("POST", "/api/files"): "upload",
    ("POST", "/api/emergencies/sweep"): "emergency_sweep",
}


def _routes():
    from app.main import create_app

    return [r for r in create_app().routes if isinstance(r, APIRoute)]


class TestWiring:
    def test_every_limited_route_carries_its_bucket_and_no_other_does(self) -> None:
        found = {}
        for r in _routes():
            buckets = [d.call.bucket for d in r.dependant.dependencies if hasattr(d.call, "bucket")]
            for m in r.methods - {"HEAD", "OPTIONS"}:
                if buckets:
                    found[(m, r.path)] = buckets[0]
                    assert len(buckets) == 1, (m, r.path, buckets)
        assert found == ROUTE_BUCKETS

    def test_the_unmetered_routes_exist(self) -> None:
        """A typo there would put an SOS back under the write ceiling."""
        paths = {r.path for r in _routes()}
        assert deps.UNMETERED_ROUTES <= paths

    def test_the_budget_is_charged_before_any_provider_call(self) -> None:
        """Route-level dependencies resolve before the handler's own, so the
        limit runs before the permission gate's release, the body and the
        provider. FastAPI puts them first; this holds it to that."""
        for r in _routes():
            deps_ = r.dependant.dependencies
            if any(hasattr(d.call, "bucket") for d in deps_):
                assert hasattr(deps_[0].call, "bucket"), r.path


# --------------------------------------------------------------------------
# http


async def _manager(api, session):
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return user, await auth_headers(api, user.email, factories.TEST_PASSWORD)


async def _driver(api, session):
    driver, user = await factories.make_driver(session)
    return driver, user, await auth_headers(api, user.phone, factories.TEST_PASSWORD)


@pytest.fixture
def fake_geocoder(monkeypatch):
    calls: list[str] = []

    async def autocomplete(q, token):
        calls.append(q)
        return []

    monkeypatch.setattr(geocoding, "available", lambda: True)
    monkeypatch.setattr(geocoding, "provider", lambda: "TEST")
    monkeypatch.setattr(geocoding, "autocomplete", autocomplete)
    return calls


def _suggest(n: int = 0) -> str:
    return f"/api/geocoding/suggest?q=Guwahati{n}&session_token=tok-{n:08d}"


@pytest.mark.requires_db
class TestExpensiveEndpoints:
    async def test_trip_plan_meets_429_at_its_burst(self, api, session) -> None:
        """The P0-B red test: before, every one of these answered 422 (or 201)
        without end. Invalid bodies on purpose - the budget is spent before
        validation, so a malformed flood costs the caller too."""
        _, headers = await _manager(api, session)
        burst = POLICIES["route_plan"].burst
        for _ in range(burst):
            assert (await api.post("/api/trips/plan", headers=headers, json={})).status_code == 422
        _is_429(await api.post("/api/trips/plan", headers=headers, json={}))

    async def test_geocoding_stops_before_the_provider(self, api, session, fake_geocoder) -> None:
        _, headers = await _manager(api, session)
        burst = POLICIES["geocoding"].burst
        for i in range(burst):
            assert (await api.get(_suggest(i), headers=headers)).status_code == 200
        _is_429(await api.get(_suggest(99), headers=headers))
        assert len(fake_geocoder) == burst  # the refused one never reached Nominatim

    async def test_ai_ask_is_refused_before_the_trip_facts_are_read(self, api, session, monkeypatch) -> None:
        """Decision in the policy s.5: the soft gate stays (offline answer,
        200) and a hard limit now sits in front of `_trip_facts`."""
        _, _, headers = await _driver(api, session)
        facts: list[object] = []
        real = ai_api._trip_facts

        async def counted(db, driver):
            facts.append(driver)
            return await real(db, driver)

        async def offline(**kw):
            return gemini._deterministic_offline_answer(kw["user"], mode=kw["mode"], reason="test")

        monkeypatch.setattr(ai_api, "_trip_facts", counted)
        monkeypatch.setattr(gemini, "generate", offline)  # no provider, no soft gate
        burst = POLICIES["ai_ask"].burst
        body = {"mode": "assistant", "question": "How far is the next stop?"}
        for _ in range(burst):
            assert (await api.post("/api/ai/ask", headers=headers, json=body)).status_code == 200
        _is_429(await api.post("/api/ai/ask", headers=headers, json=body))
        assert len(facts) == burst

    async def test_change_password_stops_before_argon2(self, api, session, monkeypatch) -> None:
        from app.api import auth as auth_api

        user, headers = await _manager(api, session)
        verified: list[str] = []
        real = auth_api.verify_password_async

        async def counted(password, hashed):
            verified.append(password)
            return await real(password, hashed)

        monkeypatch.setattr(auth_api, "verify_password_async", counted)
        body = {"current_password": "not-the-password-1", "new_password": "Another-long-pass-1"}
        for _ in range(POLICIES["password"].burst):
            assert (await api.post("/api/auth/password", headers=headers, json=body)).status_code == 401
        _is_429(await api.post("/api/auth/password", headers=headers, json=body))
        assert len(verified) == POLICIES["password"].burst

    async def test_upload_is_refused_before_its_body_is_read(self, api, session) -> None:
        _, _, headers = await _driver(api, session)
        for _ in range(POLICIES["upload"].burst):
            r = await api.post("/api/files?kind=DRIVER_DOCUMENT", headers=headers, content=b"not an image")
            assert r.status_code == 415
        pulled = 0

        async def body():
            nonlocal pulled
            pulled += 1
            yield b"\x00" * 1024

        _is_429(await api.post("/api/files?kind=DRIVER_DOCUMENT", headers=headers, content=body()))
        assert pulled == 0

    async def test_driver_reroute_has_its_own_small_budget(self, api, session) -> None:
        _, _, headers = await _driver(api, session)
        for _ in range(POLICIES["driver_reroute"].burst):
            assert (await api.post("/api/driver/me/trip/reroute", headers=headers, json={})).status_code == 422
        _is_429(await api.post("/api/driver/me/trip/reroute", headers=headers, json={}))

    async def test_an_anonymous_caller_is_refused_401_and_spends_nobody_s_budget(self, api, session, fake_geocoder) -> None:
        for _ in range(30):
            assert (await api.get(_suggest())).status_code == 401
        _, headers = await _manager(api, session)
        assert (await api.get(_suggest(), headers=headers)).status_code == 200


@pytest.mark.requires_db
class TestCeilings:
    async def test_the_per_user_ceiling_binds_on_ordinary_routes_and_only_for_that_user(self, api, session) -> None:
        """Classes C, D and F: every authenticated request passes the per-user
        ceiling in get_current_user, so a route nobody decorated is covered."""
        user, headers = await _manager(api, session)
        _, other = await _manager(api, session)
        _spend("read", user.id, POLICIES["read"].burst)
        _is_429(await api.get("/api/auth/me", headers=headers))
        assert (await api.get("/api/auth/me", headers=other)).status_code == 200
        _spend("write", user.id, POLICIES["write"].burst)
        _is_429(await api.post("/api/presence/heartbeat", headers=headers, json={}))
        assert (await api.post("/api/presence/heartbeat", headers=other, json={})).status_code != 429


@pytest.mark.requires_db
class TestWhoMustNotBeLimited:
    async def test_many_users_behind_one_nat_do_not_lock_each_other_out(self, api, session, fake_geocoder) -> None:
        """Authenticated budgets are per user; the per-IP guard is 20 users'
        worth. 15 managers on one address, each spending most of their own
        burst: all served. Then the one who overdoes it meets their own 429,
        and a neighbour on the same address is still served."""
        from app.main import create_app

        people = [await _manager(api, session) for _ in range(15)]  # logins come from 127.0.0.1
        burst = POLICIES["geocoding"].burst
        async with AsyncClient(transport=ASGITransport(app=create_app(), client=("203.0.113.50", 4000)), base_url="http://test") as nat:
            codes = [
                (await nat.get(_suggest(i), headers=h)).status_code
                for _, h in people
                for i in range(burst - 2)
            ]
            assert set(codes) == {200}, codes
            abuser, neighbour = people[0][1], people[1][1]
            for i in range(2):
                assert (await nat.get(_suggest(i), headers=abuser)).status_code == 200
            # GCRA gives a unit back every 3 s (20/min), and ~120 requests sit
            # between the abuser's first and this one: under a loaded suite
            # that refilled one and the 429 became a 200. Spend the rest of the
            # abuser's own budget now, so the check does not race the clock.
            _spend("geocoding", people[0][0].id, burst)
            _is_429(await nat.get(_suggest(), headers=abuser))
            assert (await nat.get(_suggest(), headers=neighbour)).status_code == 200

    async def test_the_first_sos_of_a_trip_is_never_refused(self, api, session, caplog) -> None:
        """Every budget the driver has is already spent - SOS, the write
        ceiling, the read ceiling - and the first stop request still lands.
        Only requests while that SOS is open spend the SOS budget, and a
        refusal is logged with the driver and trip (not audited)."""
        trip, driver, user = await _running_trip(session)
        headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
        for bucket in ("sos", "write", "read"):
            _spend(bucket, user.id, POLICIES[bucket].burst)

        first = await api.post("/api/driver/me/trip/stop-request", headers=headers, json=_stop())
        assert first.status_code == 200, first.text

        deps.reset_rate_limits()
        for _ in range(POLICIES["sos"].burst):
            assert (await api.post("/api/driver/me/trip/stop-request", headers=headers, json=_stop())).status_code == 200
        refused = await api.post("/api/driver/me/trip/stop-request", headers=headers, json=_stop())
        _is_429(refused)
        assert refused.json()["error"]["message"] == SOS_ALREADY_OPEN
        assert f"SOS request refused by its rate limit: driver {driver.id} trip {trip.id}" in caplog.text

    async def test_answering_an_open_check_is_never_refused(self, api, session) -> None:
        trip, driver, user = await _running_trip(session)
        session.add(_check(trip))
        await session.commit()
        headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
        for bucket in ("sos", "write"):
            _spend(bucket, user.id, POLICIES[bucket].burst)

        r = await api.post("/api/driver/me/trip/check-in", headers=headers, json={"response": "I_AM_SAFE"})
        assert r.status_code == 200, r.text
        again = await api.post("/api/driver/me/trip/check-in", headers=headers, json={"response": "I_AM_SAFE"})
        _is_429(again)  # already answered: that one spends the (spent) budget
        assert again.json()["error"]["message"] == CHECK_IN_REFUSED

    async def test_a_manager_resolving_an_sos_is_never_refused(self, api, session) -> None:
        trip, driver, _ = await _running_trip(session)
        headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
        assert (await api.post("/api/driver/me/trip/stop-request", headers=headers, json=_stop())).status_code == 200
        manager, mheaders = await _manager(api, session)
        active = (await api.get("/api/emergencies/active", headers=mheaders)).json()
        [emergency] = [e for e in active if e["trip_id"] == str(trip.id)]
        _spend("write", manager.id, POLICIES["write"].burst)
        r = await api.post(f"/api/emergencies/{emergency['id']}/resolve", headers=mheaders, json={"note": "called, safe"})
        assert r.status_code == 200, r.text

    async def test_gps_at_the_tracker_cadence_is_never_refused(self, api, session) -> None:
        """Class D. The write ceiling is spent and GPS still flows; the batches
        a phone really sends (one fix live, 100 from a backlog) all land."""
        trip, driver, user = await _running_trip(session)
        headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
        _spend("write", user.id, POLICIES["write"].burst)
        for size in [1] * 30 + [100] * 5 + [1] * 10:
            r = await api.post("/api/driver/me/location", headers=headers, json=_fixes(trip, size))
            assert r.status_code == 202, r.text

    async def test_gps_past_its_budget_is_delayed_and_a_resend_merges(self, api, session) -> None:
        """Past 1000 fixes at once: 429 + Retry-After, which the app treats as
        retryable. The batch it re-sends later is not stored twice."""
        trip, driver, _ = await _running_trip(session)
        headers = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
        first = _fixes(trip, 500)
        assert (await api.post("/api/driver/me/location", headers=headers, json=first)).status_code == 202
        assert (await api.post("/api/driver/me/location", headers=headers, json=_fixes(trip, 500))).status_code == 202
        _is_429(await api.post("/api/driver/me/location", headers=headers, json=_fixes(trip, 500)))

        deps.reset_rate_limits()  # the Retry-After has passed
        again = await api.post("/api/driver/me/location", headers=headers, json=first)
        assert again.status_code == 202 and again.json()["duplicates_ignored"] == 500

    async def test_health_is_never_limited(self, api) -> None:
        codes = {(await api.get("/health")).status_code for _ in range(400)}
        assert codes == {200}


@pytest.mark.requires_db
class TestAddresses:
    """Public budgets key on client_address: the peer, or the X-Forwarded-For
    entry TRUSTED_PROXY_HOPS proxies appended, from the right. Never the
    left-most entry and never X-Real-IP."""

    burst = POLICIES["public"].burst

    async def _until_429(self, api, headers_for) -> int:
        for i in range(self.burst + 1):
            r = await api.get("/api/org/regions", headers=headers_for(i))
            if r.status_code == 429:
                return i
            assert r.status_code == 200, r.text
        return -1

    async def test_hops_0_ignores_forged_headers(self, api) -> None:
        forged = lambda i: {"X-Forwarded-For": f"9.9.9.{i}", "X-Real-IP": f"8.8.8.{i}"}  # noqa: E731
        assert await self._until_429(api, forged) == self.burst

    async def test_hops_1_ignores_the_forged_left_and_x_real_ip(self, api, monkeypatch) -> None:
        _hops(monkeypatch, 1)
        forged = lambda i: {"X-Forwarded-For": f"1.2.3.{i}, 203.0.113.7", "X-Real-IP": f"8.8.8.{i}"}  # noqa: E731
        assert await self._until_429(api, forged) == self.burst
        # The proxy-appended entry is the client: another one has its own budget.
        other = await api.get("/api/org/regions", headers={"X-Forwarded-For": "1.2.3.4, 203.0.113.8"})
        assert other.status_code == 200

    async def test_a_malformed_chain_keys_on_its_one_real_entry(self, api, monkeypatch) -> None:
        _hops(monkeypatch, 1)
        assert await self._until_429(api, lambda i: {"X-Forwarded-For": " , ,, 198.51.100.5 , "}) == self.burst
        assert (await api.get("/api/org/regions", headers={"X-Forwarded-For": "198.51.100.6"})).status_code == 200

    async def test_ipv6_clients_have_their_own_budgets(self, monkeypatch) -> None:
        """Per /64 (RB-01): a host rotating inside its /64 is one client."""
        from app.main import create_app

        for peer in ("2001:db8:0:1::1", "2001:db8:0:2::1"):
            async with AsyncClient(transport=ASGITransport(app=create_app(), client=(peer, 4000)), base_url="http://test") as v6:
                assert await self._until_429(v6, lambda i: {}) == self.burst
        _hops(monkeypatch, 1)
        async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test") as proxied:
            assert await self._until_429(proxied, lambda i: {"X-Forwarded-For": "2001:db8:0:3::3"}) == self.burst
            # Same /64 as the peer above: already spent.
            r = await proxied.get("/api/org/regions", headers={"X-Forwarded-For": "2001:db8:0:1::ffff"})
            assert r.status_code == 429

    async def test_one_user_from_many_addresses_is_still_one_budget(self, api, session, monkeypatch, fake_geocoder) -> None:
        _hops(monkeypatch, 1)
        _, headers = await _manager(api, session)
        burst = POLICIES["geocoding"].burst
        for i in range(burst):
            r = await api.get(_suggest(i), headers={**headers, "X-Forwarded-For": f"198.51.100.{i}"})
            assert r.status_code == 200
        _is_429(await api.get(_suggest(), headers={**headers, "X-Forwarded-For": "198.51.100.200"}))

    async def test_ready_says_when_a_forwarded_header_is_being_ignored(self, api, monkeypatch) -> None:
        """FC-02. Advisory: the instance stays ready (200)."""
        r = await api.get("/ready")
        assert r.status_code == 200 and r.json()["checks"]["proxy"] == {"ok": True, "detail": "direct"}
        r = await api.get("/ready", headers={"X-Forwarded-For": "203.0.113.9"})
        assert r.status_code == 200
        assert r.json()["checks"]["proxy"] == {"ok": False, "detail": "forwarded_header_ignored"}
        _hops(monkeypatch, 1)
        assert (await api.get("/ready")).json()["checks"]["proxy"] == {"ok": True, "detail": "trusted_hops_set"}

    async def test_startup_warns_about_hops_0_outside_development(self, monkeypatch, caplog) -> None:
        from fastapi import FastAPI

        from app.main import lifespan

        for k in ("SENTINEL_SCHEDULER_ENABLED", "WARNINGS_POLL_ENABLED", "ROUTE_WATCH_ENABLED"):
            monkeypatch.setenv(k, "false")
        monkeypatch.setenv("APP_ENV", "staging")
        monkeypatch.setenv("SECRET_KEY", "staging-test-" + "x" * 40)
        get_settings.cache_clear()
        async with lifespan(FastAPI()):
            pass
        assert "TRUSTED_PROXY_HOPS=0 with APP_ENV=staging" in caplog.text


def _hops(monkeypatch, n: int) -> None:
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", str(n))
    get_settings.cache_clear()


# --------------------------------------------------------------------------
# multi


@pytest.mark.requires_db
class TestMoreThanOneInstance:
    async def test_two_instances_spend_one_shared_budget_and_it_outlives_a_restart(self, monkeypatch) -> None:
        monkeypatch.setenv("MULTI_INSTANCE", "true")
        get_settings.cache_clear()
        policy = POLICIES["route_plan"]
        a, b = limiter_for(policy), limiter_for(policy)  # two processes' memory
        key = f"route_plan:test-{uuid.uuid4().hex[:8]}"
        try:
            for i in range(policy.burst):
                await deps.enforce(a if i % 2 else b, key, shared=True)
            with pytest.raises(RateLimitedError) as refused:
                await deps.enforce(a, key, shared=True)
            assert refused.value.retry_after >= 1
            a.clear()
            b.clear()  # both restarted: memory gone, the shared TAT is not
            with pytest.raises(RateLimitedError):
                await deps.enforce(b, key, shared=True)
            assert await _stored(key) == [hashlib.sha256(key.encode()).hexdigest()]
        finally:
            await coordination.reset(key)

    async def test_a_single_instance_restart_forgets(self) -> None:
        """Documented, not defended: in-process state goes with the process."""
        limiter = limiter_for(POLICIES["route_plan"])
        for _ in range(POLICIES["route_plan"].burst):
            await deps.enforce(limiter, "k", shared=True)
        with pytest.raises(RateLimitedError):
            await deps.enforce(limiter, "k", shared=True)
        limiter.clear()
        await deps.enforce(limiter, "k", shared=True)

    async def test_a_shared_charge_never_holds_two_connections(self, api, session, monkeypatch, fake_geocoder) -> None:
        """deps.charge hands the auth lookup's connection back before the
        shared count borrows one (DBPOOL-02): while it runs, the request holds
        nothing of its own."""
        user, headers = await _manager(api, session)
        monkeypatch.setenv("MULTI_INSTANCE", "true")
        get_settings.cache_clear()
        pool = db_session.get_engine().pool
        baseline = pool.checkedout()
        seen: list[int] = []
        real = coordination._run

        async def watched(sql, **kw):
            seen.append(pool.checkedout())
            return await real(sql, **kw)

        monkeypatch.setattr(coordination, "_run", watched)
        try:
            assert (await api.get(_suggest(), headers=headers)).status_code == 200
            assert seen and max(seen) == baseline, (baseline, seen)
        finally:
            await coordination.reset(f"geocoding:{user.id}")
            await coordination.reset("geocoding:ip:127.0.0.1")

    async def test_concurrent_shared_attempts_spend_exactly_the_burst(self, monkeypatch) -> None:
        monkeypatch.setenv("MULTI_INSTANCE", "true")
        get_settings.cache_clear()
        key = f"test-{uuid.uuid4().hex[:8]}"
        try:
            decisions = await asyncio.gather(*(coordination.allow(key, 10, 60, burst=5) for _ in range(12)))
            assert sum(d.allowed for d in decisions) == 5
            assert all(d.retry_after >= 1 for d in decisions if not d.allowed)
        finally:
            await coordination.reset(key)


async def _stored(key: str) -> list[str]:
    digest = hashlib.sha256(key.encode()).hexdigest()
    async with db_session.get_sessionmaker()() as db:
        rows = await db.execute(text("SELECT key FROM rate_limit_windows WHERE key = :d"), {"d": digest})
        return list(rows.scalars())


# --------------------------------------------------------------------------
# fixtures


async def _running_trip(session):
    driver, user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    await factories.make_assignment(session, driver, truck, verified=True)
    trip = await factories.make_trip(session, driver, truck, status=TripStatus.ACTIVE)
    return trip, driver, user


def _stop() -> dict:
    return {
        "request_id": str(uuid.uuid4()),
        "reason": "Rock fall across the road just past the bridge, cannot pass",
        "category": "ROAD_BLOCKED",
    }


def _check(trip) -> Emergency:
    from app.domain.sentinel import DRIVER_RESPONSE_WINDOW_SECONDS

    t0 = datetime.now(UTC)
    return Emergency(
        trip_id=trip.id,
        state=EmergencyState.DRIVER_CHECK_REQUIRED,
        triggered_at=t0,
        stationary_since=t0 - timedelta(minutes=60),
        check_sent_at=t0,
        response_deadline_at=t0 + timedelta(seconds=DRIVER_RESPONSE_WINDOW_SECONDS),
    )


def _fixes(trip, n: int) -> dict:
    now = datetime.now(UTC)
    return {
        "trip_id": str(trip.id),
        "fixes": [
            {
                "device_fix_id": str(uuid.uuid4()),
                "location": {"lat": 26.1445 + i * 1e-5, "lon": 91.7362},
                "recorded_at": (now - timedelta(seconds=n - i)).isoformat(),
            }
            for i in range(n)
        ],
    }


def test_the_policy_table_is_what_the_document_says() -> None:
    """docs/RATE_LIMIT_POLICY.md s.5 is READ here, not restated: every
    bucket's USER_LIMIT, IP_LIMIT, BURST and coordination in the document
    must be POLICIES (and the login/refresh settings), so the document and
    the code cannot drift apart. Rows that say "as F" defer to another row."""
    import re
    from pathlib import Path

    from app.core.config import Settings

    doc = (Path(__file__).resolve().parents[2] / "docs" / "RATE_LIMIT_POLICY.md").read_text(encoding="utf-8")
    section = doc.split("\n## 5.", 1)[1].split("\n## ", 1)[0]
    table = [[c.strip() for c in ln.strip().strip("|").split("|")] for ln in section.splitlines() if ln.startswith("| ")]
    header, rows = table[0], [dict(zip(table[0], r)) for r in table[1:]]

    def rate(cell: str) -> tuple[int, int] | None:
        """'10 / 60 s ...' or '60 fixes / 60 s' -> (10, 60); 'none' -> None."""
        if cell == "none":
            return None
        return tuple(map(int, re.match(r"(\d+)(?: fixes)? / (\d+) s", cell).groups()))

    default = {k: f.default for k, f in Settings.model_fields.items()}
    window = default["RATE_LIMIT_WINDOW_SECONDS"]
    seen = set()
    for row in rows:
        named = re.match(r"`(\w+)`", row["Bucket"])
        if not named or row["USER_LIMIT"].startswith("as "):
            continue
        name = named.group(1)
        seen.add(name)
        if name == "login":
            assert rate(row["USER_LIMIT"]) == (default["LOGIN_RATE_LIMIT_PER_IDENTIFIER"], window)
            assert rate(row["IP_LIMIT"]) == (default["LOGIN_RATE_LIMIT_PER_IP"], window)
            continue
        if name == "refresh":
            assert rate(row["IP_LIMIT"]) == (default["REFRESH_RATE_LIMIT_PER_IP"], window)
            continue
        p = POLICIES[name]
        per_ip = p.ip_multiple or (1 if p.per_address else 0)
        assert rate(row["USER_LIMIT"]) == (None if p.per_address else (p.limit, int(p.window_s))), name
        assert rate(row["IP_LIMIT"]) == ((p.limit * per_ip, int(p.window_s)) if per_ip else None), name
        assert int(re.match(r"\d+", row["BURST"]).group()) == p.burst, name
        assert row["MULTI_WORKER_COORDINATION"].strip("*").startswith("shared" if p.shared else "local"), name
    assert seen == set(POLICIES) | {"login", "refresh"}, sorted(seen)
    assert "MULTI_WORKER_COORDINATION" in header and rl.MAX_TRACKED_KEYS == 10_000
