# RASTA AI brand and copy guide

**Date** 26 September 2026 · **Lane** Head of Design + Brand (`plugins-design-brand`)
**Applies to** The manager fleet console (`manager-web`), the driver app (`driver-app`, including its
manager shell), the web page metadata, and any document or slide that quotes the product.
**Status** A proposal. Nothing in the product has been changed. The violations in §8 are what exists
in the current working tree.

**Evidence labels.** Every claim carries one label:

- `PROVEN_BY_SOURCE`: file:line in this repository.
- `PROVEN_BY_RUNTIME`: a command run in this lane.
- `INFERRED`: a conclusion that was not observed directly.
- `NOT_VERIFIED`: not checked.
- `BLOCKED`: could not be checked.

Rules marked **(rule)** are policy proposals, not claims.

---

## 0. How this guide was built

- **Plugin used: `brand-voice:discover-brand`. Status: `BLOCKED`.** It searches connected document
  platforms. Notion, Figma, Gong and Granola need authentication in this session, and no Drive,
  SharePoint, Confluence or Box connector is available. The plugin produced no output.
- **Plugin used: `brand-voice:brand-voice-enforcement`.** It was loaded with the Skill tool. No
  `.claude/brand-voice-guidelines.md` exists (`PROVEN_BY_RUNTIME`). I applied its "voice constant,
  tone flexes" model and its "We Are / We Are Not" table **by hand**. The plugin's agent did not write
  any text in this guide.
- **Plugin used: `frontend-design`.** Its interface-writing rules were applied by hand:
  - name things in the user's words;
  - errors never vague and never apologetic;
  - an action keeps its name through the flow.
- **Local sources the voice was discovered from** (all `PROVEN_BY_SOURCE`):
  - `SUBMISSION_README.md:1-7`: the product name and the core claim ("UNKNOWN is never treated as SAFE").
  - `docs/PPT_SOURCE_OF_TRUTH.md:3`: the repository's existing wording rules and banned phrases.
  - `backend/app/domain/ai_prompts.py:22-47`: the AI assistant may only restate given facts, and may
    not "tell anyone a road is safe or clear, or promise that help is coming".
  - `manager-web/src/index.css:14-20` and `driver-app/src/theme.ts:8-12`: the hue meanings.
  - `docs/REDESIGN_CERTIFICATION.md` §1: the mockup claims the redesign refused to copy.
  - `docs/PRODUCT_VISION.md:43-46`: who uses each app, and where.
  - `driver-app/src/themeWording.test.ts:1-3`: "Light / Dark, never Day / Night".
- **No brand book exists in the repository.** The only brand asset is `brand/mark.svg`, with its
  renderer `brand/render.mjs` (`PROVEN_BY_RUNTIME`, `find`).

---

## 1. Names

| Thing | Use | Do not use | Found in the product today |
|---|---|---|---|
| Product | **RASTA AI**. After first use in running text, **RASTA** is fine. | NER Logistics, NER Driver, NER Fleet Intelligence | `driver-app/app.json:3` "RASTA AI" (correct). "NER FLEET CONSOLE" `manager-web/src/App.tsx:271`. "NER Logistics" `manager-web/src/pages/LoginPage.tsx:781`. "NER LOGISTICS" `driver-app/src/screens/LoginScreen.tsx:120`. "NER Driver shares your location…" `driver-app/app.json:31`. "NER Fleet Intelligence" in a CSS comment only (`manager-web/src/index.css:4`). All `PROVEN_BY_SOURCE`. |
| Manager web | **Fleet console** | Manager console, NER fleet console, Command centre | "Fleet console" `manager-web/index.html:19`. "Manager console" `LoginPage.tsx:441`. |
| Driver app | **RASTA AI driver app** | NER Driver App | "NER Driver App" `driver-app/dist/index.html:7`, a stale local build dated 30 August (`PROVEN_BY_SOURCE`). |
| Team | **NER-AI LOGISTICS**, only in submission documents | inside the product UI | `SUBMISSION_README.md:1` |
| Problem statement | **SIH26002 (MDoNER)** | | `SUBMISSION_README.md:3` |
| Region | Formal: **North Eastern Region (NER)**. In the UI: **North East**. | NE, the Northeast, North-East (pick one) | The UI mixes "North East India" (`LoginPage.tsx:458`) and "North-East" (scope label, `.runtime/evidence/responsive-redesign/overview-320.png`). |

