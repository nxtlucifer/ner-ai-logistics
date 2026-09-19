# Landslide data dictionary

Every landslide field RASTA stores or computes, what it means, and what it is not allowed to
mean. Written against the code: `backend/app/domain/landslide.py`,
`backend/app/services/landslide/`, `backend/data/landslides/glc_ner.csv`.

Schema version: `landslide-incident-v1`.

## 1. The four things that are not the same thing

The single most important distinction in this file, because conflating any two of them
produces a confident wrong answer about a road:

| Concept | Question it answers | Source in RASTA | Never used as |
|---|---|---|---|
| **Historical inventory** | Has a landslide been recorded near here before? | NASA GLC slice, 2007–2017 | Current road state |
| **Current incident** | Is there a landslide on this road now? | *none connected* → `NOT_CONFIGURED` | Historical exposure |
| **Susceptibility** | Is this slope prone to failure? | *none* — unknown | Inferred from inventory density |
| **Model output** | Does a model think today is a landslide day? | experimental, `SHADOW_ONLY` | Any input to a route decision |

An inventory count is not an event count either: the flagship research document's Sikkim
total of 1,569 is dominated by 1,408 records from a single 2011 earthquake. One event, 1,408
inventory rows.

## 2. Bundled inventory columns (`backend/data/landslides/glc_ner.csv`)

471 rows, sliced to lat 23.5–29.5 N, lon 89.0–97.5 E. Provenance and citation in
`backend/data/landslides/PROVENANCE.md`.

| Column | Meaning | Handling |
|---|---|---|
| `event_id` | GLC identifier | Deduplication key |
| `event_date` | `MM/DD/YYYY hh:mm:ss AM` as exported | Parsed strictly; an unparseable date becomes `None`, never a guess |
| `event_title` | Short label | Display only |
| `location_description` | Free text | Display only; never geocoded back into a coordinate |
| `location_accuracy` | GLC vocabulary: `exact`, `1km`, `5km`, `10km`, `25km`, `50km`, `100km`, `250km`, `unknown` | **Load-bearing.** Mapped to metres; `unknown` stays `None`, which means "cannot be placed on a road", not "exact" |
| `landslide_trigger` | rain, earthquake, construction, … | Evidence context |
| `landslide_size` | small / medium / large / very_large | Evidence context |
| `landslide_category` | landslide, mudslide, rockfall, … | Evidence context |
| `fatality_count` | Reported deaths; frequently blank | Blank is blank, never 0 |
| `country_name`, `admin_division_name` | As published, including diacritics (`Meghālaya`) | Not normalised into a route decision |
| `source_name`, `source_link` | Who reported it | Rendered so a human can check the claim |
| `latitude`, `longitude` | WGS84 degrees | Paired with `location_accuracy`; never used bare |

## 3. Provider-state vocabulary

`SourceState` — whether anyone could answer at all:

| Value | Meaning |
|---|---|
| `NOT_CONFIGURED` | No provider connected. **Nothing was asked, so nothing is known.** The honest production state for current incidents. |
| `AVAILABLE` | A provider answered. An empty result here is a real finding. |
| `UNAVAILABLE` | A provider exists and failed. Tells you nothing about the road. |

`NOT_CONFIGURED` and `UNAVAILABLE` are deliberately distinct from `AVAILABLE` + empty. Only
the third is a statement about a road; the first two are statements about us.

`SourceType` — what kind of body published it, *not* how much it is trusted:
`OFFICIAL_AGENCY`, `NEWS`, `FLEET`, `OPERATOR`, `OTHER`.

`VerificationStatus` — how much corroboration an incident has. `OTHER`-typed reports are
never sufficient alone.

## 4. Assessment vocabulary

`LandslideRisk` and `DataStatus` carry the current-incident assessment; `HistoryExposure`
carries the inventory one. The reason codes are the contract the UI renders:

| Reason code | What it asserts |
|---|---|
| `LANDSLIDE_DATA_NOT_CONFIGURED` | No source connected. **Unknown, not safe.** |
| `LANDSLIDE_SOURCE_FAILED` | A source was asked and errored. Unknown. |
| `LANDSLIDE_NO_RECORDED_INCIDENTS` | A source answered, with nothing in the window. |
| `LANDSLIDE_OFFICIAL_ROAD_CLOSURE` | An authority closed the road. |
| `LANDSLIDE_OFFICIAL_INCIDENT_ON_ROUTE` | An authority reported an incident on the corridor. |
| `LANDSLIDE_CORROBORATED_INCIDENT_ON_ROUTE` | Multiple independent reports agree. |
| `LANDSLIDE_UNVERIFIED_REPORT_ON_ROUTE` | One uncorroborated report. Surfaced, weighted low. |
| `LANDSLIDE_INCIDENT_LOCATION_UNKNOWN` | Reported, but not placeable on a road. |
| `LANDSLIDE_HISTORY_NOT_CONFIGURED` / `_SOURCE_FAILED` | Same distinction, for the inventory. |
| `LANDSLIDE_HISTORY_ON_ROUTE` | Recorded events within the corridor buffer. |
| `LANDSLIDE_HISTORY_NONE_RECORDED` | Inventory answered; nothing within the buffer. |
| `LANDSLIDE_HISTORY_INVENTORY_AGED` | The inventory's last event is older than the freshness bound. Always set for the bundled slice. |

## 5. Thresholds, and why each has a number

| Constant | Value | Reason |
|---|---|---|
| `ON_ROUTE_BUFFER_M` | 5,000 m | A corridor is a line; an event placed to 5 km cannot be resolved finer. |
| `HISTORY_MODERATE_AT` | 1 event | One recorded failure on a corridor is worth saying out loud. |
| `HISTORY_HIGH_AT` | 3 events | Repetition on the same corridor is the signal. |
| `INVENTORY_AGED_AFTER_YEARS` | 3 years | Beyond this, "none recorded" stops meaning "none recently". The 2017-ending slice is always aged. |
| `MAX_BBOX_DEGREES` | 5.0° | A query wider than a corridor is a caller that meant to page. |

## 6. What is deliberately absent

- **No susceptibility class.** GSI/NRSC classes were not machine-reachable. Inferring them
  from inventory density would manufacture a hazard map out of where journalists were.
- **No road-reopening record.** No surveyed source publishes one. A closure therefore never
  expires silently — see `docs/ROAD_MEMORY.md`.
- **No aggregate "safety score" from history.** Exposure is reported with its count, its
  distance and its inventory age attached, so a reader can see what it rests on.
