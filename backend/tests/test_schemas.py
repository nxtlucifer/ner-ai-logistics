"""API contract validation.

The rule under test throughout: a client may never supply a server-managed
field, and a malformed coordinate must be rejected at the edge rather than
stored.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.schemas.common import Coordinate
from app.schemas.domain import (
    CargoItemCreate,
    DriverCreate,
    GpsBatchIn,
    GpsFixIn,
    ShipmentCreate,
    TripCreate,
    TripStopCreate,
    TruckCreate,
    TruckUpdate,
)

GUWAHATI = Coordinate(lat=26.1445, lon=91.7362)
JORHAT = Coordinate(lat=26.7509, lon=94.2037)


class TestCoordinate:
    def test_accepts_a_real_ner_point(self) -> None:
        assert GUWAHATI.is_plausibly_ner

    def test_rejects_inverted_lat_lon(self) -> None:
        """Guwahati inverted gives lat=91.7362, which is not a latitude.

        This is the single most common spatial bug, and the range bound catches
        it for free at the API edge.
        """
        with pytest.raises(ValidationError):
            Coordinate(lat=91.7362, lon=26.1445)

    @pytest.mark.parametrize(
        ("lat", "lon"), [(91.0, 0.0), (-91.0, 0.0), (0.0, 181.0), (0.0, -181.0)]
    )
    def test_rejects_out_of_range(self, lat: float, lon: float) -> None:
        with pytest.raises(ValidationError):
            Coordinate(lat=lat, lon=lon)

    def test_wkt_uses_lon_lat_ordering(self) -> None:
        """PostGIS WKT is POINT(lon lat), the opposite of the JSON payload."""
        assert GUWAHATI.to_wkt() == "POINT(91.7362 26.1445)"

    def test_point_outside_ner_is_flagged_but_valid(self) -> None:
        """Advisory, never blocking - trips may start outside the region."""
        delhi = Coordinate(lat=28.6139, lon=77.2090)
        assert delhi.is_plausibly_ner is False


class TestServerManagedFieldsRejected:
    def test_truck_create_rejects_id(self) -> None:
        with pytest.raises(ValidationError) as exc:
            TruckCreate(
                id=uuid.uuid4(), registration_number="AS01AB1234", max_capacity_kg=16000
            )
        assert "extra" in str(exc.value).lower()

    def test_truck_create_rejects_created_at(self) -> None:
        with pytest.raises(ValidationError):
            TruckCreate(
                registration_number="AS01AB1234",
                max_capacity_kg=16000,
                created_at=datetime.now(UTC),
            )

    def test_truck_update_cannot_set_current_load(self) -> None:
        """current_load_kg is derived; setting it would bypass the capacity gate."""
        with pytest.raises(ValidationError):
            TruckUpdate(current_load_kg=999)

    def test_shipment_create_rejects_total_weight(self) -> None:
        """Weight is computed from cargo_items by the database."""
        with pytest.raises(ValidationError):
            ShipmentCreate(
                reference_code="SHP-1",
                client_name="Assam Tea Co-op",
                pickup_address="Jorhat",
                pickup=JORHAT,
                destination_address="Guwahati",
                destination=GUWAHATI,
                total_weight_kg=13500,
                cargo_items=[
                    CargoItemCreate(
                        cargo_type="TEA", cargo_name="CTC chests", weight_kg=450
                    )
                ],
            )

    def test_trip_create_rejects_status(self) -> None:
        """A trip always starts as DRAFT; choosing a status would skip the gates."""
        with pytest.raises(ValidationError):
            TripCreate(
                trip_code="TRP-1",
                shipment_id=uuid.uuid4(),
                truck_id=uuid.uuid4(),
                driver_id=uuid.uuid4(),
                status="ACTIVE",
            )


class TestValueValidation:
    def test_registration_is_normalised(self) -> None:
        t = TruckCreate(registration_number="as-01-ab-1234", max_capacity_kg=16000)
        assert t.registration_number == "AS01AB1234"

    def test_malformed_registration_rejected(self) -> None:
        with pytest.raises(ValidationError):
            TruckCreate(registration_number="NOT A PLATE!", max_capacity_kg=16000)

    def test_capacity_must_be_positive(self) -> None:
        with pytest.raises(ValidationError):
            TruckCreate(registration_number="AS01AB1234", max_capacity_kg=0)

    def test_licence_number_normalised(self) -> None:
        d = DriverCreate(
            full_name="Bipul Das",
            initial_password="an-initial-password",
            phone="9435012345",
            licence_number="as 01 2020 1234567",
            licence_expiry="2030-01-01",
        )
        assert d.licence_number == "AS0120201234567"

    def test_bad_phone_rejected(self) -> None:
        with pytest.raises(ValidationError):
            DriverCreate(
                full_name="Bipul Das",
                initial_password="an-initial-password",
                phone="not-a-phone",
                licence_number="AS0120201234567",
                licence_expiry="2030-01-01",
            )

    def test_cargo_weight_must_be_positive(self) -> None:
        with pytest.raises(ValidationError):
            CargoItemCreate(cargo_type="TEA", cargo_name="chests", weight_kg=0)


class TestShipmentInvariants:
    def _shipment(self, **overrides: object) -> ShipmentCreate:
        payload: dict = {
            "reference_code": "SHP-0001",
            "client_name": "Assam Tea Co-op",
            "pickup_address": "Jorhat Warehouse",
            "pickup": JORHAT,
            "destination_address": "Guwahati Hub",
            "destination": GUWAHATI,
            "cargo_items": [
                CargoItemCreate(
                    cargo_type="TEA", cargo_name="CTC chests", weight_kg=450, quantity=30
                )
            ],
        }
        payload.update(overrides)
        return ShipmentCreate(**payload)

    def test_valid_shipment_accepted(self) -> None:
        assert self._shipment().cargo_items[0].quantity == 30

    def test_requires_at_least_one_cargo_item(self) -> None:
        with pytest.raises(ValidationError):
            self._shipment(cargo_items=[])

    def test_pickup_and_destination_must_differ(self) -> None:
        with pytest.raises(ValidationError) as exc:
            self._shipment(pickup=GUWAHATI, destination=GUWAHATI)
        assert "different locations" in str(exc.value)

    def test_delivery_cannot_precede_pickup(self) -> None:
        now = datetime.now(UTC)
        with pytest.raises(ValidationError):
            self._shipment(
                scheduled_pickup_at=now, expected_delivery_at=now - timedelta(hours=2)
            )


class TestTripStops:
    def test_duplicate_stop_sequences_rejected(self) -> None:
        stop = TripStopCreate(sequence=1, kind="PICKUP", location=JORHAT)
        with pytest.raises(ValidationError) as exc:
            TripCreate(
                trip_code="TRP-1",
                shipment_id=uuid.uuid4(),
                truck_id=uuid.uuid4(),
                driver_id=uuid.uuid4(),
                stops=[stop, TripStopCreate(sequence=1, kind="DROPOFF", location=GUWAHATI)],
            )
        assert "unique" in str(exc.value)

    def test_geofence_radius_bounded(self) -> None:
        with pytest.raises(ValidationError):
            TripStopCreate(
                sequence=0, kind="REST", location=GUWAHATI, geofence_radius_m=1
            )


class TestGpsBatch:
    def _fix(self, **overrides: object) -> GpsFixIn:
        payload: dict = {
            "device_fix_id": uuid.uuid4(),
            "location": GUWAHATI,
            "recorded_at": datetime.now(UTC),
        }
        payload.update(overrides)
        return GpsFixIn(**payload)

    def test_valid_batch(self) -> None:
        batch = GpsBatchIn(trip_id=uuid.uuid4(), fixes=[self._fix(), self._fix()])
        assert len(batch.fixes) == 2

    def test_duplicate_fix_ids_rejected_in_one_batch(self) -> None:
        fix_id = uuid.uuid4()
        with pytest.raises(ValidationError) as exc:
            GpsBatchIn(
                trip_id=uuid.uuid4(),
                fixes=[self._fix(device_fix_id=fix_id), self._fix(device_fix_id=fix_id)],
            )
        assert "unique" in str(exc.value)

    def test_empty_batch_rejected(self) -> None:
        with pytest.raises(ValidationError):
            GpsBatchIn(trip_id=uuid.uuid4(), fixes=[])

    def test_batch_size_capped(self) -> None:
        with pytest.raises(ValidationError):
            GpsBatchIn(trip_id=uuid.uuid4(), fixes=[self._fix() for _ in range(501)])

    def test_impossible_heading_rejected(self) -> None:
        with pytest.raises(ValidationError):
            self._fix(heading_deg=360)

    def test_negative_speed_rejected(self) -> None:
        with pytest.raises(ValidationError):
            self._fix(speed_kmph=-1)

    def test_mock_location_is_accepted_and_preserved(self) -> None:
        """Spoofing is recorded, never auto-rejected. See docs/SECURITY.md."""
        assert self._fix(is_mock_location=True).is_mock_location is True
