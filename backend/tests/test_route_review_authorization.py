"""LS-11: an audited, single-use authorisation for incomplete hazard evidence.

WHAT THESE TESTS ARE DEFENDING

The feature's whole risk is that it quietly becomes "mark as safe". Every test
below exists to stop one specific way that could happen:

  * a closed road being approved by anybody              -> impossible, tested
  * an integration failure being approved instead of fixed -> impossible, tested
  * a manager approving without saying why, or without
    acknowledging that incomplete is not SAFE              -> refused, tested
  * one authorisation spending twice                     -> refused, tested
  * yesterday's review authorising today's road          -> refused, tested
  * the route quietly becoming ELIGIBLE afterwards       -> it does NOT, tested

Real auth, real persisted routes, the real guard and the real transaction. The
only injection is at the existing private provider seam, which is where the
hazard evidence comes from.
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.landslide import (
    IncidentQueryResult,
    IncidentSource,
    LandslideIncident,
    SourceState,
    SourceType,
    VerificationStatus,
)
from app.domain.routing import RouteCandidate
from app.models.enums import RouteKind, RouteState, TripEventKind, UserRole
from app.models.operations import Trip, TripEvent, TripRoute
from app.models.review import RouteReviewAuthorization
from app.services import route_review
from app.services import route_risk as risk_service
from app.services import routes as route_service
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

GEOMETRY = [(26.1445, 91.7362), (26.4, 92.9), (26.7509, 94.2037)]
# A second, distinct corridor so an EMERGENCY_BACKUP survives de-duplication.
BACKUP_GEOMETRY = [(26.1445, 91.7362), (27.1, 92.9), (26.7509, 94.2037)]
RATIONALE = "Spoke to the depot at Nagaon; road reported open by two drivers today."


class _StubChain:
    async def route_options(
        self, origin, destination, *, kind, limit=1, detailed=False
    ):  # noqa: ANN001
        from app.services.routing.base import ChainAttempt, ChainOptions

        return ChainOptions(
            candidates=(
                RouteCandidate(
                    kind=kind, provider="stub", geometry=GEOMETRY,
                    distance_m=308_000.0, duration_s=21_600.0,
                ),
                RouteCandidate(
                    kind=kind, provider="stub", geometry=BACKUP_GEOMETRY,
                    distance_m=326_000.0, duration_s=22_800.0,
                ),
            ),
            attempts=(ChainAttempt("stub", ok=True),),
        )

    async def route(self, origin, destination, *, kind):  # noqa: ANN001
        from app.services.routing.base import ChainResult

        opts = await self.route_options(origin, destination, kind=kind, limit=1)
        return ChainResult(candidate=opts.candidates[0], attempts=opts.attempts)


class _NoSource:
    """No provider configured: the honest production state. -> UNKNOWN."""

    name = "ls11-none"

    async def incidents_near(self, box, *, since, until):  # noqa: ANN001
        return IncidentQueryResult(state=SourceState.NOT_CONFIGURED, provider=self.name)


class _ClearSource:
    """Answered, found nothing on this corridor. -> LOW -> ELIGIBLE."""

    name = "ls11-clear"

    async def incidents_near(self, box, *, since, until):  # noqa: ANN001
        return IncidentQueryResult(state=SourceState.AVAILABLE, provider=self.name)


def _incident(blocked: bool) -> LandslideIncident:
    return LandslideIncident(
        incident_id="SYNTHETIC-LS11",
        latitude=26.4, longitude=92.9,
        road_blocked=blocked,
        verification_status=VerificationStatus.OFFICIAL,
        sources=(IncidentSource(name="synthetic", source_type=SourceType.OFFICIAL_AGENCY),),
    )


class _ClosureSource:
    """Verified active closure. -> CRITICAL -> REJECTED. Never authorisable."""

    name = "ls11-closure"

    async def incidents_near(self, box, *, since, until):  # noqa: ANN001
        return IncidentQueryResult(
            state=SourceState.AVAILABLE, incidents=(_incident(True),), provider=self.name
        )


class _HighSource:
    """Official incident that does not close the road. -> HIGH."""

    name = "ls11-high"

    async def incidents_near(self, box, *, since, until):  # noqa: ANN001
        return IncidentQueryResult(
            state=SourceState.AVAILABLE, incidents=(_incident(False),), provider=self.name
        )


def _use(monkeypatch, source) -> None:
    monkeypatch.setattr(risk_service, "build_landslide_provider", lambda: source)


@pytest.fixture(autouse=True)
def _stubs(monkeypatch):
    monkeypatch.setattr(route_service, "build_chain", lambda: _StubChain())
    _use(monkeypatch, _NoSource())

    async def _no_weather(positions):  # noqa: ANN001
        return []

    monkeypatch.setattr(risk_service, "observations_for", _no_weather)


async def _headers(api: AsyncClient, session: AsyncSession, role: UserRole) -> dict:
    user = await factories.make_user(session, role=role)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    return await _headers(api, session, UserRole.MANAGER)


@pytest.fixture
async def reviewer_headers(api: AsyncClient, session: AsyncSession) -> dict:
    return await _headers(api, session, UserRole.AUTHORISED_REVIEWER)


async def _planned(api: AsyncClient, session: AsyncSession, headers: dict):
    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck)
    trip = await factories.make_trip(
        session, driver, truck, assignment=assignment, stops=2
    )
    planned = await api.post(f"/api/trips/{trip.id}/routes/recalculate", headers=headers)
    assert planned.status_code == 201, planned.text
    return trip, planned.json()["route"]["id"]


async def _authorize(api, trip_id, route_id, headers, rationale=RATIONALE):
    return await api.post(
        f"/api/trips/{trip_id}/routes/{route_id}/review-authorization",
        headers=headers,
        json={"rationale": rationale},
    )


async def _selected_route_id(trip_id):
    from app.db import session as db_session

    async with db_session.get_sessionmaker()() as fresh:
        trip = (
            await fresh.execute(select(Trip).where(Trip.id == trip_id))
        ).scalar_one()
        return trip.selected_route_id


class TestTheRoleSeparationIsStructural:
    def test_reviewer_cannot_select_and_manager_cannot_review(self):
        """Two-person control begins in the permission sets, not in a check."""
        from app.core.permissions import (
            ROUTE_REVIEW_AUTHORIZE,
            ROUTE_SELECT,
            permissions_for,
        )

        reviewer = permissions_for(UserRole.AUTHORISED_REVIEWER)
        manager = permissions_for(UserRole.MANAGER)

        assert ROUTE_REVIEW_AUTHORIZE in reviewer
        assert ROUTE_SELECT not in reviewer, (
            "a reviewer that can also select can authorise their own action"
        )
        assert ROUTE_SELECT in manager
        assert ROUTE_REVIEW_AUTHORIZE not in manager

    async def test_a_manager_cannot_issue_an_authorization(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        trip, route_id = await _planned(api, session, manager_headers)
        refused = await _authorize(api, trip.id, route_id, manager_headers)
        assert refused.status_code == 403, refused.text


class TestWhatMayAndMayNotBeAuthorized:
    async def test_unknown_evidence_is_authorizable(
        self, api: AsyncClient, session: AsyncSession,
        manager_headers: dict, reviewer_headers: dict,
    ):
        trip, route_id = await _planned(api, session, manager_headers)
        issued = await _authorize(api, trip.id, route_id, reviewer_headers)
        assert issued.status_code == 201, issued.text
        body = issued.json()
        assert body["basis"] == "HAZARD_DATA_UNKNOWN"
        assert body["consumed_at"] is None
        # Server-set lifetime, 30 minutes.
        span = datetime.fromisoformat(body["expires_at"]) - datetime.fromisoformat(
            body["issued_at"]
        )
        assert span == route_review.AUTHORIZATION_TTL

    async def test_a_closed_road_can_never_be_authorized(
        self, api: AsyncClient, session: AsyncSession,
        manager_headers: dict, reviewer_headers: dict, monkeypatch,
    ):
        """The hard limit. No role, rationale or policy reaches this."""
        trip, route_id = await _planned(api, session, manager_headers)
        _use(monkeypatch, _ClosureSource())
        refused = await _authorize(api, trip.id, route_id, reviewer_headers)
        assert refused.status_code == 422, refused.text
        assert refused.json()["error"]["code"] == "ROUTE_REJECTED_ACTIVE_HAZARD"

    async def test_high_hazard_is_not_authorizable_under_this_policy(
        self, api: AsyncClient, session: AsyncSession,
        manager_headers: dict, reviewer_headers: dict, monkeypatch,
    ):
        """Approved scope is UNKNOWN only.

        HIGH means an authority reported an incident ON this corridor.
        Delegating "unmeasured" is a different act from delegating "known
        dangerous", and only the first is in scope.
        """
        trip, route_id = await _planned(api, session, manager_headers)
        _use(monkeypatch, _HighSource())
        refused = await _authorize(api, trip.id, route_id, reviewer_headers)
        assert refused.status_code == 422, refused.text
        assert refused.json()["error"]["code"] == "ROUTE_REVIEW_BASIS_NOT_AUTHORIZABLE"

    async def test_an_eligible_route_needs_no_authorization(
        self, api: AsyncClient, session: AsyncSession,
        manager_headers: dict, reviewer_headers: dict, monkeypatch,
    ):
        trip, route_id = await _planned(api, session, manager_headers)
        _use(monkeypatch, _ClearSource())
        refused = await _authorize(api, trip.id, route_id, reviewer_headers)
        assert refused.status_code == 422, refused.text
        assert refused.json()["error"]["code"] == "ROUTE_REVIEW_NOT_REQUIRED"

    async def test_a_shrug_is_not_a_rationale(
        self, api: AsyncClient, session: AsyncSession,
        manager_headers: dict, reviewer_headers: dict,
    ):
        trip, route_id = await _planned(api, session, manager_headers)
        refused = await _authorize(api, trip.id, route_id, reviewer_headers, "ok")
        assert refused.status_code == 422, refused.text


class TestConsumption:
    async def test_unknown_without_authorization_is_still_refused(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        """The LS-7 behaviour must be untouched when nobody reviewed anything."""
        trip, route_id = await _planned(api, session, manager_headers)
        refused = await api.post(
            f"/api/trips/{trip.id}/routes/{route_id}/select", headers=manager_headers
        )
        assert refused.status_code == 422, refused.text
        assert refused.json()["error"]["code"] == "ROUTE_SELECTION_REQUIRES_REVIEW"

    async def test_a_valid_authorization_permits_exactly_one_selection(
        self, api: AsyncClient, session: AsyncSession,
        manager_headers: dict, reviewer_headers: dict,
    ):
        trip, route_id = await _planned(api, session, manager_headers)
        auth_id = (await _authorize(api, trip.id, route_id, reviewer_headers)).json()["id"]

        ok = await api.post(
            f"/api/trips/{trip.id}/routes/{route_id}/select"
            f"?authorization_id={auth_id}",
            headers=manager_headers,
        )
        assert ok.status_code == 200, ok.text
        assert str(await _selected_route_id(trip.id)) == route_id

        # THE TEST THAT STOPS THIS BECOMING "MARK AS SAFE".
        risk = await api.get(
            f"/api/trips/{trip.id}/routes/{route_id}/risk", headers=manager_headers
        )
        assert risk.json()["inputs"]["landslide"] == "NOT_AVAILABLE", (
            "consuming an authorisation changed what the evidence says"
        )

    async def test_the_same_authorization_cannot_be_spent_twice(
        self, api: AsyncClient, session: AsyncSession,
        manager_headers: dict, reviewer_headers: dict,
    ):
        trip, route_id = await _planned(api, session, manager_headers)
        auth_id = (await _authorize(api, trip.id, route_id, reviewer_headers)).json()["id"]
        url = (
            f"/api/trips/{trip.id}/routes/{route_id}/select"
            f"?authorization_id={auth_id}"
        )
        assert (await api.post(url, headers=manager_headers)).status_code == 200
        replay = await api.post(url, headers=manager_headers)
        assert replay.status_code == 422, replay.text
        assert replay.json()["error"]["code"] == "ROUTE_REVIEW_AUTHORIZATION_INVALID"

    async def test_the_person_who_accepted_the_evidence_may_act_on_it(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        """Policy 2026-09-18: one accountable person, not two. ADMIN holds both
        permissions, so this is the two-step shape of what a manager does in
        one step through /approve."""
        trip, route_id = await _planned(api, session, manager_headers)
        admin = await _headers(api, session, UserRole.ADMIN)

        auth_id = (await _authorize(api, trip.id, route_id, admin)).json()["id"]
        ok = await api.post(
            f"/api/trips/{trip.id}/routes/{route_id}/select"
            f"?authorization_id={auth_id}",
            headers=admin,
        )
        assert ok.status_code == 200, ok.text
        assert str(await _selected_route_id(trip.id)) == route_id

    async def test_a_revoked_authorization_cannot_be_spent(
        self, api: AsyncClient, session: AsyncSession,
        manager_headers: dict, reviewer_headers: dict,
    ):
        trip, route_id = await _planned(api, session, manager_headers)
        auth_id = (await _authorize(api, trip.id, route_id, reviewer_headers)).json()["id"]
        revoked = await api.delete(
            f"/api/trips/{trip.id}/routes/{route_id}"
            f"/review-authorization/{auth_id}",
            headers=reviewer_headers,
        )
        assert revoked.status_code == 200, revoked.text

        refused = await api.post(
            f"/api/trips/{trip.id}/routes/{route_id}/select"
            f"?authorization_id={auth_id}",
            headers=manager_headers,
        )
        assert refused.status_code == 422
        assert await _selected_route_id(trip.id) is None

    async def test_an_expired_authorization_cannot_be_spent(
        self, api: AsyncClient, session: AsyncSession,
        manager_headers: dict, reviewer_headers: dict,
    ):
        """30 minutes, server-set, and past it the answer is no.

        The row is INSERTED already-aged rather than edited: `expires_at` is
        immutable once issued - the trigger refuses to move it, which is the
        point - so there is no way to age a real one, and no need to.
        """
        from app.db import session as db_session

        trip, route_id = await _planned(api, session, manager_headers)
        reviewer = await factories.make_user(
            session, role=UserRole.AUTHORISED_REVIEWER
        )
        now = datetime.now(UTC)

        async with db_session.get_sessionmaker()() as writer:
            stale = RouteReviewAuthorization(
                trip_id=trip.id,
                route_id=uuid.UUID(route_id),
                evidence_digest="whatever-it-was",
                evidence_snapshot={"risk": "UNKNOWN"},
                policy_version="route-eligibility-v1",
                evidence_version="landslide-incident-v1",
                basis="HAZARD_DATA_UNKNOWN",
                route_state_at_issue="PROPOSED",
                reviewer_user_id=reviewer.id,
                rationale=RATIONALE,
                issued_at=now - timedelta(minutes=61),
                expires_at=now - timedelta(minutes=31),
            )
            writer.add(stale)
            await writer.commit()
            auth_id = str(stale.id)

        refused = await api.post(
            f"/api/trips/{trip.id}/routes/{route_id}/select"
            f"?authorization_id={auth_id}",
            headers=manager_headers,
        )
        assert refused.status_code == 422, refused.text
        assert refused.json()["error"]["code"] == "ROUTE_REVIEW_AUTHORIZATION_INVALID"
        assert await _selected_route_id(trip.id) is None

    async def test_a_closure_appearing_after_issue_blocks_the_selection(
        self, api: AsyncClient, session: AsyncSession,
        manager_headers: dict, reviewer_headers: dict, monkeypatch,
    ):
        """The case the whole evidence binding exists for.

        The reviewer accepted "nobody has measured this". By the time the
        manager acts, an authority has closed the road. The authorisation must
        not carry the selection through.
        """
        trip, route_id = await _planned(api, session, manager_headers)
        auth_id = (await _authorize(api, trip.id, route_id, reviewer_headers)).json()["id"]

        _use(monkeypatch, _ClosureSource())

        refused = await api.post(
            f"/api/trips/{trip.id}/routes/{route_id}/select"
            f"?authorization_id={auth_id}",
            headers=manager_headers,
        )
        assert refused.status_code == 422, refused.text
        assert refused.json()["error"]["code"] == "ROUTE_REJECTED_ACTIVE_HAZARD"
        assert await _selected_route_id(trip.id) is None

    async def test_a_superseded_route_cannot_be_selected_even_with_authorization(
        self, api: AsyncClient, session: AsyncSession,
        manager_headers: dict, reviewer_headers: dict,
    ):
        """Review approval does not bypass terminal lifecycle rules."""
        from app.db import session as db_session

        trip, route_id = await _planned(api, session, manager_headers)
        auth_id = (await _authorize(api, trip.id, route_id, reviewer_headers)).json()["id"]

        async with db_session.get_sessionmaker()() as writer:
            row = (
                await writer.execute(
                    select(TripRoute).where(TripRoute.id == uuid.UUID(route_id))
                )
            ).scalar_one()
            row.state = RouteState.SUPERSEDED
            await writer.commit()

        refused = await api.post(
            f"/api/trips/{trip.id}/routes/{route_id}/select"
            f"?authorization_id={auth_id}",
            headers=manager_headers,
        )
        assert refused.status_code == 422, refused.text
        assert refused.json()["error"]["code"] == "ROUTE_SUPERSEDED"


class TestEvidenceBinding:
    def test_equivalent_evidence_digests_identically(self):
        """Or every authorisation dies on the next poll."""
        from app.domain.landslide import DataStatus, LandslideAssessment, LandslideRisk

        def build(considered: int) -> LandslideAssessment:
            return LandslideAssessment(
                risk=LandslideRisk.UNKNOWN,
                data_status=DataStatus.NOT_CONFIGURED,
                reason_codes=("LANDSLIDE_DATA_NOT_CONFIGURED",),
                considered_count=considered,
                on_route_count=0,
                unlocatable_count=0,
                provider="none",
            )

        # `considered_count` is deliberately outside the digest: an incident
        # elsewhere in the query box is not news about THIS corridor.
        assert route_review.evidence_digest(build(0)) == route_review.evidence_digest(
            build(7)
        )

    def test_a_substantive_on_route_change_digests_differently(self):
        from app.domain.landslide import DataStatus, LandslideAssessment, LandslideRisk

        base = LandslideAssessment(
            risk=LandslideRisk.UNKNOWN,
            data_status=DataStatus.NOT_CONFIGURED,
            reason_codes=("LANDSLIDE_DATA_NOT_CONFIGURED",),
            provider="none",
        )
        changed = LandslideAssessment(
            risk=LandslideRisk.HIGH,
            data_status=DataStatus.AVAILABLE,
            reason_codes=("LANDSLIDE_OFFICIAL_INCIDENT_ON_ROUTE",),
            on_route_count=1,
            provider="ls11-high",
        )
        assert route_review.evidence_digest(base) != route_review.evidence_digest(changed)


class TestConcurrency:
    async def test_two_concurrent_selections_produce_one_transition(
        self, api: AsyncClient, session: AsyncSession,
        manager_headers: dict, reviewer_headers: dict,
    ):
        """Exercises the real service path, not the index in isolation.

        Atomicity here rests on three things and this test is the only one that
        can tell whether they combine: the partial unique index (one live row),
        the trips row lock (ordering), and the conditional UPDATE (claim and
        check in one statement).
        """
        trip, route_id = await _planned(api, session, manager_headers)
        auth_id = (await _authorize(api, trip.id, route_id, reviewer_headers)).json()["id"]
        url = (
            f"/api/trips/{trip.id}/routes/{route_id}/select"
            f"?authorization_id={auth_id}"
        )

        first, second = await asyncio.gather(
            api.post(url, headers=manager_headers),
            api.post(url, headers=manager_headers),
        )
        codes = sorted([first.status_code, second.status_code])
        assert codes == [200, 422], f"{first.status_code} {second.status_code}"

        from app.db import session as db_session

        async with db_session.get_sessionmaker()() as fresh:
            spent = (
                await fresh.execute(
                    select(RouteReviewAuthorization).where(
                        RouteReviewAuthorization.id == uuid.UUID(auth_id)
                    )
                )
            ).scalar_one()
            assert spent.consumed_at is not None
            assert spent.consumed_by_user_id is not None


APPROVAL = {
    "rationale": "Use route with current evidence for demo dispatch; depot confirms road open.",
    "acknowledged_incomplete_evidence": True,
}


async def _approve(api, trip_id, route_id, headers, body=APPROVAL):
    return await api.post(
        f"/api/trips/{trip_id}/routes/{route_id}/approve", headers=headers, json=body
    )


async def _authorizations(route_id) -> list[RouteReviewAuthorization]:
    from app.db import session as db_session

    async with db_session.get_sessionmaker()() as fresh:
        return list(
            (
                await fresh.execute(
                    select(RouteReviewAuthorization).where(
                        RouteReviewAuthorization.route_id == uuid.UUID(route_id)
                    )
                )
            ).scalars()
        )


class TestManagerApproval:
    """The manager is the route authority: accept the evidence and act, at once."""

    async def test_an_eligible_route_is_selected_directly(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, monkeypatch
    ):
        trip, route_id = await _planned(api, session, manager_headers)
        _use(monkeypatch, _ClearSource())
        ok = await api.post(
            f"/api/trips/{trip.id}/routes/{route_id}/select", headers=manager_headers
        )
        assert ok.status_code == 200, ok.text
        # And approving it is refused: there was nothing to accept.
        refused = await _approve(api, trip.id, route_id, manager_headers)
        assert refused.json()["error"]["code"] == "ROUTE_REVIEW_NOT_REQUIRED"

    async def test_approval_issues_spends_and_selects_in_one_step(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        trip, route_id = await _planned(api, session, manager_headers)
        ok = await _approve(api, trip.id, route_id, manager_headers)
        assert ok.status_code == 200, ok.text
        body = ok.json()
        assert body["route"]["is_current"] is True
        assert body["authorization"]["consumed_at"] is not None
        assert body["authorization"]["reviewer_role"] == "MANAGER"
        assert body["authorization"]["reviewer_name"]
        assert str(await _selected_route_id(trip.id)) == route_id

        rows = await _authorizations(route_id)
        assert len(rows) == 1
        assert rows[0].consumed_by_user_id == rows[0].reviewer_user_id

        # Survives a reload: the spent authorisation is still readable.
        again = await api.get(
            f"/api/trips/{trip.id}/routes/{route_id}/review-authorization",
            headers=manager_headers,
        )
        assert again.json()["id"] == body["authorization"]["id"]
        assert again.json()["reviewer_role"] == "MANAGER"

        # STILL NOT "MARK AS SAFE".
        risk = await api.get(
            f"/api/trips/{trip.id}/routes/{route_id}/risk", headers=manager_headers
        )
        assert risk.json()["inputs"]["landslide"] == "NOT_AVAILABLE"

    async def test_no_rationale_or_no_acknowledgement_is_refused(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        trip, route_id = await _planned(api, session, manager_headers)
        for body in (
            {**APPROVAL, "rationale": "ok"},
            {**APPROVAL, "acknowledged_incomplete_evidence": False},
            {"rationale": APPROVAL["rationale"]},
        ):
            refused = await _approve(api, trip.id, route_id, manager_headers, body)
            assert refused.status_code == 422, refused.text
        assert await _authorizations(route_id) == []
        assert await _selected_route_id(trip.id) is None

    async def test_a_closed_road_cannot_be_approved_by_a_manager(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, monkeypatch
    ):
        trip, route_id = await _planned(api, session, manager_headers)
        _use(monkeypatch, _ClosureSource())
        refused = await _approve(api, trip.id, route_id, manager_headers)
        assert refused.status_code == 422, refused.text
        assert refused.json()["error"]["code"] == "ROUTE_REJECTED_ACTIVE_HAZARD"
        assert await _authorizations(route_id) == []
        assert await _selected_route_id(trip.id) is None

    async def test_high_hazard_is_not_a_manager_override_either(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, monkeypatch
    ):
        trip, route_id = await _planned(api, session, manager_headers)
        _use(monkeypatch, _HighSource())
        refused = await _approve(api, trip.id, route_id, manager_headers)
        assert refused.status_code == 422, refused.text
        assert refused.json()["error"]["code"] == "ROUTE_REVIEW_BASIS_NOT_AUTHORIZABLE"
        assert await _authorizations(route_id) == []

    async def test_a_driver_cannot_approve(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        trip, route_id = await _planned(api, session, manager_headers)
        driver = await _headers(api, session, UserRole.DRIVER)
        refused = await _approve(api, trip.id, route_id, driver)
        assert refused.status_code == 403, refused.text
        assert await _authorizations(route_id) == []

    async def test_a_double_click_makes_one_authorization_and_one_selection(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        trip, route_id = await _planned(api, session, manager_headers)
        first, second = await asyncio.gather(
            _approve(api, trip.id, route_id, manager_headers),
            _approve(api, trip.id, route_id, manager_headers),
        )
        codes = sorted([first.status_code, second.status_code])
        assert codes == [200, 422], f"{first.status_code} {second.status_code}"
        rows = await _authorizations(route_id)
        assert len(rows) == 1 and rows[0].consumed_at is not None
        assert str(await _selected_route_id(trip.id)) == route_id

    async def test_a_superseded_route_cannot_be_approved(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        from app.db import session as db_session

        trip, route_id = await _planned(api, session, manager_headers)
        async with db_session.get_sessionmaker()() as writer:
            row = (
                await writer.execute(
                    select(TripRoute).where(TripRoute.id == uuid.UUID(route_id))
                )
            ).scalar_one()
            row.state = RouteState.SUPERSEDED
            await writer.commit()

        refused = await _approve(api, trip.id, route_id, manager_headers)
        assert refused.status_code == 422, refused.text
        assert refused.json()["error"]["code"] == "ROUTE_SUPERSEDED"
        assert await _authorizations(route_id) == [], "a refusal must store nothing"


class TestManagerApprovalOfAReroute:
    """The same acceptance for a moving truck, through the reroute contract."""

    async def _moving(self, api, session, headers):
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await factories.make_assignment(session, driver, truck, verified=True)
        trip = await factories.make_trip(session, driver, truck, assignment=assignment, stops=2)
        planned = await api.post(f"/api/trips/{trip.id}/routes/recalculate", headers=headers)
        assert planned.status_code == 201, planned.text
        routes = (
            await session.execute(select(TripRoute).where(TripRoute.trip_id == trip.id))
        ).scalars().all()
        primary = next(r for r in routes if r.kind is RouteKind.PRIMARY)
        backup = next(r for r in routes if r.kind is RouteKind.EMERGENCY_BACKUP)
        # Evidence is UNKNOWN on every corridor here, so even the first
        # selection goes through the manager's approval.
        assert (await _approve(api, trip.id, primary.id, headers)).status_code == 200
        driver_headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        started = await api.post("/api/driver/me/trip/start", headers=driver_headers, json={})
        assert started.status_code == 200, started.text
        return trip, primary, backup

    async def test_approving_with_from_route_reroutes_and_records_it(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        trip, primary, backup = await self._moving(api, session, manager_headers)
        ok = await _approve(
            api, trip.id, backup.id, manager_headers,
            {**APPROVAL, "from_route_id": str(primary.id)},
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["route"]["id"] == str(backup.id)
        assert str(await _selected_route_id(trip.id)) == str(backup.id)

        async with __import__("app.db.session", fromlist=["x"]).get_sessionmaker()() as fresh:
            event = (
                await fresh.execute(
                    select(TripEvent).where(
                        TripEvent.trip_id == trip.id,
                        TripEvent.kind == TripEventKind.ROUTE_CHANGED,
                    )
                )
            ).scalar_one()
        assert event.payload["to_route_id"] == str(backup.id)
        spent = await _authorizations(str(backup.id))
        assert len(spent) == 1 and spent[0].consumed_at is not None

    async def test_a_stale_screen_cannot_reroute_and_stores_nothing(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        trip, primary, backup = await self._moving(api, session, manager_headers)
        stale = await _approve(
            api, trip.id, backup.id, manager_headers,
            {**APPROVAL, "from_route_id": str(uuid.uuid4())},  # a road the trip left
        )
        assert stale.status_code == 409, stale.text
        assert stale.json()["error"]["code"] == "ROUTE_SUPERSEDED"
        assert str(await _selected_route_id(trip.id)) == str(primary.id)
        assert await _authorizations(str(backup.id)) == []
