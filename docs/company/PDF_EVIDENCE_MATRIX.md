# PDF evidence matrix: RASTA AI (SIH26002)

Lane: plugins-geo-docs (Documentation). Written 26 Sep 2026. This lane only read files. It edited no code and sent no requests to hosted systems.

Labels follow `GEOSPATIAL_PLUGIN_FINDINGS.md` section 0. When a row says "the PDF states X", the label PROVEN_BY_SOURCE (file, page) proves only that the PDF says it. Whether the code or the product supports X is labelled separately.

## 1. Method

1. **Scope.**
   - Repository PDFs came from `git ls-files '*.pdf'` (7 files).
   - Downloads PDFs are those in `C:/Users/patel/Downloads` whose names match `sih|rasta|ner|26002|mdoner|data_sources`, case-insensitive: 27 files in the folder and 3 in its `sih 2026/` subfolder.
   - Total: **37 files**. I did not read the 24 Downloads PDFs whose names do not match [PROVEN_BY_RUNTIME: 51 PDFs, 27 matched, 24 not]. Examples: the landslide research files without "NER" in the name, and the SIH task sheets named "Day N Task N.pdf".
2. **PDF Viewer plugin.** `mcp__plugin_pdf-viewer_pdf__list_pdfs` returned `allowedDirectories: []` [PROVEN_BY_RUNTIME], so it cannot open local files. Status: BLOCKED.
3. **Extraction.** I used PyMuPDF 1.28.2, which was already installed in the system Python 3.11; nothing was installed. Every page of all 37 files was extracted. **No PDF failed text extraction** [PROVEN_BY_RUNTIME].
4. **Reading.** I read the full extracted text of every distinct document. For near-duplicates I compared the extracted text with `diff`.
5. **Images.** Embedded images such as screenshots and slide art were **not** inspected one by one. I rendered and viewed only three pages:
   - `RASTA_AI_SIH26002_.pdf` p6;
   - `NER-Fleet-Pamphlet.pdf` p1;
   - `RASTA_AI_SIH26002_TEAM17_FINAL.pdf` p5.

   Anything shown only inside other images is NOT_VERIFIED.
6. **Code checks.** Each claim was checked against the working tree at 5b5e474 plus uncommitted changes and against hosted e4043ce, using `git grep`, `git show` and file reads. Line references are given for each.

## 2. Inventory

SHA-256 values are shown as their first 12 hex characters. `R` = repository, `D` = Downloads, `S` = `Downloads/sih 2026/`.

| # | File | Pages | SHA-256 (12) | Images | Duplicate of | Extracted |
|---|---|---|---|---|---|---|
| R1 | docs/submission/2026-09-09/NER_AI_Logistics_FullStack.pdf | 24 | ae6700d694e9 | 0 | – | full |
| R2 | docs/submission/2026-09-09/NER_AI_Logistics_SIH26002_Idea_Submission.pdf | 6 | dfd5ed746358 | 13 | variant of D6 | full |
| R3 | docs/submission/2026-09-09/NER_AI_Logistics_Technical_Dossier.pdf | 26 | c35342205fb5 | 0 | = D8 = S2 | full |
| R4 | docs/submission/2026-09-09/NER_AI_Logistics_Technology_Stack.pdf | 18 | e8ff0b4ec8b0 | 0 | = D9 = S3 | full |
| R5 | docs/submission/NER_AI_Logistics_SIH2026.pdf | 6 | 4a934c09a5b5 | 106 | – | full |
| R6 | docs/submission/RASTA_AI_SIH26002_TEAM17_FINAL.pdf | 6 | 4e40fb742255 | 39 | – | full |
| R7 | docs/submission/day1/RASTA_AI_SIH2026_DAY1_TASK1_SYSTEM_DESIGN.pdf | 40 | 0ad8c91f0b94 | 3 | – | full |
| D1 | GitHub_Repositories_Related_to_NER_Logistics_Project.pdf | 1 | dc0c142a2b57 | 0 | – | full |
| D2 | Gods_Eye_View_Project_Data_and_Map_Sources_for_NER_AI.pdf | 4 | 5fa0b7fa3030 | 0 | – | full |
| D3 | India_Open_Source_Maps_Locations_Buildings_Data_Sources.pdf | 4 | ea7665b038b5 | 0 | – | full |
| D4 | Internal SIH 2026 Schedule.pdf | 2 | 5c4af29e0396 | 0 | – | full |
| D5 | NER-Fleet-Pamphlet.pdf | 1 | 150c7d1f9b04 | 1 | – | full (page viewed) |
| D6 | NER_AI_Logistics_SIH26002_Idea_Submission.pdf | 6 | f9d7b0644969 | 13 | = S1; variant of R2 | full |
| D7 | NER_AI_Logistics_SIH26002_Idea_Submission_.pdf | 6 | eb235916aad4 | 14 | text identical to D18 | full |
| D8 | NER_AI_Logistics_Technical_Dossier.pdf | 26 | c35342205fb5 | 0 | = R3 | full |
| D9 | NER_AI_Logistics_Technology_Stack.pdf | 18 | e8ff0b4ec8b0 | 0 | = R4 | full |
| D10 | NER_Landslide_Only_Statewise_Data_2017_2026.pdf | 6 | 7420aded385c | 0 | – | full |
| D11 | NER_Landslide_Weather_Data_2017_2026_Official_Sources.pdf | 3 | e4536d181bd9 | 0 | – | full |
| D12 | RASTA_AI_Complete_Project_Dossier_2026-09-20.pdf | 25 | 783ab18f829a | 75 | – | full |
| D13 | RASTA_AI_Complete_Project_Dossier_COMPATIBLE.pdf | 25 | af2736122d0f | 6 | same text as D12 except 25 lines with broken ligature glyphs, mostly headings | full |
| D14 | RASTA_AI_DAY2_TASK1_BACKEND_API_DATABASE_FINAL.pdf | 12 | 658b206b8cde | 7 | – | full |
| D15 | RASTA_AI_DAY2_TASK2_SECURITY_ASSESSMENT_FINAL.pdf | 30 | bc7834470e0a | 15 | – | full |
| D16 | RASTA_AI_Data_Sources_for_SIH_PPT.pdf | 2 | b11c64df8f77 | 0 | – | full |
| D17 | RASTA_AI_SIH2026_FINAL_SUBMISSION.pdf | 6 | 5790029f360b | 37 | – | full |
| D18 | RASTA_AI_SIH26002_.pdf | 6 | 140639b987e9 | 14 | text identical to D7 | full (p6 viewed) |
| D19 | RASTA_AI_SIH26002_SUPPORTING_REPORT.pdf | 6 | 52e528211eb3 | 0 | – | full |
| D20 | RASTA_AI_SIH26002_VIDEO_ALIGNED_FINAL.pdf | 6 | dcaf14dee29f | 16 | – | full |
| D21 | RASTA_AI_SIH_Counter_Questions_Judge_QA.pdf | 20 | 043c4a13f920 | 0 | – | full |
| D22 | RASTA_AI_Speech.pdf | 8 | 4d61148bb5e3 | 0 | – | full |
| D23 | RASTA_FINAL_UI_VALIDATION_LANDSLIDE_DATA_GITHUB_AUDIT_MASTER_PROMPT.pdf | 45 | db94666192b7 | 0 | = D24 | full |
| D24 | RASTA_FINAL_UI_VALIDATION_LANDSLIDE_DATA_GITHUB_AUDIT_MASTER_PROMPT1.pdf | 45 | db94666192b7 | 0 | = D23 | full |
| D25 | SIH_PPT_DEMO_1.pdf | 5 | f3c72502a43a | 94 | – | full |
| D26 | SIH_PPT_DEMO_2.pdf | 5 | d358ead60183 | 26 | – | full |
| D27 | geospatial_data_sources_NE_India.pdf | 2 | ba14eafac1a5 | 0 | – | full |
| S1 | sih 2026/NER_AI_Logistics_SIH26002_Idea_Submission.pdf | 6 | f9d7b0644969 | 13 | = D6 | full |
| S2 | sih 2026/NER_AI_Logistics_Technical_Dossier.pdf | 26 | c35342205fb5 | 0 | = R3 | full |
| S3 | sih 2026/NER_AI_Logistics_Technology_Stack.pdf | 18 | e8ff0b4ec8b0 | 0 | = R4 | full |

