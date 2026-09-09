# UX, Navigation, and AI Research & Engineering Decisions

Documenting verified facts, official sources, and architecture implications for the NER-AI-LOGISTICS system.

---

## 1. Google Navigation SDK & Google Maps Platform

### Record 1.1: Navigation SDK Billing & Free Allowance
- **SOURCE:** Google Maps Platform Official Pricing Documentation (`https://developers.google.com/maps/documentation/navigation/pricing`)
- **DATE CHECKED:** 2026-09-07
- **FACT:** The Google Navigation SDK is a billable product on Google Maps Platform. It provides a monthly free allowance of 1,000 billable destinations (events) per billing account per month. However, it strictly requires a Google Cloud project with an active, valid billing account (credit card linked). Beginning March 2025, Google replaced the general $200 recurring monthly credit with SKU-specific free allowances. Beyond 1,000 destinations, usage is billed per destination request.
- **PROJECT IMPLICATION:** Google Navigation SDK cannot be made a hard, mandatory dependency for the hackathon build. Requiring Google Navigation SDK would break builds and runtime execution for any evaluator, tester, or device without an active Google Cloud billing configuration. We must retain a provider abstraction: MapLibre GL JS (web) and `react-native-maps` + OSRM routing serve as the primary, guaranteed zero-cost stack, with Google Maps/Nav SDK as an optional pluggable provider.

### Record 1.2: Maps SDK for Android vs Navigation SDK
- **SOURCE:** Android Developer & Google Maps Platform Docs (`https://developers.google.com/maps/documentation/android-sdk/overview`)
- **DATE CHECKED:** 2026-09-07
- **FACT:** The Maps SDK for Android (used by `react-native-maps`) provides vector map rendering, camera control, markers, and polylines with free tier allowance. Turn-by-turn guidance and rerouting logic are application-layer responsibilities when not using the proprietary Navigation SDK.
- **PROJECT IMPLICATION:** Our custom navigation engine in `driver-app/src/map/` already implements maneuver parsing (`maneuvers.ts`), route progress calculation (`useRouteGeometry.ts`), and voice guidance (`speech.ts`). We maintain full control over the UX, styling, and offline capabilities without third-party vendor lock-in.

---

## 2. Gemini Developer API (Free Tier) & AI Assistant Architecture

### Record 2.1: Free Tier Rate Limits and Quota Exhaustion
- **SOURCE:** Google AI Studio / Gemini API Official Docs (`https://ai.google.dev/pricing`)
- **DATE CHECKED:** 2026-09-07
- **FACT:** The Gemini Developer API Free Tier offers zero-cost access to models such as `gemini-2.5-flash` and `gemini-1.5-flash` with rate limits typically capped at 10–15 Requests Per Minute (RPM), 250,000 Tokens Per Minute (TPM), and 1,000–1,500 Requests Per Day (RPD). Quotas reset at midnight Pacific Time. Exceeding these limits returns HTTP `429 RESOURCE_EXHAUSTED`.
- **PROJECT IMPLICATION:** 
  1. The mobile client must never crash on HTTP 429. The app must implement graceful degradation.
  2. Free-tier quota must be conserved: user queries must first pass through local deterministic intent classification. Questions resolvable deterministically (e.g., current trip status, emergency numbers, cached safety guide) are answered locally without calling Gemini.
  3. A server-side token bucket / rate-limiter must throttle requests to 10 RPM per user.

### Record 2.2: API Key Security Architecture
- **SOURCE:** Android Security Guidelines & Expo Security Best Practices
- **DATE CHECKED:** 2026-09-07
- **FACT:** Expo inlines all `EXPO_PUBLIC_*` environment variables directly into client JavaScript bundles. Any API key embedded in a mobile APK or React bundle is extractable via simple static analysis (`strings`, APK decompilation).
- **PROJECT IMPLICATION:** Direct calls from Driver APK to the Gemini API are strictly prohibited. The Gemini API key (`GEMINI_API_KEY`) must exist solely in the backend / Edge Function environment. The Driver APK communicates exclusively with authenticated server endpoints (`/api/ai/ask`), which proxy and sanitize requests.

### Record 2.3: Deterministic Safety Split & Non-Authority Principle
- **SOURCE:** System Safety Architecture (`docs/ARCHITECTURE.md`, `AGENTS.md`)
- **DATE CHECKED:** 2026-09-07
- **FACT:** LLMs can hallucinate plausible-sounding route directions, closures, or weather data. In hazardous terrain (such as monsoon-affected Northeast India), fabricated directions can cause vehicle accidents or stranding.
- **PROJECT IMPLICATION:** Gemini is strictly an *explainer*, never an *authority*. It is fed verified deterministic context (computed route risk, verified weather points, active trip status, emergency directory) and tasked only with summarizing or translating. Turn-by-turn maneuvers, road closures, ETA calculations, GPS fixes, and emergency dispatch confirmations remain 100% deterministic.

---

## 3. Map & Routing Stack (MapLibre & OSRM)

### Record 3.1: MapLibre GL JS Web Worker Bundling
- **SOURCE:** MapLibre GL JS Documentation & Vite Bundler Specifications
- **DATE CHECKED:** 2026-09-07
- **FACT:** MapLibre GL JS creates a Web Worker dynamically at runtime using `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. Modern bundlers (like Vite) do not trace dynamic string URLs by default, causing production builds to fail to emit the worker and fail silently with GeoJSON layers unrendered.
- **PROJECT IMPLICATION:** `manager-web/src/components/FleetMap.tsx` correctly resolves the worker at compile-time using Vite's static worker syntax `import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'` and `setWorkerUrl(maplibreWorkerUrl)`. This pattern must be preserved.

### Record 3.2: Polyline Coordinate Conventions
- **SOURCE:** GeoJSON RFC 7946 vs Leaflet / React Native Maps API Specifications
- **DATE CHECKED:** 2026-09-07
- **FACT:** GeoJSON specifications mandate `[longitude, latitude]` order. Leaflet, React Native Maps, and the application domain use `[latitude, longitude]` (`LatLon`).
- **PROJECT IMPLICATION:** All transformations must happen at the adapter boundary. The internal normalized application model strictly operates on `{ latitude, longitude }` objects or `[lat, lon]` pairs, avoiding silent inversion bugs.

---

## 4. In-Cab Mobile Driver Ergonomics & Accessibility

### Record 4.1: Touch Targets and Glanceable Scan Time
- **SOURCE:** Android Accessibility Guidelines (WCAG 2.5.5) & Human-Machine Interface (HMI) In-Vehicle Standards
- **DATE CHECKED:** 2026-09-07
- **FACT:** In-cab mobile devices operate on dashboard mounts subject to vehicle vibration, varying lighting conditions, and arm's-length interaction. Standard 32dp or 40dp touch targets have high error rates under vibration. The acceptable driver eye glance time off the road is at most 2.0 seconds.
- **PROJECT IMPLICATION:**
  1. Primary in-cab interactive targets must meet or exceed 48dp x 48dp (TOUCH_TARGET = 48dp).
  2. The next-turn maneuver card must be pinned at the top of the navigation viewport, displaying a high-contrast maneuver arrow, large-font distance (< 2-second glanceability), and road name.
  3. High-contrast dark theme (#0B1016 background, #131B24 surface, #FFFFFF text) ensures daylight and nighttime readability without blinding night vision.
