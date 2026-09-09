"""Step 1b: landslide evidence reaching route risk, and the invariant that guards it.

THE INVARIANT

    INSUFFICIENT_DATA MUST NEVER BECOME LOW.

Every other assertion in this file exists to stop that one being violated by a
different route. "Nobody looked", "we tried and failed", and "we looked and
found nothing" are three different answers, and only the third one is evidence
about a road. A risk engine that collapses them tells a dispatcher a
never-examined corridor is clear, which is the single most dangerous output
this feature can produce.

Fixtures here are TEST-ONLY and never reach a running application: the
configured provider is `NullLandslideProvider`, asserted in
`test_landslide_provider.py`.
"""

from datetime import UTC, datetime

from app.domain.landslide import (
    DataStatus,
    IncidentQueryResult,
    IncidentSource,
    LandslideIncident,
    LandslideRisk,
    SourceState,
    SourceType,
    VerificationStatus,
    assess_corridor,
)
from app.domain.route_risk import AVAILABLE, FACTOR_LANDSLIDE, NOT_AVAILABLE, assess

NOW = datetime(2026, 9, 5, tzinfo=UTC)

#: A short corridor near Guwahati, as sampled route positions (lat, lon).
CORRIDOR = [(26.14, 91.73), (26.20, 91.85), (26.26, 91.97)]


def incident(
    lat: float | None = 26.20,
    lon: float | None = 91.85,
    *,
    status: VerificationStatus = VerificationStatus.UNVERIFIED,
    blocked: bool | None = None,
    kind: SourceType = SourceType.NEWS,
) -> LandslideIncident:
    return LandslideIncident(
        incident_id="i1",
        latitude=lat,
        longitude=lon,
        event_date=NOW,
        road_blocked=blocked,
        verification_status=status,
        sources=(IncidentSource(name="src", source_type=kind),),
    )


def available(*incidents: LandslideIncident) -> IncidentQueryResult:
    return IncidentQueryResult(
        state=SourceState.AVAILABLE, incidents=tuple(incidents), provider="test"
    )


class TestAbsenceOfDataIsNeverLowRisk:
    """The safety invariant. Each case is a different route to the same lie."""

    def test_unconfigured_provider_never_reports_low_risk(self):
        result = IncidentQueryResult(state=SourceState.NOT_CONFIGURED, provider="none")
        found = assess_corridor(result, route=CORRIDOR)
        assert found.risk is LandslideRisk.UNKNOWN
        assert found.risk is not LandslideRisk.LOW
        assert found.data_status is DataStatus.NOT_CONFIGURED

    def test_provider_failure_never_reports_low_risk(self):
        result = IncidentQueryResult(
            state=SourceState.UNAVAILABLE, provider="x", error="timeout"
        )
        found = assess_corridor(result, route=CORRIDOR)
        assert found.risk is LandslideRisk.UNKNOWN
        assert found.data_status is DataStatus.SOURCE_FAILED

    def test_a_successful_empty_query_is_the_only_route_to_low(self):
        # This is the ONE case where "no incidents" is evidence about a road:
        # a real source was asked and answered.
        found = assess_corridor(available(), route=CORRIDOR)
        assert found.risk is LandslideRisk.LOW
        assert found.data_status is DataStatus.AVAILABLE

    def test_unknown_and_low_are_distinguishable_by_the_caller(self):
        # If a client cannot tell them apart it will render both as "safe".
        unknown = assess_corridor(
            IncidentQueryResult(state=SourceState.NOT_CONFIGURED), route=CORRIDOR
        )
        low = assess_corridor(available(), route=CORRIDOR)
        assert unknown.risk != low.risk
        assert unknown.data_status != low.data_status
        assert unknown.reason_codes != low.reason_codes


