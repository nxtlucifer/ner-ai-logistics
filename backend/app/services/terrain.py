"""Terrain profiles: sample a route, ask a DEM, build the profile once.

Contract verified against the live endpoint, not from memory:

    GET https://api.open-meteo.com/v1/elevation?latitude=a,b,c&longitude=x,y,z
      -> {"elevation": [52.0, 527.0, 91.0]}

  - up to 100 coordinates per request, comma-separated, WGS84
  - source is Copernicus DEM GLO-90 (90 m); heights in metres, `null` where
    the DEM has no value
  - no API key for non-commercial use, same terms as the weather endpoint

THE PROFILE OF A ROUTE NEVER CHANGES

A `TripRoute` row's geometry is immutable - rerouting inserts a new row - so
its terrain is a fact about that row, not about now. It is fetched once per
process and kept. A weather reading is asked for again every time because the
sky moves; a hillside does not.

Kept in memory AND on disk (`backend/.cache/terrain/<route_id>.json`). The
disk copy exists because the free DEM endpoint rate-limits by the hour, and a
demo that refetches a 300 km profile after every restart is a demo that
depends on somebody else's quota. A profile is written only when usable.

ponytail: a JSON file per route. Move it to a column on trip_routes if the
cache ever needs to be shared across processes or queried.

DEM FAILURE IS NOT REQUEST FAILURE

Same rule as weather. If the endpoint is down the assessment returns with the
terrain factor NOT_AVAILABLE and a reason code, because distance, duration and
weather are still perfectly good evidence.
"""

import asyncio
import json
import logging
import time
import uuid
from pathlib import Path
from datetime import UTC, datetime
from typing import Final

import httpx

from app.services import provider_health

from app.core.config import get_settings
from app.domain.terrain import TerrainProfile, build_profile, sample_by_distance

logger = logging.getLogger(__name__)

USER_AGENT: Final[str] = "ner-fleet-intelligence/0.1 (SIH26002; terrain)"
SOURCE: Final[str] = "Copernicus DEM GLO-90 via Open-Meteo"
#: Named when at least one batch came from the fallback, so the profile never
#: claims a single dataset it was not entirely built from.
SOURCE_FALLBACK: Final[str] = "Copernicus DEM GLO-90 via Open-Meteo + SRTM 30 m via OpenTopoData"

#: ~500 m between samples: the DEM is 90 m, a hairpin is shorter than that,
#: and a loaded truck feels a grade over hundreds of metres. Finer buys
#: requests, not knowledge. Bounded so a 2,000 km route cannot fan out into
#: hundreds of calls.
SAMPLE_SPACING_M: Final[float] = 500.0
MAX_SAMPLES: Final[int] = 1_000
BATCH: Final[int] = 100

_cache: dict[uuid.UUID, TerrainProfile] = {}
CACHE_DIR: Final[Path] = Path(__file__).resolve().parents[2] / ".cache" / "terrain"
#: One fetch per route at a time. The driver app asks for route-risk, the
#: navigation package and the offline package in the same breath, and each
#: of those scores the route: three concurrent cache misses fired 21 elevation
#: requests at once and Open-Meteo answered 429. Concurrent callers now await
#: the same task.
_inflight: dict[uuid.UUID, "asyncio.Task[TerrainProfile | None]"] = {}
#: After a partial or failed fetch, do not retry for a while. A 429 that is
#: retried on the next poll is a 429 that never clears.
_retry_after: dict[uuid.UUID, float] = {}
RETRY_DELAY_S: Final[float] = 120.0


