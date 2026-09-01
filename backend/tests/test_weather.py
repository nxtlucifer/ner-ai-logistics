"""Weather subsystem: normalised observation and provider parsing.

No database and no network - the provider is driven through
`httpx.MockTransport`, so a timeout, a refusal, a unit change and a missing
field are all exercised deterministically rather than hoped for.

The unit check is the one carrying real weight. A wind speed read as m/s when
it is km/h is a 3.6x error in a number a dispatcher might hold a truck over,
and nothing about the response would look wrong.
"""

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.domain.weather import (
    FRESHNESS_CURRENT,
    FRESHNESS_STALE,
    WeatherMalformed,
    WeatherObservation,
    WeatherRejected,
    WeatherUnavailable,
)
from app.services.weather import OpenMeteoWeatherProvider

GUWAHATI = (26.1445, 91.7362)
BASE = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)


def _body(**overrides) -> dict:
    body = {
        "latitude": 26.1445,
        "longitude": 91.7362,
        "current": {
            "time": "2026-01-01T12:00",
            "temperature_2m": 24.3,
            "precipitation": 0.4,
            "weather_code": 61,
            "wind_speed_10m": 11.2,
            "wind_gusts_10m": 19.8,
        },
        "current_units": {
            "temperature_2m": "°C",
            "precipitation": "mm",
            "wind_speed_10m": "km/h",
            "wind_gusts_10m": "km/h",
        },
    }
    body.update(overrides)
    return body


class TestWeatherObservation:
    def test_absent_measurements_stay_none_and_never_become_zero(self) -> None:
        """0 °C and "no reading" are very different facts on a hill route."""
        o = WeatherObservation(
            lat=26.1445, lon=91.7362, provider="p", observed_at=BASE
        )
        assert o.temperature_c is None
        assert o.precipitation_mm is None
        assert o.wind_speed_kmh is None

    def test_an_inverted_coordinate_is_refused(self) -> None:
        with pytest.raises(WeatherMalformed):
            WeatherObservation(
                lat=91.7362, lon=26.1445, provider="p", observed_at=BASE
            )

    def test_negative_measurements_are_refused(self) -> None:
        with pytest.raises(WeatherMalformed):
            WeatherObservation(
                lat=26.1, lon=91.7, provider="p", observed_at=BASE,
                wind_speed_kmh=-1.0,
            )
        with pytest.raises(WeatherMalformed):
            WeatherObservation(
                lat=26.1, lon=91.7, provider="p", observed_at=BASE,
                precipitation_mm=-0.5,
            )

    def test_freshness_is_labelled_not_guessed(self) -> None:
        o = WeatherObservation(
            lat=26.1, lon=91.7, provider="p", observed_at=BASE
        )
        assert o.freshness(now=BASE + timedelta(minutes=30)) == FRESHNESS_CURRENT
        assert o.freshness(now=BASE + timedelta(hours=3)) == FRESHNESS_STALE

    def test_there_is_no_risk_score(self) -> None:
        """Turning conditions into a safety judgement needs agreed thresholds.

        None exist, so the model must not carry a field that implies they do -
        an unearned number rendered next to a truck is worse than a blank,
        because a dispatcher will act on it.
        """
        o = WeatherObservation(
            lat=26.1, lon=91.7, provider="p", observed_at=BASE
        )
        for forbidden in ("risk", "risk_score", "severity", "is_dangerous"):
            assert not hasattr(o, forbidden), f"{forbidden} implies a judgement"

    def test_there_is_no_visibility_field(self) -> None:
        """Open-Meteo exposes visibility hourly, not currently.

        A field that is always None invites a UI to render "0 m".
        """
        o = WeatherObservation(
            lat=26.1, lon=91.7, provider="p", observed_at=BASE
        )
        assert not hasattr(o, "visibility_m")


