"""Deterministic commercial truck fuel physics model (SAE J1321 / CMEM).

Pure domain application logic. No I/O, no provider, no model weights.
Uses verifiable physical equations based on distance, cargo payload,
elevation climb, and cruise speed rather than ungrounded guesses.

Formula:
  F = (B_base + K_payload * M_cargo + K_speed * max(0, v - 50)) * Distance_km + K_grade * max(0, Delta_H)

Where:
  B_base: Base unladen fuel rate (L/km)
  K_payload: Consumption increment per tonne of payload (L / (tonne * km))
  K_grade: Additional fuel per metre of elevation climb (L / m)
  K_speed: Aerodynamic drag penalty above 50 km/h (L / (km * (km/h)))
  CO2 factor: 2.68 kg CO2 per litre of diesel
"""

from dataclasses import dataclass
from typing import Final

# Default calibration coefficients for a standard multi-axle Indian freight truck (16T-28T GVW)
DEFAULT_BASE_L_PER_KM: Final[float] = 0.22  # ~22 L/100km unladen flat cruising at 50 km/h
DEFAULT_K_PAYLOAD: Final[float] = 0.0075    # +0.75 L/100km per tonne of cargo
DEFAULT_K_GRADE: Final[float] = 0.00018      # ~0.18 L per 1000m elevation gain
DEFAULT_K_SPEED: Final[float] = 0.002       # Drag penalty above 50 km/h
DIESEL_CO2_KG_PER_LITRE: Final[float] = 2.68

MODE_CALIBRATED: Final[str] = "CALIBRATED"
MODE_ESTIMATED: Final[str] = "ESTIMATED"
MODE_BASELINE_ONLY: Final[str] = "BASELINE_ONLY"
MODE_UNAVAILABLE: Final[str] = "UNAVAILABLE"


@dataclass(frozen=True)
class FuelEstimate:
    """Deterministic fuel consumption estimate for a commercial truck trip."""

    litres: float | None
    litres_per_100km: float | None
    mode: str
    base_litres: float | None
    payload_penalty_litres: float | None
    elevation_penalty_litres: float | None
    speed_penalty_litres: float | None
    co2_kg: float | None
    breakdown_notes: tuple[str, ...]

    @property
    def is_available(self) -> bool:
        return self.litres is not None and self.mode != MODE_UNAVAILABLE


def estimate_fuel(
    *,
    distance_km: float | None,
    payload_kg: float | None = None,
    elevation_gain_m: float | None = None,
    average_speed_kmph: float | None = None,
    base_rate_l_per_km: float = DEFAULT_BASE_L_PER_KM,
    calibrated: bool = False,
) -> FuelEstimate:
    """Calculate fuel consumption for a given corridor and payload.

    If distance is missing or non-positive, returns an UNAVAILABLE estimate.
    Never defaults missing values to 0 without recording the mode honestly.
    """
    if distance_km is None or distance_km <= 0:
        return FuelEstimate(
            litres=None,
            litres_per_100km=None,
            mode=MODE_UNAVAILABLE,
            base_litres=None,
            payload_penalty_litres=None,
            elevation_penalty_litres=None,
            speed_penalty_litres=None,
            co2_kg=None,
            breakdown_notes=("Distance not provided",),
        )

    notes: list[str] = []
    base_litres = distance_km * base_rate_l_per_km
    notes.append(f"Base cruising: {base_litres:.1f} L ({distance_km:.0f} km @ {base_rate_l_per_km * 100:.1f} L/100km)")

    # Payload penalty
    payload_litres = 0.0
    has_payload = payload_kg is not None and payload_kg > 0
    if has_payload:
        tonnes = payload_kg / 1000.0
        payload_litres = distance_km * DEFAULT_K_PAYLOAD * tonnes
        notes.append(f"Payload ({tonnes:.1f} T): +{payload_litres:.1f} L")
    else:
        notes.append("Payload unladen or not specified")

    # Elevation penalty
    elevation_litres = 0.0
    has_elevation = elevation_gain_m is not None and elevation_gain_m > 0
    if has_elevation:
        elevation_litres = elevation_gain_m * DEFAULT_K_GRADE
        notes.append(f"Terrain climb ({elevation_gain_m:.0f}m): +{elevation_litres:.1f} L")

    # Speed penalty
    speed_litres = 0.0
    has_speed = average_speed_kmph is not None and average_speed_kmph > 50.0
    if has_speed:
        excess_speed = average_speed_kmph - 50.0
        speed_litres = distance_km * DEFAULT_K_SPEED * excess_speed
        notes.append(f"Cruising speed ({average_speed_kmph:.0f} km/h): +{speed_litres:.1f} L")

    total_litres = round(base_litres + payload_litres + elevation_litres + speed_litres, 1)
    l_per_100 = round((total_litres / distance_km) * 100.0, 1)
    co2 = round(total_litres * DIESEL_CO2_KG_PER_LITRE, 1)

    mode = (
        MODE_CALIBRATED
        if calibrated
        else (MODE_ESTIMATED if (has_payload or has_elevation) else MODE_BASELINE_ONLY)
    )

    return FuelEstimate(
        litres=total_litres,
        litres_per_100km=l_per_100,
        mode=mode,
        base_litres=round(base_litres, 1),
        payload_penalty_litres=round(payload_litres, 1) if has_payload else None,
        elevation_penalty_litres=round(elevation_litres, 1) if has_elevation else None,
        speed_penalty_litres=round(speed_litres, 1) if has_speed else None,
        co2_kg=co2,
        breakdown_notes=tuple(notes),
    )
