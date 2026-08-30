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
from app.db.session import Base
from app.models import P2_TABLES
from app.models.enums import ENUM_TYPE_NAMES

pytestmark = pytest.mark.requires_db

# Objects the migrations do not own: PostGIS internals, the 0001 bootstrap
# marker table, and Alembic's own bookkeeping.
NOT_OURS = {
    "spatial_ref_sys",
    "geography_columns",
    "geometry_columns",
    "system_info",
    "alembic_version",
}


def _include_object(obj, name, type_, reflected, compare_to) -> bool:
    return not (type_ == "table" and name in NOT_OURS)


def test_no_drift_between_models_and_database(db: Connection) -> None:
    """The authoritative GATE 7 check."""
    ctx = MigrationContext.configure(
        db, opts={"include_object": _include_object}
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


def test_migration_enum_definitions_match_python_enums() -> None:
    """Migration 0002 spells enum values out inline; they must not drift.

    The migration is deliberately self-contained - it does not import
    app.models - so this test is what keeps the two copies in agreement.
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
        assert type_name in module.ENUMS, f"{type_name} missing from migration"
        assert set(module.ENUMS[type_name]) == {m.value for m in py_enum}, (
            f"enum {type_name} differs between migration and app.models.enums"
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
