"""LS-4: eligibility is a REFUSAL, not a penalty.

WHY THIS FILE EXISTS

LS-3 made landslide severity contribute points, which fixed ranking. It did
NOT make a closed road unusable, and a review of that work supplied the
counterexample that proves the difference:

    a closed route scoring 7 + 45 = 52
    beats
    an open route scoring 70

A penalty can always be out-voted by other components. A refusal cannot. So
eligibility is computed separately from the score and consulted before any
route is recommended or applied.

All fixtures here are SYNTHETIC and clearly local to this file. No incident in
this file describes a real road.
"""

from datetime import UTC, datetime

import pytest

from app.domain.landslide import (
    IncidentQueryResult,
    IncidentSource,
    LandslideIncident,
    SourceState,
    SourceType,
    VerificationStatus,
    assess_corridor,
)
from app.domain.route_recommendation import RouteCandidate, recommend
from app.domain.route_risk import assess

NOW = datetime(2026, 9, 5, tzinfo=UTC)
CORRIDOR = [(26.14, 91.73), (26.20, 91.85), (26.26, 91.97)]


def _closure_assessment():
    """SYNTHETIC: an official agency reporting a blocked road on the corridor."""
    return assess_corridor(
        IncidentQueryResult(
            state=SourceState.AVAILABLE,
            provider="test-fixture",
            incidents=(
                LandslideIncident(
                    incident_id="synthetic-closure",
                    latitude=26.20,
                    longitude=91.85,
                    event_date=NOW,
                    road_blocked=True,
                    verification_status=VerificationStatus.OFFICIAL,
                    sources=(
                        IncidentSource(
                            name="synthetic-authority",
                            source_type=SourceType.OFFICIAL_AGENCY,
                        ),
                    ),
                ),
            ),
        ),
        route=CORRIDOR,
    )


def _clear_assessment():
    """SYNTHETIC: a real source asked, and it reported no incidents."""
    return assess_corridor(
        IncidentQueryResult(state=SourceState.AVAILABLE, provider="test-fixture"),
        route=CORRIDOR,
    )


def _unknown_assessment():
    """The PRODUCTION state today: no landslide source is configured."""
    return assess_corridor(
        IncidentQueryResult(state=SourceState.NOT_CONFIGURED, provider="none"),
        route=CORRIDOR,
    )


def candidate(
    route_id: str,
    *,
    landslide,
    distance_km: float = 100.0,
    duration_min: float = 120.0,
    kind: str = "PRIMARY",
) -> RouteCandidate:
    return RouteCandidate(
        route_id=route_id,
        kind=kind,
        distance_km=distance_km,
        duration_min=duration_min,
        risk=assess(
            distance_km=distance_km,
            duration_min=duration_min,
            landslide=landslide,
            now=NOW,
        ),
    )


class TestAPenaltyIsNotAProhibition:
    """The gap LS-3 left open."""

    def test_a_sole_closed_candidate_is_never_recommended(self):
        # THE reproduction. One candidate, officially closed. Before LS-4 the
        # recommender returned it because it was the only thing on the list -
        # a penalty has nothing to out-rank when there is no alternative.
        closed = candidate("r-closed", landslide=_closure_assessment())
        result = recommend([closed])
        assert result.recommended_route_id is None

    def test_a_closed_shortcut_loses_to_a_longer_open_route(self):
        # The review's counterexample made concrete: the closed route is
        # cheaper on every other axis, so only a refusal can stop it winning.
        closed = candidate(
            "r-closed", landslide=_closure_assessment(), distance_km=40, duration_min=45
        )
        longer = candidate(
            "r-open",
            landslide=_clear_assessment(),
            distance_km=260,
            duration_min=330,
            kind="EMERGENCY_BACKUP",
        )
        result = recommend([closed, longer])
        assert result.recommended_route_id == "r-open"

    def test_every_candidate_closed_yields_no_safe_route(self):
        a = candidate("r-a", landslide=_closure_assessment())
        b = candidate("r-b", landslide=_closure_assessment(), kind="EMERGENCY_BACKUP")
        result = recommend([a, b])
        assert result.recommended_route_id is None
        # It must say the assessed candidates were all blocked - NOT that every
        # road in the region is shut, which is a claim about the world.
        assert any("NO_SAFE_ROUTE" in c for c in result.reason_codes)


class TestUnknownIsInsufficientEvidenceNotClearance:
    """LS-7 REVERSED the earlier policy here, deliberately.

    Landslide is REQUIRED safety evidence, so a successful assessment that
    returns UNKNOWN describes insufficient knowledge - which is not a clear
    road. The earlier version kept UNKNOWN eligible so the product stayed
    clickable; that traded the only safety claim this layer makes for
    convenience.
    """

    def test_unknown_routes_are_not_automatically_recommended(self):
        a = candidate("r-a", landslide=_unknown_assessment())
        b = candidate("r-b", landslide=_unknown_assessment(), kind="EMERGENCY_BACKUP")
        result = recommend([a, b])
        assert result.recommended_route_id is None
        assert any("REVIEW" in c for c in result.reason_codes)

    def test_unknown_is_reported_as_a_missing_input(self):
        a = candidate("r-a", landslide=_unknown_assessment())
        result = recommend([a])
        assert "landslide" in result.unavailable_inputs


