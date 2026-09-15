"""Schema drift: the ORM models and the migrated database must agree exactly.

This is the test that keeps migration 0002 and app/models honest. Without it,
a column added to a model but not to a migration (or the reverse) surfaces as a
runtime error in a later phase, far from its cause.
"""

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Connection, inspect, text

import app.models  # noqa: F401  - registers every table on Base.metadata
from app.db.schema_ownership import (
    NOT_MIGRATION_OWNED,
    extension_owned_relations,
    make_include_object,
    relations_not_ours,
)
from app.db.session import Base
from app.models import P2_TABLES
from app.models.enums import ENUM_TYPE_NAMES

pytestmark = pytest.mark.requires_db


def test_no_drift_between_models_and_database(db: Connection) -> None:
    """The authoritative GATE 7 check.

    What counts as "not ours" is asked of the database rather than listed here.
    A hardcoded list was correct against a plain `postgis` install and wrong
    against `postgis/postgis:18-3.6`, which also ships the tiger geocoder and
    topology - thirty-odd extra relations that read as drift. See
    app/db/schema_ownership.
    """
    ctx = MigrationContext.configure(
        db,
        opts={
            "include_object": make_include_object(
                relations_not_ours(db, Base.metadata.tables)
            )
        },
    )
    diff = compare_metadata(ctx, Base.metadata)
    assert diff == [], (
        "ORM models and the database schema disagree. Each entry is a change "
        f"autogenerate would emit:\n" + "\n".join(f"  - {d}" for d in diff)
    )


def test_every_p2_table_exists(db: Connection) -> None:
    present = set(inspect(db).get_table_names(schema="public"))
    missing = set(P2_TABLES) - present
    assert not missing, f"migration 0002 did not create: {sorted(missing)}"


def test_every_enum_type_exists_with_expected_labels(db: Connection) -> None:
    """A missing label makes a legal domain value unstorable."""
    for py_enum, type_name in ENUM_TYPE_NAMES.items():
        labels = set(
            db.execute(
                text(
                    "SELECT e.enumlabel FROM pg_enum e "
                    "JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = :n"
                ),
                {"n": type_name},
            ).scalars()
        )
        expected = {m.value for m in py_enum}
        assert labels == expected, (
            f"enum {type_name}: database has {sorted(labels)}, "
            f"Python has {sorted(expected)}"
        )


#: Enum LABELS added after migration 0002, and the revision that adds each.
#:
#: Listed explicitly, and verified below against the revision file itself. A
#: label that is in neither 0002 nor here fails this test, so an enum cannot be
#: extended in Python without someone recording which migration ships it - which
#: is the drift this test exists to catch.
ENUM_LABELS_ADDED_AFTER_0002: dict[str, dict[str, str]] = {
    "user_role": {"AUTHORISED_REVIEWER": "0007_route_review_authorizations"},
    "trip_event_kind": {
        "ACCEPTED": "0008_trip_driver_acceptance",
        "ROUTE_DEVIATION": "0013_device_events",
        "ALERT_ACKNOWLEDGED": "0013_device_events",
        "SOS_TRIGGERED": "0013_device_events",
    },
    "driver_document_type": {"GOVERNMENT_ID": "0011_files_verification"},
}

#: Enum TYPES created after 0002, and the revision that creates each.
ENUM_TYPES_ADDED_AFTER_0002: dict[str, str] = {
    "route_review_basis": "0007_route_review_authorizations",
    "emergency_state": "0010_emergencies",
    "driver_check_response": "0010_emergencies",
}


def _revision_source(revision: str) -> str:
    from pathlib import Path

    path = (
        Path(__file__).resolve().parents[1] / "alembic" / "versions" / f"{revision}.py"
    )
    assert path.exists(), f"revision {revision} does not exist"
    return path.read_text(encoding="utf-8")


def test_migration_enum_definitions_match_python_enums() -> None:
    """Python enums and the migrations that ship them must not drift.

    Migration 0002 spells its enum values out inline and deliberately does not
    import app.models, so something has to keep the two copies in agreement.

    ORIGINALLY this asserted that 0002 held EVERY enum, which was true when it
    was written and stopped being true at 0007 - that revision adds the
    `AUTHORISED_REVIEWER` label and creates the `route_review_basis` type. The
    assertion was therefore measuring "0002 is the only source of enums" rather
    than "Python and the migrations agree", and it is widened here to the
    property actually wanted. It is NOT loosened: every later addition must be
    declared above AND the declared revision is opened and checked to really
    contain it, so an undeclared change still fails.
    """
    import importlib.util
    from pathlib import Path

    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0002_core_domain.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0002", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    for py_enum, type_name in ENUM_TYPE_NAMES.items():
        expected = {m.value for m in py_enum}

        if type_name in ENUM_TYPES_ADDED_AFTER_0002:
            revision = ENUM_TYPES_ADDED_AFTER_0002[type_name]
            assert type_name not in module.ENUMS, (
                f"{type_name} is declared as created by {revision} but 0002 "
                f"also defines it"
            )
            source = _revision_source(revision)
            assert type_name in source, (
                f"{revision} does not mention the {type_name} type"
            )
            for label in expected:
                assert label in source, (
                    f"{revision} creates {type_name} without the label {label!r}"
                )
            continue

        assert type_name in module.ENUMS, f"{type_name} missing from migration"

        in_0002 = set(module.ENUMS[type_name])
        added = ENUM_LABELS_ADDED_AFTER_0002.get(type_name, {})
        for label, revision in added.items():
            assert label not in in_0002, (
                f"{label!r} is declared as added by {revision} but 0002 "
                f"already has it"
            )
            assert label in _revision_source(revision), (
                f"{revision} does not add the {type_name} label {label!r}"
            )

        assert in_0002 | set(added) == expected, (
            f"enum {type_name} differs between the migrations and "
            f"app.models.enums. Values only in Python must be declared in "
            f"ENUM_LABELS_ADDED_AFTER_0002 with the revision that ships them."
        )