class TestVerificationDrivesSeverity:
    def test_official_road_closure_on_route_is_critical(self):
        found = assess_corridor(
            available(
                incident(
                    status=VerificationStatus.OFFICIAL,
                    blocked=True,
                    kind=SourceType.OFFICIAL_AGENCY,
                )
            ),
            route=CORRIDOR,
        )
        assert found.risk is LandslideRisk.CRITICAL

    def test_official_incident_on_route_without_closure_is_high(self):
        found = assess_corridor(
            available(
                incident(status=VerificationStatus.OFFICIAL, kind=SourceType.OFFICIAL_AGENCY)
            ),
            route=CORRIDOR,
        )
        assert found.risk is LandslideRisk.HIGH

    def test_a_single_unverified_article_does_not_reject_a_route(self):
        # RULE 4. One unsourced report must not shut a corridor - that is how
        # a rumour strands cargo and teaches dispatchers to ignore the system.
        found = assess_corridor(
            available(incident(status=VerificationStatus.UNVERIFIED)), route=CORRIDOR
        )
        assert found.risk is LandslideRisk.CAUTION
        assert found.risk is not LandslideRisk.CRITICAL

    def test_a_resolved_incident_does_not_raise_risk(self):
        found = assess_corridor(
            available(incident(status=VerificationStatus.RESOLVED)), route=CORRIDOR
        )
        assert found.risk is LandslideRisk.LOW


class TestLocationRelation:
    def test_an_incident_far_from_the_route_does_not_affect_it(self):
        # Shillong-ish, well off this corridor.
        far = incident(lat=25.57, lon=91.88, status=VerificationStatus.OFFICIAL,
                       kind=SourceType.OFFICIAL_AGENCY, blocked=True)
        found = assess_corridor(available(far), route=CORRIDOR)
        assert found.on_route_count == 0
        assert found.risk is LandslideRisk.LOW

    def test_an_incident_without_coordinates_is_never_placed_on_the_route(self):
        # Kept as evidence, but its location relation is UNKNOWN. Treating it
        # as on-route would be inventing a position the source never gave.
        nowhere = incident(lat=None, lon=None, status=VerificationStatus.OFFICIAL,
                           kind=SourceType.OFFICIAL_AGENCY, blocked=True)
        found = assess_corridor(available(nowhere), route=CORRIDOR)
        assert found.on_route_count == 0
        assert found.unlocatable_count == 1
        assert found.risk is not LandslideRisk.CRITICAL

    def test_an_empty_route_cannot_place_anything_on_it(self):
        found = assess_corridor(available(incident()), route=[])
        assert found.on_route_count == 0


class TestRouteRiskIntegration:
    def test_landslide_is_computed_not_hardcoded_unavailable(self):
        # Before step 1b this factor was pinned NOT_AVAILABLE by a constant.
        risk = assess(
            distance_km=100,
            duration_min=120,
            landslide=assess_corridor(available(), route=CORRIDOR),
            now=NOW,
        )
        assert risk.inputs[FACTOR_LANDSLIDE] == AVAILABLE
        assert FACTOR_LANDSLIDE not in risk.unavailable

    def test_landslide_stays_unavailable_when_no_provider_is_configured(self):
        risk = assess(
            distance_km=100,
            duration_min=120,
            landslide=assess_corridor(
                IncidentQueryResult(state=SourceState.NOT_CONFIGURED), route=CORRIDOR
            ),
            now=NOW,
        )
        assert risk.inputs[FACTOR_LANDSLIDE] == NOT_AVAILABLE
        assert FACTOR_LANDSLIDE in risk.unavailable

    def test_route_risk_still_works_with_no_landslide_argument_at_all(self):
        # Route planning must not break because no landslide provider exists.
        risk = assess(distance_km=100, duration_min=120, now=NOW)
        assert risk.inputs[FACTOR_LANDSLIDE] == NOT_AVAILABLE
        assert risk.score >= 0

    def test_an_official_closure_reaches_the_route_risk_reason_codes(self):
        risk = assess(
            distance_km=100,
            duration_min=120,
            landslide=assess_corridor(
                available(
                    incident(
                        status=VerificationStatus.OFFICIAL,
                        blocked=True,
                        kind=SourceType.OFFICIAL_AGENCY,
                    )
                ),
                route=CORRIDOR,
            ),
            now=NOW,
        )
        assert any("LANDSLIDE" in code for code in risk.reason_codes)


