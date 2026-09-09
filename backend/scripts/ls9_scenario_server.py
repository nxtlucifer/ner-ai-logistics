"""LS-9 G3: run the REAL backend against a deterministic landslide source.

    . .\\.runtime\\use-isolated-db.ps1
    python scripts/ls9_scenario_server.py --scenario clear

WHY THIS EXISTS

No landslide source is connected (BLOCKER-1: four probes, all shut), so every
route assesses UNKNOWN and nothing can be selected. That is the correct
production behaviour and it must not be relaxed - but it also means the
manager-to-driver workflow has never been driven end to end through a browser,
because the very first selection is refused.

This launcher supplies a scenario source so that workflow can be demonstrated,
WITHOUT weakening anything:

  * The real routers, real authentication, real geometry reads, real
    `assess_corridor`, real `evaluate` and real `refuse_if_ineligible` run. The
    guard is never patched and no decision is ever pre-approved.
  * The ONLY substitution is at `build_landslide_provider` - the same seam the
    existing API hazard tests use, and the seam that exists precisely so the
    body publishing the data can be swapped.
  * Nothing here is reachable over HTTP. There is no route, query parameter,
    header or permission that switches a running server into scenario mode; the
    provider is chosen once, from argv, before the first request is served.
  * Normal startup (`python run.py`) never imports this file.

FAIL CLOSED

Refuses to start unless the configured target is the dedicated isolated
cluster. Pointing a synthetic hazard source at a shared database would put
fabricated evidence where somebody could later read it as real.

THE DATA IS SYNTHETIC AND SAYS SO

Every fixture in `scripts/ls9_scenarios/` is labelled, carries a
`SYNTHETIC-...` incident id and an `ls9-scenario` source name, so a screenshot
of an incident block can never be mistaken for a real bulletin.

The provider keeps COVERAGE semantics rather than answering for the whole
world: outside its declared box it returns NOT_CONFIGURED, exactly as a real
regional source would. A fixture that answered AVAILABLE everywhere would make
every route on the map eligible at once and would prove nothing about whether
the evidence reached the corridor it was supposed to.
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

# This file lives in scripts/, so the backend root is not on sys.path the way
# it is for run.py. Added here rather than requiring the caller to export
# PYTHONPATH, so the documented command line just works.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.event_loop import configure_event_loop_policy

# Before uvicorn is imported, not merely before it is called - see run.py.
_policy_changed = configure_event_loop_policy()

import uvicorn  # noqa: E402  - deliberate: import order is load-bearing

from app.core.config import get_settings  # noqa: E402
from app.domain.landslide import (  # noqa: E402
    IncidentQueryResult,
    IncidentSource,
    LandslideIncident,
    SourceState,
    SourceType,
    VerificationStatus,
)
from app.services.landslide.base import BoundingBox, LandslideQueryError  # noqa: E402

SCENARIO_DIR = Path(__file__).parent / "ls9_scenarios"

#: The one database this may run against.
EXPECTED_HOST = "127.0.0.1"
EXPECTED_PORT = 55432
EXPECTED_DB = "ner_logistics_test"


class ScenarioLandslideProvider:
    """A landslide source whose answers come from a labelled local fixture.

    Implements the same `LandslideIncidentProvider` protocol as the real thing
    and goes through the same `assess_corridor` rules. It decides nothing about
    eligibility - it returns evidence, and the untouched domain layer draws the
    conclusion.
    """

    def __init__(self, name: str, coverage: BoundingBox, incidents: tuple, state: SourceState):
        self.name = f"ls9-scenario-{name}"
        self._coverage = coverage
        self._incidents = incidents
        self._state = state

    def _covers(self, box: BoundingBox) -> bool:
        """Whether the declared coverage box overlaps the queried corridor."""
        return not (
            box.max_lat < self._coverage.min_lat
            or box.min_lat > self._coverage.max_lat
            or box.max_lon < self._coverage.min_lon
            or box.min_lon > self._coverage.max_lon
        )

    async def incidents_near(
        self, box: BoundingBox, *, since: datetime, until: datetime
    ) -> IncidentQueryResult:
        # The null provider validates this too, so a malformed query is caught
        # with or without a source connected.
        if since > until:
            raise LandslideQueryError("Time window ends before it starts.")

        if not self._covers(box):
            # Outside the area this source covers. NOT_CONFIGURED, not an empty
            # success: "we do not cover that corridor" is a statement about the
            # source, and reporting it as "no incidents" would be a claim about
            # a road nobody looked at.
            return IncidentQueryResult(
                state=SourceState.NOT_CONFIGURED, provider=self.name
            )

        if self._state is not SourceState.AVAILABLE:
            return IncidentQueryResult(state=self._state, provider=self.name)

        # Only incidents actually inside the queried box. Route filtering by
        # distance is `assess_corridor`'s job and is left to it.
        inside = tuple(
            i
            for i in self._incidents
            if i.latitude is not None
            and i.longitude is not None
            and box.min_lat <= i.latitude <= box.max_lat
            and box.min_lon <= i.longitude <= box.max_lon
        )
        return IncidentQueryResult(
            state=SourceState.AVAILABLE, incidents=inside, provider=self.name
        )


def load_scenario(name: str) -> ScenarioLandslideProvider:
    path = SCENARIO_DIR / f"{name}.json"
    if not path.exists():
        available = ", ".join(sorted(p.stem for p in SCENARIO_DIR.glob("*.json")))
        raise SystemExit(f"No scenario {name!r}. Available: {available}")

    spec = json.loads(path.read_text(encoding="utf-8"))
    cov = spec["coverage"]
    incidents = tuple(
        LandslideIncident(
            incident_id=i["incident_id"],
            latitude=i.get("latitude"),
            longitude=i.get("longitude"),
            location_name=i.get("location_name"),
            district=i.get("district"),
            state=i.get("state"),
            road_name=i.get("road_name"),
            highway_code=i.get("highway_code"),
            road_blocked=i.get("road_blocked"),
            verification_status=VerificationStatus(i["verification_status"]),
            sources=tuple(
                IncidentSource(
                    name=s["name"], source_type=SourceType(s["source_type"])
                )
                for s in i.get("sources", ())
            ),
        )
        for i in spec.get("incidents", ())
    )
    return ScenarioLandslideProvider(
        name=name,
        coverage=BoundingBox(
            min_lat=cov["min_lat"],
            min_lon=cov["min_lon"],
            max_lat=cov["max_lat"],
            max_lon=cov["max_lon"],
        ),
        incidents=incidents,
        state=SourceState(spec.get("source_state", "AVAILABLE")),
    )


def assert_isolated_target() -> str:
    """Refuse to serve synthetic hazard evidence against anything shared."""
    settings = get_settings()
    if settings.DATABASE_PROVIDER != "local":
        raise SystemExit(
            f"REFUSED: DATABASE_PROVIDER is {settings.DATABASE_PROVIDER!r}, not "
            "'local'. Arm the isolated cluster first:\n"
            "    . .\\.runtime\\use-isolated-db.ps1"
        )
    # SQLAlchemy's own parser, not urlsplit: the isolated cluster's generated
    # password contains characters that are legal in a DSN but ambiguous to a
    # naive URL split, and getting this wrong here would mean the fail-closed
    # check crashes instead of checking. `make_url` is what the engine itself
    # uses, so this validates exactly the target that will be connected to.
    from sqlalchemy.engine import make_url

    url = make_url(settings.effective_database_url)
    if url.host != EXPECTED_HOST or url.port != EXPECTED_PORT or url.database != EXPECTED_DB:
        raise SystemExit(
            "REFUSED: this launcher only runs against "
            f"{EXPECTED_HOST}:{EXPECTED_PORT}/{EXPECTED_DB}. "
            f"Configured target is {url.host}:{url.port}/{url.database}."
        )
    # Host, port and database only - never the credential.
    return f"{url.host}:{url.port}/{url.database}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", required=True)
    parser.add_argument("--port", type=int, default=None)
    args = parser.parse_args()

    target = assert_isolated_target()
    provider = load_scenario(args.scenario)

    # Patched on the module that CALLS it. `route_risk` did
    # `from ... import build_provider as build_landslide_provider`, so it holds
    # its own reference and patching the defining module would not be seen -
    # the same binding the existing hazard tests patch.
    from app.services import route_risk as route_risk_service

    route_risk_service.build_landslide_provider = lambda: provider

    settings = get_settings()
    port = args.port or settings.API_PORT
    if _policy_changed:
        print("[ls9] Windows: WindowsSelectorEventLoopPolicy set")
    print(f"[ls9] SCENARIO SERVER - synthetic hazard evidence, scenario={args.scenario!r}")
    print(f"[ls9] provider   = {provider.name}")
    print(f"[ls9] target     = {target}")
    print(f"[ls9] port       = {port}")
    print("[ls9] the eligibility guard is NOT patched; only the data source is")

    from app.main import create_app

    # reload=False deliberately: the reloader re-imports app.main in a child
    # process, which would not carry the patch above.
    uvicorn.run(create_app(), host=settings.API_HOST, port=port, log_level="info")


if __name__ == "__main__":
    sys.exit(main())
