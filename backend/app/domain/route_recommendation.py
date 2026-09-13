"""Explainable Route Recommendation V1.

Given several routes that have each been scored by `route_risk.assess`, decide
which one to advise and state why in the same units the decision was made in.

DELIBERATELY NOT AI

A published comparison rule over deterministic inputs. No model, no training,
no confidence interval. The name in `VERSION` says exactly that, and a test
asserts the output carries no field that would imply otherwise.

NO PERCENTAGES

A risk score is an ordinal built from this project's own weights. "33 points
lower" is a statement about that scale and is checkable against the components.
"54% safer" is a claim about probability of harm, which nothing here measures.
Deltas are therefore reported in points, minutes and kilometres - the units the
inputs arrived in - and never as a ratio.

NOTHING IS INVENTED

If a trip has one route, the answer is that route and the reason code says so.
A backup corridor is not fabricated to make the comparison look richer; on a
single-road corridor - which much of the North East is - one route is the
truthful answer.

EVIDENCE MUST MATCH BEFORE SCORES CAN BE COMPARED

The subtle failure this guards against: route A scored WITH live weather, route
B scored without it because the provider failed for B's sample points. B will
usually score lower, purely because a factor that only ever ADDS points was
missing. Recommending B would be recommending the route we know less about.
When the available-input sets differ, the comparison is refused and the reason
code says which fact is missing - the baseline is kept rather than a guess
being dressed up as a decision.
"""

from dataclasses import dataclass
from typing import Final

from app.domain.route_eligibility import (
    REASON_NO_SAFE_ROUTE,
    REASON_REVIEW_REQUIRED,
    Eligibility,
    EligibilityDecision,
    evaluate,
)
from app.domain.route_risk import RouteRisk

VERSION: Final[str] = "explainable-route-recommendation-v1"

#: How much lower a route's risk must be before switching is advised.
#:
#: The score is built from coarse inputs - five weather samples and two
#: distance/duration curves - so small differences are noise, not signal.
#: Advising a detour on a 3-point gap would spend real fuel and real hours on a
#: number that cannot support the decision. Ten points is one full band-width
#: step at the LOW/MODERATE boundary and is a difference a dispatcher can see
#: in the components.
MIN_RISK_MARGIN_POINTS: Final[int] = 10

# --- Reason codes ---------------------------------------------------------
# Codes, not sentences. The driver app renders Hindi and Assamese from local
# files with no model in the loop, and a sentence built here arrives
# untranslatable. Same rule as route_risk.

REASON_NO_ROUTES: Final[str] = "NO_ROUTES_PLANNED"
REASON_ONLY_ONE_ROUTE: Final[str] = "ONLY_ONE_ROUTE_AVAILABLE"
REASON_NO_PRIMARY: Final[str] = "NO_PRIMARY_ROUTE"
REASON_LOWER_RISK_ALTERNATIVE: Final[str] = "LOWER_RISK_ALTERNATIVE"
REASON_WITHIN_MARGIN: Final[str] = "RISK_DIFFERENCE_WITHIN_MARGIN"
REASON_NOT_COMPARABLE: Final[str] = "RISK_INPUTS_NOT_COMPARABLE"
REASON_SLOWER: Final[str] = "ALTERNATIVE_IS_SLOWER"
REASON_FASTER: Final[str] = "ALTERNATIVE_IS_FASTER"
REASON_LONGER: Final[str] = "ALTERNATIVE_IS_LONGER"
REASON_SHORTER: Final[str] = "ALTERNATIVE_IS_SHORTER"
REASON_DURATION_UNKNOWN: Final[str] = "DURATION_NOT_ESTIMATED"
REASON_DISTANCE_UNKNOWN: Final[str] = "DISTANCE_NOT_ESTIMATED"


@dataclass(frozen=True)
class RouteCandidate:
    """One route, already scored, ready to be compared.

    `distance_km` and `duration_min` are optional because the columns behind
    them are: a provider that returned a geometry without an estimate leaves
    NULL, and NULL must stay NULL. Defaulting either to zero would make a route
    with no estimate look instantaneous and win every comparison.
    """

    route_id: str
    kind: str
    distance_km: float | None
    duration_min: float | None
    risk: RouteRisk
    #: Optional override, for a caller that has already evaluated eligibility.
    #: Left None in normal use - see `decision`, which DERIVES it.
    eligibility: EligibilityDecision | None = None

    @property
    def decision(self) -> EligibilityDecision:
        """Whether this route may be used.

        DERIVED from the risk it already carries, not supplied by the caller.
        An eligibility gate that depends on somebody remembering to pass an
        argument is one that will eventually be bypassed by a new call site
        that simply does not know about it - and the bypass would be silent.
        """
        if self.eligibility is not None:
            return self.eligibility
        return evaluate(landslide=self.risk.landslide)

    @property
    def is_rejected(self) -> bool:
        return self.decision.is_rejected

    @property
    def may_be_recommended_automatically(self) -> bool:
        return self.decision.may_be_recommended_automatically

    @property
    def evidence(self) -> frozenset[str]:
        """The factors that were actually available when this was scored.

        Two candidates are comparable only when these match. See the module
        docstring - this is the guard against recommending the route we simply
        know less about.
        """
        return frozenset(self.risk.unavailable)


