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

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Final

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.identity import Driver
from app.models.operations import DriverNotification
from app.services import provider_health

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
    "DEMO_SIMULATION",
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
        async with httpx.AsyncClient(timeout=settings.PUSH_TIMEOUT_SECONDS) as client:
            resp = await client.post(EXPO_PUSH_URL, json=message, headers=headers)
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
    """Record and (when due and possible) push one notification. Flushes, never commits."""
    assert event in EVENTS, event
    fp = (fingerprint or f"{event}:{trip_id}")[:200]
    now = datetime.now(UTC)
    cooldown = COOLDOWN_S.get(event, DEFAULT_COOLDOWN_S)
    delivery: str
    if cooldown:
        recent = await db.scalar(
            select(DriverNotification.id)
            .where(DriverNotification.fingerprint == fp, DriverNotification.sent_at >= now - timedelta(seconds=cooldown))
            .where(DriverNotification.delivery.in_(("SENT", "NO_TOKEN")))
            .limit(1)
        )
        if recent is not None:
            delivery = "SKIPPED_COOLDOWN"
            return await _row(db, driver_id, trip_id, event, fp, title, body, delivery)
    token = await db.scalar(select(Driver.push_token).where(Driver.id == driver_id))
    if not configured():
        delivery = "DISABLED"
    elif not token:
        delivery = "NO_TOKEN"
    else:
        delivery = await _deliver(token, title, body, {"event": event, "trip_id": str(trip_id) if trip_id else None, **(data or {})})
    return await _row(db, driver_id, trip_id, event, fp, title, body, delivery)


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