That is 37 files and 29 distinct texts [PROVEN_BY_RUNTIME, hash and diff]. The duplicates are copies of R3, R4, D6, D7 and D23.

Git history of the repository PDFs [PROVEN_BY_SOURCE `git log -1 -- <file>`]:
- R5 was committed in 66f3008 on 9 Sep.
- R1 to R4 were committed in 801337f on 12 Sep.
- R6 was committed in 8913bb6 on 14 Sep.
- R7 was committed in 0a7323e on 18 Sep.

All seven are on origin/main (e4043ce), so they are public.

---

## 3. Per-document matrix

Each block covers one distinct text. Duplicates are named in the FILE line.

### R1. NER_AI_Logistics_FullStack.pdf (9 Sep 2026, 24 pages, public)
- **TOPIC:** An engineering description of release 1.0.9 / versionCode 9.
- **IMPORTANT FACTS:** The PDF states [PROVEN_BY_SOURCE R1 pp1-24]:
  - 1,636 tests (976 backend, 150 manager, 510 driver), 10 engines, 17 tables, 46 endpoints, a 71 MB APK;
  - Supabase ap-south-1, and "data stays in India";
  - the driver uses `react-native-maps` 1.27.2 as its "native Android map surface";
  - MapLibre "vector tiles";
  - fuel formula constants (B = 0.22 L/km, K_payload = 0.0075);
  - GSI, ASDMA, IMD and NHAI/BRO bulletins "enter the platform through road_memory";
  - Gemini runs through an Edge Function, default `gemini-3-flash-preview`;
  - the API is "horizontally scalable".
- **DATASET/SOURCE:** The working tree of 9 Sep, as described by the PDF.
- **WHAT RASTA CAN USE:**
  - The design principles: UNKNOWN ≠ SAFE, closure is a refusal, and GPS idempotency on (trip_id, device_fix_id). The unique index exists [PROVEN_BY_SOURCE `backend/app/models/operations.py:609`].
  - The fuel constants exist in code [PROVEN_BY_SOURCE `backend/app/domain/fuel_model.py:22-23`], but nothing calls them in route planning (see C2).
- **WHAT RASTA CANNOT CLAIM:** C1, C2, C3, C4, C5, C11 and C13 in section 4, plus every count in this PDF, which are superseded.
- **ACTION:** Mark it as a historical 9 Sep snapshot wherever it is linked. Do not quote its numbers.

### R2 / D6 / S1. NER_AI_Logistics_SIH26002_Idea_Submission.pdf (two versions)
- **TOPIC:** The six-slide idea deck of 9 Sep.
- **IMPORTANT FACTS:**
  - R2 (repository copy) states [PROVEN_BY_SOURCE R2 pp2-6]:
    - "1,636 automated tests", "10 deterministic decision engines", "17 database tables in production";
    - a "physics fuel model" giving litres and CO₂;
    - "Fleet Sentinel … ≤ 90 min, by rule";
    - "DATA SOURCES — LIVE IN THE PLATFORM" including GSI Bhukosh, ASDMA, IMD and NHAI/BRO;
    - "All data sources are free and licence-clear";
    - "A GPS traversal reopens a segment";
    - "PostgreSQL Row Level Security — enabled on every table".
  - The Downloads copy D6/S1 (a different hash) is more careful [PROVEN_BY_SOURCE `diff` of the extracted texts]. It says "1,573 automated tests", "9 database migrations", "0 fabricated values", "DATA SOURCES — INTEGRATED AND SURVEYED", and "No accuracy figure is claimed".
- **DATASET/SOURCE:** Hand-written deck.
- **WHAT RASTA CAN USE:** The problem framing: monsoon closures, dead zones, and the finding that no machine-readable reopening feed exists. That is the team's own survey [NOT_VERIFIED by me].
- **WHAT RASTA CANNOT CLAIM:**
  - R2 carries C1, C2, C6-fuel, C13 and C15.
  - "A GPS traversal reopens a segment": `road_memory` is not wired into any service [PROVEN_BY_SOURCE: `git grep road_memory backend/app` finds only `domain/monsoon_risk.py` and the inventory list, and `monsoon_risk` itself has no service caller].
- **ACTION:** Replace R2 in the repository with the D6 wording, or mark R2 as superseded. The team should decide which copy was actually submitted [NOT_VERIFIED].

### R3 / D8 / S2. NER_AI_Logistics_Technical_Dossier.pdf (9 Sep, 26 pages)
- **TOPIC:** A full system description. §17 lists the known gaps.
- **IMPORTANT FACTS:** The PDF states [PROVEN_BY_SOURCE R3]:
  - 959 / 124 / 490 tests (8 Sep run);
  - "No hosted backend … READY, NOT DEPLOYED" (§16);
  - five risk factors "NOT_AVAILABLE" (§17);
  - SRTM for climb;
  - model-governance rules (§9.1);
  - an empty model-metrics table;
  - a "reviewed phrase pack in Assamese, Bengali, Hindi and English";
  - the Fleet Sentinel description (§12).
