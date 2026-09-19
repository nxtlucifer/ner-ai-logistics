# Research plugin source ledger: NER-wide logistics sources

Owner: lane `research-ner`. Written 26 September 2026.

This ledger covers the public sources for logistics across all eight North-Eastern states:
roads, the region itself, disaster, weather, flood, earthquake, fire, terrain, administration,
rail, air cargo, inland waterways, points of interest and mobile connectivity. It **extends**
`docs/FINAL_SOURCE_ADMISSION_LEDGER.md` (live providers, keyed providers, research sources,
supplied PDFs) and `docs/research/GITHUB_REFERENCE_AUDIT.md` (16 repositories), and reads them
together with `docs/research/SOURCE_ADMISSION_MATRIX.md` (the portals named in the supplied
PDFs). It does not re-audit any of them. A source that one of them already classifies is marked
`ADMITTED_ALREADY`, with the status it holds there and the file:line of that record. This ledger
changes none of those statuses. Section 0 lists places where the web evidence or the source tree
now disagrees with them, or where two of them disagree with each other.

Revised on 26 September 2026 after a review. The corrections are listed in the last section.

## Method

- Each source was looked up with WebSearch, and then the **publisher's own page** was read
  with WebFetch on 26 September 2026. A search-result snippet on its own is never used as
  evidence. When only a search snippet was available, the claim is labelled `NOT_VERIFIED`
  and the URL is marked `NOT_FETCHED`.
- No dataset was downloaded. Three public **reports** (PDFs, not datasets) were saved
  automatically by the fetch tool to the session's tool-results cache, outside this
  repository, and read as text: GSI's landslide note (409 KB), NHIDCL's project-status list
  (336 KB) and TRAI press release 23/2025 (1.4 MB). None of them is in the repo.
- When a site refused an automated read (403, connection refused or reset, TLS failure, or a
  bot-verification page), the source is recorded as `BLOCKED` and nothing more was tried.
  No CAPTCHA was touched. No form was submitted. No login was attempted.
- There was one read-only query against a public API: a USGS FDSN `count` request (see E2).
  Nothing hosted by RASTA was contacted.
- During the revision, the MET Norway terms, the Tripura SDMA home page and its
  `/current-weather-api` page, and the IWAI NW-16 page were read again with WebFetch. The TRAI
  press release PDF was fetched again into the tool-results cache outside the repository and
  its text extracted locally. The three Consensus queries in §K were run again. All on
  26 September 2026.

### Evidence labels

| Label | Meaning here |
|---|---|
| `PROVEN_BY_WEB` | Read on the publisher's page at the URL shown, on the date seen. |
| `PROVEN_BY_SOURCE` | Read in this repository at the file:line shown. |
| `PROVEN_BY_RUNTIME` | Observed as the output of a tool call made in this session. |
| `INFERRED` | Reasoned from evidence but not observed directly. **Not a fact.** |
| `NOT_VERIFIED` | Seen only in a search snippet or third-party text, or the page did not render the content. **Not a fact.** |
| `BLOCKED` | The publisher's site refused the read. |

In each source block below, the `EVIDENCE` line gives the label for the record as a whole.
A field that rests on different evidence has its own label in brackets.

### Admission values

| Value | Meaning |
|---|---|
| `ADMITTED_ALREADY` | Already classified in the final ledger, the GitHub audit or `SOURCE_ADMISSION_MATRIX.md`. That status is shown with its file:line and is not changed here. |
| `CANDIDATE` | Relevant and apparently usable. It still needs engineering and a named decision before any code references it. |
| `NEEDS_LEGAL` | Relevant, but the licence or reuse terms are missing, restrictive or unread. It needs a human decision before any reuse. |
| `REJECTED` | Not usable for RASTA's purpose. The reason is given. |

---

## 0. Where the existing ledgers have drifted

These were found while cross-checking. They are recorded here for the owner of the final ledger
to act on. This lane does not edit that file.

| # | Existing statement | What the evidence shows | Evidence |
|---|---|---|---|
| 0.1 | The final ledger §1 lists **Overpass** as `ADOPT_NOW` and "called at runtime", with implementation in `backend/app/services/places/`. | The application does **not** call Overpass at runtime. The only `.py` file that holds the Overpass endpoint is the developer acquisition script, and the snapshot file itself says it is read from disk. | `PROVEN_BY_SOURCE`: `backend/scripts/acquire_places_snapshot.py:46`; `backend/app/services/places/data/corridor_snapshot.json:6-9` |
| 0.2 | The final ledger §5b says the places snapshot is "720 records ... no `amenity=fuel` records at all". | That is true of `HEAD` and `origin/main` (retrieved 2026-09-05). The **working tree** snapshot is different: retrieved 2026-09-20, 4,366 records (EMERGENCY 1,984; HOTEL 1,261; FUEL 726; TYRES 325; REST 70), per-state bounding boxes for all eight states. The fuel layer is therefore **not on the hosted build**. | `PROVEN_BY_SOURCE`: `corridor_snapshot.json:8` plus its `counts` block, compared with `git show origin/main:` of the same file |
| 0.3 | The final ledger §6 judge-safe line: "Terrain is SRTM elevation via OpenTopoData." Its §1 Open-Meteo row covers "Forecast and observed weather" only. | The **primary** DEM in code is Copernicus DEM GLO-90 through the Open-Meteo elevation API, with no key. OpenTopoData SRTM is the fallback. The final ledger does not list the elevation endpoint or Copernicus DEM. The GitHub audit mentions Copernicus DEM only as an entry in the `awesome-spatial-data` catalogue. `SOURCE_ADMISSION_MATRIX.md` lists "Open-Meteo elevation" as `ADOPT_NOW` without naming the data under it, and lists Copernicus DEM as `VALIDATION_ONLY` because "All need an account this project does not hold". The Open-Meteo path needs no account. So the primary DEM has no consistent admission record. This ledger marks Copernicus DEM `CANDIDATE` (T1) until the ledger owner records one decision. | `PROVEN_BY_SOURCE`: `backend/app/services/terrain.py:5-11`, `backend/app/core/config.py:280-282`, `docs/FINAL_SOURCE_ADMISSION_LEDGER.md:32,35,148`, `docs/research/GITHUB_REFERENCE_AUDIT.md:77-78`, `docs/research/SOURCE_ADMISSION_MATRIX.md:48-49` |
| 0.4 | `SPATIAL_SOURCE_AUDIT.md` §1 says `awesome-spatial-data` is `NOT_AUDITED`. | `GITHUB_REFERENCE_AUDIT.md` records it as audited on 20 September 2026 (MIT, `REFERENCE_ONLY`). The spatial audit is stale on this point. | `PROVEN_BY_SOURCE`: `docs/research/SPATIAL_SOURCE_AUDIT.md:6`, `docs/research/GITHUB_REFERENCE_AUDIT.md:33` |
| 0.5 | The final ledger's MET Norway row gives "User-Agent required" as the only auth condition. | MET Norway's terms say every request "must (if possible)" carry a User-Agent with the application or domain name, and that you "should also include a company email address or a link to the company website". They add that if MET Norway cannot contact you, "you risk being blocked without warning". The terms also say apps "should cache all API responses" and give `If-Modified-Since` as an example of using cache headers. RASTA's shared weather User-Agent names the app and project but gives no contact, and no `If-Modified-Since` header is set anywhere in `backend/app`. | `PROVEN_BY_WEB`: https://api.met.no/doc/TermsOfService; `PROVEN_BY_SOURCE`: `backend/app/services/weather/open_meteo.py:47,159`, and a case-insensitive grep for `If-Modified` in `backend/app` (no match) |
| 0.6 | The final ledger lists Open-Meteo and OSRM as "fair use". | Both publishers limit their free service to **non-commercial** use. The limits are stated in O1 and R5 below. That is acceptable for a hackathon prototype. It is a legal question for any ministry deployment. | `PROVEN_BY_WEB` (O1, R5) |
| 0.7 | The final ledger §3 lists "GSI / Bhusanket" as `BLOCKED` and says it "Would be the authoritative CURRENT_OFFICIAL_EVENT source for landslides. No machine interface found." `SOURCE_ADMISSION_MATRIX.md` lists "GSI / Bhusanket / Bhukosh" as `BLOCKED`. | This ledger keeps `BLOCKED` (D4, D5, D6). Two findings may matter to the owner. (a) The Bhusanket portal and GSI's 2024 note were readable without a login on 26 September 2026, and the portal offers a "Landslide Inventory (Field Validated)" download and a state-wise report list. There is still no API and no licence text, so the "no machine interface" reason still holds, but a manual download path exists. (b) GSI's own note says operational landslide bulletins covered no NE state as of August 2024, so the publisher does not support the CURRENT_OFFICIAL_EVENT expectation for the NE. Any status change needs GSI's written reuse terms and a named decision. | `PROVEN_BY_SOURCE`: `docs/FINAL_SOURCE_ADMISSION_LEDGER.md:65`, `docs/research/SOURCE_ADMISSION_MATRIX.md:43`; `PROVEN_BY_WEB`: the D5 URLs |
| 0.8 | The final ledger §3 lists "ISRO Bhuvan / CartoDEM" as `BLOCKED`. | `SOURCE_ADMISSION_MATRIX.md` lists "Bhuvan/CartoDEM" as `VALIDATION_ONLY`. The two records disagree. The web read in D8 could not settle it, because the pages are JavaScript-rendered. | `PROVEN_BY_SOURCE`: `docs/FINAL_SOURCE_ADMISSION_LEDGER.md:58`, `docs/research/SOURCE_ADMISSION_MATRIX.md:49` |

---

## Index

