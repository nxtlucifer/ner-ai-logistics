"""LS-6 Phase C: does the LIVE selection path actually reach the guard?

WHAT THIS PROVES, AND WHAT IT EXPLICITLY DOES NOT

LS-5 made `refuse_if_ineligible` mandatory and wired `select_route` to compute
a decision. Nothing had ever run that wiring. This file runs the REAL
`routes.select_route`, the REAL `route_risk.eligibility_for_route`, the REAL
`route_eligibility.evaluate` and the REAL guard, and injects the scenario
through the **provider interface** - the same seam the application would use if
a hazard source were configured.

It does NOT prove: HTTP status codes, authentication, PostGIS geometry,
persistence, row locking, transaction rollback or serialization. There is no
PostgreSQL on this machine (verified: no install dir, no initdb.exe, no
service, nothing listening on 5432-5435), so integration proof is BLOCKED on
an isolated database. See docs/CLAUDE_HANDOFF.md BLOCKER-5.

THE SESSION DELIBERATELY EXPLODES

`ExplodingSession.execute` raises. A rejected selection must therefore refuse
BEFORE touching the database - which is both the correctness requirement (no
partial mutation, nothing to roll back) and the proof that the guard runs ahead
of `trips.load_for_update`. If the refusal ever moved after the lock, these
tests would fail with the session's own error instead of the business rule.
"""

from datetime import UTC, datetime

import pytest

from app.core.errors import BusinessRuleError
from app.domain.landslide import (
    IncidentQueryResult,
    IncidentSource,
    LandslideIncident,
    SourceState,
    SourceType,
    VerificationStatus,
)
from app.services import route_risk as risk_service
from app.services import routes as route_service
from app.services.landslide.base import BoundingBox

NOW = datetime(2026, 9, 5, tzinfo=UTC)

#: A short synthetic corridor. WKT because that is what the geometry read
#: returns, so the real parser and sampler run.
CORRIDOR_WKT = "LINESTRING(91.73 26.14, 91.85 26.20, 91.97 26.26)"

ROUTE_ID = "11111111-1111-1111-1111-111111111111"
TRIP_ID = "22222222-2222-2222-2222-222222222222"


class ExplodingSession:
    """A session that fails if the code under test touches the database.

    Not a mock of the database - a tripwire. Any read or write means the
    refusal happened too late.
    """

    async def execute(self, *a, **k):  # noqa: ANN002, ANN003
        raise AssertionError("database was touched before the route was refused")

    async def commit(self):
        # assess_route legitimately releases the connection before provider
        # I/O. Allowed, and it writes nothing.
        return None

    async def refresh(self, *a, **k):  # noqa: ANN002, ANN003
        raise AssertionError("refresh reached on a refused selection")


class StubProvider:
    """Injected at the PROVIDER seam, exactly where a real source would sit."""

    name = "test-fixture"

    def __init__(self, result: IncidentQueryResult):
        self._result = result

    async def incidents_near(self, box: BoundingBox, *, since, until):  # noqa: ANN001
        # Prove the caller bounded the query rather than asking for everything.
        assert isinstance(box, BoundingBox)
        assert since < until
        return self._result


def _closure() -> IncidentQueryResult:
    """SYNTHETIC official closure sitting on the corridor. Test-only."""
    return IncidentQueryResult(
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
    )


@pytest.fixture
def geometry(monkeypatch):
    """The one database read `assess_route` needs, stubbed at its own seam."""

    async def _facts(db, route_id):  # noqa: ANN001
        return CORRIDOR_WKT, 100.0, 120

    monkeypatch.setattr(risk_service, "_route_facts", _facts)


def use_provider(monkeypatch, result: IncidentQueryResult) -> None:
    monkeypatch.setattr(
        risk_service, "build_landslide_provider", lambda: StubProvider(result)
    )


