"""A driver off the planned road asks for a road from WHERE THE TRUCK IS.

The request plans a real route from the reported position to the trip's
destination and stores it as a PROPOSED EMERGENCY_BACKUP. It does NOT move the
trip: the selected route is untouched, and the new road reaches the driver
through the offline package's `backup_route` and the manager through the
ordinary reroute/accept path, with eligibility checked there. Governance is
kept; only the origin changes.
"""

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
from app.services.routing.base import RoutingUnavailable
from tests import factories
from tests.conftest import auth_headers

pytestmark = [pytest.mark.requires_db, pytest.mark.usefixtures("clear_hazard_evidence")]

# Guwahati -> Jorhat, the corridor the factory trip's stops actually span:
# the validated planner refuses a line that does not reach the destination.
PLANNED = [(26.1445, 91.7362), (26.4, 92.9), (26.7509, 94.2037)]
OFF_ROAD = (26.1, 92.6)


class _Recording:
    """One corridor per call, remembering the origin it was asked for."""

    def __init__(self) -> None:
        self.origins: list[tuple[float, float]] = []
        self.fail = False
        #: Distance of the road planned from the reported position; None = 190 km.
        self.reroute_m: float | None = None

    async def route_options(self, origin, destination, *, kind, limit=1, detailed=False):  # noqa: ANN001
        from app.services.routing.base import ChainAttempt, ChainOptions

        if self.fail:
            raise RoutingUnavailable("stub down")
        self.origins.append((origin.lat, origin.lon))
        rerouting = bool(self.origins[1:])
        geometry = [(origin.lat, origin.lon), PLANNED[-1]] if rerouting else PLANNED
        return ChainOptions(
            candidates=(
                RouteCandidate(
                    kind=kind,
                    provider="stub",
                    geometry=geometry,
                    distance_m=(self.reroute_m or 190_000.0) if rerouting else 305_000.0,
                    duration_s=90 * 60.0,
                ),
            ),
            attempts=(ChainAttempt("stub", ok=True),),
        )


@pytest.fixture
def chain(monkeypatch) -> _Recording:
    stub = _Recording()
    monkeypatch.setattr(route_service, "build_chain", lambda: stub)
    return stub


@pytest.fixture(autouse=True)
def _weather(monkeypatch):
    async def fake(positions):  # noqa: ANN001
        from app.domain.weather import WeatherObservation

        return [
            WeatherObservation(
                lat=lat, lon=lon, provider="stub-weather",
                observed_at=datetime.now(UTC), precipitation_mm=0.0, wind_gust_kmh=5.0,
            )
            for lat, lon in positions
        ]

    monkeypatch.setattr(risk_service, "observations_for", fake)


async def _trip(api: AsyncClient, session: AsyncSession, *, start: bool):
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    manager_headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)
    driver, user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck, verified=True)
    trip = await factories.make_trip(session, driver, truck, assignment=assignment, stops=2)

    planned = await api.post(f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers)
    assert planned.status_code == 201, planned.text
    primary = (
        await session.execute(select(TripRoute).where(TripRoute.trip_id == trip.id))
    ).scalars().one()
    chosen = await api.post(f"/api/trips/{trip.id}/routes/{primary.id}/select", headers=manager_headers)
    assert chosen.status_code == 200, chosen.text

    headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
    if start:
        started = await api.post("/api/driver/me/trip/start", headers=headers, json={})
        assert started.status_code == 200, started.text
    return trip, primary, headers


async def test_plans_from_the_reported_position_and_leaves_the_trip_on_its_road(
    api: AsyncClient, session: AsyncSession, chain: _Recording
) -> None:
    trip, primary, headers = await _trip(api, session, start=True)
    trip_id, primary_id = trip.id, str(primary.id)

    res = await api.post(
        "/api/driver/me/trip/reroute", headers=headers,
        json={"lat": OFF_ROAD[0], "lon": OFF_ROAD[1]},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert chain.origins[-1] == OFF_ROAD
    assert body["kind"] == "EMERGENCY_BACKUP"
    assert body["distance_km"] == 190.0
    assert body["estimated_duration_min"] == 90

    session.expire_all()
    rows = (await session.execute(select(TripRoute).where(TripRoute.trip_id == trip_id))).scalars().all()
    by_id = {str(r.id): r for r in rows}
    assert by_id[primary_id].state is RouteState.SELECTED
    assert by_id[body["route_id"]].state is RouteState.PROPOSED
    assert by_id[body["route_id"]].kind is RouteKind.EMERGENCY_BACKUP
    assert by_id[body["route_id"]].maneuvers is None or isinstance(by_id[body["route_id"]].maneuvers, list)

    # The driver's own package now carries it as the backup road.
    pkg = (await api.get("/api/driver/me/trip/offline-package", headers=headers)).json()
    assert pkg["selected_route"]["route_id"] == primary_id
    assert pkg["backup_route"]["route_id"] == body["route_id"]
    assert pkg["backup_route"]["geometry"][0] == [OFF_ROAD[0], OFF_ROAD[1]]


async def test_a_trip_that_has_not_left_cannot_be_rerouted(
    api: AsyncClient, session: AsyncSession, chain: _Recording
) -> None:
    _, _, headers = await _trip(api, session, start=False)
    res = await api.post(
        "/api/driver/me/trip/reroute", headers=headers, json={"lat": OFF_ROAD[0], "lon": OFF_ROAD[1]}
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "TRIP_NOT_IN_TRANSIT"
    assert len(chain.origins) == 1  # only the manager's plan reached the provider


async def test_provider_outage_is_503_and_persists_nothing(
    api: AsyncClient, session: AsyncSession, chain: _Recording
) -> None:
    trip, _, headers = await _trip(api, session, start=True)
    trip_id = trip.id
    chain.fail = True
    res = await api.post(
        "/api/driver/me/trip/reroute", headers=headers, json={"lat": OFF_ROAD[0], "lon": OFF_ROAD[1]}
    )
    assert res.status_code == 503, res.text
    session.expire_all()
    rows = (await session.execute(select(TripRoute).where(TripRoute.trip_id == trip_id))).scalars().all()
    assert len(rows) == 1


# A phone whose GPS is in another state (Gujarat, 16 Sep) asked for a road
# from there: the provider returned a perfectly self-consistent 2,451 km route
# to Shillong, and it was stored as the trip's EMERGENCY_BACKUP. A road from
# where the truck is must still be a road for THIS trip.
FAR_AWAY = (24.0, 73.0)


async def test_a_road_from_far_outside_the_corridor_is_refused_and_nothing_is_stored(
    api: AsyncClient, session: AsyncSession, chain: _Recording
) -> None:
    trip, primary, headers = await _trip(api, session, start=True)
    trip_id = trip.id
    chain.reroute_m = 2_451_000.0

    res = await api.post(
        "/api/driver/me/trip/reroute", headers=headers,
        json={"lat": FAR_AWAY[0], "lon": FAR_AWAY[1]},
    )
    assert res.status_code == 422, res.text
    assert res.json()["error"]["code"] == "ROUTE_VALIDATION_FAILED"

    session.expire_all()
    rows = (await session.execute(select(TripRoute).where(TripRoute.trip_id == trip_id))).scalars().all()
    assert [r.id for r in rows] == [primary.id]
    assert rows[0].state is RouteState.SELECTED
