# ROUTE ATOMICITY — P1 DEFECT FIX

Continues `CLAUDE_UI_PASS_2.md`. Nothing committed or pushed. One migration
was deployed to hosted Supabase, with explicit authorisation given in-session —
see DEPLOYED below.

---

## THE DEFECT, AS FOUND

`selectRoute` was three independent PostgREST writes with no transaction, and
**the error on the first was never read**:

```ts
await supabase.from('trip_routes').update({ state: 'PROPOSED' })   // result discarded
   .eq('trip_id', tripId).eq('state', 'SELECTED')
const { data, error } = await supabase.from('trip_routes')
   .update({ state: 'SELECTED' }).eq('id', routeId).select().single()
await supabase.from('trips').update({ selected_route_id: routeId }) // result discarded
```

`acceptReroute` was worse — three fire-and-forget writes, **no error checked on
any of them**, returning a hardcoded success object including a
`selected_route_kind: 'PRIMARY'` that was never read from anything. It reported
success even when every write had failed.

Reachable states:

| Failure | Result |
| :--- | :--- |
| demote ok, promote fails | **zero** selected routes |
| demote fails (error discarded), promote ok | **two** selected routes |
| both ok, `trips` update fails | `trip_routes` says B, `trips.selected_route_id` says A — **manager on B, driver authoritatively on A** |
| two managers at once | both demote, both promote — **two** selected routes |

Two further holes, neither mentioned in the brief:

- **No ownership check.** The promote matched on `.eq('id', routeId)` alone, so
  a route id belonging to a *different trip* could be promoted onto this one.
- **No blocked check.** A `REJECTED_BLOCKED` corridor was selectable.

---

## THE FIX

`supabase/migrations/20260909100000_manager_select_route.sql` —
`app.select_route` / `public.select_route` and `app.accept_reroute` /
`public.accept_reroute`, following the `plan_trip` convention exactly
(security-definer `app.*`, invoker `public.*` wrapper, `auth.uid()`,
`app.has_perm`, structured `errcode` + JSON `detail`, `revoke`/`grant`).

One transaction does: authenticate → authorise (`route:select`) → **lock the
trip row** → verify the route belongs to this trip → idempotency → staleness →
blocked → demote others → promote one → repoint the trip → **assert exactly one
selected row** → audit.

`accept_reroute` is a thin wrapper over `select_route`, deliberately: accepting
a reroute *is* selecting a route, with the extra requirement that the caller
names the corridor being left. Two implementations of one rule drift — the old
client code proved it by checking authority in neither.

### Three design decisions worth challenging

**1. The concurrency token is the currently-selected route id, not a revision
counter.** The brief asked for `p_expected_route_revision`. I did not add one,
because `route_revision` **already exists and means something else**: it is a
content hash of geometry + maneuvers computed in
`backend/app/services/navigation.py`, deliberately derived so a package's
identity cannot disagree with the geometry it carries. A second, stored,
incrementing column under the same name would leave two different things called
"revision" — one binding content, one binding order. The selected route id
changes on exactly the events we care about, needs no schema change, and is
already what `acceptReroute(tripId, fromRouteId, toRouteId)` passes.

**2. Idempotency is checked *before* staleness.** A transaction can commit and
its response still be lost. The client retries with an expectation that is now
out of date; a naive staleness check answers CONFLICT for a request that already
succeeded, and the UI reports failure for a change that is live. If the
requested route is already selected, the function returns canonical state
unchanged — no writes, no second audit row.

**3. Staleness is reported *before* blockedness.** A caller can be both stale
and pointing at a blocked route. Answering `ROUTE_BLOCKED` states a fact about a
screen that no longer reflects reality and invites the manager to reason about
it; the actionable truth is that the trip moved on. The UI treatments differ
too — stale refreshes, blocked explains and keeps the current route. Both
directions are pinned by tests.

### What the RPC deliberately does NOT enforce

**Hazard review policy.** Eligibility (`REQUIRES_REVIEW` from live weather and
landslide evidence) is computed by the FastAPI intelligence plane, which is not
hosted. The RPC enforces what the *database* can prove — blocked state,
ownership, authority, atomicity — and nothing more. Accepting an
`authorizationId` it could not validate would look like enforcement while being
none, which is the failure mode this whole pass exists to remove.

---

