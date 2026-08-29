"""Database and PostGIS foundation tests.

These run against the real database. They prove the spatial stack works end to end
rather than merely that the extension is installed.
"""

import pytest
from sqlalchemy import text

from app.db.session import get_sessionmaker

pytestmark = pytest.mark.requires_db

# Guwahati, matching the bootstrap migration.
GUWAHATI_LON = 91.7362
GUWAHATI_LAT = 26.1445


class TestConnection:
    async def test_can_connect_and_query(self) -> None:
        async with get_sessionmaker()() as session:
            assert (await session.execute(text("SELECT 1"))).scalar_one() == 1

    async def test_postgis_extension_installed(self) -> None:
        async with get_sessionmaker()() as session:
            installed = (
                await session.execute(
                    text("SELECT 1 FROM pg_extension WHERE extname = 'postgis'")
                )
            ).scalar_one_or_none()
        assert installed == 1, "PostGIS extension is not installed"


class TestBootstrapMigration:
    async def test_system_info_row_exists(self) -> None:
        async with get_sessionmaker()() as session:
            marker = (
                await session.execute(
                    text("SELECT schema_marker FROM system_info WHERE id = 1")
                )
            ).scalar_one()
        assert marker == "foundation-p1"

    async def test_reference_point_round_trips_through_postgis(self) -> None:
        """The stored geography must come back as the coordinate written."""
        async with get_sessionmaker()() as session:
            lon, lat = (
                await session.execute(
                    text(
                        "SELECT ST_X(reference_location::geometry), "
                        "ST_Y(reference_location::geometry) "
                        "FROM system_info WHERE id = 1"
                    )
                )
            ).one()
        assert lon == pytest.approx(GUWAHATI_LON, abs=1e-6)
        assert lat == pytest.approx(GUWAHATI_LAT, abs=1e-6)


class TestGeographySemantics:
    """Guard the geography-vs-geometry decision from docs/DATA_MODEL.md section 1.

    Distances on `geography` are metres. On `geometry` in SRID 4326 they are
    degrees, and at 26 degrees N a degree of longitude is about 90 km against
    111 km for latitude. Proximity checks in the safety path depend on this being
    right, so it is asserted rather than assumed.
    """

    async def test_distance_is_measured_in_metres(self) -> None:
        # Guwahati to Jorhat, the demo corridor. Roughly 250 km straight-line.
        async with get_sessionmaker()() as session:
            metres = (
                await session.execute(
                    text(
                        "SELECT ST_Distance("
                        "  ST_SetSRID(ST_MakePoint(:lon1, :lat1), 4326)::geography,"
                        "  ST_SetSRID(ST_MakePoint(:lon2, :lat2), 4326)::geography)"
                    ),
                    {
                        "lon1": GUWAHATI_LON,
                        "lat1": GUWAHATI_LAT,
                        "lon2": 94.2037,
                        "lat2": 26.7509,
                    },
                )
            ).scalar_one()
        assert 240_000 < metres < 270_000, f"expected ~250 km in metres, got {metres}"

    async def test_dwithin_radius_is_symmetric_in_both_axes(self) -> None:
        """A 10 km radius must behave the same north-south and east-west.

        This is the exact bug that using `geometry` instead of `geography` would
        introduce, and it would silently corrupt incident-to-route matching.
        """
        # 0.05 degrees of latitude is ~5.6 km; 0.05 degrees of longitude at
        # 26 N is ~5.0 km. Both are inside 10 km, and both must match.
        async with get_sessionmaker()() as session:
            north, east = (
                await session.execute(
                    text(
                        "SELECT "
                        " ST_DWithin(a, ST_SetSRID(ST_MakePoint(:lon, :lat_n), 4326)::geography, 10000),"
                        " ST_DWithin(a, ST_SetSRID(ST_MakePoint(:lon_e, :lat), 4326)::geography, 10000)"
                        " FROM (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography AS a) s"
                    ),
                    {
                        "lon": GUWAHATI_LON,
                        "lat": GUWAHATI_LAT,
                        "lat_n": GUWAHATI_LAT + 0.05,
                        "lon_e": GUWAHATI_LON + 0.05,
                    },
                )
            ).one()
        assert north is True and east is True
