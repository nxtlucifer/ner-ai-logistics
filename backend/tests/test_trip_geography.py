"""Trip geography: a trip planned in the console reaches the managers it belongs to.

THE DEFECT
Scope (app/core/scope.py) is built from shipment geography, but nothing in the
API ever wrote it. Seeded shipments had districts, so every scope test passed,
while a trip planned through the real console had none and was invisible to
every State and District Manager.

THE RULE
Geography is resolved on the server, once, when the shipment is created. Since
migration 0016 the authority is PostGIS (tests/test_geo_classify.py): inside
India or refused, then the state/district polygons that cover the point. THIS
file covers the labelled fallback used only while no state geometry is loaded:
the stored coordinate is reverse-geocoded and the answer is matched EXACTLY
against the states table, and against districts the product counts as
operational (VERIFIED_OFFICIAL or DEMO). No fuzzy match, no guessed district.
What cannot be resolved stays NULL - unknown, never a neighbour - and the trip
is still created.
"""
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import DistrictSource, UserRole
from app.models.operations import Shipment
from app.services import geocoding, trip_geography
from tests import factories
from tests.conftest import auth_headers
from tests.test_resource_reservation import DROP, PICKUP, _pair, _plan

# Planning needs an India boundary (fails closed without one): the synthetic
# outline from tests/geo_fixtures.py, no state shapes.
pytestmark = [pytest.mark.requires_db, pytest.mark.usefixtures("fixture_india")]


def _reverse(answers: dict):
    """A fake reverse geocoder keyed by rounded coordinate."""

    async def reverse_admin(lat: float, lon: float):
        key = (round(lat, 3), round(lon, 3))
        if key not in answers:
            raise geocoding.GeocodingUnavailable("no answer for this point")
        return answers[key]

    return reverse_admin


class TestResolve:
    @pytest.mark.parametrize("status", [DistrictSource.VERIFIED_OFFICIAL, DistrictSource.DEMO])
    async def test_exact_operational_district(self, session: AsyncSession, monkeypatch, status):
        d = await factories.make_district(session, state_slug="assam")
        async with factories.operational(session, d, status=status):
            monkeypatch.setattr(geocoding, "reverse_admin", _reverse({(26.0, 91.0): ("Assam", [d.name])}))
            place = await trip_geography.resolve(session, 26.0, 91.0)
        assert place.state_id == d.state_id
        assert place.district_id == d.id
        assert place.resolved
        # The fallback may confirm an NER state; it never proves "not NER".
        assert place.is_ner is True

    async def test_unverified_district_gives_state_only(self, session, monkeypatch):
        d = await factories.make_district(session, state_slug="assam")  # TEST provenance
        monkeypatch.setattr(geocoding, "reverse_admin", _reverse({(26.0, 91.0): ("Assam", [d.name])}))
        place = await trip_geography.resolve(session, 26.0, 91.0)
        assert place.state_id == d.state_id
        assert place.district_id is None

    async def test_a_similar_name_is_not_the_district(self, session, monkeypatch):
        d = await factories.make_district(session, state_slug="assam")
        async with factories.operational(session, d, status=DistrictSource.VERIFIED_OFFICIAL):
            # "Kamrup" is not "Kamrup Metropolitan": no prefix, no fuzzy match.
            monkeypatch.setattr(geocoding, "reverse_admin", _reverse({(26.0, 91.0): ("Assam", [d.name.split()[0]])}))
            place = await trip_geography.resolve(session, 26.0, 91.0)
        assert place.district_id is None

    async def test_a_point_outside_the_region_is_unknown(self, session, monkeypatch):
        monkeypatch.setattr(geocoding, "reverse_admin", _reverse({(22.5, 88.3): ("West Bengal", ["Kolkata"])}))
        place = await trip_geography.resolve(session, 22.5, 88.3)
        assert (place.state_id, place.district_id, place.is_ner) == (None, None, None)

    async def test_geocoder_outage_is_unknown_not_a_guess(self, session, monkeypatch):
        monkeypatch.setattr(geocoding, "reverse_admin", _reverse({}))
        place = await trip_geography.resolve(session, 26.0, 91.0)
        assert (place.state_id, place.district_id, place.resolved) == (None, None, False)


@pytest.fixture
async def ne_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


async def _manager(api, session, role, *, state_slug, district=None):
    state = await factories.get_state(session, state_slug)
    user = await factories.make_user(
        session, role=role, state_id=state.id,
        district_id=district.id if district is not None else None,
    )
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


