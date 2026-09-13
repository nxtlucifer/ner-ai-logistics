"""Private file store, verification source, generic government-ID document type.

WHY A TABLE AND NOT A BUCKET

This deployment has no object-storage credential of its own (the backend holds
only the Supabase anon key, and a bucket writable with an anon key is a public
bucket). The smallest PRIVATE store that exists today is Postgres: one row per
file, bytes in a `bytea`, every read through an authorised endpoint that checks
ownership or role. Files are capped at 5 MB in the API, JPEG/PNG/PDF only, so
the table stays a few hundred MB even with photos on every trip.

ponytail: move to an object store (S3-compatible, private, signed URLs) when a
fleet uploads more than the free database tier holds; the API path stays
`/api/files/{id}` either way, so no client changes.

`verification_source` says WHO verified a truck: the driver with a photo on the
phone, the driver without one, or a manager by hand for a driver with no
smartphone. Never pretend a photo exists.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011_files_verification"
down_revision: str | None = "0010_emergencies"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "stored_files",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("owner_driver_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("drivers.id", ondelete="CASCADE"), nullable=True),
        sa.Column("uploaded_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("content_type", sa.String(64), nullable=False),
        sa.Column("size_bytes", sa.Integer, nullable=False),
        sa.Column("data", postgresql.BYTEA, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("size_bytes > 0 AND size_bytes <= 5242880", name="ck_stored_files_size"),
    )
    op.create_index("ix_stored_files_owner_driver_id", "stored_files", ["owner_driver_id"])
    op.execute("ALTER TABLE stored_files ENABLE ROW LEVEL SECURITY")

    op.add_column(
        "driver_truck_assignments",
        sa.Column("verification_source", sa.String(32), nullable=True),
    )
    # PostgreSQL 12+ allows ADD VALUE inside a transaction as long as the new
    # value is not used in the same transaction - and nothing here uses it.
    op.execute("ALTER TYPE driver_document_type ADD VALUE IF NOT EXISTS 'GOVERNMENT_ID'")


def downgrade() -> None:
    op.drop_column("driver_truck_assignments", "verification_source")
    op.drop_index("ix_stored_files_owner_driver_id", table_name="stored_files")
    op.drop_table("stored_files")
    # Enum values cannot be dropped in PostgreSQL; GOVERNMENT_ID stays.