class OpenMeteoElevationProvider:
    def __init__(self, base_url: str, *, timeout_s: float, fallback_url: str = "") -> None:
        self._url = base_url.rstrip("/") + "/v1/elevation"
        self._timeout = timeout_s
        # OpenTopoData (no key): 100 locations per request, 1 request/s,
        # 1,000/day. Only asked when an Open-Meteo batch fails (its daily
        # quota ran out on 12 Sep and terrain went NOT_AVAILABLE for hours).
        self._fallback = fallback_url.rstrip("/") + "/v1/srtm30m" if fallback_url else ""
        self.used_fallback = False

    async def _fallback_heights(
        self, client: httpx.AsyncClient, chunk: list[tuple[float, float]]
    ) -> list[float | None]:
        if not self._fallback:
            raise ValueError("no fallback configured")
        await asyncio.sleep(1.0)  # ponytail: provider's 1 req/s, per call not per process
        response = await client.get(
            self._fallback, params={"locations": "|".join(f"{lat:.5f},{lon:.5f}" for lat, lon in chunk)}
        )
        response.raise_for_status()
        results = response.json().get("results")
        if not isinstance(results, list) or len(results) != len(chunk):
            raise ValueError("fallback results do not match request")
        self.used_fallback = True
        return [r.get("elevation") if isinstance(r.get("elevation"), (int, float)) else None for r in results]

    async def elevations(
        self, points: list[tuple[float, float]]
    ) -> list[float | None]:
        """One height per point, in order. `None` where the DEM had no value.

        A batch that fails is `None` for every point in it and the others
        still answer: coverage is reported, not hidden, and one bad request
        must not throw away six good ones.
        """
        out: list[float | None] = []
        async with httpx.AsyncClient(
            timeout=self._timeout, headers={"User-Agent": USER_AGENT}
        ) as client:
            for start in range(0, len(points), BATCH):
                chunk = points[start : start + BATCH]
                try:
                    response = await client.get(
                        self._url,
                        params={
                            "latitude": ",".join(f"{lat:.5f}" for lat, _ in chunk),
                            "longitude": ",".join(f"{lon:.5f}" for _, lon in chunk),
                        },
                    )
                    response.raise_for_status()
                    heights = response.json().get("elevation")
                    if not isinstance(heights, list) or len(heights) != len(chunk):
                        raise ValueError("elevation array does not match request")
                    out.extend(
                        float(h) if isinstance(h, (int, float)) else None for h in heights
                    )
                    provider_health.ok("OPEN_METEO_ELEVATION")
                except (httpx.HTTPError, ValueError) as error:
                    logger.info("terrain batch %d unavailable: %r", start // BATCH, error)
                    status = getattr(getattr(error, "response", None), "status_code", None)
                    provider_health.fail("OPEN_METEO_ELEVATION", provider_health.category(error, status))
                    try:
                        out.extend(await self._fallback_heights(client, chunk))
                        provider_health.ok("OPENTOPODATA")
                    except (httpx.HTTPError, ValueError) as fallback_error:
                        logger.info("terrain fallback batch %d unavailable: %r", start // BATCH, fallback_error)
                        status = getattr(getattr(fallback_error, "response", None), "status_code", None)
                        provider_health.fail("OPENTOPODATA", provider_health.category(fallback_error, status))
                        out.extend([None] * len(chunk))
        return out


def build_provider() -> OpenMeteoElevationProvider:
    settings = get_settings()
    return OpenMeteoElevationProvider(
        settings.WEATHER_PROVIDER_URL,
        timeout_s=settings.WEATHER_TIMEOUT_SECONDS,
        fallback_url=settings.TERRAIN_FALLBACK_URL,
    )


async def profile_for(
    route_id: uuid.UUID, geometry: list[tuple[float, float]]
) -> TerrainProfile | None:
    """The terrain profile for one persisted route, or None if unobtainable.

    NEVER RAISES. Returns None when terrain is switched off, the geometry is
    degenerate, or the DEM answered nothing at all - and the caller reports
    the factor NOT_AVAILABLE. A profile that answered PARTIALLY is returned
    with its coverage, so the domain can decide whether it is usable.
    """
    cached = _cache.get(route_id)
    if cached is not None:
        return cached
    on_disk = _read_disk(route_id)
    if on_disk is not None:
        _cache[route_id] = on_disk
        return on_disk
    if not get_settings().TERRAIN_ENABLED or len(geometry) < 2:
        return None
    if _retry_after.get(route_id, 0.0) > time.monotonic():
        return None

    task = _inflight.get(route_id)
    if task is None:
        task = asyncio.create_task(_fetch(route_id, geometry))
        _inflight[route_id] = task
        task.add_done_callback(lambda _t: _inflight.pop(route_id, None))
    return await task


async def _fetch(
    route_id: uuid.UUID, geometry: list[tuple[float, float]]
) -> TerrainProfile | None:
    sampled = sample_by_distance(geometry, SAMPLE_SPACING_M, max_samples=MAX_SAMPLES)
    if len(sampled) < 2:
        return None
    points = [(lat, lon) for lat, lon, _ in sampled]
    distances = [d for _, _, d in sampled]
    spacing = distances[-1] / (len(sampled) - 1)

    provider = build_provider()
    try:
        heights = await provider.elevations(points)
    except Exception:  # noqa: BLE001 - a DEM outage must not break planning
        logger.warning("terrain provider failed", exc_info=True)
        return None

    profile = build_profile(
        points,
        heights,
        spacing_m=spacing,
        source=SOURCE_FALLBACK if getattr(provider, "used_fallback", False) else SOURCE,
        fetched_at=datetime.now(UTC),
        distances_m=distances,
    )
    if profile.samples_answered == 0:
        _retry_after[route_id] = time.monotonic() + RETRY_DELAY_S
        return None
    # Only a USABLE profile is kept. A partial one (a 429 on two of seven
    # batches) is returned for this response so its coverage is visible, but
    # caching it would freeze the gap into the route forever.
    if profile.usable:
        _cache[route_id] = profile
        _write_disk(route_id, profile)
    else:
        _retry_after[route_id] = time.monotonic() + RETRY_DELAY_S
    return profile


def forget(route_id: uuid.UUID) -> None:
    """For tests. A route's terrain does not change, so production never calls this."""
    _cache.pop(route_id, None)
    _retry_after.pop(route_id, None)


# --- Disk cache --------------------------------------------------------------


def _path(route_id: uuid.UUID) -> Path:
    return CACHE_DIR / f"{route_id}.json"


def _write_disk(route_id: uuid.UUID, profile: TerrainProfile) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _path(route_id).write_text(
            json.dumps(
                {
                    "source": profile.source,
                    "fetched_at": profile.fetched_at.isoformat(),
                    "spacing_m": profile.spacing_m,
                    "samples": [
                        [s.latitude, s.longitude, s.distance_m, s.elevation_m]
                        for s in profile.samples
                    ],
                }
            ),
            encoding="utf-8",
        )
    except OSError:
        logger.info("terrain cache not written for %s", route_id, exc_info=True)


def _read_disk(route_id: uuid.UUID) -> TerrainProfile | None:
    path = _path(route_id)
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        samples = raw["samples"]
        profile = build_profile(
            [(s[0], s[1]) for s in samples],
            [s[3] for s in samples],
            spacing_m=float(raw["spacing_m"]),
            source=str(raw["source"]),
            fetched_at=datetime.fromisoformat(raw["fetched_at"]),
            distances_m=[float(s[2]) for s in samples],
        )
        return profile if profile.usable else None
    except (OSError, ValueError, KeyError, TypeError):
        logger.info("terrain cache unreadable for %s", route_id, exc_info=True)
        return None
