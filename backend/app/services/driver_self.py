"""Driver self-service: current assignment and verification.

Every function here takes an already-resolved `Driver` from
`require_current_driver`. None of them accepts a driver id, so there is no
parameter an attacker could change to act as somebody else.

VERIFICATION SEMANTICS, stated explicitly
-----------------------------------------
| Situation | Result |
| --- | --- |
| First verification, registration matches | 200, ACTIVE, verified_at set |
| First verification, registration differs | 200, PENDING_VERIFICATION, mismatch_flagged - the driver is never blocked |
| Repeat with the SAME readings | 200, idempotent, returns the existing record unchanged |
| Repeat with DIFFERENT readings | 409 ALREADY_VERIFIED - a correction is a manager review, not a silent overwrite |
| Assignment has ended | 404 - an ended assignment is not "current", so there is nothing to verify |
| Assignment superseded by a newer one | 409 ASSIGNMENT_SUPERSEDED |
| Truck retired or broken down | 409 TRUCK_NOT_OPERATIONAL |
| Driver suspended / no profile | 403 (in require_current_driver) |

The idempotent branch matters because the driver app runs on an unreliable
network: a retried request after a lost response must not become a 409 the
driver cannot act on. It compares the submitted readings to what was stored, so
a genuine retry succeeds while a genuine change is refused.

That comparison is made at the PRECISION THE DATABASE STORES, not at the
precision the client sent. `reported_odometer_km` is NUMERIC(10,1): submitting
184203.05 stores 184203.1, so comparing the raw submission against the stored
value would call an identical retry a "correction" and answer 409 - stranding
the driver in exactly the situation idempotency exists to prevent.
"""

import uuid
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError
from app.models.enums import AssignmentStatus, AuditAction, TruckStatus
from app.models.fleet import DriverTruckAssignment, Truck
from app.models.identity import Driver, User
from app.schemas.domain import AssignmentVerify
from app.services import audit

AUDITED_FIELDS = (
    "id", "driver_id", "truck_id", "status", "assigned_at", "verified_at",
    "mismatch_flagged", "ended_at",
)

# Statuses a driver may still be acting on.
OPEN_STATUSES = (AssignmentStatus.ACTIVE, AssignmentStatus.PENDING_VERIFICATION)

#: Scale of driver_truck_assignments.reported_odometer_km, NUMERIC(10,1).
ODOMETER_QUANTUM = Decimal("0.1")


def normalise_registration(value: str) -> str:
    return value.upper().replace(" ", "").replace("-", "")


