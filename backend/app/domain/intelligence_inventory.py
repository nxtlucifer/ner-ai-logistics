"""The exact inventory of "intelligence" in this repository, by category.

Counted by reading the code, not by what the marketing says. Every row names
the module so a judge can open it. Categories:

    TRUE_LOCAL_ML              a trained model executing locally      (none)
    LOCAL_LLM                  a local language model                  (none)
    DETERMINISTIC_INTELLIGENCE rules / thresholds / decision engines
    GEOMETRIC_ALGORITHM        projection, routing geometry, filters
    STATISTICAL_MODEL          fitted / calibrated statistical models  (none)
    OFFLINE_KNOWLEDGE_SYSTEM   bundled lookups: phrasebook, guide, codes
    ONLINE_LLM                 cloud models that WORD answers, never decide
    PROVIDER_MODEL_OUTPUT      external providers' model products

`services/inference.py` (an Ollama client) is NOT counted: no model has ever
been installed and it has never produced a token. The device speech engine is
the platform's, not ours, and is not counted either.

This list is served on /api/system/providers so the manager's System page and
the final report read the same numbers.
"""

from typing import Final

INVENTORY: Final[list[tuple[str, str, str]]] = [
    # (category, module, what it is)
    ("TRUE_LOCAL_ML_EXPERIMENTAL", "backend/scripts/hazard_validation/experiments_v2.py", "landslide-day logistic regression (NER slice; season-matched negatives expose a seasonality confound) - EXPERIMENTAL, not deployed"),
    ("DETERMINISTIC_INTELLIGENCE", "backend/app/domain/route_risk.py", "11-factor route risk: points, bands, reason codes; UNKNOWN is not safe"),
    ("DETERMINISTIC_INTELLIGENCE", "backend/app/domain/route_eligibility.py", "landslide-inventory refusal rule"),
    ("DETERMINISTIC_INTELLIGENCE", "backend/app/domain/route_recommendation.py", "compare route options by evidence"),
    ("DETERMINISTIC_INTELLIGENCE", "backend/app/domain/reroute.py", "reroute governance: human authorises, never automatic"),
    ("DETERMINISTIC_INTELLIGENCE", "backend/app/domain/monsoon_risk.py", "monsoon-risk-engine-v1 weighted rule"),
    ("DETERMINISTIC_INTELLIGENCE", "backend/app/domain/road_memory.py", "evidence log; silence is not evidence"),
    ("DETERMINISTIC_INTELLIGENCE", "backend/app/domain/sentinel.py", "fleet sentinel: stationary/escalation rules"),
    ("DETERMINISTIC_INTELLIGENCE", "backend/app/domain/weather.py", "weather thresholds, freshness"),
    ("DETERMINISTIC_INTELLIGENCE", "backend/app/domain/flood.py", "discharge-vs-30-day-mean context bands"),
    ("DETERMINISTIC_INTELLIGENCE", "backend/app/domain/landslide.py", "historical exposure by distance to recorded events"),
    ("DETERMINISTIC_INTELLIGENCE", "backend/app/domain/warnings.py", "CAP alert parsing, expiry, corridor district match"),
    ("DETERMINISTIC_INTELLIGENCE", "backend/app/domain/traffic.py", "fleet traffic: median observed vs planned pace"),
    ("DETERMINISTIC_INTELLIGENCE", "backend/app/domain/fuel_model.py", "physics-informed fuel baseline (hand-set constants)"),
    ("DETERMINISTIC_INTELLIGENCE", "driver-app/src/navigation/routeAi.ts", "Personal Route AI: fixed policy + explanation over route_risk"),
    ("DETERMINISTIC_INTELLIGENCE", "driver-app/src/assistant/intents.ts", "offline NLU: keyword intent matching, five languages"),
    ("DETERMINISTIC_INTELLIGENCE", "driver-app/src/assistant/assistant.ts", "assistant answers from application state; health guidance"),
    ("DETERMINISTIC_INTELLIGENCE", "driver-app/src/safety/breaks.ts", "break advice thresholds"),
    ("DETERMINISTIC_INTELLIGENCE", "driver-app/src/notify/local.ts", "danger alert dedupe/cooldown"),
    ("DETERMINISTIC_INTELLIGENCE", "backend/app/services/route_watch.py", "route-ahead worker: corridor window by speed, material-change detection -> push events"),
    ("DETERMINISTIC_INTELLIGENCE", "backend/app/services/notify.py", "push dedupe: fingerprint + per-event cooldown"),
    ("GEOMETRIC_ALGORITHM", "backend/app/domain/route_progress.py", "projection onto the route line, off-route threshold"),
    ("GEOMETRIC_ALGORITHM", "backend/app/domain/terrain.py", "slope/gradient from sampled DEM heights"),
    ("GEOMETRIC_ALGORITHM", "driver-app/src/map/navState.ts", "on-device projection with hysteresis (200/80 m, 3 fixes)"),
    ("GEOMETRIC_ALGORITHM", "driver-app/src/map/maneuvers.ts", "next-turn selection from OSRM steps"),
    ("GEOMETRIC_ALGORITHM", "driver-app/src/tracking/speed.ts", "stationary-speed filter: accuracy-aware displacement + hysteresis"),
    ("OFFLINE_KNOWLEDGE_SYSTEM", "driver-app/src/phrasebook", "roadside phrasebook (bundled)"),
    ("OFFLINE_KNOWLEDGE_SYSTEM", "driver-app/src/safety/guide.json", "reviewed safety guide en/hi/as"),
    ("OFFLINE_KNOWLEDGE_SYSTEM", "driver-app/src/i18n/reasonCodes.json", "reason-code catalogue en/hi/as"),
    ("OFFLINE_KNOWLEDGE_SYSTEM", "backend/app/services/places/snapshot.py", "OSM corridor snapshot of roadside services"),
    ("ONLINE_LLM", "backend/app/services/gemini.py", "Gemini Developer API (primary) - wording only"),
    ("ONLINE_LLM", "backend/app/services/gemini.py", "OpenRouter free models (fallback) - wording only"),
    ("PROVIDER_MODEL_OUTPUT", "backend/app/services/weather/open_meteo.py", "Open-Meteo current/hourly (ECMWF/GFS/ICON blend)"),
    ("PROVIDER_MODEL_OUTPUT", "backend/app/services/weather/open_meteo.py", "MET Norway locationforecast (fallback)"),
    ("PROVIDER_MODEL_OUTPUT", "backend/app/services/flood.py", "GloFAS river discharge via Open-Meteo flood API"),
    ("PROVIDER_MODEL_OUTPUT", "backend/app/services/terrain.py", "Copernicus DEM (Open-Meteo elevation) / SRTM (OpenTopoData)"),
    ("PROVIDER_MODEL_OUTPUT", "backend/app/services/routing/osrm.py", "OSRM routing engine"),
]

