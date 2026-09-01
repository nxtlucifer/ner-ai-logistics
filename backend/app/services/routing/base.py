"""Routing provider interface, and the chain that survives one failing.

    RoutingProvider (protocol)
            |
       +----+----+
       |         |
    primary   fallback
       |         |
       +----+----+
            |
     RouteCandidate  (normalised - app/domain/routing.py)

Nothing above this layer knows which provider answered. That is the point: a
provider is an operational dependency, and the trip service should no more
depend on OSRM's response shape than on a particular database driver's.
"""

import logging
from dataclasses import dataclass
from typing import Protocol

from app.domain.routing import (
    Coordinate,
    RouteCandidate,
    RoutingError,
    RoutingMalformed,
    RoutingRejected,
    RoutingUnavailable,
)
from app.models.enums import RouteKind

logger = logging.getLogger(__name__)


class RoutingProvider(Protocol):
    """Turns two points into a route, or raises a RoutingError.

    Implementations own their own transport, timeout and parsing, and normalise
    before returning. They must never leak a provider-shaped object upward, and
    must never invent a duration or a fuel figure the provider did not supply.
    """

    #: Short stable identifier, persisted to `trip_routes.routing_provider`.
    name: str

    async def route(
        self, origin: Coordinate, destination: Coordinate, *, kind: RouteKind
    ) -> RouteCandidate: ...

    async def route_options(
        self,
        origin: Coordinate,
        destination: Coordinate,
        *,
        kind: RouteKind,
        limit: int = 1,
    ) -> list[RouteCandidate]: ...


@dataclass(frozen=True)
class ChainAttempt:
    """What one provider did, for reporting and for the audit trail."""

    provider: str
    ok: bool
    error: str | None = None


@dataclass(frozen=True)
class ChainOptions:
    """Several routes from one provider, best first, plus what was tried."""

    candidates: tuple[RouteCandidate, ...]
    attempts: tuple[ChainAttempt, ...]

    @property
    def used_fallback(self) -> bool:
        return len(self.attempts) > 1


@dataclass(frozen=True)
class ChainResult:
    """The outcome of asking the chain, including what was tried.

    The attempts are carried deliberately. When a manager is looking at a route
    that came from the fallback, "which provider produced this and why" is the
    question they will ask, and reconstructing it from logs afterwards is worse
    than returning it.
    """

    candidate: RouteCandidate
    attempts: tuple[ChainAttempt, ...]

    @property
    def used_fallback(self) -> bool:
        return len(self.attempts) > 1


class RoutingChain:
    """Try providers in order until one answers.

    Falls through on `RoutingUnavailable` and `RoutingMalformed` - a provider
    that is down or answering nonsense should not end the request when another
    is configured.

    Does NOT fall through on `RoutingRejected`. A refusal means the provider was
    reached and said no route exists, or the coordinates are unroutable; a
    second provider will say the same, and trying it spends another budget and
    another timeout to arrive at the same answer more slowly. Distinguishing
    "the provider is broken" from "the request is impossible" is the whole
    reason those are separate exception types.
    """

    def __init__(self, providers: list[RoutingProvider]) -> None:
        if not providers:
            raise ValueError("a routing chain needs at least one provider")
        self._providers = providers

    @property
    def provider_names(self) -> tuple[str, ...]:
        return tuple(p.name for p in self._providers)

    async def route(
        self, origin: Coordinate, destination: Coordinate, *, kind: RouteKind
    ) -> ChainResult:
        result = await self.route_options(origin, destination, kind=kind, limit=1)
        return ChainResult(
            candidate=result.candidates[0], attempts=result.attempts
        )

    async def route_options(
        self,
        origin: Coordinate,
        destination: Coordinate,
        *,
        kind: RouteKind,
        limit: int = 1,
    ) -> "ChainOptions":
        attempts: list[ChainAttempt] = []
        last: RoutingError | None = None

        for provider in self._providers:
            try:
                candidates = await provider.route_options(
                    origin, destination, kind=kind, limit=limit
                )
            except RoutingRejected:
                # Terminal by design - see the class docstring.
                attempts.append(ChainAttempt(provider.name, ok=False, error="rejected"))
                logger.info(
                    "routing: %s rejected the request; not trying further providers",
                    provider.name,
                )
                raise
            except (RoutingUnavailable, RoutingMalformed) as exc:
                last = exc
                attempts.append(
                    ChainAttempt(provider.name, ok=False, error=type(exc).__name__)
                )
                logger.warning(
                    "routing: provider %s failed (%s); trying the next one",
                    provider.name,
                    type(exc).__name__,
                )
                continue

            attempts.append(ChainAttempt(provider.name, ok=True))
            return ChainOptions(
                candidates=tuple(candidates), attempts=tuple(attempts)
            )

        # Every provider failed. Raise rather than return a degraded result: the
        # UI must show "no route available", not an empty route that renders as
        # a straight line through the terrain.
        raise RoutingUnavailable(
            "No routing provider could answer. Tried: "
            + ", ".join(a.provider for a in attempts)
        ) from last
