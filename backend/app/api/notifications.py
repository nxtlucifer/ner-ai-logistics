"""A manager's inbox.

    GET  /api/notifications?unread_only=   newest first, this caller's only
    POST /api/notifications/read           mark some of them read

WHY THERE IS NO SCOPE FILTER HERE

A notification is already addressed. Re-deriving who may read it would be a
second answer to a question settled when the row was written, and the two
answers would eventually disagree. The only filter is `recipient_user_id`.

Marking someone else's notification read finds nothing rather than refusing:
a 403 would confirm the id exists.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import DbSession, require_permission
from app.core import permissions as perm
from app.models.enums import NotificationKind, NotificationSeverity
from app.models.identity import User
from app.schemas.common import APIModel, ReadModel
from app.services import notifications as service

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class NotificationRead(ReadModel):
    id: uuid.UUID
    trip_id: uuid.UUID | None
    kind: NotificationKind
    severity: NotificationSeverity
    #: Structured, so the client renders the sentence in the reader's own
    #: language. Never a pre-rendered English string.
    payload: dict
    is_read: bool
    created_at: datetime
    read_at: datetime | None


class MarkRead(APIModel):
    ids: list[uuid.UUID]


class MarkReadResult(ReadModel):
    marked: int


@router.get("", response_model=list[NotificationRead], summary="Your notifications")
async def list_notifications(
    db: DbSession,
    user: Annotated[User, Depends(require_permission(perm.NOTIFICATION_READ))],
    unread_only: bool = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[NotificationRead]:
    rows = await service.inbox(db, user, unread_only=unread_only, limit=limit)
    return [NotificationRead.model_validate(r) for r in rows]


@router.post("/read", response_model=MarkReadResult, summary="Mark yours read")
async def mark_read(
    body: MarkRead,
    db: DbSession,
    user: Annotated[User, Depends(require_permission(perm.NOTIFICATION_READ))],
) -> MarkReadResult:
    marked = await service.mark_read(db, user, body.ids[:200])
    await db.commit()
    return MarkReadResult(marked=marked)
