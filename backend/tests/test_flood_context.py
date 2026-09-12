"""River discharge along the corridor is CONTEXT for the risk engine, never a flood claim.

GloFAS (via Open-Meteo's flood API) publishes daily discharge for a 5 km grid
with no return-period thresholds, so the only defensible statement is a
comparison of today with the same cell's own recent past. The threshold is a
project-defined heuristic and the reason codes say "discharge", not "flood".
"""

from datetime import date

from app.domain.flood import (
    ELEVATED_RATIO,
    LEVEL_ELEVATED,
    LEVEL_NORMAL,
    LEVEL_UNKNOWN,
    MIN_MEAN_M3S,
    REASON_FLOOD_CONTEXT_UNAVAILABLE,
    REASON_RIVER_DISCHARGE_ELEVATED,
    REASON_RIVER_DISCHARGE_NORMAL,
    DischargeSample,
    flood_context,
    parse_open_meteo,
)
from app.domain.route_risk import AVAILABLE, FACTOR_FLOOD, NOT_AVAILABLE, assess

TODAY = date(2026, 9, 12)


def sample(today: float, mean: float, forecast_max: float | None = None, lat: float = 26.0) -> DischargeSample:
    return DischargeSample(lat=lat, lon=91.8, observed_on=TODAY, today_m3s=today, mean_30d_m3s=mean, forecast_max_m3s=forecast_max)


def test_normal_when_every_cell_is_near_its_own_recent_mean() -> None:
    ctx = flood_context([sample(10.0, 9.0), sample(3.0, 3.2)], provider="glofas")
    assert ctx.level == LEVEL_NORMAL
    assert ctx.is_known
    assert ctx.ratio_max == 10.0 / 9.0
    assert ctx.reason_codes == (REASON_RIVER_DISCHARGE_NORMAL,)


def test_elevated_when_any_cell_runs_at_the_ratio_or_the_forecast_does() -> None:
    ctx = flood_context([sample(10.0, 9.0), sample(9.0 * ELEVATED_RATIO, 9.0, lat=25.9)], provider="glofas")
    assert ctx.level == LEVEL_ELEVATED
    assert ctx.reason_codes == (REASON_RIVER_DISCHARGE_ELEVATED,)
    forecast = flood_context([sample(9.0, 9.0, forecast_max=9.0 * ELEVATED_RATIO + 1)], provider="glofas")
    assert forecast.level == LEVEL_ELEVATED


def test_tiny_streams_and_missing_data_are_unknown_not_normal() -> None:
    assert flood_context([], provider="glofas").level == LEVEL_UNKNOWN
    trickle = flood_context([sample(MIN_MEAN_M3S * 3, MIN_MEAN_M3S / 2)], provider="glofas")
    assert trickle.level == LEVEL_UNKNOWN
    assert trickle.reason_codes == (REASON_FLOOD_CONTEXT_UNAVAILABLE,)


def test_parse_reads_the_multi_location_body_and_dates() -> None:
    body = [
        {
            "latitude": 26.125, "longitude": 91.725,
            "daily": {"time": ["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"],
                      "river_discharge": [4.0, 6.0, 15.0, 30.0, 10.0]},
        },
        {"latitude": 25.9, "longitude": 91.9, "daily": {"time": ["2026-09-12"], "river_discharge": [None]}},
    ]
    samples = parse_open_meteo(body, today=TODAY)
    assert len(samples) == 1
    s = samples[0]
    assert (s.today_m3s, s.mean_30d_m3s, s.forecast_max_m3s) == (15.0, 5.0, 30.0)
    assert s.observed_on == TODAY


def test_the_engine_counts_the_factor_and_scores_only_elevated() -> None:
    elevated = flood_context([sample(30.0, 9.0)], provider="glofas")
    risk = assess(distance_km=50.0, duration_min=60.0, flood=elevated)
    assert risk.inputs[FACTOR_FLOOD] == AVAILABLE
    assert FACTOR_FLOOD not in risk.unavailable
    assert any(c.code == "RIVER_DISCHARGE_ELEVATED" for c in risk.components)
    assert REASON_RIVER_DISCHARGE_ELEVATED in risk.reason_codes
    assert risk.flood is elevated

    normal = assess(distance_km=50.0, duration_min=60.0, flood=flood_context([sample(9.0, 9.0)], provider="glofas"))
    assert normal.inputs[FACTOR_FLOOD] == AVAILABLE
    assert not any(c.code == "RIVER_DISCHARGE_ELEVATED" for c in normal.components)

    none = assess(distance_km=50.0, duration_min=60.0)
    assert none.inputs[FACTOR_FLOOD] == NOT_AVAILABLE
    assert REASON_FLOOD_CONTEXT_UNAVAILABLE in none.reason_codes
