"""LS-8: a decision made before a state change must not commit after it.

WHAT THIS TESTS

`select_route` computes eligibility OUTSIDE the transaction (correctly - it is
provider I/O and must not be held across a row lock). That creates a real
window: the route can change between the assessment and the mutation.

So the mutation must revalidate application-owned state UNDER the lock. This
test proves it does, with a deterministic interleaving rather than a sleep.

HOW THE BARRIER WORKS

Request A is paused at an explicit `asyncio.Event` placed BETWEEN the
assessment and the guarded mutation. While it waits, a separate session
supersedes the route and commits. Then A resumes and attempts the mutation
against a route that no longer exists in the state it was assessed in.

The guard itself is NOT patched and no decision is forced. The only
instrumentation is the barrier, which controls WHEN the real code runs, not
WHAT it decides.

WHAT IT DOES NOT PROVE

This covers ONE application-owned state change: a route superseded between
assessment and mutation. It does not prove freshness of the EXTERNAL hazard
evidence - no local transaction can be made atomic with a remote authority,
and recording a timestamp would not change that. The honest guarantee is:
application-owned route lifecycle is revalidated under the lock.
"""

import asyncio

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BusinessRuleError
from app.domain.landslide import IncidentQueryResult, SourceState
from app.domain.routing import RouteCandidate
from app.models.enums import RouteState, UserRole
from app.models.operations import Trip, TripRoute
from app.services import route_risk as risk_service
from app.services import routes as route_service
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

GEOMETRY = [(26.1445, 91.7362), (26.4, 92.9), (26.7509, 94.2037)]


class _StubChain:
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

        opts = await self.route_options(origin, destination, kind=kind, limit=1)
        return ChainResult(candidate=opts.candidates[0], attempts=opts.attempts)


class _ClearSource:
    """A hazard source that answered and found nothing: sufficient evidence."""

    name = "ls8-clear"

    async def incidents_near(self, box, *, since, until):  # noqa: ANN001
        return IncidentQueryResult(state=SourceState.AVAILABLE, provider=self.name)


@pytest.fixture(autouse=True)
def _stubs(monkeypatch):
    monkeypatch.setattr(route_service, "build_chain", lambda: _StubChain())
    monkeypatch.setattr(risk_service, "build_landslide_provider", lambda: _ClearSource())

    async def _no_weather(positions):  # noqa: ANN001
        return []

    monkeypatch.setattr(risk_service, "observations_for", _no_weather)


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


async def _planned(api: AsyncClient, session: AsyncSession, headers: dict):
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
    routes = (
        await session.execute(select(TripRoute).where(TripRoute.trip_id == trip.id))
    ).scalars().all()
    return trip, routes


class TestAStaleDecisionCannotCommit:
    async def test_a_route_superseded_after_assessment_is_refused(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        monkeypatch,
    ):
        # A second, independent session on the application's own engine, so the
        # interleaving is two real transactions rather than one session
        # pretending to be two.
        from app.db import session as db_session

        maker = db_session.get_sessionmaker()
        actor = await factories.make_user(session, role=UserRole.MANAGER)
        trip, routes = await _planned(api, session, manager_headers)
        target = routes[0]

        before_selected = (
            await session.execute(select(Trip).where(Trip.id == trip.id))
        ).scalar_one().selected_route_id

        assessed = asyncio.Event()
        may_proceed = asyncio.Event()
        real_apply = route_service.apply_selection

        async def barrier_apply(*args, **kwargs):
            # The assessment has happened; the mutation has not started.
            assessed.set()
            await may_proceed.wait()
            return await real_apply(*args, **kwargs)

        monkeypatch.setattr(route_service, "apply_selection", barrier_apply)

        # Request A gets its OWN session, exactly as a real HTTP request does.
        # Reusing the test's session made SQLAlchemy's identity map hand back a
        # cached TripRoute with its pre-supersede state, so the revalidation had
        # nothing stale to catch - the test would have "passed" the wrong thing.
        async with maker() as request_a, maker() as writer:
            task = asyncio.create_task(
                route_service.select_route(
                    request_a, trip.id, target.id, actor=actor, ip=None
                )
            )
            await asyncio.wait_for(assessed.wait(), timeout=10)

            # A DIFFERENT transaction supersedes the route and commits, while
            # request A is holding a decision that is now out of date.
            row = (
                await writer.execute(select(TripRoute).where(TripRoute.id == target.id))
            ).scalar_one()
            row.state = RouteState.SUPERSEDED
            await writer.commit()

            may_proceed.set()

            with pytest.raises(BusinessRuleError) as caught:
                await asyncio.wait_for(task, timeout=15)

        assert caught.value.code == "ROUTE_SUPERSEDED"

        # Fresh read: the stale decision changed nothing.
        async with maker() as fresh:
            after = (
                await fresh.execute(select(Trip).where(Trip.id == trip.id))
            ).scalar_one()
            assert after.selected_route_id == before_selected
            state = (
                await fresh.execute(select(TripRoute).where(TripRoute.id == target.id))
            ).scalar_one().state
            assert state is RouteState.SUPERSEDED