**(rule)** The "AI" in the product name is a name, not a claim. Never expand it into a sentence about
what AI does. See §5.

The meaning of "RASTA": no document in the repo defines it, so it is `NOT_VERIFIED`. It is also the
Hindi word for "road" or "way" (`INFERRED`). Do not present it as an acronym.

---

## 2. Voice: constant in both apps

| We are | We are not |
|---|---|
| **Plain.** We say what the system knows, in the user's words. | Technical to users. No "backend", "API", "server-side", "rows" or "engine". |
| **Evidence-led.** We name the source and the age of what we show. | Reassuring beyond the evidence. No "safe", "clear" or "all good". |
| **Honest about gaps.** UNKNOWN is shown in words. | Filling a gap with green, a dash or silence when a *factor* is unknown. |
| **Calm and direct.** Short sentences, verbs first, no exclamation marks. | Alarmist or cheerful. No "Oops", no "Sorry". |
| **Respectful of the person at the wheel.** We say what the button does and leave the judgment with them. | Commanding beyond the evidence, or blaming. |
| **Regional and specific.** We name corridors, states and yards. | Promotional. No slogans, no "Stronger India", no "Brighter futures". |

These rules are drawn from the sources in §0, especially `PPT_SOURCE_OF_TRUTH.md:3` and
`ai_prompts.py:22-47`. The table itself is a proposal.

---

## 3. Tone: Manager and Driver

Tone uses the brand-voice model's three dimensions. The user contexts come from
`docs/PRODUCT_VISION.md:44-45` (`PROVEN_BY_SOURCE`). How each dimension is set is a proposal.

| | Manager (desk, browser, several screens) | Driver (cab, one hand, poor signal, sometimes at night) |
|---|---|---|
| Formality | Medium to high. Complete sentences. | Medium. Short imperative lines. |
| Energy | Low and steady, even for incidents. | Low. Emergencies only: direct imperative, one line. |
| Technical depth | Medium to high. Evidence names, provider names on the System page, reason codes with words. | Low. No internal words. Numbers carry units ("12 km", "2 min ago"). |
| Line length | Up to about 25 words, with reasoning allowed. | About 10 words per line. One instruction per message. |
| Language | English. The console UI is English-only today (`INFERRED` from `manager-web/src/i18n/` holding only reason codes). | Every visible string **and** every accessibility label goes through `t()`. There are 23 languages in the selector (`docs/PPT_SOURCE_OF_TRUTH.md` §9). |
| Case | Sentence case for buttons, titles and pills. | Sentence case. Short caps section labels (for example "CURRENT TRIP") are allowed at 12px or larger. |
| Example | "Route not selected. Hazard data is UNKNOWN for N of 11 factors; a reviewer must authorise before dispatch." | "Route not selected. Your manager assigns the road first." (`driver-app/src/screens/MapScreen.tsx:1119`) |

The manager example above is illustrative. It is not a string in the product.

---

## 4. Terminology