class TestOpenMeteoProvider:
    async def _current(self, monkeypatch, handler, coords=GUWAHATI):
        provider = OpenMeteoWeatherProvider(
            "https://weather.test", name="om-test"
        )
        transport = httpx.MockTransport(handler)
        real_init = httpx.AsyncClient.__init__

        def patched(self, *args, **kwargs):
            kwargs["transport"] = transport
            real_init(self, *args, **kwargs)

        monkeypatch.setattr(httpx.AsyncClient, "__init__", patched)
        return await provider.current(*coords)

    async def test_parses_a_current_observation(self, monkeypatch) -> None:
        captured: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["ua"] = request.headers.get("user-agent")
            return httpx.Response(200, json=_body())

        o = await self._current(monkeypatch, handler)

        assert o.provider == "om-test"
        assert o.temperature_c == 24.3
        assert o.precipitation_mm == 0.4
        assert o.wind_speed_kmh == 11.2
        assert o.wind_gust_kmh == 19.8
        assert o.condition_code == "61"
        assert o.observed_at == datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
        # UTC is requested explicitly, so a naive timestamp is UTC by
        # construction rather than by assumption.
        assert "timezone=UTC" in captured["url"]
        assert "latitude=26.1445" in captured["url"]
        assert captured["ua"] and "ner-fleet" in captured["ua"]

    async def test_visibility_is_never_requested(self, monkeypatch) -> None:
        """It is not a `current` variable; asking would error or return nothing."""
        captured: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            return httpx.Response(200, json=_body())

        await self._current(monkeypatch, handler)
        assert "visibility" not in captured["url"]

    async def test_a_unit_change_is_refused_rather_than_misread(
        self, monkeypatch
    ) -> None:
        """The failure this check exists for.

        m/s read as km/h is a 3.6x error, and nothing in the response would
        look wrong - the number is simply smaller.
        """
        body = _body()
        body["current_units"]["wind_speed_10m"] = "m/s"

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=body)

        with pytest.raises(WeatherMalformed) as exc:
            await self._current(monkeypatch, handler)
        assert "m/s" in str(exc.value)

    async def test_an_out_of_range_coordinate_never_reaches_the_network(
        self, monkeypatch
    ) -> None:
        """Our own bug should not spend a free service's budget."""
        called = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            called["n"] += 1
            return httpx.Response(200, json=_body())

        with pytest.raises(WeatherRejected):
            await self._current(monkeypatch, handler, coords=(91.7362, 26.1445))
        assert called["n"] == 0

    async def test_a_provider_refusal_is_not_an_outage(self, monkeypatch) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(400, json={"error": True, "reason": "bad"})

        with pytest.raises(WeatherRejected):
            await self._current(monkeypatch, handler)

    async def test_a_server_error_is_an_outage(self, monkeypatch) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(503, text="down")

        with pytest.raises(WeatherUnavailable):
            await self._current(monkeypatch, handler)

    async def test_a_timeout_is_an_outage(self, monkeypatch) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectTimeout("slow")

        with pytest.raises(WeatherUnavailable):
            await self._current(monkeypatch, handler)

    async def test_a_missing_current_block_is_malformed(self, monkeypatch) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"latitude": 26.1})

        with pytest.raises(WeatherMalformed):
            await self._current(monkeypatch, handler)

    async def test_missing_units_are_malformed_not_assumed(
        self, monkeypatch
    ) -> None:
        """Without units the numbers mean nothing in particular."""
        body = _body()
        del body["current_units"]

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=body)

        with pytest.raises(WeatherMalformed):
            await self._current(monkeypatch, handler)

    async def test_a_partial_response_keeps_what_it_has(self, monkeypatch) -> None:
        """A provider omitting one field must not lose the others."""
        body = _body()
        del body["current"]["wind_gusts_10m"]

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=body)

        o = await self._current(monkeypatch, handler)
        assert o.wind_gust_kmh is None
        assert o.temperature_c == 24.3
