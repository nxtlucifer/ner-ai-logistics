"""Dynamic reroute foundation: when to raise a route change, and how loudly.

A trip is already moving. Conditions on the selected road have changed. This
module answers one question - "is there anything worth telling a human about" -
and it answers it with three outcomes, not two.

    NO_ACTION     the road is not bad enough to reconsider
    ALERT_ONLY    it IS bad, and there is nothing better to offer
    PROPOSE       it is bad, and a genuinely better road exists

ALERT_ONLY is the outcome that makes this honest. Most of the North East is a
single corridor: when NH-715 floods there is frequently no second road, and a
system that only knows how to propose alternatives has nothing to say in
exactly the situation that matters most. Saying "this road has deteriorated and
there is no better option" is real information - it is what makes a dispatcher
phone the driver.

NOTHING HERE MUTATES A TRIP

This module returns an assessment. It does not select a route, does not write,
and is not permitted to. The route a truck is following changes only when a
person accepts the proposal - see `app/services/reroute.py`. A silent
automatic reroute is the failure mode this design exists to prevent: a driver
whose map changes underneath them on a hill road at night, with no one having
decided anything.

NO MODEL PARTICIPATES

Same rule as the rest of the routing stack. This is a threshold and a
comparison over deterministic inputs, and the comparison is not re-invented
here - it is `route_recommendation.recommend`, so a reroute proposal and a
planning-time recommendation cannot disagree about which road is better.
"""

from dataclasses import dataclass
from typing import Final

from app.domain.route_recommendation import (
    MIN_RISK_MARGIN_POINTS,
    Recommendation,
    RouteCandidate,
    recommend,
)
from app.domain.route_risk import BAND_HIGH, BAND_HIGH_AT, BAND_MODERATE

VERSION: Final[str] = "reroute-assessment-v1"

#: How bad the CURRENT road must be before an alternative is even considered.
#:
#: Deliberately the same number as `route_risk.BAND_HIGH_AT`, and imported
#: rather than repeated: "we reconsider the route once it reads HIGH" is a
#: sentence a dispatcher can hold in their head, and two constants that are
#: meant to be equal eventually stop being.
#:
#: A floor is necessary, not tidy. Without one, every marginally-better road
#: becomes a proposal, and a driver on a perfectly safe highway gets pinged
#: because a parallel route scored eleven points lower. Proposals that arrive
#: when nothing is wrong are the ones that get dismissed unread, which is how a
#: real one gets missed.
DETERIORATION_FLOOR: Final[int] = BAND_HIGH_AT

#: How severe the CONDITIONS alone must be to count as deterioration,
#: regardless of how long the trip is.
#:
#: The floor above is measured against `route_risk.score`, which mixes weather
#: with exposure - distance and duration contribute up to 30 of its 100 points.
#: That makes a short trip structurally unable to reach it. Measured against
#: the real scoring rule, heavy rain along the WHOLE corridor scores 60 on a
#: 305 km route and only 53 on a 150 km one, so the advisory would have stayed
#: silent on most NER corridors, which run 100-300 km.
#:
#: Exposure is a property of the journey, not of the storm sitting on it. A
#: cloudburst does not become acceptable because the trip is short.
#:
#: 35 out of a 70-point conditions ceiling. In the rule's own terms that is
#: heavy rain over roughly three fifths of the corridor or more: heavy rain at
#: full coverage scores 45, at 4/5 coverage 41, at 3/5 coverage 36 - and a
#: single heavy sample in five scores 27 and does NOT trigger, because a squall
#: crossing the road is not the road going bad.
SEVERE_CONDITIONS_FLOOR: Final[int] = 35

OUTCOME_NO_ACTION: Final[str] = "NO_ACTION"
OUTCOME_ALERT_ONLY: Final[str] = "ALERT_ONLY"
OUTCOME_PROPOSE: Final[str] = "PROPOSE"

