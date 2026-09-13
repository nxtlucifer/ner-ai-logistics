"""Test data helpers.

Rows are created through the real async session, not the rolled-back sync
`db` fixture, because API tests exercise the application's own sessions and must
see committed data.

Cleanup deletes only what this process created - see OWNED - in foreign-key
order, and stops short of two things on purpose:

  - `audit_logs` is never deleted; the append-only trigger rejects DELETE.
  - `users` are never deleted; audit_logs.actor_user_id is RESTRICT, so a user
    who has done anything auditable is pinned by their trail.

Both are the intended production behaviour. Weakening either to tidy a
development database would remove the guarantee it exists to provide, so test
users and audit rows accumulate instead.

Accumulating is fine. Accumulating **usable** is not, and that is what this file
used to do: it claimed retained users were "inert because identifiers are
random", which was wrong in the way that matters. They kept `is_active = true`
and a password that was a committed constant, so any one of them - including
ADMIN accounts - could still log in and receive a full permission set. Retained
accounts are therefore DEACTIVATED at cleanup and their refresh tokens deleted:
the audit trail keeps its actor, and the actor keeps no way in.
"""

import secrets
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models.enums import (
    AssignmentStatus,
    CargoPriority,
    DriverStatus,
    TripStatus,
    TripStopKind,
    TruckStatus,
    UserRole,
)
from app.models.files import StoredFile
from app.models.fleet import DriverTruckAssignment, Truck
from app.models.identity import Driver, User
from app.models.operations import CargoItem, Shipment, Trip, TripStop
from app.schemas.common import Coordinate
from app.services.shipments import point
from tests import db_target

# Arming the veto here as well as in conftest, because this module is the one
# that WRITES. A suite start is not the only way in: `from tests import
# factories` in a scratch script, a REPL, or a helper somebody runs to reset
# fixtures reaches these functions and this cleanup with no conftest loaded at
# all. Idempotent, so importing both costs nothing.
db_target.install()

# Domain for every address the suite generates. RFC 6761 reserves `.invalid`, so
# these can never be delivered to and never collide with a real account.
#
# It is a LABEL, not a permission: cleanup no longer selects on it. A human
# reading the database can see which rows came from a test; nothing deletes a row
# because it looks like one.
TEST_MARKER = "p3test.invalid"

#: Password for every account this suite creates. Generated per PROCESS, never
#: committed.
#:
#: It used to be a fixed literal in this file, which AGENTS.md forbids outright
#: ("never hardcode passwords, including tests and fixtures") and which had a
#: consequence rather than merely a smell. Users cannot be deleted at cleanup -
#: audit_logs.actor_user_id is RESTRICT - so accounts accumulate, and every one
#: of them accepted a password published in a public repository. An audit of the
#: shared development project found thousands of live accounts, including
#: ADMIN ones, that authenticated with it and returned a full permission set.
#: Harmless while the backend binds to localhost; not harmless the moment it is
#: exposed on a LAN so a physical phone can reach it, which P7 requires.
#:
#: One value per process, so factories and the tests that log in as those
#: accounts agree for the length of a run, and nothing outside that run - or
#: any later run - can reuse it. `certify_fleet.py` already worked this way;
#: this brings the suite into line with it.
TEST_PASSWORD = secrets.token_urlsafe(32)

# Trips and shipments carry their own prefixes so a human reading the database
# can tell suite rows apart. Cleanup does NOT use them - see OWNED below.
TEST_TRIP_PREFIX = "TTEST-"
TEST_SHIPMENT_PREFIX = "STEST-"

#: Exactly the rows this process created, per table, in creation order.
#:
#: Cleanup used to delete by GLOBAL prefix: every `TTEST-%` trip, every `STEST-%`
#: shipment, every `AS__ZZ%` truck, every `%@p3test.invalid` user - regardless of
#: who made them. That is what turned one misconfigured run into a shared-database
#: incident with an unbounded blast radius, and it is why the reported "36 rows
#: created in a two-hour window" could not be turned into an attribution: a prefix
#: plus a timestamp says a row looks like a test row, not that this run made it.
#:
#: A prefix is a naming convention. This is ownership. Nothing reaches the delete
#: unless this process put its id here, so a run cannot remove another run's
#: fixtures, cannot remove rows that predate it, and cannot remove a real record
#: that happens to match a pattern.
OWNED: dict[str, list[uuid.UUID]] = {}

