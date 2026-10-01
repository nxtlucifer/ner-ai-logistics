"""India-wide, NER-centred trip policy (owner decisions, 29 Sep 2026).

Findings P1R-16, P1R-12 and RG-8: the Phase-1 trip-policy lane never ran.

(a) `trip_scope_type` is read on TripRead, TripDetail and FleetTripRead.
(b) The North-East Manager sees every trip except a PROVEN India-external one.
    State and district managers see a trip by either end. The list and the
    single read agree, and out of scope is the same 404 as a trip that does not
    exist.
(c) A candidate route whose line leaves India is dropped
    (ROUTE_CROSSES_COUNTRY_BOUNDARY). None left is 422 HOLD_AND_REVIEW and
    nothing is stored. No India outline is 503 GEOGRAPHY_UNAVAILABLE, before any
    provider is asked.
(d) `intelligence_coverage` on route evidence. A road not wholly inside the NER
    state polygons is LIMITED_EVIDENCE (INDIA_BASE_ROUTING); unknown coverage is
    UNKNOWN. Neither can be ELIGIBLE, whatever a hazard source says.

Every shape is a SYNTHETIC FIXTURE_* rectangle (tests/geo_fixtures.py). Nothing
here is a fact about a real place.
"""

import logging
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.domain.landslide import DataStatus, LandslideAssessment, LandslideRisk
from app.domain.reroute import driver_decision
from app.domain.route_eligibility import Eligibility, evaluate
from app.domain.route_recommendation import RouteCandidate as RankedCandidate
from app.domain.route_risk import assess
from app.domain.routing import RouteCandidate
from app.models.audit import AuditLog
from app.models.enums import RouteState, TripStatus, UserRole
from app.models.geography import District, State
from app.models.operations import Shipment, Trip, TripRoute
from app.services import routes as route_service
from tests import factories
from tests import geo_fixtures as fx
from tests.conftest import auth_headers
from tests.test_geo_classify import _plan
from tests.test_resource_reservation import _pair

pytestmark = pytest.mark.requires_db


@pytest.fixture(autouse=True)
def _no_weather(monkeypatch):
    """No test here may reach a weather service; the evidence is not the subject."""
    monkeypatch.setenv("WEATHER_ENABLED", "false")
    get_settings.cache_clear()


async def _headers(api: AsyncClient, user) -> dict:
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


async def _planned(api: AsyncClient, session: AsyncSession, pickup, destination) -> dict:
    """A trip planned through the API, by a manager of its own (rate budgets)."""
    boss = await factories.make_user(session, role=UserRole.MANAGER)
    driver, truck = await _pair(session)
    r = await _plan(api, await _headers(api, boss), driver, truck, pickup, destination)
    assert r.status_code == 201, r.text
    return r.json()


def _without_request_id(body: dict) -> dict:
    return {k: v for k, v in body["error"].items() if k != "request_id"}


async def _sees(api: AsyncClient, user, trip: dict) -> bool:
    """Whether `user` can reach `trip`, asserting the list and the id agree."""
    headers = await _headers(api, user)
    page = await api.get(f"/api/trips?search={trip['trip_code']}", headers=headers)
    assert page.status_code == 200, page.text
    listed = trip["trip_code"] in {t["trip_code"] for t in page.json()["items"]}
    one = await api.get(f"/api/trips/{trip['id']}", headers=headers)
    assert one.status_code in (200, 404), one.text
    assert listed is (one.status_code == 200), "the list and the single read disagree"
    if one.status_code == 404:
        ghost = await api.get(f"/api/trips/{uuid.uuid4()}", headers=headers)
        assert _without_request_id(one.json()) == _without_request_id(ghost.json()), (
            "out of scope must read exactly like a trip that does not exist"
        )
    return listed


async def _set_active(session: AsyncSession, trip_id) -> None:
    row = await session.get(Trip, uuid.UUID(str(trip_id)))
    row.status = TripStatus.ACTIVE
    await session.commit()


