"""Driver push notifications - Expo Push API, one row per send.

WHY THE BACKEND PUSHES
The app's own polls cannot alert a driver whose screen is off: React Native
stops JS timers when the activity pauses (certified on the phone, 13 Sep).
So the moment that matters - a trip assigned, a reroute approved, a hazard
ahead - is pushed from here through Expo, and Android shows it.

RULES
  wording   -> the caller words evidence honestly ("High historical landslide
               exposure ahead", never "landslide detected"); this sends text.
  dedupe    -> fingerprint = event + trip + hazard + segment (caller-supplied
               or event:trip). A fingerprint seen within its cooldown is
               recorded as SKIPPED_COOLDOWN and not sent. No spam.
  audit     -> every call, sent or not, is a driver_notifications row.
  isolation -> a push failure is a row and a health mark, never an exception
               into the trip flow that triggered it.
  no token  -> NO_TOKEN row. The in-app card still shows on the next poll.

ponytail: Expo's free push path; FCM directly if Expo's relay is ever the
bottleneck. The one HTTP call is here and only here.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Final

import httpx
from sqlalchemy import event as sa_event
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.identity import Driver
from app.models.operations import DriverNotification
from app.services import http_clients, provider_health

logger = logging.getLogger(__name__)

EXPO_PUSH_URL: Final = "https://exp.host/--/api/v2/push/send"
PROVIDER: Final = "EXPO_PUSH"

#: Seconds before the same fingerprint may be sent again. Lifecycle events
#: are one-shot by nature (fingerprint carries the trip), hazards repeat.
COOLDOWN_S: Final[dict[str, int]] = {
    "TRIP_ASSIGNED": 0,
    "REROUTE_APPROVED": 0,
    "CRITICAL_ROUTE_CHANGE": 0,
}
DEFAULT_COOLDOWN_S: Final = 30 * 60

EVENTS: Final = frozenset({
    "TRIP_ASSIGNED", "REROUTE_APPROVED", "OFFICIAL_WARNING_NEW", "WEATHER_SEVERITY_CHANGED",
    "ROUTE_DANGER_AHEAD", "HOLD_AND_REVIEW", "CRITICAL_ROUTE_CHANGE", "NO_SIGNAL_ZONE_AHEAD",
    "DEMO_SIMULATION", "TRIP_CANCELLED",
    # A manager set a different road on a trip already under way. Distinct
    # from REROUTE_APPROVED, which answers a road the DRIVER proposed: the
    # driver is expecting that one and is not expecting this one.
    "ROUTE_CHANGED",
    # The driver asked to stop. Sent to the driver as an acknowledgement that
    # the request reached somebody, and again when a manager answers it.
    "EMERGENCY_STOP_ACK", "EMERGENCY_RESOLVED",
})


def configured() -> bool:
    return get_settings().PUSH_ENABLED


async def _deliver(token: str, title: str, body: str, data: dict[str, Any] | None) -> str:
    """One POST to Expo. Returns a delivery word, never raises."""
    settings = get_settings()
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if settings.EXPO_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {settings.EXPO_ACCESS_TOKEN}"
    message = {"to": token, "title": title, "body": body, "sound": "default", "priority": "high", "channelId": "alerts", "data": data or {}}
    try:
        resp = await http_clients.get("expo").post(
            EXPO_PUSH_URL, json=message, headers=headers, timeout=settings.PUSH_TIMEOUT_SECONDS
        )
        if resp.status_code != 200:
            provider_health.fail(PROVIDER, provider_health.category(httpx.HTTPStatusError("push", request=resp.request, response=resp), resp.status_code))
            return f"FAILED:http_{resp.status_code}"
        ticket = (resp.json().get("data") or {})
        if isinstance(ticket, list):
            ticket = ticket[0] if ticket else {}
        if ticket.get("status") == "error":
            provider_health.fail(PROVIDER, "ticket_error")
            return f"FAILED:{(ticket.get('details') or {}).get('error', 'ticket')}"
        provider_health.ok(PROVIDER)
        return "SENT"
    except Exception as exc:  # noqa: BLE001 - a push outage must not break a dispatch
        provider_health.fail(PROVIDER, provider_health.category(exc))
        return f"FAILED:{provider_health.category(exc)}"


async def send(
    db: AsyncSession,
    *,
    driver_id: uuid.UUID,
    event: str,
    title: str,
    body: str,
    trip_id: uuid.UUID | None = None,
    fingerprint: str | None = None,
    data: dict[str, Any] | None = None,
) -> DriverNotification:
    """Record and (when due and possible) push one notification. Never commits the caller's work.

    THE PUSH NEVER WAITS INSIDE A TRANSACTION (DBPOOL-08). After the caller's
    commit - which is where every caller sends - our reads are all this
    transaction holds: it is committed before the push, and our row after
    it, so the next send in a loop finds no transaction either. Inside the
    caller's open transaction (caller work, even unflushed, keeps it open)
    nothing is committed here; the row is written QUEUED and the push waits
    for the caller's COMMIT, then runs in the background and records its
    outcome on the row. A rollback sends nothing: the row went with it.
    """
    assert event in EVENTS, event
    own_txn = not db.in_transaction()
    fp = (fingerprint or f"{event}:{trip_id}")[:200]
    now = datetime.now(UTC)
    cooldown = COOLDOWN_S.get(event, DEFAULT_COOLDOWN_S)
    delivery: str
    push: tuple | None = None
    recent = None
    if cooldown:
        recent = await db.scalar(
            select(DriverNotification.id)
            .where(DriverNotification.fingerprint == fp, DriverNotification.sent_at >= now - timedelta(seconds=cooldown))
            # QUEUED counts: that push goes out when its caller commits.
            .where(DriverNotification.delivery.in_(("SENT", "NO_TOKEN", "QUEUED")))
            .limit(1)
        )
    if recent is not None:
        delivery = "SKIPPED_COOLDOWN"
    else:
        token = await db.scalar(select(Driver.push_token).where(Driver.id == driver_id))
        if not configured():
            delivery = "DISABLED"
        elif not token:
            delivery = "NO_TOKEN"
        else:
            push = (token, title, body, {"event": event, "trip_id": str(trip_id) if trip_id else None, **(data or {})})
            if own_txn:
                await db.commit()
                delivery = await _deliver(*push)
            else:
                delivery = "QUEUED"
    row = await _row(db, driver_id, trip_id, event, fp, title, body, delivery)
    if own_txn:
        await db.commit()
    elif push is not None:
        _push_after_commit(db, row.id, push)
    return row


#: Background pushes started by a caller's commit; held so none is collected mid-flight.
_after_commit: set[asyncio.Task] = set()


def _push_after_commit(db: AsyncSession, row_id: uuid.UUID, push: tuple) -> None:
    """Queue `push` until the caller's transaction commits; a rollback drops it."""
    jobs = db.info.get("notify.after_commit")
    if jobs is None:
        jobs = db.info["notify.after_commit"] = []
        loop = asyncio.get_running_loop()

        def committed(_session) -> None:
            for job in jobs:
                task = loop.create_task(_deliver_and_record(*job))
                _after_commit.add(task)
                task.add_done_callback(_after_commit.discard)
            jobs.clear()

        def ended(_session, transaction) -> None:
            if transaction.parent is None:  # the real transaction, not a savepoint
                jobs.clear()

        # after_commit runs before after_transaction_end, so a commit starts
        # the pushes first and a rollback (or close) only ever drops them.
        sa_event.listen(db.sync_session, "after_commit", committed)
        sa_event.listen(db.sync_session, "after_transaction_end", ended)
    jobs.append((row_id, push))


