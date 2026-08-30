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
users and audit rows accumulate instead. They are inert - identifiers are
random and collide with nothing.
"""

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models.enums import DriverStatus, TruckStatus, UserRole
from app.models.fleet import DriverTruckAssignment, Truck
from app.models.identity import Driver, User

# Everything created by the suite carries this marker so cleanup can find it
# without touching real development data.
TEST_MARKER = "p3test.invalid"
TEST_PASSWORD = "correct-horse-battery-staple"


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


async def cleanup(db: AsyncSession) -> None:
    """Remove everything the suite created, in foreign-key order."""
    marker = f"%@{TEST_MARKER}"

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
    # Test users therefore accumulate. They are inert: emails and phones are
    # random, so they collide with nothing.
    # Trucks carry no marker of their own; the registration prefix identifies them.
    await db.execute(
        text("DELETE FROM trucks WHERE registration_number LIKE 'AS__ZZ%'")
    )
    await db.commit()