# --- (a) trip_scope_type on the reads -------------------------------------


@pytest.mark.usefixtures("fixture_geography")
class TestTripScopeTypeIsRead:
    CASES = {
        "NER_OUTBOUND": (fx.P_ASSAM_KAMRUP, fx.P_DELHI),
        "NER_INBOUND": (fx.P_DELHI, fx.P_ASSAM_KAMRUP),
        "NER_INTERNAL": (fx.P_ASSAM_KAMRUP, fx.P_MEGHALAYA),
        # India, but no state polygon covers the point: never a guess.
        "UNKNOWN": (fx.P_INDIA_NO_STATE, fx.P_ASSAM),
    }

    async def test_list_detail_and_fleet_carry_it(self, api: AsyncClient, session: AsyncSession):
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await _headers(api, boss)
        for expected, (pickup, destination) in self.CASES.items():
            trip = await _planned(api, session, pickup, destination)
            listed = (await api.get(f"/api/trips?search={trip['trip_code']}", headers=headers)).json()["items"]
            assert [t["trip_scope_type"] for t in listed] == [expected], trip["trip_code"]
            detail = (await api.get(f"/api/trips/{trip['id']}", headers=headers)).json()
            assert detail["trip_scope_type"] == expected
            await _set_active(session, trip["id"])
            fleet = (await api.get("/api/fleet/active", headers=headers)).json()["trips"]
            assert {t["trip_code"]: t["trip_scope_type"] for t in fleet}[trip["trip_code"]] == expected

    async def test_india_external_is_named_when_the_flag_admits_one(self, api, session, monkeypatch):
        monkeypatch.setenv("ALLOW_INDIA_EXTERNAL_TRIPS", "true")
        get_settings.cache_clear()
        trip = await _planned(api, session, fx.P_WEST_BENGAL, fx.P_DELHI)
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        detail = (await api.get(f"/api/trips/{trip['id']}", headers=await _headers(api, boss))).json()
        assert detail["trip_scope_type"] == "INDIA_EXTERNAL"

    async def test_a_trip_with_no_geography_is_unknown(self, api, session):
        driver, truck = await _pair(session)
        orphan = await factories.make_trip(session, driver, truck)
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        detail = (await api.get(f"/api/trips/{orphan.id}", headers=await _headers(api, boss))).json()
        assert detail["trip_scope_type"] == "UNKNOWN"

    @pytest.mark.parametrize(
        "source,expected",
        [("POSTGIS_ADMIN_BOUNDARY", "INDIA_EXTERNAL"), ("OSM_NOMINATIM_REVERSE", "UNKNOWN"), (None, "UNKNOWN")],
    )
    async def test_only_postgis_can_say_an_end_is_not_ner(self, api, session, source, expected):
        """The OSM fallback confirms the NER, never denies it (trip_geography)."""
        wb = (await session.execute(select(State.id).where(State.slug == "fixture-west-bengal"))).scalar_one()
        delhi = (await session.execute(select(State.id).where(State.slug == "fixture-delhi"))).scalar_one()
        shipment = await factories.make_shipment(session)
        shipment.origin_state_id, shipment.destination_state_id = wb, delhi
        shipment.geography_source = source
        await session.commit()
        driver, truck = await _pair(session)
        trip = await factories.make_trip(session, driver, truck, shipment=shipment)
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        detail = (await api.get(f"/api/trips/{trip.id}", headers=await _headers(api, boss))).json()
        assert detail["trip_scope_type"] == expected
        ne = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        seen = await _sees(api, ne, {"id": str(trip.id), "trip_code": trip.trip_code})
        assert seen is (expected != "INDIA_EXTERNAL")


# --- (b) RBAC for India-wide trips ----------------------------------------