class TestTheMutationPathRefuses:
    """A disabled button is not a control. The server must refuse."""

    def test_a_rejected_route_cannot_be_applied(self):
        from app.core.errors import BusinessRuleError
        from app.domain.route_eligibility import evaluate
        from app.services.routes import refuse_if_ineligible

        decision = evaluate(landslide=_closure_assessment())
        with pytest.raises(BusinessRuleError):
            refuse_if_ineligible(decision)

    def test_an_eligible_route_is_applied_normally(self):
        from app.domain.route_eligibility import evaluate
        from app.services.routes import refuse_if_ineligible

        refuse_if_ineligible(evaluate(landslide=_clear_assessment()))

    def test_a_missing_decision_is_refused_not_allowed(self):
        # REVERSED IN LS-5, deliberately. This test previously asserted that a
        # missing decision was ALLOWED, which is exactly the hole: the guard
        # existed, every live caller passed None, and so it enforced nothing.
        # An omitted assessment is an integration failure in this application,
        # and the safe answer to "did anyone check?" being "no" is to refuse.
        from app.core.errors import BusinessRuleError
        from app.services.routes import refuse_if_ineligible

        with pytest.raises(BusinessRuleError):
            refuse_if_ineligible(None)

    def test_a_failed_assessment_is_refused_and_is_not_unknown(self):
        # The distinction the mission requires: "we asked, the hazard is
        # UNKNOWN" permits a mutation; "we never managed to ask" does not.
        from app.core.errors import BusinessRuleError
        from app.domain.route_eligibility import evaluate, not_assessed
        from app.services.routes import refuse_if_ineligible

        # Both refuse, but with DIFFERENT codes - "we never managed to ask" is
        # an integration fault in this application, while "we asked and nobody
        # knows" is a fact about the road. A dispatcher acts differently on
        # each, so they must not collapse into one message.
        with pytest.raises(BusinessRuleError) as broken:
            refuse_if_ineligible(not_assessed())
        assert broken.value.code == "ROUTE_ELIGIBILITY_NOT_ASSESSED"

        with pytest.raises(BusinessRuleError) as unknown:
            refuse_if_ineligible(evaluate(landslide=_unknown_assessment()))
        assert unknown.value.code == "ROUTE_SELECTION_REQUIRES_REVIEW"

    def test_unknown_hazard_data_blocks_selection_pending_review(self):
        # REVERSED in LS-7. No audited acknowledgement mechanism exists, so
        # the only safe behaviour is refusal that leaves selection unchanged.
        from app.core.errors import BusinessRuleError
        from app.domain.route_eligibility import evaluate
        from app.services.routes import refuse_if_ineligible

        with pytest.raises(BusinessRuleError) as caught:
            refuse_if_ineligible(evaluate(landslide=_unknown_assessment()))
        assert caught.value.code == "ROUTE_SELECTION_REQUIRES_REVIEW"


class TestEligibilityPolicy:
    def test_bands_map_to_the_documented_policy(self):
        from app.domain.landslide import DataStatus, LandslideAssessment
        from app.domain.route_eligibility import Eligibility, evaluate

        def band(risk):
            return evaluate(
                landslide=LandslideAssessment(
                    risk=risk, data_status=DataStatus.AVAILABLE
                )
            ).eligibility

        from app.domain.landslide import LandslideRisk

        assert band(LandslideRisk.CRITICAL) is Eligibility.REJECTED
        assert band(LandslideRisk.HIGH) is Eligibility.REQUIRES_REVIEW
        # LS-7: landslide is REQUIRED evidence, so unknown is not clearance.
        assert band(LandslideRisk.UNKNOWN) is Eligibility.REQUIRES_REVIEW
        assert band(LandslideRisk.CAUTION) is Eligibility.ELIGIBLE
        assert band(LandslideRisk.LOW) is Eligibility.ELIGIBLE

    def test_only_landslide_is_required_evidence(self):
        # The six other unavailable factors in route_risk are ROADMAP items.
        # Gating on them would make every route review-required on account of
        # features that were never built.
        from app.domain.route_eligibility import REQUIRED_EVIDENCE

        assert REQUIRED_EVIDENCE == frozenset({"landslide"})

    def test_a_high_hazard_route_is_not_recommended_automatically(self):
        # Visible and explainable, but a human must choose it.
        from app.domain.landslide import DataStatus, LandslideAssessment, LandslideRisk
        from app.domain.route_eligibility import evaluate

        decision = evaluate(
            landslide=LandslideAssessment(
                risk=LandslideRisk.HIGH, data_status=DataStatus.AVAILABLE
            )
        )
        assert decision.may_be_recommended_automatically is False
        assert decision.is_rejected is False
