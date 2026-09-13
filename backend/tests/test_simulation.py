"""DEMO SIMULATION: labelled, bounded, on one route, never a live claim."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.domain.route_risk import RouteRisk
from app.models.enums import UserRole
from app.services import simulation
from tests import factories
from tests.conftest import auth_headers


def _risk(score=10, codes=("STEEP_GRADIENT_ON_ROUTE",)):
    return RouteRisk(score=score, band="LOW", components=(), inputs={"weather": "AVAILABLE"}, unavailable=(),
                     reason_codes=codes, observations_used=3, observations_stale=0)


def test_apply_labels_and_escalates_only_the_simulated_route(monkeypatch):
    monkeypatch.setenv("DEMO_SIMULATION_ENABLED", "true")
    trip, route, other = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    simulation.start(trip, route, "ROAD_INCIDENT", minutes=5)
    out = simulation.apply(route, _risk())
    assert out.band == "HIGH" and "DEMO_SIMULATION_ACTIVE" in out.reason_codes and "LANDSLIDE_OFFICIAL_ROAD_CLOSURE" in out.reason_codes
    assert "STEEP_GRADIENT_ON_ROUTE" in out.reason_codes  # real evidence kept beside the synthetic
    assert out.components[-1].code == "DEMO_SIMULATION"
    assert simulation.apply(other, _risk()).reason_codes == ("STEEP_GRADIENT_ON_ROUTE",)
    # expired -> no-op; PROVIDER_FAILURE -> weather NOT_AVAILABLE, never safer
    assert simulation.apply(route, _risk(), now=simulation._active[trip].until + 1).reason_codes == ("STEEP_GRADIENT_ON_ROUTE",)
    simulation.start(trip, route, "PROVIDER_FAILURE", minutes=5)
    pf = simulation.apply(route, _risk())
    assert pf.inputs["weather"] == "NOT_AVAILABLE" and "weather" in pf.unavailable and pf.score >= 10
    simulation.stop(trip)
    assert simulation.apply(route, _risk()).reason_codes == ("STEEP_GRADIENT_ON_ROUTE",)


def test_disabled_service_never_injects(monkeypatch):
    monkeypatch.setenv("DEMO_SIMULATION_ENABLED", "false")
    trip, route = uuid.uuid4(), uuid.uuid4()
    simulation.start(trip, route, "HEAVY_MONSOON_RAIN")
    assert simulation.apply(route, _risk()).score == 10
    simulation.stop(trip)


@pytest.mark.requires_db
async def test_manager_starts_and_clears_a_scenario(api: AsyncClient, session: AsyncSession, monkeypatch):
    monkeypatch.setenv("DEMO_SIMULATION_ENABLED", "true")
    get_settings.cache_clear()
    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    trip = await factories.make_trip(session, driver, truck)
    await session.commit()
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    m = await auth_headers(api, manager.email, factories.TEST_PASSWORD)
    d = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)

    assert (await api.post(f"/api/trips/{trip.id}/simulation?scenario=HEAVY_MONSOON_RAIN", headers=d)).status_code == 403
    no_route = await api.post(f"/api/trips/{trip.id}/simulation?scenario=HEAVY_MONSOON_RAIN", headers=m)
    assert no_route.status_code == 422  # no selected route yet
    bad = await api.post(f"/api/trips/{trip.id}/simulation?scenario=ALIENS", headers=m)
    assert bad.status_code == 422
    listed = await api.get("/api/system/simulation", headers=d)
    assert listed.status_code == 200 and listed.json()["enabled"] is True
    assert (await api.delete(f"/api/trips/{trip.id}/simulation", headers=m)).json() == {"cleared": False}
