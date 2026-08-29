# data/

Datasets. **All contents are git-ignored** — only this file is tracked.

```
data/
  raw/         Third-party sources as downloaded, never edited by hand
  processed/   Cleaned, joined, ready for feature engineering
  generated/   Synthetic output from ml/fuel/generate.py
```

## Expected sources

| Source | Use | Phase |
| --- | --- | --- |
| OpenStreetMap NER extract | Road network for routing | P7 |
| SRTM / Copernicus DEM tiles | Elevation, gradient — the dominant fuel feature | P7, P10 |
| IMD / weather API responses | Rainfall and warnings | P8 |
| Historical landslide and closure records | Route risk features | P8 |
| Generated synthetic trips | Fuel model training | P10 |

## Rules

- **Nothing personal.** Driver documents, photos and GPS tracks belong in the
  database and object storage, never here. See
  [docs/SECURITY.md](../docs/SECURITY.md) §4.
- Raw files are immutable. Transformations write to `processed/` so a pipeline
  change can be re-run from source.
- Record the provenance and licence of every dataset before using it. OSM is
  ODbL and requires attribution.
- Generated data must be reproducible from a seed, and never mixed into `raw/`.
