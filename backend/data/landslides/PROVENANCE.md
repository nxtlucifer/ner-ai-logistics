# Landslide inventory snapshot — provenance

`glc_ner.csv` is a bundled, provenance-labelled slice of the **NASA Global
Landslide Catalog (GLC)**. It exists because the live sources this project
prefers are not machine-reachable in hackathon time, and the alternative —
no history at all — was being reported as `historical_incidents:
NOT_AVAILABLE` on every route.

| | |
|---|---|
| Dataset | NASA Global Landslide Catalog Export |
| Publisher | NASA Goddard Space Flight Center, via the NASA Open Data Portal |
| Portal record | https://data.nasa.gov/dataset/global-landslide-catalog-export |
| File fetched | `https://data.nasa.gov/docs/legacy/Global_Landslide_Catalog_Export/Global_Landslide_Catalog_Export_rows.csv` |
| Fetched on | 2026-09-11 (UTC), HTTP 200, 8,479,717 bytes, 11,033 rows |
| Source file SHA-256 (first 16) | `2c4898899dd4f373` |
| Portal licence field | "License not specified". NASA data on the portal is published as U.S. Government work; cite Kirschbaum et al. (see below). |
| Slice | rows with a coordinate inside lat 23.5–29.5 N, lon 89.0–97.5 E (the North Eastern Region and its margins) — **471 events, 2007–2017** |
| Columns kept | event id/date/title, location description and **accuracy**, trigger, size, category, fatalities, country, state, source name/link, latitude, longitude |

Citation: Kirschbaum, D. B., Adler, R., Hong, Y., Hill, S., & Lerner-Lam, A.
(2010). *A global landslide catalog for hazard applications: method, results,
and limitations.* Natural Hazards, 52(3), 561–575. And: Kirschbaum, D. B.,
Stanley, T., & Zhou, Y. (2015). *Spatial and temporal analysis of a global
landslide catalog.* Geomorphology, 249, 4–15.

## What it is, and what it is not

- It is a **historical inventory**, compiled largely from news reports, with a
  per-event **location accuracy** ("exact", "1km", "5km", "10km", "25km",
  "50km", "unknown"). The application honours that field: an event placed to
  50 km is never counted as being *on* a 5 km corridor.
- It **ends in 2017**. The application flags the inventory as aged so that
  "no recorded landslides on this corridor" is never read as "none recently".
- It is **not** a current-incident feed and is never used as one. The
  `landslide` (current) factor remains `NOT_CONFIGURED` until a live source
  is connected; this file feeds the separate `historical_incidents` factor.
- It is **not** a susceptibility map. GSI / NRSC susceptibility classes were
  not reachable as a machine-readable service; that dimension stays
  explicitly unknown rather than being inferred from this inventory.

## How to refresh

Re-fetch the export URL above, re-run the slice with the same bounding box,
update the fetched-on date, byte count and hash here. `tests/test_glc_snapshot.py`
asserts the file parses, the bounding box holds, and the accuracy field is honoured.
