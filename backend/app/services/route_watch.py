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
ponytail: per-process state (restart re-observes; cooldown rows stop repeats);
a table when the API runs on more than one instance.
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
from app.services import notify, simulation, telemetry
from app.services import traffic as traffic_service
from app.services import connectivity as connectivity_service
from app.domain import connectivity as connectivity_domain
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
    #: Kilometres of the window this fleet's phones have driven with no
    #: dependable data path (WEAK + DEAD_ZONE). 0.0 when none is known.
    signal_gap_km: float = 0.0


@dataclass
class Watched:
    last_assessed: float
    ahead: Ahead


_STATE: dict[uuid.UUID, Watched] = {}


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
    # A stretch with no data path entered the window. Once per episode: the
    # cooldown on the notify side stops a repeat while the gap stays ahead.
    if now.signal_gap_km > 0.0 and (prev is None or prev.signal_gap_km <= 0.0):
        out.append(("NO_SIGNAL_ZONE_AHEAD", "Weak or no signal ahead", f"Fleet phones lost data on {now.signal_gap_km:.0f} km of the next {now.horizon_km:.0f} km. Your trip kit is being prepared; guidance continues offline.", "SIGNAL_GAP"))
    return out


async def look_ahead(db: AsyncSession, trip_id: uuid.UUID, route_id: uuid.UUID) -> tuple[Ahead, RouteRisk]:
    wkt, distance_km, duration_min = await _route_facts(db, route_id)
    geometry = parse_wkt_linestring(wkt)
    fix = await telemetry.latest_position(db, trip_id)
    probes = await traffic_service.samples_for(db, route_id)
    delays = await connectivity_service.samples_for(db, route_id)
    await db.commit()  # release the connection before the provider fan-out

    total_km = float(distance_km) if distance_km is not None else 0.0
    total_min = float(duration_min) if duration_min is not None else 0.0
    progress = route_progress.assess(
        geometry=geometry, position=(fix.lat, fix.lon) if fix else None,
        planned_duration_min=total_min or None, planned_distance_km=total_km or None,
    )
    km = horizon_km(fix.speed_kmph if fix else None)
    window = ahead_slice(geometry, progress.fraction_complete, km)
    # Connectivity is graded on the whole line and then clipped to the window,
    # so the segments a phone caches and the ones this worker warns about are
    # the same segments.
    full_connectivity = connectivity_domain.estimate(geometry=geometry, samples=delays)
    total_m = sum(seg.length_m for seg in full_connectivity.segments)
    start_m = max(0.0, min(1.0, progress.fraction_complete or 0.0)) * total_m
    connectivity = connectivity_domain.window(full_connectivity, start_m, start_m + km * 1000.0)
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
        connectivity=connectivity,
    ))
    exposure = risk.history.exposure.value if risk.history else None
    decision = driver_decision(risk.band, None, reason_codes=risk.reason_codes, history_exposure=exposure)
    signal_gap_km = risk.connectivity.exposure_km if risk.connectivity is not None else 0.0
    return Ahead(decision=decision, codes=frozenset(risk.reason_codes), exposure=exposure, horizon_km=km,
                 fraction_complete=progress.fraction_complete, band=risk.band, signal_gap_km=signal_gap_km), risk


async def run_tick(db: AsyncSession, *, now: float | None = None) -> list[dict]:
    """One coordinator pass. Returns what it did, for logs and tests."""
    settings = get_settings()
    now = now or time.time()
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
        try:
            ahead, _risk = await look_ahead(db, trip_id, route_id)
        except Exception as exc:  # noqa: BLE001 - one trip's evidence degrades, the loop lives
            logger.info("route watch: trip %s skipped (%s)", trip_id, type(exc).__name__)
            await db.rollback()
            continue
        events = changes(watched.ahead if watched else None, ahead)
        sent = []
        for event, title, body, hazard in events:
            row = await notify.send(
                db, driver_id=driver_id, trip_id=trip_id, event=event, title=title, body=body,
                fingerprint=f"{event}:{trip_id}:{hazard}", data={"screen": "navigate"},
            )
            sent.append((event, row.delivery))
        _STATE[trip_id] = Watched(last_assessed=now, ahead=ahead)
        done.append({"trip_id": str(trip_id), "decision": ahead.decision, "horizon_km": ahead.horizon_km, "events": sent})
    await db.commit()
    return done
