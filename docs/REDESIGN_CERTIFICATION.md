> **Superseded (28 Sep 2026)** by [`REDESIGN_VISUAL_CERTIFICATION.md`](REDESIGN_VISUAL_CERTIFICATION.md). This file records the 20 Sep pass (vector scenery, no photographs) and is kept for history only.

# RASTA AI — redesign certification

**Date** 20 September 2026 · **Scope** Manager web + driver app, measured against the
seven reference images in `redesgin.7z` (`manger1-3.jpeg`, `driver1-4.jpeg`).

Nothing here was deployed. Hosted still runs schema 0012 and the `5b5e474` build.

---

## 1. What the references asked for, and what was built

| Reference | Screen | Result |
|---|---|---|
| `manger1.jpeg` | Operational region selector | **Rebuilt as its own full-width screen.** Brand header + tagline row, `STEP 1 OF 2`, scope card, schematic North-East map with the chosen state highlighted, four-step journey card, stat strip, terrain band. |
| `manger2.jpeg` | Manager sign-in | **Split panel.** Deep-forest left with four capability rows in circular badges; cream right with icon-led fields, an eye reveal, and a scope chip that names what the console will open. |
| `manger3.jpeg` | Command centre | **Topbar added** (scope + freshness + notifications + identity + sign out), sidebar retoned to forest and given an operational-region card. |
| `driver1.jpeg` | Driver sign-in | Language pill moved to the top-right; layered ridge hero with a horizon; cream card. |
| `driver2.jpeg` | Navigate | Forest map surface; the idle banner no longer borrows route blue. |
| `driver3.jpeg` | Safety | 112 is the one filled tile; the guidance list is outlined, not a wall of red. |
| `driver4.jpeg` | More | Tinted icon discs per row, forest cards, `Dark` — never `Night`. |

### Deliberate differences from the references

Each of these is a case where copying the picture would have meant shipping a lie
or breaking a rule the product already holds.

| Reference shows | Shipped instead | Why |
|---|---|---|
| `120+ Districts` | `4 · Verified districts · 6 states pending` | Counted from `/api/org/regions`. No verified directory exists for six states and the screen says so. |
| `Continue with SSO` | *(absent)* | There is no SSO. |
| `Forgot password?` (both apps) | A sentence naming who resets it | There is no reset flow; a link shaped like one is worse than none. |
| Global search box in the topbar | Per-page server-side search on Trips, Drivers, Trucks | There is no cross-entity search endpoint. A box that silently searched only open trips would be a worse lie than an absent control. |
| `Change Region →` in the sidebar | A card that states the region | The scope belongs to the account, not to a setting. |
| Sparklines and `+12% from last month` | Plain counts | No time series is stored. A trend line drawn from one reading is decoration pretending to be data. |
| `Route Status: Safe`, `Weather: Clear`, `320 km / 8h 20m` | Real values or `—` | UNKNOWN ≠ SAFE. |
| Four different icon-disc hues on More | One brand disc | Green means action, blue means route, amber caution, red emergency. A purple disc means nothing. |
| 5-tab driver nav with `Home` | 4 tabs: Trip · Navigate · Safety · More | No functional audit produced a fifth destination. |
| Photographic scenery | Vector terrain (`TerrainScene`, RN ridge Views) | No licensed photography, and shipping the mockup's own pixels is not implementation. ~2 KB instead of ~400 KB, sharp at 2560 and on a 3× phone. |

---

## 2. Defects found and fixed during the pass

### P1 — the region picker could never work

`/api/org/states` requires `TRIP_READ`. The sign-in screen called it **before any
token exists**, so choosing "A state" opened a dropdown that was empty on every
deployment, for every user, every time.

Closed by `GET /api/org/regions` — the one unauthenticated read in the
organisation API. Names and ids only: no counts, no provenance, no user, trip or
fleet data, and the same `OPERATIONAL_SOURCES` filter as the authenticated list.
Memoised for 300 s so an anonymous caller cannot make the database work.

Choosing a region still grants nothing: `_workspace_matches` compares it against
the account and refuses a mismatch with the same message as a wrong password.
`backend/tests/test_public_regions.py` holds all four properties, including the
hostile one — signing in as Assam while naming Meghalaya's id is still 401.

### P2 — the console scrolled sideways on a phone

At 320 px the Managers page pushed the document **258 px** wider than the
viewport. The sidebar slid away with it and the columns past the fold were
unreachable, because the page moved instead of the table.

Two root causes, both fixed once rather than per page:

- **Six tables had no scroll container** (Managers, both Overview tables, both
  Reports tables, States). Wrapped, with `src/components/tableScroll.test.ts`
  scanning every `.tsx` so the next one fails in CI instead of on a phone.
- **A grid item defaults to `min-width: auto`, not 0.** `.fleet-main` was already
  `min-width: 0`; its children were not, so the trip table's 385 px min-content
  width pushed the page 81 px wide at 320. One rule now covers
  `.fleet-main`, `.dispatch-grid` and `.fleet-layout` children.

Also: the Drivers header's fixed `w-56` search plus its Add button came to 322 px
in a 320 px viewport — two pixels of sideways scroll with nothing visible to
explain it. Now a flexible field that wraps.

### P2 — two modals promised `aria-modal` and did not keep it

