"""River discharge for a corridor, from GloFAS via Open-Meteo's flood API.

One request per assessment: the API takes comma-separated coordinates and
answers with one entry per point, and the figures are DAILY, so the answer is
cached per route per UTC day in memory. Failures return None and the engine
reports the factor NOT_AVAILABLE - never a calm river by default.

Same no-key terms and the same budget as weather (WEATHER_TIMEOUT_SECONDS).
"""

import logging
from datetime import UTC, datetime
from typing import Final

import httpx

from app.core.config import get_settings
from app.domain.flood import FloodContext, flood_context, parse_open_meteo

logger = logging.getLogger(__name__)

PROVIDER: Final[str] = "glofas-open-meteo"
USER_AGENT: Final[str] = "ner-fleet-intelligence/0.1 (SIH26002; flood-context)"

# ponytail: process-local day cache; a shared cache if more than one worker ever runs.
_cache: dict[tuple[str, str], FloodContext] = {}


async def flood_for(route_id: object, positions: list[tuple[float, float]]) -> FloodContext | None:
    settings = get_settings()
    if not positions or not settings.FLOOD_ENABLED:
        return None
    today = datetime.now(UTC).date()
    key = (str(route_id), today.isoformat())
    hit = _cache.get(key)
    if hit is not None:
        return hit
    params = {
        "latitude": ",".join(f"{lat:.4f}" for lat, _ in positions),
        "longitude": ",".join(f"{lon:.4f}" for _, lon in positions),
        "daily": "river_discharge",
        "past_days": 30,
        "forecast_days": 3,
    }
    try:
        async with httpx.AsyncClient(timeout=settings.WEATHER_TIMEOUT_SECONDS) as client:
            response = await client.get(
                f"{settings.FLOOD_PROVIDER_URL}/v1/flood", params=params, headers={"User-Agent": USER_AGENT}
            )
        response.raise_for_status()
        body = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.info("flood context unavailable: %s", type(exc).__name__)
        return None
    context = flood_context(parse_open_meteo(body, today=today), provider=PROVIDER)
    _cache[key] = context
    return context
