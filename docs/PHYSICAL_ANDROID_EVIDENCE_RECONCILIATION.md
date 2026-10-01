# Physical Android evidence: reconciliation

Lane: routing-android (REPRODUCE, DO NOT FIX). Written 30 Sep 2026 against HEAD `5b5e474` plus the
uncommitted working tree. No source was changed and no phone was touched.

Two stories conflict:

- Antigravity says physical Android was "never tested on real hardware", citing `AGENTS.md:194`.
- Earlier project docs say APK 1.0.18 was "certified" on a phone.

This document keeps only what the evidence files support. Labels: PROVEN_BY_RUNTIME here means a
historical runtime artefact. That is an on-device log line, an `adb`/`pm` output or a device
screenshot, and it was re-read today but not re-run. PROVEN_BY_SOURCE means a build or config file.
NOT_REPRODUCED means the claim is contradicted, or nothing supports it.

Device serials are masked to the last 4 characters. The evidence files contain personal data: a
personal home screen, a real person's name on screen, an account e-mail captured from a
password-save sheet, and a real location in the 12 Sep shots. They stay private and are not quoted
here.

## 1. Verdict

```
OLDER_APK_PHYSICAL_PROOF   = YES - APK 1.0.18 (versionCode 18, sha256 5d374766...59c25cab,
                             identical to release/RASTA-AI-1.0.18.apk) on device CPH2691 ****d9d3,
                             Android 16, against the HOSTED API:
                             judge flow 12/12 once (14 Sep 18:35), 11/12 twice (17:26, 18:27);
                             role certification 9/9 (14 Sep 17:17); human-driven trip 16 Sep
                             (phone did receive/accept/start/pickup/deliver, the MOVING leg was
                             simulated GPS on the driver WEB build).
                             Earlier: remote-demo "L" APK 12/12 x3 (13 Sep); Expo Go + real GPS (12 Sep).
LATEST_APK_PHYSICAL_PROOF  = PARTIAL - APK 1.0.21 (versionCode 21, sha256 4773e381...ae1d931edd),
                             20 Sep, version read back from the device: 66-item matrix =
                             37 PASS, 1 PARTIAL, 28 BLOCKED. EVERY trip-lifecycle item is BLOCKED
                             (assignment -> accept -> truck verify -> pickup -> route line/maneuvers ->
                             off-route/reroute -> emergency stop -> arrive/deliver -> driver/truck released).
                             APK 1.0.22 (the newest binary): installation UNPROVEN, 0 functional steps.
LATEST_INTEGRATED_BUILD    = the current working tree (HEAD 5b5e474 + 100 uncommitted driver-app entries,
                             app.json 1.0.22 / versionCode 22). NO APK or AAB has been built from it.
LATEST_INTEGRATED_BUILD_PHYSICAL_STATUS = NOT CERTIFIED (never built, never installed; no device attached today)
PHYSICAL_ANDROID_READY     = NO
```

Short form: an older build was tested on a phone, and the latest integrated build is not certified.
Antigravity's "never run on a real handset" is wrong for builds up to 1.0.21. Its conclusion, "not
certified", is right for the build that would ship.

## 2. Evidence timeline

The device is CPH2691, serial `****d9d3`, Android 16, screenshots 1264x2780. `.runtime/phone-install.sh`
and `docs/terrain/HANDOFF.md` §6f call it "OPPO CPH2691", while
`.runtime/evidence/phone-1.0.22/rollback.txt` says "OnePlus CPH2691". The brand is therefore
unresolved, but the model number and serial are the same everywhere.

It is not an emulator:

- There is no `emulator-*` serial anywhere.
- Every screenshot carries a carrier status bar (VoLTE, dual SIM, charging).
- The ColorOS package installer appears ("No risks found / Continue installation").
- A face-or-fingerprint prompt, an incoming-call interruption and Wi-Fi AP isolation are all logged.

