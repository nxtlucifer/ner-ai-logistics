"""Operations: shipments, cargo, trips, stops, routes, events and GPS.

Geospatial choice: every spatial column is `geography(...,4326)`, not
`geometry`. NER spans roughly 22-29 degrees N, where one degree of longitude is
about 90 km against 111 km for latitude. On `geometry` in SRID 4326, distances
come back in degrees and that anisotropy silently corrupts any proximity check -
including the ones the safety features will depend on. `geography` returns true
metres from ST_Distance and accepts metres in ST_DWithin.

The cost is that `geography` supports fewer functions and is slower than a
projected CRS. For our operations - distance, proximity, DWithin, length - it is
the correct trade. See docs/DATA_MODEL.md section 1.
"""

import uuid
from datetime import datetime
from decimal import Decimal

import sqlalchemy as sa
from geoalchemy2 import Geography
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import WEIGHT_KG, TimestampMixin, pg_enum, uuid_pk
from app.models.enums import (
    CargoPriority,
    RouteKind,
    RouteState,
    ShipmentStatus,
    TripEventKind,
    TripStatus,
    TripStopKind,
    TripStopStatus,
)

# Spatial indexes are created explicitly in the migration, so GeoAlchemy2 must
# not also emit its own.
#
# FACTORIES, NOT SHARED CONSTANTS. This is not a style preference.
#
# GeoAlchemy2 attaches a column listener that reconciles nullability between a
# column and its type (geoalchemy2/admin/__init__.py):
#
#     if not getattr(column.type, "nullable", True):
#         column.nullable = column.type.nullable   # the TYPE wins
#     elif hasattr(column.type, "nullable"):
#         column.type.nullable = column.nullable   # the COLUMN mutates the type
#
# With one shared `POINT` instance, the second branch lets the first column
# declared `nullable=False` write that back onto the shared type. Every later
# column then takes the first branch and is silently forced NOT NULL - whatever
# its own declaration says.
#
# That is exactly what happened to `trip_events.location`: declared nullable,
# created NOT NULL, and invisible to the drift check because the model and the
# database were wrong in the same direction. The consequence was that no trip
# event could be recorded without a position, which broke the entire operational
# timeline. Fixed in migration 0005.
#
# A fresh instance per column makes the column declaration the single source of
# truth again.


def point() -> Geography:
    return Geography(geometry_type="POINT", srid=4326, spatial_index=False)


def linestring() -> Geography:
    return Geography(geometry_type="LINESTRING", srid=4326, spatial_index=False)


class Shipment(TimestampMixin, Base):
    """What the customer asked to be moved, and between which two places.

    Commercial intent. The operational execution - which may involve rest and
    fuel stops along the way - is expressed by TripStop.
    """

    __tablename__ = "shipments"

    id: Mapped[uuid.UUID] = uuid_pk()
    reference_code: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    client_name: Mapped[str] = mapped_column(sa.String(160), nullable=False)
    client_contact: Mapped[str | None] = mapped_column(sa.String(60), nullable=True)

    pickup_address: Mapped[str] = mapped_column(sa.Text, nullable=False)
    pickup_location: Mapped[object] = mapped_column(point(), nullable=False)
    destination_address: Mapped[str] = mapped_column(sa.Text, nullable=False)
    destination_location: Mapped[object] = mapped_column(point(), nullable=False)

    # Maintained from cargo_items by a trigger; never written by clients.
    total_weight_kg: Mapped[Decimal] = mapped_column(
        WEIGHT_KG, nullable=False, server_default=sa.text("0")
    )
    priority: Mapped[CargoPriority] = mapped_column(
        pg_enum(CargoPriority),
        nullable=False,
        server_default=CargoPriority.NORMAL.value,
    )
    status: Mapped[ShipmentStatus] = mapped_column(
        pg_enum(ShipmentStatus),
        nullable=False,
        server_default=ShipmentStatus.DRAFT.value,
    )
    scheduled_pickup_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    expected_delivery_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    cargo_items: Mapped[list["CargoItem"]] = relationship(
        back_populates="shipment", cascade="all, delete-orphan", lazy="raise"
    )

    __table_args__ = (
        sa.CheckConstraint("total_weight_kg >= 0", name="ck_shipments_weight_non_negative"),
        sa.CheckConstraint(
            "expected_delivery_at IS NULL OR scheduled_pickup_at IS NULL "
            "OR expected_delivery_at >= scheduled_pickup_at",
            name="ck_shipments_delivery_after_pickup",
        ),
        sa.Index("uq_shipments_reference_code", "reference_code", unique=True),
        sa.Index("ix_shipments_status", "status"),
        sa.Index(
            "ix_shipments_pickup_location",
            "pickup_location",
            postgresql_using="gist",
        ),
        sa.Index(
            "ix_shipments_destination_location",
            "destination_location",
            postgresql_using="gist",
        ),
    )


