"""Identity: users, drivers and driver documents."""

import uuid
from datetime import date, datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import (
    MONEY,
    SoftDeleteMixin,
    TimestampMixin,
    pg_enum,
    uuid_pk,
)
from app.models.enums import (
    DocumentStatus,
    DriverDocumentType,
    DriverStatus,
    UserRole,
)


class User(TimestampMixin, Base):
    """Authentication principal. Every human actor has exactly one.

    Managers and admins sign in with email; drivers sign in with phone, because
    drivers in this region reliably have a phone number and often do not have a
    working email address.
    """

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(sa.String(20), nullable=True)
    password_hash: Mapped[str] = mapped_column(sa.Text, nullable=False)
    role: Mapped[UserRole] = mapped_column(pg_enum(UserRole), nullable=False)
    display_name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.true()
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )

    driver: Mapped["Driver | None"] = relationship(
        back_populates="user", uselist=False, lazy="raise"
    )

    __table_args__ = (
        # A principal with neither identifier could never authenticate.
        sa.CheckConstraint(
            "email IS NOT NULL OR phone IS NOT NULL",
            name="ck_users_has_identifier",
        ),
        # Case-insensitive uniqueness via a functional index rather than CITEXT:
        # identical behaviour without depending on another extension.
        sa.Index(
            "uq_users_email_lower",
            sa.text("lower(email)"),
            unique=True,
            postgresql_where=sa.text("email IS NOT NULL"),
        ),
        sa.Index(
            "uq_users_phone",
            "phone",
            unique=True,
            postgresql_where=sa.text("phone IS NOT NULL"),
        ),
        sa.Index("ix_users_role_active", "role", postgresql_where=sa.text("is_active")),
    )


class Driver(TimestampMixin, SoftDeleteMixin, Base):
    """Operational profile of a driver, separate from their login."""

    __tablename__ = "drivers"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    full_name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    photo_url: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    phone: Mapped[str] = mapped_column(sa.String(20), nullable=False)
    emergency_contact_name: Mapped[str | None] = mapped_column(
        sa.String(120), nullable=True
    )
    emergency_contact_phone: Mapped[str | None] = mapped_column(
        sa.String(20), nullable=True
    )
    licence_number: Mapped[str] = mapped_column(sa.String(40), nullable=False)
    licence_class: Mapped[str | None] = mapped_column(sa.String(20), nullable=True)
    licence_expiry: Mapped[date] = mapped_column(sa.Date, nullable=False)
    date_of_joining: Mapped[date | None] = mapped_column(sa.Date, nullable=True)
    status: Mapped[DriverStatus] = mapped_column(
        pg_enum(DriverStatus),
        nullable=False,
        server_default=DriverStatus.AVAILABLE.value,
    )
    base_salary_monthly: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)

    user: Mapped[User] = relationship(back_populates="driver", lazy="raise")
    documents: Mapped[list["DriverDocument"]] = relationship(
        back_populates="driver",
        cascade="all, delete-orphan",
        lazy="raise",
    )

    __table_args__ = (
        sa.CheckConstraint(
            "base_salary_monthly IS NULL OR base_salary_monthly >= 0",
            name="ck_drivers_salary_non_negative",
        ),
        sa.Index(
            "uq_drivers_licence_number",
            "licence_number",
            unique=True,
            postgresql_where=sa.text("deleted_at IS NULL"),
        ),
        sa.Index(
            "ix_drivers_status",
            "status",
            postgresql_where=sa.text("deleted_at IS NULL"),
        ),
        # Drives the scheduled licence-expiry sweep.
        sa.Index(
            "ix_drivers_licence_expiry",
            "licence_expiry",
            postgresql_where=sa.text("deleted_at IS NULL"),
        ),
    )


class DriverDocument(Base):
    """Identity and compliance documents belonging to a driver.

    Files live in private object storage; only the key is stored here. See
    docs/SECURITY.md section 4.
    """

    __tablename__ = "driver_documents"

    id: Mapped[uuid.UUID] = uuid_pk()
    driver_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("drivers.id", ondelete="CASCADE"), nullable=False
    )
    doc_type: Mapped[DriverDocumentType] = mapped_column(
        pg_enum(DriverDocumentType), nullable=False
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

    driver: Mapped[Driver] = relationship(back_populates="documents", lazy="raise")

    __table_args__ = (
        sa.CheckConstraint(
            "issued_on IS NULL OR expires_on IS NULL OR expires_on >= issued_on",
            name="ck_driver_documents_dates_ordered",
        ),
        sa.Index("ix_driver_documents_driver_type", "driver_id", "doc_type"),
        sa.Index(
            "ix_driver_documents_expiry",
            "expires_on",
            postgresql_where=sa.text("status <> 'EXPIRED'"),
        ),
    )
