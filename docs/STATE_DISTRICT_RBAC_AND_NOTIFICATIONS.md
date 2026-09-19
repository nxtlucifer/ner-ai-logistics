# State and district managers, and the inbox that serves them

What exists in the code as of migration `0013_state_district_inbox`. Statuses use the
mission's vocabulary: `IMPLEMENTED`, `PARTIALLY_IMPLEMENTED`, `NOT_IMPLEMENTED`, `BLOCKED`.

---

## 1. The role model — `IMPLEMENTED`

Two roles were added. Nothing existing was renamed or narrowed.

| Role | Scope | Sees | Creates accounts |
|---|---|---|---|
| `ADMIN` | national | everything | any |
| `MANAGER` | fleet-wide (pre-existing, unchanged) | everything | no |
| `STATE_MANAGER` | one state | every trip touching any district of that state | District Managers in their own state |
| `DISTRICT_MANAGER` | one district | trips whose origin **or** destination is that district | no |
| `AUTHORISED_REVIEWER` | — | the trip and route it authorises | no |
| `DRIVER` | own trip | own trip | no |

`MANAGER` keeps fleet-wide reach deliberately. The hierarchy is additive: a demo, a test
and a running deployment all continue to work with the accounts they already have.

## 2. Where scope is enforced — `IMPLEMENTED`

One module: `backend/app/core/scope.py`. Every list filters through
`trip_scope_clause()` / `shipment_scope_clause()`; every single-row read checks
`may_see_shipment()`. Both derive from the same predicate, because a filtered list beside
an unfiltered `GET /resource/{id}` is not access control — it is a tidy screen. The IDOR
tests assert the two agree.

```
DISTRICT_MANAGER   origin_district == mine OR destination_district == mine
STATE_MANAGER      the state of either district == mine
ADMIN / MANAGER    no clause at all (unscoped, by design)
anything else      false  — fails closed
```

Three rules worth stating out loud:

- **A truck arriving is the destination district's business.** Scope is built from the
  trip's geography, not from who owns the truck.
- **A shipment with no district recorded reaches no scoped manager.** Null means nobody
  said. Inferring a district from coordinates would put a truck under the authority of a
  manager with no claim to it, and the fix is to record the district, not to guess it.
- **A scoped role with no scope is refused twice**: by `ck_users_role_scope` in the
  database, and again by `require_scope()`. The constraint could be dropped by a future
  migration; the second lock should still hold.

## 3. Geography — `PARTIALLY_IMPLEMENTED` (states yes, districts `BLOCKED`)

`states` and `districts` both carry `source_name` and `source_effective_date`, and
districts additionally carry `disputed_or_recently_changed` and `notes`.

**The eight states are seeded** by migration 0013, sourced to the SIH26002 problem
statement.

**No districts are seeded, and that is deliberate.**
Status: `BLOCKED_NEEDS_OFFICIAL_DISTRICT_SOURCE`.

A district list is a government notification, not a fact about software. Assam, Manipur
and Arunachal Pradesh have all gazetted changes in living memory and at least one was
litigated, so published counts disagree. No verified official source was machine-reachable
from this session: the Local Government Directory (`lgdirectory.gov.in`) is an interactive
application rather than a document, and the `data.gov.in` LGD catalogue needs an API key
this project does not hold. Seeding a plausible list would make a guess indistinguishable
from a gazette, and the provenance columns exist precisely to prevent that.

A test enforces it: `test_districts_are_not_seeded_and_that_is_deliberate` fails if
districts appear without a recorded source. Replace it with one that asserts the count
**and** the source when someone seeds from a verified notification — do not delete it.

### To unblock, in order of preference

1. LGD district export for each of the eight states, with the extract date.
2. Each state government's own current district list page, with its notification number.
3. The Census/Registrar General district directory, noting it lags recent changes.

Record for every row: name, state, source URL or notification number, effective date, and
`disputed_or_recently_changed` where sources disagree.

