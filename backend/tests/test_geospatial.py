"""Geospatial behaviour against the real PostGIS installation.

Uses real North-East India coordinates so a wrong answer is recognisably wrong
rather than merely a number. The dominant risk being guarded here is
latitude/longitude inversion, which produces valid-looking geometry that is
silently in the wrong hemisphere.
"""

import uuid

import pytest
from sqlalchemy import Connection, text

pytestmark = pytest.mark.requires_db

# Real NER locations. Longitude first in WKT, which is the ordering that trips
# people up.
GUWAHATI = (91.7362, 26.1445)
JORHAT = (94.2037, 26.7509)
SHILLONG = (91.8933, 25.5788)

# Straight-line Guwahati -> Jorhat, verified independently: ~255 km.
GUWAHATI_JORHAT_M = 255_097


def _wkt(lon: float, lat: float) -> str:
    return f"POINT({lon} {lat})"


class TestSridAndOrdering:
    def test_stored_points_use_srid_4326(self, db: Connection) -> None:
        srid = db.execute(
            text("SELECT ST_SRID(ST_GeogFromText(:p)::geometry)"),
            {"p": _wkt(*GUWAHATI)},
        ).scalar_one()
        assert srid == 4326

    def test_coordinate_ordering_round_trips(self, db: Connection) -> None:
        """ST_X is longitude and ST_Y is latitude. Getting this backwards puts
        Guwahati in the Arctic."""
        lon, lat = db.execute(
            text(
                "SELECT ST_X(g::geometry), ST_Y(g::geometry) "
                "FROM (SELECT ST_GeogFromText(:p) AS g) s"
            ),
            {"p": _wkt(*GUWAHATI)},
        ).one()
        assert lon == pytest.approx(GUWAHATI[0], abs=1e-6)
        assert lat == pytest.approx(GUWAHATI[1], abs=1e-6)

    def test_postgis_silently_wraps_an_out_of_range_latitude(
        self, db: Connection
    ) -> None:
        """PostGIS does NOT reject inverted coordinates - it wraps them.

        Feeding it Guwahati with lat/lon swapped (lat=91.7362) produces no
        error. PostGIS reflects the value over the pole and stores latitude
        88.2638 - a plausible-looking point in the Arctic Ocean, roughly 7000 km
        from Assam.

        This test exists to pin that behaviour down, because it means **the
        database is not a defence against latitude/longitude inversion**. The
        Coordinate bounds in app/schemas/common.py are the only layer that
        catches it, which makes them a safety control rather than input
        hygiene. Every coordinate entering the system must pass through them.
        """
        wrapped_lat = db.execute(
            text("SELECT ST_Y(ST_GeogFromText(:p)::geometry)"),
            {"p": _wkt(GUWAHATI[1], GUWAHATI[0])},  # deliberately swapped
        ).scalar_one()

        assert wrapped_lat == pytest.approx(88.2638, abs=1e-4), (
            "PostGIS behaviour changed. If it now raises instead of wrapping, "
            "that is an improvement - update this test and the note in "
            "docs/DATA_MODEL.md."
        )
        assert wrapped_lat != GUWAHATI[1], "the wrapped value is not Guwahati"

    def test_application_layer_rejects_what_postgis_would_wrap(self) -> None:
        """The compensating control for the behaviour above."""
        from pydantic import ValidationError

        from app.schemas.common import Coordinate

        with pytest.raises(ValidationError):
            Coordinate(lat=GUWAHATI[0], lon=GUWAHATI[1])  # swapped: lat=91.7362


class TestDistance:
    def test_distance_is_returned_in_metres(self, db: Connection) -> None:
        """geography, not geometry: the answer must be metres, not degrees."""
        metres = db.execute(
            text(
                "SELECT ST_Distance(ST_GeogFromText(:a), ST_GeogFromText(:b))"
            ),
            {"a": _wkt(*GUWAHATI), "b": _wkt(*JORHAT)},
        ).scalar_one()
        assert metres == pytest.approx(GUWAHATI_JORHAT_M, rel=0.02)

    def test_distance_is_symmetric(self, db: Connection) -> None:
        forward, backward = db.execute(
            text(
                "SELECT ST_Distance(ST_GeogFromText(:a), ST_GeogFromText(:b)), "
                "ST_Distance(ST_GeogFromText(:b), ST_GeogFromText(:a))"
            ),
            {"a": _wkt(*GUWAHATI), "b": _wkt(*JORHAT)},
        ).one()
        assert forward == pytest.approx(backward)

    def test_distance_to_self_is_zero(self, db: Connection) -> None:
        d = db.execute(
            text("SELECT ST_Distance(ST_GeogFromText(:a), ST_GeogFromText(:a))"),
            {"a": _wkt(*GUWAHATI)},
        ).scalar_one()
        assert d == pytest.approx(0.0)


