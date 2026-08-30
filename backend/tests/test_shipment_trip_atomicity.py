"""Creating a shipment and its trip must be one transaction, or neither.

THE DEFECT THIS FILE EXISTS FOR

The manager UI plans a trip by creating a shipment and then a trip that
references it. As two separately-committed API calls, the second one failing
leaves the first one behind:

    POST /api/shipments   -> 201, committed
    POST /api/trips       -> 422 CAPACITY_EXCEEDED
                             the shipment is now in the database, referenced by
                             nothing and visible on no screen

That failure is not exotic - it is the *advertised* one. The trip form tells the
manager the weight is "checked against the truck's capacity", so the overloaded
case is a normal thing for them to hit, correct, and then retry. Each retry mints
a fresh reference code, so the orphans accumulate one per attempt.

Orphans are worse than untidy here. `total_weight_kg` is derived by a database
trigger from cargo_items, and the capacity gate is measured against it, so an
orphan shipment is a real cargo record that no trip and no audit trail explains.

The fix is a single endpoint that does both inside one transaction. The two
single-resource endpoints stay: a shipment without a trip is a legitimate thing
to create deliberately. What must not happen is creating one *by accident*.
"""

import uuid
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import TripStatus, UserRole
from app.models.operations import Shipment, Trip
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


def _payload(*, driver_id, truck_id, weight: str, reference: str, code: str) -> dict:
    return {
        "shipment": {
            "reference_code": reference,
            "client_name": "Brahmaputra Traders",
            "pickup_address": "Depot, Guwahati",
            "pickup": {"lat": 26.1445, "lon": 91.7362},
            "destination_address": "Yard, Jorhat",
            "destination": {"lat": 26.7509, "lon": 94.2037},
            "cargo_items": [
                {
                    "cargo_type": "GENERAL",
                    "cargo_name": "Consignment",
                    "weight_kg": weight,
                    "quantity": 1,
                }
            ],
        },
        "trip": {
            "trip_code": code,
            "truck_id": str(truck_id),
            "driver_id": str(driver_id),
        },
    }


async def _shipment_exists(session: AsyncSession, reference: str) -> bool:
    return (
        await session.execute(
            select(func.count(Shipment.id)).where(Shipment.reference_code == reference)
        )
    ).scalar_one() > 0


class TestAtomicPlanning:
    async def test_a_refused_trip_leaves_no_shipment_behind(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """The capacity gate must roll the shipment back with the trip.

        This is the whole defect. 9,000 kg of cargo onto a 5,000 kg truck is
        refused - correctly - and the question is what survives the refusal.
        """
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session, capacity=5000)
        reference = f"{factories.TEST_SHIPMENT_PREFIX}{uuid.uuid4().hex[:10].upper()}"

        response = await api.post(
            "/api/trips/plan",
            headers=manager_headers,
            json=_payload(
                driver_id=driver.id,
                truck_id=truck.id,
                weight="9000",
                reference=reference,
                code=f"{factories.TEST_TRIP_PREFIX}{uuid.uuid4().hex[:8].upper()}",
            ),
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "CAPACITY_EXCEEDED"

        # The point of the whole file.
        assert not await _shipment_exists(session, reference), (
            "the refused trip left an orphan shipment in the database"
        )

    async def test_a_retry_after_a_refusal_does_not_duplicate_the_shipment(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """Correcting the weight and resubmitting must leave exactly one shipment.

        The realistic sequence: a manager overloads the truck, is told, fixes the
        number and submits again. Two attempts must not mean two cargo records.
        """
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session, capacity=5000)
        reference = f"{factories.TEST_SHIPMENT_PREFIX}{uuid.uuid4().hex[:10].upper()}"
        code = f"{factories.TEST_TRIP_PREFIX}{uuid.uuid4().hex[:8].upper()}"

        refused = await api.post(
            "/api/trips/plan",
            headers=manager_headers,
            json=_payload(
                driver_id=driver.id, truck_id=truck.id,
                weight="9000", reference=reference, code=code,
            ),
        )
        assert refused.status_code == 422

        accepted = await api.post(
            "/api/trips/plan",
            headers=manager_headers,
            json=_payload(
                driver_id=driver.id, truck_id=truck.id,
                weight="4000", reference=reference, code=code,
            ),
        )
        assert accepted.status_code == 201, accepted.text

        count = (
            await session.execute(
                select(func.count(Shipment.id)).where(
                    Shipment.reference_code == reference
                )
            )
        ).scalar_one()
        assert count == 1, f"expected exactly one shipment, found {count}"

    async def test_a_valid_plan_creates_both(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """The success path still produces a shipment and a DRAFT trip."""
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session, capacity=16000)
        reference = f"{factories.TEST_SHIPMENT_PREFIX}{uuid.uuid4().hex[:10].upper()}"
        code = f"{factories.TEST_TRIP_PREFIX}{uuid.uuid4().hex[:8].upper()}"

        response = await api.post(
            "/api/trips/plan",
            headers=manager_headers,
            json=_payload(
                driver_id=driver.id, truck_id=truck.id,
                weight="9000", reference=reference, code=code,
            ),
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["status"] == TripStatus.DRAFT.value
        assert body["trip_code"] == code

        trip = (
            await session.execute(select(Trip).where(Trip.trip_code == code))
        ).scalar_one()
        shipment = (
            await session.execute(
                select(Shipment).where(Shipment.reference_code == reference)
            )
        ).scalar_one()
        assert trip.shipment_id == shipment.id
        # Derived by the trigger from cargo_items, never accepted from a client.
        assert shipment.total_weight_kg == Decimal("9000.00")

    async def test_an_unknown_truck_leaves_no_shipment_behind(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """Rollback must cover a 404 from the gates too, not only 422."""
        driver, _ = await factories.make_driver(session)
        reference = f"{factories.TEST_SHIPMENT_PREFIX}{uuid.uuid4().hex[:10].upper()}"

        response = await api.post(
            "/api/trips/plan",
            headers=manager_headers,
            json=_payload(
                driver_id=driver.id,
                truck_id=uuid.uuid4(),
                weight="1000",
                reference=reference,
                code=f"{factories.TEST_TRIP_PREFIX}{uuid.uuid4().hex[:8].upper()}",
            ),
        )
        assert response.status_code == 404, response.text
        assert not await _shipment_exists(session, reference)

    async def test_planning_requires_both_permissions(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A driver holds neither shipment:create nor trip:create."""
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        reference = f"{factories.TEST_SHIPMENT_PREFIX}{uuid.uuid4().hex[:10].upper()}"

        response = await api.post(
            "/api/trips/plan",
            headers=headers,
            json=_payload(
                driver_id=driver.id, truck_id=truck.id,
                weight="1000", reference=reference,
                code=f"{factories.TEST_TRIP_PREFIX}{uuid.uuid4().hex[:8].upper()}",
            ),
        )
        assert response.status_code == 403
        assert not await _shipment_exists(session, reference)
