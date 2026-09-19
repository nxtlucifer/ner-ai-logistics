"""Private files: profile photos, truck verification photos, documents.

    POST /api/files?kind=...      raw bytes in the body (no multipart, no
                                  python-multipart) -> {id, url}
    GET  /api/files/{id}          the bytes, for the owner or a fleet reader

WHAT IS CHECKED AT THE TRUST BOUNDARY

- Type by MAGIC BYTES, not by header: JPEG (FF D8 FF), PNG (89 50 4E 47) or
  PDF (%PDF). Anything else is refused as 415, whatever it calls itself.
- Size: 5 MB, enforced by reading at most 5 MB + 1 and by the table's CHECK.
- Ownership: a driver reads only files whose `owner_driver_id` is theirs; a
  manager/reviewer/admin (`driver:read`) reads any. Everything else is 404 -
  not 403, so the id space is not an oracle.
- Nothing about the file's content is logged; the id and the size are.

Side effects by `kind` keep the client to ONE call per action:
  PROFILE_PHOTO       -> driver.photo_url = /api/files/{id}
  TRUCK_VERIFICATION  -> current assignment.verification_photo_url (driver)
  TRUCK_PHOTO         -> truck.photo_url for ?truck_id= (manager)
  DEMO_REFERENCE      -> like TRUCK_PHOTO / PROFILE_PHOTO but labelled demo
  DRIVER_DOCUMENT / TRUCK_DOCUMENT -> stored only; the document row links it
"""

from __future__ import annotations

import logging
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core import permissions as perm
from app.core.errors import APIError, NotFoundError, PermissionDeniedError
from app.core.permissions import has_permission
from app.models.enums import AssignmentStatus
from app.models.files import StoredFile
from app.models.fleet import DriverTruckAssignment, Truck
from app.models.identity import Driver
from app.schemas.common import ReadModel

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/files", tags=["files"])

MAX_BYTES = 5 * 1024 * 1024
#: An avatar is drawn at 56 pixels. Three seeded profile photos of 2.3-3.5 MB
#: took 15-18 seconds to arrive over the hosted tier, so the manager's driver
#: list showed initials instead of faces for a quarter of a minute. The driver
#: app already re-encodes captures at JPEG quality 0.5 and lands far under
#: this; the cap stops a full-resolution upload from any other client.
MAX_PROFILE_PHOTO_BYTES = 512 * 1024
Kind = Literal["PROFILE_PHOTO", "TRUCK_VERIFICATION", "TRUCK_PHOTO", "DEMO_REFERENCE", "DRIVER_DOCUMENT", "TRUCK_DOCUMENT"]
_MAGIC = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"%PDF", "application/pdf"),
)
#: Photos only. A PDF as a profile picture is not a picture.
_IMAGE_KINDS = {"PROFILE_PHOTO", "TRUCK_VERIFICATION", "TRUCK_PHOTO", "DEMO_REFERENCE"}


class FileRead(ReadModel):
    id: uuid.UUID
    url: str
    content_type: str
    size_bytes: int


def sniff(data: bytes) -> str | None:
    """The real type from the first bytes, or None for anything else."""
    return next((ctype for magic, ctype in _MAGIC if data.startswith(magic)), None)


async def _driver_of(db, user) -> Driver | None:
    return (await db.execute(select(Driver).where(Driver.user_id == user.id))).scalar_one_or_none()


