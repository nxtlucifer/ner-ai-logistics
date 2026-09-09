# Driver UI Audit & Information Architecture Specification

Audit of all Driver mobile screens and controls, conducted 2026-09-07.

---

## Screen 1: Navigation / Map Screen (`MapScreen.tsx`)

- **CURRENT PURPOSE:** Full-screen turn guidance, roadside POI discovery, upcoming maneuvers, offline route viewing, and direct emergency numbers.
- **WORKING CONTROLS:**
  - Maneuver progress & upcoming maneuver calculation (`NextTurnPanel.tsx`).
  - Voice speech announcement of maneuvers (`expo-speech` on native).
  - Search roadside places ("Near me", "Along route", "Search this area") across Emergency, Tyres, Hotel, Rest categories.
  - Emergency call shortcuts (112, 108, 1033) with dialer intent.
  - Web & native map adapters (`DriverRouteMap.web.tsx`, `DriverRouteMap.native.tsx`).
- **BROKEN / SUB-OPTIMAL CONTROLS:**
  - Recenter button was not prominent enough when driver panned away from vehicle in free-pan mode.
  - Map area was occasionally compressed by oversized floating panels on smaller screens (< 360dp width).
- **VISUAL PROBLEM:** Controls slightly scattered; needs industrial Terrain Command visual tokens (`#0B1016` dark background, `#3EA6FF` primary blue, `#26C6A5` safe teal).
- **INFORMATION PRIORITY:**
  1. Top: Next-turn card (maneuver arrow, distance, road name).
  2. Center: Map with active vehicle position and planned route polyline.
  3. Floating Right: Recenter, compass, overview toggle.
  4. Bottom: Collapsible bottom sheet (distance remaining, duration, next stop, POI triggers).
- **NAVIGATION PROBLEM:** Previously accessed only conditionally through a modal state toggle (`isMapOpen`) from `TripScreen`.
- **ACCESSIBILITY PROBLEM:** Touch targets on map controls were 40dp; must be strictly >= 48dp for in-cab dashboard mount operation.
- **PROPOSED CHANGE:** Promote to the primary `NAVIGATE` bottom tab (65–80% visual area). Ensure large 48dp+ floating controls and high glanceability (< 2s scan time).

---

## Screen 2: Trip Overview & Lifecycle (`TripScreen.tsx`)

- **CURRENT PURPOSE:** Manage active assignment, review trip code, origin, destination, cargo, verify truck, and trigger start / stop arrival / stop complete / trip complete lifecycle transitions.
- **WORKING CONTROLS:**
  - Accept trip button (server-authoritative idempotency).
  - Truck physical verification input and button (flags mismatch without blocking).
  - Start trip button (bound to server start-gate).
  - Stop arrival & stop completion buttons (sequential enforcement).
  - Complete trip button (disabled until all stops completed).
- **BROKEN / SUB-OPTIMAL CONTROLS:**
  - Action buttons previously lacked visual distinction between primary next-step vs secondary actions.
  - Disabled reasons were sometimes collapsed inside alert banners rather than clearly paired with the disabled button.
- **VISUAL PROBLEM:** Dense card layout with excessive nested boxes on small viewports.
- **INFORMATION PRIORITY:**
  1. Current Status Banner (REQUESTED, ASSIGNED, ACTIVE, DELIVERED).
  2. Next Immediate Action (Accept, Verify, Start, Arrive, or Complete).
  3. Trip Summary (Code, Origin, Destination, Cargo).
  4. Stop Sequence Progress (Numbered badges, status).
- **NAVIGATION PROBLEM:** Nested in the old top header tabs.
- **ACCESSIBILITY PROBLEM:** Touch targets on stop action buttons need 48dp minimum height and unambiguous active/disabled contrast.
- **PROPOSED CHANGE:** Position as the `TRIP` tab in the new 4-tab bottom navigation. Clean vertical workflow card with dominant primary action button.

---

## Screen 3: Safety & Emergency (`SafetyScreen.tsx`)

- **CURRENT PURPOSE:** Display terrain hazard guidance, driver break tracking / mandatory rest logging, and emergency contact numbers.
- **WORKING CONTROLS:**
  - Break assessment (`breaks.ts`) tracking driving duration.
  - "Log a break" button persisting to `AsyncStorage`.
  - Offline safety guide accordion from `guide.json`.
  - Emergency call shortcuts (112, 108, 1033).
