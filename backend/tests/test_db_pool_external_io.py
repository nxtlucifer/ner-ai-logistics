"""No pooled connection is held while a request waits on an external provider.

WHAT THIS DEFENDS (db-pool lane, 30 Sep 2026)

The auth dependencies open a transaction on the request's session, and the
handlers below kept it open across provider I/O. On the deployed pool (3+2):

  * 20 AI questions with a 7 s model held 5/5 connections for 29 s and
    /api/auth/me went from p95 0.045 s to 27.3 s (DBPOOL-01);
  * 10 address searches, serialised behind the one-per-second Nominatim
    lock, held 5/5 for 5.4 s (DBPOOL-02);
  * 10 trip plans waiting on reverse geocoding held 5/5 for 9.7 s (DBPOOL-03).

HOW IT IS MEASURED

Requests run on a one-connection pool of their own, and each provider stub
records `pool.checkedout()` at the moment the provider would be on the
network: 0 means the handler gave its connection back first. Fixture data
goes through the suite's own engine, so it never counts.

Also here: the notify push after the caller's commit (DBPOOL-08), the shared
provider clients (DBPOOL-06) and the pool timeout and readiness detail
(DBPOOL-07).
"""

from __future__ import annotations

import asyncio
import time
import uuid

import httpx
import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db import session as db_session
from app.models.enums import RouteKind, RouteState, TripStatus, UserRole
from app.models.operations import DriverNotification, Shipment, TripRoute
from app.services import gemini, geocoding, http_clients, inference, notify, route_watch
from tests import factories
from tests.conftest import auth_headers
from tests.test_resource_reservation import DROP, PICKUP, _pair, _plan

pytestmark = [pytest.mark.requires_db, pytest.mark.usefixtures("fixture_india")]

PROVIDER_SECONDS = 1.5


@pytest_asyncio.fixture
async def pool_of_one(session: AsyncSession):
    """The application's requests get ONE connection. `session` is set up
    first, so the suite's own engine keeps serving fixtures and cleanup."""
    saved = db_session._engine, db_session._sessionmaker
    engine = db_session._build_engine(pool_size=1, max_overflow=0, pool_timeout=5)
    db_session._engine, db_session._sessionmaker = engine, None
    try:
        yield engine.pool
    finally:
        await engine.dispose()
        db_session._engine, db_session._sessionmaker = saved


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession, pool_of_one) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


@pytest.fixture
async def driver_headers(api: AsyncClient, session: AsyncSession, pool_of_one) -> dict:
    driver, _ = await factories.make_driver(session)
    return await auth_headers(api, driver.phone, factories.TEST_PASSWORD)


def _answer(seen: list[int], pool, started: asyncio.Event | None = None, seconds: float = 0.0):
    async def generate(**_kwargs):
        seen.append(pool.checkedout())
        if started is not None:
            started.set()
        await asyncio.sleep(seconds)
        return gemini.GeminiResponse(answer="stub", model="stub", provider="GOOGLE_GEMINI")

    return generate


# --- DBPOOL-01: the AI routes ----------------------------------------------


@pytest.mark.parametrize("mode", ["assistant", "safety", "translate"])
async def test_ai_ask_holds_no_connection_during_the_provider_call(
    api, driver_headers, pool_of_one, monkeypatch, mode
):
    seen: list[int] = []
    monkeypatch.setattr(gemini, "generate", _answer(seen, pool_of_one))
    r = await api.post("/api/ai/ask", headers=driver_headers, json={"mode": mode, "question": "Road ok?"})
    assert r.status_code == 200, r.text
    assert seen == [0], f"/api/ai/ask held {seen} connection(s) while the model answered"


async def test_an_unrelated_request_is_not_starved_by_a_slow_answer(
    api, driver_headers, manager_headers, pool_of_one, monkeypatch
):
    """Behavioural form: one connection, a slow answer in flight, and a cheap
    authenticated read must not queue behind it."""
    started = asyncio.Event()
    monkeypatch.setattr(gemini, "generate", _answer([], pool_of_one, started, PROVIDER_SECONDS))
    slow = asyncio.create_task(
        api.post("/api/ai/ask", headers=driver_headers, json={"mode": "assistant", "question": "Road ok?"})
    )
    await asyncio.wait_for(started.wait(), 10)
    t0 = time.perf_counter()
    r = await api.get("/api/auth/me", headers=manager_headers)
    waited = time.perf_counter() - t0
    assert (await slow).status_code == 200
    assert r.status_code == 200, r.text
    assert waited < PROVIDER_SECONDS / 3, f"/api/auth/me waited {waited:.2f}s behind the model"