- **DATASET/SOURCE:** The working tree of 9 Sep plus the docs listed in its provenance note.
- **WHAT RASTA CAN USE:** The model-governance rules (baseline first, synthetic data disclosed) and the §17 list of honest gaps as a template.
- **WHAT RASTA CANNOT CLAIM:**
  - "No hosted backend" is outdated: a hosted backend exists (render.yaml).
  - The PDF calls the phrase pack "reviewed" in Assamese, Bengali, Hindi and English. The code disagrees:
    - the phrase file header says "REVIEW STATUS: drafted by the team, NOT reviewed by native speakers" [PROVEN_BY_SOURCE `driver-app/src/i18n/phrases.ts:8`];
    - the UI marks as, bn and hi as DRAFT [PROVEN_BY_SOURCE `driver-app/src/i18n/appLanguage.ts`].
  - One UI string says the safety guidance "is reviewed in English, Hindi and Assamese only" [PROVEN_BY_SOURCE `phrases.ts:169`]. Who reviewed it is not established [NOT_VERIFIED].
  - The 17 tables / 9 migrations figures are superseded.
- **ACTION:** Keep it as history. Do not cite its status lines as current.

### R4 / D9 / S3. NER_AI_Logistics_Technology_Stack.pdf (9 Sep, 18 pages)
- **TOPIC:** Package versions, endpoints and configuration.
- **IMPORTANT FACTS:** The PDF states [PROVEN_BY_SOURCE R4 pp2-5,17]:
  - `react-native-maps 1.27.2` for Android;
  - `maplibre-gl` "vector tiles";
  - GEMINI_MODEL default `gemini-2.5-flash`;
  - 9 migrations;
  - "Nothing here is aspirational unless it is explicitly tagged PLANNED".
- **DATASET/SOURCE:** Manifests as of 9 Sep.
- **WHAT RASTA CAN USE:** The package versions for React, Vite and FastAPI. They still match the current manifests (manager `react ^19.2.8`, `maplibre-gl ^6.6.0`) [PROVEN_BY_SOURCE `manager-web/package.json`].
- **WHAT RASTA CANNOT CLAIM:**
  - C3 and C4.
  - GEMINI_MODEL is now `gemini-flash-lite-latest` [PROVEN_BY_SOURCE `backend/app/core/config.py:248`].
  - There are now 12 migrations on hosted and 13 in the working tree [PROVEN_BY_SOURCE `backend/alembic/versions/`].
- **ACTION:** Mark it as a historical snapshot.

### R5. NER_AI_Logistics_SIH2026.pdf (committed 9 Sep, 6 pages, 106 images)
- **TOPIC:** An earlier "RASTA-AI" deck: an NER-first pilot and a pan-India architecture.
- **IMPORTANT FACTS:** The PDF states [PROVEN_BY_SOURCE R5 pp2-6]:
  - an "en / hi / as catalogue";
  - "Future: GSI + road authorities";
  - "Risk thresholds are not yet statistically calibrated";
  - GSI Bhusanket showed "36,072 inventory entries … (accessed 02 Sep 2026)";
  - "MDoNER reports an Industry 4.0 + Logistics Roadmap for NER, approved in May 2025";
  - Team ID "[REGISTERED TEAM ID]" as a placeholder.
- **DATASET/SOURCE:** GSI Bhusanket, mdoner.gov.in, OSRM docs, Open-Meteo docs, MapLibre docs, and the OSM copyright page.
- **WHAT RASTA CAN USE:** Its conservative wording on data sources, since it marks GSI as future.
- **WHAT RASTA CANNOT CLAIM:**
  - The MDoNER roadmap statement and the 36,072 figure have not been re-checked [NOT_VERIFIED].
  - D10 quotes 36,068 records instead (see section 5).
- **ACTION:** Re-check both facts against their sources before reuse.

### R6. RASTA_AI_SIH26002_TEAM17_FINAL.pdf (14 Sep, 6 pages, public on origin/main)
- **TOPIC:** The final six-slide deck, "Team 17 (internal group no.)", NER-AI LOGISTICS.
- **IMPORTANT FACTS:** The PDF states [PROVEN_BY_SOURCE R6 pp1-6; p5 viewed as an image]:
  - "23 languages", "11 route factors in every decision";
  - "conditions are re-scored every 60 s along the road ahead";
  - "12/12 judge-flow steps certified on a physical phone" beside "Real screens, APK 1.0.18";
  - "1138+ backend tests · 621+ driver tests · 170+ manager tests";
  - "≈ 98.8 km real route";
  - landslide model metrics: recall 95%, FPR 50%, precision 0.32, PR-AUC 0.55, ROC-AUC 0.83, Brier 0.12, "NOT DEPLOYED".
- **DATASET/SOURCE:** NASA GLC, NDMA SACHET, GloFAS, Open-Meteo, MET Norway, Copernicus DEM, OpenTopoData, OSRM.
- **WHAT RASTA CAN USE:**
  - The 23-entry language selector with its statuses. The code has 23 entries: 1 VERIFIED, 13 DRAFT and 9 FALLBACK_ENGLISH [PROVEN_BY_SOURCE `driver-app/src/i18n/appLanguage.ts`].
  - The 11 factor slots [PROVEN_BY_SOURCE `backend/app/domain/route_risk.py:91-101`].
  - The model metrics, only as EXPERIMENTAL and only after the registry is checked. I did not open `docs/MODEL_REGISTRY.md` [NOT_VERIFIED].
- **WHAT RASTA CANNOT CLAIM:** C6, C7, C8 and C12. "11 factors in every decision" also needs a caveat: road_quality and truck_restrictions are always unavailable [PROVEN_BY_SOURCE `route_risk.py:102-107`], and fuel is never supplied (C2).
- **ACTION:** This PDF is public. Either replace it with the D20 wording or add a dated erratum. The team decides.

### R7. RASTA_AI_SIH2026_DAY1_TASK1_SYSTEM_DESIGN.pdf (18 Sep, 40 pages, public)
- **TOPIC:** Problem understanding, system design and a status matrix. It uses six status labels.
- **IMPORTANT FACTS:** The PDF states [PROVEN_BY_SOURCE R7]:
  - "84 route handlers", 12 migrations, 20 tables;
  - the driver map is "Leaflet in a WebView";
  - offline tiles NOT IMPLEMENTED; 9 km prefetch not on main;
  - Render "free, Singapore region";
  - push BLOCKED (no google-services.json); SMS NOT CONFIGURED;
  - Sentinel scheduler off by default;
  - "22 UI languages listed";
  - tests 1172/5 skipped, manager 225, driver 624 (16 Sep).
