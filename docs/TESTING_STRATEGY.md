# Testing Strategy

**Status:** the backend test suite and both frontend typecheck/build pipelines are running as of
Mission 1. The layers below describe the target; §11 states exactly what exists today.

---

## 0. Principles

1. **Safety logic gets the highest coverage.** Fleet Sentinel and capacity validation are tested to
   a standard the rest of the codebase is not held to.
2. **Tests run against the real configured database** - Supabase PostgreSQL + PostGIS
   by default - never SQLite. Half of what we test is spatial and enum-constrained;
   a substituted database tests a different system.
3. **A test that needs a live third-party API is not a test.** External providers are stubbed at
   the interface boundary.
4. **No test asserts a model's accuracy.** ML tests assert the *pipeline*, the *fallbacks*, and
   *baseline comparison*, never a number.
5. **Deterministic time.** Sentinel timing is tested by injecting a clock, never by sleeping.

---

## 1. Unit Tests (`pytest`)

Pure logic, no I/O, fast enough to run on save.

Priority targets:
- Capacity validation — at, just under, just over, zero, negative, null capacity.
- Trip state machine — every legal transition, and a table of every illegal one.
- Document expiry classification across boundary dates.
- Fuel baseline formula.
- Sentinel threshold arithmetic (distance, elapsed time, deadline).
- Payroll arithmetic — advances, deductions, rounding to paise.
- Serialisation of `Decimal` money and the lat/lon vs GeoJSON `[lon,lat]` boundary.

Target: 90%+ on `app/domain/`. Coverage elsewhere is not a goal in itself.

---

## 2. Integration Tests

Multiple components with a real database, no HTTP.

- Assignment: creating a new active assignment ends the previous one **atomically**, and the
  partial unique index rejects a concurrent second active assignment.
- Reroute: incident created → affected trips identified via `ST_DWithin` → new routes inserted →
  old marked `SUPERSEDED` → alerts raised.
- GPS ingest → Sentinel evaluation → emergency creation, as one flow.
- Audit rows are written for every consequential mutation (asserted generically, so a new mutation
  without an audit entry fails).

---

## 3. API Tests (`pytest` + `httpx.AsyncClient`)

Every endpoint, over real HTTP against a real database.

Per endpoint: happy path; each documented error code; **authorization matrix**; input validation
(out-of-range lat/lon, negative weights, invalid enums, oversized payloads).

The authorization matrix is a parameterised test over *(role × endpoint × own/other resource)* that
must be extended whenever an endpoint is added. Object-level authorization — a driver requesting
another driver's trip — is the specific case most likely to regress, so it is generated rather than
hand-written.

Also asserted: `POST /api/gps/batch` is idempotent (same `device_fix_id` twice → one row,
`duplicates_ignored: 1`), and `/health` returns 200 with the database **stopped**, while `/ready`
returns 503.

---

## 4. Database Tests

Constraints must be proven at the database level, not just in Python:

- `CHECK (current_load_kg <= max_capacity_kg)` rejects a direct SQL overload.
- `uq_active_assignment_driver` / `_truck` reject a second active row.
- **`uq_open_emergency_per_trip` rejects a duplicate open emergency** — the constraint that stops a
  monitor bug from spamming a driver.
- PostGIS behaviour: `ST_DWithin` on `geography` returns metres; a 5 km radius near Guwahati matches
  correctly in both latitude and longitude directions (the specific bug that using `geometry` would
  cause).
- Every migration is tested `upgrade` → `downgrade` → `upgrade` on a scratch database.

---

## 5. Frontend Tests (Vitest + Testing Library)

- `tsc --noEmit` and a production build gate every change.
- Component tests for state rendering — especially that a `null` fuel estimate renders
  "unavailable" and **never** `0`, `—`, or a fabricated value. This is a correctness test, not a
  cosmetic one: it enforces the honesty rule from [AI_MODELS.md](AI_MODELS.md).
- Backend-offline states render as offline, not as empty success.
- MSW stubs the API; no test hits a live backend.

---

## 6. Mobile Tests (Jest + React Native Testing Library)

- `tsc --noEmit` gates every change.
- **Offline queue** is the priority: fixes buffer when offline, flush in order on reconnect, survive
  app restart, and never duplicate after an ack timeout.
- The Sentinel check-in screen renders all ten response options and posts the correct enum.
- Token storage uses `expo-secure-store` — asserted, since a regression to `AsyncStorage` is silent.
- Detox E2E only if time permits; not a MUST.

---

## 7. End-to-End (Playwright)

