"""The Survey of India boundary importer (scripts/import_soi_boundaries.py).

The real OVSF/1M/7 shapefile has not been seen yet - its download needs a
CAPTCHA and a consent the owner completes personally - so its attribute names
are TODO markers and the importer refuses to run without them. Everything here
runs on SYNTHETIC shapefiles built from rectangles at test time; nothing in
this file is geography.

What must hold whatever the real schema turns out to be:
  * CRS is checked, not assumed;
  * every geometry is validated, repaired only where invalid, and every repair
    is recorded;
  * the eight NER state rows keep their ids and must all be present in the
    source, or nothing is written;
  * only NER districts are loaded;
  * a second run changes nothing.
"""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from scripts import import_soi_boundaries as soi
from tests import geo_fixtures as fx

BACKEND = Path(__file__).resolve().parents[1]
BUNDLED_OGR2OGR = BACKEND.parent / ".runtime" / "pg" / "pgsql" / "bin" / "ogr2ogr.exe"
OGR2OGR = os.environ.get("OGR2OGR") or shutil.which("ogr2ogr") or (
    str(BUNDLED_OGR2OGR) if BUNDLED_OGR2OGR.exists() else None
)
FIELDS = {"state_name": "NAME", "district_name": "NAME"}

NER_BOXES = {
    "Arunachal Pradesh": "POLYGON((92 28, 97 28, 97 29.5, 92 29.5, 92 28))",
    "ASSAM": fx.FIXTURE_ASSAM,  # upper case on purpose: names are normalised
    "Manipur": "POLYGON((93.5 24, 94.5 24, 94.5 25, 93.5 25, 93.5 24))",
    "Meghalaya": fx.FIXTURE_MEGHALAYA,
    "Mizoram": "POLYGON((92.5 22.5, 93.3 22.5, 93.3 24, 92.5 24, 92.5 22.5))",
    "Nagaland": "POLYGON((95 25, 96 25, 96 25.5, 95 25.5, 95 25))",
    "Sikkim": "POLYGON((88 27.1, 88.9 27.1, 88.9 28, 88 28, 88 27.1))",
    "Tripura": "POLYGON((91 23, 92 23, 92 24.5, 91 24.5, 91 23))",
}
#: Two overlapping squares as one multipolygon: invalid until repaired.
BOWTIE = "MULTIPOLYGON(((93 26, 94 26, 94 27, 93 27, 93 26)),((93.5 26.5, 94.5 26.5, 94.5 27.5, 93.5 27.5, 93.5 26.5)))"


class TestPureParts:
    @pytest.mark.parametrize(
        "raw,expected",
        [("ASSAM", "assam"), ("  Arunachal   Pradesh ", "arunachal pradesh"),
         ("Jammu & Kashmir", "jammu and kashmir"), ("ＡＳＳＡＭ", "assam")],
    )
    def test_names_are_normalised(self, raw, expected):
        assert soi.normalise_name(raw) == expected

    def test_slugs(self):
        assert soi.slugify("Kamrup Metropolitan") == "kamrup-metropolitan"
        assert soi.slugify("Jammu & Kashmir") == "jammu-and-kashmir"

    def test_wgs84_is_accepted(self, tmp_path):
        prj = tmp_path / "a.prj"
        prj.write_text('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]]]')
        soi.check_crs(prj)

    @pytest.mark.parametrize(
        "wkt",
        ['PROJCS["Lambert",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"]]]',
         'GEOGCS["GCS_Everest_1830",DATUM["D_Everest_1830"]]'],
        ids=["projected", "other-datum"],
    )
    def test_any_other_crs_is_refused(self, tmp_path, wkt):
        prj = tmp_path / "a.prj"
        prj.write_text(wkt)
        with pytest.raises(soi.ImportRefused, match="CRS"):
            soi.check_crs(prj)

    def test_a_missing_prj_is_refused(self, tmp_path):
        with pytest.raises(soi.ImportRefused, match="CRS"):
            soi.check_crs(tmp_path / "missing.prj")

    def test_the_field_mapping_is_a_todo_until_the_real_file_is_seen(self, tmp_path):
        assert all(v is None for v in soi.FIELDS.values())
        with pytest.raises(soi.ImportRefused, match="TODO"):
            soi.run(
                country_shp=tmp_path / "c.shp", states_shp=tmp_path / "s.shp",
                districts_shp=tmp_path / "d.shp", source_version="v", ogr2ogr="ogr2ogr",
            )

    def test_a_hosted_database_is_refused(self):
        with pytest.raises(soi.ImportRefused, match="local"):
            soi.require_local("postgresql+psycopg://u:p@db.example.supabase.co:5432/postgres")
        soi.require_local("postgresql+psycopg://u:p@127.0.0.1:55432/x")