REASON_TRIP_NOT_IN_TRANSIT: Final[str] = "TRIP_NOT_IN_TRANSIT"
REASON_NO_SELECTED_ROUTE: Final[str] = "NO_SELECTED_ROUTE"
REASON_WITHIN_TOLERANCE: Final[str] = "SELECTED_ROUTE_WITHIN_TOLERANCE"
REASON_DETERIORATED: Final[str] = "SELECTED_ROUTE_DETERIORATED"
REASON_SEVERE_CONDITIONS: Final[str] = "SEVERE_CONDITIONS_ON_ROUTE"
REASON_NO_BETTER_ALTERNATIVE: Final[str] = "NO_BETTER_ALTERNATIVE"
REASON_BETTER_ROUTE_AVAILABLE: Final[str] = "BETTER_ROUTE_AVAILABLE"


@dataclass(frozen=True)
class RerouteAssessment:
    """Whether to say anything, what to say, and on what evidence.

    `proposed_route_id` is populated only for OUTCOME_PROPOSE. On ALERT_ONLY it
    is None on purpose: there is no road to offer, and returning the least-bad
    alternative would read as a recommendation to take it.
    """

    outcome: str
    selected_route_id: str | None
    selected_risk_score: int | None
    selected_risk_band: str | None
    proposed_route_id: str | None
    reason_codes: tuple[str, ...]
    #: The full comparison, when one was possible. Carries the tradeoff and the
    #: per-candidate figures, so a proposal arrives with its own evidence.
    comparison: Recommendation | None
    unavailable_inputs: tuple[str, ...]
    floor_points: int = DETERIORATION_FLOOR
    #: The conditions-only threshold, published for the same reason the floor
    #: is: a rule nobody can see is a rule nobody can argue with.
    severe_conditions_points: int = SEVERE_CONDITIONS_FLOOR
    margin_points: int = MIN_RISK_MARGIN_POINTS
    version: str = VERSION

    @property
    def requires_a_human(self) -> bool:
        """Whether anything should reach a person at all."""
        return self.outcome in (OUTCOME_ALERT_ONLY, OUTCOME_PROPOSE)


# --- The driver's four words ----------------------------------------------
#
# The screen a driver reads at speed gets one of four instructions, derived -
# never chosen - from the band the risk engine published and the outcome the
# reroute assessment reached. Published here beside the reroute rule because
# the two must agree: a proposal that exists is the only thing that may say
# REROUTE, and a HIGH road with nothing better is HOLD, not "carry on".
#
#   LOW                          CONTINUE
#   MODERATE, or a caution flag  CAUTION
#   HIGH, or ALERT_ONLY raised   HOLD_AND_REVIEW
#   PROPOSE raised               REROUTE_RECOMMENDED
#
# The caution flag exists because the score is a JOURNEY total: a short hill
# road with a steep pitch and a HIGH historical slide density can still sum
# to LOW, and "continue" beside "landslide exposure HIGH" reads as the app
# contradicting itself. Exposure evidence is a caution, never a hold - a hold
# needs the band or the reroute assessment behind it.
#
# No probabilities and no model: this is a lookup over published values.
DECISION_CONTINUE: Final[str] = "CONTINUE"
DECISION_CAUTION: Final[str] = "CAUTION"
DECISION_HOLD: Final[str] = "HOLD_AND_REVIEW"
DECISION_REROUTE: Final[str] = "REROUTE_RECOMMENDED"


#: Reason codes that raise a LOW journey to CAUTION on their own.
CAUTION_CODES: Final[frozenset[str]] = frozenset(
    {
        "STEEP_GRADIENT_ON_ROUTE",
        "HEAVY_RAIN_ON_ROUTE",
        "HIGH_WIND_GUSTS",
        "RIVER_DISCHARGE_ELEVATED",
        "OFFICIAL_WARNING_ON_ROUTE",
    }
)


def driver_decision(
    band: str,
    reroute_outcome: str | None = None,
    *,
    reason_codes: tuple[str, ...] | list[str] = (),
    history_exposure: str | None = None,
) -> str:
    if reroute_outcome == OUTCOME_PROPOSE:
        return DECISION_REROUTE
    if reroute_outcome == OUTCOME_ALERT_ONLY or band == BAND_HIGH:
        return DECISION_HOLD
    if band == BAND_MODERATE or history_exposure == "HIGH" or CAUTION_CODES & set(reason_codes):
        return DECISION_CAUTION
    return DECISION_CONTINUE