async def _deliver_and_record(row_id: uuid.UUID, push: tuple) -> None:
    from app.db.session import get_sessionmaker

    delivery = await _deliver(*push)
    try:
        async with get_sessionmaker()() as s:
            await s.execute(update(DriverNotification).where(DriverNotification.id == row_id).values(delivery=delivery))
            await s.commit()
    except Exception as exc:  # noqa: BLE001 - the push went; only its record did not
        logger.warning("push %s -> %s, outcome not recorded: %s", row_id, delivery, type(exc).__name__)
        return
    logger.info("push (after commit) %s -> %s", row_id, delivery)


async def _row(db, driver_id, trip_id, event, fp, title, body, delivery) -> DriverNotification:
    row = DriverNotification(driver_id=driver_id, trip_id=trip_id, event=event, fingerprint=fp, title=title[:120], body=body, delivery=delivery)
    db.add(row)
    await db.flush()
    logger.info("push %s %s -> %s", event, driver_id, delivery)
    return row


def status() -> dict[str, Any]:
    """For /ready-style checks: is the relay configured and what did it last do."""
    h = provider_health.snapshot()
    mine = next((r for r in h if r["provider"] == PROVIDER), None)
    return {"enabled": configured(), "state": (mine or {}).get("state", "UNKNOWN")}
