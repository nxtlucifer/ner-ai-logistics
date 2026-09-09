# Release staging manifest

Generated for the reviewed release commit onto `main`. Everything listed under
**Staged** was added by explicit path. `git add -A` and `git add .` were not used.

No secret value appears in this file.

**Staged: 430 paths.**

| Category | Count |
| :--- | ---: |
| APPLICATION_SOURCE | 149 |
| TEST | 90 |
| DOCUMENTATION | 126 |
| TOOLING | 34 |
| MIGRATION | 15 |
| DEPLOY_CONFIG | 16 |
| **TOTAL** | **430** |

---

## Staged paths

### DEPLOY_CONFIG (16)

*Why required:* Build, ignore or hosting descriptor a deployment reads.

```
.easignore
.gitignore
backend/Dockerfile
backend/render.yaml
driver-app/app.json
driver-app/eas.json
driver-app/package-lock.json
driver-app/package.json
driver-app/tsconfig.json
manager-web/netlify.toml
manager-web/package-lock.json
manager-web/package.json
manager-web/vercel.json
scripts/demo/.gitignore
scripts/demo/package-lock.json
scripts/demo/package.json
```

### MIGRATION (15)

*Why required:* Schema change or RPC the running code requires. Omitting it breaks a fresh deploy.

```
backend/alembic/versions/0007_route_review_authorizations.py
backend/alembic/versions/0008_trip_driver_acceptance.py
backend/alembic/versions/0009_route_maneuvers.py
supabase/migrations/20260907120000_app_authz_core.sql
supabase/migrations/20260907120100_data_api_grants_rls.sql
supabase/migrations/20260907120150_auth_identity_mapping.sql
supabase/migrations/20260907120200_guarded_transitions.sql
supabase/migrations/20260907120400_rpc_surface.sql
supabase/migrations/20260907120500_start_trip.sql
supabase/migrations/20260907120600_driver_trip_payload.sql
supabase/migrations/20260907120700_stops_and_completion.sql
supabase/migrations/20260907120800_manager_plan_trip.sql
supabase/migrations/20260907120900_manager_dispatch_trip.sql
supabase/migrations/20260909100000_manager_select_route.sql
supabase/rollback/rollback_supabase_migration.sql
```

### APPLICATION_SOURCE (149)

*Why required:* Runtime code for the backend, manager, driver app or Supabase Edge Functions.