def _nothing(reason: str, *, unavailable: tuple[str, ...] = ()) -> RerouteAssessment:
    return RerouteAssessment(
        outcome=OUTCOME_NO_ACTION,
        selected_route_id=None,
        selected_risk_score=None,
        selected_risk_band=None,
        proposed_route_id=None,
        reason_codes=(reason,),
        comparison=None,
        unavailable_inputs=unavailable,
    )


def assess(
    *,
    in_transit: bool,
    selected: RouteCandidate | None,
    alternatives: list[RouteCandidate],
) -> RerouteAssessment:
    """Decide what, if anything, to raise about the route a truck is on.

    `selected` is the route the trip is actually following - not the PRIMARY,
    which may already have been rerouted away from. `alternatives` are the
    other live routes, already scored against the same conditions.

    Rerouting is only meaningful for a truck that is moving. A trip still at
    ASSIGNED has not left; changing its route is ordinary planning and belongs
    on the planning endpoint, where no one has to be told mid-journey.
    """
    if not in_transit:
        return _nothing(REASON_TRIP_NOT_IN_TRANSIT)
    if selected is None:
        # Nothing to deteriorate FROM. A trip with no selected route is a
        # planning gap, not a reroute situation, and silently proposing one
        # would paper over it.
        return _nothing(REASON_NO_SELECTED_ROUTE)

    unavailable = tuple(
        sorted(
            {f for c in [selected, *alternatives] for f in c.risk.unavailable}
        )
    )

    # TWO triggers, and the second is additive: anything that raised an alert
    # before still does. The total score answers "is this journey bad enough";
    # the conditions answer "is this ROAD bad enough", which a short trip could
    # otherwise never satisfy. See SEVERE_CONDITIONS_FLOOR.
    severe = selected.risk.condition_points >= SEVERE_CONDITIONS_FLOOR
    if selected.risk.score < DETERIORATION_FLOOR and not severe:
        return RerouteAssessment(
            outcome=OUTCOME_NO_ACTION,
            selected_route_id=selected.route_id,
            selected_risk_score=selected.risk.score,
            selected_risk_band=selected.risk.band,
            proposed_route_id=None,
            reason_codes=(REASON_WITHIN_TOLERANCE,),
            comparison=None,
            unavailable_inputs=unavailable,
        )

    codes = [REASON_DETERIORATED]
    if severe:
        # Named separately, because "the whole corridor is under heavy rain" and
        # "this is a long trip in poor weather" call for different phone calls.
        codes.append(REASON_SEVERE_CONDITIONS)

    # The SAME comparison the planning recommendation uses, with the selected
    # route as the baseline rather than the PRIMARY - the truck is on this
    # road, so this road is what an alternative has to beat. Reusing it is what
    # keeps a reroute proposal and a planning recommendation from disagreeing
    # about which of two roads is better.
    comparison = recommend(
        [selected, *alternatives], baseline_route_id=selected.route_id
    )
    better = (
        comparison.recommended_route_id is not None
        and comparison.recommended_route_id != selected.route_id
    )

    if not better:
        # Deteriorated with nowhere to go. This is the common case on a single
        # corridor and it is still worth saying out loud.
        codes.append(REASON_NO_BETTER_ALTERNATIVE)
        codes.extend(comparison.reason_codes)
        return RerouteAssessment(
            outcome=OUTCOME_ALERT_ONLY,
            selected_route_id=selected.route_id,
            selected_risk_score=selected.risk.score,
            selected_risk_band=selected.risk.band,
            proposed_route_id=None,
            reason_codes=tuple(dict.fromkeys(codes)),
            comparison=comparison,
            unavailable_inputs=unavailable,
        )

    codes.append(REASON_BETTER_ROUTE_AVAILABLE)
    codes.extend(comparison.reason_codes)
    return RerouteAssessment(
        outcome=OUTCOME_PROPOSE,
        selected_route_id=selected.route_id,
        selected_risk_score=selected.risk.score,
        selected_risk_band=selected.risk.band,
        proposed_route_id=comparison.recommended_route_id,
        reason_codes=tuple(dict.fromkeys(codes)),
        comparison=comparison,
        unavailable_inputs=unavailable,
    )
