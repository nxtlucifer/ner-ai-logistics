"""Core domain: identity, fleet, assignment, shipment, trip, telemetry, audit.

The P2 operational spine. Deliberately excluded and left to later migrations:
payments, expenses, payroll, deliveries, alerts, emergencies, road_incidents and
weather_events. Creating those now would be untested schema.

Enum values are written out inline rather than imported from app.models. A
migration is a snapshot of the schema at a point in time; importing live
application code would break this file the first time an enum member is renamed.
tests/test_schema_drift.py asserts the two never disagree.

Revision ID: 0002_core_domain
Revises: 0001_bootstrap
Create Date: 2026-08-29

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geography
from sqlalchemy.dialects import postgresql

revision: str = "0002_core_domain"
down_revision: str | None = "0001_bootstrap"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# --- Enum definitions -----------------------------------------------------

ENUMS: dict[str, tuple[str, ...]] = {
    "user_role": ("ADMIN", "MANAGER", "DRIVER"),
    "driver_status": ("AVAILABLE", "ON_TRIP", "OFF_DUTY", "SUSPENDED"),
    "document_status": ("VALID", "EXPIRING_SOON", "EXPIRED", "MISSING", "REJECTED"),
    "driver_document_type": (
        "DRIVING_LICENCE", "AADHAAR", "PAN", "POLICE_VERIFICATION",
        "MEDICAL_CERTIFICATE", "OTHER",
    ),
    "truck_status": ("AVAILABLE", "ON_TRIP", "MAINTENANCE", "BREAKDOWN", "RETIRED"),
    "truck_document_type": (
        "REGISTRATION_CERTIFICATE", "INSURANCE", "FITNESS_CERTIFICATE",
        "POLLUTION_CERTIFICATE", "NATIONAL_PERMIT", "STATE_PERMIT", "OTHER",
    ),
    "maintenance_kind": ("SERVICE", "REPAIR", "BREAKDOWN", "INSPECTION"),
    "assignment_status": ("PENDING_VERIFICATION", "ACTIVE", "ENDED", "REJECTED"),
    "cargo_priority": ("LOW", "NORMAL", "HIGH", "CRITICAL"),
    "shipment_status": ("DRAFT", "PLANNED", "IN_TRANSIT", "DELIVERED", "CANCELLED"),
    "trip_status": (
        "DRAFT", "ASSIGNED", "VERIFICATION_PENDING", "MANAGER_REVIEW", "ACTIVE",
        "DELAYED", "INCIDENT", "DELIVERED", "CLOSED", "CANCELLED",
    ),
    "trip_stop_kind": ("PICKUP", "DROPOFF", "REST", "FUEL", "CHECKPOINT", "OTHER"),
    "trip_stop_status": ("PENDING", "ARRIVED", "COMPLETED", "SKIPPED"),
    "route_kind": ("PRIMARY", "FUEL_EFFICIENT", "EMERGENCY_BACKUP"),
    "route_state": ("PROPOSED", "SELECTED", "SUPERSEDED", "REJECTED_BLOCKED"),
    "trip_event_kind": (
        "CREATED", "ASSIGNED", "VERIFIED", "DISPATCHED", "STARTED", "STOP_ARRIVED",
        "STOP_COMPLETED", "ROUTE_CHANGED", "DELAY_DETECTED", "COMMS_LOST",
        "COMMS_RESTORED", "BREAKDOWN_REPORTED", "INCIDENT_OPENED",
        "INCIDENT_RESOLVED", "DELIVERED", "CLOSED", "CANCELLED",
    ),
    "audit_action": (
        "CREATE", "UPDATE", "DELETE", "STATUS_CHANGE", "LOGIN", "LOGIN_FAILED",
        "DOCUMENT_ACCESS",
    ),
}

# Tables in creation order. Reversed for the drop, which is dependency-safe
# because every FK points at a table created earlier.
TABLES_IN_ORDER: tuple[str, ...] = (
    "users",
    "drivers",
    "driver_documents",
    "trucks",
    "truck_documents",
    "truck_maintenance",
    "driver_truck_assignments",
    "shipments",
    "cargo_items",
    "trips",
    "trip_stops",
    "trip_routes",
    "trip_events",
    "gps_points",
    "audit_logs",
)

TABLES_WITH_UPDATED_AT: tuple[str, ...] = ("users", "drivers", "trucks", "shipments", "trips")

POINT = Geography(geometry_type="POINT", srid=4326, spatial_index=False)
LINESTRING = Geography(geometry_type="LINESTRING", srid=4326, spatial_index=False)


def _enum(name: str) -> postgresql.ENUM:
    """Reference an already-created type; never create it here."""
    return postgresql.ENUM(*ENUMS[name], name=name, create_type=False)


def _uuid_pk() -> sa.Column:
    return sa.Column(
        "id",
        sa.Uuid(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    )


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


def _updated_at() -> sa.Column:
    return sa.Column(
        "updated_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


def upgrade() -> None:
    bind = op.get_bind()

    # --- Types ------------------------------------------------------------
    for name, values in ENUMS.items():
        postgresql.ENUM(*values, name=name).create(bind, checkfirst=True)

    # --- Trigger functions -------------------------------------------------
    # updated_at is maintained by the database, not by SQLAlchemy's onupdate.
    # An ORM-side default does not fire for bulk updates, raw SQL or migrations,
    # which is precisely when a stale timestamp misleads most.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
        BEGIN
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    # audit_logs is append-only. The application connects as the table owner,
    # and an owner cannot be denied UPDATE/DELETE via GRANT, so a trigger is the
    # only mechanism that actually holds.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'audit_logs is append-only; % is not permitted',
                TG_OP USING ERRCODE = 'check_violation';
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    # shipments.total_weight_kg is derived from cargo_items and is the value
    # compared against truck capacity. Clients never write it.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION recalc_shipment_weight() RETURNS trigger AS $$
        DECLARE
            target uuid;
        BEGIN
            target := COALESCE(NEW.shipment_id, OLD.shipment_id);
            UPDATE shipments s
               SET total_weight_kg = COALESCE((
                     SELECT SUM(c.weight_kg * c.quantity)
                       FROM cargo_items c
                      WHERE c.shipment_id = target), 0)
             WHERE s.id = target;
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    # --- users ------------------------------------------------------------
    op.create_table(
        "users",
        _uuid_pk(),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("phone", sa.String(20), nullable=True),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("role", _enum("user_role"), nullable=False),
        sa.Column("display_name", sa.String(120), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint(
            "email IS NOT NULL OR phone IS NOT NULL", name="ck_users_has_identifier"
        ),
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email)) "
        "WHERE email IS NOT NULL"
    )
    op.create_index(
        "uq_users_phone", "users", ["phone"], unique=True,
        postgresql_where=sa.text("phone IS NOT NULL"),
    )
    op.create_index(
        "ix_users_role_active", "users", ["role"],
        postgresql_where=sa.text("is_active"),
    )

    # --- drivers ----------------------------------------------------------
    op.create_table(
        "drivers",
        _uuid_pk(),
        sa.Column(
            "user_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, unique=True,
        ),
        sa.Column("full_name", sa.String(120), nullable=False),
        sa.Column("photo_url", sa.Text, nullable=True),
        sa.Column("phone", sa.String(20), nullable=False),
        sa.Column("emergency_contact_name", sa.String(120), nullable=True),
        sa.Column("emergency_contact_phone", sa.String(20), nullable=True),
        sa.Column("licence_number", sa.String(40), nullable=False),
        sa.Column("licence_class", sa.String(20), nullable=True),
        sa.Column("licence_expiry", sa.Date, nullable=False),
        sa.Column("date_of_joining", sa.Date, nullable=True),
        sa.Column(
            "status", _enum("driver_status"), nullable=False,
            server_default="AVAILABLE",
        ),
        sa.Column("base_salary_monthly", sa.Numeric(12, 2), nullable=True),
        _created_at(),
        _updated_at(),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "base_salary_monthly IS NULL OR base_salary_monthly >= 0",
            name="ck_drivers_salary_non_negative",
        ),
    )
    op.create_index(
        "uq_drivers_licence_number", "drivers", ["licence_number"], unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_drivers_status", "drivers", ["status"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_drivers_licence_expiry", "drivers", ["licence_expiry"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # --- driver_documents -------------------------------------------------
    op.create_table(
        "driver_documents",
        _uuid_pk(),
        sa.Column(
            "driver_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("drivers.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("doc_type", _enum("driver_document_type"), nullable=False),
        sa.Column("doc_number", sa.String(64), nullable=True),
        sa.Column("file_url", sa.Text, nullable=True),
        sa.Column("issued_on", sa.Date, nullable=True),
        sa.Column("expires_on", sa.Date, nullable=True),
        sa.Column(
            "status", _enum("document_status"), nullable=False, server_default="MISSING"
        ),
        sa.Column(
            "verified_by", sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        _created_at(),
        sa.CheckConstraint(
            "issued_on IS NULL OR expires_on IS NULL OR expires_on >= issued_on",
            name="ck_driver_documents_dates_ordered",
        ),
    )
    op.create_index(
        "ix_driver_documents_driver_type", "driver_documents", ["driver_id", "doc_type"]
    )
    op.create_index(
        "ix_driver_documents_expiry", "driver_documents", ["expires_on"],
        postgresql_where=sa.text("status <> 'EXPIRED'"),
    )

    # --- trucks -----------------------------------------------------------
    op.create_table(
        "trucks",
        _uuid_pk(),
        sa.Column("registration_number", sa.String(20), nullable=False),
        sa.Column("photo_url", sa.Text, nullable=True),
        sa.Column("truck_type", sa.String(40), nullable=True),
        sa.Column("make", sa.String(60), nullable=True),
        sa.Column("model", sa.String(60), nullable=True),
        sa.Column("manufacture_year", sa.SmallInteger, nullable=True),
        sa.Column("max_capacity_kg", sa.Numeric(10, 2), nullable=False),
        sa.Column(
            "current_load_kg", sa.Numeric(10, 2), nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("axle_count", sa.SmallInteger, nullable=True),
        sa.Column("height_m", sa.Numeric(5, 2), nullable=True),
        sa.Column("length_m", sa.Numeric(5, 2), nullable=True),
        sa.Column("fuel_tank_capacity_l", sa.Numeric(7, 2), nullable=True),
        sa.Column("baseline_mileage_kmpl", sa.Numeric(5, 2), nullable=True),
        sa.Column("odometer_km", sa.Numeric(10, 1), nullable=True),
        sa.Column(
            "status", _enum("truck_status"), nullable=False, server_default="AVAILABLE"
        ),
        _created_at(),
        _updated_at(),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("max_capacity_kg > 0", name="ck_trucks_capacity_positive"),
        sa.CheckConstraint("current_load_kg >= 0", name="ck_trucks_load_non_negative"),
        sa.CheckConstraint(
            "current_load_kg <= max_capacity_kg", name="ck_trucks_load_within_capacity"
        ),
        sa.CheckConstraint(
            "manufacture_year IS NULL OR manufacture_year BETWEEN 1950 AND 2100",
            name="ck_trucks_manufacture_year_sane",
        ),
        sa.CheckConstraint(
            "baseline_mileage_kmpl IS NULL OR baseline_mileage_kmpl > 0",
            name="ck_trucks_mileage_positive",
        ),
    )
    op.create_index(
        "uq_trucks_registration_number", "trucks", ["registration_number"], unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_trucks_status", "trucks", ["status"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # --- truck_documents --------------------------------------------------
    op.create_table(
        "truck_documents",
        _uuid_pk(),
        sa.Column(
            "truck_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("trucks.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("doc_type", _enum("truck_document_type"), nullable=False),
        sa.Column("doc_number", sa.String(64), nullable=True),
        sa.Column("file_url", sa.Text, nullable=True),
        sa.Column("issued_on", sa.Date, nullable=True),
        sa.Column("expires_on", sa.Date, nullable=True),
        sa.Column(
            "status", _enum("document_status"), nullable=False, server_default="MISSING"
        ),
        sa.Column(
            "verified_by", sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        _created_at(),
        sa.CheckConstraint(
            "issued_on IS NULL OR expires_on IS NULL OR expires_on >= issued_on",
            name="ck_truck_documents_dates_ordered",
        ),
    )
    op.create_index(
        "ix_truck_documents_truck_type", "truck_documents", ["truck_id", "doc_type"]
    )
    op.create_index(
        "ix_truck_documents_expiry", "truck_documents", ["expires_on"],
        postgresql_where=sa.text("status <> 'EXPIRED'"),
    )

    # --- truck_maintenance ------------------------------------------------
    op.create_table(
        "truck_maintenance",
        _uuid_pk(),
        sa.Column(
            "truck_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("trucks.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("event_kind", _enum("maintenance_kind"), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("odometer_km", sa.Numeric(10, 1), nullable=True),
        sa.Column("cost", sa.Numeric(12, 2), nullable=True),
        sa.Column("performed_on", sa.Date, nullable=False),
        sa.Column("next_due_on", sa.Date, nullable=True),
        _created_at(),
        sa.CheckConstraint("cost IS NULL OR cost >= 0", name="ck_maintenance_cost_non_negative"),
        sa.CheckConstraint(
            "next_due_on IS NULL OR next_due_on >= performed_on",
            name="ck_maintenance_next_due_after_performed",
        ),
    )
    op.execute(
        "CREATE INDEX ix_truck_maintenance_truck_date "
        "ON truck_maintenance (truck_id, performed_on DESC)"
    )

    # --- driver_truck_assignments -----------------------------------------
    op.create_table(
        "driver_truck_assignments",
        _uuid_pk(),
        sa.Column(
            "driver_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("drivers.id", ondelete="RESTRICT"), nullable=False,
        ),
        sa.Column(
            "truck_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("trucks.id", ondelete="RESTRICT"), nullable=False,
        ),
        sa.Column(
            "assigned_by", sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column(
            "status", _enum("assignment_status"), nullable=False,
            server_default="PENDING_VERIFICATION",
        ),
        sa.Column(
            "assigned_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("verification_photo_url", sa.Text, nullable=True),
        sa.Column("reported_registration", sa.String(20), nullable=True),
        sa.Column("reported_odometer_km", sa.Numeric(10, 1), nullable=True),
        sa.Column("reported_fuel_level_pct", sa.SmallInteger, nullable=True),
        sa.Column("reported_damage_notes", sa.Text, nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "mismatch_flagged", sa.Boolean, nullable=False, server_default=sa.false()
        ),
        sa.Column("manager_review_note", sa.Text, nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "reported_fuel_level_pct IS NULL "
            "OR reported_fuel_level_pct BETWEEN 0 AND 100",
            name="ck_assignment_fuel_pct_range",
        ),
        sa.CheckConstraint(
            "ended_at IS NULL OR ended_at >= assigned_at",
            name="ck_assignment_ended_after_assigned",
        ),
    )
    op.create_index(
        "uq_active_assignment_driver", "driver_truck_assignments", ["driver_id"],
        unique=True, postgresql_where=sa.text("status = 'ACTIVE'"),
    )
    op.create_index(
        "uq_active_assignment_truck", "driver_truck_assignments", ["truck_id"],
        unique=True, postgresql_where=sa.text("status = 'ACTIVE'"),
    )
    op.execute(
        "CREATE INDEX ix_assignment_driver_time "
        "ON driver_truck_assignments (driver_id, assigned_at DESC)"
    )
    op.execute(
        "CREATE INDEX ix_assignment_truck_time "
        "ON driver_truck_assignments (truck_id, assigned_at DESC)"
    )

    # --- shipments --------------------------------------------------------
    op.create_table(
        "shipments",
        _uuid_pk(),
        sa.Column("reference_code", sa.String(32), nullable=False),
        sa.Column("client_name", sa.String(160), nullable=False),
        sa.Column("client_contact", sa.String(60), nullable=True),
        sa.Column("pickup_address", sa.Text, nullable=False),
        sa.Column("pickup_location", POINT, nullable=False),
        sa.Column("destination_address", sa.Text, nullable=False),
        sa.Column("destination_location", POINT, nullable=False),
        sa.Column(
            "total_weight_kg", sa.Numeric(10, 2), nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "priority", _enum("cargo_priority"), nullable=False, server_default="NORMAL"
        ),
        sa.Column(
            "status", _enum("shipment_status"), nullable=False, server_default="DRAFT"
        ),
        sa.Column("scheduled_pickup_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expected_delivery_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by", sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        ),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint("total_weight_kg >= 0", name="ck_shipments_weight_non_negative"),
        sa.CheckConstraint(
            "expected_delivery_at IS NULL OR scheduled_pickup_at IS NULL "
            "OR expected_delivery_at >= scheduled_pickup_at",
            name="ck_shipments_delivery_after_pickup",
        ),
    )
    op.create_index("uq_shipments_reference_code", "shipments", ["reference_code"], unique=True)
    op.create_index("ix_shipments_status", "shipments", ["status"])
    op.create_index(
        "ix_shipments_pickup_location", "shipments", ["pickup_location"],
        postgresql_using="gist",
    )
    op.create_index(
        "ix_shipments_destination_location", "shipments", ["destination_location"],
        postgresql_using="gist",
    )

    # --- cargo_items ------------------------------------------------------
    op.create_table(
        "cargo_items",
        _uuid_pk(),
        sa.Column(
            "shipment_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("shipments.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("cargo_type", sa.String(60), nullable=False),
        sa.Column("cargo_name", sa.String(160), nullable=False),
        sa.Column("weight_kg", sa.Numeric(10, 2), nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False, server_default=sa.text("1")),
        sa.Column("is_hazardous", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_perishable", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("handling_notes", sa.Text, nullable=True),
        sa.CheckConstraint("weight_kg > 0", name="ck_cargo_items_weight_positive"),
        sa.CheckConstraint("quantity > 0", name="ck_cargo_items_quantity_positive"),
    )
    op.create_index("ix_cargo_items_shipment", "cargo_items", ["shipment_id"])
    op.execute(
        """
        CREATE TRIGGER trg_cargo_items_recalc_weight
        AFTER INSERT OR UPDATE OR DELETE ON cargo_items
        FOR EACH ROW EXECUTE FUNCTION recalc_shipment_weight();
        """
    )

    # --- trips ------------------------------------------------------------
    op.create_table(
        "trips",
        _uuid_pk(),
        sa.Column("trip_code", sa.String(32), nullable=False),
        sa.Column(
            "shipment_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("shipments.id", ondelete="RESTRICT"), nullable=False,
        ),
        sa.Column(
            "truck_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("trucks.id", ondelete="RESTRICT"), nullable=False,
        ),
        sa.Column(
            "driver_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("drivers.id", ondelete="RESTRICT"), nullable=False,
        ),
        sa.Column(
            "assignment_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("driver_truck_assignments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", _enum("trip_status"), nullable=False, server_default="DRAFT"),
        # FK added after trip_routes exists - see below.
        sa.Column("selected_route_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("planned_eta", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_eta", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delay_minutes", sa.Integer, nullable=True),
        sa.Column(
            "created_by", sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        ),
        _created_at(),
        _updated_at(),
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
    )
    op.create_index("uq_trips_trip_code", "trips", ["trip_code"], unique=True)
    op.create_index(
        "ix_trips_active", "trips", ["status"],
        postgresql_where=sa.text("status IN ('ACTIVE','DELAYED')"),
    )
    op.execute("CREATE INDEX ix_trips_truck_time ON trips (truck_id, created_at DESC)")
    op.execute("CREATE INDEX ix_trips_driver_time ON trips (driver_id, created_at DESC)")
    op.create_index("ix_trips_shipment", "trips", ["shipment_id"])

    # --- trip_stops -------------------------------------------------------
    op.create_table(
        "trip_stops",
        _uuid_pk(),
        sa.Column(
            "trip_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("sequence", sa.SmallInteger, nullable=False),
        sa.Column("kind", _enum("trip_stop_kind"), nullable=False),
        sa.Column(
            "status", _enum("trip_stop_status"), nullable=False, server_default="PENDING"
        ),
        sa.Column("name", sa.String(160), nullable=True),
        sa.Column("address", sa.Text, nullable=True),
        sa.Column("location", POINT, nullable=False),
        sa.Column(
            "geofence_radius_m", sa.Integer, nullable=False, server_default=sa.text("200")
        ),
        sa.Column("planned_arrival_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_arrival_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_departure_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
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
    )
    op.create_index(
        "uq_trip_stops_sequence", "trip_stops", ["trip_id", "sequence"], unique=True
    )
    op.create_index(
        "ix_trip_stops_location", "trip_stops", ["location"], postgresql_using="gist"
    )

    # --- trip_routes ------------------------------------------------------
    op.create_table(
        "trip_routes",
        _uuid_pk(),
        sa.Column(
            "trip_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("kind", _enum("route_kind"), nullable=False),
        sa.Column(
            "state", _enum("route_state"), nullable=False, server_default="PROPOSED"
        ),
        sa.Column("geometry", LINESTRING, nullable=False),
        sa.Column("distance_km", sa.Numeric(8, 2), nullable=True),
        sa.Column("estimated_duration_min", sa.Integer, nullable=True),
        sa.Column("estimated_fuel_litres", sa.Numeric(8, 2), nullable=True),
        sa.Column("estimated_fuel_cost", sa.Numeric(12, 2), nullable=True),
        sa.Column("fuel_estimate_source", sa.String(32), nullable=True),
        sa.Column("risk_score", sa.Numeric(4, 3), nullable=True),
        sa.Column("risk_factors", postgresql.JSONB, nullable=True),
        sa.Column("routing_provider", sa.String(32), nullable=True),
        sa.Column("provider_route_id", sa.String(128), nullable=True),
        sa.Column(
            "superseded_by", sa.Uuid(as_uuid=True),
            sa.ForeignKey("trip_routes.id", ondelete="SET NULL"), nullable=True,
        ),
        _created_at(),
        sa.CheckConstraint(
            "distance_km IS NULL OR distance_km >= 0",
            name="ck_trip_routes_distance_non_negative",
        ),
        sa.CheckConstraint(
            "estimated_fuel_litres IS NULL OR estimated_fuel_litres >= 0",
            name="ck_trip_routes_fuel_non_negative",
        ),
        sa.CheckConstraint(
            "risk_score IS NULL OR risk_score BETWEEN 0 AND 1",
            name="ck_trip_routes_risk_score_range",
        ),
    )
    op.create_index("ix_trip_routes_trip", "trip_routes", ["trip_id"])
    op.create_index(
        "ix_trip_routes_geometry", "trip_routes", ["geometry"], postgresql_using="gist"
    )

    # Circular reference trips <-> trip_routes. DEFERRABLE INITIALLY DEFERRED so
    # both rows can be written inside one transaction.
    op.create_foreign_key(
        "fk_trips_selected_route",
        "trips", "trip_routes", ["selected_route_id"], ["id"],
        ondelete="SET NULL", deferrable=True, initially="DEFERRED",
    )

    # --- trip_events ------------------------------------------------------
    op.create_table(
        "trip_events",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "trip_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("kind", _enum("trip_event_kind"), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("payload", postgresql.JSONB, nullable=True),
        sa.Column("location", POINT, nullable=True),
        sa.Column(
            "actor_user_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column(
            "occurred_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.execute(
        "CREATE INDEX ix_trip_events_trip_time ON trip_events (trip_id, occurred_at DESC)"
    )
    op.create_index("ix_trip_events_kind", "trip_events", ["kind"])

    # --- gps_points -------------------------------------------------------
    op.create_table(
        "gps_points",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "trip_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "driver_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("drivers.id", ondelete="RESTRICT"), nullable=False,
        ),
        sa.Column(
            "truck_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("trucks.id", ondelete="RESTRICT"), nullable=False,
        ),
        sa.Column("location", POINT, nullable=False),
        sa.Column("altitude_m", sa.Numeric(7, 2), nullable=True),
        sa.Column("speed_kmph", sa.Numeric(6, 2), nullable=True),
        sa.Column("heading_deg", sa.Numeric(5, 2), nullable=True),
        sa.Column("accuracy_m", sa.Numeric(7, 2), nullable=True),
        sa.Column("device_fix_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "received_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "is_mock_location", sa.Boolean, nullable=False, server_default=sa.false()
        ),
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
    )
    op.create_index(
        "uq_gps_trip_device_fix", "gps_points", ["trip_id", "device_fix_id"], unique=True
    )
    op.execute("CREATE INDEX ix_gps_trip_recorded ON gps_points (trip_id, recorded_at DESC)")
    op.execute("CREATE INDEX ix_gps_trip_received ON gps_points (trip_id, received_at DESC)")
    op.create_index("ix_gps_location", "gps_points", ["location"], postgresql_using="gist")

    # --- audit_logs -------------------------------------------------------
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "actor_user_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("action", _enum("audit_action"), nullable=False),
        sa.Column("entity_type", sa.String(64), nullable=False),
        sa.Column("entity_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("before", postgresql.JSONB, nullable=True),
        sa.Column("after", postgresql.JSONB, nullable=True),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("ip_address", postgresql.INET, nullable=True),
        _created_at(),
    )
    op.execute(
        "CREATE INDEX ix_audit_logs_entity "
        "ON audit_logs (entity_type, entity_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX ix_audit_logs_actor ON audit_logs (actor_user_id, created_at DESC)"
    )
    op.execute(
        """
        CREATE TRIGGER trg_audit_logs_append_only
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
        """
    )

    # --- updated_at triggers ----------------------------------------------
    for table in TABLES_WITH_UPDATED_AT:
        op.execute(
            f"""
            CREATE TRIGGER trg_{table}_set_updated_at
            BEFORE UPDATE ON {table}
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
            """
        )

    # --- Row Level Security -----------------------------------------------
    # Enabled with NO policies on every table. Supabase publishes `public`
    # through the PostgREST Data API, so a table without RLS is readable by
    # anyone holding the anon key - which for this schema would mean driver
    # identity documents and live GPS traces. The backend connects as the table
    # owner and bypasses RLS, so this costs the application nothing.
    #
    # No permissive anon policy is created. Deny-by-default stands until the
    # auth design is implemented deliberately. See docs/SECURITY.md section 5.
    # NOT "FORCE ROW LEVEL SECURITY": forcing would subject the table owner to
    # RLS too, and with no policies defined that would lock the backend out of
    # its own database.
    for table in TABLES_IN_ORDER:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")

    # Alembic's own bookkeeping table also lives in `public` and is therefore
    # published by the Data API, leaking the exact schema revision to anyone
    # holding the anon key. Low severity, but free to close. Alembic connects as
    # the owner and bypasses RLS, so its own migrations are unaffected.
    op.execute("ALTER TABLE alembic_version ENABLE ROW LEVEL SECURITY")

    # --- Comments ---------------------------------------------------------
    op.execute(
        "COMMENT ON COLUMN trucks.current_load_kg IS "
        "'Enforced <= max_capacity_kg by ck_trucks_load_within_capacity. "
        "Capacity is a safety limit, not a preference.'"
    )
    op.execute(
        "COMMENT ON COLUMN gps_points.received_at IS "
        "'Server clock. All safety timers use this, never recorded_at, so a "
        "manipulated device clock cannot extend a response window.'"
    )
    op.execute(
        "COMMENT ON COLUMN trip_routes.estimated_fuel_litres IS "
        "'NULL means no estimate available. Never default to zero - see "
        "docs/AI_MODELS.md section 0.'"
    )
    op.execute(
        "COMMENT ON TABLE audit_logs IS "
        "'Append-only. UPDATE and DELETE are rejected by trg_audit_logs_append_only.'"
    )
    op.execute(
        "COMMENT ON TABLE trip_events IS "
        "'What happened on the road. audit_logs records who changed what.'"
    )


def downgrade() -> None:
    bind = op.get_bind()

    # Triggers depending on tables go with their tables; drop the standalone
    # ones and the functions after.
    for table in reversed(TABLES_IN_ORDER):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")

    op.execute("DROP FUNCTION IF EXISTS recalc_shipment_weight()")
    op.execute("DROP FUNCTION IF EXISTS reject_audit_mutation()")
    op.execute("DROP FUNCTION IF EXISTS set_updated_at()")

    for name in ENUMS:
        postgresql.ENUM(name=name).drop(bind, checkfirst=True)

    # RLS on alembic_version is deliberately left enabled. Turning it back off
    # would re-open an information disclosure for no benefit, and the table is
    # not owned by this migration.

    # 0001_bootstrap - the postgis extension and system_info - is deliberately
    # left untouched. This migration did not create them.
