"""Normalized landslide incidents, and the states a source can be in.

Pure types and pure rules. No I/O, no provider, no database — the same split
`app/domain/routing.py` keeps from `app/services/routing/`.

THE DISTINCTION THIS MODULE EXISTS TO PROTECT

    "we have no source"           is not
    "we looked and found nothing" is not
    "this corridor is safe"

Three different facts, and collapsing any pair of them is how a risk engine
starts telling a dispatcher a road is fine when nobody has ever looked at it.
`SourceState` keeps the first separate from the second; the second is an empty
`incidents` tuple with `state=AVAILABLE`; the third is a conclusion this module
never draws.

NOTHING IS MANUFACTURED

Every field that a source might not publish is optional and defaults to None.
`None` means "not published", never zero and never false. Coordinates are the
sharpest case: an incident whose source gave no coordinates is still a real
incident and is kept, with `latitude`/`longitude` None, because inventing a
point to make it mappable would put a marker on a road that was never named.
`is_locatable` is how a caller asks, rather than guessing from a 0.0.

VERIFICATION IS A CLASSIFICATION, NOT A SCORE

Four states, deliberately not a confidence number. A number invites averaging,
and averaging a government closure notice with two blog posts produces a figure
that means nothing. `promote()` holds the only rule for reaching CORROBORATED,
and it requires independent SOURCES rather than independent articles — see
`docs/ROAD_MEMORY.md` on why duplicate reporting must not inflate anything.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Final

VERSION: Final[str] = "landslide-incident-v1"


class SourceState(str, Enum):
    """Whether a provider could answer at all.

    `NOT_CONFIGURED` is the honest production state for this build: no
    landslide source has been connected, and every route therefore has
    unknown landslide exposure rather than none.
    """

    #: No provider is configured. Nothing was asked, so nothing is known.
    NOT_CONFIGURED = "NOT_CONFIGURED"
    #: A provider answered. `incidents` is complete for the query — possibly
    #: empty, which is a real finding.
    AVAILABLE = "AVAILABLE"
    #: A provider exists but failed (timeout, error). Distinct from an empty
    #: answer, because a failure tells you nothing about the road.
    UNAVAILABLE = "UNAVAILABLE"


class SourceType(str, Enum):
    """What KIND of body published it. Not how much it is trusted."""

    #: Disaster-management, geological survey, road or highway authority.
    OFFICIAL_AGENCY = "OFFICIAL_AGENCY"
    #: A reputable news organisation. Credible, not authoritative.
    NEWS = "NEWS"
    #: Our own fleet observing the road.
    FLEET = "FLEET"
    #: An operator or driver entering what they saw.
    OPERATOR = "OPERATOR"
    #: Anything else, including social posts. Never sufficient alone.
    OTHER = "OTHER"


class VerificationStatus(str, Enum):
    """How well established an incident is."""

    #: A primary authority said it. The only status a single source can reach.
    OFFICIAL = "OFFICIAL"
    #: Two or more INDEPENDENT credible sources describe the same event.
    CORROBORATED = "CORROBORATED"
    #: One non-official source, or too few to corroborate.
    UNVERIFIED = "UNVERIFIED"
    #: Credible evidence that the incident or closure has ended.
    RESOLVED = "RESOLVED"


@dataclass(frozen=True)
class IncidentSource:
    """One report of an incident, kept so provenance survives deduplication."""

    name: str
    source_type: SourceType
    #: Bulletin URL, notice number, trip id. Evidence that cannot be traced
    #: back is evidence that cannot be checked when it turns out to matter.
    reference: str | None = None
    published_at: datetime | None = None


@dataclass(frozen=True)
class LandslideIncident:
    """One event, after normalisation and deduplication.

    A cluster of reports about one landslide collapses to ONE of these, with
    every report retained in `sources`. `len(sources)` is reporting volume and
    must never be used as an event count.
    """

    incident_id: str
    #: When the landslide happened, if a source said. Not when it was written.
    event_date: datetime | None = None
    latitude: float | None = None
    longitude: float | None = None
    location_name: str | None = None
    district: str | None = None
    state: str | None = None
    road_name: str | None = None
    highway_code: str | None = None
    #: Tri-state on purpose: True, False, and "no source said".
    road_blocked: bool | None = None
    fatalities: int | None = None
    injuries: int | None = None
    #: Only ever set from an explicit report. Never inferred from a landslide.
    restoration_reported: bool | None = None
    slope_stabilization_reported: bool | None = None
    verification_status: VerificationStatus = VerificationStatus.UNVERIFIED
    sources: tuple[IncidentSource, ...] = field(default_factory=tuple)
    ingested_at: datetime | None = None

    @property
    def is_locatable(self) -> bool:
        """Whether this incident can be placed on a route.

        Asked explicitly rather than inferred, so a missing coordinate can
        never be read as 0.0 — which is a real point in the Gulf of Guinea.
        """
        return self.latitude is not None and self.longitude is not None

    @property
    def quality_evidence(self) -> str:
        """What can be said about the ROAD's condition, as opposed to the slope.

        Repeated landslides are evidence of a hazardous corridor. They are NOT
        evidence of bad construction or bad repair, and this project refuses to
        make that leap: establishing it needs engineering data no source here
        publishes. So the answer is INSUFFICIENT unless somebody actually
        reported restoration or stabilisation work.
        """
        if self.slope_stabilization_reported or self.restoration_reported:
            return "REPORTED"
        return "INSUFFICIENT"


@dataclass(frozen=True)
class IncidentQueryResult:
    """What a provider returned, and whether it could answer at all.

    `incidents` is meaningless without `state`. An empty tuple with
    `AVAILABLE` means the corridor has no recorded incidents; an empty tuple
    with `NOT_CONFIGURED` means nobody looked. A caller that reads only the
    tuple will treat those identically, which is the failure this type exists
    to make impossible to write by accident.
    """

    state: SourceState
    incidents: tuple[LandslideIncident, ...] = field(default_factory=tuple)
    #: Which providers were asked, for the audit trail and for reporting.
    provider: str | None = None
    #: Why, when `state` is UNAVAILABLE. Never shown as a road condition.
    error: str | None = None

    @property
    def usable(self) -> bool:
        """True only when the answer describes the road rather than our setup."""
        return self.state is SourceState.AVAILABLE


def promote(status_sources: tuple[IncidentSource, ...]) -> VerificationStatus:
    """The verification a set of reports earns.

    The rule, and the whole reason deduplication has to happen first:

    - any OFFICIAL_AGENCY report        -> OFFICIAL
    - two or more INDEPENDENT sources   -> CORROBORATED
    - otherwise                         -> UNVERIFIED

    "Independent" counts distinct source NAMES, not articles. Three syndicated
    copies of one wire story are one source, and letting them reach
    CORROBORATED would mean reporting volume — which tracks how interesting an
    event was, not how real it was — silently becoming confidence.
    """
    if any(s.source_type is SourceType.OFFICIAL_AGENCY for s in status_sources):
        return VerificationStatus.OFFICIAL
    if len({s.name.strip().casefold() for s in status_sources if s.name.strip()}) >= 2:
        return VerificationStatus.CORROBORATED
    return VerificationStatus.UNVERIFIED


# --- Provider status -> evidence -> risk -----------------------------------
#
# A deliberate three-step conversion. Downstream code must never reason from
# `len(incidents)` alone, because the natural shape of that reasoning is
#
#     if not incidents: return LOW
#
# which is correct only when a real source actually answered. Routing every
# caller through `assess_corridor` makes the provider's STATE impossible to
# skip on the way to a risk level.


class LandslideRisk(str, Enum):
    """Landslide exposure for one corridor.

    `UNKNOWN` is first and is the default for a reason: it is what every
    absence of evidence resolves to, and it must never be confused with `LOW`.
    """

    UNKNOWN = "UNKNOWN"
    LOW = "LOW"
    CAUTION = "CAUTION"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class DataStatus(str, Enum):
    """Why the risk is what it is, from the data's point of view."""

    NOT_CONFIGURED = "NOT_CONFIGURED"
    SOURCE_FAILED = "SOURCE_FAILED"
    AVAILABLE = "AVAILABLE"


