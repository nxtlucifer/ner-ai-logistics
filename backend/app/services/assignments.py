"""Driver/truck assignment service.

Not simple CRUD: the invariants are "at most one CURRENT assignment per driver"
and "at most one CURRENT assignment per truck", and those must survive
concurrent requests.

"Current" means ACTIVE **or** PENDING_VERIFICATION. Both statuses mean the
driver is responsible for that truck right now - PENDING_VERIFICATION is what a
reported registration mismatch produces, and the driver keeps driving while a
manager reviews it. Treating only ACTIVE as current is a real defect and was
one: a reassignment slipped straight past an assignment awaiting review and left
the driver holding two trucks at once.

The concurrency story matters. A SELECT-then-INSERT pre-check cannot be correct
on its own:

    request A: SELECT -> no active assignment -> INSERT
    request B: SELECT -> no active assignment -> INSERT     <- both pass

Both transactions see a clean pre-check and both insert. The authority is
therefore the pair of partial unique indexes created in migration 0002 and
widened in 0006 (uq_current_assignment_driver / uq_current_assignment_truck -
renamed there because "active" was exactly the word that was wrong). The
pre-check exists
only to produce a clear message in the uncontended case; the IntegrityError
handler is what makes the contended case correct.
"""

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BusinessRuleError, ConflictError, NotFoundError
from app.models.enums import (
    AssignmentStatus,
    AuditAction,
    DriverStatus,
    TruckStatus,
    UserRole,
)
from app.models.fleet import DriverTruckAssignment, Truck
from app.models.identity import Driver, User
from app.services import audit
from app.services.pagination import clamp_limit

AUDITED_FIELDS = (
    "id", "driver_id", "truck_id", "status", "assigned_at", "verified_at",
    "mismatch_flagged", "ended_at",
)

#: Statuses in which a driver is still responsible for the truck. Both count
#: as "current": PENDING_VERIFICATION is what a reported mismatch produces,
#: and the driver keeps the vehicle while a manager reviews it.
OPEN_STATUSES = (AssignmentStatus.ACTIVE, AssignmentStatus.PENDING_VERIFICATION)

#: Backwards-compatible alias for the list filter.
ACTIVE_STATUSES = OPEN_STATUSES


async def get(
    db: AsyncSession, assignment_id: uuid.UUID, *, actor: User
) -> DriverTruckAssignment:
    assignment = (
        await db.execute(
            select(DriverTruckAssignment).where(
                DriverTruckAssignment.id == assignment_id
            )
        )
    ).scalar_one_or_none()
    if assignment is None:
        raise NotFoundError("Assignment not found.")

    if actor.role is UserRole.DRIVER:
        driver = (
            await db.execute(
                select(Driver).where(Driver.id == assignment.driver_id)
            )
        ).scalar_one_or_none()
        if driver is None or driver.user_id != actor.id:
            raise NotFoundError("Assignment not found.")

    return assignment


async def list_assignments(
    db: AsyncSession,
    *,
    actor: User,
    driver_id: uuid.UUID | None = None,
    truck_id: uuid.UUID | None = None,
    active_only: bool = False,
    limit: int | None = None,
) -> list[DriverTruckAssignment]:
    page_size = clamp_limit(limit)
    stmt = select(DriverTruckAssignment)

    if actor.role is UserRole.DRIVER:
        own = (
            await db.execute(select(Driver.id).where(Driver.user_id == actor.id))
        ).scalar_one_or_none()
        # A driver with no profile sees nothing rather than everything.
        stmt = stmt.where(DriverTruckAssignment.driver_id == (own or uuid.UUID(int=0)))

    if driver_id is not None:
        stmt = stmt.where(DriverTruckAssignment.driver_id == driver_id)
    if truck_id is not None:
        stmt = stmt.where(DriverTruckAssignment.truck_id == truck_id)
    if active_only:
        stmt = stmt.where(DriverTruckAssignment.status.in_(ACTIVE_STATUSES))

    stmt = stmt.order_by(
        DriverTruckAssignment.assigned_at.desc(), DriverTruckAssignment.id.desc()
    ).limit(page_size)
    return list((await db.execute(stmt)).scalars().all())


