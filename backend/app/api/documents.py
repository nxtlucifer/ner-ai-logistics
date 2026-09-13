"""Driver identity, documents and truck insurance - the smallest safe version.

    GET  /api/driver/me/profile           name, phone, photo, emergency contact,
                                          assigned truck, document + insurance summary
    GET  /api/driver/me/documents         own documents, numbers MASKED
    POST /api/driver/me/documents         type, number, dates, file id
    GET  /api/driver/me/truck-documents   the assigned truck's papers (insurance)
    POST /api/driver/me/truck-documents   add one (insurance) for the assigned truck
    GET  /api/drivers/{id}/documents      manager: status + metadata, masked
    POST /api/assignments/{id}/verify-manual  manager verifies a truck by hand
                                          for a driver with no smartphone

WHAT IS NOT CLAIMED. `status` is derived from `expires_on` only (VALID /
EXPIRING_SOON / EXPIRED, MISSING without a file). Nothing here verifies a
document with any government or insurer; there is no such integration and
no field pretends there is.

MASKING. A document or policy number leaves this API as its last four
characters; the full value is stored and never logged.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import Field
from sqlalchemy import select

from app.api.deps import CurrentDriver, CurrentUser, DbSession, get_client_ip, require_permission
from app.core import permissions as perm
from app.core.errors import BusinessRuleError, ConflictError, NotFoundError
from app.models.enums import (
    AssignmentStatus,
    AuditAction,
    DocumentStatus,
    DriverDocumentType,
    TruckDocumentType,
)
from app.models.files import StoredFile
from app.models.fleet import DriverTruckAssignment, Truck, TruckDocument
from app.models.identity import Driver, DriverDocument, User
from app.schemas.common import APIModel, ReadModel
from app.schemas.domain import AssignmentRead
from app.services import audit
from app.services.driver_self import normalise_registration

router = APIRouter(tags=["documents"])

EXPIRING_WITHIN_DAYS = 30
#: Never a chance to type an Aadhaar-style flow: the app offers these three.
DRIVER_TYPES = (DriverDocumentType.DRIVING_LICENCE, DriverDocumentType.GOVERNMENT_ID, DriverDocumentType.OTHER)


def status_for(expires_on: date | None, has_file: bool) -> DocumentStatus:
    if not has_file:
        return DocumentStatus.MISSING
    if expires_on is None:
        return DocumentStatus.VALID
    today = date.today()
    if expires_on < today:
        return DocumentStatus.EXPIRED
    if expires_on <= today + timedelta(days=EXPIRING_WITHIN_DAYS):
        return DocumentStatus.EXPIRING_SOON
    return DocumentStatus.VALID


def masked(number: str | None) -> str | None:
    if not number:
        return None
    tail = number[-4:]
    return f"•••• {tail}" if len(number) > 4 else "••••"


class DocumentRead(ReadModel):
    id: uuid.UUID
    doc_type: str
    number_masked: str | None
    issued_on: date | None
    expires_on: date | None
    status: DocumentStatus
    file_url: str | None
    created_at: datetime


class DocumentCreate(APIModel):
    doc_type: DriverDocumentType
    doc_number: Annotated[str, Field(min_length=3, max_length=64)] | None = None
    issued_on: date | None = None
    expires_on: date | None = None
    #: From POST /api/files (kind=DRIVER_DOCUMENT). Optional: metadata first, file later.
    file_id: uuid.UUID | None = None


class TruckDocumentCreate(APIModel):
    doc_type: TruckDocumentType = TruckDocumentType.INSURANCE
    doc_number: Annotated[str, Field(min_length=3, max_length=64)] | None = None
    issued_on: date | None = None
    expires_on: date | None = None
    file_id: uuid.UUID | None = None


class ProfileRead(ReadModel):
    id: uuid.UUID
    full_name: str
    phone: str
    photo_url: str | None
    emergency_contact_name: str | None
    emergency_contact_phone: str | None
    licence_expiry: date
    truck_registration: str | None
    truck_photo_url: str | None
    truck_verified: bool
    documents: list[DocumentRead]
    insurance: list[DocumentRead]


def _read(row: DriverDocument | TruckDocument) -> DocumentRead:
    return DocumentRead(
        id=row.id, doc_type=row.doc_type.value, number_masked=masked(row.doc_number),
        issued_on=row.issued_on, expires_on=row.expires_on,
        status=status_for(row.expires_on, bool(row.file_url)), file_url=row.file_url,
        created_at=row.created_at,
    )


async def _own_file(db, driver: Driver, file_id: uuid.UUID | None, kind: str) -> str | None:
    if file_id is None:
        return None
    row = (await db.execute(select(StoredFile).where(StoredFile.id == file_id))).scalar_one_or_none()
    if row is None or row.owner_driver_id != driver.id or row.kind != kind:
        raise NotFoundError("Uploaded file not found.")
    return f"/api/files/{row.id}"


def _dates_ok(issued_on: date | None, expires_on: date | None) -> None:
    if issued_on and expires_on and expires_on < issued_on:
        raise BusinessRuleError("Expiry date is before the issue date.", code="DOCUMENT_DATES_INVALID")
    if issued_on and issued_on > date.today():
        raise BusinessRuleError("Issue date is in the future.", code="DOCUMENT_DATES_INVALID")


async def _current_assignment(db, driver: Driver) -> tuple[DriverTruckAssignment, Truck] | None:
    row = (
        await db.execute(
            select(DriverTruckAssignment, Truck)
            .join(Truck, Truck.id == DriverTruckAssignment.truck_id)
            .where(DriverTruckAssignment.driver_id == driver.id, DriverTruckAssignment.status != AssignmentStatus.ENDED)
            .order_by(DriverTruckAssignment.assigned_at.desc())
        )
    ).first()
    return (row[0], row[1]) if row else None


async def _truck_docs(db, truck_id: uuid.UUID) -> list[DocumentRead]:
    rows = (await db.execute(select(TruckDocument).where(TruckDocument.truck_id == truck_id).order_by(TruckDocument.created_at.desc()))).scalars().all()
    return [_read(r) for r in rows]


@router.get("/api/driver/me/profile", response_model=ProfileRead, summary="My details")
async def my_profile(driver: CurrentDriver, db: DbSession) -> ProfileRead:
    docs = (await db.execute(select(DriverDocument).where(DriverDocument.driver_id == driver.id).order_by(DriverDocument.created_at.desc()))).scalars().all()
    current = await _current_assignment(db, driver)
    return ProfileRead(
        id=driver.id, full_name=driver.full_name, phone=driver.phone, photo_url=driver.photo_url,
        emergency_contact_name=driver.emergency_contact_name, emergency_contact_phone=driver.emergency_contact_phone,
        licence_expiry=driver.licence_expiry,
        truck_registration=current[1].registration_number if current else None,
        truck_photo_url=current[1].photo_url if current else None,
        truck_verified=bool(current and current[0].verified_at),
        documents=[_read(d) for d in docs],
        insurance=[d for d in (await _truck_docs(db, current[1].id) if current else []) if d.doc_type == TruckDocumentType.INSURANCE.value],
    )


@router.get("/api/driver/me/documents", response_model=list[DocumentRead], summary="My documents, masked")
async def my_documents(driver: CurrentDriver, db: DbSession) -> list[DocumentRead]:
    rows = (await db.execute(select(DriverDocument).where(DriverDocument.driver_id == driver.id).order_by(DriverDocument.created_at.desc()))).scalars().all()
    return [_read(r) for r in rows]


@router.post("/api/driver/me/documents", response_model=DocumentRead, status_code=201, summary="Add one of my documents")
async def add_document(payload: DocumentCreate, driver: CurrentDriver, db: DbSession) -> DocumentRead:
    if payload.doc_type not in DRIVER_TYPES:
        raise BusinessRuleError("Choose Driving Licence, Government ID or Other.", code="DOCUMENT_TYPE_NOT_OFFERED")
    _dates_ok(payload.issued_on, payload.expires_on)
    file_url = await _own_file(db, driver, payload.file_id, "DRIVER_DOCUMENT")
    row = DriverDocument(
        driver_id=driver.id, doc_type=payload.doc_type, doc_number=payload.doc_number,
        file_url=file_url, issued_on=payload.issued_on, expires_on=payload.expires_on,
        status=status_for(payload.expires_on, bool(file_url)),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _read(row)


@router.get("/api/driver/me/truck-documents", response_model=list[DocumentRead], summary="My assigned truck's papers")
async def my_truck_documents(driver: CurrentDriver, db: DbSession) -> list[DocumentRead]:
    current = await _current_assignment(db, driver)
    return await _truck_docs(db, current[1].id) if current else []


@router.post("/api/driver/me/truck-documents", response_model=DocumentRead, status_code=201, summary="Add insurance for my assigned truck")
async def add_truck_document(payload: TruckDocumentCreate, driver: CurrentDriver, db: DbSession) -> DocumentRead:
    current = await _current_assignment(db, driver)
    if current is None:
        raise NotFoundError("You have no assigned truck.")
    _dates_ok(payload.issued_on, payload.expires_on)
    file_url = await _own_file(db, driver, payload.file_id, "TRUCK_DOCUMENT")
    row = TruckDocument(
        truck_id=current[1].id, doc_type=payload.doc_type, doc_number=payload.doc_number,
        file_url=file_url, issued_on=payload.issued_on, expires_on=payload.expires_on,
        status=status_for(payload.expires_on, bool(file_url)),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _read(row)


@router.get("/api/drivers/{driver_id}/documents", response_model=list[DocumentRead], summary="A driver's document status (masked)")
async def driver_documents(
    driver_id: uuid.UUID, db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.DRIVER_READ))],
) -> list[DocumentRead]:
    # Masked metadata only: DRIVER_READ is enough. The number itself never
    # leaves the database through this API for any role.
    rows = (await db.execute(select(DriverDocument).where(DriverDocument.driver_id == driver_id).order_by(DriverDocument.created_at.desc()))).scalars().all()
    return [_read(r) for r in rows]


class ManualVerify(APIModel):
    reported_registration: Annotated[str, Field(min_length=4, max_length=20)]
    note: Annotated[str, Field(max_length=200)] | None = None


@router.post("/api/assignments/{assignment_id}/verify-manual", response_model=AssignmentRead, summary="Manager verifies a truck by hand (driver without a smartphone)")
async def verify_manual(
    assignment_id: uuid.UUID, payload: ManualVerify, db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.ASSIGNMENT_REVIEW))],
    ip: Annotated[str | None, Depends(get_client_ip)],
) -> AssignmentRead:
    row = (
        await db.execute(
            select(DriverTruckAssignment, Truck).join(Truck, Truck.id == DriverTruckAssignment.truck_id)
            .where(DriverTruckAssignment.id == assignment_id)
        )
    ).first()
    if row is None:
        raise NotFoundError("Assignment not found.")
    assignment, truck = row
    if assignment.status == AssignmentStatus.ENDED:
        raise ConflictError("This assignment has ended.", code="ASSIGNMENT_ENDED")
    reported = normalise_registration(payload.reported_registration)
    if reported != truck.registration_number:
        raise BusinessRuleError(
            "The plate you entered does not match the assigned truck. Check the truck and try again.",
            code="REGISTRATION_MISMATCH",
        )
    before = audit.snapshot(assignment, ("status", "verified_at", "verification_source"))
    assignment.reported_registration = reported
    assignment.verified_at = datetime.now(UTC)
    assignment.mismatch_flagged = False
    assignment.status = AssignmentStatus.ACTIVE
    assignment.verification_source = "MANAGER_MANUAL"
    await audit.record(
        db, action=AuditAction.STATUS_CHANGE, entity_type="driver_truck_assignments", entity_id=assignment.id,
        actor_user_id=actor.id, before=before, after=audit.snapshot(assignment, ("status", "verified_at", "verification_source")),
        reason=f"manager verified truck by hand (no smartphone){': ' + payload.note if payload.note else ''}", ip_address=ip,
    )
    await db.commit()
    await db.refresh(assignment)
    return AssignmentRead.model_validate(assignment)
