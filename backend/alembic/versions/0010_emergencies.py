"""Fleet Sentinel emergencies and deterministic safety incidents.

WHY THIS EXISTS

docs/ARCHITECTURE.md Diagram F, docs/DATA_MODEL.md section 11.
Fleet Sentinel monitors active trips deterministically. When a vehicle is
stationary for >= 60 minutes outside approved geofenced stops, a check-in is
issued to the driver with a 30-minute deadline.

THE PARTIAL UNIQUE INDEX - THE CORE SAFETY INVARIANT

A single stuck truck must NEVER generate multiple open emergencies or spam
the driver with checks. The monitor runs every 5 minutes against a 60-minute
window, re-observing the same stationary truck ~12 times. The partial unique index
`uq_open_emergency_per_trip` enforces at the database level that only one open
incident can exist per trip.

ROW LEVEL SECURITY

Enabled on `emergencies` to contain the Supabase Data API, per AGENTS.md.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010_emergencies"
down_revision: str | None = "0009_route_maneuvers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    emergency_state = postgresql.ENUM(
        "DRIVER_CHECK_REQUIRED",
        "DRIVER_RESPONDED",
        "SOS_ESCALATED",
        "RESOLVED",
        "FALSE_ALARM",
        name="emergency_state",
    )
    emergency_state.create(op.get_bind(), checkfirst=True)

    driver_check_response = postgresql.ENUM(
        "I_AM_SAFE",
        "TRAFFIC",
        "ROAD_BLOCKED",
        "BREAKDOWN",
        "REST_STOP",
        "LOADING",
        "UNLOADING",
        "MEDICAL_ISSUE",
        "OTHER",
        "NEED_HELP",
        name="driver_check_response",
    )
    driver_check_response.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "emergencies",
        sa.Column(
            "id",
            sa.Uuid(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "trip_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("trips.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "state",
            postgresql.ENUM(
                "DRIVER_CHECK_REQUIRED",
                "DRIVER_RESPONDED",
                "SOS_ESCALATED",
                "RESOLVED",
                "FALSE_ALARM",
                name="emergency_state",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "triggered_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("stationary_since", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "last_gps_point_id",
            sa.BigInteger,
            sa.ForeignKey("gps_points.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("check_sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "response_deadline_at", sa.DateTime(timezone=True), nullable=False
        ),
        sa.Column(
            "driver_response",
            postgresql.ENUM(
                "I_AM_SAFE",
                "TRAFFIC",
                "ROAD_BLOCKED",
                "BREAKDOWN",
                "REST_STOP",
                "LOADING",
                "UNLOADING",
                "MEDICAL_ISSUE",
                "OTHER",
                "NEED_HELP",
                name="driver_check_response",
                create_type=False,
            ),
            nullable=True,
        ),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("escalated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "resolved_by_user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("resolution_note", sa.Text, nullable=True),
        sa.Column(
            "briefing_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        comment="Fleet Sentinel deterministic safety incidents and SOS escalations.",
    )

    # Partial unique index: at most ONE open emergency per trip
    op.create_index(
        "uq_open_emergency_per_trip",
        "emergencies",
        ["trip_id"],
        unique=True,
        postgresql_where=sa.text(
            "state IN ('DRIVER_CHECK_REQUIRED', 'DRIVER_RESPONDED', 'SOS_ESCALATED')"
        ),
    )

    op.create_index(
        "ix_emergencies_trip_id",
        "emergencies",
        ["trip_id", sa.text("triggered_at DESC")],
    )

    # Required by AGENTS.md: enable RLS on every table
    op.execute("ALTER TABLE emergencies ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("emergencies")
    postgresql.ENUM(name="driver_check_response").drop(
        op.get_bind(), checkfirst=True
    )
    postgresql.ENUM(name="emergency_state").drop(op.get_bind(), checkfirst=True)
