"""Cleanup may remove this run's rows and nothing else.

WHY THIS FILE EXISTS

Cleanup used to delete by global prefix - `TTEST-%`, `STEST-%`, `AS__ZZ%`,
`%@p3test.invalid` - which deletes by what a row is CALLED. Two facts follow
from that, and both hurt:

  - a run could delete rows it never made, including another run's live
    fixtures and rows that predate it entirely;
  - and afterwards nobody could say which rows a given run had created, because
    the only evidence was a name shared by every run that ever existed. That is
    why the shared-database incident produced "36 rows in a two-hour window"
    rather than an attribution.

`factories.OWNED` records ids at creation. These tests pin the consequences: the
things that must survive, the things that must go, and the ordering that lets
them go at all.

Everything here runs against the isolated cluster. "Another run's rows" are
simulated by inserting a complete trip graph directly, so no id reaches this
process's ledger - which is the entire difference between those rows and the
suite's own, and exactly the difference the prefix delete could not see.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import TripStatus, UserRole
from tests import factories

pytestmark = pytest.mark.requires_db


async def _exists(session: AsyncSession, table: str, row_id: uuid.UUID) -> bool:
    # `table` is a literal from this file, never request data.
    return (
        await session.execute(
            text(f"SELECT count(*) FROM {table} WHERE id = :i"), {"i": row_id}
        )
    ).scalar_one() == 1


async def _insert_unowned_graph(session: AsyncSession, tag: str) -> dict:
    """A complete trip graph written the way ANOTHER process would.

    Its own driver, truck and shipment, so nothing this run owns is pinned by
    it - otherwise the test would be measuring a foreign key rather than
    ownership.
    """
    ids = {k: uuid.uuid4() for k in ("user", "driver", "truck", "shipment", "trip")}
    suffix = uuid.uuid4().hex[:8]
    await session.execute(
        text(
            "INSERT INTO users (id, email, password_hash, role, display_name,"
            " is_active) VALUES (:i, :e, :p, 'DRIVER', 'Other Run', true)"
        ),
        {
            "i": ids["user"],
            "e": f"unowned-{suffix}@{factories.TEST_MARKER}",
            "p": "x" * 20,
        },
    )
    await session.execute(
        text(
            "INSERT INTO drivers (id, user_id, full_name, phone, licence_number,"
            " licence_expiry, status) VALUES (:i, :u, 'Other Run', :ph, :lic,"
            " CURRENT_DATE + 365, 'AVAILABLE')"
        ),
        {
            "i": ids["driver"],
            "u": ids["user"],
            "ph": factories.unique_phone(),
            "lic": factories.unique_licence(),
        },
    )
    await session.execute(
        text(
            "INSERT INTO trucks (id, registration_number, max_capacity_kg, status)"
            " VALUES (:i, :r, 16000, 'AVAILABLE')"
        ),
        {"i": ids["truck"], "r": factories.unique_registration()},
    )
    await session.execute(
        text(
            "INSERT INTO shipments (id, reference_code, client_name, pickup_address,"
            " pickup_location, destination_address, destination_location, priority)"
            " VALUES (:i, :c, 'Other Run', 'Depot',"
            " ST_SetSRID(ST_MakePoint(91.7362, 26.1445), 4326), 'Yard',"
            " ST_SetSRID(ST_MakePoint(94.2037, 26.7509), 4326), 'NORMAL')"
        ),
        {
            "i": ids["shipment"],
            "c": f"{factories.TEST_SHIPMENT_PREFIX}{tag}{suffix.upper()}",
        },
    )
    await session.execute(
        text(
            "INSERT INTO trips (id, trip_code, shipment_id, truck_id, driver_id,"
            " status) VALUES (:i, :c, :s, :t, :d, 'ASSIGNED')"
        ),
        {
            "i": ids["trip"],
            "c": f"{factories.TEST_TRIP_PREFIX}{tag}{suffix.upper()}",
            "s": ids["shipment"],
            "t": ids["truck"],
            "d": ids["driver"],
        },
    )
    await session.commit()
    return ids


async def _drop_unowned_graph(session: AsyncSession, ids: dict) -> None:
    """Remove the simulated other run. Not cleanup's job - that is the point."""
    await session.rollback()
    for sql, key in (
        ("DELETE FROM trips WHERE id = :i", "trip"),
        ("DELETE FROM shipments WHERE id = :i", "shipment"),
        ("DELETE FROM drivers WHERE id = :i", "driver"),
        ("DELETE FROM trucks WHERE id = :i", "truck"),
        ("DELETE FROM users WHERE id = :i", "user"),
    ):
        await session.execute(text(sql), {"i": ids[key]})
    await session.commit()


