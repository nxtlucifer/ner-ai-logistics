"""Fleet: trucks, their documents, maintenance history and driver assignment."""

import uuid
from datetime import date, datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import (
    MONEY,
    WEIGHT_KG,
    SoftDeleteMixin,
    TimestampMixin,
    pg_enum,
    uuid_pk,
)
from app.models.enums import (
    AssignmentStatus,
    DocumentStatus,
    MaintenanceKind,
    TruckDocumentType,
    TruckStatus,
)


class Truck(TimestampMixin, SoftDeleteMixin, Base):
    """A vehicle in the fleet.

    Called "truck" throughout, matching how the operators and the problem
    statement speak. Not "vehicle" - one word for one concept.
    """

    __tablename__ = "trucks"

    id: Mapped[uuid.UUID] = uuid_pk()
    registration_number: Mapped[str] = mapped_column(sa.String(20), nullable=False)
    photo_url: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    truck_type: Mapped[str | None] = mapped_column(sa.String(40), nullable=True)
    make: Mapped[str | None] = mapped_column(sa.String(60), nullable=True)
    model: Mapped[str | None] = mapped_column(sa.String(60), nullable=True)
    manufacture_year: Mapped[int | None] = mapped_column(sa.SmallInteger, nullable=True)

    max_capacity_kg: Mapped[Decimal] = mapped_column(WEIGHT_KG, nullable=False)
    current_load_kg: Mapped[Decimal] = mapped_column(
        WEIGHT_KG,
        nullable=False,
        server_default=sa.text("0"),
        comment=(
            "Enforced <= max_capacity_kg by ck_trucks_load_within_capacity. "
            "Capacity is a safety limit, not a preference."
        ),
    )

    axle_count: Mapped[int | None] = mapped_column(sa.SmallInteger, nullable=True)
    height_m: Mapped[Decimal | None] = mapped_column(sa.Numeric(5, 2), nullable=True)
    length_m: Mapped[Decimal | None] = mapped_column(sa.Numeric(5, 2), nullable=True)
    fuel_tank_capacity_l: Mapped[Decimal | None] = mapped_column(
        sa.Numeric(7, 2), nullable=True
    )
    # Fallback used by the fuel BASELINE when the ML model is unavailable.
    # See docs/AI_MODELS.md section 1.
    baseline_mileage_kmpl: Mapped[Decimal | None] = mapped_column(
        sa.Numeric(5, 2), nullable=True
    )
    odometer_km: Mapped[Decimal | None] = mapped_column(
        sa.Numeric(10, 1), nullable=True
    )
    status: Mapped[TruckStatus] = mapped_column(
        pg_enum(TruckStatus),
        nullable=False,
        server_default=TruckStatus.AVAILABLE.value,
    )

    documents: Mapped[list["TruckDocument"]] = relationship(
        back_populates="truck", cascade="all, delete-orphan", lazy="raise"
    )
    maintenance: Mapped[list["TruckMaintenance"]] = relationship(
        back_populates="truck", cascade="all, delete-orphan", lazy="raise"
    )

    __table_args__ = (
        sa.CheckConstraint("max_capacity_kg > 0", name="ck_trucks_capacity_positive"),
        sa.CheckConstraint("current_load_kg >= 0", name="ck_trucks_load_non_negative"),
        # THE capacity invariant, enforced by the database rather than only by
        # application code. An overloaded truck on a hill road is a safety
        # failure, so this must not depend on a service-layer bug being absent.
        sa.CheckConstraint(
            "current_load_kg <= max_capacity_kg",
            name="ck_trucks_load_within_capacity",
        ),
        sa.CheckConstraint(
            "manufacture_year IS NULL OR manufacture_year BETWEEN 1950 AND 2100",
            name="ck_trucks_manufacture_year_sane",
        ),
        sa.CheckConstraint(
            "baseline_mileage_kmpl IS NULL OR baseline_mileage_kmpl > 0",
            name="ck_trucks_mileage_positive",
        ),
        sa.Index(
            "uq_trucks_registration_number",
            "registration_number",
            unique=True,
            postgresql_where=sa.text("deleted_at IS NULL"),
        ),
        sa.Index(
            "ix_trucks_status",
            "status",
            postgresql_where=sa.text("deleted_at IS NULL"),
        ),
    )


