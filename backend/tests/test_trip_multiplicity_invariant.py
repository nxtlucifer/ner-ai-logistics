"""What "one driver, one trip" actually means in this system.

A review observed that a driver can hold more than one non-terminal trip and
asked whether that is a defect. It is not one fact but three, and they have
different answers - so this file pins each separately rather than asserting a
single slogan that would be wrong for two of them.

    DRAFT       many      planning; nothing is committed to anybody
    ASSIGNED    many      a dispatch QUEUE - `driver_trips.current_trip`
                          orders by dispatched_at and takes one, which is
                          only meaningful if more than one can exist
    ACTIVE      ONE       the invariant. A driver is in one cab. Two trips
                          reading ACTIVE for one person is a lie about the
                          physical world, and Fleet Sentinel, the fleet map
                          and every ETA downstream would inherit it.

The third is not enforced by a constraint or a guard. It holds structurally:
`driver_trips.start` is the ONLY writer of ACTIVE, and it can only ever act on
the single trip `current_trip` resolves, which puts an in-progress trip first.
A structural invariant with no test is one refactor away from being an
accident, which is what these tests exist to prevent.
"""

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import TripStatus
from app.models.operations import Trip
from app.services.driver_trips import IN_PROGRESS_STATUSES
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


async def _crew(session: AsyncSession):
    driver, user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck, verified=True)
    return driver, user, truck, assignment


async def _headers(api: AsyncClient, user) -> dict:
    return await auth_headers(api, user.phone, factories.TEST_PASSWORD)


async def _in_transit_count(session: AsyncSession, driver_id) -> int:
    return (
        await session.execute(
            select(func.count())
            .select_from(Trip)
            .where(
                Trip.driver_id == driver_id,
                Trip.status.in_(IN_PROGRESS_STATUSES),
            )
        )
    ).scalar_one()


async def _fresh_clients(count: int) -> list[AsyncClient]:
    """Independent clients over independent app instances.

    One AsyncClient serialises requests on a single connection, so a
    concurrency test that shares one proves nothing.
    """
    from app.main import create_app

    return [
        AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://t")
        for _ in range(count)
    ]


