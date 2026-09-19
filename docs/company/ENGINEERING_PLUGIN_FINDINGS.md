# Engineering plugin findings (trip lifecycle, auth deps, manager API client)

Lane: plugins-engineering-data (VP Engineering). Date: 2026-09-26.
Code reviewed: local working tree (main 5b5e474 plus the uncommitted post-demo tree, tag
`snapshot/post-demo-2026-09-26`). Where a finding also exists on hosted commit e4043ce it says so;
that check was done with `git show e4043ce:<path>`, not against the running service.

Nothing in this document changed code. Every recommendation is advisory. No hosted system was
contacted. The runtime proofs ran in a database this lane created for itself on the isolated
cluster (`ner_lane_ped_proof`, migrated 0001 to 0013, then dropped at the end of the run), with
routing, AI, weather and warnings disabled by environment and the one push HTTP call
(`notify._deliver`) replaced by an in-process stub, so no request left the machine.

Evidence labels: PROVEN_BY_TEST, PROVEN_BY_RUNTIME, PROVEN_BY_DATABASE, PROVEN_BY_SOURCE,
PROVEN_BY_WEB, INFERRED, NOT_VERIFIED, BLOCKED. Each claim carries exactly one.

---

## 1. Plugin ledger

| PLUGIN | OWNER_ROLE | TASK | WHY_RELEVANT | INPUT | OUTPUT | EVIDENCE | STATUS | FOLLOW_UP |
|---|---|---|---|---|---|---|---|---|
| qodo:qodo-review | VP Engineering | Pre-PR review of the dirty tree | Second opinion on 280 uncommitted files before the 38-commit integration | Skill loaded through the Skill tool; its runtime gate asks for `qodo --version` first | No review ran. `qodo` is not on PATH and `~/.qodo/bin/qodo` does not exist. The skill also sends the diff to Qodo's servers, which this lane may not do | PROVEN_BY_RUNTIME (`command -v qodo` empty, `~/.qodo` absent) | UNAVAILABLE | User decides whether to install the CLI and log in, and whether the post-demo diff may be uploaded to Qodo. If both are yes it becomes NEEDS_USER_AUTH, then a real run |
| qodo:qodo-codebase-wisdom | VP Engineering | Look for earlier changes to the reservation and cancel paths | History of how the lifecycle rules got here | Skill loaded through the Skill tool | No output. The same CLI is required and absent | PROVEN_BY_RUNTIME | UNAVAILABLE | Same as above |
| engineering:code-review | VP Engineering | Correctness review of trips.py, driver_trips.py, routes.py, api/deps.py, core/permissions.py, manager-web/src/api/client.ts | Lifecycle races, double submit, error paths | Skill loaded through the Skill tool. It ships a checklist (security, performance, correctness, maintainability) and no tooling of its own. I applied that checklist myself, then checked the suspect findings at runtime | Findings E1 to E9 and E12 below | See each finding | USED_AND_USEFUL | Fix the ADOPT_NOW items in the integration commits named in section 3 |
| engineering:tech-debt | VP Engineering | Rank the findings | Choose what enters the integration plan now | Skill loaded through the Skill tool. I applied its scoring formula myself: (Impact + Risk) x (6 - Effort) | Table in section 4. The scores are my judgement, not measurements | INFERRED | USED_AND_USEFUL | Re-score after the fixes land |
| engineering:architecture | VP Engineering | Where the driver push belongs relative to the transaction | E3 is an architectural inconsistency, not a single bug | Skill loaded through the Skill tool. I wrote the ADR in its template myself | ADR-1 in section 5 | INFERRED | USED_AND_USEFUL | Owner decides option A now or option B later |
| engineering:testing-strategy | VP Engineering | Find missing lifecycle tests | Every runtime-proven defect here passes the current suite | Skill loaded through the Skill tool. I applied its gap analysis myself against backend/tests | Test plan in section 6 | PROVEN_BY_SOURCE (existing tests read: test_resource_reservation.py:166-190, test_post_pickup_resolution.py:111-228, test_driver_stop_request.py:72-237) | USED_AND_USEFUL | Land one test with each fix |
| ponytail:ponytail-audit | VP Engineering | Look for over-engineering in the same six files | Cut code before adding more | Skill loaded through the Skill tool. I applied its tags (delete, stdlib, native, yagni, shrink) myself | Section 7. The files are mostly lean. It found small cuts, no dependency cuts | PROVEN_BY_SOURCE | USED_AND_USEFUL | Fold the one-line cuts into the E8 cleanup |
| Engineering plugin connectors (github, linear, asana, datadog, pagerduty) | VP Engineering | Not needed | The review worked from the local checkout | None | None | PROVEN_BY_RUNTIME (session reported these servers need authentication) | NEEDS_USER_AUTH | No action unless someone wants findings filed as tickets |