```
backend/app/api/ai.py
backend/app/api/driver.py
backend/app/api/geocoding.py
backend/app/api/trips.py
backend/app/auth/verifier.py
backend/app/core/config.py
backend/app/core/permissions.py
backend/app/db/session.py
backend/app/domain/ai_prompts.py
backend/app/domain/fuel_model.py
backend/app/domain/landslide.py
backend/app/domain/monsoon_risk.py
backend/app/domain/places.py
backend/app/domain/reroute.py
backend/app/domain/road_memory.py
backend/app/domain/route_eligibility.py
backend/app/domain/route_progress.py
backend/app/domain/route_recommendation.py
backend/app/domain/route_risk.py
backend/app/domain/routing.py
backend/app/domain/trip_state.py
backend/app/main.py
backend/app/models/__init__.py
backend/app/models/enums.py
backend/app/models/identity.py
backend/app/models/operations.py
backend/app/models/review.py
backend/app/schemas/domain.py
backend/app/services/assignments.py
backend/app/services/driver_trips.py
backend/app/services/drivers.py
backend/app/services/gemini.py
backend/app/services/geocoding.py
backend/app/services/inference.py
backend/app/services/landslide/__init__.py
backend/app/services/landslide/base.py
backend/app/services/navigation.py
backend/app/services/offline_package.py
backend/app/services/places/__init__.py
backend/app/services/places/data/corridor_snapshot.json
backend/app/services/places/snapshot.py
backend/app/services/reroute.py
backend/app/services/route_recommendation.py
backend/app/services/route_review.py
backend/app/services/route_risk.py
backend/app/services/routes.py
backend/app/services/routing/base.py
backend/app/services/routing/osrm.py
backend/app/services/trips.py
driver-app/App.tsx
driver-app/app.config.js
driver-app/plugins/withDemoNetworkSecurity.js
driver-app/scripts/check-release-config.mjs
driver-app/src/ai/AiPanel.tsx
driver-app/src/ai/useLocalAi.ts
driver-app/src/api/client.ts
driver-app/src/api/intelligence.ts
driver-app/src/api/releaseConfig.d.ts
driver-app/src/api/releaseConfig.mjs
driver-app/src/api/supabaseApi.ts
driver-app/src/api/supabaseClient.ts
driver-app/src/assistant/assistant.ts
driver-app/src/auth/authErrors.ts
driver-app/src/auth/phone.ts
driver-app/src/auth/tokenStore.ts
driver-app/src/components/icons.tsx
driver-app/src/components/ui.tsx
driver-app/src/i18n/AppLanguageProvider.tsx
driver-app/src/i18n/appLanguage.ts
driver-app/src/i18n/language.ts
driver-app/src/i18n/reasonCodes.json
driver-app/src/i18n/reasonCodes.ts
driver-app/src/map/DriverRouteMap.d.ts
driver-app/src/map/DriverRouteMap.native.tsx
driver-app/src/map/DriverRouteMap.web.tsx
driver-app/src/map/NextTurnPanel.tsx
driver-app/src/map/geo.ts
driver-app/src/map/maneuvers.ts
driver-app/src/map/routeDisplay.ts
driver-app/src/map/speech.ts
driver-app/src/map/types.ts
driver-app/src/map/useGuidanceClock.ts
driver-app/src/map/useNavigationPackage.ts
driver-app/src/map/useRouteGeometry.ts
driver-app/src/map/useSpokenGuidance.ts
driver-app/src/navigation.ts
driver-app/src/offline/packageStore.ts
driver-app/src/phrasebook/offlineTranslator.ts
driver-app/src/phrasebook/phrases.json
driver-app/src/phrasebook/phrases.ts
driver-app/src/places/usePlaces.ts
driver-app/src/raw-modules.d.ts
driver-app/src/safety/breakStore.ts
driver-app/src/safety/breaks.ts
driver-app/src/safety/guide.json
driver-app/src/safety/guide.ts
driver-app/src/screens/AssistantScreen.tsx
driver-app/src/screens/LoginScreen.tsx
driver-app/src/screens/MapScreen.tsx
driver-app/src/screens/PhrasebookScreen.tsx
driver-app/src/screens/SafetyScreen.tsx
driver-app/src/screens/TranslateBox.tsx
driver-app/src/screens/TripScreen.tsx
driver-app/src/screens/progressFormat.ts
driver-app/src/theme.ts
driver-app/src/tracking/queueStorage.ts
driver-app/src/tracking/queueStore.ts
driver-app/src/tracking/tracker.ts
driver-app/src/tracking/useLocationTracking.ts
driver-app/src/trip/TripProvider.tsx
driver-app/vitest.config.ts
i18n/reason_codes.json
manager-web/index.html
manager-web/src/App.tsx
manager-web/src/api/client.ts
manager-web/src/api/intelligence.ts
manager-web/src/api/supabaseClient.ts
manager-web/src/api/supabaseManagerApi.ts
manager-web/src/auth/AuthProvider.tsx
manager-web/src/components/AddressPicker.tsx
manager-web/src/components/FleetKpiBar.tsx
manager-web/src/components/FleetMap.tsx
manager-web/src/components/RouteRiskComparison.tsx
manager-web/src/components/TripRouteReview.tsx
manager-web/src/components/TruckContextDrawer.tsx
manager-web/src/components/track.ts
manager-web/src/components/ui.tsx
manager-web/src/hooks/useFleetPoll.ts
manager-web/src/i18n/reasonCodes.json
manager-web/src/i18n/reasonCodes.ts
manager-web/src/index.css
manager-web/src/main.tsx
manager-web/src/pages/AssignmentsPage.tsx
manager-web/src/pages/DriversPage.tsx
manager-web/src/pages/FleetPage.tsx
manager-web/src/pages/LoginPage.tsx
manager-web/src/pages/ReviewPage.tsx
manager-web/src/pages/SystemPage.tsx
manager-web/src/pages/TripsPage.tsx
manager-web/src/pages/TrucksPage.tsx
manager-web/src/utils/googleMapsUrl.ts
supabase/functions/_shared/routeProgress.fixtures.json
supabase/functions/_shared/routeProgress.ts
supabase/functions/driver-trip/handler.ts
supabase/functions/driver-trip/index.ts
supabase/functions/gemini-ai/handler.ts
supabase/functions/gemini-ai/index.ts
supabase/functions/resolve-map-link/handler.ts
supabase/functions/resolve-map-link/index.ts
```

