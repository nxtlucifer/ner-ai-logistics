#!/usr/bin/env python3
"""Generate src/map/replay.fixtures.json.

SYNTHETIC ON PURPOSE. No driver's recorded journey goes into a fixture: the
corridor here is a shape chosen to contain what real corridors contain and
synthetic ones usually do not - two near-parallel stretches 150 m apart, a
genuine doubling back, and two turns 150 m apart. A fixture built from a real
trace would also put a real person's movements in the repository.

DETERMINISTIC ON PURPOSE. Every offset is written out; there is no RNG. A
replay fixture that does not reproduce is not a fixture.

Run from driver-app/:  python3 scripts/make_replay_fixtures.py
"""

import json
import math
import os

LAT0, LON0 = 26.1400, 91.7000
M_PER_DEG_LAT = 111_320.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(LAT0))

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "map", "replay.fixtures.json")


def at(east_m, north_m):
    """Local-plane metres -> [lat, lon]. The ONE place the conversion happens."""
    return [round(LAT0 + north_m / M_PER_DEG_LAT, 7), round(LON0 + east_m / M_PER_DEG_LON, 7)]


LEG = 3000.0
SEP = 150.0
TAIL = 500.0
STEP = 25.0

points, cum = [], []


def push(p, d):
    points.append(p)
    cum.append(d)


d = 0.0
push(at(0, 0), 0.0)
for i in range(1, int(LEG / STEP) + 1):
    d += STEP
    push(at(i * STEP, 0), d)
for i in range(1, int(SEP / STEP) + 1):
    d += STEP
    push(at(LEG, i * STEP), d)
for i in range(1, int(LEG / STEP) + 1):
    d += STEP
    push(at(LEG - i * STEP, SEP), d)
for i in range(1, int(TAIL / STEP) + 1):
    d += STEP
    push(at(0, SEP + i * STEP), d)
TOTAL = d
assert abs(TOTAL - (LEG + SEP + LEG + TAIL)) < 1e-6, TOTAL


def man(kind, modifier, along, name, exit_=None):
    i = min(range(len(cum)), key=lambda k: abs(cum[k] - along))
    return {
        "type": kind, "modifier": modifier, "lat": points[i][0], "lon": points[i][1],
        "geometry_index": i, "distance_from_start_m": round(along, 1),
        "step_distance_m": 0.0, "duration_s": None, "name": name, "exit": exit_,
    }


maneuvers = [
    man("depart", None, 0.0, "Kamrup Link Road"),
    man("turn", "left", LEG, "Bypass Connector"),
    man("turn", "left", LEG + SEP, "Kamrup Bypass"),
    man("turn", "right", LEG + SEP + LEG, "Depot Approach"),
    man("arrive", None, TOTAL, "Jorhat Depot"),
]
# `step_distance_m` measures FORWARD to the next maneuver - OSRM's
# `step.distance`, not the distance remaining before this one.
for i, m in enumerate(maneuvers[:-1]):
    m["step_distance_m"] = round(
        maneuvers[i + 1]["distance_from_start_m"] - m["distance_from_start_m"], 1
    )
# The provider's final `arrive` step is 0.0 m - verified against OSRM in
# backend/app/services/navigation.py, not taken from the documentation.
maneuvers[-1]["step_distance_m"] = 0.0


def on_route(along):
    for i in range(1, len(cum)):
        if cum[i] >= along:
            t = (along - cum[i - 1]) / (cum[i] - cum[i - 1])
            a, b = points[i - 1], points[i]
            return [round(a[0] + (b[0] - a[0]) * t, 7), round(a[1] + (b[1] - a[1]) * t, 7)]
    return points[-1]


def offset(p, east_m=0.0, north_m=0.0):
    return [round(p[0] + north_m / M_PER_DEG_LAT, 7), round(p[1] + east_m / M_PER_DEG_LON, 7)]


def fix(pos, *, t_ms, accuracy_m=8.0, speed_kmh=60.0, fresh=True):
    return {"lat": pos[0], "lon": pos[1], "at_ms": t_ms, "accuracy_m": accuracy_m,
            "speed_kmh": speed_kmh, "fresh": fresh}


scenarios = {}

SPEED = 60.0 / 3.6
fixes, along, t = [], 0.0, 0
while along < TOTAL:
    fixes.append(fix(on_route(along), t_ms=t, speed_kmh=60.0))
    along += SPEED * 10
    t += 10_000
