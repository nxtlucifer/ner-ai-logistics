"""Replay of what a phone saw while it had no network.

GPS answers "where was the truck". This answers "what happened" - the truck
left the corridor, the driver acknowledged a warning, the driver pressed for
help, the connection went and came back - for the hours when nothing could be
said at the time. The device queues those events durably and flushes them on
reconnect, and this is the door they come through.

THE SAME THREE PROPERTIES AS TELEMETRY, FOR THE SAME REASONS

  IDEMPOTENCE   Re-posting an unacknowledged batch cannot duplicate anything.
                The authority is the partial unique index
                (trip_id, device_event_id) plus INSERT ... ON CONFLICT DO
                NOTHING - never SELECT-then-INSERT, which two concurrent
                replays both pass. Crucially, every SIDE EFFECT is bound to a
                row actually having been inserted: a duplicate SOS reaches
                `_side_effects` never, not twice, so it cannot open a second
                emergency.

  ORDERING      Events are applied in DEVICE order - `recorded_at`, then the
                device's own `sequence` as a tie-break - because the domain
                needs it: an acknowledgement of a warning belongs after the
                warning, and a reconnecting phone flushes an hour of them at
                once. What is NOT taken from the device is the timeline
                position: `occurred_at` stays the server clock.

  HONEST TIME   `device_reported_at` is the device clock and is not trusted.
                The gap between it and `occurred_at` is how long the event sat
                in the queue - the same measurement `app/domain/connectivity.py`
                reads out of GPS fixes - and a phone with a wrong clock can
                make that gap wrong without being able to reorder anything.

ONE POISON EVENT MUST NOT BLOCK THE QUEUE FOREVER

A batch is not a transaction. An event this server cannot process - an
unsupported kind from a newer build, a payload that violates a constraint, a
timestamp from next year - is counted in `rejected`, its id is returned as
SETTLED, and the device deletes it. The alternative is a queue with a bad event
at its head retrying every minute behind an SOS that will therefore never
arrive. Each event is applied inside its own SAVEPOINT so a failure rolls back
that event alone.

WHAT SETTLED MEANS, AND WHY IT IS RETURNED

`settled_event_ids` are the ids the device may now delete: stored, already
stored, or refused for good. An event whose fate is unknown - the request died
mid-flight, the server fell over - is in no list, so the device keeps it and
sends it again. Losing an SOS to an ambiguous response is the failure this
field exists to prevent.
"""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from geoalchemy2 import WKTElement
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain import telemetry_policy as policy
from app.models.enums import TripEventKind
from app.models.identity import Driver
from app.models.operations import Trip, TripEvent
from app.schemas.domain import DeviceEventIn
from app.services import sentinel
from app.services.shipments import SRID

logger = logging.getLogger(__name__)

#: Refusal reasons. Stable strings; the device counts them for diagnostics and
#: never re-sends an event that earned one.
REJECT_STALE = policy.REJECT_STALE
REJECT_FUTURE = policy.REJECT_FUTURE
REJECT_UNPROCESSABLE = "UNPROCESSABLE"

#: Where the partial unique index applies. Must match migration 0013's
#: predicate exactly or PostgreSQL cannot use the index as a conflict target.
_CONFLICT_WHERE = sa_text("device_event_id IS NOT NULL")


@dataclass
class EventIngestResult:
    accepted: int = 0
    duplicates_ignored: int = 0
    rejected: int = 0
    rejected_reasons: dict[str, int] = field(default_factory=dict)
    #: Ids the device may delete from its queue. See the module docstring.
    settled: list[uuid.UUID] = field(default_factory=list)

    def reject(self, event_id: uuid.UUID, reason: str) -> None:
        self.rejected += 1
        self.rejected_reasons[reason] = self.rejected_reasons.get(reason, 0) + 1
        self.settled.append(event_id)