class CargoItem(Base):
    """One line of cargo within a shipment."""

    __tablename__ = "cargo_items"

    id: Mapped[uuid.UUID] = uuid_pk()
    shipment_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("shipments.id", ondelete="CASCADE"), nullable=False
    )
    cargo_type: Mapped[str] = mapped_column(sa.String(60), nullable=False)
    cargo_name: Mapped[str] = mapped_column(sa.String(160), nullable=False)
    weight_kg: Mapped[Decimal] = mapped_column(WEIGHT_KG, nullable=False)
    quantity: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default=sa.text("1")
    )
    is_hazardous: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.false()
    )
    is_perishable: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.false()
    )
    handling_notes: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    shipment: Mapped[Shipment] = relationship(
        back_populates="cargo_items", lazy="raise"
    )

    __table_args__ = (
        sa.CheckConstraint("weight_kg > 0", name="ck_cargo_items_weight_positive"),
        sa.CheckConstraint("quantity > 0", name="ck_cargo_items_quantity_positive"),
        sa.Index("ix_cargo_items_shipment", "shipment_id"),
    )


class Trip(TimestampMixin, Base):
    """One execution of a shipment by a specific truck and driver."""

    __tablename__ = "trips"

    id: Mapped[uuid.UUID] = uuid_pk()
    trip_code: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    shipment_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("shipments.id", ondelete="RESTRICT"), nullable=False
    )
    truck_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("trucks.id", ondelete="RESTRICT"), nullable=False
    )
    driver_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("drivers.id", ondelete="RESTRICT"), nullable=False
    )
    assignment_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("driver_truck_assignments.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[TripStatus] = mapped_column(
        pg_enum(TripStatus), nullable=False, server_default=TripStatus.DRAFT.value
    )
    # Circular with trip_routes.trip_id, so the constraint is deferrable and
    # added after both tables exist. Both rows are written in one transaction.
    selected_route_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey(
            "trip_routes.id",
            ondelete="SET NULL",
            deferrable=True,
            initially="DEFERRED",
            use_alter=True,
            name="fk_trips_selected_route",
        ),
        nullable=True,
    )

    dispatched_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    started_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    delivered_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    closed_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    planned_eta: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    current_eta: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    delay_minutes: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    stops: Mapped[list["TripStop"]] = relationship(
        back_populates="trip",
        cascade="all, delete-orphan",
        order_by="TripStop.sequence",
        lazy="raise",
    )
    routes: Mapped[list["TripRoute"]] = relationship(
        back_populates="trip",
        primaryjoin="Trip.id == TripRoute.trip_id",
        cascade="all, delete-orphan",
        lazy="raise",
    )
    # No cascade delete: the event timeline is evidence and outlives edits.
    events: Mapped[list["TripEvent"]] = relationship(
        back_populates="trip", lazy="raise"
    )

    __table_args__ = (
        sa.CheckConstraint(
            "started_at IS NULL OR dispatched_at IS NULL OR started_at >= dispatched_at",
            name="ck_trips_started_after_dispatched",
        ),
        sa.CheckConstraint(
            "delivered_at IS NULL OR started_at IS NULL OR delivered_at >= started_at",
            name="ck_trips_delivered_after_started",
        ),
        sa.CheckConstraint(
            "closed_at IS NULL OR delivered_at IS NULL OR closed_at >= delivered_at",
            name="ck_trips_closed_after_delivered",
        ),
        sa.Index("uq_trips_trip_code", "trip_code", unique=True),
        # The Fleet Sentinel monitor sweeps active trips every 5 minutes and must
        # never table-scan.
        sa.Index(
            "ix_trips_active",
            "status",
            postgresql_where=sa.text("status IN ('ACTIVE','DELAYED')"),
        ),
        sa.Index("ix_trips_truck_time", "truck_id", sa.text("created_at DESC")),
        sa.Index("ix_trips_driver_time", "driver_id", sa.text("created_at DESC")),
        sa.Index("ix_trips_shipment", "shipment_id"),
    )


