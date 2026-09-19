# UI bug certification

Four reported defects, verified on the hosted build at
`https://ner-manager.onrender.com` + `https://ner-intelligence.onrender.com`, 19 September
2026. Commit `7c176f3` (fixes) and `d473f9c` (follow-ups) are live.

Three are fixed and re-verified on hosted. The fourth is fixed for access but exposed two
further problems in hosted **data**, recorded honestly below rather than closed quietly.

---

## 1. Trips page wasted half the screen at browser zoom — FIXED

**Was:** at 50% zoom on a 1920 screen (a 3840 CSS-pixel viewport), the Trips workspace used
53% of the width. Everything sat in a fixed-width column with a dead gutter beside it.

**Cause:** `.workspace` carried a global `max-width` sized for reading-width pages. Trips is
a table-and-planner page and needs the width.

**Fix:** one page modifier rather than a per-page override —
`.workspace--wide { max-width: none }`, applied by `App.tsx` when the path starts `/trips`.
Reading-width pages keep their bound.

**Measured on hosted, after the fix:**

| Case | Viewport | Rail | Workspace | Dead gutters | Table | Screen used | Overflow |
|---|---|---|---|---|---|---|---|
| 50% zoom on 1920 | 3840 | 216 | 3624 | L216 / R0 | 3518 | **100%** | 0 |
| 67% on 1920 | 2880 | 216 | 2664 | L216 / R0 | 2558 | 100% | 0 |
| 80% on 1920 | 2400 | 216 | 2184 | L216 / R0 | 2078 | 100% | 0 |
| 100% on 1920 | 1920 | 216 | 1704 | L216 / R0 | 1598 | 100% | 0 |
| 100% on 1366 | 1366 | 216 | 1150 | L216 / R0 | 1044 | 100% | 0 |
| 1024 | 1024 | 216 | 808 | L216 / R0 | 718 | 100% | 0 |
| 768 | 768 | — (rail stacks) | 768 | L0 / R0 | 694 | 100% | 0 |

The only remaining left gutter is the navigation rail itself. Horizontal overflow is zero at
every width. Evidence: `.runtime/evidence/layout/`.

---

## 2. One driver and one truck could be promised to several open jobs — FIXED

**Was:** trip creation validated each resource's own status (suspended, licence expiry,
truck operational) and never asked whether another open trip already held them. A dispatcher
could promise one person and one vehicle to three jobs.

**Fix, server first:** `blocking_trip_for()` in `backend/app/services/trips.py` selects the
holding trip `FOR UPDATE` across `RESOURCE_BLOCKING_STATUSES`, and `_assert_resources_free()`
raises `DRIVER_RESERVED_BY_TRIP` / `TRUCK_RESERVED_BY_TRIP` naming the trip. `CANCELLED` and
`CLOSED` release; `DELIVERED` does not, because the truck is still at the consignee until
someone closes the job. Two concurrent planners cannot both win the pair.

**Then the client**, so the refusal is visible before anyone types: reserved drivers and
trucks appear in the pickers as `… (reserved by TRP-XXXX)` and are `disabled`.

**Verified on hosted:**

| Check | Result |
|---|---|
| Same driver **and** truck as an open trip | `409 DRIVER_RESERVED_BY_TRIP` — "Hasan Sodawala is already committed to TRP-A8BA83FC-9328-42A9 (ASSIGNED). Close or cancel that trip first." |
| Same driver, **different** truck | `409 DRIVER_RESERVED_BY_TRIP` (still refused) |
| Open-trip count before vs after the refused attempts | 7 → 7 — **a refusal writes nothing**, no orphan shipment |
| Picker labels reserved people and vehicles | 3 of 3 reserved options labelled **and** disabled |

Tests: `backend/tests/test_resource_reservation.py` (10), plus the client rules in
`manager-web/src/pages/planValidation.test.ts`.

**Deliberately not done:** rows that already violated the rule are left exactly as they are.
Seven open trips on hosted predate the gate and include real double-bookings (one driver on
three open drafts). Retro-cancelling other people's trips is a data decision, not a code fix.

**One consequence worth recording.** The gate immediately blocked `judge.sh reset`: an
`ASSIGNED` trip created that morning (`TRP-A8BA83FC-9328-42A9`, Hasan Sodawala) held the
demo truck `AS86QQ7606`, so the canonical demo trip could not be created and
`judge.sh check` read `NOT READY`. The refusal was correct — the truck's own status field
said `AVAILABLE` while a live job held it, which is precisely the gap this closes. Cleared
at the operator's direction by cancelling that one trip; reset then produced `JUDGE-9044FE`
and check returned `READY`.

