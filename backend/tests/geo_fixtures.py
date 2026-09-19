"""SYNTHETIC boundary polygons for tests. Not geography. Never shipped as data.

Every shape here is a hand-typed rectangle named FIXTURE_*. They exist so the
PostGIS classifier (app/services/geo_classify.py) can be tested before the
Survey of India boundaries are imported. None of them resembles a real border
and no test may treat a result computed from them as a fact about a real place:
real-city acceptance lives in tests/test_geo_classify.py::TestRealCities and
skips until the SoI import exists.

Everything written here is marked with FIXTURE_SOURCE in `geometry_source`, and
`unload` removes exactly the marked rows' geometry - it never touches a row
some other import wrote.

Layout (lon, lat):

    FIXTURE_INDIA        70..97 x 8..35, with a rectangular HOLE
    FIXTURE_NEIGHBOUR    85..88 x 14..18   (the hole: a fake foreign country)
    Assam row            90..96 x 25.5..28          (NER)
    Meghalaya row        89.8..92.8 x 25..25.5      (NER, shares lat 25.5 with Assam)
    FIXTURE West Bengal  86..89.8 x 21.5..27        (not NER)
    FIXTURE Delhi        76.8..77.4 x 28.4..28.9    (not NER)
    FIXTURE Kamrup       90.5..92 x 25.9..26.5      (district of the Assam row)

The Assam and Meghalaya ROWS are the real seeded state rows (their ids carry
FKs); only their geometry is synthetic, and only for the length of a test.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.common import Coordinate

FIXTURE_SOURCE = "FIXTURE_SYNTHETIC_TEST_ONLY"

FIXTURE_INDIA = (
    "POLYGON((70 8, 97 8, 97 35, 70 35, 70 8),"
    " (85 14, 85 18, 88 18, 88 14, 85 14))"
)
FIXTURE_ASSAM = "POLYGON((90 25.5, 96 25.5, 96 28, 90 28, 90 25.5))"
FIXTURE_MEGHALAYA = "POLYGON((89.8 25, 92.8 25, 92.8 25.5, 89.8 25.5, 89.8 25))"
FIXTURE_WEST_BENGAL = "POLYGON((86 21.5, 89.8 21.5, 89.8 27, 86 27, 86 21.5))"
FIXTURE_DELHI = "POLYGON((76.8 28.4, 77.4 28.4, 77.4 28.9, 76.8 28.9, 76.8 28.4))"
FIXTURE_KAMRUP = "POLYGON((90.5 25.9, 92 25.9, 92 26.5, 90.5 26.5, 90.5 25.9))"

#: Non-NER fixture state rows: (slug, name, polygon). Created once and reused,
#: like tests/factories.make_district - states are FK-referenced reference data.
FIXTURE_NON_NER_STATES = (
    ("fixture-west-bengal", "FIXTURE West Bengal", FIXTURE_WEST_BENGAL),
    ("fixture-delhi", "FIXTURE Delhi", FIXTURE_DELHI),
)
FIXTURE_DISTRICT_SLUG = "fixture-kamrup"
#: `source_name` of every fixture district: tests/test_state_district_scope.py
#: holds that any district NOT named "test fixture..." came from a government
#: source, so a synthetic row must say it is one.
FIXTURE_DISTRICT_SOURCE_NAME = "test fixture - FIXTURE_SYNTHETIC_TEST_ONLY"

# Points, as Coordinate(lat, lon).
P_ASSAM_KAMRUP = Coordinate(lat=26.2, lon=91.0)
P_ASSAM = Coordinate(lat=27.0, lon=94.0)
P_MEGHALAYA = Coordinate(lat=25.2, lon=91.5)
P_WEST_BENGAL = Coordinate(lat=24.0, lon=87.5)
P_DELHI = Coordinate(lat=28.6, lon=77.1)
P_INDIA_NO_STATE = Coordinate(lat=20.0, lon=78.0)
P_NEIGHBOUR = Coordinate(lat=16.0, lon=86.5)
P_OUTSIDE = Coordinate(lat=40.0, lon=60.0)
#: Exactly on the outer ring (lat 8 edge) and on the hole's west edge.
P_ON_INDIA_EDGE = Coordinate(lat=8.0, lon=80.0)
P_ON_HOLE_EDGE = Coordinate(lat=16.0, lon=85.0)
#: Inside India, ~107 m west of the hole's edge at lon 85.
P_NEAR_HOLE = Coordinate(lat=16.0, lon=84.999)
#: On the shared Assam/Meghalaya edge.
P_STATE_EDGE = Coordinate(lat=25.5, lon=91.0)


def _geom(param: str) -> str:
    return f"ST_Multi(ST_GeomFromText(:{param}, 4326))"


async def load(session: AsyncSession, *, admin: bool) -> None:
    """Write the fixture India outline and, with `admin`, the state/district shapes."""
    other = (
        await session.execute(
            text(
                "SELECT geometry_source FROM country_boundaries "
                "WHERE code = 'IN' AND geometry_source <> :src"
            ),
            {"src": FIXTURE_SOURCE},
        )
    ).scalar_one_or_none()
    if other is not None:
        raise RuntimeError(
            f"The test database holds a real India boundary ({other}); the "
            "synthetic fixture will not overwrite it."
        )
    await session.execute(
        text(
            "INSERT INTO country_boundaries (code, name, geometry, geometry_source, "
            "geometry_source_version) VALUES ('IN', 'FIXTURE India (synthetic)', "
            f"{_geom('wkt')}, :src, 'fixture-v1') "
            "ON CONFLICT (code) DO UPDATE SET geometry = EXCLUDED.geometry, "
            "geometry_source = EXCLUDED.geometry_source"
        ),
        {"wkt": FIXTURE_INDIA, "src": FIXTURE_SOURCE},
    )
    if admin:
        for slug, wkt in (("assam", FIXTURE_ASSAM), ("meghalaya", FIXTURE_MEGHALAYA)):
            await session.execute(
                text(
                    f"UPDATE states SET geometry = {_geom('wkt')}, "
                    "geometry_source = :src WHERE slug = :slug"
                ),
                {"wkt": wkt, "src": FIXTURE_SOURCE, "slug": slug},
            )
        for slug, name, wkt in FIXTURE_NON_NER_STATES:
            await session.execute(
                text(
                    "INSERT INTO states (name, slug, source_name, is_ner, geometry, "
                    f"geometry_source) VALUES (:name, :slug, :src, false, {_geom('wkt')}, :src) "
                    "ON CONFLICT (slug) DO UPDATE SET geometry = EXCLUDED.geometry, "
                    "geometry_source = EXCLUDED.geometry_source"
                ),
                {"name": name, "slug": slug, "wkt": wkt, "src": FIXTURE_SOURCE},
            )
        await session.execute(
            text(
                "INSERT INTO districts (state_id, name, slug, source_name, source_status) "
                "SELECT id, 'FIXTURE Kamrup', :slug, :sname, 'TEST' FROM states "
                "WHERE slug = 'assam' ON CONFLICT (state_id, slug) DO NOTHING"
            ),
            {"slug": FIXTURE_DISTRICT_SLUG, "sname": FIXTURE_DISTRICT_SOURCE_NAME},
        )
        # Operational only while the fixture is loaded: district classification
        # counts VERIFIED_OFFICIAL/DEMO rows, and `unload` puts TEST back.
        await session.execute(
            text(
                f"UPDATE districts SET geometry = {_geom('wkt')}, geometry_source = :src, "
                "source_status = 'DEMO' WHERE slug = :slug"
            ),
            {"wkt": FIXTURE_KAMRUP, "src": FIXTURE_SOURCE, "slug": FIXTURE_DISTRICT_SLUG},
        )
    await session.commit()


async def unload(session: AsyncSession) -> None:
    """Remove every fixture-marked geometry. Rows stay; their shapes do not."""
    params = {"src": FIXTURE_SOURCE}
    await session.execute(
        text("DELETE FROM country_boundaries WHERE geometry_source = :src"), params
    )
    clear = (
        "geometry = NULL, geometry_source = NULL, geometry_source_version = NULL, "
        "geometry_verified_at = NULL"
    )
    await session.execute(
        text(f"UPDATE states SET {clear} WHERE geometry_source = :src"), params
    )
    await session.execute(
        text(
            f"UPDATE districts SET {clear}, source_status = 'TEST', source_name = :sname "
            "WHERE geometry_source = :src"
        ),
        {**params, "sname": FIXTURE_DISTRICT_SOURCE_NAME},
    )
    await session.commit()
