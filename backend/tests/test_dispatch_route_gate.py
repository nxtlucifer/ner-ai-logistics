"""Dispatch refuses a trip that has no road for the driver to follow.

The console disables its Dispatch button without a selected route, and a
disabled button is not a control: TRP-08726C5F went ACTIVE with no route
through an older console. The server is the gate. `selected_route_id` is
written only by `apply_selection`, which runs eligibility and spends any review
authorisation in the same transaction that marks the row SELECTED - so
"selected, belongs to this trip, still SELECTED, has a line" is the invariant.

Placed after the driver/capacity/assignment gates, which keep their own codes.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import RouteState, TripEventKind, TripStatus, UserRole
from app.models.operations import Trip, TripEvent
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


async def _draft(session: AsyncSession) -> Trip:
    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck)
    return await factories.make_trip(
        session, driver, truck, assignment=assignment, status=TripStatus.DRAFT
    )


async def _dispatch(api: AsyncClient, headers: dict, trip: Trip):
    return await api.post(f"/api/trips/{trip.id}/dispatch", headers=headers)


async def _still_draft(session: AsyncSession, trip: Trip) -> None:
    await session.refresh(trip)
    assert trip.status is TripStatus.DRAFT
    assert trip.dispatched_at is None or trip.status is TripStatus.DRAFT


class TestDispatchRouteGate:
    async def test_a_draft_with_no_route_is_refused(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        trip = await _draft(session)
        r = await _dispatch(api, manager_headers, trip)
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == "ROUTE_SELECTION_REQUIRED"
        await _still_draft(session, trip)

    async def test_a_planned_but_unselected_route_is_refused(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        trip = await _draft(session)
        await factories.make_selected_route(
            session, trip.id, state=RouteState.PROPOSED, select=False
        )
        r = await _dispatch(api, manager_headers, trip)
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == "ROUTE_SELECTION_REQUIRED"
        await _still_draft(session, trip)

    async def test_a_route_belonging_to_another_trip_is_refused(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        trip = await _draft(session)
        other = await _draft(session)
        foreign = await factories.make_selected_route(session, other.id)
        await session.execute(
            Trip.__table__.update()
            .where(Trip.id == trip.id)
            .values(selected_route_id=foreign.id)
        )
        await session.commit()
        r = await _dispatch(api, manager_headers, trip)
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == "ROUTE_INVALID"
        await _still_draft(session, trip)

    async def test_a_superseded_selection_is_refused(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        trip = await _draft(session)
        await factories.make_selected_route(session, trip.id, state=RouteState.SUPERSEDED)
        r = await _dispatch(api, manager_headers, trip)
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == "ROUTE_INVALID"
        assert "no longer current" in r.json()["error"]["message"]
        await _still_draft(session, trip)

    async def test_a_selection_that_skipped_review_is_refused(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        # Pointed at a PROPOSED row without going through apply_selection: no
        # eligibility decision, no authorisation spent.
        trip = await _draft(session)
        await factories.make_selected_route(session, trip.id, state=RouteState.PROPOSED)
        r = await _dispatch(api, manager_headers, trip)
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == "ROUTE_REVIEW_REQUIRED"
        await _still_draft(session, trip)

    async def test_a_selected_valid_route_dispatches(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        trip = await _draft(session)
        route = await factories.make_selected_route(session, trip.id)
        r = await _dispatch(api, manager_headers, trip)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "ASSIGNED"
        assert r.json()["selected_route_id"] == str(route.id)

    async def test_a_retried_dispatch_changes_nothing(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        trip = await _draft(session)
        await factories.make_selected_route(session, trip.id)
        first = await _dispatch(api, manager_headers, trip)
        assert first.status_code == 200, first.text
        await session.refresh(trip)
        dispatched_at = trip.dispatched_at

        again = await _dispatch(api, manager_headers, trip)
        # The existing state-machine contract: ASSIGNED -> ASSIGNED is illegal.
        assert again.status_code == 409, again.text
        assert again.json()["error"]["code"] == "ILLEGAL_TRIP_TRANSITION"

        await session.refresh(trip)
        assert trip.status is TripStatus.ASSIGNED
        assert trip.dispatched_at == dispatched_at
        assigned_events = (
            await session.execute(
                select(func.count()).select_from(TripEvent).where(
                    TripEvent.trip_id == trip.id,
                    TripEvent.kind == TripEventKind.ASSIGNED,
                )
            )
        ).scalar_one()
        assert assigned_events == 1

    async def test_the_route_gate_comes_after_the_assignment_gate(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """A missing assignment keeps its own code; the route is checked last."""
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        trip = await factories.make_trip(session, driver, truck, status=TripStatus.DRAFT)
        r = await _dispatch(api, manager_headers, trip)
        assert r.status_code == 409, r.text
        assert r.json()["error"]["code"] == "NO_ACTIVE_ASSIGNMENT"
        assert uuid.UUID(str(trip.id))  # the trip row is untouched by the refusal
