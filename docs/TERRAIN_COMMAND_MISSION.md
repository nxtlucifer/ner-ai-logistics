# Terrain Command redesign and APK investigation

Started 2026-09-07 IST. User-authorized mission: `C:\Users\patel\Downloads\NER-AI-Redesign-APK-Debug-Mission.txt` (read completely).

## Current state

Active phase: VERIFY / final artifact certification (session 3, resumed 2026-09-07 ~14:00 IST).

Work continues in the dirty checkout; the baseline was never restarted. Concept A
(light Terrain Command) remains the selected direction. No theme, framework or map
provider was replaced.

- Repository: `D:\Projects\ner-ai-logistics`; branch `main`; starting HEAD
  `f850de456d03bdcf776bafd1bcd8377f89b763c0`, unchanged. COMMITTED = NO; PUSHED = NO;
  DEPLOYED = NO.
- Tests and demo use only the isolated PostgreSQL `127.0.0.1:55432/ner_logistics_test`.
  No shared-database writes.
- AXME context tool required by CLAUDE.md is still not present in this session; no
  plugin configuration was changed.

### Gates as of this session

| Gate | Result | Scope |
| --- | --- | --- |
| CORE_END_TO_END_DEMO | **PASS** — 9/9 checks, exit 0 | Local Chrome; real API/OSRM; driver via Expo web |
| Manager viewport + zoom matrix | **PASS** — 30/30 cells | 1366x768 and 1440x900 at 100/125/150/200%, tablet 834, mobile 390 |
| Manager tests | PASS — 99/99 | `manager-web` vitest |
| Driver tests | PASS — 230/230 | `driver-app` vitest |
| Typecheck (manager, driver) | PASS — both exit 0 | `tsc -b`, `tsc --noEmit` |
| Backend full suite | 942 passed, 1 failed, 5 skipped | Failure is pre-existing and environmental — see TC-07 |
| Manager production build | PASS | `tsc -b && vite build` |
| STATIC_APK_CHECKS (original) | PASS, artifact unchanged | v2 signature, standalone Hermes bundle, 4 ABIs |
| BUILD (final APK) | see "Final artifact" below | EAS `preview`, Free plan |
| ADB_INSTALL / NORMAL_INSTALLER / PHYSICAL_DEVICE_LAUNCH / RELEASE_WITHOUT_METRO | **NOT RUN** | No device connected; `adb devices -l` empty |

### Evidence

- `docs/terrain-command/evidence/journey-report.json` — status PASS, 9 checks, **zero**
  page errors and zero HTTP >= 400 across the whole run.
- `docs/terrain-command/evidence/journey-01..10-*.png` — the required demo scenario,
  step by step, each frame stamped "LOCAL QA - synthetic trip & GPS".
- `docs/terrain-command/evidence/viewport-matrix.json` + `viewport-*.png` — reflow gate.
- `docs/terrain-command/evidence/before-*.png` vs `after-*.png` — before/after pairs for
  manager login/fleet/detail/dispatch and driver login/home/map/assistant/safety/translator.
- `docs/terrain-command/evidence/after-manager-route-review-controls.png` — TC-08 fix.
- `.runtime/terrain-command/` — logs (`journey.log`, `viewport-matrix.log`,
  `eas-build-final.log`, `backend-full.log`, test logs) and the preserved APKs.

## Issue register