| ID | Source | Admission | Evidence |
|---|---|---|---|
| R1 | MoRTH | CANDIDATE | NOT_VERIFIED |
| R2 | NHAI (site and Data Lake GIS dashboard) | NEEDS_LEGAL | PROVEN_BY_WEB |
| R3 | NHAI Rajmargyatra app | REJECTED | NOT_VERIFIED |
| R4 | NHIDCL | NEEDS_LEGAL | PROVEN_BY_WEB |
| R5 | OSRM public demo server | ADMITTED_ALREADY (`ADOPT_NOW`) | PROVEN_BY_WEB |
| M1 | MDoNER | NEEDS_LEGAL | BLOCKED |
| M2 | North Eastern Council | CANDIDATE | PROVEN_BY_WEB |
| M3 | NER Databank (NEDFI) | NEEDS_LEGAL | PROVEN_BY_WEB |
| D1 | NDMA website (hazard atlases, LRMS) | NEEDS_LEGAL | PROVEN_BY_WEB |
| D2 | NDMA SACHET | ADMITTED_ALREADY (`ADOPT_NOW`) | PROVEN_BY_WEB |
| D3 | State SDMAs (eight states) | CANDIDATE (Arunachal), REJECTED as feeds (others) | PROVEN_BY_WEB / BLOCKED per state |
| D4 | GSI Bhukosh | ADMITTED_ALREADY (`BLOCKED`) | BLOCKED |
| D5 | GSI Bhusanket and National Landslide Forecasting Centre | ADMITTED_ALREADY (`BLOCKED`; new evidence in 0.7) | PROVEN_BY_WEB |
| D6 | GSI main site | ADMITTED_ALREADY (`BLOCKED`) | BLOCKED |
| D7 | NRSC Landslide Atlas of India | ADMITTED_ALREADY (`RESEARCH_ONLY`) | PROVEN_BY_WEB |
| D8 | NRSC Bhuvan and NOEDA | ADMITTED_ALREADY (`BLOCKED` in the final ledger; `VALIDATION_ONLY` in the matrix, see 0.8) | NOT_VERIFIED |
| D9 | NRSC NDEM | CANDIDATE | NOT_VERIFIED |
| W1 | IMD (mausam, API gateway, Data Supply Portal) | ADMITTED_ALREADY (`VALIDATION_ONLY`) | PROVEN_BY_WEB |
| O1 | Open-Meteo (forecast and elevation) | ADMITTED_ALREADY (`ADOPT_NOW`; the elevation use only in the matrix, see 0.3) | PROVEN_BY_WEB |
| O2 | MET Norway | ADMITTED_ALREADY (`ADOPT_NOW`) | PROVEN_BY_WEB |
| F1 | CWC flood forecasting (FFS portal, FFM dashboard, BBBO) | CANDIDATE | PROVEN_BY_WEB |
| F2 | Open-Meteo Flood API (GloFAS) | ADMITTED_ALREADY (`ADOPT_NOW`) | PROVEN_BY_WEB |
| F3 | ASDMA (Assam flood report, FRIMS) | CANDIDATE | PROVEN_BY_WEB |
| E1 | National Center for Seismology | NEEDS_LEGAL | PROVEN_BY_WEB |
| E2 | USGS FDSN event service | ADMITTED_ALREADY (`BLOCKED`, no layer yet) | PROVEN_BY_WEB |
| FI1 | NASA FIRMS | ADMITTED_ALREADY (`BLOCKED`, key not obtained) | PROVEN_BY_WEB |
| T1 | Copernicus DEM | CANDIDATE (in code, no consistent admission record, see 0.3) | PROVEN_BY_WEB |
| T2 | NASA SRTMGL1 v003 | ADMITTED_ALREADY (through OpenTopoData and AWS Terrain Tiles) | PROVEN_BY_WEB |
| T3 | OpenTopoData | ADMITTED_ALREADY (`ADOPT_NOW`) | PROVEN_BY_WEB |
| A1 | Local Government Directory (LGD) | NEEDS_LEGAL | PROVEN_BY_WEB |
| A2 | data.gov.in (OGD Platform) | NEEDS_LEGAL | BLOCKED |
| A3 | Census of India | NEEDS_LEGAL | BLOCKED |
| A4 | geoBoundaries / GADM | ADMITTED_ALREADY (`RESEARCH_ONLY`, open item) | PROVEN_BY_SOURCE |
| RL1 | Northeast Frontier Railway | CANDIDATE | PROVEN_BY_WEB |
| RL2 | FOIS / RailSAHAY | NEEDS_LEGAL | PROVEN_BY_WEB |
| RL3 | Railway Board statistics | CANDIDATE | PROVEN_BY_WEB |
| AI1 | AAI cargo and AAICLAS | NEEDS_LEGAL | PROVEN_BY_WEB |
| AI2 | AAI monthly traffic news | NEEDS_LEGAL | PROVEN_BY_WEB |
| AI3 | Guwahati LGBI airport operator site | CANDIDATE | PROVEN_BY_WEB |
| IW1 | IWAI NW-2 (Brahmaputra) | CANDIDATE | PROVEN_BY_WEB |
| IW2 | IWAI NW-16 (Barak) | CANDIDATE | PROVEN_BY_WEB |
| IW3 | IWAI LAD and river notices | CANDIDATE | PROVEN_BY_WEB |
| P1 | OpenStreetMap data | ADMITTED_ALREADY (`ADOPT_NOW`) | PROVEN_BY_WEB |
| P2 | Overpass API | ADMITTED_ALREADY (`ADOPT_NOW`, developer-time only, see 0.1) | PROVEN_BY_WEB |
| P3 | Nominatim | ADMITTED_ALREADY (`ADOPT_NOW`) | PROVEN_BY_WEB |
| C1 | TRAI coverage-map mandate | CANDIDATE (as a pointer only) | PROVEN_BY_WEB |
| C2 | Operator coverage maps (Airtel, Jio, Vi, BSNL) | NEEDS_LEGAL | NOT_VERIFIED |
| C3 | DoT Tarang Sanchar | REJECTED | PROVEN_BY_WEB |
| K1 | Consensus academic search (Bio Research plugin) | see §K | PROVEN_BY_RUNTIME |

---

## R. Road network and corridors

### R1: Ministry of Road Transport & Highways (MoRTH)
- SOURCE: MoRTH website: Basic Road Statistics of India, NH notifications.
- OWNER: Ministry of Road Transport & Highways, Government of India.
- URL: https://morth.nic.in/ (301 redirect to morth.gov.in). http://morth.gov.in/ and http://morth.gov.in/basic-road-statistics-india were fetched, but **only the page header rendered**.
- DATE: 2026-09-26.
- LICENSE: UNKNOWN.
- AUTH: none for reading. COST: none seen. RATE_LIMIT: UNKNOWN.
- COVERAGE: national, including all eight NE states [NOT_VERIFIED].
- FRESHNESS: search results list Basic Road Statistics editions up to 2019-20 [NOT_VERIFIED; the edition pages were not read].
- NER_RELEVANCE: high in principle: the NH network and statistics.
- RELIABILITY: authoritative publisher. The content read here was empty.
- USE_CASE in RASTA: background statistics for reports. It is not a routing input, because OSRM on OSM geometry is the only thing permitted to say a road exists.
- LIMITATIONS: no machine interface or geometry download was found. The statistics are aggregates, not segment status.
- ADMISSION: CANDIDATE (reference only).
- EVIDENCE: NOT_VERIFIED.

### R2: National Highways Authority of India (NHAI)
- SOURCE: NHAI website and the NHAI Data Lake GIS dashboard ("National Highways Projects under Execution").
- OWNER: NHAI, under MoRTH.
- URL: https://nhai.gov.in/ (header only rendered); https://datalakeg.nhai.gov.in/nhai/mISC/DataLakeGISDashboard (fetched).
- DATE: 2026-09-26.
- LICENSE: UNKNOWN. No terms were visible on the dashboard.
- AUTH: the dashboard rendered without a login prompt. COST: none seen. RATE_LIMIT: UNKNOWN.
- COVERAGE: projects under execution, with lengths, lanes, project types, capital costs and financial progress, filterable by state and Lok Sabha constituency. Which NE states appear was **not confirmed**.
- FRESHNESS: UNKNOWN.
- NER_RELEVANCE: medium. Construction zones affect travel time.
- RELIABILITY: official, and project-oriented rather than traffic-oriented.
- USE_CASE in RASTA: a possible manual "works in progress" context note on a corridor. It is not road status.
- LIMITATIONS: no downloadable layer or API was confirmed. It covers NHAI projects only, not NHIDCL, BRO or state PWD.
- ADMISSION: NEEDS_LEGAL (terms unread).
- EVIDENCE: PROVEN_BY_WEB.

### R3: NHAI Rajmargyatra app
- SOURCE: citizen highway app (weather, tolls, amenities, complaints).
- OWNER: NHAI.
- URL: NOT_FETCHED. Only app-store and news search results were seen.
- DATE: 2026-09-26. LICENSE: UNKNOWN. AUTH / COST / RATE_LIMIT: UNKNOWN.
- COVERAGE: National Highways [NOT_VERIFIED]. FRESHNESS: UNKNOWN.
- NER_RELEVANCE: low for RASTA. It is a consumer app.
- RELIABILITY: UNKNOWN.
- USE_CASE in RASTA: none.
- LIMITATIONS: no public data interface was found. The search summary itself says no API information was present.
- ADMISSION: REJECTED (no machine interface; not a data source).
- EVIDENCE: NOT_VERIFIED.

### R4: National Highways & Infrastructure Development Corporation (NHIDCL)
- SOURCE: organisation page and "NHIDCL-Completed and Ongoing Projects Status as on 31-07-2025" (PDF report).
- OWNER: NHIDCL, a Schedule 'A' PSU under MoRTH.
- URL: https://www.nhidcl.com/en/our-organisation (fetched); https://www.nhidcl.com/sites/default/files/2025-08/nhidcl_completed_ongoing_as_on_31.07.2025_1_0.pdf (fetched, read as text); https://nhidcl.com/ (fetched, no data).
- DATE: 2026-09-26.
- LICENSE: UNKNOWN. The footer links "Terms & Conditions", which was not read.
- AUTH: none. COST: none. RATE_LIMIT: UNKNOWN.
- COVERAGE: the organisation page names "the entire North Eastern Region (NER)" as its domain, plus J&K, Ladakh, A&N Islands and Uttarakhand. All eight NE state names appear in the status PDF.
- FRESHNESS: the status list is as on 31-07-2025, about 14 months before the date seen.
- NER_RELEVANCE: high. NHIDCL builds much of the NE national-highway work.
- RELIABILITY: official progress report.
- USE_CASE in RASTA: manual context on which NH sections were under construction on a stated date.
- LIMITATIONS: a table in a PDF, with NH number, chainage in km as text, length, cost, progress % and dates. **It has no coordinates**, so mapping it to geometry would be a manual and error-prone job. The PDF also lists **contractor contact email addresses**, which is personal data that must not be ingested. It is not live road status.
- ADMISSION: NEEDS_LEGAL.
- EVIDENCE: PROVEN_BY_WEB.

### R5: OSRM public demo server
- SOURCE: `router.project-osrm.org`. RASTA uses it as the routing fallback.
- OWNER: the Project-OSRM maintainers.
- URL: https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server (fetched).
- DATE: 2026-09-26.
- LICENSE: the service terms are a usage policy. The road data underneath is OSM ODbL (see P1).
- AUTH: none. COST: none.
- RATE_LIMIT: at most 1 request per second, and only for "reasonable, non-commercial use-cases". The policy states that no guarantees on uptime, latency or data updates are given.
- COVERAGE: global. FRESHNESS: UNKNOWN (the policy promises no update schedule).
- NER_RELEVANCE: high. It is RASTA's road truth.
- RELIABILITY: best-effort, with no SLA.
- USE_CASE in RASTA: live routing, configured as `ROUTING_FALLBACK_URL` [PROVEN_BY_SOURCE: `backend/app/core/config.py:182`].
- LIMITATIONS: the non-commercial condition and the missing SLA both matter for any real deployment. A self-hosted OSRM would remove both, and `ROUTING_PRIMARY_URL` already exists for that [PROVEN_BY_SOURCE: `config.py:181`].
- ADMISSION: ADMITTED_ALREADY (`ADOPT_NOW` in the final ledger §1).
- EVIDENCE: PROVEN_BY_WEB.

