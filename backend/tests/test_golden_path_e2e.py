"""The whole journey, once, in order, over real HTTP.

Every step here is covered somewhere else in more depth. This exists for the
failure those suites are worst at: a chain where each link is tested and the
chain itself is not connected.

That is not hypothetical. NER-B03 was exactly this shape - `api.selectRoute`
had existed since P7, was tested on the server, and no client ever called it,
so `trips.selected_route_id` was never set and THREE downstream features
quietly reported their empty states. Nothing failed. Everything passed. The gap
was only visible by walking the path end to end.

So this walks it:

    plan trip -> plan routes -> SELECT a route -> dispatch -> driver starts
      -> driver reports a position -> progress along the planned line
      -> assess the corridor -> accept a reroute -> the trip is on the new road

and asserts at each step that the NEXT step's precondition actually holds.
"""

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.routing import RouteCandidate
from app.models.enums import RouteKind, RouteState, TripEventKind, TripStatus, UserRole
from app.models.operations import Trip, TripEvent, TripRoute
from app.services import route_risk as risk_service
from app.services import routes as route_service
from tests import factories
from tests.conftest import auth_headers

# LS-7: this suite tests packaging/selection/journey behaviour, not the
# hazard policy. `clear_hazard_evidence` supplies a source that really
# answered, so these exercise what they mean to. Absence-of-evidence
# behaviour lives in tests/test_route_eligibility.py and
# tests/test_route_selection_hazard_api.py.
pytestmark = [pytest.mark.requires_db, pytest.mark.usefixtures("clear_hazard_evidence")]

SOUTHERN = [(26.1445, 91.7362), (26.4, 92.9), (26.7509, 94.2037)]
NORTHERN = [(26.1445, 91.7362), (27.1, 92.9), (26.7509, 94.2037)]


class _TwoCorridors:
    async def route_options(
        self, origin, destination, *, kind, limit=1, detailed=False
    ):  # noqa: ANN001
        from app.services.routing.base import ChainAttempt, ChainOptions

        return ChainOptions(
            candidates=(
                RouteCandidate(
                    kind=kind,
                    provider="stub",
                    geometry=SOUTHERN,
                    distance_m=305_000.0,
                    duration_s=221 * 60.0,
                ),
                RouteCandidate(
                    kind=kind,
                    provider="stub",
                    geometry=NORTHERN,
                    distance_m=326_000.0,
                    duration_s=244 * 60.0,
                ),
            ),
            attempts=(ChainAttempt("stub", ok=True),),
        )

    async def route(self, origin, destination, *, kind):  # noqa: ANN001
        from app.services.routing.base import ChainResult

        options = await self.route_options(origin, destination, kind=kind, limit=1)
        return ChainResult(candidate=options.candidates[0], attempts=options.attempts)


@pytest.fixture(autouse=True)
def _stub_routing(monkeypatch):
    monkeypatch.setattr(route_service, "build_chain", lambda: _TwoCorridors())


@pytest.fixture(autouse=True)
def _storm_on_the_southern_corridor(monkeypatch):
    """Heavy weather on the road the trip starts on, calm on the alternative.

    Classified per call, because `observations_for` is invoked once per route
    with that route's sample points.
    """

    async def fake(positions):
        from app.domain.weather import WeatherObservation

        northern = max((lat for lat, _ in positions), default=0.0) > 26.9
        return [
            WeatherObservation(
                lat=lat,
                lon=lon,
                provider="stub-weather",
                observed_at=datetime.now(UTC),
                precipitation_mm=0.0 if northern else 30.0,
                wind_gust_kmh=5.0 if northern else 90.0,
            )
            for lat, lon in positions
        ]

    monkeypatch.setattr(risk_service, "observations_for", fake)


