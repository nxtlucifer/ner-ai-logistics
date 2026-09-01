"""Weather subsystem.

Provider-independent by construction, mirroring `app/services/routing/`: the
application depends on `WeatherObservation`, never on a provider's response
shape.

There is no chain here yet. One provider is configured, and a fallback would be
scaffolding for a resilience story that does not exist - `RoutingChain` shows
the shape to copy when a second provider earns its place.
"""

from app.domain.weather import (
    WeatherError,
    WeatherMalformed,
    WeatherObservation,
    WeatherRejected,
    WeatherUnavailable,
)
from app.services.weather.open_meteo import OpenMeteoWeatherProvider

__all__ = [
    "OpenMeteoWeatherProvider",
    "WeatherError",
    "WeatherMalformed",
    "WeatherObservation",
    "WeatherRejected",
    "WeatherUnavailable",
]