No sentence in this document says "according to Qodo". Qodo produced no output in this run.

---

## 2. Findings

Severity is my assessment. The decision column says what to do with the finding: ADOPT_NOW
means fix it in the integration plan, ROADMAP means later, REJECT means do not do it.

### E1. Two different drivers can be planned onto the same free truck at the same moment

- Where: backend/app/services/trips.py:509-524 (`create`), :713-726 (`_load_truck` reads the
  truck without a lock), :285-315 (`blocking_trip_for`), docstring claim at :294-297; no partial
  unique index on open trips per truck in backend/app/models/operations.py:312-322.
- What happens: `create` is serialised only by `_load_driver`'s `FOR UPDATE OF users`
  (trips.py:679-686), which is the driver's row. `SELECT ... FOR UPDATE` that returns no rows
  locks nothing, so the truck check in `blocking_trip_for` does not make a second planner wait.
  With different drivers, the two transactions share no lock.
- Proof: in the lane database, session A ran `trips.create` for driver 1 and truck T and kept its
  transaction open. Session B ran `trips.create` for driver 2 and the same truck T. B was not
  blocked, both committed, and 2 open trips then held one truck. The reservation rule allows 1.
- Evidence: PROVEN_BY_RUNTIME
- Also on hosted e4043ce: PROVEN_BY_SOURCE (same `_load_truck` without a lock and the same gate
  order in `git show e4043ce:backend/app/services/trips.py`, lines 482 and 671).
- Test gap: the existing race test uses the same driver for both plans
  (backend/tests/test_resource_reservation.py:166-190), so the users-row lock hides the truck case.
- Severity: Medium. It needs two planners acting within milliseconds. The hosted backend runs one
  uvicorn worker, but async requests still interleave at each `await`.
- Recommendation: lock the truck row in `_load_truck` (`.with_for_update()`), then check the lock
  order against `dispatch` and `drivers.deactivate`, which document users-then-trips ordering
  (trips.py:895-911). I did not check that lock order for deadlocks: NOT_VERIFIED.
- Decision: ADOPT_NOW, with one concurrency test (two drivers, one truck).

### E2. Repeating a post-pickup redirect duplicates the driver's instruction

- Where: backend/app/services/trips.py:1463-1484 (cancel with RETURN_TO_DEPOT or
  NEW_DESTINATION) and :1184-1196 (`_redirect_cargo` skips every pending drop-off and appends a
  new one). The client sends no idempotency key: manager-web/src/api/client.ts:1513-1522.
- Proof: two identical `trips.cancel(..., disposition="RETURN_TO_DEPOT")` calls on one loaded trip
  both returned success. Result: stops Pickup COMPLETED, Delivery SKIPPED, "Return to depot"
  SKIPPED, "Return to depot" PENDING. 2 ROUTE_CHANGED events that each need the driver's
  acknowledgement, and 2 CRITICAL_ROUTE_CHANGE driver notifications.
- Evidence: PROVEN_BY_RUNTIME
- Also on hosted e4043ce: PROVEN_BY_SOURCE (`_redirect_cargo` and the same cancel branch exist
  there).
- Severity: Medium. The driver gets two "destination changed" pushes and two acknowledgements for
  one decision, and the stop list gains a second SKIPPED row.
- Recommendation: reuse the pattern already in this codebase. `request_stop` takes a client
  `request_id` and returns early when an event with that id exists (driver_trips.py:801-812). Do
  the same for cancel, with the console generating the id once per intent, as TripsPage already
  does for planning (manager-web/src/pages/TripsPage.tsx:347-353).