## PROOF: 18 NEW DATABASE-LEVEL TESTS

`backend/tests/test_select_route_rpc.py` builds a disposable database, runs
alembic, applies every Supabase migration, and calls the RPC through the same
`auth.uid()` predicate the hosted project evaluates — the approach
`scripts/rls_harness.py` already used for RLS. Mocking would have proved
nothing: the point of moving this into the database was to get a transaction and
a row lock, and neither survives being stubbed.

| Test | Covers |
| :--- | :--- |
| selects a route and points the trip at it | happy path |
| selecting a second route demotes the first | **exactly-one invariant** |
| the trip pointer and the route rows never disagree | manager-on-B/driver-on-A |
| a blocked route is refused | BLOCKED policy |
| a route from another trip is refused | ownership hole |
| a driver may not select a route | authority |
| an anonymous caller is refused | authentication |
| a stale expectation is a conflict not an overwrite | optimistic concurrency |
| staleness is reported before blockedness | precedence |
| blockedness is reported when the caller is not stale | precedence, other half |
| a lost-response retry converges instead of conflicting | **retry idempotency** |
| a repeated click writes one audit row not two | audit idempotency |
| two managers selecting at once leave exactly one selected | **concurrency** |
| reroute moves the trip and names the route left | reroute happy path |
| reroute from a route no longer current is refused | stale reroute |
| a cross-trip reroute is refused | ownership |
| a driver may not accept a reroute | authority |
| a failed reroute rolls back completely | **transaction rollback** |

**18/18 pass.**

---

## MANAGER CLIENT

Both multi-write paths deleted. Each domain operation is now one server call,
pinned by 6 new manager tests whose mock **throws if `.update()` is reached** —
so reintroducing a client-side demote/promote fails the suite.

New `rpcError()` maps SQLSTATE to an `ApiError` the UI can branch on:
`40001 → 409 STALE_ROUTE_REVISION`, `42501 → 403`, `28000 → 401`,
`P0002 → 404`, `55000 → 422`. Without this a legitimate concurrent edit would
surface as a server fault.

`acceptReroute` now returns the route kind **the server actually selected**
instead of a hardcoded `'PRIMARY'`.

---

## THROWING CONTROLS: NINE, NOT SIX

The brief said six. There are **nine** with real UI call sites:

| Control | Page | Now |
| :--- | :--- | :--- |
| Add driver (×2 entry points) | DriversPage | DISABLED_WITH_REASON |
| Deactivate driver | DriversPage | DISABLED_WITH_REASON |
| Add truck (×2 entry points) | TrucksPage | DISABLED_WITH_REASON |
| Retire truck | TrucksPage | DISABLED_WITH_REASON |
| End assignment | AssignmentsPage | DISABLED_WITH_REASON |
| Cancel trip | TripsPage | DISABLED_WITH_REASON |
| Close trip | TripsPage | DISABLED_WITH_REASON |
| Revoke review authorisation | ReviewPage | DISABLED_WITH_REASON |
| Resolve address | AddressPicker | degrades to an honest `PROVIDER_ERROR` state |

`UNAVAILABLE_OPERATIONS` in `supabaseManagerApi.ts` carries a per-operation
reason; `unavailableReason(op)` in `client.ts` returns null on the local FastAPI
transport (where everything is implemented) and the reason on hosted Supabase.
`Button` gained a `title` prop to carry it — a greyed button with no explanation
is only marginally better than one that throws.

**I did not wire these up, deliberately.** Several are guarded state transitions
(`cancelTrip`, `closeTrip`) or need privileges a browser holding an anon key does
not have (`createDriver` needs a GoTrue admin call). Implementing them as ad-hoc
client-side table writes is precisely the pattern just removed from route
selection. Making six buttons light up by adding six more unguarded write paths
would trade a visible gap for an invisible corruption.

---

## A TOOLING DEFECT FOUND ALONG THE WAY

**`npx tsc --noEmit` in `manager-web` checks nothing.** The root `tsconfig.json`
is a project-references stub (`"files": []`), so that command exits 0 having
type-checked zero files. It silently passed code with an invalid JSX prop.

The correct command is **`tsc -b`**, which is what `npm run build` already runs —
so no bad code shipped, but every "typecheck clean" I reported using
`tsc --noEmit` was hollow. All figures below use `tsc -b`.