async def _validate_driver(db: AsyncSession, driver_id: uuid.UUID) -> Driver:
    driver = (
        await db.execute(
            select(Driver).where(Driver.id == driver_id, Driver.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if driver is None:
        raise NotFoundError("Driver not found.")

    if driver.status is DriverStatus.SUSPENDED:
        raise BusinessRuleError(
            "Driver is suspended and cannot be assigned.", code="DRIVER_SUSPENDED"
        )

    # A compliance fact, not a preference: no role may assign a driver whose
    # licence has lapsed.
    if driver.licence_expiry < date.today():
        raise BusinessRuleError(
            "Driver's licence has expired.",
            code="LICENCE_EXPIRED",
            details={"licence_expiry": driver.licence_expiry.isoformat()},
        )
    return driver


async def _validate_truck(db: AsyncSession, truck_id: uuid.UUID) -> Truck:
    truck = (
        await db.execute(
            select(Truck).where(Truck.id == truck_id, Truck.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if truck is None:
        raise NotFoundError("Truck not found.")

    if truck.status in (TruckStatus.RETIRED, TruckStatus.BREAKDOWN):
        raise BusinessRuleError(
            f"Truck is {truck.status.value.lower()} and cannot be assigned.",
            code="TRUCK_NOT_OPERATIONAL",
        )
    return truck


async def create(
    db: AsyncSession,
    *,
    driver_id: uuid.UUID,
    truck_id: uuid.UUID,
    actor: User,
    ip: str | None = None,
) -> DriverTruckAssignment:
    """Assign a driver to a truck.

    Any existing CURRENT assignment for either party - ACTIVE or
    PENDING_VERIFICATION - is ended first, in the same transaction, so the
    partial unique indexes are never transiently violated.
    """
    driver = await _validate_driver(db, driver_id)
    truck = await _validate_truck(db, truck_id)

    # Already assigned to exactly this truck? Return a clear conflict rather
    # than silently creating a duplicate.
    #
    # ACTIVE **or** PENDING_VERIFICATION. Both mean the driver is currently
    # responsible for that truck - PENDING_VERIFICATION is what a registration
    # mismatch produces, and the driver keeps the vehicle while a manager
    # reviews it. Matching only ACTIVE here let a reassignment slip past an
    # assignment awaiting review, leaving the driver holding two trucks at once:
    # PENDING_VERIFICATION on the old one and ACTIVE on the new. P5 made that
    # concrete - `trips.open_assignment_for()` accepts either status, so a trip
    # on the abandoned truck stayed startable by a driver who had been moved.
    held_by_driver = list(
        (
            await db.execute(
                select(DriverTruckAssignment)
                .where(
                    DriverTruckAssignment.driver_id == driver_id,
                    DriverTruckAssignment.status.in_(OPEN_STATUSES),
                )
                .order_by(DriverTruckAssignment.assigned_at.desc())
            )
        )
        .scalars()
        .all()
    )
    current = held_by_driver[0] if held_by_driver else None
    if current is not None and current.truck_id == truck_id:
        raise ConflictError(
            "Driver is already assigned to this truck.",
            code="ASSIGNMENT_UNCHANGED",
            details={"assignment_id": str(current.id)},
        )

    now = datetime.now(UTC)

    # End every open assignment the driver holds, not just the newest. A
    # database that predates the widened unique indexes may carry more than one.
    for held in held_by_driver:
        held.status = AssignmentStatus.ENDED
        held.ended_at = now

    # End whoever currently holds this truck.
    truck_holders = list(
        (
            await db.execute(
                select(DriverTruckAssignment).where(
                    DriverTruckAssignment.truck_id == truck_id,
                    DriverTruckAssignment.status.in_(OPEN_STATUSES),
                )
            )
        )
        .scalars()
        .all()
    )
    for holder in truck_holders:
        holder.status = AssignmentStatus.ENDED
        holder.ended_at = now

    # Flush the endings before inserting, so the unique indexes see the
    # intermediate state in the right order.
    await db.flush()

    assignment = DriverTruckAssignment(
        driver_id=driver_id,
        truck_id=truck_id,
        assigned_by=actor.id,
        status=AssignmentStatus.ACTIVE,
        assigned_at=now,
    )
    db.add(assignment)

    try:
        await db.flush()
    except IntegrityError as exc:
        # A competing request won the race. The database rejected the second
        # write, which is exactly what should happen; the loser gets a 409.
        await db.rollback()
        raise ConflictError(
            "That driver or truck was assigned by another request. Please retry.",
            code="ASSIGNMENT_CONFLICT",
        ) from exc

    await audit.record(
        db,
        action=AuditAction.CREATE,
        entity_type="driver_truck_assignments",
        entity_id=assignment.id,
        actor_user_id=actor.id,
        after=audit.snapshot(assignment, AUDITED_FIELDS),
        reason=f"driver {driver.full_name} -> truck {truck.registration_number}",
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(assignment)
    return assignment


# Truck verification lives in app/services/driver_self.py, which owns the whole
# driver-scoped path (current assignment, idempotent retry, truck-operational
# gate, row lock). This module briefly carried a second implementation of it and
# the two had already drifted apart; one state transition gets one implementation.


async def end(
    db: AsyncSession,
    assignment_id: uuid.UUID,
    *,
    actor: User,
    reason: str | None = None,
    ip: str | None = None,
) -> DriverTruckAssignment:
    assignment = await get(db, assignment_id, actor=actor)

    if assignment.status is AssignmentStatus.ENDED:
        raise ConflictError("Assignment has already ended.", code="ALREADY_ENDED")

    before = audit.snapshot(assignment, AUDITED_FIELDS)
    assignment.status = AssignmentStatus.ENDED
    assignment.ended_at = datetime.now(UTC)

    await db.flush()
    await audit.record(
        db,
        action=AuditAction.STATUS_CHANGE,
        entity_type="driver_truck_assignments",
        entity_id=assignment.id,
        actor_user_id=actor.id,
        before=before,
        after=audit.snapshot(assignment, AUDITED_FIELDS),
        reason=reason or "ended by manager",
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(assignment)
    return assignment