| Use | Do not use | Why |
|---|---|---|
| **route decision**: CONTINUE, CAUTION, HOLD or REROUTE | "safe route", "Route status: Safe", "risk-free" | These are the outputs of the deterministic policy (`PPT_SOURCE_OF_TRUTH.md` §2). `PROVEN_BY_SOURCE` |
| **evidence coverage** | confidence, accuracy, "AI confidence" | Coverage is what is shown (`PPT_SOURCE_OF_TRUTH.md` §3). |
| **UNKNOWN** | clear, OK, normal, "no issues" | UNKNOWN is never SAFE (`SUBMISSION_README.md:7`). |
| **official warning** | "government alert" (vague) | `PPT_SOURCE_OF_TRUTH.md:3` |
| **weather forecast** | live weather, real-time weather | Forecasts have a cadence (`PPT_SOURCE_OF_TRUTH.md` §3). |
| **flood context** | flood prediction | `PPT_SOURCE_OF_TRUTH.md:3` |
| **historical landslide exposure** | landslide risk prediction, landslide detection | `PPT_SOURCE_OF_TRUTH.md:3` |
| **experimental landslide model** | "AI landslide model" or any claim that it controls routing | Rejected for production (`PPT_SOURCE_OF_TRUTH.md` §10). |
| **fleet traffic estimate** ("N % of the road graded from M RASTA trucks") | live traffic, Google-level traffic | `backend/app/domain/traffic.py`, as cited at `PPT_SOURCE_OF_TRUTH.md:40` |
| **suggested stop** | safe stop, safe place | `PPT_SOURCE_OF_TRUTH.md:3` |
| **reroute proposal**, which the manager approves | "AI reroutes", "auto-reroute" | Every reroute is human-approved (`SUBMISSION_README.md:7`). |
| **reviewer authorisation** | override, force | `PPT_SOURCE_OF_TRUTH.md` §5 |
| **deterministic rule** | prediction, predictive | `manager-web/src/pages/FleetPage.tsx:1525-1527`, `pages/SystemPage.tsx:211` |
| **assistant** or **AI assistant**, only for the Gemini / OpenRouter / local helper | "AI" for route decisions | "wording only — never a decision" (`pages/SystemPage.tsx:44`) |
| **GPS fix**, "last fix 2 min ago" | live location (unqualified), real-time tracking | Fixes have an age. The topbar shows it (`App.tsx:204-208`). |
| **trip**, **trip code** (TRP-…), **stop**, **pickup**, **destination** | job, order, run | Screen copy (`light-01-trip-412.png`) |
| **operational region**; scope **North East / state / district** | territory, zone | `LoginPage.tsx:468` |
| Roles: **Regional head, State manager, District manager, Fleet manager, Administrator, Driver** | NORTH_EAST_MANAGER and other raw enums | `App.tsx:233-247` |
| Driver tabs: **Trip, Navigate, Safety, More** | Home | `REDESIGN_CERTIFICATION.md` §1 |
| Theme: **Light / Dark** | Day / Night | `themeWording.test.ts:1-3` |
| **Sign in / Sign out** | Log in and Sign In mixed together | "Log in" `LoginPage.tsx:277,374`. "Sign In" `appLanguage.ts:171`. "Sign out" `App.tsx:224`. |

---

## 5. Safety wording rules

- **S1 (rule).** Never call a road, route, corridor, trip or place *safe, safer, safest, clear,
  risk-free* or *guaranteed*.
  - The product outputs a route decision and evidence coverage, not a safety certificate. The AI
    prompt already forbids the model to say it (`ai_prompts.py:45-46`), and the UI must not say what
    the model may not.
  - When eligibility must be stated, use the product's own sentence: "Eligible under the checks that
    ran. Not a safety guarantee." (`manager-web/src/components/RouteCandidateCards.tsx:66`)
  - **Allowed.** A person's report about themselves: "I am safe" on the driver check-in
    (`driver-app/src/screens/TripScreen.tsx:287`).
  - **Allowed.** An instruction that leaves the judgment with the driver: "Stop somewhere safe if you
    cannot see the road." (`driver-app/src/safety/riskCards.ts:96`)
- **S2 (rule). UNKNOWN is not SAFE.**
  - An unknown factor is named as UNKNOWN in words. It is never coloured green, never hidden, never
    shown as a dash, and never averaged into a score that looks complete.
  - Model to copy: "Unknown, not clear." (`manager-web/src/components/TripRouteReview.tsx:166`)
  - A dash is only for a *value* that does not exist yet, such as REMAINING before a route loads.
- **S3 (rule).** Never write "AI predicts", "AI detected", "predictive" or "AI-powered" about route
  risk, hazards or traffic.
  - The route decision is a deterministic rule (`SystemPage.tsx:211`).
  - The only locally trained hazard model is experimental and does not control routing
    (`PPT_SOURCE_OF_TRUTH.md` §10).
- **S4 (rule).** Never write "real-time" or "live" unless the age is shown next to it. Traffic is a
  fleet estimate, not live traffic (`SUBMISSION_README.md:59`).
- **S5 (rule).** Show no number without stored data behind it: no trend arrows, no "+12%", and no
  "120+ districts" (`REDESIGN_CERTIFICATION.md` §1). A count must say what it counts. "Verified" means
  `VERIFIED_OFFICIAL` only (see V10).
- **S6 (rule).** For emergencies, say what the control does, and never promise help. Model: "Tapping
  opens your dialler. You still press call." (`driver-app/src/screens/SafetyScreen.tsx:379`). Never
  write "Help is on the way" (`ai_prompts.py:46`).
- **S7 (rule).** Translations may not strengthen a claim. A comparative must not become an absolute
  (see V3).

**Banned-phrase list for a copy test** (proposal A13 in `DESIGN_PLUGIN_COMPARISON.md`):
`safe route`, `safe routes`, `safer route`, `safer routes`, `safer logistics`, `AI predicts`,
`AI detected`, `predictive`, `real-time intelligence`, `live traffic`, `guaranteed`, `risk-free`,
`Route Status: Safe`, `Stronger India`.

