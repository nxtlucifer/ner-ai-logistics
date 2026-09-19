# GitHub reference audit

Scope: the 15 repositories listed in `GitHub_Repositories_Related_to_NER_Logistics_Project.pdf`
(compiled 18 September 2026) plus `bchapuis/awesome-spatial-data`, named separately in the
mission brief. Sixteen references in total.

## Result: `NOT_AUDITED` — no repository was inspected

**Every one of the sixteen is `NOT_AUDITED` and therefore `BLOCKED` for adoption.**

Reason, stated plainly: this session has no authorisation to reach github.com. The outbound
call that would have read repository metadata was declined by the operator, and no other
network path to GitHub was substituted. Nothing was fetched, cloned, or read.

That is the honest record. The alternative — writing down what a repository probably contains
based on its name — is exactly the failure this audit exists to prevent. "LandslideGuard"
tells you nothing about whether the repository has code, a licence, or a working model. Seven
of the sixteen have near-identical hazard-sounding names; inferring capability from any of
them would be invention.

## The list, as supplied

| # | Repository | Owner | Inspected? | Licence | Status |
|---|---|---|---|---|---|
| 1 | `raahsetu-sih-2026` | Anubhav1451 | No | Unknown | `NOT_AUDITED` |
| 2 | `ner-landslide-guard-ai` | karthi011926 | No | Unknown | `NOT_AUDITED` |
| 3 | `LandslideGuard` | sowmitha-lab | No | Unknown | `NOT_AUDITED` |
| 4 | `NER-LandslideGuard` | VVSBrunda | No | Unknown | `NOT_AUDITED` |
| 5 | `LandslideGuard-NER` | hemadeepika143 | No | Unknown | `NOT_AUDITED` |
| 6 | `NER-CascadeGuard` | Reshma-spec | No | Unknown | `NOT_AUDITED` |
| 7 | `SlopeGuard` | arman2690 | No | Unknown | `NOT_AUDITED` |
| 8 | `TerraGuard-AI` | Harini345678 | No | Unknown | `NOT_AUDITED` |
| 9 | `Land-Guard-AI` | DharshiniM-07 | No | Unknown | `NOT_AUDITED` |
| 10 | `TerraGuard` | B-Abdulla | No | Unknown | `NOT_AUDITED` |
| 11 | `geojson-path-finder` | perliedman | No | Unknown | `NOT_AUDITED` |
| 12 | `fleetpilot` | sachncs | No | Unknown | `NOT_AUDITED` |
| 13 | `fleet-management-system` | sachnaror | No | Unknown | `NOT_AUDITED` |
| 14 | `vehicle-tracking-system` | Serkanbyx | No | Unknown | `NOT_AUDITED` |
| 15 | `Food-Delivery-Simulator` | NotArsal | No | Unknown | `NOT_AUDITED` |
| 16 | `awesome-spatial-data` | bchapuis | No | Unknown | `NOT_AUDITED` |

Repositories 1-10 appear, from their names and the list's own grouping, to be other SIH
entries in the same problem space. Whether any of them contains working code is unknown and
is recorded as unknown.

## The licence gate, and why nothing passes it

The rule in force: **no third-party code, data file, model weight or asset enters this
repository unless its licence has been read and is compatible.** An unread licence is not a
permissive licence. `UNKNOWN ≠ SAFE` applies to intellectual property exactly as it applies
to hazard evidence.

Sixteen unknown licences means sixteen refusals. No file from any of these repositories is
present in RASTA, and none was consulted while writing the code in this change.

## What this costs the project: nothing

Worth stating, because "not audited" reads like a gap:

- **Routing** — RASTA already routes through OSRM with a region gate and a corridor policy.
  A client-side graph search over GeoJSON (what #11 is named for) would be a downgrade, not
  an addition.
- **Fleet, tracking, delivery simulation** (#12-#15) — RASTA has a working fleet model,
  live driver positions, trip lifecycle and a canonical demo flow, all under test.
- **The hazard repositories** (#1-#10) — anything they contain would still have to pass the
  same evidence rules RASTA applies to its own model: provenance, freshness, confidence, and
  the ban on deploying an unvalidated landslide model. A model from an unaudited stranger's
  repository could not clear that bar even if the licence were perfect.
- **`awesome-spatial-data`** (#16) — a link list. Its value is pointers to sources, and this
  project already has more admitted sources than it has evidence gaps.

## To close this out later

Someone with network access should, per repository: read `LICENSE`, check whether code exists
at all, and record the finding in this table. Until then the table stands as written. Do not
soften `NOT_AUDITED` to "reviewed" or "considered" in any submission document.
