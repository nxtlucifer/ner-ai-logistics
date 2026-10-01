"""Driver breaks: a planned 15- or 30-minute stop on a running trip.

A break is a FACT ABOUT THE DRIVER, not a trip state. The trip stays ACTIVE (or
DELAYED), the route and stops are untouched, and every lifecycle rule keeps
working without knowing breaks exist. What a break adds is a row in
`trip_breaks`, a line on the timeline, and a note in the managers' inbox.

IDEMPOTENT BOTH WAYS. The phone generates `request_id` once per tap and reuses
it on retry, so a lost response on a hill road cannot start two breaks; a
second tap with a NEW id while one is open is refused (BREAK_ALREADY_ACTIVE),
and the partial unique index `uq_trip_breaks_one_open` decides any race.
Resuming a break that already ended returns the trip unchanged.

OVERDUE is computed on every read (now > started_at + planned), so a manager
sees it the moment it is true. The sweep (`flag_overdue`, run by the app's
break-watch loop) adds the timeline line and ONE inbox alert per break,
claimed with UPDATE ... RETURNING so two instances cannot both send it.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from geoalchemy2.elements import WKTElement
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError
from app.models.enums import AuditAction, NotificationKind, NotificationSeverity, TripEventKind, TripStatus
from app.models.identity import Driver, User
from app.models.operations import BREAK_MINUTES, BREAK_REASONS, Trip, TripBreak
from app.services import audit, notifications, telemetry, trips

IN_PROGRESS = (TripStatus.ACTIVE, TripStatus.DELAYED)

REASON_WORDS = {
    "TEA_REST": "Tea / rest",
    "FOOD": "Food",
    "WASHROOM": "Washroom",
    "FUEL": "Fuel",
    "EMERGENCY": "Emergency",
    "OTHER": "Other",
}


@dataclass
class BreakView:
    row: TripBreak
    lat: float | None
    lon: float | None

    @property
    def expected_end_at(self) -> datetime:
        return self.row.started_at + timedelta(minutes=self.row.planned_minutes)

    def overdue(self, now: datetime | None = None) -> bool:
        end = self.row.ended_at or now or datetime.now(UTC)
        return end > self.expected_end_at

    @property
    def actual_seconds(self) -> int | None:
        if self.row.ended_at is None:
            return None
        return int((self.row.ended_at - self.row.started_at).total_seconds())


def _select():
    return select(
        TripBreak,
        func.ST_Y(func.geometry(TripBreak.location)).label("lat"),
        func.ST_X(func.geometry(TripBreak.location)).label("lon"),
    )


async def _views(db: AsyncSession, stmt) -> list[BreakView]:
    return [BreakView(row, lat, lon) for row, lat, lon in (await db.execute(stmt)).all()]


async def open_for_trips(db: AsyncSession, trip_ids: list[uuid.UUID]) -> dict[uuid.UUID, BreakView]:
    """The open break of each trip, one query (Fleet polls this)."""
    if not trip_ids:
        return {}
    views = await _views(db, _select().where(TripBreak.trip_id.in_(trip_ids), TripBreak.ended_at.is_(None)))
    return {v.row.trip_id: v for v in views}


async def for_trip(db: AsyncSession, trip_id: uuid.UUID) -> list[BreakView]:
    """Every break of a trip, newest first: the break history."""
    return await _views(db, _select().where(TripBreak.trip_id == trip_id).order_by(TripBreak.started_at.desc()))


async def _people(db: AsyncSession, trip: Trip) -> list[User]:
    # The area's managers, and always the regional ones: a trip with no known
    # geography has no area manager, and someone must still be told.
    scoped = await notifications.recipients_for_trip(db, trip)
    regional = await notifications.regional_managers(db)
    return list({u.id: u for u in (*scoped, *regional)}.values())


async def _running_trip(db: AsyncSession, driver: Driver, current: Trip | None) -> Trip:
    if current is None:
        raise NotFoundError("You have no trip to work on right now.")
    trip = await trips.load_for_update(db, current.id)
    if trip.driver_id != driver.id:
        raise ConflictError("Your trip changed. Reload before continuing.", code="TRIP_SUPERSEDED")
    return trip


async def start(
    db: AsyncSession,
    driver: Driver,
    user: User,
    current: Trip | None,
    *,
    request_id: uuid.UUID,
    minutes: int,
    reason: str,
    note: str | None = None,
    lat: float | None = None,
    lon: float | None = None,
    fix_at: datetime | None = None,
    ip: str | None = None,
) -> Trip:
    if minutes not in BREAK_MINUTES:
        raise ConflictError("A break is 15 or 30 minutes.", code="BREAK_MINUTES_INVALID")
    if reason not in BREAK_REASONS:
        raise ConflictError("Choose a reason for the break.", code="BREAK_REASON_INVALID")
    trip = await _running_trip(db, driver, current)

    same = (await db.execute(select(TripBreak).where(TripBreak.request_id == request_id))).scalar_one_or_none()
    if same is not None:
        if same.trip_id != trip.id:
            raise ConflictError("That break belongs to another trip.", code="TRIP_SUPERSEDED")
        return trip  # a retry of the same tap
    if trip.status not in IN_PROGRESS:
        raise ConflictError("A break can start only while the trip is under way.", code="TRIP_NOT_IN_PROGRESS")
    if (await open_for_trips(db, [trip.id])).get(trip.id) is not None:
        raise ConflictError("A break is already running. Resume it first.", code="BREAK_ALREADY_ACTIVE")

    now = datetime.now(UTC)
    # Where: the phone's own fix at the tap, else the trip's newest GPS point.
    source = None
    if lat is not None and lon is not None:
        source, at = "PHONE", fix_at
    else:
        last = await telemetry.latest_position(db, trip.id)
        if last is not None:
            lat, lon, source, at = last.lat, last.lon, "LAST_FIX", last.recorded_at
        else:
            at = None
    nav_state = {
        "trip_status": trip.status.value,
        "selected_route_id": str(trip.selected_route_id) if trip.selected_route_id else None,
    }
    row = TripBreak(
        trip_id=trip.id,
        driver_id=driver.id,
        truck_id=trip.truck_id,
        request_id=request_id,
        started_at=now,
        planned_minutes=minutes,
        reason=reason,
        note=(note or "").strip()[:200] or None,
        location=WKTElement(f"POINT({lon} {lat})", srid=4326) if source else None,
        location_at=at,
        location_source=source,
        nav_state=nav_state,
        started_by_user_id=user.id,
    )
    db.add(row)
    try:
        await db.flush()
    except IntegrityError as exc:  # the partial unique index lost a race
        await db.rollback()
        raise ConflictError("A break is already running. Resume it first.", code="BREAK_ALREADY_ACTIVE") from exc

    expected = now + timedelta(minutes=minutes)
    words = REASON_WORDS[reason]
    await trips.record_event(
        db, trip,
        kind=TripEventKind.BREAK_STARTED,
        description=f"Break started: {minutes} min · {words}",
        payload={"break_id": str(row.id), "reason": words, "planned_minutes": minutes, "expected_end_at": expected.isoformat()},
        actor_user_id=user.id,
        location=row.location,
    )
    await audit.record(
        db, action=AuditAction.CREATE, entity_type="trip_breaks", entity_id=row.id, actor_user_id=user.id,
        after={"trip_id": str(trip.id), "planned_minutes": minutes, "reason": reason, "location_source": source},
        reason="driver started a break", ip_address=ip,
    )
    await notifications.notify(
        db,
        recipients=await _people(db, trip),
        kind=NotificationKind.DRIVER_BREAK_STARTED,
        dedupe_key=f"break-start:{row.id}",
        trip_id=trip.id,
        severity=NotificationSeverity.WARNING if reason == "EMERGENCY" else None,
        payload={
            "trip_code": trip.trip_code,
            "driver_name": driver.full_name,
            "break_id": str(row.id),
            "reason": words,
            "planned_minutes": minutes,
            "started_at": now.isoformat(),
            "expected_end_at": expected.isoformat(),
            **({"lat": round(lat, 5), "lon": round(lon, 5)} if source else {}),
        },
    )
    await db.commit()
    return trip


async def resume(
    db: AsyncSession, driver: Driver, user: User, current: Trip | None, *, break_id: uuid.UUID, ip: str | None = None
) -> Trip:
    trip = await _running_trip(db, driver, current)
    row = (
        await db.execute(select(TripBreak).where(TripBreak.id == break_id, TripBreak.trip_id == trip.id).with_for_update())
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("That break is not on your trip.")
    if row.ended_at is not None:
        return trip  # already resumed: a retry or a double tap
    now = datetime.now(UTC)
    row.ended_at = now
    row.ended_by_user_id = user.id
    view = BreakView(row, None, None)
    actual = view.actual_seconds or 0
    over = view.overdue()
    words = REASON_WORDS.get(row.reason, row.reason)
    await trips.record_event(
        db, trip,
        kind=TripEventKind.BREAK_ENDED,
        description=f"Break ended after {round(actual / 60)} min" + (f" (planned {row.planned_minutes}, overran)" if over else ""),
        payload={"break_id": str(row.id), "reason": words, "actual_seconds": actual, "overdue": over},
        actor_user_id=user.id,
    )
    await audit.record(
        db, action=AuditAction.UPDATE, entity_type="trip_breaks", entity_id=row.id, actor_user_id=user.id,
        before={"ended_at": None}, after={"ended_at": now.isoformat(), "actual_seconds": actual},
        reason="driver resumed after a break", ip_address=ip,
    )
    await notifications.notify(
        db,
        recipients=await _people(db, trip),
        kind=NotificationKind.DRIVER_BREAK_ENDED,
        dedupe_key=f"break-end:{row.id}",
        trip_id=trip.id,
        payload={
            "trip_code": trip.trip_code,
            "driver_name": driver.full_name,
            "break_id": str(row.id),
            "reason": words,
            "planned_minutes": row.planned_minutes,
            "actual_seconds": actual,
            "overdue": over,
        },
    )
    await db.commit()
    return trip


async def flag_overdue(db: AsyncSession, now: datetime | None = None) -> int:
    """Mark breaks that ran past their planned end, once each. Returns how many."""
    now = now or datetime.now(UTC)
    claimed = (
        await db.execute(
            update(TripBreak)
            .where(
                TripBreak.ended_at.is_(None),
                TripBreak.overdue_alerted_at.is_(None),
                TripBreak.started_at + func.make_interval(0, 0, 0, 0, 0, TripBreak.planned_minutes) < now,
                TripBreak.trip_id.in_(select(Trip.id).where(Trip.status.in_(IN_PROGRESS))),
            )
            .values(overdue_alerted_at=now)
            .returning(TripBreak.id, TripBreak.trip_id)
        )
    ).all()
    for break_id, trip_id in claimed:
        trip = await db.get(Trip, trip_id)
        row = await db.get(TripBreak, break_id)
        driver = await db.get(Driver, row.driver_id)
        await trips.record_event(
            db, trip,
            kind=TripEventKind.BREAK_OVERDUE,
            description=f"Break overran its planned {row.planned_minutes} min",
            payload={"break_id": str(break_id), "planned_minutes": row.planned_minutes},
        )
        await notifications.notify(
            db,
            recipients=await _people(db, trip),
            kind=NotificationKind.DRIVER_BREAK_OVERDUE,
            dedupe_key=f"break-overdue:{break_id}",
            trip_id=trip.id,
            severity=NotificationSeverity.WARNING,
            payload={
                "trip_code": trip.trip_code,
                "driver_name": driver.full_name if driver else None,
                "break_id": str(break_id),
                "reason": REASON_WORDS.get(row.reason, row.reason),
                "planned_minutes": row.planned_minutes,
                "started_at": row.started_at.isoformat(),
            },
        )
    await db.commit()
    return len(claimed)
