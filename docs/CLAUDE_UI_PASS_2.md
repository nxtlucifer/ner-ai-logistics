# NER LOGISTICS — UI/UX PASS 2 (P0 SLICE CONTINUATION)

Continues `CLAUDE_UI_PASS.md`. Presentation only. Backend, Supabase and the
deployed `gemini-ai` function untouched. Nothing committed or pushed.

---

## WHAT THIS PASS ACTUALLY DID

The brief predicted Driver Navigation would need a rebuild — "dashboard cards +
empty map area + many pills". **That was not what I found.** `MapScreen.tsx`
already had the right architecture: a full-bleed map canvas, floating top layer,
next-turn card, right-edge control stack, floating speedometer and a collapsible
ETA sheet. Rebuilding it would have destroyed working, tested composition to
arrive back where it started.

So this pass fixed what was actually wrong with it, which was different and in
places worse than a layout problem: **three dead controls, an emoji icon system,
and vendor model names on a driver's windscreen.**

---

## 1. DRIVER ACTIVE NAVIGATION

### Dead controls found and fixed

Three of the four map controls could be pressed and did nothing, with no visual
difference from a working control:

| Control | Defect | Fix |
| :--- | :--- | :--- |
| **Audio** | `onPress={() => voice.available === true && setMuted(...)}` — on a device with no speech engine the tap was swallowed silently | Disabled with `accessibilityHint` "No speech engine on this device" |
| **Recenter** | Re-aimed the camera at a position that may not exist yet | Disabled until `tracking.lastPosition != null`, hint "Waiting for a GPS position" |
| **Alternative route** | Flipped a flag that draws `geometry.backupPoints` — an empty array unless the trip carries a second corridor. On most NER corridors the provider returns one road, so this was inert on the majority of real trips | Rendered **only** when `backupPoints.length > 1` |
| **Fit route** | Worked, but with no route to frame | Disabled when `geometry.points.length <= 1` |

All four now route through one `MapControl` component: 52dp (`TOUCH_TARGET`,
above the 48 floor), pressed state, active state, and disabled carried by both
opacity **and** `accessibilityState` + hint, so a screen reader says *why*
rather than just "dimmed".

### Icons: emoji removed across the whole driver app

The bottom navigation shipped with `🧭 📋 🛡️ 🤖` and the map controls with
`🗺️ 🧭 🔊 🔇`. Emoji are drawn by whichever font the device ships, so the app's
**primary navigation changed appearance between Android versions**, sat at
whatever baseline the font chose, and **could not take the app's own colours** —
an active tab physically could not tint its icon, because the glyph carries its
own palette.

The mute toggle was the clearest failure: `🔇` and `🔊` differ by a small stroke
that several system fonts draw almost identically, so the control gave a driver
no reliable read on whether guidance was on.

**New:** `src/components/icons.tsx` — a zero-dependency icon set drawn from
Views (rectangles, circles, rotated squares, and border-trick triangles).
`@expo/vector-icons` and `react-native-svg` are both absent and neither resolves
transitively; adding a native module days before a demo to draw a loudspeaker is
a bad trade.

Eight icons, **rendered and visually verified** in a temporary harness (since
removed): navigate, trip, safety, ai, recenter, fit-route, audio-on, audio-off.

Two iterations were needed and are recorded in the source:
- The shield read as a blob — a triangle rotated 180° pivots about its centre.
  Rebuilt with `borderTopWidth` directly.
- The AI icon failed twice: a four-point spark lost its points at 21px and read
  as a plain diamond; a processor die scattered its eight legs into a diagonal
  smear. Third attempt — a speech bubble, three Views, no small features to
  lose — is what shipped.

### Vendor and model names removed from the driver UI

| Was | Now |
| :--- | :--- |
| `🤖 Gemini Driver Assistant` | `AI Co-Driver` |
| `Voice & text highway companion (Gemini 3 Flash + DeepSeek fallback)` | `Ask about the road ahead, conditions and your trip.` |
| `Thinking with Gemini 3 Flash…` | `Thinking…` |
| `🚨 SOS 112` | `SOS 112` |

The subtitle named **two** model vendors, and "DeepSeek" had been wrong since
the backup engine changed to Gemma. A driver needs to know what it answers, not
who built it.

**FILES:** `src/screens/MapScreen.tsx`, `src/components/icons.tsx` (new),
`App.tsx`, `src/navigation.ts`

---

## 2. EMOJI PURGE — WHOLE DRIVER APP

