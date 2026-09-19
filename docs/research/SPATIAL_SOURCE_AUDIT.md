# Spatial source audit

Two questions: what `bchapuis/awesome-spatial-data` would have added, and what
spatial sources RASTA actually runs on today.

## 1. `bchapuis/awesome-spatial-data` — `NOT_AUDITED`

Not fetched. This session has no authorisation to reach github.com, so the list was
never opened. See [GITHUB_REFERENCE_AUDIT.md](GITHUB_REFERENCE_AUDIT.md).

What it is, by category, is a curated index of links. Its value would be pointers to
datasets — and the binding constraint on RASTA's hazard evidence is not a shortage of
pointers. It is that the two sources that would matter most (GSI/Bhukosh susceptibility
and IMD historical rainfall) are behind portals and request forms, not behind a missing
link. A link list does not move that.

## 2. The spatial sources RASTA actually runs on

Read out of the code, not out of a plan. Each row names the module a judge can open.

| Layer | Source | Where | State today |
|---|---|---|---|
| Road network / routing | OSRM | `backend/app/services/routing/osrm.py` | Live. Region-gated; out-of-region stops refused. |
| Base map tiles | MapTiler | driver app + manager web (key from env only) | Live. |
| Elevation / slope | Copernicus DEM via Open-Meteo elevation; SRTM via OpenTopoData | `backend/app/services/terrain.py` | Live, with fallback between the two. |
| Weather | Open-Meteo (primary), MET Norway (fallback) | `backend/app/services/weather/` | Live, with provider health and freshness. |
| River discharge | GloFAS via the Open-Meteo flood API | `backend/app/services/flood.py` | Live; banded against a 30-day mean. |
| Official warnings | NDMA SACHET (CAP) | `backend/app/services/warnings.py` | Live; parsed with expiry and district match. |
| Landslide history | NASA Global Landslide Catalog, NER slice | `backend/data/landslides/glc_ner.csv` | Bundled, 471 events 2007–2017, provenance-labelled. Flagged aged. |
| Landslide — current | *none* | `backend/app/services/landslide/base.py` | `NOT_CONFIGURED`. Four routes tried, all shut. Reported as unknown, never as clear. |
| Landslide susceptibility | *none* | — | Unknown. GSI/NRSC classes are not machine-reachable; not inferred from the inventory. |
| Roadside services | OpenStreetMap corridor snapshot | `backend/app/services/places/snapshot.py` | Bundled. |

## 3. The gap, stated honestly

There is exactly one spatial gap that matters, and no link list closes it:

**No current landslide-incident feed exists for this corridor.** That is why every hosted
corridor assesses as `REQUIRES_REVIEW` with reason `LANDSLIDE_DATA_NOT_CONFIGURED`, and why
a human approves each route. The system does not fill the gap with a plausible number. An
empty answer from a provider that was never asked is not "no landslides" — it is "nobody
looked", and the two are stored, scored and displayed differently.

Closing it needs one of: a GSI/Bhusanket machine interface, a state disaster-authority feed,
or fleet-sourced observations at enough density to be evidence. All three are institutional
problems, not repository-discovery problems.
