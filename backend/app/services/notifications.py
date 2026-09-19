"""Who needs to know, and the durable row that tells them.

WHO GETS TOLD

Not "the manager". A trip from Kamrup to West Garo Hills concerns four
people: the district manager either end, and the state manager either end when
it crosses a border. Working that out from the trip's geography - rather than
from who owns the truck - is the whole point of the district model, so it is
computed in one function and every caller uses it.

Unscoped roles are NOT recipients. ADMIN and the pre-existing MANAGER can see
every trip already; putting every dispatch in their inbox would make the inbox
worthless within a day. They read the trip list, which is what it is for.

DEDUPE IS A CONSTRAINT, NOT A CHECK

`dedupe_key` is unique per recipient, and a duplicate insert is swallowed. A
route re-assessed five times in a minute is one notification. Doing this with
a SELECT-then-INSERT would lose the race that actually happens - two workers
reacting to the same event - so the database decides.

NOTHING HERE SENDS ANYTHING

A row is the notification. Push and realtime are ways of drawing attention to
one, they are handled elsewhere (`services/notify.py`), and both may fail
without anything being lost. That separation is why a manager who was asleep
still finds the dispatch waiting.
"""

from __future__ import annotations

import logging
import uuid
from typing import Final

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import NotificationKind, NotificationSeverity, UserRole
from app.models.identity import User
from app.models.notifications import Notification
from app.models.operations import Shipment, Trip

log = logging.getLogger(__name__)

#: Which kinds interrupt a person rather than waiting to be read.
SEVERITY: Final[dict[NotificationKind, NotificationSeverity]] = {
    NotificationKind.DRIVER_EMERGENCY_STOP: NotificationSeverity.URGENT,
    NotificationKind.TRIP_DELAYED: NotificationSeverity.WARNING,
    NotificationKind.ROUTE_CHANGED: NotificationSeverity.WARNING,
}


async def recipients_for_trip(db: AsyncSession, trip: Trip) -> list[User]:
    """Every scoped manager with a claim on this trip, deduplicated.

    Returns users, not ids, because callers need the role to decide what to
    put in the payload - a destination district manager is told about an
    INCOMING truck, the origin's manager about one that left.
    """
    shipment = (
        await db.execute(select(Shipment).where(Shipment.id == trip.shipment_id))
    ).scalar_one_or_none()
    if shipment is None:
        return []

    districts = [
        d
        for d in (shipment.origin_district_id, shipment.destination_district_id)
        if d is not None
    ]
    # The same geography scope reads (migration 0014 keeps a district's state
    # on the row), so the people told are exactly the people who can look.
    states = {
        s
        for s in (shipment.origin_state_id, shipment.destination_state_id)
        if s is not None
    }
    if not districts and not states:
        # Nowhere this job touches is known, so nobody new is told.
        return []

    rows = (
        (
            await db.execute(
                select(User).where(
                    User.is_active,
                    (
                        (
                            (User.role == UserRole.DISTRICT_MANAGER)
                            & User.district_id.in_(districts)
                        )
                        | (
                            (User.role == UserRole.STATE_MANAGER)
                            & User.state_id.in_(states)
                        )
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    # One person can hold only one of these roles, so uniqueness by id is
    # enough - but a trip whose two districts are in the same state would
    # otherwise return that state manager twice.
    return list({u.id: u for u in rows}.values())


async def regional_managers(db: AsyncSession) -> list[User]:
    """The active North-East managers: the authority over every state.

    An emergency whose trip has no known geography has no scoped manager, and
    must still reach someone.
    """
    return list(
        (
            await db.execute(
                select(User).where(
                    User.is_active, User.role == UserRole.NORTH_EAST_MANAGER
                )
            )
        )
        .scalars()
        .all()
    )


async def notify(
    db: AsyncSession,
    *,
    recipients: list[User],
    kind: NotificationKind,
    dedupe_key: str,
    trip_id: uuid.UUID | None = None,
    payload: dict | None = None,
    severity: NotificationSeverity | None = None,
) -> int:
    """Write one notification per recipient. Returns how many were new.

    Flushes but does not commit: a notification belongs to the transaction
    that caused it. A dispatch that rolls back must not leave four managers
    believing a truck left.
    """
    if not recipients:
        return 0
    stmt = (
        pg_insert(Notification)
        .values(
            [
                {
                    "recipient_user_id": u.id,
                    "trip_id": trip_id,
                    "kind": kind,
                    "severity": severity or SEVERITY.get(kind, NotificationSeverity.INFO),
                    "payload": payload or {},
                    "dedupe_key": dedupe_key,
                }
                for u in recipients
            ]
        )
        # The dedupe window is the constraint itself. DO NOTHING rather than
        # DO UPDATE: re-raising an old notification to the top of someone's
        # inbox because a provider refreshed is noise, not news.
        .on_conflict_do_nothing(constraint="uq_notifications_recipient_dedupe")
        .returning(Notification.id)
    )
    written = len((await db.execute(stmt)).scalars().all())
    await db.flush()
    return written


async def inbox(
    db: AsyncSession,
    user: User,
    *,
    unread_only: bool = False,
    limit: int = 50,
) -> list[Notification]:
    """One person's notifications, newest first.

    Addressed rows only. There is no scope filter here and there must not be
    one: a notification is already addressed to a user, and re-deriving who
    may read it would be a second answer to a question that was settled when
    the row was written.
    """
    stmt = select(Notification).where(Notification.recipient_user_id == user.id)
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))
    stmt = stmt.order_by(Notification.created_at.desc()).limit(min(limit, 200))
    return list((await db.execute(stmt)).scalars().all())


async def mark_read(db: AsyncSession, user: User, ids: list[uuid.UUID]) -> int:
    """Mark the caller's own notifications read. Someone else's are ignored.

    Filtered by recipient rather than checked and refused: an id that is not
    yours simply is not found, which leaks nothing about whether it exists.
    """
    from datetime import UTC, datetime

    from sqlalchemy import update

    if not ids:
        return 0
    result = await db.execute(
        update(Notification)
        .where(
            Notification.id.in_(ids),
            Notification.recipient_user_id == user.id,
            Notification.is_read.is_(False),
        )
        .values(is_read=True, read_at=datetime.now(UTC))
    )
    await db.flush()
    return result.rowcount or 0
