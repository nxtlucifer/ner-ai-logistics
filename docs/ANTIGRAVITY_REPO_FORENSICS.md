# RASTA AI — REPOSITORY FORENSICS & INTEGRITY AUDIT
**Auditor:** Antigravity Independent Review Organization  
**Date:** 29 September 2026  
**Repository Path:** `d:\Projects\ner-ai-logistics`  
**Execution Environment:** Windows 11 (AMD64), PowerShell 5.1 / 7.x, Python 3.11.9, Node v24.13.3  

---

## 1. REPOSITORY METADATA & GIT FORENSICS

```text
pwd:                        D:\Projects\ner-ai-logistics
git remote -v:              origin  https://github.com/nxtlucifer/ner-ai-logistics.git (fetch)
                            origin  https://github.com/nxtlucifer/ner-ai-logistics.git (push)
git branch --show-current:  main
git rev-parse HEAD:         5b5e4749c6da8046a6217caff9f19626a270930d
git rev-parse origin/main:  e4043ce4fd283cedcede73c8dd1afc5eb8108445
Merge Base:                 5b5e4749c6da8046a6217caff9f19626a270930d
Divergence:                 Local HEAD is 0 ahead, 1 behind origin/main (Commit e4043ce)
Worktree Status:            DIRTY (201 modified tracked files, 542 untracked files)
```

### Git Branch Inventory
- `* main` (Active local branch at commit `5b5e474`)
- `+ post-demo-integration` (Local branch containing commits `c60900b`, `1c14764`, `6a542ed`, `3f8c4b0`, `2b3f1e5`)
- `+ release/close-releases-resources` (Local branch containing upstream commit `e4043ce`)
- `remotes/origin/main` (Remote head at `e4043ce`: *"fix: release trip resources on close and refresh availability"*)
- `remotes/origin/claude/pdf-master-mission-gohuj5` (Feature branch)
- `remotes/origin/claude/rasta-ai-sih26002-deck-e8xagd` (Presentation deck branch)
- `remotes/origin/claude/video-navigation-impl-ejdxwo` (Video demonstration branch)

---

## 2. THE UPSTREAM COMMIT & WORKTREE DIVERGENCE

Local `HEAD` sits on commit `5b5e474` (*"Certification: what the hosted checks actually found"*).
Remote `origin/main` has 1 commit not present in local HEAD: `e4043ce` (*"fix: release trip resources on close and refresh availability"*).

Inspection of `git diff HEAD..origin/main` reveals `e4043ce` touched:
- `backend/app/services/trips.py`
- `backend/app/services/driver_trips.py`
- `backend/tests/test_trip_execution.py`
- `manager-web/src/api/client.ts`
- `manager-web/src/pages/TripsPage.tsx`

**Critical Finding:** The local dirty worktree incorporates the exact logic of `e4043ce` (including the `inFlight` request coalescing in `manager-web/src/api/client.ts` and resource release logic in `backend/app/services/trips.py`), but these modifications were never committed to local `main`.

---

## 3. DIRTY & UNTRACKED FILE CLASSIFICATION

Total Untracked Files: 542  
Total Modified Tracked Files: 201  

### Category Summary
| Classification | Description | Count | Action Required |
|---|---|---|---|
| **KEEP** | Critical features, tests, migrations, security controls | 114 | Commit and merge to `main` |
| **REWORK** | Fragile test assertions, incomplete docs, broken configs | 18 | Address before release |
| **DROP** | Redundant artifacts, duplicate scripts | 22 | Clean up safely |
| **GENERATED** | Video renders, test artifacts, build outputs | 460 | Add to `.gitignore` |
| **SENSITIVE** | Configuration files, keys, credentials | 4 | Quarantine and move to env vars |
| **UNKNOWN** | Unreferenced scripts or experiments | 125 | Review before archiving |

---

### Detailed File Classification

