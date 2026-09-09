"""LS-10: planning must not retire the route the truck is currently following.

THE DISTINCTION THIS FILE DEFENDS

Four different things were being collapsed into one column:

    the CURRENT ASSIGNMENT   what the driver is following right now
                             (`trips.selected_route_id`)
    NEW CANDIDATES           what a planning request just produced
    OLD ALTERNATIVES         candidates nobody chose, now obsolete
    ELIGIBILITY              whether a route may be taken, which is about
                             hazard evidence and is not a lifecycle state

`RouteState.SUPERSEDED` means "can never be taken again" - that is not an
opinion, it is what the code does with it: `apply_selection` refuses a
SUPERSEDED route outright (ROUTE_SUPERSEDED), `route_recommendation` excludes
SUPERSEDED rows from candidates, and `apply_selection` deliberately demotes a
replaced route to PROPOSED rather than SUPERSEDED because "weather is not
permanent".

`plan()` was applying that terminal state to the CURRENTLY SELECTED route
merely because someone asked for fresh options. Asking what else is available
is not consent to abandon the road a truck is on, and the result was a trip
whose `selected_route_id` pointed at a row the rest of the system considered
dead - so the manager UI, which finds the current route by looking for
`state == 'SELECTED'`, could no longer see what the driver was following.

WHAT IS DELIBERATELY NOT CHANGED

Old unselected candidates are still superseded, which is correct - they are
obsolete. And nothing here clears `selected_route_id`: stripping a moving
truck's route to make ids tidy would be a far worse bug than the one being
fixed.
"""

import asyncio

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
    """A routing provider that always answers, so the test is about lifecycle."""

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
    """A hazard source that answered and found nothing: sufficient evidence.

    Needed because selection runs the REAL eligibility guard. Without evidence
    the route is REQUIRES_REVIEW and nothing could be selected at all, so these
    lifecycle tests would never reach the behaviour they are about.
    """

    name = "ls10-clear"

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


async def _trip_with_selected_route(
    api: AsyncClient, session: AsyncSession, headers: dict
):
    """A trip following a route, built through the real endpoints."""
    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck)
    trip = await factories.make_trip(
        session, driver, truck, assignment=assignment, stops=2
    )

    planned = await api.post(f"/api/trips/{trip.id}/routes/recalculate", headers=headers)
    assert planned.status_code == 201, planned.text
    route_a = planned.json()["route"]["id"]

    chosen = await api.post(
        f"/api/trips/{trip.id}/routes/{route_a}/select", headers=headers
    )
    assert chosen.status_code == 200, chosen.text
    return trip, route_a


async def _fresh_state(trip_id):
    """Read trip and routes in a NEW session, so nothing is an in-memory echo."""
    from app.db import session as db_session

    async with db_session.get_sessionmaker()() as fresh:
        trip = (
            await fresh.execute(select(Trip).where(Trip.id == trip_id))
        ).scalar_one()
        routes = (
            await fresh.execute(
                select(TripRoute).where(TripRoute.trip_id == trip_id)
            )
        ).scalars().all()
        return trip.selected_route_id, {str(r.id): r.state for r in routes}


