# GitHub reference audit

Scope: the 15 repositories listed in `GitHub_Repositories_Related_to_NER_Logistics_Project.pdf`
(compiled 18 September 2026) plus `bchapuis/awesome-spatial-data`, named separately in the
mission brief. Sixteen references.

**Audited 20 September 2026.** Each repository's public page was read directly. An earlier
version of this document recorded `NOT_AUDITED` for all sixteen because no network path to
GitHub had been authorised; that is no longer true and the record below replaces it.

What was read: description, primary language, **licence**, star count, commit count, and
whether a README exists. Code was not cloned. Nothing was copied.

## Result

| # | Repository | Language | Licence | ★ | Commits | Status |
|---|---|---|---|---:|---:|---|
| 1 | `Anubhav1451/raahsetu-sih-2026` | Python + TS | **MIT** | 0 | — | `REFERENCE_ONLY` |
| 2 | `karthi011926/ner-landslide-guard-ai` | Python | **none** | 0 | — | `REJECT` |
| 3 | `sowmitha-lab/LandslideGuard` | — | **none** | 0 | 2 | `REJECT` |
| 4 | `VVSBrunda/NER-LandslideGuard` | JS (React+Vite) | **none** | 0 | 4 | `REJECT` |
| 5 | `hemadeepika143/LandslideGuard-NER` | Python | **none** | 0 | 5 | `REJECT` |
| 6 | `Reshma-spec/NER-CascadeGuard` | Python | **none** | 0 | 4 | `REJECT` |
| 7 | `arman2690/SlopeGuard` | Python + JS | **none** | 0 | 25 | `RESEARCH_ONLY` |
| 8 | `Harini345678/TerraGuard-AI` | — | — | 0 | **0** | `REJECT` — empty |
| 9 | `DharshiniM-07/Land-Guard-AI` | — | — | 0 | **0** | `REJECT` — empty |
| 10 | `B-Abdulla/TerraGuard` | — | **none** | 0 | 3 | `REJECT` |
| 11 | `perliedman/geojson-path-finder` | TypeScript | ISC | 332 | — | `REFERENCE_ONLY` |
| 12 | `sachncs/fleetpilot` | TypeScript | ISC | 0 | 29 | `RESEARCH_ONLY` |
| 13 | `sachnaror/fleet-management-system` | Python | Apache-2.0 | 1 | — | `REFERENCE_ONLY` |
| 14 | `Serkanbyx/vehicle-tracking-system` | TypeScript | **PolyForm Noncommercial** | 0 | — | `REJECT` for code |
| 15 | `NotArsal/Food-Delivery-Simulator` | Python + JS | MIT | 0 | — | `REFERENCE_ONLY` |
| 16 | `bchapuis/awesome-spatial-data` | — | MIT | 79 | — | `REFERENCE_ONLY` |

**Nothing is `ADOPT_NOW`. No code from any of these is in RASTA.**

## The finding that matters: eight of the ten hazard repositories have no licence

Repositories 2, 3, 4, 5, 6, 7 and 10 publish **no licence file at all**, and 8 and 9 are
completely empty. A public repository with no licence is not open source — copyright
defaults to all rights reserved, and copying any part of it would be an infringement
regardless of how useful it looked.

So for the seven that contain code, the question of whether their approach is good never
arises: there is no lawful way to take it. They are recorded here so that the next person
who reads the list does not have to rediscover that.

Repository 14 does carry a licence, **PolyForm Noncommercial 1.0.0**, which permits use only
for non-commercial purposes. A hackathon prototype that may later be deployed by a ministry
is not safely inside that boundary, so its code is rejected too.

## What the licensed, relevant projects actually offer

**`perliedman/geojson-path-finder` (ISC, 332★)** — shortest path across a GeoJSON LineString
network, for cases where "a full routing engine like OSRM seems excessive". RASTA already
runs OSRM against real road geometry and treats fabricated alternatives as a defect. Adopting
a client-side approximator would be a step away from real roads, not towards them.

**`sachncs/fleetpilot` (ISC)** — a genuine two-stage VRP solver (ALNS + BRKGA) for
pickup-and-delivery with time windows, multi-depot and transfer nodes. This is real
optimisation work and the licence permits reuse. It is `RESEARCH_ONLY` for one reason: RASTA
dispatches one truck against one corridor and asks whether that corridor is passable. Multi-
vehicle assignment optimisation is a different product. Reconsider after the deadline, not
before it.

**`sachnaror/fleet-management-system` (Apache-2.0)** — OBD-II/CAN telematics. RASTA's
telemetry comes from a phone, not a vehicle bus, so the overlap is the dashboard only.

**`Serkanbyx/vehicle-tracking-system`** — the one architectural idea worth writing down even
though the code is off-limits: **two separate WebSocket channels, one for device GPS ingest
and one for the authenticated dashboard feed.** RASTA polls instead, which is documented and
honest, and `docs/STATE_DISTRICT_RBAC_AND_NOTIFICATIONS.md` already says polling is not
realtime. If live push is ever added, keeping ingest and fan-out on separate authenticated
channels is the right shape, because it stops a dashboard subscriber from reaching the ingest
path.

**`bchapuis/awesome-spatial-data` (MIT, 79★)** — a catalogue, and useful as one. Its elevation
section names Copernicus DEM, SRTM, ASTER GDEM, JAXA and GEBCO; transport names OpenStreetMap,
OpenBusMap, OpenRailwayMap; boundaries name **geoBoundaries and GADM**. Its India-specific
entries are state electricity load-despatch dashboards, which are not relevant here.

> **geoBoundaries and GADM are worth a follow-up** as a possible source of district polygons,
> which is the one thing `DISTRICT_SEED = BLOCKED_NEEDS_OFFICIAL_DISTRICT_SOURCE` is waiting
> for. Neither is a Government of India notification, so neither can be `VERIFIED_OFFICIAL`
> on its own — but a `DEMO`-provenance district directory drawn from a named, licensed,
> dated source is strictly better than the nothing currently loaded. Recorded as an open
> item, not actioned: choosing a district list is a decision about what the product claims,
> and that is the user's to make.

## One repository deserves a direct note

**`Anubhav1451/raahsetu-sih-2026`** is not a library. It is another team's entry for the same
Smart India Hackathon, on what appears to be the same problem: "an explainable logistics route
planner for North-East India", FastAPI + React, eight-state coverage, risk-aware routing
compared against the fastest route, 3D terrain, field incident reporting on Supabase,
reviewer-moderated accessibility events.

It is MIT-licensed, so its code *could* lawfully be reused. It should not be. Beyond the
obvious, the architectures have already diverged in a way that matters: RaahSetu describes
custom A* pathfinding over extracted road graphs; RASTA routes on OSRM against real road
geometry and refuses to synthesise alternatives. Swapping in a custom pathfinder days before
a deadline would trade a working, honest routing path for an unvalidated one.

Recorded because the user should know a closely-comparable public entry exists, not because
anything should be taken from it.

## Method and limits

- Read: the public repository landing page for each of the sixteen, on 20 September 2026.
- Not read: full source trees, commit history, issues, or dependency manifests.
- Licence is as displayed by GitHub. "none" means no licence was detected on the page, which
  is the state that makes the code unusable — the conservative reading, and the correct one.
- Star and commit counts are a snapshot; they will drift.
- A repository being small or unlicensed is **not** a judgement of the team behind it. Most
  of these were created within days of a hackathon. It is only a statement about whether
  RASTA may lawfully and safely take code from them today, and the answer is no.
