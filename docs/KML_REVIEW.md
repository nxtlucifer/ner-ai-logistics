# Google Earth KML review (13 Sep 2026)

Files inspected: `Untitled map project (3).kml` and `(4).kml` (Google Earth web exports, 24 and 25 layers).

## What is in them

Every layer is a `GroundOverlay` with a 1×1 transparent GIF icon, a world-spanning
`LatLonBox`, and a `gx:MapTilePyramid` whose `Link/href` is
`earthdatalayer:0:…` (file 3 prefixes it with `files/`). Those are Google Earth's
internal, account-managed tile references: they resolve only inside Google Earth
and carry no data. There is **no Placemark, Point, LineString or Polygon** in either
file.

```
KML_STANDARD_GEOMETRY      = NONE
KML_GOOGLE_INTERNAL_LAYERS = 24 (file 3) / 25 (file 4), all ignored
KML_LAYER_CONCEPTS_REVIEWED = YES
```

Nothing was imported, and nothing here claims to have been.

## Layer concepts → the open source RASTA already uses (or deliberately does not)

| Google Earth layer | Useful concept | RASTA today | Verdict |
|---|---|---|---|
| Digital elevation model (Copernicus GLO-30) | elevation along the corridor | Copernicus DEM via Open-Meteo elevation, OpenTopoData SRTM fallback (`services/terrain.py`) | already in use |
| Slope / Aspect (10 m) | gradient on the route | slope derived from the sampled DEM (`domain/terrain.py`); aspect not used | in use (slope); aspect = no consumer |
| Elevation contours 20/40 m | visual | hillshade tiles on the driver map (MapTiler) | cosmetic, covered |
| Surface water · Inundation (flooding) history | flood context | GloFAS discharge vs 30-day mean (`services/flood.py`) | context in use; inundation history = FUTURE (Google Flood Hub history is downloadable, not integrated) |
| Land cover (ESA WorldCover v100/v200) · Forest cover | landslide susceptibility feature | not used | FUTURE: only worth adding as a feature of a validated model (none yet) |
| Administrative areas L1–L3 · Localities | district match for CAP alerts | Nominatim reverse geocode → district (`services/warnings.py`) | in use |
| Building footprints · Land parcels | none for a corridor | — | not relevant |
| Population (US census tracts), Traffic signal LOS (Seattle), Land use zones (Australia/Canada), Street lights, Storm drains, Maintenance covers, Bike lanes, EV chargers | none | — | US/AU/CA-centric or municipal; not relevant to NER |

## Standard KML import

`STANDARD_KML_IMPORT_READY = NOT_NEEDED`. The supplied files contain nothing
portable, the demo has no depot/hazard layers to import, and the manager already
accepts pasted Google Maps links for places (`/api/geocoding/resolve-link`). If a
real reference layer arrives as standard KML, the safe path is: `defusedxml`
(no external entities), size cap, extract Placemark Point/LineString/Polygon
coordinates, validate ranges, preview on the manager map, store as a reference
layer. Any `earthdatalayer:` / `gx:MapTilePyramid` layer is reported as
"Google Earth managed layer is not portable" and skipped, never a failure.
