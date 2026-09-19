# Design plugin comparison: RASTA AI redesign audit

**Date** 26 September 2026 · **Lane** Head of Design + Brand (`plugins-design-brand`)
**Scope** The current working tree: local `main` at `5b5e474` plus the uncommitted redesign. This is not
the hosted build (`e4043ce`). No code was edited, nothing hosted was requested, and no Figma or
Superdesign file was created.

**Evidence labels.** Every claim carries exactly one label:

- `PROVEN_BY_SOURCE`: file:line in this repository.
- `PROVEN_BY_RUNTIME`: a command run in this lane.
- `PROVEN_BY_TEST`, `PROVEN_BY_DATABASE`, `PROVEN_BY_WEB`: not used. No test was run, no database was
  queried and no web page was fetched.
- `INFERRED`: a conclusion that was not observed directly.
- `NOT_VERIFIED`: not checked.
- `BLOCKED`: could not be checked.

**How contrast was measured.** Every ratio below was computed in this lane with the WCAG 2.x
relative-luminance formula, using a scratch script on hex values copied from source. The ratio is
`PROVEN_BY_RUNTIME`. The hex value it comes from is `PROVEN_BY_SOURCE` at the cited line. Opacity mixes,
such as `/80` and `/50`, were composited over the surface before measuring.

---

## 1. Inputs

- **Manager console.** `manager-web/src/index.css`, `components/ui.tsx`, `App.tsx`,
  `pages/LoginPage.tsx`, `pages/OverviewPage.tsx`, `pages/FleetPage.tsx`, `components/FleetMap.tsx`,
  `components/PlacesLayer.tsx`, `index.html`, `vercel.json`, `netlify.toml`, `public/*.svg`.
- **Driver app.** `driver-app/src/theme.ts`, `components/ui.tsx`, `screens/LoginScreen.tsx`,
  `screens/MapScreen.tsx`, `screens/SafetyScreen.tsx`, `screens/TripScreen.tsx`,
  `i18n/appLanguage.ts`, `app.json`, `dist/index.html`. The `dist/index.html` file is a stale local
  export dated 30 August.
- **Documents.** `docs/REDESIGN_CERTIFICATION.md`, `docs/PPT_SOURCE_OF_TRUTH.md`,
  `docs/PRODUCT_VISION.md`, `brand/mark.svg`, `brand/render.mjs`.
- **Screenshots viewed with Read.** All seven are prior-run artifacts, not new captures:
  - `.runtime/evidence/redesign-after/00-scope-1440.png`
  - `.runtime/evidence/redesign-after/01-credentials-1440.png`
  - `.runtime/evidence/responsive-redesign/overview-320.png`
  - `.runtime/evidence/driver-redesign/driver-login-412.png`
  - `.runtime/evidence/driver-redesign/drv-02-navigate-412.png`
  - `.runtime/evidence/driver-redesign/drv-03-safety-412.png`
  - `.runtime/evidence/driver-redesign/light-01-trip-412.png`

---

## 2. Plugin register

### 2.1 UI UX Pro Max

- **PLUGIN** `ui-ux-pro-max:ui-ux-pro-max`
- **OWNER_ROLE** Head of Design
- **TASK** Audit accessibility, touch targets, states, tokens and navigation against its rule set.
- **WHY_RELEVANT** It ships a searchable rule database with separate web and React Native guidance,
  and this product has one app of each kind.
- **INPUT**
  - Loaded with the Skill tool.
  - Ran the skill's own `scripts/search.py` five times:
    - `"touch target size mobile" --domain ux`
    - `"focus visible keyboard" --domain ux`
    - `"empty state loading skeleton" --domain ux`
    - `"accessibilityLabel touch target hitSlop" --stack react-native`
    - `"logistics fleet operations dashboard" --domain product`
  - Read the Pre-Delivery Checklist in `references/pro-rules.md`.
  - No project data was placed in any query.
- **OUTPUT (produced by the tool)**
  - Touch targets: 44pt on iOS and 48dp on Android. On the web, WCAG's 24 CSS px, "not one unit
    across platforms".
  - At least 8px between adjacent targets.
  - A visible focus ring on every control, including controls inside modals.
  - Focus must not be obscured by sticky UI.
  - Empty states carry a message and an action.
  - Loading uses a stable skeleton or `aria-busy` and never a flickering spinner.
  - React Native: `hitSlop` on small targets and an `accessibilityLabel` on every interactive element.
  - Product rows:
    - "Logistics/Delivery: Minimalism & Swiss + Flat; Blue #2563EB + Orange + Green".
    - "Autonomous Drone Fleet Manager: HUD / Sci-Fi FUI, Tactical Green #00FF00".
  - Checklist items: test at 375px and at the largest system text size, check dark mode separately,
    use semantic tokens rather than hard-coded colours per screen.
- **EVIDENCE** `PROVEN_BY_RUNTIME`. The search output is saved in the lane scratchpad as
  `uiux_search.txt`.
