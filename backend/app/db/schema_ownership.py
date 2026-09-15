"""Which relations a migration owns, and which belong to an extension.

Autogenerate compares the ORM models against everything it can see in the
database, and anything it sees that the models do not define, it proposes to
DROP. PostGIS objects are the obvious casualty - `spatial_ref_sys` holds the
coordinate systems every spatial query resolves against - so they have always
been filtered out of both autogenerate and the drift gate.

They were filtered BY NAME, against a list written by hand. That list was
correct for an install carrying only the `postgis` extension, and silently
incomplete for any other:

  - `postgis_tiger_geocoder` creates about thirty relations (state, county,
    place, edges, addr, addrfeat, featnames, tract, bg, tabblock, the zip_*,
    *_lookup, loader_* and pagc_* tables) plus their indexes;
  - `postgis_topology` creates topology.topology.

Neither lives in `public`, which is why this went unnoticed: both extensions
put their schema on the database search_path, SQLAlchemy reflects the default
schema by VISIBILITY rather than by namespace, and a visible relation arrives
unqualified. So on an image that ships them - `postgis/postgis:18-3.6`, the one
CI uses - thirty-odd tables the project has never heard of read as drift, and
`alembic revision --autogenerate` would cheerfully emit `op.drop_table` for
every one.

The fix is to stop guessing. An extension records ownership of everything it
creates in `pg_depend`, so the database can be ASKED which relations belong to
an extension, rather than a list being maintained by hand against whichever
PostGIS build happened to be installed the last time someone looked.
"""

from collections.abc import Iterable

from sqlalchemy import Connection, text

#: Relations that no migration owns and no extension claims either.
#:
#: `system_info` is migration 0001's bootstrap marker and `alembic_version` is
#: Alembic's own bookkeeping. Neither is an extension member, so `pg_depend`
#: has nothing to say about them and they are still named here - a short list
#: of two, both of which this repository creates deliberately.
NOT_MIGRATION_OWNED = frozenset({"system_info", "alembic_version"})

#: The PostGIS relations to filter when there is no connection to ask.
#:
#: Offline autogenerate (`alembic revision --autogenerate --sql`) has no
#: database, so it falls back to this. It is the same list that used to be the
#: whole rule, and it carries the same limitation: an offline diff taken
#: against a tiger-enabled database still needs a human to read it.
POSTGIS_CORE_RELATIONS = frozenset(
    {"spatial_ref_sys", "geography_columns", "geometry_columns"}
)

#: Relations belonging to an installed extension, by name.
#:
#: `deptype = 'e'` is the extension-member dependency PostgreSQL records for
#: every object `CREATE EXTENSION` creates, which is exactly the question being
#: asked. Names are returned unqualified and across all schemas, because that
#: is the form reflection surfaces them in.
_EXTENSION_OWNED = text(
    "SELECT c.relname "
    "FROM pg_depend d "
    "JOIN pg_class c ON c.oid = d.objid "
    "WHERE d.classid = 'pg_class'::regclass "
    "AND d.refclassid = 'pg_extension'::regclass "
    "AND d.deptype = 'e'"
)


def extension_owned_relations(connection: Connection) -> frozenset[str]:
    """Every relation an installed extension created, asked of the database."""
    return frozenset(connection.execute(_EXTENSION_OWNED).scalars())


def relations_not_ours(
    connection: Connection, model_tables: Iterable[str]
) -> frozenset[str]:
    """Relations to keep out of a schema comparison.

    A name the models DEFINE is never excluded, even if an extension also
    claims it. The two failure modes are not symmetric: excluding one of our
    own tables would hide real drift silently, while comparing an
    extension-owned table that collides with one of ours fails loudly and gets
    looked at. The gate errs towards the loud one.
    """
    ours = set(model_tables)
    candidates = extension_owned_relations(connection) | NOT_MIGRATION_OWNED
    return frozenset(candidates - ours)


def make_include_object(excluded: Iterable[str]):
    """An Alembic `include_object` hook that skips `excluded` and their indexes.

    Indexes are filtered by the table they sit on. Excluding the table is
    expected to take its indexes with it, but the failing CI diff listed
    `remove_index` entries (`idx_tiger_edges_countyfp`, `place_lookup_name_idx`)
    as first-class items beside their `remove_table`, so the index path is
    covered explicitly rather than assumed to follow.
    """
    names = frozenset(excluded)

    def include_object(object_, name, type_, reflected, compare_to) -> bool:
        if type_ == "table":
            return name not in names
        if type_ == "index":
            table = getattr(object_, "table", None)
            return table is None or table.name not in names
        return True

    return include_object
