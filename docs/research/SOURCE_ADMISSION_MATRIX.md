# Source admission matrix

Every supplied source gets exactly one status. Nothing is unclassified.

| Status | Meaning here |
|---|---|
| `ADOPT_NOW` | Wired into runtime or training in this change. |
| `VALIDATION_ONLY` | May be used to check RASTA's own output; not a feed. |
| `RESEARCH_ONLY` | Readable, quotable with attribution; creates no route state and no label. |
| `REFERENCE_ONLY` | A pattern, a list or a duplicate of something RASTA already has. |
| `BLOCKED` | Relevant, but no lawful machine access exists today. |
| `REJECT` | Not relevant, or contradicted by a stronger source. |

## The supplied research package

| Source | Kind | Status | Why |
|---|---|---|---|
| `2017 to Present North East India Landslides Report.pdf` | PDF (supplied) | RESEARCH_ONLY | Tier 3 reporting; would need corroboration before any label. |
| `2017_landslides_northeast_india.pdf` | PDF (supplied) | RESEARCH_ONLY | Summary-level; no record-level data. |
| `DOC-20260819-WA0004.pdf` | PDF (supplied) | RESEARCH_ONLY | No URLs and no tabulated source records, so nothing here can be a label. |
| `GitHub_Repositories_Related_to_NER_Logistics_Project.pdf` | PDF (supplied) | REFERENCE_ONLY | Links only. Nothing in it describes what the code does, and this session did not inspect the repositories. |
| `Gods_Eye_View_Project_Data_and_Map_Sources_for_NER_AI.pdf` | PDF (supplied) | REFERENCE_ONLY | No new admitted source: RASTA already has a stronger, working equivalent for each category it covers. |
| `India_Open_Source_Maps_Locations_Buildings_Data_Sources.pdf` | PDF (supplied) | REFERENCE_ONLY | Duplicates an existing source; adding a second would not fill an evidence gap. |
| `LocalPilot_Architecture_and_Flowchartsl.pdf` | PDF (supplied) | REFERENCE_ONLY | A design pattern, not data. Nothing to ingest. |
| `NER_Landslide_Only_Statewise_Data_2017_2026.pdf` | PDF (supplied) | RESEARCH_ONLY | Compiled from mixed tiers. It would have to pass the event schema, deduplication and confidence gates before any of it could become a training label. |
| `NER_Landslide_Weather_Data_2017_2026_Official_Sources.pdf` | PDF (supplied) | VALIDATION_ONLY | No machine interface without an approved data request. RASTA's live weather stays Open-Meteo/MET Norway; IMD is a validation reference, not a feed. |
| `NE_India_Landslides_2017_Report.pdf` | PDF (supplied) | RESEARCH_ONLY | Overlaps the other 2017 documents; kept for cross-checking. |
| `Northeast_India_Landslide_Data_1998_2025 (2).pdf` | PDF (supplied) | RESEARCH_ONLY | No methodology section of its own; overlaps the flagship report. |
| `Northeast_India_Landslide_Research_1990_2026333.pdf` | PDF (supplied) | RESEARCH_ONLY | A secondary compilation of primary figures. Its numbers are quotable with attribution; they are not a runtime feed and create no route decision. |
| `Northeast_India_Landslides_After_2017_Data_and_Sources.pdf` | PDF (supplied) | RESEARCH_ONLY | Describes sources rather than carrying the data. |
| `Sikkim_Landslide_Source_Data_2017_2020.pdf` | PDF (supplied) | RESEARCH_ONLY | State-scoped and period-scoped; valuable as a caveat, not as coverage. |
| `geospatial_data_sources_NE_India.pdf` | PDF (supplied) | VALIDATION_ONLY | Every entry needs an account RASTA does not have, except the two already integrated. Nothing new can be switched on from this document alone. |

**Nothing in this package is `ADOPT_NOW`.** Not one of these documents is a machine
interface: they are compilations, catalogues and methodology notes. Admitting any of
their numbers into a route decision would mean a PDF deciding whether a truck may use
a road, which is the failure mode the hazard architecture exists to prevent.

## Portals the package names

| Source | Status | Why |
|---|---|---|
| GSI / Bhusanket / Bhukosh | `BLOCKED` | Named repeatedly as the primary authority. No stable public machine interface was verified in this session, and scraping around access control to make a demo look live is not acceptable. |
| ISRO / NRSC Landslide Atlas | `RESEARCH_ONLY` | The 1998-2022 inventory is the package's strongest baseline. It is a published inventory, not a live service: usable as historical context, never as current road state. |
| IMD (station, district, gridded 0.25° NetCDF) | `VALIDATION_ONLY` | Historical products come through a data-request form, not an API. Useful to check RASTA's rainfall against; not a runtime feed. |
| NDMA SACHET CAP | `ADOPT_NOW` (already integrated) | Already RASTA's official-warning feed, with freshness and a health row. The package confirms the choice; nothing changes. |
| NASA COOLR / Global Landslide Catalog | `ADOPT_NOW` (already integrated) | Already the landslide-history source behind the route cards, labelled with its inventory years. |
| Open-Meteo elevation, OpenTopoData/SRTM | `ADOPT_NOW` (already integrated) | Already the terrain source. The package independently names both and confirms the free-tier terms. |
| Copernicus DEM, Sentinel, Bhuvan/CartoDEM, OpenTopography | `VALIDATION_ONLY` | All need an account this project does not hold. Bhuvan/CartoDEM is the strongest India-specific candidate if someone registers. |
| GPM / IMERG | `RESEARCH_ONLY` | Would need an Earthdata login and a real rainfall-feature gap to justify it. RASTA has live rainfall already. |

## The evidence rule this preserves

A number in a PDF is not permission to treat that number as a live measurement, and a
portal that publishes an inventory is not a road-closure service. Historical inventory,
official warning, current measurement and experimental model output stay four different
things in the data, in the UI and in this matrix.