### TEST (90)

*Why required:* Automated test asserting behaviour committed in this change. 994 backend / 156 manager / 517 driver all pass.

```
backend/tests/conftest.py
backend/tests/db_target.py
backend/tests/factories.py
backend/tests/test_api_fleet.py
backend/tests/test_cleanup_ownership.py
backend/tests/test_concurrency.py
backend/tests/test_config.py
backend/tests/test_db_target_guard.py
backend/tests/test_fuel_model.py
backend/tests/test_gemini_ai.py
backend/tests/test_geocoding.py
backend/tests/test_golden_path_e2e.py
backend/tests/test_inference.py
backend/tests/test_landslide_provider.py
backend/tests/test_landslide_route_risk.py
backend/tests/test_monsoon_risk.py
backend/tests/test_navigation_package.py
backend/tests/test_offline_package.py
backend/tests/test_places_snapshot.py
backend/tests/test_reason_code_coverage.py
backend/tests/test_reroute.py
backend/tests/test_reroute_api.py
backend/tests/test_road_memory.py
backend/tests/test_route_api.py
backend/tests/test_route_current_assignment.py
backend/tests/test_route_eligibility.py
backend/tests/test_route_progress.py
backend/tests/test_route_recommendation.py
backend/tests/test_route_recommendation_api.py
backend/tests/test_route_review_authorization.py
backend/tests/test_route_risk.py
backend/tests/test_route_risk_api.py
backend/tests/test_route_selection_hazard_api.py
backend/tests/test_routing.py
backend/tests/test_schema_drift.py
backend/tests/test_select_route_rpc.py
backend/tests/test_selection_enforcement_contract.py
backend/tests/test_stale_selection_interleaving.py
backend/tests/test_start_race_epq.py
backend/tests/test_supabase_verifier.py
backend/tests/test_trip_acceptance.py
backend/tests/test_trip_execution.py
backend/tests/test_trip_multiplicity_invariant.py
driver-app/src/ai/AiPanel.test.tsx
driver-app/src/api/driverTripHandler.test.ts
driver-app/src/api/geminiAiHandler.test.ts
driver-app/src/api/releaseConfig.test.ts
driver-app/src/api/routeProgress.parity.test.ts
driver-app/src/api/supabaseApi.test.ts
driver-app/src/api/supabaseClient.test.ts
driver-app/src/api/transport.test.ts
driver-app/src/assistant/assistant.test.ts
driver-app/src/auth/authErrors.test.ts
driver-app/src/auth/phone.test.ts
driver-app/src/i18n/appLanguage.test.ts
driver-app/src/i18n/language.test.ts
driver-app/src/i18n/reasonCodes.test.ts
driver-app/src/map/geo.test.ts
driver-app/src/map/maneuvers.test.ts
driver-app/src/map/navigationLifecycle.test.tsx
driver-app/src/map/routeDisplay.test.ts
driver-app/src/map/speech.test.ts
driver-app/src/navigation.test.ts
driver-app/src/networkSecurity.test.ts
driver-app/src/offline/packageStore.test.ts
driver-app/src/phrasebook/offlineTranslator.test.ts
driver-app/src/phrasebook/phrases.test.ts
driver-app/src/safety/breakStore.test.ts
driver-app/src/safety/breaks.test.ts
driver-app/src/safety/guide.test.ts
driver-app/src/screens/AssistantScreen.test.tsx
driver-app/src/screens/LoginScreen.test.tsx
driver-app/src/screens/MapScreen.test.tsx
driver-app/src/screens/TranslateBox.test.tsx
driver-app/src/screens/progressFormat.test.ts
driver-app/src/tracking/queueStorage.test.ts
driver-app/src/tracking/queueStore.test.ts
driver-app/src/trip/TripProvider.test.tsx
manager-web/src/api/intelligence.test.ts
manager-web/src/api/resolveMapLink.test.ts
manager-web/src/api/supabaseManagerApi.test.ts
manager-web/src/components/AddressPicker.test.tsx
manager-web/src/components/FleetMap.worker.build.test.ts
manager-web/src/components/TripRouteReview.test.tsx
manager-web/src/components/track.test.ts
manager-web/src/pages/DriversPage.test.tsx
manager-web/src/pages/FleetPage.test.tsx
manager-web/src/pages/TripsPage.test.tsx
manager-web/src/utils/googleMapsUrl.test.ts
scripts/test_synthetic_auth.py
```