REASON_NOT_CONFIGURED: Final[str] = "LANDSLIDE_DATA_NOT_CONFIGURED"
REASON_SOURCE_FAILED: Final[str] = "LANDSLIDE_SOURCE_FAILED"
REASON_NO_RECORDED_INCIDENTS: Final[str] = "LANDSLIDE_NO_RECORDED_INCIDENTS"
REASON_OFFICIAL_CLOSURE: Final[str] = "LANDSLIDE_OFFICIAL_ROAD_CLOSURE"
REASON_OFFICIAL_INCIDENT: Final[str] = "LANDSLIDE_OFFICIAL_INCIDENT_ON_ROUTE"
REASON_CORROBORATED_INCIDENT: Final[str] = "LANDSLIDE_CORROBORATED_INCIDENT_ON_ROUTE"
REASON_UNVERIFIED_REPORT: Final[str] = "LANDSLIDE_UNVERIFIED_REPORT_ON_ROUTE"
REASON_UNLOCATABLE: Final[str] = "LANDSLIDE_INCIDENT_LOCATION_UNKNOWN"

#: How near a sampled route position an incident must fall to count as being
#: on this corridor. Project-defined operational constant, not a standard.
#: Generous because route sampling is coarse (a handful of points across
#: hundreds of km), and the failure to avoid is missing a real slide, not
#: flagging a nearby one.
ON_ROUTE_BUFFER_M: Final[float] = 5_000.0


