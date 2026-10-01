"""PostGIS is the geography authority: country, state, district, North-East.

OWNER DECISIONS (29 Sep 2026) THESE DEFEND

  * Logistics is India-wide and NER-centred. A trip is not refused for leaving
    the North-East; an endpoint must be inside INDIA, decided by ST_Covers on
    the India polygon. Outside -> 422 OUTSIDE_SUPPORTED_COUNTRY.
  * No India boundary loaded -> 503 GEOGRAPHY_UNAVAILABLE. Never accept blindly.
  * No outward tolerance ever extends India. A GPS accuracy radius that reaches
    the boundary only DETECTS uncertainty: BORDER_AMBIGUOUS.
  * Trip scope type comes from the endpoints. INDIA_EXTERNAL (neither end in
    the NER) is refused with 422 NOT_NER_CONNECTED unless
    ALLOW_INDIA_EXTERNAL_TRIPS is on (default off). Unknown is not INDIA_EXTERNAL.
  * A non-NER state row (imported with the all-India boundaries) never widens
    any manager's scope.

Everything except TestRealCities runs on SYNTHETIC rectangles
(tests/geo_fixtures.py). TestRealCities waits for the Survey of India import.
"""

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import BusinessRuleError, ServiceUnavailableError
from app.models.enums import UserRole
from app.models.geography import District, State
from app.models.operations import Shipment
from app.schemas.common import Coordinate
from app.services import geo_classify
from app.services.geo_classify import TripScope, classify_point, trip_scope_type
from tests import factories
from tests import geo_fixtures as fx
from tests.conftest import auth_headers
from tests.test_resource_reservation import _pair

pytestmark = pytest.mark.requires_db


async def _classify(session: AsyncSession, p: Coordinate, accuracy_m: float | None = None):
    return await classify_point(session, p.lat, p.lon, accuracy_m=accuracy_m)


async def _state_id(session: AsyncSession, slug: str):
    return (await session.execute(select(State.id).where(State.slug == slug))).scalar_one()


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


def _plan(api, headers, driver, truck, pickup: Coordinate, destination: Coordinate):
    code = "TRP-GEO-" + factories.unique_phone()[-6:]
    return api.post(
        "/api/trips/plan",
        headers=headers,
        json={
            "shipment": {
                "reference_code": f"SHP-{code[-6:]}",
                "client_name": "Fixture Traders",
                "pickup_address": "Fixture pickup",
                "pickup": pickup.model_dump(),
                "destination_address": "Fixture drop",
                "destination": destination.model_dump(),
                "cargo_items": [
                    {"cargo_type": "GENERAL", "cargo_name": "Consignment", "weight_kg": "100", "quantity": 1}
                ],
            },
            "trip": {"trip_code": code, "truck_id": str(truck.id), "driver_id": str(driver.id)},
        },
    )


async def _shipment_count(session: AsyncSession) -> int:
    return (await session.execute(select(func.count()).select_from(Shipment))).scalar_one()