The test must allow "I am safe" and "somewhere safe".

---

## 6. Error-message rules

- **E1 (rule).** The title says what happened, in the user's words, in six words or fewer.
- **E2 (rule).** The detail says what to do next.
- **E3 (rule).** Never show "Something went wrong" on its own. Never apologise. No exclamation marks.
- **E4 (rule).** No system words in user-facing errors: backend, API, server-side, endpoint, payload,
  rows, unconfigured, HTTP codes. The manager System page may name providers (NDMA SACHET, OSRM),
  because that page is about providers.
- **E5 (rule).** Drivers never see raw server text. Map each error code to a local phrase that goes
  through `t()`.
- **E6 (rule).** A validation error sits beside its field and states the expected format. "Not in the
  expected format" alone is not enough.
- **E7 (rule).** An action keeps its name. A button "Assign truck" leads to the success message
  "Truck assigned" and the error "Truck not assigned: …".
- **E8 (rule).** When offline or stale, say what is on screen. Model: "Offline · showing last known
  data" (`manager-web/src/App.tsx:208`).

**Templates**, for the manager (proposals):

| Case | Title | Detail |
|---|---|---|
| No network | Cannot reach RASTA | Check the connection, then try again. The page keeps the last data it loaded. |
| Timeout | RASTA is slow to answer | Try again in a minute. If the hosted service was idle it can take about 30 seconds to wake. |
| 403 | Not allowed for your role | Your account cannot do this. Ask an administrator if you need it. |
| 404 | Not found | It may have been removed or moved out of your region. |
| 409 | Changed by someone else | Reload and check the latest state before you try again. |
| Unknown | This did not load | Try again. If it keeps failing, note the time and tell your administrator. |

The "about 30 seconds" figure is based on the measured 32.9 s cold start
(`REDESIGN_CERTIFICATION.md` §3). Keep it only while that figure holds.

**Templates**, for the driver (proposals, each through `t()`):

| Case | Title | Detail |
|---|---|---|
| No network | No connection | Check your signal and refresh the trip before retrying. This is the existing copy, which meets the rules (`driver-app/src/components/ui.tsx:190-193`). |
| 5xx | RASTA had a problem | Try again in a minute. |
| Unknown | That did not work | Check your signal and try again. |
| Assistant offline | Assistant offline | Safety guidance in the app still works. The app says its guidance is "Bundled in the app · works offline" (`drv-03-safety-412.png`). |

---

## 7. Loading, empty and success copy

- **Loading (rule).** Name the thing being loaded: "Loading trips…", not "Loading…". The shared
  `LoadingState` accepts a label (`manager-web/src/components/ui.tsx:216`).
- **Empty (rule).** Say what is missing and what to do. Model: "No verified district directory has
  been loaded for this state yet." (`LoginPage.tsx:570`)
- **Success (rule).** Use the past tense of the button verb, as a `role="status"` message.
- **Disabled (rule).** Say why. The shared `Button` already carries a `title` for this purpose
  (`manager-web/src/components/ui.tsx:25-29`).

---

## 8. Current copy that violates this guide

Every entry below is `PROVEN_BY_SOURCE`, except where another label is given. The replacements are
proposals.

