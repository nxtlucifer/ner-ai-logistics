"""Route recommendation over real HTTP: scoping, honesty, DB lifetime.

The weather provider is always stubbed, for the reason `test_route_risk_api`
gives: a suite that reaches Open-Meteo fails when someone else has a bad minute
and spends a free service's budget on our CI.

Two routing stubs, because the two shapes have different contracts. One
corridor is the ORDINARY case in the North East and must produce a truthful
single-route answer rather than an invented choice. Two distinct corridors is
the case the comparison exists for.
"""

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


from app.domain.routing import RouteCandidate
from app.models.enums import RouteKind, RouteState, UserRole
from app.models.operations import TripRoute
from app.services import route_risk as risk_service
from app.services import routes as route_service
from tests import factories
from tests.conftest import auth_headers

# LS-7: these suites test recommendation/reroute/fleet behaviour, not the
# hazard policy. `clear_hazard_evidence` supplies sufficient evidence so
# they exercise what they mean to; absence-of-evidence behaviour lives in
# tests/test_route_eligibility.py.
pytestmark = [pytest.mark.requires_db, pytest.mark.usefixtures("clear_hazard_evidence")]

#: Guwahati -> Jorhat, roughly along NH-27.
PRIMARY_GEOMETRY = [(26.1445, 91.7362), (26.4, 92.9), (26.7509, 94.2037)]
#: A genuinely different corridor, far enough north that
#: `routing.is_distinct_corridor` accepts it as a real alternative.
BACKUP_GEOMETRY = [(26.1445, 91.7362), (27.1, 92.9), (26.7509, 94.2037)]


class _OneCorridor:
    """A provider that only ever finds one road. The common case here."""

    async def route_options(
        self, origin, destination, *, kind, limit=1, detailed=False
    ):  # noqa: ANN001
        from app.services.routing.base import ChainAttempt, ChainOptions

        return ChainOptions(
            candidates=(
                RouteCandidate(
                    kind=kind,
                    provider="stub",
                    geometry=PRIMARY_GEOMETRY,
                    distance_m=305_000.0,
                    duration_s=221 * 60.0,
                ),
            ),
            attempts=(ChainAttempt("stub", ok=True),),
        )

    async def route(self, origin, destination, *, kind):  # noqa: ANN001
        from app.services.routing.base import ChainResult

        options = await self.route_options(origin, destination, kind=kind, limit=1)
        return ChainResult(candidate=options.candidates[0], attempts=options.attempts)


class _TwoCorridors(_OneCorridor):
    """A provider offering a second, genuinely separate road."""

    async def route_options(
        self, origin, destination, *, kind, limit=1, detailed=False
    ):  # noqa: ANN001
        from app.services.routing.base import ChainAttempt, ChainOptions

        return ChainOptions(
            candidates=(
                RouteCandidate(
                    kind=kind,
                    provider="stub",
                    geometry=PRIMARY_GEOMETRY,
                    distance_m=305_000.0,
                    duration_s=221 * 60.0,
                ),
                RouteCandidate(
                    kind=kind,
                    provider="stub",
                    geometry=BACKUP_GEOMETRY,
                    distance_m=326_000.0,
                    duration_s=244 * 60.0,
                ),
            ),
            attempts=(ChainAttempt("stub", ok=True),),
        )


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


@pytest.fixture
def routing(monkeypatch):
    """Install a routing stub. Explicit per test - the shape IS the fixture."""

    def install(chain) -> None:
        monkeypatch.setattr(route_service, "build_chain", lambda: chain)

    return install


@pytest.fixture
def weather_by_latitude(monkeypatch):
    """Rain on one whole corridor and not the other.

    Classified per CALL rather than per point. `observations_for` is invoked
    once per route with that route's five sample positions, so the northernmost
    of them identifies which corridor is being asked about - the two differ
    only in their middle waypoint. Deciding per point instead would put dry
    weather on the shared endpoints of both roads and leave the two scores a
    few points apart, which is a test of the sampler rather than of the
    comparison.
    """

    def install(*, north_rain: float, south_rain: float, gust: float = 5.0):
        calls = {"n": 0}

        async def fake(positions):
            calls["n"] += 1
            from app.domain.weather import WeatherObservation

            northern = max((lat for lat, _ in positions), default=0.0) > 26.9
            rain = north_rain if northern else south_rain
            return [
                WeatherObservation(
                    lat=lat,
                    lon=lon,
                    provider="stub-weather",
                    observed_at=datetime.now(UTC),
                    precipitation_mm=rain,
                    wind_gust_kmh=gust,
                )
                for lat, lon in positions
            ]

        monkeypatch.setattr(risk_service, "observations_for", fake)
        return calls

    return install


