"""Route risk over real HTTP: scoping, weather failure, DB lifetime.

The weather provider is always stubbed. A suite that reaches Open-Meteo is not
a suite - it fails when someone else has a bad minute, and it spends a free
service's budget on our own CI.
"""

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.routing import RouteCandidate
from app.domain.weather import WeatherObservation, WeatherUnavailable
from app.models.enums import RouteKind, UserRole
from app.services import route_risk as risk_service
from app.services import routes as route_service
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

GEOMETRY = [(26.1445, 91.7362), (26.4, 92.9), (26.7509, 94.2037)]


class _StubChain:
    """Enough of RoutingChain to plant a route worth assessing."""

    async def route_options(self, origin, destination, *, kind, limit=1):  # noqa: ANN001
        from app.services.routing.base import ChainAttempt, ChainOptions

        return ChainOptions(
            candidates=(
                RouteCandidate(
                    kind=kind,
                    provider="stub",
                    geometry=GEOMETRY,
                    distance_m=308_000.0,
                    duration_s=21_600.0,
                ),
            ),
            attempts=(ChainAttempt("stub", ok=True),),
        )

    async def route(self, origin, destination, *, kind):  # noqa: ANN001
        from app.services.routing.base import ChainResult

        options = await self.route_options(origin, destination, kind=kind, limit=1)
        return ChainResult(candidate=options.candidates[0], attempts=options.attempts)


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


@pytest.fixture
def stub_weather(monkeypatch):
    """Replace the weather fan-out for the duration of one test."""

    def install(*, rain=None, gust=None, raises=None, observed_at=None):
        calls = {"n": 0, "positions": []}

        async def fake(positions):
            calls["n"] += 1
            calls["positions"] = list(positions)
            if raises is not None:
                return []
            return [
                WeatherObservation(
                    lat=lat,
                    lon=lon,
                    provider="stub-weather",
                    observed_at=observed_at or datetime.now(UTC),
                    precipitation_mm=rain,
                    wind_gust_kmh=gust,
                )
                for lat, lon in positions
            ]

        monkeypatch.setattr(risk_service, "observations_for", fake)
        return calls

    return install


async def _planned_route(api: AsyncClient, session: AsyncSession, headers: dict):
    """A trip with one persisted route, ready to assess."""
    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck)
    trip = await factories.make_trip(
        session, driver, truck, assignment=assignment, stops=2
    )
    planned = await api.post(
        f"/api/trips/{trip.id}/routes/recalculate", headers=headers
    )
    assert planned.status_code == 201, planned.text
    return trip, planned.json()["route"]["id"]


@pytest.fixture(autouse=True)
def _stub_routing(monkeypatch):
    monkeypatch.setattr(route_service, "build_chain", lambda: _StubChain())