#### SENSITIVE (Immediate Attention Required)
1. `driver-app/eas.json` (TRACKED): Contains `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and plain HTTP LAN URL `http://192.168.1.6:8010`. **Status: SENSITIVE.**
2. `backend/.env` (UNTRACKED / EXCLUDED): Contains local PostgreSQL test password and placeholder/test secrets. Must remain git-ignored. **Status: SENSITIVE.**
3. `backend/.env.mission1.backup`: Untracked backup file containing configuration. **Status: SENSITIVE / DROP.**
4. `manager-web/.env.remote-demo`: Untracked file pointing to hosted endpoints. **Status: SENSITIVE.**

#### KEEP (Uncommitted Production Code & Migrations)
1. `backend/alembic/versions/0013_state_district_inbox.py`: State/District notifications inbox schema. **Status: KEEP.**
2. `backend/alembic/versions/0014_shipment_state_geography.py`: Shipment state and district foreign keys. **Status: KEEP.**
3. `backend/alembic/versions/0015_instance_coordination.py`: Multi-worker coordination leases and rate limit windows. **Status: KEEP.**
4. `backend/alembic/versions/0016_geography_boundaries.py`: Country, state, and district boundary geometry schemas. **Status: KEEP.**
5. `backend/app/core/rate_limit.py`: `client_address` reverse-proxy parsing and `FixedWindowLimiter`. **Status: KEEP.**
6. `backend/app/main.py`: Security headers middleware (`nosniff`, `DENY`, `frame-ancestors`, HSTS). **Status: KEEP.**
7. `backend/tests/test_migration_0016.py`, `test_state_district_scope.py`, `test_trip_release_after_delivery.py`: Regression test suites. **Status: KEEP.**

#### REWORK (Needs Adjustment Before Commit)
1. `manager-web/src/components/ScenicImage.test.tsx`: Fails due to label mismatch ("Image credits" vs "Photo credits"). **Status: REWORK.**
2. `manager-web/src/pages/OverviewPage.test.tsx`: Fails on "Image credits" button query. **Status: REWORK.**
3. `manager-web/src/pages/scopeSelector.test.tsx`: Fails on "Image credits" modal dialog query. **Status: REWORK.**
4. `manager-web/src/pages/tripExport.ts`: Vulnerable to CSV Formula Injection in `csvCell()`. **Status: REWORK.**
5. `backend/scripts/import_soi_boundaries.py`: Unrun script awaiting missing Survey of India shapefiles. **Status: REWORK.**

#### GENERATED (Bloat & Video Assets to Ignore)
1. `rasta-company-video/` (400+ files): Contains MP4 video segments (`RASTA_AI_Company_Presentation_10min_1080p.mp4`), extracted frames (`00001.png` - `00072.png`), audio recordings (`indicvoice`), and temporary ffmpeg downloads. Must NOT be committed to git. **Status: GENERATED.**
2. `manager-web/dist-cert/`: Static distribution build artifact. **Status: GENERATED.**
3. `docs/PRODUCTION_READINESS_AUDIT_2026.pdf`: Compiled PDF binary. **Status: GENERATED.**
4. `docs/submission/day2/task1/api-results.json`: Ephemeral test result json. **Status: GENERATED.**

---

## 4. CONTAMINATION & ABANDONED CODE AUDIT

- **Pranay AI Trader Contamination:** Scanned entire repository for references to "Pranay", "trader", "stock", "crypto", "trading".
  - Result: Only a single reference exists in `docs/SUPABASE_MIGRATION_MISSION.md:789` (`patelpranay2296@gmail.com` as the administrative Supabase connector email).
  - No foreign algorithmic trading code, stock data, or cryptocurrency dependencies exist in the repository.
- **Abandoned Code / Dead Branches:**
  - Branch `post-demo-integration` has 5 unmerged commits (`c60900b` through `2b3f1e5`) that implement critical safety and PII fixes (e.g. removing SOS local dispatch promises, sending Gemini API key via headers, route approval focus).
  - These commits have NOT been merged into `main`.

---

## 5. REPOSITORY FORENSICS VERDICT

The repository is structurally sound and free from third-party contamination, but exhibits **severe branch and worktree drift**:
1. Local `main` is missing remote commit `e4043ce`.
2. Crucial production features (Migrations 0013-0016, Security Headers, Multi-Instance Leases) exist only as untracked/dirty working copy files.
3. Over 400 multimedia presentation files pollute the untracked file inventory.