## 4. Manager account lifecycle — `PARTIALLY_IMPLEMENTED`

Implemented:

- `MANAGER_ACCOUNT_MANAGE` permission, held by `ADMIN` and `STATE_MANAGER` only.
- `may_manage_user()`: a State Manager may create **only** District Managers, **only** in
  their own state. Not peers, not admins, not another state.
- `users.must_reset_password`, `users.created_by_user_id` columns.
- One active manager per state and per district, as partial unique indexes. Retirement is
  deactivation, not deletion, so the predecessor stays on the record and the index frees
  the slot.

Not yet implemented: the HTTP endpoints, the forced password-change gate on every other
route, and the Manager Web screens. `must_reset_password` is a column nothing reads yet —
it must not be presented as a working flow until the gate exists.

## 5. Notifications — `PARTIALLY_IMPLEMENTED`

`notifications` is a durable, addressed inbox: `recipient_user_id`, `trip_id`, `kind`,
`severity`, JSONB `payload`, `dedupe_key`, `is_read`, `read_at`.

Two tables, two jobs, and they are not the same:

| | `driver_notifications` (0012) | `notifications` (0013) |
|---|---|---|
| Records | a push **attempt** to a phone | the notification **itself** |
| Means | "we tried" | "this is waiting for you" |
| Survives being offline | no | yes |

**Structured payload, not a frozen sentence.** `kind` plus `payload` lets the client render
the message in the reader's language. An English sentence written into a row in September
cannot be translated in October.

**Dedupe is a database constraint**, unique per recipient, with `ON CONFLICT DO NOTHING`. A
route re-assessed five times in a minute is one notification. A check-then-insert would
lose exactly the race that happens — two workers reacting to one event.

Implemented: `recipients_for_trip()`, `notify()`, `inbox()`, `mark_read()`, and dispatch
wired to all of it. Each side hears its own fact — the origin that a truck **left**, the
destination that one is **coming** — because only the second changes what the destination
does today.

Not yet implemented: the HTTP endpoints, realtime delivery, the manager inbox UI, and the
other event kinds (`ROUTE_CHANGED`, `TRIP_DELAYED`, `TRIP_ARRIVED`, `TRIP_DELIVERED`,
`DRIVER_EMERGENCY_STOP`, `EMERGENCY_RESOLVED`) — the enum values exist, nothing emits them
yet.

## 6. RLS — read this before adding policies

The backend connects to Supabase as `postgres`, which has `rolbypassrls = true`. **RLS
therefore cannot participate in backend authorization at all**, and every client in this
project reaches the database through FastAPI, never through PostgREST.

```
RLS protects              the Supabase Data API (anon key, PostgREST)
app/core/permissions.py   every request that reaches FastAPI
app/core/scope.py         which rows within that request
```

`ENABLE ROW LEVEL SECURITY` is set on the new tables, consistent with the rest of the
schema, so that the Data API is closed by default. Writing scope policies in SQL and
calling that the district model's enforcement would be theatre: it would look like
security while enforcing nothing on the path clients actually use. See `docs/SECURITY.md`.

## 7. Test matrix

`backend/tests/test_state_district_scope.py` (16) and
`backend/tests/test_notifications.py` (11).

| Actor | Own district | Other district, same state | Other state | Trip arriving in their district |
|---|---|---|---|---|
| District Manager | allow | deny | deny | **allow** |
| State Manager | allow | allow | deny | allow if it touches their state |
| MANAGER (legacy) | allow | allow | allow | allow |
| Authorised Reviewer | deny | deny | deny | deny |

Also covered: the scope constraint at database level, the second lock in code, one active
manager per patch, successor after deactivation, unscoped shipments reaching nobody,
recipient deduplication, dedupe-key collision, severity mapping, and reading or marking
someone else's notification (finds nothing rather than refusing, so nothing is leaked
about whether the id exists).
