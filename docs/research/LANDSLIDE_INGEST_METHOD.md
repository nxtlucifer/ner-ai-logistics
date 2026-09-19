# Landslide ingest method

How landslide data gets into RASTA, and — more important for this audit — why the fifteen
research PDFs do not.

## 1. The two seams, and why there are two

```
CURRENT INCIDENTS                       HISTORICAL INVENTORY
services/landslide/base.py              services/landslide/history.py
LandslideIncidentProvider               HistoricalInventory
        |                                        |
   NullLandslideProvider              GLC slice: glc_ner.csv (471 events)
   -> NOT_CONFIGURED                  -> AVAILABLE, flagged aged
        |                                        |
   gates route selection              contributes exposure evidence
```

They are separate on purpose. Plugging a 2017-ending inventory into the current-incident
seam would make every corridor read "clear" the moment the 90-day window passed — a lie in
both directions: clear where there is a live slide, and alarming where a decade-old event
sits beside a rebuilt road.

## 2. Ingest rules, enforced in code

1. **Bounded queries only.** `incidents_near` requires a bounding box and a time window.
   There is no fetch-everything call. A box wider than `MAX_BBOX_DEGREES` (5°) is refused
   at construction, as is an inverted or out-of-range box — validated in `BoundingBox`, not
   per provider, so a new provider cannot forget.
2. **Failure is not emptiness.** A provider that is missing returns `NOT_CONFIGURED`; one
   that errors returns `UNAVAILABLE`. Neither is ever collapsed into an empty success.
3. **Accuracy travels with the coordinate.** Every event carries its GLC
   `location_accuracy`; an event placed to 50 km is never counted as being *on* a 5 km
   corridor. `unknown` accuracy means unplaceable, not exact.
4. **Age travels with the answer.** The inventory is flagged aged past
   `INVENTORY_AGED_AFTER_YEARS`, so "none recorded" can never be read as "none recently".
5. **Read once per process.** 471 rows, `lru_cache`d; a hillside's history does not change
   between requests.

## 3. Provenance record required for any bundled file

`backend/data/landslides/PROVENANCE.md` is the template and the only bundled instance.
It records: dataset, publisher, portal record URL, exact file URL, fetch date, HTTP status,
byte count, source SHA-256, the slice bounds, the columns kept, the citation, and an
explicit "what it is not" section. A snapshot without all of those does not ship.

A test (`backend/tests/test_glc_snapshot.py`) asserts the file parses, the bounding box
holds, and the accuracy field is honoured — so the provenance claim and the file cannot
drift apart silently.

## 4. Why the research package is not ingested

Fifteen PDFs were read end to end with hashes
([SOURCE_READING_RECEIPTS.md](SOURCE_READING_RECEIPTS.md)). None is ingested. Four reasons,
in order of how often each applies:

1. **No record-level geometry.** Ingest needs a coordinate and a location accuracy per
   event. The package's tables are state-level aggregates and narrative reporting. A state
   total cannot be placed on a corridor.
2. **Mixed and unlabelled provenance.** The flagship report's own four-tier hierarchy
   mixes official inventories with news compilation. Ingesting the mixture would erase the
   tier, and tier is exactly what `SourceType` and `VerificationStatus` exist to preserve.
3. **Inventory/event conflation is already documented inside the sources.** The Sikkim total
   (1,569, of which 1,408 are one 2011 earthquake) and the Mizoram total (12,385, including
   a 2017 event-based component) cannot be treated as event counts. Nothing in the pipeline
   should have to know that per-state exception.
4. **Double counting is explicitly warned against.** The ISRO/NRSC eight-state 1998–2022 sum
   is 42,547; GSI's figure is roughly 91,000; the source says plainly not to add them. Two
   overlapping inventories entering the same store would do exactly that.

The correct use of these documents is as citations in the report, which is what the
admission matrix records.

## 5. To add a real source later

Implement `LandslideIncidentProvider` (current) or `HistoricalInventory` (history). Nothing
above the package may learn the provider's name — the risk engine does not know whether it
is reading GSI, a state authority or a fleet observation, only the state, the type and the
verification status. Then:

- record provenance to the standard in §3;
- verify the licence before the first byte is committed;
- confirm the provider can express `UNAVAILABLE`, or wrap it in something that can;
- add one test that the accuracy and age fields survive the round trip.

An honest `NOT_CONFIGURED` is a better production state than a source that cannot say it
failed.
