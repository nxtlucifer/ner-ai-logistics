"""Widen the assignment uniqueness invariant to cover PENDING_VERIFICATION.

Migration 0002 created two partial unique indexes:

    uq_active_assignment_driver  ... WHERE status = 'ACTIVE'
    uq_active_assignment_truck   ... WHERE status = 'ACTIVE'

The intent, stated in the model, was "a driver cannot hold two trucks at once
and a truck cannot have two drivers". The predicate does not express that,
because ACTIVE is not the only status in which a driver holds a truck.

A reported registration mismatch moves an assignment to PENDING_VERIFICATION.
The driver keeps the vehicle - that is the whole point, a mismatch flags for a
manager and never strands the driver - so the assignment is still current. But
it fell outside the index predicate, and outside the service-layer pre-check,
which also matched only ACTIVE. So:

    assign driver -> truck A            ACTIVE
    driver reports a different reg      PENDING_VERIFICATION
    assign driver -> truck B            ACTIVE, and A was never ended

leaving the driver holding two trucks simultaneously, with nothing in the
database objecting.

P5 turned that from untidy into unsafe. `trips.open_assignment_for()` accepts
either status, so a trip on truck A remained startable by a driver who had been
moved to truck B - and the start gate would have confirmed a "valid" assignment
for a vehicle nobody had reassigned them to.

The service layer is fixed alongside this, but the service layer was already
supposed to be the *convenience* check: the module docstring in
app/services/assignments.py says the indexes are the authority, precisely
because a SELECT-then-INSERT pre-check cannot survive two concurrent requests.
An authority that does not cover the case is not an authority, so the predicate
has to change too.

Renamed from `uq_active_*` to `uq_current_*`: the old name says exactly the
thing that was wrong.

DATA REPAIR
-----------
`CREATE UNIQUE INDEX` fails if existing rows violate it, and any database that
ran the buggy code may hold such rows - they are the artefact of this defect.
The upgrade ends the older duplicates first, keeping the most recently assigned
open row per driver and per truck, which is the one the application was already
treating as current (`ORDER BY assigned_at DESC`). Nothing is deleted; the
history stays, with `status = ENDED` and `ended_at` set.

Revision ID: 0006_current_assignment_unique
Revises: 0005_trip_event_location_null
Create Date: 2026-08-30

"""
from collections.abc import Sequence

from alembic import op

revision: str = "0006_current_assignment_unique"
down_revision: str | None = "0005_trip_event_location_null"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OPEN = "status IN ('ACTIVE','PENDING_VERIFICATION')"

#: End every open assignment except the newest, per `column`.
REPAIR = """
    UPDATE driver_truck_assignments SET
        status = 'ENDED',
        ended_at = COALESCE(ended_at, now())
    WHERE id IN (
        SELECT id FROM (
            SELECT id, row_number() OVER (
                PARTITION BY {column}
                ORDER BY assigned_at DESC, id DESC
            ) AS rank
            FROM driver_truck_assignments
            WHERE {open}
        ) ranked
        WHERE ranked.rank > 1
    )
"""


def upgrade() -> None:
    # Driver first, then truck: ending a driver's duplicates can also resolve a
    # truck duplicate, so the second pass has less to do and never contradicts
    # the first.
    op.execute(REPAIR.format(column="driver_id", open=OPEN))
    op.execute(REPAIR.format(column="truck_id", open=OPEN))

    op.execute("DROP INDEX IF EXISTS uq_active_assignment_driver")
    op.execute("DROP INDEX IF EXISTS uq_active_assignment_truck")

    op.execute(
        "CREATE UNIQUE INDEX uq_current_assignment_driver "
        f"ON driver_truck_assignments (driver_id) WHERE {OPEN}"
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_current_assignment_truck "
        f"ON driver_truck_assignments (truck_id) WHERE {OPEN}"
    )


def downgrade() -> None:
    """Return to the narrower ACTIVE-only predicate.

    Always succeeds: narrowing a unique index cannot be violated by rows that
    satisfied the wider one. The rows this upgrade ended are not resurrected -
    they were duplicates that should never have existed, and inventing a second
    current assignment to undo a repair would reintroduce the defect.
    """
    op.execute("DROP INDEX IF EXISTS uq_current_assignment_driver")
    op.execute("DROP INDEX IF EXISTS uq_current_assignment_truck")

    op.execute(
        "CREATE UNIQUE INDEX uq_active_assignment_driver "
        "ON driver_truck_assignments (driver_id) WHERE status = 'ACTIVE'"
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_active_assignment_truck "
        "ON driver_truck_assignments (truck_id) WHERE status = 'ACTIVE'"
    )