@pytest.mark.usefixtures("fixture_geography")
class TestIndiaWideScope:
    async def test_kamrup_to_delhi_reaches_its_region_state_and_district_only(self, api, session):
        kamrup = (
            await session.execute(select(District).where(District.slug == fx.FIXTURE_DISTRICT_SLUG))
        ).scalar_one()
        ekh = await factories.make_district(session, state_slug="meghalaya", slug="fixture-east-khasi-hills")
        trip = await _planned(api, session, fx.P_ASSAM_KAMRUP, fx.P_DELHI)
        shipment = await session.get(Shipment, uuid.UUID(trip["shipment_id"]))
        assert (shipment.origin_district_id, shipment.geography_source) == (kamrup.id, "POSTGIS_ADMIN_BOUNDARY")

        async def user(role, district=None, state_id=None):
            return await factories.make_user(
                session, role=role,
                state_id=state_id or (district.state_id if district else None),
                district_id=district.id if role is UserRole.DISTRICT_MANAGER else None,
            )

        expected = {
            "north-east manager": (await user(UserRole.NORTH_EAST_MANAGER), True),
            "Assam state manager": (await user(UserRole.STATE_MANAGER, kamrup), True),
            "Kamrup district manager": (await user(UserRole.DISTRICT_MANAGER, kamrup), True),
            "Meghalaya state manager": (await user(UserRole.STATE_MANAGER, ekh), False),
            "East Khasi Hills district manager": (await user(UserRole.DISTRICT_MANAGER, ekh), False),
        }
        for name, (viewer, visible) in expected.items():
            assert await _sees(api, viewer, trip) is visible, name

    async def test_the_north_east_manager_never_reaches_an_india_external_trip(
        self, api, session, monkeypatch
    ):
        """P1R-12: before this clause the regional role saw Delhi -> Mumbai too."""
        monkeypatch.setenv("ALLOW_INDIA_EXTERNAL_TRIPS", "true")
        get_settings.cache_clear()
        external = await _planned(api, session, fx.P_WEST_BENGAL, fx.P_DELHI)
        outbound = await _planned(api, session, fx.P_ASSAM_KAMRUP, fx.P_DELHI)
        ne = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        boss = await factories.make_user(session, role=UserRole.MANAGER)

        assert await _sees(api, boss, external) is True, "the fleet-wide role is unchanged"
        assert await _sees(api, ne, external) is False
        assert await _sees(api, ne, outbound) is True

        headers = await _headers(api, ne)
        shipments = {s["id"] for s in (await api.get("/api/shipments?limit=100", headers=headers)).json()["items"]}
        assert external["shipment_id"] not in shipments
        assert outbound["shipment_id"] in shipments
        for trip in (external, outbound):
            await _set_active(session, trip["id"])
        fleet = {t["trip_code"] for t in (await api.get("/api/fleet/active", headers=headers)).json()["trips"]}
        assert external["trip_code"] not in fleet
        assert outbound["trip_code"] in fleet
        # A mutation on it is the same 404, before any provider is asked
        # (routes.plan checks scope first).
        chain = _Chain((THROUGH, 540_000.0))
        monkeypatch.setattr(route_service, "build_chain", lambda: chain)
        r = await api.post(f"/api/trips/{external['id']}/routes/recalculate", headers=headers)
        assert chain.calls == 0
        assert r.status_code == 404, r.text

    def test_the_single_row_helper_says_the_same(self):
        from app.core.scope import may_see_shipment
        from app.models.identity import User

        ne = User(role=UserRole.NORTH_EAST_MANAGER)
        ids = {"origin_district_id": None, "destination_district_id": None}
        assert may_see_shipment(ne, **ids, trip_scope_type="INDIA_EXTERNAL") is False
        for seen in ("NER_OUTBOUND", "NER_INBOUND", "NER_INTERNAL", "UNKNOWN", None):
            assert may_see_shipment(ne, **ids, trip_scope_type=seen) is True

    async def test_a_trip_nobody_placed_still_reaches_the_region(self, api, session):
        """Its emergencies reach only the regional role (driver_trips), so the
        regional role must be able to open it."""
        driver, truck = await _pair(session)
        orphan = await factories.make_trip(session, driver, truck)
        ne = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        assert await _sees(api, ne, {"id": str(orphan.id), "trip_code": orphan.trip_code}) is True


