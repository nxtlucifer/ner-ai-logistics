"""Migration reversibility test.

Every migration must survive upgrade -> downgrade -> upgrade. A migration that
cannot be rolled back is a migration that cannot be safely deployed.

DESTRUCTIVE - OPT-IN ONLY
-------------------------
`alembic downgrade base` executes `DROP TABLE ... CASCADE` on every domain
table. Against the shared Supabase development project that destroys ALL data:
manager accounts, drivers, trucks, assignments and any demo seed.

That is exactly what happened once during P3 - a routine `pytest` run silently
wiped the development database, and the loss was only noticed later. A test that
can delete the demo the night before a deadline must not run by accident.

These tests therefore skip unless RUN_DESTRUCTIVE_MIGRATION_TESTS=1 is set:

    RUN_DESTRUCTIVE_MIGRATION_TESTS=1 pytest tests/test_migrations.py

Run them deliberately, against a database you are willing to empty - after
adding a migration, and in CI against a throwaway service container. The CI job
that does this is .github/workflows/migrations.yml: it stands up a disposable
postgis container, points DATABASE_PROVIDER at it, and runs these tests on every
change under backend/alembic/. Rollback coverage therefore does not depend on
anyone remembering to set an environment variable.

TWO INTERLOCKS, NOT ONE
-----------------------
The opt-in flag is necessary but not sufficient. Someone setting it while their
.env still points at Supabase - the obvious way to run these locally - would
destroy the shared project, and the flag would have felt like the safety check.
So the target must ALSO be a local, disposable host. Both conditions must hold;
either one missing skips, and the skip reason says which.
"""

import os
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.core.config import LOCAL_HOSTS, _host_of, get_settings

DESTRUCTIVE_OPT_IN = os.getenv("RUN_DESTRUCTIVE_MIGRATION_TESTS") == "1"


def _target_is_disposable() -> bool:
    """Whether the database Alembic would migrate is safe to empty.

    Fails closed: any error reading the configuration counts as "not safe".
    A test that drops every table must never proceed on a guess.
    """
    try:
        return _host_of(get_settings().effective_migration_url) in LOCAL_HOSTS
    except Exception:  # noqa: BLE001 - unreadable config is not a safe target
        return False


TARGET_IS_DISPOSABLE = _target_is_disposable()

pytestmark = [
    pytest.mark.requires_db,
    pytest.mark.migration,
    pytest.mark.skipif(
        not DESTRUCTIVE_OPT_IN,
        reason=(
            "Destructive: downgrades to base and drops every table. "
            "Set RUN_DESTRUCTIVE_MIGRATION_TESTS=1 to run."
        ),
    ),
    pytest.mark.skipif(
        DESTRUCTIVE_OPT_IN and not TARGET_IS_DISPOSABLE,
        reason=(
            "REFUSED: RUN_DESTRUCTIVE_MIGRATION_TESTS=1 but the migration target "
            "is not a local host. These tests DROP every table. Point "
            "DATABASE_PROVIDER=local at a disposable database first - see "
            "docker-compose.yml or .github/workflows/migrations.yml."
        ),
    ),
]

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _alembic_config() -> Config:
    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    return cfg


def _sync_engine():
    # Alembic runs synchronously; the same psycopg3 URL serves both engines.
    # effective_migration_url follows DATABASE_PROVIDER, so this always inspects
    # the database Alembic actually migrated.
    settings = get_settings()
    connect_args: dict[str, object] = {}
    if settings.requires_ssl and "sslmode=" not in settings.effective_migration_url:
        connect_args["sslmode"] = "require"
    return create_engine(settings.effective_migration_url, connect_args=connect_args)


def _table_exists(name: str) -> bool:
    with _sync_engine().connect() as conn:
        return inspect(conn).has_table(name)


def test_upgrade_downgrade_upgrade_cycle() -> None:
    cfg = _alembic_config()

    command.upgrade(cfg, "head")
    assert _table_exists("system_info"), "upgrade did not create system_info"

    command.downgrade(cfg, "base")
    assert not _table_exists("system_info"), "downgrade did not drop system_info"

    command.upgrade(cfg, "head")
    assert _table_exists("system_info"), "re-upgrade did not restore system_info"


def test_downgrade_preserves_postgis_extension() -> None:
    """Rolling back the bootstrap must not remove PostGIS.

    The extension may pre-date this migration, and dropping it would cascade into
    every spatial object in the database. Removing PostGIS is an operator
    decision, never a side effect of a rollback.
    """
    cfg = _alembic_config()
    command.downgrade(cfg, "base")
    try:
        with _sync_engine().connect() as conn:
            still_installed = conn.execute(
                text("SELECT 1 FROM pg_extension WHERE extname = 'postgis'")
            ).scalar_one_or_none()
        assert still_installed == 1
    finally:
        # Always return the database to head, whatever the assertion did.
        command.upgrade(cfg, "head")


def test_seed_row_restored_after_cycle() -> None:
    """The bootstrap data, not just the table, must come back."""
    with _sync_engine().connect() as conn:
        count = conn.execute(text("SELECT count(*) FROM system_info")).scalar_one()
    assert count == 1


def test_row_level_security_is_enabled() -> None:
    """Every table must have RLS on - critical on Supabase.

    Supabase publishes `public` through the PostgREST Data API. A table without
    RLS is readable by anyone holding the anon key, bypassing FastAPI entirely.
    RLS with no policy denies all API access; the backend's role bypasses RLS and
    is unaffected. See docs/SECURITY.md.
    """
    with _sync_engine().connect() as conn:
        enabled = conn.execute(
            text(
                "SELECT relrowsecurity FROM pg_class "
                "WHERE oid = 'public.system_info'::regclass"
            )
        ).scalar_one()
    assert enabled is True, "system_info has RLS disabled - it would be world-readable"
