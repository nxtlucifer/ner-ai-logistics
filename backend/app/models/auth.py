"""Refresh token storage.

Refresh tokens are opaque and rotating, per docs/SECURITY.md section 1. Only a
SHA-256 digest is stored, so a database disclosure does not hand an attacker
usable sessions.

Rotation with reuse detection works on token *families*. Every refresh issues a
new token carrying the same `family_id` and marks its predecessor used. If a
token that has already been used is presented again, the only explanations are a
stolen token or a client bug - and since we cannot tell which, the entire family
is revoked. That is how theft is actually caught: the legitimate client and the
attacker cannot both keep refreshing.
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import uuid_pk


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # SHA-256 hex digest. The token itself is never stored.
    token_hash: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    # Groups every token descended from one login, so a detected reuse can
    # revoke the whole lineage rather than just the replayed token.
    family_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid(as_uuid=True), nullable=False)

    issued_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )
    expires_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False
    )
    # Set when the token is rotated away or explicitly revoked.
    revoked_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    revoked_reason: Mapped[str | None] = mapped_column(sa.String(40), nullable=True)
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("refresh_tokens.id", ondelete="SET NULL"), nullable=True
    )

    user_agent: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(postgresql.INET, nullable=True)

    __table_args__ = (
        sa.CheckConstraint("expires_at > issued_at", name="ck_refresh_expiry_after_issue"),
        sa.Index("uq_refresh_tokens_hash", "token_hash", unique=True),
        sa.Index("ix_refresh_tokens_user", "user_id"),
        sa.Index("ix_refresh_tokens_family", "family_id"),
        # Supports the expiry sweep without scanning the table.
        sa.Index(
            "ix_refresh_tokens_active_expiry",
            "expires_at",
            postgresql_where=sa.text("revoked_at IS NULL"),
        ),
        {"comment": "Opaque rotating refresh tokens; only SHA-256 digests are stored."},
    )
