"""Whether a route may be taken at all, as opposed to how it scores.

WHY THIS IS NOT A NUMBER

LS-3 made landslide severity contribute points, which fixed RANKING. It did not
make a closed road unusable, and the counterexample is simple arithmetic:

    a closed route scoring   7 + 45 = 52
    beats
    an open route scoring    70

A penalty can always be out-voted by the other components. A refusal cannot.
So eligibility is decided here, separately, and consulted BEFORE ranking - the
same argument `monsoon_risk` already makes about passability, and the reason
`NOT_PASSABLE` is a field there rather than a high score.

WHAT REJECTED MEANS, AND WHAT IT DOES NOT

REJECTED means an authority has said this road is blocked and the report is
current. It is not "risky", it is "not a road you may plan over". No score,
no duration saving, no cargo priority and no client flag may override it.

ELIGIBLE means "eligible under the constraints actually checked". It is not a
safety guarantee, and this module never claims one - most hazard inputs in this
build are still unavailable and say so.

REQUIRED EVIDENCE VERSUS OPTIONAL ROADMAP FACTORS

The distinction that makes this policy workable, and the one an earlier version
of this module got wrong.

`route_risk` reports SEVEN factors as unavailable in this build. Six of them -
flood, road quality, truck restrictions, historical incidents, elevation and
fuel - are ROADMAP factors: aspirational inputs nothing has ever supplied. If
"any unavailable input forces review" were the rule, every route would be
review-required forever on account of features that were never built, the gate
would carry no information, and operators would learn to click through it.

Exactly one factor is REQUIRED SAFETY EVIDENCE today: **landslide**. It is the
one this system exists to reason about, and the one where absence of knowledge
is operationally meaningful rather than merely incomplete.

So: unknown LANDSLIDE evidence forces REQUIRES_REVIEW. Unknown fuel does not.

WHAT THIS COSTS, STATED HONESTLY

No landslide source is configured, so every route is currently UNKNOWN and
therefore REQUIRES_REVIEW - which means no route is automatically recommended
and no route may be selected until either a source is connected or an audited
review mechanism exists. That is a real operational cost and it is the correct
one: a successful assessment returning UNKNOWN describes insufficient
knowledge, and insufficient knowledge is not evidence of a clear road. Keeping
UNKNOWN eligible would have been keeping the demo clickable at the price of the
only safety claim this module makes.

`REQUIRED_EVIDENCE` below is the single place to change if a factor's status
changes.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Final

from app.domain.landslide import LandslideAssessment, LandslideRisk

VERSION: Final[str] = "route-eligibility-v1"


class Eligibility(str, Enum):
    """Whether a route may be recommended or applied."""

    #: Eligible under the constraints actually checked. Not "safe".
    ELIGIBLE = "ELIGIBLE"
    #: Visible, explainable, but never automatically recommended.
    REQUIRES_REVIEW = "REQUIRES_REVIEW"
    #: May not be recommended, selected or applied. A refusal, not a penalty.
    REJECTED = "REJECTED"
    #: No assessment could be produced at all. This is an INTEGRATION failure,
    #: not a domain answer, and it is deliberately NOT the same thing as a
    #: successfully assessed UNKNOWN: "we asked and the hazard is unknown" is
    #: a supported result that permits a mutation, while "we never managed to
    #: ask" is a bug in this application and must not.
    NOT_ASSESSED = "NOT_ASSESSED"


REASON_REJECTED_HAZARD: Final[str] = "ROUTE_REJECTED_ACTIVE_HAZARD"
REASON_REVIEW_HIGH_HAZARD: Final[str] = "ROUTE_REVIEW_HIGH_HAZARD"
REASON_HAZARD_DATA_UNKNOWN: Final[str] = "ROUTE_HAZARD_DATA_UNKNOWN"
REASON_NO_SAFE_ROUTE: Final[str] = "NO_SAFE_ROUTE_AVAILABLE"
REASON_REVIEW_REQUIRED: Final[str] = "ROUTE_SELECTION_REQUIRES_REVIEW"
REASON_NOT_ASSESSED: Final[str] = "ROUTE_ELIGIBILITY_NOT_ASSESSED"

#: Landslide bands that refuse a route outright.
#:
#: CRITICAL only. HIGH is serious but is an assessment of exposure rather than
#: a statement that the road is shut, and refusing on it would mean an
#: unverified severity judgement could strand cargo.
REJECTING_BANDS: Final[frozenset[LandslideRisk]] = frozenset({LandslideRisk.CRITICAL})

#: Bands that keep a route visible but out of automatic recommendation AND out
#: of direct selection while no audited review mechanism exists.
#:
#: UNKNOWN is here because landslide is REQUIRED evidence (see the module
#: docstring): a successful assessment that returns UNKNOWN describes
#: insufficient knowledge, which is not checked-clear.
REVIEW_BANDS: Final[frozenset[LandslideRisk]] = frozenset(
    {LandslideRisk.HIGH, LandslideRisk.UNKNOWN}
)

#: The factors whose absence forces review. Deliberately ONE entry: the other
#: six unavailable factors in `route_risk` are roadmap items, not safety
#: evidence, and gating on them would make the control meaningless.
REQUIRED_EVIDENCE: Final[frozenset[str]] = frozenset({"landslide"})


@dataclass(frozen=True)
class EligibilityDecision:
    """Whether a route may be used, and the evidence for that answer."""

    eligibility: Eligibility
    reason_codes: tuple[str, ...] = field(default_factory=tuple)
    policy_version: str = VERSION

    @property
    def is_rejected(self) -> bool:
        return self.eligibility is Eligibility.REJECTED

    @property
    def blocks_mutation(self) -> bool:
        """Whether a route-changing action must be refused.

        Two different reasons, both refusing: the road is blocked, or we never
        established whether it is. Absence of an assessment is not permission -
        that was the LS-4 hole, where `decision=None` silently meant "allowed"
        and every live caller passed None.
        """
        return self.eligibility in (Eligibility.REJECTED, Eligibility.NOT_ASSESSED)

    @property
    def may_be_recommended_automatically(self) -> bool:
        return self.eligibility is Eligibility.ELIGIBLE


def not_assessed(detail: str | None = None) -> EligibilityDecision:
    """The decision to use when evidence could not be gathered at all.

    Returned by a caller whose assessment RAISED, so the refusal is explicit
    rather than an omitted argument. See `Eligibility.NOT_ASSESSED`.
    """
    codes = (REASON_NOT_ASSESSED,) if detail is None else (REASON_NOT_ASSESSED, detail)
    return EligibilityDecision(
        eligibility=Eligibility.NOT_ASSESSED, reason_codes=codes
    )


def evaluate(*, landslide: LandslideAssessment | None = None) -> EligibilityDecision:
    """Decide whether a route may be used, from the hazard evidence available.

    `landslide=None` means no assessment was performed at all, which is the
    same absence of evidence as an unconfigured provider: eligible, reported,
    never called clear.
    """
    codes: list[str] = []

    if landslide is None:
        # No assessment at all for a REQUIRED factor. Not eligible: this is
        # the same absence of knowledge as an unconfigured provider, and it
        # was previously - wrongly - treated as permission.
        return EligibilityDecision(
            eligibility=Eligibility.REQUIRES_REVIEW,
            reason_codes=(REASON_HAZARD_DATA_UNKNOWN,),
        )

    if landslide.risk in REJECTING_BANDS:
        # An authority said the road is shut. Nothing downstream may weigh
        # this against a duration saving.
        return EligibilityDecision(
            eligibility=Eligibility.REJECTED,
            reason_codes=(REASON_REJECTED_HAZARD, *landslide.reason_codes),
        )

    if landslide.risk in REVIEW_BANDS:
        # UNKNOWN and HIGH reach review by different routes and must say which:
        # "nobody knows" and "known to be dangerous" are different facts and a
        # dispatcher acts differently on each.
        lead = (
            REASON_HAZARD_DATA_UNKNOWN
            if landslide.risk is LandslideRisk.UNKNOWN
            else REASON_REVIEW_HIGH_HAZARD
        )
        return EligibilityDecision(
            eligibility=Eligibility.REQUIRES_REVIEW,
            reason_codes=(lead, *landslide.reason_codes),
        )

    return EligibilityDecision(
        eligibility=Eligibility.ELIGIBLE, reason_codes=tuple(codes)
    )