class TestProximity:
    def test_dwithin_is_isotropic_at_ner_latitude(self, db: Connection) -> None:
        """The specific bug that using `geometry` would introduce.

        At 26 degrees N a degree of longitude is about 90 km against 111 km for
        latitude. On `geometry` the same numeric offset would give very
        different distances; on `geography` both are true metres, so a 10 km
        radius behaves identically north-south and east-west.
        """
        lon, lat = GUWAHATI
        north, east = db.execute(
            text(
                "SELECT "
                " ST_DWithin(ST_GeogFromText(:c), ST_GeogFromText(:n), 10000), "
                " ST_DWithin(ST_GeogFromText(:c), ST_GeogFromText(:e), 10000)"
            ),
            {
                "c": _wkt(lon, lat),
                "n": _wkt(lon, lat + 0.05),   # ~5.6 km north
                "e": _wkt(lon + 0.05, lat),   # ~5.0 km east
            },
        ).one()
        assert north is True and east is True

    def test_dwithin_excludes_points_beyond_the_radius(
        self, db: Connection
    ) -> None:
        within = db.execute(
            text("SELECT ST_DWithin(ST_GeogFromText(:a), ST_GeogFromText(:b), 10000)"),
            {"a": _wkt(*GUWAHATI), "b": _wkt(*JORHAT)},
        ).scalar_one()
        assert within is False

    def test_shillong_is_nearer_to_guwahati_than_jorhat_is(
        self, db: Connection
    ) -> None:
        """A sanity check a reader can verify on a map."""
        to_shillong, to_jorhat = db.execute(
            text(
                "SELECT ST_Distance(ST_GeogFromText(:g), ST_GeogFromText(:s)), "
                "ST_Distance(ST_GeogFromText(:g), ST_GeogFromText(:j))"
            ),
            {"g": _wkt(*GUWAHATI), "s": _wkt(*SHILLONG), "j": _wkt(*JORHAT)},
        ).one()
        assert to_shillong < to_jorhat


class TestSpatialStorageAndIndexes:
    def test_geography_columns_registered_with_correct_type(
        self, db: Connection
    ) -> None:
        rows = db.execute(
            text(
                "SELECT f_table_name, f_geography_column, type, srid "
                "FROM geography_columns WHERE f_table_schema = 'public'"
            )
        ).all()
        by_table = {(r.f_table_name, r.f_geography_column): r for r in rows}

        expected = {
            ("shipments", "pickup_location"): "Point",
            ("shipments", "destination_location"): "Point",
            ("trip_stops", "location"): "Point",
            ("trip_routes", "geometry"): "LineString",
            ("trip_events", "location"): "Point",
            ("gps_points", "location"): "Point",
        }
        for key, geom_type in expected.items():
            assert key in by_table, f"{key} is not a registered geography column"
            assert by_table[key].srid == 4326, f"{key} has wrong SRID"
            assert by_table[key].type.lower() == geom_type.lower(), (
                f"{key} is {by_table[key].type}, expected {geom_type}"
            )

    def test_gist_indexes_exist_on_every_spatial_column(
        self, db: Connection
    ) -> None:
        """Without these, proximity queries table-scan.

        The Fleet Sentinel monitor and the incident-to-route intersection both
        depend on them at a cadence where a scan is not viable.
        """
        expected_indexes = {
            "ix_shipments_pickup_location",
            "ix_shipments_destination_location",
            "ix_trip_stops_location",
            "ix_trip_routes_geometry",
            "ix_gps_location",
        }
        rows = db.execute(
            text(
                "SELECT i.relname AS index_name, am.amname AS method "
                "FROM pg_class i "
                "JOIN pg_index ix ON ix.indexrelid = i.oid "
                "JOIN pg_am am ON am.oid = i.relam "
                "JOIN pg_class t ON t.oid = ix.indrelid "
                "JOIN pg_namespace n ON n.oid = t.relnamespace "
                "WHERE n.nspname = 'public' AND i.relname = ANY(:names)"
            ),
            {"names": sorted(expected_indexes)},
        ).all()
        found = {r.index_name: r.method for r in rows}

        missing = expected_indexes - set(found)
        assert not missing, f"missing spatial indexes: {sorted(missing)}"

        not_gist = sorted(n for n, m in found.items() if m != "gist")
        assert not not_gist, f"these indexes are not GIST: {not_gist}"

    def test_geography_point_persists_and_reads_back(self, db: Connection) -> None:
        """Full round trip through an actual table column."""
        shipment_id = db.execute(
            text(
                "INSERT INTO shipments (reference_code, client_name, pickup_address, "
                "pickup_location, destination_address, destination_location) "
                "VALUES (:ref, 'Test', 'Jorhat', ST_GeogFromText(:pk), "
                "'Guwahati', ST_GeogFromText(:dt)) RETURNING id"
            ),
            {
                "ref": f"SHP-{uuid.uuid4().hex[:8]}",
                "pk": _wkt(*JORHAT),
                "dt": _wkt(*GUWAHATI),
            },
        ).scalar_one()

        lon, lat, metres = db.execute(
            text(
                "SELECT ST_X(pickup_location::geometry), "
                "ST_Y(pickup_location::geometry), "
                "ST_Distance(pickup_location, destination_location) "
                "FROM shipments WHERE id = :s"
            ),
            {"s": shipment_id},
        ).one()

        assert lon == pytest.approx(JORHAT[0], abs=1e-6)
        assert lat == pytest.approx(JORHAT[1], abs=1e-6)
        assert metres == pytest.approx(GUWAHATI_JORHAT_M, rel=0.02)

    def test_linestring_route_length_is_sane(self, db: Connection) -> None:
        length = db.execute(
            text("SELECT ST_Length(ST_GeogFromText(:line))"),
            {
                "line": (
                    f"LINESTRING({JORHAT[0]} {JORHAT[1]}, "
                    f"{GUWAHATI[0]} {GUWAHATI[1]})"
                )
            },
        ).scalar_one()
        assert length == pytest.approx(GUWAHATI_JORHAT_M, rel=0.02)
