# Security and legal plugin findings

Lane: `plugins-security-legal` (CISO + Legal). Date: 2026-09-26.
Code read: the local working tree on `main` (5b5e474 plus uncommitted changes). Where this
document says "hosted", it means commit `e4043ce` read with `git show`. The live Render and
Supabase services were not contacted.

**This is not legal advice.** The legal parts are general information, organised with a
checklist from a plugin skill. A qualified lawyer should review anything here before it
becomes a decision.

## How to read this

Each claim carries one evidence label:

| Label | Meaning |
| --- | --- |
| PROVEN_BY_SOURCE | Read in a file at the cited `path:line` |
| PROVEN_BY_RUNTIME | A command I ran in this session printed it |
| PROVEN_BY_WEB | A page I fetched in this session says it (URL given) |
| INFERRED | My reasoning from proven facts. Not verified. |
| NOT_VERIFIED | Unknown. Not the same as safe. |
| BLOCKED | Could not be checked, and the reason is given |

Decisions: **ADOPT_NOW** = small, no APK rebuild, do before the next deploy. **ROADMAP** = real
but needs a build, account access, a product decision or a lawyer. **REJECT** = do not do it.

Legal risk score = Severity (1-5) x Likelihood (1-5), using the scale from the
`legal-risk-assessment` skill: 1-4 GREEN, 5-9 YELLOW, 10-15 ORANGE, 16-25 RED. **I assigned
the scores myself using that scale. The plugin did not score these findings.**

What this lane did not do: it sent no requests to hosted services, used no database, installed
no packages, edited no code and scraped nothing. Secret values were only tested as present or
absent. No value appears in this document or in my output.

Scratch probes are in
`C:/Users/patel/AppData/Local/Temp/claude/D--Projects-ner-ai-logistics/2f919799-51fd-4107-9011-42ec4e7339f3/scratchpad/company2/plugins-security-legal/`
(`httpx_log_probe.py`, `scan_key.py`).

---

## 1. Plugin ledger

### 1.1 Legal: `legal:legal-risk-assessment`

| Field | Value |
| --- | --- |
| PLUGIN | `legal` plugin, skill `legal-risk-assessment` |
| OWNER_ROLE | Legal |
| TASK | Check licence compatibility of the third-party data and code in use, the obligations the DPDP Act 2023 creates for driver personal data, and the API terms of the providers the backend calls |
| WHY_RELEVANT | The maps and routes are built on OSM-derived data and free public APIs, and each has usage terms. The database stores driver identity documents and GPS history. |
| INPUT | I loaded the skill with the Skill tool and a one-paragraph brief. I gathered the repo evidence myself: a grep of `backend/app` for base URLs, the client map code, the licence fields in `node_modules/*/package.json`, the backend venv package metadata, the models and `docs/SECURITY.md`. |
| OUTPUT | The skill returned a framework: a severity x likelihood matrix, GREEN/YELLOW/ORANGE/RED bands, a memo layout and escalation guidance. It did not read the repo and produced no findings. I applied its scale to section 2 myself. |
| EVIDENCE | The Skill tool returned "Launching skill: legal:legal-risk-assessment" in this session [PROVEN_BY_RUNTIME] |
| STATUS | USED_AND_USEFUL |
| FOLLOW_UP | A lawyer should review P-2, P-3, P-4 and L-3 before a pilot with real drivers or any paid or government deployment. The skill's "consider engagement" rule for regulatory changes applies to the DPDP phase-in. |

### 1.2 Token security: `mapbox:mapbox-token-security`

| Field | Value |
| --- | --- |
| PLUGIN | `mapbox` plugin, skill `mapbox-token-security` |
| OWNER_ROLE | CISO |
| TASK | Apply the skill's token-security rules to the MapTiler key without printing the key |
| WHY_RELEVANT | The skill is written for Mapbox, but a MapTiler key is the same kind of credential: a client map key that is public by design and can only be restricted at the provider. The Mapbox-only parts (pk/sk/tk token types, scopes) do not apply to MapTiler. I used the parts that apply to any provider: keep keys in env, never commit them, restrict client keys, use one key per environment or platform, rotate keys, monitor usage and guard against a missing key. |
| INPUT | I loaded the skill with the Skill tool. I did not open its `references/*.md` files. |
| OUTPUT | The skill returned a checklist. The results of applying it are in section 3, and that analysis is mine. |
| EVIDENCE | The Skill tool returned "Launching skill: mapbox:mapbox-token-security" in this session [PROVEN_BY_RUNTIME] |
| STATUS | USED_AND_USEFUL |
| FOLLOW_UP | Finding S-2. The MapTiler dashboard needs the account owner. The Mapbox MCP servers needed authentication this session and were not used. The project has no Mapbox package in either client's direct dependencies (section 4.2) [PROVEN_BY_SOURCE: manager-web/package.json, driver-app/package.json]. |

### 1.3 Bright Data