class TestPlanningPreservesTheCurrentAssignment:
    async def test_replanning_leaves_the_followed_route_selected(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        """The LS-10 defect, reproduced against the real endpoints.

        Before the fix this failed on the state assertion: A was SUPERSEDED
        while `selected_route_id` still pointed at it, so the trip was
        following a route the rest of the system treats as unusable.
        """
        trip, route_a = await _trip_with_selected_route(api, session, manager_headers)

        current_before, states_before = await _fresh_state(trip.id)
        assert str(current_before) == route_a
        assert states_before[route_a] is RouteState.SELECTED

        # Ask for fresh options. This is NOT consent to change road.
        replanned = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        assert replanned.status_code == 201, replanned.text
        route_b = replanned.json()["route"]["id"]
        assert route_b != route_a

        current_after, states_after = await _fresh_state(trip.id)

        # The trip still points at A ...
        assert current_after == current_before, (
            "planning changed which route the trip is following"
        )
        # ... and A is still a route the system considers usable. This is the
        # assertion that was failing: SUPERSEDED is terminal.
        assert states_after[route_a] is RouteState.SELECTED, (
            "the currently followed route was retired by a planning request; "
            "SUPERSEDED means 'can never be taken again' and the driver is on it"
        )
        # The new candidate is offered, not imposed.
        assert states_after[route_b] is RouteState.PROPOSED

    async def test_replanning_still_supersedes_unselected_candidates(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        """The other half: obsolete alternatives must NOT pile up.

        Guards the lazy over-correction of simply not superseding anything,
        which would leave every stale candidate looking choosable forever.
        """
        trip, route_a = await _trip_with_selected_route(api, session, manager_headers)

        first = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        route_b = first.json()["route"]["id"]

        second = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        route_c = second.json()["route"]["id"]

        current, states = await _fresh_state(trip.id)
        assert str(current) == route_a
        assert states[route_a] is RouteState.SELECTED   # still the assignment
        assert states[route_b] is RouteState.SUPERSEDED  # obsolete candidate
        assert states[route_c] is RouteState.PROPOSED    # the live offer

    async def test_a_superseded_route_still_cannot_be_selected(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        """The terminal meaning of SUPERSEDED is unchanged by this fix."""
        trip, route_a = await _trip_with_selected_route(api, session, manager_headers)

        first = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        route_b = first.json()["route"]["id"]
        await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )  # supersedes B

        refused = await api.post(
            f"/api/trips/{trip.id}/routes/{route_b}/select", headers=manager_headers
        )
        assert refused.status_code == 422, refused.text
        assert refused.json()["error"]["code"] == "ROUTE_SUPERSEDED"


class TestPlanningRacingAnAcceptance:
    async def test_a_route_selected_during_planning_is_not_retired(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, monkeypatch
    ):
        """Planning holds no lock while it is at the provider - by design.

        `plan()` commits and releases the connection before calling the routing
        provider, so another transaction can change which route is current
        while it is out there. The supersede decision must therefore be made
        from the selection re-read UNDER the lock, not from whatever was true
        when the request started.

        Deterministic barrier, not a sleep: planning is paused inside the
        provider call, the replacement is accepted and committed, then planning
        resumes and must not retire the route that just became current.
        """
        from app.db import session as db_session

        trip, route_a = await _trip_with_selected_route(api, session, manager_headers)

        # A second live candidate for the racing transaction to select.
        offered = await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        route_b = offered.json()["route"]["id"]

        in_provider = asyncio.Event()
        may_finish = asyncio.Event()

        class _BarrierChain(_StubChain):
            async def route_options(self, *args, **kwargs):  # noqa: ANN001
                # Planning has released the database and is "at the provider".
                in_provider.set()
                await may_finish.wait()
                return await super().route_options(*args, **kwargs)

        monkeypatch.setattr(route_service, "build_chain", lambda: _BarrierChain())

        maker = db_session.get_sessionmaker()
        actor = await factories.make_user(session, role=UserRole.MANAGER)

        async with maker() as planner, maker() as accepter:
            planning = asyncio.create_task(
                route_service.plan(planner, trip.id, actor=actor, ip=None)
            )
            await asyncio.wait_for(in_provider.wait(), timeout=10)

            # B becomes the current assignment while the planner is blocked.
            await route_service.select_route(
                accepter, trip.id, route_b, actor=actor, ip=None
            )

            may_finish.set()
            await asyncio.wait_for(planning, timeout=20)

        current, states = await _fresh_state(trip.id)
        assert str(current) == route_b, "the accepted replacement was lost"
        assert states[route_b] is RouteState.SELECTED, (
            "planning retired the route that became current during its "
            "provider call - the supersede set was computed from a stale read"
        )
        # A was demoted by the acceptance, then legitimately superseded as an
        # obsolete unselected candidate.
        assert states[route_a] is RouteState.SUPERSEDED


class TestTheApiSaysWhichRouteIsCurrent:
    """`is_current` comes from the trip row, not from the lifecycle state.

    The manager UI used to find the current route by looking for
    `state == 'SELECTED'`. That is a client re-deriving a fact the server
    already knows, and it is wrong for exactly the rows the LS-10 bug created.
    """

    async def test_current_route_is_flagged_and_candidates_are_not(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        trip, route_a = await _trip_with_selected_route(api, session, manager_headers)
        await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )

        listed = await api.get(f"/api/trips/{trip.id}/routes", headers=manager_headers)
        assert listed.status_code == 200, listed.text
        rows = listed.json()

        current = [r for r in rows if r["is_current"]]
        assert [r["id"] for r in current] == [route_a]
        # Exactly one, always. Two "current" routes on one trip is a UI that
        # cannot draw a truck's road.
        assert len(current) == 1

    async def test_a_legacy_selected_but_superseded_row_is_still_current(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        """The compatibility case, and the reason this flag exists.

        Trips created before the fix have `selected_route_id` pointing at a row
        whose state is SUPERSEDED. The driver is following it. The API must say
        so rather than hiding it, and must NOT quietly relabel the row - a read
        endpoint rewriting history to tidy a display would destroy the evidence
        of what the driver was actually told to do.
        """
        from app.db import session as db_session

        trip, route_a = await _trip_with_selected_route(api, session, manager_headers)

        # Reproduce the old behaviour directly rather than reintroducing it:
        # retire the trip's own selection, as `plan()` used to.
        maker = db_session.get_sessionmaker()
        async with maker() as writer:
            row = (
                await writer.execute(
                    select(TripRoute).where(TripRoute.id == route_a)
                )
            ).scalar_one()
            row.state = RouteState.SUPERSEDED
            await writer.commit()

        listed = await api.get(f"/api/trips/{trip.id}/routes", headers=manager_headers)
        rows = {r["id"]: r for r in listed.json()}

        assert rows[route_a]["is_current"] is True, (
            "the trip's own selection vanished from the API because its "
            "lifecycle state had been retired"
        )
        # Reported honestly, not laundered into something selectable.
        assert rows[route_a]["state"] == "SUPERSEDED"

        # And it is still refused as a NEW selection: being current is not a
        # licence to re-select a retired row.
        refused = await api.post(
            f"/api/trips/{trip.id}/routes/{route_a}/select", headers=manager_headers
        )
        assert refused.status_code == 422
        assert refused.json()["error"]["code"] == "ROUTE_SUPERSEDED"

    async def test_candidates_carry_server_computed_eligibility(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        """The chooser must not pattern-match reason codes to decide this."""
        trip, _ = await _trip_with_selected_route(api, session, manager_headers)

        rec = await api.get(
            f"/api/trips/{trip.id}/routes/recommendation", headers=manager_headers
        )
        assert rec.status_code == 200, rec.text
        candidates = rec.json()["candidates"]
        assert candidates, "expected at least one live candidate"
        for c in candidates:
            # Under _ClearSource the evidence is sufficient, so ELIGIBLE - and
            # the field is present and typed regardless of value.
            assert c["eligibility"] in {
                "ELIGIBLE", "REQUIRES_REVIEW", "REJECTED", "NOT_ASSESSED"
            }
            assert c["eligibility"] == "ELIGIBLE"