One scenario matters most: **the demo chain in [DEMO_PLAN.md](DEMO_PLAN.md), automated end to end.**
Manager creates shipment → assigns → dispatches → simulated GPS → incident → reroute → alerts →
stationary → check → no response → SOS briefing.

If that test passes, the demo works. It runs against a real backend and real database with the GPS
replay harness driving the ingestion API — the backend cannot distinguish it from a real phone.

Also: capacity rejection surfaces a clear message in the UI; login/logout/refresh for both roles.

---

## 8. ML Tests

What is asserted:
- Feature engineering is deterministic and handles nulls without silent imputation.
- The trained model **beats its stated baseline** on the held-out set — the assertion is
  `model_mae < baseline_mae`, not an absolute threshold.
- Serving contract: output shape, `source` and `model_version` populated, latency budget.
- **Fallbacks, exhaustively** — missing model file, inference exception, timeout, out-of-range
  prediction, missing feature. Each must return the baseline or `null`, never a fabricated number.
- Training is reproducible from a fixed seed.

What is never asserted: an absolute accuracy figure. See [AI_MODELS.md](AI_MODELS.md) §0.

---

## 9. Failure Injection

The property from [ARCHITECTURE.md](ARCHITECTURE.md) §8 — *the platform works without ML* — is only
real if tested:

| Injected failure | Required behaviour |
| --- | --- |
| ML service entirely down | Trips dispatch, GPS ingests, reroute works, **SOS escalates**. Only estimates show as unavailable. |
| Routing provider 503 | Existing trips continue; new route requests return `503 ROUTING_UNAVAILABLE`; no crash |
| Weather API timeout | Last-known-good served with staleness marked |
| Database connection lost | `/health` 200, `/ready` 503, requests fail cleanly with no partial writes |
| WebSocket disconnected | Clients fall back to polling and reconcile on reconnect |
| Driver offline 2 hours | Fixes buffer, flush in order, deduplicate; `COMMS_LOST` raised, **not** SOS |
| Scheduler stops | Health check detects it and alarms |
| Clock skew on device (±6 h) | Safety timers unaffected — they use `received_at` |

The clock-skew and offline-flush cases are the ones most likely to break silently in the field.

---

## 10. Security Tests

- Authorization matrix (§3) is the primary control.
- Token tampering: `alg: none`, wrong signature, expired, another user's token.
- Upload validation: oversized, wrong magic bytes, `.jpg` containing a script, path traversal in
  filename, EXIF GPS stripped after re-encode.
- SQL injection attempts through string parameters, including PostGIS query paths.
- Rate limits return 429 — and `POST /api/emergencies/{id}/respond` is confirmed **not** limited
  into failure.
- Secret scanning in CI; `pip-audit` and `npm audit`.
- Grep assertion that no `VITE_*`/`EXPO_PUBLIC_*` variable name matches a secret-like pattern.

---

## 11. What Exists Today

| Layer | State |
| --- | --- |
| Backend unit + API tests for `/health`, `/ready` (DB up and DB down) | **Running** |
| Config loading and `SECRET_KEY` enforcement tests | **Running** |
| **Provider selection: Supabase default, no silent local fallback** | **Running** |
| **Credential redaction in logs and in `/ready` output** | **Running** |
| **Row Level Security enabled on every table** | **Running** |
| **Schema drift: ORM vs database via `compare_metadata`** | **Running** |
| **FK, CHECK and partial-unique constraints (raw SQL)** | **Running** |
| **Append-only `audit_logs` trigger** | **Running** |
| **Derived `shipments.total_weight_kg` trigger** | **Running** |
| **Geospatial: SRID, metre distance, isotropic `ST_DWithin`, GIST indexes** | **Running** |
| **Trip state machine, including prohibited transitions** | **Running** |
| **Pydantic contracts reject server-managed fields** | **Running** |
| PostGIS availability test against the real database | **Running** |
| Migration upgrade/downgrade test | **Running** |
| Manager web `tsc --noEmit` + production build | **Running** |
| Driver app `tsc --noEmit` | **Running** |
| Everything else above | **Not implemented** |

## 12. Commands

```bash
cd backend && pytest -v                 # backend suite
cd backend && pytest --cov=app          # with coverage
cd manager-web && npm run typecheck     # tsc --noEmit
cd manager-web && npm run build         # production build
cd driver-app && npm run typecheck      # tsc --noEmit
```

## 13. CI Gate (when a repository is initialised)

Backend tests, both typechecks, both builds, `pip-audit`, `npm audit`, and secret scanning must
pass. `pytest` runs against a PostGIS service container so the spatial and constraint tests are
real. No merge on red — and per [AGENTS.md](../AGENTS.md), tests are never skipped to make a
build green.
