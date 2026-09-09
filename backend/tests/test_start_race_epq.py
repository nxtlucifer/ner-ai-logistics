"""REPRODUCTION: does cancelling the queue head strand a driver's second trip?

`driver_trips.current_trip` issues

    SELECT ... WHERE status IN (open) ORDER BY ... LIMIT 1 FOR UPDATE

PostgreSQL's EvalPlanQual recheck is the suspicion. When `FOR UPDATE` waits on a
row another transaction is updating, and that transaction commits a change which
makes the row no longer satisfy the WHERE clause, the row is dropped. With a
LIMIT the planner has already decided which row it wanted, so the documented
behaviour is that the query can return ZERO rows rather than moving on to the
next candidate.

If that happens here, a driver who taps Start at the moment a manager cancels
their first trip is told "You have no trip to work on right now" while a second,
perfectly startable trip is sitting in their queue. They would have to guess
that tapping again works.

This file exists to find out. It is written to FAIL loudly if the race strands
the driver, and to pass if the database resolves it the other way.
"""

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import TripStatus, UserRole
from app.models.operations import Trip
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


async def _fresh_client() -> AsyncClient:
    """A client over its own app instance, so requests genuinely interleave."""
    from app.main import create_app

    return AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://t")


async def _crew(session: AsyncSession):
    driver, user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck, verified=True)
    return driver, user, truck, assignment


