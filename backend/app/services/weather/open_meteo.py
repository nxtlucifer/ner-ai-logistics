"""Open-Meteo weather provider.

Contract verified against the official documentation, not from memory:

    GET https://api.open-meteo.com/v1/forecast
        ?latitude=..&longitude=..
        &current=temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m

  - `latitude` and `longitude` are required, WGS84, floating point
  - the response carries `current` alongside `current_units`, so units are
    stated by the provider rather than assumed here
  - **no API key is required for non-commercial use**; a key exists only for
    commercial customers accessing reserved resources

NO `visibility`. Open-Meteo exposes visibility as an HOURLY variable, not a
current one. Requesting it under `current` would either error or return nothing,
and carrying an always-empty field would invite a UI to render `0 m` - the same
failure mode as a permanently-null fuel estimate. See app/domain/weather.py.

UNITS ARE READ, NOT ASSUMED. `wind_speed_10m` defaults to km/h and
`temperature_2m` to Celsius, but both are configurable per request and the
response says which was used. Trusting the default would be right today and
silently wrong the first time someone adds `&wind_speed_unit=ms` - so the
provider checks what it was given and converts or refuses.

NO RETRIES HERE, for the same reason as routing: a chain that falls through and
a provider that retries multiply into a storm against a free service.
"""

import logging
from datetime import UTC, datetime
from typing import Any, Final

import httpx

from app.domain.weather import (
    WeatherMalformed,
    WeatherObservation,
    WeatherRejected,
    WeatherUnavailable,
)

logger = logging.getLogger(__name__)

USER_AGENT: Final[str] = "ner-fleet-intelligence/0.1 (SIH26002; weather)"

CURRENT_FIELDS: Final[str] = (
    "temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m"
)

#: Units this provider is asked for and knows how to read. Anything else is a
#: refusal rather than a guess - a wind speed silently read as m/s when it is
#: km/h is a 3.6x error in a number a dispatcher may act on.
_EXPECTED_UNITS: Final[dict[str, str]] = {
    "temperature_2m": "°C",
    "wind_speed_10m": "km/h",
    "wind_gusts_10m": "km/h",
    "precipitation": "mm",
}


class OpenMeteoWeatherProvider:
    """Implements `WeatherProvider` against Open-Meteo."""

    def __init__(
        self,
        base_url: str = "https://api.open-meteo.com",
        *,
        timeout_s: float = 6.0,
        name: str = "open-meteo",
    ) -> None:
        self.name = name
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_s

    async def current(self, lat: float, lon: float) -> WeatherObservation:
        if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
            # Refused here rather than sent: an out-of-range coordinate is the
            # shape of a lat/lon inversion, and spending a request to be told
            # so wastes a free service's budget on our own bug.
            raise WeatherRejected(
                f"{self.name} was asked for an out-of-range coordinate"
            )

        url = f"{self._base_url}/v1/forecast"
        params = {
            "latitude": f"{lat}",
            "longitude": f"{lon}",
            "current": CURRENT_FIELDS,
            "timezone": "UTC",
        }

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(
                    url, params=params, headers={"User-Agent": USER_AGENT}
                )
        except httpx.TimeoutException as exc:
            raise WeatherUnavailable(f"{self.name} timed out") from exc
        except httpx.HTTPError as exc:
            raise WeatherUnavailable(f"{self.name} is unreachable") from exc

        if response.status_code >= 500:
            raise WeatherUnavailable(
                f"{self.name} returned {response.status_code}"
            )
        if response.status_code >= 400:
            # Open-Meteo returns 400 with {"error": true, "reason": "..."} for a
            # request it will never accept. Reached and refused, so not a reason
            # to retry or to try another provider.
            raise WeatherRejected(f"{self.name} refused the request")

        try:
            body: Any = response.json()
        except ValueError as exc:
            raise WeatherMalformed(f"{self.name} returned non-JSON") from exc
        if not isinstance(body, dict):
            raise WeatherMalformed(f"{self.name} returned a non-object body")

        return self._parse(body, lat=lat, lon=lon)

    def _parse(self, body: dict, *, lat: float, lon: float) -> WeatherObservation:
        current = body.get("current")
        if not isinstance(current, dict):
            raise WeatherMalformed(f"{self.name} returned no current block")

        units = body.get("current_units")
        if not isinstance(units, dict):
            raise WeatherMalformed(f"{self.name} returned no units")
        for field_name, expected in _EXPECTED_UNITS.items():
            got = units.get(field_name)
            if got is not None and got != expected:
                # Refuse rather than convert. A conversion table is one more
                # thing to get wrong, and a provider changing units under us is
                # worth failing loudly over.
                raise WeatherMalformed(
                    f"{self.name} returned {field_name} in {got!r}, "
                    f"expected {expected!r}"
                )

        observed_at = self._parse_time(current.get("time"))

        def number(key: str) -> float | None:
            value = current.get(key)
            return float(value) if isinstance(value, (int, float)) else None

        code = current.get("weather_code")

        return WeatherObservation(
            lat=lat,
            lon=lon,
            provider=self.name,
            observed_at=observed_at,
            temperature_c=number("temperature_2m"),
            precipitation_mm=number("precipitation"),
            wind_speed_kmh=number("wind_speed_10m"),
            wind_gust_kmh=number("wind_gusts_10m"),
            # Kept as text. Mapping a code to "thunderstorm" is a judgement with
            # operational consequences and is not made at this layer.
            condition_code=str(code) if code is not None else None,
            metadata={"source": "open-meteo/v1/forecast"},
        )

    def _parse_time(self, raw: object) -> datetime:
        """The provider's observation time, as UTC.

        Requested with `timezone=UTC`, so a naive timestamp is UTC by
        construction. Interpreted rather than rejected, because the alternative
        - discarding a good observation over a missing offset - loses real data
        for a formatting detail. The same choice telemetry makes for device
        timestamps.
        """
        if not isinstance(raw, str) or not raw:
            raise WeatherMalformed(f"{self.name} returned no observation time")
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError as exc:
            raise WeatherMalformed(
                f"{self.name} returned an unparseable time {raw!r}"
            ) from exc
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