- **BROKEN / SUB-OPTIMAL CONTROLS:**
  - Emergency contacts were located near the bottom of a scrollable list rather than permanently pinned and immediately dialable.
- **VISUAL PROBLEM:** Emergency red was used across several non-critical alert icons, diluting its urgency.
- **INFORMATION PRIORITY:**
  1. Critical Emergency Actions (112, 108, 1033) — ALWAYS prominent.
  2. Fatigue & Break Status (Time driven, rest recommended).
  3. Terrain Safety Checklist & Monsoon / Landslide Guidance.
- **NAVIGATION PROBLEM:** Top tab navigation caused delay during stressful emergency situations.
- **ACCESSIBILITY PROBLEM:** Emergency buttons must have high contrast, large icons, and clear confirmation modals to prevent accidental pocket dials while ensuring single-tap access in distress.
- **PROPOSED CHANGE:** Position as the `SAFETY` bottom tab. Pin emergency call banner to the top with immediate 48dp+ tap targets. Reserve `#EF4444` red exclusively for emergencies.

---

## Screen 4: Driver AI Assistant (`AssistantScreen.tsx`)

- **CURRENT PURPOSE:** Provide conversational logistics assistance, explain complex route hazards, and offer phrasebook translation.
- **WORKING CONTROLS:**
  - Pre-computed intent answering (`assistant.ts`).
  - Offline fallback answering when server / model is unreachable.
  - Quick action prompt chips ("Explain route risk", "Weather ahead", "Emergency guidance").
- **BROKEN / SUB-OPTIMAL CONTROLS:**
  - Fast-typing in chat previously could overlap slow responses; mitigated by cancellation tokens but needed clearer streaming/loading states.
  - No speech readout for answers.
- **VISUAL PROBLEM:** Chat bubbles lacked distinct visual hierarchy between user questions, AI responses, and local offline fallback notices.
- **INFORMATION PRIORITY:**
  1. Assistant Status Badge (`ONLINE (Gemini)`, `LIMITED`, `OFFLINE ASSISTANT`).
  2. Concise Quick Prompt Chips.
  3. Dialogue Stream (High contrast, compact, in-cab readable).
  4. Audio Listen (Text-to-Speech) control.
- **NAVIGATION PROBLEM:** Previously split between `AssistantScreen` and `PhrasebookScreen`.
- **ACCESSIBILITY PROBLEM:** In-vehicle typing is hazardous while moving. Must provide voice readout (`expo-speech`) and one-tap quick prompt chips.
- **PROPOSED CHANGE:** Promote to the `AI` bottom tab. Integrate translation directly. Implement server-side Gemini proxy with free-tier 429 protection, strict safety filtering, and offline library fallback.

---

## Screen 5: Authentication (`LoginScreen.tsx`)

- **CURRENT PURPOSE:** Driver credential sign-in (email/password).
- **WORKING CONTROLS:**
  - Form validation, password visibility toggle, network timeout handling (15s bounded), error banner.
- **BROKEN / SUB-OPTIMAL CONTROLS:**
  - None; auth flow is solid.
- **VISUAL PROBLEM:** Needs alignment with the Terrain Command dark industrial design tokens.
- **INFORMATION PRIORITY:**
  1. Brand Header (NER Fleet Intelligence · Driver Command).
  2. Credentials Input (Email / ID and Password).
  3. Large 48dp "Sign in" action.
  4. Clear, non-technical error alerts (no raw stack traces).
- **PROPOSED CHANGE:** Update styling to Terrain Command dark theme `#0B1016`. Retain exact working session and credential logic.

---

## Information Architecture (IA) Decision

Primary Bottom Navigation Tabs (4 Destinations):
```
┌────────────────────────────────────────────────────────┐
│  [ 🧭 NAVIGATE ]   [ 📋 TRIP ]   [ 🛡️ SAFETY ]   [ 🤖 AI ] │
└────────────────────────────────────────────────────────┘
```
1. **NAVIGATE**: Dedicated map-first guidance (75-80% viewport).
2. **TRIP**: Current assignment, truck verification, stop management, dispatch actions.
3. **SAFETY**: Emergency numbers (112/108/1033), break logging, terrain protocols.
4. **AI**: Gemini-powered driver assistant, quick chips, speech TTS, and phrasebook.
