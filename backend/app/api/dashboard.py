"""One scoped overview per role, computed on the server.

    GET /api/dashboard

WHY THE SERVER SHAPES IT

The alternative - send the region and let the browser hide what the role
may not see - is not a dashboard, it is a data leak with a stylesheet. A
district manager's response contains their district's rows and nothing
else, so the numbers on their screen are the numbers the server was willing
to tell them.

WHAT THE ROLE CHANGES

The SCOPE, and which sections are worth computing. A district manager gets
incoming and outgoing counts, because that is the question their day turns
on. A regional manager gets a state-by-state table, because theirs does.
Nobody gets a section computed from rows they cannot read.

NO INVENTED NUMBERS

Every figure here is a COUNT of rows that exist. There is no utilisation
percentage, no "efficiency", no predicted arrival: the project has no
ground truth for any of them, and a dashboard that guesses is worse than
one that is quiet. A count that cannot be computed is absent, never zero -
zero is a measurement.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from sqlalchemy import Select, func, or_, select

from app.api.deps import DbSession, require_permission
from app.core import permissions as perm
from app.core import scope
from app.domain import presence as presence_domain
from app.models.enums import TripStatus, UserRole
from app.models.geography import OPERATIONAL_SOURCES, District, State
from app.models.identity import Driver, User
from app.models.operations import GpsPoint, Shipment, Trip
from app.schemas.common import ReadModel

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

#: Being worked on right now. DRAFT is excluded: a draft is a plan, and a
#: dashboard that counts plans as operations overstates the day's load.
UNDER_WAY = (
    TripStatus.ASSIGNED,
    TripStatus.VERIFICATION_PENDING,
    TripStatus.MANAGER_REVIEW,
    TripStatus.ACTIVE,
    TripStatus.DELAYED,
    TripStatus.INCIDENT,
)

#: Something has gone wrong, or is about to. These are the rows a manager
#: should look at before anything else on the screen.
NEEDS_ATTENTION = (TripStatus.DELAYED, TripStatus.INCIDENT)


class StateSummary(ReadModel):
    state_id: uuid.UUID
    name: str
    districts_configured: int
    trips_under_way: int
    trips_needing_attention: int


class DistrictSummary(ReadModel):
    district_id: uuid.UUID
    name: str
    incoming: int
    outgoing: int


class DashboardRead(ReadModel):
    """What this caller may see, and nothing else."""

    role: UserRole
    #: The scope in words, for a header that has to say which fleet this is.
    scope_label: str
    state_id: uuid.UUID | None
    district_id: uuid.UUID | None

    trips_under_way: int
    trips_needing_attention: int
    trips_awaiting_route: int
    #: Crossing a state border. Absent for a district manager, for whom the
    #: interesting boundary is their own district.
    cross_state_trips: int | None

    #: Only trips this caller may see, so these are counts of THEIR fleet.
    drivers_in_scope: int
    drivers_online: int
    drivers_with_stale_gps: int
    trucks_in_transit: int

    unread_notifications: int
    urgent_notifications: int

    #: Regional roles only.
    states: list[StateSummary]
    #: State managers get their districts; district managers get their own.
    districts: list[DistrictSummary]


def _scoped(stmt: Select, user: User) -> Select:
    clause = scope.trip_scope_clause(user)
    return stmt if clause is None else stmt.where(clause)


async def _count(db, stmt) -> int:
    return int((await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one())


def _scope_label(user: User, state_name: str | None, district_name: str | None) -> str:
    if user.role is UserRole.NORTH_EAST_MANAGER:
        return "North-East · all states"
    if user.role is UserRole.STATE_MANAGER:
        return f"{state_name} · state" if state_name else "State"
    if user.role is UserRole.DISTRICT_MANAGER:
        return f"{district_name} · district" if district_name else "District"
    if user.role is UserRole.ADMIN:
        return "Administrator"
    return "Fleet"


@router.get("", response_model=DashboardRead, summary="This caller's overview")
async def dashboard(
    db: DbSession,
    user: Annotated[User, Depends(require_permission(perm.TRIP_READ))],
) -> DashboardRead:
    trips = _scoped(select(Trip.id, Trip.status, Trip.driver_id, Trip.truck_id), user)

    under_way = await _count(db, trips.where(Trip.status.in_(UNDER_WAY)))
    attention = await _count(db, trips.where(Trip.status.in_(NEEDS_ATTENTION)))
    awaiting_route = await _count(
        db,
        trips.where(
            Trip.status.in_(UNDER_WAY + (TripStatus.DRAFT,)),
            Trip.selected_route_id.is_(None),
        ),
    )
    in_transit = await _count(
        db, trips.where(Trip.status.in_((TripStatus.ACTIVE, TripStatus.DELAYED)))
    )

    # Crossing a state border: the two ends are in different states.
    # Computed only where it is a question the role asks.
    cross_state: int | None = None
    if user.role is not UserRole.DISTRICT_MANAGER:
        crossing = (
            _scoped(select(Trip.id), user)
            .join(Shipment, Shipment.id == Trip.shipment_id)
            .where(
                Trip.status.in_(UNDER_WAY),
                Shipment.origin_state_id != Shipment.destination_state_id,
            )
        )
        cross_state = await _count(db, crossing)

    # Drivers this caller may see = drivers on trips this caller may see.
    # Derived from trip scope rather than from a driver's own geography,
    # because a driver has none: they are wherever the truck is.
    # The presence board uses the same helper, so its list and this count agree.
    driver_ids = [
        row[0] for row in (await db.execute(scope.scoped_driver_ids(user))).all()
    ]
    drivers = (
        list(
            (
                await db.execute(
                    select(Driver, User.last_seen_at)
                    .join(User, User.id == Driver.user_id)
                    .where(Driver.id.in_(driver_ids))
                )
            ).all()
        )
        if driver_ids
        else []
    )
    last_fix = {}
    if driver_ids:
        last_fix = {
            row[0]: row[1]
            for row in (
                await db.execute(
                    select(Trip.driver_id, func.max(GpsPoint.received_at))
                    .join(Trip, Trip.id == GpsPoint.trip_id)
                    .where(Trip.driver_id.in_(driver_ids))
                    .group_by(Trip.driver_id)
                )
            ).all()
        }

    online = stale = 0
    for driver, last_seen in drivers:
        status = presence_domain.assess(
            last_seen_at=last_seen, last_gps_at=last_fix.get(driver.id)
        )
        if status.presence is presence_domain.Presence.ONLINE:
            online += 1
        if status.location is presence_domain.LocationFreshness.STALE:
            stale += 1

    from app.models.enums import NotificationSeverity
    from app.models.notifications import Notification

    unread = await _count(
        db,
        select(Notification.id).where(
            Notification.recipient_user_id == user.id, Notification.is_read.is_(False)
        ),
    )
    urgent = await _count(
        db,
        select(Notification.id).where(
            Notification.recipient_user_id == user.id,
            Notification.is_read.is_(False),
            Notification.severity == NotificationSeverity.URGENT,
        ),
    )

    # --- The per-role tables ---------------------------------------------
    states: list[StateSummary] = []
    districts: list[DistrictSummary] = []
    state_name = district_name = None

    if user.state_id is not None:
        state_name = (
            await db.execute(select(State.name).where(State.id == user.state_id))
        ).scalar_one_or_none()
    if user.district_id is not None:
        district_name = (
            await db.execute(select(District.name).where(District.id == user.district_id))
        ).scalar_one_or_none()

    if user.role in scope.UNSCOPED_ROLES:
        # The region's states. Non-NER rows exist for classification only.
        rows = (
            await db.execute(select(State).where(State.is_ner).order_by(State.name))
        ).scalars().all()
        # OPERATIONAL districts only. Counting every row put 230 test
        # fixtures on a regional dashboard as "141 configured" for Assam -
        # a number somebody could have put in front of a ministry.
        counts = dict(
            (
                await db.execute(
                    select(District.state_id, func.count())
                    .where(District.source_status.in_(OPERATIONAL_SOURCES))
                    .group_by(District.state_id)
                )
            ).all()
        )
        for st in rows:
            in_state = (
                select(Trip.id, Trip.status)
                .join(Shipment, Shipment.id == Trip.shipment_id)
                .where(
                    or_(
                        Shipment.origin_state_id == st.id,
                        Shipment.destination_state_id == st.id,
                    )
                )
                .distinct()
            )
            states.append(
                StateSummary(
                    state_id=st.id,
                    name=st.name,
                    districts_configured=counts.get(st.id, 0),
                    trips_under_way=await _count(
                        db, in_state.where(Trip.status.in_(UNDER_WAY))
                    ),
                    trips_needing_attention=await _count(
                        db, in_state.where(Trip.status.in_(NEEDS_ATTENTION))
                    ),
                )
            )

    mine: list[District] = []
    if user.role is UserRole.STATE_MANAGER and user.state_id:
        # A state manager's district table is an operational list, not an
        # inventory of every row that mentions their state.
        mine = list(
            (
                await db.execute(
                    select(District)
                    .where(
                        District.state_id == user.state_id,
                        District.source_status.in_(OPERATIONAL_SOURCES),
                    )
                    .order_by(District.name)
                )
            )
            .scalars()
            .all()
        )
    elif user.role is UserRole.DISTRICT_MANAGER and user.district_id:
        row = (
            await db.execute(select(District).where(District.id == user.district_id))
        ).scalar_one_or_none()
        mine = [row] if row else []

    for d in mine:
        base = (
            _scoped(select(Trip.id), user)
            .join(Shipment, Shipment.id == Trip.shipment_id)
            .where(Trip.status.in_(UNDER_WAY))
        )
        districts.append(
            DistrictSummary(
                district_id=d.id,
                name=d.name,
                incoming=await _count(
                    db, base.where(Shipment.destination_district_id == d.id)
                ),
                outgoing=await _count(
                    db, base.where(Shipment.origin_district_id == d.id)
                ),
            )
        )

    return DashboardRead(
        role=user.role,
        scope_label=_scope_label(user, state_name, district_name),
        state_id=user.state_id,
        district_id=user.district_id,
        trips_under_way=under_way,
        trips_needing_attention=attention,
        trips_awaiting_route=awaiting_route,
        cross_state_trips=cross_state,
        drivers_in_scope=len(drivers),
        drivers_online=online,
        drivers_with_stale_gps=stale,
        trucks_in_transit=in_transit,
        unread_notifications=unread,
        urgent_notifications=urgent,
        states=states,
        districts=districts,
    )