### TOOLING (34)

*Why required:* Repeatable operator or verification script referenced by the docs.

```
backend/scripts/certify_dispatchability.py
backend/scripts/create_user.py
backend/scripts/demo_account.py
backend/scripts/demo_scenario.py
backend/scripts/ls9_scenario_server.py
backend/scripts/ls9_scenarios/clear.json
backend/scripts/ls9_scenarios/closure.json
backend/scripts/ls9_scenarios/high.json
backend/scripts/migration_manifest.py
backend/scripts/rls_harness.py
backend/scripts/route_progress_fixtures.py
backend/scripts/terrain_seed.py
scripts/Simulate-Journey.cmd
scripts/Start-Demo.cmd
scripts/Start-Demo.ps1
scripts/Stop-Demo.cmd
scripts/Stop-Demo.ps1
scripts/apk/verify_apk.py
scripts/apply_plan_trip.py
scripts/apply_supabase_migrations.py
scripts/backup_hosted_db.py
scripts/check_auth_schema.py
scripts/check_enums.py
scripts/check_identity_status.py
scripts/check_state.py
scripts/check_triggers.py
scripts/demo/simulate-journey.js
scripts/demo/terrain-capture.js
scripts/demo/terrain-journey.js
scripts/demo/terrain-viewport-matrix.js
scripts/inspect_columns.py
scripts/inspect_recalc.py
scripts/verify_alembic_upgrade.py
scripts/verify_rpcs.py
```

### DOCUMENTATION (126)

*Why required:* Architecture, deployment, security or submission documentation.

