"""Driver acceptance of a dispatched trip (LS-12 G1A).

Acceptance is an ACKNOWLEDGMENT, not a lifecycle state and not a permission.
The whole risk of adding it is that it quietly becomes one of those, so this
file is mostly about what acceptance must NOT do:

    it must not start travel
    it must not make an unstartable trip startable
    it must not touch the selected route
    it must not be inherited by a driver who never gave it
    it must not write a second timeline event when tapped twice

The positive case - a driver accepts and the server records it - is one test.
The rest are the boundaries.
"""

import asyncio
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import DriverStatus, TripEventKind, TripStatus, TruckStatus
from app.models.operations import Trip, TripEvent
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


async def _crew(
    session: AsyncSession,
    *,
    verified: bool = True,
    stops: int = 2,
    status: TripStatus = TripStatus.ASSIGNED,
):
    """A driver with a truck and ONE trip they have not accepted.

    `status` builds the trip in that state directly rather than adding a
    second trip beside an ASSIGNED one - `current_trip` resolves the driver's
    single current job, so an extra trip would simply not be the one the
    endpoint acts on, and the test would pass for the wrong reason.
    """
    driver, user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(
        session, driver, truck, verified=verified
    )
    trip = await factories.make_trip(
        session, driver, truck, assignment=assignment, stops=stops, status=status
    )
    return driver, user, truck, assignment, trip


async def _headers(api: AsyncClient, user) -> dict:
    return await auth_headers(api, user.phone, factories.TEST_PASSWORD)


async def _accepted_events(session: AsyncSession, trip_id: uuid.UUID) -> int:
    return (
        await session.execute(
            select(func.count())
            .select_from(TripEvent)
            .where(
                TripEvent.trip_id == trip_id,
                TripEvent.kind == TripEventKind.ACCEPTED,
            )
        )
    ).scalar_one()


async def test_first_acceptance_is_recorded_and_leaves_the_trip_assigned(
    api: AsyncClient, session: AsyncSession
) -> None:
    driver, user, truck, _, trip = await _crew(session)
    headers = await _headers(api, user)

    before = await api.get("/api/driver/me/trip", headers=headers)
    assert before.json()["driver_accepted_at"] is None

    response = await api.post("/api/driver/me/trip/accept", json={}, headers=headers)
    assert response.status_code == 200
    body = response.json()

    assert body["driver_accepted_at"] is not None
    # The single most important assertion in this file: acknowledging a job is
    # not beginning it. A dispatcher reading ACTIVE would believe a truck was
    # moving that is still parked at the depot.
    assert body["status"] == TripStatus.ASSIGNED.value
    assert body["started_at"] is None

    await session.refresh(trip)
    assert trip.driver_accepted_at is not None
    assert trip.driver_accepted_by == driver.id
    assert trip.started_at is None
    assert trip.status is TripStatus.ASSIGNED

    # Neither resource is committed to the road by an acknowledgment, so the
    # planner must still see both as available.
    await session.refresh(driver)
    await session.refresh(truck)
    assert driver.status is not DriverStatus.ON_TRIP
    assert truck.status is not TruckStatus.ON_TRIP

    assert await _accepted_events(session, trip.id) == 1