# --- (c) a domestic route never leaves India ------------------------------

#: India on either side of FIXTURE_NEIGHBOUR, the fixture outline's hole
#: (lon 85..88, lat 14..18). The straight road crosses the neighbour; the
#: detour goes round its north side and stays in India.
WEST = (16.0, 84.0)
EAST = (16.0, 89.0)
THROUGH = [WEST, (16.0, 86.5), EAST]
AROUND = [WEST, (19.0, 84.0), (19.0, 89.0), EAST]


class _Chain:
    """Stands in for RoutingChain: returns the configured lines, counts calls."""

    def __init__(self, *lines: tuple[list[tuple[float, float]], float]) -> None:
        self.lines = lines
        self.calls = 0

    async def route_options(self, origin, destination, *, kind, limit=1, detailed=False):  # noqa: ANN001
        from app.services.routing.base import ChainAttempt, ChainOptions

        self.calls += 1
        return ChainOptions(
            candidates=tuple(
                RouteCandidate(kind=kind, provider="stub", geometry=g, distance_m=m, duration_s=3600.0)
                for g, m in self.lines[:limit]
            ),
            attempts=(ChainAttempt("stub", ok=True),),
        )


async def _trip_across_the_neighbour(session: AsyncSession) -> Trip:
    driver, truck = await _pair(session)
    trip = await factories.make_trip(session, driver, truck)
    for sequence, (lat, lon) in enumerate((WEST, EAST)):
        await session.execute(
            text(
                "UPDATE trip_stops SET location = ST_GeogFromText(:p) "
                "WHERE trip_id = :t AND sequence = :s"
            ),
            {"p": f"SRID=4326;POINT({lon} {lat})", "t": trip.id, "s": sequence},
        )
    await session.commit()
    return trip


async def _routes(session: AsyncSession, trip_id) -> list[tuple]:
    return (
        await session.execute(
            select(TripRoute.id, TripRoute.state, func.ST_AsText(TripRoute.geometry))
            .where(TripRoute.trip_id == trip_id)
        )
    ).all()


@pytest.fixture
async def manager(api: AsyncClient, session: AsyncSession) -> dict:
    return await _headers(api, await factories.make_user(session, role=UserRole.MANAGER))


