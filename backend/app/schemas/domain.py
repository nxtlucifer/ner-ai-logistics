"""P2 domain API contracts.

Only the schemas the P2 foundation needs. Endpoint-specific request/response
models arrive with their endpoints in P3 - writing them now would be contracts
with nothing on the other end.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from pydantic import Field, field_validator, model_validator

from app.models.enums import (
    AssignmentStatus,
    CargoPriority,
    DriverStatus,
    ShipmentStatus,
    TripStatus,
    TripStopKind,
    TripStopStatus,
    TruckStatus,
)
from app.schemas.common import APIModel, Coordinate, ReadModel

# Indian commercial vehicle registrations, e.g. AS01AB1234 / AS-01-AB-1234.
REGISTRATION_PATTERN = r"^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{1,3}[ -]?\d{1,4}$"
PHONE_PATTERN = r"^\+?[0-9]{10,15}$"


# --- Driver ---------------------------------------------------------------


class DriverCreate(APIModel):
    user_id: uuid.UUID
    full_name: Annotated[str, Field(min_length=2, max_length=120)]
    phone: Annotated[str, Field(pattern=PHONE_PATTERN)]
    licence_number: Annotated[str, Field(min_length=4, max_length=40)]
    licence_expiry: date
    licence_class: str | None = Field(default=None, max_length=20)
    emergency_contact_name: str | None = Field(default=None, max_length=120)
    emergency_contact_phone: str | None = Field(default=None, pattern=PHONE_PATTERN)
    date_of_joining: date | None = None
    base_salary_monthly: Annotated[Decimal, Field(ge=0)] | None = None

    # mode="before": normalisation must run BEFORE the length/pattern
    # constraints, otherwise a validly-formatted lowercase value is rejected
    # before the normaliser ever sees it.
    @field_validator("licence_number", mode="before")
    @classmethod
    def _normalise_licence(cls, v: object) -> object:
        return v.upper().replace(" ", "").replace("-", "") if isinstance(v, str) else v


class DriverUpdate(APIModel):
    """All fields optional. `status` is managed by the trip lifecycle, not here."""

    full_name: Annotated[str, Field(min_length=2, max_length=120)] | None = None
    phone: Annotated[str, Field(pattern=PHONE_PATTERN)] | None = None
    licence_number: Annotated[str, Field(min_length=4, max_length=40)] | None = None
    licence_expiry: date | None = None
    licence_class: str | None = Field(default=None, max_length=20)
    emergency_contact_name: str | None = Field(default=None, max_length=120)
    emergency_contact_phone: str | None = Field(default=None, pattern=PHONE_PATTERN)
    photo_url: str | None = None


class DriverRead(ReadModel):
    id: uuid.UUID
    user_id: uuid.UUID
    full_name: str
    phone: str
    photo_url: str | None
    licence_number: str
    licence_expiry: date
    status: DriverStatus
    created_at: datetime
    # base_salary_monthly is deliberately absent: salary is admin-only and is
    # exposed by a separate payroll contract, not by the general driver read.


# --- Truck ----------------------------------------------------------------


class TruckCreate(APIModel):
    registration_number: Annotated[str, Field(pattern=REGISTRATION_PATTERN)]
    max_capacity_kg: Annotated[Decimal, Field(gt=0, le=Decimal("100000"))]
    truck_type: str | None = Field(default=None, max_length=40)
    make: str | None = Field(default=None, max_length=60)
    model: str | None = Field(default=None, max_length=60)
    manufacture_year: Annotated[int, Field(ge=1950, le=2100)] | None = None
    axle_count: Annotated[int, Field(ge=2, le=12)] | None = None
    height_m: Annotated[Decimal, Field(gt=0, le=Decimal("6"))] | None = None
    length_m: Annotated[Decimal, Field(gt=0, le=Decimal("30"))] | None = None
    fuel_tank_capacity_l: Annotated[Decimal, Field(gt=0)] | None = None
    baseline_mileage_kmpl: Annotated[Decimal, Field(gt=0, le=Decimal("30"))] | None = None

    # mode="before" for the same reason as licence_number: REGISTRATION_PATTERN
    # requires uppercase, so "as-01-ab-1234" must be normalised first or it
    # fails the pattern and the normaliser never runs.
    @field_validator("registration_number", mode="before")
    @classmethod
    def _normalise_registration(cls, v: object) -> object:
        return v.upper().replace(" ", "").replace("-", "") if isinstance(v, str) else v


class TruckUpdate(APIModel):
    """`current_load_kg` is absent by design.

    Load is a consequence of what is on the truck, derived from the shipment
    when a trip is created. Letting a client set it directly would let them
    walk around the capacity check.
    """

    truck_type: str | None = Field(default=None, max_length=40)
    make: str | None = Field(default=None, max_length=60)
    model: str | None = Field(default=None, max_length=60)
    max_capacity_kg: Annotated[Decimal, Field(gt=0, le=Decimal("100000"))] | None = None
    baseline_mileage_kmpl: Annotated[Decimal, Field(gt=0, le=Decimal("30"))] | None = None
    odometer_km: Annotated[Decimal, Field(ge=0)] | None = None
    status: TruckStatus | None = None
    photo_url: str | None = None


class TruckRead(ReadModel):
    id: uuid.UUID
    registration_number: str
    truck_type: str | None
    make: str | None
    model: str | None
    max_capacity_kg: Decimal
    current_load_kg: Decimal
    status: TruckStatus
    baseline_mileage_kmpl: Decimal | None
    created_at: datetime

    @property
    def available_capacity_kg(self) -> Decimal:
        return self.max_capacity_kg - self.current_load_kg


# --- Assignment -----------------------------------------------------------


class AssignmentCreate(APIModel):
    driver_id: uuid.UUID
    truck_id: uuid.UUID


class AssignmentVerify(APIModel):
    """Driver-submitted verification of the physical truck.

    A registration mismatch flags for manager review; it never blocks the
    driver. See docs/API_CONTRACTS.md section 5.
    """

    reported_registration: Annotated[str, Field(max_length=20)] | None = None
    reported_odometer_km: Annotated[Decimal, Field(ge=0)] | None = None
    reported_fuel_level_pct: Annotated[int, Field(ge=0, le=100)] | None = None
    reported_damage_notes: str | None = None


class AssignmentRead(ReadModel):
    id: uuid.UUID
    driver_id: uuid.UUID
    truck_id: uuid.UUID
    status: AssignmentStatus
    assigned_at: datetime
    verified_at: datetime | None
    mismatch_flagged: bool
    ended_at: datetime | None


# --- Shipment -------------------------------------------------------------


class CargoItemCreate(APIModel):
    cargo_type: Annotated[str, Field(min_length=1, max_length=60)]
    cargo_name: Annotated[str, Field(min_length=1, max_length=160)]
    weight_kg: Annotated[Decimal, Field(gt=0)]
    quantity: Annotated[int, Field(gt=0, le=100000)] = 1
    is_hazardous: bool = False
    is_perishable: bool = False
    handling_notes: str | None = None


class CargoItemRead(ReadModel):
    id: uuid.UUID
    cargo_type: str
    cargo_name: str
    weight_kg: Decimal
    quantity: int
    is_hazardous: bool
    is_perishable: bool


class ShipmentCreate(APIModel):
    """`total_weight_kg` is absent by design.

    It is computed by the database from cargo_items. Accepting it from a client
    would let the declared weight disagree with the actual cargo, and the
    capacity check is made against exactly this number.
    """

    reference_code: Annotated[str, Field(min_length=3, max_length=32)]
    client_name: Annotated[str, Field(min_length=1, max_length=160)]
    client_contact: str | None = Field(default=None, max_length=60)
    pickup_address: Annotated[str, Field(min_length=1)]
    pickup: Coordinate
    destination_address: Annotated[str, Field(min_length=1)]
    destination: Coordinate
    priority: CargoPriority = CargoPriority.NORMAL
    scheduled_pickup_at: datetime | None = None
    expected_delivery_at: datetime | None = None
    cargo_items: Annotated[list[CargoItemCreate], Field(min_length=1)]

    @model_validator(mode="after")
    def _check_ordering_and_distinctness(self) -> "ShipmentCreate":
        if (
            self.expected_delivery_at is not None
            and self.scheduled_pickup_at is not None
            and self.expected_delivery_at < self.scheduled_pickup_at
        ):
            raise ValueError("expected_delivery_at must not precede scheduled_pickup_at")
        if (self.pickup.lat, self.pickup.lon) == (
            self.destination.lat,
            self.destination.lon,
        ):
            raise ValueError("pickup and destination must be different locations")
        return self


class ShipmentRead(ReadModel):
    id: uuid.UUID
    reference_code: str
    client_name: str
    pickup_address: str
    destination_address: str
    total_weight_kg: Decimal
    priority: CargoPriority
    status: ShipmentStatus
    scheduled_pickup_at: datetime | None
    expected_delivery_at: datetime | None
    created_at: datetime


# --- Trip -----------------------------------------------------------------


class TripStopCreate(APIModel):
    sequence: Annotated[int, Field(ge=0, le=999)]
    kind: TripStopKind
    location: Coordinate
    name: str | None = Field(default=None, max_length=160)
    address: str | None = None
    geofence_radius_m: Annotated[int, Field(ge=10, le=20000)] = 200
    planned_arrival_at: datetime | None = None


class TripStopRead(ReadModel):
    id: uuid.UUID
    sequence: int
    kind: TripStopKind
    status: TripStopStatus
    name: str | None
    geofence_radius_m: int
    planned_arrival_at: datetime | None
    actual_arrival_at: datetime | None


class TripCreate(APIModel):
    """`status` is absent by design - a trip is always created as DRAFT.

    Allowing a client to choose the initial status would let it skip the
    capacity and document gates that guard the path into ACTIVE.
    """

    trip_code: Annotated[str, Field(min_length=3, max_length=32)]
    shipment_id: uuid.UUID
    truck_id: uuid.UUID
    driver_id: uuid.UUID
    stops: list[TripStopCreate] = []

    @model_validator(mode="after")
    def _stop_sequences_unique(self) -> "TripCreate":
        seqs = [s.sequence for s in self.stops]
        if len(seqs) != len(set(seqs)):
            raise ValueError("trip stop sequences must be unique within a trip")
        return self


class TripStatusUpdate(APIModel):
    """Status transitions are validated against app.domain.trip_state."""

    status: TripStatus
    reason: str | None = None


class TripRead(ReadModel):
    id: uuid.UUID
    trip_code: str
    shipment_id: uuid.UUID
    truck_id: uuid.UUID
    driver_id: uuid.UUID
    status: TripStatus
    selected_route_id: uuid.UUID | None
    dispatched_at: datetime | None
    started_at: datetime | None
    delivered_at: datetime | None
    planned_eta: datetime | None
    current_eta: datetime | None
    delay_minutes: int | None
    created_at: datetime


# --- GPS ------------------------------------------------------------------


class GpsFixIn(APIModel):
    """One position fix from the driver app.

    `device_fix_id` is client-generated and makes the offline replay queue
    safely retryable: re-posting an unacknowledged batch cannot duplicate rows.
    """

    device_fix_id: uuid.UUID
    location: Coordinate
    recorded_at: datetime
    altitude_m: Decimal | None = None
    speed_kmph: Annotated[Decimal, Field(ge=0, le=Decimal("200"))] | None = None
    heading_deg: Annotated[Decimal, Field(ge=0, lt=Decimal("360"))] | None = None
    accuracy_m: Annotated[Decimal, Field(ge=0)] | None = None
    is_mock_location: bool = False


class GpsBatchIn(APIModel):
    trip_id: uuid.UUID
    fixes: Annotated[list[GpsFixIn], Field(min_length=1, max_length=500)]

    @model_validator(mode="after")
    def _fix_ids_unique(self) -> "GpsBatchIn":
        ids = [f.device_fix_id for f in self.fixes]
        if len(ids) != len(set(ids)):
            raise ValueError("device_fix_id must be unique within a batch")
        return self


class GpsBatchAccepted(ReadModel):
    accepted: int
    duplicates_ignored: int
    rejected: int
    server_time: datetime
