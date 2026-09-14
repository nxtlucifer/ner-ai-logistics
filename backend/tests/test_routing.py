"""Routing subsystem: normalised model, provider parsing, fallback chain.

No database and no network. The provider is driven through `httpx.MockTransport`
so every branch a real provider can produce - timeout, 5xx, refusal, nonsense -
is exercised deterministically instead of being hoped for.

The negative cases carry the weight. A routing bug does not look like a crash;
it looks like a plausible line drawn slightly wrong on a dispatcher's map, which
is exactly the kind of thing that gets believed.
"""

import httpx
import pytest

from app.domain import routing
from app.domain.routing import (
    Coordinate,
    RouteCandidate,
    RoutingMalformed,
    RoutingRejected,
    RoutingUnavailable,
    haversine_m,
    is_distinct_corridor,
    sample_positions,
)
from app.models.enums import RouteKind
from app.services.routing.base import ChainAttempt, RoutingChain
from app.services.routing.osrm import OsrmRoutingProvider

GUWAHATI = Coordinate(lat=26.1445, lon=91.7362)
JORHAT = Coordinate(lat=26.7509, lon=94.2037)

# A short real-looking corridor, in the model's (lat, lon) order.
GEOMETRY = [(26.1445, 91.7362), (26.4, 92.9), (26.7509, 94.2037)]


def _candidate(**overrides) -> RouteCandidate:
    kwargs = {
        "kind": RouteKind.PRIMARY,
        "provider": "test",
        "geometry": GEOMETRY,
        "distance_m": 308_000.0,
        "duration_s": 21_600.0,
    }
    kwargs.update(overrides)
    return RouteCandidate(**kwargs)


class TestRouteCandidate:
    def test_a_valid_candidate_is_accepted(self) -> None:
        c = _candidate()
        assert c.distance_km == pytest.approx(308.0)
        assert c.duration_min == 360

    def test_a_missing_duration_stays_none_and_never_becomes_zero(self) -> None:
        """NULL means 'not available' and must render as such.

        Zero would be a claim - an instantaneous trip - rather than an absence.
        """
        assert _candidate(duration_s=None).duration_min is None

    def test_a_two_point_geometry_is_refused(self) -> None:
        """Several providers return the straight line between endpoints when
        they cannot route. Drawing it puts a truck through a river."""
        with pytest.raises(RoutingMalformed):
            _candidate(geometry=[(26.1445, 91.7362)])

    def test_an_implausible_distance_is_refused(self) -> None:
        with pytest.raises(RoutingMalformed):
            _candidate(distance_m=99_000_000.0)

    def test_a_zero_distance_is_refused(self) -> None:
        with pytest.raises(RoutingMalformed):
            _candidate(distance_m=0.0)

    def test_a_negative_duration_is_refused(self) -> None:
        with pytest.raises(RoutingMalformed):
            _candidate(duration_s=-1.0)

    def test_an_inverted_coordinate_is_refused(self) -> None:
        """The single most common spatial bug.

        Guwahati is (26.14 N, 91.73 E); swapped, latitude becomes 91.73, which
        is outside -90..90 and is caught here rather than stored.
        """
        with pytest.raises(RoutingMalformed):
            _candidate(geometry=[(91.7362, 26.1445), (94.2037, 26.7509)])

    def test_wkt_is_lon_lat_not_lat_lon(self) -> None:
        """WKT is x-then-y, the opposite of how the pair is spoken."""
        wkt = _candidate(geometry=[(26.1445, 91.7362), (26.7509, 94.2037)]).to_wkt()
        assert wkt == "LINESTRING(91.7362 26.1445, 94.2037 26.7509)"


# --- Provider -------------------------------------------------------------


def _ok_body(coords: list[list[float]] | None = None) -> dict:
    return {
        "code": "Ok",
        "routes": [
            {
                "distance": 308000.0,
                "duration": 21600.0,
                # GeoJSON is [lon, lat].
                "geometry": {
                    "coordinates": coords
                    or [[91.7362, 26.1445], [92.9, 26.4], [94.2037, 26.7509]]
                },
            }
        ],
    }


