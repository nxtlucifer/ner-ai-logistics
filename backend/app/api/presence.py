"""Who is there: one write, one read.

    POST /api/presence/heartbeat   "I am still here"
    GET  /api/presence             who is there, within the caller's scope

WHY THE WRITE IS COALESCED

A client beating every 60 s across a fleet of two hundred is 200 writes a
minute to one table, every minute, forever - for a fact whose resolution is
90 seconds. The update is skipped when the stored timestamp is already
recent enough to give the same answer, so the common beat costs one indexed
read and no write at all.

WHAT THE READ REFUSES TO INVENT

Presence comes from a heartbeat this server received. Location freshness is
a separate field from a separate source. A driver in a gorge is ONLINE with
no position, and the two are never collapsed into one dot.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from sqlalchemy import and_, func, or_, select, update

from app.api.deps import CurrentUser, DbSession, require_permission
from app.core import permissions as perm
from app.core import scope
from app.domain import presence as domain
from app.models.enums import UserRole
from app.models.identity import Driver, User
from app.models.operations import GpsPoint, Trip
from app.schemas.common import ReadModel

router = APIRouter(prefix="/api/presence", tags=["presence"])

#: Do not write if the stored value is this recent: the answer would not
#: change. Half the ONLINE window, so a skipped write can never make a
#: present user look absent.
COALESCE_WITHIN = timedelta(seconds=45)


class Heartbeat(ReadModel):
    #: Echoed back so a client can see the server's clock rather than trust
    #: its own, which on a phone that has been in a tunnel is not reliable.
    server_time: datetime
    #: True when the write was skipped because the stored value was already
    #: recent enough. Useful in tests; harmless to a client.
    coalesced: bool


class PersonPresence(ReadModel):
    user_id: uuid.UUID
    display_name: str
    role: UserRole
    state_id: uuid.UUID | None
    district_id: uuid.UUID | None
    presence: Literal["ONLINE", "IDLE", "OFFLINE"]
    location: Literal["FRESH", "AGEING", "STALE", "UNAVAILABLE"]
    seen_seconds_ago: int | None
    gps_seconds_ago: int | None
    driver_id: uuid.UUID | None = None


@router.post("/heartbeat", response_model=Heartbeat, summary="I am still here")
async def heartbeat(db: DbSession, user: CurrentUser) -> Heartbeat:
    """Any authenticated principal, driver or manager.

    Deliberately not permission-gated: being present is not a privilege, and
    a role that could not say so would be invisible on every dashboard that
    is allowed to see it.
    """
    now = datetime.now(UTC)
    last = user.last_seen_at
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=UTC)
    if last is not None and now - last < COALESCE_WITHIN:
        return Heartbeat(server_time=now, coalesced=True)

    await db.execute(update(User).where(User.id == user.id).values(last_seen_at=now))
    await db.commit()
    return Heartbeat(server_time=now, coalesced=False)


@router.get("", response_model=list[PersonPresence], summary="Who is there")
async def who_is_there(
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.FLEET_LOCATION_READ))],
) -> list[PersonPresence]:
    """Everyone the caller's scope covers, with how we know.

    Scoped by the SAME rule as everything else: a district manager sees the
    managers of their district and the drivers of trips in it, a state manager
    their state's, the regional and fleet-wide roles everyone. A driver never
    reaches this route at all -
    `fleet:location_read` is not in their permission set, which is where
    that decision has always lived.
    """
    stmt = select(User).where(User.is_active)

    if actor.role in scope.SCOPED_ROLES:
        scope.require_scope(actor)
        # Managers by their own geography. Drivers have none, so they are the
        # drivers of trips this caller may see - the dashboard's rule, so the
        # "of N drivers" figure and this list never contradict each other.
        home = (
            User.state_id == actor.state_id
            if actor.role is UserRole.STATE_MANAGER
            else User.district_id == actor.district_id
        )
        drivers = select(Driver.user_id).where(
            Driver.id.in_(scope.scoped_driver_ids(actor))
        )
        stmt = stmt.where(
            or_(and_(User.role != UserRole.DRIVER, home), User.id.in_(drivers))
        )
    elif actor.role not in scope.UNSCOPED_ROLES:
        return []

    people = list((await db.execute(stmt)).scalars().all())

    # Drivers carry a position; managers do not.
    driver_rows = {
        d.user_id: d
        for d in (
            await db.execute(
                select(Driver).where(Driver.user_id.in_([u.id for u in people] or [None]))
            )
        )
        .scalars()
        .all()
    }

    # The newest fix per driver, in ONE query rather than one per person -
    # a regional dashboard asks this for every driver in eight states.
    # `received_at`, not the device clock: a phone with a wrong clock must
    # not be able to make a stale position look fresh.
    last_fix: dict[uuid.UUID, datetime] = {}
    if driver_rows:
        newest = (
            select(Trip.driver_id, func.max(GpsPoint.received_at))
            .join(Trip, Trip.id == GpsPoint.trip_id)
            .where(Trip.driver_id.in_([d.id for d in driver_rows.values()]))
            .group_by(Trip.driver_id)
        )
        last_fix = {row[0]: row[1] for row in (await db.execute(newest)).all()}

    out: list[PersonPresence] = []
    for u in people:
        driver = driver_rows.get(u.id)
        status = domain.assess(
            last_seen_at=u.last_seen_at,
            last_gps_at=last_fix.get(driver.id) if driver else None,
        )
        out.append(
            PersonPresence(
                user_id=u.id,
                # A driver is known everywhere else by the driver record's name.
                display_name=driver.full_name if driver else u.display_name,
                role=u.role,
                state_id=u.state_id,
                district_id=u.district_id,
                presence=status.presence.value,
                location=status.location.value,
                seen_seconds_ago=status.seen_seconds_ago,
                gps_seconds_ago=status.gps_seconds_ago,
                driver_id=driver.id if driver else None,
            )
        )
    # Present people first, then the most recently seen. A dispatcher scans
    # the top of this list and needs the people who can answer.
    order = {"ONLINE": 0, "IDLE": 1, "OFFLINE": 2}
    out.sort(key=lambda p: (order[p.presence], p.seen_seconds_ago or 10**9))
    return out
