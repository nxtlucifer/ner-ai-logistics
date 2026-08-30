"""Truck service."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BusinessRuleError, ConflictError, NotFoundError
from app.models.enums import AuditAction, TruckStatus
from app.models.fleet import Truck
from app.models.identity import User
from app.schemas.domain import TruckCreate, TruckUpdate
from app.services import audit
from app.services.pagination import (
    build_page,
    clamp_limit,
    cursor_predicate,
    decode_cursor,
)

AUDITED_FIELDS = (
    "id", "registration_number", "truck_type", "make", "model",
    "max_capacity_kg", "current_load_kg", "status", "baseline_mileage_kmpl",
    "odometer_km",
)


async def get(db: AsyncSession, truck_id: uuid.UUID) -> Truck:
    truck = (
        await db.execute(
            select(Truck).where(Truck.id == truck_id, Truck.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if truck is None:
        raise NotFoundError("Truck not found.")
    return truck


async def list_trucks(
    db: AsyncSession,
    *,
    limit: int | None = None,
    cursor: str | None = None,
    status: TruckStatus | None = None,
    search: str | None = None,
) -> tuple[list[Truck], str | None]:
    page_size = clamp_limit(limit)
    stmt = select(Truck).where(Truck.deleted_at.is_(None))

    if status is not None:
        stmt = stmt.where(Truck.status == status)
    if search:
        stmt = stmt.where(Truck.registration_number.ilike(f"%{search.strip()}%"))
    if cursor:
        stmt = stmt.where(
            cursor_predicate(Truck.created_at, Truck.id, decode_cursor(cursor))
        )

    stmt = stmt.order_by(Truck.created_at.desc(), Truck.id.desc()).limit(page_size + 1)
    rows = list((await db.execute(stmt)).scalars().all())
    return build_page(rows, page_size)


async def create(
    db: AsyncSession, payload: TruckCreate, *, actor: User, ip: str | None = None
) -> Truck:
    # The schema already normalised the registration to uppercase without
    # separators, so this comparison is against the canonical form.
    existing = (
        await db.execute(
            select(Truck.id).where(
                Truck.registration_number == payload.registration_number,
                Truck.deleted_at.is_(None),
            )
        )
    ).first()
    if existing:
        raise ConflictError(
            "A truck with that registration number already exists.",
            code="REGISTRATION_EXISTS",
        )

    truck = Truck(**payload.model_dump(), status=TruckStatus.AVAILABLE)
    db.add(truck)

    try:
        await db.flush()
    except IntegrityError as exc:
        # Lost the race against the partial unique index. The database is the
        # concurrency-safe authority; the pre-check above is only for a nicer
        # message in the common case.
        await db.rollback()
        raise ConflictError(
            "A truck with that registration number already exists.",
            code="REGISTRATION_EXISTS",
        ) from exc

    await audit.record(
        db,
        action=AuditAction.CREATE,
        entity_type="trucks",
        entity_id=truck.id,
        actor_user_id=actor.id,
        after=audit.snapshot(truck, AUDITED_FIELDS),
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(truck)
    return truck


async def update(
    db: AsyncSession,
    truck_id: uuid.UUID,
    payload: TruckUpdate,
    *,
    actor: User,
    ip: str | None = None,
) -> Truck:
    truck = await get(db, truck_id)
    before = audit.snapshot(truck, AUDITED_FIELDS)

    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return truck

    # Lowering capacity below what the truck is already carrying would leave the
    # row violating ck_trucks_load_within_capacity. 422, because no role may
    # authorise an overloaded truck - this is a safety limit, not a permission.
    new_capacity = changes.get("max_capacity_kg")
    if new_capacity is not None and new_capacity < truck.current_load_kg:
        raise BusinessRuleError(
            "Capacity cannot be set below the truck's current load.",
            code="CAPACITY_BELOW_CURRENT_LOAD",
            details={
                "current_load_kg": str(truck.current_load_kg),
                "requested_capacity_kg": str(new_capacity),
            },
        )

    if truck.status is TruckStatus.ON_TRIP and changes.get("status") not in (
        None,
        TruckStatus.ON_TRIP,
    ):
        raise ConflictError(
            "Truck is on a trip; its status cannot be changed.",
            code="TRUCK_ON_TRIP",
        )

    for field, value in changes.items():
        setattr(truck, field, value)

    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError("Update conflicts with an existing truck.") from exc

    await audit.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="trucks",
        entity_id=truck.id,
        actor_user_id=actor.id,
        before=before,
        after=audit.snapshot(truck, AUDITED_FIELDS),
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(truck)
    return truck


async def retire(
    db: AsyncSession,
    truck_id: uuid.UUID,
    *,
    actor: User,
    reason: str | None = None,
    ip: str | None = None,
) -> Truck:
    """Retire a truck. Soft delete - trips and GPS history reference it."""
    truck = await get(db, truck_id)

    if truck.status is TruckStatus.ON_TRIP:
        raise ConflictError(
            "Truck is currently on a trip and cannot be retired.",
            code="TRUCK_ON_TRIP",
        )

    before = audit.snapshot(truck, AUDITED_FIELDS)
    truck.status = TruckStatus.RETIRED
    truck.deleted_at = datetime.now(UTC)

    await audit.record(
        db,
        action=AuditAction.DELETE,
        entity_type="trucks",
        entity_id=truck.id,
        actor_user_id=actor.id,
        before=before,
        after=audit.snapshot(truck, AUDITED_FIELDS),
        reason=reason,
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(truck)
    return truck