class TestOsrmProvider:
    """Driven through MockTransport, patched onto httpx directly."""

    async def _route(self, monkeypatch, handler):
        provider = OsrmRoutingProvider("https://routing.test", name="osrm-test")
        transport = httpx.MockTransport(handler)
        real_init = httpx.AsyncClient.__init__

        def patched(self, *args, **kwargs):
            kwargs["transport"] = transport
            real_init(self, *args, **kwargs)

        monkeypatch.setattr(httpx.AsyncClient, "__init__", patched)
        return await provider.route(GUWAHATI, JORHAT, kind=RouteKind.PRIMARY)

    async def test_parses_a_successful_route(self, monkeypatch) -> None:
        captured: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["ua"] = request.headers.get("user-agent")
            return httpx.Response(200, json=_ok_body())

        candidate = await self._route(monkeypatch, handler)

        assert candidate.provider == "osrm-test"
        assert candidate.distance_m == 308000.0
        assert candidate.duration_s == 21600.0
        # Converted back into the application's (lat, lon) order.
        assert candidate.geometry[0] == (26.1445, 91.7362)
        # lon,lat in the path, per the OSRM contract.
        assert "91.7362,26.1445;94.2037,26.7509" in captured["url"]
        assert "geometries=geojson" in captured["url"]
        # `simplified`, not `full`. Measured on the live service: `full` returns
        # 5,213 points (~121 KB of JSON) for the Guwahati-Jorhat corridor where
        # `simplified` returns 52 (~1.2 KB) with the SAME distance and duration.
        # A dispatcher views the line at a zoom where the difference is
        # invisible, and this payload is fetched on every trip selection.
        assert "overview=simplified" in captured["url"]
        # The usage policy requires an identifying User-Agent.
        assert captured["ua"] and "ner-fleet" in captured["ua"]

    @pytest.mark.parametrize("code", ["NoRoute", "NoSegment", "InvalidQuery", "TooBig"])
    async def test_provider_refusals_are_rejections_not_outages(
        self, monkeypatch, code: str
    ) -> None:
        """Rejected, not Unavailable - so the chain does NOT try the fallback.

        A second provider will also fail to route from an unroutable point, and
        trying it spends another timeout to reach the same answer.
        """

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(400, json={"code": code})

        with pytest.raises(RoutingRejected):
            await self._route(monkeypatch, handler)

    async def test_a_server_error_is_an_outage(self, monkeypatch) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(503, text="upstream down")

        with pytest.raises(RoutingUnavailable):
            await self._route(monkeypatch, handler)

    async def test_a_timeout_is_an_outage(self, monkeypatch) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectTimeout("too slow")

        with pytest.raises(RoutingUnavailable):
            await self._route(monkeypatch, handler)

    async def test_non_json_is_malformed(self, monkeypatch) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text="<html>proxy error</html>")

        with pytest.raises(RoutingMalformed):
            await self._route(monkeypatch, handler)

    async def test_ok_with_no_routes_is_malformed(self, monkeypatch) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"code": "Ok", "routes": []})

        with pytest.raises(RoutingMalformed):
            await self._route(monkeypatch, handler)

    async def test_an_inverted_provider_geometry_is_caught(self, monkeypatch) -> None:
        """If the provider ever emits lat,lon we must not draw it."""

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200, json=_ok_body(coords=[[26.1445, 91.7362], [26.7509, 94.2037]])
            )

        with pytest.raises(RoutingMalformed):
            await self._route(monkeypatch, handler)


# --- Chain ----------------------------------------------------------------


