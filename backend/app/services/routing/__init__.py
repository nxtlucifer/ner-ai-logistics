"""Routing subsystem.

Provider-independent by construction: the application depends on
`RoutingChain` and `RouteCandidate`, never on a provider's response shape.
See app/domain/routing.py for why the normalised model carries no ETA and no
fuel figure.
"""

from app.services.routing.base import (
    ChainAttempt,
    ChainOptions,
    ChainResult,
    RoutingChain,
    RoutingProvider,
)
from app.services.routing.osrm import OsrmRoutingProvider

__all__ = [
    "ChainAttempt",
    "ChainOptions",
    "ChainResult",
    "OsrmRoutingProvider",
    "RoutingChain",
    "RoutingProvider",
]
