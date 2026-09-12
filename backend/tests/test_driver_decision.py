"""The driver's four words come from two published values, never from a model."""

from app.domain.reroute import (
    DECISION_CAUTION,
    DECISION_CONTINUE,
    DECISION_HOLD,
    DECISION_REROUTE,
    OUTCOME_ALERT_ONLY,
    OUTCOME_NO_ACTION,
    OUTCOME_PROPOSE,
    driver_decision,
)


def test_band_alone_maps_to_continue_caution_hold() -> None:
    assert driver_decision("LOW") == DECISION_CONTINUE
    assert driver_decision("MODERATE") == DECISION_CAUTION
    assert driver_decision("HIGH") == DECISION_HOLD


def test_only_a_real_proposal_may_say_reroute() -> None:
    assert driver_decision("HIGH", OUTCOME_PROPOSE) == DECISION_REROUTE
    assert driver_decision("HIGH", OUTCOME_ALERT_ONLY) == DECISION_HOLD
    # A severe-conditions alert on a MODERATE journey is still a hold.
    assert driver_decision("MODERATE", OUTCOME_ALERT_ONLY) == DECISION_HOLD
    assert driver_decision("LOW", OUTCOME_NO_ACTION) == DECISION_CONTINUE


def test_exposure_evidence_raises_a_low_journey_to_caution_never_hold() -> None:
    # A short hill road sums to LOW, yet says "steep" and "HIGH slide density".
    assert driver_decision("LOW", reason_codes=["STEEP_GRADIENT_ON_ROUTE"]) == DECISION_CAUTION
    assert driver_decision("LOW", history_exposure="HIGH") == DECISION_CAUTION
    assert driver_decision("LOW", history_exposure="MODERATE") == DECISION_CONTINUE
    assert driver_decision("LOW", reason_codes=["LANDSLIDE_HISTORY_INVENTORY_AGED"]) == DECISION_CONTINUE