class TruckDocument(Base):
    """RC, insurance, fitness, PUC and permits."""

    __tablename__ = "truck_documents"

    id: Mapped[uuid.UUID] = uuid_pk()
    truck_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("trucks.id", ondelete="CASCADE"), nullable=False
    )
    doc_type: Mapped[TruckDocumentType] = mapped_column(
        pg_enum(TruckDocumentType), nullable=False
    )
    doc_number: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    file_url: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    issued_on: Mapped[date | None] = mapped_column(sa.Date, nullable=True)
    expires_on: Mapped[date | None] = mapped_column(sa.Date, nullable=True)
    status: Mapped[DocumentStatus] = mapped_column(
        pg_enum(DocumentStatus),
        nullable=False,
        server_default=DocumentStatus.MISSING.value,
    )
    verified_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    verified_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )

    truck: Mapped[Truck] = relationship(back_populates="documents", lazy="raise")

    __table_args__ = (
        sa.CheckConstraint(
            "issued_on IS NULL OR expires_on IS NULL OR expires_on >= issued_on",
            name="ck_truck_documents_dates_ordered",
        ),
        sa.Index("ix_truck_documents_truck_type", "truck_id", "doc_type"),
        sa.Index(
            "ix_truck_documents_expiry",
            "expires_on",
            postgresql_where=sa.text("status <> 'EXPIRED'"),
        ),
    )


class TruckMaintenance(Base):
    """Service, repair, breakdown and inspection history."""

    __tablename__ = "truck_maintenance"

    id: Mapped[uuid.UUID] = uuid_pk()
    truck_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("trucks.id", ondelete="CASCADE"), nullable=False
    )
    event_kind: Mapped[MaintenanceKind] = mapped_column(
        pg_enum(MaintenanceKind), nullable=False
    )
    description: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    odometer_km: Mapped[Decimal | None] = mapped_column(
        sa.Numeric(10, 1), nullable=True
    )
    cost: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    performed_on: Mapped[date] = mapped_column(sa.Date, nullable=False)
    next_due_on: Mapped[date | None] = mapped_column(sa.Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )

    truck: Mapped[Truck] = relationship(back_populates="maintenance", lazy="raise")

    __table_args__ = (
        sa.CheckConstraint("cost IS NULL OR cost >= 0", name="ck_maintenance_cost_non_negative"),
        sa.CheckConstraint(
            "next_due_on IS NULL OR next_due_on >= performed_on",
            name="ck_maintenance_next_due_after_performed",
        ),
        sa.Index("ix_truck_maintenance_truck_date", "truck_id", sa.text("performed_on DESC")),
    )


class DriverTruckAssignment(Base):
    """Which driver is currently responsible for which truck.

    Full history is retained; "current" is expressed by two partial unique
    indexes rather than a boolean, so the database itself guarantees a driver
    cannot hold two trucks at once and a truck cannot have two drivers.
    """

    __tablename__ = "driver_truck_assignments"

    id: Mapped[uuid.UUID] = uuid_pk()
    driver_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("drivers.id", ondelete="RESTRICT"), nullable=False
    )
    truck_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("trucks.id", ondelete="RESTRICT"), nullable=False
    )
    assigned_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[AssignmentStatus] = mapped_column(
        pg_enum(AssignmentStatus),
        nullable=False,
        server_default=AssignmentStatus.PENDING_VERIFICATION.value,
    )
    assigned_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )

    # Driver-submitted verification of the physical truck.
    verification_photo_url: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    reported_registration: Mapped[str | None] = mapped_column(
        sa.String(20), nullable=True
    )
    reported_odometer_km: Mapped[Decimal | None] = mapped_column(
        sa.Numeric(10, 1), nullable=True
    )
    reported_fuel_level_pct: Mapped[int | None] = mapped_column(
        sa.SmallInteger, nullable=True
    )
    reported_damage_notes: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    # A mismatch flags for manager review; it never blocks the driver.
    # See docs/API_CONTRACTS.md section 5.
    mismatch_flagged: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.false()
    )
    manager_review_note: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        sa.CheckConstraint(
            "reported_fuel_level_pct IS NULL "
            "OR reported_fuel_level_pct BETWEEN 0 AND 100",
            name="ck_assignment_fuel_pct_range",
        ),
        sa.CheckConstraint(
            "ended_at IS NULL OR ended_at >= assigned_at",
            name="ck_assignment_ended_after_assigned",
        ),
        # At most one CURRENT assignment per driver, and per truck. Expressed as
        # partial unique indexes so history is retained in the same table.
        #
        # "Current" is ACTIVE **or** PENDING_VERIFICATION, and the distinction
        # matters: a reported registration mismatch moves an assignment to
        # PENDING_VERIFICATION and the driver keeps the truck, so it is still
        # current. The original predicate covered only ACTIVE, which let a
        # reassignment slip past an assignment awaiting review and leave one
        # driver holding two trucks. Widened in migration 0006.
        sa.Index(
            "uq_current_assignment_driver",
            "driver_id",
            unique=True,
            postgresql_where=sa.text(
                "status IN ('ACTIVE','PENDING_VERIFICATION')"
            ),
        ),
        sa.Index(
            "uq_current_assignment_truck",
            "truck_id",
            unique=True,
            postgresql_where=sa.text(
                "status IN ('ACTIVE','PENDING_VERIFICATION')"
            ),
        ),
        sa.Index("ix_assignment_driver_time", "driver_id", sa.text("assigned_at DESC")),
        sa.Index("ix_assignment_truck_time", "truck_id", sa.text("assigned_at DESC")),
    )