async def test_ai_status_holds_no_connection_during_the_local_model_probe(
    api, driver_headers, pool_of_one, monkeypatch
):
    seen: list[int] = []

    async def gemini_status():
        return gemini.GeminiStatus(available=False, provider=None, model=None, detail="off")

    async def local_status():
        seen.append(pool_of_one.checkedout())
        return inference.ModelStatus(False, None, None, "no local model")

    monkeypatch.setattr(gemini, "status", gemini_status)
    monkeypatch.setattr(inference, "status", local_status)
    r = await api.get("/api/ai/status", headers=driver_headers)
    assert r.status_code == 200, r.text
    assert seen == [0]


# --- DBPOOL-02: geocoding ---------------------------------------------------


async def test_address_search_holds_no_connection_during_the_provider(
    api, manager_headers, pool_of_one, monkeypatch
):
    from app.services import maplink

    seen: list[int] = []

    async def autocomplete(q, token):
        seen.append(pool_of_one.checkedout())
        return []

    async def details(place_id, token):
        seen.append(pool_of_one.checkedout())
        return geocoding.PlaceDetail(place_id=place_id, address="Guwahati", lat=26.14, lon=91.73)

    async def resolve(url):
        seen.append(pool_of_one.checkedout())
        return maplink.MapLocation(lat=26.14, lon=91.73, label=None, url=url, via="DIRECT_PARSE")

    monkeypatch.setattr(geocoding, "autocomplete", autocomplete)
    monkeypatch.setattr(geocoding, "details", details)
    monkeypatch.setattr(maplink, "resolve", resolve)
    token = uuid.uuid4().hex
    calls = [
        api.get("/api/geocoding/suggest", headers=manager_headers, params={"q": "guwahati depot", "session_token": token}),
        api.get("/api/geocoding/details", headers=manager_headers, params={"place_id": "osm:26.1,91.7", "session_token": token}),
        api.post("/api/geocoding/resolve-link", headers=manager_headers, json={"url": "https://maps.app.goo.gl/abc"}),
    ]
    for call in calls:
        r = await call
        assert r.status_code == 200, r.text
    assert seen == [0, 0, 0]


# --- DBPOOL-03: planning ------------------------------------------------------


async def test_trip_plan_holds_no_connection_during_reverse_geocoding(
    api, session, manager_headers, pool_of_one, monkeypatch
):
    seen: list[int] = []

    async def reverse_admin(lat, lon):
        seen.append(pool_of_one.checkedout())
        return ("Assam", [])

    monkeypatch.setattr(geocoding, "reverse_admin", reverse_admin)
    driver, truck = await _pair(session)
    r = await _plan(api, manager_headers, driver, truck, "TRP-DBP-" + factories.unique_phone()[-6:])
    assert r.status_code == 201, r.text
    assert len(seen) == 2, "reverse geocoding was never reached - the test proved nothing"
    assert seen == [0, 0], f"/api/trips/plan held {seen} connection(s) during reverse geocoding"
    shipment = (await session.execute(select(Shipment).where(Shipment.id == r.json()["shipment_id"]))).scalar_one()
    # The prefetched answer is what phase C recorded - not a second lookup.
    assert shipment.geography_source == "OSM_NOMINATIM_REVERSE"
    assert shipment.origin_state_id == (await factories.get_state(session, "assam")).id


async def test_shipment_create_holds_no_connection_during_reverse_geocoding(
    api, session, manager_headers, pool_of_one, monkeypatch
):
    seen: list[int] = []
    reference = "SHP-DBP-" + factories.unique_phone()[-6:]

    async def reverse_admin(lat, lon):
        seen.append(pool_of_one.checkedout())
        raise geocoding.GeocodingUnavailable("stub")

    monkeypatch.setattr(geocoding, "reverse_admin", reverse_admin)
    r = await api.post(
        "/api/shipments",
        headers=manager_headers,
        json={
            "reference_code": reference,
            "client_name": "Brahmaputra Traders",
            "pickup_address": "Guwahati Depot",
            "pickup": PICKUP,
            "destination_address": "Shillong Depot",
            "destination": DROP,
            "cargo_items": [{"cargo_type": "GENERAL", "cargo_name": "Rice", "weight_kg": "500", "quantity": 1}],
        },
    )
    assert r.status_code == 201, r.text
    # Two lookups, none holding a connection - and a failed one is not
    # retried inside the write transaction (that would be four).
    assert seen == [0, 0]
    stored = await session.scalar(select(Shipment.geography_source).where(Shipment.reference_code == reference))
    assert stored == "GEOCODER_UNAVAILABLE"


