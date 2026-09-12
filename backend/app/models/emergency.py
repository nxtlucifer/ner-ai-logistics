"""Emergencies and Fleet Sentinel incident models.

docs/ARCHITECTURE.md Diagram F, docs/DATA_MODEL.md section 11.
"""

from datetime import datetime
from typing import Any
import uuid

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import pg_enum
from app.models.enums import DriverCheckResponse, EmergencyState


class Emergency(Base):
    """A safety incident raised deterministically by Fleet Sentinel or by driver SOS."""

    __tablename__ = "emergencies"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    )

    trip_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=False
    )

    state: Mapped[EmergencyState] = mapped_column(
        pg_enum(EmergencyState), nullable=False
    )

    triggered_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )

    stationary_since: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False
    )

    last_gps_point_id: Mapped[int | None] = mapped_column(
        sa.BigInteger,
        sa.ForeignKey("gps_points.id", ondelete="SET NULL"),
        nullable=True,
    )

    check_sent_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False
    )

    response_deadline_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False
    )

    driver_response: Mapped[DriverCheckResponse | None] = mapped_column(
        pg_enum(DriverCheckResponse), nullable=True
    )

    responded_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )

    escalated_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )

    resolved_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )

    resolved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    resolution_note: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    briefing_snapshot: Mapped[dict[str, Any] | None] = mapped_column(
        postgresql.JSONB, nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )

    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )

    # Relationships
    trip = relationship("Trip", foreign_keys=[trip_id])
    resolved_by = relationship("User", foreign_keys=[resolved_by_user_id])

    __table_args__ = (
        sa.Index(
            "uq_open_emergency_per_trip",
            "trip_id",
            unique=True,
            postgresql_where=sa.text(
                "state IN ('DRIVER_CHECK_REQUIRED', 'DRIVER_RESPONDED', 'SOS_ESCALATED')"
            ),
        ),
        sa.Index(
            "ix_emergencies_trip_id",
            "trip_id",
            sa.text("triggered_at DESC"),
        ),
        {
            "comment": "Fleet Sentinel deterministic safety incidents and SOS escalations.",
        },
    )
