"""Normalised weather model, independent of any provider.

Deterministic application logic. No I/O, no provider SDK, no model.

Same shape as `app/domain/routing.py` and for the same reason: providers differ
in field names, units and envelopes, and the application should no more depend
on Open-Meteo's response format than on a particular database driver's.

WHAT THIS DELIBERATELY DOES NOT CARRY

No risk score, no "conditions are dangerous", no reroute recommendation. Turning
a temperature and a precipitation rate into a safety judgement requires
deterministic thresholds that have been agreed and tested - which do not exist
yet. `docs/SECURITY.md` and `docs/AI_MODELS.md` both take the same line: an
unearned number that renders next to a truck on a map is worse than a blank,
because a dispatcher will act on it.

So this layer reports what a provider said and how old it is. Whether 12 mm of
rain on NH-715 is a reason to hold a truck is a decision the system does not yet
make, and it does not pretend to.

NO VISIBILITY FIELD. Open-Meteo exposes visibility as an *hourly* variable, not
a current one. Carrying a `visibility` field that is always None would invite a
UI to render "0 m" - the same failure as a permanently-null fuel estimate - so
the field simply does not exist until a provider supplies it for the current
moment.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Final

#: Beyond this an observation describes weather that has since moved on. Named
#: rather than assumed, and returned with the data so a client cannot invent its
#: own idea of "current" - the same rule the fleet map follows for GPS
#: freshness (app/domain/telemetry_policy.py).
WEATHER_FRESH_SECONDS: Final[int] = 3_600

FRESHNESS_CURRENT: Final[str] = "CURRENT"
FRESHNESS_STALE: Final[str] = "STALE"


class WeatherError(Exception):
    """Base for every weather failure, so callers catch one thing."""


class WeatherUnavailable(WeatherError):
    """Provider unreachable, timed out, or returned 5xx. Retryable."""


class WeatherRejected(WeatherError):
    """Provider was reached and refused - bad coordinates, out of coverage.

    Not retryable, and not a reason to try a second provider: another one will
    also decline to forecast for a latitude of 200.
    """


class WeatherMalformed(WeatherError):
    """Provider answered with something unusable. A provider defect, not an
    outage, but treated as unavailable by any fallback chain."""


@dataclass(frozen=True)
class WeatherObservation:
    """Conditions at a point, as one provider reported them.

    Frozen: an observation is evidence of what was said at a moment. Anything
    derived from it is computed elsewhere.

    Every measurement is optional because providers differ in what they return,
    and `None` means "this provider did not supply it" - never zero. A
    temperature of 0 °C and an absent temperature are very different facts in a
    region with hill routes.
    """

    lat: float
    lon: float
    provider: str
    observed_at: datetime
    temperature_c: float | None = None
    precipitation_mm: float | None = None
    wind_speed_kmh: float | None = None
    wind_gust_kmh: float | None = None
    #: Provider-specific condition code, kept as text so no meaning is invented
    #: for it here. Translating a code into "storm" is a decision with
    #: consequences and belongs where those consequences are handled.
    condition_code: str | None = None
    fetched_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    metadata: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not (-90.0 <= self.lat <= 90.0) or not (-180.0 <= self.lon <= 180.0):
            raise WeatherMalformed(
                "observation carries an out-of-range coordinate; this is the "
                "shape of a latitude/longitude inversion"
            )
        if self.wind_speed_kmh is not None and self.wind_speed_kmh < 0:
            raise WeatherMalformed(f"negative wind speed {self.wind_speed_kmh}")
        if self.precipitation_mm is not None and self.precipitation_mm < 0:
            raise WeatherMalformed(
                f"negative precipitation {self.precipitation_mm}"
            )

    def age_seconds(self, now: datetime | None = None) -> float:
        reference = now or datetime.now(UTC)
        observed = self.observed_at
        if observed.tzinfo is None:
            observed = observed.replace(tzinfo=UTC)
        return max(0.0, (reference - observed).total_seconds())

    def freshness(self, now: datetime | None = None) -> str:
        """CURRENT or STALE, by the same convention the fleet map uses.

        A label rather than a boolean so the API can gain a third state later
        without every caller having to change how it reads the second.
        """
        window = timedelta(seconds=WEATHER_FRESH_SECONDS).total_seconds()
        return (
            FRESHNESS_CURRENT
            if self.age_seconds(now) <= window
            else FRESHNESS_STALE
        )