class TestTheLivePathReachesTheGuard:
    @pytest.mark.asyncio
    async def test_select_route_refuses_an_officially_closed_route(
        self, geometry, monkeypatch
    ):
        # The whole point of LS-5. Before it, select_route passed no decision
        # and this call would have proceeded to mutate.
        use_provider(monkeypatch, _closure())

        with pytest.raises(BusinessRuleError) as caught:
            await route_service.select_route(
                ExplodingSession(), TRIP_ID, ROUTE_ID, actor=object(), ip=None
            )

        assert caught.value.code == "ROUTE_REJECTED_ACTIVE_HAZARD"

    @pytest.mark.asyncio
    async def test_the_refusal_happens_before_any_database_work(
        self, geometry, monkeypatch
    ):
        # ExplodingSession.execute raises AssertionError. Getting a
        # BusinessRuleError instead proves the guard ran first, so there is no
        # partial selection to roll back.
        use_provider(monkeypatch, _closure())
        with pytest.raises(BusinessRuleError):
            await route_service.select_route(
                ExplodingSession(), TRIP_ID, ROUTE_ID, actor=object(), ip=None
            )

    @pytest.mark.asyncio
    async def test_a_provider_failure_refuses_rather_than_clears(
        self, geometry, monkeypatch
    ):
        # A source being down must not become permission. LS-7: it resolves to
        # UNKNOWN, and landslide is REQUIRED evidence, so the mutation is
        # refused for review - before any database work.
        use_provider(
            monkeypatch,
            IncidentQueryResult(
                state=SourceState.UNAVAILABLE, provider="x", error="timeout"
            ),
        )
        with pytest.raises(BusinessRuleError) as caught:
            await route_service.select_route(
                ExplodingSession(), TRIP_ID, ROUTE_ID, actor=object(), ip=None
            )
        assert caught.value.code == "ROUTE_SELECTION_REQUIRES_REVIEW"

    @pytest.mark.asyncio
    async def test_an_eligible_route_is_not_refused_by_the_guard(
        self, geometry, monkeypatch
    ):
        # A real source answered with no incidents. The guard must let it
        # through - reaching the database tripwire is the success signal here.
        use_provider(
            monkeypatch,
            IncidentQueryResult(state=SourceState.AVAILABLE, provider="test-fixture"),
        )
        with pytest.raises(AssertionError, match="database was touched"):
            await route_service.select_route(
                ExplodingSession(), TRIP_ID, ROUTE_ID, actor=object(), ip=None
            )

    @pytest.mark.asyncio
    async def test_an_assessment_that_raises_refuses_the_mutation(self, monkeypatch):
        # NOT_ASSESSED. If the evidence pipeline itself breaks, the safe answer
        # to "did anyone check?" being "no" is to refuse.
        async def _boom(db, route_id):  # noqa: ANN001
            raise RuntimeError("geometry unavailable")

        monkeypatch.setattr(risk_service, "_route_facts", _boom)

        with pytest.raises(BusinessRuleError) as caught:
            await route_service.select_route(
                ExplodingSession(), TRIP_ID, ROUTE_ID, actor=object(), ip=None
            )
        assert caught.value.code == "ROUTE_ELIGIBILITY_NOT_ASSESSED"


class TestTheCallerCannotSupplyItsOwnClearance:
    def test_select_route_takes_no_eligibility_argument(self):
        # A client-supplied clearance is the obvious way to reopen this hole.
        # The public entry point must not expose one.
        import inspect

        params = inspect.signature(route_service.select_route).parameters
        assert "eligibility" not in params

    def test_apply_selection_requires_a_decision(self):
        # No default: omitting it is a TypeError at the call site rather than
        # a silently permitted mutation, which is what LS-4 shipped.
        import inspect

        param = inspect.signature(route_service.apply_selection).parameters[
            "eligibility"
        ]
        assert param.default is inspect.Parameter.empty


class TestRerouteAcceptanceIsGatedToo:
    """The second mutation path. A gate on one endpoint is not a gate."""

    @pytest.mark.asyncio
    async def test_reroute_refuses_a_closed_target_before_any_database_work(
        self, geometry, monkeypatch
    ):
        # `accept` computes eligibility as its FIRST await - before
        # trip_service.load_for_update - so a closed target is refused without
        # a lock being taken or a row being read.
        from app.services import reroute as reroute_service

        use_provider(monkeypatch, _closure())

        with pytest.raises(BusinessRuleError) as caught:
            await reroute_service.accept(
                ExplodingSession(),
                TRIP_ID,
                from_route_id=ROUTE_ID,
                to_route_id="33333333-3333-3333-3333-333333333333",
                actor=object(),
                ip=None,
            )
        assert caught.value.code == "ROUTE_REJECTED_ACTIVE_HAZARD"

    @pytest.mark.asyncio
    async def test_reroute_refuses_when_the_assessment_fails(self, monkeypatch):
        from app.services import reroute as reroute_service

        async def _boom(db, route_id):  # noqa: ANN001
            raise RuntimeError("geometry unavailable")

        monkeypatch.setattr(risk_service, "_route_facts", _boom)

        with pytest.raises(BusinessRuleError) as caught:
            await reroute_service.accept(
                ExplodingSession(),
                TRIP_ID,
                from_route_id=ROUTE_ID,
                to_route_id="33333333-3333-3333-3333-333333333333",
                actor=object(),
                ip=None,
            )
        assert caught.value.code == "ROUTE_ELIGIBILITY_NOT_ASSESSED"