---

## M. MDoNER and the North Eastern Council

### M1: Ministry of Development of North Eastern Region (MDoNER)
- SOURCE: MDoNER website.
- OWNER: MDoNER, Government of India.
- URL: https://mdoner.gov.in/ returned **HTTP 403**.
- DATE: 2026-09-26. LICENSE / AUTH / COST / RATE_LIMIT / COVERAGE / FRESHNESS: UNKNOWN.
- NER_RELEVANCE: high. It is the ministry behind SIH26002.
- RELIABILITY: UNKNOWN (not read).
- USE_CASE in RASTA: none until it has been read.
- LIMITATIONS: automated reads are refused.
- ADMISSION: NEEDS_LEGAL.
- EVIDENCE: BLOCKED.

### M2: North Eastern Council (NEC)
- SOURCE: NEC portal: Project Dashboard, North East Vision 2047, Transport & Communication sector.
- OWNER: North Eastern Council, under MDoNER.
- URL: https://necouncil.gov.in/ (fetched); https://necouncil.gov.in/terms-use (fetched). The transport-sector URL that was tried first returned 404.
- DATE: 2026-09-26.
- LICENSE: the Terms of Use contain **no reuse or attribution clause**, only disclaimers. Reuse terms are UNKNOWN.
- AUTH: none. COST: none. RATE_LIMIT: UNKNOWN.
- COVERAGE: the eight NE states. FRESHNESS: footer "Last Updated: 23 Sep 2026".
- NER_RELEVANCE: high for context and funded projects.
- RELIABILITY: official.
- USE_CASE in RASTA: narrative and policy context in submission documents. It supplies no operational data.
- LIMITATIONS: project dashboards and reports, not a machine interface.
- ADMISSION: CANDIDATE (documentation reference only).
- EVIDENCE: PROVEN_BY_WEB.

### M3: NER Databank (NEDFI)
- SOURCE: state and district statistics repository, linked from the NEC portal.
- OWNER: North Eastern Development Finance Corporation (NEDFI).
- URL: https://databank.nedfi.com/ (fetched).
- DATE: 2026-09-26.
- LICENSE: UNKNOWN. The footer links Terms of Use, which were not read.
- AUTH: browsing is open, and a Login option exists. COST: UNKNOWN. RATE_LIMIT: UNKNOWN.
- COVERAGE: the page says it covers 8 states, "130 Districts", and 25 sectors, including roadways.
- FRESHNESS: no update date was shown.
- NER_RELEVANCE: medium.
- RELIABILITY: a compiled secondary repository.
- USE_CASE in RASTA: none today. At most, background figures with attribution.
- LIMITATIONS: **the "130 districts" figure is the page's own statement, with no date. It must not be used as a district count for RASTA** (see A1 and the final ledger §6).
- ADMISSION: NEEDS_LEGAL.
- EVIDENCE: PROVEN_BY_WEB.

---

## D. Disaster

### D1: NDMA website (hazard atlases, Landslide Risk Management Strategy)
- SOURCE: NDMA portal: Landslide Hazard Atlas, Flood Hazard Atlases, National Landslide Risk Management Strategy, GLOF dashboard, guidelines.
- OWNER: National Disaster Management Authority.
- URL: https://ndma.gov.in/ (fetched); https://ndma.gov.in/terms-use (fetched).
- DATE: 2026-09-26.
- LICENSE: the Terms of Use say material "may be reproduced free of charge after taking proper permission", with the source acknowledged. **Permission is required.**
- AUTH: none for reading. COST: free. RATE_LIMIT: UNKNOWN.
- COVERAGE: national. FRESHNESS: page "Last Updated: 25 September 2026".
- NER_RELEVANCE: high.
- RELIABILITY: official.
- USE_CASE in RASTA: methodology references. The atlases could be quoted with permission.
- LIMITATIONS: atlases and PDFs, not a machine interface. Reproduction needs permission.
- ADMISSION: NEEDS_LEGAL.
- EVIDENCE: PROVEN_BY_WEB.

### D2: NDMA SACHET
- SOURCE: SACHET Common Alerting Protocol platform.
- OWNER: NDMA, platform by C-DOT.
- URL: https://sachet.ndma.gov.in/ (fetched).
- DATE: 2026-09-26.
- LICENSE: UNKNOWN. No terms were visible on the page.
- AUTH: none. COST: free. RATE_LIMIT: unstated. RASTA polls once per 600 s TTL [PROVEN_BY_SOURCE: `backend/app/core/config.py:298-299`].
- COVERAGE: pan-India, with alerts from NDMA, IMD, CWC, INCOIS, FSI, DGRE and state authorities. The page mentions RSS distribution "for news agencies".
- FRESHNESS: live.
- NER_RELEVANCE: high.
- RELIABILITY: the official alert channel.
- USE_CASE in RASTA: the only source allowed to produce OFFICIAL_WARNING. The feed is `.../cap_public_website/rss/rss_india.xml` [PROVEN_BY_SOURCE: `config.py:298`].
- LIMITATIONS: the page shows no API documentation or historical archive. Alerts are placed by district name, which depends on reverse geocoding.
- ADMISSION: ADMITTED_ALREADY (`ADOPT_NOW`).
- EVIDENCE: PROVEN_BY_WEB.

### D3: State Disaster Management Authorities (all eight states)

One row per state. All were read on 2026-09-26. **None publishes an API, an RSS feed or
machine-readable road-closure data on the pages read.**

| State | URL read | What was found | LICENSE | Admission | Evidence |
|---|---|---|---|---|---|
| Arunachal Pradesh | https://sdma-arunachal.in/ | "Daily Situation Report" posts dated 24–25 Sep 2026. A Disaster Survival Guide PDF. Terms & Conditions link (not read). No hazard maps or API seen. | UNKNOWN | CANDIDATE (manual daily reading) | PROVEN_BY_WEB |
| Assam | https://asdma.assam.gov.in/ | "Assam Flood Report" section, flood alerts, a link to NRSC inundation mapping, the Smart Axom app. "Last Reviewed & Updated: 11 Sep 2026". The report page itself rendered only navigation. See F3. | UNKNOWN (Copyright and Terms pages listed, not read) | CANDIDATE | PROVEN_BY_WEB |
| Manipur | https://manipur.gov.in/?page_id=16938 | District, block and department DM **plans** only. Most recent files are from March 2020. No SDMA portal was found. | UNKNOWN | REJECTED as a feed (plans only, stale) | PROVEN_BY_WEB |
| Meghalaya | https://msdma.gov.in/ | Organisation, programmes, Do's and Don'ts, notices. No situation reports, maps or data. | UNKNOWN | REJECTED as a feed | PROVEN_BY_WEB |
| Mizoram | https://dmr.mizoram.gov.in/ | Plans, policies, staff, archival news. No situation reports, maps or data. | UNKNOWN | REJECTED as a feed | PROVEN_BY_WEB |
| Nagaland | https://nsdma.nagaland.gov.in/home and /download | Connection reset on both. | UNKNOWN | NEEDS_LEGAL | BLOCKED |
| Sikkim | https://ssdma.nic.in/ (the `www.` host fails TLS name matching) | Safety tips, helpline, links to NDMA and NCS, a "Disaster History" page. No situation reports, maps or data. | UNKNOWN | REJECTED as a feed | PROVEN_BY_WEB |
| Tripura | https://tdma.tripura.gov.in/ | Links for weather update, district-wise warning, weather forecast, district and state rainfall, district-wise nowcast, and publications. These are relative links to TDMA's own pages. No IMD mention or IMD link was seen on the home page. The `/current-weather-api` link opens an HTML page with a weather widget, not a machine-readable response, and names no data source. "Last Update date: 06-08-2025". The `/reportsminutes` path returned 404. | UNKNOWN | REJECTED as a feed | PROVEN_BY_WEB |

- NER_RELEVANCE: high. SDMAs hold the ground truth on closures.
- RELIABILITY: official, but the publishing practice is uneven.
- USE_CASE in RASTA: at most, a human reviewer reads Arunachal's daily situation report and ASDMA's flood report when approving a route. This fits the existing REQUIRES_REVIEW flow. Nothing is automated.
- LIMITATIONS: there is no machine interface in any of the eight states. Closing the "current landslide incident" gap (see `SPATIAL_SOURCE_AUDIT.md` §3) remains an institutional agreement, not a scrape.

### D4: GSI Bhukosh
- SOURCE: GSI geoscience map portal. According to GSI's own note, it holds the NLSM 1:50,000 susceptibility maps and the landslide inventory "for free downloading by all" (see D5).
- OWNER: Geological Survey of India, Ministry of Mines.
- URL: https://bhukosh.gsi.gov.in/ gave **connection refused**.
- DATE: 2026-09-26.
- LICENSE: UNKNOWN. The GSI note says "free downloading". That is not a licence.
- AUTH: UNKNOWN. COST: free according to GSI's note. RATE_LIMIT: UNKNOWN.
- COVERAGE: all 19 landslide-prone states and UTs, including all eight NE states (per D5).
- FRESHNESS: UNKNOWN.
- NER_RELEVANCE: very high. It is the authoritative susceptibility and inventory source.
- RELIABILITY: authoritative.
- USE_CASE in RASTA: a HISTORICAL_INVENTORY and SUSCEPTIBILITY layer, if a human downloads it and the licence is confirmed.
- LIMITATIONS: unreachable to automated reads today, as in the earlier sessions.
- ADMISSION: ADMITTED_ALREADY (`BLOCKED` in `docs/research/SOURCE_ADMISSION_MATRIX.md:43`, row "GSI / Bhusanket / Bhukosh". The final ledger §3 row at line 65 names only "GSI / Bhusanket"). See 0.7.
- EVIDENCE: BLOCKED.

### D5: GSI Bhusanket and the National Landslide Forecasting Centre
- SOURCE: the Bhusanket landslide portal (forecast bulletin, susceptibility, state-wise reports) and GSI's note "Landslide hazard scenario & landslide forecasting in India" (dated 08.08.2024 in its file name).
- OWNER: Geological Survey of India.
- URL: https://bhusanket.gsi.gov.in/ (fetched); https://bhusanket.gsi.gov.in/LS_hazard.html (fetched); https://bhusanket.gsi.gov.in/faq.html (fetched); https://bhusanket.gsi.gov.in/Public_Portal_News_pdf/Revised%20Note%20on%20Landslide%20Hazards%20&%20Early%20Warning_GSI_08.08.2024.cleaned.pdf (fetched, read as text).
- DATE: 2026-09-26.
- LICENSE: none stated on any page read.
- AUTH: the portal pages are open. COST: free. RATE_LIMIT: UNKNOWN.
- COVERAGE: GSI's note, Table 1, gives these figures for the NE states (target area km², % high susceptibility, landslides inventoried):
  Assam 24,144 / 2 / 527; Meghalaya 22,601 / 1 / 1,525; Manipur 23,245 / 12 / 2,404; Nagaland 17,294 / 16 / 2,740;
  Mizoram 21,865 / 16 / 4,219; Tripura 1,367 / 2 / 57; Arunachal Pradesh 70,308 / 15 / 26,213; Sikkim 4,979 / 18 / 3,378.
  The national total is 87,474 landslides over 433,863 km².
