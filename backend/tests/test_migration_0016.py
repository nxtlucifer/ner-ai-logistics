"""Migration 0016: geography boundaries, proven on the POPULATED isolated database.

What must hold across 0015 -> 0016 -> 0015 -> 0016 on a database that already
has users, districts and shipments pointing at the eight seeded states:

  * the eight NER state rows keep their ids (users, districts and shipments
    reference them with RESTRICT);
  * `is_ner` is backfilled true for exactly those eight, by name;
  * geometry columns are MultiPolygon/4326, nullable, GiST-indexed;
  * country_boundaries exists with RLS on, and is gone after the downgrade;
  * a non-NER state row cannot survive a downgrade into code that believes
    every state row is one of the eight.

Only this revision's own step is exercised, so no data outside 0016's columns
is dropped. The full base -> head chain is the opt-in tests/test_migrations.py
and the scratch-database evidence run recorded in the lane report.
"""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app.core.config import get_settings

pytestmark = [pytest.mark.requires_db, pytest.mark.migration]

BACKEND = Path(__file__).resolve().parents[1]
REV = "0016_geography_boundaries"
PREV = "0015_instance_coordination"
NER = {
    "Arunachal Pradesh", "Assam", "Manipur", "Meghalaya",
    "Mizoram", "Nagaland", "Sikkim", "Tripura",
}


def _cfg() -> Config:
    # No ini FILE on purpose: alembic/env.py runs logging.fileConfig() whenever
    # there is one, which disables every logger already created - and the tests
    # after this one read app loggers through caplog. The options that matter
    # are set here instead.
    cfg = Config()
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.set_main_option("version_path_separator", "os")
    return cfg


def _engine():
    return create_engine(get_settings().effective_migration_url)


def test_0016_is_the_single_head_after_0015():
    # One head, with 0016 in its history (0017_trip_breaks follows it).
    script = ScriptDirectory.from_config(_cfg())
    heads = script.get_heads()
    assert len(heads) == 1
    assert REV in {r.revision for r in script.iterate_revisions(heads[0], "base")}
    assert script.get_revision(REV).down_revision == PREV


def test_down_and_up_on_a_populated_database():
    engine = _engine()
    try:
        with engine.begin() as conn:
            ids = dict(conn.execute(text("SELECT slug, id FROM states WHERE name = ANY(:n)"), {"n": list(NER)}).all())
            assert len(ids) == 8
            # A non-NER row, as the importer would write one.
            conn.execute(text(
                "INSERT INTO states (name, slug, source_name, is_ner) "
                "VALUES ('MIGRATION Probe', 'migration-probe', 'test', false) ON CONFLICT (slug) DO NOTHING"
            ))

        command.downgrade(_cfg(), PREV)
        with engine.connect() as conn:
            insp = inspect(conn)
            assert not insp.has_table("country_boundaries")
            state_cols = {c["name"] for c in insp.get_columns("states")}
            assert not state_cols & {"is_ner", "geometry", "geometry_source"}
            assert "geometry" not in {c["name"] for c in insp.get_columns("districts")}
            after_down = dict(conn.execute(text("SELECT slug, id FROM states")).all())
        assert after_down == ids, "downgrade must leave exactly the eight NER rows, same ids"

        command.upgrade(_cfg(), "head")
        with engine.connect() as conn:
            rows = conn.execute(text("SELECT slug, id, name, is_ner FROM states")).all()
            assert {r.slug: r.id for r in rows} == ids, "state ids changed"
            assert {r.name for r in rows if r.is_ner} == NER
            geom_types = dict(conn.execute(text(
                "SELECT f_table_name || '.' || f_geometry_column, type || '/' || srid "
                "FROM geometry_columns WHERE f_table_name IN ('states', 'districts', 'country_boundaries')"
            )).all())
            assert geom_types == {
                "states.geometry": "MULTIPOLYGON/4326",
                "districts.geometry": "MULTIPOLYGON/4326",
                "country_boundaries.geometry": "MULTIPOLYGON/4326",
            }
            gist = set(conn.execute(text(
                "SELECT indexname FROM pg_indexes WHERE indexdef ILIKE '%USING gist (geometry)%' "
                "AND tablename IN ('states', 'districts', 'country_boundaries')"
            )).scalars())
            assert gist == {"ix_states_geometry", "ix_districts_geometry", "ix_country_boundaries_geometry"}
            rls = conn.execute(text(
                "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.country_boundaries'::regclass"
            )).scalar_one()
            assert rls is True
    finally:
        command.upgrade(_cfg(), "head")
        engine.dispose()
