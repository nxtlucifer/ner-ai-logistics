"""Provider health: what each external data source last did, for the System page.

One in-memory registry, written by every adapter at the moment it succeeds or
fails, read by `GET /api/system/providers`. It answers the questions a
dispatcher asks when a route says UNKNOWN: which source, when did it last
answer, how old is its data, what went wrong. Never a key, a URL with a key,
or a response body - the error is a CATEGORY (timeout, http_429, unparseable).

FRESHNESS is judged against each product's own cadence, not one clock:
    FRESH    age <= cadence
    AGING    age <= 3 x cadence
    STALE    age >  3 x cadence
    EXPIRED  the data carries a validity window and it has passed
    UNKNOWN  never answered
A static dataset (the landslide inventory) is STATIC: it has a vintage, not a
refresh.

# ponytail: process-local, like every other cache in services/. A shared
# store if a second worker ever runs.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Any, Final

#: Refresh cadence (seconds) a product is EXPECTED to keep. Official warnings
#: are polled often and bounded; weather is per-route on demand; the flood
#: model publishes daily; the inventory is a vintage.
CADENCE_S: Final[dict[str, int]] = {
    "NDMA_SACHET": 15 * 60,
    "OPEN_METEO": 60 * 60,
    "MET_NORWAY": 60 * 60,
    "GLOFAS": 24 * 60 * 60,
    "OPEN_METEO_ELEVATION": 30 * 24 * 60 * 60,
    "OPENTOPODATA": 30 * 24 * 60 * 60,
    "OSRM": 24 * 60 * 60,
    "NOMINATIM": 24 * 60 * 60,
    "OVERPASS": 24 * 60 * 60,
    "GOOGLE_GEMINI": 24 * 60 * 60,
    "OPENROUTER": 24 * 60 * 60,
    "EXPO_PUSH": 24 * 60 * 60,
}

PRODUCT: Final[dict[str, tuple[str, str]]] = {
    # provider -> (product, evidence class)
    "NDMA_SACHET": ("CAP alerts (IMD, CWC, GSI, DGRE, INCOIS)", "OFFICIAL_WARNING"),
    "OPEN_METEO": ("Current weather + hourly forecast", "MODEL_CURRENT"),
    "MET_NORWAY": ("Locationforecast (Open-Meteo fallback)", "FORECAST"),
    "GLOFAS": ("River discharge vs 30-day mean", "MODEL_HAZARD"),
    "NASA_GLC": ("Global Landslide Catalog snapshot", "HISTORICAL_INVENTORY"),
    "OPEN_METEO_ELEVATION": ("Copernicus DEM elevation", "MEASURED_OBSERVATION"),
    "OPENTOPODATA": ("SRTM elevation (fallback)", "MEASURED_OBSERVATION"),
    "OSRM": ("Road routing", "ROUTING"),
    "NOMINATIM": ("Geocoding / district lookup", "REFERENCE"),
    "OVERPASS": ("Roadside services (OSM)", "REFERENCE"),
    "GOOGLE_GEMINI": ("Assistant wording", "ONLINE_LLM"),
    "OPENROUTER": ("Assistant wording (fallback)", "ONLINE_LLM"),
    "EXPO_PUSH": ("Driver push notifications", "NOT_AI"),
    # No SMS gateway is integrated. The row exists so Diagnostics says
    # NOT_CONFIGURED in words, and nothing anywhere simulates a send.
    "SMS": ("Driver SMS fallback", "NOT_AI"),
}


@dataclass
class Health:
    provider: str
    state: str = "UNKNOWN"  # HEALTHY | FAILED | RATE_LIMITED | STATIC | UNKNOWN | NOT_CONFIGURED
    last_success_at: float | None = None
    last_error_at: float | None = None
    last_error: str | None = None
    #: When the data itself is from (issued/observed), if the provider says.
    data_at: float | None = None
    #: Validity end for windowed products (a CAP alert's expiry), if any.
    valid_to: float | None = None
    calls: int = 0
    failures: int = 0
    detail: dict[str, Any] = field(default_factory=dict)


_REG: dict[str, Health] = {}


def _h(provider: str) -> Health:
    return _REG.setdefault(provider, Health(provider=provider))


def ok(provider: str, *, data_at: float | None = None, valid_to: float | None = None, **detail: Any) -> None:
    h = _h(provider)
    h.state = "HEALTHY"
    h.last_success_at = time.time()
    h.calls += 1
    if data_at is not None:
        h.data_at = data_at
    if valid_to is not None:
        h.valid_to = valid_to
    if detail:
        h.detail.update(detail)


def static(provider: str, *, vintage: str, records: int) -> None:
    """A bundled dataset: loaded, not fetched. Vintage instead of freshness."""
    h = _h(provider)
    h.state = "STATIC"
    h.last_success_at = time.time()
    h.detail.update(vintage=vintage, records=records)


def fail(provider: str, category: str) -> None:
    """`category` is a word, never a message: timeout | http_429 | http_5xx | http_4xx | unreachable | unparseable."""
    h = _h(provider)
    h.state = "RATE_LIMITED" if category == "http_429" else "FAILED"
    h.last_error_at = time.time()
    h.last_error = category
    h.calls += 1
    h.failures += 1


def not_configured(provider: str) -> None:
    """Say plainly that nothing is wired up. Not a failure, not unknown."""
    h = _h(provider)
    h.state = "NOT_CONFIGURED"


def category(exc: BaseException, status_code: int | None = None) -> str:
    if status_code is not None:
        if status_code == 429:
            return "http_429"
        if status_code >= 500:
            return "http_5xx"
        if status_code >= 400:
            return "http_4xx"
    name = type(exc).__name__
    if "Timeout" in name:
        return "timeout"
    if name in ("ValueError", "JSONDecodeError", "ParseError", "KeyError"):
        return "unparseable"
    return "unreachable"


def freshness(h: Health, now: float) -> str:
    if h.state == "STATIC":
        return "STATIC"
    if h.valid_to is not None and h.valid_to < now:
        return "EXPIRED"
    ref = h.data_at if h.data_at is not None else h.last_success_at
    if ref is None:
        return "UNKNOWN"
    cadence = CADENCE_S.get(h.provider, 60 * 60)
    age = now - ref
    if age <= cadence:
        return "FRESH"
    if age <= 3 * cadence:
        return "AGING"
    return "STALE"


def snapshot(now: float | None = None) -> list[dict[str, Any]]:
    now = now or time.time()
    rows = []
    for provider, (product, evidence) in PRODUCT.items():
        h = _REG.get(provider) or Health(provider=provider)
        row = asdict(h)
        row.update(product=product, evidence_type=evidence, freshness=freshness(h, now), cadence_s=CADENCE_S.get(provider))
        rows.append(row)
    return rows