@pytest.mark.usefixtures("fixture_india")
class TestRouteStaysInIndia:
    async def test_the_crossing_candidate_is_dropped_and_the_domestic_one_kept(
        self, api, session, manager, monkeypatch, caplog
    ):
        chain = _Chain((THROUGH, 540_000.0), (AROUND, 1_190_000.0))
        monkeypatch.setattr(route_service, "build_chain", lambda: chain)
        trip = await _trip_across_the_neighbour(session)

        with caplog.at_level(logging.WARNING, logger="app.services.routes"):
            r = await api.post(f"/api/trips/{trip.id}/routes/recalculate", headers=manager)
        assert r.status_code == 201, r.text
        assert r.json()["route"]["geometry"] == [list(p) for p in AROUND]
        stored = await _routes(session, trip.id)
        assert len(stored) == 1, "the crossing line must not be stored in any state"

        reason = (
            await session.execute(
                select(AuditLog.reason).where(AuditLog.entity_id == stored[0][0])
            )
        ).scalar_one()
        assert "ROUTE_CROSSES_COUNTRY_BOUNDARY" in reason
        logged = [rec.getMessage() for rec in caplog.records if "ROUTE_CROSSES_COUNTRY_BOUNDARY" in rec.getMessage()]
        assert logged and str(trip.id) in logged[0]
        # No PII: no coordinate of the trip reaches the log line.
        assert not any(c in logged[0] for c in ("84.0", "89.0", "16.0", "86.5"))

    async def test_no_candidate_left_is_hold_and_review_and_the_current_road_stands(
        self, api, session, manager, monkeypatch
    ):
        chain = _Chain((THROUGH, 540_000.0))
        monkeypatch.setattr(route_service, "build_chain", lambda: chain)
        trip = await _trip_across_the_neighbour(session)
        current = await factories.make_selected_route(session, trip.id)
        before = await _routes(session, trip.id)

        r = await api.post(f"/api/trips/{trip.id}/routes/recalculate", headers=manager)
        assert r.status_code == 422, r.text
        error = r.json()["error"]
        assert error["code"] == "HOLD_AND_REVIEW"
        assert error["details"] == {"reason": "ROUTE_CROSSES_COUNTRY_BOUNDARY", "candidates_dropped": 1}
        assert await _routes(session, trip.id) == before, "nothing stored, nothing superseded"
        trip_id, current_id = trip.id, current.id
        session.expire_all()
        assert (await session.get(Trip, trip_id)).selected_route_id == current_id

    async def test_a_driver_reroute_that_leaves_india_is_held(self, api, session, monkeypatch):
        """The driver path plans ONE candidate from the reported position."""
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await factories.make_assignment(session, driver, truck, verified=True)
        trip = await factories.make_trip(session, driver, truck, assignment=assignment)
        await factories.make_selected_route(session, trip.id)
        await _set_active(session, trip.id)
        here = (26.1, 92.6)
        dip = [here, (16.0, 86.5), (factories.JORHAT.lat, factories.JORHAT.lon)]
        monkeypatch.setattr(route_service, "build_chain", lambda: _Chain((dip, 190_000.0)))

        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        r = await api.post("/api/driver/me/trip/reroute", headers=headers, json={"lat": here[0], "lon": here[1]})
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == "HOLD_AND_REVIEW"
        assert len(await _routes(session, trip.id)) == 1

    async def test_a_line_on_the_boundary_is_inside_and_one_across_is_not(self, session):
        from app.services import geo_classify

        on_edge = "LINESTRING(85 14.5, 85 17.5)"  # the neighbour's west edge
        across = "LINESTRING(84 16, 86.5 16, 89 16)"
        assert await geo_classify.lines_inside_india(session, [on_edge, across]) == [True, False]


async def test_the_line_check_itself_fails_closed_without_an_outline(session):
    """The backstop behind the pre-check: an outline gone mid-request is 503."""
    from app.core.errors import ServiceUnavailableError
    from app.services import geo_classify

    with pytest.raises(ServiceUnavailableError) as caught:
        await geo_classify.lines_inside_india(session, ["LINESTRING(84 16, 89 16)"])
    assert caught.value.code == "GEOGRAPHY_UNAVAILABLE"


async def test_no_india_outline_is_503_before_any_provider_is_asked(api, session, manager, monkeypatch):
    loaded = (await session.execute(text("SELECT count(*) FROM country_boundaries"))).scalar_one()
    assert loaded == 0, "precondition: no India boundary in the test database"
    chain = _Chain((THROUGH, 540_000.0))
    monkeypatch.setattr(route_service, "build_chain", lambda: chain)
    trip = await _trip_across_the_neighbour(session)
    r = await api.post(f"/api/trips/{trip.id}/routes/recalculate", headers=manager)
    assert r.status_code == 503, r.text
    assert r.json()["error"]["code"] == "GEOGRAPHY_UNAVAILABLE"
    assert chain.calls == 0, "no provider hears about a trip whose route cannot be checked"


# --- (d) intelligence coverage --------------------------------------------

CLEAR = LandslideAssessment(risk=LandslideRisk.LOW, data_status=DataStatus.AVAILABLE)


