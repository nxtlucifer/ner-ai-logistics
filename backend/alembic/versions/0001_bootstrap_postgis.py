"""Bootstrap: enable PostGIS and prove the spatial stack end to end.

Foundation-phase migration only. It deliberately creates no domain table - see
docs/DATA_MODEL.md section 13. Phase P2 introduces users, drivers, trucks and
assignments.

What this proves, beyond "PostGIS is installed":
  - the extension is available to the application role
  - a geography(Point,4326) column can be created through SQLAlchemy/GeoAlchemy2
  - a real coordinate round-trips through PostGIS functions

Portable across both configured providers:
  - Supabase  : extension lives in the `extensions` schema (Supabase convention),
                which is already on the postgres role's search_path
  - local WSL2: no `extensions` schema, so it lives in the default schema

Revision ID: 0001_bootstrap
Revises:
Create Date: 2026-08-29

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geography

revision: str = "0001_bootstrap"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Guwahati - the primary logistics hub of the region and the destination in the
# demo scenario. Used here as a reference point so the spatial type is exercised
# with a real coordinate rather than a placeholder.
GUWAHATI_LON = 91.7362
GUWAHATI_LAT = 26.1445


def _enable_postgis() -> None:
    """Create the PostGIS extension in whichever schema suits the provider."""
    bind = op.get_bind()
    has_extensions_schema = bind.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.schemata "
            "WHERE schema_name = 'extensions')"
        )
    ).scalar_one()

    if has_extensions_schema:
        # Supabase. Keeps `public` free of the ~1000 PostGIS objects, and the
        # postgres role's search_path already includes `extensions`, so
        # geography(...) still resolves unqualified.
        op.execute("CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions")
    else:
        op.execute("CREATE EXTENSION IF NOT EXISTS postgis")


def upgrade() -> None:
    _enable_postgis()

    op.create_table(
        "system_info",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("schema_marker", sa.String(length=64), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column(
            "reference_location",
            # spatial_index=False: this table holds a single marker row, so an
            # index would cost more than it saves. Domain tables in P2 onward do
            # index their geography columns.
            Geography(geometry_type="POINT", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("schema_marker", name="uq_system_info_schema_marker"),
    )

    # Row Level Security, enabled with NO policies.
    #
    # This matters specifically on Supabase: every table in `public` is published
    # through the PostgREST Data API, so without RLS anyone holding the anon key
    # could read it directly, bypassing FastAPI entirely. RLS with no policy
    # denies all API access while the backend's `postgres` role bypasses RLS and
    # is unaffected.
    #
    # EVERY table added from phase P2 onward must do this. See docs/SECURITY.md.
    op.execute("ALTER TABLE system_info ENABLE ROW LEVEL SECURITY")

    op.execute(
        sa.text(
            """
            INSERT INTO system_info (schema_marker, description, reference_location)
            VALUES (
                :marker,
                :description,
                ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
            )
            """
        ).bindparams(
            marker="foundation-p1",
            description=(
                "Foundation bootstrap. PostGIS verified. No domain tables yet - "
                "see docs/DATA_MODEL.md."
            ),
            lon=GUWAHATI_LON,
            lat=GUWAHATI_LAT,
        )
    )


def downgrade() -> None:
    op.drop_table("system_info")
    # The postgis extension is deliberately NOT dropped. It may have pre-existed
    # this migration, and dropping it would cascade into every spatial object in
    # the database. Removing PostGIS is an explicit operator decision, never a
    # side effect of rolling back one migration.