async def test_accepting_twice_is_idempotent_and_writes_one_event(
    api: AsyncClient, session: AsyncSession
) -> None:
    _, user, _, _, trip = await _crew(session)
    headers = await _headers(api, user)

    first = await api.post("/api/driver/me/trip/accept", json={}, headers=headers)
    second = await api.post("/api/driver/me/trip/accept", json={}, headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    # The timestamp must not move. A driver who taps twice on a flaky link has
    # accepted once, and the record should say when they actually did.
    assert first.json()["driver_accepted_at"] == second.json()["driver_accepted_at"]
    assert await _accepted_events(session, trip.id) == 1


async def test_concurrent_taps_produce_one_acceptance(
    api: AsyncClient, session: AsyncSession
) -> None:
    """Two taps racing on a slow connection, not two drivers.

    The row lock in `_own_trip_for_update` is what serialises these. Without
    it both requests would read a null timestamp, both would stamp, and the
    timeline would carry two acceptances of one job.
    """
    _, user, _, _, trip = await _crew(session)
    headers = await _headers(api, user)

    responses = await asyncio.gather(
        api.post("/api/driver/me/trip/accept", json={}, headers=headers),
        api.post("/api/driver/me/trip/accept", json={}, headers=headers),
    )

    assert [r.status_code for r in responses] == [200, 200]
    stamps = {r.json()["driver_accepted_at"] for r in responses}
    assert len(stamps) == 1
    assert await _accepted_events(session, trip.id) == 1


async def test_acceptance_does_not_unblock_an_unstartable_trip(
    api: AsyncClient, session: AsyncSession
) -> None:
    """The gate is `can_start`, and acceptance is not a way through it."""
    _, user, _, _, _ = await _crew(session, verified=False)
    headers = await _headers(api, user)

    before = await api.get("/api/driver/me/trip", headers=headers)
    assert before.json()["can_start"] is False
    blocked_code = before.json()["start_blocked_code"]

    accepted = await api.post("/api/driver/me/trip/accept", json={}, headers=headers)
    assert accepted.status_code == 200
    assert accepted.json()["driver_accepted_at"] is not None

    # Same blocker, same reason, still refused. Accepting a job you cannot
    # legally start leaves you with a job you cannot legally start.
    assert accepted.json()["can_start"] is False
    assert accepted.json()["start_blocked_code"] == blocked_code

    started = await api.post("/api/driver/me/trip/start", json={}, headers=headers)
    assert started.status_code >= 400


async def test_acceptance_does_not_touch_the_selected_route(
    api: AsyncClient, session: AsyncSession
) -> None:
    _, user, _, _, trip = await _crew(session)
    headers = await _headers(api, user)

    before = (await api.get("/api/driver/me/trip", headers=headers)).json()
    accepted = (
        await api.post("/api/driver/me/trip/accept", json={}, headers=headers)
    ).json()

    assert accepted["selected_route_id"] == before["selected_route_id"]
    await session.refresh(trip)
    assert trip.selected_route_id == (
        uuid.UUID(before["selected_route_id"]) if before["selected_route_id"] else None
    )


async def test_another_driver_cannot_accept_this_trip(
    api: AsyncClient, session: AsyncSession
) -> None:
    """The subject comes from the token, so there is nothing to point elsewhere."""
    _, _, _, _, trip = await _crew(session)

    # A second, unrelated driver with no trip of their own.
    _, other_user = await factories.make_driver(session)
    other_headers = await _headers(api, other_user)

    response = await api.post(
        "/api/driver/me/trip/accept", json={}, headers=other_headers
    )
    assert response.status_code == 404

    await session.refresh(trip)
    assert trip.driver_accepted_at is None
    assert await _accepted_events(session, trip.id) == 0


async def test_naming_another_drivers_trip_is_refused_not_followed(
    api: AsyncClient, session: AsyncSession
) -> None:
    """`trip_id` may only NARROW. It is never used to look anything up."""
    _, _, _, _, victim_trip = await _crew(session)
    _, attacker_user, _, _, attacker_trip = await _crew(session)
    headers = await _headers(api, attacker_user)

    response = await api.post(
        "/api/driver/me/trip/accept",
        json={"trip_id": str(victim_trip.id)},
        headers=headers,
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "TRIP_SUPERSEDED"

    # Neither trip was accepted: not the one named, and not the attacker's own.
    await session.refresh(victim_trip)
    await session.refresh(attacker_trip)
    assert victim_trip.driver_accepted_at is None
    assert attacker_trip.driver_accepted_at is None


@pytest.mark.parametrize(
    "status",
    [TripStatus.DELIVERED, TripStatus.CLOSED, TripStatus.CANCELLED],
)
async def test_a_finished_or_cancelled_trip_cannot_be_accepted(
    api: AsyncClient, session: AsyncSession, status: TripStatus
) -> None:
    """A stale screen, not a retry worth honouring.

    404 and 409 are both correct answers and which one appears is a detail of
    whether `current_trip` still considers a finished job the driver's
    concern. What must NOT happen is a 200 recording an acknowledgment of a
    job that is over.
    """
    _, user, _, _, trip = await _crew(session, status=status)
    headers = await _headers(api, user)

    response = await api.post("/api/driver/me/trip/accept", json={}, headers=headers)
    assert response.status_code in (404, 409)
    if response.status_code == 409:
        assert response.json()["error"]["code"] == "TRIP_NOT_ACCEPTABLE"

    await session.refresh(trip)
    assert trip.driver_accepted_at is None
    assert await _accepted_events(session, trip.id) == 0


async def test_a_reassigned_trip_does_not_inherit_the_previous_acceptance(
    api: AsyncClient, session: AsyncSession
) -> None:
    """The acknowledgment belongs to a person, not to the row.

    `driver_accepted_at` lives on the trip, so handing the trip to somebody
    else would carry the stamp with it and open the new driver's app on a job
    it claimed they had already accepted. `driver_accepted_by` is what makes
    that impossible.
    """
    first_driver, first_user, truck, assignment, trip = await _crew(session)
    headers = await _headers(api, first_user)

    accepted = await api.post("/api/driver/me/trip/accept", json={}, headers=headers)
    assert accepted.json()["driver_accepted_at"] is not None

    # Hand the trip to a different driver, exactly as a reassignment would.
    #
    # No assignment is created for them: `uq_current_assignment_truck` (P5)
    # forbids a truck having two current drivers, and the first driver still
    # holds this one. That constraint is correct and is not what this test is
    # about - `current_trip` resolves on `trips.driver_id` alone, so moving
    # that column is all a reassignment needs to do here.
    second_driver, second_user = await factories.make_driver(session)
    trip.driver_id = second_driver.id
    await session.commit()

    # The row still carries the first driver's acknowledgment...
    await session.refresh(trip)
    assert trip.driver_accepted_at is not None
    assert trip.driver_accepted_by == first_driver.id

    # ...but the new driver is not told they accepted anything.
    second_headers = await _headers(api, second_user)
    payload = (await api.get("/api/driver/me/trip", headers=second_headers)).json()
    assert payload["id"] == str(trip.id)
    assert payload["driver_accepted_at"] is None

    # And accepting it themselves records THEM, replacing the inherited stamp.
    theirs = await api.post(
        "/api/driver/me/trip/accept", json={}, headers=second_headers
    )
    assert theirs.status_code == 200
    assert theirs.json()["driver_accepted_at"] is not None
    await session.refresh(trip)
    assert trip.driver_accepted_by == second_driver.id
    assert await _accepted_events(session, trip.id) == 2


async def test_a_failed_event_write_rolls_back_the_acceptance(
    api: AsyncClient, session: AsyncSession, monkeypatch
) -> None:
    """Acceptance and its timeline entry commit together, or not at all.

    A stamped trip with no event would be an acknowledgment the manager's
    timeline never shows; an event with no stamp would be the reverse. Both
    are worse than the request simply failing.
    """
    from app.db.session import get_sessionmaker
    from app.services import driver_trips

    _, user, _, _, trip = await _crew(session)
    headers = await _headers(api, user)
    trip_id = trip.id

    async def boom(*args, **kwargs):
        raise RuntimeError("timeline write failed")

    monkeypatch.setattr(driver_trips.trips, "record_event", boom)

    with pytest.raises(RuntimeError):
        await api.post("/api/driver/me/trip/accept", json={}, headers=headers)

    # Verified from an INDEPENDENT session, not the fixture's.
    #
    # Two reasons. The request died mid-transaction and left the fixture's own
    # connection unusable, so reading through it fails for that reason rather
    # than telling us anything. And the claim being tested is precisely that
    # nothing was COMMITTED - which is a question about what another
    # connection can see, so asking a different one is the honest form of it.
    async with get_sessionmaker()() as check:
        fresh = (
            await check.execute(select(Trip).where(Trip.id == trip_id))
        ).scalar_one()
        assert fresh.driver_accepted_at is None
        assert fresh.driver_accepted_by is None
        assert await _accepted_events(check, trip_id) == 0
