"""Demo blockers, 1 Oct 2026 - one regression test per finding.

A  RB-02  route select / reroute accept scope the trip BEFORE eligibility
B         DEMO districts are operational only outside production
C         FIXTURE_* boundary rows are not India outside APP_ENV=test
D  G2     a NEW_DESTINATION redirect re-runs the NER gate and re-scopes
E  RB-09  readiness reports the India outline and its source
F  RB-01  IPv6 rate-limit keys use the /64
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.enums import RouteState, TripStatus, UserRole
from app.services import route_risk as risk_service
from tests import factories
from tests.conftest import auth_headers


def _body(r) -> dict:
    return {k: v for k, v in r.json()["error"].items() if k != "request_id"}


# --- A. RB-02 -------------------------------------------------------------


@pytest.mark.requires_db
class TestOutOfScopeRouteMutationsAreA404:
    """An out-of-scope manager learns nothing from a real trip+route: the same
    404 a pair of random ids gets, and no hazard provider is asked."""

    @pytest.fixture
    def eligibility_calls(self, monkeypatch) -> list:
        calls: list = []
        real = risk_service.eligibility_and_evidence_for_route

        async def spy(db, route_id):  # noqa: ANN001
            calls.append(route_id)
            return await real(db, route_id)

        monkeypatch.setattr(risk_service, "eligibility_and_evidence_for_route", spy)
        return calls

    async def _outsider(self, api: AsyncClient, session: AsyncSession) -> dict:
        meghalaya = await factories.get_state(session, "meghalaya")
        user = await factories.make_user(
            session, role=UserRole.STATE_MANAGER, state_id=meghalaya.id
        )
        return await auth_headers(api, user.email, factories.TEST_PASSWORD)

    async def _trip(self, session: AsyncSession, status: TripStatus):
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        # No geography on the shipment: unknown, which no state manager sees.
        trip = await factories.make_trip(session, driver, truck, status=status)
        current = await factories.make_selected_route(session, trip.id)
        other = await factories.make_selected_route(
            session, trip.id, state=RouteState.PROPOSED, select=False
        )
        return trip, current, other

    async def test_select(self, api, session, eligibility_calls):
        headers = await self._outsider(api, session)
        trip, _, other = await self._trip(session, TripStatus.ASSIGNED)
        real = await api.post(f"/api/trips/{trip.id}/routes/{other.id}/select", headers=headers)
        ghost = await api.post(
            f"/api/trips/{uuid.uuid4()}/routes/{uuid.uuid4()}/select", headers=headers
        )
        assert real.status_code == 404, real.text
        assert _body(real) == _body(ghost)
        assert eligibility_calls == []

    async def test_reroute_accept(self, api, session, eligibility_calls):
        headers = await self._outsider(api, session)
        trip, current, other = await self._trip(session, TripStatus.ACTIVE)
        real = await api.post(
            f"/api/trips/{trip.id}/reroute/accept", headers=headers,
            json={"from_route_id": str(current.id), "to_route_id": str(other.id)},
        )
        ghost = await api.post(
            f"/api/trips/{uuid.uuid4()}/reroute/accept", headers=headers,
            json={"from_route_id": str(uuid.uuid4()), "to_route_id": str(uuid.uuid4())},
        )
        assert real.status_code == 404, real.text
        assert _body(real) == _body(ghost)
        assert eligibility_calls == []


# --- B/C. Which geography counts, by APP_ENV -------------------------------

#: The real rule, captured before conftest's suite-wide opt-in replaces it.
from app.services.geo_classify import fixture_geometry_allowed as REAL_FIXTURE_RULE  # noqa: E402


def _env(monkeypatch, env: str) -> None:
    monkeypatch.setenv("APP_ENV", env)
    monkeypatch.setenv("SECRET_KEY", "x" * 64)  # only development takes the placeholder
    get_settings.cache_clear()


class TestDemoDistrictsAreNotOperationalInProduction:
    @pytest.mark.parametrize(
        "env,demo", [("production", False), ("staging", True), ("development", True), ("test", True)]
    )
    def test_operational_sources(self, monkeypatch, env, demo):
        from app.models.enums import DistrictSource
        from app.models.geography import operational_sources

        _env(monkeypatch, env)
        assert DistrictSource.VERIFIED_OFFICIAL in operational_sources()
        assert (DistrictSource.DEMO in operational_sources()) is demo

    @pytest.mark.requires_db
    @pytest.mark.usefixtures("fixture_geography")
    async def test_a_demo_district_places_nothing_in_production(self, session, monkeypatch):
        from app.models.geography import District
        from app.services import geo_classify
        from tests import geo_fixtures as fx

        kamrup = (
            await session.execute(select(District.id).where(District.slug == fx.FIXTURE_DISTRICT_SLUG))
        ).scalar_one()  # DEMO while the fixture is loaded
        p = fx.P_ASSAM_KAMRUP
        _env(monkeypatch, "development")
        assert (await geo_classify.classify_point(session, p.lat, p.lon)).district_id == kamrup
        _env(monkeypatch, "production")
        geo = await geo_classify.classify_point(session, p.lat, p.lon)
        assert geo.state_id is not None and geo.district_id is None


@pytest.mark.requires_db
@pytest.mark.usefixtures("fixture_geography")
class TestFixtureShapesAreNotIndiaOutsideTest:
    @pytest.fixture(autouse=True)
    def real_rule(self, monkeypatch):
        from app.services import geo_classify

        monkeypatch.setattr(geo_classify, "fixture_geometry_allowed", REAL_FIXTURE_RULE)

    @pytest.mark.parametrize("env", ["development", "production"])
    async def test_a_leftover_fixture_outline_is_no_outline(self, session, monkeypatch, env):
        from app.core.errors import ServiceUnavailableError
        from app.services import geo_classify
        from tests import geo_fixtures as fx

        _env(monkeypatch, env)
        p = fx.P_ASSAM_KAMRUP
        for call in (
            lambda: geo_classify.classify_point(session, p.lat, p.lon),
            lambda: geo_classify.require_country_boundary(session),
            lambda: geo_classify.lines_inside_india(session, ["LINESTRING(91 26, 91.5 26.1)"]),
        ):
            with pytest.raises(ServiceUnavailableError) as caught:
                await call()
            assert caught.value.code == "GEOGRAPHY_UNAVAILABLE"

    async def test_fixture_states_give_no_route_coverage(self, session, monkeypatch):
        from app.services import geo_classify

        driver, _ = await factories.make_driver(session)
        trip = await factories.make_trip(session, driver, await factories.make_truck(session))
        route = await factories.make_selected_route(session, trip.id)
        _env(monkeypatch, "test")
        assert await geo_classify.route_coverage(session, route.id) == "NER_DEEP"
        _env(monkeypatch, "development")
        assert await geo_classify.route_coverage(session, route.id) == "UNKNOWN"

    async def test_under_app_env_test_the_fixture_is_india(self, session, monkeypatch):
        from app.services import geo_classify
        from tests import geo_fixtures as fx

        _env(monkeypatch, "test")
        geo = await geo_classify.classify_point(session, fx.P_ASSAM_KAMRUP.lat, fx.P_ASSAM_KAMRUP.lon)
        assert geo.in_india and geo.is_ner and geo.district_id is not None


# --- D. G2: a mid-trip redirect re-runs the NER gate ------------------------

from tests.test_post_pickup_resolution import _Chain, chain  # noqa: E402,F401

KOLKATA = (22.5726, 88.3639)  # inside FIXTURE West Bengal (not NER)


@pytest.mark.requires_db
@pytest.mark.usefixtures("fixture_geography")
class TestRedirectKeepsTheTripNerConnected:
    async def _loaded_kolkata_to_guwahati(self, api: AsyncClient, session: AsyncSession):
        from app.schemas.common import Coordinate

        shipment = await factories.make_shipment(session, pickup=Coordinate(lat=KOLKATA[0], lon=KOLKATA[1]))
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await factories.make_assignment(session, driver, truck, verified=True)
        trip = await factories.make_trip(session, driver, truck, shipment=shipment, assignment=assignment)
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        started = await api.post("/api/driver/me/trip/start", headers=headers, json={})
        assert started.status_code == 200, started.text
        pickup = started.json()["next_stop_id"]
        assert (await api.post(f"/api/driver/me/trip/stops/{pickup}/arrive", headers=headers)).status_code == 200
        assert (await api.post(f"/api/driver/me/trip/stops/{pickup}/complete", headers=headers)).status_code == 200
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        return trip, shipment, await auth_headers(api, boss.email, factories.TEST_PASSWORD)

    def _redirect(self, to, address: str) -> dict:
        return {
            "reason": "Customer moved the delivery elsewhere", "disposition": "NEW_DESTINATION",
            "destination": {"lat": to.lat, "lon": to.lon}, "destination_address": address,
        }

    async def test_kolkata_to_guwahati_redirected_to_delhi_is_refused(self, api, session):
        from app.models.operations import TripStop
        from tests import geo_fixtures as fx

        trip, _, headers = await self._loaded_kolkata_to_guwahati(api, session)
        r = await api.post(f"/api/trips/{trip.id}/cancel", headers=headers, json=self._redirect(fx.P_DELHI, "Delhi DC"))
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == "NOT_NER_CONNECTED"
        stops = (await session.execute(
            select(TripStop.status).where(TripStop.trip_id == trip.id).order_by(TripStop.sequence)
        )).scalars().all()
        assert [s.value for s in stops] == ["COMPLETED", "PENDING"]

    async def test_a_ner_redirect_moves_the_destination_geography(self, api, session, chain):
        from app.models.geography import State
        from app.models.operations import Shipment
        from tests import geo_fixtures as fx

        trip, shipment, headers = await self._loaded_kolkata_to_guwahati(api, session)
        r = await api.post(
            f"/api/trips/{trip.id}/cancel", headers=headers, json=self._redirect(fx.P_MEGHALAYA, "Meghalaya DC")
        )
        assert r.status_code == 200, r.text
        meghalaya = (await session.execute(select(State.id).where(State.slug == "meghalaya"))).scalar_one()
        await session.refresh(shipment)
        row = await session.get(Shipment, shipment.id)
        assert (row.destination_state_id, row.destination_district_id) == (meghalaya, None)
        assert row.geography_source == "POSTGIS_ADMIN_BOUNDARY"
        detail = (await api.get(f"/api/trips/{trip.id}", headers=headers)).json()
        assert detail["trip_scope_type"] == "NER_INBOUND"


# --- E. RB-09: readiness says whose India outline it is ---------------------


@pytest.mark.requires_db
class TestReadinessReportsGeography:
    @pytest.fixture(autouse=True)
    def real_rule(self, monkeypatch):
        from app.services import geo_classify

        monkeypatch.setattr(geo_classify, "fixture_geometry_allowed", REAL_FIXTURE_RULE)

    async def test_no_outline_is_advisory(self, api):
        r = await api.get("/ready")
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "ready"
        assert r.json()["checks"]["geography"] == {"ok": False, "detail": "not_loaded"}

    @pytest.mark.usefixtures("fixture_india")
    async def test_a_fixture_outline_is_named_not_trusted(self, api, session):
        from tests import geo_fixtures as fx

        r = await api.get("/ready")
        assert r.status_code == 200 and r.json()["status"] == "ready"
        assert r.json()["checks"]["geography"] == {"ok": False, "detail": fx.FIXTURE_SOURCE}
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, boss.email, factories.TEST_PASSWORD)
        detail = (await api.get("/api/system/readiness", headers=headers)).json()
        assert detail["checks"]["geography"]["geometry_source"] == fx.FIXTURE_SOURCE
        assert detail["checks"]["geography"]["ok"] is False


# --- F. RB-01: an IPv6 caller is counted per /64 ----------------------------


def _request(host: str):
    from starlette.requests import Request

    return Request({"type": "http", "client": (host, 1234), "headers": []})


class TestIpv6RateKeys:
    @pytest.mark.parametrize(
        "host,key",
        [
            ("2001:db8:1:2:aaaa::1", "2001:db8:1:2::/64"),
            ("2001:db8:1:2:ffff:ffff:ffff:ffff", "2001:db8:1:2::/64"),
            ("::ffff:203.0.113.7", "203.0.113.7"),
            ("203.0.113.7", "203.0.113.7"),
            ("unknown-peer", "unknown-peer"),
        ],
    )
    def test_the_budget_key(self, host, key):
        from app.api.deps import rate_address

        assert rate_address(_request(host)) == key

    async def test_the_audit_row_keeps_the_full_address(self):
        from app.api.deps import get_client_ip

        assert await get_client_ip(_request("2001:db8:1:2:aaaa::1")) == "2001:db8:1:2:aaaa::1"

    def test_rotating_inside_a_64_does_not_buy_a_new_budget(self):
        from app.api.deps import rate_address
        from app.core.rate_limit import GcraLimiter
        from datetime import timedelta

        limiter = GcraLimiter(limit=1, window=timedelta(seconds=60))
        assert limiter.check(rate_address(_request("2001:db8::1"))).allowed
        assert not limiter.check(rate_address(_request("2001:db8::2"))).allowed
        assert limiter.check(rate_address(_request("2001:db8:0:1::1"))).allowed
