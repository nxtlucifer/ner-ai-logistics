"""Audited single-use authorisation for routes with incomplete hazard evidence.

WHY THIS EXISTS

No landslide source is connected, so every route assesses UNKNOWN and
`refuse_if_ineligible` refuses every selection with
ROUTE_SELECTION_REQUIRES_REVIEW. That is correct safety behaviour and an
unusable product: nothing can be dispatched. The honest resolution is an
AUDITED authorisation - a named person accepting a specific, incomplete
evidence picture for ONE selection - not a switch that relabels UNKNOWN as
clear.

The full design argument, including why `audit_logs` cannot serve as the gate,
is in docs/migrations/PENDING_route_review_authorizations.sql. This revision is
that proposal, applied under the scope approved on 2026-09-05:

    reviewer authority   a distinct AUTHORISED_REVIEWER role
    expiry               30 minutes, single consumption
    authorisable basis   assessed HAZARD_DATA_UNKNOWN only

WHAT THIS CANNOT DO

Nothing here can authorise REJECTED (a verified closure) or NOT_ASSESSED (no
assessment ran). Those are refused in the service with no parameter that can
reach them. And consuming an authorisation does not change any assessment: the
route still reports UNKNOWN afterwards, which a test pins.

TWO ENUM CHANGES, ONE TRANSACTION

`ALTER TYPE ... ADD VALUE` runs inside a transaction block on PostgreSQL 12+,
verified on the 18.2 cluster this targets. The restriction that matters is that
the new value must not be USED in the same transaction - and nothing here
inserts a row with the new role. Reviewer accounts are created afterwards, by
ordinary application tooling, in their own transactions.

`AUTHORISED_REVIEWER` is NOT removed on downgrade. PostgreSQL cannot drop an
enum value; pretending otherwise in `downgrade()` would produce a migration that
claims to reverse itself and does not. It is left in place and documented.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007_route_review_authorizations"
down_revision: str | None = "0006_current_assignment_unique"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


#: Allows the row to move FORWARD through its lifecycle exactly once, and
#: forbids rewriting what was authorised or why.
#:
#: Not the same trigger as `audit_logs`, which forbids UPDATE entirely:
#: consumption and revocation are legitimate updates here. What must never
#: change is the authorised facts - who, which route, on what evidence, until
#: when - because an authorisation whose terms can be edited after the fact
#: authorises whatever someone later says it did.
#:
#: DELETE IS DELIBERATELY ALLOWED. An earlier draft forbade it, copying the
#: append-only rule from `audit_logs` - but `audit_logs` has no parent, and
#: these rows are declared ON DELETE CASCADE from trips and trip_routes. The two
#: contradicted each other: removing a trip became impossible, which broke
#: ordinary data management and the suite's own cleanup. The durable compliance
#: record is the audit_logs row written at issue and at consumption, whose
#: `entity_id` is a plain column rather than a foreign key, so it survives the
#: cascade. This table holds operational state whose parent's deletion
#: legitimately takes it with it.
IMMUTABLE_CORE = """
CREATE OR REPLACE FUNCTION trg_rra_immutable_core() RETURNS trigger AS $$
BEGIN
    IF NEW.trip_id           IS DISTINCT FROM OLD.trip_id
    OR NEW.route_id          IS DISTINCT FROM OLD.route_id
    OR NEW.evidence_digest   IS DISTINCT FROM OLD.evidence_digest
    OR NEW.evidence_snapshot IS DISTINCT FROM OLD.evidence_snapshot
    OR NEW.policy_version    IS DISTINCT FROM OLD.policy_version
    OR NEW.evidence_version  IS DISTINCT FROM OLD.evidence_version
    OR NEW.basis             IS DISTINCT FROM OLD.basis
    OR NEW.reviewer_user_id  IS DISTINCT FROM OLD.reviewer_user_id
    OR NEW.rationale         IS DISTINCT FROM OLD.rationale
    OR NEW.issued_at         IS DISTINCT FROM OLD.issued_at
    OR NEW.expires_at        IS DISTINCT FROM OLD.expires_at
    OR NEW.route_state_at_issue IS DISTINCT FROM OLD.route_state_at_issue THEN
        RAISE EXCEPTION 'the authorised facts of a review are immutable';
    END IF;
    IF OLD.consumed_at IS NOT NULL
       AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
        RAISE EXCEPTION 'a review authorization may only be consumed once';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