#: Tables `cleanup` knows how to remove, in the order it removes them. Rows in
#: any other table are left to CASCADE from these, or are append-only.
OWNED_TABLES = frozenset(
    {"trips", "shipments", "driver_truck_assignments", "drivers", "trucks", "users"}
)


def _own(table: str, row_id: uuid.UUID) -> None:
    """Record a row this run created, so cleanup may remove exactly it."""
    OWNED.setdefault(table, []).append(row_id)


_tracking_installed = False


def install_ownership_tracking() -> None:
    """Record every row the ORM inserts, whichever session inserts it.

    Calling `_own` from each factory was the obvious design and it was wrong in
    a way worth writing down: several tests do not use the factories to make
    their trips. They POST to `/api/trips`, so the row is created by the
    application's own session inside the request, and no factory ever sees it.
    Those trips then pinned factory shipments with RESTRICT and cleanup failed
    on rows it could not identify - the same shape of blindness as the prefix
    delete, arrived at from the other direction.

    An `after_flush` listener on `Session` catches all of them, because every
    row the application creates goes through the ORM. It is the write-side
    counterpart of the connection veto in `db_target`: one place all writers
    pass through, rather than a rule each writer has to remember.

    Deliberately NOT triggered by `session.execute(text("INSERT ..."))`. Raw SQL
    is how the tests simulate another process's rows, and that distinction is
    what those tests measure.
    """
    global _tracking_installed
    if _tracking_installed:
        return
    _tracking_installed = True

    from sqlalchemy import event
    from sqlalchemy.orm import Session

    @event.listens_for(Session, "after_flush")
    def _record_inserts(session: Session, flush_context: object) -> None:  # noqa: ARG001
        # After the flush, so server-generated primary keys are populated.
        for obj in session.new:
            table = getattr(obj, "__table__", None)
            if table is None or table.name not in OWNED_TABLES:
                continue
            row_id = getattr(obj, "id", None)
            if row_id is not None:
                _own(table.name, row_id)


install_ownership_tracking()


# Real NER coordinates, so a latitude/longitude inversion in the code under test
# produces a recognisably wrong answer rather than merely a different number.
GUWAHATI = Coordinate(lat=26.1445, lon=91.7362)
JORHAT = Coordinate(lat=26.7509, lon=94.2037)


def unique_email(prefix: str = "user") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}@{TEST_MARKER}"


def unique_phone() -> str:
    # 10 digits, matching PHONE_PATTERN, unlikely to collide.
    return f"9{uuid.uuid4().int % 10**9:09d}"


def unique_registration() -> str:
    return f"AS{uuid.uuid4().int % 100:02d}ZZ{uuid.uuid4().int % 10000:04d}"


def unique_licence() -> str:
    return f"AS{uuid.uuid4().hex[:12].upper()}"


