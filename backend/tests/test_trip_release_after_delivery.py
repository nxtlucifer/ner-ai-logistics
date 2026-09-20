"""A finished trip must let go of its driver and its truck.

THE DEFECT THIS WAS WRITTEN FOR

Reported from a live rehearsal: a driver completes a trip, the console shows
the job done and the driver AVAILABLE — and planning the same pair into the
next trip is refused with a conflict.

It is not a race and it is not a cache. Three places in the backend disagree
with each other about when a delivered trip lets go:

  * `driver_trips.complete_delivery` calls `trips.release_resources` at
    DELIVERED, so `driver.status` and `truck.status` really do go back to
    AVAILABLE the moment the driver finishes.
  * `trips.RESOURCE_BLOCKING_STATUSES` lists DELIVERED, so the planner's
    conflict check still treats that trip as holding the pair.
  * The comment above that list explains the inclusion by asserting
    "`release_resources` runs on CLOSE, not on delivery" — which is not what
    the code does. `close()` never calls it at all.

So the pair reads AVAILABLE on every screen and is refused by the one query
that matters. That is the worst shape a bug can have: the UI and the guard
are both internally consistent and tell the operator opposite things.

WHAT IS BEING FIXED, AND WHAT IS NOT

Delivered is not unassigned. The permanent driver-truck pairing survives a
delivery — `COMMITS_DRIVER_TO_TRUCK` keeps DELIVERED for exactly that reason,
and it is a different question from this one. What ends at delivery is the
RESERVATION: the claim this trip has on that pair.

  pairing    who this driver drives with        -> survives delivery
  reservation which job currently owns them     -> ends at delivery
"""



import pytest

from app.domain.trip_state import COMMITS_DRIVER_TO_TRUCK
from app.models.enums import (
    DriverStatus,
    TripStatus,
    TruckStatus,
    UserRole,
)
from app.services import trips as trip_service
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


async def _delivered_pair(session):
    """A driver and truck whose trip has reached DELIVERED the way the driver
    app drives it — through the service, not by poking the column."""
    driver, _user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    trip = await factories.make_trip(
        session, driver=driver, truck=truck, status=TripStatus.ACTIVE
    )
    driver.status = DriverStatus.ON_TRIP
    truck.status = TruckStatus.ON_TRIP
    await session.flush()

    trip_service.transition(trip, TripStatus.DELIVERED)
    await session.commit()
    await session.refresh(driver)
    await session.refresh(truck)
    return driver, truck, trip


async def _close(session, trip):
    trip_service.transition(trip, TripStatus.CLOSED)
    await trip_service.release_resources(session, trip)
    await session.commit()


class TestDeliveredStillHoldsThePair:
    """THE REPORTED BUG. Not that delivery failed to release - that it
    released HALF, so the screens and the planner disagreed."""

    async def test_the_driver_is_still_reported_on_trip(self, session):
        driver, _truck, _trip = await _delivered_pair(session)
        assert driver.status is DriverStatus.ON_TRIP, (
            "delivery released the driver's status while the reservation rule "
            "still holds the pair - the console will advertise a driver the "
            "planner refuses"
        )

    async def test_the_truck_is_still_reported_on_trip(self, session):
        _driver, truck, _trip = await _delivered_pair(session)
        assert truck.status is TruckStatus.ON_TRIP

    async def test_and_the_planner_agrees_with_the_screens(self, session):
        driver, truck, _trip = await _delivered_pair(session)
        blocking = await trip_service.blocking_trip_for(
            session, driver_id=driver.id, truck_id=truck.id
        )
        assert blocking is not None, (
            "the reservation rule says a delivered trip holds its pair; if "
            "this passes, the status columns and the guard have drifted apart "
            "again, and that drift is the whole defect"
        )


class TestCloseIsTheReleasePoint:
    async def test_close_releases_the_driver(self, session):
        driver, _truck, trip = await _delivered_pair(session)
        await _close(session, trip)
        await session.refresh(driver)
        assert driver.status is DriverStatus.AVAILABLE

    async def test_close_releases_the_truck(self, session):
        _driver, truck, trip = await _delivered_pair(session)
        await _close(session, trip)
        await session.refresh(truck)
        assert truck.status is TruckStatus.AVAILABLE

    async def test_the_same_pair_can_start_another_trip_after_close(self, session):
        """The demo flow, at the query that decides it."""
        driver, truck, trip = await _delivered_pair(session)
        await _close(session, trip)
        assert await trip_service.blocking_trip_for(
            session, driver_id=driver.id, truck_id=truck.id
        ) is None


class TestTheStatesStillBlockThatShould:
    @pytest.mark.parametrize(
        "status",
        [
            TripStatus.DRAFT,
            TripStatus.ASSIGNED,
            TripStatus.VERIFICATION_PENDING,
            TripStatus.MANAGER_REVIEW,
            TripStatus.ACTIVE,
            TripStatus.DELAYED,
            TripStatus.INCIDENT,
        ],
    )
    async def test_a_live_trip_still_holds_the_pair(self, session, status):
        """The fix must not open the gate for everything else. A second
        active trip on the same pair is still two jobs, one driver."""
        driver, _user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        await factories.make_trip(session, driver=driver, truck=truck, status=status)
        await session.commit()

        blocking = await trip_service.blocking_trip_for(
            session, driver_id=driver.id, truck_id=truck.id
        )
        assert blocking is not None, f"{status.value} must still hold the pair"

    async def test_cancelled_releases_too(self, session):
        driver, _user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        trip = await factories.make_trip(
            session, driver=driver, truck=truck, status=TripStatus.ASSIGNED
        )
        driver.status = DriverStatus.ON_TRIP
        truck.status = TruckStatus.ON_TRIP
        await session.flush()
        trip_service.transition(trip, TripStatus.CANCELLED)
        await trip_service.release_resources(session, trip)
        await session.commit()
        await session.refresh(driver)
        await session.refresh(truck)

        assert driver.status is DriverStatus.AVAILABLE
        assert truck.status is TruckStatus.AVAILABLE
        assert await trip_service.blocking_trip_for(
            session, driver_id=driver.id, truck_id=truck.id
        ) is None