class TripStop(Base):
    """An ordered stop in the trip's execution plan.

    Generalises pickup and dropoff into a sequence that can also carry rest,
    fuel and checkpoint stops. Fleet Sentinel will later treat an approved stop
    as a legitimate reason for a stationary truck.
    """

    __tablename__ = "trip_stops"

    id: Mapped[uuid.UUID] = uuid_pk()
    trip_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=False
    )
    sequence: Mapped[int] = mapped_column(sa.SmallInteger, nullable=False)
    kind: Mapped[TripStopKind] = mapped_column(pg_enum(TripStopKind), nullable=False)
    status: Mapped[TripStopStatus] = mapped_column(
        pg_enum(TripStopStatus),
        nullable=False,
        server_default=TripStopStatus.PENDING.value,
    )
    name: Mapped[str | None] = mapped_column(sa.String(160), nullable=True)
    address: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    location: Mapped[object] = mapped_column(point(), nullable=False)
    # Radius within which a truck counts as "at" this stop.
    geofence_radius_m: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default=sa.text("200")
    )
    planned_arrival_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    actual_arrival_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    actual_departure_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    trip: Mapped[Trip] = relationship(back_populates="stops", lazy="raise")

    __table_args__ = (
        sa.CheckConstraint("sequence >= 0", name="ck_trip_stops_sequence_non_negative"),
        sa.CheckConstraint(
            "geofence_radius_m BETWEEN 10 AND 20000",
            name="ck_trip_stops_geofence_radius_sane",
        ),
        sa.CheckConstraint(
            "actual_departure_at IS NULL OR actual_arrival_at IS NULL "
            "OR actual_departure_at >= actual_arrival_at",
            name="ck_trip_stops_departure_after_arrival",
        ),
        sa.Index("uq_trip_stops_sequence", "trip_id", "sequence", unique=True),
        sa.Index("ix_trip_stops_location", "location", postgresql_using="gist"),
    )


class TripRoute(Base):
    """A candidate or selected route for a trip.

    Rerouting inserts a NEW row and marks the old one SUPERSEDED. Route history
    is never overwritten - it is evidence in an incident review.
    """

    __tablename__ = "trip_routes"

    id: Mapped[uuid.UUID] = uuid_pk()
    trip_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[RouteKind] = mapped_column(pg_enum(RouteKind), nullable=False)
    state: Mapped[RouteState] = mapped_column(
        pg_enum(RouteState), nullable=False, server_default=RouteState.PROPOSED.value
    )
    geometry: Mapped[object] = mapped_column(linestring(), nullable=False)
    distance_km: Mapped[Decimal | None] = mapped_column(
        sa.Numeric(8, 2), nullable=True
    )
    estimated_duration_min: Mapped[int | None] = mapped_column(
        sa.Integer, nullable=True
    )
    # NULL means "no estimate available" and must render as such. It is never
    # defaulted to zero. See docs/AI_MODELS.md section 0.
    estimated_fuel_litres: Mapped[Decimal | None] = mapped_column(
        sa.Numeric(8, 2),
        nullable=True,
        comment=(
            "NULL means no estimate available. Never default to zero - see "
            "docs/AI_MODELS.md section 0."
        ),
    )
    estimated_fuel_cost: Mapped[Decimal | None] = mapped_column(
        sa.Numeric(12, 2), nullable=True
    )
    # Traces a displayed number back to what produced it: MODEL_V1, BASELINE_KMPL
    # or NULL.
    fuel_estimate_source: Mapped[str | None] = mapped_column(
        sa.String(32), nullable=True
    )
    risk_score: Mapped[Decimal | None] = mapped_column(sa.Numeric(4, 3), nullable=True)
    risk_factors: Mapped[dict | None] = mapped_column(
        postgresql.JSONB, nullable=True
    )
    routing_provider: Mapped[str | None] = mapped_column(sa.String(32), nullable=True)
    provider_route_id: Mapped[str | None] = mapped_column(sa.String(128), nullable=True)
    superseded_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("trip_routes.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )

    trip: Mapped[Trip] = relationship(
        back_populates="routes",
        primaryjoin="Trip.id == TripRoute.trip_id",
        lazy="raise",
    )

    __table_args__ = (
        sa.CheckConstraint(
            "distance_km IS NULL OR distance_km >= 0", name="ck_trip_routes_distance_non_negative"
        ),
        sa.CheckConstraint(
            "estimated_fuel_litres IS NULL OR estimated_fuel_litres >= 0",
            name="ck_trip_routes_fuel_non_negative",
        ),
        sa.CheckConstraint(
            "risk_score IS NULL OR risk_score BETWEEN 0 AND 1",
            name="ck_trip_routes_risk_score_range",
        ),
        sa.Index("ix_trip_routes_trip", "trip_id"),
        # Required by the incident-to-route intersection query.
        sa.Index("ix_trip_routes_geometry", "geometry", postgresql_using="gist"),
    )


class TripEvent(Base):
    """Append-only operational timeline of what happened on the road."""

    __tablename__ = "trip_events"

    id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=True)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[TripEventKind] = mapped_column(pg_enum(TripEventKind), nullable=False)
    description: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    # Semi-structured by nature: each event kind carries different detail. This
    # is the one legitimate JSONB use in the schema.
    payload: Mapped[dict | None] = mapped_column(postgresql.JSONB, nullable=True)
    # Nullable on purpose, and it took migration 0005 to make that true in the
    # database - see the comment on point() above. Most events have no position:
    # CREATED and ASSIGNED happen in an office, and CLOSED is a settlement fact.
    location: Mapped[object | None] = mapped_column(
        point(),
        nullable=True,
        comment=(
            "Where the event happened, when that is known. NULL for lifecycle "
            "events recorded away from the vehicle - CREATED, ASSIGNED, CLOSED."
        ),
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    occurred_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )

    trip: Mapped[Trip] = relationship(back_populates="events", lazy="raise")

    __table_args__ = (
        sa.Index("ix_trip_events_trip_time", "trip_id", sa.text("occurred_at DESC")),
        sa.Index("ix_trip_events_kind", "kind"),
        {
            "comment": (
                "What happened on the road. audit_logs records who changed what."
            )
        },
    )