---

## 3. Exports had blank Client, Origin and Destination — FIXED

**Was:** every exported row showed an empty client and empty endpoints. The PDF styling was
blamed; it was not the styling.

**Cause:** the trip list returned trips only. Client name and the two addresses live on the
shipment, and the export read fields the API never sent. 107 of 107 rows were blank.

**Fix at the query, not at the renderer:** `list_trips()` outer-joins `Shipment` and
hydrates `client_name`, `origin` and `destination` onto each row in the same statement — one
request, no N+1. `TripRead` gained the three fields. `tripExport.ts` reads them and labels a
genuinely missing value `Not recorded` rather than printing an empty cell.

**Verified on hosted, through the UI's own Export CSV button** (blob captured in the page):

```
Client@1 Origin@2 Destination@3 — 7 rows, blanks {"Client":0,"Origin":0,"Destination":0}
first row: Client="Pushp Trader"
           Origin="Barpeta, Assam, 781309, India"
           Destination="Furkating, Golaghat, Assam, 785702, India"
```

Evidence: `.runtime/evidence/final-ui/trips-export.csv`.

---

## 4. Driver profile photo isolation — ACCESS VERIFIED; two data problems found

### 4a. Access isolation — PASS

Photos are private files behind `/api/files/{id}`, fetched with the bearer token. Tested on
hosted with real tokens:

| Request | Result |
|---|---|
| Driver → own photo | `200` bytes |
| Driver → another driver's photo | `404 NOT_FOUND` — existence is not even leaked |
| Manager → any driver's photo | `200` (correct: fleet oversight) |
| Anonymous → any photo | `401 UNAUTHENTICATED` |

Each of the eight drivers has their own `photo_url` or none; no two rows point at the same
file id.

### 4b. Two drivers show the same face — OPEN (DATA_DEFECT, not a code defect)

Distinct file ids, byte-identical content:

| Driver | Bytes | Type | SHA-256 (first 16) |
|---|---|---|---|
| Rituraj Gogoi | 2,327,427 | image/png | `82234bc3306a1ec0` |
| RASTA Demo Driver | 2,327,427 | image/png | `82234bc3306a1ec0` |
| Bipul Das | 3,500,820 | image/jpeg | `c18d8c6bef0f2e37` |

The same picture was uploaded twice during seeding. Access isolation is intact; visual
identity is not. Left as found: overwriting or deleting a stored photo is the owner's call.

### 4c. Avatars take 15–18 seconds to appear — OPEN (P3)

Instrumented on hosted: response headers arrive in ~1.2 s, the body finishes at **15.6 s,
15.7 s and 18.2 s**. Until then `AuthImage` shows initials, so the page never looks broken —
but a judge watching the Drivers page sees initials, not faces.

Cause: 2.3 MB and 3.5 MB originals served raw for a 40-pixel avatar, over Render's free
tier. Not a race and not CORS — the fetches resolve `200 type=cors`, and there is no CSP.

The driver app already re-encodes captures at JPEG quality 0.5; these three came from
seeding, which went straight to the API. The upload cap is 5 MB (`backend/app/api/files.py`),
sized against abuse rather than against avatars.

**Fixed forward, at the operator's direction:** `PROFILE_PHOTO` uploads are now capped at
512 KB (`MAX_PROFILE_PHOTO_BYTES` in `backend/app/api/files.py`), with a refusal that says
the actual size and where to take a smaller photo. Documents keep the 5 MB cap — the limit
is about avatars, not about files. Test:
`test_an_avatar_is_held_to_an_avatar_size`.

Server-side thumbnailing was considered and rejected: it needs an image library the backend
does not have, and adding a dependency mid-certification is the wrong trade.

**Still open:** the three photos already stored stay oversized, so those three drivers still
take ~16 s to show a face. Re-seeding them is a data decision and was left to the owner.

---

## Console and network

No console errors during the hosted flow. No failed requests. No duplicate mutation calls.

## Test state

| Suite | Result |
|---|---|
| Manager web (`vitest`) | 259 passed / 24 files |
| Manager typecheck (`tsc --noEmit`) | clean |
| Backend | 1,200 passed / 5 skipped, plus 10 new reservation tests and 1 list test |
