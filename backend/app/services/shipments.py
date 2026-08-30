"""Shipment service: what the customer asked to be moved.

Commercial intent only. The operational execution - which truck, which driver,
which stops along the way - is a Trip, and lives in app/services/trips.py.

`total_weight_kg` is never accepted from a client and never written here. A
database trigger (migration 0002, trg_cargo_items_recalc_weight) derives it from
cargo_items. That matters because it is the number the capacity check is made
against: if a client could declare a weight, it could declare one that disagrees
with the cargo and walk a truck past its safety limit.
"""

import uuid

from geoalchemy2 import WKTElement
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError
from app.models.enums import AuditAction
from app.models.identity import User
from app.models.operations import CargoItem, Shipment
from app.schemas.common import Coordinate
from app.schemas.domain import ShipmentCreate
from app.services import audit
from app.services.pagination import (
    build_page,
    clamp_limit,
    cursor_predicate,
    decode_cursor,
)

AUDITED_FIELDS = (
    "id", "reference_code", "client_name", "status", "priority",
    "total_weight_kg",
)

SRID = 4326


def point(coordinate: Coordinate) -> WKTElement:
    """A coordinate as PostGIS geography.

    Note the POINT(lon lat) ordering: WKT is x-then-y, which is the opposite of
    how everyone says "lat, long" out loud. The Coordinate schema has already
    bounded both values - PostGIS would silently wrap an out-of-range latitude
    over the pole rather than reject it, so this conversion is not a validation
    boundary and must never be handed unvalidated numbers.
    """
    return WKTElement(coordinate.to_wkt(), srid=SRID)


async def get(db: AsyncSession, shipment_id: uuid.UUID) -> Shipment:
    shipment = (
        await db.execute(select(Shipment).where(Shipment.id == shipment_id))
    ).scalar_one_or_none()
    if shipment is None:
        raise NotFoundError("Shipment not found.")
    return shipment


async def list_shipments(
    db: AsyncSession, *, limit: int | None = None, cursor: str | None = None
) -> tuple[list[Shipment], str | None]:
    page_size = clamp_limit(limit)
    stmt = select(Shipment)
    if cursor:
        stmt = stmt.where(
            cursor_predicate(Shipment.created_at, Shipment.id, decode_cursor(cursor))
        )
    stmt = stmt.order_by(Shipment.created_at.desc(), Shipment.id.desc()).limit(
        page_size + 1
    )
    rows = list((await db.execute(stmt)).scalars().all())
    return build_page(rows, page_size)


async def create(
    db: AsyncSession,
    payload: ShipmentCreate,
    *,
    actor: User,
    ip: str | None = None,
    commit: bool = True,
) -> Shipment:
    """Create a shipment and its cargo in one transaction.

    `commit=False` leaves the transaction open so a caller can make this and
    something else succeed or fail together - `trips.plan()` creates a shipment
    and its trip that way. The shipment is still flushed and refreshed, so
    `total_weight_kg` is populated by the trigger and the row is visible to
    later statements in the same transaction; it is simply not durable yet.
    Nothing about the validation, the audit record or the ordering changes.
    """
    clash = (
        await db.execute(
            select(Shipment.id).where(
                Shipment.reference_code == payload.reference_code
            )
        )
    ).first()
    if clash:
        raise ConflictError(
            "A shipment with that reference code already exists.",
            code="SHIPMENT_EXISTS",
        )

    shipment = Shipment(
        reference_code=payload.reference_code,
        client_name=payload.client_name,
        client_contact=payload.client_contact,
        pickup_address=payload.pickup_address,
        pickup_location=point(payload.pickup),
        destination_address=payload.destination_address,
        destination_location=point(payload.destination),
        priority=payload.priority,
        scheduled_pickup_at=payload.scheduled_pickup_at,
        expected_delivery_at=payload.expected_delivery_at,
        created_by=actor.id,
    )
    db.add(shipment)
    await db.flush()

    for item in payload.cargo_items:
        db.add(
            CargoItem(
                shipment_id=shipment.id,
                cargo_type=item.cargo_type,
                cargo_name=item.cargo_name,
                weight_kg=item.weight_kg,
                quantity=item.quantity,
                is_hazardous=item.is_hazardous,
                is_perishable=item.is_perishable,
                handling_notes=item.handling_notes,
            )
        )

    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError(
            "That shipment conflicts with existing data.", code="SHIPMENT_CONFLICT"
        ) from exc

    # The weight trigger fired during the flush above; without this the object
    # still holds the 0 default and the capacity check downstream would compare
    # against nothing.
    await db.refresh(shipment)

    await audit.record(
        db,
        action=AuditAction.CREATE,
        entity_type="shipments",
        entity_id=shipment.id,
        actor_user_id=actor.id,
        after=audit.snapshot(shipment, AUDITED_FIELDS),
        reason=f"shipment {payload.reference_code} for {payload.client_name}",
        ip_address=ip,
    )
    if commit:
        await db.commit()
        await db.refresh(shipment)
    return shipment