class TestCancellingTheQueueHeadWhileTheDriverStarts:
    async def test_the_driver_is_not_stranded(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        manager = await factories.make_user(session, role=UserRole.MANAGER)
        manager_headers = await auth_headers(
            api, manager.email, factories.TEST_PASSWORD
        )

        driver, user, truck, assignment = await _crew(session)
        head = await factories.make_trip(
            session, driver, truck, assignment=assignment
        )
        queued = await factories.make_trip(
            session, driver, truck, assignment=assignment
        )
        driver_headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        head_id, queued_id, driver_id = head.id, queued.id, driver.id

        cancel_client, start_client = await _fresh_client(), await _fresh_client()
        try:
            cancel, start = await asyncio.gather(
                cancel_client.post(
                    f"/api/trips/{head_id}/cancel", headers=manager_headers
                ),
                start_client.post(
                    "/api/driver/me/trip/start", headers=driver_headers, json={}
                ),
                return_exceptions=True,
            )
        finally:
            await cancel_client.aclose()
            await start_client.aclose()

        assert not isinstance(cancel, BaseException), cancel
        assert not isinstance(start, BaseException), start
        assert cancel.status_code == 200, cancel.text

        session.expire_all()
        trips = {
            t.id: t.status
            for t in (
                await session.execute(
                    select(Trip).where(Trip.driver_id == driver_id)
                )
            ).scalars()
        }

        # Whatever happened, the database must not be lying about either trip.
        assert trips[head_id] in (TripStatus.CANCELLED, TripStatus.ACTIVE)

        if start.status_code == 200:
            # The driver started something. It must be a trip that is really
            # theirs and really running.
            started_id = start.json()["id"]
            assert trips[__import__("uuid").UUID(started_id)] is TripStatus.ACTIVE
            return

        # The interesting branch. A 404 here is the stranding this test exists
        # to detect: a startable trip is sitting in the queue and the driver has
        # been told they have nothing to do.
        assert start.status_code != 404, (
            "STRANDED: the driver was told they have no trip while "
            f"{queued_id} was ASSIGNED and startable. "
            f"head={trips[head_id].value} queued={trips[queued_id].value} "
            f"body={start.text}"
        )


class TestTheRaceForcedDeterministically:
    """The version above may simply never hit the window.

    `asyncio.gather` gives no guarantee the two statements overlap, and a race
    test that passes because it never raced is worse than no test - it reports
    a property it did not check.

    So the interleaving is constructed by hand: a third session takes the row
    lock on the queue head and HOLDS it, the driver's start is fired and blocks
    inside `current_trip`'s `FOR UPDATE`, and only then is the head cancelled
    and committed. That is exactly the EvalPlanQual situation, produced on
    demand rather than hoped for.
    """

    async def test_the_lock_wait_is_real_and_the_driver_is_not_stranded(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        import uuid as _uuid

        from sqlalchemy import text

        from app.db import session as db_session

        driver, user, truck, assignment = await _crew(session)
        head = await factories.make_trip(
            session, driver, truck, assignment=assignment
        )
        queued = await factories.make_trip(
            session, driver, truck, assignment=assignment
        )
        driver_headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        head_id, queued_id, driver_id = head.id, queued.id, driver.id

        client = await _fresh_client()
        sessionmaker = db_session.get_sessionmaker()
        blocker = sessionmaker()
        # The watcher takes its connection BEFORE anything is locked. Acquiring
        # it later means competing for the pool with the very request under
        # test, and a watcher that cannot connect reports "no lock wait" - a
        # false green on the one assertion that makes this test worth running.
        watcher = sessionmaker()
        try:
            await watcher.execute(text("SELECT 1"))

            # 1. Hold the queue head's row lock.
            locked = (
                await blocker.execute(
                    text("SELECT id FROM trips WHERE id = :i FOR UPDATE"),
                    {"i": str(head_id)},
                )
            ).scalar_one()
            assert locked is not None

            # 2. The driver taps Start. `current_trip` resolves the head - it is
            #    the earliest dispatched - and blocks on its FOR UPDATE.
            start_task = asyncio.create_task(
                client.post(
                    "/api/driver/me/trip/start", headers=driver_headers, json={}
                )
            )

            # PROVE it is blocked on THE ROW LOCK, from the database's own
            # view. `not start_task.done()` was the first attempt and is not
            # good enough: it shows the request has not FINISHED, which is also
            # true if it is waiting on auth, on another statement, or is merely
            # slow. A race test that cannot tell those apart reports a property
            # it did not check.
            #
            # `pg_stat_activity.wait_event_type = 'Lock'` is the database
            # saying a backend is waiting on a lock. Polled with a bounded
            # deadline rather than slept through, so a slow machine waits
            # longer and a fast one does not pay for it.
            # Let the request get past auth and reach the lock before probing.
            # This sleep is NOT the synchronisation - the assertion below is.
            # It only avoids polling through a window in which the answer is
            # meaningless because the statement has not been issued yet.
            await asyncio.sleep(2.0)

            waiting = False
            deadline = asyncio.get_running_loop().time() + 20.0
            while asyncio.get_running_loop().time() < deadline:
                waiting = bool(
                    (
                        await watcher.execute(
                            text(
                                "SELECT count(*) FROM pg_stat_activity "
                                "WHERE wait_event_type = 'Lock' "
                                "AND state = 'active' "
                                "AND query ILIKE '%FOR UPDATE OF trips%' "
                                "AND pid <> pg_backend_pid()"
                            )
                        )
                    ).scalar_one()
                )
                if waiting:
                    break
                await asyncio.sleep(0.25)

            assert waiting, (
                "no backend was observed waiting on a row lock, so the "
                "EvalPlanQual window was never entered and this test proved "
                "nothing"
            )
            assert not start_task.done(), (
                "the start request completed despite a lock being held"
            )

            # 3. Cancel the head and release. The driver's SELECT now wakes to
            #    find the row it chose no longer satisfies the WHERE clause.
            await blocker.execute(
                text(
                    "UPDATE trips SET status = 'CANCELLED', "
                    "closed_at = now() WHERE id = :i"
                ),
                {"i": str(head_id)},
            )
            await blocker.commit()

            start = await asyncio.wait_for(start_task, timeout=30)
        finally:
            await blocker.close()
            await watcher.close()
            await client.aclose()

        session.expire_all()
        statuses = {
            t.id: t.status
            for t in (
                await session.execute(select(Trip).where(Trip.driver_id == driver_id))
            ).scalars()
        }
        assert statuses[head_id] is TripStatus.CANCELLED

        if start.status_code == 200:
            started = _uuid.UUID(start.json()["id"])
            assert statuses[started] is TripStatus.ACTIVE
            assert started == queued_id, (
                "the driver started the trip that was cancelled underneath them"
            )
            return

        assert start.status_code != 404, (
            "STRANDED: with the queue head cancelled mid-wait, the driver was "
            f"told they have no trip while {queued_id} was ASSIGNED. "
            f"queued={statuses[queued_id].value} body={start.text}"
        )
