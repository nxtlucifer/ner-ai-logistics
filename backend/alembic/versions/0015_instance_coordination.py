"""Three small tables that let more than one API instance share what one
process used to keep in memory (services/coordination.py).

  instance_leases     who runs the background loops that write rows and send
                      pushes (route watch, sentinel) - one leader per loop,
                      by expiry
  rate_limit_windows  the login / refresh fixed windows, one row per key
  provider_pacing     the next free slot for a rate-limited provider
                      (Nominatim: one request per second, across instances)

Read and written only when MULTI_INSTANCE is true; a single instance never
touches them. Additive; downgrade drops all three.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_instance_coordination"
down_revision: str | None = "0014_shipment_state_geography"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("instance_leases", "rate_limit_windows", "provider_pacing")


def upgrade() -> None:
    op.create_table(
        "instance_leases",
        sa.Column("name", sa.Text, primary_key=True),
        sa.Column("holder", sa.Text, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "rate_limit_windows",
        sa.Column("key", sa.Text, primary_key=True),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("hits", sa.Integer, nullable=False),
    )
    op.create_table(
        "provider_pacing",
        sa.Column("name", sa.Text, primary_key=True),
        sa.Column("next_at", sa.DateTime(timezone=True), nullable=False),
    )
    # RLS on, no policy - the same second lock as every other table (see 0013):
    # the API connects as the owner; the Supabase Data API reads nothing here.
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_table(table)
