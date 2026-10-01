"""Driver breaks: a planned 15/30-minute stop, its reason, place and end.

One table, three timeline kinds and three inbox kinds. The trip's status does
not change during a break, so no lifecycle code has to learn a new state.

The pdf branch's `device_events` (never applied anywhere) now follows as 0018.

Revision ID: 0017_trip_breaks
Revises: 0016_geography_boundaries
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geography
from sqlalchemy.dialects import postgresql

revision: str = "0017_trip_breaks"
down_revision: str | None = "0016_geography_boundaries"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Enum values first and committed: PostgreSQL refuses to use a value in
    # the transaction that added it (see 0013). IF NOT EXISTS makes a re-run safe.
    with op.get_context().autocommit_block():
        for value in ("BREAK_STARTED", "BREAK_ENDED", "BREAK_OVERDUE"):
            op.execute(f"ALTER TYPE trip_event_kind ADD VALUE IF NOT EXISTS '{value}'")
        for value in ("DRIVER_BREAK_STARTED", "DRIVER_BREAK_ENDED", "DRIVER_BREAK_OVERDUE"):
            op.execute(f"ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS '{value}'")

    op.create_table(
        "trip_breaks",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("trip_id", sa.Uuid(as_uuid=True), sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=False),
        sa.Column("driver_id", sa.Uuid(as_uuid=True), sa.ForeignKey("drivers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("truck_id", sa.Uuid(as_uuid=True), sa.ForeignKey("trucks.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("request_id", sa.Uuid(as_uuid=True), nullable=False, unique=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("planned_minutes", sa.SmallInteger, nullable=False),
        sa.Column("reason", sa.String(20), nullable=False),
        sa.Column("note", sa.String(200), nullable=True),
        sa.Column("location", Geography(geometry_type="POINT", srid=4326, spatial_index=False), nullable=True),
        sa.Column("location_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("location_source", sa.String(12), nullable=True),
        sa.Column("nav_state", postgresql.JSONB, nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("overdue_alerted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_by_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("ended_by_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint("planned_minutes IN (15, 30)", name="ck_trip_breaks_minutes"),
        sa.CheckConstraint(
            "reason IN ('TEA_REST', 'FOOD', 'WASHROOM', 'FUEL', 'EMERGENCY', 'OTHER')",
            name="ck_trip_breaks_reason",
        ),
        sa.CheckConstraint("ended_at IS NULL OR ended_at >= started_at", name="ck_trip_breaks_order"),
        comment="Driver breaks: planned length, reason, where, and when the truck moved on.",
    )
    op.create_index("ix_trip_breaks_trip_time", "trip_breaks", ["trip_id", sa.text("started_at DESC")])
    op.create_index(
        "uq_trip_breaks_one_open", "trip_breaks", ["trip_id"], unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
    )
    # Like every public table: no policy means no access through PostgREST's
    # anon/authenticated roles; the API connects as the owner.
    op.execute("ALTER TABLE trip_breaks ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    # The enum VALUES stay (PostgreSQL has no DROP VALUE); nothing uses them
    # once the table is gone.
    op.drop_index("uq_trip_breaks_one_open", table_name="trip_breaks")
    op.drop_index("ix_trip_breaks_trip_time", table_name="trip_breaks")
    op.drop_table("trip_breaks")
