# tests/

Cross-cutting end-to-end tests that span the backend, the manager web app and the
driver app together. **Empty until phase P13.**

Tests that live with their own component are not here:

| Scope | Location | Runner |
| --- | --- | --- |
| Backend unit, API, database, migrations | `backend/tests/` | pytest |
| Manager web components | `manager-web/src/**/*.test.tsx` | Vitest |
| Driver app components | `driver-app/src/**/*.test.tsx` | Jest + RNTL |
| **Full-system E2E** | **here** | Playwright |

## The test that matters

The primary artefact of this directory will be one Playwright scenario that
automates the entire demo narrative from [docs/DEMO_PLAN.md](../docs/DEMO_PLAN.md):

```
create shipment -> assign truck (capacity validated) -> dispatch
-> simulated GPS movement -> road incident -> automatic reroute
-> manager + driver alerts -> truck goes stationary
-> driver check required -> no response -> SOS escalated
```

**If that test passes, the demo works.** It runs against a real backend and a real
database, with the GPS replay harness posting to the real ingestion endpoint — the
backend cannot distinguish it from a live phone.

Also planned here: the failure-injection suite from
[docs/TESTING_STRATEGY.md](../docs/TESTING_STRATEGY.md) §9, including the property
that with the ML service entirely down, trips still dispatch, GPS still ingests,
rerouting still works and **SOS still escalates**.