class TestUnownedRowsSurvive:
    async def test_another_runs_whole_graph_survives(
        self, session: AsyncSession
    ) -> None:
        """Trip, shipment, truck, driver and account, all named like ours.

        Under the prefix delete every one of these was reachable and would have
        gone - including while the run that made them was still using them.
        """
        foreign = await _insert_unowned_graph(session, "NOTOURS")
        # Something of our own, so cleanup has real work to do rather than
        # passing by doing nothing at all.
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        try:
            await factories.cleanup(session)

            assert await _exists(session, "trips", foreign["trip"])
            assert await _exists(session, "shipments", foreign["shipment"])
            assert await _exists(session, "trucks", foreign["truck"])
            assert await _exists(session, "drivers", foreign["driver"])
            assert (
                await session.execute(
                    text("SELECT is_active FROM users WHERE id = :i"),
                    {"i": foreign["user"]},
                )
            ).scalar_one() is True, "another run's account was deactivated"

            # And ours did go, so the survival above is scope, not inaction.
            assert not await _exists(session, "drivers", driver.id)
            assert not await _exists(session, "trucks", truck.id)
        finally:
            await _drop_unowned_graph(session, foreign)

    async def test_an_unowned_account_in_the_marker_domain_survives(
        self, session: AsyncSession
    ) -> None:
        """`%@p3test.invalid` is what EVERY run's accounts look like.

        The old `UPDATE` reached all of them, so a suite running alongside had
        its live fixtures deactivated mid-test and failed authenticating for no
        visible reason.
        """
        address = f"otherrun-{uuid.uuid4().hex[:8]}@{factories.TEST_MARKER}"
        await session.execute(
            text(
                "INSERT INTO users (email, password_hash, role, display_name,"
                " is_active) VALUES (:e, :p, 'MANAGER', 'Other Run', true)"
            ),
            {"e": address, "p": "x" * 20},
        )
        await session.commit()
        try:
            await factories.cleanup(session)

            still_active = (
                await session.execute(
                    text("SELECT is_active FROM users WHERE email = :e"),
                    {"e": address},
                )
            ).scalar_one()
            assert still_active is True, (
                "cleanup deactivated an account belonging to another run"
            )
        finally:
            await session.rollback()
            await session.execute(
                text("DELETE FROM users WHERE email = :e"), {"e": address}
            )
            await session.commit()

    async def test_an_unowned_truck_survives(self, session: AsyncSession) -> None:
        """Trucks were the weakest case and the reason the fix was deferred.

        `REGISTRATION_PATTERN` leaves almost no room to encode a run id, so a
        naming scheme could not have owned them - which is why a per-run
        namespace was judged "a wider change than this checkpoint should carry".
        Recording ids sidesteps the format entirely: the registration stays
        exactly as it is.
        """
        truck_id = uuid.uuid4()
        await session.execute(
            text(
                "INSERT INTO trucks (id, registration_number, max_capacity_kg, status)"
                " VALUES (:i, :r, 16000, 'AVAILABLE')"
            ),
            {"i": truck_id, "r": factories.unique_registration()},
        )
        await session.commit()
        try:
            await factories.cleanup(session)
            assert await _exists(session, "trucks", truck_id), (
                "cleanup deleted an AS__ZZ truck this run did not create"
            )
        finally:
            await session.rollback()
            await session.execute(
                text("DELETE FROM trucks WHERE id = :i"), {"i": truck_id}
            )
            await session.commit()