- Decision: ADOPT_NOW

### E3. The cancel, hold and redirect pushes leave before the change commits

- Where: backend/app/services/trips.py:1452-1456 (hold), :1480-1484 (redirect), :1493-1497
  (cargo unloaded), :1538-1544 (pre-pickup cancel). All of them call `notify.send` before
  `db.commit()` (:1503, :1556). `notify.send` makes the Expo HTTP POST inline
  (backend/app/services/notify.py:72-96) with an 8 s timeout (backend/app/core/config.py:313).
  `dispatch` (trips.py:975-983), `add_stop` (:1378-1389) and `request_stop`
  (driver_trips.py:860-874) push after the commit and say why.
- Proof: during a pre-pickup cancel of an ASSIGNED trip, the stubbed push read the trip from an
  independent session at the moment it was sent and saw status ASSIGNED. The final status was
  CANCELLED. The driver is told before the database agrees.
- Evidence: PROVEN_BY_RUNTIME
- Also on hosted e4043ce: PROVEN_BY_SOURCE (notify.send at lines 1250, 1272, 1285 and 1331,
  before the commits at 1295 and 1348).
- Consequences: if the commit fails (the audit insert, a constraint, a dropped connection), the
  driver has a cancellation push for a trip that is still assigned: INFERRED. The trip row lock
  and a pooled connection are held across a third-party HTTP call of up to 8 s: INFERRED from
  the code order. Neither was measured.
- Severity: Medium
- Decision: ADOPT_NOW (option A in ADR-1)

### E4. A driver's emergency stop request can reach no manager, and the driver is told it did

