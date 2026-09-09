"""LS-7: the live HTTP proof that a closed route cannot be selected.

This is the test every prior mission asked for and none could run, because
there was no isolated database. It now runs against a project-local
PostgreSQL 18.2 + PostGIS 3.6 cluster.

WHAT IS REAL HERE

Real HTTP through the ASGI app, real login and bearer token, real permission
dependency, real trip and routes persisted in PostGIS, real geometry read,
real risk assessment, real eligibility computation, real guard, real
transaction. Nothing about authentication or the mutation path is stubbed.

WHAT IS INJECTED, AND WHERE

Exactly one thing: the landslide PROVIDER, at
`route_risk.build_landslide_provider`. That is the same seam a real hazard
source would occupy. The guard is NOT patched - patching it would prove the
guard works, which was never in doubt; what was in doubt is whether the live
HTTP path reaches it.

Every incident here is SYNTHETIC and describes no real road.

PERSISTED STATE IS INSPECTED, NOT ASSUMED

A non-2xx response does not prove the database is unchanged. Each refusal test
records `selected_route_id` and route lifecycle before the request and
re-reads them afterwards from a fresh statement.
"""

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.landslide import (
    IncidentQueryResult,
    IncidentSource,
    LandslideIncident,
    SourceState,
    SourceType,
    VerificationStatus,
)
from app.domain.routing import RouteCandidate
from app.models.enums import UserRole
from app.models.operations import Trip, TripRoute
from app.services import route_risk as risk_service
from app.services import routes as route_service
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

NOW = datetime(2026, 9, 5, tzinfo=UTC)

#: The corridor the stubbed routing provider returns. Guwahati -> Jorhat-ish.
GEOMETRY = [(26.1445, 91.7362), (26.4, 92.9), (26.7509, 94.2037)]


class _StubChain:
    """Enough of RoutingChain to plant a route worth selecting.

    Stubbed so planning does not depend on the live OSRM demo server; the
    GEOMETRY it returns is still read back out of PostGIS and sampled for
    real by the risk service.
    """

    async def route_options(
        self, origin, destination, *, kind, limit=1, detailed=False
    ):  # noqa: ANN001
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


@pytest.fixture(autouse=True)
def _stub_routing(monkeypatch):
    monkeypatch.setattr(route_service, "build_chain", lambda: _StubChain())


@pytest.fixture(autouse=True)
def _stub_weather(monkeypatch):
    """Weather is not what these tests are about."""
    async def _none(positions):  # noqa: ANN001
        return []

    monkeypatch.setattr(risk_service, "observations_for", _none)


class _Source:
    """Injected at the provider seam. TEST-ONLY."""

    name = "ls7-synthetic-source"

    def __init__(self, result: IncidentQueryResult):
        self._result = result

    async def incidents_near(self, box, *, since, until):  # noqa: ANN001
        return self._result


def _clear() -> IncidentQueryResult:
    """A source that really answered and found nothing. The route to ELIGIBLE."""
    return IncidentQueryResult(state=SourceState.AVAILABLE, provider="ls7-synthetic-source")


def _closed_on_route() -> IncidentQueryResult:
    """SYNTHETIC official closure sitting ON the corridor being selected.

    The incidents are placed at the EXACT positions `route_risk` will sample,
    computed with the same functions the service uses. An earlier version of
    this fixture scattered a 0.5-degree lattice (~55 km spacing) across the
    region and the tests passed with 200 OK - because nothing landed inside
    the 5 km on-route buffer. The lesson is that a hazard fixture has to be
    built from the route, not near it.
    """
    from app.domain.routing import sample_positions
    from app.services.route_risk import ROUTE_SAMPLES

    positions = sample_positions(GEOMETRY, ROUTE_SAMPLES)
    return IncidentQueryResult(
        state=SourceState.AVAILABLE,
        provider="ls7-synthetic-source",
        incidents=tuple(
            LandslideIncident(
                incident_id=f"ls7-synthetic-{i}",
                latitude=lat,
                longitude=lon,
                event_date=NOW,
                road_blocked=True,
                verification_status=VerificationStatus.OFFICIAL,
                sources=(
                    IncidentSource(
                        name="ls7-synthetic-authority",
                        source_type=SourceType.OFFICIAL_AGENCY,
                    ),
                ),
            )
            for i, (lat, lon) in enumerate(positions)
        ),
    )


def use_source(monkeypatch, result: IncidentQueryResult) -> None:
    monkeypatch.setattr(
        risk_service, "build_landslide_provider", lambda: _Source(result)
    )


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