class TestQueueIsIntended:
    """Multiple non-terminal trips per driver: permitted, and relied upon."""

    async def test_two_assigned_trips_coexist(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        driver, user, truck, assignment = await _crew(session)
        first = await factories.make_trip(session, driver, truck, assignment=assignment)
        second = await factories.make_trip(
            session, driver, truck, assignment=assignment
        )

        assert first.status is TripStatus.ASSIGNED
        assert second.status is TripStatus.ASSIGNED, (
            "a second dispatched trip is a queued trip, not a corruption - "
            "the ordering in current_trip exists precisely for this case"
        )

    async def test_current_trip_is_the_first_dispatched(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The head of the queue is deterministic, not whichever row PG returns."""
        driver, user, truck, assignment = await _crew(session)
        first = await factories.make_trip(session, driver, truck, assignment=assignment)
        second = await factories.make_trip(
            session, driver, truck, assignment=assignment
        )
        # make_trip stamps dispatched_at at creation, so `first` is earlier.
        assert first.dispatched_at <= second.dispatched_at

        headers = await _headers(api, user)
        body = (await api.get("/api/driver/me/trip", headers=headers)).json()
        assert body["id"] == str(first.id)


class TestOneInTransitTripPerDriver:
    """The invariant. Two ACTIVE trips for one person is a physical falsehood."""

    async def test_a_second_trip_cannot_be_started_while_one_is_active(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        driver, user, truck, assignment = await _crew(session)
        running = await factories.make_trip(
            session, driver, truck, assignment=assignment
        )
        queued = await factories.make_trip(
            session, driver, truck, assignment=assignment
        )
        headers = await _headers(api, user)

        started = await api.post("/api/driver/me/trip/start", headers=headers, json={})
        assert started.status_code == 200
        assert started.json()["id"] == str(running.id)

        # Naming the queued trip explicitly is the strongest form of the
        # attempt: it is the driver's own trip, it is ASSIGNED, and every gate
        # on it would pass in isolation.
        forced = await api.post(
            "/api/driver/me/trip/start",
            headers=headers,
            json={"trip_id": str(queued.id)},
        )
        assert forced.status_code == 409
        assert forced.json()["error"]["code"] == "TRIP_SUPERSEDED"

        await session.refresh(queued)
        assert queued.status is TripStatus.ASSIGNED
        assert await _in_transit_count(session, driver.id) == 1, (
            "a driver reached two in-transit trips at once"
        )

    async def test_bare_start_while_active_returns_the_running_trip(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """No trip_id must not silently promote the queued trip either."""
        driver, user, truck, assignment = await _crew(session)
        running = await factories.make_trip(
            session, driver, truck, assignment=assignment
        )
        queued = await factories.make_trip(
            session, driver, truck, assignment=assignment
        )
        headers = await _headers(api, user)

        await api.post("/api/driver/me/trip/start", headers=headers, json={})
        again = await api.post("/api/driver/me/trip/start", headers=headers, json={})

        assert again.status_code == 200
        assert again.json()["id"] == str(running.id)
        await session.refresh(queued)
        assert queued.status is TripStatus.ASSIGNED
        assert await _in_transit_count(session, driver.id) == 1

    async def test_concurrent_starts_on_two_queued_trips_activate_one(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The race the structural argument depends on.

        Both requests resolve the current trip independently. If they could
        resolve to DIFFERENT trips, the row lock each takes would be on a
        different row and both would commit an ACTIVE. They cannot, because the
        ordering is total - and that is what this proves rather than assumes.
        """
        driver, user, truck, assignment = await _crew(session)
        first = await factories.make_trip(session, driver, truck, assignment=assignment)
        second = await factories.make_trip(
            session, driver, truck, assignment=assignment
        )
        headers = await _headers(api, user)

        clients = await _fresh_clients(2)
        try:
            responses = await asyncio.gather(
                *(
                    c.post(
                        "/api/driver/me/trip/start",
                        headers=headers,
                        json={"trip_id": str(t.id)},
                    )
                    for c, t in zip(clients, (first, second))
                ),
                return_exceptions=True,
            )
        finally:
            for c in clients:
                await c.aclose()

        assert not any(isinstance(r, BaseException) for r in responses), responses
        codes = sorted(r.status_code for r in responses)
        assert codes == [200, 409], f"expected one start and one refusal, got {codes}"

        assert await _in_transit_count(session, driver.id) == 1, (
            "concurrent starts produced two in-transit trips for one driver"
        )
        await session.refresh(second)
        assert second.status is TripStatus.ASSIGNED


class TestIncidentTripIsNotAbandoned:
    """A driver stopped at an incident must not be handed a different trip.

    `current_trip` filters on `trips.OPEN_TRIP_STATUSES`, which lists ASSIGNED,
    ACTIVE and DELAYED. INCIDENT is absent - so a trip in that state vanishes
    from the driver's app and the next QUEUED trip takes its place, which the
    driver can then start. The system has already declared, via
    COMMITS_DRIVER_TO_TRUCK, that during INCIDENT the driver is physically with
    that truck; starting a second trip contradicts a fact the same codebase
    asserts, and the fleet map would show one person driving away from a
    vehicle they are standing next to.

    No service writes INCIDENT today, so this is latent rather than live. That
    is the reason to close it now: the transition lands in a future phase, and
    a gap in a status filter is invisible to whoever writes that transition.
    """

    def test_every_committed_status_is_resolvable_by_the_driver_app(self) -> None:
        """The set relation, stated once rather than re-derived per feature.

        DELIVERED is excluded deliberately: it is committed, but it is not
        resolved through `current_trip` at all - `_own_delivered_trip` addresses
        it by id, because a delivered trip is settlement work rather than the
        thing the driver is currently doing.
        """
        from app.domain.trip_state import COMMITS_DRIVER_TO_TRUCK
        from app.models.enums import TripStatus as TS
        from app.services.trips import OPEN_TRIP_STATUSES

        needs_resolving = COMMITS_DRIVER_TO_TRUCK - {TS.DELIVERED}
        missing = needs_resolving - set(OPEN_TRIP_STATUSES)
        assert not missing, (
            f"{sorted(s.value for s in missing)} commit the driver to a truck "
            "but cannot be reached through current_trip, so the driver's app "
            "silently moves on to a queued trip"
        )

    async def test_an_incident_trip_blocks_starting_a_queued_one(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Built through the factory because no service writes INCIDENT yet.

        Constructing the state directly is the point: it is the state a future
        incident-reporting endpoint will produce, and this asserts the rest of
        the system already behaves when it arrives.
        """
        driver, user, truck, assignment = await _crew(session)
        stuck = await factories.make_trip(
            session,
            driver,
            truck,
            assignment=assignment,
            status=TripStatus.INCIDENT,
        )
        queued = await factories.make_trip(
            session, driver, truck, assignment=assignment
        )
        headers = await _headers(api, user)

        current = (await api.get("/api/driver/me/trip", headers=headers)).json()
        assert current is not None
        assert current["id"] == str(stuck.id), (
            "the driver's app skipped the incident trip and offered the next one"
        )

        response = await api.post("/api/driver/me/trip/start", headers=headers, json={})
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "TRIP_NOT_STARTABLE"

        await session.refresh(queued)
        assert queued.status is TripStatus.ASSIGNED
        assert await _in_transit_count(session, driver.id) == 0

    async def test_incident_wins_over_an_earlier_dispatched_queued_trip(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Membership in the filter is not enough; the ORDER must decide too.

        Including INCIDENT in OPEN_TRIP_STATUSES only makes it a candidate. The
        first sort key is what picks between candidates, and if that key asks
        "is this in progress" then an INCIDENT trip ranks level with a queued
        ASSIGNED one and loses to any dispatched earlier.

        Today no reachable sequence produces that pair - a driver always starts
        the earliest-dispatched open trip, so the incident trip is also the
        earliest. Resting a physical-safety invariant on an argument about
        which orderings are reachable is exactly the kind of reasoning that
        stops being true when someone adds a re-dispatch path, so the order is
        pinned here against a case built deliberately backwards.
        """
        driver, user, truck, assignment = await _crew(session)
        earlier_queued = await factories.make_trip(
            session, driver, truck, assignment=assignment
        )
        stuck = await factories.make_trip(
            session,
            driver,
            truck,
            assignment=assignment,
            status=TripStatus.INCIDENT,
        )
        assert earlier_queued.dispatched_at <= stuck.dispatched_at

        headers = await _headers(api, user)
        current = (await api.get("/api/driver/me/trip", headers=headers)).json()
        assert current["id"] == str(stuck.id), (
            "a queued trip outranked the incident the driver is standing at"
        )