async def _trip_with_routes(
    api: AsyncClient, session: AsyncSession, headers: dict
) -> uuid.UUID:
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
    return trip.id


class TestSingleCorridor:
    async def test_one_route_is_recommended_and_says_so(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather_by_latitude,
    ) -> None:
        """No backup is invented to make the answer look richer."""
        routing(_OneCorridor())
        weather_by_latitude(north_rain=0.0, south_rain=0.0)
        trip_id = await _trip_with_routes(api, session, manager_headers)

        r = await api.get(
            f"/api/trips/{trip_id}/routes/recommendation", headers=manager_headers
        )
        assert r.status_code == 200, r.text
        body = r.json()

        assert len(body["candidates"]) == 1
        assert body["recommended_route_id"] == body["candidates"][0]["route_id"]
        assert body["comparable"] is False
        assert "ONLY_ONE_ROUTE_AVAILABLE" in body["reason_codes"]
        assert body["tradeoff"] is None
        # The recommendation still names what it could NOT see. `landslide` is
        # no longer in that list here because `clear_hazard_evidence` supplies
        # a source that actually answered - which is the point of the fixture.
        # The roadmap factors remain genuinely unavailable and must still be
        # reported, or a dispatcher would read a partial score as a complete one.
        assert "landslide" not in body["unavailable_inputs"]
        assert "road_quality" in body["unavailable_inputs"]


class TestTwoCorridors:
    async def test_the_wetter_corridor_loses_and_the_cost_is_stated(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather_by_latitude,
    ) -> None:
        routing(_TwoCorridors())
        # Heavy rain on the southern (PRIMARY) corridor, dry on the northern.
        weather_by_latitude(north_rain=0.0, south_rain=14.0)
        trip_id = await _trip_with_routes(api, session, manager_headers)

        r = await api.get(
            f"/api/trips/{trip_id}/routes/recommendation", headers=manager_headers
        )
        assert r.status_code == 200, r.text
        body = r.json()

        assert len(body["candidates"]) == 2
        assert body["comparable"] is True

        by_kind = {c["kind"]: c for c in body["candidates"]}
        assert set(by_kind) == {"PRIMARY", "EMERGENCY_BACKUP"}
        assert by_kind["PRIMARY"]["risk"]["score"] > (
            by_kind["EMERGENCY_BACKUP"]["risk"]["score"]
        )

        assert body["baseline_route_id"] == by_kind["PRIMARY"]["route_id"]
        assert body["recommended_route_id"] == by_kind["EMERGENCY_BACKUP"]["route_id"]
        assert "LOWER_RISK_ALTERNATIVE" in body["reason_codes"]

        # The cost is real and is stated in the units it was measured in.
        tradeoff = body["tradeoff"]
        assert tradeoff["risk_delta_points"] < 0
        assert tradeoff["duration_delta_min"] == pytest.approx(23.0)
        assert tradeoff["distance_delta_km"] == pytest.approx(21.0)
        assert "ALTERNATIVE_IS_SLOWER" in body["reason_codes"]

    async def test_equal_weather_keeps_the_primary(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather_by_latitude,
    ) -> None:
        """The backup is longer and slower; with nothing to gain, it loses."""
        routing(_TwoCorridors())
        weather_by_latitude(north_rain=3.0, south_rain=3.0)
        trip_id = await _trip_with_routes(api, session, manager_headers)

        body = (
            await api.get(
                f"/api/trips/{trip_id}/routes/recommendation", headers=manager_headers
            )
        ).json()

        by_kind = {c["kind"]: c for c in body["candidates"]}
        assert body["recommended_route_id"] == by_kind["PRIMARY"]["route_id"]
        assert "RISK_DIFFERENCE_WITHIN_MARGIN" in body["reason_codes"]
        # Declined, but the figures behind the refusal still travel.
        assert body["tradeoff"] is not None

    async def test_a_superseded_route_is_not_a_candidate(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather_by_latitude,
    ) -> None:
        """History is evidence; advice is about what to do next."""
        routing(_TwoCorridors())
        weather_by_latitude(north_rain=0.0, south_rain=14.0)
        trip_id = await _trip_with_routes(api, session, manager_headers)

        backup = (
            await session.execute(
                select(TripRoute).where(
                    TripRoute.trip_id == trip_id,
                    TripRoute.kind == RouteKind.EMERGENCY_BACKUP,
                )
            )
        ).scalar_one()
        backup.state = RouteState.SUPERSEDED
        await session.commit()

        body = (
            await api.get(
                f"/api/trips/{trip_id}/routes/recommendation", headers=manager_headers
            )
        ).json()

        assert [c["kind"] for c in body["candidates"]] == ["PRIMARY"]
        assert "ONLY_ONE_ROUTE_AVAILABLE" in body["reason_codes"]