class TestFailsClosed:
    async def test_no_india_boundary_is_geography_unavailable(self, session: AsyncSession):
        loaded = (await session.execute(text("SELECT count(*) FROM country_boundaries"))).scalar_one()
        assert loaded == 0, "precondition: no India boundary in the test database"
        with pytest.raises(ServiceUnavailableError) as caught:
            await _classify(session, fx.P_ASSAM)
        assert caught.value.code == "GEOGRAPHY_UNAVAILABLE"
        assert caught.value.status_code == 503

    async def test_planning_without_a_boundary_is_503_and_stores_nothing(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        driver, truck = await _pair(session)
        before = await _shipment_count(session)
        r = await _plan(api, manager_headers, driver, truck, fx.P_ASSAM, fx.P_MEGHALAYA)
        assert r.status_code == 503, r.text
        assert r.json()["error"]["code"] == "GEOGRAPHY_UNAVAILABLE"
        assert await _shipment_count(session) == before


@pytest.mark.usefixtures("fixture_india")
class TestCountry:
    async def test_a_point_inside_india(self, session):
        geo = await _classify(session, fx.P_ASSAM)
        assert (geo.country_code, geo.in_india, geo.border_ambiguous) == ("IN", True, False)
        # No state geometry is loaded: the state is not known from PostGIS.
        assert geo.admin_geometry_loaded is False
        assert (geo.state_id, geo.district_id, geo.is_ner) == (None, None, None)
        assert geo.intelligence_coverage == "UNKNOWN"

    @pytest.mark.parametrize("point", [fx.P_NEIGHBOUR, fx.P_OUTSIDE], ids=["neighbour-hole", "outside-outer-ring"])
    async def test_a_point_outside_india(self, session, point):
        geo = await _classify(session, point)
        assert (geo.country_code, geo.in_india, geo.state_id, geo.is_ner) == (None, False, None, None)
        assert geo.intelligence_coverage == "NONE"

    @pytest.mark.parametrize("point", [fx.P_ON_INDIA_EDGE, fx.P_ON_HOLE_EDGE], ids=["outer-edge", "hole-edge"])
    async def test_a_point_exactly_on_the_boundary_is_covered(self, session, point):
        assert (await _classify(session, point)).in_india is True

    async def test_accuracy_only_detects_uncertainty(self, session):
        """~107 m inside India from the neighbour's edge."""
        assert (await _classify(session, fx.P_NEAR_HOLE)).border_ambiguous is False
        tight = await _classify(session, fx.P_NEAR_HOLE, accuracy_m=50)
        assert (tight.in_india, tight.border_ambiguous) == (True, False)
        loose = await _classify(session, fx.P_NEAR_HOLE, accuracy_m=500)
        assert loose.border_ambiguous is True
        # Never auto-accepted as India, never declared foreign either.
        assert (loose.in_india, loose.country_code) == (None, None)
        assert loose.intelligence_coverage == "UNKNOWN"

    async def test_no_tolerance_moves_a_foreign_point_into_india(self, session):
        geo = await _classify(session, fx.P_NEIGHBOUR, accuracy_m=1)
        assert (geo.in_india, geo.border_ambiguous) == (False, False)

    async def test_the_gate_refuses_outside_and_ambiguous(self, session):
        with pytest.raises(BusinessRuleError) as outside:
            geo_classify.require_in_india(await _classify(session, fx.P_NEIGHBOUR), "pickup")
        assert outside.value.code == "OUTSIDE_SUPPORTED_COUNTRY"
        assert outside.value.status_code == 422
        assert outside.value.message == "This location is outside the currently supported country."
        assert outside.value.details == {"field": "pickup"}
        with pytest.raises(BusinessRuleError) as ambiguous:
            geo_classify.require_in_india(
                await _classify(session, fx.P_NEAR_HOLE, accuracy_m=500), "location"
            )
        assert ambiguous.value.code == "BORDER_AMBIGUOUS"
        geo_classify.require_in_india(await _classify(session, fx.P_ASSAM), "pickup")


@pytest.mark.usefixtures("fixture_geography")
class TestAdministrative:
    async def test_state_and_district(self, session):
        geo = await _classify(session, fx.P_ASSAM_KAMRUP)
        district = (
            await session.execute(select(District.id).where(District.slug == fx.FIXTURE_DISTRICT_SLUG))
        ).scalar_one()
        assert geo.admin_geometry_loaded is True
        assert geo.state_id == await _state_id(session, "assam")
        assert geo.district_id == district
        assert (geo.is_ner, geo.intelligence_coverage) == (True, "NER_DEEP")

    async def test_ner_state_without_a_district_shape(self, session):
        geo = await _classify(session, fx.P_ASSAM)
        assert (geo.state_id, geo.district_id) == (await _state_id(session, "assam"), None)
        assert (await _classify(session, fx.P_MEGHALAYA)).state_id == await _state_id(session, "meghalaya")

    async def test_india_outside_the_ner(self, session):
        geo = await _classify(session, fx.P_WEST_BENGAL)
        assert geo.state_id == await _state_id(session, "fixture-west-bengal")
        assert (geo.in_india, geo.is_ner, geo.intelligence_coverage) == (True, False, "INDIA_BASELINE")

    async def test_india_with_no_state_shape_is_unknown_not_false(self, session):
        geo = await _classify(session, fx.P_INDIA_NO_STATE)
        assert (geo.in_india, geo.state_id, geo.is_ner) == (True, None, None)
        assert geo.intelligence_coverage == "UNKNOWN"

    async def test_foreign_point_has_no_state(self, session):
        geo = await _classify(session, fx.P_NEIGHBOUR)
        assert (geo.in_india, geo.state_id, geo.district_id) == (False, None, None)

    async def test_a_shared_state_edge_is_attributed_deterministically(self, session):
        geo = await _classify(session, fx.P_STATE_EDGE)
        assert geo.state_id == await _state_id(session, "assam")
        assert geo.is_ner is True

    async def test_a_test_provenance_district_is_never_used(self, session):
        await session.execute(
            text("UPDATE districts SET source_status = 'TEST' WHERE slug = :s"),
            {"s": fx.FIXTURE_DISTRICT_SLUG},
        )
        await session.commit()
        geo = await _classify(session, fx.P_ASSAM_KAMRUP)
        assert geo.state_id == await _state_id(session, "assam")
        assert geo.district_id is None


class TestTripScopeType:
    @pytest.mark.parametrize(
        "origin,destination,expected",
        [
            (True, True, TripScope.NER_INTERNAL),
            (True, False, TripScope.NER_OUTBOUND),
            (False, True, TripScope.NER_INBOUND),
            (False, False, TripScope.INDIA_EXTERNAL),
            (True, None, None),
            (None, False, None),
            (None, None, None),
        ],
    )
    def test_matrix(self, origin, destination, expected):
        assert trip_scope_type(origin, destination) == expected

    def test_india_external_is_refused_by_default_and_unknown_is_not(self, monkeypatch):
        with pytest.raises(BusinessRuleError) as caught:
            geo_classify.require_ner_connected(False, False)
        assert caught.value.code == "NOT_NER_CONNECTED"
        assert caught.value.status_code == 422
        assert geo_classify.require_ner_connected(None, None) is None
        assert geo_classify.require_ner_connected(True, False) is TripScope.NER_OUTBOUND
        monkeypatch.setenv("ALLOW_INDIA_EXTERNAL_TRIPS", "true")
        get_settings.cache_clear()
        assert geo_classify.require_ner_connected(False, False) is TripScope.INDIA_EXTERNAL


def test_the_border_policy_distances_are_unset_by_default(monkeypatch):
    for name in ("ALLOW_INDIA_EXTERNAL_TRIPS", "BORDER_ADVISORY_DISTANCE_M", "BORDER_HIGH_ATTENTION_DISTANCE_M"):
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    settings = get_settings()
    assert settings.ALLOW_INDIA_EXTERNAL_TRIPS is False
    assert settings.BORDER_ADVISORY_DISTANCE_M is None
    assert settings.BORDER_HIGH_ATTENTION_DISTANCE_M is None


@pytest.mark.usefixtures("fixture_geography")
class TestPlanning:
    async def test_ner_outbound_is_planned_with_postgis_geography(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        driver, truck = await _pair(session)
        r = await _plan(api, manager_headers, driver, truck, fx.P_ASSAM_KAMRUP, fx.P_WEST_BENGAL)
        assert r.status_code == 201, r.text
        shipment = (
            await session.execute(select(Shipment).where(Shipment.id == r.json()["shipment_id"]))
        ).scalar_one()
        district = (
            await session.execute(select(District.id).where(District.slug == fx.FIXTURE_DISTRICT_SLUG))
        ).scalar_one()
        assert shipment.origin_state_id == await _state_id(session, "assam")
        assert shipment.origin_district_id == district
        assert shipment.destination_state_id == await _state_id(session, "fixture-west-bengal")
        assert shipment.destination_district_id is None
        assert shipment.geography_source == "POSTGIS_ADMIN_BOUNDARY"

    async def test_with_state_shapes_loaded_osm_is_not_consulted(
        self, api, session, manager_headers, monkeypatch
    ):
        from app.services import geocoding

        calls = []

        async def reverse_admin(lat, lon):
            calls.append((lat, lon))
            return ("Assam", [])

        monkeypatch.setattr(geocoding, "reverse_admin", reverse_admin)
        driver, truck = await _pair(session)
        r = await _plan(api, manager_headers, driver, truck, fx.P_WEST_BENGAL, fx.P_ASSAM)
        assert r.status_code == 201, r.text
        assert calls == []

    async def test_ner_inbound_is_planned(self, api, session, manager_headers):
        driver, truck = await _pair(session)
        r = await _plan(api, manager_headers, driver, truck, fx.P_DELHI, fx.P_ASSAM)
        assert r.status_code == 201, r.text

    async def test_unknown_membership_is_not_refused(self, api, session, manager_headers):
        driver, truck = await _pair(session)
        r = await _plan(api, manager_headers, driver, truck, fx.P_INDIA_NO_STATE, fx.P_WEST_BENGAL)
        assert r.status_code == 201, r.text

    async def test_india_external_is_refused_and_stores_nothing(self, api, session, manager_headers):
        driver, truck = await _pair(session)
        before = await _shipment_count(session)
        r = await _plan(api, manager_headers, driver, truck, fx.P_WEST_BENGAL, fx.P_DELHI)
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == "NOT_NER_CONNECTED"
        assert await _shipment_count(session) == before

    async def test_india_external_behind_the_flag(self, api, session, manager_headers, monkeypatch):
        monkeypatch.setenv("ALLOW_INDIA_EXTERNAL_TRIPS", "true")
        get_settings.cache_clear()
        driver, truck = await _pair(session)
        r = await _plan(api, manager_headers, driver, truck, fx.P_WEST_BENGAL, fx.P_DELHI)
        assert r.status_code == 201, r.text

    @pytest.mark.parametrize("field", ["pickup", "destination"])
    async def test_a_foreign_endpoint_is_refused_and_stores_nothing(self, api, session, manager_headers, field):
        driver, truck = await _pair(session)
        before = await _shipment_count(session)
        ends = (fx.P_NEIGHBOUR, fx.P_ASSAM) if field == "pickup" else (fx.P_ASSAM, fx.P_NEIGHBOUR)
        r = await _plan(api, manager_headers, driver, truck, *ends)
        assert r.status_code == 422, r.text
        error = r.json()["error"]
        assert error["code"] == "OUTSIDE_SUPPORTED_COUNTRY"
        assert error["message"] == "This location is outside the currently supported country."
        assert error["details"] == {"field": field}
        assert await _shipment_count(session) == before


@pytest.mark.usefixtures("fixture_india")
async def test_a_stop_in_india_outside_the_old_box_is_accepted(api, session, manager_headers):
    """lon 87.5 was refused by the retired 88..97.5 box; it is India."""
    from tests.test_midtrip_stops_and_history import _add, _trip

    trip, _, _ = await _trip(session)
    r = await _add(api, trip.id, manager_headers, location=fx.P_WEST_BENGAL.model_dump())
    assert r.status_code == 201, r.text


@pytest.mark.usefixtures("fixture_geography")
class TestNonNerStatesNeverWidenScope:
    """Importing every Indian state for classification grants nobody anything."""

    async def test_state_lists_are_the_ner_states(self, api, session, manager_headers):
        from app.api.org import reset_regions_cache

        ner = {"arunachal-pradesh", "assam", "manipur", "meghalaya", "mizoram", "nagaland", "sikkim", "tripura"}
        states = (await api.get("/api/org/states", headers=manager_headers)).json()
        assert {s["slug"] for s in states} == ner
        reset_regions_cache()
        regions = (await api.get("/api/org/regions")).json()
        assert {r["slug"] for r in regions} == ner

    async def test_the_regional_dashboard_lists_only_ner_states(self, api, session):
        me = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        headers = await auth_headers(api, me.email, factories.TEST_PASSWORD)
        body = (await api.get("/api/dashboard", headers=headers)).json()
        assert len(body["states"]) == 8
        assert "FIXTURE West Bengal" not in {s["name"] for s in body["states"]}

    @pytest.mark.parametrize("role", [UserRole.NORTH_EAST_MANAGER, UserRole.ADMIN])
    async def test_nobody_appoints_a_manager_for_a_non_ner_state(self, api, session, role):
        me = await factories.make_user(session, role=role)
        headers = await auth_headers(api, me.email, factories.TEST_PASSWORD)
        r = await api.post(
            "/api/org/managers",
            headers=headers,
            json={
                "email": factories.unique_email("sm-wb"),
                "display_name": "Not A Region",
                "role": "STATE_MANAGER",
                "state_id": str(await _state_id(session, "fixture-west-bengal")),
            },
        )
        assert r.status_code == 403, r.text

    def test_may_manage_user_requires_an_ner_state(self):
        from app.core.scope import may_manage_user
        from app.models.identity import User

        for role in (UserRole.NORTH_EAST_MANAGER, UserRole.ADMIN):
            actor = User(role=role)
            assert may_manage_user(
                actor, role=UserRole.STATE_MANAGER, state_id=None, district_id=None, state_is_ner=True
            )
            assert not may_manage_user(
                actor, role=UserRole.STATE_MANAGER, state_id=None, district_id=None, state_is_ner=False
            )


# --- Real cities: written now, run once the Survey of India import exists ---

#: (lat, lon, in_india, is_ner). Siliguri is West Bengal - never NER.
REAL = {
    "Guwahati": (26.1445, 91.7362, True, True),
    "Shillong": (25.5788, 91.8933, True, True),
    "Aizawl": (23.7271, 92.7176, True, True),
    "Itanagar": (27.0844, 93.6053, True, True),
    "Kolkata": (22.5726, 88.3639, True, False),
    "Siliguri": (26.7271, 88.3953, True, False),
    "Delhi": (28.6139, 77.2090, True, False),
    "Mumbai": (19.0760, 72.8777, True, False),
    "Bengaluru": (12.9716, 77.5946, True, False),
    "Ahmedabad": (23.0225, 72.5714, True, False),
    "Dhaka": (23.8103, 90.4125, False, None),
}

MATRIX = [
    ("Guwahati", "Shillong", TripScope.NER_INTERNAL),
    ("Guwahati", "Kolkata", TripScope.NER_OUTBOUND),
    ("Guwahati", "Delhi", TripScope.NER_OUTBOUND),
    ("Guwahati", "Mumbai", TripScope.NER_OUTBOUND),
    ("Guwahati", "Bengaluru", TripScope.NER_OUTBOUND),
    ("Guwahati", "Ahmedabad", TripScope.NER_OUTBOUND),
    ("Delhi", "Guwahati", TripScope.NER_INBOUND),
    ("Shillong", "Siliguri", TripScope.NER_OUTBOUND),
    ("Siliguri", "Shillong", TripScope.NER_INBOUND),
    ("Dhaka", "Guwahati", "OUTSIDE_SUPPORTED_COUNTRY"),
    ("Guwahati", "Dhaka", "OUTSIDE_SUPPORTED_COUNTRY"),
]


@pytest.fixture
async def soi_imported(session: AsyncSession) -> None:
    from scripts import import_soi_boundaries

    loaded = (
        await session.execute(
            text("SELECT 1 FROM country_boundaries WHERE code = 'IN' AND geometry_source = :s"),
            {"s": import_soi_boundaries.SOURCE},
        )
    ).first()
    if loaded is None:
        pytest.skip("SoI geometry not imported")


@pytest.mark.usefixtures("soi_imported")
class TestRealCities:
    @pytest.mark.parametrize("city", sorted(REAL))
    async def test_city(self, session, city):
        lat, lon, in_india, is_ner = REAL[city]
        geo = await classify_point(session, lat, lon)
        assert (geo.in_india, geo.is_ner) == (in_india, is_ner)

    @pytest.mark.parametrize("origin,destination,expected", MATRIX)
    async def test_trip(self, session, origin, destination, expected):
        o = await classify_point(session, *REAL[origin][:2])
        d = await classify_point(session, *REAL[destination][:2])
        if expected == "OUTSIDE_SUPPORTED_COUNTRY":
            with pytest.raises(BusinessRuleError) as caught:
                geo_classify.require_in_india(o, "pickup")
                geo_classify.require_in_india(d, "destination")
            assert caught.value.code == expected
        else:
            assert trip_scope_type(o.is_ner, d.is_ner) is expected