```
AGENTS.md
CLAUDE.md
README.md
design-system/ner-fleet-intelligence/MASTER.md
docs/AI_MODELS.md
docs/API_CONTRACTS.md
docs/CLAUDE_ATOMICITY_PASS.md
docs/CLAUDE_FINAL_QA.md
docs/CLAUDE_HANDOFF.md
docs/CLAUDE_HOSTING_READINESS.md
docs/CLAUDE_RELEASE_PREFLIGHT.md
docs/CLAUDE_UI_PASS.md
docs/CLAUDE_UI_PASS_2.md
docs/CROSS_CLIENT_CONTRACT_MATRIX.md
docs/DEMO.md
docs/DEMO_PLAN.md
docs/DEPLOYMENT_ENV_MATRIX.md
docs/DRIVER_UI_AUDIT.md
docs/ENGINEERING_PROGRESS.md
docs/FINAL_MASTER_CHECKPOINT.md
docs/HOSTED_INTELLIGENCE_PLANE.md
docs/INCIDENT_2026-09-06_SHARED_DB_WRITE.md
docs/INTERACTION_CERTIFICATION.md
docs/MANAGER_UI_AUDIT.md
docs/NAVIGATION_ARCHITECTURE.md
docs/OVERNIGHT_PROGRESS.md
docs/PREMIUM_NAVIGATION_RISK_RESEARCH.md
docs/ROAD_MEMORY.md
docs/SECURITY.md
docs/SIH26002_FINAL_PROGRESS.md
docs/SIH26002_GAP_MATRIX.md
docs/SUPABASE_MIGRATION_MISSION.md
docs/TERRAIN_COMMAND_MISSION.md
docs/TESTING_STRATEGY.md
docs/UX_NAV_AI_RESEARCH.md
docs/migrations/PENDING_reroute_decision_events.sql
docs/migrations/PENDING_road_memory_tables.sql
docs/migrations/PENDING_route_review_authorizations.sql
docs/submission/NER_AI_Logistics_SIH2026.pdf
docs/submission/NER_AI_Logistics_SIH2026.pptx
docs/submission/README.md
docs/submission/evidence/01-granted-fresh-on-route.png
docs/submission/evidence/02-countdown-approaching.png
docs/submission/evidence/03-countdown-after-maneuver.png
docs/submission/evidence/04-off-route-hold.png
docs/submission/evidence/05-off-route-recovered.png
docs/submission/evidence/06-emergency-panel.png
docs/submission/evidence/21-countdown-220.png
docs/submission/evidence/22-countdown-120.png
docs/submission/evidence/23-countdown-40.png
docs/submission/evidence/24-emergency-dialler-intercepted.png
docs/submission/evidence/25-replan-preserves-assignment.png
docs/submission/evidence/26-approved-replacement-switched.png
docs/submission/evidence/27-stale-hold.png
docs/submission/evidence/28-contact-lost-hold.png
docs/submission/evidence/29-permission-revoked-after-live-fix.png
docs/submission/evidence/31-baseline-live.png
docs/submission/evidence/32-approved-replacement-driver-side.png
docs/submission/evidence/33-contact-lost-hold.png
docs/submission/evidence/34-permission-revoked-after-live-fix.png
docs/submission/evidence/41-recheck-baseline-live.png
docs/submission/evidence/42-contact-lost-hold-FIXED.png
docs/submission/evidence/43-permission-revoked-after-live-fix-FIXED.png
docs/submission/evidence/README.md
docs/submission/evidence/capture-log-2.json
docs/submission/evidence/capture-log-3.json
docs/submission/evidence/capture-log-4.json
docs/submission/evidence/capture-log.json
docs/submission/existing.pptx
docs/submission/slides/Slide1.PNG
docs/submission/slides/Slide2.PNG
docs/submission/slides/Slide3.PNG
docs/submission/slides/Slide4.PNG
docs/submission/slides/Slide5.PNG
docs/submission/slides/Slide6.PNG
docs/submission/template.pptx
docs/terrain-command/evidence/after-browser-issues.json
docs/terrain-command/evidence/after-driver-assistant.png
docs/terrain-command/evidence/after-driver-home.png
docs/terrain-command/evidence/after-driver-login.png
docs/terrain-command/evidence/after-driver-map.png
docs/terrain-command/evidence/after-driver-safety.png
docs/terrain-command/evidence/after-driver-translator.png
docs/terrain-command/evidence/after-manager-detail.png
docs/terrain-command/evidence/after-manager-dispatch.png
docs/terrain-command/evidence/after-manager-fleet.png
docs/terrain-command/evidence/after-manager-login.png
docs/terrain-command/evidence/after-manager-route-review-controls.png
docs/terrain-command/evidence/before-browser-issues.json
docs/terrain-command/evidence/before-driver-assistant.png
docs/terrain-command/evidence/before-driver-home.png
docs/terrain-command/evidence/before-driver-login.png
docs/terrain-command/evidence/before-driver-map.png
docs/terrain-command/evidence/before-driver-safety.png
docs/terrain-command/evidence/before-driver-translator.png
docs/terrain-command/evidence/before-manager-dispatch.png
docs/terrain-command/evidence/before-manager-fleet.png
docs/terrain-command/evidence/before-manager-login.png
docs/terrain-command/evidence/iteration1-browser-issues.json
docs/terrain-command/evidence/iteration1-driver-assistant.png
docs/terrain-command/evidence/iteration1-driver-home.png
docs/terrain-command/evidence/iteration1-driver-login.png
docs/terrain-command/evidence/iteration1-driver-map.png
docs/terrain-command/evidence/iteration1-driver-safety.png
docs/terrain-command/evidence/iteration1-driver-translator.png
docs/terrain-command/evidence/iteration1-manager-detail.png
docs/terrain-command/evidence/iteration1-manager-dispatch.png
docs/terrain-command/evidence/iteration1-manager-fleet.png
docs/terrain-command/evidence/iteration1-manager-login.png
docs/terrain-command/evidence/journey-01-addresses.png
docs/terrain-command/evidence/journey-02-route-preview.png
docs/terrain-command/evidence/journey-03-reviewed-incomplete-evidence.png
docs/terrain-command/evidence/journey-04-assigned-route.png
docs/terrain-command/evidence/journey-05-driver-request.png
docs/terrain-command/evidence/journey-06-navigation-preview.png
docs/terrain-command/evidence/journey-07-guidance-location.png
docs/terrain-command/evidence/journey-08-roadside.png
docs/terrain-command/evidence/journey-09-offline.png
docs/terrain-command/evidence/journey-10-manager-active-trip.png
docs/terrain-command/evidence/journey-prior-failure-web-signout-on-reload.png
docs/terrain-command/evidence/journey-report.json
docs/terrain-command/evidence/viewport-dispatch-1366x768-2.png
docs/terrain-command/evidence/viewport-dispatch-1440x900-1.png
docs/terrain-command/evidence/viewport-fleet-1440x900-1-5.png
docs/terrain-command/evidence/viewport-fleet-mobile-390-1.png
docs/terrain-command/evidence/viewport-matrix.json
```
---