| Field | Value |
| --- | --- |
| PLUGIN | `brightdata-plugin` (all skills) |
| OWNER_ROLE | CISO (policy gate) |
| TASK | Decide whether any Bright Data skill may be used, and check whether a Bright Data token variable exists |
| WHY_RELEVANT | The skill list in this session describes the `bright-data-mcp` skill as handling "CAPTCHAs, bot detection bypass" [PROVEN_BY_RUNTIME: this session's skill listing]. This lane's rules prohibit that. In this run, pib.gov.in and meity.gov.in both answered HTTP 403 to WebFetch [PROVEN_BY_RUNTIME]. Getting past that block with a bypass tool is exactly the use the policy forbids. |
| INPUT | None. I did not invoke any Bright Data skill or tool. |
| OUTPUT | None |
| EVIDENCE | The process environment has no value for `BRIGHTDATA_API_KEY`, `BRIGHTDATA_API_TOKEN`, `BRIGHT_DATA_API_KEY`, `BRIGHTDATA_TOKEN` or `API_TOKEN`. The first three are also unset at Windows User and Machine scope. No project `.env` file contains a `BRIGHT_DATA` or `BRIGHTDATA` variable name [PROVEN_BY_RUNTIME]. |
| STATUS | REJECTED_BY_POLICY |
| FOLLOW_UP | None. Do not install or authenticate it for this project. When a government page blocks automated reads, a person should read it in a browser. |

### 1.4 Zoom

| Field | Value |
| --- | --- |
| PLUGIN | `zoom-plugin` (MCP servers `zoom-mcp`, `zoom-docs-mcp`, `zoom-whiteboard-mcp`) |
| OWNER_ROLE | Legal (meeting records as evidence), none in practice |
| TASK | None available |
| WHY_RELEVANT | It would only matter if meeting recordings or transcripts were evidence sources |
| INPUT | None |
| OUTPUT | None |
| EVIDENCE | In this session all three servers failed with `AUTH_HEADER_REJECTED` (HTTP 401) [PROVEN_BY_RUNTIME: session MCP status notice]. The repo tracks 0 media or transcript files (`.vtt .m4a .mp4 .webm .mp3 .wav`) and 0 files with "zoom" in the name [PROVEN_BY_SOURCE: `git ls-files`]. |
| STATUS | BLOCKED (auth) / NOT_RELEVANT |
| FOLLOW_UP | Only if recordings become evidence. Re-authenticating is the user's job (`/mcp`). |

---

## 2. Findings

| ID | Severity | Finding | Where | Score | Decision |
| --- | --- | --- | --- | --- | --- |
| S-1 | High | The Gemini API key goes in the URL query string, and the app's INFO logging writes that URL, key included | `backend/app/services/gemini.py:323`, `backend/app/main.py:36` | 3x4=12 ORANGE | ADOPT_NOW |
| P-1 | Medium | `docs/SECURITY.md` describes a consent record, a retention job and data-export/erasure as if they exist. The code has none of them. | `docs/SECURITY.md:178,450-469` | 3x3=9 YELLOW | ADOPT_NOW |
| P-4 | Medium | Driver free text and trip facts go to the Gemini API, possibly on the unpaid tier, and to OpenRouter `:free` models | `backend/app/api/ai.py:63,169-171`, `backend/app/core/config.py:257` | 3x3=9 YELLOW | ADOPT_NOW |
| S-2a | Medium | The MapTiler key can be extracted from the submission APK. Whether the provider restricts it is unverified. | `release/RASTA-AI-1.0.18.apk`, `driver-app/src/map/scene.ts:65` | 2x3=6 YELLOW | ADOPT_NOW (dashboard) |
| S-2b | Medium | The WebView sends no app User-Agent, so a MapTiler User-Agent restriction has nothing to match | `driver-app/src/map/DriverRouteMap.native.tsx:188-199` | (with S-2a) | ROADMAP |
| L-2 | Medium | Hosted routing defaults to the public OSRM demo server, whose policy covers only reasonable, non-commercial use | `backend/app/core/config.py:182`, `render.yaml` | 3x3=9 YELLOW | ROADMAP |
| L-3 | Medium | Open-Meteo's free API is for non-commercial use only. Whether a ministry or operator deployment qualifies is unknown. | `backend/app/core/config.py:204,290`, `backend/app/services/terrain.py:5` | 3x3=9 YELLOW | ROADMAP |
| P-2 | Medium | There is no retention job, no export or erasure endpoint and no consent record for driver personal data | `backend/app`, `backend/alembic`, `supabase` | 4x2=8 YELLOW | ROADMAP |
| P-3 | Medium | ID document numbers, including AADHAAR and PAN, are stored in full and masked only when read | `backend/app/api/documents.py:71-75,104,226` | 4x2=8 YELLOW | ROADMAP |
| L-6 | Low | Manager address search queries Nominatim after a 700 ms pause in typing. That is close to the client-side autocomplete the policy prohibits. | `manager-web/src/components/AddressPicker.tsx:71,254-284` | 2x3=6 YELLOW | ROADMAP |
| L-1 | Low | The driver WebView loads OSM tiles with the default WebView User-Agent | `driver-app/src/map/DriverRouteMap.native.tsx:60,191` | 2x3=6 YELLOW | ROADMAP |
| L-4 | Low | The outbound User-Agent strings name the app but give no contact. The MET Norway fallback sends no conditional request. | six modules, see L-4 | 2x2=4 GREEN | ADOPT_NOW |
| L-5 | Low | OSM credits do not link to the copyright or ODbL page, and the weather and elevation data carry no Open-Meteo credit | `manager-web/src/components/FleetMap.tsx:90` and others | 2x2=4 GREEN | ADOPT_NOW (web) |
| L-8 | Low | There is no third-party notices file and no in-app open-source licences screen | repo, APK | 2x2=4 GREEN | ROADMAP |
| L-9 | Low | `driver-app/LICENSE` is Expo's template (copyright 650 Industries), and the repo has no root licence | `driver-app/LICENSE` | 2x2=4 GREEN | ROADMAP |
| L-10 | Low | A dormant browser routing path returns a fixed 305 km corridor geometry when OSRM fails | `manager-web/src/api/supabaseManagerApi.ts:543-600` | 3x1=3 GREEN | ROADMAP |
| L-7 | Low | The AWS Terrain Tiles credit is shortened, and the licence text does not explicitly allow that | `manager-web/src/components/mapTerrain.ts:37-46` | 1x2=2 GREEN | ROADMAP |
| S-3 | Info | The Supabase key in `driver-app/eas.json` has role `anon`, which is public by design | `driver-app/eas.json:16,28` | 1x1=1 GREEN | REJECT (no change) |
| BD-1 | n/a | Use Bright Data for scraping or bot-detection bypass | n/a | n/a | REJECT |

### S-1. The Gemini API key is written to logs (High)

- `gemini.py` builds the request URL as `.../{model}:generateContent?key={key}` [PROVEN_BY_SOURCE: backend/app/services/gemini.py:323].
- The app configures the root logger at INFO [PROVEN_BY_SOURCE: backend/app/main.py:36-39].
- No module in `backend/app` raises the `httpx` logger's level [PROVEN_BY_SOURCE: grep for httpx logger `setLevel` in backend/app found no match].
- I ran an offline probe: httpx 0.28.1, `MockTransport`, a dummy key and the app's logging level. It printed an INFO line from logger `httpx` that contained the full URL with the dummy key [PROVEN_BY_RUNTIME: scratch `httpx_log_probe.py`].
- The hosted commit has both lines too: `gemini.py:323` and `main.py:31` in `e4043ce` [PROVEN_BY_SOURCE: `git show e4043ce:...`].
- `render.yaml` declares `GEMINI_API_KEY` for the backend service [PROVEN_BY_SOURCE: render.yaml:120].
- The live Render logs therefore likely contain the real key [INFERRED]. I did not read those logs.
- The Supabase edge function also puts the key in the URL [PROVEN_BY_SOURCE: supabase/functions/gemini-ai/handler.ts:766]. Whether Supabase logs outbound URLs is NOT_VERIFIED.
- The Gemini REST API accepts the key in an `x-goog-api-key` header [PROVEN_BY_WEB: https://ai.google.dev/gemini-api/docs/api-key].
- This is a different issue from the cycle-1 prompt-text logging fix. That fix does not touch line 323 [PROVEN_BY_SOURCE: backend/app/services/gemini.py:323 in the working tree].

**ADOPT_NOW:** send the key as an `x-goog-api-key` header in both places, and set the `httpx`
logger to WARNING in `main.py`. After that is deployed, the key owner should rotate the Gemini
key. The old key may still be kept in Render's log retention [INFERRED].

### P-1. SECURITY.md claims privacy controls that do not exist (Medium)

- `docs/SECURITY.md` states: "Consent is captured at onboarding, recorded with timestamp and version" [PROVEN_BY_SOURCE: docs/SECURITY.md:178].
- It also states that retention is "enforced by a scheduled job" and that drivers "can request their own data export and deletion" [PROVEN_BY_SOURCE: docs/SECURITY.md:468-469].
- No consent column or table exists: "consent" does not appear in `backend/app/models`, `backend/alembic/versions` or `supabase` [PROVEN_BY_SOURCE: grep, no match].
- No retention or purge job exists. The only "retention" matches in `backend/app`, `backend/scripts` and `supabase` are comments [PROVEN_BY_SOURCE: backend/app/services/geocoding.py:49, backend/app/api/ai.py:155, backend/app/models/audit.py:36].
- No export or erasure route exists in `backend/app/api` [PROVEN_BY_SOURCE: grep of route decorators, no match].
- The same two sentences are on the hosted commit [PROVEN_BY_SOURCE: `git show e4043ce:docs/SECURITY.md`, lines 178 and 468].

**ADOPT_NOW:** mark those lines "planned, not implemented", or move them into section 12
("Known Gaps"). An evaluator or a ministry reader should not have to find this out from the
code.

### P-4. Driver text goes to free-tier AI providers (Medium)

- In assistant mode, the backend sends the provider the trip code, status, start time, planned ETA, delay minutes, the driver's question and up to 2,000 characters of client-supplied context [PROVEN_BY_SOURCE: backend/app/api/ai.py:63,97-104,169-171].
- The driver id is used for local rate limiting and does not go in the provider payload [PROVEN_BY_SOURCE: backend/app/services/gemini.py:92-104,259,307].
- Google's terms for unpaid services say human reviewers may read API input and output, and tell users not to submit sensitive, confidential or personal information to those services [PROVEN_BY_WEB: https://ai.google.dev/gemini-api/terms].
- The default OpenRouter models are `:free` variants [PROVEN_BY_SOURCE: backend/app/core/config.py:257].
- OpenRouter leaves data handling to each provider, and an account setting controls whether requests may route to providers that train on prompts [PROVEN_BY_WEB: https://openrouter.ai/docs/features/privacy-and-logging].
- Whether the hosted Gemini key is on a paid tier is NOT_VERIFIED. The same goes for the OpenRouter account's privacy setting.

**ADOPT_NOW:** the account owner should confirm Gemini billing, which moves the key to paid
terms, and set OpenRouter to exclude training providers. Until then, add one line in the driver
assistant: "Do not type names, phone numbers or ID numbers here." Data-processing terms with
these providers, for DPDP purposes, are ROADMAP.

### S-2a / S-2b. The MapTiler key is in the APK (Medium)

The detailed checklist is in section 3. In summary:

- The key value appears in `assets/index.android.bundle` inside `release/RASTA-AI-1.0.18.apk` [PROVEN_BY_RUNTIME: zip scan, boolean only].
- That APK is the submission build [PROVEN_BY_SOURCE: release/README.md:5].
- MapTiler says a client key is usable, but anyone can take and use an unsecured key. A key can be secured by an allowed HTTP origin (web) or an allowed User-Agent substring (native apps). MapTiler suggests rotating every 2-3 months and using one key per app and platform [PROVEN_BY_WEB: https://docs.maptiler.com/cloud/api/authentication-key/].
- The source comment says the key is "restricted per origin/app in the MapTiler dashboard" [PROVEN_BY_SOURCE: driver-app/src/map/scene.ts:46-48]. Whether that restriction exists is NOT_VERIFIED, because the dashboard is behind a login.
- The native map is a WebView with `baseUrl: 'https://driver.rasta.local/'` and no `applicationNameForUserAgent` [PROVEN_BY_SOURCE: driver-app/src/map/DriverRouteMap.native.tsx:188-199]. A User-Agent restriction therefore has no app-specific string to match. An origin restriction on `driver.rasta.local` would match any client that sends that header [INFERRED].
- The installed `react-native-webview` supports `applicationNameForUserAgent` [PROVEN_BY_SOURCE: driver-app/node_modules/react-native-webview/lib/WebViewTypes.d.ts:210].
- A missing key falls back to OpenTopoMap at build time [PROVEN_BY_SOURCE: driver-app/src/map/scene.ts:65-78]. A key that is present but rejected is not detected, so restricting or revoking the current key would likely blank the relief layer on the certified 1.0.18 APK [INFERRED].

**S-2a ADOPT_NOW (account owner, no rebuild):** check the dashboard for current restrictions,
and set a usage limit or alert. **S-2b ROADMAP (next APK build):** set
`applicationNameForUserAgent`, create separate keys for the native app and the web client,
restrict each key, and rotate the old key after the new build ships.

### L-2. Hosted routing uses the OSRM demo server (Medium)

- `ROUTING_FALLBACK_URL` defaults to `https://router.project-osrm.org` [PROVEN_BY_SOURCE: backend/app/core/config.py:182].
- `render.yaml` does not declare `ROUTING_PRIMARY_URL` [PROVEN_BY_SOURCE: render.yaml env keys]. Whether the Render dashboard sets it is NOT_VERIFIED.
- The demo server policy says: do not exceed 1 request per second, use is limited to reasonable, non-commercial cases, and there are no uptime guarantees [PROVEN_BY_WEB: https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server].
- `backend/app/services/routing/` has no request pacing (no lock, sleep or semaphore) [PROVEN_BY_SOURCE: grep, no match].
- The module's own header already says not to depend on this server alone [PROVEN_BY_SOURCE: backend/app/services/routing/osrm.py:17-30].

**ROADMAP:** self-host OSRM on a North-East extract before any pilot.

### L-3. Open-Meteo is free for non-commercial use only (Medium)

- The backend uses Open-Meteo for forecasts [PROVEN_BY_SOURCE: backend/app/core/config.py:204], elevation [PROVEN_BY_SOURCE: backend/app/services/terrain.py:5] and river discharge [PROVEN_BY_SOURCE: backend/app/core/config.py:290].
- The terms limit the free API to non-commercial use. Limits are 600 calls per minute, 5,000 per hour and 10,000 per day, and the data is CC BY 4.0 [PROVEN_BY_WEB: https://open-meteo.com/en/terms].
- Whether a ministry or fleet-operator production deployment counts as non-commercial is NOT_VERIFIED. That is a question for the provider or a lawyer.
- Weather answers are not cached, and route risk makes one weather call per sampled position [PROVEN_BY_SOURCE: backend/app/services/route_risk.py:79,112].

**ROADMAP:** get written confirmation or a paid plan before production, and add a weather
cache.

### P-2. No retention, erasure or consent implementation (Medium)

The DPDP background is in section 5. Code facts:

- There is no retention job, no export or erasure endpoint and no consent record (see P-1) [PROVEN_BY_SOURCE].
- `Driver` uses a soft-delete mixin [PROVEN_BY_SOURCE: backend/app/models/identity.py:133].
- The driver app shows an in-app notice that location is shared with the manager during a trip [PROVEN_BY_SOURCE: driver-app/src/i18n/phrases.ts:135,332; driver-app/src/screens/TripScreen.tsx:1084].
- No wider privacy notice exists: "privacy" matches nothing in `driver-app/src/screens` or `phrases.ts` [PROVEN_BY_SOURCE: grep].
- SECURITY.md already lists "No formal DPIA" as a gap [PROVEN_BY_SOURCE: docs/SECURITY.md:496].

**ROADMAP, before real drivers:** a retention job for `gps_points`, refresh tokens and
documents; a driver data export and erasure request path; a privacy notice with a recorded
version; and a DPIA.

### P-3. ID numbers are stored in full (Medium)

- Document types include `AADHAAR` and `PAN` [PROVEN_BY_SOURCE: backend/app/models/enums.py:69-78].
- The comment on `GOVERNMENT_ID` says it is "stored as a masked number" [PROVEN_BY_SOURCE: backend/app/models/enums.py:71-72].
- The API accepts `doc_number` up to 64 characters and stores it as given [PROVEN_BY_SOURCE: backend/app/api/documents.py:104,226].
- `masked()` is applied only on read [PROVEN_BY_SOURCE: backend/app/api/documents.py:71-75,138].
- UIDAI's Aadhaar Data Vault requirements apply to requesting entities (AUA/KUA), not to employers that collect staff Aadhaar details for internal use [PROVEN_BY_WEB: https://www.mondaq.com/india/privacy-protection/1719124/vaulting-to-safety-uidai-issues-clarifications-on-applicability-of-aadhaar-data-vault-requirements]. No vault duty follows from the current design [INFERRED]. Storing full numbers still makes a breach worse [INFERRED].
- Whether any database holds a real Aadhaar or PAN number is NOT_VERIFIED, because this lane used no database.

**ROADMAP:** at write time, store only what `masked()` already shows (the last four characters),
or remove `AADHAAR` from the enum. Do not add Aadhaar authentication, because that is what makes
an entity a requesting entity [INFERRED from the same page].

### L-6. Nominatim is queried as you type (Low)

- The address search queries Nominatim 700 ms after typing stops [PROVEN_BY_SOURCE: manager-web/src/components/AddressPicker.tsx:71,254-284].
- The Nominatim policy forbids building autocomplete on the client side, sets a maximum of 1 request per second and forbids grid or systematic reverse queries [PROVEN_BY_WEB: https://operations.osmfoundation.org/policies/nominatim/].
- The server side follows the rate rule: one shared lock, a 1.1 s gap and a cache [PROVEN_BY_SOURCE: backend/app/services/geocoding.py:103-117; backend/app/services/warnings.py:50,114-117].
- Whether OSMF would treat a search that fires after a pause as autocomplete is INFERRED.
- A ban would also stop the NDMA warning district lookup, which uses the same host and User-Agent [PROVEN_BY_SOURCE: backend/app/services/warnings.py:114-119, backend/app/core/config.py:303].

**ROADMAP:** search on Enter or a button press.

### L-1. OSM tiles in the driver WebView (Low)

- The native map requests `tile.openstreetmap.org` from a WebView page whose base URL is `https://driver.rasta.local/`, and sets no app User-Agent [PROVEN_BY_SOURCE: driver-app/src/map/DriverRouteMap.native.tsx:60,191].
- The OSMF tile policy requires a clear, unique User-Agent that names the app, says not to use a library default, and warns that traffic with generic defaults can be blocked without notice. It also forbids offline use and bulk prefetch [PROVEN_BY_WEB: https://operations.osmfoundation.org/policies/tiles/].
- Whether OSMF treats the WebView User-Agent as a library default is INFERRED.
- The working-tree `render.yaml` sets `Referrer-Policy: strict-origin-when-cross-origin` for the manager and driver web sites, which still sends the origin as Referer [PROVEN_BY_SOURCE: render.yaml:154,183]. `e4043ce` has no such header [PROVEN_BY_SOURCE: `git show e4043ce:render.yaml`].

**ROADMAP:** this is the same `applicationNameForUserAgent` change as S-2b, and it ships in the
same build.

### L-4. User-Agent has no contact; MET Norway fallback sends no conditional request (Low)

- The User-Agent is `ner-fleet-intelligence/0.1 (SIH26002; <purpose>)`, with no email or URL. It is defined in `backend/app/services/weather/open_meteo.py:47`, `routing/osrm.py:78`, `geocoding.py:113`, `terrain.py:53`, `flood.py:25` and `warnings.py:39` [PROVEN_BY_SOURCE].
- MET Norway requires the application name plus a contact email address or a website link. Requests it cannot trace risk being blocked or getting 403. It requires `If-Modified-Since` and respect for `Expires`, and at most 4 coordinate decimals. The data is CC BY 4.0 [PROVEN_BY_WEB: https://api.met.no/doc/TermsOfService].
- The fallback sends a plain GET with neither header [PROVEN_BY_SOURCE: backend/app/services/weather/open_meteo.py:154-160].
- It does round coordinates to 4 decimals [PROVEN_BY_SOURCE: backend/app/services/weather/open_meteo.py:158].

**ADOPT_NOW:** add the repository URL or a team mailbox to the User-Agent. Use one shared
constant rather than six copies. Conditional requests can wait for the weather cache in L-3.

### L-5. Attribution (Low)

- The OSM credit reads "© OpenStreetMap contributors" with no link [PROVEN_BY_SOURCE: manager-web/src/components/FleetMap.tsx:90; manager-web/src/components/AddressPicker.tsx:610; driver-app/src/map/DriverRouteMap.web.tsx:128; driver-app/src/map/DriverRouteMap.native.tsx:60].
- The OSM copyright page asks users to make clear that the data is under the ODbL, and to link to the licence or give `https://www.openstreetmap.org/copyright` [PROVEN_BY_WEB: https://www.openstreetmap.org/copyright].
- Collapsing the credit is allowed if it is visible at first and collapses on interaction or after 5 seconds [PROVEN_BY_WEB: https://osmfoundation.org/wiki/Licence/Attribution_Guidelines]. MapLibre's compact control opens expanded and minimises on interaction [PROVEN_BY_SOURCE: manager-web/node_modules/maplibre-gl/dist/maplibre-gl-dev.mjs:22697-22712].
- The flood line credits "GloFAS via Open-Meteo" [PROVEN_BY_SOURCE: manager-web/src/components/TripRouteReview.tsx:130]. A grep of both clients for "open-meteo" found no other credit, so weather and elevation data have none [PROVEN_BY_SOURCE].

**ADOPT_NOW for manager-web:** link the OSM credit to the copyright page and add "Weather:
Open-Meteo.com (CC BY 4.0)" where weather is shown. The driver native strings change at the
next build.

### L-8. No third-party notices (Low)

- The repo tracks no NOTICE, THIRD_PARTY or licences file. Only `docs/research/THIRD_PARTY_ADOPTION.md` and `driver-app/LICENSE` match [PROVEN_BY_SOURCE: `git ls-files`].
- The APK contains 4 licence or notice entries, all from AndroidX and okhttp [PROVEN_BY_RUNTIME: zip listing of release/RASTA-AI-1.0.18.apk].
- No licences screen exists in either client [PROVEN_BY_SOURCE: grep].
- The MIT text requires that "the above copyright notice and this permission notice shall be included in all copies or substantial portions" [PROVEN_BY_SOURCE: driver-app/LICENSE].

**ROADMAP:** generate a notices file from the licence fields in `node_modules/*/package.json`
(no new package is needed), and add a licences item to the driver app menu.

### L-9. Wrong licence file (Low)

- `driver-app/LICENSE` is Expo's template MIT licence, "Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)", and has been tracked since `3a0278e` [PROVEN_BY_SOURCE].
- The repo has no root licence file [PROVEN_BY_SOURCE: `git ls-files`].
- As a result, the driver folder looks MIT-licensed under Expo's name, and the rest of the repo states no licence [INFERRED].

**ROADMAP:** this is a team decision. Either replace the file or remove it.

### L-10. Fabricated fallback route in a dormant path (Low)

- `supabaseManagerApi.ts` calls the OSRM demo server from the browser. If that call fails, it returns a fixed 8-point line with `distance: 305390`, whatever the endpoints are, and labels it `cached_corridor` [PROVEN_BY_SOURCE: manager-web/src/api/supabaseManagerApi.ts:543-600].
- The hosted manager builds with `VITE_BACKEND=local`, so it does not use this path [PROVEN_BY_SOURCE: render.yaml:134-135; e4043ce render.yaml:123-124].

**ROADMAP:** delete the fixed geometry before `VITE_BACKEND=supabase` is used anywhere.

### L-7. Terrain Tiles credit is shortened (Low)

- The credit names SRTM and GMTED2010 only, on the grounds that the other sources do not cover the region [PROVEN_BY_SOURCE: manager-web/src/components/mapTerrain.ts:37-46].
- The Terrain Tiles attribution document lists the required credits per source and does not explicitly allow leaving any out [PROVEN_BY_WEB: https://github.com/tilezen/joerd/blob/master/docs/attribution.md].

**ROADMAP:** add a link to that full list.

### S-3. The Supabase key in eas.json is expected (Info)

- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `driver-app/eas.json` carries the role claim `anon`. I decoded only the claim names and the role [PROVEN_BY_SOURCE: driver-app/eas.json:16,28].
- Anonymous grants are revoked on the core tables [PROVEN_BY_SOURCE: supabase/migrations/20260907120100_data_api_grants_rls.sql:25-42].
- RLS is enabled on every table created by Alembic [PROVEN_BY_SOURCE: backend/alembic/versions/0002_core_domain.py:822, 0007:221, 0010:171, 0011:47, 0012:37, 0013:129,221].
- The hosted RLS state is NOT_VERIFIED. The Supabase MCP needed authentication, and hosted queries are out of scope.

**REJECT** moving the key, because it is public by design. **Follow-up:** run the Supabase
security advisors once the MCP is authorised.

### BD-1. Bright Data scraping (REJECT)

See section 1.3.

---

## 3. MapTiler key checklist (from the token-security skill)

| Checklist item | Status here | Evidence |
| --- | --- | --- |
| Key read from env, not written in source | Read from `EXPO_PUBLIC_MAPTILER_KEY` | PROVEN_BY_SOURCE: driver-app/src/map/scene.ts:65 |
| Value kept out of tracked files | The scan found the value only in `driver-app/.env`, which is git-ignored. It covered 1,246 working-tree files and skipped node_modules, .git, .venv, .expo, .gradle and .runtime. | PROVEN_BY_RUNTIME |
| Never committed | `git log --all -S <value>` returned 0 commits, and `git grep` found 0 files | PROVEN_BY_RUNTIME |
| Shipped builds | The value is inside the 1.0.18 APK bundle, so it is public by design | PROVEN_BY_RUNTIME |
| Shipped builds | The Render driver web build declares no MapTiler variable, so it uses the OpenTopoMap fallback | PROVEN_BY_SOURCE: render.yaml:168-170 |
| Restricted at the provider | Unknown | NOT_VERIFIED |
| Restriction possible for this client | Only after the WebView sets an app User-Agent | PROVEN_BY_SOURCE: DriverRouteMap.native.tsx:188-199 |
| One key per environment or platform | One variable serves both native and web driver builds | PROVEN_BY_SOURCE: scene.ts:65 |
| Rotation (MapTiler suggests 2-3 months) | No rotation record found | NOT_VERIFIED |
| Usage monitoring or alerts | Unknown | NOT_VERIFIED |
| Guard for a missing key | A missing key falls back to OpenTopoMap and switches the credit | PROVEN_BY_SOURCE: scene.ts:65-78 |
| Guard for a rejected key | None | INFERRED |
| Credit when the key is used | "© MapTiler" with a link, alongside the base layer's OSM credit | PROVEN_BY_SOURCE: scene.ts:72-73 |
| MapTiler's required credit | "© MapTiler" and "© OpenStreetMap contributors", visible | PROVEN_BY_WEB: https://www.maptiler.com/copyright/ |

The same rule applied to server keys:

- `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_PLACES_API_KEY` and `EXPO_ACCESS_TOKEN` are backend settings with no client prefix [PROVEN_BY_SOURCE: backend/app/core/config.py].
- The startup settings log is an allowlist that excludes them [PROVEN_BY_SOURCE: backend/app/core/config.py:478-500].
- The Places key and the OpenRouter key travel in headers [PROVEN_BY_SOURCE: backend/app/services/geocoding.py:209,301; backend/app/services/gemini.py:92].
- The Gemini key is the exception (S-1).

---

## 4. Licences

### 4.1 Data and API providers the code calls

| Provider | Used for | Code | Terms I read | Where the code stands |
| --- | --- | --- | --- | --- |
| OSM tiles | Base map, both clients | FleetMap.tsx:86; DriverRouteMap.web.tsx:125; DriverRouteMap.native.tsx:60 | Credit, a User-Agent that names the app, Referer from websites, cache for at least 7 days, no offline or bulk use [PROVEN_BY_WEB: operations.osmfoundation.org/policies/tiles/] | L-1, L-5 |
| Nominatim | Geocoding, district lookup | geocoding.py; warnings.py | See L-6 [PROVEN_BY_WEB] | Rate rule met; L-6 |
| OSRM demo | Routing fallback | config.py:182 | See L-2 [PROVEN_BY_WEB] | L-2 |
| Open-Meteo | Weather, elevation, flood | config.py:204,290; terrain.py:5 | See L-3 [PROVEN_BY_WEB] | L-3, L-5 |
| MET Norway | Weather fallback | open_meteo.py:146-180 | See L-4 [PROVEN_BY_WEB] | L-4 |
| OpenTopoData | Elevation fallback | config.py:282 | At most 100 locations per request, 1 call per second, 1,000 per day [PROVEN_BY_WEB: https://www.opentopodata.org/] | Spaces calls 1.0 s apart [PROVEN_BY_SOURCE: terrain.py:96] |
| MapTiler | Driver hillshade (keyed) | scene.ts:67-73 | See section 3 [PROVEN_BY_WEB] | S-2 |
| OpenTopoMap | Keyless hillshade fallback | scene.ts:70,74 | CC-BY-SA 3.0, credit to OSM, SRTM and OpenTopoMap, no heavy bulk use [PROVEN_BY_WEB: https://opentopomap.org/about] | Credit present [PROVEN_BY_SOURCE: scene.ts:74] |
| AWS Terrain Tiles | Manager 3D terrain | mapTerrain.ts:49 | See L-7 [PROVEN_BY_WEB] | L-7 |
| Gemini API | Driver assistant | gemini.py:323 | See P-4 and S-1 [PROVEN_BY_WEB] | S-1, P-4 |
| OpenRouter | AI fallback | gemini.py:92-104 | See P-4 [PROVEN_BY_WEB] | P-4 |
| NDMA SACHET RSS | Official warnings | config.py:298 | Not read | NOT_VERIFIED |
| Google Places | Address search (optional) | geocoding.py:47 | Not read | Not set in render.yaml [PROVEN_BY_SOURCE] |
| Expo Push | Driver notifications | notify.py:42 | Not read | NOT_VERIFIED |

### 4.2 Code licences

- **Leaflet** 1.9.4 is BSD-2-Clause [PROVEN_BY_SOURCE: driver-app/node_modules/leaflet/package.json]. The native WebView also loads it from unpkg with pinned sha384 SRI [PROVEN_BY_SOURCE: driver-app/src/map/DriverRouteMap.native.tsx:48-55].
- **MapLibre GL JS** 6.6.0 is BSD-3-Clause [PROVEN_BY_SOURCE: manager-web/node_modules/maplibre-gl/package.json].
- Every direct dependency of both clients is MIT, ISC, BSD-2/3-Clause or Apache-2.0 [PROVEN_BY_SOURCE: node_modules/*/package.json of each dependency]. No direct dependency is from Mapbox [PROVEN_BY_SOURCE].
- **manager-web**, top-level `node_modules` (177 packages) [PROVEN_BY_RUNTIME: licence census]:
  - 142 MIT and 13 ISC.
  - Also permissive: Apache, BSD, MIT-0, CC0, 0BSD and BlueOak.
  - Flagged: `lightningcss` MPL-2.0, a build-time CSS tool.
- **driver-app**, top-level `node_modules` (504 packages) [PROVEN_BY_RUNTIME: licence census]:
  - 433 MIT and 24 ISC.
  - Flagged: `lightningcss` MPL-2.0 (build tool); `node-forge` "(BSD-3-Clause OR GPL-2.0)", where BSD can be chosen; `caniuse-lite` CC-BY-4.0 (build-time data); `argparse` Python-2.0.
- No GPL-only or AGPL package appeared in either census [PROVEN_BY_RUNTIME]. Nested `node_modules` folders were not scanned, so their licences are NOT_VERIFIED.
- **Backend venv** (46 distributions): `psycopg` and `psycopg-binary` are LGPLv3, and `certifi` is MPL-2.0 [PROVEN_BY_RUNTIME: importlib.metadata census]. They are used unmodified on a server and not distributed, so no copyleft duty is triggered [INFERRED].

---

## 5. DPDP Act 2023: general information and where the code stands

Not legal advice. Sources are secondary summaries (Wikipedia). The primary government pages
returned HTTP 403 to automated fetches in this run [PROVEN_BY_RUNTIME], and I did not bypass
that block.

- The Act's summary lists: notice and consent, "legitimate uses" including employment, security safeguards, breach notification, erasure, and rights to access, correction, erasure and grievance. Transfers are allowed except to a government-restricted list. The maximum penalty is ₹250 crore for failing to take security safeguards. Full provisions commence on 13 May 2027 [PROVEN_BY_WEB: https://en.wikipedia.org/wiki/Digital_Personal_Data_Protection_Act,_2023].
- The Rules were notified on 14 November 2025, with some parts phased in. Privacy notices must state purposes, data categories, retention periods and how to withdraw consent [PROVEN_BY_WEB: https://en.wikipedia.org/wiki/Digital_Personal_Data_Protection_Rules,_2025].
- A search-result snippet gave 13 November. I did not fetch that page, so the exact date is NOT_VERIFIED.
- Whether drivers count under the employment legitimate use is a legal question and NOT_VERIFIED. It also depends on whether they are employees or contractors.
- The data fiduciary would be the operator that deploys the platform, not the development team [INFERRED].

| Personal data held | Where | Evidence |
| --- | --- | --- |
| Name, phone, emergency contact name and phone, licence number, class and expiry, photo, monthly salary, push token | `drivers` | PROVEN_BY_SOURCE: backend/app/models/identity.py:144-164 |
| ID document type, full number and file (including AADHAAR and PAN) | `driver_documents` | PROVEN_BY_SOURCE: backend/app/models/identity.py:213-235; backend/app/models/enums.py:69-78 |
| GPS position, speed, heading and accuracy per trip | `gps_points` | PROVEN_BY_SOURCE: backend/app/models/operations.py:557-591 |
| IP address and User-Agent per session; IP address in the audit log | `refresh_tokens`, `audit_logs` | PROVEN_BY_SOURCE: backend/app/models/auth.py:54-55; backend/app/models/audit.py:55 |
| Driver's free-text assistant questions (not stored; sent to the AI provider) | provider | PROVEN_BY_SOURCE: backend/app/api/ai.py:152-156,169-181 |

| Hosting | Region | Evidence |
| --- | --- | --- |
| Render backend | `singapore` | PROVEN_BY_SOURCE: render.yaml:36 |
| Supabase | `ap-south-1`, as recorded in a repo doc | PROVEN_BY_SOURCE: docs/FINAL_MASTER_CHECKPOINT.md:4. The live region is NOT_VERIFIED. |

| Obligation (from the summaries above) | Code status | Finding |
| --- | --- | --- |
| Notice | Location-sharing notice only | P-2 |
| Consent record | None | P-1, P-2 |
| Security safeguards | RLS, masking on read, allowlisted config log. A key reaches the logs (S-1). ID numbers are stored in full (P-3). | S-1, P-3 |
| Erasure and retention | None; soft delete only | P-2 |
| Rights requests | None | P-2 |
| Breach notification process | Not checked | NOT_VERIFIED |
| Processors (AI providers) | No data terms on record | P-4 |

---

## 6. Checked and in order

- The Nominatim limit of 1 request per second is enforced by one lock shared across geocoding and warnings, with a cache and an on-screen OSM credit [PROVEN_BY_SOURCE: geocoding.py:103-117; warnings.py:50,114-117; AddressPicker.tsx:417].
- OpenTopoData calls are spaced 1.0 s apart [PROVEN_BY_SOURCE: terrain.py:96].
- MET Norway coordinates are rounded to 4 decimals [PROVEN_BY_SOURCE: open_meteo.py:158].
- When MapTiler is in use, the credit matches MapTiler's required text [PROVEN_BY_SOURCE: scene.ts:73].
- The OpenTopoMap credit names SRTM and OpenTopoMap under CC-BY-SA, and the OSM credit comes from the base layer [PROVEN_BY_SOURCE: scene.ts:74].
- The MapTiler key is not in git history or in any tracked file [PROVEN_BY_RUNTIME].
- The committed Supabase key is `anon` [PROVEN_BY_SOURCE].
- RLS is enabled on every table Alembic creates [PROVEN_BY_SOURCE].
