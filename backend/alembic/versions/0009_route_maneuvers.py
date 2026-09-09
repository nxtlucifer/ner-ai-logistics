"""Turn instructions stored with the route they describe.

WHY THIS EXISTS

LS-12 G2 needs turn-by-turn guidance, and the honest constraint is that the
routes already in this database cannot provide it. Planning calls OSRM with
`steps=false` and `overview=simplified` - measured on the live service, the
demo corridor comes back as 52 points and zero maneuvers, while the same
request with `steps=true&overview=full` returns 5,213 points and 19 maneuvers.

Both numbers matter:

  no maneuvers   there is nothing to say at a junction, and deriving turns
                 from polyline corners is forbidden - a simplified overview
                 has vertices where the encoder put them, not where the roads
                 meet, so "the line bends" is not "turn right"
  52 points      over 305 km that is a vertex every ~6 km. Projecting a moving
                 fix onto that line cannot tell which side of a junction the
                 truck is on

So guidance requires a route planned FOR guidance. This column is where the
provider's own instructions live, beside the geometry from the SAME provider
response, so a route's directions can never describe a different road from its
line.

NULLABLE, AND NULL MEANS SOMETHING

Every existing route gets NULL: they were planned without directions and no
backfill can invent them. NULL is read as "this route cannot drive guidance" -
the app shows the route overview and says guidance is unavailable until a
route planned with directions has been assessed and accepted through the
ordinary flow. It is NOT read as "this road has no turns".

Nothing here attaches new directions to an old route. A route gains guidance
only by being planned with it, which produces a new candidate that goes
through `refuse_if_ineligible` and selection like any other.

JSONB, NOT A TABLE

Maneuvers are read as one list, always for one route, and are never queried
across routes or updated individually. A child table would add a join and a
second lifetime to something that is one immutable attribute of the provider's
answer. `risk_factors` on the same table already sets this precedent.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_route_maneuvers"
down_revision: str | None = "0008_trip_driver_acceptance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "trip_routes",
        sa.Column(
            "maneuvers",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment=(
                "Provider turn instructions for THIS route's geometry, or "
                "NULL when the route was planned without them. NULL means "
                "guidance unavailable, never 'no turns'."
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column("trip_routes", "maneuvers")
