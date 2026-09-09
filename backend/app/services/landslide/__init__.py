"""Landslide incident providers.

Mirrors `app/services/weather/` and `app/services/routing/`: the Protocol and
the normalisation live here, and nothing above this package knows which body
published a bulletin.
"""

from app.services.landslide.base import (
    LandslideIncidentProvider,
    NullLandslideProvider,
    build_provider,
)

__all__ = [
    "LandslideIncidentProvider",
    "NullLandslideProvider",
    "build_provider",
]
