"""Test data helpers.

Rows are created through the real async session, not the rolled-back sync
`db` fixture, because API tests exercise the application's own sessions and must
see committed data.

Cleanup deletes in foreign-key order, and stops short of two things on purpose:

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
from app.models.fleet import DriverTruckAssignment, Truck
from app.models.identity import Driver, User
from app.models.operations import CargoItem, Shipment, Trip, TripStop
from app.schemas.common import Coordinate
from app.services.shipments import point

# Everything created by the suite carries this marker so cleanup can find it
# without touching real development data.
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

# Trips and shipments carry their own prefixes: they are not linked to a user by
# email, so cleanup finds them by code.
TEST_TRIP_PREFIX = "TTEST-"
TEST_SHIPMENT_PREFIX = "STEST-"

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
) -> tuple[Driver, User]:
    phone = unique_phone()
    user = User(
        email=unique_email("driver"),
        phone=phone,
        password_hash=hash_password(password),
        role=UserRole.DRIVER,
        display_name="Test Driver",
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


async def cleanup(db: AsyncSession) -> None:
    """Remove everything the suite created, in foreign-key order."""
    marker = f"%@{TEST_MARKER}"

    # Trips first: they RESTRICT the delete of shipments, drivers and trucks.
    # Deleting a trip CASCADEs to its stops, routes, events and gps_points, so
    # telemetry created by the P5 tests goes with it.
    await db.execute(
        text("DELETE FROM trips WHERE trip_code LIKE :p"),
        {"p": f"{TEST_TRIP_PREFIX}%"},
    )
    # Cargo items CASCADE from shipments.
    await db.execute(
        text("DELETE FROM shipments WHERE reference_code LIKE :p"),
        {"p": f"{TEST_SHIPMENT_PREFIX}%"},
    )

    # Assignments reference drivers and trucks with RESTRICT.
    await db.execute(
        text(
            "DELETE FROM driver_truck_assignments a USING drivers d, users u "
            "WHERE a.driver_id = d.id AND d.user_id = u.id AND u.email LIKE :m"
        ),
        {"m": marker},
    )
    await db.execute(
        text(
            "DELETE FROM drivers d USING users u "
            "WHERE d.user_id = u.id AND u.email LIKE :m"
        ),
        {"m": marker},
    )
    await db.execute(
        text("DELETE FROM refresh_tokens r USING users u "
             "WHERE r.user_id = u.id AND u.email LIKE :m"),
        {"m": marker},
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
    #
    # Scoped to the marker domain, which is RFC 6761 `.invalid` and can only
    # have been produced by unique_email() in this file - so this can never
    # reach a real development account.
    await db.execute(
        text("UPDATE users SET is_active = false WHERE email LIKE :m AND is_active"),
        {"m": marker},
    )
    # Trucks carry no marker of their own; the registration prefix identifies them.
    await db.execute(
        text("DELETE FROM trucks WHERE registration_number LIKE 'AS__ZZ%'")
    )
    await db.commit()
