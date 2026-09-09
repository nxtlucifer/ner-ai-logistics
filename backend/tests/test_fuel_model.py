"""Targeted unit tests for the deterministic fuel physics model."""

import pytest
from app.domain.fuel_model import (
    DEFAULT_BASE_L_PER_KM,
    MODE_BASELINE_ONLY,
    MODE_CALIBRATED,
    MODE_ESTIMATED,
    MODE_UNAVAILABLE,
    estimate_fuel,
)


def test_missing_or_zero_distance_is_unavailable():
    res = estimate_fuel(distance_km=None)
    assert res.mode == MODE_UNAVAILABLE
    assert res.litres is None
    assert not res.is_available

    res_zero = estimate_fuel(distance_km=0)
    assert res_zero.mode == MODE_UNAVAILABLE
    assert res_zero.litres is None


def test_baseline_unladen_fuel():
    # 100 km unladen flat
    res = estimate_fuel(distance_km=100.0)
    assert res.mode == MODE_BASELINE_ONLY
    assert res.is_available
    assert res.litres == 22.0  # 100 * 0.22
    assert res.litres_per_100km == 22.0
    assert res.payload_penalty_litres is None
    assert res.elevation_penalty_litres is None
    assert res.co2_kg == round(22.0 * 2.68, 1)


def test_laden_with_payload_and_elevation():
    # 200 km, 10 tonnes (10,000 kg), 500m elevation gain, 60 km/h average
    # Base: 200 * 0.22 = 44.0 L
    # Payload: 200 * 0.0075 * 10 = 15.0 L
    # Elevation: 500 * 0.00018 = 0.09 -> 0.1 L
    # Speed: 200 * 0.002 * (60 - 50) = 4.0 L
    # Total = 44 + 15 + 0.09 + 4 = 63.09 -> 63.1 L
    res = estimate_fuel(
        distance_km=200.0,
        payload_kg=10000.0,
        elevation_gain_m=500.0,
        average_speed_kmph=60.0,
    )
    assert res.mode == MODE_ESTIMATED
    assert res.is_available
    assert res.litres == 63.1
    assert res.payload_penalty_litres == 15.0
    assert res.speed_penalty_litres == 4.0
    assert len(res.breakdown_notes) == 4


def test_calibrated_mode():
    res = estimate_fuel(distance_km=300.0, payload_kg=5000.0, calibrated=True)
    assert res.mode == MODE_CALIBRATED
