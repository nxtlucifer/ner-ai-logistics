"""Driver service: business rules, transactions and audit for drivers."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError, PermissionDeniedError
from app.core.security import hash_password
from app.models.enums import AuditAction, DriverStatus, UserRole
from app.models.identity import Driver, User
from app.schemas.domain import DriverCreate, DriverUpdate
from app.services import audit
from app.services.pagination import (
    build_page,
    clamp_limit,
    cursor_predicate,
    decode_cursor,
)

# Fields captured in audit before/after records. Explicit, so a column added
# later is not swept into the audit trail without thought.
AUDITED_FIELDS = (
    "id", "full_name", "phone", "licence_number", "licence_expiry",
    "licence_class", "status", "emergency_contact_name",
    "emergency_contact_phone", "date_of_joining",
)


async def get(db: AsyncSession, driver_id: uuid.UUID, *, actor: User) -> Driver:
    """Fetch one driver, scoped to what the actor may see.

    A driver may read only their own record. The response for someone else's is
    404, not 403 - a 403 confirms the record exists, which is itself a
    disclosure. See docs/SECURITY.md section 2.
    """
    driver = (
        await db.execute(
            select(Driver).where(Driver.id == driver_id, Driver.deleted_at.is_(None))
        )
    ).scalar_one_or_none()

    if driver is None:
        raise NotFoundError("Driver not found.")

    if actor.role is UserRole.DRIVER and driver.user_id != actor.id:
        raise NotFoundError("Driver not found.")

    return driver


async def list_drivers(
    db: AsyncSession,
    *,
    actor: User,
    limit: int | None = None,
    cursor: str | None = None,
    status: DriverStatus | None = None,
    search: str | None = None,
) -> tuple[list[Driver], str | None]:
    """List drivers, newest first, scoped to the actor."""
    page_size = clamp_limit(limit)

    stmt = select(Driver).where(Driver.deleted_at.is_(None))

    # Scoping happens in the query, not by filtering results afterwards - a
    # post-filter still fetches rows the caller may not see, and one forgotten
    # filter leaks them.
    if actor.role is UserRole.DRIVER:
        stmt = stmt.where(Driver.user_id == actor.id)

    if status is not None:
        stmt = stmt.where(Driver.status == status)

    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(Driver.full_name.ilike(pattern), Driver.licence_number.ilike(pattern))
        )

    if cursor:
        stmt = stmt.where(
            cursor_predicate(Driver.created_at, Driver.id, decode_cursor(cursor))
        )

    stmt = stmt.order_by(Driver.created_at.desc(), Driver.id.desc()).limit(page_size + 1)
    rows = list((await db.execute(stmt)).scalars().all())
    return build_page(rows, page_size)


async def create(
    db: AsyncSession, payload: DriverCreate, *, actor: User, ip: str | None = None
) -> Driver:
    """Create the login and the driver profile in one transaction."""
    # Pre-check for a clear 409. The unique indexes remain the real authority -
    # this check can lose a race, and the IntegrityError handler below is what
    # makes the outcome correct when it does.
    clash = (
        await db.execute(
            select(User.id).where(
                or_(
                    User.phone == payload.phone,
                    User.email.isnot(None)
                    & (func.lower(User.email) == (payload.email or "").lower())
                    if payload.email
                    else User.phone == payload.phone,
                )
            )
        )
    ).first()
    if clash:
        raise ConflictError(
            "A user with that phone or email already exists.",
            code="USER_EXISTS",
        )

    existing_licence = (
        await db.execute(
            select(Driver.id).where(
                Driver.licence_number == payload.licence_number,
                Driver.deleted_at.is_(None),
            )
        )
    ).first()
    if existing_licence:
        raise ConflictError(
            "A driver with that licence number already exists.",
            code="LICENCE_EXISTS",
        )

    user = User(
        email=payload.email,
        phone=payload.phone,
        password_hash=hash_password(payload.initial_password),
        role=UserRole.DRIVER,
        display_name=payload.full_name,
    )
    db.add(user)
    await db.flush()

    driver = Driver(
        user_id=user.id,
        full_name=payload.full_name,
        phone=payload.phone,
        licence_number=payload.licence_number,
        licence_expiry=payload.licence_expiry,
        licence_class=payload.licence_class,
        emergency_contact_name=payload.emergency_contact_name,
        emergency_contact_phone=payload.emergency_contact_phone,
        date_of_joining=payload.date_of_joining,
        base_salary_monthly=payload.base_salary_monthly,
        status=DriverStatus.AVAILABLE,
    )
    db.add(driver)

    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError(
            "A driver with those details already exists.", code="DRIVER_EXISTS"
        ) from exc

    await audit.record(
        db,
        action=AuditAction.CREATE,
        entity_type="drivers",
        entity_id=driver.id,
        actor_user_id=actor.id,
        after=audit.snapshot(driver, AUDITED_FIELDS),
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(driver)
    return driver


async def update(
    db: AsyncSession,
    driver_id: uuid.UUID,
    payload: DriverUpdate,
    *,
    actor: User,
    ip: str | None = None,
) -> Driver:
    driver = await get(db, driver_id, actor=actor)
    before = audit.snapshot(driver, AUDITED_FIELDS)

    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return driver

    if "licence_number" in changes:
        clash = (
            await db.execute(
                select(Driver.id).where(
                    Driver.licence_number == changes["licence_number"],
                    Driver.id != driver.id,
                    Driver.deleted_at.is_(None),
                )
            )
        ).first()
        if clash:
            raise ConflictError(
                "A driver with that licence number already exists.",
                code="LICENCE_EXISTS",
            )

    for field, value in changes.items():
        setattr(driver, field, value)

    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError("Update conflicts with an existing driver.") from exc

    await audit.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="drivers",
        entity_id=driver.id,
        actor_user_id=actor.id,
        before=before,
        after=audit.snapshot(driver, AUDITED_FIELDS),
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(driver)
    return driver


async def deactivate(
    db: AsyncSession,
    driver_id: uuid.UUID,
    *,
    actor: User,
    reason: str | None = None,
    ip: str | None = None,
) -> Driver:
    """Soft-delete a driver and disable their login.

    Never a hard DELETE: trips, assignments and GPS history reference this row,
    and the foreign keys are RESTRICT precisely so history cannot be destroyed.
    """
    driver = await get(db, driver_id, actor=actor)

    if driver.status is DriverStatus.ON_TRIP:
        raise ConflictError(
            "Driver is currently on a trip and cannot be deactivated.",
            code="DRIVER_ON_TRIP",
        )

    before = audit.snapshot(driver, AUDITED_FIELDS)
    now = datetime.now(UTC)
    driver.deleted_at = now
    driver.status = DriverStatus.SUSPENDED

    user = (
        await db.execute(select(User).where(User.id == driver.user_id))
    ).scalar_one_or_none()
    if user is not None:
        user.is_active = False

    await audit.record(
        db,
        action=AuditAction.DELETE,
        entity_type="drivers",
        entity_id=driver.id,
        actor_user_id=actor.id,
        before=before,
        after=audit.snapshot(driver, AUDITED_FIELDS),
        reason=reason,
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(driver)
    return driver
