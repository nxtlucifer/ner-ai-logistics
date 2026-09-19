"""Geography boundaries: PostGIS becomes the authority for country, state and district.

LOCAL / ISOLATED / CERT DATABASES ONLY. Never applied to the hosted database
by this change (owner decision, 29 Sep 2026).

  states.geometry, districts.geometry   MultiPolygon/4326, NULLABLE until the
                                        Survey of India import fills them
  geometry_source / _version / _verified_at   provenance of each shape
  states.is_ner                         true for the eight NER states,
                                        backfilled BY NAME; every state row
                                        the importer adds later is false
  country_boundaries                    the India outline (see below)

WHY A country_boundaries TABLE, NOT A ROW IN states

India is not a state. As a states row it would appear in every state list,
picker and dashboard table, could be chosen as a State Manager's scope, and
every query over states would need to remember to exclude it. Its own
single-purpose table keeps `states` meaning states, and makes "is the India
boundary loaded?" - the question classification fails closed on - a lookup of
one primary key.

EXISTING ROWS KEEP THEIR IDS. Users, districts and shipments reference the
eight seeded states with RESTRICT; nothing here rewrites them.

DOWNGRADE deletes every non-NER state first: code before 0016 treats every
states row as one of the eight, so an imported Delhi row left behind would
appear in its lists and could be given a State Manager. Shipments pointing at
such a row lose that reference (their NER end keeps its own); a user scoped to
one makes the downgrade fail loudly, which is the right outcome - that account
should not exist.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

revision: str = "0016_geography_boundaries"
down_revision: str | None = "0015_instance_coordination"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NER_STATE_NAMES = (
    "Arunachal Pradesh", "Assam", "Manipur", "Meghalaya",
    "Mizoram", "Nagaland", "Sikkim", "Tripura",
)


def _multipolygon() -> Geometry:
    # A fresh instance per column (see app/models/operations.py on why a shared
    # GeoAlchemy2 type instance is a bug), and no implicit index: the GiST
    # indexes are created explicitly below.
    return Geometry(geometry_type="MULTIPOLYGON", srid=4326, spatial_index=False)


def _provenance() -> list[sa.Column]:
    return [
        sa.Column("geometry_source", sa.Text, nullable=True),
        sa.Column("geometry_source_version", sa.Text, nullable=True),
        sa.Column("geometry_verified_at", sa.DateTime(timezone=True), nullable=True),
    ]


def upgrade() -> None:
    for table in ("states", "districts"):
        op.add_column(table, sa.Column("geometry", _multipolygon(), nullable=True))
        for column in _provenance():
            op.add_column(table, column)
        op.create_index(f"ix_{table}_geometry", table, ["geometry"], postgresql_using="gist")

    op.add_column(
        "states", sa.Column("is_ner", sa.Boolean, nullable=False, server_default=sa.false())
    )
    op.execute(
        sa.text("UPDATE states SET is_ner = true WHERE name = ANY(:names)").bindparams(
            sa.bindparam("names", list(NER_STATE_NAMES), type_=postgresql.ARRAY(sa.Text))
        )
    )

    op.create_table(
        "country_boundaries",
        #: ISO 3166-1 alpha-2. 'IN' is the only row classification reads.
        sa.Column("code", sa.String(2), primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("geometry", _multipolygon(), nullable=False),
        sa.Column("geometry_source", sa.Text, nullable=False),
        sa.Column("geometry_source_version", sa.Text, nullable=True),
        sa.Column("geometry_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_country_boundaries_geometry", "country_boundaries", ["geometry"], postgresql_using="gist"
    )
    op.execute(
        "CREATE TRIGGER trg_country_boundaries_set_updated_at BEFORE UPDATE ON country_boundaries "
        "FOR EACH ROW EXECUTE FUNCTION set_updated_at()"
    )
    # RLS on, no policy - the same second lock as every other table (see 0013).
    op.execute("ALTER TABLE country_boundaries ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("country_boundaries")

    for end in ("origin", "destination"):
        op.execute(
            f"UPDATE shipments SET {end}_district_id = NULL WHERE {end}_district_id IN "
            "(SELECT d.id FROM districts d JOIN states s ON s.id = d.state_id WHERE NOT s.is_ner)"
        )
        op.execute(
            f"UPDATE shipments SET {end}_state_id = NULL "
            f"WHERE {end}_state_id IN (SELECT id FROM states WHERE NOT is_ner)"
        )
    op.execute("DELETE FROM districts WHERE state_id IN (SELECT id FROM states WHERE NOT is_ner)")
    op.execute("DELETE FROM states WHERE NOT is_ner")
    op.drop_column("states", "is_ner")

    for table in ("districts", "states"):
        op.drop_index(f"ix_{table}_geometry", table_name=table)
        for column in ("geometry_verified_at", "geometry_source_version", "geometry_source", "geometry"):
            op.drop_column(table, column)
