"""Driver self-service endpoints.

Every route here is scoped to the authenticated driver by
`require_current_driver`. None of them accepts a driver id, so there is nothing
to enumerate: the subject comes from the token, not the URL.

Responses carry only what the app needs. No manager metadata, no salary, no
other drivers, no document contents.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import CurrentDriver, CurrentUser, DbSession, get_client_ip
from app.models.enums import AssignmentStatus, DriverStatus, TruckStatus
from app.schemas.common import ReadModel
from app.schemas.domain import AssignmentVerify
from app.services import driver_self

router = APIRouter(prefix="/api/driver", tags=["driver"])

ClientIp = Annotated[str | None, Depends(get_client_ip)]


class DriverMe(ReadModel):
    """The driver's own profile. Deliberately narrow.

    `base_salary_monthly` is absent: it is admin-only and has no place in a
    device that may be handed around a depot.
    """

    id: uuid.UUID
    full_name: str
    phone: str
    licence_number: str
    licence_expiry: date
    status: DriverStatus


class TruckSummary(ReadModel):
    """Only what a driver needs to identify and check the vehicle."""

    id: uuid.UUID
    registration_number: str
    truck_type: str | None
    make: str | None
    model: str | None
    max_capacity_kg: Decimal
    status: TruckStatus


class CurrentAssignment(ReadModel):
    id: uuid.UUID
    status: AssignmentStatus
    assigned_at: datetime
    verified_at: datetime | None
    mismatch_flagged: bool
    truck: TruckSummary


class VerifyResult(ReadModel):
    assignment: CurrentAssignment
    #: True when this call was a no-op retry of an earlier identical submission.
    already_verified: bool


class VerifyRequest(AssignmentVerify):
    """Verification payload.

    `assignment_id` is optional and can only ever NARROW the request: the
    assignment is resolved from the authenticated driver, and this is compared
    against it to reject a stale screen. Sending someone else's id cannot widen
    access - it simply fails.
    """

    assignment_id: uuid.UUID | None = None


def _to_current(assignment, truck) -> CurrentAssignment:
    return CurrentAssignment(
        id=assignment.id,
        status=assignment.status,
        assigned_at=assignment.assigned_at,
        verified_at=assignment.verified_at,
        mismatch_flagged=assignment.mismatch_flagged,
        truck=TruckSummary.model_validate(truck),
    )


@router.get("/me", response_model=DriverMe, summary="The signed-in driver")
async def me(driver: CurrentDriver) -> DriverMe:
    return DriverMe.model_validate(driver)


@router.get(
    "/me/assignment",
    response_model=CurrentAssignment | None,
    summary="The driver's current assignment",
)
async def my_assignment(
    driver: CurrentDriver, db: DbSession
) -> CurrentAssignment | None:
    """Returns null when the driver has no assignment.

    An unassigned driver is a normal state, not an error, so this is a 200 with
    a null body rather than a 404 the app would have to special-case.
    """
    found = await driver_self.current_assignment(db, driver)
    return None if found is None else _to_current(*found)


@router.post(
    "/me/assignment/verify",
    response_model=VerifyResult,
    summary="Verify the assigned truck",
)
async def verify_my_assignment(
    payload: VerifyRequest,
    driver: CurrentDriver,
    user: CurrentUser,
    db: DbSession,
    ip: ClientIp,
) -> VerifyResult:
    """Confirm the physical truck matches the assignment.

    A registration mismatch is recorded and flagged for the manager - it never
    blocks the driver. Semantics for repeats, ended and superseded assignments
    are in app/services/driver_self.py.
    """
    assignment, truck, already = await driver_self.verify_current_assignment(
        db,
        driver,
        user,
        AssignmentVerify(
            reported_registration=payload.reported_registration,
            reported_odometer_km=payload.reported_odometer_km,
            reported_fuel_level_pct=payload.reported_fuel_level_pct,
            reported_damage_notes=payload.reported_damage_notes,
        ),
        assignment_id=payload.assignment_id,
        ip=ip,
    )
    return VerifyResult(
        assignment=_to_current(assignment, truck), already_verified=already
    )