def test_database_is_at_head(db: Connection) -> None:
    """Non-destructive companion to the opt-in migration tests.

    Those drop every table, so they do not run by default. This one runs always
    and catches the common failure they would otherwise be relied on for: a
    migration added but never applied.
    """
    from pathlib import Path

    from alembic.config import Config
    from alembic.script import ScriptDirectory

    backend_root = Path(__file__).resolve().parents[1]
    cfg = Config(str(backend_root / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_root / "alembic"))
    expected = ScriptDirectory.from_config(cfg).get_current_head()

    actual = db.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert actual == expected, (
        f"database is at {actual}, migrations head is {expected}. "
        "Run: alembic upgrade head"
    )


def test_migration_table_list_matches_models() -> None:
    """The RLS loop iterates the migration list; it must cover every table."""
    import importlib.util
    from pathlib import Path

    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0002_core_domain.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0002_tables", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert set(module.TABLES_IN_ORDER) == set(P2_TABLES)


# ---------------------------------------------------------------------------
# What "not ours" means, and the two ways getting it wrong goes badly.
#
# These exist because the drift gate above was green for months against a
# database carrying only the `postgis` extension, and failed the moment it met
# one carrying `postgis_tiger_geocoder` and `postgis_topology` as well. The
# exclusion was a hand-written list of five names; the property wanted was
# "created by an extension".
# ---------------------------------------------------------------------------


def test_extension_ownership_is_read_from_the_database(db: Connection) -> None:
    """The exclusion set is a fact about this database, not a literal.

    `spatial_ref_sys` is a member of the `postgis` extension in every install
    that has PostGIS at all, so it must come back from pg_depend without anyone
    having typed its name.
    """
    owned = extension_owned_relations(db)
    assert "spatial_ref_sys" in owned, (
        "pg_depend reported no PostGIS members - the ownership query is wrong, "
        f"or PostGIS is not installed. Got {len(owned)} relations."
    )


def test_everything_postgis_ships_is_excluded_whatever_it_ships(
    db: Connection,
) -> None:
    """Every extension-owned relation is filtered, named or not.

    This is the assertion the old list could not make. On the CI image it
    covers the ~30 tiger geocoder tables and topology.topology; on a plain
    PostGIS install it covers three. Neither number appears here.
    """
    excluded = relations_not_ours(db, Base.metadata.tables)
    unfiltered = extension_owned_relations(db) - excluded - set(Base.metadata.tables)
    assert not unfiltered, f"extension-owned but still compared: {sorted(unfiltered)}"
    assert NOT_MIGRATION_OWNED <= excluded


def test_a_table_we_own_is_never_excluded(db: Connection) -> None:
    """A name collision must fail loudly rather than pass silently.

    If an extension ever shipped a relation named like one of ours, excluding
    it would hide real drift in OUR table and nobody would ever know. Comparing
    it instead produces a noisy failure someone has to look at, which is the
    correct direction for a gate.
    """
    pretend_ours = set(Base.metadata.tables) | {"spatial_ref_sys"}
    excluded = relations_not_ours(db, pretend_ours)
    assert "spatial_ref_sys" not in excluded
    for name in Base.metadata.tables:
        assert name not in excluded, f"the gate would not compare our own {name}"


def test_indexes_on_excluded_tables_are_excluded_too() -> None:
    """An index is asked about separately from the table it sits on.

    `idx_tiger_edges_countyfp` reached the diff even though nothing in this
    project has ever heard of `edges`, because the old filter only ever looked
    at tables.
    """
    from sqlalchemy import Column, Integer, MetaData, Table

    metadata = MetaData()
    theirs = Table("edges", metadata, Column("countyfp", Integer))
    ours = Table("trips", metadata, Column("id", Integer))
    include = make_include_object({"edges"})

    assert include(theirs, "edges", "table", True, None) is False
    assert include(ours, "trips", "table", True, None) is True

    their_index = type("Idx", (), {"table": theirs})()
    our_index = type("Idx", (), {"table": ours})()
    assert include(their_index, "idx_tiger_edges_countyfp", "index", True, None) is False
    assert include(our_index, "ix_trips_id", "index", True, None) is True

    # Anything that is not a table or an index is left alone, as before.
    assert include(None, "whatever", "column", True, None) is True