## Excluded, and why

Every class below is now matched by the **tracked** root `.gitignore`, except
where noted. The previous protection for `.runtime/` lived only in
`.git/info/exclude`, which guards one clone on one machine.

| Excluded path class | Count | Reason |
| :--- | ---: | :--- |
| `.runtime/` | — | Local isolated Postgres cluster: server binaries, cluster data, `pgpass.txt`, and **9 built APKs**. Large binaries and credentials. |
| `.claude/` | 29 | Assistant session state, caches, KPI files keyed to the operator's username, and **two verbatim conversation transcripts** under `chat-exports/`. |
| `.semgrep/` | 2 | `guardian.yml` holds a **live Semgrep OAuth token**. Publishing it would leak a working credential. |
| `supabase/.temp/` | 9 | Written by `supabase link`. Carries the linked project ref and the session pooler URL — infrastructure detail. |
| Prompt / conversation dumps | 6 | `full_user_request*.txt`, `full_user_request_untruncated.txt`, `latest_user_prompt*.txt`, `mission_prompt*.txt`, `scratch_user_prompt.txt`. Briefing scratch, not project source. |
| `.artibot/`, `.context-os/`, `.coworker/`, `.codex/`, `.thumbgate/`, `.agentic-security/`, `memory/.dreams/` | 10 | Per-machine agent and CLI scratch, including a SQLite task database and a 380 KB repo graph. |
| `docs/submission/2026-09-09/` | 3 | **Not ignored — deliberately unstaged.** These PDFs and the PPTX were still being written by another process during this commit (timestamps 09:45 and 09:52). Committing a file mid-write risks a truncated binary. Stage them once generation has finished. |

### Not excluded, and deliberately so

- `driver-app/eas.json` carries the Supabase **anon** JWT (`"role":"anon"`,
  decoded and checked). Anon keys are public by design and are already inlined
  into every shipped client bundle; RLS is the control, not key secrecy. It is
  not a leak. It does expose the project ref publicly, so RLS coverage is now
  load-bearing — `backend/scripts/rls_harness.py` is the thing that must keep
  passing.
- Private LAN addresses appear throughout `driver-app/src/api/releaseConfig*`
  and the docs. Every occurrence is a **test asserting such an address is
  rejected**, or a post-mortem of the vc3 APK that shipped one. `eas.json`
  itself carries no LAN address.
- `CLAUDE.md` is committed as project instructions alongside the existing
  tracked `AGENTS.md`.