class _StubProvider:
    """Implements the full RoutingProvider protocol, not just the easy half.

    `route_options` is what the chain calls; `route` delegates to it exactly as
    the real provider does. A stub that implemented only `route` would pass
    while the chain talked to something no provider actually offers.
    """

    def __init__(
        self,
        name: str,
        *,
        raises: Exception | None = None,
        options: int = 1,
    ) -> None:
        self.name = name
        self._raises = raises
        self._options = options
        self.calls = 0

    async def route_options(
        self, origin, destination, *, kind, limit=1, detailed=False
    ):  # noqa: ANN001
        self.calls += 1
        if self._raises is not None:
            raise self._raises
        count = min(self._options, limit)
        return [_candidate(provider=self.name) for _ in range(count)]

    async def route(self, origin, destination, *, kind):  # noqa: ANN001
        return (await self.route_options(origin, destination, kind=kind, limit=1))[0]


class TestRoutingChain:
    async def test_the_primary_answers_and_the_fallback_is_untouched(self) -> None:
        primary = _StubProvider("primary")
        fallback = _StubProvider("fallback")
        result = await RoutingChain([primary, fallback]).route(
            GUWAHATI, JORHAT, kind=RouteKind.PRIMARY
        )
        assert result.candidate.provider == "primary"
        assert result.used_fallback is False
        assert fallback.calls == 0, "the fallback was called unnecessarily"

    async def test_an_outage_falls_through_to_the_fallback(self) -> None:
        primary = _StubProvider("primary", raises=RoutingUnavailable("down"))
        fallback = _StubProvider("fallback")
        result = await RoutingChain([primary, fallback]).route(
            GUWAHATI, JORHAT, kind=RouteKind.PRIMARY
        )
        assert result.candidate.provider == "fallback"
        assert result.used_fallback is True
        assert result.attempts == (
            ChainAttempt("primary", ok=False, error="RoutingUnavailable"),
            ChainAttempt("fallback", ok=True),
        )

    async def test_malformed_also_falls_through(self) -> None:
        """A provider answering nonsense is as useful as one that is down."""
        primary = _StubProvider("primary", raises=RoutingMalformed("nonsense"))
        fallback = _StubProvider("fallback")
        result = await RoutingChain([primary, fallback]).route(
            GUWAHATI, JORHAT, kind=RouteKind.PRIMARY
        )
        assert result.candidate.provider == "fallback"

    async def test_a_rejection_is_terminal_and_spares_the_fallback(self) -> None:
        """The distinction the two exception types exist for."""
        primary = _StubProvider("primary", raises=RoutingRejected("no route"))
        fallback = _StubProvider("fallback")
        with pytest.raises(RoutingRejected):
            await RoutingChain([primary, fallback]).route(
                GUWAHATI, JORHAT, kind=RouteKind.PRIMARY
            )
        assert fallback.calls == 0, "an impossible request cost two provider budgets"

    async def test_every_provider_failing_raises_rather_than_degrading(self) -> None:
        """No empty route. The UI must say 'no route available'.

        A degraded result would render as a straight line through the terrain,
        which looks like a route and is not one.
        """
        chain = RoutingChain(
            [
                _StubProvider("a", raises=RoutingUnavailable("down")),
                _StubProvider("b", raises=RoutingUnavailable("down")),
            ]
        )
        with pytest.raises(RoutingUnavailable) as exc:
            await chain.route(GUWAHATI, JORHAT, kind=RouteKind.PRIMARY)
        assert "a" in str(exc.value) and "b" in str(exc.value)

    def test_an_empty_chain_is_a_configuration_error(self) -> None:
        with pytest.raises(ValueError):
            RoutingChain([])