| date (IST) | build on the phone | how the version is known | what ran | result | evidence |
|---|---|---|---|---|---|
| 12 Sep night | Expo Go 57.0.9 running the Metro bundle over USB. **Not an APK.** | HANDOFF §6f | login, dispatch receipt, accept/start, real GPS fixes, off-route -> real OSRM reroute, offline/last-known, reconnect, dialler, TTS | passed per HANDOFF | `phone-20..22-abu-*.png`, HANDOFF §6f |
| 13 Sep 11:11-14:30 | remote-demo APKs J, K, L (72-74 MB) | `adb_install_J/J2/K/L.log` = "Success" | judge flow on hosted | J1-J3 11/11, K1 10/12, L1-L3 12/12 | `judge_e2e_r1..r3.log`, `judge_e2e_K1/L1..L3.log` |
| 13 Sep | same | - | compat and notification gates | network switch PASS, last-sync FAIL; background Android notification FAIL x3 (7/11) | `phone_compat.log`, `gate2-phone-notify-run1..3.log`, `phone-compat-04-mobile-data.png` |
| 13 Sep 20:42 | 1.0.14 | "installed 1.0.14" | install only | - | `pm-install-1.0.14.log` |
| 13 Sep 21:11 | 1.0.15 attempt | dumpsys still 1.0.14 | install FAILED | - | `phone-after-unlock.log` |
| 14 Sep 10:34 | 1.0.17 | dumpsys `versionName=1.0.17` | i18n and assistant checks | - | `phone-after-unlock-1.0.17b.log` |
| 14 Sep 15:01, 15:17 | 1.0.18 attempts | dumpsys still 1.0.17 | install TIMEOUT x2 | - | `phone-install-1.0.18.log`, `-1.0.18b.log` |
| 14 Sep 16:52-18:35 | **1.0.18** | `phone_certify.py` precheck reads dumpsys: "apk: 1.0.18" | role cert and judge flow on hosted | role 9/9; judge 9/12 (16:52), 11/12 (17:26), 11/12 (18:27), **12/12 (18:35)** | `phone-certify.log`, `phone-e2e-role.log`, `phone-e2e-certify2.log`, `final-demo-run.log`, `phone-e2e-final-b.log` (= `phone-e2e-certify.log`) |
| 16 Sep 18:15-21:35 | 1.0.18 | HANDOFF §17 | true-human trip TRP-56A4FF2D: phone received in ≤ 9 s, accepted, started, completed pickup, delivered | passed; the moving leg was SIMULATED GPS on the driver web, not the phone | `phone-cert-*.png`, HANDOFF §17 |
| 18 Sep | none | HANDOFF §19, §20: "the physical phone was not used" | - | - | HANDOFF lines 1898, 2031 |
| 20 Sep 02:57-03:06 | 1.0.20 | matrix item 1: `versionName=1.0.20` | 33-item matrix, no trip | 15 PASS / 6 PARTIAL / 12 BLOCKED; screens 14 PASS / 1 FAIL (Day/Night wording) | `phone-matrix/matrix.json`, `screens.json` |
| 20 Sep 06:19-06:32 | **1.0.21** | dumpsys in `phone_matrix66.py:33` and `phone_reverify.py:38` | 66-item matrix + 20-item reverify, no trip | see section 3 | `phone-1.0.21/matrix66.json`, `reverify.json`, `merged.json` |
| 20 Sep 09:47-10:29 | 1.0.22 attempt | NO read-back | streamed `adb install` "failed to install" (10:13); installer prompt still waiting for a tap at 09:50, 10:05, 10:09, 10:12, 10:15; `pm-install.log` = "Success" (10:29), with no dumpsys line after it | installation UNPROVEN, 0 functional steps | `phone-1.0.22/*` |
| 30 Sep 07:42 | - | `adb devices -l` (adb 37.0.1, `.runtime/tools/platform-tools/`) | read-only | **no device attached** | `repro/routing-android/adb-devices-2026-09-30.txt` |

A ColorOS `pm install` "Success" is not proof. The installer parks sessions as
committed-but-unconfirmed until someone taps "Continue installation" (`.runtime/phone-install.sh:8-11`, which
records 1.0.11 coming back over 1.0.12 that way on 13 Sep). Later project docs agree that 1.0.22 was not installed:

- `docs/REDESIGN_CERTIFICATION.md:199` says `APK_1.0.22_INSTALLED = NO - needs a physical tap`.
- `docs/POST_DEMO_CHANGE_INVENTORY.md:815` says "never installed on a device".

## 3. APK 1.0.21 matrix, recounted

| source | PASS | PARTIAL | BLOCKED | FAIL |
|---|---:|---:|---:|---:|
| `matrix66.json` (first pass) | 27 | 10 | 28 | 1 (57 reconnect) |
| `reverify.json` (20 items re-judged) | 17 | 1 | 2 | 0 |
| `merged.json` (as recorded) | 38 | 0 | 28 | 0 |
| **merged, honestly** | **37** | **1** | **28** | **0** |

Item 43, "local fallback assistant", is PARTIAL in both the first pass and the reverify. It still
reads PASS in `merged.json`, so that one upgrade has no evidence behind it.

The 28 BLOCKED items are 16-23, 26-29, 31-36, 39-41, 46-47 and 62-66. Almost all of them were
blocked because no trip was dispatched ("HOSTED_DEMO_TRIP_REQUIRED"). Items 46-47 were blocked
because the AI keys are not configured on Render.

The 1.0.21 and 1.0.22 bundles both point at `https://ner-intelligence.onrender.com`
(PROVEN_BY_SOURCE: string in `assets/index.android.bundle`). That is the hosted build at migration
0012, not the local 0013-0016 backend.

## 4. Latest integrated build vs the newest APK (PROVEN_BY_SOURCE)

- `driver-app/app.json` (working tree) reads `version 1.0.22`, `versionCode 22`. At HEAD it reads
  `1.0.18` / `18` (commit 0b89ddf). `driver-app/android/app/build.gradle:95-96` reads
  `versionCode 22` / `"1.0.22"`.
