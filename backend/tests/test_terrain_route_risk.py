"""Terrain and history reach the score, the wire model, and the factor map.

The DEM is patched at the provider seam, so this exercises everything above
it - sampling, the profile, the component, the inputs map, and `risk_read` -
without the network. The history side uses the real bundled inventory.
"""

import uuid
from datetime import UTC, datetime

import pytest

from app.api.trips import risk_read
from app.domain.landslide import HistoryExposure
from app.domain.route_risk import (
    AVAILABLE,
    FACTOR_ELEVATION,
    FACTOR_HISTORICAL_INCIDENTS,
    FACTOR_LANDSLIDE,
    NOT_AVAILABLE,
    assess,
)
from app.domain.terrain import build_profile, sample_by_distance
from app.services import terrain as terrain_service
from app.services.route_risk import history_for

# Guwahati -> Jorhat along NH-27, coarse but real.
NH27 = [(26.1445, 91.7362), (26.20, 91.95), (26.25, 92.30), (26.40, 92.90), (26.60, 93.60), (26.7509, 94.2037)]
NOW = datetime(2026, 9, 11, tzinfo=UTC)


class HillyDem:
    """Answers a 12% climb for the first 10 km, then flat - deterministic."""

    async def elevations(self, points):
        out = []
        for i, _ in enumerate(points):
            out.append(50.0 + min(i, 20) * 60.0)  # 60 m per 500 m sample = 12%
        return out


class DeadDem:
    async def elevations(self, points):
        return [None] * len(points)


@pytest.mark.asyncio
async def test_a_hilly_dem_makes_terrain_a_measured_scored_factor(monkeypatch) -> None:
    monkeypatch.setenv("TERRAIN_ENABLED", "true")
    monkeypatch.setattr(terrain_service, "build_provider", lambda: HillyDem())
    route_id = uuid.uuid4()

    profile = await terrain_service.profile_for(route_id, NH27)
    assert profile is not None and profile.usable
    assert profile.max_grade_pct == pytest.approx(12.0, abs=0.5)
    assert profile.steep_km > 5.0
    # Second call is the cache, not the provider.
    monkeypatch.setattr(terrain_service, "build_provider", lambda: DeadDem())
    assert (await terrain_service.profile_for(route_id, NH27)) is profile

    history = await history_for(NH27, now=NOW)
    assert history.exposure is HistoryExposure.HIGH

    risk = assess(distance_km=305.0, duration_min=221.0, terrain=profile, history=history, now=NOW)
    assert risk.inputs[FACTOR_ELEVATION] == AVAILABLE
    assert risk.inputs[FACTOR_HISTORICAL_INCIDENTS] == AVAILABLE
    # The CURRENT landslide feed is still not connected, and must still say so:
    # history is not a substitute, and governance must not relax on it.
    assert risk.inputs[FACTOR_LANDSLIDE] == NOT_AVAILABLE
    codes = {c.code for c in risk.components}
    assert {"TERRAIN_EXPOSURE", "LANDSLIDE_HISTORY_EXPOSURE"} <= codes
    assert "STEEP_GRADIENT_ON_ROUTE" in risk.reason_codes
    assert "LANDSLIDE_HISTORY_ON_ROUTE" in risk.reason_codes
    assert "LANDSLIDE_HISTORY_INVENTORY_AGED" in risk.reason_codes

    wire = risk_read(risk)
    assert wire.terrain is not None and wire.terrain.usable
    assert wire.terrain.segments and wire.terrain.class_km["STEEP"] > 0
    assert wire.landslide_history is not None
    assert wire.landslide_history.exposure == "HIGH"
    assert wire.landslide_history.inventory_to_year == 2017
    assert wire.landslide_history.on_route_count >= 3