class TestServiceDegradesHonestly:
    """`landslide_for` must never raise and never resolve absence to LOW."""

    @staticmethod
    def _run(coro):
        import asyncio

        return asyncio.run(coro)

    def test_the_configured_provider_is_actually_called(self):
        # Definition of done for step 1b: a provider seam nobody calls is
        # still a hardcoded constant wearing a Protocol.
        from app.services import route_risk as svc

        found = self._run(svc.landslide_for(CORRIDOR))
        assert found.provider == "none"
        assert found.data_status is DataStatus.NOT_CONFIGURED
        assert found.risk is LandslideRisk.UNKNOWN

    def test_route_planning_survives_a_provider_that_explodes(self):
        # A landslide feed failing must not take trip planning with it.
        from app.services import route_risk as svc

        class Exploding:
            name = "boom"

            async def incidents_near(self, box, *, since, until):
                raise RuntimeError("upstream on fire")

        original = svc.build_landslide_provider
        svc.build_landslide_provider = lambda: Exploding()
        try:
            found = self._run(svc.landslide_for(CORRIDOR))
        finally:
            svc.build_landslide_provider = original

        assert found.data_status is DataStatus.SOURCE_FAILED
        assert found.risk is LandslideRisk.UNKNOWN
        assert found.risk is not LandslideRisk.LOW

    def test_the_corridor_query_is_bounded(self):
        from app.services.route_risk import corridor_box

        box = corridor_box(CORRIDOR)
        assert box is not None
        # Constructed at all means it passed BoundingBox validation, which
        # rejects anything wider than 5 degrees.
        assert box.max_lat - box.min_lat < 5.0
        assert box.max_lon - box.min_lon < 5.0

    def test_a_route_with_no_sampled_positions_is_unknown_not_low(self):
        from app.services.route_risk import corridor_box, landslide_for

        assert corridor_box([]) is None
        found = self._run(landslide_for([]))
        assert found.risk is LandslideRisk.UNKNOWN


class TestCriticalLandslideCannotWinForBeingShorter:
    """LS-3: landslide severity must move the score, not just a flag.

    Step 1b wired the DATA STATUS through but scored nothing, so a corridor
    with an official road closure on it produced exactly the same
    `risk.score` as a clear one. `route_recommendation._sort_key` ranks on
    that score, so the closed road would win on duration - which is the
    "can CRITICAL still win because it is shortest?" failure.
    """

    def _risk(self, assessment):
        return assess(
            distance_km=100, duration_min=120, landslide=assessment, now=NOW
        )

    def test_an_official_closure_scores_higher_than_a_clear_corridor(self):
        closed = self._risk(
            assess_corridor(
                available(
                    incident(
                        status=VerificationStatus.OFFICIAL,
                        blocked=True,
                        kind=SourceType.OFFICIAL_AGENCY,
                    )
                ),
                route=CORRIDOR,
            )
        )
        clear = self._risk(assess_corridor(available(), route=CORRIDOR))
        assert closed.score > clear.score

    def test_severity_is_ordered_low_caution_high_critical(self):
        def score(assessment):
            return self._risk(assessment).score

        clear = score(assess_corridor(available(), route=CORRIDOR))
        caution = score(
            assess_corridor(
                available(incident(status=VerificationStatus.UNVERIFIED)), route=CORRIDOR
            )
        )
        high = score(
            assess_corridor(
                available(
                    incident(
                        status=VerificationStatus.OFFICIAL, kind=SourceType.OFFICIAL_AGENCY
                    )
                ),
                route=CORRIDOR,
            )
        )
        critical = score(
            assess_corridor(
                available(
                    incident(
                        status=VerificationStatus.OFFICIAL,
                        blocked=True,
                        kind=SourceType.OFFICIAL_AGENCY,
                    )
                ),
                route=CORRIDOR,
            )
        )
        assert clear < caution < high < critical

    def test_unknown_does_not_score_as_clear(self):
        # The invariant one layer up: a corridor nobody checked must not
        # produce the same number as one checked and found clear, or ranking
        # will prefer it whenever it is marginally quicker.
        unknown = self._risk(
            assess_corridor(
                IncidentQueryResult(state=SourceState.NOT_CONFIGURED), route=CORRIDOR
            )
        )
        clear = self._risk(assess_corridor(available(), route=CORRIDOR))
        assert unknown.score != clear.score