def _shapefile(ogr2ogr: str, folder: Path, name: str, features: list[tuple[str, str]]) -> Path:
    """Write a synthetic shapefile from (NAME, WKT) pairs through ogr2ogr."""
    from sqlalchemy import create_engine

    from app.core.config import get_settings

    # WKT -> GeoJSON through PostGIS, so no GIS package is needed in the venv.
    engine = create_engine(get_settings().effective_database_url)
    with engine.connect() as conn:
        geoms = [conn.execute(text("SELECT ST_AsGeoJSON(ST_GeomFromText(:w))"), {"w": w}).scalar_one() for _, w in features]
    engine.dispose()
    collection = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"NAME": n}, "geometry": json.loads(g)}
            for (n, _), g in zip(features, geoms)
        ],
    }
    src = folder / f"{name}.geojson"
    src.write_text(json.dumps(collection))
    out = folder / f"{name}.shp"
    subprocess.run([ogr2ogr, "-f", "ESRI Shapefile", str(out), str(src)], check=True, capture_output=True)
    return out


@pytest.fixture
def layers(tmp_path):
    if OGR2OGR is None:
        pytest.skip("ogr2ogr not available")
    return {
        "country_shp": _shapefile(OGR2OGR, tmp_path, "country", [("India", fx.FIXTURE_INDIA)]),
        "states_shp": _shapefile(
            OGR2OGR, tmp_path, "states",
            [*NER_BOXES.items(), ("FIXTURE West Bengal", fx.FIXTURE_WEST_BENGAL)],
        ),
        "districts_shp": _shapefile(
            OGR2OGR, tmp_path, "districts",
            [("FIXTURE Kamrup", fx.FIXTURE_KAMRUP), ("FIXTURE Bowtie", BOWTIE),
             ("FIXTURE WB District", "POLYGON((87 23, 88 23, 88 24, 87 24, 87 23))")],
        ),
    }


@pytest.fixture
async def clean_import(session: AsyncSession):
    yield
    await fx.unload(session)
    await session.execute(text("DELETE FROM districts WHERE slug IN ('fixture-bowtie', 'fixture-wb-district')"))
    await session.commit()


def _run(layers, **over):
    return soi.run(
        **layers, source_version="fixture-v1", ogr2ogr=OGR2OGR, fields=FIELDS,
        source=fx.FIXTURE_SOURCE, source_name=fx.FIXTURE_DISTRICT_SOURCE_NAME, **over,
    )


@pytest.mark.requires_db
@pytest.mark.usefixtures("clean_import")
class TestImport:
    async def test_loads_validates_and_is_idempotent(self, session: AsyncSession, layers):
        ids_before = dict((await session.execute(text("SELECT slug, id FROM states WHERE is_ner"))).all())

        first = _run(layers)
        assert first["country"] in ("inserted", "updated")
        assert first["states"]["matched_ner"] == 8
        assert [r["name"] for r in first["repaired"]] == ["FIXTURE Bowtie"]
        assert first["districts"]["outside_ner"] == 1

        rows = (await session.execute(text(
            "SELECT slug, id, is_ner, geometry IS NOT NULL AS has_geom, geometry_source, "
            "ST_IsValid(geometry) AS valid, GeometryType(geometry) AS kind FROM states"
        ))).all()
        by_slug = {r.slug: r for r in rows}
        assert {s: by_slug[s].id for s in ids_before} == ids_before, "NER state ids changed"
        assert all(by_slug[s].has_geom and by_slug[s].valid for s in ids_before)
        assert by_slug["fixture-west-bengal"].is_ner is False
        assert {r.kind for r in rows if r.has_geom} == {"MULTIPOLYGON"}

        districts = dict((await session.execute(text(
            "SELECT slug, source_status::text FROM districts WHERE geometry_source = :s"
        ), {"s": fx.FIXTURE_SOURCE})).all())
        assert districts == {"fixture-kamrup": "VERIFIED_OFFICIAL", "fixture-bowtie": "VERIFIED_OFFICIAL"}
        valid = (await session.execute(text(
            "SELECT bool_and(ST_IsValid(geometry)) FROM districts WHERE geometry_source = :s"
        ), {"s": fx.FIXTURE_SOURCE})).scalar_one()
        assert valid is True

        second = _run(layers)
        assert second["country"] == "unchanged"
        assert second["states"]["changed"] == 0 and second["states"]["inserted"] == []
        assert second["districts"]["changed"] == 0 and second["districts"]["inserted"] == []

    async def test_a_missing_ner_state_writes_nothing(self, session: AsyncSession, layers, tmp_path):
        seven = dict(list(NER_BOXES.items())[:-1])
        layers["states_shp"] = _shapefile(OGR2OGR, tmp_path, "states7", list(seven.items()))
        with pytest.raises(soi.ImportRefused, match="Tripura"):
            _run(layers)
        loaded = (await session.execute(text("SELECT count(*) FROM country_boundaries"))).scalar_one()
        assert loaded == 0
