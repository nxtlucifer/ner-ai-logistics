"""Location telemetry: ingestion, latest position, bounded history.

Telemetry is not the audit trail and is not the trip timeline. A trip that
uploads a fix every 10 seconds for eight hours produces ~2,900 rows; writing an
`audit_logs` entry for each would bury the compliance record it exists to be,
and writing a `trip_event` for each would bury the operational narrative. So GPS
goes to `gps_points` and nowhere else. Trip *events* mark what happened; GPS
records where the truck was.

Three properties this module is responsible for:

  IDEMPOTENCE   Re-posting an unacknowledged batch cannot duplicate rows. The
                authority is the unique index (trip_id, device_fix_id) plus
                INSERT ... ON CONFLICT DO NOTHING - never SELECT-then-INSERT,
                which two concurrent uploads both pass.

  ORDERING      "Current location" is the newest VALID observation by
                `recorded_at`, not the last row inserted. A reconnecting truck
                flushes an offline backlog, so the last row written is routinely
                the oldest position in it.

  HONEST TIME   `recorded_at` is the device clock and is not trusted. Freshness,
                and every safety timer later built on it, uses `received_at`,
                the server clock - a phone with a wrong or manipulated clock
                cannot make an old position look current.
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from geoalchemy2 import WKTElement
from sqlalchemy import func, select
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain import telemetry_policy as policy
from app.domain.routing import haversine_m
from app.models.enums import TripStatus
from app.models.fleet import Truck
from app.models.identity import Driver
from app.models.operations import GpsPoint, Trip, TripStop
from app.schemas.domain import GpsFixIn
from app.services.shipments import SRID

#: Hard ceiling on a single track page. The privacy limit, not a perf one:
#: an unrestricted GPS dump turns an authorised "where is this truck" read into
#: a complete movement profile of a person. See docs/SECURITY.md section 3.
MAX_TRACK_POINTS = 1000


@dataclass
class Position:
    """One observation, already converted out of PostGIS."""

    lat: float
    lon: float
    recorded_at: datetime
    received_at: datetime
    speed_kmph: float | None = None
    heading_deg: float | None = None
    accuracy_m: float | None = None
    is_mock_location: bool = False

    def age_seconds(self, now: datetime | None = None) -> float:
        """Age by the SERVER clock. See the module docstring."""
        reference = now or datetime.now(UTC)
        received = self.received_at
        if received.tzinfo is None:
            received = received.replace(tzinfo=UTC)
        return max(0.0, (reference - received).total_seconds())

    @property
    def freshness(self) -> str:
        return policy.freshness_label(self.age_seconds())


@dataclass
class IngestResult:
    accepted: int = 0
    duplicates_ignored: int = 0
    rejected: int = 0
    rejected_reasons: dict[str, int] = field(default_factory=dict)
    anomalies: set[str] = field(default_factory=set)

    def reject(self, reason: str) -> None:
        self.rejected += 1
        self.rejected_reasons[reason] = self.rejected_reasons.get(reason, 0) + 1


def _as_utc(value: datetime) -> datetime:
    """Interpret a naive timestamp as UTC.

    Naive is accepted rather than refused because a JSON timestamp without an
    offset is a common client mistake, and the alternative - rejecting the whole
    batch - loses real positions over a formatting detail. UTC is the only
    defensible assumption: the API speaks UTC everywhere else.
    """
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


async def latest_position(db: AsyncSession, trip_id: uuid.UUID) -> Position | None:
    """The newest valid observation for a trip.

    Ordered by `recorded_at DESC` - when the truck actually was there - with
    `received_at` and `id` as tiebreakers so the ordering is total. Uses
    ix_gps_trip_recorded (trip_id, recorded_at DESC); with LIMIT 1 this is an
    index scan of one row, not a sort of the trip's whole track.
    """
    row = (
        await db.execute(
            select(
                func.ST_AsText(GpsPoint.location),
                GpsPoint.recorded_at,
                GpsPoint.received_at,
                GpsPoint.speed_kmph,
                GpsPoint.heading_deg,
                GpsPoint.accuracy_m,
                GpsPoint.is_mock_location,
            )
            .where(GpsPoint.trip_id == trip_id)
            .order_by(
                GpsPoint.recorded_at.desc(),
                GpsPoint.received_at.desc(),
                GpsPoint.id.desc(),
            )
            .limit(1)
        )
    ).first()
    if row is None:
        return None
    return _position_from_row(row)


def _parse_point_wkt(wkt: str) -> tuple[float, float]:
    """'POINT(lon lat)' -> (lat, lon).

    Note the reordering. WKT is x-then-y, so the first number is LONGITUDE.
    Returning (lat, lon) here - and nowhere else in this module doing the
    conversion - means there is exactly one place the inversion could be made,
    and it is covered by a test using a real Guwahati coordinate.
    """
    inner = wkt[wkt.index("(") + 1 : wkt.rindex(")")]
    # Only the first two ordinates. `POINT Z` and `POINT ZM` carry a third and
    # fourth, and an unpacking assignment would raise ValueError - a 500 for a
    # row PostGIS considers perfectly valid. Our columns are 2D, but the parser
    # should not be the thing that breaks if that ever changes.
    parts = inner.split()
    lon_text, lat_text = parts[0], parts[1]
    return float(lat_text), float(lon_text)


def _position_from_row(row) -> Position:
    lat, lon = _parse_point_wkt(row[0])
    return Position(
        lat=lat,
        lon=lon,
        recorded_at=_as_utc(row[1]),
        received_at=_as_utc(row[2]),
        speed_kmph=float(row[3]) if row[3] is not None else None,
        heading_deg=float(row[4]) if row[4] is not None else None,
        accuracy_m=float(row[5]) if row[5] is not None else None,
        is_mock_location=bool(row[6]),
    )


async def ingest(
    db: AsyncSession,
    *,
    trip: Trip,
    driver: Driver,
    fixes: list[GpsFixIn],
    now: datetime | None = None,
) -> IngestResult:
    """Store a batch of fixes for a trip the caller has already been proven to own.

    Every identifying field - trip, driver, truck - comes from `trip`, which the
    caller resolved from the authenticated driver. Nothing in `fixes` names a
    subject, so there is no field a client could set to write someone else's
    track.

    Returns per-fix dispositions rather than failing the batch. A truck
    reconnecting after a coverage gap flushes hundreds of fixes at once, and
    throwing all of them away because one carries a bad timestamp would lose
    real positions.
    """
    now = now or datetime.now(UTC)
    result = IngestResult()

    # Pass 1: admit or reject each fix on its own timestamp.
    admitted: list[tuple[GpsFixIn, datetime]] = []
    for fix in fixes:
        recorded_at = _as_utc(fix.recorded_at)

        if recorded_at > now + policy.MAX_CLOCK_SKEW:
            result.reject(policy.REJECT_FUTURE)
            continue
        if recorded_at < now - policy.MAX_BACKDATE:
            result.reject(policy.REJECT_STALE)
            continue

        admitted.append((fix, recorded_at))

        if fix.is_mock_location:
            result.anomalies.add(policy.ANOMALY_MOCK_LOCATION)
        if (
            fix.accuracy_m is not None
            and float(fix.accuracy_m) > policy.POOR_ACCURACY_M
        ):
            result.anomalies.add(policy.ANOMALY_POOR_ACCURACY)

    # Pass 2: movement plausibility, walked in TIME order with the baseline
    # advancing.
    #
    # A batch is not a single observation. Comparing every fix in it against one
    # stored position - the state before the batch - measures a 60-second window
    # for the sixth fix and a 10-second one for the first, so a genuine
    # teleport between two consecutive fixes inside the batch goes unflagged
    # while ordinary movement across the whole batch can look impossible.
    #
    # Sorted because a flushed offline queue does not arrive in order, and
    # "speed between consecutive fixes" is only meaningful along the timeline.
    previous = await latest_position(db, trip.id)
    baseline = (
        (previous.lat, previous.lon, previous.recorded_at)
        if previous is not None
        else None
    )
    for fix, recorded_at in sorted(admitted, key=lambda pair: pair[1]):
        if baseline is not None:
            lat, lon, at = baseline
            gap = (recorded_at - at).total_seconds()
            if gap > 0:
                metres = haversine_m(lat, lon, fix.location.lat, fix.location.lon)
                if (metres / gap) * 3.6 > policy.IMPLAUSIBLE_SPEED_KMPH:
                    # Flagged, never rejected. Discarding an "impossible" fix is
                    # how you lose the position of a truck that is genuinely in
                    # trouble. See docs/SECURITY.md section 8.
                    result.anomalies.add(policy.ANOMALY_IMPLAUSIBLE_SPEED)
        baseline = (fix.location.lat, fix.location.lon, recorded_at)

    rows: list[dict] = [
        {
            "trip_id": trip.id,
            "driver_id": driver.id,
            "truck_id": trip.truck_id,
            "location": WKTElement(fix.location.to_wkt(), srid=SRID),
            "altitude_m": fix.altitude_m,
            "speed_kmph": fix.speed_kmph,
            "heading_deg": fix.heading_deg,
            "accuracy_m": fix.accuracy_m,
            "device_fix_id": fix.device_fix_id,
            "recorded_at": recorded_at,
            "is_mock_location": fix.is_mock_location,
        }
        for fix, recorded_at in admitted
    ]

    if rows:
        # ON CONFLICT DO NOTHING against uq_gps_trip_device_fix, not a
        # SELECT-then-INSERT: two concurrent uploads of the same batch would
        # both pass a pre-check and both insert. The database decides.
        statement = (
            pg_insert(GpsPoint)
            .values(rows)
            .on_conflict_do_nothing(index_elements=["trip_id", "device_fix_id"])
            .returning(GpsPoint.id)
        )
        inserted = len((await db.execute(statement)).scalars().all())
        result.accepted = inserted
        result.duplicates_ignored = len(rows) - inserted

    await db.commit()
    return result


# --- Manager reads --------------------------------------------------------


@dataclass
class FleetRow:
    """One active trip as a dispatcher needs to see it."""

    trip_id: uuid.UUID
    trip_code: str
    trip_status: TripStatus
    driver_id: uuid.UUID
    driver_name: str
    truck_id: uuid.UUID
    registration_number: str
    started_at: datetime | None
    position: Position | None
    next_stop_sequence: int | None
    next_stop_name: str | None
    stops_done: int
    stops_total: int

    @property
    def freshness(self) -> str:
        return policy.freshness_label(
            self.position.age_seconds() if self.position else None
        )


async def active_fleet(db: AsyncSession, *, limit: int = 100) -> list[FleetRow]:
    """Every trip currently on the road, with its last known position.

    Two queries, not one per trip. The trip list uses the partial index
    ix_trips_active; the positions use a single DISTINCT ON over
    ix_gps_trip_recorded restricted to those trip ids. An N+1 here would issue a
    query per truck on a dashboard that polls.
    """
    trip_rows = list(
        (
            await db.execute(
                select(Trip, Driver.full_name, Truck.registration_number)
                .join(Driver, Driver.id == Trip.driver_id)
                .join(Truck, Truck.id == Trip.truck_id)
                .where(Trip.status.in_((TripStatus.ACTIVE, TripStatus.DELAYED)))
                .order_by(Trip.started_at.desc().nullslast(), Trip.id)
                .limit(limit)
            )
        ).all()
    )
    if not trip_rows:
        return []

    trip_ids = [row[0].id for row in trip_rows]
    positions = await latest_positions(db, trip_ids)
    progress = await _stop_progress(db, trip_ids)

    out: list[FleetRow] = []
    for trip, driver_name, registration in trip_rows:
        done, total, next_seq, next_name = progress.get(
            trip.id, (0, 0, None, None)
        )
        out.append(
            FleetRow(
                trip_id=trip.id,
                trip_code=trip.trip_code,
                trip_status=trip.status,
                driver_id=trip.driver_id,
                driver_name=driver_name,
                truck_id=trip.truck_id,
                registration_number=registration,
                started_at=trip.started_at,
                position=positions.get(trip.id),
                next_stop_sequence=next_seq,
                next_stop_name=next_name,
                stops_done=done,
                stops_total=total,
            )
        )
    return out


#: Newest position per trip, one index lookup each.
#
# LATERAL, not DISTINCT ON. The obvious formulation
#
#     SELECT DISTINCT ON (trip_id) ... WHERE trip_id = ANY(...)
#     ORDER BY trip_id, recorded_at DESC
#
# reads EVERY point of EVERY named trip and then sorts them. Measured on 25
# active trips with 1,200 points each: 30,000 rows scanned, 397 ms, spilling to
# temp files - on a dashboard that polls. And it degrades with track length, so
# it is slowest exactly when a fleet has been running longest.
#
# The LATERAL runs the single-trip query - which is an index scan of one row on
# ix_gps_trip_recorded - once per trip. Same 25 answers, 25 rows read.
#
# Written as SQL because SQLAlchemy's LATERAL construction obscures the one
# thing that matters here: the LIMIT 1 is inside the correlated subquery, which
# is what makes it an index lookup rather than a scan.
LATEST_POSITIONS_SQL = sa_text(
    """
    SELECT t.trip_id,
           ST_AsText(p.location),
           p.recorded_at,
           p.received_at,
           p.speed_kmph,
           p.heading_deg,
           p.accuracy_m,
           p.is_mock_location
    FROM unnest(CAST(:trip_ids AS uuid[])) AS t(trip_id)
    JOIN LATERAL (
        SELECT g.location, g.recorded_at, g.received_at, g.speed_kmph,
               g.heading_deg, g.accuracy_m, g.is_mock_location
        FROM gps_points g
        WHERE g.trip_id = t.trip_id
        ORDER BY g.recorded_at DESC, g.received_at DESC, g.id DESC
        LIMIT 1
    ) p ON TRUE
    """
)


async def latest_positions(
    db: AsyncSession, trip_ids: list[uuid.UUID]
) -> dict[uuid.UUID, Position]:
    """Newest observation for each of several trips, in one round trip.

    Trips with no fix yet are simply absent from the result. That is the honest
    representation: `dict.get` returns None, and "no contact yet" is a different
    fact from "contact went stale".
    """
    if not trip_ids:
        return {}

    rows = (
        await db.execute(
            LATEST_POSITIONS_SQL, {"trip_ids": [str(t) for t in trip_ids]}
        )
    ).all()
    return {uuid.UUID(str(row[0])): _position_from_row(row[1:]) for row in rows}


async def _stop_progress(
    db: AsyncSession, trip_ids: list[uuid.UUID]
) -> dict[uuid.UUID, tuple[int, int, int | None, str | None]]:
    """(done, total, next_sequence, next_name) per trip, in one query."""
    rows = (
        await db.execute(
            select(
                TripStop.trip_id,
                TripStop.sequence,
                TripStop.status,
                TripStop.name,
            )
            .where(TripStop.trip_id.in_(trip_ids))
            .order_by(TripStop.trip_id, TripStop.sequence)
        )
    ).all()

    out: dict[uuid.UUID, tuple[int, int, int | None, str | None]] = {}
    for trip_id, sequence, status, name in rows:
        done, total, next_seq, next_name = out.get(trip_id, (0, 0, None, None))
        total += 1
        if status.value in ("COMPLETED", "SKIPPED"):
            done += 1
        elif next_seq is None:
            next_seq, next_name = sequence, name
        out[trip_id] = (done, total, next_seq, next_name)
    return out


async def track(
    db: AsyncSession,
    trip_id: uuid.UUID,
    *,
    limit: int = 500,
    since: datetime | None = None,
) -> list[Position]:
    """A trip's recent track, newest first and always bounded.

    There is deliberately no "all history" mode. An unbounded GPS dump endpoint
    is both a performance hazard and, more importantly, a privacy one: it turns
    an authorised read of "where is this truck" into a complete movement profile
    of a person. Callers page with `since` instead.
    """
    stmt = select(
        func.ST_AsText(GpsPoint.location),
        GpsPoint.recorded_at,
        GpsPoint.received_at,
        GpsPoint.speed_kmph,
        GpsPoint.heading_deg,
        GpsPoint.accuracy_m,
        GpsPoint.is_mock_location,
    ).where(GpsPoint.trip_id == trip_id)

    if since is not None:
        stmt = stmt.where(GpsPoint.recorded_at > _as_utc(since))

    # +1 so a caller asking for the maximum page can still over-fetch by one to
    # decide whether the track is truncated. The route's own Query bound is the
    # real limit; this clamp is defence in depth against a service-layer caller.
    stmt = stmt.order_by(
        GpsPoint.recorded_at.desc(), GpsPoint.id.desc()
    ).limit(max(1, min(limit, MAX_TRACK_POINTS + 1)))

    return [_position_from_row(row) for row in (await db.execute(stmt)).all()]