- Where: backend/app/services/notifications.py:68-76 (`recipients_for_trip` returns an empty list
  when the shipment has no district ids) and :90-104 (it only ever selects DISTRICT_MANAGER and
  STATE_MANAGER). backend/app/services/driver_trips.py:843-873 (`request_stop` notifies that list,
  then pushes "Your manager has been alerted and can see your reason. Stay safe; they will
  call."). The driver screen also promises "Your manager is alerted immediately"
  (driver-app/src/screens/TripScreen.tsx:997).
- Proof: an ACTIVE trip whose shipment has no districts, with one active MANAGER account, gets a
  stop request. Result: 0 manager-inbox rows for the trip, 1 INCIDENT_OPENED timeline event, and
  the driver acknowledgement text above.
- Evidence: PROVEN_BY_RUNTIME
- Hosted: not on e4043ce (`request_stop` and notifications.py do not exist there):
  PROVEN_BY_SOURCE. It enters with integration commits 32 and 37.
- Why it will happen: district data is a candidate seed only, so shipments without district ids
  are the expected case until a verified district seed exists: INFERRED.
- Severity: High. A safety message tells the driver something the system did not do.
- Recommendation: when `recipients_for_trip` is empty for an URGENT kind, fall back to the active
  MANAGER and NORTH_EAST_MANAGER accounts. Make the driver acknowledgement depend on whether any
  inbox row was written ("Request recorded. No manager inbox was reached. Call your manager.").
  This needs E5 decided first.
- Decision: ADOPT_NOW, in commit 32 before it lands

### E5. The MANAGER role cannot read the notification inbox, and a comment says every manager can

- Where: backend/app/core/permissions.py:83-86 ("Every manager role has it") and :114-126
  (`_MANAGER_PERMISSIONS` has no NOTIFICATION_READ). Only DISTRICT, STATE, NORTH_EAST and ADMIN
  get it (:170-196).
- Proof: `has_permission(MANAGER, "notification:read")` returned False.
- Evidence: PROVEN_BY_RUNTIME
- Severity: Low on its own. It becomes load-bearing with E4.
- Decision: ADOPT_NOW. Either grant it or correct the comment, decided together with E4.

### E6. Dispatch inspects and locks the driver before it checks the manager's scope

- Where: backend/app/services/trips.py:913-922. `dispatch` reads `Trip.driver_id` and calls
  `_load_driver`, which locks that user's row and can refuse with DRIVER_SUSPENDED,
  DRIVER_LOGIN_INACTIVE or LICENCE_EXPIRED. Only then does `load_for_update(..., actor=actor)`
  apply the scope rule, which says out-of-scope must be 404 "so the id space is not an oracle"
  (:161-176).
- Effect: a district or state manager who holds another district's trip UUID gets the driver's
  compliance state instead of a 404, and briefly locks that user row.
- Evidence: PROVEN_BY_SOURCE
- Hosted: scope is not on e4043ce. This is working-tree only, integration commit 28.
- Severity: Low. It needs a leaked UUID.
- Recommendation: call `_assert_in_scope` (or `get(db, trip_id, actor=actor)`) before
  `_load_driver`. One line. Lock order is unchanged because it only reads.
- Decision: ADOPT_NOW

### E7. Route planning calls the external provider before the scope check

- Where: backend/app/services/routes.py:233 calls `trips.get(db, trip_id)` without `actor`, then
  commits (:269) and calls the provider chain (:272-278). Scope is enforced only at :361
  (`load_for_update(..., actor=actor)`). The comment at :233 says "404 before anything external is
  called".
- Effect: an out-of-scope scoped manager can spend routing-provider calls and receive
  NO_VIABLE_ROUTE, ROUTE_VALIDATION_FAILED or ROUTING_UNAVAILABLE before the 404.
- Evidence: PROVEN_BY_SOURCE
- Hosted: working-tree only (scope arrives in integration commits 28 and 30).
- Severity: Low
- Recommendation: pass `actor=actor` at routes.py:233.
- Decision: ADOPT_NOW

### E8. Three docstrings or doc comments are attached to nothing

- backend/app/api/deps.py:1. `import logging` comes before the module docstring, so the docstring
  is a bare expression. Proof: `app.api.deps.__doc__ is None` returned True. PROVEN_BY_RUNTIME.
  This is also on e4043ce: PROVEN_BY_SOURCE.
- backend/app/services/trips.py:346-350. `_trip_filters` runs a statement before its docstring.
  Proof: `_trip_filters.__doc__ is None` returned True. PROVEN_BY_RUNTIME.
- backend/app/services/trips.py:71-96. The `#:` block describing OPEN_TRIP_STATUSES is split from
  it by `logger = ...` on line 94, so documentation tools attach it to `logger`. PROVEN_BY_SOURCE.
- Severity: Low. No behaviour change.
- Decision: ADOPT_NOW (move three lines)

### E9. Duplicate import

- backend/app/services/driver_trips.py:45 imports AuditAction and TripEventKind again. Lines
  35-42 already import them. PROVEN_BY_SOURCE.
- Severity: Low. Decision: ADOPT_NOW (delete line 45 and keep NotificationKind in the first
  import).

### E10. Small duplicated logic

- "Find the pickup stop" is written twice (trips.py:1104 and :1162), and :1162 has no empty-list
  guard (`stops[0]`). The TRIP_SUPERSEDED check is copied between driver_trips.py:135-140 and
  :656-661. PROVEN_BY_SOURCE.
- Severity: Low. Decision: ROADMAP (next change that touches either function).

### E11. The lifecycle defects above all pass the current suite

- There is no test for: two drivers on one truck at once (E1), a repeated redirect (E2), push
  after commit (E3), a stop request with no reachable manager (E4), or out-of-scope dispatch and
  planning order (E6, E7). PROVEN_BY_SOURCE (tests read, see ledger).
- Decision: ADOPT_NOW, one test per fix (plan in section 6).

### E12. A redirect cancel can outlast the console's timeout and invite the retry that triggers E2

- Where: manager-web/src/api/client.ts:128 (`REQUEST_TIMEOUT_MS = 15_000`, applied to mutations
  too). backend/app/services/trips.py:1505-1522 plans a new route synchronously after the redirect
  commits. The routing chain tries providers one after another (backend/app/services/routing/base.py:150),
  each with an 8 s timeout (backend/app/core/config.py:183).
- Reasoning: with `ROUTING_PRIMARY_URL` set, two slow providers can take about 16 s, so the
  console reports a network error for a redirect that already committed, and a manager who
  retries hits E2. With the default (no primary URL) only one provider runs.
- Evidence: INFERRED (not timed)
- Severity: Low to Medium, depending on configuration.
- Recommendation: return after the commit and let the console ask for route candidates, or plan
  in the background. E2's request id removes the harm either way.
- Decision: ROADMAP

### Rejected suggestions

| # | Suggestion | Why rejected | Evidence |
|---|---|---|---|
| R1 | Partial unique index on `trips(truck_id)` for open statuses instead of E1's row lock | The suite deliberately keeps legacy rows that already break the rule (test_resource_reservation.py:192 "rows that already break the rule are left alone"). A unique index would fail migration on such data. The row lock is the smaller change | PROVEN_BY_SOURCE |
| R2 | Build `ALL_PERMISSIONS` by introspecting module globals (ponytail shrink idea) | Clever, harder to read at 3am. test_authorization.py:47 already pins ADMIN to ALL_PERMISSIONS | PROVEN_BY_SOURCE |
| R3 | Run a Qodo review now | CLI absent, and it would upload the unmerged post-demo diff to a third party without a user decision | PROVEN_BY_RUNTIME |
| R4 | A durable push outbox now (ADR-1 option B) | The pdf-master durable queue already has known defects (not trip-scoped, strands events at INCIDENT, retries permanent 4xx forever). Moving the call after commit fixes E3 without a new moving part | INFERRED |

---

## 3. Where each ADOPT_NOW lands in the integration plan (docs/POST_DEMO_CHANGE_INVENTORY.md)

| Finding | Integration commit | Note |
|---|---|---|
| E1, E2, E3, E8, E9 | Any commit that touches trips.py. They also exist on e4043ce, so they can go first as 0012-compatible fixes | No migration needed |
| E4, E5 | 32 (driver stop request, inbox) | Decide the MANAGER inbox permission first |
| E6, E7 | 28 (scope-aware loads), 30 (HTTP row scoping) | One line each |
| E11 | With each fix | See section 6 |

The mapping follows the table in POST_DEMO_CHANGE_INVENTORY.md lines 203-243: PROVEN_BY_SOURCE.

---

## 4. Tech-debt ranking (engineering:tech-debt formula, my scores)

Priority = (Impact + Risk) x (6 - Effort). Scale 1-5. All scores: INFERRED (judgement).

| Finding | Impact | Risk | Effort | Priority |
|---|---|---|---|---|
| E4 stop request reaches nobody | 4 | 5 | 2 | 36 |
| E1 truck double booking | 3 | 4 | 2 | 28 |
| E3 push before commit | 3 | 3 | 2 | 24 |
| E2 repeated redirect | 3 | 3 | 2 | 24 |
| E6 dispatch scope order | 1 | 2 | 1 | 15 |
| E7 plan scope order | 1 | 2 | 1 | 15 |
| E12 redirect timeout | 2 | 2 | 3 | 12 |
| E8 detached docstrings | 1 | 1 | 1 | 10 |
| E9 duplicate import | 1 | 1 | 1 | 10 |
| E10 duplicated helpers | 1 | 1 | 2 | 8 |

---

## 5. ADR-1: where the driver push is sent (engineering:architecture template)

**Status:** Proposed. **Date:** 2026-09-26. **Deciders:** backend owner.

**Context.** `notify.send` writes a `driver_notifications` row and, in the same call, makes the
Expo HTTP request (notify.py:98-132). Dispatch, add-stop and stop-request call it after the commit.
Cancel, hold, redirect and cargo-unloaded call it before the commit, under the trip row lock (E3,
PROVEN_BY_RUNTIME).

**Option A: move the four calls after `db.commit()`, then commit again (the dispatch pattern).**
Complexity low, no new infrastructure, one existing pattern. If the process dies between the two
commits, the push is lost, but the trip change is right and the app's poll still shows it: INFERRED.

**Option B: durable outbox row inside the transaction, sent by a worker.** No lost pushes, but it
needs a worker on a one-worker free plan. The known pdf-master queue defects argue against adopting
it as it stands.

**Decision.** A now, B only if lost pushes are measured as a problem.

**Consequences.** One ordering rule everywhere ("a row is the notification, a push is only a
nudge", as trips.py:968-972 already says). The trip lock is no longer held across third-party I/O.

**Action items.** Move the four calls. Add one test that fails if a push is sent while the trip
change is still uncommitted (the spy-session technique from this lane's proof works in pytest
with a monkeypatched `notify._deliver`, as backend/tests/test_notify.py:26 already does).

---

## 6. Test plan (engineering:testing-strategy)

| Gap | Test type | Minimal case | Fails today |
|---|---|---|---|
| E1 | Integration, concurrency | Two `POST /api/trips/plan` calls through `asyncio.gather`, different drivers, one truck. Expect `[201, 409]` and one open trip on the truck | Yes: PROVEN_BY_RUNTIME (the service-level equivalent produced 2 open trips) |
| E2 | Integration | The same cancel body with RETURN_TO_DEPOT and the same request id, twice. Expect one new drop-off and one ROUTE_CHANGED event | Yes: PROVEN_BY_RUNTIME |
| E3 | Integration | Monkeypatch `notify._deliver` to read the trip status from a fresh session. Cancel an ASSIGNED trip. Expect CANCELLED at push time | Yes: PROVEN_BY_RUNTIME |
| E4 | Integration | Stop request on a trip whose shipment has no districts, with one active MANAGER. Expect at least one inbox row, or an acknowledgement that does not claim an alert | Yes: PROVEN_BY_RUNTIME |
| E6, E7 | HTTP, scope | An out-of-scope district manager dispatches or plans a trip whose driver is suspended. Expect 404 and no provider call | Expected to fail (dispatch returns a driver error first): INFERRED |

The suite must run against `ner_logistics_test` only (tests/db_target.py), so these tests are
written for that database. This lane did not run the suite: its rules forbid writing to that
database.

---

## 7. Ponytail audit (over-engineering only)

Scope: the six files named above. Most of the code is lean. The long comments record measured
incidents; they are not unused abstractions.

- `delete:` second import on driver_trips.py:45. Keep the first. [backend/app/services/driver_trips.py]
- `shrink:` the pickup lookup at trips.py:1104 and :1162. One `_pickup(stops)` covers both and the
  empty-list case. [backend/app/services/trips.py]
- `shrink:` the TRIP_SUPERSEDED block at driver_trips.py:656-661 repeats :135-140. `complete` can
  call the narrowing check it already duplicates. [backend/app/services/driver_trips.py]
- `delete:` nothing in manager-web/src/api/client.ts. The GET coalescing (:296-333) and the
  cross-tab refresh lock (:187-295) each cite a measured failure.

net: a few lines, 0 deps. No dependency or layer is worth removing.

---

## 8. What looks sound (checked, no action)

- `load_for_update` re-reads under the lock with `populate_existing` (trips.py:179-211). PROVEN_BY_SOURCE
- Driver start, accept, stop arrive/complete, deliver and stop request are retry-safe under the
  trip row lock (driver_trips.py:246-249, 345-346, 507-512, 651-653, 801-812). PROVEN_BY_SOURCE
- `add_stop` is protected against repeats by its 200 m separation check (trips.py:1289-1307). PROVEN_BY_SOURCE
- The must-reset gate uses `request.scope["path"]` (deps.py:79-81). This is the DEP-6 fix already
  known from cycle 1, not a new finding. PROVEN_BY_SOURCE
- Plan-trip retries reuse the same reference and trip code (TripsPage.tsx:347-353). PROVEN_BY_SOURCE

---

## 9. Reproduction (scratch, outside the repository)

Scripts live in the session scratchpad under `company2/plugins-engineering-data/`: `mkdb.py`
(creates or drops `ner_lane_ped_proof` and refuses any other name), `env.sh` (sets
`DATABASE_PROVIDER`, `LOCAL_DATABASE_URL`, `MIGRATION_DATABASE_URL` and the feature flags for that
database only; the password is read from `.runtime/pgpass.txt` and never printed), and `proof.py`
(asserts it is connected to `ner_lane_ped_proof`, stubs `notify._deliver`, and runs E1 to E4).
The proof database was dropped after the run: PROVEN_BY_RUNTIME (the cluster's database list
afterwards no longer contained it).