@pytest.mark.asyncio
async def test_a_dead_dem_leaves_terrain_unavailable_not_flat(monkeypatch) -> None:
    monkeypatch.setenv("TERRAIN_ENABLED", "true")
    monkeypatch.setattr(terrain_service, "build_provider", lambda: DeadDem())
    profile = await terrain_service.profile_for(uuid.uuid4(), NH27)
    assert profile is None

    risk = assess(distance_km=305.0, duration_min=221.0, terrain=None, now=NOW)
    assert risk.inputs[FACTOR_ELEVATION] == NOT_AVAILABLE
    assert FACTOR_ELEVATION in risk.unavailable
    assert "TERRAIN_DATA_UNAVAILABLE" in risk.reason_codes
    assert not any(c.code == "TERRAIN_EXPOSURE" for c in risk.components)


def test_a_partial_dem_answer_is_reported_partial() -> None:
    sampled = sample_by_distance(NH27, 500.0, max_samples=1000)
    points = [(a, b) for a, b, _ in sampled]
    heights: list[float | None] = [100.0] * len(points)
    for i in range(0, len(heights), 3):  # a third of the samples missing
        heights[i] = None
    profile = build_profile(points, heights, spacing_m=500.0, source="t", fetched_at=NOW,
                            distances_m=[d for _, _, d in sampled])
    assert profile.coverage == pytest.approx(2 / 3, abs=0.01)
    assert profile.usable is False
    risk = assess(distance_km=305.0, duration_min=221.0, terrain=profile, now=NOW)
    assert risk.inputs[FACTOR_ELEVATION] == NOT_AVAILABLE
    # ...but the evidence of HOW partial still ships.
    assert risk_read(risk).terrain is not None
    assert risk_read(risk).terrain.coverage < 0.8


@pytest.mark.asyncio
async def test_concurrent_callers_share_one_fetch(monkeypatch) -> None:
    """Three screens asking at once must not be three fan-outs at the DEM."""
    import asyncio

    calls = {"n": 0}

    class CountingDem:
        async def elevations(self, points):
            calls["n"] += 1
            await asyncio.sleep(0.05)
            return [100.0] * len(points)

    monkeypatch.setenv("TERRAIN_ENABLED", "true")
    monkeypatch.setattr(terrain_service, "build_provider", lambda: CountingDem())
    route_id = uuid.uuid4()
    results = await asyncio.gather(*(terrain_service.profile_for(route_id, NH27) for _ in range(3)))
    assert calls["n"] == 1
    assert all(r is results[0] for r in results)


@pytest.mark.asyncio
async def test_a_partial_answer_is_returned_but_not_cached(monkeypatch) -> None:
    class HalfDem:
        async def elevations(self, points):
            return [100.0 if i % 2 else None for i in range(len(points))]

    monkeypatch.setenv("TERRAIN_ENABLED", "true")
    monkeypatch.setattr(terrain_service, "build_provider", lambda: HalfDem())
    route_id = uuid.uuid4()
    first = await terrain_service.profile_for(route_id, NH27)
    assert first is not None and not first.usable and first.coverage < 0.8
    # Backed off rather than retried on the very next poll.
    assert (await terrain_service.profile_for(route_id, NH27)) is None
    terrain_service.forget(route_id)


@pytest.mark.asyncio
async def test_the_recommendation_path_carries_the_same_evidence(monkeypatch) -> None:
    """LS-7 again: the dispatcher's review and the driver's monitor must not
    disagree about whether terrain was measured for one road."""
    from app.services import route_recommendation as rec
    from app.services import route_risk as risk_service

    monkeypatch.setenv("TERRAIN_ENABLED", "true")
    monkeypatch.setattr(terrain_service, "build_provider", lambda: HillyDem())

    async def no_weather(positions):
        return []

    monkeypatch.setattr(risk_service, "observations_for", no_weather)
    wkt = "LINESTRING(" + ", ".join(f"{lon} {lat}" for lat, lon in NH27) + ")"
    risk = await rec._risk_for(uuid.uuid4(), wkt, 305, 221)
    assert risk.inputs[FACTOR_ELEVATION] == AVAILABLE
    assert risk.inputs[FACTOR_HISTORICAL_INCIDENTS] == AVAILABLE
    assert risk.terrain is not None and risk.history is not None