The Fleet incident dossier and the Trips change-journey dialog both declared
`aria-modal="true"` with no focus trap and no Escape. Tab walked straight out
into the page behind them. Both now wrap Tab through `wrapTab` and close on
Escape.

*Caught while fixing it:* an inline `ref` callback runs on **every render**, so
focusing unconditionally yanked the caret back to the first button on each
keystroke — the reason field could not be typed into at all. Two TripsPage tests
failed and were right to. It now focuses only when focus is outside the dialog.

### P3 — the driver app was a slate product wearing a green logo

`DAY` was Tailwind-slate (`#F5F7FA` / `#0F172A` / `#64748B`) and `NIGHT` was
charcoal `#101820`, while the manager console had already moved to forest and
cream. Both palettes retuned — same keys, so no call site changed.

`src/theme.contrast.test.ts` now measures **every** readable token against
**every** surface it can land on (bg, card, raised, sunken) in both palettes.
It immediately caught `dim` at 4.41:1 on `sunken`, which a by-eye check against
one background had missed.

### P3 — three other honesty/hierarchy fixes

- The Safety guidance list filled every card with `badBg`. Four consecutive red
  slabs is a list where nothing reads as urgent. Red border, normal card.
- All three emergency numbers were identical red tiles. 112 reaches everything,
  so it is the one that fills.
- `Route not selected` was painted in route blue, making the *absence* of a route
  the loudest instruction on the map. It is a quiet state on the cab surface now.
- The Fleet details panel was a 600 px blank slab beside a busy map when nothing
  was selected. It now sizes to its content and says what will appear there.
- The sidebar gradient faded from charcoal-blue (`#16212A`) into forest and back
  out to `#0C131A` — two brands down one 1000 px edge.

---

## 3. Measurements

### Responsive — 11 widths × 10 pages, signed in

`320, 360, 390, 412, 768, 1024, 1280, 1366, 1440, 1920, 2560`

| | before | after |
|---|---:|---:|
| measurements | 110 | 110 |
| worst horizontal overflow | **258 px** | **0 px** |
| controls clipped out of reach | 18 | **0** |
| buttons with no accessible name | 0 | **0** |
| console errors | 1 | 1 |

The one console entry is a `401` from `/api/auth/refresh` at startup — the silent
session-restore attempt made before a cookie exists. It fires once and is by
design, not an application error.

Four controls measure under 24 px: two are exempt (`input.sr-only` is visually
hidden; a `text-route` link is inline text), one is a MapLibre marker from the
library, and the map's layer checkboxes are 14 px inside a **24 px label**, which
is the activation area WCAG counts. Raised from ~18 px in this pass.

### Tests

| suite | result |
|---|---|
| backend | **1435 passed, 5 skipped** |
| manager web | **333 passed** (was 322) |
| driver app | **704 passed** (was 676) |
| manager typecheck | clean |
| driver typecheck | clean |
| manager production build | ok — 1.73 MB js / 133 KB css / 478 KB map worker |

### Security regression

161 tests across `test_auth`, `test_authorization`, `test_rate_limit`,
`test_route_review_authorization`, `test_scope_http_idor`,
`test_security_assessment`, `test_state_district_scope`, `test_trusted_proxy`,
`test_public_regions` — all pass.

- Manager production bundle secret scan: **0 hits** across 6 files.
- APK 1.0.22 bundle secret scan: **0 hits** across 2.88 MB.
- SEC-008 still closed in the shipped APK: `integrity="sha384-"` ×2 and
  `crossorigin="anonymous"` ×2 in `assets/index.android.bundle`.

### Performance — warm, local certification API

| endpoint | p50 | p95 |
|---|---:|---:|
| health | 14.7 ms | 16.9 ms |
| ready (touches the database) | 16.2 ms | 31.8 ms |
| login (argon2 verify) | 164.1 ms | 177.4 ms |
| dashboard | 106.9 ms | 122.7 ms |
| trips list | 15.1 ms | 32.5 ms |
| fleet active | 31.1 ms | 43.6 ms |
| **`/api/org/regions` (new, memoised)** | **2.3 ms** | — |

Nothing over 400 ms at p95. Render's free-tier cold start remains **32.9 s** and is
reported separately, because averaging it with a warm number describes neither.

### Map and data capabilities, re-verified after the redesign

- 2D / Terrain / 3D: all three activate, canvas present, 0 page errors.
- POI layers: Fuel **60 mapped**, Hospital/police/fire **60**, Tyres and repair
  **17** in the Guwahati view, each carrying
  *"Mapped, not verified: nothing here says a place is open or reachable"* and
  `(c) OpenStreetMap contributors, ODbL · snapshot 2026-09-20`.

---

## 4. Gates still held

```
MIGRATION_0013_HOSTED_APPLIED   = NO
HOSTED_FIXTURE_CLEANUP          = NO
DEPLOYED                        = NO
PUSHED                          = NO
SUPABASE_RECOVERY_PATH          = NEEDS_USER_CONFIRMATION
APK_1.0.22_INSTALLED            = NO — needs a physical tap
```

`.runtime/rasta-driver-1.0.22-local.apk` (32.3 MB, versionCode 22) is built and
scanned. Installing it replaces the certified 1.0.21 on device `b519d9d3`, which
needs the user at the phone.
