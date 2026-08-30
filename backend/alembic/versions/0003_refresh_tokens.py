"""Refresh token storage for rotating sessions with reuse detection.

See app/models/auth.py for why rotation works on token families.

Revision ID: 0003_refresh_tokens
Revises: 0002_core_domain
Create Date: 2026-08-30

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_refresh_tokens"
down_revision: str | None = "0002_core_domain"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "refresh_tokens",
        sa.Column(
            "id", sa.Uuid(as_uuid=True), primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("family_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column(
            "issued_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.String(40), nullable=True),
        sa.Column(
            "replaced_by_id", sa.Uuid(as_uuid=True),
            sa.ForeignKey("refresh_tokens.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("user_agent", sa.String(255), nullable=True),
        sa.Column("ip_address", postgresql.INET, nullable=True),
        sa.CheckConstraint(
            "expires_at > issued_at", name="ck_refresh_expiry_after_issue"
        ),
        comment="Opaque rotating refresh tokens; only SHA-256 digests are stored.",
    )
    op.create_index("uq_refresh_tokens_hash", "refresh_tokens", ["token_hash"], unique=True)
    op.create_index("ix_refresh_tokens_user", "refresh_tokens", ["user_id"])
    op.create_index("ix_refresh_tokens_family", "refresh_tokens", ["family_id"])
    op.create_index(
        "ix_refresh_tokens_active_expiry", "refresh_tokens", ["expires_at"],
        postgresql_where=sa.text("revoked_at IS NULL"),
    )

    # Same rule as every other table: `public` is published by the Supabase Data
    # API, and this table holds session material. RLS with no policies denies
    # all API access; the backend bypasses RLS as table owner.
    op.execute("ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("refresh_tokens")