class TestOwnedRowsAreRemoved:
    async def test_the_full_graph_goes_in_dependency_order(
        self, session: AsyncSession
    ) -> None:
        """Trips RESTRICT shipments, drivers and trucks, so order is the test.

        A cleanup that deleted trucks first would raise instead of tidying, and
        the failure would surface as a warning during someone else's test.
        """
        driver, driver_user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await factories.make_assignment(session, driver, truck)
        shipment = await factories.make_shipment(session)
        trip = await factories.make_trip(
            session, driver, truck, shipment=shipment, assignment=assignment
        )

        await factories.cleanup(session)

        assert not await _exists(session, "trips", trip.id)
        assert not await _exists(session, "shipments", shipment.id)
        assert not await _exists(session, "driver_truck_assignments", assignment.id)
        assert not await _exists(session, "drivers", driver.id)
        assert not await _exists(session, "trucks", truck.id)
        # Retained by the audit FK, deactivated instead - see
        # test_test_account_hygiene.py.
        assert await _exists(session, "users", driver_user.id)

    async def test_children_go_with_their_parent(self, session: AsyncSession) -> None:
        """Stops are never recorded individually; they CASCADE from the trip.

        Worth pinning: the ledger deliberately does not track every dependent
        row, and that is only safe while the database really does cascade.
        """
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        trip = await factories.make_trip(session, driver, truck, stops=2)

        stops_before = (
            await session.execute(
                text("SELECT count(*) FROM trip_stops WHERE trip_id = :i"),
                {"i": trip.id},
            )
        ).scalar_one()
        assert stops_before == 2

        await factories.cleanup(session)

        stops_after = (
            await session.execute(
                text("SELECT count(*) FROM trip_stops WHERE trip_id = :i"),
                {"i": trip.id},
            )
        ).scalar_one()
        assert stops_after == 0

    async def test_the_ledger_is_emptied_so_ids_are_not_retried(
        self, session: AsyncSession
    ) -> None:
        await factories.make_truck(session)
        assert factories.OWNED.get("trucks")

        await factories.cleanup(session)
        assert factories.OWNED == {}

        # A second cleanup with nothing owned must be a no-op, not an error:
        # `_cleanup_test_rows` runs after every test, most of which create
        # nothing.
        await factories.cleanup(session)


class TestFailureDoesNotBroadenTheDelete:
    async def test_ids_survive_a_failed_cleanup_for_the_next_attempt(
        self, session: AsyncSession
    ) -> None:
        """A raising delete must not clear the ledger.

        If it did, the rows would still be there and nothing would know they
        were ours - the exact loss of attribution this design exists to
        prevent. The retry is the point; forgetting is the bug.

        Provoked by claiming ownership of a driver that an unowned trip still
        references: RESTRICT refuses the delete part way through the sequence,
        with the truck delete still to come.
        """
        truck = await factories.make_truck(session)
        # Read now: the rollback below expires the instance, and reading an
        # expired attribute would lazy-load from outside the async context.
        truck_id = truck.id
        blocked = await _insert_unowned_graph(session, "BLOCK")
        factories.OWNED.setdefault("drivers", []).append(blocked["driver"])

        owned_trucks = list(factories.OWNED["trucks"])
        try:
            with pytest.raises(Exception):  # noqa: B017 - the driver's own error
                await factories.cleanup(session)
            await session.rollback()

            assert factories.OWNED.get("trucks") == owned_trucks, (
                "a failed cleanup forgot which rows it owned"
            )
            assert await _exists(session, "trucks", truck_id), (
                "the truck went even though the transaction failed"
            )
        finally:
            factories.OWNED.clear()
            await _drop_unowned_graph(session, blocked)

    async def test_a_row_deleted_by_the_test_itself_is_tolerated(
        self, session: AsyncSession
    ) -> None:
        """Tests that clean up after themselves must not break teardown.

        `DELETE ... WHERE id = ANY(...)` matches nothing for an id already gone,
        which is the behaviour wanted - no error, and no widening to find a
        replacement.
        """
        truck = await factories.make_truck(session)
        await session.execute(
            text("DELETE FROM trucks WHERE id = :i"), {"i": truck.id}
        )
        await session.commit()

        await factories.cleanup(session)
        assert factories.OWNED == {}


class TestOwnershipIsNotAHeuristic:
    async def test_ownership_does_not_depend_on_trip_state(
        self, session: AsyncSession
    ) -> None:
        """A CLOSED trip is still this run's row.

        Guards against an ownership check drifting into a status filter, which
        would leave finished trips accumulating and unattributable.
        """
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        trip = await factories.make_trip(
            session, driver, truck, status=TripStatus.CLOSED
        )

        await factories.cleanup(session)
        assert not await _exists(session, "trips", trip.id)

    async def test_an_admin_account_is_still_deactivated(
        self, session: AsyncSession
    ) -> None:
        """The role that mattered most in the original exposure."""
        user = await factories.make_user(session, role=UserRole.ADMIN)

        await factories.cleanup(session)

        assert (
            await session.execute(
                text("SELECT is_active FROM users WHERE id = :i"), {"i": user.id}
            )
        ).scalar_one() is False