| # | File:line | Current copy | Rule | Proposed |
|---|---|---|---|---|
| V1 | `driver-app/src/screens/LoginScreen.tsx:294` | "Safe Routes. Stronger India." | S1, voice | Remove. |
| V2 | `driver-app/src/i18n/appLanguage.ts:166` | "Safer logistics through difficult corridors." | S1 | "Trips, routes and help for hill corridors." |
| V3 | `driver-app/src/i18n/appLanguage.ts:235` | Hindi `login_subtitle` built on सुरक्षित, which reads as "safe" rather than "safer" (`INFERRED`: needs a native reader) | S7 | Retranslate from V2. |
| V4 | `manager-web/src/pages/LoginPage.tsx:444-452` | "Smarter logistics \| Safer routes \| Stronger communities" | S1, voice | Remove, or use "Route evidence, dispatch and driver support". |
| V5 | `LoginPage.tsx:728-730` | "Smarter logistics for the North East." with "North East." in gold | voice; single-phrase accent (frontend-design) | "Route decisions for North East corridors." in one colour. |
| V6 | `LoginPage.tsx:733` | "Real-time intelligence. Safer routes. Stronger communities." | S1, S4 | "Evidence for each corridor. A manager decides." |
| V7 | `LoginPage.tsx:695` | "Every truck, with honest GPS freshness" | S5. "Every truck" overstates: a truck whose driver app is not reporting is tracked by "dispatcher check-in by phone call" (`components/TruckContextDrawer.tsx:96`). The overstatement is `INFERRED`. | "Each truck's last GPS fix, and how old it is." |
| V8 | `LoginPage.tsx:396`, `:584`, `:753-757` | "Better access. Brighter futures.", "From the hills to new horizons", "People / Places / Possibilities" | voice: slogans | Remove. At most one factual line per screen. |
| V9 | `driver-app/src/screens/MapScreen.tsx:1273` | "PERSONAL ROUTE AI" (not translated) | S3, localisation | `t('ROUTE DECISION')` |
| V10 | `LoginPage.tsx:641-645`, with `backend/app/models/geography.py:110` | "Verified districts", counting `VERIFIED_OFFICIAL` **and** `DEMO` rows | S5 | Count `VERIFIED_OFFICIAL` only, or label it "Districts loaded (demo and verified)". |
| V11 | `driver-app/src/screens/LoginScreen.tsx:176` | The phone placeholder is the demo driver's real login number, ending `…77`. `docs/terrain/HANDOFF.md:78` identifies it as the driver's login, and it is also on `origin/main` (`PROVEN_BY_RUNTIME`). | privacy | "10-digit mobile number". |
| V12 | `App.tsx:271`, `LoginPage.tsx:441,781`, `LoginScreen.tsx:120`, `driver-app/app.json:31`, `manager-web/index.html:19` | "NER FLEET CONSOLE", "Manager console", "NER Logistics", "NER LOGISTICS", "NER Driver shares…", "RASTA AI · Fleet console" | §1 names | "RASTA AI" with "Fleet console" or "Driver app". The iOS permission string should begin "RASTA AI shares your location…". |
| V13 | `manager-web/src/components/ui.tsx:266,269-270` | "The backend took too long", "Cannot reach the backend", "The API is not responding. Check the connection and that the backend is up." | E4 | Templates in §6. |
| V14 | `manager-web/src/components/ui.tsx:261-262` | "Something went wrong" / "An unexpected error occurred." | E3 | "This did not load" / "Try again. If it keeps failing, note the time and tell your administrator." |
| V15 | `manager-web/src/components/ui.tsx:281` | "Conflict" | E1 | "Changed by someone else" |
| V16 | `manager-web/src/api/client.ts:73` | "Not in the expected format" / "Invalid value" | E6 | A per-field format hint, for example a sentence stating the exact pattern that field accepts, taken from the validator rather than invented. |
| V17 | `manager-web/src/pages/FleetPage.tsx:421` | "Failed to resolve incident" | E7 | "Incident not closed. Try again." |
| V18 | `driver-app/src/components/ui.tsx:206` | "Something went wrong" / "Please try again." | E3 | "That did not work" / "Check your signal and try again." |
| V19 | `driver-app/src/components/ui.tsx:205` | "Server problem" plus the raw server `error.message` | E4, E5 | "RASTA had a problem" / "Try again in a minute." |
| V20 | `driver-app/src/screens/MapScreen.tsx:765` | "Route intelligence service is currently unconfigured or offline. …" | E4 | "Route checks are not available right now. You can open the destination in Google Maps. Your manager still sees your location." |
| V21 | `manager-web/src/components/TruckContextDrawer.tsx:96` | "… · Route intelligence still runs server-side" | E4 | "… · Route checks still run" |
| V22 | `manager-web/src/pages/OverviewPage.tsx:160` | "Every figure is a count of rows you may read, and opens them." | E4 (the word "rows") | "Each number counts records you can see. Select one to open them." |
| V23 | `driver-app/src/api/supabaseApi.ts:303`, `manager-web/src/api/supabaseManagerApi.ts:1037` | "The hosted AI assistant service could not be reached." | E4 ("hosted … service") | "Assistant offline" / "Safety guidance in the app still works." |
| V24 | `appLanguage.ts:171`, `LoginPage.tsx:277,374` | "Sign In" (driver) and "Log in" (manager) | §4, E7 | "Sign in" in both apps, matching "Sign out" (`App.tsx:224`). |
| V25 | `driver-app/src/screens/TripScreen.tsx:292` | "I Am Safe / Routine Pause" | case | "I am safe – routine pause". The wording itself is allowed under S1. |
| V26 | `driver-app/src/screens/SafetyScreen.tsx:300`, `MapScreen.tsx:1434` | " — elapsed time, not time spent driving", " (no GPS)", both hard-coded English | localisation | Pass both through `t()`. |
| V27 | Driver `accessibilityLabel`s | 27 literal English labels and 1 through `t()` (`PROVEN_BY_RUNTIME`, grep count) | localisation | Pass all through `t()`. |
| V28 | `docs/PRODUCT_VISION.md:55` | "A **Predictive** Fleet & Accessibility Command Platform" | S3 | "A fleet and route-evidence platform". |
| V29 | `docs/PPT_SOURCE_OF_TRUTH.md:3` | Records the login motto "Safe Routes. Stronger India." without flagging it | S1 | Update after the user decides on V1. |
| V30 | `manager-web/src/components/ui.tsx:207-209` | Status pills print raw enums such as "NO ROUTE SELECTED" and "PENDING VERIFICATION" at 11px | case, legibility | Map to sentence case ("No route selected"). This is roadmap item R4. |