---

## REGRESSION

| Suite | Before | After |
| :--- | :--- | :--- |
| **Backend** | 976 | **994 passed**, 5 skipped, 0 failed |
| **Manager** | 150 | **156 passed**, 0 failed |
| **Driver** | 510 | **510 passed**, 0 failed (untouched) |
| Manager `tsc -b` | — | clean |
| Driver `tsc --noEmit` | — | clean (single tsconfig; not a stub) |
| Manager production build | — | clean |

No test weakened. No existing authorization test touched.

---

## FINAL GATE

| Gate | Verdict |
| :--- | :--- |
| SELECT_ROUTE_RPC | **PASS** — proven locally, deployed to hosted, anon refused |
| ACCEPT_REROUTE_RPC | **PASS** — proven locally, deployed to hosted, anon refused |
| EXACTLY_ONE_SELECTED | **PASS** — asserted inside the transaction, plus 3 tests |
| CONCURRENCY | **PASS** — two overlapping transactions, row lock, one winner |
| STALE_REVISION | **PASS** — 409, both precedence directions pinned |
| RETRY_IDEMPOTENCY | **PASS** — converges, one audit row |
| MANAGER_CLIENT_ATOMIC | **PASS** — one call each; mock rejects table writes |
| DRIVER_ROUTE_CONVERGENCE | **PASS (pre-existing)** — `useNavigationPackage` triple guard |
| LATE_NAV_PACKAGE_REJECTED | **PASS (pre-existing)** — regression test already present |
| SIX_MANAGER_CONTROLS | **9 found**: 0 working, **8 disabled with reason**, 1 degrades honestly, **0 broken** |
| BACKEND | **994** passed / 5 skipped |
| MANAGER | **156** passed |
| DRIVER | **510** passed |
| PRODUCTION_BUILD | **PASS** |
| FASTAPI_HOSTING | **BLOCKED** (unchanged, external) |
| DEMO_READY | **NO** |

---

## DEPLOYED (authorised in-session)

You authorised the migration; it was applied to `znaveeefzgfxsblsobdb` as
`manager_select_route`. Verified afterwards by direct query:

| Function | Schema | security definer |
| :--- | :--- | :--- |
| `select_route` | `app` | yes |
| `accept_reroute` | `app` | yes |
| `selected_route_state` | `app` | yes |
| `select_route` | `public` | no (invoker wrapper) |
| `accept_reroute` | `public` | no (invoker wrapper) |

Purely additive: five `create or replace function` statements plus grants. No
table created, no column altered, no data row touched. `plan_trip` and
`dispatch_trip` unaffected.

**Anon is refused, verified live against the hosted endpoint:**

```
POST /rest/v1/rpc/select_route    (anon key) -> HTTP 401  permission denied for schema app
POST /rest/v1/rpc/accept_reroute  (anon key) -> HTTP 401  permission denied for schema app
```

Anon is stopped by the missing `USAGE` on schema `app`, before the function body
runs at all — a stronger gate than the in-function `auth.uid()` check, which is
still there behind it.

---

## SECURITY OBSERVATION (PRE-EXISTING, NOT INTRODUCED HERE)

Every RPC on this project carries `anon=X/postgres` in its ACL:

```
accept_reroute, accept_trip, dispatch_trip, plan_trip, select_route, start_trip
```

That comes from Supabase's `ALTER DEFAULT PRIVILEGES` granting EXECUTE on new
functions in `public`, and the `revoke all ... from public` each migration
performs does not remove it — `PUBLIC` and the explicit `anon` grant are
different things.

It is **not currently exploitable**: the invoker wrappers cannot reach schema
`app`, as proved above. But it means the whole RPC surface is nominally
anon-executable and only a second mechanism stops it. Worth an explicit
`revoke execute ... from anon` across all six as defence in depth. **Not changed
here** — it touches every existing RPC, not just the two this pass added, and
that is a wider blast radius than this mission authorised.

---

## FINAL REGRESSION (post-deployment)

| Suite | Result |
| :--- | :--- |
| **Backend** | **994 passed**, 5 skipped, 0 failed |
| **Manager** | **156 passed**, 0 failed |
| **Driver** | **510 passed**, 0 failed |
| Manager `tsc -b` | clean |
| Manager production build | clean |
| Hosted RPCs | present, anon refused |