class TestCorridorDistinctness:
    """Whether a provider "alternative" is honestly a different route.

    This is the gate that stops an EMERGENCY_BACKUP being the same road twice.
    Providers routinely return an alternative that leaves the highway for a few
    hundred metres and rejoins it; offering that to a dispatcher as a second
    option would be offering a choice that is not one.
    """

    def test_a_route_is_not_distinct_from_itself(self) -> None:
        c = _candidate()
        assert is_distinct_corridor(c, c) is False

    def test_a_minor_detour_is_not_a_different_corridor(self) -> None:
        """~300 m off the line and back. Same road, in practice."""
        nudged = [(lat + 0.003, lon) for lat, lon in GEOMETRY]
        assert (
            is_distinct_corridor(_candidate(), _candidate(geometry=nudged)) is False
        )

    def test_a_genuinely_separate_corridor_is_distinct(self) -> None:
        """A route half a degree away is a different valley, not a detour."""
        far = [(lat + 0.5, lon + 0.5) for lat, lon in GEOMETRY]
        assert is_distinct_corridor(_candidate(), _candidate(geometry=far)) is True

    def test_distinctness_is_positional_not_merely_length(self) -> None:
        """Two routes of the SAME length can still go different ways.

        A backup route's entire value is going somewhere else, so comparing
        total distances would miss exactly the case that matters.
        """
        mirrored = [(lat, lon + 0.6) for lat, lon in GEOMETRY]
        a, b = _candidate(), _candidate(geometry=mirrored)
        assert a.distance_m == b.distance_m
        assert is_distinct_corridor(a, b) is True


class TestProviderAlternatives:
    async def test_a_single_option_request_asks_for_no_alternatives(
        self, monkeypatch
    ) -> None:
        captured: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            return httpx.Response(200, json=_ok_body())

        provider = OsrmRoutingProvider("https://routing.test", name="osrm-test")
        transport = httpx.MockTransport(handler)
        real_init = httpx.AsyncClient.__init__

        def patched(self, *args, **kwargs):
            kwargs["transport"] = transport
            real_init(self, *args, **kwargs)

        monkeypatch.setattr(httpx.AsyncClient, "__init__", patched)
        out = await provider.route_options(
            GUWAHATI, JORHAT, kind=RouteKind.PRIMARY, limit=1
        )
        assert len(out) == 1
        assert "alternatives=false" in captured["url"]

    async def test_more_options_are_requested_and_parsed(self, monkeypatch) -> None:
        captured: dict = {}
        body = _ok_body()
        body["routes"].append(
            {
                "distance": 330000.0,
                "duration": 24000.0,
                "geometry": {
                    "coordinates": [[92.2, 26.6], [93.0, 26.9], [94.2037, 26.7509]]
                },
            }
        )

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            return httpx.Response(200, json=body)

        provider = OsrmRoutingProvider("https://routing.test", name="osrm-test")
        transport = httpx.MockTransport(handler)
        real_init = httpx.AsyncClient.__init__

        def patched(self, *args, **kwargs):
            kwargs["transport"] = transport
            real_init(self, *args, **kwargs)

        monkeypatch.setattr(httpx.AsyncClient, "__init__", patched)
        out = await provider.route_options(
            GUWAHATI, JORHAT, kind=RouteKind.PRIMARY, limit=2
        )
        assert len(out) == 2
        # OSRM's `alternatives` takes a COUNT of extras, not a boolean.
        assert "alternatives=1" in captured["url"]
        assert out[0].metadata["option_index"] == "0"
        assert out[1].metadata["option_index"] == "1"

    async def test_one_road_returns_one_option_without_complaint(
        self, monkeypatch
    ) -> None:
        """Most NER corridors have one sensible road.

        Asking for two and receiving one is the honest answer, not a shortfall
        to pad out.
        """

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=_ok_body())

        provider = OsrmRoutingProvider("https://routing.test", name="osrm-test")
        transport = httpx.MockTransport(handler)
        real_init = httpx.AsyncClient.__init__

        def patched(self, *args, **kwargs):
            kwargs["transport"] = transport
            real_init(self, *args, **kwargs)

        monkeypatch.setattr(httpx.AsyncClient, "__init__", patched)
        out = await provider.route_options(
            GUWAHATI, JORHAT, kind=RouteKind.PRIMARY, limit=2
        )
        assert len(out) == 1