class TestMissingDataOutsideTheNerIsNeverEligible:
    """Exhaustive over every landslide reading: only NER_DEEP coverage can be
    ELIGIBLE, through the direct decision and through a ranked candidate."""

    @pytest.mark.parametrize("coverage", ["LIMITED_EVIDENCE", "UNKNOWN", None, "NOT_A_VALUE"])
    @pytest.mark.parametrize("status", list(DataStatus))
    @pytest.mark.parametrize("risk", list(LandslideRisk))
    def test_nothing_but_ner_deep_is_eligible(self, risk, status, coverage):
        landslide = LandslideAssessment(risk=risk, data_status=status)
        given = {} if coverage is None else {"coverage": coverage}
        assert evaluate(landslide=landslide, **given).eligibility is not Eligibility.ELIGIBLE
        scored = assess(
            distance_km=100.0, duration_min=120.0, landslide=landslide,
            **({} if coverage is None else {"intelligence_coverage": coverage}),
        )
        ranked = RankedCandidate("r", "PRIMARY", 100.0, 120.0, scored)
        assert ranked.decision.eligibility is not Eligibility.ELIGIBLE
        assert ranked.may_be_recommended_automatically is False

    def test_the_control_ner_deep_and_clear_is_eligible(self):
        assert evaluate(landslide=CLEAR, coverage="NER_DEEP").eligibility is Eligibility.ELIGIBLE

    def test_a_closure_outside_the_ner_is_still_a_closure(self):
        shut = LandslideAssessment(risk=LandslideRisk.CRITICAL, data_status=DataStatus.AVAILABLE)
        assert evaluate(landslide=shut, coverage="LIMITED_EVIDENCE").eligibility is Eligibility.REJECTED

    def test_a_limited_road_is_labelled_and_never_reads_continue(self):
        risk = assess(distance_km=10.0, duration_min=10.0, landslide=CLEAR, intelligence_coverage="LIMITED_EVIDENCE")
        assert risk.intelligence_coverage == "LIMITED_EVIDENCE"
        assert "INDIA_BASE_ROUTING" in risk.reason_codes
        assert risk.band == "LOW"
        assert driver_decision(risk.band, reason_codes=risk.reason_codes) != "CONTINUE"

    def test_a_limited_road_can_still_be_reviewed(self):
        """Refusing it for good would end NER_OUTBOUND logistics the day a real
        hazard source is connected. It is incomplete evidence, which a
        manager may accept for one selection - never a clear road."""
        from app.domain.route_eligibility import within_coverage
        from app.models.enums import RouteReviewBasis
        from app.services import route_review

        decision = evaluate(landslide=CLEAR, coverage="LIMITED_EVIDENCE")
        seen = within_coverage(CLEAR, "LIMITED_EVIDENCE")
        route_review.refuse_unless_authorizable(decision, seen)
        assert route_review.basis_for(seen) is RouteReviewBasis.HAZARD_DATA_UNKNOWN
        assert "INDIA_BASE_ROUTING" in decision.reason_codes


#: Guwahati to Jorhat, inside the FIXTURE Assam rectangle the whole way.
IN_ASSAM = [(26.1445, 91.7362), (26.4, 92.9), (26.7509, 94.2037)]
#: The same ends, bent west through FIXTURE West Bengal (India, not NER).
VIA_WEST_BENGAL = [(26.1445, 91.7362), (26.0, 89.5), (26.7509, 94.2037)]


async def _planned_route(api, session, manager, monkeypatch, line) -> tuple:
    monkeypatch.setattr(route_service, "build_chain", lambda: _Chain((line, 308_000.0)))
    driver, truck = await _pair(session)
    trip = await factories.make_trip(session, driver, truck)
    r = await api.post(f"/api/trips/{trip.id}/routes/recalculate", headers=manager)
    assert r.status_code == 201, r.text
    return trip, r.json()["route"]["id"]