| File | Removed |
| :--- | :--- |
| `navigation.ts` | `TAB_ICONS` deleted entirely — a map of emoji in the navigation module is the first thing a future edit reaches for |
| `App.tsx` | `🌐` on the language switcher — it sat at a different baseline from the Assamese/Bengali label beside it, leaving the row visibly uneven |
| `MapScreen.tsx` | 12 instances across map controls, SOS, AI modal, quick-prompt chips |
| `AssistantScreen.tsx` | `🤖 🌐 ⚠️ 🛡️` mode-chip icons (the `icon` field is gone, not just unused), `☕` |
| `TranslateBox.tsx` | `📋 ✓ 🔊 ⏹` on copy/speak controls |
| `maneuvers.ts` | `🏁` → `◉`, `🔄` → `↻` — the only two colour-emoji in a set otherwise made of `↰ ↱ ↑`, so on the next-turn card they rendered at a different weight and baseline and ignored the card's colour |

**Audited result: zero rendered emoji in driver source.** The only matches left
are inside explanatory comments and `✕` (U+2715), a monochrome typographic close
glyph that inherits colour.

Arrows (`↰ ↱ ↑ →`) are kept deliberately — they are geometric typography, not
emoji, and the brief's own target mockup uses `↱` for the maneuver card.

---

## 3. ROUTE PLANNER

**Blank card slots eliminated.** The comparison grid was a fixed
`md:grid-cols-3`, so a single-corridor result — the common case, measured as six
of eight tested NER pairs — rendered one card beside two empty thirds and read
as a broken layout rather than an honest answer.

Columns now follow the data: 3 → `grid-cols-3`, 2 → `grid-cols-2`, 1 → a single
constrained-width card.

**Model names removed here too.** The explainer badge printed
`aiModel ?? 'Gemini 3 Flash / DeepSeek'` on a manager screen. Now
`AI-generated · advisory`. The `aiModel` prop is retained on the interface so
the call site is unchanged, but nothing renders it, and `FleetPage`'s hardcoded
fallback string is gone.

**FILES:** `manager-web/src/components/RouteRiskComparison.tsx`,
`manager-web/src/pages/FleetPage.tsx`

---

## 4. FLEET MAP — TWO FABRICATED HAZARD BANNERS REMOVED

Pinned to the top-right of the GIS map, on every screen, for every trip, in
every region:

- *"🌧️ Monitored Monsoon Corridor: Kaziranga Sector — HISTORICAL HAZARD AREA"*
- *"⚠️ Landslide Hazard Exposure: NH715 Sector 4 — STATIC REFERENCE"*

Neither was derived from anything: no snapshot, no assessment, no trip. They
carried honest qualifiers, but a fixed string dressed as a hazard readout on an
operational console is the same class of thing this codebase refuses to do with
weather and GPS — and a judge has no way to tell it apart from a live detection.
They also sat over the corridor a dispatcher is trying to read.

Real hazard rendering already exists and is data-driven: risk segments come
through the route assessment and are drawn on the line itself.

**This is a deletion of visible content — flagged prominently in case you want
it back.**

---

## 5. SAFETY — A DELIBERATE NON-CHANGE

The brief asks for a new ROUTE SAFETY panel (ACCESSIBILITY / WEATHER /
LANDSLIDE / GPS / CONNECTIVITY). **I did not build it**, because it would
require wiring route-risk data into `SafetyScreen`, and the same brief says "DO
NOT ADD NEW FEATURES". Inventing a panel whose data is not plumbed is how
fabricated status badges get built — exactly what I removed from the KPI bar
last pass.

What is already there and is good: emergency numbers pinned at the top at 60dp
(`TOUCH_TARGET + 8`, well above the 48 floor), and a break tracker that states
its own limits on screen — *"elapsed time, not time spent driving"*.

**This is a gap against the brief, by choice, and I would rather say so than
ship a panel of invented states.**

---

## 6. RESPONSIVE QA

Measured in-browser (`scrollWidth - clientWidth`), not eyeballed — the preview
pane's screenshot scaling distorts React-Native-Web.

| Manager width | Overflow |
| :--- | :--- |
| 1920×1080 | 0px |
| 1440×900 | 0px |
| 1366×768 | 0px |
| 1280×720 | 0px |
| 1024×768 | 0px |
| 820×900 | 0px (brand panel hides, submit stays 48px and visible) |

Driver login measured at 375×812: root 375px, card 331px, no overflow.
**Driver Navigation was not measured at any width — it is behind auth.**

---