async def test_the_whole_journey(api: AsyncClient, session: AsyncSession) -> None:
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    manager_headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)

    driver, driver_user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck, verified=True)
    # DRAFT, not the factory's default ASSIGNED: this test is about the whole
    # chain, and dispatch is a link in it. Starting from an already-dispatched
    # trip would skip the step and then fail on ASSIGNED -> ASSIGNED.
    trip = await factories.make_trip(
        session,
        driver,
        truck,
        assignment=assignment,
        stops=2,
        status=TripStatus.DRAFT,
    )
    driver_headers = await auth_headers(
        api, driver_user.phone, factories.TEST_PASSWORD
    )

    # --- 1. Plan routes -----------------------------------------------------
    planned = await api.post(
        f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
    )
    assert planned.status_code == 201, planned.text
    assert planned.json()["backup_planned"] is True, (
        "the two-corridor stub did not produce a real backup"
    )

    routes = (
        await session.execute(select(TripRoute).where(TripRoute.trip_id == trip.id))
    ).scalars().all()
    primary = next(r for r in routes if r.kind is RouteKind.PRIMARY)
    backup = next(r for r in routes if r.kind is RouteKind.EMERGENCY_BACKUP)

    # Planning alone must NOT select anything. This is the precondition
    # NER-B03 violated: without an explicit selection everything downstream
    # reports empty and looks broken.
    await session.refresh(trip)
    assert trip.selected_route_id is None

    # --- 2. Recommend, before choosing --------------------------------------
    advice = (
        await api.get(
            f"/api/trips/{trip.id}/routes/recommendation", headers=manager_headers
        )
    ).json()
    assert advice["comparable"] is True
    assert len(advice["candidates"]) == 2
    # The storm is on the primary, so the backup should win by more than the
    # published margin.
    assert advice["recommended_route_id"] == str(backup.id)
    assert advice["tradeoff"]["risk_delta_points"] <= -advice["margin_points"]

    # --- 3. Select the PRIMARY anyway ---------------------------------------
    # Deliberately overruling the recommendation: the rule advises, a person
    # decides, and the reroute path later has something to propose away from.
    chosen = await api.post(
        f"/api/trips/{trip.id}/routes/{primary.id}/select", headers=manager_headers
    )
    assert chosen.status_code == 200, chosen.text
    await session.refresh(trip)
    assert trip.selected_route_id == primary.id

    # --- 4. Dispatch --------------------------------------------------------
    dispatched = await api.post(
        f"/api/trips/{trip.id}/dispatch", headers=manager_headers
    )
    assert dispatched.status_code == 200, dispatched.text
    assert dispatched.json()["status"] == "ASSIGNED"

    # --- 5. The driver sees it and starts -----------------------------------
    mine = (await api.get("/api/driver/me/trip", headers=driver_headers)).json()
    assert mine["id"] == str(trip.id)
    assert mine["can_start"] is True, mine["start_blocked_reason"]

    started = await api.post(
        "/api/driver/me/trip/start", headers=driver_headers, json={}
    )
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "ACTIVE"

    # --- 6. The corridor downloads for offline use --------------------------
    package = (
        await api.get("/api/driver/me/trip/offline-package", headers=driver_headers)
    ).json()
    assert package["selected_route"]["route_id"] == str(primary.id)
    assert package["backup_route"] is not None
    # The licence gap is declared at the depot, not discovered in a valley.
    assert package["basemap"] == "BUNDLED_NONE"
    # The risk travelling with it is a snapshot, and says when it was taken.
    assert package["risk_captured_at"] is not None

    # --- 7. A position, and progress along the PLANNED line -----------------
    midpoint = SOUTHERN[1]
    sent = await api.post(
        "/api/driver/me/location",
        headers=driver_headers,
        json={
            "fixes": [
                {
                    "device_fix_id": str(uuid.uuid4()),
                    "location": {"lat": midpoint[0], "lon": midpoint[1]},
                    "recorded_at": datetime.now(UTC).isoformat(),
                }
            ]
        },
    )
    assert sent.status_code in (200, 202), sent.text

    progress = (
        await api.get("/api/driver/me/trip", headers=driver_headers)
    ).json()["progress"]
    assert progress is not None, "selecting a route did not reach the driver"
    assert progress["on_route"] is True
    assert 0.0 < progress["fraction_complete"] < 1.0
    assert progress["remaining_distance_km"] > 0
    # Still not an ETA, at the end of the chain as at the start.
    assert "REMAINING_TIME_ASSUMES_PLANNED_PACE" in progress["reason_codes"]

    # --- 8. The road has gone bad -------------------------------------------
    assessment = (
        await api.get(f"/api/trips/{trip.id}/reroute", headers=manager_headers)
    ).json()
    assert assessment["outcome"] == "PROPOSE", assessment
    assert assessment["selected_route_id"] == str(primary.id)
    assert assessment["proposed_route_id"] == str(backup.id)

    # --- 9. A person accepts -------------------------------------------------
    accepted = await api.post(
        f"/api/trips/{trip.id}/reroute/accept",
        headers=manager_headers,
        json={
            "from_route_id": str(primary.id),
            "to_route_id": str(backup.id),
        },
    )
    assert accepted.status_code == 200, accepted.text

    await session.refresh(trip)
    await session.refresh(primary)
    await session.refresh(backup)
    assert trip.selected_route_id == backup.id
    assert backup.state is RouteState.SELECTED
    # Not SUPERSEDED: a reroute is not a one-way door.
    assert primary.state is RouteState.PROPOSED

    event = (
        await session.execute(
            select(TripEvent).where(
                TripEvent.trip_id == trip.id,
                TripEvent.kind == TripEventKind.ROUTE_CHANGED,
            )
        )
    ).scalar_one()
    assert event.payload["from_route_id"] == str(primary.id)
    assert event.payload["to_route_id"] == str(backup.id)
    assert event.actor_user_id == manager.id

    # --- 10. The driver is now measured against the NEW road ----------------
    after = (await api.get("/api/driver/me/trip", headers=driver_headers)).json()
    assert after["status"] == "ACTIVE"
    assert after["progress"] is not None
    # The truck has not moved, but the road under it has. Its old midpoint is
    # nowhere near the northern corridor, so the honest answer is off-route -
    # which is precisely what a dispatcher needs to see after rerouting a truck
    # that is already driving.
    assert after["progress"]["on_route"] is False
    assert "VEHICLE_OFF_PLANNED_ROUTE" in after["progress"]["reason_codes"]

    reloaded = (
        await session.execute(select(Trip).where(Trip.id == trip.id))
    ).scalar_one()
    assert reloaded.status is TripStatus.ACTIVE