| ID | Priority | Root cause | Files | State | Verification |
| --- | --- | --- | --- | --- | --- |
| TC-01 | P1 | Reported Android installer stall after WhatsApp delivery. Cause still **unproven**. Ruled out this session: EAS signing-lineage mismatch (both finished builds carry the identical certificate `d3a0dc77…`), native-lib extraction (`extractNativeLibs=false`), 16 KB page size (arm64-v8a and x86_64 ELF loads aligned), ABI mismatch (4 ABIs), AAB-renamed-APK, ZIP damage. | — | BLOCKED on device | Preserve original; static checks PASS |
| TC-02 | P1 | Late address detail response could replace a later typed/manual endpoint | `manager-web/src/components/AddressPicker.tsx` | IMPLEMENTED | 21 AddressPicker tests PASS incl. late-resolve-after-shortening |
| TC-03 | P1 | Marker freshness memo omitted clock and permission, so a marker could stay LIVE | driver map screens | IMPLEMENTED | Driver suite 230 PASS |
| TC-04 | P2 | Native map never reported viewport, so "Search this area" had no anchor | driver map adapter | IMPLEMENTED (web verified) | Journey check "Explicit Search this area uses visible map bounds" PASS |
| TC-05 | P2 | Manager layout and driver hierarchy needed the Terrain Command redesign | manager-web + driver-app | IMPLEMENTED | after-* screenshots, 30/30 viewport matrix |
| TC-06 | P1 | Launcher cold-start reportedly stalled after database recovery | `scripts/Start-Demo.ps1` | NOT REPRODUCED | Full cold start this session: all 5 phases OK, log `launcher-resume.log` |
| TC-07 | P3 | `spatial_ref_sys` sits in `public` without RLS on the **local** isolated cluster, so `test_no_table_in_public_lacks_rls` fails | environment, not code | PRE-EXISTING / NOT ATTRIBUTABLE | See below |
| TC-08 | P2 | Two map-fit buttons were pinned at `left-3` and `left-24`; "Region overview" is 117 px wide, so they overlapped on the review panel | `manager-web/src/components/FleetMap.tsx` | FIXED | Measured at 1440/1152/960/720: no overlap, 8 px gap |
| TC-09 | **P1** | `.easignore` used `/*` then `!/driver-app/`. The trailing slash meant the negation never matched the ignored **directory node**, the archiver pruned it, and EAS received an **80-byte** archive. Build `6c856cb0` died in 6.5 s. | `.easignore` | FIXED | Reproduced against the same `ignore` npm package; archive went 80 B -> 729 KB |
| TC-10 | P3 | Journey/capture scripts contained a mis-encoded ellipsis (lone `0x85`) and four `count()` probes that do not auto-wait, so steps were silently skipped and still reported PASS | `scripts/demo/terrain-journey.js`, `terrain-capture.js` | FIXED | Journey now 9/9 from a fresh draft |

### TC-07 detail

`spatial_ref_sys` is created by PostGIS. Migration `0001_bootstrap_postgis` puts the
extension in `extensions` on Supabase (so the table is not in `public` there) and in the
default schema on a local cluster that has no `extensions` schema — which this one does
not. The table holds EPSG coordinate-system definitions, no user data, and the local
cluster publishes no Data API, so the invariant the test protects does not apply to it
here.

Provenance: the pre-mission full run (`logs/backend-full.log`, 2026-09-05 00:22) was
724 passed / 0 failed. The current test database's `public` objects date from
2026-09-05 14:50 — the cluster was re-provisioned after that run and before this mission
began on 2026-09-07. Not attributable to this work, and **not** silenced: the test is
untouched.

Operator remediation, if the invariant should hold locally too (owner is `ner_test`, and
a table owner bypasses RLS, so application reads are unaffected):
`ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;`
Not applied here because it changes the security of an extension-owned table, and this
mission has no authorization to alter database objects outside its own migrations.

## Known limitations, stated rather than hidden

- **Native basemap**: `app.json` has `extra.googleMapsConfigured: false` and the merged
  manifest carries no Google Maps API key. The native release map will not render tiles
  until a key is configured. BLOCKED on the owner's provider configuration.
