"""Make trip_events.location nullable, as migration 0002 intended.

Migration 0002 declares the column `nullable=True`:

    sa.Column("location", POINT, nullable=True)

and the database got NOT NULL anyway. The cause is a shared GeoAlchemy2 type
instance. `POINT` is one module-level `Geography(...)` object used by six
columns, and GeoAlchemy2 attaches a listener that reconciles nullability between
a column and its type (geoalchemy2/admin/__init__.py):

    if not getattr(column.type, "nullable", True):
        column.nullable = column.type.nullable   # the TYPE wins
    elif hasattr(column.type, "nullable"):
        column.type.nullable = column.nullable   # the COLUMN mutates the type

The first column declared `nullable=False` - shipments.pickup_location - writes
False onto the shared instance. Every later column then takes the first branch
and is forced NOT NULL regardless of its own declaration. `trip_events.location`
was the only column that wanted to be nullable, so it was the only casualty.

Why the drift check did not catch it: the ORM models used the same shared
constant, so `Base.metadata` was wrong in exactly the same way. Alembic compared
two identical mistakes and reported agreement.

Why it matters: most trip events have no position. A trip is CREATED and
ASSIGNED in an office, and STARTED, DELIVERED, CANCELLED and CLOSED are
lifecycle facts, not places. Requiring a location made the operational timeline
unwritable - the first attempt to record a STARTED event failed with a
NotNullViolation. The alternative, inventing a coordinate to satisfy the
constraint, would have put fictional points in a table used as incident
evidence.

app/models/operations.py now builds a fresh type instance per column, so the
column declaration is the single source of truth and this cannot recur.

Revision ID: 0005_trip_event_location_null
Revises: 0004_audit_actor_restrict
Create Date: 2026-08-30

"""
from collections.abc import Sequence

from alembic import op

revision: str = "0005_trip_event_location_null"
down_revision: str | None = "0004_audit_actor_restrict"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE trip_events ALTER COLUMN location DROP NOT NULL")
    op.execute(
        "COMMENT ON COLUMN trip_events.location IS "
        "'Where the event happened, when that is known. NULL for lifecycle "
        "events recorded away from the vehicle - CREATED, ASSIGNED, CLOSED.'"
    )


def downgrade() -> None:
    """Restore NOT NULL.

    This fails if any event row has a NULL location, which after any real use of
    the timeline it will. That is the correct behaviour: the alternative is
    inventing coordinates to satisfy a constraint that should not exist, and a
    fabricated position in a table used as incident evidence is worse than a
    failed downgrade.
    """
    op.execute("ALTER TABLE trip_events ALTER COLUMN location SET NOT NULL")
