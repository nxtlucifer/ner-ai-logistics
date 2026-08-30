"""Append-only audit trail."""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import pg_enum, uuid_pk  # noqa: F401  (uuid_pk kept for parity)
from app.models.enums import AuditAction


class AuditLog(Base):
    """Who changed what, when, and why.

    Append-only, enforced by a database trigger rather than by revoking
    privileges. The application connects to Supabase as the table owner, and an
    owner cannot be denied UPDATE/DELETE through GRANT - so a trigger is the only
    mechanism that actually holds. See migration 0002.

    Distinct from `trip_events`: that records what happened on the road, this
    records who touched a record. Compliance reads this one.
    """

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=True)
    # RESTRICT, not SET NULL: an audit row pins its actor. SET NULL is executed
    # as an UPDATE, which the append-only trigger blocks anyway - and nulling
    # the actor on delete would let anyone able to delete a user anonymise their
    # own trail, defeating the point of the trigger.
    #
    # NULL therefore means the action was taken by the system or a scheduler,
    # never that a user was removed. Retention anonymises the users row instead;
    # see docs/SECURITY.md section 10.
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        comment=(
            "RESTRICT, not SET NULL: an audit row pins its actor. NULL means "
            "the action was taken by the system or a scheduler, never that a "
            "user was deleted. Retention anonymises the users row instead."
        ),
    )
    action: Mapped[AuditAction] = mapped_column(pg_enum(AuditAction), nullable=False)
    entity_type: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.Uuid(as_uuid=True), nullable=True
    )
    before: Mapped[dict | None] = mapped_column(postgresql.JSONB, nullable=True)
    after: Mapped[dict | None] = mapped_column(postgresql.JSONB, nullable=True)
    reason: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(postgresql.INET, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )

    __table_args__ = (
        sa.Index(
            "ix_audit_logs_entity",
            "entity_type",
            "entity_id",
            sa.text("created_at DESC"),
        ),
        sa.Index("ix_audit_logs_actor", "actor_user_id", sa.text("created_at DESC")),
        {
            "comment": (
                "Append-only. UPDATE and DELETE are rejected by "
                "trg_audit_logs_append_only."
            )
        },
    )
