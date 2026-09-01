"""OSRM routing provider.

Contract verified against the official API documentation (Project-OSRM v5.24),
not from memory:

    GET /route/v1/{profile}/{lon},{lat};{lon},{lat}?geometries=geojson&overview=simplified

  - coordinates are **lon,lat** - the opposite order to this application's
    `{lat, lon}` convention, which is the single most common spatial bug and is
    why the inversion happens in exactly one place here
  - `routes[].distance` is metres, `routes[].duration` is seconds
  - `code` is `Ok` on success; `NoRoute`, `NoSegment`, `TooBig`, `InvalidQuery`,
    `InvalidValue`, `InvalidUrl`, `InvalidService`, `InvalidVersion`,
    `InvalidOptions` on failure
  - HTTP 200 for success, 400 for errors

OPERATIONAL STATUS OF THE PUBLIC DEMO SERVER

The official usage policy is explicit: *"We don't give any quality guarantees.
The Demo Server is supplied on best effort basis"*, and *"Access to the Demo
Server shall be withdrawn at any time and without giving a reason."* It also
requires a real User-Agent and ODbL attribution.

So this is **not** a dependency to demo on alone. It is configured as a keyless
FALLBACK so routing works with no credential at all, while the primary slot
stays open for a provider with an actual service level. `ROUTING_PRIMARY_URL`
points at any OSRM-compatible endpoint that needs no credential - a self-hosted
instance, say. A provider requiring a key needs its own class against
`RoutingProvider`, because where a credential goes differs per vendor; there is
deliberately no key setting that would accept one and send it nowhere.

When no primary is configured this is the ONLY provider, and the chain reports
that honestly rather than pretending to be resilient.

NO RETRIES HERE. The chain falls through to the next provider on failure, which
is a better use of the same wall-clock than asking a struggling server twice.
Retrying inside the provider and falling through outside it would multiply into
a retry storm against a service whose policy is "excessive use is not allowed".
"""

import logging
from typing import Any, Final

import httpx

from app.domain.routing import (
    Coordinate,
    RouteCandidate,
    RoutingMalformed,
    RoutingRejected,
    RoutingUnavailable,
)
from app.models.enums import RouteKind

logger = logging.getLogger(__name__)

#: Identifies this application, as the usage policy requires.
USER_AGENT: Final[str] = "ner-fleet-intelligence/0.1 (SIH26002; routing)"

#: Provider codes that mean "reached, and the answer is no". Terminal - a second
#: provider will also fail to route from a point in the sea.
_REJECTING_CODES: Final[frozenset[str]] = frozenset(
    {
        "NoRoute",
        "NoSegment",
        "TooBig",
        "InvalidQuery",
        "InvalidValue",
        "InvalidUrl",
        "InvalidService",
        "InvalidVersion",
        "InvalidOptions",
    }
)