- FRESHNESS: the note dates from August 2024. The portal home page offers a forecast bulletin (PDF viewer), a "State Wise Landslide Report" (1,179 entries) and a "Landslide Inventory (Field Validated)" download. No issue date was visible.
- NER_RELEVANCE: very high.
- RELIABILITY: authoritative for inventory and susceptibility.
- USE_CASE in RASTA: (a) the per-state figures above can be quoted, with attribution to GSI's 2024 note, as context. (b) If the field-validated inventory is downloaded by a human and its licence is confirmed, it could become a second HISTORICAL_INVENTORY beside the NASA GLC slice.
- LIMITATIONS: **operational forecasting did not cover any NE state as of the note.** The note says bulletins were operational only for Darjeeling and Kalimpong (West Bengal) and the Nilgiris (Tamil Nadu). Experimental bulletins covered 13 other districts in Sikkim, Uttarakhand, Himachal Pradesh and Kerala, and went "to the concerned SDMAs and DDMAs only". Whether coverage has grown since August 2024 was not verified. No API.
- ADMISSION: ADMITTED_ALREADY (`BLOCKED` in `docs/FINAL_SOURCE_ADMISSION_LEDGER.md:65` and `docs/research/SOURCE_ADMISSION_MATRIX.md:43`). This ledger does not change it. The new evidence above, and why it may matter to that status, is drift item 0.7. Any reuse still needs GSI's written terms, because no licence is stated.
- EVIDENCE: PROVEN_BY_WEB.

### D6: GSI main site
- SOURCE: https://www.gsi.gov.in/.
- OWNER: GSI. URL: fetched, but it returned a "Verifying secure session" bot-verification page. It was not worked around.
- DATE: 2026-09-26. LICENSE / AUTH / COST / RATE_LIMIT / COVERAGE / FRESHNESS: UNKNOWN.
- NER_RELEVANCE: high. RELIABILITY: authoritative. USE_CASE in RASTA: none (use D5).
- LIMITATIONS: bot verification.
- ADMISSION: ADMITTED_ALREADY (`BLOCKED`). The matrix row "GSI / Bhusanket / Bhukosh" (`docs/research/SOURCE_ADMISSION_MATRIX.md:43`) names GSI. That the row covers the main site is INFERRED.
- EVIDENCE: BLOCKED.

### D7: NRSC Landslide Atlas of India
- SOURCE: Landslide Atlas of India.
- OWNER: National Remote Sensing Centre, ISRO.
- URL: https://www.nrsc.gov.in/nrscnew/resources_atlas_landslide.php (fetched).
- DATE: 2026-09-26.
- LICENSE: not stated for the atlas. The page links general Terms and Conditions, which were not read.
- AUTH: none. COST: free. RATE_LIMIT: n/a.
- COVERAGE: 17 states and 2 UTs, with "seasonal, event-based and route-wise" inventories for 1998–2022.
- FRESHNESS: updated 25 August 2023.
- NER_RELEVANCE: high.
- RELIABILITY: authoritative remote-sensing inventory.
- USE_CASE in RASTA: HISTORICAL_INVENTORY context with attribution. It is never evidence of a current event.
- LIMITATIONS: the page offers the PDF only, with no separate data download.
- ADMISSION: ADMITTED_ALREADY (`RESEARCH_ONLY`).
- EVIDENCE: PROVEN_BY_WEB.

### D8: NRSC Bhuvan and NOEDA
- SOURCE: the Bhuvan geoportal and the NRSC Open EO Data Archive.
- OWNER: NRSC / ISRO.
- URL: https://bhuvan.nrsc.gov.in/ (fetched; rendered only a loading state); https://bhuvan-app3.nrsc.gov.in/data/download/index.php (fetched; navigation only).
- DATE: 2026-09-26. LICENSE / AUTH / COST / RATE_LIMIT: UNKNOWN from the pages read.
- COVERAGE: India. FRESHNESS: UNKNOWN.
- NER_RELEVANCE: high (CartoDEM, thematic layers).
- RELIABILITY: authoritative.
- USE_CASE in RASTA: none until registration.
- LIMITATIONS: JavaScript-rendered, so the pages could not be read as text. The final ledger records that CartoDEM needs NOEDA registration.
- ADMISSION: ADMITTED_ALREADY (`BLOCKED` in `docs/FINAL_SOURCE_ADMISSION_LEDGER.md:58`; `docs/research/SOURCE_ADMISSION_MATRIX.md:49` says `VALIDATION_ONLY`. See 0.8).
- EVIDENCE: NOT_VERIFIED.

### D9: NRSC NDEM (National Database for Emergency Management)
- SOURCE: https://ndem.nrsc.gov.in/. Fetched, but only the title rendered.
- OWNER: NRSC. DATE: 2026-09-26. LICENSE / AUTH / COST / RATE_LIMIT / COVERAGE / FRESHNESS: UNKNOWN.
- NER_RELEVANCE: potentially high (flood inundation layers, and ASDMA links NRSC inundation mapping).
- RELIABILITY: UNKNOWN. USE_CASE in RASTA: none yet.
- LIMITATIONS: content not readable.
- ADMISSION: CANDIDATE (for a human to investigate).
- EVIDENCE: NOT_VERIFIED.

---

## W / O. Weather

### W1: India Meteorological Department (IMD)
- SOURCE: the mausam portal (district-wise nowcast and warnings), the IMD API gateway, and the Data Supply Portal.
- OWNER: IMD, Ministry of Earth Sciences.
- URL: https://mausam.imd.gov.in/ (fetched); https://api.imd.gov.in/ (fetched); https://dsp.imdpune.gov.in/ (fetched).
- DATE: 2026-09-26.
- LICENSE: the Data Supply Portal requires prior permission for commercial reproduction and disclaims liability. The API gateway's terms were not visible.
- AUTH: the API gateway offers "Create Account". The Data Supply Portal requires registration.
- COST: the Data Supply Portal charges for most data, with a limited free series for research. The API cost is UNKNOWN.
- RATE_LIMIT: UNKNOWN.
- COVERAGE: national, with a district-wise nowcast. The mausam page showed data timestamped 2026-09-26 17:30 IST.
- FRESHNESS: live (nowcast); historical (Data Supply Portal).
- NER_RELEVANCE: high. It is the official source, and GSI's landslide forecasting uses IMD inputs (D5).
- RELIABILITY: authoritative.
- USE_CASE in RASTA: validation of the Open-Meteo and MET Norway readings, and possibly official district warnings, if an account is granted.
- LIMITATIONS: API access terms are unknown until an account exists. The account must be the user's own, and no key can be obtained on the user's behalf.
- ADMISSION: ADMITTED_ALREADY (`VALIDATION_ONLY`). New finding: an API gateway with self-service account creation now exists [PROVEN_BY_WEB].
- EVIDENCE: PROVEN_BY_WEB.

### O1: Open-Meteo (forecast and elevation)
- SOURCE: Open-Meteo forecast API and elevation API.
- OWNER: Open-Meteo.
- URL: https://open-meteo.com/en/terms (fetched); https://open-meteo.com/en/docs/elevation-api (fetched).
- DATE: 2026-09-26.
- LICENSE: data under CC BY 4.0. The elevation data (Copernicus DEM) requires the DOI citation and attribution to Copernicus and Open-Meteo.
- AUTH: no key on the free tier. COST: free for **non-commercial** use only. Commercial use needs a paid subscription.
- RATE_LIMIT: free tier 10,000 calls/day, 5,000/hour, 600/minute. Elevation: up to 100 coordinates per request.
- COVERAGE: global. FRESHNESS: live forecast.
- NER_RELEVANCE: high.
- RELIABILITY: a model-based provider. It is not an official Indian source.
- USE_CASE in RASTA: primary weather [PROVEN_BY_SOURCE: `config.py:204`] and primary DEM [PROVEN_BY_SOURCE: `terrain.py:5-9`].
- LIMITATIONS: the non-commercial clause (see 0.6). The daily quota is shared by everything behind the single hosted egress IP [INFERRED]. No DOI string was found in the source trees [PROVEN_BY_SOURCE: a fixed-string grep (`grep -rF 10.5270`) over `manager-web/src`, `driver-app/src` and `backend/app` found no match. A regex grep also matches an OSM node id in `corridor_snapshot.json:40167`, which is a false positive]. Whether the Copernicus attribution is shown on screen was NOT_VERIFIED.
- ADMISSION: ADMITTED_ALREADY (`ADOPT_NOW`). The weather use is in the final ledger §1 (`docs/FINAL_SOURCE_ADMISSION_LEDGER.md:32`). The elevation use is `ADOPT_NOW` only in `docs/research/SOURCE_ADMISSION_MATRIX.md:48`; the final ledger does not list it, and the data under it (Copernicus DEM, T1) has no consistent record. See 0.3.
- EVIDENCE: PROVEN_BY_WEB.

### O2: MET Norway Locationforecast
- SOURCE: api.met.no.
- OWNER: Norwegian Meteorological Institute.
- URL: https://api.met.no/doc/TermsOfService (fetched).
- DATE: 2026-09-26.
- LICENSE: CC BY 4.0, attribution required.
- AUTH: every request "must (if possible)" carry an identifying User-Agent with the application or domain name. The terms say you "should also include a company email address or a link to the company website", and that if MET Norway cannot contact you, "you risk being blocked without warning". COST: free.
- RATE_LIMIT: anything over 20 requests/second per application (total, not per client) "requires special agreement". On caching, the terms say web servers and mobile apps "should cache all API responses" and should use the cache headers, for example `If-Modified-Since` when a `Last-Modified` header exists. The terms do not call caching mandatory.
- COVERAGE: global. FRESHNESS: live.
- NER_RELEVANCE: medium (fallback). RELIABILITY: a national met service's global model.
- USE_CASE in RASTA: the fallback when Open-Meteo returns 429 or is down [PROVEN_BY_SOURCE: `config.py:210`].
- LIMITATIONS: RASTA's User-Agent carries no contact details [PROVEN_BY_SOURCE: defined at `backend/app/services/weather/open_meteo.py:47`, sent to MET Norway at line 159]. No `If-Modified-Since` header is set anywhere in `backend/app` [PROVEN_BY_SOURCE: case-insensitive grep, no match]. Whether RASTA caches MET Norway responses in some other way was NOT_VERIFIED.
- ADMISSION: ADMITTED_ALREADY (`ADOPT_NOW`).
- EVIDENCE: PROVEN_BY_WEB.