- **STATUS** `USED_AND_USEFUL`
- **FOLLOW_UP** Its touch-target rule splits web and mobile. See conflict C1. Its product palette
  suggestion was rejected (X1).

### 2.2 Frontend design

- **PLUGIN** `frontend-design:frontend-design`
- **OWNER_ROLE** Head of Design
- **TASK** Critique hierarchy, typography and interface copy.
- **WHY_RELEVANT** It is the only installed skill that has explicit rules for UI copy (errors,
  action names) and a list of generic visual tells.
- **INPUT** Loaded with the Skill tool. This is a build skill. No page was built. I applied its critique
  sections to the source and screenshots myself.
- **OUTPUT (the skill's rules, as I applied them)**
  - Avoid colour-accenting a single phrase in a headline, all-caps labels, meta strings joined with
    middle dots, and a `→` appended to buttons.
  - Name things by what users understand, not by how the system is built.
  - Errors say what happened and how to fix it. They never apologise and are never vague.
  - An action keeps the same name through the whole flow.
  - Quality floor: visible focus, reduced motion, responsive down to mobile.
  - Where the brief pins a visual direction, the brief wins.
- **EVIDENCE** `PROVEN_BY_SOURCE`, citing the skill text. Its application to this repository is
  mine and is listed in §3 with file:line.
- **STATUS** `USED_AND_USEFUL`
- **FOLLOW_UP** Its "cream canvas is a generic tell" signal conflicts with the reference images
  (C2). I kept the references.

### 2.3 UX Superpowers: ux-validate

- **PLUGIN** `ux-superpowers:ux-validate`
- **OWNER_ROLE** Head of Design
- **TASK** Validate persona fit, jobs coverage, journey gaps, principles and telemetry.
- **WHY_RELEVANT** It checks the redesign against its users rather than against a style.
- **INPUT**
  - Loaded with the Skill tool.
  - The skill expects `docs/ux-discovery/`, which does not exist (`PROVEN_BY_RUNTIME`, `ls`).
  - I used the target-user table in `docs/PRODUCT_VISION.md` §2 as a proxy. Its driver row reads
    "cab of a truck, phone only, one hand, poor signal, sometimes at night".
- **OUTPUT (the skill's checklist, as I applied it)**

  | Area | Result |
  |---|---|
  | Persona alignment | Partial. The driver constraints are honoured by `TOUCH_TARGET = 52` (`driver-app/src/theme.ts:90`), but hazard-alert actions sit at 40px and "Find a place to stop" at 32px (§3.3). |
  | Jobs coverage | Jobs were derived from documents only. See §2.5. |
  | Journey gaps | See §2.4. |
  | Design principles | The written hue rule (`manager-web/src/index.css:14-18`) is broken in map code (§3.6). |
  | Telemetry | None. No product-analytics code exists in either client: a search for analytics libraries returned only false matches (`PROVEN_BY_RUNTIME`). |
  | Assumptions | No user research is on file. Every persona statement here is `INFERRED`. |
- **EVIDENCE** Labelled per row above.
- **STATUS** `USED_AND_USEFUL`
- **FOLLOW_UP** A discovery document with real interviews would upgrade every `INFERRED` persona claim.
  Client analytics were rejected (X6).

### 2.4 UX Superpowers: user-journey

- **PLUGIN** `ux-superpowers:user-journey`
- **OWNER_ROLE** Head of Design
- **TASK** Map the dispatch and trip journeys and find the moments of truth.
- **WHY_RELEVANT** The riskiest screens are the ones a driver uses while moving.
- **INPUT** Loaded with the Skill tool. The skill is designed to be walked with the user. As a
  subagent I could not do that, so I derived the stages from `docs/PPT_SOURCE_OF_TRUTH.md` §5–6
  and the screen source.
- **OUTPUT (my application)**
  - **Driver moments of truth.** Each stage, with what was found at it:
    - Sign-in: the placeholder is a real account number (A1).
    - A hazard alert while driving: the action buttons are under target size (A9).
    - The hold decision, "Find a place to stop": 32px (A9).
    - An SOS tap: a 52px round button with a label, so no defect
      (`driver-app/src/screens/MapScreen.tsx:1123-1131`, `:1546-1549`).
  - **Manager moments of truth:**
    - Region select: "Verified districts" overstates what is loaded (A6).
    - Sign-in: slogans (A3).
    - Route review: honest copy, kept as the model (see the brand guide §9).
- **EVIDENCE** The stage list is `INFERRED`. The defects are `PROVEN_BY_SOURCE`, as cited in §3.
- **STATUS** `USED_AND_USEFUL`
- **FOLLOW_UP** Walk both journeys with one real dispatcher and one real driver before the next redesign.

### 2.5 UX Superpowers: jobs-to-be-done

- **PLUGIN** `ux-superpowers:jobs-to-be-done`
- **OWNER_ROLE** Head of Design
- **TASK** Write the primary jobs for managers and drivers.
- **WHY_RELEVANT** It anchors copy and hierarchy decisions.
- **INPUT** Loaded with the Skill tool. The skill asks the user its questions one at a time. I derived
  the jobs from `docs/PRODUCT_VISION.md:45,91` and `SUBMISSION_README.md:7`.
- **OUTPUT (my application, `INFERRED`)**
  - Manager: "When a truck is due to leave on a hill corridor, I want to see whether the corridor
    is usable now and what evidence is missing, so I can dispatch or hold with a reason I can defend."
  - Driver: "When I am driving and something changes ahead, I want one clear instruction I can act
    on with one hand, so I can keep the truck and myself out of trouble and be found if I cannot."
  - The skill's importance and satisfaction scores were **not produced**. They need user answers, and
    inventing them is prohibited (X7).
- **EVIDENCE** `INFERRED`
- **STATUS** `USED_NO_ACTION`
- **FOLLOW_UP** Score the jobs after real interviews.

### 2.6 Brand Voice: discover-brand

- **PLUGIN** `brand-voice:discover-brand`
- **OWNER_ROLE** Head of Brand
- **TASK** Find brand materials.
- **WHY_RELEVANT** It would anchor the voice in existing guidelines, if any exist.
- **INPUT** Loaded with the Skill tool. Its workflow searches connected document platforms, and it
  stops when none is connected. In this session Notion, Figma, Gong and Granola require
  authentication, and no Google Drive, SharePoint, Confluence or Box connector is available.
- **OUTPUT** None from the plugin. I did local discovery by hand from repository documents and UI
  copy. That work is in `BRAND_AND_COPY_GUIDE.md` §0.
- **EVIDENCE** `BLOCKED`
- **STATUS** `BLOCKED`
- **FOLLOW_UP** If a brand document exists outside the repo, connect its platform and re-run the skill.
  None exists in the repo: the only brand asset found is `brand/mark.svg` and its renderer
  (`PROVEN_BY_RUNTIME`, `find`).

### 2.7 Brand Voice: brand-voice-enforcement

- **PLUGIN** `brand-voice:brand-voice-enforcement`
- **OWNER_ROLE** Head of Brand
- **TASK** Apply a voice to the current UI copy and flag violations.
- **WHY_RELEVANT** The two apps and the submission documents use at least five product-name variants
  and several unproven slogans.
- **INPUT**
  - Loaded with the Skill tool.
  - `.claude/brand-voice-guidelines.md` does not exist (`PROVEN_BY_RUNTIME`, `ls .claude`).
  - I read its reference `references/voice-constant-tone-flexes.md` and applied its
    "We Are / We Are Not" table and its three tone dimensions (formality, energy, technical depth)
    myself.
- **OUTPUT** The voice table, the tone matrix and the violation list in `BRAND_AND_COPY_GUIDE.md`.
  The plugin agent did not generate these. I did, using the skill's model.
- **EVIDENCE** `PROVEN_BY_SOURCE` for each cited string.
- **STATUS** `USED_AND_USEFUL`
- **FOLLOW_UP** If the user approves the guide, the skill can load it from
  `.claude/brand-voice-guidelines.md` in a later session. I did not write that file here.

### 2.8 SearchFit SEO: technical-seo

- **PLUGIN** `searchfit-seo:technical-seo`
- **OWNER_ROLE** Head of Design (web metadata)
- **TASK** Check the metadata of `manager-web/index.html` and the driver web export only.
- **WHY_RELEVANT** The two sign-in pages are publicly reachable.
- **INPUT** Loaded with the Skill tool. I applied its codebase checklist (crawl directives, mobile,
  `lang`, security headers) to `manager-web/index.html`, `manager-web/vercel.json`,
  `manager-web/netlify.toml`, `driver-app/app.json` and `driver-app/dist/index.html`. No live site
  was fetched.
- **OUTPUT (my application)**
  - `manager-web/index.html:1-25` has `lang="en"`, a viewport meta tag and a title. It has no
    `description`, no `robots` meta and no `theme-color`.
  - No `robots.txt` is shipped. `manager-web/public/` holds only `brand-mark.svg` and `favicon.svg`.
  - Both descriptors rewrite every path to `/index.html` (`manager-web/vercel.json:23-28`,
    `manager-web/netlify.toml:19-22`), so a request for `/robots.txt` would return the app shell.
    That is `INFERRED` from the rewrite rules, not requested.
  - The local driver export's title reads "NER Driver App" (`driver-app/dist/index.html:7`, a build
    dated 30 August), while `driver-app/app.json:3` now names the app "RASTA AI". The hosted title
    is `NOT_VERIFIED`.
- **EVIDENCE** `PROVEN_BY_SOURCE`, as cited.
- **STATUS** `USED_AND_USEFUL`
- **FOLLOW_UP** SEO changes may not add product claims. See A12 and X3.

### 2.9 Figma

- **PLUGIN** Figma MCP (`mcp__606aa85d-…__whoami`)
- **OWNER_ROLE** Head of Design
- **TASK** Record whether the session is authenticated.
- **WHY_RELEVANT** A future token handoff could go through Figma.
- **INPUT** Loaded with ToolSearch `select:` and called once.
- **OUTPUT** Authenticated. One team plan on the starter tier, with a **View** seat. The account email
  is not reproduced here.
- **EVIDENCE** `PROVEN_BY_RUNTIME`
- **STATUS** `USED_NO_ACTION`
- **FOLLOW_UP** No file was opened or created. Whether a View seat allows editing design files is
  `INFERRED` to be no.

### 2.10 Superdesign

- **PLUGIN** `superdesign` 0.6.0, installed at
  `~/.claude/plugins/cache/claude-plugins-official/superdesign/0.6.0` (`PROVEN_BY_RUNTIME`, `ls`).
- **OWNER_ROLE** Head of Design
- **TASK** None. Recorded only.
- **WHY_RELEVANT** It could generate variants of the redesign.
- **INPUT** Its instructions were not executed. The skill runs `npx --yes @superdesign/cli@latest`,
  and its own text says every generation spends credits.
- **OUTPUT** None.
- **EVIDENCE** `PROVEN_BY_RUNTIME` (the installed files)
- **STATUS** `REJECTED_BY_POLICY`. Credit spend needs the user's approval, and `npx` downloads a
  package, which this lane forbids.
- **FOLLOW_UP** Ask the user before any use.

---

## 3. Findings: each plugin's rules applied to the current tree

### 3.1 Hierarchy
- **Manager sign-in carries five slogans across two steps.** No plugin endorses any of them.
  (Frontend design copy rule; Brand Voice. `PROVEN_BY_SOURCE`)
  - "Smarter logistics | Safer routes | Stronger communities" (`manager-web/src/pages/LoginPage.tsx:444-452`)
  - "From the hills to new horizons" (`:584`)
  - "Better access. Brighter futures." (`:396`)
  - "People / Places / Possibilities" (`:753-757`)
  - "Real-time intelligence. Safer routes. Stronger communities." (`:733`)
- **One phrase in the headline is accented in a gold hue.** "for the North East." uses
  `text-[#E3C77A]` (`LoginPage.tsx:730`), and the bar above it uses `#C9A227`. Frontend design lists a
  single-phrase colour accent as a generic tell. Gold is also outside the four-hue rule, where amber
  means caution (`manager-web/src/index.css:14-18`). (`PROVEN_BY_SOURCE`)
- **At 320px the wrapped rail pushes content down.** Ten nav items, the region card and the topbar sit
  above the "Overview" heading, which starts at about y=640 of a 900px capture
  (`.runtime/evidence/responsive-redesign/overview-320.png`). (UI UX Pro Max `nav-hierarchy`.
  `PROVEN_BY_RUNTIME` for the viewed image. The measurement is approximate.)
- **"No fix" appears three times on one navigate screen with no GPS**: as a chip, a pill and a footer
  cell (`drv-02-navigate-412.png`). (`PROVEN_BY_RUNTIME`)

### 3.2 Accessibility: contrast
| Pair | Where | Ratio | Needs |
|---|---|---|---|
| `--color-ok` #087F5B on `--color-ok-soft` #DFEFE4, 11px semibold | `index.css:81-82`. Used by `StatusPill` AVAILABLE / ACTIVE / ROUTE_SELECTED / SELECTABLE (`components/ui.tsx:181-196`), `FleetPage.tsx:149` LIVE, `AssignmentsPage.tsx:108`, `DriverProfileDrawer.tsx:124` | **4.19:1** | 4.5:1 |
| ErrorState detail: `text-danger/80` on `bg-danger-soft/50` | `components/ui.tsx:291,294` | **4.32:1** | 4.5:1 |
| Driver DAY `ok` #076C4D on `okBg` #DFEFE4 | `driver-app/src/theme.ts:145-146` | 5.40:1 | passes |
| Status dots `ok-strong` #10B981 / `warning-strong` #F59E0B on surface | `index.css:289-290` | 2.49 / 2.11:1 | 3:1 for non-text, **but** the dot is `aria-hidden` and always sits beside a text label (`App.tsx:200-208`), so the text carries the meaning |

The driver app already fixed the same pair. Its DAY `ok` value is darker than the console's, and
`driver-app/src/theme.contrast.test.ts` measures every readable token against every surface. The
manager console has no contrast test: a search for "contrast" under `manager-web/src` found nothing
(`PROVEN_BY_RUNTIME`).

### 3.3 Accessibility: focus and touch targets
- **The focus ring fails contrast on the dark rail.** The global
  `:focus-visible { outline: 3px solid var(--color-route) }` (`index.css:347`) paints #2563EB on the
  rail gradient (`index.css:172`: #0B3A30, then #062621, then #041A16) and on the active item
  (#0C302A, `index.css:215`). The measured ratios are 2.44:1 at the rail top, 3.11:1 at mid-rail and
  2.76:1 next to the active item. WCAG 1.4.11 asks 3:1 for a focus indicator. (UI UX Pro Max
  "Focus States"; Frontend design quality floor. `PROVEN_BY_RUNTIME`)
- **Driver targets under 44px on the hazard path.** Each item below has no `hitSlop`
  (`PROVEN_BY_SOURCE`):
  - `alertBtn` `minHeight: 40` (`driver-app/src/screens/MapScreen.tsx:1837`). Used by View, Stops and
    Acknowledge on the danger alert (`:1154`, `:1157`, `:1164`).
  - `stopLink` `minHeight: 32` (`:1841`). Used by "Find a place to stop" in the hold state (`:1327`).
  - `modeChip` `minHeight: 40` (`:1862-1863`, used at `:1430`).
  - `chip` 40 (`MyDetailsScreen.tsx:296`).
  - TranslateBox controls at 36, 38 and 40 (`TranslateBox.tsx:649,672,735,885`).
  - These sit below the app's own `TOUCH_TARGET = 52` (`theme.ts:90`) and below the 44/48 from
    UI UX Pro Max.
  - `detailsBtn` (36px) is fine: its `hitSlop` of 8 top and 8 bottom makes 52 (`MapScreen.tsx:1278,1651`).
- **Manager targets under 44px.** Each is at or above the WCAG 2.2 AA 24px minimum, but under this
  lane's 44px bar. That matters below 800px, where the console is used by touch (`PROVEN_BY_SOURCE`):
  - `.topbar-icon` 40×40 (`index.css:292`), the notifications link.
  - MapLibre controls 36px (`index.css:312`).
  - Map layer labels `min-h-6`, 24px (`components/FleetMap.tsx:793,807`).
  - Fleet header links `min-h-10`, 40px (`pages/FleetPage.tsx:786,792,795`).
- **Driver accessibility labels are mostly English literals.** 27 `accessibilityLabel="…"` literals
  and 1 through `t()`/`tx()` in `screens/`, `components/` and `navigation/` (`PROVEN_BY_RUNTIME`,
  grep count). A screen reader in Hindi or Assamese reads them in English (`INFERRED`).

### 3.4 Responsive
- **Horizontal overflow.** The prior run reports `"worstOverflow": 0` across 11 widths × 10 pages
  (`.runtime/evidence/responsive-redesign/summary.json`). `PROVEN_BY_SOURCE` for the artifact. It was
  not re-run in this lane.
- **Driver Day-palette evidence does not cover four screens.** `light-01-trip`, `light-02-navigate`,
  `light-03-safety` and `light-04-more` are byte-identical, with one md5 for all four
  (`PROVEN_BY_RUNTIME`). All four show the Trip tab. Day mode on Navigate, Safety and More is
  `NOT_VERIFIED` visually.
- **Large system text and landscape.** `allowFontScaling` and `maxFontSizeMultiplier` appear nowhere
  in `driver-app/src`, so system text scaling applies (`PROVEN_BY_RUNTIME`). No capture at the
  largest font scale exists, so clipping at large scale is `NOT_VERIFIED`. The app is locked to
  portrait (`driver-app/app.json:6`).
- **Sub-12px text.** 96 arbitrary `text-[9–11px]` uses in the manager and 48 driver `fontSize` values
  of 9–11 (`PROVEN_BY_RUNTIME`, grep count). UI UX Pro Max advises body text of 12px or more. The
  driver header comment itself says the app is "read one-handed, in a truck cab, often at night"
  (`theme.ts:3-4`).

### 3.5 Loading, empty, error and success states
- **Coverage is good.** Shared `LoadingState`, `EmptyState` and `ErrorState` components
  (`components/ui.tsx:216-304`) are used in 16, 11 and 17 files respectively (`PROVEN_BY_RUNTIME`).
  `LoadingState` carries `role="status"`. `ErrorState` carries `role="alert"` and never renders a
  raw stack.
- **Error copy uses system words.** "Cannot reach the backend", "The API is not responding. Check …
  that the backend is up" (`components/ui.tsx:266-270`). "Conflict" as a title (`:281`). The generic
  fallback "Something went wrong / An unexpected error occurred." (`:261-262`). Frontend design says
  errors are never vague and should use the user's words. (`PROVEN_BY_SOURCE`)
- **Driver errors pass server text through.** For 403, 404, 409, 422 and other statuses the detail is
  `error.message` (`driver-app/src/components/ui.tsx:190-205`), passed through `t()`, which only
  translates known keys (`INFERRED`). A 5xx shows the title "Server problem".
- **Success states.** Present, for example the `role="status"` confirmation in
  `pages/ManagersPage.tsx:178`. I did not audit every success path (`NOT_VERIFIED`).

### 3.6 Tokens
- **Map code bypasses the tokens.** It still carries the retired slate and old-red values
  (`PROVEN_BY_SOURCE`):
  - Truck markers use #0f172a, rgba(15,23,42,…), #f1f5f9 and #64748b (`components/FleetMap.tsx:73-78,154-155`).
  - Slope uses #B42318 and #B45309 (`:297`, `:329`).
  - The traffic layer uses a separate #D97706 and #16A34A (`:312`).
  - The route label blue is #2457D6 (`:583-584`).
  - The certification says the slate set was retired from the driver app as "a slate product wearing
    a green logo" (`docs/REDESIGN_CERTIFICATION.md` §2). The same set survives in the console map.
- **POI colours break the hue rule.** Hotel POIs are route blue #2563EB (`components/PlacesLayer.tsx:39`),
  against "blue = route geometry and keyboard focus, NOTHING else" (`index.css:14-18`).
  (`PROVEN_BY_SOURCE`)
- **The brand mark predates the forest retone.** It is a charcoal #101820 field with a #2563EB shield
  stroke, in `brand/mark.svg:2-3`, `manager-web/public/brand-mark.svg:2-3` and `favicon.svg:2-3`. The
  Android adaptive background is #E6F4FE (`driver-app/app.json:14`). (`PROVEN_BY_SOURCE`)
- **Stale contrast comments.**
  - `index.css:22-27` still lists `muted #52615A` and `primary #087F5B`, which are no longer the values.
  - `theme.ts:20-24` lists `faint #8B9C93`, `dim #7D8E85` and `bad #F87171`, which differ from
    `theme.ts:47,51,82`.
  - `theme.ts:109-110` repeats a doc line.
  - (`PROVEN_BY_SOURCE`)
- **What works.** The token names are semantic, the hue rule is written down, and the driver DAY and
  NIGHT palettes share one key set (`theme.ts:95-107`). (`PROVEN_BY_SOURCE`)

### 3.7 Navigation
- **The driver bar follows UI UX Pro Max's limit of five items or fewer.** It has four tabs: Trip,
  Navigate, Safety and More (`drv-*-412.png`). (`PROVEN_BY_RUNTIME` for the viewed images)
- **The mobile manager shell has five tabs**, as recorded in `docs/PPT_SOURCE_OF_TRUTH.md` §6.
  (`NOT_VERIFIED` in this lane)
- **The manager console has a skip link** (`App.tsx:266`, `.skip-link` at `index.css:310-311`). The
  nav is a labelled `<nav aria-label="Main navigation">` (`App.tsx:279`). (`PROVEN_BY_SOURCE`)
- **Modals trap focus and close on Escape**, as reported in `docs/REDESIGN_CERTIFICATION.md` §2
  (`NOT_VERIFIED` in this lane).

### 3.8 Copy and honesty on screen
See `BRAND_AND_COPY_GUIDE.md` §8 for the full list with file:line. The design-relevant items:

- **The driver sign-in placeholder is a real account phone number.**
  - The mobile field placeholder is the demo driver's account number, ending `…77`
    (`driver-app/src/screens/LoginScreen.tsx:176`).
  - `docs/terrain/HANDOFF.md:78` identifies that number as the driver's login.
  - The same string is on `origin/main` (`PROVEN_BY_RUNTIME`, `git show origin/main:…`).
  - It is visible in `driver-login-412.png`.
- **"Safe Routes. Stronger India."** on the driver sign-in (`LoginScreen.tsx:294`). The AI prompt
  policy forbids the model to "tell anyone a road is safe or clear"
  (`backend/app/domain/ai_prompts.py:45-46`). (`PROVEN_BY_SOURCE`)
- **"PERSONAL ROUTE AI"** labels the route card (`MapScreen.tsx:1273`). The card shows "the decision
  the engine reached" (`MapScreen.tsx:1267`), and the console's System page says "Route risk is a
  deterministic rule" (`pages/SystemPage.tsx:211`). The label is also untranslated. (`PROVEN_BY_SOURCE`)
- **"Verified districts"** on the sign-in stat strip (`LoginPage.tsx:434,641-645`) counts districts whose
  source status is in `OPERATIONAL_SOURCES = (VERIFIED_OFFICIAL, DEMO)`
  (`backend/app/models/geography.py:110`). Demo rows are therefore shown as verified.
  (`PROVEN_BY_SOURCE`) That the four districts in `00-scope-1440.png` are demo rows is `INFERRED`:
  no backend code writes `VERIFIED_OFFICIAL`, and the database was not queried.

---

## 4. Where the plugins agree and where they conflict

**Agreement.**
- UI UX Pro Max, Frontend design and SearchFit (mobile section) all ask for:
  - a visible focus ring;
  - touch-sized targets on mobile;
  - no horizontal scroll;
  - text of 12px or more.

  The tree meets the scroll rule. It misses on focus contrast on the rail, on some targets and on
  small type.
- UI UX Pro Max ("semantic tokens, no per-screen hard-coded colours") and Frontend design ("a compact
  token system") agree. The map layers are the exception.
- Frontend design's copy rules, the Brand Voice model and the repository's own wording rules
  (`docs/PPT_SOURCE_OF_TRUTH.md:3`) all point the same way: remove unproven slogans and system jargon
  from the UI.

**Conflicts and how I resolved them.**

| # | Conflict | Resolution |
|---|---|---|
| C1 | Target size. UI UX Pro Max: 24 CSS px on the web, 44pt/48dp on mobile. SearchFit: 44px. Lane brief: 44px or more. | 44px everywhere in the driver app, and in the manager console below 800px. Desktop manager controls of 24px or more are acceptable now, and 44px is the roadmap target (R5). |
| C2 | Palette. UI UX Pro Max product row: blue primary for logistics. Frontend design: a cream canvas is a generic tell. Repo: blue is reserved for route and focus (`index.css:14-18`), and seven reference images set forest and cream (`REDESIGN_CERTIFICATION.md` §1). | Keep Terrain. Frontend design itself says a brief that pins the direction wins. Both suggestions rejected (X1, X2). |
| C3 | SearchFit aims at indexation (sitemap, structured data). The console and the driver web are sign-in-gated operational tools. | `noindex`, a plain description and `theme-color` only. No schema, no sitemap (A12, X3). |
| C4 | Frontend design discourages all-caps labels. The driver app uses short tracked-caps section labels, and `StatusPill` prints raw enums such as "NO ROUTE SELECTED" at 11px (`components/ui.tsx:207-209`). | Keep short caps section labels at 12px or more. Move status pills to sentence case with a word map (R4). |
| C5 | The hue rule (focus is blue) against contrast on the dark rail. | Keep the hue and use a lighter tint on the rail: #93B4FF, the driver app's own `routeOn` (`theme.ts:71`), measures 6.14–7.81:1 on the rail colours (`PROVEN_BY_RUNTIME`). |
| C6 | ux-validate wants product telemetry. This is a government operations tool, and no privacy review of client analytics exists. | No client analytics. Measure journeys from timestamps the server already records (X6). |

---

## 5. Head of Design synthesis

Only recommendations with evidence behind them are listed. None adds a dependency or fake data.

### ADOPT_NOW
| ID | Area | Change | Evidence |
|---|---|---|---|
| A1 | Privacy / copy | Replace the driver phone placeholder with a format hint that is not a real number, such as "10-digit mobile number". The number is the demo driver's login (`…77`). Handle it together with the pending user decision on the 12 public images. | `LoginScreen.tsx:176`; `docs/terrain/HANDOFF.md:78`; on `origin/main` (`PROVEN_BY_RUNTIME`) |
| A2 | Safety wording | Remove "Safe Routes. Stronger India." from the driver sign-in. | `LoginScreen.tsx:294`; `ai_prompts.py:45-46` |
| A3 | Safety wording / hierarchy | Manager sign-in: keep **one** plain line, for example "Route evidence and dispatch for North East India". Remove "Safer routes", "Real-time intelligence", "Smarter logistics" and the other slogans, and remove the gold phrase accent. | `LoginPage.tsx:396,444-452,584,728-733,753-757` |
| A4 | Safety wording | Change the driver `login_subtitle` from "Safer logistics through difficult corridors." to "Trips, routes and help for hill corridors.", and retranslate. The Hindi version (`:235`) reads as "safe", not "safer". That reading is `INFERRED` and should be checked by a native reader. | `driver-app/src/i18n/appLanguage.ts:166,235` |
| A5 | Honesty | Rename "PERSONAL ROUTE AI" to "ROUTE DECISION" and pass it through `t()`. | `MapScreen.tsx:1273` |
| A6 | Honesty | The stat strip must stop calling demo rows verified. Either count only `VERIFIED_OFFICIAL` rows, or label the number "Districts loaded (demo and verified)". | `LoginPage.tsx:641-645`; `geography.py:110` |
| A7 | Contrast / tokens | Set `--color-ok` to #076C4D, the value the driver DAY palette already uses. It measures 5.40:1 on ok-soft, 6.32:1 on surface and 5.73:1 on canvas. Add a manager token contrast test copied from `driver-app/src/theme.contrast.test.ts`. | `index.css:81`; ratios `PROVEN_BY_RUNTIME` |
| A8 | Contrast | In `ErrorState`, drop the `/80` on the detail text (4.32:1 → 5.48:1 on danger-soft). | `components/ui.tsx:294` |
| A9 | Touch targets | Driver `alertBtn`, `stopLink` and `modeChip` should use `minHeight: TOUCH_TARGET`, or `hitSlop` as `detailsBtn` already does. Start with "Find a place to stop" and the hazard-alert actions. | `MapScreen.tsx:1837,1841,1862` |
| A10 | Focus | Scope the rail focus ring: `.app-rail :focus-visible { outline-color: #93B4FF }`. | `index.css:347`; C5 |
| A11 | Error copy | Rewrite system-word errors in user terms (`BRAND_AND_COPY_GUIDE.md` §7): "Cannot reach RASTA. Check the connection, then try again." instead of "backend" and "API", and "Changed by someone else. Reload and check before retrying." instead of "Conflict". | `components/ui.tsx:261-281`; `MapScreen.tsx:765` |
| A12 | Metadata (SEO) | `manager-web/index.html`: add `<meta name="robots" content="noindex, nofollow">`, a factual description ("Sign-in for the RASTA AI fleet console."), and `<meta name="theme-color" content="#062621">`. Apply the same to the driver web export on the next build. No other claims. | `index.html:1-25` |
| A13 | Guard | Extend the existing wording test (`driver-app/src/themeWording.test.ts`, which already scans user-facing literals) with a banned-phrase list from the brand guide §5. Add a matching one in `manager-web`. | reuse of an existing pattern |

### ROADMAP
| ID | Area | Change | Why not now |
|---|---|---|---|
| R1 | Tokens | Map layers read colours from the CSS variables (`getComputedStyle`) instead of hex literals. Move Hotel POIs off route blue. | Touches map paint expressions. Needs visual re-certification of 2D, terrain and 3D. |
| R2 | Brand | Retone `brand/mark.svg` to forest and re-render with the existing `brand/render.mjs`. Decide whether the blue shield stroke stays. | A brand decision for the user. It changes the app icon, which needs a new APK. |
| R3 | Typography | Raise the text floor to 12px in the console (96 sites) and 13px in the driver app (48 sites). | Wide diff. Needs the 11-width responsive rerun. |
| R4 | Status | Show `StatusPill` in sentence case through a label map ("No route selected"). | Tests and exports may match the enum strings (`INFERRED`); check callers first. |
| R5 | Targets | Manager controls reach 44px below 800px (`.topbar-icon`, MapLibre controls, layer labels, Fleet header links). | Desktop already meets 24px (WCAG 2.2 AA). |
| R6 | i18n | Pass all 27 literal driver `accessibilityLabel`s through `t()`. Map server `error.message` to local phrases by error code. | Needs translation passes in 23 languages. |
| R7 | Responsive | Collapse the manager rail into a menu button below 800px. | Managers on phones also have the driver app's manager shell. Low use is `INFERRED`. |
| R8 | Evidence | Re-capture the Day palette on all four driver tabs, and one capture at the largest system font. | The current captures are identical files. |
| R9 | Docs | Fix the stale contrast comments in `index.css:22-27` and `theme.ts:20-24,109-110`. | Comment-only. Batch it with A7. |

### REJECT
| ID | Proposal | Source | Reason |
|---|---|---|---|
| X1 | Blue primary, orange tracking and green delivered as the logistics palette | UI UX Pro Max product search | Breaks the product's hue rule: a blue button "is claiming to be a road" (`index.css:19-20`). |
| X2 | Move off the cream and forest palette as a "generic tell" | Frontend design calibration list | Seven reference images set the direction (`REDESIGN_CERTIFICATION.md` §1), and the skill says the brief wins. |
| X3 | Sitemap, JSON-LD and indexation work | SearchFit checklist | These are sign-in-gated tools. Indexing sign-in pages serves no user. SEO must not add claims. |
| X4 | Generate variants with Superdesign | Superdesign | Spends credits and downloads a CLI. Needs the user's approval. |
| X5 | HUD / sci-fi styling, "Tactical Green #00FF00" | UI UX Pro Max product row (drone fleet) | Wrong product. It would also break the green-means-action rule. |
| X6 | Client-side product analytics | ux-validate telemetry item | No privacy review, and a government operations context. Use server trip timestamps instead. That usable timestamps exist for each transition is `INFERRED` from the trip workflow in `docs/PPT_SOURCE_OF_TRUTH.md` §5-6 and was not checked. |
| X7 | JTBD importance and satisfaction scores | jobs-to-be-done | No interviews exist. Numbers would be invented. |
| X8 | Dropping the `→` from "Continue" and "Log in", and removing middle-dot meta strings everywhere | Frontend design tells | Cosmetic, with no user-impact evidence. Keep them where they are readable. |

---

## 6. What not to do
- Do not generate designs with Superdesign or create Figma files without the user's approval.
- Do not add "safe", "safer", "real-time" or "AI predicts" wording in any redesign or SEO pass.
- Do not re-tone the palette away from the reference images.
- Do not copy mockup numbers ("120+ Districts", "+12%", "Route Status: Safe") into the product.
  `REDESIGN_CERTIFICATION.md` §1 already rejects them.
- Do not fix contrast by changing the hue meaning. Change lightness within the hue.
- Do not ship a real phone number, even as a placeholder or in a screenshot.

## 7. Decisions that belong to the user
1. A1, together with the pending cycle-1 decision on the 12 public images. The placeholder is on
   `origin/main` as well.
2. Remove the motto (A2). `docs/PPT_SOURCE_OF_TRUTH.md:3` recorded it without objecting.
3. The brand-mark palette (R2).
4. Which fix for A6: count only verified districts, or relabel.