async def make_user(
    db: AsyncSession,
    *,
    role: UserRole = UserRole.MANAGER,
    password: str = TEST_PASSWORD,
    is_active: bool = True,
    phone: str | None = None,
) -> User:
    user = User(
        email=unique_email(role.value.lower()),
        phone=phone,
        password_hash=hash_password(password),
        role=role,
        display_name=f"Test {role.value.title()}",
        is_active=is_active,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def make_driver(
    db: AsyncSession,
    *,
    status: DriverStatus = DriverStatus.AVAILABLE,
    licence_expiry: date | None = None,
    password: str = TEST_PASSWORD,
    is_active: bool = True,
) -> tuple[Driver, User]:
    """A driver and the login behind them.

    `is_active` is the LOGIN flag, not the driver's operational status - the two
    are independent columns and are exactly what the dispatchability tests need
    to drive apart. A driver row can read AVAILABLE while the account behind it
    cannot sign in; that combination is a bug to be caught, not one to be made
    unreachable by the factory.
    """
    phone = unique_phone()
    user = User(
        email=unique_email("driver"),
        phone=phone,
        password_hash=hash_password(password),
        role=UserRole.DRIVER,
        display_name="Test Driver",
        is_active=is_active,
    )
    db.add(user)
    await db.flush()

    driver = Driver(
        user_id=user.id,
        full_name="Bipul Das",
        phone=phone,
        licence_number=unique_licence(),
        licence_expiry=licence_expiry or (date.today() + timedelta(days=365)),
        status=status,
    )
    db.add(driver)
    await db.commit()
    await db.refresh(driver)
    await db.refresh(user)
    return driver, user


async def make_truck(
    db: AsyncSession,
    *,
    capacity: Decimal | int = 16000,
    status: TruckStatus = TruckStatus.AVAILABLE,
) -> Truck:
    truck = Truck(
        registration_number=unique_registration(),
        max_capacity_kg=Decimal(str(capacity)),
        status=status,
    )
    db.add(truck)
    await db.commit()
    await db.refresh(truck)
    return truck


async def make_assignment(
    db: AsyncSession,
    driver: Driver,
    truck: Truck,
    *,
    status: AssignmentStatus = AssignmentStatus.ACTIVE,
    verified: bool = True,
) -> DriverTruckAssignment:
    """A driver/truck assignment.

    `verified` defaults to True because most trip tests are about the trip, and
    an unverified assignment blocks the start gate - which is its own test, not
    a trap for every other one.
    """
    assignment = DriverTruckAssignment(
        driver_id=driver.id,
        truck_id=truck.id,
        status=status,
        verified_at=datetime.now(UTC) if verified else None,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    return assignment


#: Smallest bytes the files API sniffs as PNG.
PNG = bytes([0x89]) + b"PNG" + bytes([13, 10, 26, 10]) + bytes(64)


async def attach_verification_photo(
    db: AsyncSession, driver: Driver, assignment: DriverTruckAssignment
) -> str:
    """A stored TRUCK_VERIFICATION photo bound to `assignment`, exactly as
    `POST /api/files?kind=TRUCK_VERIFICATION` leaves it. Driver verification
    refuses without one (VERIFICATION_PHOTO_REQUIRED)."""
    stored = StoredFile(
        owner_driver_id=driver.id, kind="TRUCK_VERIFICATION",
        content_type="image/png", size_bytes=len(PNG), data=PNG,
    )
    db.add(stored)
    await db.flush()
    assignment.verification_photo_url = f"/api/files/{stored.id}"
    await db.commit()
    await db.refresh(assignment)
    return assignment.verification_photo_url


async def make_shipment(
    db: AsyncSession,
    *,
    weight_kg: Decimal | int = 1000,
    pickup: Coordinate = GUWAHATI,
    destination: Coordinate = JORHAT,
) -> Shipment:
    shipment = Shipment(
        reference_code=f"{TEST_SHIPMENT_PREFIX}{uuid.uuid4().hex[:10].upper()}",
        client_name="Test Client",
        pickup_address="Depot, Guwahati",
        pickup_location=point(pickup),
        destination_address="Yard, Jorhat",
        destination_location=point(destination),
        priority=CargoPriority.NORMAL,
    )
    db.add(shipment)
    await db.flush()
    db.add(
        CargoItem(
            shipment_id=shipment.id,
            cargo_type="GENERAL",
            cargo_name="Test cargo",
            weight_kg=Decimal(str(weight_kg)),
            quantity=1,
        )
    )
    await db.commit()
    # The weight trigger fired on the cargo insert; without the refresh the
    # object still holds the 0 default and capacity tests compare nothing.
    await db.refresh(shipment)
    return shipment


async def make_trip(
    db: AsyncSession,
    driver: Driver,
    truck: Truck,
    *,
    shipment: Shipment | None = None,
    assignment: DriverTruckAssignment | None = None,
    status: TripStatus = TripStatus.ASSIGNED,
    stops: int = 2,
) -> Trip:
    """A trip with `stops` PENDING stops, ready to execute."""
    shipment = shipment or await make_shipment(db)
    trip = Trip(
        trip_code=f"{TEST_TRIP_PREFIX}{uuid.uuid4().hex[:10].upper()}",
        shipment_id=shipment.id,
        truck_id=truck.id,
        driver_id=driver.id,
        assignment_id=assignment.id if assignment else None,
        status=status,
        dispatched_at=datetime.now(UTC),
    )
    db.add(trip)
    await db.flush()

    for sequence in range(stops):
        db.add(
            TripStop(
                trip_id=trip.id,
                sequence=sequence,
                kind=TripStopKind.PICKUP if sequence == 0 else TripStopKind.DROPOFF,
                location=point(GUWAHATI if sequence == 0 else JORHAT),
                name=f"Stop {sequence}",
            )
        )
    await db.commit()
    await db.refresh(trip)
    return trip


async def _by_id(db: AsyncSession, sql: str, table: str) -> None:
    """Run `sql` for the ids this run owns in `table`, or not at all.

    Skipping the empty case is not only an optimisation: `= ANY(:ids)` with an
    empty Python list gives psycopg no element type to infer, and the statement
    fails rather than matching nothing.
    """
    ids = OWNED.get(table)
    if not ids:
        return
    await db.execute(text(sql), {"ids": ids})


async def cleanup(db: AsyncSession) -> None:
    """Remove the rows THIS RUN created, in foreign-key order.

    Every statement is keyed on ids from `OWNED`. A row this process did not
    create cannot be reached by any of them, whatever it is called - so a
    concurrent run's fixtures, a pre-existing `TTEST-` trip and a real record
    that happens to match a pattern all survive, and cleanup no longer has to
    be trusted, only read.

    The ledger is cleared only after the commit. If a delete raises - a
    constraint this run did not expect - the ids stay recorded and the next
    teardown attempts them again, rather than the failure quietly widening into
    "rows we can no longer identify".
    """
    # Trips first: they RESTRICT the delete of shipments, drivers and trucks.
    # Deleting a trip CASCADEs to its stops, routes, events and gps_points, so
    # telemetry created by the P5 tests goes with it.
    await _by_id(db, "DELETE FROM trips WHERE id = ANY(:ids)", "trips")
    # Cargo items CASCADE from shipments.
    await _by_id(db, "DELETE FROM shipments WHERE id = ANY(:ids)", "shipments")

    # Assignments reference drivers and trucks with RESTRICT.
    await _by_id(
        db,
        "DELETE FROM driver_truck_assignments WHERE id = ANY(:ids)",
        "driver_truck_assignments",
    )
    await _by_id(db, "DELETE FROM drivers WHERE id = ANY(:ids)", "drivers")
    # Refresh tokens are minted by the login endpoint, not by a factory, so they
    # are owned transitively: a token belongs to this run exactly when the user
    # it authenticates does.
    await _by_id(
        db, "DELETE FROM refresh_tokens WHERE user_id = ANY(:ids)", "users"
    )
    # Users are deliberately NOT deleted. audit_logs.actor_user_id is RESTRICT
    # (migration 0004): an audit row pins its actor, so a user who has done
    # anything auditable - including a login attempt - cannot be removed. That
    # is the intended production behaviour, so the suite lives with it rather
    # than weakening the constraint to tidy a development database.
    #
    # They are DEACTIVATED instead. Retention is required; remaining usable is
    # not, and the two were previously conflated. With refresh tokens already
    # deleted above and is_active false, a retained account has no way in: the
    # password path fails on the is_active check in app/api/deps.py and the token
    # path has nothing to present. The audit trail keeps its actor either way.
    await _by_id(
        db,
        "UPDATE users SET is_active = false WHERE id = ANY(:ids) AND is_active",
        "users",
    )
    await _by_id(db, "DELETE FROM trucks WHERE id = ANY(:ids)", "trucks")
    await db.commit()
    OWNED.clear()