class TestWeatherSamplingIsSpreadByDistance:
    """Where the five weather samples actually land on a real corridor.

    `sample_positions` feeds `route_risk`, which feeds the recommendation and
    the reroute assessment. If the samples cluster, every one of those is
    scored against a corridor it barely looked at.

    Clustering is not hypothetical here. This project asks OSRM for
    `overview=simplified`, and a simplified polyline keeps MORE vertices where
    the road bends - which on a NER corridor means the hills, and leaves long
    straight stretches with almost none. Sampling by index then puts most of
    the samples in a small part of the route.
    """

    #: Vertices dense through a hill section, then two long straight legs -
    #: the shape `overview=simplified` actually produces.
    HILLY = [
        (26.10, 91.70), (26.12, 91.75), (26.15, 91.79), (26.17, 91.84),
        (26.20, 91.88), (26.24, 91.93), (26.28, 91.99), (26.33, 92.05),
        (26.40, 92.90), (26.75, 94.20),
    ]

    @staticmethod
    def _along_km(geometry, point):
        """How far along `geometry` a point lying ON it sits, and the total.

        Projects onto the SEGMENTS rather than snapping to the nearest vertex.
        Samples are interpolated, so a nearest-vertex measure would report a
        sample 66 km along as being at 44 km - and a test whose measurement is
        wrong can pass for the wrong reason.

        The segment a point belongs to is the one where going via the point
        adds no detour.
        """
        cumulative = [0.0]
        for i in range(1, len(geometry)):
            cumulative.append(
                cumulative[-1] + haversine_m(*geometry[i - 1], *geometry[i])
            )
        best_detour, best_along = float("inf"), 0.0
        for i in range(1, len(geometry)):
            detour = (
                haversine_m(*geometry[i - 1], *point)
                + haversine_m(*point, *geometry[i])
                - haversine_m(*geometry[i - 1], *geometry[i])
            )
            if detour < best_detour:
                best_detour = detour
                best_along = cumulative[i - 1] + haversine_m(*geometry[i - 1], *point)
        return best_along / 1000.0, cumulative[-1] / 1000.0

    def test_samples_are_spread_across_the_whole_corridor(self) -> None:
        samples = sample_positions(self.HILLY, 5)
        assert len(samples) == 5

        positions = [self._along_km(self.HILLY, p)[0] for p in samples]
        total = self._along_km(self.HILLY, samples[0])[1]

        # No more than two of five may fall in the first quarter. Sampling by
        # index put FOUR of five in the first 17% of this route, leaving 220 km
        # represented by a single reading - so a storm sitting on that stretch
        # would be seen once out of five times and scored as if it were local.
        in_first_quarter = sum(1 for p in positions if p < total * 0.25)
        assert in_first_quarter <= 2, (
            f"{in_first_quarter}/5 samples in the first quarter: {positions}"
        )

        # And the corridor's far half must be represented by more than the
        # endpoint alone.
        in_second_half = sum(1 for p in positions if p > total * 0.5)
        assert in_second_half >= 2, (
            f"only {in_second_half}/5 samples past halfway: {positions}"
        )

    def test_the_ends_are_always_sampled(self) -> None:
        """Origin and destination are the two points a dispatcher assumes are
        covered."""
        samples = sample_positions(self.HILLY, 5)
        assert samples[0] == self.HILLY[0]
        assert samples[-1] == self.HILLY[-1]

    def test_an_evenly_spaced_line_is_still_evenly_sampled(self) -> None:
        """The change must not disturb the ordinary case."""
        even = [(26.0, 91.0 + i * 0.1) for i in range(11)]
        samples = sample_positions(even, 5)
        positions = [self._along_km(even, p)[0] for p in samples]
        total = self._along_km(even, samples[0])[1]
        for i, p in enumerate(positions):
            assert p == pytest.approx(total * i / 4, rel=0.15, abs=1.0)

    def test_fewer_vertices_than_samples_returns_them_all(self) -> None:
        short = [(26.0, 91.0), (26.5, 92.0)]
        assert sample_positions(short, 5) == short

    def test_degenerate_inputs_do_not_raise(self) -> None:
        assert sample_positions([], 5) == []
        assert sample_positions([(26.0, 91.0)], 5) == [(26.0, 91.0)]
        assert sample_positions(self.HILLY, 0) == []
        assert sample_positions(self.HILLY, 1) == [self.HILLY[0]]


