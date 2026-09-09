"""Monsoon Risk Engine V1 — recurrence, rainfall, season, and what is known.

Deliberately **not** a prediction. There is no trained model here, no
validation split and no metric, because the data to build one does not exist:
see `docs/ROAD_MEMORY.md` section 2. This is a weighted rule over three facts
and one belief, with the constants in this file so they can be argued with.

    historical recurrence   how often this stretch has actually failed
    rainfall                how much has fallen on it recently
    season                  whether it is monsoon
    road status             what road_memory last observed about it

The name says engine, not forecast. It answers "how exposed is this segment
right now, given what we know", and every input it did not get is named in the
output rather than quietly scored as zero.

PASSABILITY IS NOT A SCORE

The one structural decision worth defending. A road an authority has declared
CLOSED is not "risk 100" - it is **not a road you may plan over**, and the
difference matters because a score can lose a comparison narrowly. A closed
segment scoring 100 against an open one scoring 96 would be a four-point
preference for the road that exists. So passability is a separate field with
three values, and NOT_PASSABLE is a refusal rather than a high number.

UNVERIFIED IS ITS OWN ANSWER

A segment nobody has observed is not a safe segment and not a dangerous one. It
reports `UNVERIFIED`, and a caller that treats that as PASSABLE has made a
decision this module declined to make for it.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Final

from app.domain.road_memory import FRESHNESS_CURRENT, Knowledge, RoadStatus
from app.domain.route_risk import (
    AVAILABLE,
    BAND_HIGH,
    BAND_HIGH_AT,
    BAND_LOW,
    BAND_MODERATE,
    BAND_MODERATE_AT,
    NOT_AVAILABLE,
    RiskComponent,
)

VERSION: Final[str] = "monsoon-risk-engine-v1"

# --- Season ---------------------------------------------------------------

#: South-west monsoon months used by this project for the North East.
#:
#: A project-defined operational window, NOT an official meteorological
#: definition, and stated as such for the same reason route_risk states it
#: about its rainfall thresholds. Onset varies year to year and the real season
#: has fuzzy edges; June to September is the span this system treats as monsoon
#: and it is one constant rather than a date arithmetic scattered around.
MONSOON_MONTHS: Final[frozenset[int]] = frozenset({6, 7, 8, 9})

#: Pre-monsoon, when the first heavy rain meets slopes that have had months to
#: dry and crack. Scored lower than monsoon, not zero.
PRE_MONSOON_MONTHS: Final[frozenset[int]] = frozenset({4, 5})

# --- Weights --------------------------------------------------------------
# Per-component ceilings, summing to 100 so no single factor saturates the
# score alone and the weighting is readable at a glance. Same shape as
# route_risk, deliberately: a dispatcher should not have to learn two scales.

MAX_RECURRENCE_POINTS: Final[int] = 40
MAX_RAINFALL_POINTS: Final[int] = 35
MAX_SEASON_POINTS: Final[int] = 15
MAX_STATUS_POINTS: Final[int] = 10

#: Recorded incidents at which the recurrence component saturates.
#:
#: Four, not forty. The GSI inventory is a record of what was REPORTED, and
#: reporting is sparse and uneven - a stretch with four recorded slides is
#: already a stretch that fails, and demanding more before taking it seriously
#: would mostly measure how well an area is surveyed.
RECURRENCE_SATURATION: Final[int] = 4

#: Rainfall in mm over the recent accumulation window at which the rainfall
#: component saturates. Project-defined operational threshold, not an official
#: warning level.
RAINFALL_SATURATION_MM: Final[float] = 100.0

PASSABLE: Final[str] = "PASSABLE"
NOT_PASSABLE: Final[str] = "NOT_PASSABLE"
UNVERIFIED: Final[str] = "UNVERIFIED"

FACTOR_RECURRENCE: Final[str] = "landslide_history"
FACTOR_RAINFALL: Final[str] = "rainfall_accumulation"
FACTOR_SEASON: Final[str] = "season"
FACTOR_ROAD_STATUS: Final[str] = "road_status"

REASON_ROAD_CLOSED: Final[str] = "ROAD_DECLARED_CLOSED"
REASON_ROAD_UNVERIFIED: Final[str] = "ROAD_STATUS_UNVERIFIED"
REASON_REPAIR_UNCONFIRMED: Final[str] = "REPAIR_CLAIM_UNCONFIRMED"
REASON_INCIDENT_OPEN: Final[str] = "INCIDENT_UNRESOLVED"
REASON_STATUS_STALE: Final[str] = "ROAD_STATUS_STALE"
REASON_REPEAT_FAILURE: Final[str] = "REPEATED_HISTORICAL_FAILURE"
REASON_HEAVY_RECENT_RAIN: Final[str] = "HEAVY_RECENT_RAINFALL"
REASON_MONSOON: Final[str] = "MONSOON_SEASON"
REASON_PRE_MONSOON: Final[str] = "PRE_MONSOON_SEASON"
REASON_NO_HISTORY: Final[str] = "NO_LANDSLIDE_HISTORY_AVAILABLE"
REASON_NO_RAINFALL: Final[str] = "RAINFALL_NOT_AVAILABLE"


@dataclass(frozen=True)
class SegmentHistory:
    """What the evidence log says about one stretch of road.

    Every field is optional because every field can genuinely be absent, and
    absent must not read as zero: a segment with no inventory coverage has
    `recorded_incidents=None`, which is "we do not know", while `0` is "we
    looked and found none". Those are different facts and the second one is
    much rarer than a naive ingest would suggest.
    """

    recorded_incidents: int | None = None
    #: Of those, how many fell in monsoon months. A road that fails only in
    #: monsoon is a different road from one that fails year-round.
    monsoon_incidents: int | None = None
    last_incident_at: datetime | None = None


@dataclass(frozen=True)
class MonsoonRisk:
    """Exposure for one segment, with its evidence and its gaps.

    `passable` is not derived from `score` and must not be inferred from it.
    See the module docstring.
    """

    score: int
    band: str
    passable: str
    components: tuple[RiskComponent, ...]
    inputs: dict[str, str]
    unavailable: tuple[str, ...]
    reason_codes: tuple[str, ...]
    version: str = VERSION


def _band(score: int) -> str:
    if score >= BAND_HIGH_AT:
        return BAND_HIGH
    if score >= BAND_MODERATE_AT:
        return BAND_MODERATE
    return BAND_LOW


def _scaled(value: float, saturation: float, ceiling: int) -> int:
    """Linear to `saturation`, flat after. Never negative."""
    if value <= 0 or saturation <= 0:
        return 0
    return int(round(min(1.0, value / saturation) * ceiling))


def _passability(knowledge: Knowledge | None, now: datetime) -> tuple[str, list[str]]:
    """Whether this segment may be planned over at all, and why not.

    Separate from the score on purpose, and returning UNVERIFIED rather than
    guessing when nothing is known.
    """
    if knowledge is None or knowledge.status is RoadStatus.UNKNOWN:
        return UNVERIFIED, [REASON_ROAD_UNVERIFIED]

    codes: list[str] = []
    if knowledge.freshness(now) != FRESHNESS_CURRENT:
        # The belief still stands; it has simply stopped being current. Said
        # out loud rather than folded into the score, because "we last saw this
        # road three weeks ago" is a fact a dispatcher acts on differently from
        # a slightly higher number.
        codes.append(REASON_STATUS_STALE)

    if knowledge.status is RoadStatus.CLOSED:
        return NOT_PASSABLE, [*codes, REASON_ROAD_CLOSED]
    if knowledge.status is RoadStatus.REPORTED_INCIDENT:
        return UNVERIFIED, [*codes, REASON_INCIDENT_OPEN]
    if knowledge.status in (
        RoadStatus.REPAIR_REPORTED,
        RoadStatus.AWAITING_VERIFICATION,
    ):
        # A repair claim is the case that most looks like a yes and is not one.
        return UNVERIFIED, [*codes, REASON_REPAIR_UNCONFIRMED]

    # VERIFIED_OPEN. Still only passable while the observation is current -
    # `Knowledge.is_usable` is the same rule, and it is reused rather than
    # restated so the two cannot drift.
    if not knowledge.is_usable(now):
        return UNVERIFIED, codes
    return PASSABLE, codes


def assess(
    *,
    history: SegmentHistory | None = None,
    knowledge: Knowledge | None = None,
    recent_rainfall_mm: float | None = None,
    now: datetime,
) -> MonsoonRisk:
    """Score one road segment's monsoon exposure from what is known about it.

    `now` is injected rather than read, because the season component depends on
    it and a function that reads its own clock cannot be tested across seasons.
    """
    components: list[RiskComponent] = []
    codes: list[str] = []
    inputs: dict[str, str] = {}

    # --- Historical recurrence ---
    incidents = history.recorded_incidents if history else None
    if incidents is None:
        inputs[FACTOR_RECURRENCE] = NOT_AVAILABLE
        codes.append(REASON_NO_HISTORY)
    else:
        inputs[FACTOR_RECURRENCE] = AVAILABLE
        points = _scaled(incidents, RECURRENCE_SATURATION, MAX_RECURRENCE_POINTS)
        if points:
            monsoon_share = (history.monsoon_incidents if history else None) or 0
            detail = f"{incidents} recorded incident(s)"
            if monsoon_share:
                detail += f", {monsoon_share} in monsoon"
            components.append(
                RiskComponent(
                    code="LANDSLIDE_RECURRENCE",
                    label="Landslide history",
                    points=points,
                    detail=detail,
                )
            )
            if incidents >= 2:
                codes.append(REASON_REPEAT_FAILURE)

    # --- Rainfall ---
    if recent_rainfall_mm is None:
        inputs[FACTOR_RAINFALL] = NOT_AVAILABLE
        codes.append(REASON_NO_RAINFALL)
    else:
        inputs[FACTOR_RAINFALL] = AVAILABLE
        points = _scaled(
            recent_rainfall_mm, RAINFALL_SATURATION_MM, MAX_RAINFALL_POINTS
        )
        if points:
            components.append(
                RiskComponent(
                    code="RAINFALL_ACCUMULATION",
                    label="Recent rainfall",
                    points=points,
                    detail=f"{recent_rainfall_mm:.0f} mm recently",
                )
            )
            if recent_rainfall_mm >= RAINFALL_SATURATION_MM:
                codes.append(REASON_HEAVY_RECENT_RAIN)

    # --- Season ---
    # Always available: it is a fact about the calendar, not about a provider.
    inputs[FACTOR_SEASON] = AVAILABLE
    if now.month in MONSOON_MONTHS:
        components.append(
            RiskComponent(
                code="MONSOON_SEASON",
                label="Season",
                points=MAX_SEASON_POINTS,
                detail="south-west monsoon",
            )
        )
        codes.append(REASON_MONSOON)
    elif now.month in PRE_MONSOON_MONTHS:
        components.append(
            RiskComponent(
                code="PRE_MONSOON_SEASON",
                label="Season",
                points=MAX_SEASON_POINTS // 2,
                detail="pre-monsoon",
            )
        )
        codes.append(REASON_PRE_MONSOON)

    # --- Road status ---
    passable, status_codes = _passability(knowledge, now)
    codes.extend(status_codes)
    # UNKNOWN is the ABSENCE of a road-status observation, so it is reported as
    # a missing input rather than as a low-confidence one. The caution it
    # deserves is carried by `passable = UNVERIFIED`, which a caller cannot
    # read as a number and ignore.
    observed = knowledge is not None and knowledge.status is not RoadStatus.UNKNOWN
    inputs[FACTOR_ROAD_STATUS] = AVAILABLE if observed else NOT_AVAILABLE
    if observed and passable == UNVERIFIED:
        # Doubt about the road itself is exposure, but it is capped: the real
        # signal is in `passable`, and letting it dominate the score would mean
        # a well-surveyed bad road and an unconfirmed one became the same
        # number.
        components.append(
            RiskComponent(
                code="ROAD_STATUS_DOUBT",
                label="Road status",
                points=MAX_STATUS_POINTS,
                detail=knowledge.status.value,
            )
        )

    score = min(100, sum(c.points for c in components))

    return MonsoonRisk(
        score=score,
        band=_band(score),
        passable=passable,
        components=tuple(components),
        inputs=inputs,
        unavailable=tuple(
            name for name, state in inputs.items() if state == NOT_AVAILABLE
        ),
        reason_codes=tuple(dict.fromkeys(codes)),
    )
