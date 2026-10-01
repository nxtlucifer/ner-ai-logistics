"""Administrative geography, two scoped manager roles, and a durable inbox.

Additive throughout. Every new column on an existing table is nullable or has
a server default, so rows written before this migration stay valid and no
backfill has to guess which district an old shipment belonged to.

WHAT IS DELIBERATELY NOT DONE HERE

No district rows. The eight states are seeded because their names and
existence are not in question; districts are a government notification that
has changed repeatedly and is disputed in places, and no verified official
source was reachable when this migration was written. Seeding a plausible
list would make a guess indistinguishable from a gazette. The table carries
`source_name` and `source_effective_date` precisely so that cannot happen
quietly - see docs/STATE_DISTRICT_RBAC_AND_NOTIFICATIONS.md.

No backfill of shipment districts, for the same reason: placing an existing
pickup point in a district needs an authoritative boundary set this project
does not have.

PRECONDITION FOR `ck_users_role_scope`

The constraint is added in the same migration that creates the two roles, so
on any database that has not run this before, no row can violate it. The one
way to meet a CheckViolation here is a RE-upgrade after a downgrade, where
scoped users survive but their scope columns were dropped. That failure is
correct and loud: the rows are real accounts with no scope, and the operator
must decide what happens to them. Demote or deactivate them, then upgrade
again - do NOT add the constraint NOT VALID to get past it.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013_state_district_inbox"
down_revision: str | None = "0012_push_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STATES = [
    ("Arunachal Pradesh", "arunachal-pradesh"),
    ("Assam", "assam"),
    ("Manipur", "manipur"),
    ("Meghalaya", "meghalaya"),
    ("Mizoram", "mizoram"),
    ("Nagaland", "nagaland"),
    ("Sikkim", "sikkim"),
    ("Tripura", "tripura"),
]

#: Why these eight and not "the North-East": the project's scope is the eight
#: states named in the problem statement and in every hazard document it
#: reads. Recorded on the row so nobody has to guess later.
STATE_SOURCE = (
    "SIH26002 problem statement (MDoNER): the eight North Eastern Region states. "
    "Names as used by the Ministry of Development of North Eastern Region."
)


def upgrade() -> None:
    # A district row can come from a gazette, a demo seed or a test
    # fixture, and only the first two may be counted as operational. The
    # default is UNVERIFIED so anything inserted without thinking about
    # provenance is excluded rather than silently included.
    district_source = postgresql.ENUM(
        "VERIFIED_OFFICIAL", "DEMO", "TEST", "UNVERIFIED",
        name="district_source", create_type=False,
    )

    # --- Two scoped roles, FIRST --------------------------------------------
    #
    # `autocommit_block` commits everything Alembic has done so far, so this
    # has to run before any other statement or a later failure leaves half a
    # migration committed with no way back. PostgreSQL also refuses to USE a
    # new enum value in the transaction that added it, and the check
    # constraint below names both values - so they must be committed first.
    # IF NOT EXISTS keeps a re-run after a failed attempt working.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'NORTH_EAST_MANAGER'")
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'STATE_MANAGER'")
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'DISTRICT_MANAGER'")

    # --- Geography --------------------------------------------------------
    op.create_table(
        "states",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column("source_name", sa.Text, nullable=False),
        sa.Column("source_effective_date", sa.Date, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("slug", name="uq_states_slug"),
    )
    district_source.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "districts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("state_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("states.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("slug", sa.String(120), nullable=False),
        sa.Column("source_name", sa.Text, nullable=False),
        sa.Column("source_status", district_source, nullable=False, server_default="UNVERIFIED"),
        sa.Column("source_effective_date", sa.Date, nullable=True),
        sa.Column("disputed_or_recently_changed", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("state_id", "slug", name="uq_districts_state_slug"),
    )
    op.create_index("ix_districts_state_id", "districts", ["state_id"])
    # RLS ON, AND DELIBERATELY NO POLICY.
    #
    # Every table here is read by the API, which connects as the owner and is
    # not subject to RLS; scope is enforced in app/core/scope.py against a
    # request's authenticated user, which is the only place that knows who is
    # asking. RLS is the second lock: enabled with no policy, these tables are
    # closed to Supabase's `authenticated` role, so a client that reaches
    # PostgREST with a valid Supabase JWT still reads nothing.
    #
    # If a policy is ever added here it must be because a client genuinely
    # needs direct table access - not to make an error go away.
    for table in ("states", "districts"):
        op.execute(f"CREATE TRIGGER trg_{table}_set_updated_at BEFORE UPDATE ON {table} "
                   "FOR EACH ROW EXECUTE FUNCTION set_updated_at()")
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")

    op.bulk_insert(
        sa.table(
            "states",
            sa.column("name", sa.String),
            sa.column("slug", sa.String),
            sa.column("source_name", sa.Text),
        ),
        [{"name": n, "slug": s, "source_name": STATE_SOURCE} for n, s in STATES],
    )

    # --- Scope on the principal -------------------------------------------
    op.add_column("users", sa.Column("state_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("states.id", ondelete="RESTRICT"), nullable=True))
    op.add_column("users", sa.Column("district_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("districts.id", ondelete="RESTRICT"), nullable=True))
    op.add_column("users", sa.Column("must_reset_password", sa.Boolean, nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
    # Presence is derived from this timestamp on read, never stored as a word.
    op.add_column("users", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_state_id", "users", ["state_id"])
    op.create_index("ix_users_district_id", "users", ["district_id"])

    # A scoped role with no scope is the failure that turns the hierarchy into
    # decoration, so the database refuses it outright. Written to allow every
    # pre-existing role unchanged.
    op.create_check_constraint(
        "ck_users_role_scope",
        "users",
        "(role = 'STATE_MANAGER' AND state_id IS NOT NULL AND district_id IS NULL) "
        "OR (role = 'DISTRICT_MANAGER' AND state_id IS NOT NULL AND district_id IS NOT NULL) "
        "OR role NOT IN ('STATE_MANAGER', 'DISTRICT_MANAGER')",
    )

    # One active manager per state, and one per district. Partial unique
    # indexes so a deactivated predecessor stays on the record.
    op.create_index(
        "uq_active_state_manager", "users", ["state_id"], unique=True,
        postgresql_where=sa.text("role = 'STATE_MANAGER' AND is_active"),
    )
    op.create_index(
        "uq_active_district_manager", "users", ["district_id"], unique=True,
        postgresql_where=sa.text("role = 'DISTRICT_MANAGER' AND is_active"),
    )

    # --- Which districts a job touches ------------------------------------
    op.add_column("shipments", sa.Column("origin_district_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("districts.id", ondelete="RESTRICT"), nullable=True))
    op.add_column("shipments", sa.Column("destination_district_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("districts.id", ondelete="RESTRICT"), nullable=True))
    op.create_index("ix_shipments_origin_district_id", "shipments", ["origin_district_id"])
    op.create_index("ix_shipments_destination_district_id", "shipments", ["destination_district_id"])

    # --- A truck the yard can name ----------------------------------------
    #
    # Nullable, and the registration keeps its unique constraint: a name is
    # what people say, a plate is what identifies the vehicle to anyone
    # outside the company, and swapping one for the other would lose the
    # second.
    op.add_column("trucks", sa.Column("display_name", sa.String(60), nullable=True))

    # --- The inbox --------------------------------------------------------
    notification_kind = postgresql.ENUM(
        "TRIP_DISPATCHED", "INCOMING_TRIP", "ROUTE_CHANGED", "TRIP_DELAYED",
        "TRIP_ARRIVED", "TRIP_DELIVERED", "DRIVER_EMERGENCY_STOP",
        "EMERGENCY_RESOLVED", "ROUTE_APPROVED",
        name="notification_kind",
        create_type=False,
    )
    notification_severity = postgresql.ENUM(
        "INFO", "WARNING", "URGENT", name="notification_severity", create_type=False
    )
    notification_kind.create(op.get_bind(), checkfirst=True)
    notification_severity.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("recipient_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=True),
        sa.Column("kind", notification_kind, nullable=False),
        sa.Column("severity", notification_severity, nullable=False, server_default="INFO"),
        sa.Column("payload", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("dedupe_key", sa.String(200), nullable=False),
        sa.Column("is_read", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("recipient_user_id", "dedupe_key", name="uq_notifications_recipient_dedupe"),
    )
    op.create_index("ix_notifications_recipient_user_id", "notifications", ["recipient_user_id"])
    op.create_index("ix_notifications_trip_id", "notifications", ["trip_id"])
    op.execute("CREATE INDEX ix_notifications_recipient_created ON notifications "
               "(recipient_user_id, created_at DESC)")
    # Closed to PostgREST for the reason above. An inbox is the one table
    # where a permissive policy would be most tempting and most costly.
    op.execute("ALTER TABLE notifications ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    # The two enum VALUES cannot be removed - PostgreSQL has no DROP VALUE -
    # so a downgrade leaves them in the type. Harmless: no row can use them
    # once the check constraint and the role rows are gone, and re-running the
    # upgrade is idempotent because it uses ADD VALUE IF NOT EXISTS.
    op.drop_table("notifications")
    sa.Enum(name="notification_kind").drop(op.get_bind())
    sa.Enum(name="notification_severity").drop(op.get_bind())

    op.drop_column("trucks", "display_name")

    op.drop_index("ix_shipments_destination_district_id", table_name="shipments")
    op.drop_index("ix_shipments_origin_district_id", table_name="shipments")
    op.drop_column("shipments", "destination_district_id")
    op.drop_column("shipments", "origin_district_id")

    op.drop_index("uq_active_district_manager", table_name="users")
    op.drop_index("uq_active_state_manager", table_name="users")
    op.drop_constraint("ck_users_role_scope", "users", type_="check")
    op.drop_index("ix_users_district_id", table_name="users")
    op.drop_index("ix_users_state_id", table_name="users")
    op.drop_column("users", "last_seen_at")
    op.drop_column("users", "created_by_user_id")
    op.drop_column("users", "must_reset_password")
    op.drop_column("users", "district_id")
    op.drop_column("users", "state_id")

    op.drop_index("ix_districts_state_id", table_name="districts")
    op.drop_table("districts")
    sa.Enum(name="district_source").drop(op.get_bind(), checkfirst=True)
    op.drop_table("states")
