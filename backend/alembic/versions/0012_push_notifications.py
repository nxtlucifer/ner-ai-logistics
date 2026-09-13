"""Driver push token + one row per notification (audit and dedupe).

Background Android alerts cannot come from the app's own polling (JS timers
stop when the activity pauses), so the backend pushes through Expo. The token
lives on the driver row - one phone per driver is the fleet reality today.
ponytail: a per-device table when a driver carries two phones.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012_push_notifications"
down_revision: str | None = "0011_files_verification"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("drivers", sa.Column("push_token", sa.String(200), nullable=True))
    op.create_table(
        "driver_notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("driver_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("drivers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("trips.id", ondelete="SET NULL"), nullable=True),
        sa.Column("event", sa.String(40), nullable=False),
        sa.Column("fingerprint", sa.String(200), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("delivery", sa.String(40), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_driver_notifications_fingerprint", "driver_notifications", ["fingerprint", "sent_at"])
    op.create_index("ix_driver_notifications_driver_id", "driver_notifications", ["driver_id"])
    op.execute("ALTER TABLE driver_notifications ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_driver_notifications_driver_id", table_name="driver_notifications")
    op.drop_index("ix_driver_notifications_fingerprint", table_name="driver_notifications")
    op.drop_table("driver_notifications")
    op.drop_column("drivers", "push_token")