def quantise_odometer(value: Decimal | None) -> Decimal | None:
    """Round to the precision the column actually stores.

    ROUND_HALF_UP, not Python's default ROUND_HALF_EVEN, because PostgreSQL
    rounds numeric half away from zero. Matching it means the value compared on
    a retry is the value the database will hold.
    """
    if value is None:
        return None
    try:
        return Decimal(value).quantize(ODOMETER_QUANTUM, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        # Pydantic has already bounded this field; anything unquantisable is
        # left untouched rather than silently becoming a different reading.
        return value


async def current_assignment(
    db: AsyncSession, driver: Driver, *, for_update: bool = False
) -> tuple[DriverTruckAssignment, Truck] | None:
    """The driver's open assignment, or None.

    None is a legitimate answer - an unassigned driver is a normal state, not an
    error - so callers render an empty state rather than a failure.

    `for_update` takes a row lock on the assignment (never on the truck, which
    is only being read). Mutating callers must set it: without the lock, two
    devices verifying at the same moment both read `verified_at IS NULL`, both
    write, and the row ends up with whichever readings committed last plus two
    audit entries claiming to be the first verification.
    """
    stmt = (
        select(DriverTruckAssignment, Truck)
        .join(Truck, Truck.id == DriverTruckAssignment.truck_id)
        .where(
            DriverTruckAssignment.driver_id == driver.id,
            DriverTruckAssignment.status.in_(OPEN_STATUSES),
        )
        .order_by(DriverTruckAssignment.assigned_at.desc())
        .limit(1)
    )
    if for_update:
        stmt = stmt.with_for_update(of=DriverTruckAssignment)

    row = (await db.execute(stmt)).first()
    if row is None:
        return None
    return row[0], row[1]


async def truck_for(db: AsyncSession, truck_id: uuid.UUID) -> Truck:
    """The truck a driver is working with.

    No ownership check here on purpose: callers reach this only with a truck id
    taken from the driver's OWN assignment or trip, never from a request. Adding
    a redundant check would suggest this function is safe to call with a
    client-supplied id, which it is not.
    """
    truck = (
        await db.execute(select(Truck).where(Truck.id == truck_id))
    ).scalar_one_or_none()
    if truck is None:
        raise NotFoundError("Truck not found.")
    return truck


def _readings_match(
    assignment: DriverTruckAssignment, payload: AssignmentVerify
) -> bool:
    """Whether a repeat submission carries the same readings as the stored one.

    Used to tell a network retry (idempotent, 200) from a genuine correction
    (409). Compared as Decimal, never as float.
    """

    def same_decimal(stored: Decimal | None, given: Decimal | None) -> bool:
        if stored is None and given is None:
            return True
        if stored is None or given is None:
            return False
        # Both sides quantised to the stored scale: a retry of 184203.05 must
        # match the 184203.1 the database rounded it to.
        return quantise_odometer(stored) == quantise_odometer(given)

    reported = (
        normalise_registration(payload.reported_registration)
        if payload.reported_registration
        else None
    )
    return (
        assignment.reported_registration == reported
        and same_decimal(assignment.reported_odometer_km, payload.reported_odometer_km)
        and assignment.reported_fuel_level_pct == payload.reported_fuel_level_pct
        and (assignment.reported_damage_notes or None)
        == (payload.reported_damage_notes or None)
    )


async def verify_current_assignment(
    db: AsyncSession,
    driver: Driver,
    user: User,
    payload: AssignmentVerify,
    *,
    assignment_id: uuid.UUID | None = None,
    ip: str | None = None,
) -> tuple[DriverTruckAssignment, Truck, bool]:
    """Verify the driver's own current assignment.

    Returns (assignment, truck, was_already_verified).

    `assignment_id` is optional and is only ever used to REJECT a stale request
    - it can never widen what the driver may touch, because the assignment is
    looked up from the authenticated driver regardless of what was sent.
    """
    # Locked: this is a mutating path, and two devices may submit at once.
    found = await current_assignment(db, driver, for_update=True)
    if found is None:
        # Covers "never assigned" and "assignment has ended" alike: neither is a
        # current assignment, and distinguishing them would tell the driver
        # nothing they can act on.
        raise NotFoundError("You have no active assignment to verify.")

    assignment, truck = found

    # The app may send the id it was showing. If it no longer matches, the
    # manager reassigned in the meantime and the driver is looking at a stale
    # screen - refuse rather than silently verifying a different truck.
    if assignment_id is not None and assignment_id != assignment.id:
        raise ConflictError(
            "Your assignment changed. Reload and check the truck again.",
            code="ASSIGNMENT_SUPERSEDED",
            details={"current_assignment_id": str(assignment.id)},
        )

    if truck.status in (TruckStatus.RETIRED, TruckStatus.BREAKDOWN):
        raise ConflictError(
            f"Truck is {truck.status.value.lower()} and cannot be verified.",
            code="TRUCK_NOT_OPERATIONAL",
        )

    if assignment.verified_at is not None:
        if _readings_match(assignment, payload):
            # Idempotent: a retry after a lost response.
            return assignment, truck, True
        raise ConflictError(
            "This assignment has already been verified. Ask your manager to "
            "review it if the details are wrong.",
            code="ALREADY_VERIFIED",
        )

    before = audit.snapshot(assignment, AUDITED_FIELDS)

    mismatch = False
    if payload.reported_registration:
        reported = normalise_registration(payload.reported_registration)
        mismatch = reported != truck.registration_number
        assignment.reported_registration = reported

    assignment.reported_odometer_km = quantise_odometer(payload.reported_odometer_km)
    assignment.reported_fuel_level_pct = payload.reported_fuel_level_pct
    assignment.reported_damage_notes = payload.reported_damage_notes
    assignment.verified_at = datetime.now(UTC)
    assignment.mismatch_flagged = mismatch
    # A mismatch routes to manager review; it never blocks the driver.
    assignment.status = (
        AssignmentStatus.PENDING_VERIFICATION if mismatch else AssignmentStatus.ACTIVE
    )

    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError(
            "Your assignment changed while verifying. Please reload.",
            code="ASSIGNMENT_CONFLICT",
        ) from exc

    await audit.record(
        db,
        action=AuditAction.STATUS_CHANGE,
        entity_type="driver_truck_assignments",
        entity_id=assignment.id,
        actor_user_id=user.id,
        before=before,
        after=audit.snapshot(assignment, AUDITED_FIELDS),
        reason=(
            "driver verification: registration mismatch flagged for review"
            if mismatch
            else "driver verified truck"
        ),
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(assignment)
    return assignment, truck, False
