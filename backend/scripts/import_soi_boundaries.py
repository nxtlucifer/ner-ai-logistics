"""Load the Survey of India administrative boundaries into PostGIS (migration 0016).

    python scripts/import_soi_boundaries.py \\
        --country  <India outline .shp> \\
        --states   <state boundaries .shp> \\
        --districts <district boundaries .shp> \\
        --source-version "<edition / date printed on the download>" \\
        --field state_name=<ATTR> --field district_name=<ATTR>

SOURCE: Survey of India, Administrative Boundary Database, OVSF/1M/7
(shapefile, 1:1M, country to district with HQ). The download needs a CAPTCHA
and a privacy-policy consent the owner completes personally; this script never
fetches anything. geoBoundaries / OpenStreetMap are NOT substitutes for it.

LOCAL / ISOLATED / CERT DATABASES ONLY. A non-local database host is refused.

WHAT IT DOES, IN ORDER, IN ONE TRANSACTION

 1. refuses unless every attribute name in FIELDS is known (see TODO below);
 2. checks each layer's CRS from its .prj - WGS 84 geographic only;
 3. converts each layer to GeoJSON with ogr2ogr (no GIS package is installed
    in the venv; ogr2ogr ships with the PostGIS bundle) and stages every
    feature in a temp table;
 4. validates every geometry: polygonal and non-empty, or refuse; an invalid
    one is repaired with ST_MakeValid and the repair is RECORDED (name +
    ST_IsValidReason) in the summary - never silently;
 5. India = the union of the country layer, written to country_boundaries;
 6. states are matched to existing rows by normalised name. The eight NER rows
    keep their ids and all eight must be in the source, or nothing is
    written. Every other state is inserted with is_ner = false - which grants
    nobody anything (app/core/scope.py);
 7. districts are loaded for NER states only, parented SPATIALLY (the state
    that covers the district's ST_PointOnSurface), matched by slug within the
    state, and marked VERIFIED_OFFICIAL;
 8. idempotent: a shape is rewritten only when it or its source version
    changed, so a second run reports nothing changed.

Prints a JSON summary. Exit 0 on success, 2 when refused.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, text  # noqa: E402

from app.core.config import LOCAL_HOSTS, _host_of, get_settings  # noqa: E402

SOURCE = "SURVEY_OF_INDIA_OVSF_1M_7"
SOURCE_NAME = "Survey of India, Administrative Boundary Database (OVSF/1M/7), 1:1M"

#: Attribute names in the SoI layers.
#:
#: TODO(SoI schema): the real OVSF/1M/7 files have not been seen. Inspect them
#: with `ogrinfo -so -al <layer>.shp`, then set these (or pass --field). Until
#: then the importer refuses to run: guessing an attribute name would load
#: the wrong column as a state name without any error.
#: TODO(SoI schema): also confirm the DBF encoding (.cpg), whether the country
#: layer is one feature or several, and the CRS (only WGS 84 is accepted below;
#: anything else needs a reviewed reprojection step, not an automatic one).
FIELDS: dict[str, str | None] = {
    "state_name": None,  # TODO(SoI schema): state-name attribute, states layer
    "district_name": None,  # TODO(SoI schema): district-name attribute, districts layer
}


class ImportRefused(RuntimeError):
    """The import stopped before writing anything."""


def normalise_name(raw: str) -> str:
    """Name equality key: Unicode-compatible, case-free, '&' is 'and', one space."""
    name = unicodedata.normalize("NFKC", raw).casefold().replace("&", " and ")
    return " ".join(name.split())


def slugify(raw: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", normalise_name(raw)).strip("-")


def require_local(url: str) -> None:
    host = _host_of(url)
    if host not in LOCAL_HOSTS:
        raise ImportRefused(
            f"Refusing to import into database host '{host}': boundary imports are "
            "for local, isolated and cert databases only."
        )


def check_crs(prj: Path) -> None:
    """WGS 84 geographic, or refuse. Deliberately strict: a wrong CRS puts every
    boundary in the wrong place without a single error."""
    if not prj.exists():
        raise ImportRefused(f"CRS unknown: {prj.name} is missing.")
    wkt = prj.read_text(encoding="utf-8", errors="replace").upper().replace(" ", "_")
    if "PROJCS" in wkt or "GEOGCS" not in wkt or "WGS_1984" not in wkt and "WGS_84" not in wkt:
        raise ImportRefused(
            f"CRS of {prj.name} is not WGS 84 geographic. TODO(SoI schema): add a "
            "reviewed reprojection step for the source CRS."
        )


def _sha256(shp: Path) -> str:
    digest = hashlib.sha256()
    for suffix in (".shp", ".shx", ".dbf", ".prj"):
        part = shp.with_suffix(suffix)
        if part.exists():
            digest.update(part.read_bytes())
    return digest.hexdigest()


def read_layer(shp: Path, ogr2ogr: str, workdir: Path) -> list[dict]:
    check_crs(shp.with_suffix(".prj"))
    out = workdir / f"{shp.stem}.geojson"
    done = subprocess.run(
        [ogr2ogr, "-f", "GeoJSON", str(out), str(shp)], capture_output=True, text=True
    )
    if done.returncode != 0:
        raise ImportRefused(f"ogr2ogr could not read {shp.name}: {done.stderr.strip()[:300]}")
    features = json.loads(out.read_text(encoding="utf-8"))["features"]
    if not features:
        raise ImportRefused(f"{shp.name} has no features.")
    return features


def _name(feature: dict, field: str, layer: str) -> str:
    value = (feature.get("properties") or {}).get(field)
    if not isinstance(value, str) or not value.strip():
        raise ImportRefused(f"A {layer} feature has no '{field}' value.")
    return " ".join(value.split())


def run(
    *,
    country_shp: Path,
    states_shp: Path,
    districts_shp: Path,
    source_version: str,
    ogr2ogr: str,
    fields: dict[str, str | None] | None = None,
    source: str = SOURCE,
    source_name: str = SOURCE_NAME,
    database_url: str | None = None,
) -> dict:
    fields = {**FIELDS, **(fields or {})}
    missing = [k for k, v in fields.items() if not v]
    if missing:
        raise ImportRefused(
            f"TODO(SoI schema): attribute names not confirmed for {missing}. Inspect the "
            "real shapefiles with `ogrinfo -so -al` and pass --field."
        )
    url = database_url or get_settings().effective_database_url
    require_local(url)

    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        staged = [("country", "India", f) for f in read_layer(Path(country_shp), ogr2ogr, work)]
        staged += [
            ("state", _name(f, fields["state_name"], "state"), f)
            for f in read_layer(Path(states_shp), ogr2ogr, work)
        ]
        staged += [
            ("district", _name(f, fields["district_name"], "district"), f)
            for f in read_layer(Path(districts_shp), ogr2ogr, work)
        ]
    version = f"{source_version}; sha256 " + ", ".join(
        f"{p.stem}={_sha256(Path(p))[:16]}" for p in (country_shp, states_shp, districts_shp)
    )
    params = {"src": source, "ver": version, "sname": source_name}

    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            return _load(conn, staged, params)
    finally:
        engine.dispose()


def _load(conn, staged: list[tuple[str, str, dict]], params: dict) -> dict:
    conn.execute(text(
        "CREATE TEMP TABLE soi_stage (layer text, name text, norm text, slug text, "
        "geom geometry, repaired text) ON COMMIT DROP"
    ))
    conn.execute(
        text(
            "INSERT INTO soi_stage (layer, name, norm, slug, geom) VALUES "
            "(:layer, :name, :norm, :slug, ST_SetSRID(ST_GeomFromGeoJSON(:g), 4326))"
        ),
        [
            {"layer": layer, "name": name, "norm": normalise_name(name), "slug": slugify(name),
             "g": json.dumps(feature["geometry"])}
            for layer, name, feature in staged
        ],
    )
    bad = conn.execute(text(
        "SELECT layer, name FROM soi_stage WHERE geom IS NULL OR ST_IsEmpty(geom) "
        "OR GeometryType(geom) NOT IN ('POLYGON', 'MULTIPOLYGON') ORDER BY layer, name"
    )).all()
    if bad:
        raise ImportRefused(f"Empty or non-polygon geometry: {[tuple(b) for b in bad][:10]}")
    # Repair only what is invalid, and say so.
    conn.execute(text(
        "UPDATE soi_stage SET repaired = ST_IsValidReason(geom), geom = ST_MakeValid(geom) "
        "WHERE NOT ST_IsValid(geom)"
    ))
    conn.execute(text("UPDATE soi_stage SET geom = ST_Multi(ST_CollectionExtract(geom, 3))"))
    repaired = [
        {"layer": r.layer, "name": r.name, "reason": r.repaired}
        for r in conn.execute(text(
            "SELECT layer, name, repaired FROM soi_stage WHERE repaired IS NOT NULL ORDER BY layer, name"
        ))
    ]
    if conn.execute(text("SELECT count(*) FROM soi_stage WHERE ST_IsEmpty(geom)")).scalar_one():
        raise ImportRefused("A geometry was empty after repair.")

    # --- Country -----------------------------------------------------------
    country = conn.execute(
        text(
            "WITH u AS (SELECT ST_Multi(ST_Union(geom)) AS g FROM soi_stage WHERE layer = 'country') "
            "INSERT INTO country_boundaries (code, name, geometry, geometry_source, "
            "geometry_source_version, geometry_verified_at) "
            "SELECT 'IN', 'India', g, :src, :ver, now() FROM u "
            "ON CONFLICT (code) DO UPDATE SET geometry = EXCLUDED.geometry, "
            "geometry_source = EXCLUDED.geometry_source, "
            "geometry_source_version = EXCLUDED.geometry_source_version, "
            "geometry_verified_at = EXCLUDED.geometry_verified_at "
            "WHERE NOT ST_Equals(country_boundaries.geometry, EXCLUDED.geometry) "
            "OR country_boundaries.geometry_source IS DISTINCT FROM EXCLUDED.geometry_source "
            "OR country_boundaries.geometry_source_version IS DISTINCT FROM EXCLUDED.geometry_source_version "
            "RETURNING (xmax = 0) AS inserted"
        ),
        params,
    ).first()
    country_result = "unchanged" if country is None else ("inserted" if country.inserted else "updated")

    # --- States --------------------------------------------------------------
    rows = conn.execute(text("SELECT id, name, is_ner FROM states")).all()
    by_norm = {normalise_name(r.name): r for r in rows}
    source_states = dict(conn.execute(text(
        "SELECT DISTINCT ON (norm) norm, name FROM soi_stage WHERE layer = 'state' ORDER BY norm, name"
    )).all())
    absent = sorted(r.name for r in rows if r.is_ner and normalise_name(r.name) not in source_states)
    if absent:
        raise ImportRefused(f"NER states missing from the source layer: {absent}")
    shape = "(SELECT ST_Multi(ST_Union(geom)) FROM soi_stage WHERE layer = 'state' AND norm = :norm)"
    changed, inserted = 0, []
    for norm, name in sorted(source_states.items()):
        row = by_norm.get(norm)
        if row is None:
            conn.execute(
                text(
                    "INSERT INTO states (name, slug, source_name, is_ner, geometry, geometry_source, "
                    f"geometry_source_version, geometry_verified_at) VALUES (:name, :slug, :sname, false, "
                    f"{shape}, :src, :ver, now())"
                ),
                {**params, "name": name, "slug": slugify(name), "norm": norm},
            )
            inserted.append(name)
            continue
        changed += conn.execute(
            text(
                f"UPDATE states SET geometry = s.g, geometry_source = :src, geometry_source_version = :ver, "
                f"geometry_verified_at = now() FROM (SELECT {shape} AS g) s WHERE states.id = :id "
                "AND (states.geometry IS NULL OR NOT ST_Equals(states.geometry, s.g) "
                "OR states.geometry_source IS DISTINCT FROM :src "
                "OR states.geometry_source_version IS DISTINCT FROM :ver)"
            ),
            {**params, "id": row.id, "norm": norm},
        ).rowcount
    states = {"matched_ner": sum(1 for r in rows if r.is_ner), "changed": changed, "inserted": inserted}

    # --- Districts: NER only, parented spatially ------------------------------
    placed = conn.execute(text(
        "SELECT st.slug, min(st.name) AS name, s.id AS state_id, bool_and(s.is_ner) AS is_ner "
        "FROM soi_stage st JOIN states s ON s.geometry IS NOT NULL "
        "AND ST_Covers(s.geometry, ST_PointOnSurface(st.geom)) "
        "WHERE st.layer = 'district' GROUP BY st.slug, s.id ORDER BY st.slug"
    )).all()
    total = conn.execute(text("SELECT count(DISTINCT slug) FROM soi_stage WHERE layer = 'district'")).scalar_one()
    unplaced = total - len({p.slug for p in placed})
    outside_ner = sum(1 for p in placed if not p.is_ner)
    d_shape = (
        "(SELECT ST_Multi(ST_Union(geom)) FROM soi_stage WHERE layer = 'district' "
        "AND slug = CAST(:slug AS text))"
    )
    d_changed, d_inserted = 0, []
    for p in (p for p in placed if p.is_ner):
        args = {**params, "slug": p.slug, "state_id": p.state_id, "name": p.name}
        hit = conn.execute(
            text(
                f"UPDATE districts SET geometry = s.g, geometry_source = :src, "
                "geometry_source_version = :ver, geometry_verified_at = now(), "
                "source_status = 'VERIFIED_OFFICIAL', source_name = :sname "
                f"FROM (SELECT {d_shape} AS g) s WHERE districts.state_id = :state_id "
                "AND districts.slug = CAST(:slug AS text) AND (districts.geometry IS NULL "
                "OR NOT ST_Equals(districts.geometry, s.g) "
                "OR districts.geometry_source IS DISTINCT FROM :src "
                "OR districts.geometry_source_version IS DISTINCT FROM :ver "
                "OR districts.source_status <> 'VERIFIED_OFFICIAL') RETURNING districts.id"
            ),
            args,
        ).first()
        if hit is not None:
            d_changed += 1
            continue
        exists = conn.execute(
            text("SELECT 1 FROM districts WHERE state_id = :state_id AND slug = CAST(:slug AS text)"), args
        ).first()
        if exists is None:
            conn.execute(
                text(
                    "INSERT INTO districts (state_id, name, slug, source_name, source_status, geometry, "
                    "geometry_source, geometry_source_version, geometry_verified_at) VALUES "
                    f"(:state_id, :name, CAST(:slug AS text), :sname, 'VERIFIED_OFFICIAL', {d_shape}, :src, :ver, now())"
                ),
                args,
            )
            d_inserted.append(p.name)
    districts = {
        "changed": d_changed, "inserted": d_inserted,
        "outside_ner": outside_ner, "unplaced": unplaced,
    }
    return {"country": country_result, "states": states, "districts": districts, "repaired": repaired,
            "source": params["src"], "source_version": params["ver"]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--country", required=True, type=Path)
    parser.add_argument("--states", required=True, type=Path)
    parser.add_argument("--districts", required=True, type=Path)
    parser.add_argument("--source-version", required=True)
    parser.add_argument("--ogr2ogr", default=shutil.which("ogr2ogr"))
    parser.add_argument("--field", action="append", default=[], metavar="KEY=ATTR",
                        help=f"attribute mapping, keys: {', '.join(FIELDS)}")
    args = parser.parse_args(argv)
    if not args.ogr2ogr:
        print("ogr2ogr not found; pass --ogr2ogr.", file=sys.stderr)
        return 2
    try:
        fields = dict(f.split("=", 1) for f in args.field)
        summary = run(
            country_shp=args.country, states_shp=args.states, districts_shp=args.districts,
            source_version=args.source_version, ogr2ogr=args.ogr2ogr, fields=fields,
        )
    except (ImportRefused, ValueError) as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