class TestHonesty:
    async def test_a_weather_outage_does_not_fail_the_request(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        monkeypatch,
    ) -> None:
        """Distance and duration are still real evidence."""
        routing(_TwoCorridors())

        async def no_weather(positions):
            return []

        monkeypatch.setattr(risk_service, "observations_for", no_weather)
        trip_id = await _trip_with_routes(api, session, manager_headers)

        r = await api.get(
            f"/api/trips/{trip_id}/routes/recommendation", headers=manager_headers
        )
        assert r.status_code == 200, r.text
        body = r.json()

        assert "weather" in body["unavailable_inputs"]
        # Both blind in the same way, so a comparison is still fair.
        assert body["comparable"] is True
        assert body["recommended_route_id"] is not None

    async def test_no_percentage_or_model_field_reaches_the_wire(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather_by_latitude,
    ) -> None:
        routing(_TwoCorridors())
        weather_by_latitude(north_rain=0.0, south_rain=14.0)
        trip_id = await _trip_with_routes(api, session, manager_headers)

        raw = (
            await api.get(
                f"/api/trips/{trip_id}/routes/recommendation", headers=manager_headers
            )
        ).text

        for forbidden in (
            "confidence",
            "model_version",
            "probability",
            "predicted",
            "percent",
            "%",
        ):
            assert forbidden not in raw, (
                f"{forbidden!r} implies a claim this rule cannot support"
            )

    async def test_the_version_names_the_rule_not_a_model(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather_by_latitude,
    ) -> None:
        routing(_OneCorridor())
        weather_by_latitude(north_rain=0.0, south_rain=0.0)
        trip_id = await _trip_with_routes(api, session, manager_headers)

        body = (
            await api.get(
                f"/api/trips/{trip_id}/routes/recommendation", headers=manager_headers
            )
        ).json()
        assert body["version"] == "explainable-route-recommendation-v1"
        assert body["margin_points"] == 10


class TestScopingAndAuth:
    async def test_an_unknown_trip_is_404(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        r = await api.get(
            f"/api/trips/{uuid.uuid4()}/routes/recommendation", headers=manager_headers
        )
        assert r.status_code == 404

    async def test_anonymous_is_rejected(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, routing,
        weather_by_latitude,
    ) -> None:
        routing(_OneCorridor())
        weather_by_latitude(north_rain=0.0, south_rain=0.0)
        trip_id = await _trip_with_routes(api, session, manager_headers)

        r = await api.get(f"/api/trips/{trip_id}/routes/recommendation")
        assert r.status_code == 401

    async def test_a_trip_with_no_routes_says_so_rather_than_erroring(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await factories.make_assignment(session, driver, truck)
        trip = await factories.make_trip(
            session, driver, truck, assignment=assignment, stops=2
        )

        r = await api.get(
            f"/api/trips/{trip.id}/routes/recommendation", headers=manager_headers
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["recommended_route_id"] is None
        assert body["candidates"] == []
        assert "NO_ROUTES_PLANNED" in body["reason_codes"]


class TestConnectionLifetime:
    async def test_no_pooled_connection_is_held_across_the_weather_fan_out(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        monkeypatch,
    ) -> None:
        """The measured rule the rest of the routing stack already follows.

        This endpoint fans out for EVERY candidate, so the window is the widest
        in the system. The assertion is made from inside the stub, at the exact
        moment the request is out of the database's hands.
        """
        routing(_TwoCorridors())
        trip_id = await _trip_with_routes(api, session, manager_headers)

        from app.db import session as db_session

        pool = db_session.get_engine().pool
        # Relative to a baseline, not to zero: the test's own `session` fixture
        # holds a connection of its own for the whole test.
        baseline = pool.checkedout()
        during: list[int] = []

        async def watching(positions):
            during.append(pool.checkedout())
            return []

        monkeypatch.setattr(risk_service, "observations_for", watching)

        r = await api.get(
            f"/api/trips/{trip_id}/routes/recommendation", headers=manager_headers
        )
        assert r.status_code == 200, r.text
        assert during, "the weather fan-out never ran"
        assert len(during) == 2, "both routes should have been assessed"
        assert max(during) <= baseline, (
            "a pooled database connection was held across the weather calls "
            f"(baseline {baseline}, during call {during})"
        )
