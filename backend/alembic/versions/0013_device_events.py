"""Device-originated trip events: a stable replay key and the device's own clock.

WHAT THIS IS FOR

A phone on a hill road records things while it has no network - the truck left
the corridor, the driver acknowledged a warning, the driver pressed for help -
and sends them when signal returns. That replay must be safely retryable: a
batch the server accepted but whose response never came back is sent again, and
the second copy must not open a second emergency or record a second
acknowledgement.

`device_event_id` is that key, generated on the device and kept across retries,
exactly as `device_fix_id` already is for GPS (migration 0002). The partial
unique index `(trip_id, device_event_id)` is the authority; the ingest path uses
INSERT ... ON CONFLICT DO NOTHING against it and binds every side effect to a
row actually having been inserted.

PARTIAL, BECAUSE MOST EVENTS HAVE NO DEVICE

The server writes most of this table itself - CREATED, DISPATCHED, DELIVERED -
and those have no device, no replay and nothing to deduplicate on. A NOT NULL
column would have meant inventing an identity for them; a full unique index
would have meant one NULL per trip. The index is therefore partial, which is
also what keeps it small: it covers only the rows that can arrive twice.

TWO CLOCKS, KEPT APART

`occurred_at` remains the SERVER clock and stays the ordering key. The device's
own timestamp goes in `device_reported_at`, recorded and never trusted, for the
reason the telemetry policy already states: a phone with a wrong or manipulated
clock must not be able to reorder a safety timeline or backdate an
acknowledgement. The gap between the two is a measurement in its own right -
it is how long the event sat in the offline queue, and it is the same signal
`app/domain/connectivity.py` reads from GPS fixes.

THE ENUM VALUES STAY ON DOWNGRADE

PostgreSQL cannot drop a value from an enum type, so `downgrade()` removes the
columns and the index and leaves ROUTE_DEVIATION, ALERT_ACKNOWLEDGED and
SOS_TRIGGERED in `trip_event_kind`. That is the same decision migration 0008
made for ACCEPTED, and it is harmless: an unused enum value writes nothing.
`ALTER TYPE ... ADD VALUE` runs inside a transaction block on PostgreSQL 12+
provided the new value is not also USED in that transaction, which it is not.

No new table, so no new RLS statement: `trip_events` already has row-level
security enabled from migration 0002.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013_device_events"
down_revision: str | None = "0012_push_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "trip_events",
        sa.Column(
            "device_event_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
            comment=(
                "Client-generated identity for a device-originated event. The "
                "replay key for the phone's offline queue; NULL for events the "
                "server writes."
            ),
        ),
    )
    op.add_column(
        "trip_events",
        sa.Column(
            "device_reported_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment=(
                "When the device says it happened. Recorded, never trusted - "
                "occurred_at (server clock) remains the ordering key."
            ),
        ),
    )
    op.create_index(
        "uq_trip_events_device_event",
        "trip_events",
        ["trip_id", "device_event_id"],
        unique=True,
        postgresql_where=sa.text("device_event_id IS NOT NULL"),
    )

    # Three Sentinel measurements a driver-pressed SOS does not have.
    #
    # Every emergency until now came from Fleet Sentinel, which had all three,
    # so NOT NULL cost nothing. A driver pressing for help has no stationary
    # window (the truck may be moving), was sent no check-in prompt, and has no
    # deadline to wait out - and writing now() into those columns would tell a
    # manager the truck stopped, and was asked, at a moment when neither
    # happened. Unavailable renders as unavailable (AGENTS.md).
    for column, comment in (
        (
            "stationary_since",
            "When the truck stopped, as Fleet Sentinel measured it. NULL when "
            "no stationary window was observed - a driver-pressed SOS.",
        ),
        (
            "check_sent_at",
            "When Sentinel asked the driver to check in. NULL when no check "
            "was sent - a driver-pressed SOS.",
        ),
        (
            "response_deadline_at",
            "When an unanswered check-in escalates. NULL when there is no "
            "window to wait out - a driver-pressed SOS is already escalated.",
        ),
    ):
        op.alter_column(
            "emergencies",
            column,
            existing_type=sa.DateTime(timezone=True),
            nullable=True,
            comment=comment,
        )

    # Idempotent so a re-run against a cluster that already has the value does
    # not fail the whole revision.
    for value in ("ROUTE_DEVIATION", "ALERT_ACKNOWLEDGED", "SOS_TRIGGERED"):
        op.execute(f"ALTER TYPE trip_event_kind ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # Restore NOT NULL, but never by dropping rows: an emergency with no
    # stationary window falls back to when it was triggered, which is the
    # value the pre-0013 code would have written for it.
    for column in ("stationary_since", "check_sent_at", "response_deadline_at"):
        op.execute(
            f"UPDATE emergencies SET {column} = triggered_at WHERE {column} IS NULL"
        )
        op.alter_column(
            "emergencies",
            column,
            existing_type=sa.DateTime(timezone=True),
            nullable=False,
            comment=None,
        )
    op.drop_index("uq_trip_events_device_event", table_name="trip_events")
    op.drop_column("trip_events", "device_reported_at")
    op.drop_column("trip_events", "device_event_id")
    # The three enum values stay. PostgreSQL cannot drop one; see the module
    # docstring.