"""


def upgrade() -> None:
    # The new role. Powerless until app/core/permissions.py grants it something;
    # `permissions_for` returns an empty set for a role with no entry, which is
    # the intended fail-closed behaviour.
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'AUTHORISED_REVIEWER'")

    basis = postgresql.ENUM(
        "HAZARD_DATA_UNKNOWN",
        "HIGH_HAZARD_REPORTED",
        name="route_review_basis",
    )
    basis.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "route_review_authorizations",
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
            "route_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("trip_routes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("evidence_digest", sa.Text, nullable=False),
        sa.Column("evidence_snapshot", postgresql.JSONB, nullable=False),
        sa.Column("policy_version", sa.Text, nullable=False),
        sa.Column("evidence_version", sa.Text, nullable=False),
        sa.Column(
            "basis",
            postgresql.ENUM(name="route_review_basis", create_type=False),
            nullable=False,
        ),
        sa.Column("route_state_at_issue", sa.Text, nullable=False),
        sa.Column(
            "reviewer_user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("rationale", sa.Text, nullable=False),
        sa.Column(
            "issued_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "consumed_by_user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "revoked_by_user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("revoked_reason", sa.Text, nullable=True),
        sa.CheckConstraint("expires_at > issued_at", name="ck_rra_expiry_after_issue"),
        sa.CheckConstraint(
            "length(btrim(rationale)) >= 20", name="ck_rra_rationale_substantive"
        ),
        sa.CheckConstraint(
            "num_nonnulls(revoked_at, revoked_by_user_id) IN (0, 2)",
            name="ck_rra_revocation_complete",
        ),
        sa.CheckConstraint(
            "num_nonnulls(consumed_at, consumed_by_user_id) IN (0, 2)",
            name="ck_rra_consumption_complete",
        ),
        sa.CheckConstraint(
            "consumed_at IS NULL OR revoked_at IS NULL",
            name="ck_rra_not_both_consumed_and_revoked",
        ),
        comment=(
            "Single-use authorisation to select ONE route whose hazard evidence "
            "is incomplete. Never a statement that a road is clear; the route "
            "still reports UNKNOWN afterwards."
        ),
    )

    # At most one LIVE authorisation per route. One of three mechanisms - the
    # trips row lock orders concurrent selections and the conditional UPDATE
    # makes the claim atomic with the selection. This index alone does not make
    # consumption safe.
    op.create_index(
        "uq_rra_one_live_per_route",
        "route_review_authorizations",
        ["route_id"],
        unique=True,
        postgresql_where=sa.text("consumed_at IS NULL AND revoked_at IS NULL"),
    )
    op.create_index(
        "ix_rra_trip",
        "route_review_authorizations",
        ["trip_id", sa.text("issued_at DESC")],
    )
    op.create_index(
        "ix_rra_reviewer",
        "route_review_authorizations",
        ["reviewer_user_id", sa.text("issued_at DESC")],
    )

    # Required by AGENTS.md for every table: Supabase publishes `public` through
    # its Data API, so a table without RLS is readable by anyone holding the
    # anon key, bypassing FastAPI entirely. No policy is added - authorization
    # lives in FastAPI and the backend connects as a role with rolbypassrls.
    # RLS here contains the Data API and nothing else.
    op.execute(
        "ALTER TABLE route_review_authorizations ENABLE ROW LEVEL SECURITY"
    )

    op.execute(IMMUTABLE_CORE)
    op.execute(
        "CREATE TRIGGER trg_rra_immutable_core "
        "BEFORE UPDATE ON route_review_authorizations "
        "FOR EACH ROW EXECUTE FUNCTION trg_rra_immutable_core()"
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_rra_immutable_core "
        "ON route_review_authorizations"
    )
    op.execute("DROP FUNCTION IF EXISTS trg_rra_immutable_core()")
    op.drop_table("route_review_authorizations")
    postgresql.ENUM(name="route_review_basis").drop(op.get_bind(), checkfirst=True)
    # `user_role.AUTHORISED_REVIEWER` is deliberately NOT removed: PostgreSQL
    # has no DROP VALUE. Leaving it is harmless - a role with no
    # ROLE_PERMISSIONS entry resolves to no permissions at all.