---

## F. Flood

### F1: Central Water Commission (CWC) flood forecasting
- SOURCE: the FFS portal, the Flood Forecast dashboard, and the Brahmaputra & Barak Basin Organisation (BBBO) pages.
- OWNER: Central Water Commission, Ministry of Jal Shakti.
- URL: https://ffs.india-water.gov.in/ (fetched; JS app, little content); https://cwc.gov.in/ffm_dashboard (fetched); https://www.cwc.gov.in/bbbo/about-basins (fetched); http://www.cwc.gov.in/bbbo/ho-ff-network (fetched; station lists are PDFs, which were not opened).
- DATE: 2026-09-26.
- LICENSE: UNKNOWN. Terms of Use exist but were not read.
- AUTH: none for viewing. COST: free. RATE_LIMIT: UNKNOWN.
- COVERAGE: the BBBO page says CWC operates **28 flood-forecasting stations and 137 gauge-discharge sites in the Brahmaputra sub-basin** (Arunachal, Assam, West Bengal, Meghalaya, Nagaland, Sikkim) and **6 flood-forecasting stations and 97 gauge-discharge sites in the Barak sub-basin** (Meghalaya, Manipur, Mizoram, Assam, Tripura, Nagaland).
- FRESHNESS: dashboard footer "Last updated: 25-09-2026 2:42 pm". It offers PDFs per flood-situation category.
- NER_RELEVANCE: high. It is the official river-level forecast.
- RELIABILITY: authoritative for station river levels.
- USE_CASE in RASTA: official river-level context for a human reviewer on Assam and Barak-valley corridors. A future feed if a machine interface is published.
- LIMITATIONS: no API or licence was found. It gives station levels, not road inundation.
- ADMISSION: CANDIDATE.
- EVIDENCE: PROVEN_BY_WEB.

### F2: Open-Meteo Flood API (GloFAS)
- SOURCE: flood-api.open-meteo.com.
- OWNER: Open-Meteo, redistributing Copernicus GloFAS.
- URL: https://open-meteo.com/en/docs/flood-api (fetched).
- DATE: 2026-09-26.
- LICENSE: Open-Meteo terms (O1). The GloFAS upstream licence is UNKNOWN (not fetched).
- AUTH: none. COST: free, non-commercial (O1). RATE_LIMIT: as O1.
- COVERAGE: global; 0.05° (~5 km) for GloFAS v4. Daily forecast to 30 days, seasonal to 7 months.
- FRESHNESS: daily.
- NER_RELEVANCE: high for Brahmaputra and Barak discharge.
- RELIABILITY: simulated discharge. The docs warn that at 5 km resolution the nearest river may be picked incorrectly.
- USE_CASE in RASTA: river-discharge context, banded against a 30-day mean [PROVEN_BY_SOURCE: `backend/app/core/config.py:286-287`].
- LIMITATIONS: modelled discharge. It is **not** road water depth and not an official flood warning.
- ADMISSION: ADMITTED_ALREADY (`ADOPT_NOW`).
- EVIDENCE: PROVEN_BY_WEB.

### F3: ASDMA flood reporting (Assam Flood Report, FRIMS)
- SOURCE: the Assam daily flood report and FRIMS (Flood Reporting and Information Management System).
- OWNER: Assam State Disaster Management Authority.
- URL: https://asdma.assam.gov.in/information-services/assam-flood-report (fetched; navigation only). The legacy https://www.asdma.gov.in/reports.html and its PDF reports gave **connection refused** (BLOCKED). The FRIMS description is from search results only [NOT_VERIFIED].
- DATE: 2026-09-26.
- LICENSE: UNKNOWN. AUTH: FRIMS entry is for authorised users [NOT_VERIFIED]. COST: free to read. RATE_LIMIT: UNKNOWN.
- COVERAGE: Assam, all districts [NOT_VERIFIED]. FRESHNESS: daily in season [NOT_VERIFIED].
- NER_RELEVANCE: very high for Assam corridors.
- RELIABILITY: official.
- USE_CASE in RASTA: reviewer reading during monsoon route approval.
- LIMITATIONS: no machine interface was found, and the legacy host is unreachable.
- ADMISSION: CANDIDATE.
- EVIDENCE: PROVEN_BY_WEB (for the portal's existence and its sections only).

---

## E. Earthquake

### E1: National Center for Seismology (NCS)
- SOURCE: the RISEQ earthquake list and the NCS website.
- OWNER: National Center for Seismology, Ministry of Earth Sciences.
- URL: https://riseq.seismo.gov.in/riseq/earthquake (fetched; the `www.` host does not resolve); https://seismo.gov.in/ (fetched). **Note: `ncs.gov.in` is the National Career Service, not seismology** (fetched).
- DATE: 2026-09-26.
- LICENSE: UNKNOWN. Copyright policy and terms pages exist but were not read.
- AUTH: none for viewing. COST: free. RATE_LIMIT: UNKNOWN.
- COVERAGE: Indian and regional events, with magnitude, origin time (IST), lat/lon, depth, region and a Reviewed/Auto flag. NE events are listed (Assam, Meghalaya, Arunachal, Manipur, Mizoram, Tripura). The seismo.gov.in page states a national network of more than 170 stations.
- FRESHNESS: the latest listed event was on 2026-09-26. The site was last updated 7 Sep 2026.
- NER_RELEVANCE: high. The NE lies in high seismic zones.
- RELIABILITY: authoritative for India.
- USE_CASE in RASTA: the official Indian earthquake context layer, if a machine interface and reuse terms are confirmed.
- LIMITATIONS: no API or feed was visible.
- ADMISSION: NEEDS_LEGAL.
- EVIDENCE: PROVEN_BY_WEB.

### E2: USGS FDSN event web service
- SOURCE: earthquake.usgs.gov FDSN event API.
- OWNER: U.S. Geological Survey.
- URL: https://earthquake.usgs.gov/fdsnws/event/1/ (fetched). The USGS copyright page (https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits) was fetched **but came back empty**.
- DATE: 2026-09-26.
- LICENSE: UNKNOWN from the pages read. Public-domain status is commonly assumed, but it was not verified here.
- AUTH: no key. COST: free.
- RATE_LIMIT: at most 20,000 results per query.
- COVERAGE: global. Parameters include a bounding box, a radius, time, magnitude and depth. Formats: geojson, kml, csv, xml, QuakeML.
- FRESHNESS: near real time. One read-only `count` query (lat 21.9–29.5 N, lon 88–97.5 E, M≥2.5, 2026-08-26 to 2026-09-26) returned **2** [PROVEN_BY_WEB]. The box includes parts of Bangladesh, Bhutan and Myanmar.
- NER_RELEVANCE: medium. It is a keyless cross-check to NCS.
- RELIABILITY: authoritative global catalogue, with sparse low-magnitude completeness in the region [INFERRED].
- USE_CASE in RASTA: the cheapest earthquake-context layer to build (keyless).
- LIMITATIONS: it is not the Indian official source. Magnitudes and locations can differ from NCS.
- ADMISSION: ADMITTED_ALREADY (`BLOCKED`: "no earthquake layer exists yet").
- EVIDENCE: PROVEN_BY_WEB.

---

## FI. Fire

### FI1: NASA FIRMS
- SOURCE: Fire Information for Resource Management System API.
- OWNER: NASA (LANCE / EOSDIS).
- URL: https://firms.modaps.eosdis.nasa.gov/api/ (fetched); https://firms.modaps.eosdis.nasa.gov/api/map_key/ (fetched).
- DATE: 2026-09-26.
- LICENSE: not stated on the pages read. EOSDIS data is "openly shared, without restriction" (quoted from the SRTM record in T2); that this policy covers FIRMS is INFERRED.
- AUTH: a MAP_KEY, requested free with an email address and sent to that address.
- COST: free.
- RATE_LIMIT: 5,000 transactions per 10-minute interval. Larger requests use more than one transaction.
- COVERAGE: global, with area and date queries (the country query was listed as unavailable). CSV and KML output. API version 4.1.16.
- FRESHNESS: near real time (NRT availability is queryable).
- NER_RELEVANCE: low to medium. Jhum burning season smoke and visibility [INFERRED].
- RELIABILITY: satellite hotspot detections, not confirmed fires.
- USE_CASE in RASTA: a supplementary fire and smoke context layer.
- LIMITATIONS: the key must be the user's own (no key can be requested on the user's behalf).
- ADMISSION: ADMITTED_ALREADY (`BLOCKED` until the user obtains a MAP_KEY).
- EVIDENCE: PROVEN_BY_WEB.

---

## T. Terrain

### T1: Copernicus DEM (GLO-30 / GLO-90)
- SOURCE: Copernicus DEM, on the Copernicus Data Space Ecosystem.
- OWNER: ESA / European Union (Copernicus), with data © DLR and Airbus.
- URL: https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM (fetched).
- DATE: 2026-09-26.
- LICENSE: "available worldwide with a free license". Users must cite DOI 10.5270/ESA-c5d3d65 and include the DLR/Airbus/Copernicus attribution.
- AUTH: registration is required to download directly. None is needed through Open-Meteo (O1).
- COST: free. RATE_LIMIT: none stated for the data. Open-Meteo's limits apply to RASTA's path.
- COVERAGE: global, 30 m and 90 m. FRESHNESS: static DEM (the Open-Meteo docs name the 2021 release of GLO-90).
- NER_RELEVANCE: high (slope and gradient on hill corridors).
- RELIABILITY: good global DEM. Steep valley floors may be smoothed at 90 m [INFERRED].
- USE_CASE in RASTA: route terrain profiles [PROVEN_BY_SOURCE: `backend/app/services/terrain.py:5-9`; `backend/app/domain/terrain.py:14`].
- LIMITATIONS: the attribution condition (see O1). GLO-30 direct use would need a registered account.
- ADMISSION: CANDIDATE. It is in code as the primary DEM, but has no consistent admission record. The final ledger and the GitHub audit do not classify it. `docs/research/SOURCE_ADMISSION_MATRIX.md:49` lists it as `VALIDATION_ONLY` on the premise that it needs an account, which the Open-Meteo path does not. `docs/research/SPATIAL_SOURCE_AUDIT.md:25` describes it as live, which is an inventory line, not an admission. See 0.3.
- EVIDENCE: PROVEN_BY_WEB.