def _as_utc(value: datetime) -> datetime:
    """Interpret a naive timestamp as UTC - the same rule telemetry applies."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def describe(event: DeviceEventIn) -> str:
    """The manager-facing sentence for one device event.

    English here rather than a reason code, because this is the operational
    timeline a dispatcher reads, and every other writer of `trip_events` puts a
    sentence in it. The codes-not-sentences rule governs what reaches a DRIVER,
    who may be reading in Assamese; it does not govern this table.
    """
    payload = event.payload or {}
    if event.kind is TripEventKind.ROUTE_DEVIATION:
        off = payload.get("off_route_m")
        distance = f"{float(off):.0f} m" if isinstance(off, (int, float)) else "an unstated distance"
        return f"Driver's phone reported leaving the planned corridor by {distance}."
    if event.kind is TripEventKind.ALERT_ACKNOWLEDGED:
        level = payload.get("level") or "alert"
        return f"Driver acknowledged a {level} alert on the phone."
    if event.kind is TripEventKind.SOS_TRIGGERED:
        return "Driver pressed SOS on the phone."
    if event.kind is TripEventKind.COMMS_LOST:
        return "Driver's phone lost its connection to the service."
    if event.kind is TripEventKind.COMMS_RESTORED:
        queued = payload.get("queued_events")
        if isinstance(queued, int):
            return (
                f"Driver's phone regained its connection with {queued} event(s) "
                "waiting to be sent."
            )
        return "Driver's phone regained its connection."
    return f"Device reported {event.kind.value}."


async def _insert(
    db: AsyncSession,
    *,
    trip: Trip,
    driver: Driver,
    event: DeviceEventIn,
    recorded_at: datetime,
) -> int | None:
    """Store one event, or return None because it is already stored.

    ON CONFLICT DO NOTHING against `uq_trip_events_device_event`, not a
    pre-check: two concurrent replays of the same batch would both pass a
    SELECT and both insert. The database decides, and its answer is what gates
    the side effect.
    """
    location = (
        WKTElement(event.location.to_wkt(), srid=SRID)
        if event.location is not None
        else None
    )
    payload = dict(event.payload or {})
    if event.sequence is not None:
        # Carried, not trusted as an ordering key on its own - see the header.
        payload.setdefault("device_sequence", event.sequence)
    if event.accuracy_m is not None:
        payload.setdefault("accuracy_m", float(event.accuracy_m))

    statement = (
        pg_insert(TripEvent)
        .values(
            trip_id=trip.id,
            kind=event.kind,
            description=describe(event),
            payload=payload or None,
            location=location,
            # The driver is the actor: this is something a person on the road
            # did, not something the system decided.
            actor_user_id=driver.user_id,
            device_event_id=event.device_event_id,
            device_reported_at=recorded_at,
        )
        .on_conflict_do_nothing(
            index_elements=["trip_id", "device_event_id"],
            index_where=_CONFLICT_WHERE,
        )
        .returning(TripEvent.id)
    )
    return (await db.execute(statement)).scalar_one_or_none()


async def _side_effects(
    db: AsyncSession,
    *,
    trip: Trip,
    driver: Driver,
    event: DeviceEventIn,
    now: datetime,
) -> None:
    """What the domain must do about an event that was genuinely new.

    Reached only when the insert above actually inserted, which is what makes a
    replayed SOS a no-op rather than a second emergency.

    Deliberately thin, and deliberately delegating: opening an emergency is
    Fleet Sentinel's job and it already knows how, including the concurrency
    race. A second implementation here would be a parallel safety subsystem.
    """
    if event.kind is not TripEventKind.SOS_TRIGGERED:
        return
    await sentinel.record_driver_sos(
        db,
        driver=driver,
        trip=trip,
        now=now,
        location=(
            (event.location.lat, event.location.lon)
            if event.location is not None
            else None
        ),
    )


async def ingest(
    db: AsyncSession,
    *,
    trip: Trip,
    driver: Driver,
    events: list[DeviceEventIn],
    now: datetime | None = None,
) -> EventIngestResult:
    """Replay a batch of device events onto a trip the caller already owns.

    Every identifying field comes from `trip` and `driver`, which the caller
    resolved from the authenticated token. Nothing in `events` names a subject,
    so there is no field a client could set to write someone else's history.
    """
    now = now or datetime.now(UTC)
    result = EventIngestResult()

    # Device order, so causally dependent events land in the order they
    # happened. `sequence` breaks ties within a second; events without one sort
    # first, which is the conservative reading of "no finer information".
    ordered = sorted(
        events,
        key=lambda e: (_as_utc(e.recorded_at), e.sequence if e.sequence is not None else -1),
    )

    for event in ordered:
        recorded_at = _as_utc(event.recorded_at)

        # The same acceptance window telemetry applies, and for the same
        # reason: a timestamp outside it is not evidence of anything. Note that
        # rejecting here costs nothing safety-critical - the event is refused
        # before it can claim a position in a timeline it does not belong in.
        if recorded_at > now + policy.MAX_CLOCK_SKEW:
            result.reject(event.device_event_id, REJECT_FUTURE)
            continue
        if recorded_at < now - policy.MAX_BACKDATE:
            result.reject(event.device_event_id, REJECT_STALE)
            continue

        try:
            # One SAVEPOINT per event: a failure rolls back that event alone
            # and the rest of the backlog still lands.
            async with db.begin_nested():
                inserted = await _insert(
                    db, trip=trip, driver=driver, event=event, recorded_at=recorded_at
                )
                if inserted is None:
                    result.duplicates_ignored += 1
                    result.settled.append(event.device_event_id)
                    continue
                await _side_effects(db, trip=trip, driver=driver, event=event, now=now)
        except Exception:  # noqa: BLE001 - a poison event must not block the queue
            # Broad on purpose, logged with a traceback for the same reason
            # offline_package logs its absorbed failure: a constraint violation
            # from a malformed payload and a bug in this module both arrive
            # here, and the two need very different responses. Neither may stop
            # the SOS behind it from being delivered.
            logger.exception(
                "device event %s (%s) on trip %s could not be applied; parked",
                event.device_event_id,
                event.kind.value,
                trip.id,
            )
            result.reject(event.device_event_id, REJECT_UNPROCESSABLE)
            continue

        result.accepted += 1
        result.settled.append(event.device_event_id)

    await db.commit()
    return result