CATEGORIES: Final[tuple[str, ...]] = (
    "TRUE_LOCAL_ML",
    #: trained, held-out tested, registered EXPERIMENTAL - executes in research
    #: scripts only, never in a route decision (docs/MODEL_REGISTRY.md)
    "TRUE_LOCAL_ML_EXPERIMENTAL",
    "LOCAL_LLM",
    "DETERMINISTIC_INTELLIGENCE",
    "GEOMETRIC_ALGORITHM",
    "STATISTICAL_MODEL",
    "OFFLINE_KNOWLEDGE_SYSTEM",
    "ONLINE_LLM",
    "PROVIDER_MODEL_OUTPUT",
)


def counts() -> dict[str, int]:
    out = {c: 0 for c in CATEGORIES}
    for category, _, _ in INVENTORY:
        out[category] += 1
    return out


def totals() -> dict[str, int]:
    c = counts()
    return {
        "TOTAL_TRUE_LOCAL_AI": c["TRUE_LOCAL_ML"] + c["LOCAL_LLM"] + c["STATISTICAL_MODEL"],
        "TRUE_LOCAL_ML_PRODUCTION": c["TRUE_LOCAL_ML"],
        "TRUE_LOCAL_ML_EXPERIMENTAL": c["TRUE_LOCAL_ML_EXPERIMENTAL"],
        "TOTAL_LOCAL_INTELLIGENCE": c["DETERMINISTIC_INTELLIGENCE"] + c["GEOMETRIC_ALGORITHM"] + c["OFFLINE_KNOWLEDGE_SYSTEM"],
    }