@pytest.mark.usefixtures("clear_hazard_evidence")
class TestCoverageOnTheWire:
    """`clear_hazard_evidence` is a source that answered and found nothing, over
    the synthetic NER state shapes: the ONE route to ELIGIBLE."""

    async def test_a_road_inside_the_ner_polygons_is_ner_deep_and_eligible(self, api, session, manager, monkeypatch):
        trip, route_id = await _planned_route(api, session, manager, monkeypatch, IN_ASSAM)
        risk = (await api.get(f"/api/trips/{trip.id}/routes/{route_id}/risk", headers=manager)).json()
        assert risk["intelligence_coverage"] == "NER_DEEP"
        assert "INDIA_BASE_ROUTING" not in risk["reason_codes"]
        advice = (await api.get(f"/api/trips/{trip.id}/routes/recommendation", headers=manager)).json()
        assert [c["eligibility"] for c in advice["candidates"]] == ["ELIGIBLE"]
        assert [c["risk"]["intelligence_coverage"] for c in advice["candidates"]] == ["NER_DEEP"]
        chosen = await api.post(f"/api/trips/{trip.id}/routes/{route_id}/select", headers=manager)
        assert chosen.status_code == 200, chosen.text

    async def test_a_road_through_west_bengal_is_limited_and_never_eligible(self, api, session, manager, monkeypatch):
        trip, route_id = await _planned_route(api, session, manager, monkeypatch, VIA_WEST_BENGAL)
        risk = (await api.get(f"/api/trips/{trip.id}/routes/{route_id}/risk", headers=manager)).json()
        assert risk["intelligence_coverage"] == "LIMITED_EVIDENCE"
        assert "INDIA_BASE_ROUTING" in risk["reason_codes"]
        advice = (await api.get(f"/api/trips/{trip.id}/routes/recommendation", headers=manager)).json()
        assert [c["eligibility"] for c in advice["candidates"]] == ["REQUIRES_REVIEW"]
        assert advice["recommended_route_id"] is None
        chosen = await api.post(f"/api/trips/{trip.id}/routes/{route_id}/select", headers=manager)
        assert chosen.status_code == 422, chosen.text
        assert chosen.json()["error"]["code"] == "ROUTE_SELECTION_REQUIRES_REVIEW"
        # Reviewable, not a dead end: a manager may accept the limited evidence.
        approved = await api.post(
            f"/api/trips/{trip.id}/routes/{route_id}/approve",
            headers=manager,
            json={
                "rationale": "West Bengal stretch has India base data only; accepted.",
                "acknowledged_incomplete_evidence": True,
            },
        )
        assert approved.status_code == 200, approved.text
        session.expire_all()
        assert (await session.get(TripRoute, uuid.UUID(route_id))).state is RouteState.SELECTED


@pytest.fixture
def clear_source_without_state_shapes(monkeypatch):
    """A source that answered and found nothing, but NO state polygons loaded."""
    from app.domain.landslide import IncidentQueryResult, SourceState
    from app.services import route_risk as risk_service

    class _Clear:
        name = "test-clear-source"

        async def incidents_near(self, box, *, since, until):  # noqa: ANN001
            return IncidentQueryResult(state=SourceState.AVAILABLE, provider=self.name)

    monkeypatch.setattr(risk_service, "build_landslide_provider", lambda: _Clear())


@pytest.mark.usefixtures("fixture_india", "clear_source_without_state_shapes")
async def test_unknown_coverage_is_never_eligible_either(api, session, manager, monkeypatch):
    trip, route_id = await _planned_route(api, session, manager, monkeypatch, IN_ASSAM)
    risk = (await api.get(f"/api/trips/{trip.id}/routes/{route_id}/risk", headers=manager)).json()
    assert risk["intelligence_coverage"] == "UNKNOWN"
    chosen = await api.post(f"/api/trips/{trip.id}/routes/{route_id}/select", headers=manager)
    assert chosen.status_code == 422, chosen.text
    assert chosen.json()["error"]["code"] == "ROUTE_SELECTION_REQUIRES_REVIEW"


def test_every_route_risk_in_the_app_is_built_by_assess():
    """The ELIGIBLE gate lives in `assess` and `evaluate`. A RouteRisk built
    anywhere else could skip the coverage it depends on."""
    from pathlib import Path

    app_dir = Path(__file__).resolve().parents[1] / "app"
    builders = sorted(
        str(p.relative_to(app_dir)).replace("\\", "/")
        for p in app_dir.rglob("*.py")
        if "RouteRisk(" in p.read_text(encoding="utf-8")
    )
    assert builders == ["domain/route_risk.py"]
