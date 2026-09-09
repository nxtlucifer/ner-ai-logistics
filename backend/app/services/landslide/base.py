"""The seam between this application and whoever publishes landslide data.

Nothing above this package may know about GSI, Bhukosh, IMD, a state disaster
authority or a newspaper. They are transport details, and the survey in
`docs/ROAD_MEMORY.md` shows why that matters here more than usual: the sources
are heterogeneous, several are not machine-readable at all, and the one thing
none of them publishes is a road REOPENING. A provider boundary is what lets
that mess be swapped without the risk engine noticing.

WHY THE DEFAULT PROVIDER RETURNS NOTHING, LOUDLY

No landslide source is connected to this build. Four routes were tried and all
four are shut - NASA COOLR endpoints 404 and time out, the Global Landslide
Catalog CSV redirects to a presigned URL that 403s, and IMD's highway warning
API returns 401. That is recorded in the progress log with the evidence.

So the honest production state is `NOT_CONFIGURED`, and `NullLandslideProvider`
returns exactly that. It is deliberately NOT an empty success. An empty
success says "this corridor has no recorded landslides", which is a claim about
a road; `NOT_CONFIGURED` says "nobody looked", which is a claim about us. Only
one of them is true today, and only one of them is safe to score.

BOUNDED BY CONSTRUCTION

`incidents_near` takes a bounding box and a time window, both required. There
is no "fetch everything" call, because the failure it invites - loading a
national inventory to answer a question about one corridor - is the one that
only shows up on the corridors with the most history, which are exactly the
ones this feature exists for.
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Final, Protocol

from app.domain.landslide import IncidentQueryResult, SourceState

logger = logging.getLogger(__name__)

#: Widest box a single query may cover, in degrees. A corridor is tens of
#: kilometres; anything much larger is a caller that meant to page instead.
MAX_BBOX_DEGREES: Final[float] = 5.0


class LandslideQueryError(ValueError):
    """A query this layer refuses to send, rather than a provider failure."""


@dataclass(frozen=True)
class BoundingBox:
    """A spatial bound, validated on construction.

    Validated here rather than at each provider so a new provider cannot
    forget: an unbounded or inverted box reaches a remote service as a request
    for everything, and the first symptom is a timeout under load.
    """

    min_lat: float
    min_lon: float
    max_lat: float
    max_lon: float

    def __post_init__(self) -> None:
        if not (-90.0 <= self.min_lat <= 90.0 and -90.0 <= self.max_lat <= 90.0):
            raise LandslideQueryError("Latitude out of range.")
        if not (-180.0 <= self.min_lon <= 180.0 and -180.0 <= self.max_lon <= 180.0):
            raise LandslideQueryError("Longitude out of range.")
        if self.min_lat > self.max_lat or self.min_lon > self.max_lon:
            raise LandslideQueryError("Bounding box is inverted.")
        if (
            self.max_lat - self.min_lat > MAX_BBOX_DEGREES
            or self.max_lon - self.min_lon > MAX_BBOX_DEGREES
        ):
            raise LandslideQueryError(
                f"Bounding box exceeds {MAX_BBOX_DEGREES} degrees; page instead."
            )


class LandslideIncidentProvider(Protocol):
    """Returns normalized incidents for a bounded area and time window.

    Implementations own their transport, timeout and parsing, and normalise
    before returning. They must never leak a provider-shaped object upward and
    must never invent a coordinate, a date or a severity the source did not
    publish - the same contract `RoutingProvider` holds about durations.

    An implementation must not raise for a provider outage. It returns
    `SourceState.UNAVAILABLE`, because a landslide feed being down is not a
    reason for trip planning to fail.
    """

    #: Short stable identifier, used in reporting and the audit trail.
    name: str

    async def incidents_near(
        self, box: BoundingBox, *, since: datetime, until: datetime
    ) -> IncidentQueryResult: ...


class NullLandslideProvider:
    """The provider used when no source is configured. Answers nothing.

    Not a stub to be replaced by a fake later - it is the correct production
    behaviour while no source exists, and it keeps the whole path exercised so
    the integration is real code rather than a hardcoded constant sitting in
    the risk engine.
    """

    name = "none"

    async def incidents_near(
        self, box: BoundingBox, *, since: datetime, until: datetime
    ) -> IncidentQueryResult:
        # The box is still validated by its own constructor before we get
        # here, so a caller with a broken query finds out even with no source
        # connected. Silently accepting nonsense now would mean discovering it
        # only on the day a real provider is wired in.
        if since > until:
            raise LandslideQueryError("Time window ends before it starts.")
        return IncidentQueryResult(state=SourceState.NOT_CONFIGURED, provider=self.name)


def build_provider() -> LandslideIncidentProvider:
    """The configured provider.

    Built per call rather than cached, matching `route_risk.build_provider()`
    and `routes.build_chain()`. Returns the null provider until a real source
    is configured; when one is, this is the single place that changes.
    """
    return NullLandslideProvider()
