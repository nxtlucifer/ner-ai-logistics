"""DEMO SIMULATION - synthetic hazard evidence for a demonstration, always labelled.

A scenario is injected AFTER the real evidence is gathered and scored, on ONE
route (the trip's selected road), for a bounded number of minutes. It adds the
reason codes a real event of that kind would have produced, the points the
policy gives them, and ALWAYS the code DEMO_SIMULATION_ACTIVE - which both
apps render as "DEMO SIMULATION" from the shared reason-code catalogue. The
deterministic decision (CONTINUE / CAUTION / HOLD_AND_REVIEW /
REROUTE_RECOMMENDED), the driver push, the manager's evidence panel and the
reroute comparison all run unchanged on the labelled score: the alternative
roads are NOT injected, so a bad enough scenario yields a real reroute proposal
and clearing it is the recovery.

Never mixed with a live warning: the simulated codes are added, the real ones
are kept, and the label says which world the score came from.
ponytail: in-process registry (one API instance); off unless
DEMO_SIMULATION_ENABLED. No LLM anywhere here.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, replace
from typing import Final

from app.core.config import get_settings
from app.domain.route_risk import RiskComponent, RouteRisk, _band

REASON_DEMO_SIMULATION_ACTIVE: Final = "DEMO_SIMULATION_ACTIVE"

#: scenario -> (reason codes a real event would carry, points the policy adds)
SCENARIOS: Final[dict[str, tuple[tuple[str, ...], int]]] = {
    "HEAVY_MONSOON_RAIN": (("HEAVY_RAIN_ON_ROUTE",), 40),
    "LANDSLIDE_WARNING_AHEAD": (("OFFICIAL_WARNING_ON_ROUTE", "LANDSLIDE_OFFICIAL_INCIDENT_ON_ROUTE"), 65),
    "FLOOD_HIGH_DISCHARGE": (("RIVER_DISCHARGE_ELEVATED",), 40),
    "ROAD_INCIDENT": (("LANDSLIDE_OFFICIAL_ROAD_CLOSURE",), 75),
    #: One provider gone: weather becomes NOT_AVAILABLE and stays UNKNOWN - the
    #: score must not read as safer because a source went quiet.
    "PROVIDER_FAILURE": (("WEATHER_UNAVAILABLE",), 0),
}
MAX_MINUTES: Final = 180


@dataclass(frozen=True)
class Scenario:
    trip_id: uuid.UUID
    route_id: uuid.UUID
    name: str
    started_at: float
    until: float

    def expired(self, now: float | None = None) -> bool:
        return (now or time.time()) >= self.until


_active: dict[uuid.UUID, Scenario] = {}


def enabled() -> bool:
    return get_settings().DEMO_SIMULATION_ENABLED


def start(trip_id: uuid.UUID, route_id: uuid.UUID, name: str, minutes: int = 30) -> Scenario:
    if name not in SCENARIOS:
        raise ValueError(f"unknown scenario {name}")
    now = time.time()
    sc = Scenario(trip_id=trip_id, route_id=route_id, name=name, started_at=now, until=now + max(1, min(minutes, MAX_MINUTES)) * 60)
    _active[trip_id] = sc
    return sc


def stop(trip_id: uuid.UUID) -> Scenario | None:
    return _active.pop(trip_id, None)


def active(now: float | None = None) -> list[Scenario]:
    now = now or time.time()
    for k in [k for k, v in _active.items() if v.expired(now)]:
        _active.pop(k, None)
    return list(_active.values())


def for_route(route_id: uuid.UUID, now: float | None = None) -> Scenario | None:
    if not enabled():
        return None
    return next((s for s in active(now) if s.route_id == route_id), None)


def apply(route_id: uuid.UUID, risk: RouteRisk, now: float | None = None) -> RouteRisk:
    """The real score, plus the scenario's codes and points, plus the label."""
    sc = for_route(route_id, now)
    if sc is None:
        return risk
    codes, points = SCENARIOS[sc.name]
    reason_codes = tuple(dict.fromkeys((*risk.reason_codes, *codes, REASON_DEMO_SIMULATION_ACTIVE)))
    score = max(0, min(100, risk.score + points))
    component = RiskComponent(code="DEMO_SIMULATION", label=f"Demo simulation: {sc.name.replace('_', ' ').lower()}", points=points,
                              detail="Synthetic evidence injected for a demonstration. Not a live report.")
    out = replace(risk, score=score, band=_band(score), reason_codes=reason_codes, components=(*risk.components, component))
    if sc.name == "PROVIDER_FAILURE":
        out = replace(out, inputs={**risk.inputs, "weather": "NOT_AVAILABLE"},
                      unavailable=tuple(dict.fromkeys((*risk.unavailable, "weather"))), observations_used=0, observations_stale=0)
    return out


def snapshot() -> list[dict]:
    now = time.time()
    return [{"trip_id": str(s.trip_id), "route_id": str(s.route_id), "scenario": s.name,
             "remaining_s": int(s.until - now), "label": REASON_DEMO_SIMULATION_ACTIVE} for s in active(now)]
