"""A shipment the API accepts must be a shipment the API can return.

The defect: `ShipmentCreate` accepted a one-character address while
`ShipmentRead` required three, so a 201 was followed by a 500 on every read of
that row. Validation belongs on the way IN (a clean 422); the read model
describes what is stored and refuses nothing, including rows written before
any limit existed.
"""
import pytest
from httpx import AsyncClient

from app.models.enums import UserRole
from app.schemas.domain import ShipmentRead
from tests import factories
from tests.conftest import auth_headers

# Planning needs an India boundary (fails closed without one): the synthetic
# outline from tests/geo_fixtures.py, no state shapes.
pytestmark = [pytest.mark.requires_db, pytest.mark.usefixtures("fixture_india")]


def _body(address: str) -> dict:
    return {
        "reference_code": "SHP-" + factories.unique_phone()[-6:],
        "client_name": "Brahmaputra Traders",
        "pickup_address": address,
        "pickup": {"lat": 26.1445, "lon": 91.7362},
        "destination_address": "Shillong Depot",
        "destination": {"lat": 25.5788, "lon": 91.8933},
        "cargo_items": [{"cargo_type": "GENERAL", "cargo_name": "Consignment", "weight_kg": "10", "quantity": 1}],
    }


@pytest.fixture
async def headers(api: AsyncClient, session) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


@pytest.mark.parametrize("address", ["Ri", "  "])
async def test_a_too_short_address_is_refused_at_create(api, headers, address):
    r = await api.post("/api/shipments", headers=headers, json=_body(address))
    assert r.status_code == 422, r.text


@pytest.mark.parametrize("address", ["Tura", "Guwahati, Kamrup Metropolitan, Assam, 781001, India", "গুৱাহাটী ডিপো"])
async def test_what_is_created_can_be_read_back(api, headers, address):
    created = await api.post("/api/shipments", headers=headers, json=_body(address))
    assert created.status_code == 201, created.text
    assert created.json()["pickup_address"] == address
    # Shipments are read through the list; the row must serialise there too.
    listed = await api.get("/api/shipments?limit=100", headers=headers)
    assert listed.status_code == 200, listed.text
    mine = [s for s in listed.json()["items"] if s["id"] == created.json()["id"]]
    assert mine and mine[0]["pickup_address"] == address


def test_the_read_model_describes_stored_rows_without_refusing_them():
    """Rows written before any length rule existed must still serialise."""
    row = {
        "id": "00000000-0000-0000-0000-000000000001", "reference_code": "SHP-OLD1", "client_name": "C",
        "pickup_address": "A", "destination_address": "x" * 600, "total_weight_kg": "1",
        "priority": "NORMAL", "status": "DRAFT", "scheduled_pickup_at": None,
        "expected_delivery_at": None, "created_at": "2026-09-01T00:00:00Z",
    }
    assert ShipmentRead.model_validate(row).pickup_address == "A"