@dataclass(frozen=True)
class LandslideAssessment:
    """Landslide exposure plus the provenance of that judgement."""

    risk: LandslideRisk
    data_status: DataStatus
    reason_codes: tuple[str, ...] = field(default_factory=tuple)
    #: Incidents the provider returned, before route filtering.
    considered_count: int = 0
    #: Of those, how many fall within the corridor buffer.
    on_route_count: int = 0
    #: Kept as evidence but with no coordinates, so location relation UNKNOWN.
    unlocatable_count: int = 0
    provider: str | None = None

    @property
    def is_known(self) -> bool:
        return self.risk is not LandslideRisk.UNKNOWN


def _distance_to_route_m(
    incident: LandslideIncident, route: list[tuple[float, float]]
) -> float | None:
    """Metres to the nearest sampled route position, or None if unplaceable.

    None for an incident with no coordinates. That is NOT zero and NOT
    "far away" - it is "we cannot say", and the caller must treat it as
    such rather than defaulting it onto or off the road.
    """
    if not incident.is_locatable or not route:
        return None
    from app.domain.routing import haversine_m

    return min(
        haversine_m(incident.latitude, incident.longitude, lat, lon)
        for lat, lon in route
    )


def assess_corridor(
    result: IncidentQueryResult,
    *,
    route: list[tuple[float, float]],
    buffer_m: float = ON_ROUTE_BUFFER_M,
) -> LandslideAssessment:
    """Turn a provider answer into a risk level, without ever skipping its state.

    The order of the branches is the safety property: provider STATE is
    resolved before any incident is looked at, so there is no path on which an
    empty list produced by "no source" reaches the same code as an empty list
    produced by a successful query.
    """
    if result.state is SourceState.NOT_CONFIGURED:
        return LandslideAssessment(
            risk=LandslideRisk.UNKNOWN,
            data_status=DataStatus.NOT_CONFIGURED,
            reason_codes=(REASON_NOT_CONFIGURED,),
            provider=result.provider,
        )

    if result.state is SourceState.UNAVAILABLE:
        # A feed being down says nothing about the hillside.
        return LandslideAssessment(
            risk=LandslideRisk.UNKNOWN,
            data_status=DataStatus.SOURCE_FAILED,
            reason_codes=(REASON_SOURCE_FAILED,),
            provider=result.provider,
        )

    # From here a real source answered, so an empty result IS evidence.
    codes: list[str] = []
    unlocatable = 0
    on_route: list[LandslideIncident] = []

    for incident in result.incidents:
        # RESOLVED means somebody credible said it is over. It stays in the
        # record for recurrence but does not raise current exposure.
        if incident.verification_status is VerificationStatus.RESOLVED:
            continue
        distance = _distance_to_route_m(incident, route)
        if distance is None:
            unlocatable += 1
            continue
        if distance <= buffer_m:
            on_route.append(incident)

    if unlocatable:
        codes.append(REASON_UNLOCATABLE)

    risk = LandslideRisk.LOW
    if not on_route:
        codes.append(REASON_NO_RECORDED_INCIDENTS)
    else:
        official = [
            i for i in on_route if i.verification_status is VerificationStatus.OFFICIAL
        ]
        corroborated = [
            i
            for i in on_route
            if i.verification_status is VerificationStatus.CORROBORATED
        ]
        if any(i.road_blocked for i in official):
            # An authority saying the road is shut is not a high score - it is
            # a road you may not plan over. See monsoon_risk on passability.
            risk = LandslideRisk.CRITICAL
            codes.append(REASON_OFFICIAL_CLOSURE)
        elif official:
            risk = LandslideRisk.HIGH
            codes.append(REASON_OFFICIAL_INCIDENT)
        elif corroborated:
            risk = LandslideRisk.HIGH
            codes.append(REASON_CORROBORATED_INCIDENT)
        else:
            # RULE 4: a single unverified report warns, it does not reject.
            # Shutting a corridor on a rumour strands cargo and teaches
            # dispatchers to ignore the system, which costs more than it saves.
            risk = LandslideRisk.CAUTION
            codes.append(REASON_UNVERIFIED_REPORT)

    return LandslideAssessment(
        risk=risk,
        data_status=DataStatus.AVAILABLE,
        reason_codes=tuple(dict.fromkeys(codes)),
        considered_count=len(result.incidents),
        on_route_count=len(on_route),
        unlocatable_count=unlocatable,
        provider=result.provider,
    )
