"""Route planning API: persistence, supersession, authorization, failure modes.

The provider is always stubbed. A test suite that reaches a third-party routing
service is not a test - it fails when someone else has a bad minute, and the
public OSRM demo server's own policy says "excessive use is not allowed".
`docs/TESTING_STRATEGY.md` §0.3 says the same thing: external providers are
stubbed at the interface boundary, which is exactly what `RoutingChain` is.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.routing import RouteCandidate, RoutingRejected, RoutingUnavailable
from app.models.enums import RouteKind, RouteState, TripStatus, UserRole
from app.models.operations import TripRoute
from app.services import routes as route_service
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

GEOMETRY = [(26.1445, 91.7362), (26.4, 92.9), (26.7509, 94.2037)]


#: A genuinely separate corridor - half a degree away, not a detour around a
#: roundabout. Used to prove a real alternative IS stored as a backup.
FAR_GEOMETRY = [(lat + 0.5, lon + 0.5) for lat, lon in GEOMETRY]
#: A few hundred metres off the same road. Must NOT be stored as a backup.
NUDGED_GEOMETRY = [(lat + 0.003, lon) for lat, lon in GEOMETRY]


class _StubChain:
    """Stands in for RoutingChain. Records what it was asked."""

    def __init__(
        self,
        *,
        raises=None,
        provider="stub",
        extra_geometry: list[tuple[float, float]] | None = None,
    ) -> None:
        self._raises = raises
        self._provider = provider
        self._extra = extra_geometry
        self.calls = 0

    def _make(self, kind, geometry, distance=308_000.0):  # noqa: ANN001
        return RouteCandidate(
            kind=kind,
            provider=self._provider,
            geometry=geometry,
            distance_m=distance,
            duration_s=21_600.0,
        )

    async def route_options(self, origin, destination, *, kind, limit=1):  # noqa: ANN001
        self.calls += 1
        if self._raises is not None:
            raise self._raises
        from app.services.routing.base import ChainAttempt, ChainOptions

        candidates = [self._make(kind, GEOMETRY)]
        if self._extra is not None and limit > 1:
            candidates.append(self._make(kind, self._extra, distance=330_000.0))
        return ChainOptions(
            candidates=tuple(candidates),
            attempts=(ChainAttempt(self._provider, ok=True),),
        )

    async def route(self, origin, destination, *, kind):  # noqa: ANN001
        from app.services.routing.base import ChainResult

        options = await self.route_options(origin, destination, kind=kind, limit=1)
        return ChainResult(
            candidate=options.candidates[0], attempts=options.attempts
        )


@pytest.fixture
def stub_chain(monkeypatch):
    """Replace the provider chain for the duration of one test."""

    def install(**kwargs):
        chain = _StubChain(**kwargs)
        monkeypatch.setattr(route_service, "build_chain", lambda: chain)
        return chain

    return install


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


async def _trip(session: AsyncSession):
    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck)
    return await factories.make_trip(
        session, driver, truck, assignment=assignment, stops=2
    )


class TestPlanRoute:
    async def test_a_planned_route_is_persisted_and_returned(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, stub_chain
    ) -> None:
        stub_chain()
        trip = await _trip(session)

        r = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        assert r.status_code == 201, r.text
        body = r.json()

        assert body["route"]["kind"] == RouteKind.PRIMARY.value
        assert body["route"]["state"] == RouteState.PROPOSED.value
        assert body["route"]["distance_km"] == "308.00"
        assert body["route"]["estimated_duration_min"] == 360
        assert body["provider"] == "stub"
        assert body["used_fallback"] is False

        stored = (
            await session.execute(
                select(TripRoute).where(TripRoute.trip_id == trip.id)
            )
        ).scalars().all()
        assert len(stored) == 1

    async def test_geometry_comes_back_as_lat_lon_for_the_map(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, stub_chain
    ) -> None:
        """Stored as WKT (lon-lat), returned as lat-lon like every other
        coordinate in this API. An inversion here draws the route in China."""
        stub_chain()
        trip = await _trip(session)

        r = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        first = r.json()["route"]["geometry"][0]
        assert first == pytest.approx([26.1445, 91.7362])

    async def test_no_fuel_estimate_is_invented(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, stub_chain
    ) -> None:
        """No fuel model exists, so no fuel number may appear - not even zero.

        The field is absent from the contract entirely rather than null, because
        a permanently-null field invites a client to render it as 0.
        """
        stub_chain()
        trip = await _trip(session)

        r = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        assert "estimated_fuel_litres" not in r.json()["route"]

        row = (
            await session.execute(
                select(TripRoute).where(TripRoute.trip_id == trip.id)
            )
        ).scalar_one()
        assert row.estimated_fuel_litres is None
        assert row.fuel_estimate_source is None

    async def test_replanning_supersedes_rather_than_overwrites(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, stub_chain
    ) -> None:
        """Route history is evidence in an incident review."""
        stub_chain()
        trip = await _trip(session)

        first = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        second = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        assert first.status_code == second.status_code == 201

        rows = (
            await session.execute(
                select(TripRoute).where(TripRoute.trip_id == trip.id)
            )
        ).scalars().all()
        assert len(rows) == 2, "the old route was overwritten instead of superseded"

        by_id = {str(r.id): r for r in rows}
        old = by_id[first.json()["route"]["id"]]
        new = by_id[second.json()["route"]["id"]]
        assert old.state is RouteState.SUPERSEDED
        assert old.superseded_by == new.id
        assert new.state is RouteState.PROPOSED

    async def test_provider_outage_is_503_not_422(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, stub_chain
    ) -> None:
        """"Every provider is down" and "no route exists" are different answers.

        Collapsing them would tell a manager a trip is unroutable when the
        provider is merely having a bad minute.
        """
        stub_chain(raises=RoutingUnavailable("all down"))
        trip = await _trip(session)

        r = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        assert r.status_code == 503, r.text
        assert r.json()["error"]["code"] == "ROUTING_UNAVAILABLE"

        stored = (
            await session.execute(
                select(TripRoute).where(TripRoute.trip_id == trip.id)
            )
        ).scalars().all()
        assert stored == [], "a failed plan persisted a route"

    async def test_an_unroutable_request_is_422_no_viable_route(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, stub_chain
    ) -> None:
        stub_chain(raises=RoutingRejected("no route"))
        trip = await _trip(session)

        r = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == "NO_VIABLE_ROUTE"

    async def test_an_unknown_trip_is_404_before_the_provider_is_called(
        self, api: AsyncClient, manager_headers: dict, stub_chain
    ) -> None:
        """Never spend a provider budget on a trip that does not exist."""
        chain = stub_chain()
        r = await api.post(
            f"/api/trips/{uuid.uuid4()}/routes/recalculate", headers=manager_headers
        )
        assert r.status_code == 404
        assert chain.calls == 0

    async def test_a_driver_cannot_plan_routes(
        self, api: AsyncClient, session: AsyncSession, stub_chain
    ) -> None:
        stub_chain()
        trip = await _trip(session)
        driver, user = await factories.make_driver(session)
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)

        r = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=headers
        )
        assert r.status_code == 403


    async def test_disabling_routing_refuses_before_any_provider_is_called(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict,
        stub_chain, monkeypatch,
    ) -> None:
        """ROUTING_ENABLED=False is for an offline demo, so it has to refuse
        *before* reaching out - a flag that still made the call would hang for
        the full timeout against an unreachable provider, which is the exact
        situation it exists to avoid.

        Untested until now, which is how a config flag ends up not working.
        """
        from app.core.config import get_settings

        chain = stub_chain()
        monkeypatch.setattr(get_settings(), "ROUTING_ENABLED", False)
        trip = await _trip(session)

        r = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )

        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == "ROUTING_DISABLED"
        assert chain.calls == 0, "the provider was called despite routing being off"


class TestSelectRoute:
    async def test_selecting_marks_the_route_and_the_trip(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, stub_chain
    ) -> None:
        stub_chain()
        trip = await _trip(session)
        planned = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        route_id = planned.json()["route"]["id"]

        r = await api.post(
            f"/api/trips/{trip.id}/routes/{route_id}/select", headers=manager_headers
        )
        assert r.status_code == 200, r.text
        assert r.json()["state"] == RouteState.SELECTED.value

        selected = (
            await session.execute(
                text("SELECT selected_route_id FROM trips WHERE id = :i"),
                {"i": trip.id},
            )
        ).scalar_one()
        assert str(selected) == route_id

    async def test_a_route_from_another_trip_is_404(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, stub_chain
    ) -> None:
        """Scoped by trip_id as well as route_id - otherwise selecting is a
        cross-trip write addressable by id alone."""
        stub_chain()
        mine = await _trip(session)
        theirs = await _trip(session)
        planned = await api.post(
            f"/api/trips/{theirs.id}/routes/recalculate", headers=manager_headers
        )
        other_route = planned.json()["route"]["id"]

        r = await api.post(
            f"/api/trips/{mine.id}/routes/{other_route}/select",
            headers=manager_headers,
        )
        assert r.status_code == 404

    async def test_a_superseded_route_cannot_be_selected(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, stub_chain
    ) -> None:
        stub_chain()
        trip = await _trip(session)
        first = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )

        r = await api.post(
            f"/api/trips/{trip.id}/routes/{first.json()['route']['id']}/select",
            headers=manager_headers,
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "ROUTE_SUPERSEDED"


class TestListRoutes:
    async def test_history_is_visible_including_superseded(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, stub_chain
    ) -> None:
        stub_chain()
        trip = await _trip(session)
        await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )

        r = await api.get(f"/api/trips/{trip.id}/routes", headers=manager_headers)
        assert r.status_code == 200
        states = [row["state"] for row in r.json()]
        assert RouteState.SUPERSEDED.value in states
        assert RouteState.PROPOSED.value in states


class TestBackupRoute:
    """EMERGENCY_BACKUP is written only for a genuinely different corridor.

    The negative case matters more than the positive one. A provider offering a
    three-hundred-metre detour around a roundabout must not become a second
    "option" on a dispatcher's screen, because choosing between two labels for
    the same road is not a choice - and it would be indistinguishable from a
    working feature.
    """

    async def test_a_separate_corridor_is_stored_as_a_backup(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, stub_chain
    ) -> None:
        stub_chain(extra_geometry=FAR_GEOMETRY)
        trip = await _trip(session)

        r = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        assert r.status_code == 201, r.text
        assert r.json()["backup_planned"] is True

        rows = (
            await session.execute(
                select(TripRoute).where(TripRoute.trip_id == trip.id)
            )
        ).scalars().all()
        kinds = sorted(row.kind.value for row in rows)
        assert kinds == ["EMERGENCY_BACKUP", "PRIMARY"]

    async def test_a_minor_detour_is_not_stored_as_a_backup(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, stub_chain
    ) -> None:
        stub_chain(extra_geometry=NUDGED_GEOMETRY)
        trip = await _trip(session)

        r = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        assert r.status_code == 201, r.text
        assert r.json()["backup_planned"] is False

        rows = (
            await session.execute(
                select(TripRoute).where(TripRoute.trip_id == trip.id)
            )
        ).scalars().all()
        assert [row.kind.value for row in rows] == ["PRIMARY"]

    async def test_one_road_means_no_backup_and_that_is_not_a_failure(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, stub_chain
    ) -> None:
        """The ordinary answer on most NER corridors."""
        stub_chain()  # provider returns a single option
        trip = await _trip(session)

        r = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        assert r.status_code == 201
        assert r.json()["backup_planned"] is False

    async def test_no_fuel_efficient_route_is_ever_invented(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, stub_chain
    ) -> None:
        """Ranking by consumption needs a fuel model, and none exists.

        Relabelling a route FUEL_EFFICIENT would be a fabricated feature that
        looks exactly like a working one.
        """
        stub_chain(extra_geometry=FAR_GEOMETRY)
        trip = await _trip(session)
        await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )

        rows = (
            await session.execute(
                select(TripRoute).where(TripRoute.trip_id == trip.id)
            )
        ).scalars().all()
        assert all(row.kind is not RouteKind.FUEL_EFFICIENT for row in rows)
        assert all(row.estimated_fuel_litres is None for row in rows)


class TestProviderCallDoesNotHoldTheDatabase:
    """A routing provider must not be able to exhaust the connection pool.

    PROVEN behaviour before this was fixed: the first SELECT in `plan()`
    autobegins a transaction and checks out a pooled connection, and both were
    still held while awaiting the provider - `pool.checkedout() == 1` and
    `pg_stat_activity.state == 'idle in transaction'` for the whole call.

    Why that matters here specifically: the routing timeout is 8 s, the pool is
    `DB_POOL_SIZE=5 + DB_MAX_OVERFLOW=10` = 15, and Supabase's session pooler
    allows 15 clients per project. So concurrent planning against a slow
    provider consumes the entire database budget waiting on somebody else's
    server - and an idle-in-transaction backend also holds back vacuum.

    The endpoints a route is planned between are immutable for the duration of
    the call, so nothing is gained by holding the read open across it. Trip
    state is re-read under a row lock afterwards regardless.
    """

    async def test_no_connection_is_held_while_the_provider_is_called(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, monkeypatch
    ) -> None:
        from app.db import session as db_session

        observed: dict = {}

        class _WatchingChain(_StubChain):
            async def route_options(self, origin, destination, *, kind, limit=1):  # noqa: ANN001
                # Sampled at exactly the moment plan() is awaiting the provider.
                observed["checked_out"] = db_session.get_engine().pool.checkedout()
                return await super().route_options(
                    origin, destination, kind=kind, limit=limit
                )

        chain = _WatchingChain()
        monkeypatch.setattr(route_service, "build_chain", lambda: chain)

        trip = await _trip(session)
        baseline = db_session.get_engine().pool.checkedout()

        r = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        assert r.status_code == 201, r.text

        assert observed["checked_out"] <= baseline, (
            "a pooled database connection was held across the provider call "
            f"(baseline {baseline}, during call {observed['checked_out']}); "
            "concurrent planning would consume the Supabase client budget "
            "waiting on a third party"
        )
