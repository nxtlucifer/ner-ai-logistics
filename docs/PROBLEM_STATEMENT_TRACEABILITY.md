# SIH26002 problem-statement traceability

**Owner:** product-constitution lane (VP Product)
**Written:** 26 September 2026. **Revised:** 26 September 2026, after review.
**Baselines:** hosted = `e4043ce` (origin/main, DB revision 0012). Local = `5b5e474` plus the uncommitted working tree (DB revision 0013). Local main is one commit behind `e4043ce`; see `docs/POST_DEMO_STATE.md`.

This document maps each requirement in the official SIH26002 problem statement to the user it serves, the RASTA AI feature that answers it, the code that implements it, the tests that cover it, and its status on the hosted build and in the local tree. It is the reference for deciding what to build next and what to say to judges.

## How to read this document

Every claim carries exactly one evidence label:

| Label | Meaning |
| --- | --- |
| PROVEN_BY_TEST | A test run by this lane on 26 Sep 2026 gave the result stated (section 4 lists the runs). |
| PROVEN_BY_RUNTIME | Observed by running code. This lane ran the real modules in one local process (section 4, run E). It observed no hosted runtime. |
| PROVEN_BY_DATABASE | Read from a database. Not used in this document. |
| PROVEN_BY_SOURCE | Read in a file at the path and line given. |
| PROVEN_BY_WEB | Read from the URL given, fetched by this lane. |
| INFERRED | A conclusion drawn from evidence. It is not a fact. |
| NOT_VERIFIED | Not checked. |
| BLOCKED | Could not be checked. |

Status values:

| Status | Meaning |
| --- | --- |
| DEPLOYED_ON_HOSTED | The requirement's wording is met in full by code that is in `e4043ce` (checked with `git show e4043ce:<path>`). It does not mean this lane saw it run on Render. Hosted code that meets only part of the wording is PARTIAL. |
| LOCAL_ONLY | Only in the uncommitted working tree. It reaches hosted only through the 38-commit plan in `docs/POST_DEMO_CHANGE_INVENTORY.md`. |
| PARTIAL | Part of the requirement is built. The row says which part and where it lives. |
| NOT_BUILT | Nothing in the repository meets the requirement. |
| BLOCKED | Cannot be built without an outside dependency. |
| NOT_VERIFIED | Whether the requirement is met cannot be decided from evidence this lane is allowed to collect. The row says why. |

UNKNOWN is not SAFE, and a requirement is never marked met because nothing contradicts it.

Each "RASTA feature" line in section 3.2 is PROVEN_BY_SOURCE through the Implementation paths listed directly under it, unless the line carries its own label. Numbers in feature lines (11 factors, 15 minutes, 6 hours, 2007 to 2017) carry their own file and line.

Line numbers: when a claim is about the hosted build, the line cited is the line in `e4043ce`, marked "at e4043ce". All other line numbers are in the working tree.

---

## 1. Where the requirement text comes from

### 1.1 Search order and result