class TestPlannedTripReachesItsManagers:
    async def test_assam_to_meghalaya(self, api: AsyncClient, session: AsyncSession, ne_headers, monkeypatch):
        origin = await factories.make_district(session, state_slug="assam")
        other = await factories.make_district(session, state_slug="assam")
        dest_unverified = await factories.make_district(session, state_slug="meghalaya")
        # The planner's coordinates (tests/test_resource_reservation.py).
        monkeypatch.setattr(geocoding, "reverse_admin", _reverse({
            (round(PICKUP["lat"], 3), round(PICKUP["lon"], 3)): ("Assam", [origin.name]),
            (round(DROP["lat"], 3), round(DROP["lon"], 3)): ("Meghalaya", [dest_unverified.name]),
        }))
        driver, truck = await _pair(session)
        async with factories.operational(session, origin, status=DistrictSource.VERIFIED_OFFICIAL):
            r = await _plan(api, ne_headers, driver, truck, "TRP-GEO-" + factories.unique_phone()[-6:])
            assert r.status_code == 201, r.text
            trip = r.json()

            shipment = (await session.execute(select(Shipment).where(Shipment.id == trip["shipment_id"]))).scalar_one()
            assam = await factories.get_state(session, "assam")
            meghalaya = await factories.get_state(session, "meghalaya")
            assert shipment.origin_state_id == assam.id
            assert shipment.origin_district_id == origin.id
            assert shipment.destination_state_id == meghalaya.id
            assert shipment.destination_district_id is None  # unverified: never guessed
            assert shipment.geography_source == "OSM_NOMINATIM_REVERSE"

            cases = [
                (await _manager(api, session, UserRole.STATE_MANAGER, state_slug="assam"), True),
                (await _manager(api, session, UserRole.STATE_MANAGER, state_slug="meghalaya"), True),
                (await _manager(api, session, UserRole.STATE_MANAGER, state_slug="nagaland"), False),
                (await _manager(api, session, UserRole.DISTRICT_MANAGER, state_slug="assam", district=origin), True),
                (await _manager(api, session, UserRole.DISTRICT_MANAGER, state_slug="assam", district=other), False),
            ]
            for headers, visible in cases:
                listed = trip["trip_code"] in {
                    t["trip_code"] for t in (await api.get("/api/trips?limit=100", headers=headers)).json()["items"]
                }
                direct = (await api.get(f"/api/trips/{trip['id']}", headers=headers)).status_code
                assert listed is visible, (visible, listed)
                assert direct == (200 if visible else 404), (visible, direct)

    async def test_geocoder_down_still_plans_and_scoped_managers_do_not_see_a_guess(
        self, api, session, ne_headers, monkeypatch
    ):
        monkeypatch.setattr(geocoding, "reverse_admin", _reverse({}))
        driver, truck = await _pair(session)
        r = await _plan(api, ne_headers, driver, truck, "TRP-GEO-" + factories.unique_phone()[-6:])
        assert r.status_code == 201, r.text
        shipment = (await session.execute(select(Shipment).where(Shipment.id == r.json()["shipment_id"]))).scalar_one()
        assert (shipment.origin_state_id, shipment.destination_state_id) == (None, None)
        assert shipment.geography_source == "GEOCODER_UNAVAILABLE"
        headers = await _manager(api, session, UserRole.STATE_MANAGER, state_slug="assam")
        assert (await api.get(f"/api/trips/{r.json()['id']}", headers=headers)).status_code == 404

    async def test_a_driver_gets_no_manager_scope(self, api, session, ne_headers, monkeypatch):
        monkeypatch.setattr(geocoding, "reverse_admin", _reverse({}))
        driver, truck = await _pair(session)
        r = await _plan(api, ne_headers, driver, truck, "TRP-GEO-" + factories.unique_phone()[-6:])
        other_driver, user = await factories.make_driver(session)
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        assert (await api.get(f"/api/trips/{r.json()['id']}", headers=headers)).status_code in (403, 404)


class TestStateFollowsDistrict:
    async def test_a_district_written_directly_carries_its_state(self, session: AsyncSession):
        """Seeds and factories write districts without a state; the database
        fills the state in, so no writer can leave the two disagreeing."""
        o = await factories.make_district(session, state_slug="assam")
        d = await factories.make_district(session, state_slug="meghalaya")
        shipment = await factories.make_shipment(session, origin_district_id=o.id, destination_district_id=d.id)
        await session.refresh(shipment)
        assert shipment.origin_state_id == o.state_id
        assert shipment.destination_state_id == d.state_id


def test_reverse_payload_parsing_takes_both_district_spellings():
    """Indian districts are mapped as `state_district` or `county`; both are
    kept and matched exactly downstream. No state means no answer."""
    state, districts = geocoding.parse_reverse_admin(
        {"address": {"state": "Assam", "state_district": "Kamrup Metropolitan", "county": "Guwahati"}}
    )
    assert state == "Assam" and districts == ["Kamrup Metropolitan", "Guwahati"]
    assert geocoding.parse_reverse_admin({"address": {}}) == (None, [])
    assert geocoding.parse_reverse_admin({}) == (None, [])


class TestBadCoordinates:
    @pytest.mark.parametrize("pickup", [{"lat": 999, "lon": 91.7}, {"lat": 26.1}, None])
    async def test_invalid_or_missing_points_are_refused_before_anything_is_resolved(
        self, api, session, ne_headers, pickup, monkeypatch
    ):
        called = []

        async def reverse_admin(lat, lon):
            called.append((lat, lon))
            raise geocoding.GeocodingUnavailable("unused")

        monkeypatch.setattr(geocoding, "reverse_admin", reverse_admin)
        driver, truck = await _pair(session)
        body = {
            "shipment": {
                "reference_code": "SHP-BADPT", "client_name": "C", "pickup_address": "A", "destination_address": "B",
                "destination": DROP,
                "cargo_items": [{"cargo_type": "GENERAL", "cargo_name": "x", "weight_kg": "10", "quantity": 1}],
                **({"pickup": pickup} if pickup is not None else {}),
            },
            "trip": {"trip_code": "TRP-BADPT", "truck_id": str(truck.id), "driver_id": str(driver.id)},
        }
        r = await api.post("/api/trips/plan", headers=ne_headers, json=body)
        assert r.status_code == 422, r.text
        assert called == []
