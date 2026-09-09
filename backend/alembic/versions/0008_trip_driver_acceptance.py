"""Driver acknowledgment of a dispatched trip, distinct from starting travel.

WHY THIS EXISTS

The driver app is being restructured (LS-12 G1A) so the main page shows a
pending assignment with an **Accept trip** action, and the dedicated Map page
opens only after the SERVER confirms acceptance.

Before this revision the driver lifecycle had exactly two acknowledgments and
neither one means "I accept this job":

    POST /api/driver/me/assignment/verify   the driver confirms the TRUCK's
                                            registration. About the vehicle,
                                            not about the trip.
    POST /api/driver/me/trip/start          ASSIGNED -> ACTIVE. This puts the
                                            truck on the road, starts GPS
                                            reporting, moves driver and truck
                                            to ON_TRIP and makes both
                                            unavailable to the planner.

Relabelling `start` as "Accept" was explicitly refused by the mission brief,
and it would be wrong on its own terms: a driver who has read and accepted a
job at the depot has not begun travelling, and a dispatcher reading ACTIVE
would believe a truck was moving that is still parked.

WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT

Two nullable columns and one event kind. That is the whole change.

    trips.driver_accepted_at    when the assigned driver acknowledged the trip
    trips.driver_accepted_by    WHICH driver did, so it cannot be inherited

The second column is not bookkeeping. `driver_accepted_at` lives on the TRIP,
so if a trip were ever handed to a different driver the stamp would travel with
it and the new driver's app would open showing a job they had never seen as
already accepted - by them. Storing the accepting driver makes that
structurally impossible: the read model returns an acceptance only when it
belongs to the driver asking, so a reassigned trip reads as unaccepted without
anything having to remember to clear it.

The alternative - clearing the timestamp wherever `trips.driver_id` changes -
was rejected because no such reassignment path exists in this codebase today.
That guard would be unreachable code protecting against a future edit, which is
exactly the kind of guard that is quietly dropped when the edit finally lands.

There is NO new TripStatus and NO change to `app/domain/trip_state.py`. The
lifecycle is untouched: a trip stays ASSIGNED after acceptance and `start`
still performs exactly the same transition, under exactly the same gates, with
`can_start` still computed by the same function the write endpoint uses. So
every LS-9/10/11 invariant - the hazard refusal, the review authorisation, the
trip lock, the reroute rules - is unaffected by design rather than by
inspection: none of them reads this column.

Acceptance is therefore an ACKNOWLEDGMENT, not a gate. It does not grant route
review permission, does not choose a route, does not mark a road safe, and
does not make an ineligible trip startable.

NULLABLE, WITH NO BACKFILL

Existing trips get NULL, meaning "never acknowledged through this flow", which
is the truth for every trip created before it existed. Backfilling
`dispatched_at` into it would manufacture an acknowledgment by a driver who
never gave one, on a column whose only purpose is to record that they did.

IDEMPOTENCY IS ENFORCED IN THE SERVICE, NOT HERE

`driver_trips.accept()` returns the existing timestamp when one is already
set, under the same row lock every other trip mutation takes, so a double tap
on a flaky link cannot produce two different acceptance times. A UNIQUE
constraint would be the wrong tool - there is one row and one column, and the
race is a lost-update race, which the lock already covers.

ENUM VALUE

`ACCEPTED` joins `trip_event_kind` so the manager timeline can show that the
driver acknowledged the job. `ALTER TYPE ... ADD VALUE` runs inside a
transaction block on PostgreSQL 12+ (verified on the 18.2 cluster this
targets); the restriction is that the new value must not be USED in the same
transaction, and nothing here writes an event row.

As in 0007, the enum value is NOT removed on downgrade. PostgreSQL cannot drop
an enum value, and a `downgrade()` that claimed to reverse itself would be
lying. The column is dropped; the value is left and documented.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_trip_driver_acceptance"
down_revision: str | None = "0007_route_review_authorizations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "trips",
        sa.Column(
            "driver_accepted_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment=(
                "When the assigned driver acknowledged this trip. NOT a "
                "lifecycle state and not a start gate - see 0008 docstring."
            ),
        ),
    )

    op.add_column(
        "trips",
        sa.Column(
            "driver_accepted_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("drivers.id", ondelete="RESTRICT"),
            nullable=True,
            comment=(
                "Which driver acknowledged this trip. RESTRICT, like every "
                "other actor reference: an acknowledgment must not lose the "
                "person who gave it."
            ),
        ),
    )

    # Idempotent so a re-run against a cluster that already has the value does
    # not fail the whole revision.
    op.execute(
        "ALTER TYPE trip_event_kind ADD VALUE IF NOT EXISTS 'ACCEPTED'"
    )


def downgrade() -> None:
    op.drop_column("trips", "driver_accepted_by")
    op.drop_column("trips", "driver_accepted_at")
    # 'ACCEPTED' stays in trip_event_kind. PostgreSQL cannot drop an enum
    # value; see the module docstring.