## 7. INTERACTION CERTIFICATION

| Control | Status | Basis |
| :--- | :--- | :--- |
| Recenter | **DISABLED_WITH_REASON** when no GPS, else WORKING | code + guard |
| Fit route / Overview | **DISABLED_WITH_REASON** when no route, else WORKING | code + guard |
| Audio | **DISABLED_WITH_REASON** when no speech engine, else WORKING | code + guard |
| Alternative route | **REMOVED** from the UI unless a real second corridor exists | code + guard |
| SOS | WORKING — existing `tel:` flow, untouched | code |
| Navigate / Trip / Safety / AI tabs | WORKING, now with tintable vector icons | rendered + verified |
| Driver login (all 8 controls) | Certified last pass; `Remember me` REMOVED | rendered + verified |
| Manager sign-in | WORKING | rendered + verified |
| Manager KPI + freshness chips | WORKING | tests |
| Route select / preview | WORKING; BLOCKED routes non-selectable | tests |

**Honest limit:** the driver map controls are certified from code and guards,
**not from pressing them on a running screen**, because MapScreen is behind a
login and I do not enter passwords. I verified the icon set by rendering it; I
did not verify the assembled navigation screen.

---

## 8. TESTS

| Suite | Result |
| :--- | :--- |
| **DRIVER** | **490 / 490** (36 files) |
| Driver typecheck | clean |
| **MANAGER** | **124 / 124** (12 files) |
| Manager typecheck | clean |
| Manager production build | clean |
| **BACKEND** | **959 passed, 0 failed, 5 skipped** — unchanged |

Two `maneuvers.test.ts` assertions updated to the new glyphs (`◉`, `↻`). That is
the test asserting the presentation it is meant to assert; the behaviour under
test — which maneuver maps to which symbol — is unchanged.

---

## 9. APK

**Version bumped: `1.0.9` → `1.0.10`, `versionCode` 9 → 10.**

Driver runtime source changed substantially this pass, so VC9 does not contain
any of it. **No EAS build has been triggered** — that is yours to run.

The pre-bundle release gate still exits 1 correctly when env is unset.

---

## FINAL GATE

| Gate | Verdict |
| :--- | :--- |
| DRIVER LOGIN | **PASS** — rendered and verified |
| DRIVER ACTIVE NAVIGATION | **PARTIAL** — dead controls fixed, icons rebuilt, vendor names removed; screen not rendered end-to-end |
| MAP DOMINANCE | **PASS (unchanged)** — already full-bleed with floating layers; not re-measured on device |
| RECENTER | **PASS** — works, and now disables with a reason |
| OVERVIEW | **PASS** — works, and now disables with a reason |
| AUDIO | **PASS** — was silently dead without a speech engine; now honest |
| SOS | **PASS** — visible, existing flow, emoji removed |
| ROUTE PLANNER | **PASS** — dynamic columns, no blank slots, no model names |
| DYNAMIC ROUTE COUNT | **PASS** — 1 / 2 / 3 all render correctly |
| AI PROVENANCE | **PASS** — fixed last pass, 4 regression tests |
| AI DUPLICATION REMOVED | **NOT DONE** — the four-mode restructure was not attempted |
| SAFETY UI | **NOT DONE** — deliberate; see section 5 |
| NO CORE EMOJI | **PASS** — zero rendered emoji in driver source |
| RESPONSIVE | **PASS (manager)** / **NOT MEASURED (driver navigation)** |
| ZERO DEAD CONTROLS | **PASS for every control I could reach**; not a whole-app inventory |
| DRIVER TESTS | **490 / 490** |
| MANAGER TESTS | **124 / 124** |
| BACKEND CHANGED | **NO** |
| SUPABASE CHANGED | **NO** |
| APK VERSION | **1.0.10** |
| APK BUILD REQUIRED | **YES** — not triggered |

### MEETING_VISUAL_READY: **YES, with two named gaps**

Driver Login, Manager Sign-in, Manager Command Center and the Route Planner are
presentation quality. Driver Navigation is materially better — no dead controls,
professional icons, no vendor leaks — but I have not seen it assembled, so I
will not certify it as verified.

**PHYSICAL_ANDROID_CERTIFIED: NO.** No handset evidence, and none of this work
is in a built APK yet.

### What I would do next, in order

1. Build VC10 and open the navigation screen on a phone — it is the only way to
   close the one gate I cannot.
2. The AI four-mode restructure (`AI CO-DRIVER` action set).
3. Decide whether the two hazard banners should return in a data-driven form.