---

## 9. Current copy that meets this guide (keep and copy the pattern)

All `PROVEN_BY_SOURCE`.

| File:line | Copy | Why it works |
|---|---|---|
| `manager-web/src/components/RouteApprovalDialog.tsx:131` | "I understand that incomplete evidence is not the same as SAFE." | S2 as a consent step |
| `manager-web/src/components/RouteCandidateCards.tsx:66` | "Eligible under the checks that ran. Not a safety guarantee." | S1: states scope, makes no claim |
| `manager-web/src/components/TripRouteReview.tsx:166` | "… one vehicle is not traffic). Unknown, not clear." | S2, S4 |
| `manager-web/src/pages/FleetPage.tsx:1525-1527` | "Deterministic rule (…), not a prediction. Risk is scored from distance, duration and current weather along the corridor." | S3: names the inputs |
| `manager-web/src/components/FleetMap.tsx:681` | "Mapped, not verified: nothing here says a place is open or reachable." | S1 for places |
| `manager-web/src/pages/LoginPage.tsx:593` | "Schematic. Shapes are indicative, not survey boundaries." | S5 for a drawing |
| `manager-web/src/App.tsx:208` | "Offline · showing last known data" | E8 |
| `manager-web/src/pages/SystemPage.tsx:44` | "wording only — never a decision" | S3 for the assistant |
| `driver-app/src/navigation/routeAi.ts:115` | "The route assessment is not available. This is not a statement that the road is clear." | S2 |
| `driver-app/src/screens/SafetyScreen.tsx:379` | "Tapping opens your dialler. You still press call." | S6 |
| `driver-app/src/screens/MapScreen.tsx:1119` | "Your manager assigns the road first" | Driver tone: short, explains the absence |
| `driver-app/src/screens/LoginScreen.tsx:292` | "Need access? Contact your fleet manager — driver accounts and passwords are managed by dispatch." | Replaces a fake "Forgot password?" link (`REDESIGN_CERTIFICATION.md` §1) |
| `driver-app/src/components/ui.tsx:190-193` | "No connection" / "Cannot confirm the server response. Check your signal and refresh the trip before retrying." | E1, E2. "Server" is acceptable in this one place, because it says what is unknown. |

---

## 10. Visual brand notes (short)

- **Hue meanings** (`manager-web/src/index.css:14-20`, `PROVEN_BY_SOURCE`):
  - green: action and success;
  - blue: route and focus only;
  - amber: caution;
  - red: emergency and error.

  Copy and colour must agree. A "Safe" label in green would break S1 twice.
- **Gold is outside the four hues.** It appears only in the manager sign-in headline and bar
  (`LoginPage.tsx:726,730`: `#C9A227`, `#E3C77A`). Proposal: remove it with V5.
- **The brand mark predates the forest retone.** It is charcoal with a blue shield stroke
  (`brand/mark.svg:2-3`). The retone is a user decision. See `DESIGN_PLUGIN_COMPARISON.md` R2.

---

## 11. Open questions for the user

1. Remove the driver motto (V1)? `PPT_SOURCE_OF_TRUTH.md:3` accepted it on 14 September.
2. The placeholder number (V11), together with the pending decision on the 12 public images that show
   the same demo driver's number.
3. The district count (V10): count verified rows only, or relabel?
4. Is "RASTA" meant as an acronym? No document in the repo says so.
5. The region spelling in the UI: "North East" or "North-East"?