class TestEndpointValidation:
    """A provider answer is checked against the endpoints it was asked for.

    The route on TRP-08726C5F (2,908 km) passes: it really connects its two
    stops. What is refused is the shape of a WRONG route - one from a previous
    request, a swapped pair, a reroute origin used by mistake, a truncated
    polyline - which is the class of fault this exists to catch.
    """

    ORIGIN = Coordinate(lat=26.1445, lon=91.7362)  # Guwahati
    DESTINATION = Coordinate(lat=25.5788, lon=91.8933)  # Shillong

    def _candidate(self, geometry, distance_m):  # noqa: ANN001
        return RouteCandidate(
            kind=RouteKind.PRIMARY, provider="t", geometry=geometry,
            distance_m=distance_m, duration_s=4_620.0,
        )

    def test_a_route_that_connects_the_stops_passes(self) -> None:
        c = self._candidate([(26.1445, 91.7362), (25.9, 91.8), (25.5788, 91.8933)], 98_800.0)
        assert routing.endpoint_mismatch(c, self.ORIGIN, self.DESTINATION) is None

    def test_the_real_2908_km_answer_passes_because_it_did_connect_its_stops(self) -> None:
        nagaland = Coordinate(lat=25.9623701, lon=94.5856111)
        ahmedabad = Coordinate(lat=23.0687402, lon=72.6734956)
        c = self._candidate([(25.962233, 94.585478), (24.5, 85.0), (23.069084, 72.67363)], 2_908_160.0)
        assert routing.endpoint_mismatch(c, nagaland, ahmedabad) is None

    def test_a_route_starting_elsewhere_is_named(self) -> None:
        c = self._candidate([(26.7509, 94.2037), (26.0, 92.0), (25.5788, 91.8933)], 400_000.0)
        assert routing.endpoint_mismatch(c, self.ORIGIN, self.DESTINATION) == routing.REASON_STARTS_AWAY_FROM_ORIGIN

    def test_a_route_ending_elsewhere_is_named(self) -> None:
        c = self._candidate([(26.1445, 91.7362), (26.4, 92.9), (26.7509, 94.2037)], 305_000.0)
        assert routing.endpoint_mismatch(c, self.ORIGIN, self.DESTINATION) == routing.REASON_ENDS_AWAY_FROM_DESTINATION

    def test_a_swapped_pair_is_refused(self) -> None:
        c = self._candidate([(25.5788, 91.8933), (25.9, 91.8), (26.1445, 91.7362)], 98_800.0)
        assert routing.endpoint_mismatch(c, self.ORIGIN, self.DESTINATION) == routing.REASON_STARTS_AWAY_FROM_ORIGIN

    def test_a_truncated_line_shorter_than_the_straight_line_is_refused(self) -> None:
        c = self._candidate([(26.1445, 91.7362), (25.9, 91.8), (25.5788, 91.8933)], 30_000.0)
        assert routing.endpoint_mismatch(c, self.ORIGIN, self.DESTINATION) == routing.REASON_SHORTER_THAN_STRAIGHT_LINE

    def test_a_distance_no_road_between_these_points_can_have_is_refused(self) -> None:
        c = self._candidate([(26.1445, 91.7362), (25.9, 91.8), (25.5788, 91.8933)], 900_000.0)
        assert routing.endpoint_mismatch(c, self.ORIGIN, self.DESTINATION) == routing.REASON_IMPLAUSIBLY_LONG

    def test_snapping_within_tolerance_is_not_a_mismatch(self) -> None:
        # OSRM snaps a pin in a field to the nearest road, a few km at most.
        c = self._candidate([(26.17, 91.76), (25.9, 91.8), (25.60, 91.90)], 98_000.0)
        assert routing.endpoint_mismatch(c, self.ORIGIN, self.DESTINATION) is None