### T2: NASA SRTMGL1 v003
- SOURCE: Shuttle Radar Topography Mission, 1 arc-second, version 3.
- OWNER: NASA JPL, distributed by LP DAAC.
- URL: https://lpdaac.usgs.gov/products/srtmgl1v003/ (301 redirect) → https://www.earthdata.nasa.gov/data/catalog/lpcloud-srtmgl1-003 (fetched).
- DATE: 2026-09-26.
- LICENSE: openly shared without restriction under EOSDIS data use guidance. Citation DOI 10.5067/MEASURES/SRTM/SRTMGL1.003.
- AUTH: Earthdata login for direct download. None through OpenTopoData or AWS Terrain Tiles.
- COST: free. RATE_LIMIT: n/a (see T3 for RASTA's path).
- COVERAGE: 60°N–56°S at ~30 m. FRESHNESS: acquired 11–21 February 2000.
- NER_RELEVANCE: high. RELIABILITY: good. Voids were filled in v3.
- USE_CASE in RASTA: the elevation fallback, and hillshade/terrain tiles.
- LIMITATIONS: the data is 26 years old. Cuttings, slides and new alignments since 2000 are not in it.
- ADMISSION: ADMITTED_ALREADY (through OpenTopoData and AWS Terrain Tiles, `ADOPT_NOW`).
- EVIDENCE: PROVEN_BY_WEB.

### T3: OpenTopoData public API
- SOURCE: api.opentopodata.org.
- OWNER: Open Topo Data project.
- URL: https://www.opentopodata.org/ (fetched).
- DATE: 2026-09-26.
- LICENSE: service terms are limited to the usage limits. Each dataset's own licence applies (T2 for srtm30m).
- AUTH: none. COST: free.
- RATE_LIMIT: at most 100 locations per request, 1 call per second, 1,000 calls per day. This matches the final ledger.
- COVERAGE: srtm30m and srtm90m (−60 to 60 latitude), aster30m, mapzen, and others.
- FRESHNESS: static. NER_RELEVANCE: medium (fallback). RELIABILITY: best-effort public API.
- USE_CASE in RASTA: the DEM fallback [PROVEN_BY_SOURCE: `config.py:282`].
- LIMITATIONS: the 1,000/day ceiling.
- ADMISSION: ADMITTED_ALREADY (`ADOPT_NOW`).
- EVIDENCE: PROVEN_BY_WEB.

---

## A. Administrative

### A1: Local Government Directory (LGD)
- SOURCE: LGD, the Government of India's directory of land-region and local-body codes.
- OWNER: Ministry of Panchayati Raj.
- URL: https://lgdirectory.gov.in/ (fetched); https://lgdirectory.gov.in/districtWiseDetailReport.do (fetched; the form was **not** submitted).
- DATE: 2026-09-26.
- LICENSE: UNKNOWN (not stated on the pages read).
- AUTH: citizen reports are public but **need a CAPTCHA** (visual or audio). The CAPTCHA was not touched. Web services are offered through a "NAPIX API Provider" (terms and registration not read).
- COST: UNKNOWN. RATE_LIMIT: UNKNOWN.
- COVERAGE: the home page listed 36 states/UTs, 784 districts, 7,092 sub-districts, 7,323 blocks and 677,662 villages on the date seen. These are national totals as displayed, **not verified as an NE district list**.
- FRESHNESS: "Recent Changes" entries were dated 2026-09-26. It is actively maintained.
- NER_RELEVANCE: very high. It is the official source for the district seed that `DISTRICT_SEED` is waiting for.
- RELIABILITY: official codes, maintained by the states' own data owners.
- USE_CASE in RASTA: a `VERIFIED_OFFICIAL` district directory for the eight states, **if** a human downloads the report (solving the CAPTCHA themselves) or the NAPIX API terms are obtained. The file then gets a retrieval date and a hash, as the places snapshot does.
- LIMITATIONS: the CAPTCHA blocks any automated path, and automating around it is prohibited. LGD provides codes and names, not polygons, so geometry would still need a separate source.
- ADMISSION: NEEDS_LEGAL.
- EVIDENCE: PROVEN_BY_WEB.

### A2: data.gov.in (Open Government Data Platform)
- SOURCE: the OGD Platform and the Government Open Data License – India (GODL).
- OWNER: MeitY / NIC.
- URL: https://www.data.gov.in/, https://www.data.gov.in/catalog/local-government-directory-lgd and https://www.data.gov.in/Godl all returned **HTTP 403**.
- DATE: 2026-09-26. LICENSE / AUTH / COST / RATE_LIMIT / COVERAGE / FRESHNESS: UNKNOWN from this session.
- NER_RELEVANCE: potentially high (an LGD catalogue exists, according to the search results).
- RELIABILITY: UNKNOWN. USE_CASE in RASTA: none until it has been read.
- LIMITATIONS: automated reads are refused.
- ADMISSION: NEEDS_LEGAL.
- EVIDENCE: BLOCKED.

### A3: Census of India
- SOURCE: censusindia.gov.in.
- OWNER: Office of the Registrar General & Census Commissioner.
- URL: https://censusindia.gov.in/ failed with "unable to verify the first certificate" (TLS chain). An insecure retry was not attempted.
- DATE: 2026-09-26. Everything else: UNKNOWN.
- NER_RELEVANCE: medium (population for accessibility indicators).
- ADMISSION: NEEDS_LEGAL.
- EVIDENCE: BLOCKED.

### A4: geoBoundaries / GADM
- Not re-fetched. It is recorded in the final ledger §3 as `RESEARCH_ONLY` (open item) and in
  `GITHUB_REFERENCE_AUDIT.md`. It could only ever carry `DEMO` provenance.
- ADMISSION: ADMITTED_ALREADY (`RESEARCH_ONLY`).
- EVIDENCE: PROVEN_BY_SOURCE (`docs/FINAL_SOURCE_ADMISSION_LEDGER.md` §3, `docs/research/GITHUB_REFERENCE_AUDIT.md` §"geoBoundaries").

---

## RL. Rail freight

### RL1: Northeast Frontier Railway (NFR)
- SOURCE: NFR website, Freight section.
- OWNER: Northeast Frontier Railway zone, Indian Railways.
- URL: https://nfr.indianrailways.gov.in/ (fetched). A sub-page that was tried rendered empty.
- DATE: 2026-09-26.
- LICENSE: UNKNOWN. AUTH: none. COST: free. RATE_LIMIT: UNKNOWN.
- COVERAGE: the Freight menu lists "Induction of Essential Commodities in N.E. States", Interchange, Loading & Earnings, Loading Profile, Placement & Release, and Transhipment. The contents of those pages were not rendered.
- FRESHNESS: UNKNOWN.
- NER_RELEVANCE: high. NFR is the rail operator for the region.
- RELIABILITY: official.
- USE_CASE in RASTA: reference material for a future road–rail handoff design.
- LIMITATIONS: no terminal list with coordinates was seen.
- ADMISSION: CANDIDATE.
- EVIDENCE: PROVEN_BY_WEB.

### RL2: FOIS / RailSAHAY
- SOURCE: Indian Railways freight customer portal.
- OWNER: Indian Railways (CRIS).
- URL: https://www.fois.indianrail.gov.in/RailSAHAY/index.jsp (fetched); https://www.fois.indianrail.gov.in/FOISWebPortal/pages/FWP_SttnHelp.jsp (fetched; not submitted); https://www.fois.indianrail.gov.in/ (fetched; title only).
- DATE: 2026-09-26.
- LICENSE: UNKNOWN (no terms seen).
- AUTH: terminal search, wagon selector, freight calculator, GCT information and track-and-trace are public. Wagon indents (e-Demand), receipts and dashboards need registration.
- COST: free to view. RATE_LIMIT: UNKNOWN.
- COVERAGE: all Indian Railways, including NFR [INFERRED].
- FRESHNESS: live portal.
- NER_RELEVANCE: medium to high for multimodal freight.
- RELIABILITY: official.
- USE_CASE in RASTA: manual lookup of rail terminals near a corridor for a handoff note.
- LIMITATIONS: no bulk export or API was seen. Automated querying of an interactive form would need permission.
- ADMISSION: NEEDS_LEGAL.
- EVIDENCE: PROVEN_BY_WEB.

### RL3: Railway Board statistics
- SOURCE: Railway Board Statistics & Economics publications.
- OWNER: Ministry of Railways.
- URL: https://indianrailways.gov.in/railwayboard/view_section.jsp?lang=0&id=0,1,304,366,554 (fetched).
- DATE: 2026-09-26.
- LICENSE: UNKNOWN. AUTH: none. COST: free. RATE_LIMIT: UNKNOWN.
- COVERAGE: national. Listed items include "Indian Railways Annual Statistical Statements, 2024-25", Year Books, and Railway Maps of India.
- FRESHNESS: FY 2024-25 is the latest listed.
- NER_RELEVANCE: low to medium (aggregates).
- RELIABILITY: official.
- USE_CASE in RASTA: background figures for documents only.
- LIMITATIONS: aggregate PDFs only.
- ADMISSION: CANDIDATE (documentation reference).
- EVIDENCE: PROVEN_BY_WEB.

---

## AI. Air cargo

### AI1: AAI cargo and AAICLAS
- SOURCE: AAI cargo page.
- OWNER: Airports Authority of India. AAICLAS is its cargo logistics subsidiary.
- URL: https://www.aai.aero/en/cargo (fetched).
- DATE: 2026-09-26.
- LICENSE: UNKNOWN.
- AUTH: registration with AAI is mandatory for electronic cargo transactions (through AAICLAS).
- COST: tariffs were not on the page. RATE_LIMIT: n/a.
- COVERAGE: the navigation lists Guwahati, Agartala, Imphal, Dibrugarh, Silchar, Dimapur and Itanagar among airports. The page itself gives no NE cargo-terminal specifics.
- FRESHNESS: UNKNOWN.
- NER_RELEVANCE: medium (perishables and high-value cargo) [INFERRED].
- RELIABILITY: official.
- USE_CASE in RASTA: reference for a future air-cargo handoff point list.
- LIMITATIONS: no NE terminal data was seen.
- ADMISSION: NEEDS_LEGAL.
- EVIDENCE: PROVEN_BY_WEB.

### AI2: AAI monthly traffic news
- SOURCE: AAI traffic statistics, including Annexure IV (freight by airport).
- OWNER: AAI.
- URL: https://www.aai.aero/en/business-opportunities/aai-traffic-news (fetched).
- DATE: 2026-09-26.
- LICENSE: UNKNOWN.
- AUTH: download requires registration (name, email, OTP, organisation, purpose). **Not downloaded.**
- COST: free [INFERRED]. RATE_LIMIT: n/a.
- COVERAGE: all AAI-reporting airports. The latest period listed was August 2026.
- FRESHNESS: monthly.
- NER_RELEVANCE: medium. RELIABILITY: official.
- USE_CASE in RASTA: freight-volume context per NE airport, cited in documents.
- LIMITATIONS: gated behind registration with a stated purpose, so the terms of reuse must be read first.
- ADMISSION: NEEDS_LEGAL.
- EVIDENCE: PROVEN_BY_WEB.

### AI3: Guwahati (LGBI) airport operator site
- SOURCE: the airport's own website.
- OWNER: the site is branded Adani Group (footer "@2025 Adani Group").
- URL: https://www.adani.com/lgbia-guwahati-airport (301 redirect) → https://lgbia-guwahati.adaniairports.com/ (fetched).
- DATE: 2026-09-26.
- LICENSE: UNKNOWN. AUTH: none. COST: n/a. RATE_LIMIT: n/a.
- COVERAGE: Guwahati. The page has "Cargo" and "Cargo Flights" menu entries, and no cargo details rendered.
- FRESHNESS: UNKNOWN.
- NER_RELEVANCE: high. Guwahati is the region's main air gateway [INFERRED].
- RELIABILITY: operator site.
- USE_CASE in RASTA: correct attribution. AAI pages are not the operator source for Guwahati cargo [INFERRED from the branding].
- LIMITATIONS: cargo content not rendered.
- ADMISSION: CANDIDATE.
- EVIDENCE: PROVEN_BY_WEB.

---

## IW. Inland waterways

### IW1: IWAI National Waterway 2 (Brahmaputra)
- SOURCE: IWAI NW-2 page.
- OWNER: Inland Waterways Authority of India, Ministry of Ports, Shipping and Waterways.
- URL: https://iwai.gov.in/offerings/national-waterway/national-waterways2 (fetched). The legacy host https://iwai.nic.in/ gave connection refused.
- DATE: 2026-09-26.
- LICENSE: UNKNOWN. AUTH: none. COST: free. RATE_LIMIT: UNKNOWN.
- COVERAGE: 891 km, Bangladesh border to Sadiya (Assam), declared 1 September 1988. Guaranteed LAD: 2.5 m (Bangladesh border–Neamati, 629 km), 2.0 m (Neamati–Dibrugarh, 139 km), 1.5 m (Dibrugarh–Sadiya). Twelve terminals, operational or under development, including Dhubri, Pandu/Guwahati (rail-connected), Neamati, Dibrugarh, Tezpur and Silghat. Night navigation aids run from the Bangladesh border to Dibrugarh.
- FRESHNESS: UNKNOWN (no page date).
- NER_RELEVANCE: high for Assam multimodal freight.
- RELIABILITY: official.
- USE_CASE in RASTA: a curated, attributed list of river-terminal handoff points (a manual seed with a retrieval date). Terminal coordinates would need a separate verified source.
- LIMITATIONS: descriptive page, with no coordinates and no API.
- ADMISSION: CANDIDATE.
- EVIDENCE: PROVEN_BY_WEB.

### IW2: IWAI National Waterway 16 (Barak)
- SOURCE: IWAI NW-16 page.
- OWNER: IWAI.
- URL: https://iwai.gov.in/offerings/national-waterway/national-waterways16 (fetched).
- DATE: 2026-09-26.
- LICENSE: UNKNOWN. AUTH: none. COST: free. RATE_LIMIT: UNKNOWN.
- COVERAGE: about 121 km on the Barak, Lakhipur to Bhanga (Assam). Terminals named: Karimganj, which the page calls part of the Indo-Bangladesh Protocol routes; Badarpur, which it says was declared an extended port of call of Karimganj in May 2020; and Sonamura, listed at "Tripura (IBP Route Corridor)" (RCC terminal, inaugurated February 2024, as the page states). Monthly thalweg surveys. LAD is disseminated through River Notices.
- FRESHNESS: UNKNOWN.
- NER_RELEVANCE: high for Barak valley, Tripura and Mizoram access.
- RELIABILITY: official.
- USE_CASE in RASTA: as IW1.
- LIMITATIONS: as IW1.
- ADMISSION: CANDIDATE.
- EVIDENCE: PROVEN_BY_WEB.

### IW3: IWAI Least Available Depth and river notices
- SOURCE: IWAI LAD page.
- OWNER: IWAI.
- URL: https://iwai.gov.in/least-available-depth-lad (fetched).
- DATE: 2026-09-26.
- LICENSE: UNKNOWN. AUTH: none. COST: free. RATE_LIMIT: UNKNOWN.
- COVERAGE: the page says IWAI regularly monitors and publishes LAD for the national waterways. The notices sit behind a separate "LAD and River Notices" link, which was not rendered.
- FRESHNESS: UNKNOWN.
- NER_RELEVANCE: high. LAD decides whether a barge handoff is feasible in season [INFERRED].
- RELIABILITY: official.
- USE_CASE in RASTA: a reviewer check before recommending a river leg.
- LIMITATIONS: format and frequency were not visible.
- ADMISSION: CANDIDATE.
- EVIDENCE: PROVEN_BY_WEB.

---

## P. Points of interest

### P1: OpenStreetMap data
- SOURCE: OpenStreetMap.
- OWNER: OpenStreetMap Foundation and contributors.
- URL: https://www.openstreetmap.org/copyright (fetched).
- DATE: 2026-09-26.
- LICENSE: ODbL. It requires credit to "OpenStreetMap and its contributors", a statement that the data is under ODbL, and **share-alike** for altered or derived databases that are distributed.
- AUTH: none. COST: free. RATE_LIMIT: see P2 and P3.
- COVERAGE: global. Completeness in the NE is uneven [INFERRED].
- FRESHNESS: continuous edits. RASTA's copy is a dated snapshot.
- NER_RELEVANCE: high.
- RELIABILITY: crowd-sourced. Absence is not evidence of absence (as the final ledger §5b says about fuel).
- USE_CASE in RASTA: road geometry (through OSRM), POI snapshot, geocoding.
- LIMITATIONS: the share-alike duty applies if RASTA ever distributes the snapshot as a database [INFERRED].
- ADMISSION: ADMITTED_ALREADY (`ADOPT_NOW`).
- EVIDENCE: PROVEN_BY_WEB.

### P2: Overpass API (public instance)
- SOURCE: overpass-api.de.
- OWNER: Overpass API operators (FOSSGIS-hosted main instance).
- URL: https://wiki.openstreetmap.org/wiki/Overpass_API (fetched).
- DATE: 2026-09-26.
- LICENSE: the data is ODbL (P1).
- AUTH: none. COST: free.
- RATE_LIMIT: the main instance treats fewer than 10,000 queries/day and less than 1 GB/day as safe. For regular applications those limits are divided by 100. Callers are told to "Cache and rate-limit calls, use extracts". Commercial use should go to self-hosted or paid servers.
- COVERAGE: global. FRESHNESS: minutes behind OSM.
- NER_RELEVANCE: high. RELIABILITY: best-effort.
- USE_CASE in RASTA: developer-time snapshot acquisition only (see 0.1). The working-tree snapshot was retrieved 2026-09-20 with 4,366 records, including 726 FUEL [PROVEN_BY_SOURCE: `corridor_snapshot.json:8`].
- LIMITATIONS: the snapshot ages, and it must carry its date on screen.
- ADMISSION: ADMITTED_ALREADY (`ADOPT_NOW`; the "runtime" wording in the final ledger is inaccurate).
- EVIDENCE: PROVEN_BY_WEB.

### P3: Nominatim (public instance)
- SOURCE: nominatim.openstreetmap.org.
- OWNER: OpenStreetMap Foundation.
- URL: https://operations.osmfoundation.org/policies/nominatim/ (fetched).
- DATE: 2026-09-26.
- LICENSE: ODbL data (P1).
- AUTH: none, but an identifying User-Agent or Referer is required. COST: free.
- RATE_LIMIT: an absolute maximum of 1 request/second. Caching is required. Bulk geocoding is discouraged. **Client-side autocomplete is forbidden.**
- COVERAGE: global. FRESHNESS: follows OSM.
- NER_RELEVANCE: high (the location picker, and district placement of SACHET alerts).
- RELIABILITY: best-effort.
- USE_CASE in RASTA: forward and reverse geocoding, serialised under one lock and cached [PROVEN_BY_SOURCE: `backend/app/services/geocoding.py:103-117`].
- LIMITATIONS: the manager address picker issues a search after a 700 ms typing pause [PROVEN_BY_SOURCE: `manager-web/src/components/AddressPicker.tsx:71`]. The code's own comment says it is "not an autocomplete service". Whether OSMF would read a debounced search-as-you-type as autocomplete is a policy judgement [INFERRED], so it needs a decision before any production use.
- ADMISSION: ADMITTED_ALREADY (`ADOPT_NOW`).
- EVIDENCE: PROVEN_BY_WEB.

---

## C. Connectivity

### C1: TRAI coverage-map mandate
- SOURCE: TRAI Press Release No. 23/2025 (9 April 2025).
- OWNER: Telecom Regulatory Authority of India.
- URL: https://www.trai.gov.in/sites/default/files/2025-04/PR_No.23of2025.pdf (fetched, read as text).
- DATE: 2026-09-26.
- LICENSE: UNKNOWN (press release).
- AUTH: none. COST: free. RATE_LIMIT: n/a.
- COVERAGE: the QoS Regulations 2024 (06 of 2024), effective 1 October 2024, require every wireless access provider to publish service-wise geospatial coverage maps. Publication was due by 1 April 2025, under TRAI Direction RG-17/(3)/2022-QoS of 22 November 2024. The release lists operator links. It records BSNL and MTNL as "Yet to be published" at that date.
- FRESHNESS: as of 9 April 2025. The current BSNL and MTNL status was not verified.
- NER_RELEVANCE: medium. Driver-app sync on hill corridors depends on coverage [INFERRED].
- RELIABILITY: official regulatory statement.
- USE_CASE in RASTA: a pointer to where coverage maps exist. It supplies no data.
- LIMITATIONS: it is a press release, not data.
- ADMISSION: CANDIDATE (as a pointer only).
- EVIDENCE: PROVEN_BY_WEB.

### C2: Operator coverage maps (Airtel, Jio, Vi, BSNL)
- SOURCE: the operators' own coverage-map pages.
- OWNER: the respective operators.
- URL: https://www.airtel.in/wirelesscoverage/ (fetched; only the header rendered). The others were NOT_FETCHED.
- DATE: 2026-09-26.
- LICENSE: UNKNOWN. AUTH: none for viewing [NOT_VERIFIED]. COST: n/a. RATE_LIMIT: UNKNOWN.
- COVERAGE: per operator. FRESHNESS: UNKNOWN.
- NER_RELEVANCE: medium. RELIABILITY: operator-declared (TRAI allows predicted coverage).
- USE_CASE in RASTA: none. Taking operator map data without a licence would be scraping.
- LIMITATIONS: interactive maps with no reuse terms.
- ADMISSION: NEEDS_LEGAL.
- EVIDENCE: NOT_VERIFIED.

### C3: DoT Tarang Sanchar
- SOURCE: DoT tower-locator and EMF-compliance portal.
- OWNER: Department of Telecommunications.
- URL: https://tarangsanchar.gov.in/ (fetched).
- DATE: 2026-09-26.
- LICENSE: Terms of Use linked, not read. AUTH: none for the map. COST: free. RATE_LIMIT: UNKNOWN.
- COVERAGE: tower locations with EMF compliance status. **No signal or coverage data.**
- FRESHNESS: UNKNOWN.
- NER_RELEVANCE: low.
- RELIABILITY: official for its purpose.
- USE_CASE in RASTA: none. Tower presence is not coverage.
- LIMITATIONS: no API seen.
- ADMISSION: REJECTED (wrong product for a coverage question).
- EVIDENCE: PROVEN_BY_WEB.

---

## K. Academic search: Bio Research plugin (Consensus)

The tool `mcp__plugin_bio-research_consensus__search` **loaded and ran**. Three queries, each
**capped at 3 results** by the tool. The tool said that a free Consensus account would lift
the cap. Only the abstracts returned by the tool were seen. **No paper was opened or read**,
so every finding below is `NOT_VERIFIED` beyond "the tool returned it". During the revision all
three queries were run again and returned the same nine papers and the same cap message.

| Query | Returned | Relevance to RASTA |
|---|---|---|
| landslide susceptibility North East India road corridors | [Barman et al. 2024, Aizawl FR/AHP](https://consensus.app/papers/details/e185612161725c37b1c350d2ef1e0bb8/?utm_source=claude_code) (Advances in Space Research); [Singh et al. 2023, Imphal–Jiribam railway corridor](https://consensus.app/papers/details/869867b3e83b54748a9a2cdf1ea9158b/?utm_source=claude_code) (ESPR); [Saravanan et al. 2021, NH67 Nilgiris](https://consensus.app/papers/details/d658bd3296985d5fadfccd0b10215f0f/?utm_source=claude_code) (IOP) | The first two are NE. Only the Barman 2024 abstract names distance to road; it says that factor had the highest predictive value. The Singh 2023 abstract does not mention roads as a factor. The third is outside the NE. |
| rainfall thresholds landslides Northeast India highway | [Sengupta et al. 2009, Lanta Khola, North Sikkim](https://consensus.app/papers/details/243c627acb0f5e64a42fa36720913d22/?utm_source=claude_code) (Natural Hazards); [Harilal et al. 2019, Sikkim thresholds](https://consensus.app/papers/details/c2f58ea2b5fe53ac86c39598d7b3448a/?utm_source=claude_code) (Landslides); [Mandal et al. 2020, NH-10 Darjeeling](https://consensus.app/papers/details/aaf72afd60da5bc197b700a5e1db0291/?utm_source=claude_code) (Natural Hazards) | Sikkim and NH-10 (Darjeeling) are relevant hill corridors. Only Harilal 2019 and Mandal 2020 give intensity–duration (I–D) threshold equations, and their abstracts say the daily rainfall came from IMD stations (Mandal 2020 adds adjacent tea gardens). Sengupta 2009 instead proposes a normalised cumulative-rainfall threshold (more than 250 mm over more than 15 days), says typical exponential cumulative-rainfall/duration relations did not fit, and does not mention IMD. |
| freight logistics accessibility North Eastern Region India transport connectivity | [Herrera Dappe et al. 2021, Connecting to Thrive](https://consensus.app/papers/details/f7763c943e995243b64355c86d5776a2/?utm_source=claude_code) (World Bank); [Baruah 2024, dry ports for Assam IWT](https://consensus.app/papers/details/4289b9c75de45d9eae7e1ab0036df0ba/?utm_source=claude_code); [Koner et al. 2022, NE road infrastructure](https://consensus.app/papers/details/3b78fb2a06885603932589738c5ba2fb/?utm_source=claude_code) | Context only (the Siliguri-corridor detour, and IWT on the Brahmaputra and Barak). No data. |

- ADMISSION: all nine are `RESEARCH_ONLY` candidates for citation in documents. **None is
  admitted as a threshold, weight or label in RASTA.** A threshold fitted to one Sikkim slope or
  to NH-10 is not a threshold for NH-6 in Mizoram.
- EVIDENCE: PROVEN_BY_RUNTIME (the tool call and its returned list). Paper content is NOT_VERIFIED.

Tool note, reproduced as returned: "Create or connect a free Consensus account to return more than 3 results per search in Claude Code.: https://consensus.app/sign-up/?utm_source=claude_code&auth=claude_code"

---

## What this unlocks for the product

Each item needs a named human decision before any code references the source. None of these is done.

| Requirement | Unlocked by | What it takes | Evidence |
|---|---|---|---|
| Official district directory (the `DISTRICT_SEED` blocker) | A1 LGD | A human downloads the eight NE state reports through the public form (solving the CAPTCHA themselves), or obtains NAPIX API terms. The file is stored with a retrieval date and hash. | PROVEN_BY_WEB |
| Landslide susceptibility and a field-validated inventory for all 8 states | D5 Bhusanket (and D4 Bhukosh once reachable) | Both are `BLOCKED` in the existing ledgers (0.7), so a named status decision comes first. Then a human download plus written confirmation of reuse terms from GSI. It would be labelled HISTORICAL_INVENTORY / SUSCEPTIBILITY, never current. | PROVEN_BY_WEB |
| Quotable per-state landslide exposure in documents | D5 GSI note, Table 1 | Cite "GSI, 2024 note". No licence risk for a short factual citation [INFERRED]. | PROVEN_BY_WEB |
| Earthquake context layer | E2 USGS (keyless) now; E1 NCS later | Engineering only for USGS. NCS needs an interface and terms. | PROVEN_BY_WEB |
| Fire and smoke context | FI1 FIRMS | The user obtains a MAP_KEY by email. | PROVEN_BY_WEB |
| Official river-level context for Assam and Barak corridors | F1 CWC (28 + 6 forecasting stations) | Manual reviewer reading today. A feed only if CWC publishes an interface. | PROVEN_BY_WEB |
| Official weather cross-check | W1 IMD API gateway | The user creates an account and reads the terms. | PROVEN_BY_WEB |
| Multimodal handoff points (river, rail, air) | IW1–IW3, RL2, AI1–AI3 | A curated, dated, attributed list. Terminal coordinates must come from a verified source, not guessed. | PROVEN_BY_WEB |
| Reviewer checklist for monsoon approvals | D3 Arunachal daily situation report, F3 ASDMA, F1 CWC | Documentation only. It fits the existing REQUIRES_REVIEW flow. | PROVEN_BY_WEB |
| Compliance fixes on already-admitted providers | O2 MET Norway (contact details in the User-Agent and response caching, both of which the terms say "should" be done), O1 and T1 (Copernicus DOI attribution; T1 also needs an admission decision, see 0.3) | Small code and UI changes. | PROVEN_BY_WEB + PROVEN_BY_SOURCE |

## What must NOT be claimed yet

| Do not claim | Why | Evidence |
|---|---|---|
| Any district count for the NE ("N districts covered") | No district directory is loaded. LGD's 784 is a national total as displayed, and NER Databank's "130" is undated. | PROVEN_BY_WEB |
| "Official landslide forecasts for the North-East" | As of GSI's August 2024 note, operational bulletins covered no NE state. Sikkim was experimental and went to SDMAs and DDMAs only. | PROVEN_BY_WEB |
| "Live road closures" from MoRTH, NHAI, NHIDCL or any SDMA | None of them publishes a machine-readable closure feed on the pages read. | PROVEN_BY_WEB |
| "Flood forecast for the road" or "road water depth" | GloFAS gives 5 km modelled discharge. CWC gives station levels. Neither is road inundation. | PROVEN_BY_WEB |
| "Mobile coverage along the route" | Operator maps exist by regulation but carry no reuse licence. Tarang Sanchar shows towers, not coverage. | PROVEN_BY_WEB |
| "Integrated rail, air or waterway freight" | Nothing from RL, AI or IW is integrated. They are candidates only. | PROVEN_BY_SOURCE (no such hosts in `backend/app`) |
| "Earthquake layer" or "fire layer" | Neither exists in code. | PROVEN_BY_SOURCE (no such hosts in `backend/app`) |
| "Production-licensed routing and weather" | The OSRM demo server and the Open-Meteo free tier are both non-commercial with no SLA. | PROVEN_BY_WEB |
| "Overpass is queried live" | It is a developer-time snapshot read from disk. | PROVEN_BY_SOURCE |
| "Fuel stations on the hosted map" | FUEL records exist only in the uncommitted working-tree snapshot. `origin/main` has 720 records and no FUEL. | PROVEN_BY_SOURCE |
| "Landslide thresholds validated for NE corridors" | The academic thresholds are site-specific (Sikkim, NH-10) and were not read beyond abstracts. | NOT_VERIFIED |
| Any statement about MDoNER, data.gov.in, Census, Bhukosh or Nagaland SDMA content | They could not be read this session. | BLOCKED |

## Revision after review (26 September 2026)

| # | What changed | Evidence |
|---|---|---|
| 1 | O2 and 0.5: MET Norway contact details in the User-Agent and response caching are now given in the terms' own "should" wording, with the stated risk of being blocked without warning. The earlier text called caching mandatory, which the terms do not say. The `open_meteo.py` citation now points at line 159, where the header is sent. | `PROVEN_BY_WEB`, `PROVEN_BY_SOURCE` |
| 2 | D5: Bhusanket is `ADMITTED_ALREADY` (`BLOCKED`), as the final ledger and the matrix record it. The earlier `NEEDS_LEGAL` silently reclassified it. The new evidence moved to drift item 0.7. | `PROVEN_BY_SOURCE` |
| 3 | T1: Copernicus DEM is now `CANDIDATE`, not `ADMITTED_ALREADY`. O1's elevation use is marked as admitted only in the matrix. Drift item 0.3 now records the conflicting records. | `PROVEN_BY_SOURCE` |
| 4 | D4 cites `SOURCE_ADMISSION_MATRIX.md:43` for Bhukosh. The final ledger §3 names only Bhusanket. | `PROVEN_BY_SOURCE` |
| 5 | D3 Tripura: the unsupported "(these point to IMD products)" was removed. The links are relative TDMA pages. | `PROVEN_BY_WEB` |
| 6 | §K: only Barman 2024 names distance to road. Only Harilal 2019 and Mandal 2020 give IMD-based I–D thresholds. Sengupta 2009 gives a cumulative-rainfall threshold. | `PROVEN_BY_RUNTIME` |
| 7 | IW2: only Karimganj is called part of the Indo-Bangladesh Protocol routes. Badarpur is an extended port of call of Karimganj. Sonamura is listed at "Tripura (IBP Route Corridor)". | `PROVEN_BY_WEB` (NW-16 page re-read) |
| 8 | F2 cites `config.py:286-287`. O1 says the DOI grep was fixed-string. C1 adds MTNL "Yet to be published" (TRAI PDF text re-extracted). New drift item 0.8 (Bhuvan/CartoDEM classified differently in the final ledger and the matrix). | `PROVEN_BY_SOURCE`, `PROVEN_BY_WEB` |