async def test_a_reservation_made_during_the_lookup_still_refuses_the_plan(
    api, session, manager_headers, pool_of_one, monkeypatch
):
    """The gates run AFTER the provider wait: a driver committed to another
    trip while this plan waited on Nominatim is refused, and nothing is written."""
    driver, truck = await _pair(session)
    other_truck = await factories.make_truck(session)
    code = "TRP-RACE-" + factories.unique_phone()[-6:]

    async def reverse_admin(lat, lon):
        # Another planner wins the driver while this one waits on Nominatim
        # (the fixture engine; the pool of one is free right now).
        if not getattr(reverse_admin, "raced", False):
            reverse_admin.raced = True
            await factories.make_trip(session, driver, other_truck, status=TripStatus.DRAFT)
        return ("Assam", [])

    monkeypatch.setattr(geocoding, "reverse_admin", reverse_admin)
    r = await _plan(api, manager_headers, driver, truck, code)
    assert r.status_code == 409, r.text
    assert "already committed" in r.json()["error"]["message"]
    orphans = await session.scalar(
        select(func.count()).select_from(Shipment).where(Shipment.reference_code == f"SHP-{code[-6:]}")
    )
    assert orphans == 0


async def test_route_recalculate_holds_no_connection_during_osrm(
    api, session, manager_headers, pool_of_one, monkeypatch
):
    """Guard: routes.plan already commits before the provider (DBPOOL-04)."""
    from app.domain.routing import RouteCandidate, haversine_m
    from app.services import routes as route_service
    from app.services.routing.base import ChainAttempt, ChainOptions

    seen: list[int] = []

    class Chain:
        async def route_options(self, origin, destination, *, kind, limit=1, detailed=False):
            seen.append(pool_of_one.checkedout())
            geom = [(origin.lat, origin.lon), ((origin.lat + destination.lat) / 2 + 0.01,
                                                (origin.lon + destination.lon) / 2 + 0.01),
                    (destination.lat, destination.lon)]
            road = 1.2 * haversine_m(origin.lat, origin.lon, destination.lat, destination.lon)
            cand = RouteCandidate(kind=kind, provider="stub", geometry=geom, distance_m=road, duration_s=road / 12)
            return ChainOptions(candidates=(cand,), attempts=(ChainAttempt("stub", ok=True),))

    monkeypatch.setattr(route_service, "build_chain", lambda: Chain())
    driver, truck = await _pair(session)
    trip = await _plan(api, manager_headers, driver, truck, "TRP-RCL-" + factories.unique_phone()[-6:])
    assert trip.status_code == 201, trip.text
    r = await api.post(f"/api/trips/{trip.json()['id']}/routes/recalculate", headers=manager_headers)
    assert r.status_code == 201, r.text
    assert seen == [0]


# --- DBPOOL-08: pushes ---------------------------------------------------------


GEOMETRY = [(26.1445, 91.7362), (26.0, 91.8), (25.8, 91.85), (25.6, 91.88), (25.5744, 91.8826)]


async def test_route_watch_pushes_outside_any_transaction(session: AsyncSession, monkeypatch):
    from geoalchemy2 import WKTElement

    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck)
    trip = await factories.make_trip(session, driver, truck, assignment=assignment, status=TripStatus.ACTIVE)
    wkt = "LINESTRING({})".format(", ".join(f"{lon} {lat}" for lat, lon in GEOMETRY))
    route = TripRoute(trip_id=trip.id, kind=RouteKind.PRIMARY, state=RouteState.SELECTED,
                      geometry=WKTElement(wkt, srid=4326), distance_km=100, estimated_duration_min=180,
                      routing_provider="stub")
    session.add(route)
    await session.flush()
    trip.selected_route_id = route.id
    driver.push_token = "ExponentPushToken[t]"
    await session.commit()

    during: list[tuple[bool, int]] = []
    pool = db_session.get_engine().pool

    async with db_session.get_sessionmaker()() as db:
        baseline = pool.checkedout()

        async def relay(token, title, body, data):
            if data.get("trip_id") == str(trip.id):
                during.append((db.in_transaction(), pool.checkedout() - baseline))
            return "SENT"

        async def fake_look(_db, trip_id, route_id):
            await _db.execute(select(1))  # the real look_ahead reads; so does this
            return route_watch.Ahead(decision="HOLD_AND_REVIEW", codes=frozenset({"OFFICIAL_WARNING_ON_ROUTE"}),
                                     exposure="HIGH", horizon_km=60.0, fraction_complete=0.2, band="HIGH"), None

        monkeypatch.setattr(notify, "_deliver", relay)
        monkeypatch.setattr(route_watch, "look_ahead", fake_look)
        monkeypatch.setenv("PUSH_ENABLED", "true")
        route_watch._STATE.clear()
        try:
            done = await route_watch.run_tick(db, now=2_000_000.0)
        finally:
            route_watch._STATE.clear()
    mine = [d for d in done if d["trip_id"] == str(trip.id)]
    assert mine and [d for _, d in mine[0]["events"]] == ["SENT", "SENT", "SENT"]
    assert during == [(False, 0)] * 3, f"(in_transaction, extra connections) at each push: {during}"