@dataclass(frozen=True)
class Tradeoff:
    """What choosing the recommendation costs, relative to the baseline.

    Signs are from the baseline's point of view: positive duration means the
    recommendation takes longer, negative risk means it is safer. None means
    the underlying estimate was absent, never zero.
    """

    duration_delta_min: float | None
    distance_delta_km: float | None
    risk_delta_points: int
    fuel_delta_litres: float | None = None


@dataclass(frozen=True)
class Recommendation:
    """The advice, its evidence, and what it could not see."""

    recommended_route_id: str | None
    baseline_route_id: str | None
    reason_codes: tuple[str, ...]
    tradeoff: Tradeoff | None
    #: False whenever the answer rests on something other than a like-for-like
    #: comparison: no alternative existed, or the evidence did not match.
    comparable: bool
    #: Union of every factor missing from any candidate. A dispatcher reading a
    #: recommendation needs to know it was made without landslide data.
    unavailable_inputs: tuple[str, ...]
    margin_points: int = MIN_RISK_MARGIN_POINTS
    version: str = VERSION


def _pick_baseline(
    candidates: list[RouteCandidate], baseline_route_id: str | None
) -> tuple[RouteCandidate, bool]:
    """The route the trip would take if nobody intervened.

    `baseline_route_id` names it outright, and rerouting must use that form:
    once a trip is under way the road it is ON is what an alternative has to
    beat, and that may no longer be the PRIMARY. Comparing a mid-journey
    alternative against a primary the truck already left would measure the
    wrong gap and could propose a switch back onto a road that was abandoned
    for a reason.

    Without it, PRIMARY by definition - the planning-time question, where the
    primary IS what happens if nobody intervenes. When there is no PRIMARY,
    possible if planning stored only a backup or the primary was superseded,
    the first candidate in the caller's order is used and the caller is told:
    "recommended over the primary" and "recommended over whatever we found
    first" are different claims.
    """
    if baseline_route_id is not None:
        for candidate in candidates:
            if candidate.route_id == baseline_route_id:
                return candidate, True
        # A baseline that is not among the candidates is a caller error, not a
        # condition to absorb: silently falling back to the PRIMARY would
        # produce a confident answer to a different question.
        raise ValueError(
            f"baseline route {baseline_route_id} is not among the candidates"
        )
    for candidate in candidates:
        if candidate.kind == "PRIMARY":
            return candidate, True
    return candidates[0], False


def _comparison_codes(
    baseline: RouteCandidate, chosen: RouteCandidate
) -> tuple[list[str], Tradeoff]:
    """Directional codes and the numeric tradeoff, both from the same figures."""
    codes: list[str] = []

    duration_delta: float | None = None
    if baseline.duration_min is None or chosen.duration_min is None:
        codes.append(REASON_DURATION_UNKNOWN)
    else:
        duration_delta = chosen.duration_min - baseline.duration_min
        if duration_delta > 0:
            codes.append(REASON_SLOWER)
        elif duration_delta < 0:
            codes.append(REASON_FASTER)

    distance_delta: float | None = None
    if baseline.distance_km is None or chosen.distance_km is None:
        codes.append(REASON_DISTANCE_UNKNOWN)
    else:
        distance_delta = chosen.distance_km - baseline.distance_km
        if distance_delta > 0:
            codes.append(REASON_LONGER)
        elif distance_delta < 0:
            codes.append(REASON_SHORTER)

    fuel_delta: float | None = None
    if (
        baseline.risk.fuel is not None
        and baseline.risk.fuel.litres is not None
        and chosen.risk.fuel is not None
        and chosen.risk.fuel.litres is not None
    ):
        fuel_delta = round(chosen.risk.fuel.litres - baseline.risk.fuel.litres, 1)

    tradeoff = Tradeoff(
        duration_delta_min=duration_delta,
        distance_delta_km=distance_delta,
        risk_delta_points=chosen.risk.score - baseline.risk.score,
        fuel_delta_litres=fuel_delta,
    )
    return codes, tradeoff


def _sort_key(candidate: RouteCandidate) -> tuple[int, float, str]:
    """Lowest risk, then quickest, then a stable tie-break.

    The id tie-break is not cosmetic: without it two identically scored routes
    could be recommended alternately on successive requests, and a dispatcher
    watching the screen change its mind has no reason to trust either answer.
    A route with no duration estimate sorts last among equals rather than
    first, which is what treating its missing estimate as zero would do.
    """
    # Fleet traffic enters HERE, as time: a congested road loses on the
    # minutes it costs, after risk and before the id tie-break. UNKNOWN
    # traffic adds nothing - it is not evidence of a clear road either.
    delay = candidate.risk.traffic.delay_min if candidate.risk.traffic is not None else 0.0
    return (
        candidate.risk.score,
        candidate.duration_min + delay if candidate.duration_min is not None else float("inf"),
        candidate.route_id,
    )