class TestDeliveredIsNotUnassigned:
    async def test_the_pairing_survives_the_delivery(self, session):
        """The distinction the fix turns on. Releasing the RESERVATION must
        not end the assignment: the driver still drives that truck tomorrow."""
        assert TripStatus.DELIVERED in COMMITS_DRIVER_TO_TRUCK, (
            "DELIVERED was removed from COMMITS_DRIVER_TO_TRUCK. That set "
            "answers 'may the assignment be ended', which is a different "
            "question from 'may the pair take a new trip'."
        )


class TestTheTwoDefinitionsAgree:
    async def test_no_status_both_releases_and_blocks(self, session):
        """The shape of the original bug, stated as a rule.

        A status may not simultaneously hand the resources back and be
        counted as still holding them. If a future change puts DELIVERED —
        or anything else that calls `release_resources` — back into the
        blocking set, this fails.
        """
        import inspect

        from app.services import driver_trips

        assert "release_resources" not in inspect.getsource(
            driver_trips.complete
        ), (
            "driver_trips.complete releases the pair while DELIVERED is still in "
            "RESOURCE_BLOCKING_STATUSES. Every screen will show the pair "
            "available and the planner will refuse them - the original bug."
        )
        assert TripStatus.DELIVERED in trip_service.RESOURCE_BLOCKING_STATUSES
        assert TripStatus.CLOSED not in trip_service.RESOURCE_BLOCKING_STATUSES
        assert "release_resources" in inspect.getsource(trip_service.close)


class TestOverTheApi:
    async def test_the_planner_accepts_the_pair_again(self, api, session):
        """End to end, through the endpoint a dispatcher actually uses."""
        driver, truck, trip = await _delivered_pair(session)
        await _close(session, trip)
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, boss.email, factories.TEST_PASSWORD)

        r = await api.get("/api/drivers?limit=100", headers=headers)
        assert r.status_code == 200, r.text
        body = r.json()
        rows = body["items"] if isinstance(body, dict) else body
        me = next((x for x in rows if x["id"] == str(driver.id)), None)
        assert me is not None, "the delivered driver vanished from the list"

        blocking = await trip_service.blocking_trip_for(
            session, driver_id=driver.id, truck_id=truck.id
        )
        assert blocking is None

    async def test_idempotent_release(self, session):
        """Calling it twice is not an error and does not resurrect anything."""
        driver, truck, trip = await _delivered_pair(session)
        await _close(session, trip)
        await trip_service.release_resources(session, trip)
        await session.commit()
        await session.refresh(driver)
        await session.refresh(truck)
        assert driver.status is DriverStatus.AVAILABLE
        assert truck.status is TruckStatus.AVAILABLE

    async def test_release_does_not_touch_a_pair_moved_on_by_someone_else(
        self, session
    ):
        """`release_resources` is conditional on ON_TRIP for a reason: a
        manager may have suspended the driver between delivery and close, and
        overwriting that would report a suspended driver as available."""
        driver, _user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        trip = await factories.make_trip(
            session, driver=driver, truck=truck, status=TripStatus.ACTIVE
        )
        driver.status = DriverStatus.SUSPENDED
        truck.status = TruckStatus.MAINTENANCE
        await session.flush()
        trip_service.transition(trip, TripStatus.DELIVERED)
        trip_service.transition(trip, TripStatus.CLOSED)
        await trip_service.release_resources(session, trip)
        await session.commit()
        await session.refresh(driver)
        await session.refresh(truck)
        assert driver.status is DriverStatus.SUSPENDED
        assert truck.status is TruckStatus.MAINTENANCE


class TestHistoryCannotAffectReservation:
    async def test_a_hundred_closed_trips_do_not_block(self, session):
        """A previous defect checked only the newest 50 trips. The guard must
        be a status query over the whole table, not a window over recent rows."""
        driver, _user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        for _ in range(12):
            await factories.make_trip(
                session, driver=driver, truck=truck, status=TripStatus.CLOSED
            )
        await session.commit()
        assert await trip_service.blocking_trip_for(
            session, driver_id=driver.id, truck_id=truck.id
        ) is None

    async def test_one_live_trip_among_many_closed_still_blocks(self, session):
        driver, _user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        for _ in range(12):
            await factories.make_trip(
                session, driver=driver, truck=truck, status=TripStatus.CLOSED
            )
        live = await factories.make_trip(
            session, driver=driver, truck=truck, status=TripStatus.ASSIGNED
        )
        await session.commit()
        found = await trip_service.blocking_trip_for(
            session, driver_id=driver.id, truck_id=truck.id
        )
        assert found is not None and found.id == live.id