| Step | Where | What was found | Used as the requirement source? |
| --- | --- | --- | --- |
| a | Repository files (`git grep` for "SIH26002" and the title, 33 tracked files) | Only the title, organisation and the team's own descriptions of the problem. `docs/SIH26002_GAP_MATRIX.md:3-4` and `docs/PRODUCT_VISION.md:3-5` give the title. The Day 1 system design says its core problem statement was "sharpened from the original brief" but does not quote the brief. [PROVEN_BY_SOURCE docs/submission/day1/RASTA_AI_SIH2026_DAY1_TASK1_SYSTEM_DESIGN.md:74] | No. These are the team's own words. |
| b | PDFs and PPTX files in the repository and in `C:/Users/patel/Downloads` with SIH, 26002, Idea_Submission, RASTA or "SIH 2026" in the name | The two idea-submission PDFs (text extracted with `pdftotext` and `pypdf`, both already installed) carry title-level identification (PS ID, title, "Theme - Smart Automation", "PS Category - Software") followed by the team's own pitch (problem, proposed solution, USP). Neither contains the official description text: "geo-tagged", "logistics bottlenecks" and "district-wise connectivity" do not appear. [PROVEN_BY_SOURCE C:/Users/patel/Downloads/NER_AI_Logistics_SIH26002_Idea_Submission.pdf and NER_AI_Logistics_SIH26002_Idea_Submission_.pdf] "Internal SIH 2026 Schedule.pdf" is the college event timetable. A scan of the slide XML of 22 matching PPTX files (Python `zipfile`; `python-pptx` is not installed and was not installed) found no official description text. A Downloads review note paraphrases the official page second-hand. [PROVEN_BY_SOURCE C:/Users/patel/Downloads/SIH26002_Progress_Review_and_Next_Mission.md:34] | No. Title-level identification plus the team's own pitch, or second-hand. |
| c | Official SIH site | `https://sih.gov.in/sih2026PS` returns the full SIH26002 entry: background, description with items a to h, and expected solution. [PROVEN_BY_WEB https://sih.gov.in/sih2026PS] | **Yes. This is the requirement source.** |

The official page was fetched five times with WebFetch, each time asking for a different part of the entry. WebFetch passes the page through a summarising model, so the wording below has not been checked byte for byte against the HTML. Across the five fetches the content matched itself and matched the unofficial mirror `https://sih2026.vuce.in/ps/SIH26002`, which labels itself as not affiliated with SIH and names sih.gov.in as its source. [PROVEN_BY_WEB https://sih2026.vuce.in/ps/SIH26002]

### 1.2 The official entry, in summary

The requirements below paraphrase the official text. The official page is the authority; this summary is not.

- **Identity.** PS SIH26002, from the Ministry of Development of North Eastern Region (MDoNER). Category Software. Theme **Transportation & Logistics**. Idea submission deadline 30 September 2026. [PROVEN_BY_WEB https://sih.gov.in/sih2026PS]
- **Background.** The NER faces logistics and accessibility problems because of difficult terrain, extreme weather, limited transport links and road disruptions from landslides, floods and infrastructure gaps. Medicines, food, construction materials and agricultural produce reach remote districts late, which causes shortages, higher costs and interrupted public services. No integrated system gives real-time logistics visibility, route accessibility status, predictive disruption alerts and optimised transport planning for the region. [PROVEN_BY_WEB https://sih.gov.in/sih2026PS]
- **Description.** The platform should use AI, ML, GIS mapping, weather data and real-time field inputs to monitor transport networks and improve the movement of essential goods. It lists eight capabilities (a to h), which become PS-01 to PS-13 below. [PROVEN_BY_WEB https://sih.gov.in/sih2026PS]
- **Expected solution.** A scalable AI-based software platform with GIS and real-time analytics: a route prediction and optimisation engine, a GIS accessibility dashboard, GPS vehicle tracking, real-time alerts, a mobile and web application for field-level reporting and monitoring, integration with weather APIs, transport databases and government monitoring systems, and cloud infrastructure with secure data management and offline support. [PROVEN_BY_WEB https://sih.gov.in/sih2026PS]

The one direct quotation in this document is item f. It asks that field officials and local authorities be able to upload "geo-tagged updates, photographs, and incident reports" from remote locations. [PROVEN_BY_WEB https://sih.gov.in/sih2026PS]

### 1.3 A discrepancy the team must resolve

The official page lists the theme as **Transportation & Logistics**. [PROVEN_BY_WEB https://sih.gov.in/sih2026PS] The repository and the submitted title page say **Smart Automation**. [PROVEN_BY_SOURCE README.md:5] `SUBMISSION_README.md` already says the theme should be confirmed against the portal. [PROVEN_BY_SOURCE SUBMISSION_README.md:3] Which theme the team registered under on the portal has not been checked. [NOT_VERIFIED]

---

## 2. Requirements

| ID | Requirement (paraphrased) | Official clause |
| --- | --- | --- |
| PS-01 | Monitor the accessibility of roads, bridges and transport in real time, across districts and remote locations | Description a |
| PS-02 | Predict route disruptions from landslides, floods, heavy rain, road damage or traffic congestion | Description b |
| PS-03 | Suggest alternate routes, based on AI | Description c |
| PS-04 | Estimate travel delays | Description c |
| PS-05 | Track, by GPS, vehicles carrying essential commodities | Description d |
| PS-06 | Send automated alerts for blocked roads, inaccessible regions, delayed deliveries and high-risk corridors | Description e |
| PS-07 | Let field officials and local authorities upload geo-tagged updates, photos and incident reports from remote locations | Description f |
| PS-08 | Central dashboard: connectivity status by district | Description g |
| PS-09 | Central dashboard: logistics bottlenecks and supply-chain gaps | Description g |
| PS-10 | Central dashboard: accessibility routes for emergencies and disasters | Description g |
| PS-11 | Central dashboard: real-time movement and delivery status of essential supplies | Description g |
| PS-12 | Multilingual notifications | Description h |
| PS-13 | Offline data synchronisation for low-network areas | Description h, Expected solution |
| PS-14 | Integration with weather APIs | Expected solution, Description |
| PS-15 | Integration with transport databases and government monitoring systems | Expected solution |
| PS-16 | Cloud infrastructure with secure data management | Expected solution |
| PS-17 | Mobile and web application for field-level reporting and monitoring | Expected solution |
| PS-18 | AI/ML route prediction and optimisation engine | Expected solution, Description |
| PS-19 | GIS-enabled accessibility monitoring dashboard | Expected solution |
| PS-20 | A scalable platform | Expected solution |
| PS-21 | Focus on essential goods (medicines, food, construction materials, agricultural produce) reaching remote districts | Background, Description d |

Users named or implied by the official text: MDoNER and state or district officials (dashboards, PS-08 to PS-11); field officials and local authorities (PS-07); transport operators and dispatchers (PS-03 to PS-06); drivers of vehicles carrying supplies (PS-05, PS-12, PS-13); receiving districts (PS-06, PS-11). The text does not name drivers or fleet managers. That reading is ours. [INFERRED]

---

## 3. Traceability matrix

### 3.1 Summary

| ID | Status | Hosted (`e4043ce`) | Local only |
| --- | --- | --- | --- |
| PS-01 | PARTIAL | Assessment per route and per moving trip | District framing (0013) |
| PS-02 | PARTIAL | Rule-based exposure and context from 5 evidence sources | — |
| PS-03 | PARTIAL | Rule-based alternates; a human approves every change. Not AI-based | — |
| PS-04 | PARTIAL | Duration differences between candidates, remaining time at planned pace | Delay notices to districts |
| PS-05 | DEPLOYED_ON_HOSTED | GPS ingest, fleet map, observed track | — |
| PS-06 | PARTIAL | Driver push alerts, route decision bands, emergencies | Manager inbox, district delay notices |
| PS-07 | NOT_BUILT | — | Driver stop request with category and location (not officials, no photo) |
| PS-08 | NOT_BUILT | — | Trip counts per district (not connectivity) |
| PS-09 | NOT_BUILT | — | Counts of trips needing attention |
| PS-10 | PARTIAL | Refusal rule (no closure input, live or simulated, reaches it); real backup corridor in offline package | — |
| PS-11 | PARTIAL | Live fleet map and trip status | Scoped overview, reports |
| PS-12 | PARTIAL | Driver UI and reason codes in several languages; server pushes in English | Localised background notices |
| PS-13 | PARTIAL | GPS queue that survives restarts, offline trip package | — |
| PS-14 | DEPLOYED_ON_HOSTED | Open-Meteo and MET Norway | — |
| PS-15 | PARTIAL | NDMA SACHET CAP feed only | — |
| PS-16 | PARTIAL | Render and Supabase, with open security findings | Several security fixes |
| PS-17 | PARTIAL | Web console and driver app for monitoring; no field reporting | — |
| PS-18 | PARTIAL | Rule-based engines; the LLM only writes text | — |
| PS-19 | PARTIAL | MapLibre fleet map with route evidence. Not a district accessibility map | Terrain and 3D map modes |
| PS-20 | NOT_VERIFIED | One uvicorn worker on the Render free plan | — |
| PS-21 | PARTIAL | Cargo items and priority; no commodity class | District of origin and destination |

### 3.2 Detail per requirement

Test names are `file::function` as found with grep. Section 4 says which ones this lane ran.

#### PS-01 Real-time accessibility monitoring of roads, bridges and transport across districts
- **Users:** dispatchers; district and state officials.
- **RASTA feature:** a route risk assessment with 11 factors [PROVEN_BY_SOURCE backend/app/domain/route_risk.py:91-101], run when a route is planned. A route watch re-scores the road ahead of every moving trip.
- **Implementation:** `backend/app/domain/route_risk.py:91-108`, `backend/app/services/route_risk.py`, `backend/app/services/route_watch.py:161` (`run_tick`), `backend/app/api/trips.py:1406` at e4043ce (route risk; 1412 locally), `backend/app/api/driver.py:914` at e4043ce (driver route risk; 933 locally), `manager-web/src/components/TripRouteReview.tsx`.
- **Tests:** `backend/tests/test_route_risk.py::test_absent_datasets_are_named_not_omitted`, `backend/tests/test_route_watch.py::test_run_tick_scores_moving_trips_and_pushes_once`, `manager-web/src/components/TripRouteReview.test.tsx` ("before conditions are checked there is no Use this route at all …").
- **Status: PARTIAL.**
  - Roads are assessed only along a trip's routes. Nothing monitors a district's or a region's road network as a whole. [PROVEN_BY_SOURCE backend/app/services/route_watch.py:161]
  - Road quality and truck restrictions are always reported as unavailable. [PROVEN_BY_SOURCE backend/app/domain/route_risk.py:103-108]
  - Bridges are not modelled. A grep of `backend/app` for "bridge" finds only comments. [PROVEN_BY_SOURCE backend/app/domain/routing.py:237]
  - The route watch is enabled in the hosted blueprint. [PROVEN_BY_SOURCE render.yaml:98 (at e4043ce)]

#### PS-02 Predict route disruptions (landslide, flood, heavy rain, road damage, congestion)
- **Users:** dispatchers; drivers.
- **RASTA feature:** evidence classes that are kept apart: weather forecast, GloFAS river discharge context, historical landslide exposure (NASA Global Landslide Catalog snapshot, 2007 to 2017 [PROVEN_BY_SOURCE backend/data/landslides/PROVENANCE.md:18]), NDMA official warnings, and a traffic estimate from the fleet's own GPS.
- **Implementation:** `backend/app/domain/weather.py`, `backend/app/domain/flood.py`, `backend/app/domain/landslide.py`, `backend/app/services/landslide/history.py:36`, `backend/app/domain/warnings.py`, `backend/app/domain/traffic.py`.
- **Tests:** `backend/tests/test_flood_context.py::test_elevated_when_any_cell_runs_at_the_ratio_or_the_forecast_does`, `backend/tests/test_landslide_route_risk.py::test_provider_failure_never_reports_low_risk`, `backend/tests/test_traffic.py::test_one_vehicle_is_not_traffic`, `backend/tests/test_official_warnings.py::test_the_engine_scores_an_active_warning_and_reports_absence_honestly`.
- **Status: PARTIAL.**
  - The engine reports current exposure and context using published rules. It does not forecast disruptions. [PROVEN_BY_SOURCE backend/app/domain/monsoon_risk.py:3]
  - No source of current landslides or road closures is connected. The provider always answers NOT_CONFIGURED. [PROVEN_BY_SOURCE backend/app/services/landslide/base.py:124-131]
  - Road damage exists only as a domain state machine (`road_memory.py`, `monsoon_risk.py`). No service or API imports it. [PROVEN_BY_SOURCE backend/app/domain/road_memory.py:11]
  - Congestion is measured from the fleet's own GPS and needs at least two trucks on a segment. [PROVEN_BY_TEST backend/tests/test_traffic.py::test_one_vehicle_is_not_traffic]
  - An experimental landslide model exists but is not deployed. [PROVEN_BY_SOURCE backend/app/domain/intelligence_inventory.py:27]

#### PS-03 AI-based alternate route suggestions
- **Users:** dispatchers; drivers.
- **RASTA feature:** route alternatives from OSRM and an explainable comparison between them. The manager starts a reroute; the driver can ask for one. Both need human approval.
- **Implementation:** `backend/app/domain/route_recommendation.py`, `backend/app/domain/route_eligibility.py`, `backend/app/domain/reroute.py`, `backend/app/services/reroute.py`, `backend/app/api/trips.py:1477` (recommendation) and `:1583` (reroute) at e4043ce, `backend/app/api/driver.py:1147` (driver reroute) at e4043ce, `manager-web/src/components/RouteCandidateCards.tsx`.
- **Tests:** `backend/tests/test_route_recommendation.py::test_a_clearly_safer_backup_is_recommended_with_its_cost`, `backend/tests/test_reroute_api.py::test_a_bad_road_with_a_better_one_beside_it_proposes`, `backend/tests/test_driver_reroute_api.py::test_plans_from_the_reported_position_and_leaves_the_trip_on_its_road`, `manager-web/src/pages/FleetPage.test.tsx` ("does not reroute until the dispatcher accepts").
- **Status: PARTIAL.** Alternate routes are deployed; the "AI-based" part of the wording is not met.
  - The recommendation and reroute endpoints are in `e4043ce`. [PROVEN_BY_SOURCE backend/app/api/trips.py:1583 (at e4043ce)]
  - The comparison is a published rule, not AI. The module says so and a test checks it. [PROVEN_BY_SOURCE backend/app/domain/route_recommendation.py:6]
  - Many NER corridors have only one sensible road. On those, the system alerts without proposing an alternative. [PROVEN_BY_TEST backend/tests/test_reroute.py::test_a_deteriorated_single_corridor_alerts_without_proposing]

#### PS-04 Estimated travel delays
- **Users:** dispatchers; receiving districts.
- **RASTA feature:** each candidate shows how many minutes and kilometres it differs from the primary route. The driver sees "remaining at planned pace".
- **Implementation:** `backend/app/domain/route_recommendation.py:141` (`duration_delta_min`), `backend/app/domain/route_progress.py:14`. Local only: `backend/app/services/trips.py:1030` (`announce_delay`).
- **Tests:** `backend/tests/test_route_progress.py::test_travelled_and_remaining_always_sum_to_the_route`, `backend/tests/test_delay_notifications.py::test_an_eta_the_system_does_not_hold_is_null_not_invented`.
- **Status: PARTIAL.**
  - No delay estimate reflects a disruption. Durations are the routing provider's free-flow values, and the product deliberately publishes no ETA. [PROVEN_BY_SOURCE backend/app/domain/route_progress.py:14]
  - A trip becomes DELAYED only when a manager puts it on hold. Nothing detects delays automatically. [PROVEN_BY_SOURCE backend/app/services/trips.py:1039]
  - Delay notices to districts are not in `e4043ce`. [PROVEN_BY_SOURCE backend/app/services/trips.py:1030]

#### PS-05 GPS tracking of vehicles carrying essential commodities
- **Users:** dispatchers; officials.
- **RASTA feature:** the driver app sends GPS in batches and keeps unsent points on the phone. The manager sees a fleet map and the observed track.
- **Implementation:** `backend/app/api/driver.py:1351` (`/me/location`) at e4043ce, `backend/app/services/telemetry.py`, `backend/app/api/trips.py:1739` (`/api/fleet/active`) and `:1781` (track) at e4043ce, `driver-app/src/tracking/tracker.ts`, `driver-app/src/tracking/queueStorage.ts`, `manager-web/src/pages/FleetPage.tsx`, `manager-web/src/components/track.ts`.
- **Tests:** `backend/tests/test_telemetry.py::test_collection_stops_when_the_trip_completes`, `driver-app/src/tracking/queueStorage.test.ts` ("survives the store object being recreated, which is what a restart is"), `manager-web/src/components/track.test.ts` ("sorts an out-of-order upload into travel order").
- **Status: DEPLOYED_ON_HOSTED.** [PROVEN_BY_SOURCE backend/app/api/driver.py:1351 (at e4043ce)]
- The "essential commodity" qualifier is covered under PS-21.

#### PS-06 Automated alerts for blocked roads, inaccessible regions, delayed deliveries and high-risk corridors
- **Users:** drivers; dispatchers; receiving districts.
- **RASTA feature:**
  - Push alerts to the driver: trip assigned, reroute approved, hold and review, official warning, weather worsening, landslide exposure ahead.
  - Route decision bands for the manager.
  - Fleet Sentinel emergencies.
  - Local only: a notification inbox for managers and districts.
- **Implementation:** `backend/app/services/notify.py`, `backend/app/services/route_watch.py:117-125`, `backend/app/services/sentinel.py`, `backend/app/api/emergencies.py`. Local only: `backend/app/services/notifications.py`, `backend/app/api/notifications.py`, `manager-web/src/pages/NotificationsPage.tsx`.
- **Tests:** `backend/tests/test_notify.py::test_dispatch_pushes_trip_assigned_once`, `backend/tests/test_route_watch.py::test_changes_push_only_material_worsening_once`, `backend/tests/test_emergency_api.py::test_driver_check_in_need_help_escalates`, `backend/tests/test_notifications.py::test_both_district_managers_are_recipients`, `backend/tests/test_notification_lifecycle.py::test_completing_the_trip_tells_the_districts`.
- **Status: PARTIAL.**
  - **Blocked roads:** no live source reports a closure. The landslide and closure provider answers NOT_CONFIGURED. [PROVEN_BY_SOURCE backend/app/services/landslide/base.py:124-131]
  - The labelled DEMO SIMULATION scenario ROAD_INCIDENT adds the code LANDSLIDE_OFFICIAL_ROAD_CLOSURE and 75 points to one route's score. It is synthetic input, not a closure report. [PROVEN_BY_SOURCE backend/app/services/simulation.py:37]
  - The route watch scores the raised risk, so a simulated closure can produce a driver push or a hold-and-review decision. [PROVEN_BY_SOURCE backend/app/services/route_watch.py:149] The route comparison scores it too, so it can produce a reroute proposal. [PROVEN_BY_SOURCE backend/app/services/route_recommendation.py:147]
  - A simulated closure does not make the road refused. The route stays REQUIRES_REVIEW, not REJECTED (see PS-10). [PROVEN_BY_RUNTIME section 4 run E]
  - **Inaccessible regions:** no alert exists at region level. [INFERRED]
  - **Delayed deliveries:** alerts go to districts only in the local tree. [PROVEN_BY_SOURCE backend/app/services/trips.py:1030]
  - **High-risk corridors:** alerts exist on hosted, as driver pushes and manager decision bands. [PROVEN_BY_SOURCE backend/app/services/route_watch.py:117]
  - **Fleet Sentinel:** the scheduled sweep defaults to off, and `render.yaml` at `e4043ce` does not set `SENTINEL_SCHEDULER_ENABLED`. [PROVEN_BY_SOURCE backend/app/core/config.py:281 (at e4043ce; 322 locally)]
  - Whether automatic Sentinel escalation runs on hosted depends on a Render dashboard setting this lane did not see. [NOT_VERIFIED]

#### PS-07 Field officials upload geo-tagged updates, photos and incident reports
- **Users:** field officials; local authorities.
- **RASTA feature:** none for officials.
  - The nearest feature, local only, is the driver's stop request. It carries a category (including ROAD_BLOCKED), a reason and an optional location, but no photo.
  - The upload endpoint accepts six kinds: PROFILE_PHOTO, TRUCK_VERIFICATION, TRUCK_PHOTO, DEMO_REFERENCE, DRIVER_DOCUMENT and TRUCK_DOCUMENT. None of them is an incident report. [PROVEN_BY_SOURCE backend/app/api/files.py:54 (same line at e4043ce)]
  - `road_memory.py` models observed road states but is not connected to any API.
- **Implementation:** local only: `backend/app/api/driver.py:395` (`StopRequest`), `backend/app/services/driver_trips.py:736` (`STOP_CATEGORIES`). Hosted: `backend/app/api/files.py:54` (upload kinds).
- **Tests:** `backend/tests/test_driver_stop_request.py::test_records_the_reason_and_leaves_the_trip_running`, `backend/tests/test_road_memory.py::test_no_elapsed_time_reaches_verified_open_from_anything`.
- **Status: NOT_BUILT.** No official or authority role can file a geo-tagged incident report with a photo, and no upload kind is an incident report. [PROVEN_BY_SOURCE backend/app/api/files.py:54]
- A ROAD_BLOCKED stop request does not change any route assessment. [INFERRED]

#### PS-08 Dashboard: connectivity status by district
- **Users:** MDoNER, state and district officials.
- **RASTA feature:** local only. A dashboard scoped to the caller's role counts trips under way, trips needing attention, and incoming and outgoing trips per district. A States page shows which districts are configured.
- **Implementation:** `backend/app/api/dashboard.py:65-100`, `backend/app/api/org.py`, `backend/app/core/scope.py`, `manager-web/src/pages/OverviewPage.tsx`, `manager-web/src/pages/StatesPage.tsx`, migration `backend/alembic/versions/0013_state_district_inbox.py`.
- **Tests:** `backend/tests/test_dashboard.py::test_counts_only_trips_touching_their_district`, `backend/tests/test_state_district_scope.py::test_districts_are_not_seeded_and_that_is_deliberate`, `manager-web/src/pages/OverviewPage.test.tsx` ("explains the gap instead of showing an empty table").
- **Status: NOT_BUILT** (connectivity).
  - What exists locally counts trips, not road connectivity. [PROVEN_BY_SOURCE backend/app/api/dashboard.py:73-77]
  - Districts are deliberately not seeded. The district data is a candidate with no verified official seed. [PROVEN_BY_TEST backend/tests/test_state_district_scope.py::test_districts_are_not_seeded_and_that_is_deliberate]

#### PS-09 Dashboard: logistics bottlenecks and supply-chain gaps
- **Users:** officials; operations staff.
- **RASTA feature:** local only. Counts of trips needing attention and trips awaiting a route. Fleet traffic exists, but only inside route assessment.
- **Implementation:** `backend/app/api/dashboard.py:60-62`, `backend/app/domain/traffic.py`.
- **Tests:** `backend/tests/test_dashboard.py` (see PS-08), `backend/tests/test_traffic.py::test_fresh_probes_from_two_trucks_grade_the_segment`.
- **Status: NOT_BUILT.** No view shows bottlenecks or supply-chain gaps across trips or districts. [PROVEN_BY_SOURCE backend/app/api/dashboard.py:20-26]

#### PS-10 Dashboard: accessibility routes for emergencies and disasters
- **Users:** officials; dispatchers.
- **RASTA feature:**
  - Route eligibility reads only the route's landslide assessment. [PROVEN_BY_SOURCE backend/app/services/route_risk.py:340] The same rule is derived wherever a scored route travels. [PROVEN_BY_SOURCE backend/app/domain/route_recommendation.py:111]
  - It refuses a route only when that assessment is CRITICAL. [PROVEN_BY_SOURCE backend/app/domain/route_eligibility.py:98] No score, duration saving or cargo priority may override a refusal. [PROVEN_BY_SOURCE backend/app/domain/route_eligibility.py:20-21]
  - Routes with UNKNOWN or HIGH landslide evidence need review. [PROVEN_BY_SOURCE backend/app/domain/route_eligibility.py:106-108]
  - The offline package carries a real backup corridor when one exists.
- **Implementation:** `backend/app/domain/route_eligibility.py`, `backend/app/services/route_review.py`, `backend/app/services/offline_package.py`.
- **Tests:** `backend/tests/test_route_eligibility.py::test_a_closed_shortcut_loses_to_a_longer_open_route`, `backend/tests/test_offline_package.py::test_a_real_backup_corridor_is_carried_too`, `backend/tests/test_route_review_authorization.py::test_a_closed_road_can_never_be_authorized`.
- **Status: PARTIAL.**
  - The refusal rule works in tests when a landslide assessment built from a synthetic official closure report is supplied. [PROVEN_BY_TEST backend/tests/test_route_eligibility.py::test_a_closed_shortcut_loses_to_a_longer_open_route]
  - No source, live or simulated, reaches the refusal gate. The landslide provider answers NOT_CONFIGURED, so every route's landslide assessment is UNKNOWN and every route is REQUIRES_REVIEW. [PROVEN_BY_SOURCE backend/app/domain/route_eligibility.py:47-49]
  - The DEMO SIMULATION does not change this. `simulation.apply` replaces the score, band, reason codes and components, and leaves the landslide assessment untouched. [PROVEN_BY_SOURCE backend/app/services/simulation.py:100]
  - In a local run of the real modules, the ROAD_INCIDENT scenario moved the band from LOW to HIGH (score 10 to 85), while eligibility was REQUIRES_REVIEW before and after and the route was not rejected. [PROVEN_BY_RUNTIME section 4 run E]
  - No dashboard view of emergency or disaster routes exists. [INFERRED]
- **Demo risk:** during a simulated closure, do not say that the closed road is refused. The route stays REQUIRES_REVIEW. What changes is the score, the band, the alerts and possibly a reroute proposal. [PROVEN_BY_RUNTIME section 4 run E]

#### PS-11 Dashboard: real-time movement and delivery status of essential supplies
- **Users:** officials; dispatchers; receiving districts.
- **RASTA feature:** live fleet map, trip statuses, observed track, and the freshness of each driver's location. Local only: a scoped overview and a reports page.
- **Implementation:** `manager-web/src/pages/FleetPage.tsx`, `manager-web/src/pages/TripsPage.tsx`, `backend/app/api/trips.py:1739` at e4043ce. Local only: `manager-web/src/pages/OverviewPage.tsx`, `manager-web/src/pages/ReportsPage.tsx`.
- **Tests:** `manager-web/src/pages/FleetPage.test.tsx` ("separates trip status, driver location and route evidence instead of one STALE badge"), `backend/tests/test_golden_path_e2e.py::test_the_whole_journey`.
- **Status: PARTIAL.**
  - Movement and delivery status are on hosted. [PROVEN_BY_SOURCE backend/app/api/trips.py:1739 (at e4043ce)]
  - "Essential supplies" cannot be filtered, because cargo type is free text (PS-21). [PROVEN_BY_SOURCE backend/app/models/operations.py:151 (at e4043ce; 166 locally)]

#### PS-12 Multilingual notifications
- **Users:** drivers; district staff.
- **RASTA feature:**
  - Driver UI with full drafts in hi, gu, as and bn, and core-key drafts in other scheduled languages. None has been reviewed by native speakers.
  - Reason-code catalogue and safety guide in en, hi and as.
  - Gemini assistant told to answer in the driver's chosen language (local change).
  - Local only: background notices in the chosen language.
- **Implementation:** `driver-app/src/i18n/appLanguage.ts:5`, `driver-app/src/i18n/moreLanguages.ts:6`, `driver-app/src/i18n/reasonCodes.ts:36`, `backend/app/domain/ai_prompts.py` (modified locally), `driver-app/src/trip/notificationLanguage.test.ts` (local).
- **Tests:** `driver-app/src/i18n/coverage.test.ts` ("has hi/gu/as/bn for every phrase the screens use"; fails on the current tree, see below), `driver-app/src/i18n/reasonCodes.test.ts` ("gives a different string per language"), `driver-app/src/trip/notificationLanguage.test.ts`, `backend/tests/test_ai_language.py::test_a_non_english_choice_pins_the_answer_and_its_script`.
- **Status: PARTIAL.**
  - Push texts written by the server are English literals. [PROVEN_BY_SOURCE backend/app/services/route_watch.py:117-125]
  - The translation drafts have not been reviewed by native speakers. [PROVEN_BY_SOURCE driver-app/src/i18n/moreLanguages.ts:6]
  - The phrase coverage test fails on the current tree: the login screen's "10-digit mobile number" has no hi, gu, as or bn draft. [PROVEN_BY_TEST driver-app/src/i18n/coverage.test.ts, section 4 run C]
  - `driver-app/src/screens/LoginScreen.tsx` was last modified at 18:09:15 IST on 26 Sep, after this document was first saved at 18:06 IST. [PROVEN_BY_SOURCE driver-app/src/screens/LoginScreen.tsx (file modification time)]
  - The fix that localises the phone's own notices is local only (plan commit 13). [PROVEN_BY_SOURCE docs/POST_DEMO_CHANGE_INVENTORY.md:219]

#### PS-13 Offline data synchronisation for low-network areas
- **Users:** drivers.
- **RASTA feature:**
  - A GPS queue on the phone that survives restarts and replays without duplicates.
  - An offline trip package that counts as fresh for 6 hours. [PROVEN_BY_SOURCE driver-app/src/offline/packageStore.ts:45]
  - A cached navigation package.
  - An offline phrasebook and safety guide.
- **Implementation:** `driver-app/src/tracking/queueStore.ts`, `driver-app/src/tracking/queueStorage.ts`, `driver-app/src/offline/packageStore.ts:45`, `backend/app/api/driver.py:632` at e4043ce (651 locally), `backend/app/services/offline_package.py`.
- **Tests:** `driver-app/src/tracking/queueStorage.test.ts` ("produces a durable store, not the in-memory fallback"), `driver-app/src/offline/packageStore.test.ts` ("round-trips a package"), `backend/tests/test_offline_package.py::test_the_risk_snapshot_is_timestamped_not_presented_as_live`.
- **Status: PARTIAL.**
  - GPS is synced from phone to server. A grep of `driver-app/src` for an outbox or action queue finds none, so trip actions taken offline (arrive, complete, check-in) are not queued. [INFERRED]
  - The durable event queue on the `pdf-master` branch is a cycle-1 finding, not re-checked by this lane. That finding says the queue is not scoped to a trip, strands events at INCIDENT, retries permanent 4xx errors forever, and is not on hosted. [NOT_VERIFIED]

#### PS-14 Integration with weather APIs
- **RASTA feature:** Open-Meteo, with MET Norway as fallback [PROVEN_BY_SOURCE backend/app/services/weather/open_meteo.py:78]. Readings carry their freshness, and a missing reading stays missing.
- **Implementation:** `backend/app/services/weather/open_meteo.py`, `backend/app/domain/weather.py`.
- **Tests:** `backend/tests/test_weather.py::test_absent_measurements_stay_none_and_never_become_zero`, `backend/tests/test_route_risk.py::test_no_observations_marks_weather_unavailable_not_calm`.
- **Status: DEPLOYED_ON_HOSTED.** The hosted blueprint enables weather. [PROVEN_BY_SOURCE render.yaml:88 (at e4043ce)]

#### PS-15 Integration with transport databases and government monitoring systems
- **RASTA feature:** the NDMA SACHET CAP feed, polled and matched to corridor districts by name.
- **Implementation:** `backend/app/domain/warnings.py`, `backend/app/services/warnings.py`.
- **Tests:** `backend/tests/test_official_warnings.py::test_matching_is_by_district_and_expiry_and_says_when_nothing_matches`.
- **Status: PARTIAL.**
  - The warnings poll is enabled on hosted. [PROVEN_BY_SOURCE render.yaml:96 (at e4043ce)]
  - No transport database is integrated: no NHAI or PWD road status, and no vehicle registry. OpenStreetMap is used for places and routing only. [INFERRED]
  - The CAP polygon URL returns 403, so matching uses district names only. [PROVEN_BY_SOURCE backend/app/domain/warnings.py:16]

#### PS-16 Cloud infrastructure with secure data management
- **RASTA feature:** a FastAPI container on Render and PostgreSQL on Supabase. Passwords use Argon2id [PROVEN_BY_SOURCE backend/app/core/security.py:5]. Access tokens expire after 15 minutes [PROVEN_BY_SOURCE backend/app/core/config.py:93 (at e4043ce)]. Refresh tokens rotate [PROVEN_BY_SOURCE backend/app/services/auth.py:155 (at e4043ce)]. Permissions are checked on the server. Row-level security is enabled.
- **Implementation:** `render.yaml`, `backend/Dockerfile`, `backend/app/core/`, `docs/SECURITY.md`.
- **Tests:** `backend/tests/test_rls_boundary.py::test_rls_enabled_on_every_application_table`, `backend/tests/test_security_assessment.py` (local).
- **Status: PARTIAL.** Security findings are open on hosted `e4043ce` and are fixed only locally or in later plan commits:
  - The trusted-proxy fix SEC-006 lands only at plan commit 31. [PROVEN_BY_SOURCE docs/POST_DEMO_CHANGE_INVENTORY.md:126]
  - Subresource Integrity on the Leaflet assets lands only at plan commit 16. [PROVEN_BY_SOURCE docs/POST_DEMO_CHANGE_INVENTORY.md:222]
  - Gemini WARNING logs contain prompt text on `e4043ce`. This is carried over from the cycle-1 findings and was not re-checked here. [NOT_VERIFIED]
  - 12 public images on origin/main show the demo driver's phone number, and the owner has not yet decided what to do. This is also carried over from cycle 1. [NOT_VERIFIED]

#### PS-17 Mobile and web application for field-level reporting and monitoring
- **RASTA feature:** a manager web console (React and Vite) and a driver app (Android APK and web build).
- **Status: PARTIAL.** Monitoring is built. Field-level reporting is not (see PS-07). [INFERRED]

#### PS-18 AI/ML route prediction and optimisation engine
- **RASTA feature:**
  - Rule-based engines: route risk, eligibility, recommendation, reroute, traffic, and the fuel model.
  - An online LLM (Gemini, with OpenRouter as fallback) is used only to word answers and translations.
  - The experimental landslide logistic regression is not deployed.
- **Implementation:** `backend/app/domain/intelligence_inventory.py:25-60`, `backend/app/services/gemini.py`, `backend/app/api/ai.py`.
- **Tests:** `backend/tests/test_provider_health.py::test_inventory_counts_no_local_ml_and_no_local_llm`, `backend/tests/test_gemini_ai.py::test_navigation_authority_refusal`.
- **Status: PARTIAL.** No trained model makes a routing decision in production. [PROVEN_BY_SOURCE backend/app/domain/intelligence_inventory.py:27]
- This is deliberate, and it is the gap judges are most likely to probe, because "AI" is the first word of the title. [INFERRED]

#### PS-19 GIS-enabled accessibility monitoring dashboard
- **RASTA feature:** a MapLibre fleet map with planned route, observed track, and route evidence. Local only: 2D, terrain and 3D modes, and a roadside-services layer (plan commit 23).
- **Implementation:** `manager-web/src/components/FleetMap.tsx`, `manager-web/package.json:18` (maplibre-gl). Local only: `manager-web/src/components/NorthEastMap.tsx`, `TerrainScene.tsx`, `mapTerrain.ts`.
- **Tests:** `manager-web/src/pages/FleetPage.test.tsx` ("calls the observed track a track, never a route").
- **Status: PARTIAL.**
  - A MapLibre fleet and route map is on hosted. [PROVEN_BY_SOURCE manager-web/package.json:18 (same at e4043ce)]
  - It is not a map of district accessibility, so the "accessibility monitoring" part of the wording is not met (see PS-08). [INFERRED]

#### PS-20 Scalable platform
- **Status: NOT_VERIFIED.** The hosted backend runs one uvicorn worker on the Render free plan. [PROVEN_BY_SOURCE backend/Dockerfile:53]
- No load test was run by this lane, and none may be run against hosted. [NOT_VERIFIED]

#### PS-21 Focus on essential goods reaching remote districts
- **RASTA feature:** shipments have cargo items (type as free text, hazardous and perishable flags) and a priority from LOW to CRITICAL. Local only: origin and destination districts (migration 0013).
- **Implementation:** `backend/app/models/operations.py:96` (priority) and `:151` (cargo_type) at e4043ce (96 and 166 locally), `backend/app/models/enums.py:107` (`CargoPriority`) at e4043ce (119 locally).
- **Status: PARTIAL.**
  - There is no category for essential commodities (medicine, food, construction material, agricultural produce), so the platform cannot report on essential supplies as a class. [PROVEN_BY_SOURCE backend/app/models/operations.py:151 (at e4043ce)]
  - Cargo priority cannot override a refused road. [PROVEN_BY_SOURCE backend/app/domain/route_eligibility.py:20-21] Today no road is refused at all (see PS-10).

---

## 4. Tests run by this lane (26 Sep 2026)

All runs used the uncommitted working tree, not `e4043ce`. The domain modules the traceability depends on (`route_risk`, `road_memory`, `monsoon_risk`, `route_eligibility`, `route_recommendation`, `reroute`, `traffic`, `route_progress`, `sentinel`, `flood`, `warnings`, `weather`, `landslide`) are the same in both. `git diff e4043ce -- backend/app/domain` shows changes only to `ai_prompts.py` and `places.py`. The working tree also has two new untracked domain files, `driver_compliance.py` and `presence.py`, which `git diff` does not list; neither is one of the modules above. Of the services this document relies on, `services/simulation.py`, `services/route_risk.py`, `services/route_recommendation.py` and `services/route_watch.py` are unchanged from `e4043ce`; `services/reroute.py` has a one-line local change (it passes the acting user to `load_for_update`). [PROVEN_BY_SOURCE git diff and git status against e4043ce] So these results carry over to hosted source, but not to hosted runtime. [INFERRED]

| Run | Scope | Result | Label |
| --- | --- | --- | --- |
| A | 18 backend test files for domain rules (`test_route_risk`, `test_road_memory`, `test_monsoon_risk`, `test_route_eligibility`, `test_route_recommendation`, `test_reroute`, `test_traffic`, `test_route_progress`, `test_sentinel`, `test_flood_context`, `test_official_warnings`, `test_fuel_model`, `test_weather`, `test_ai_language`, `test_gemini_ai`, `test_landslide_route_risk`, `test_terrain_route_risk`, `test_routing`). Run with `--noconftest` and the database URL pointed at an unreachable local port, so no database could be reached. | 273 passed. 7 errors: the 7 `test_sentinel.py::TestSentinelIntegration` tests need the conftest `session` fixture, and they passed in run B. | PROVEN_BY_TEST |
| B | 18 backend test files that need a database, on the isolated `ner_logistics_test` at 127.0.0.1:55432 (revision 0013), armed with `.runtime/use-isolated-db.sh`: `test_dashboard`, `test_delay_notifications`, `test_driver_stop_request`, `test_notifications`, `test_notification_lifecycle`, `test_telemetry`, `test_offline_package`, `test_emergency_api`, `test_state_district_scope`, `test_district_provenance`, `test_reroute_api`, `test_route_review_authorization`, `test_golden_path_e2e`, `test_sentinel`, `test_notify`, `test_route_watch`, `test_driver_reroute_api`, `test_shipment_trip_atomicity` | 211 passed in 74.6 s | PROVEN_BY_TEST |
| C | Driver app vitest: `src/tracking`, `src/offline`, `src/i18n`, `src/phrasebook`, `navigation/alerts`, `safety/riskCards`, `trip/notificationLanguage`, `api/stopRequest`. Re-run at 18:22 IST on the current tree. | 16 files: 15 passed, 1 failed. 144 tests: 143 passed, 1 failed. The failure is `coverage.test.ts` "has hi/gu/as/bn for every phrase the screens use": "10-digit mobile number" is untranslated. | PROVEN_BY_TEST |
| D | Manager web vitest: `FleetPage`, `TripRouteReview`, `track`, `NotificationsPage`, `OverviewPage` (2 files), `FleetKpiBar` | 7 files, 83 passed | PROVEN_BY_TEST |
| E | One local Python process importing the real `simulation`, `route_risk` and `route_eligibility` modules, with `DEMO_SIMULATION_ENABLED=true` and no database. Input: a route scored 10 (band LOW) with an UNKNOWN, NOT_CONFIGURED landslide assessment, checked before and after the ROAD_INCIDENT scenario. | Band LOW to HIGH, score 10 to 85, codes gain LANDSLIDE_OFFICIAL_ROAD_CLOSURE and DEMO_SIMULATION_ACTIVE. The landslide assessment is the same object after. Eligibility is REQUIRES_REVIEW (ROUTE_HAZARD_DATA_UNKNOWN) before and after; not rejected. | PROVEN_BY_RUNTIME |

An earlier run C by this lane, before 18:06 IST, recorded 16 files and 144 passed. Its output was not kept, and that result does not hold on today's tree. [NOT_VERIFIED]

Not run by this lane: `test_migrations.py`, the full suites, and any check against hosted. [NOT_VERIFIED]

---

## 5. How each major feature serves the NER problem

"Trace" gives the requirement a feature answers. **CANDIDATE_FEATURE_CREEP** marks a feature that traces to no requirement. That does not mean it should be deleted. It means it should not lead the SIH narrative, and it should not take build time from a PS gap until those gaps close.

| Feature | Hosted? | How it helps the NER logistics and accessibility problem | Trace |
| --- | --- | --- | --- |
| Route risk with 11 factors, where UNKNOWN is never SAFE | Yes | A dispatcher sees what is known about a hill corridor, and what is not, before sending a truck | PS-01, PS-02 |
| Route eligibility and manager approval of routes that need review | Yes | A route the landslide evidence rejects cannot be out-scored, and a route with incomplete evidence is dispatched only after a named person accepts it. No closure input reaches the gate today, so every route needs review | PS-03, PS-10 |
| Route recommendation (points, minutes, kilometres) | Yes | Compares real alternatives where they exist, and says plainly when there is only one road | PS-03, PS-04 |
| Reroute assessment and reroute approved by a human | Yes | When a road on the way worsens, the office is told, and the driver's map changes only after a person approves | PS-03, PS-06 |
| Route watch and driver push alerts | Yes | Warns a moving driver about the road ahead | PS-01, PS-06 |
| NDMA SACHET official warnings | Yes | Official alerts matched to the districts a corridor crosses | PS-02, PS-06, PS-15 |
| Weather, GloFAS flood context, terrain gradient | Yes | Evidence for rain, river and slope on NER corridors | PS-02, PS-14 |
| Historical landslide exposure (NASA GLC 2007 to 2017) | Yes | Shows where slides have been recorded near the road. History, not a live report | PS-02 |
| Fleet traffic from the fleet's own GPS | Yes | A congestion signal that does not depend on a paid traffic API | PS-02, PS-09 |
| GPS tracking, durable queue, fleet map, observed track | Yes | Shows where loads are on roads with poor signal | PS-05, PS-11, PS-13, PS-19 |
| Offline trip and navigation package | Yes | The driver keeps route, stops and guidance through dead zones | PS-13 |
| Atomic trip planning and dispatch, shipments with cargo items and priority | Yes | Records what is moving and how urgent it is | PS-11, PS-21 |
| Turn-by-turn navigation with speech | Yes | Delivers the chosen or rerouted road to the driver. Not asked for by name | PS-03 (weak) |
| Fleet Sentinel, check-in and SOS | Yes (the scheduler is not enabled in the blueprint) | Escalates when a truck stops and the driver goes silent. The PS does not ask for driver-safety escalation | PS-06 (weak) |
| Driver UI languages, reason-code catalogue, safety guide | Yes | Drivers read warnings in their own language | PS-12 |
| State and district roles, scoped dashboard, notification inbox | Local only | First step toward district-level views. It counts trips, not connectivity | PS-08, PS-06, PS-11 (partial) |
| Driver stop request with category and location | Local only | Nearest thing to a field report, but from drivers, not officials | PS-07 (partial) |
| Reports page and trip CSV export | Local only (export on hosted) | Lists trips by status for the manager's own scope | PS-11 (weak) |
| System page: provider freshness and intelligence inventory | Yes | Shows which integrations are live and that no local ML runs | PS-15, PS-18 (honesty) |
| Gemini assistant: route, weather and emergency modes; translator; phrasebook | Yes | Translation helps drivers who do not share a language with the office | PS-12 (partial) |
| Assistant health mode ("I feel unwell"), break tracker | Yes | Driver welfare, not accessibility or logistics | **CANDIDATE_FEATURE_CREEP** |
| Roadside places (hotels, tyre repair, rest stops, fuel) | Yes (fuel: local) | Helps the driver on the road, but not named in the PS | **CANDIDATE_FEATURE_CREEP** |
| Driver and truck documents with expiry, truck verification photos, assignments | Yes | Fleet administration that makes dispatch lawful, but not named in the PS | **CANDIDATE_FEATURE_CREEP** (supporting) |
| Physics fuel model | Yes | Cost per route, a weak link to "optimised transportation planning" | PS-18 (weak) |
| Fuel gauge | Local only | Input convenience | **CANDIDATE_FEATURE_CREEP** |
| 3D and terrain map modes, hillshade | Local only | Visual context. Not an accessibility layer | **CANDIDATE_FEATURE_CREEP** |
| Driver tutorial, theme and contrast work | Local only | Usability | **CANDIDATE_FEATURE_CREEP** (low cost) |
| Presence heartbeat ("who is online") | Local only | Feeds the "drivers online" count | **CANDIDATE_FEATURE_CREEP** |
| Driver support session | Yes | Support tooling | **CANDIDATE_FEATURE_CREEP** |
| DEMO SIMULATION of hazards | Yes (enabled in the blueprint) | A demonstration tool, always labelled. It raises one route's score and band and can trigger alerts and a reroute proposal. It does not reach the refusal gate: a simulated closure leaves the route REQUIRES_REVIEW, not REJECTED | **CANDIDATE_FEATURE_CREEP** (demo-only; keep the label) |

Where these facts come from:
- Blueprint flags: [PROVEN_BY_SOURCE render.yaml:88-100 (at e4043ce)]
- Contents of the intelligence inventory: [PROVEN_BY_SOURCE backend/app/domain/intelligence_inventory.py:25-60]
- The creep and weak-trace judgements are this lane's own reading. [INFERRED]

---

## 6. Requirement gaps ranked by judge impact

How the ranking works: first, whether the requirement is an explicit lettered item in the official description; second, whether a judge will notice its absence in a short demo; third, whether "AI" in the title invites the question. The ranking is a judgement. [INFERRED]

| Rank | ID | Status | Gap | Smallest honest next step |
| --- | --- | --- | --- | --- |
| 1 | PS-07 | NOT_BUILT | No way for officials to file geo-tagged incident reports with photos. `road_memory.py` models the evidence states but is not connected. | Add a report endpoint (location, category, photo through the existing `files.py` upload) that writes to `road_memory` as UNVERIFIED evidence, plus a manager view to list reports. |
| 2 | PS-08 | NOT_BUILT | No connectivity status by district. The local dashboard counts trips, and there is no verified district seed. | After the owner approves a district source, show per district the corridors assessed, their latest decision band and active official warnings. Do not invent statuses for districts with no data. |
| 3 | PS-02 / PS-18 | PARTIAL | No live disruption input (the landslide and closure provider answers NOT_CONFIGURED), no trained model in production, road damage not connected. | Keep the rule-based engine. Connect `road_memory` to the PS-07 reports so road damage has an input, and state the model decision plainly in the demo. |
| 4 | PS-06 | PARTIAL | Blocked-road alerts have no live source; the DEMO SIMULATION is labelled synthetic input. No alerts for inaccessible regions. Manager inbox and delay notices are local only. Sentinel sweep not enabled in the blueprint. | Ship plan commits 28 to 32. Decide whether `SENTINEL_SCHEDULER_ENABLED` should be set on hosted. |
| 5 | PS-01 | PARTIAL | Only routes are monitored, not districts or regions. Bridges not modelled. Road quality and truck restrictions always unavailable. | Treat PS-08 and PS-07 as the path. Say "per corridor" in every claim. |
| 6 | PS-11 / PS-21 | PARTIAL | Essential commodities are not a category, so supply status cannot be filtered. | Add a cargo category enum (medicine, food, construction, agricultural, other) behind a migration. |
| 7 | PS-04 | PARTIAL | No delay estimate that reflects a disruption. DELAYED only through a manager hold. | Show the observed pace from `traffic.py` against the planned pace as the delay signal. Keep ETA out. |
| 8 | PS-12 | PARTIAL | Server push text is English only. Translation drafts not reviewed by native speakers. | Send reason codes rather than sentences in pushes, and localise on the phone (the pattern already used for route risk). |
| 9 | PS-09 | NOT_BUILT | No bottleneck or supply-gap view. | Only after PS-08. Count held and delayed trips per corridor segment. |
| 10 | PS-13 | PARTIAL | No offline queue for trip actions was found (PS-13). Cycle-1 findings, not re-checked by this lane, describe defects in the `pdf-master` event queue. | Re-check those findings and fix any that hold before merging that queue. |
| 11 | PS-15 | PARTIAL | No transport database integration. | Record as out of scope unless an open NHAI or PWD feed is found. None has been identified. |
| 12 | PS-10 | PARTIAL | No view of emergency or disaster routes. No closure input, live or simulated, reaches the refusal gate. | Follows from rank 1 and rank 3. Until then, do not claim in a demo that a simulated closure is refused. |
| 13 | PS-16 | PARTIAL | Security findings open on hosted. | Ship plan commits 2, 4, 5, 16 and 31. The owner decides on the 12 public images. |
| 14 | PS-20 | NOT_VERIFIED | Scalability not measured. | Load-test only a local copy. Never hosted. |

---

## 7. Decisions for the owner

1. **Theme.** The official page says Transportation & Logistics; the repository says Smart Automation (section 1.3). Confirm which one the portal registration uses. [NOT_VERIFIED]
2. **Who counts as a "field official".** PS-07 needs a role that neither hosted nor local has. The local DISTRICT_MANAGER role is the closest. [PROVEN_BY_SOURCE backend/app/models/enums.py:49]
3. **District source.** PS-08 cannot be honest without a verified district list. The local tree deliberately seeds none. [PROVEN_BY_TEST backend/tests/test_state_district_scope.py::test_districts_are_not_seeded_and_that_is_deliberate]
4. **What to say about "AI".** The product's rule is that no model decides routing. The narrative for judges should cite `intelligence_inventory.py` and the experimental model's rejection, not imply prediction. [PROVEN_BY_SOURCE backend/app/domain/intelligence_inventory.py:27]

## 8. What this document did not check

- Hosted runtime behaviour. No request was sent to Render or Supabase. [NOT_VERIFIED]
- Render environment values that are not in `render.yaml`, for example whether `SENTINEL_SCHEDULER_ENABLED` is set in the dashboard. [NOT_VERIFIED]
- Exact byte fidelity of the official text (section 1.1). [NOT_VERIFIED]
- The contents of the `pdf-master` branch. The finding about it is carried over from cycle 1. [NOT_VERIFIED]
