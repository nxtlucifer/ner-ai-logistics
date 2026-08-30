"""Manager CRUD endpoints for drivers, trucks and assignments.

Routes stay thin: validate, authorize, delegate, serialise. Business rules,
transactions and audit live in app/services.

Every route declares the permission it needs. No route inspects `user.role`.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel

from app.api.deps import (
    CurrentDriver,
    DbSession,
    get_client_ip,
    require_permission,
)
from app.core import permissions as perm
from app.models.enums import DriverStatus, TruckStatus
from app.models.identity import User
from app.schemas.domain import (
    AssignmentCreate,
    AssignmentRead,
    AssignmentVerify,
    DriverCreate,
    DriverRead,
    DriverUpdate,
    TruckCreate,
    TruckRead,
    TruckUpdate,
)
from app.services import assignments as assignment_service
from app.services import driver_self
from app.services import drivers as driver_service
from app.services import trucks as truck_service

ClientIp = Annotated[str | None, Depends(get_client_ip)]
Limit = Annotated[int | None, Query(ge=1, le=100)]


class DriverPage(BaseModel):
    items: list[DriverRead]
    next_cursor: str | None = None


class TruckPage(BaseModel):
    items: list[TruckRead]
    next_cursor: str | None = None


# --- Drivers --------------------------------------------------------------

drivers_router = APIRouter(prefix="/api/drivers", tags=["drivers"])


@drivers_router.get("", response_model=DriverPage, summary="List drivers")
async def list_drivers(
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.DRIVER_READ))],
    limit: Limit = None,
    cursor: str | None = None,
    driver_status: DriverStatus | None = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
) -> DriverPage:
    rows, next_cursor = await driver_service.list_drivers(
        db, actor=actor, limit=limit, cursor=cursor, status=driver_status, search=search
    )
    return DriverPage(
        items=[DriverRead.model_validate(r) for r in rows], next_cursor=next_cursor
    )


@drivers_router.post(
    "", response_model=DriverRead, status_code=status.HTTP_201_CREATED,
    summary="Create a driver",
)
async def create_driver(
    payload: DriverCreate,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.DRIVER_CREATE))],
    ip: ClientIp,
) -> DriverRead:
    driver = await driver_service.create(db, payload, actor=actor, ip=ip)
    return DriverRead.model_validate(driver)


@drivers_router.get("/{driver_id}", response_model=DriverRead, summary="Get a driver")
async def get_driver(
    driver_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.DRIVER_READ))],
) -> DriverRead:
    return DriverRead.model_validate(await driver_service.get(db, driver_id, actor=actor))


@drivers_router.patch(
    "/{driver_id}", response_model=DriverRead, summary="Update a driver"
)
async def update_driver(
    driver_id: uuid.UUID,
    payload: DriverUpdate,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.DRIVER_UPDATE))],
    ip: ClientIp,
) -> DriverRead:
    driver = await driver_service.update(db, driver_id, payload, actor=actor, ip=ip)
    return DriverRead.model_validate(driver)


@drivers_router.post(
    "/{driver_id}/deactivate", response_model=DriverRead, summary="Deactivate a driver"
)
async def deactivate_driver(
    driver_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.DRIVER_DEACTIVATE))],
    ip: ClientIp,
    reason: Annotated[str | None, Query(max_length=200)] = None,
) -> DriverRead:
    """Deactivation rather than DELETE.

    Trips, assignments and GPS history reference this driver, and the foreign
    keys are RESTRICT so that history cannot be destroyed.
    """
    driver = await driver_service.deactivate(
        db, driver_id, actor=actor, reason=reason, ip=ip
    )
    return DriverRead.model_validate(driver)


# --- Trucks ---------------------------------------------------------------

trucks_router = APIRouter(prefix="/api/trucks", tags=["trucks"])


@trucks_router.get("", response_model=TruckPage, summary="List trucks")
async def list_trucks(
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.TRUCK_READ))],
    limit: Limit = None,
    cursor: str | None = None,
    truck_status: TruckStatus | None = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
) -> TruckPage:
    rows, next_cursor = await truck_service.list_trucks(
        db, limit=limit, cursor=cursor, status=truck_status, search=search
    )
    return TruckPage(
        items=[TruckRead.model_validate(r) for r in rows], next_cursor=next_cursor
    )


@trucks_router.post(
    "", response_model=TruckRead, status_code=status.HTTP_201_CREATED,
    summary="Create a truck",
)
async def create_truck(
    payload: TruckCreate,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.TRUCK_CREATE))],
    ip: ClientIp,
) -> TruckRead:
    return TruckRead.model_validate(
        await truck_service.create(db, payload, actor=actor, ip=ip)
    )


@trucks_router.get("/{truck_id}", response_model=TruckRead, summary="Get a truck")
async def get_truck(
    truck_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.TRUCK_READ))],
) -> TruckRead:
    return TruckRead.model_validate(await truck_service.get(db, truck_id))


@trucks_router.patch("/{truck_id}", response_model=TruckRead, summary="Update a truck")
async def update_truck(
    truck_id: uuid.UUID,
    payload: TruckUpdate,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.TRUCK_UPDATE))],
    ip: ClientIp,
) -> TruckRead:
    return TruckRead.model_validate(
        await truck_service.update(db, truck_id, payload, actor=actor, ip=ip)
    )


@trucks_router.post(
    "/{truck_id}/retire", response_model=TruckRead, summary="Retire a truck"
)
async def retire_truck(
    truck_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.TRUCK_RETIRE))],
    ip: ClientIp,
    reason: Annotated[str | None, Query(max_length=200)] = None,
) -> TruckRead:
    return TruckRead.model_validate(
        await truck_service.retire(db, truck_id, actor=actor, reason=reason, ip=ip)
    )


# --- Assignments ----------------------------------------------------------

assignments_router = APIRouter(prefix="/api/assignments", tags=["assignments"])


@assignments_router.get(
    "", response_model=list[AssignmentRead], summary="List assignments"
)
async def list_assignments(
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.ASSIGNMENT_READ))],
    driver_id: uuid.UUID | None = None,
    truck_id: uuid.UUID | None = None,
    active_only: bool = False,
    limit: Limit = None,
) -> list[AssignmentRead]:
    rows = await assignment_service.list_assignments(
        db,
        actor=actor,
        driver_id=driver_id,
        truck_id=truck_id,
        active_only=active_only,
        limit=limit,
    )
    return [AssignmentRead.model_validate(r) for r in rows]


@assignments_router.post(
    "", response_model=AssignmentRead, status_code=status.HTTP_201_CREATED,
    summary="Assign a driver to a truck",
)
async def create_assignment(
    payload: AssignmentCreate,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.ASSIGNMENT_CREATE))],
    ip: ClientIp,
) -> AssignmentRead:
    assignment = await assignment_service.create(
        db, driver_id=payload.driver_id, truck_id=payload.truck_id, actor=actor, ip=ip
    )
    return AssignmentRead.model_validate(assignment)


@assignments_router.get(
    "/{assignment_id}", response_model=AssignmentRead, summary="Get an assignment"
)
async def get_assignment(
    assignment_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.ASSIGNMENT_READ))],
) -> AssignmentRead:
    return AssignmentRead.model_validate(
        await assignment_service.get(db, assignment_id, actor=actor)
    )


@assignments_router.post(
    "/{assignment_id}/verify",
    response_model=AssignmentRead,
    summary="Driver verifies the physical truck",
)
async def verify_assignment(
    assignment_id: uuid.UUID,
    payload: AssignmentVerify,
    db: DbSession,
    driver: CurrentDriver,
    actor: Annotated[User, Depends(require_permission(perm.ASSIGNMENT_VERIFY_OWN))],
    ip: ClientIp,
) -> AssignmentRead:
    """Id-addressed alias of `POST /api/driver/me/assignment/verify`.

    Delegates to the same service function rather than reimplementing it. There
    were briefly two implementations of this operation and they had already
    drifted: this one accepted a repeat submission as a flat 409 with no
    idempotent retry, and did not check that the truck was still operational.
    Two code paths for one state transition is how a security guard comes to
    exist on only one of them.

    The path id can only NARROW the request. The assignment is resolved from the
    authenticated driver, so another driver's id yields 404 (they have no
    assignment of their own) or 409 (theirs is a different one) - never a write
    to somebody else's row.
    """
    assignment, _truck, _already = await driver_self.verify_current_assignment(
        db, driver, actor, payload, assignment_id=assignment_id, ip=ip
    )
    return AssignmentRead.model_validate(assignment)


@assignments_router.post(
    "/{assignment_id}/end", response_model=AssignmentRead, summary="End an assignment"
)
async def end_assignment(
    assignment_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.ASSIGNMENT_END))],
    ip: ClientIp,
    reason: Annotated[str | None, Query(max_length=200)] = None,
) -> AssignmentRead:
    return AssignmentRead.model_validate(
        await assignment_service.end(db, assignment_id, actor=actor, reason=reason, ip=ip)
    )