- **DATASET/SOURCE:** The code, HANDOFF.md and hosted certification logs.
- **WHAT RASTA CAN USE:** The best baseline among the PDFs. Several of its statements match code I checked:
  - Render region [PROVEN_BY_SOURCE `render.yaml:36`];
  - Sentinel scheduler off by default [PROVEN_BY_SOURCE `backend/app/core/config.py:322`];
  - WebView Leaflet [PROVEN_BY_SOURCE `driver-app/src/map/DriverRouteMap.native.tsx:1-10`];
  - offline basemap absent [PROVEN_BY_SOURCE `backend/app/services/offline_package.py:26-33`].
- **WHAT RASTA CANNOT CLAIM:** "84 route handlers" differs from the 86 in D14 and D12 [PROVEN_BY_SOURCE D14 p2]. Current routes were not recounted by me [NOT_VERIFIED]. "22 UI languages" is a counting difference: the code has 23 entries including English.
- **ACTION:** Keep. If reissued, align the route count and the language count.

### D1. GitHub_Repositories_Related_to_NER_Logistics_Project.pdf (18 Sep, 1 page)
- **TOPIC:** A list of 15 GitHub repositories, compiled from links.
- **IMPORTANT FACTS:** Links only, with no evaluation [PROVEN_BY_SOURCE D1 p1].
- **DATASET/SOURCE:** The GitHub URLs listed in the PDF.
- **WHAT RASTA CAN USE:** Input for `docs/research/GITHUB_REFERENCE_AUDIT.md`, which exists and is modified in the working tree [PROVEN_BY_SOURCE `git status`].
- **WHAT RASTA CANNOT CLAIM:** Any capability, licence or accuracy of these repositories.
- **ACTION:** None beyond the existing audit.

### D2. Gods_Eye_View_Project_Data_and_Map_Sources_for_NER_AI.pdf (18 Sep, 4 pages)
- **TOPIC:** Research on another repository's live-layer data sources and how they might be used for the NER.
- **IMPORTANT FACTS:**
  - It warns that third-party feeds "should not be treated as authoritative for safety-critical decisions" and gives licence cautions: TeleGeography CC BY-NC-SA, OpenSky non-commercial, Google proprietary, OSM ODbL [PROVEN_BY_SOURCE D2 pp1-4].
  - It contains citation-token residue ("turn0search…"), which suggests it was generated by an AI assistant [INFERRED].
- **DATASET/SOURCE:** The God's Eye View repository's DATA_SOURCES.md (not opened by me).
- **WHAT RASTA CAN USE:** The licence cautions as a checklist. NASA FIRMS as a possible ROADMAP evaluation.
- **WHAT RASTA CANNOT CLAIM:** Any of these layers as integrated. None is present in the code [PROVEN_BY_SOURCE: `git grep` of backend/app, manager-web/src and driver-app/src for `firms.modaps|opensky|earthquake.usgs|usgs` matches only `manager-web/src/components/mapTerrain.ts`, and only for the USGS credit on the elevation tiles; there is no FIRMS, OpenSky or USGS-earthquake feed].
- **ACTION:** Research only.

### D3. India_Open_Source_Maps_Locations_Buildings_Data_Sources.pdf (Sep 2026, 4 pages)
- **TOPIC:** Open and government map, POI and building sources for India.
- **IMPORTANT FACTS:**
  - Recommends Survey of India for administrative boundaries, OSM for roads and POIs, Bhuvan for imagery and DEM, and Microsoft building footprints ("CDLA Permissive 2.0 according to Microsoft repository") [PROVEN_BY_SOURCE D3 pp1-4].
  - It has the same citation-token residue as D2 [INFERRED: AI-generated].
