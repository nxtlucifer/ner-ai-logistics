"""River discharge along a corridor - context for the risk engine, not a flood warning.

WHAT THE SOURCE CAN AND CANNOT SAY

GloFAS (Copernicus Emergency Management Service, served by Open-Meteo's flood
API, no key) publishes daily river discharge in m³/s for a 0.05° grid: the
nearest modelled river cell to each sampled point, with a 30-day history and a
short forecast. It publishes NO return-period thresholds and knows nothing
about roads. So nothing here says "flood" or "road under water". The one
defensible statement is a comparison of a cell with its OWN recent past:
today's (or the next two days') discharge against the trailing 30-day mean.

`ELEVATED_RATIO` is a project-defined heuristic, like OFF_ROUTE_THRESHOLD_M -
a level at which a dispatcher should look at the corridor, chosen so that the
ordinary day-to-day swing of a monsoon river does not fire it. It is not a
calibrated hazard probability and the reason codes are worded accordingly.

Cells whose recent mean is below `MIN_MEAN_M3S` are ignored: a trickle that
doubles is arithmetic, not a river.
"""

from dataclasses import dataclass
from datetime import date
from statistics import fmean
from typing import Final

VERSION: Final[str] = "flood-context-v1"

#: today / trailing-30-day-mean at which a cell counts as elevated. Heuristic.
ELEVATED_RATIO: Final[float] = 2.0
#: Below this trailing mean the cell is not a river worth comparing.
MIN_MEAN_M3S: Final[float] = 1.0

LEVEL_NORMAL: Final[str] = "NORMAL"
LEVEL_ELEVATED: Final[str] = "ELEVATED"
LEVEL_UNKNOWN: Final[str] = "UNKNOWN"

REASON_RIVER_DISCHARGE_ELEVATED: Final[str] = "RIVER_DISCHARGE_ELEVATED"
REASON_RIVER_DISCHARGE_NORMAL: Final[str] = "RIVER_DISCHARGE_NORMAL"
REASON_FLOOD_CONTEXT_UNAVAILABLE: Final[str] = "FLOOD_CONTEXT_UNAVAILABLE"

FLOOD_POINTS: Final[dict[str, int]] = {LEVEL_ELEVATED: 10, LEVEL_NORMAL: 0, LEVEL_UNKNOWN: 0}


@dataclass(frozen=True)
class DischargeSample:
    lat: float
    lon: float
    observed_on: date
    today_m3s: float
    mean_30d_m3s: float
    forecast_max_m3s: float | None


@dataclass(frozen=True)
class FloodContext:
    level: str
    #: Highest (today or forecast) / mean ratio over the usable cells.
    ratio_max: float | None
    samples: tuple[DischargeSample, ...]
    provider: str
    observed_on: date | None
    reason_codes: tuple[str, ...]
    version: str = VERSION

    @property
    def is_known(self) -> bool:
        return self.level != LEVEL_UNKNOWN


def _ratio(s: DischargeSample) -> float | None:
    if s.mean_30d_m3s < MIN_MEAN_M3S:
        return None
    peak = max(s.today_m3s, s.forecast_max_m3s if s.forecast_max_m3s is not None else s.today_m3s)
    return peak / s.mean_30d_m3s


def flood_context(samples: list[DischargeSample], *, provider: str) -> FloodContext:
    ratios = [r for r in (_ratio(s) for s in samples) if r is not None]
    if not ratios:
        return FloodContext(
            level=LEVEL_UNKNOWN, ratio_max=None, samples=tuple(samples), provider=provider,
            observed_on=samples[0].observed_on if samples else None,
            reason_codes=(REASON_FLOOD_CONTEXT_UNAVAILABLE,),
        )
    ratio_max = max(ratios)
    elevated = ratio_max >= ELEVATED_RATIO
    return FloodContext(
        level=LEVEL_ELEVATED if elevated else LEVEL_NORMAL,
        ratio_max=ratio_max,
        samples=tuple(samples),
        provider=provider,
        observed_on=samples[0].observed_on,
        reason_codes=(REASON_RIVER_DISCHARGE_ELEVATED if elevated else REASON_RIVER_DISCHARGE_NORMAL,),
    )


def parse_open_meteo(body: object, *, today: date) -> list[DischargeSample]:
    """The multi-location body of `/v1/flood?daily=river_discharge&past_days=30&forecast_days=3`.

    Cells with no value for today are dropped rather than zeroed. The trailing
    mean is over the days BEFORE today that carry a value; the forecast max is
    over the days after it.
    """
    entries = body if isinstance(body, list) else [body]
    samples: list[DischargeSample] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        daily = entry.get("daily") or {}
        days = daily.get("time") or []
        values = daily.get("river_discharge") or []
        rows = [(d, v) for d, v in zip(days, values, strict=False) if isinstance(v, (int, float))]
        today_iso = today.isoformat()
        current = next((v for d, v in rows if d == today_iso), None)
        past = [v for d, v in rows if d < today_iso]
        future = [v for d, v in rows if d > today_iso]
        if current is None or not past:
            continue
        samples.append(
            DischargeSample(
                lat=float(entry.get("latitude", 0.0)),
                lon=float(entry.get("longitude", 0.0)),
                observed_on=today,
                today_m3s=float(current),
                mean_30d_m3s=fmean(past),
                forecast_max_m3s=max(future) if future else None,
            )
        )
    return samples
