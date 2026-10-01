"""Route-ahead intelligence worker: the 60-second coordinator tick.

ONE LOOP, NOT ONE CALL PER PROVIDER PER MINUTE
    tick (60 s)                    -> which trips are moving?
    per trip, at most every         -> corridor AHEAD of the truck (30-100 km
    ROUTE_WATCH_REFRESH_SECONDS        by speed) through the SAME evidence
                                       gather and the SAME deterministic risk
                                       policy the Navigate screen uses
    material change?               -> one push per (event, trip, hazard), on
                                       the notify service's cooldown
The tick is cheap (one SELECT). Providers are asked only when a trip's refresh
is due, and each provider still applies its own cache/TTL underneath
(warnings feed per TTL, terrain per route, flood per route-day). Nothing here
calls a provider directly.

WHAT IS PUSHED (wording is honest about evidence class)
    HOLD_AND_REVIEW          the ahead window's decision became HOLD_AND_REVIEW
    OFFICIAL_WARNING_NEW     an official (NDMA CAP) alert now covers the road ahead
    WEATHER_SEVERITY_CHANGED heavy rain / high wind / elevated river discharge appeared
    ROUTE_DANGER_AHEAD       HIGH historical landslide exposure ahead - "exposure",
                             never "landslide happening"
CAUTION alone is not pushed: the in-app card carries it; a push is for the
moments a driver must not miss with the screen off.

A provider failure degrades that trip's evidence for this pass and is logged;
it never stops the loop or another trip. No LLM anywhere in this module.
ponytail: per-process state (restart re-observes; cooldown rows stop repeats).
With MULTI_INSTANCE only the lease holder ticks (_still_leading). It renews the
lease before every trip it assesses, and an instance that finds it has lost the
lease, or cannot tell, stops and forgets _STATE, so every lease gain re-observes
like a restart. Each trip's push rows are committed before the next trip.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.domain import route_progress
from app.domain.reroute import DECISION_HOLD, driver_decision
from app.domain.route_risk import RouteRisk, assess
from app.domain.routing import haversine_m, parse_wkt_linestring, sample_positions
from app.domain.traffic import estimate as traffic_estimate
from app.models.enums import TripStatus
from app.models.operations import Trip
from app.services import coordination, notify, simulation, telemetry
from app.services import traffic as traffic_service
from app.services.driver_trips import IN_PROGRESS_STATUSES
from app.services.route_risk import ROUTE_SAMPLES, _route_facts, evidence_for

logger = logging.getLogger(__name__)

HORIZON_MIN_KM = 30.0
HORIZON_MAX_KM = 100.0
#: Hours of travel at the truck's current speed the window looks ahead.
HORIZON_HOURS = 1.5
DEFAULT_HORIZON_KM = 60.0

WEATHER_CODES = frozenset({"HEAVY_RAIN_ON_ROUTE", "HIGH_WIND_GUSTS", "RIVER_DISCHARGE_ELEVATED"})
WARNING_CODE = "OFFICIAL_WARNING_ON_ROUTE"


@dataclass(frozen=True)
class Ahead:
    """What the window ahead looked like at one refresh."""

    decision: str
    codes: frozenset[str]
    exposure: str | None
    horizon_km: float
    fraction_complete: float | None
    band: str


@dataclass
class Watched:
    last_assessed: float
    ahead: Ahead


_STATE: dict[uuid.UUID, Watched] = {}
#: time.monotonic() of the last route_watch lease call that won (MULTI_INSTANCE).
_renewed_at: float | None = None


def horizon_km(speed_kmph: float | None) -> float:
    if speed_kmph is None or speed_kmph <= 0:
        return DEFAULT_HORIZON_KM
    return min(HORIZON_MAX_KM, max(HORIZON_MIN_KM, speed_kmph * HORIZON_HOURS))


def ahead_slice(geometry: list[tuple[float, float]], fraction: float | None, km: float) -> list[tuple[float, float]]:
    """Vertices from the truck's progress point to `km` further along. No
    fix -> the whole route (the honest window when position is unknown)."""
    if fraction is None or len(geometry) < 2:
        return geometry
    cum = [0.0]
    for (a, b), (c, d) in zip(geometry, geometry[1:]):
        cum.append(cum[-1] + haversine_m(a, b, c, d))
    start = max(0.0, min(1.0, fraction)) * cum[-1]
    end = start + km * 1000.0
    out = [p for p, s in zip(geometry, cum) if start <= s <= end]
    if len(out) < 2:
        # Near the end of the route: keep at least the last two vertices.
        out = geometry[-2:]
    return out


def changes(prev: Ahead | None, now: Ahead) -> list[tuple[str, str, str, str]]:
    """(event, title, body, hazard) for every material worsening between two
    looks. Pure, deterministic, tested."""
    out: list[tuple[str, str, str, str]] = []
    was = prev.codes if prev else frozenset()
    new = now.codes - was
    if now.decision == DECISION_HOLD and (prev is None or prev.decision != DECISION_HOLD):
        out.append(("HOLD_AND_REVIEW", "Hold and review", f"The next {now.horizon_km:.0f} km are HIGH risk right now. Stop safely and contact dispatch.", "HOLD"))
    if WARNING_CODE in new:
        out.append(("OFFICIAL_WARNING_NEW", "Official warning on your route", "An official alert (NDMA) covers the road ahead. Open Navigate for the details.", WARNING_CODE))
    weather = sorted(new & WEATHER_CODES)
    if weather:
        words = {"HEAVY_RAIN_ON_ROUTE": "heavy rain", "HIGH_WIND_GUSTS": "high wind gusts", "RIVER_DISCHARGE_ELEVATED": "elevated river discharge"}
        out.append(("WEATHER_SEVERITY_CHANGED", "Weather worsening ahead", f"Reported ahead: {', '.join(words[c] for c in weather)}. Slow down; check Navigate.", "+".join(weather)))
    if now.exposure == "HIGH" and (prev is None or prev.exposure != "HIGH"):
        out.append(("ROUTE_DANGER_AHEAD", "High historical landslide exposure ahead", f"Recorded landslide sites lie within 5 km of the next {now.horizon_km:.0f} km. Slow on cut slopes, especially in rain. History, not a live report.", "LANDSLIDE_HISTORY_HIGH"))
    return out


async def look_ahead(db: AsyncSession, trip_id: uuid.UUID, route_id: uuid.UUID) -> tuple[Ahead, RouteRisk]:
    wkt, distance_km, duration_min = await _route_facts(db, route_id)
    geometry = parse_wkt_linestring(wkt)
    fix = await telemetry.latest_position(db, trip_id)
    probes = await traffic_service.samples_for(db, route_id)
    await db.commit()  # release the connection before the provider fan-out

    total_km = float(distance_km) if distance_km is not None else 0.0
    total_min = float(duration_min) if duration_min is not None else 0.0
    progress = route_progress.assess(
        geometry=geometry, position=(fix.lat, fix.lon) if fix else None,
        planned_duration_min=total_min or None, planned_distance_km=total_km or None,
    )
    km = horizon_km(fix.speed_kmph if fix else None)
    window = ahead_slice(geometry, progress.fraction_complete, km)
    positions = sample_positions(window, ROUTE_SAMPLES)
    # Terrain is cached per route (whole route, static): the full geometry keeps
    # that cache honest. Everything point-based sees only the window ahead.
    observations, landslide, terrain, history, flood, warnings = await evidence_for(route_id, geometry, positions)
    share = (1.0 - (progress.fraction_complete or 0.0)) if total_km else 1.0
    risk = simulation.apply(route_id, assess(
        distance_km=min(km, total_km * share) if total_km else km,
        duration_min=total_min * share,
        observations=observations, landslide=landslide, terrain=terrain, history=history, flood=flood, warnings=warnings,
        traffic=traffic_estimate(geometry=geometry, samples=probes, distance_km=total_km, duration_min=total_min),
    ))
    exposure = risk.history.exposure.value if risk.history else None
    decision = driver_decision(risk.band, None, reason_codes=risk.reason_codes, history_exposure=exposure)
    return Ahead(decision=decision, codes=frozenset(risk.reason_codes), exposure=exposure, horizon_km=km,
                 fraction_complete=progress.fraction_complete, band=risk.band), risk


async def _still_leading(holder: str | None) -> bool:
    """May this instance go on? Always, on a single instance (no query).

    With MULTI_INSTANCE, only while it holds the route_watch lease, renewed on
    every call. Whenever the lease may have been lost, _STATE is dropped: what
    it remembers stopped being true while another instance watched, and a stale
    "already told the driver" would swallow a hazard that came back. That is
    when the lease is refused, when the call fails (not leading; the tick ends
    and commits what it pushed), and when a win comes more than one TTL after
    the last (a stall: the lease lapsed, maybe to a leader that since died).
    """
    global _renewed_at
    settings = get_settings()
    asked = time.monotonic()
    try:
        leading = await coordination.my_turn("route_watch", settings.ROUTE_WATCH_TICK_SECONDS, holder=holder)
    except Exception as exc:  # noqa: BLE001 - a lease we cannot confirm is not ours
        logger.warning("route watch: lease check failed, standing down (%s)", type(exc).__name__)
        leading = False
    if not leading:
        _STATE.clear()
        return False
    if settings.MULTI_INSTANCE:
        ttl = settings.ROUTE_WATCH_TICK_SECONDS * coordination.LEASE_INTERVALS
        if _renewed_at is not None and time.monotonic() - _renewed_at > ttl:
            _STATE.clear()
        _renewed_at = asked
    return True


async def run_tick(db: AsyncSession, *, now: float | None = None, holder: str | None = None) -> list[dict]:
    """One coordinator pass. Returns what it did, for logs and tests.
    `holder` stands in for coordination.INSTANCE_ID in tests."""
    settings = get_settings()
    now = now or time.time()
    if not await _still_leading(holder):
        return []
    rows = (
        await db.execute(
            select(Trip.id, Trip.driver_id, Trip.selected_route_id)
            .where(Trip.status.in_(IN_PROGRESS_STATUSES), Trip.selected_route_id.is_not(None))
        )
    ).all()
    live = {r.id for r in rows}
    for gone in [t for t in _STATE if t not in live]:
        _STATE.pop(gone, None)
    done: list[dict] = []
    for trip_id, driver_id, route_id in rows:
        watched = _STATE.get(trip_id)
        if watched and now - watched.last_assessed < settings.ROUTE_WATCH_REFRESH_SECONDS:
            continue
        # Each trip can wait on provider timeouts, and the first pass after a
        # takeover has every trip due: renew per trip, and stop if it is gone.
        if not await _still_leading(holder):
            break
        try:
            ahead, _risk = await look_ahead(db, trip_id, route_id)
        except Exception as exc:  # noqa: BLE001 - one trip's evidence degrades, the loop lives
            logger.info("route watch: trip %s skipped (%s)", trip_id, type(exc).__name__)
            await db.rollback()
            continue
        events = changes(watched.ahead if watched else None, ahead)
        # End the read transaction before any push (DBPOOL-08): each send
        # then pushes with no connection held and commits its own row.
        await db.commit()
        sent = []
        for event, title, body, hazard in events:
            row = await notify.send(
                db, driver_id=driver_id, trip_id=trip_id, event=event, title=title, body=body,
                fingerprint=f"{event}:{trip_id}:{hazard}", data={"screen": "navigate"},
            )
            sent.append((event, row.delivery))
        _STATE[trip_id] = Watched(last_assessed=now, ahead=ahead)
        # Before the next trip: its rollback, or a later failure in this tick,
        # must not take the record (and cooldown) of a push already delivered.
        await db.commit()
        done.append({"trip_id": str(trip_id), "decision": ahead.decision, "horizon_km": ahead.horizon_km, "events": sent})
    await db.commit()
    return done