- **DATASET/SOURCE:** The URLs the PDF lists (not opened by me).
- **WHAT RASTA CAN USE:** SoI as the boundary source. This matches DST guideline 8(xiii) [PROVEN_BY_WEB (WebFetch) https://dst.gov.in/sites/default/files/Final%20Approved%20Guidelines%20on%20Geospatial%20Data.pdf].
- **WHAT RASTA CANNOT CLAIM:** Any building or Bhuvan layer as integrated (none is in the code). The Microsoft licence statement [NOT_VERIFIED].
- **ACTION:** ROADMAP input for G12 in `GEOSPATIAL_PLUGIN_FINDINGS.md`.

### D4. Internal SIH 2026 Schedule.pdf (2 pages)
- **TOPIC:** Internal hackathon schedule, 18–20 Sep 2026, Apollo Institute of Engineering & Technology [PROVEN_BY_SOURCE D4].
- **IMPORTANT FACTS:** Timings for Day 1 to Day 3; presentations to the jury from 11:00 on 20 Sep.
- **DATASET/SOURCE:** None.
- **WHAT RASTA CAN USE:** Nothing technical.
- **WHAT RASTA CANNOT CLAIM:** Not applicable.
- **ACTION:** None.

### D5. NER-Fleet-Pamphlet.pdf (9 Sep, 1 page, viewed as an image)
- **TOPIC:** A product concept pamphlet, "NER Fleet Intelligence".
- **IMPORTANT FACTS:** It says "Design concept • Sample screens and illustrative map • Live capabilities require verification", and the mock-up footer says "All numbers are fictional" [PROVEN_BY_SOURCE D5 p1, text and rendered image].
- **DATASET/SOURCE:** A mock-up with an illustrative map.
- **WHAT RASTA CAN USE:** Only as design inspiration.
- **WHAT RASTA CANNOT CLAIM:** That these are product screenshots, or any number shown in them.
- **ACTION:** Keep out of evidence packs.

### D7 / D18. NER_AI_Logistics_SIH26002_Idea_Submission_.pdf and RASTA_AI_SIH26002_.pdf (17–18 Sep; identical text)
- **TOPIC:** A six-slide deck under **Team ID 139522, team name "ByteForceX6"**.
- **IMPORTANT FACTS:** The PDF states [PROVEN_BY_SOURCE D18 pp1-6]:
  - "98.8 km", "22 landslides within 5 km", "1975 m climb, steepest 10.3 %", "154 NER events";
  - "12/12 physical judge-flow steps" beside "Android APK 1.0.18";
  - "1138+ backend · 621+ driver · 170+ manager tests";
  - p6, "SOURCES BEHIND EVERY ROUTE DECISION", lists openrouteservice, IMD, GSI Bhusanket/NLFC, ISRO Bhuvan, MOSDAC, NASA GPM IMERG, Sentinel-1/2, NESAC/NeSDR, TRAI coverage maps, ERSS 112 and NHAI 1033;
  - the p6 footer says "Sources are tagged by implementation state", but **the rendered page shows no tags** [PROVEN_BY_SOURCE D18 p6 rendered image].
- **DATASET/SOURCE:** The same demo evidence as D19.
- **WHAT RASTA CAN USE:**
  - The 98.8 km and 22-slides-within-5 km figures, with the D19 caveat ("historical, not a forecast") [PROVEN_BY_SOURCE D19 p4]. They were not re-measured by me [NOT_VERIFIED].
  - "154" is the size of the NER hold-out in the model registry [PROVEN_BY_SOURCE D19 p4], not a count of recent events.
- **WHAT RASTA CANNOT CLAIM:** C7, C8 and C10. The team identity also conflicts with other PDFs (section 5, X1).
- **ACTION:** The user must confirm the registered Team ID and team name. Do not copy either identity between documents until confirmed.

### D10. NER_Landslide_Only_Statewise_Data_2017_2026.pdf (18 Sep, 6 pages)
- **TOPIC:** NER landslide counts by state from the ISRO/NRSC atlas table, plus a monthly template with no data.
- **IMPORTANT FACTS:** The PDF states [PROVEN_BY_SOURCE D10 pp1-6]:
  - per-state monsoon 2014 and 2017 inventory counts and event inventories;
  - "ISRO table total" per state, for example Mizoram 12,385 and Tripura 8,070;
  - GSI "36,068 field-validated landslide inventory records nationally as of its July 2026 update";
  - "does not convert unavailable records into zeroes".
- **Internal check.** The totals do not add up for two states [PROVEN_BY_SOURCE, arithmetic on D10 p1]:
  - Assam: 1,243 + 793 + 533 = 2,569, which excludes the 5,091 (2022) shown in the same row.
  - Manipur: 379 + 4,559 + 556 = 5,494, which excludes the 1 (2022).
  - The other six states match their components.

  The D23 master prompt also notes "Assam 2,569 (document flags a component discrepancy)" and a published total of 42,547. The eight totals sum to 42,547 [PROVEN_BY_SOURCE, arithmetic].
- **DATASET/SOURCE:** NRSC Landslide Atlas; NASA COOLR; GSI Bhusanket. I did not open these URLs.
- **WHAT RASTA CAN USE:** Research-only context, labelled "inventory, not annual counts".
- **WHAT RASTA CANNOT CLAIM:** Annual or monthly series; any sum of ISRO and GSI figures; any count as a route-risk input. The Assam and Manipur totals cannot be settled without the atlas [NOT_VERIFIED].
- **ACTION:** Verify against the NRSC atlas PDF before any use.

### D11. NER_Landslide_Weather_Data_2017_2026_Official_Sources.pdf (18 Sep, 3 pages)
- **TOPIC:** IMD weather sources for the eight states.
- **IMPORTANT FACTS:** The PDF states [PROVEN_BY_SOURCE D11 pp1-3]:
  - IMD 0.25° gridded daily rainfall covers 1901–2024;
  - station data comes through the IMD Data Service Portal;
  - example bulletin values, such as Cherrapunji 28 cm, without dates;
  - a regional weekly report for the week ending 13 May 2026.
- **DATASET/SOURCE:** IMD URLs (not opened by me).
- **WHAT RASTA CAN USE:** A ROADMAP plan for an IMD data request; the join schema.
- **WHAT RASTA CANNOT CLAIM:**
  - IMD integration. There is no IMD adapter [PROVEN_BY_SOURCE: `git grep mausam.imd` finds nothing in backend/app, manager-web/src or driver-app/src]. IMD alerts reach the product only as CAP items in the NDMA SACHET feed [INFERRED from R7 p14, "CRITICAL IMD thunderstorm alert" shown via SACHET].
  - Any of the example numbers [NOT_VERIFIED].
- **ACTION:** Research only.

### D12 / D13. RASTA_AI_Complete_Project_Dossier_2026-09-20.pdf and the _COMPATIBLE copy (20 Sep, 25 pages)
- **TOPIC:** A full project dossier. It compares GitHub at 5b5e474 with the 19–20 Sep reports.
- **IMPORTANT FACTS:** The PDF states [PROVEN_BY_SOURCE D12]:
  - tests 1,426 / 322 / 676;
  - APK 1.0.21; physical matrix 38 PASS / 28 BLOCKED;
  - POI snapshot 4,366, dated 20 Sep;
  - hosted migration 0013 not applied;
  - 86 routes (appendix A); 20 tables (appendix B);
  - route-watch refresh 600 s per trip; Sentinel constants;
  - "Some older documents mention MapTiler. The inspected current map components use OSM raster tile URLs" (p10).

  D13 has the same text, but 25 lines, mostly headings, extract with broken ligatures, for example "contribu)on" [PROVEN_BY_SOURCE `diff`].
- **DATASET/SOURCE:** GitHub at 5b5e474 plus uploaded reports.
- **WHAT RASTA CAN USE:**
  - The best status summary for 20 Sep.
  - The 4,366 figure matches the working-tree snapshot [PROVEN_BY_SOURCE `backend/app/services/places/data/corridor_snapshot.json`].
  - The 600 s refresh matches the code [PROVEN_BY_SOURCE `backend/app/core/config.py:319`].
- **WHAT RASTA CANNOT CLAIM:** The p10 MapTiler statement is incomplete. The driver uses MapTiler hillshade when `EXPO_PUBLIC_MAPTILER_KEY` is set, on both hosted and the working tree [PROVEN_BY_SOURCE `driver-app/src/map/scene.ts:65-78`; `git show e4043ce:driver-app/src/map/scene.ts:50-51`].
- **Privacy:** The dossier names the person it was prepared for and the presentation team. Do not republish it outside the team without their consent.
- **ACTION:**
  - Correct the MapTiler sentence in any reissue.
  - Prefer D12 over D13, because D13's text layer is damaged, which hurts search and screen readers.

### D14. RASTA_AI_DAY2_TASK1_BACKEND_API_DATABASE_FINAL.pdf (19 Sep, 12 pages)
- **TOPIC:** Backend, API, database and integration evidence at 0012.
- **IMPORTANT FACTS:** The PDF states [PROVEN_BY_SOURCE D14 pp2-11]:
  - 86 routes / 14 routers;
  - 20 tables, 41 FKs, 36 CHECKs, 75 indexes, 20 enum types;
  - tests 1210 / 259 / 624; HTTP 56/56; browser 24/24;
  - "Fuel estimation … NOT IMPLEMENTED";
  - planned_eta, current_eta and fuel columns "not populated";
  - demo route geometry of 4,341 points and 98.82 km;
  - four screenshots still to be taken.
- **DATASET/SOURCE:** The running app and a local clone database, 19 Sep.
- **WHAT RASTA CAN USE:**
  - The backend baseline at 0012.
  - The fuel statement matches the code [PROVEN_BY_SOURCE `backend/app/services/routes.py:404-406`].
  - 20 tables on hosted e4043ce matches 20 `__tablename__` entries [PROVEN_BY_SOURCE `git grep __tablename__ e4043ce -- backend/app/models`]. The working tree has 23.
- **WHAT RASTA CANNOT CLAIM:** That the numbers are current [NOT_VERIFIED]. The PDF shows a demo truck plate and demo account names; these are demo data, not personal data.
- **ACTION:** Keep. An earlier review found the committed `docs/submission/day2/task1/*FINAL.docx` corrupt. That DOCX was not checked here [NOT_VERIFIED]. This Downloads PDF extracted cleanly [PROVEN_BY_RUNTIME].

### D15. RASTA_AI_DAY2_TASK2_SECURITY_ASSESSMENT_FINAL.pdf (19 Sep, 30 pages)
- **TOPIC:** A web security assessment.
- **IMPORTANT FACTS:** The PDF states [PROVEN_BY_SOURCE D15 pp3-30]:
  - 0 critical, 0 high, 1 medium, 5 low, 7 informational;
  - SEC-001 to SEC-005 fixed in the working tree, with hosted "pending deploy";
  - SEC-006 (rate limiter behind the proxy) open;
  - SEC-008, Leaflet from unpkg without SRI, open;
  - no full CSP, because the console loads "Google Fonts, MapLibre workers and map tiles";
  - OWASP ZAP and pip-audit not run.
- **DATASET/SOURCE:** A local security clone and read-only hosted checks.
- **WHAT RASTA CAN USE:**
  - The security baseline.
  - SRI is now present in the working tree [PROVEN_BY_SOURCE `DriverRouteMap.native.tsx:48-55`] and absent on hosted [PROVEN_BY_SOURCE `git show e4043ce:driver-app/src/map/DriverRouteMap.native.tsx:39,42`].
- **WHAT RASTA CANNOT CLAIM:** That hosted carries the fixes. That any scanner beyond those named was run.
- **ACTION:** Changing any tile provider (G3 in the geospatial doc) must update the future CSP `img-src` and `connect-src` lists.

### D16. RASTA_AI_Data_Sources_for_SIH_PPT.pdf (17 Sep, 2 pages)
- **TOPIC:** A source reference sheet for the deck.
- **IMPORTANT FACTS:**
  - It says "Do not claim a source is already live-integrated unless the feature has actually been implemented and tested" and "phrase these as 'data sources used / evaluated / planned'".
  - It recommends openrouteservice routing and IMD as the primary weather source [PROVEN_BY_SOURCE D16 pp1-2].
- **DATASET/SOURCE:** Official links.
- **WHAT RASTA CAN USE:** Its rule on presenting sources.
- **WHAT RASTA CANNOT CLAIM:** openrouteservice or IMD as in use. Neither is in the code [PROVEN_BY_SOURCE: `git grep openrouteservice`, `git grep mausam.imd` find nothing].
- **ACTION:** D18 p6 did not apply this rule (C10).

### D17. RASTA_AI_SIH2026_FINAL_SUBMISSION.pdf (10 Sep, 6 pages)
- **TOPIC:** Six-slide final submission deck, "NER-AI LOGISTICS", Team ID placeholder.
- **IMPORTANT FACTS:** The PDF states [PROVEN_BY_SOURCE D17 pp1-6]:
  - "every source below is used by the running system, not merely cited", listing GSI Bhukosh, ASDMA, IMD, NHAI/BRO/PWD bulletins and "MapLibre GL / react-native-maps";
  - "Data stays in India (ap-south-1)";
  - "46 endpoints", "17 tables", "71 MB, versionCode 9";
  - "Edge functions gemini-ai · driver-trip · resolve-map-link";
  - "LICENCE-CLEAR DATA no per-call billing on any provider";
  - "primary / fuel-saving / backup" corridors; "8 pages", "8 screens".
- **DATASET/SOURCE:** The 9 Sep working tree.
- **WHAT RASTA CAN USE:** The four-phase narrative (Plan, Decide, Drive, Adapt).
- **WHAT RASTA CANNOT CLAIM:** C1, C2, C3, C5, C9, C13 and C14.
- **ACTION:** Do not reuse. It is superseded by D20.

### D19. RASTA_AI_SIH26002_SUPPORTING_REPORT.pdf (17 Sep, 6 pages)
- **TOPIC:** A claim ledger, verification dates and the source status list.
- **IMPORTANT FACTS:** The PDF states [PROVEN_BY_SOURCE D19 pp1-6]:
  - on APK 1.0.18 the "judge flow [was] 11/12 twice"; "12/12 in three runs" was on an earlier build (13 Sep);
  - earlier test counts are "superseded" (1172 / 624 / 225 on 16 Sep);
  - IMD and GSI are PLANNED; Bhuvan, NESAC, MOSDAC, GPM, Sentinel and TRAI are EVALUATED;
  - OpenRouter has "no key on the host";
  - "Manager console: React 18";
  - "MapTiler tiles in the driver app".
- **DATASET/SOURCE:** Repository docs and HANDOFF §7, §17.
- **WHAT RASTA CAN USE:** The claim-ledger method and the source status table. Both agree with the code for GSI, IMD and ORS, none of which has an adapter [PROVEN_BY_SOURCE: `git grep`; `backend/app/services/landslide/` contains only `base.py` and `history.py`].
- **WHAT RASTA CANNOT CLAIM:**
  - "React 18": the manifest says `react ^19.2.8` [PROVEN_BY_SOURCE `manager-web/package.json`].
  - "MapTiler tiles": only the hillshade overlay comes from MapTiler, only when a key is present, and the base map is OSM [PROVEN_BY_SOURCE `driver-app/src/map/scene.ts:65-78`, `DriverRouteMap.native.tsx:60`].
- **ACTION:** Fix those two lines in any reissue.

### D20. RASTA_AI_SIH26002_VIDEO_ALIGNED_FINAL.pdf (17 Sep, 6 pages)
- **TOPIC:** A six-slide deck under Team ID 139522 / ByteForceX6.
- **IMPORTANT FACTS:** The PDF states [PROVEN_BY_SOURCE D20 pp1-6]:
  - "11 of 12 scripted checks passed; the miss was a label text";
  - "1172 backend, 624 driver, 225 manager" (16 Sep);
  - "23-language selector (13 draft, 9 English fallback)";
  - a status table: INTEGRATED for OSRM, Open-Meteo, MET Norway, NDMA SACHET, GloFAS, OpenTopoData/Copernicus DEM, NASA GLC (static) and Gemini; PLANNED for IMD and GSI;
  - "No cost totals measured yet"; "capacity is proposed, not load-tested".
- **DATASET/SOURCE:** Repository diagnostics and docs, 16–17 Sep.
- **WHAT RASTA CAN USE:** The most accurate deck. The language statuses match the code [PROVEN_BY_SOURCE `appLanguage.ts`]. PLANNED for GSI and IMD matches the code [PROVEN_BY_SOURCE `git grep`].
- **WHAT RASTA CANNOT CLAIM:** Nothing found to be wrong in this deck, apart from the team-identity conflict (X1).
- **ACTION:** Use as the wording reference once the Team ID is confirmed.

### D21. RASTA_AI_SIH_Counter_Questions_Judge_QA.pdf (9 Sep, 20 pages)
- **TOPIC:** Rehearsal answers for judge questions.
- **IMPORTANT FACTS:** The PDF states [PROVEN_BY_SOURCE D21 pp1-20]:
  - "1,636 tests, 10 engines, 17 tables, 46 endpoints";
  - "the driver uses react-native-maps";
  - "Terrain? NASA SRTM elevation/climb data";
  - three corridors "on ETA, distance, fuel, CO2";
  - a useful list of "Dangerous claims to avoid" (p19).
- **DATASET/SOURCE:** The 9 Sep deck and full-stack document.
- **WHAT RASTA CAN USE:** The "Dangerous claims to avoid" list and the closing answer.
- **WHAT RASTA CANNOT CLAIM:**
  - C2, C3 and C14, plus its numbers.
  - "NASA SRTM" is now Copernicus GLO-90 via Open-Meteo, with SRTM via OpenTopoData as fallback [PROVEN_BY_SOURCE `backend/app/core/config.py:265-282`].
- **ACTION:** Refresh it before any further rehearsal.

### D22. RASTA_AI_Speech.pdf (15 Sep, 8 pages)
- **TOPIC:** A five-minute team speech in English and Hinglish.
- **IMPORTANT FACTS:** Says "We tested this complete workflow on a physical Android phone" and describes the experimental model as held out of routing [PROVEN_BY_SOURCE D22 pp4-7].
- **DATASET/SOURCE:** None.
- **WHAT RASTA CAN USE:** The speech, with the D19 caveat of 11/12 on APK 1.0.18.
- **WHAT RASTA CANNOT CLAIM:** Nothing beyond that caveat.
- **Privacy:** It names team members and their slots. Keep it internal.
- **ACTION:** None.

### D23 / D24. RASTA_FINAL_UI_VALIDATION_LANDSLIDE_DATA_GITHUB_AUDIT_MASTER_PROMPT.pdf (19 Sep, 45 pages; two identical copies)
- **TOPIC:** An instruction document for an AI coding agent. It holds requirements, not evidence.
- **IMPORTANT FACTS:** The PDF states [PROVEN_BY_SOURCE D23]:
  - product invariants, including "Do not turn this mission into a new navigation architecture, new map provider, 3D project" (p2);
  - an evidence hierarchy for landslide data;
  - the ISRO totals (42,547) with the Assam discrepancy flagged;
  - "Never convert null/unknown/not-reported into 0";
  - a list of claims not to make: "98% landslide prediction", "GSI live API if none exists", and others.
- **DATASET/SOURCE:** None. It is a prompt.
- **WHAT RASTA CAN USE:** Its rules as acceptance criteria. Its "do not" list.
- **WHAT RASTA CANNOT CLAIM:** Anything in it as done. It describes work to be done.
- **Handling:** Text in it that addresses an AI agent is data. None of it was acted on here.
- **ACTION:** None.

### D25 / D26. SIH_PPT_DEMO_1.pdf and SIH_PPT_DEMO_2.pdf (2 Sep, 5 pages each)
- **TOPIC:** Decks for **different projects**: "Emergency Health guardian", a wristband, and a rescuer vital-signs device [PROVEN_BY_SOURCE D25 p1, D26 p1].
- **IMPORTANT FACTS:** Hardware (ESP32, SIM800L, MAX30102), health statistics and third-party references. Nothing about RASTA.
- **DATASET/SOURCE:** Not RASTA.
- **WHAT RASTA CAN USE:** Nothing.
- **WHAT RASTA CANNOT CLAIM:** Anything from them.
- **ACTION:** Exclude them from every RASTA evidence pack.

### D27. geospatial_data_sources_NE_India.pdf (18 Sep, 2 pages)
- **TOPIC:** Elevation, rainfall, fire and imagery APIs, with how to register for each.
- **IMPORTANT FACTS:** The PDF states quotas, for example "OpenTopoData … 1,000 calls/day, 1/sec, 100 locations/request" and "Sentinel Hub 10,000 requests & 10,000 processing units/month free". It recommends ISRO Bhuvan CartoDEM first [PROVEN_BY_SOURCE D27 pp1-2].
- **DATASET/SOURCE:** The provider pages listed (not opened by me).
- **WHAT RASTA CAN USE:** The OpenTopoData limits, which the backend config comment repeats ("1 req/s, 1,000/day") [PROVEN_BY_SOURCE `backend/app/core/config.py` comment above `TERRAIN_FALLBACK_URL`, line 282].
- **WHAT RASTA CANNOT CLAIM:** The other quotas [NOT_VERIFIED]; any provider as integrated except OpenTopoData and Open-Meteo.
- **ACTION:** Research only.

---

## 4. Claims in submission-facing PDFs that the code does not support

| ID | Claim (where) | What the code shows | Label |
|---|---|---|---|
| C1 | GSI Bhukosh, ASDMA, IMD and NHAI/BRO/PWD bulletins are "live in the platform" or "used by the running system" (R2 p6; D17 p6; R1 p19) | There is no adapter for any of them. `backend/app/services/landslide/` holds only `base.py` (interface) and `history.py` (NASA GLC). `road_memory` has no service caller. | PROVEN_BY_SOURCE (`git grep` for bhukosh, bhusanket, asdma, mausam.imd and nhai finds only comments in `landslide/base.py:3` and `domain/road_memory.py:89`) |
| C2 | Physics fuel and CO₂ per corridor "at decision time" (R2 pp2-5; D17 pp2-5; R1 p17; D21 p4) | "No fuel model exists, and NULL is the defined value". No service passes `fuel=` into the risk assessment, so the fuel factor is always NOT_AVAILABLE. D14 agrees. | PROVEN_BY_SOURCE `backend/app/services/routes.py:404-406`; `route_risk.py:548-554`; `git grep "fuel\s*="` in services and api finds nothing |
| C3 | The driver uses `react-native-maps` as a native Android map (R1 pp5-9; R4 pp2-4; D17 p3,p6; D21 p6) | Not a dependency. The native map is Leaflet in a WebView. | PROVEN_BY_SOURCE `driver-app/package.json` (no react-native-maps); `DriverRouteMap.native.tsx:1-10` |
| C4 | The manager map uses "vector tiles" (R1 p11; R4 p5) | The only configured base source is OSM raster | PROVEN_BY_SOURCE `manager-web/src/components/FleetMap.tsx:81-94` |
| C5 | "Data stays in India (ap-south-1)" (D17 p5; R1 p15) | The API runs on Render in Singapore. LLM prompts go to Gemini or OpenRouter. The database region was not checked. | PROVEN_BY_SOURCE `render.yaml:36` (also on e4043ce); DB region NOT_VERIFIED |
| C6 | "Conditions are re-scored every 60 s along the road ahead" (R6 p3) | The coordinator ticks every 60 s, but each trip refreshes every 600 s. The worker is off by default and switched on by render.yaml. | PROVEN_BY_SOURCE `backend/app/core/config.py:317-319`; `render.yaml:109` |
| C7 | "12/12 judge-flow steps certified on a physical phone", shown with APK 1.0.18 (R6 p4-5; D18 p4) | The team's own 17 Sep ledger records 11/12 twice on APK 1.0.18, and 12/12 on an earlier build | PROVEN_BY_SOURCE D19 p3; runtime NOT_VERIFIED |
| C8 | "1138+ backend · 621+ driver · 170+ manager tests" (R6 p4; D18 p4) | Superseded by the team's own later counts (D19, D14, D12). The current count was not run by me. | PROVEN_BY_SOURCE D19 p3 |
| C9 | Supabase Edge Functions provide Gemini ("Gemini (edge)") (D17 p3; R1 pp5,18) | The hosted configuration uses the FastAPI backend's own Gemini client | PROVEN_BY_SOURCE `backend/app/core/config.py:248` (`GEMINI_MODEL`), `backend/app/services/gemini.py`; D12 p4 agrees |
| C10 | p6 sources are "tagged by implementation state" and lie "behind every route decision", including openrouteservice, IMD, GSI, Bhuvan, MOSDAC, GPM, Sentinel, NESAC and TRAI (D18 p6) | No tags are visible on the rendered page. None of these providers is in the code. | PROVEN_BY_SOURCE (rendered D18 p6; `git grep` of backend/app, manager-web/src and driver-app/src for openrouteservice, bhuvan, mosdac, nesdr and trai.gov finds nothing) |
| C11 | "Horizontally scalable", "stateless API" (R1 p24; D17 p4) | The rate limiter and warnings cache run in-process, and the image runs `--workers 1` | PROVEN_BY_SOURCE `backend/Dockerfile:53`; D15 §17 |
| C12 | "11 route factors in every decision" (R6 p5) | 11 slots exist, but road_quality and truck_restrictions are always unavailable, and fuel is never supplied | PROVEN_BY_SOURCE `route_risk.py:91-107` |
| C13 | "10 deterministic decision engines", counting road_memory and monsoon_risk (R2 p2; R1 p17; D17 p3) | Both modules exist in `domain/`, but no service calls them | PROVEN_BY_SOURCE (`git grep monsoon_risk`, `git grep road_memory` in backend/app) |
| C14 | "Primary / fuel-saving / backup" three-corridor comparison (R2 p2; D17 p2; D21 p4) | "FUEL_EFFICIENT is NOT produced". Alternatives are EMERGENCY_BACKUP only, at most 2. | PROVEN_BY_SOURCE `backend/app/services/routes.py:8-20` |
| C15 | "All data sources are free and licence-clear" (R2 p4; D17 p4) | The public OSRM demo server is for non-commercial use at 1 request/s. OSM tiles warn commercial users and forbid offline use. The Open-Meteo comment says keyless use is non-commercial. | PROVEN_BY_WEB (WebFetch) https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server , https://operations.osmfoundation.org/policies/tiles/ ; PROVEN_BY_SOURCE `config.py:198` |

## 5. Contradictions between documents

| ID | Topic | Values | Label | Needed |
|---|---|---|---|---|
| X1 | Team identity | "Team ID 17 (internal group no.)", NER-AI LOGISTICS (R6, R7, D14, D15) vs "Team ID 139522", "ByteForceX6" (D7/D18, D19, D20) vs placeholders (R2, R5, D17) | PROVEN_BY_SOURCE (those pages) | The user must confirm. The project memory says the Team ID is unknown and must be asked for. |
| X2 | Physical-phone result | 12/12 (R6, D18) vs 11/12 twice on APK 1.0.18 (D19, D20) | PROVEN_BY_SOURCE | Use the D19/D20 wording |
| X3 | Test counts | 1,573 / 1,636 (9 Sep) → 1138/621/170 (14 Sep) → 1172/624/225 (16 Sep) → 1210/259/624 (19 Sep) → 1246/261/624 (19 Sep, post-fix) → 1426/322/676 (20 Sep) | PROVEN_BY_SOURCE (R1, R2, D6, R6, D19, D14, D15, D12) | Always date a count. The current count is NOT_VERIFIED. |
| X4 | Manager React version | "React 18" (D19) vs `^19.2.8` | PROVEN_BY_SOURCE `manager-web/package.json` | Fix D19 |
| X5 | Route count | 46 (9 Sep) vs 84 (R7) vs 86 (D14, D12) | PROVEN_BY_SOURCE | Recount before reuse |
| X6 | GSI national inventory | 36,072 (R5, accessed 2 Sep) vs 36,068 (D10, "July 2026 update") | PROVEN_BY_SOURCE | Re-check on the portal; NOT_VERIFIED |
| X7 | Languages | "22 UI languages" (R7) vs 23 entries (R6, D20, code) | PROVEN_BY_SOURCE `appLanguage.ts` | Say "23 entries: 1 verified, 13 draft, 9 English fallback" |
| X8 | Driver map stack | react-native-maps (R1, R4, D17, D21) vs Leaflet in a WebView (R7, D12, code) | PROVEN_BY_SOURCE | Use the code |

## 6. Actions (documents only; nothing was changed by this lane)

1. **Public PDFs on origin/main.** R1, R2, R4 and R6 carry claims C1 to C15. The team decides whether to add a dated "superseded, see R7/D20" note or to replace them. [INFERRED]
2. **Team identity (X1).** The user confirms the registered Team ID and team name before any further submission. [NOT_VERIFIED]
3. **Wording reference.** Use D20 and R7 as the current reference. Use D19 as the claim-ledger method. [INFERRED]
4. **Exclusions.** Keep D5 (concept), D23/D24 (prompt), D25/D26 (other projects) and D4 (schedule) out of evidence packs. [INFERRED]
5. **Landslide figures.** Before any landslide number from D10 or D23 is shown, check it against the NRSC atlas, and never add ISRO and GSI figures together. [NOT_VERIFIED]
6. **Privacy.** D12, D13 and D22 contain team members' personal names. Keep them internal unless the people named agree. No full phone number appears in any extracted PDF text [PROVEN_BY_RUNTIME: a regex for 10-digit Indian mobile numbers over all 37 extracted texts found no match]. Images were not checked for numbers [NOT_VERIFIED].