@router.post("", response_model=FileRead, status_code=201, summary="Upload one private file (raw body)")
async def upload(
    request: Request,
    db: DbSession,
    user: CurrentUser,
    kind: Annotated[Kind, Query()],
    truck_id: Annotated[uuid.UUID | None, Query()] = None,
    driver_id: Annotated[uuid.UUID | None, Query()] = None,
) -> FileRead:
    data = await request.body()
    if len(data) > MAX_BYTES:
        raise APIError("File is larger than 5 MB.", code="FILE_TOO_LARGE", status_code=413)
    if kind == "PROFILE_PHOTO" and len(data) > MAX_PROFILE_PHOTO_BYTES:
        raise APIError(
            f"A profile photo must be under {MAX_PROFILE_PHOTO_BYTES // 1024} KB; "
            f"this one is {len(data) // 1024} KB. Take the photo in the driver app, "
            "or save a smaller copy.",
            code="PROFILE_PHOTO_TOO_LARGE",
            status_code=413,
        )
    ctype = sniff(data)
    if ctype is None or (kind in _IMAGE_KINDS and ctype == "application/pdf"):
        raise APIError("Only JPEG, PNG or PDF files are accepted.", code="UNSUPPORTED_FILE_TYPE", status_code=415)

    me = await _driver_of(db, user)
    manager = has_permission(user.role, perm.DRIVER_UPDATE)
    owner: Driver | None = me
    if kind in ("TRUCK_PHOTO", "DEMO_REFERENCE") and truck_id is not None:
        if not manager:
            raise PermissionDeniedError("Only a fleet manager can set a truck photo.")
        owner = None
    elif kind in ("PROFILE_PHOTO", "DEMO_REFERENCE") and driver_id is not None and manager:
        owner = (await db.execute(select(Driver).where(Driver.id == driver_id))).scalar_one_or_none()
        if owner is None:
            raise NotFoundError("Driver not found.")
    elif me is None:
        raise PermissionDeniedError("Only a driver can upload this kind of file.")

    row = StoredFile(
        owner_driver_id=owner.id if owner else None,
        uploaded_by_user_id=user.id,
        kind=kind, content_type=ctype, size_bytes=len(data), data=data,
    )
    db.add(row)
    await db.flush()
    url = f"/api/files/{row.id}"

    if kind in ("PROFILE_PHOTO", "DEMO_REFERENCE") and owner is not None and truck_id is None:
        owner.photo_url = url
    elif kind in ("TRUCK_PHOTO", "DEMO_REFERENCE") and truck_id is not None:
        truck = (await db.execute(select(Truck).where(Truck.id == truck_id))).scalar_one_or_none()
        if truck is None:
            raise NotFoundError("Truck not found.")
        truck.photo_url = url
    elif kind == "TRUCK_VERIFICATION":
        assignment = (
            await db.execute(
                select(DriverTruckAssignment)
                .where(DriverTruckAssignment.driver_id == me.id, DriverTruckAssignment.status != AssignmentStatus.ENDED)
                .order_by(DriverTruckAssignment.assigned_at.desc())
            )
        ).scalars().first()
        if assignment is None:
            raise NotFoundError("You have no assignment to attach a truck photo to.")
        assignment.verification_photo_url = url
    await db.commit()
    log.info("stored file %s kind=%s bytes=%s", row.id, kind, len(data))
    return FileRead(id=row.id, url=url, content_type=ctype, size_bytes=len(data))


@router.get("/{file_id}", summary="Read one private file")
async def read(file_id: uuid.UUID, db: DbSession, user: CurrentUser) -> Response:
    row = (await db.execute(select(StoredFile).where(StoredFile.id == file_id))).scalar_one_or_none()
    if row is None:
        raise NotFoundError("File not found.")
    if not has_permission(user.role, perm.DRIVER_READ_SENSITIVE) and not has_permission(user.role, perm.TRUCK_READ):
        raise NotFoundError("File not found.")
    if not has_permission(user.role, perm.DRIVER_UPDATE):
        # A driver: only their own files, and truck/demo photos of the fleet.
        me = await _driver_of(db, user)
        mine = me is not None and row.owner_driver_id == me.id
        if not mine and row.kind not in ("TRUCK_PHOTO", "DEMO_REFERENCE"):
            raise NotFoundError("File not found.")
    return Response(content=row.data, media_type=row.content_type, headers={"Cache-Control": "private, max-age=3600"})