class GpsPoint(Base):
    """A single position fix from the driver's phone.

    High volume, so a BIGSERIAL key rather than a UUID. Both the device clock
    and the server clock are stored: safety timers use `received_at`, so a phone
    with a wrong or manipulated clock cannot extend a response window.
    """

    __tablename__ = "gps_points"

    id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=True)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=False
    )
    driver_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("drivers.id", ondelete="RESTRICT"), nullable=False
    )
    truck_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("trucks.id", ondelete="RESTRICT"), nullable=False
    )
    location: Mapped[object] = mapped_column(point(), nullable=False)
    altitude_m: Mapped[Decimal | None] = mapped_column(sa.Numeric(7, 2), nullable=True)
    speed_kmph: Mapped[Decimal | None] = mapped_column(sa.Numeric(6, 2), nullable=True)
    heading_deg: Mapped[Decimal | None] = mapped_column(sa.Numeric(5, 2), nullable=True)
    accuracy_m: Mapped[Decimal | None] = mapped_column(sa.Numeric(7, 2), nullable=True)
    # Client-generated. Makes the offline replay queue safely retryable.
    device_fix_id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(as_uuid=True), nullable=False
    )
    recorded_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False
    )
    received_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
        comment=(
            "Server clock. All safety timers use this, never recorded_at, so a "
            "manipulated device clock cannot extend a response window."
        ),
    )
    # Reported by Android. Stored and surfaced, never used to auto-reject.
    is_mock_location: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.false()
    )

    __table_args__ = (
        sa.CheckConstraint(
            "speed_kmph IS NULL OR speed_kmph >= 0", name="ck_gps_speed_non_negative"
        ),
        sa.CheckConstraint(
            "heading_deg IS NULL OR heading_deg >= 0 AND heading_deg < 360",
            name="ck_gps_heading_range",
        ),
        sa.CheckConstraint(
            "accuracy_m IS NULL OR accuracy_m >= 0", name="ck_gps_accuracy_non_negative"
        ),
        # Idempotency: re-posting an unacknowledged batch cannot duplicate rows.
        # Without this, a dropped ack on a hill road corrupts the stationary
        # distance calculation Fleet Sentinel depends on.
        sa.Index("uq_gps_trip_device_fix", "trip_id", "device_fix_id", unique=True),
        sa.Index("ix_gps_trip_recorded", "trip_id", sa.text("recorded_at DESC")),
        sa.Index("ix_gps_trip_received", "trip_id", sa.text("received_at DESC")),
        sa.Index("ix_gps_location", "location", postgresql_using="gist"),
    )