class OsrmRoutingProvider:
    """Implements `RoutingProvider` against an OSRM HTTP endpoint."""

    def __init__(
        self,
        base_url: str,
        *,
        profile: str = "driving",
        timeout_s: float = 8.0,
        name: str = "osrm",
    ) -> None:
        self.name = name
        self._base_url = base_url.rstrip("/")
        self._profile = profile
        self._timeout = timeout_s

    async def route(
        self, origin: Coordinate, destination: Coordinate, *, kind: RouteKind
    ) -> RouteCandidate:
        """The single best route."""
        return (
            await self.route_options(origin, destination, kind=kind, limit=1)
        )[0]

    async def route_options(
        self,
        origin: Coordinate,
        destination: Coordinate,
        *,
        kind: RouteKind,
        limit: int = 1,
    ) -> list[RouteCandidate]:
        """Up to `limit` routes, best first.

        OSRM's `alternatives` parameter takes a count. It is a request, not a
        promise: on a corridor with one sensible road - which describes much of
        the NER network - it returns one route, and that is the honest answer
        rather than a shortfall to paper over.
        """
        # lon,lat - see the module docstring. One inversion, one place.
        pair = (
            f"{origin.lon},{origin.lat};{destination.lon},{destination.lat}"
        )
        url = f"{self._base_url}/route/v1/{self._profile}/{pair}"
        params = {
            "geometries": "geojson",
            # `simplified`, not `full`. Measured against the live service on the
            # Guwahati-Jorhat corridor, `full` returns 5,213 points - roughly
            # 100 KB of JSON for one route, fetched on every trip selection and
            # sent to the browser, to draw a line a dispatcher views at a zoom
            # where the extra vertices are invisible. `simplified` is OSRM's own
            # default and keeps the shape of the road.
            "overview": "simplified",
            "alternatives": "false" if limit <= 1 else str(limit - 1),
            "steps": "false",
        }

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(
                    url, params=params, headers={"User-Agent": USER_AGENT}
                )
        except httpx.TimeoutException as exc:
            raise RoutingUnavailable(f"{self.name} timed out") from exc
        except httpx.HTTPError as exc:
            raise RoutingUnavailable(f"{self.name} is unreachable") from exc

        # 5xx is an outage - fall through. 4xx is usually a refusal, and OSRM
        # puts the reason in the body, so the body is parsed either way.
        if response.status_code >= 500:
            raise RoutingUnavailable(
                f"{self.name} returned {response.status_code}"
            )

        try:
            body: Any = response.json()
        except ValueError as exc:
            raise RoutingMalformed(f"{self.name} returned non-JSON") from exc

        if not isinstance(body, dict):
            raise RoutingMalformed(f"{self.name} returned a non-object body")

        code = body.get("code")
        if code in _REJECTING_CODES:
            raise RoutingRejected(f"{self.name} could not route this request ({code})")
        if code != "Ok":
            raise RoutingMalformed(f"{self.name} returned an unknown code {code!r}")

        return self._parse_all(body, kind=kind, limit=limit)

    def _parse_all(
        self, body: dict, *, kind: RouteKind, limit: int
    ) -> list[RouteCandidate]:
        routes = body.get("routes")
        if not isinstance(routes, list) or not routes:
            raise RoutingMalformed(f"{self.name} returned Ok with no routes")

        out: list[RouteCandidate] = []
        for index, route in enumerate(routes[:limit]):
            # The first route is the primary; any others are alternatives and
            # are labelled by the caller, not here - this layer does not decide
            # what an alternative means operationally.
            out.append(self._parse_one(route, kind=kind, index=index))
        return out

    def _parse_one(
        self, route: object, *, kind: RouteKind, index: int
    ) -> RouteCandidate:
        if not isinstance(route, dict):
            raise RoutingMalformed(f"{self.name} returned a malformed route")

        geometry = route.get("geometry")
        if not isinstance(geometry, dict):
            raise RoutingMalformed(f"{self.name} returned no geojson geometry")
        raw = geometry.get("coordinates")
        if not isinstance(raw, list):
            raise RoutingMalformed(f"{self.name} returned no coordinate list")

        points: list[tuple[float, float]] = []
        for item in raw:
            if (
                not isinstance(item, (list, tuple))
                or len(item) < 2
                or not isinstance(item[0], (int, float))
                or not isinstance(item[1], (int, float))
            ):
                raise RoutingMalformed(
                    f"{self.name} returned a malformed coordinate"
                )
            # GeoJSON is [lon, lat]; the model holds (lat, lon).
            points.append((float(item[1]), float(item[0])))

        distance = route.get("distance")
        duration = route.get("duration")
        if not isinstance(distance, (int, float)):
            raise RoutingMalformed(f"{self.name} returned no usable distance")

        # RouteCandidate validates plausibility and coordinate ranges in
        # __post_init__ and raises RoutingMalformed itself, so a provider that
        # returns a straight line or an inverted coordinate is caught here
        # rather than being drawn on a dispatcher's map.
        return RouteCandidate(
            kind=kind,
            provider=self.name,
            geometry=points,
            distance_m=float(distance),
            duration_s=float(duration) if isinstance(duration, (int, float)) else None,
            metadata={"profile": self._profile, "option_index": str(index)},
        )