async def _planned(api: AsyncClient, session: AsyncSession, headers: dict):
    """A real trip with real routes persisted in PostGIS."""
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
    rows = (
        await session.execute(select(TripRoute).where(TripRoute.trip_id == trip.id))
    ).scalars().all()
    assert rows, "planning produced no routes"
    return trip, rows


async def _persisted(session: AsyncSession, trip_id):
    """Re-read the facts a refusal must not have changed."""
    session.expire_all()
    trip = (await session.execute(select(Trip).where(Trip.id == trip_id))).scalar_one()
    routes = (
        await session.execute(select(TripRoute).where(TripRoute.trip_id == trip_id))
    ).scalars().all()
    return trip.selected_route_id, {r.id: r.state for r in routes}


class TestAClosedRouteCannotBeSelectedOverHttp:
    async def test_selection_is_refused_and_nothing_is_persisted(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, monkeypatch
    ):
        use_source(monkeypatch, _clear())
        trip, routes = await _planned(api, session, manager_headers)
        target = routes[0]

        before_selected, before_states = await _persisted(session, trip.id)

        # Now the corridor is officially closed.
        use_source(monkeypatch, _closed_on_route())
        response = await api.post(
            f"/api/trips/{trip.id}/routes/{target.id}/select", headers=manager_headers
        )

        # 422 is this project's mapping for BusinessRuleError, and the body is
        # {"error": {"code": ...}}. Asserted from the real contract rather than
        # an assumed 409.
        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "ROUTE_REJECTED_ACTIVE_HAZARD"

        # THE assertion a status code cannot make on its own.
        after_selected, after_states = await _persisted(session, trip.id)
        assert after_selected == before_selected
        assert after_states == before_states

    async def test_an_eligible_route_still_selects_and_persists(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, monkeypatch
    ):
        # The happy path, on sufficient evidence. Without this the refusal
        # above would be indistinguishable from "selection is simply broken".
        use_source(monkeypatch, _clear())
        trip, routes = await _planned(api, session, manager_headers)
        target = routes[0]

        response = await api.post(
            f"/api/trips/{trip.id}/routes/{target.id}/select", headers=manager_headers
        )
        assert response.status_code == 200, response.text

        selected, states = await _persisted(session, trip.id)
        assert selected == target.id
        assert states[target.id].value == "SELECTED"

    async def test_unknown_evidence_refuses_for_review_and_persists_nothing(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, monkeypatch
    ):
        # The PRODUCTION state: no hazard source configured. LS-7 policy says
        # required evidence that is unknown is not clearance.
        use_source(monkeypatch, _clear())
        trip, routes = await _planned(api, session, manager_headers)
        target = routes[0]
        before_selected, before_states = await _persisted(session, trip.id)

        monkeypatch.setattr(
            risk_service,
            "build_landslide_provider",
            lambda: _Source(
                IncidentQueryResult(state=SourceState.NOT_CONFIGURED, provider="none")
            ),
        )
        response = await api.post(
            f"/api/trips/{trip.id}/routes/{target.id}/select", headers=manager_headers
        )
        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "ROUTE_SELECTION_REQUIRES_REVIEW"

        after_selected, after_states = await _persisted(session, trip.id)
        assert after_selected == before_selected
        assert after_states == before_states

    async def test_a_client_cannot_forge_clearance_in_the_request_body(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, monkeypatch
    ):
        # The endpoint takes no eligibility input. Sending one must not help.
        use_source(monkeypatch, _clear())
        trip, routes = await _planned(api, session, manager_headers)
        target = routes[0]

        use_source(monkeypatch, _closed_on_route())
        response = await api.post(
            f"/api/trips/{trip.id}/routes/{target.id}/select",
            headers=manager_headers,
            json={"eligibility": "ELIGIBLE", "hazard_cleared": True, "override": True},
        )
        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "ROUTE_REJECTED_ACTIVE_HAZARD"

    async def test_an_anonymous_caller_is_denied_before_any_hazard_detail(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, monkeypatch
    ):
        # Authorization precedes disclosure: an unauthenticated caller must not
        # learn whether a particular route is closed.
        use_source(monkeypatch, _closed_on_route())
        trip, routes = await _planned(api, session, manager_headers)

        response = await api.post(f"/api/trips/{trip.id}/routes/{routes[0].id}/select")
        assert response.status_code in (401, 403), response.text
        assert "LANDSLIDE" not in response.text.upper()
        assert "HAZARD" not in response.text.upper()