fixes.append(fix(on_route(TOTAL), t_ms=t, speed_kmh=0.0))
for k in range(1, 4):
    fixes.append(fix(on_route(TOTAL), t_ms=t + k * 10_000, speed_kmh=0.0))
scenarios["normal_drive"] = {
    "note": "Start to destination at 60 km/h, one fix per 10 s, then stationary at the gate.",
    "fixes": fixes,
}

# A truck does not teleport into the ambiguous stretch: it drives up to it on
# clean fixes, which is what establishes the window the matcher then uses. The
# first four fixes are that approach; `ambiguous_from` marks where the 100 m
# error starts. Without the approach this scenario tests the FIRST-FIX case
# instead, which has no memory and legitimately falls back to a global match -
# see `first_fix_ambiguity` below, which tests exactly that.
APPROACH = [533.0, 700.0, 867.0, 1033.0]
TRUE = [1200.0, 1367.0, 1534.0, 1700.0]
fixes = [fix(on_route(a), t_ms=k * 10_000) for k, a in enumerate(APPROACH)]
for k, along in enumerate(TRUE):
    fixes.append(fix(offset(on_route(along), north_m=100.0),
                     t_ms=(len(APPROACH) + k) * 10_000, accuracy_m=25.0))
scenarios["flyover_ambiguity"] = {
    "note": ("Clean approach, then the outbound leg with 100 m northward error - the return "
             "leg 150 m north is then the NEARER line. Progress must not jump to it."),
    "ambiguous_from": len(APPROACH),
    "true_along_m": APPROACH + TRUE,
    "fixes": fixes,
}

# THE HONEST LIMITATION, pinned rather than hidden. The very first fix of a
# session has no previous along-distance, so there is nothing to window against
# and the match is global - which on a doubling-back corridor can pick the wrong
# leg. Resuming navigation mid-route is exactly when this happens.
scenarios["first_fix_ambiguity"] = {
    "note": ("A single ambiguous fix with no prior position: the matcher has no memory to use "
             "and matches globally. Documents the known first-fix limitation."),
    "true_along_m": [1200.0],
    "fixes": [fix(offset(on_route(1200.0), north_m=100.0), t_ms=0, accuracy_m=25.0)],
}

fixes = []
for k, along in enumerate([2600.0, 2800.0, 3000.0]):
    fixes.append(fix(on_route(along), t_ms=k * 10_000))
for k in range(1, 5):
    fixes.append(fix(offset(on_route(LEG), east_m=k * 220.0), t_ms=(2 + k) * 10_000))
scenarios["missed_turn"] = {
    "note": "Straight on at the first left turn. Off-route must be believed only after OFF_ROUTE_FIXES.",
    "fixes": fixes,
}

WANDER = [(0, 0), (9, -6), (-11, 4), (6, 12), (-8, -9), (13, 3), (-4, -13), (7, 8)]
scenarios["stationary_jitter"] = {
    "note": "Parked at 1000 m with a 22 m accuracy circle. No reroute, no arrival, no marker flight.",
    "fixes": [
        fix(offset(on_route(1000.0), east_m=e, north_m=n), t_ms=k * 5_000,
            accuracy_m=22.0, speed_kmh=0.0)
        for k, (e, n) in enumerate(WANDER)
    ],
}

fixes = [fix(on_route(a), t_ms=k * 10_000) for k, a in enumerate([800.0, 967.0, 1134.0])]
for k in range(3):
    fixes.append(fix(on_route(1134.0), t_ms=(3 + k) * 10_000, fresh=False))
for k, a in enumerate([2100.0, 2267.0]):
    fixes.append(fix(on_route(a), t_ms=(6 + k) * 10_000))
scenarios["gps_loss_recovery"] = {
    "note": "A gap with no usable fix, then re-acquisition 1 km further on.",
    "fixes": fixes,
}

out = {
    "version": "navigation-replay-v1",
    "note": (
        "SYNTHETIC. Generated by scripts/make_replay_fixtures.py, not recorded from any "
        "real journey - no driver's route is in this file. Local-plane metres converted "
        "once, at the top of the generator."
    ),
    "route": {
        "route_id": "replay-route-1",
        "distance_m": round(TOTAL, 1),
        "geometry": points,
        "maneuvers": maneuvers,
        "destination": points[-1],
    },
    "scenarios": scenarios,
}

with open(OUT, "w") as f:
    json.dump(out, f, indent=1)
    f.write("\n")
print(f"wrote {OUT}: route {TOTAL:.0f} m, {len(points)} vertices, {len(maneuvers)} maneuvers")
