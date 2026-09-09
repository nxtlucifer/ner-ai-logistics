"""Generate parity fixtures by running the REAL route_progress implementation.

The TypeScript port in supabase/functions/_shared/routeProgress.ts must agree
with app/domain/route_progress.py exactly. Fixtures are produced here, from the
Python module itself, rather than hand-written from what the port is expected to
do - a hand-written expectation only proves the porter and the tester made the
same mistake.

Cases cover what the migration brief asks for: missing and stale GPS, invalid
and degenerate geometry, segment projection, off-route distance, progress
boundaries, remaining-time semantics, and reason codes - plus a deterministic
pseudo-random sweep so the comparison is not limited to cases someone thought of.
"""

from __future__ import annotations

import json
import random
import sys
from dataclasses import asdict
from pathlib import Path

# Run as a plain script from anywhere: the backend package root has to be on the
# path before `app` resolves.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.domain.route_progress import assess

OUT = Path(__file__).resolve().parents[2] / "supabase" / "functions" / "_shared" / "routeProgress.fixtures.json"

# A real corridor shape: Guwahati -> Jorhat, coarsely.
CORRIDOR: list[tuple[float, float]] = [
    (26.1445, 91.7362),
    (26.1800, 92.0000),
    (26.3500, 92.6800),
    (26.4500, 93.2000),
    (26.6000, 93.8000),
    (26.7509, 94.2037),
]

# A route that doubles back on itself, so "nearest segment wins" is exercised.
SELF_CROSSING: list[tuple[float, float]] = [
    (26.0000, 91.0000),
    (26.0000, 91.5000),
    (26.0100, 91.5000),
    (26.0100, 91.0000),
]


def case(name: str, **kwargs) -> dict:
    result = assess(**kwargs)
    payload = asdict(result)
    payload["reason_codes"] = list(result.reason_codes)
    return {
        "name": name,
        "input": {
            "geometry": [list(p) for p in kwargs.get("geometry", [])],
            "position": list(kwargs["position"]) if kwargs.get("position") else None,
            "plannedDurationMin": kwargs.get("planned_duration_min"),
            "plannedDistanceKm": kwargs.get("planned_distance_km"),
        },
        "expected": payload,
    }


def build() -> list[dict]:
    cases: list[dict] = []
    g = CORRIDOR

    # --- boundaries ---------------------------------------------------------
    cases.append(case("at the start", geometry=g, position=g[0]))
    cases.append(case("at the end", geometry=g, position=g[-1]))
    cases.append(case("on a middle vertex", geometry=g, position=g[3]))
    cases.append(case("within a segment", geometry=g, position=(26.163, 91.868)))

    # --- clamping -----------------------------------------------------------
    cases.append(case("before the start clamps to 0", geometry=g, position=(26.10, 91.50)))
    cases.append(case("past the end clamps to 1", geometry=g, position=(26.90, 94.60)))

    # --- missing / degenerate ----------------------------------------------
    cases.append(case("no position", geometry=g, position=None))
    cases.append(case("empty geometry", geometry=[], position=g[0]))
    cases.append(case("single vertex", geometry=[g[0]], position=g[0]))
    cases.append(case("zero-length line", geometry=[g[0], g[0]], position=g[0]))
    cases.append(case("zero-length line, three identical vertices",
                      geometry=[g[0], g[0], g[0]], position=g[0]))

    # --- off route ----------------------------------------------------------
    cases.append(case("just inside the corridor", geometry=g, position=(26.14460, 91.73780)))
    cases.append(case("far off the corridor", geometry=g, position=(25.50, 92.00)))
    cases.append(case("off route but figures still returned",
                      geometry=g, position=(27.50, 93.00), planned_duration_min=300.0))

    # --- remaining-time semantics ------------------------------------------
    cases.append(case("with duration", geometry=g, position=g[2], planned_duration_min=420.0))
    cases.append(case("zero duration is absent", geometry=g, position=g[2], planned_duration_min=0.0))
    cases.append(case("negative duration is absent", geometry=g, position=g[2], planned_duration_min=-10.0))
    cases.append(case("no duration", geometry=g, position=g[2], planned_duration_min=None))

    # --- provider distance scaling -----------------------------------------
    cases.append(case("provider distance scales lengths",
                      geometry=g, position=g[2], planned_distance_km=305.4))
    cases.append(case("provider distance with duration",
                      geometry=g, position=g[2], planned_distance_km=305.4, planned_duration_min=420.0))
    cases.append(case("zero provider distance ignored",
                      geometry=g, position=g[2], planned_distance_km=0.0))
    cases.append(case("negative provider distance ignored",
                      geometry=g, position=g[2], planned_distance_km=-5.0))

    # --- self-crossing route ------------------------------------------------
    cases.append(case("self crossing, nearest segment wins",
                      geometry=SELF_CROSSING, position=(26.0050, 91.2500)))
    cases.append(case("self crossing, on the return leg",
                      geometry=SELF_CROSSING, position=(26.0099, 91.2500)))

    # --- deterministic sweep ------------------------------------------------
    rng = random.Random(20260907)
    for i in range(60):
        lat = 25.6 + rng.random() * 1.6
        lon = 90.9 + rng.random() * 3.6
        dur = rng.choice([None, 0.0, 60.0, 420.0, 1000.5])
        dist = rng.choice([None, 0.0, -1.0, 120.0, 305.4])
        cases.append(case(f"sweep {i}", geometry=g, position=(lat, lon),
                          planned_duration_min=dur, planned_distance_km=dist))

    return cases


if __name__ == "__main__":
    cases = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(cases, indent=1), encoding="utf-8")
    print(f"{len(cases)} fixtures -> {OUT}")
