"""NDMA SACHET alerts for a corridor: the public RSS feed, the linked CAP files,
and the districts the route crosses.

THREE CACHES, THREE CADENCES

  - The RSS feed is one request, refreshed every WARNINGS_FEED_TTL_SECONDS.
  - A CAP file never changes for its identifier, so it is fetched once. Only
    items whose RSS text mentions a corridor district or state are fetched -
    the feed carries a hundred alerts for the whole country at a time.
  - The districts a route crosses come from Nominatim reverse geocoding of the
    sampled positions, once per route, serialised at one request per second
    per the usage policy. Light geocoding only; no autocomplete.

Failure at any step returns None and the factor reads NOT_AVAILABLE.
"""

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Final

import httpx

from app.core.config import get_settings
from app.domain.warnings import (
    OfficialWarning,
    OfficialWarnings,
    RssItem,
    match_corridor,
    normalise,
    parse_cap,
    parse_rss,
)

logger = logging.getLogger(__name__)

PROVIDER: Final[str] = "ndma-sachet-cap"
USER_AGENT: Final[str] = "ner-fleet-intelligence/0.1 (SIH26002; official warnings)"

# ponytail: process-local caches; a shared store if more than one worker ever runs.
_feed: tuple[datetime, list[RssItem]] | None = None
_caps: dict[str, OfficialWarning | None] = {}
_districts: dict[str, tuple[set[str], set[str]]] = {}
_locating: set[str] = set()
# ONE lock for every Nominatim call this process makes - the address search in
# geocoding.py included. Two locks were two callers at once, which is how the
# shared Render egress IP earned a 429 from a service whose limit is 1/s.
from app.services import provider_health  # noqa: E402
from app.services.geocoding import _nominatim_lock  # noqa: E402


async def _get(client: httpx.AsyncClient, url: str, **params) -> bytes | None:
    try:
        response = await client.get(url, params=params or None, headers={"User-Agent": USER_AGENT})
        response.raise_for_status()
        return response.content
    except httpx.HTTPStatusError as exc:
        logger.info("warnings fetch failed for %s: %s", url, type(exc).__name__)
        provider_health.fail("NDMA_SACHET", provider_health.category(exc, exc.response.status_code))
        return None
    except httpx.HTTPError as exc:
        logger.info("warnings fetch failed for %s: %s", url, type(exc).__name__)
        provider_health.fail("NDMA_SACHET", provider_health.category(exc))
        return None


async def feed(client: httpx.AsyncClient) -> list[RssItem] | None:
    global _feed
    settings = get_settings()
    now = datetime.now(UTC)
    if _feed and (now - _feed[0]).total_seconds() < settings.WARNINGS_FEED_TTL_SECONDS:
        return _feed[1]
    raw = await _get(client, settings.WARNINGS_FEED_URL)
    if raw is None:
        return _feed[1] if _feed else None
    try:
        items = parse_rss(raw)
    except Exception:  # noqa: BLE001 - a malformed feed is an unavailable feed
        logger.warning("warnings feed unparseable", exc_info=True)
        provider_health.fail("NDMA_SACHET", "unparseable")
        return _feed[1] if _feed else None
    _feed = (now, items)
    provider_health.ok("NDMA_SACHET", items=len(items))
    return items


async def cap(client: httpx.AsyncClient, item: RssItem) -> OfficialWarning | None:
    if item.identifier in _caps:
        return _caps[item.identifier]
    raw = await _get(client, item.link) if item.link else None
    warning = parse_cap(raw) if raw else None
    _caps[item.identifier] = warning
    return warning


async def locate(route_id: object, positions: list[tuple[float, float]]) -> tuple[set[str], set[str]] | None:
    """District and state names along the route, from Nominatim, once per route.

    Serialised at one request per second, so five samples take about six
    seconds - which is why callers never wait for it inside a request: see
    `warnings_for`. `routes.plan` warms it as soon as a route is persisted.
    """
    key = str(route_id)
    if key in _districts:
        return _districts[key]
    if key in _locating:
        return None
    _locating.add(key)
    settings = get_settings()
    districts: set[str] = set()
    states: set[str] = set()
    try:
        async with _nominatim_lock, httpx.AsyncClient(timeout=settings.WEATHER_TIMEOUT_SECONDS) as client:
            for index, (lat, lon) in enumerate(positions):
                if index:
                    await asyncio.sleep(1.1)  # usage policy: at most one request per second
                raw = await _get(
                    client, f"{settings.NOMINATIM_URL}/reverse",
                    lat=f"{lat:.5f}", lon=f"{lon:.5f}", format="jsonv2", zoom=8,
                )
                if raw is None:
                    # One patient retry: a 429 on a shared IP clears in seconds,
                    # and a district lookup that gives up leaves the whole
                    # warnings factor UNKNOWN for the life of the process.
                    await asyncio.sleep(3.0)
                    raw = await _get(
                        client, f"{settings.NOMINATIM_URL}/reverse",
                        lat=f"{lat:.5f}", lon=f"{lon:.5f}", format="jsonv2", zoom=8,
                    )
                if raw is None:
                    continue
                try:
                    address = json.loads(raw).get("address") or {}
                except ValueError:
                    continue
                for field in ("state_district", "county"):
                    if address.get(field):
                        districts.add(address[field])
                if address.get("state"):
                    states.add(address["state"])
    finally:
        _locating.discard(key)
    if not districts:
        return None
    _districts[key] = (districts, states)
    return _districts[key]


def warm(route_id: object, positions: list[tuple[float, float]]) -> None:
    """Start the district lookup in the background; nothing awaits it."""
    if get_settings().WARNINGS_ENABLED and str(route_id) not in _districts:
        asyncio.ensure_future(locate(route_id, positions))


async def warnings_for(route_id: object, positions: list[tuple[float, float]]) -> OfficialWarnings | None:
    settings = get_settings()
    if not positions or not settings.WARNINGS_ENABLED:
        return None
    located = _districts.get(str(route_id))
    if located is None:
        # Not known yet: start the lookup and report UNKNOWN for THIS read.
        # The next assessment finds it cached. Waiting here would put six
        # seconds of Nominatim pacing inside every cold request.
        warm(route_id, positions)
        return None
    async with httpx.AsyncClient(timeout=settings.WEATHER_TIMEOUT_SECONDS) as client:
        items = await feed(client)
        if items is None:
            return None
        districts, states = located
        keys = {normalise(n) for n in districts | states}
        # Only alerts whose feed text names a corridor district or state are
        # opened; the rest are counted as considered, never as matched.
        candidates = [i for i in items if any(k and k in normalise(i.title + " " + i.author) for k in keys)]
        opened = [w for w in await asyncio.gather(*(cap(client, i) for i in candidates)) if w is not None]
    result = match_corridor(
        opened, districts=districts, states=states, now=datetime.now(UTC),
        provider=PROVIDER, fetched_at=_feed[0] if _feed else None,
    )
    return OfficialWarnings(**{**result.__dict__, "considered": len(items)})