- **Cleartext is now scoped, not app-wide.** The original APK carried Expo's managed
  default `usesCleartextTraffic="true"` for every host. The final APK sets it to `false`
  and ships `res/xml/ner_network_security_config` with
  `<base-config cleartextTrafficPermitted="false">` plus a single exception for the demo
  LAN host — verified by decoding the resource out of the built artifact, which contains
  exactly `172.24.85.80` and nothing else. `driver-app/plugins/withDemoNetworkSecurity.js`
  refuses any host that is not an RFC-1918 address. Caveat that remains: that IP is
  DHCP-assigned, so if the laptop's address changes the APK must be rebuilt or the phone
  will get a cleartext-blocked failure rather than a timeout.
- **Driver web has no session persistence, by design.** `src/auth/tokenStore.ts` stores
  nothing on web (no safe place; the API is called with `credentials:'omit'`), so a reload
  signs the driver out. Native uses SecureStore. The journey therefore re-authenticates
  after reload and asserts the real invariant — the accepted trip returns from
  authoritative server state with no second acceptance. **Native token persistence is not
  covered by any run here.**
- No physical device, so no install, launch, native GPS or Metro-free certification.

## Final artifact

| Field | Value |
| --- | --- |
| Path | `D:\Projects
er-ai-logistics\.runtime	errain-commandpkinal-eas-9e136a14-vc3.apk` |
| Size | 74,170,334 bytes (70.7 MiB) |
| SHA-256 | `1ec897d744ecdd47be4b7ad882d329a10a8f7a67bc5a11fd29d46066d2dd6715` |
| EAS build | `9e136a14-db7a-404a-b895-242f034bf513`, profile `preview`, finished 2026-09-07T09:12:41Z |
| applicationId | `com.nxtlucifer.nerlogistics.driver.preview` (unchanged) |
| versionName / versionCode | 1.0.0 / **3** (original was 1) |
| SDKs | min 24, target 36, compile 36 |
| ABIs | arm64-v8a, armeabi-v7a, x86, x86_64 (15 libs each, none missing) |
| Signing | v2 scheme, RSA 2048, cert SHA-256 `d3a0dc77e329861c9b0decf71d6946a808f77ad3e5e81318fb881851e9815007` — **identical to the original**, no rotation |
| Alignment | `zipalign -c -P 16 4` exit 0; arm64-v8a and x86_64 ELF loads 16 KB aligned |
| Packaging | standalone Hermes bundle `assets/index.android.bundle`, 3 DEX, no AAB structure, no split attribute, not debuggable, no dev-client marker |
| STATIC_APK_CHECKS | **PASS**, `static_failures: []` |
| Build command | `cd driver-app && EAS_NO_VCS=1 npx eas-cli build --platform android --profile preview --non-interactive` |
| Source state | HEAD `f850de4` + the uncommitted working tree described above |

The original failing artifact is preserved untouched at
`.runtime/terrain-command/apk/original-eas-4c9331fe.apk`
(73,286,916 bytes, SHA-256 `4ecc4152…`, versionCode 1), alongside the earlier finished
build `prior-eas-bbe966dd.apk` downloaded this session for the signature comparison.

## Next

NEEDS_PHYSICAL_DEVICE_INSTALL_CERTIFICATION. On the intended handset, in this order:

1. `Settings > Apps > see all` — is `com.nxtlucifer.nerlogistics.driver.preview` already
   installed, and from which installer? If an older copy exists that was **not** built by
   this EAS project, its signature will differ and the install will fail at the very end
   of the installer, which is the reported symptom. Uninstalling it is the user's
   decision, not an automated one.
2. Free space: the APK is 70.7 MiB and needs roughly 250 MB free to install.
3. Watch for a Play Protect "unsafe app blocked / scan" prompt — it appears at the end of
   the installer on sideloaded APKs of this size. Do not disable Play Protect; note what
   it says.
4. With USB debugging on: `adb devices -l`, then
   `adb -s <serial> install -r ".runtime	errain-commandpkinal-eas-9e136a14-vc3.apk"`
   and keep the exact stdout/stderr — the error code is what classifies the cause.