- Newest APK: `.runtime/rasta-driver-1.0.22-local.apk`, built 2026-09-20 09:22:46, 32,335,369 bytes,
  sha256 `bc1a33de...a42d90c`. This matches `rollback.txt` (`apk-inventory-2026-09-30.txt`).
- Nothing is newer: no APK or AAB anywhere in the repo is newer than that file.
- 90 driver-app files were modified after the 1.0.22 build: 14 on 26 Sep, 9 on 27 Sep, 50 on 28 Sep
  (redesign) and 17 on 29 Sep (productionization). `git status` shows 100 driver-app entries: 60
  modified and 40 untracked.
- **VersionCode collision risk.** A build from today's tree would also be versionCode 22, while a
  different binary with that code already exists. `POST_DEMO_CHANGE_INVENTORY.md:815` already
  recommends 1.0.23.

## 5. Antigravity claims, reproduced

| ID | Audit claim | Result | Evidence |
|---|---|---|---|
| PA-1 | "Physical Android GPS capture ... never been run on a real handset" (`ANTIGRAVITY_CLAIM_MATRIX.md` row 6, citing `AGENTS.md:194`) | NOT_REPRODUCED (false for builds ≤ 1.0.21) | Section 2. Real fixes are logged on the phone: "GPS · ±15 m", "±22 m", "Network · ±64 m" (`phone-e2e-*.log`). `AGENTS.md:194` was last committed 9 Sep (66f3008), 3 days before the first phone run, and never updated. |
| PA-2 | "Only simulated in node/web/emulator" | NOT_REPRODUCED | No emulator artefact found. All device screenshots are 1264x2780 from one handset. |
| PA-3 | `PHYSICAL_ANDROID = NOT_CERTIFIED` | REPRODUCED for the latest integrated build | Sections 1 and 4 |
| PA-4 | "Never tested over real 4G/5G" | PARTIAL | 13 Sep `04-network-switch: PASS` with `phone-compat-04-mobile-data.png`, on a remote-demo build. Nothing for 1.0.21 and later. |
| PA-5 | "Background battery Doze mode survival is uncertified" | REPRODUCED | No Doze test anywhere. Background Android notification FAIL in all 3 gate-2 runs. The app uses foreground location only (`isAndroidBackgroundLocationEnabled: false`, `driver-app/app.json:33`). |

## 6. Project-side overclaims to correct (P3, docs only; not edited by this lane)

1. `docs/DAY2_TASK1_FINAL_REPORT.md:151,217` says "certified ... 14-18 Sep" and "last certified 18 Sep
   (HANDOFF §20)". HANDOFF §19 and §20 both say the phone was not used. The last physical trip-flow
   evidence is 16 Sep, on 1.0.18.
2. `docs/REDESIGN_VISUAL_CERTIFICATION.md:26,55,1125,1198` says "`adb` is not installed". adb 37.0.1
   is at `.runtime/tools/platform-tools/adb.exe` and ran today. The real blocker is that no device is
   attached.
3. `phone-1.0.21/merged.json` item 43 is PASS, but its evidence says PARTIAL (section 3).
4. `phone-1.0.22/rollback.txt` calls 1.0.21 the "certified build". Its core flow was never exercised.
5. `docs/submission/build_final_deck.py:403,429` shows "PHYSICAL ANDROID · CERTIFIED" and "12/12
   judge-flow steps certified on a physical phone" with no version. Both hold only for 1.0.18 (and
   the remote-demo L build), and neither is the current build.
6. `AGENTS.md:194` errs the other way: it is stale and says "never run on a real handset".
7. The 13-14 Sep judge harness passed step 06/07 with a "new road 2449.6 km" reroute, because the
   phone's real position was in another state. Those PASSes prove the flow ran, not that the route
   was right. The backend later refused such reroutes (commit 7b56554, ROUTE_VALIDATION_FAILED).

## 7. What would close the gate (not executed)

1. Build from the integration commit, not the dirty tree, as **1.0.23 / versionCode 23**. Record the
   sha256 and signer, and run the bundle secret scan.
2. The backend under test must run the same integrated code. Hosted is at 0012 and hosted migration
   is blocked, so use either an HTTPS staging API at head or `adb reverse` to a local API at head.
   Never ship a release build on the cleartext `lan-demo` profile.
3. Install with `.runtime/phone-install.sh` (on-device `pm install` with the prompt watcher). The
   dumpsys read-back must say `versionName=1.0.23` before any step counts.
4. With a dispatched trip, rerun `phone_matrix66.py` and the judge flow, so the 28 lifecycle items
   are no longer BLOCKED. Include at least one moving leg with real GPS, then background/Doze, then
   mobile data.
5. PASS means every core lifecycle item PASSes on the version read back from the device. Store the
   evidence in `.runtime/evidence/phone-1.0.23/`.
