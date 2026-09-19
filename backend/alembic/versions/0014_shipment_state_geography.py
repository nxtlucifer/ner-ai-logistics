"""Shipment state geography, so a state manager sees a trip whose district is unknown.

Scope reads shipment geography (app/core/scope.py). 0013 gave shipments
districts only, and nothing in the API ever wrote them, so every trip planned
in the console was invisible to every State and District Manager. The server
now resolves each endpoint when the shipment is created
(app/services/trip_geography.py). A state resolves far more often than an
operational (VERIFIED_OFFICIAL or DEMO) district does, so the state needs a column of its own.

`geography_source` records how the geography was obtained. It is the one thing
that lets a later reviewer find, and if necessary undo, every scope decision
made from a third-party boundary set.

A trigger keeps a written district and its state in agreement for every writer
(seed scripts, factories, raw SQL), not just the service that resolves them.

Additive: nullable columns, and a backfill that only copies the state of a
district already recorded - it never places a point anywhere.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014_shipment_state_geography"
down_revision: str | None = "0013_state_district_inbox"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for end in ("origin", "destination"):
        op.add_column(
            "shipments",
            sa.Column(
                f"{end}_state_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("states.id", ondelete="RESTRICT"),
                nullable=True,
            ),
        )
        op.create_index(f"ix_shipments_{end}_state_id", "shipments", [f"{end}_state_id"])
    op.add_column("shipments", sa.Column("geography_source", sa.String(40), nullable=True))

    op.execute(
        """
        UPDATE shipments s SET
          origin_state_id = (SELECT d.state_id FROM districts d WHERE d.id = s.origin_district_id),
          destination_state_id = (SELECT d.state_id FROM districts d WHERE d.id = s.destination_district_id)
        WHERE s.origin_district_id IS NOT NULL OR s.destination_district_id IS NOT NULL
        """
    )

    op.execute(
        """
        CREATE FUNCTION shipments_state_follows_district() RETURNS trigger AS $$
        BEGIN
          IF NEW.origin_district_id IS NOT NULL THEN
            NEW.origin_state_id := (SELECT state_id FROM districts WHERE id = NEW.origin_district_id);
          END IF;
          IF NEW.destination_district_id IS NOT NULL THEN
            NEW.destination_state_id := (SELECT state_id FROM districts WHERE id = NEW.destination_district_id);
          END IF;
          RETURN NEW;
        END
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER trg_shipments_state_follows_district "
        "BEFORE INSERT OR UPDATE OF origin_district_id, destination_district_id, origin_state_id, destination_state_id "
        "ON shipments FOR EACH ROW EXECUTE FUNCTION shipments_state_follows_district()"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_shipments_state_follows_district ON shipments")
    op.execute("DROP FUNCTION IF EXISTS shipments_state_follows_district()")
    op.drop_column("shipments", "geography_source")
    for end in ("origin", "destination"):
        op.drop_index(f"ix_shipments_{end}_state_id", table_name="shipments")
        op.drop_column("shipments", f"{end}_state_id")
