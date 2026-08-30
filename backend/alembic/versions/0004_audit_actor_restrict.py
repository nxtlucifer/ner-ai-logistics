"""Make audit_logs.actor_user_id RESTRICT instead of SET NULL.

Two decisions from migration 0002 turned out to be mutually incompatible:

  - audit_logs.actor_user_id was ON DELETE SET NULL
  - trg_audit_logs_append_only rejects UPDATE on audit_logs

SET NULL is implemented as an UPDATE, so the trigger blocks it. Deleting a user
who appears in the audit trail therefore failed with:

    CheckViolation: audit_logs is append-only; UPDATE is not permitted

which is a confusing way to learn about a real rule.

RESTRICT is the honest constraint. An audit row pins its actor: you cannot erase
who did something by deleting the user. That is the property the append-only
trigger exists to protect, so nulling the actor on delete was working against it
- an attacker able to delete a user could have anonymised their own trail.

Consequence for data retention (docs/SECURITY.md section 10): a user with audit
history is never hard-deleted. PII is removed by ANONYMISING the users row -
an UPDATE on `users`, which touches no audit record - not by DELETE.

Revision ID: 0004_audit_actor_restrict
Revises: 0003_refresh_tokens
Create Date: 2026-08-30

"""
from collections.abc import Sequence

from alembic import op

revision: str = "0004_audit_actor_restrict"
down_revision: str | None = "0003_refresh_tokens"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINT = "audit_logs_actor_user_id_fkey"


def upgrade() -> None:
    op.drop_constraint(CONSTRAINT, "audit_logs", type_="foreignkey")
    op.create_foreign_key(
        CONSTRAINT,
        "audit_logs",
        "users",
        ["actor_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.execute(
        "COMMENT ON COLUMN audit_logs.actor_user_id IS "
        "'RESTRICT, not SET NULL: an audit row pins its actor. NULL means the "
        "action was taken by the system or a scheduler, never that a user was "
        "deleted. Retention anonymises the users row instead.'"
    )


def downgrade() -> None:
    op.execute("COMMENT ON COLUMN audit_logs.actor_user_id IS NULL")
    op.drop_constraint(CONSTRAINT, "audit_logs", type_="foreignkey")
    op.create_foreign_key(
        CONSTRAINT,
        "audit_logs",
        "users",
        ["actor_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
