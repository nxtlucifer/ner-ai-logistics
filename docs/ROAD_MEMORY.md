# Road Memory — source feasibility and data model

Status: **research + domain model complete; persistence NOT built.**
Date of survey: 2026-09-01.

This document exists because the honest answer to "can we predict landslides on
NH-715" is currently **no**, and the useful thing to build instead is the
evidence architecture that would make the question answerable later. What
follows is what the available sources actually publish, what they do not, and
the data model that falls out of that gap.

---

## 0. The finding that drives everything else

**No source surveyed publishes "this road is open again."**

- GSI publishes hazard forecasts and a historical landslide inventory.
- ASDMA publishes damage reports.
- IMD publishes weather, including highway-specific warnings.

Reopening is decided by the road-owning agency — PWD, NHAI or BRO — and
communicated locally and ad hoc. Nothing in the machine-readable ecosystem
carries it.

The consequence is a design constraint, not an inconvenience: a system fed by
these sources sees roads break and never sees them mend. If "no recent bad
news" is allowed to mean "fine", every closed road in the database silently
becomes open a few days after it closes. That is the single most dangerous
failure available to this feature, and it is the default behaviour of the naive
implementation.

Hence `app/domain/road_memory.py`, where **silence is not evidence** is an
enforced rule rather than a comment, and hence `FLEET_TRAVERSAL` — our own
trucks' GPS tracks — being the strongest reopening evidence available to us,
because it is the only positive observation this system can make for itself.

---

## 1. Sources surveyed

### GSI — Bhusanket / National Landslide Forecasting Centre
<https://bhusanket.gsi.gov.in/>

| | |
|---|---|
| What it publishes | Daily short- and medium-range landslide forecasts; landslide bulletins |
| Machine-readable API | **None documented.** Web portal plus the Bhooskhalan mobile app |
| Coverage | Began with Darjeeling and Kalimpong (WB) and the Nilgiris (TN); stated target of 36 landslide-prone districts |
| **Assam / NE coverage** | **Not confirmed** for the forecast product in this survey |
| Usable today | Not as a live feed |

The coverage gap is the blocker, and it is worth being precise about it: GSI's
forecasting is real and expanding, but a demo claiming live GSI landslide
forecasts for an Assam corridor would be claiming a product that does not
currently cover that corridor. The portal is the right place to point a judge;
it is not something to wire in and call an integration.

### GSI — Bhukosh / NGDR (historical inventory)
<https://bhukosh.gsi.gov.in/Bhukosh/Public> · <https://www.data.gov.in/catalog/bhukosh>

| | |
|---|---|
| What it publishes | GSI's geoscience data including the national landslide inventory |
| Machine-readable | Shapefile / GIS download. Bulk, not an API |
| Usable today | **Yes, as a one-time ingest** |

This is the realistic historical-recurrence source. A bulk download, spatially
joined to road segments, gives "this stretch has had N recorded slides" — which
is a fact, not a prediction, and is exactly the input a deterministic monsoon
risk engine needs. It is offline and periodic by nature, which suits it: a
historical inventory does not need to be live.

### IMD — public API
<https://api.imd.gov.in/public/api_reference.html> · <https://mausam.imd.gov.in/responsive/apis.php>

| | |
|---|---|
| What it publishes | 28 JSON endpoints: district/state rainfall, district and station nowcasts, warnings, AWS/ARG station data, and notably **Highway Nowcast Warning** and **Highway Warning — 5 Days** |
| Machine-readable | Yes, JSON |
| Auth / rate limits / licence | **Not stated in the public reference** |
| Usable today | Promising, with a caveat |

The highway-specific endpoints are the most directly relevant thing found in
this survey — a warning scoped to a highway is closer to the operational
question than a district-average rainfall figure.

The caveat is the missing terms. A public reference that documents no
authentication, no rate limit and no licence is not the same as one that grants
unlimited free use; it means the terms are undetermined. That is fine for a
prototype and is **not** something to build a dependency on without checking.
Recorded here so the decision is deliberate.

### ASDMA — Assam State Disaster Management Authority
<https://asdma.assam.gov.in/>

| | |
|---|---|
| What it publishes | Landslide and flood damage reports, situation reports |
| Machine-readable | **None found.** Web pages and PDFs |
| Usable today | As a human-verified `OFFICIAL_AGENCY` evidence source, entered by an operator |

This is the natural feed for `EvidenceKind.INCIDENT_REPORTED` with
`EvidenceSource.OFFICIAL_AGENCY`, with a person in the loop. That is not a
weakness of the design — the evidence model was built to accept exactly this
shape, with a `reference` field so the bulletin can be found again.

### Open-Meteo — already integrated
Live rainfall and gusts along a route corridor, already wired into
`app/services/weather.py` and scored by `app/domain/route_risk.py`. Free for
non-commercial use, no contractual uptime.