class TestWhatTheRequestSessionActuallyHolds:
    """LS-9 G2: the question the LS-8 test could not answer by itself.

    The LS-8 case above gives request A its own session and passes. That only
    proves staleness is impossible if nothing earlier in the request loaded the
    row. Whether anything DOES is a fact about the real call graph, so it is
    asserted here rather than assumed.
    """

    async def test_assessment_does_not_load_the_route_entity(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
    ):
        """Why `select_route` cannot read a stale route.

        `route_risk._route_facts` selects COLUMNS (ST_AsText, distance,
        duration), not the `TripRoute` entity, so the assessment leaves nothing
        in the identity map for the mutation's own `select(TripRoute)` to be
        handed back instead of a fresh row.

        That is load-bearing and invisible: changing `_route_facts` to
        `select(TripRoute)` would silently re-introduce the stale read the LS-8
        test is written to catch. This pins it.
        """
        from app.db import session as db_session

        trip, routes = await _planned(api, session, manager_headers)
        target = routes[0]

        async with db_session.get_sessionmaker()() as request_a:
            await risk_service.eligibility_for_route(request_a, target.id)
            cached = [
                key for key in request_a.identity_map.keys()
                if key[0] is TripRoute
            ]

        assert cached == [], (
            "the eligibility assessment loaded TripRoute entities into the "
            "request session; the mutation's re-read would then be served from "
            "the identity map and could not observe another transaction's "
            "supersede"
        )


class TestALockedReadIsNotStale:
    """LS-9 G2: `with_for_update()` takes the lock but does NOT refresh.

    `trips.load_for_update` is the single lock every mutating trip path goes
    through. When the row is ALREADY in the session's identity map, SQLAlchemy
    returns that instance with its previously loaded attribute values - the
    SELECT ... FOR UPDATE is emitted and the lock is really taken, but the
    Python object is whatever the earlier read left behind.

    `routes.plan()` is a live path with exactly that shape: it loads the trip,
    commits to release the connection, spends up to ROUTING_TIMEOUT_SECONDS at
    a third-party provider, and only then takes the lock. `expire_on_commit` is
    False (app/db/session.py) precisely so objects survive that commit, so
    nothing expires the trip in between.

    Today `plan()` reads no attribute after the lock, so this is latent rather
    than exploitable - which is the reason to fix it at the shared function now
    instead of after a caller adds the status check that turns it into a bug.
    """

    async def test_a_preloaded_trip_is_current_after_the_lock(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
    ):
        from app.db import session as db_session
        from app.services import trips as trip_service

        maker = db_session.get_sessionmaker()
        trip, routes = await _planned(api, session, manager_headers)
        target = routes[0]

        async with maker() as request_a, maker() as writer:
            # 1. The request loads the trip, as plan() does at its first
            #    statement, and keeps the object alive.
            preloaded = await trip_service.get(request_a, trip.id)
            before = preloaded.selected_route_id

            # 2. It releases the transaction before provider I/O, as plan()
            #    does, deliberately WITHOUT expiring what it loaded.
            await request_a.commit()

            # 3. Another transaction changes the trip and commits while A is
            #    out at the provider.
            other = await trip_service.load_for_update(writer, trip.id)
            other.selected_route_id = target.id
            await writer.commit()
            assert before != target.id

            # 4. A resumes on its SAME session and takes the row lock.
            relocked = await trip_service.load_for_update(request_a, trip.id)

            # The identity map hands back the very same instance - that part is
            # correct and expected.
            assert relocked is preloaded
            # ... but a locked read must reflect the row it just locked.
            assert relocked.selected_route_id == target.id, (
                "load_for_update returned a stale instance: the lock was taken "
                "but the object still carries the values read before another "
                "transaction committed"
            )
            await request_a.rollback()