class TestPushInsideTheCallersTransaction:
    """A send inside an open transaction waits for its COMMIT, and a rollback sends nothing."""

    @pytest.fixture(autouse=True)
    def _push_on(self, monkeypatch):
        monkeypatch.setattr(notify, "configured", lambda: True)

    async def test_the_push_runs_after_the_commit(self, session: AsyncSession, monkeypatch):
        driver, _ = await factories.make_driver(session)
        driver.push_token = "ExponentPushToken[test]"
        await session.commit()
        pushed: list[bool] = []

        async with db_session.get_sessionmaker()() as db:
            async def relay(*_args):
                pushed.append(db.in_transaction())
                return "SENT"

            monkeypatch.setattr(notify, "_deliver", relay)
            await db.execute(select(1))  # the caller's transaction
            row = await notify.send(db, driver_id=driver.id, event="OFFICIAL_WARNING_NEW", title="t", body="b",
                                    fingerprint=f"after-commit:{driver.id}")
            # A queued push already counts for the cooldown: no second buzz.
            again = await notify.send(db, driver_id=driver.id, event="OFFICIAL_WARNING_NEW", title="t", body="b",
                                      fingerprint=f"after-commit:{driver.id}")
            await asyncio.sleep(0)
            assert pushed == [] and row.delivery == "QUEUED"
            assert again.delivery == "SKIPPED_COOLDOWN"
            await db.commit()
        await asyncio.gather(*notify._after_commit)
        assert pushed == [False]
        stored = await session.scalar(select(DriverNotification.delivery).where(DriverNotification.id == row.id))
        assert stored == "SENT"

    async def test_a_rollback_sends_nothing(self, session: AsyncSession, monkeypatch):
        driver, _ = await factories.make_driver(session)
        driver.push_token = "ExponentPushToken[test]"
        await session.commit()
        pushed: list[str] = []

        async def relay(*_args):
            pushed.append("sent")
            return "SENT"

        monkeypatch.setattr(notify, "_deliver", relay)
        async with db_session.get_sessionmaker()() as db:
            await db.execute(select(1))
            await notify.send(db, driver_id=driver.id, event="TRIP_CANCELLED", title="t", body="b",
                              fingerprint=f"rolled-back:{driver.id}")
            await db.rollback()
            await db.commit()  # a later commit on the same session must not send it either
        await asyncio.gather(*notify._after_commit)
        assert pushed == []


# --- DBPOOL-06: shared provider clients ----------------------------------------


async def test_provider_calls_share_one_client_until_shutdown(monkeypatch):
    from app.services.routing.osrm import OsrmRoutingProvider
    from tests.test_routing import GUWAHATI, JORHAT, _ok_body

    built: list[int] = []
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=_ok_body()))
    real_init = httpx.AsyncClient.__init__

    def counting(self, *args, **kwargs):
        built.append(1)
        kwargs["transport"] = transport
        real_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", counting)
    provider = OsrmRoutingProvider("https://routing.test", name="osrm-test")
    for _ in range(3):
        await provider.route(GUWAHATI, JORHAT, kind=RouteKind.PRIMARY)
    assert len(built) == 1, f"{len(built)} clients built for 3 calls"
    client = http_clients.get("osrm")
    await http_clients.aclose_all()
    assert client.is_closed
    assert http_clients.get("osrm") is not client


async def test_a_shared_client_keeps_no_cookies():
    seen: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("cookie"))
        return httpx.Response(200, headers={"set-cookie": "NID=someone; Domain=provider.test; Path=/"})

    client = http_clients.get("cookie-test", transport=httpx.MockTransport(handler))
    await client.get("https://provider.test/a")
    await client.get("https://provider.test/b")
    await http_clients.aclose_all()
    assert seen == [None, None]


# --- DBPOOL-07: pool timeout and the readiness detail ------------------------


async def test_the_pool_timeout_is_explicit():
    await db_session.dispose_engine()
    assert db_session.get_engine().pool.timeout() == get_settings().DB_POOL_TIMEOUT_SECONDS == 10.0


async def test_the_readiness_detail_is_for_managers_only(api: AsyncClient, session: AsyncSession):
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    driver, _ = await factories.make_driver(session)
    m = await auth_headers(api, manager.email, factories.TEST_PASSWORD)
    d = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)

    assert (await api.get("/api/system/readiness")).status_code == 401
    assert (await api.get("/api/system/readiness", headers=d)).status_code == 403
    r = await api.get("/api/system/readiness", headers=m)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body["pool"]) == {"size", "max_overflow", "checked_out", "overflow_in_use", "timeout_s"}
    assert body["pool"]["timeout_s"] == 10.0
    assert body["schema"]["database"] == body["schema"]["code_heads"]
    public = (await api.get("/ready")).json()
    assert "pool" not in public and "schema" not in public
    assert body["schema"]["code_heads"][0] not in str(public)