---

## 2. Feasibility verdict

| Capability | Verdict |
|---|---|
| Live landslide forecast for an Assam corridor | **BLOCKED** — no source covers it in machine-readable form |
| Historical landslide recurrence per road segment | **FEASIBLE** — Bhukosh bulk download, offline ingest |
| Live rainfall on a corridor | **BUILT** — Open-Meteo |
| Highway-scoped weather warnings | **FEASIBLE** — IMD, terms unverified |
| Authoritative road-closure feed | **BLOCKED** — none exists |
| Authoritative road-reopening feed | **BLOCKED** — none exists, and this is the important one |

`AI_ML = BLOCKED_BY_DATA`. There is no labelled dataset of road-segment
outcomes here — no ground truth for "was this road passable on this date" —
so there is nothing to train on and nothing to validate against. Building a
model on these inputs would produce a number with no way to check it, which is
worse than no number. See `docs/AI_MODELS.md` section 0.

---

## 3. The data model

Implemented in `app/domain/road_memory.py`, with tests in
`backend/tests/test_road_memory.py`. Pure, deterministic, clock injected.

### States

```
UNKNOWN                nobody has observed this segment
       |
       v
REPORTED_INCIDENT      something happened; passability unknown
       |
       v
CLOSED                 an authority declared it shut
       |
       v
REPAIR_REPORTED        somebody claims it is fixed - unconfirmed
       |
       | 48h with no confirmation
       v
AWAITING_VERIFICATION  the claim needs a decision, not a default
       |
       | positive observation ONLY
       v
VERIFIED_OPEN          somebody observed traffic passing
```

`UNKNOWN` is separate from `VERIFIED_OPEN` on purpose. A road nobody has looked
at is not a road known to be fine, and collapsing the two is how an unsurveyed
segment ends up in a route plan wearing a green tick.

### The two rules

**Time may only increase doubt.** The single time-driven transition is
`REPAIR_REPORTED → AWAITING_VERIFICATION`, which moves a segment to a *less*
usable state. There is no path from elapsed time to `VERIFIED_OPEN`. A test
asserts this exhaustively over every starting state and horizons out to 400
days.

**Silence does not close a road either.** An old `VERIFIED_OPEN` stays
`VERIFIED_OPEN` and goes `STALE`. Inventing a closure strands cargo and teaches
dispatchers to ignore the system. What ages is the *freshness*, not the status,
and `is_usable()` requires both.

### Evidence sources, and the asymmetry

| Source | May close / raise doubt | May open |
|---|---|---|
| `OFFICIAL_AGENCY` | yes | yes |
| `FLEET_TRAVERSAL` | yes | yes |
| `OPERATOR_REPORT` | yes | **no** |
| `UNVERIFIED_REPORT` | yes | **no** |

Weak evidence is enough to raise doubt and never enough to remove it. A driver
saying "I heard it is clear" is hearsay; the same driver's truck actually
driving through arrives as `FLEET_TRAVERSAL` and counts. Refusing to record a
rumoured landslide until it is confirmed is how a truck gets sent into one, so
the doubt-raising direction accepts everything.

`FLEET_TRAVERSAL` is the quiet advantage here. Every other participant in this
problem is reading bulletins; this system watches its own trucks and can
observe passability directly from GPS tracks it already stores.

---

## 4. What is not built

Persistence. The model is a pure fold over an append-only evidence log and
nothing writes one yet, because there are no tables for road segments or road
evidence and adding them is a migration against a shared database.

`SCHEMA_APPLICATION_REQUIRES_APPROVAL = YES` — see
`docs/migrations/PENDING_road_memory_tables.sql`, prepared and deliberately not
applied, and deliberately not placed in `backend/alembic/versions/` where the
next `alembic upgrade head` would run it.

Also not built: any adapter to GSI, IMD or ASDMA. The evidence model was
designed against what those sources actually publish, which was the point of
the survey, but wiring one in is a separate task with its own terms-of-use
question.

---

## Sources

- [GSI Bhusanket portal](https://bhusanket.gsi.gov.in/)
- [GSI Bhukosh data portal](https://bhukosh.gsi.gov.in/Bhukosh/Public)
- [Bhukosh on data.gov.in](https://www.data.gov.in/catalog/bhukosh)
- [IMD API reference](https://api.imd.gov.in/public/api_reference.html)
- [IMD APIs overview](https://mausam.imd.gov.in/responsive/apis.php)
- [IMD rainfall information](https://mausam.imd.gov.in/responsive/rainfallinformation.php)
- [ASDMA](https://asdma.assam.gov.in/)
- [ASDMA landslide damage report](https://asdma.assam.gov.in/latest/landslide-damage-report-assam)
