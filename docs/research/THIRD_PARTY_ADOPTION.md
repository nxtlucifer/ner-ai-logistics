# Third-party adoption record

What this audit adopted into RASTA, from the 15 supplied research PDFs, the 16 GitHub
references, and every portal those documents name.

## Adopted: nothing

No code, no data file, no model weight, no asset and no dependency entered this repository
as a result of this audit. The dependency lists, the lockfiles and the bundled data
directory are unchanged.

That is the correct outcome, not a shortfall, and the reasoning is short:

1. **The PDFs are compilations, not interfaces.** Fifteen documents, 61 pages, read end to
   end with hashes ([SOURCE_READING_RECEIPTS.md](SOURCE_READING_RECEIPTS.md)). Not one is a
   machine-readable feed. Their numbers are citable; a citation is not a measurement of a
   road.
2. **The GitHub references were not inspected**, so none of their licences is known, so the
   licence gate refuses all sixteen ([GITHUB_REFERENCE_AUDIT.md](GITHUB_REFERENCE_AUDIT.md)).
   An unread licence is not a permissive licence.
3. **Every portal worth having needs an account this project does not hold** — Bhuvan/CartoDEM,
   Copernicus, Earthdata, MOSDAC, OpenTopography, IMD's data-request form. No key can be
   obtained on anyone's behalf, and the `geospatial_data_sources_NE_India` document says so
   itself.
4. **The sources that would have been adopted are already integrated.** Open-Meteo elevation,
   OpenTopoData/SRTM, NDMA SACHET, NASA COOLR/GLC. The audit's practical result is that three
   independent documents confirm the existing choices ([SPATIAL_SOURCE_AUDIT.md](SPATIAL_SOURCE_AUDIT.md)).

## Changed by this audit: the record, not the runtime

| Artefact | Change |
|---|---|
| `docs/research/*` | These six documents: receipts, admission matrix, spatial audit, GitHub audit, data dictionary, ingest method, model data card. |
| Runtime behaviour | None. |
| Dependencies | None added, none removed. |
| Bundled data | Unchanged. `glc_ner.csv` is the same 471-event slice with the same hash. |
| Model status | Unchanged. Experimental landslide model stays `SHADOW_ONLY` and controls nothing. |

## The standing rule

Before anything from a third party enters this repository:

1. Its licence is read and recorded — not assumed from a badge or a name.
2. Its provenance is recorded: publisher, fetch URL, fetch date, byte count, hash.
3. It enters through an existing seam (a provider behind
   `LandslideIncidentProvider`, or a labelled snapshot under `backend/data/`), never as a
   loose file a caller reads directly.
4. Its state is representable as `NOT_CONFIGURED` / `AVAILABLE` / `UNAVAILABLE`, so a
   failure to reach it can never render as a clear road.

Anything that cannot satisfy all four stays out, however useful it looks.