class TestRouteRiskEndpoint:
    async def test_a_route_is_scored_with_its_evidence_and_its_gaps(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict,
        stub_weather,
    ) -> None:
        stub_weather(rain=12.0, gust=20.0)
        trip, route_id = await _planned_route(api, session, manager_headers)

        r = await api.get(
            f"/api/trips/{trip.id}/routes/{route_id}/risk", headers=manager_headers
        )

        assert r.status_code == 200, r.text
        body = r.json()

        assert 0 <= body["score"] <= 100
        assert body["band"] in ("LOW", "MODERATE", "HIGH")
        assert body["inputs"]["weather"] == "AVAILABLE"
        assert body["inputs"]["distance"] == "AVAILABLE"

        # The gaps are part of the answer, not a footnote.
        assert body["inputs"]["landslide"] == "NOT_AVAILABLE"
        assert "landslide" in body["unavailable"]
        assert "road_quality" in body["unavailable"]

        # Heavy rain must actually show up in the breakdown.
        assert any(c["code"] == "RAIN_EXPOSURE" for c in body["components"])
        assert sum(c["points"] for c in body["components"]) == body["score"]
        assert "HEAVY_RAIN_ON_ROUTE" in body["reason_codes"]

    async def test_a_weather_outage_still_returns_an_assessment(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict,
        stub_weather,
    ) -> None:
        """The failure mode this endpoint's contract exists for.

        A 503 would mean a dispatcher sees nothing because one free API had a
        bad minute, when distance and duration are still real evidence.
        """
        stub_weather(raises=WeatherUnavailable("down"))
        trip, route_id = await _planned_route(api, session, manager_headers)

        r = await api.get(
            f"/api/trips/{trip.id}/routes/{route_id}/risk", headers=manager_headers
        )

        assert r.status_code == 200, r.text
        body = r.json()
        assert body["inputs"]["weather"] == "NOT_AVAILABLE"
        assert "WEATHER_UNAVAILABLE" in body["reason_codes"]
        assert body["observations_used"] == 0
        # Distance and duration still scored - the answer is partial, not empty.
        assert any(
            c["code"] in ("DISTANCE_EXPOSURE", "DURATION_EXPOSURE")
            for c in body["components"]
        )

    async def test_calm_weather_is_not_reported_as_unavailable(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict,
        stub_weather,
    ) -> None:
        """The inverse of the outage case: a dry route must read as measured
        and dry, not as unknown."""
        stub_weather(rain=0.0, gust=5.0)
        trip, route_id = await _planned_route(api, session, manager_headers)

        r = await api.get(
            f"/api/trips/{trip.id}/routes/{route_id}/risk", headers=manager_headers
        )

        body = r.json()
        assert body["inputs"]["weather"] == "AVAILABLE"
        assert body["observations_used"] > 0
        assert all(c["code"] != "RAIN_EXPOSURE" for c in body["components"])

    async def test_the_route_is_sampled_at_several_points_not_one(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict,
        stub_weather,
    ) -> None:
        """A single reading at the origin would call a 300 km corridor dry
        because it happens not to be raining in Guwahati."""
        calls = stub_weather(rain=1.0)
        trip, route_id = await _planned_route(api, session, manager_headers)

        await api.get(
            f"/api/trips/{trip.id}/routes/{route_id}/risk", headers=manager_headers
        )

        assert calls["n"] == 1
        assert len(calls["positions"]) > 1
        assert calls["positions"][0] != calls["positions"][-1]

    async def test_no_model_fields_are_invented(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict,
        stub_weather,
    ) -> None:
        """A `confidence` or `model_version` field would imply training and
        validation that have not happened."""
        stub_weather(rain=3.0)
        trip, route_id = await _planned_route(api, session, manager_headers)

        body = (
            await api.get(
                f"/api/trips/{trip.id}/routes/{route_id}/risk",
                headers=manager_headers,
            )
        ).json()

        for forbidden in ("confidence", "model_version", "predicted_delay_min"):
            assert forbidden not in body


class TestRouteRiskScoping:
    async def test_another_trips_route_is_404(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict,
        stub_weather,
    ) -> None:
        """An id from one trip used against another is the classic IDOR shape."""
        stub_weather(rain=0.0)
        trip_a, route_a = await _planned_route(api, session, manager_headers)
        trip_b, _route_b = await _planned_route(api, session, manager_headers)

        r = await api.get(
            f"/api/trips/{trip_b.id}/routes/{route_a}/risk", headers=manager_headers
        )

        assert r.status_code == 404

    async def test_an_unknown_trip_is_404(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        r = await api.get(
            f"/api/trips/{uuid.uuid4()}/routes/{uuid.uuid4()}/risk",
            headers=manager_headers,
        )
        assert r.status_code == 404

    async def test_it_requires_authentication(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict,
        stub_weather,
    ) -> None:
        stub_weather(rain=0.0)
        trip, route_id = await _planned_route(api, session, manager_headers)

        r = await api.get(f"/api/trips/{trip.id}/routes/{route_id}/risk")

        assert r.status_code == 401


class TestRiskDoesNotHoldTheDatabase:
    async def test_no_connection_is_held_while_weather_is_fetched(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict,
        monkeypatch,
    ) -> None:
        """The same rule routing follows, and it matters MORE here.

        Route risk fans out to several weather requests, so the window a held
        connection would be idle for is longer than routing's single call. The
        pool is DB_POOL_SIZE + DB_MAX_OVERFLOW = 15 and Supabase's session
        pooler allows 15 clients, so concurrent risk requests against a slow
        provider would spend the entire database budget waiting.
        """
        from app.db import session as db_session

        trip, route_id = await _planned_route(api, session, manager_headers)

        pool = db_session.get_engine().pool
        baseline = pool.checkedout()
        during: list[int] = []

        async def watching(positions):
            during.append(pool.checkedout())
            return []

        monkeypatch.setattr(risk_service, "observations_for", watching)

        r = await api.get(
            f"/api/trips/{trip.id}/routes/{route_id}/risk", headers=manager_headers
        )
        assert r.status_code == 200, r.text

        assert during, "the weather fan-out never ran"
        assert during[0] <= baseline, (
            "a pooled database connection was held across the weather calls "
            f"(baseline {baseline}, during call {during[0]})"
        )