def recommend(
    candidates: list[RouteCandidate], *, baseline_route_id: str | None = None
) -> Recommendation:
    """Advise one of `candidates`, or the baseline, and say why.

    `candidates` must already exclude routes that are not live options -
    superseded and blocked ones. Ordering matters only as a fallback for
    choosing the baseline; the decision itself does not depend on it.

    `baseline_route_id` names the route to beat. Planning leaves it None and
    gets the PRIMARY. Rerouting passes the route the truck is actually on, for
    the reason given in `_pick_baseline`.
    """
    unavailable = tuple(
        sorted({factor for c in candidates for factor in c.risk.unavailable})
    )

    if not candidates:
        return Recommendation(
            recommended_route_id=None,
            baseline_route_id=None,
            reason_codes=(REASON_NO_ROUTES,),
            tradeoff=None,
            comparable=False,
            unavailable_inputs=unavailable,
        )

    # LS-4. Eligibility is consulted BEFORE ranking, and rejected routes are
    # REMOVED rather than penalised. A penalty can be out-voted by distance and
    # duration - the arithmetic is in route_eligibility - so a closed road that
    # is also the shortest would still win a comparison it should never enter.
    rejected = [c for c in candidates if c.is_rejected]
    usable = [c for c in candidates if not c.is_rejected]

    if not usable:
        # Every candidate assessed is blocked. Deliberately NOT "every road in
        # the region is shut": this is a statement about the routes planned for
        # this trip, and the wording must not imply a survey nobody performed.
        return Recommendation(
            recommended_route_id=None,
            baseline_route_id=None,
            reason_codes=(
                REASON_NO_SAFE_ROUTE,
                *dict.fromkeys(
                    code for c in rejected for code in c.decision.reason_codes
                ),
            ),
            tradeoff=None,
            comparable=False,
            unavailable_inputs=unavailable,
        )

    automatic = [c for c in usable if c.may_be_recommended_automatically]
    if not automatic:
        # Something is usable but nothing may be chosen without a human. Return
        # no route rather than quietly picking one - "requires review" that
        # silently recommends is not review.
        return Recommendation(
            recommended_route_id=None,
            baseline_route_id=None,
            reason_codes=(
                REASON_REVIEW_REQUIRED,
                *dict.fromkeys(
                    code
                    for c in usable
                    for code in c.decision.reason_codes
                ),
            ),
            tradeoff=None,
            comparable=False,
            unavailable_inputs=unavailable,
        )

    candidates = automatic

    baseline, deliberate = _pick_baseline(candidates, baseline_route_id)
    # `deliberate` is False only when the baseline was fallen back to. A named
    # baseline is deliberate by construction, so a reroute never emits
    # NO_PRIMARY_ROUTE - that is a planning-time complaint about a trip with no
    # primary, not a fact about the road a truck is already on.
    codes: list[str] = [] if deliberate else [REASON_NO_PRIMARY]

    if len(candidates) == 1:
        # One road is a truthful answer on a single-corridor route, not a
        # degraded one. No second option is invented to fill the comparison.
        codes.append(REASON_ONLY_ONE_ROUTE)
        return Recommendation(
            recommended_route_id=baseline.route_id,
            baseline_route_id=baseline.route_id,
            reason_codes=tuple(codes),
            tradeoff=None,
            comparable=False,
            unavailable_inputs=unavailable,
        )

    alternatives = [c for c in candidates if c.route_id != baseline.route_id]
    like_for_like = [c for c in alternatives if c.evidence == baseline.evidence]

    if not like_for_like:
        # Every alternative was scored from a different set of facts. Keeping
        # the baseline is the only defensible move: the score gap measures the
        # missing evidence, not the road.
        codes.append(REASON_NOT_COMPARABLE)
        return Recommendation(
            recommended_route_id=baseline.route_id,
            baseline_route_id=baseline.route_id,
            reason_codes=tuple(codes),
            tradeoff=None,
            comparable=False,
            unavailable_inputs=unavailable,
        )

    best = min(like_for_like, key=_sort_key)
    improvement = baseline.risk.score - best.risk.score
    comparison_codes, tradeoff = _comparison_codes(baseline, best)

    if improvement >= MIN_RISK_MARGIN_POINTS:
        codes.append(REASON_LOWER_RISK_ALTERNATIVE)
        codes.extend(comparison_codes)
        chosen_id = best.route_id
    else:
        # The alternative is not enough better to be worth the detour. The
        # tradeoff is still reported: a manager overruling this deserves the
        # same figures the rule used, rather than being told only "no".
        codes.append(REASON_WITHIN_MARGIN)
        codes.extend(comparison_codes)
        chosen_id = baseline.route_id

    return Recommendation(
        recommended_route_id=chosen_id,
        baseline_route_id=baseline.route_id,
        reason_codes=tuple(dict.fromkeys(codes)),
        tradeoff=tradeoff,
        comparable=True,
        unavailable_inputs=unavailable,
    )
