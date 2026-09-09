# Manager UI & Command Center Audit

Audit of Manager Web Command Center conducted 2026-09-07.

---

## 1. Manager Information Architecture & Navigation

The Manager web application serves dispatchers, fleet supervisors, and authorized route reviewers operating in command center environments.

### Primary Sections & Route Map:
1. **Fleet Command (`/fleet`)**: Central live fleet map (`MapLibre GL JS`), real-time vehicle breadcrumbs, active trips, vehicle detail drawer, and cluster filters.
2. **Trips (`/trips`)**: Atomic trip creation, shipment linking, stops, route selection, and dispatch transitions.
3. **Drivers (`/drivers`)**: Driver roster, licence status, duty status (`AVAILABLE`, `ON_TRIP`, `OFF_DUTY`).
4. **Trucks (`/trucks`)**: Fleet assets, registration numbers, maintenance flags, and operational statuses.
5. **Assignments (`/assignments`)**: Active and historical driver-truck pairings.
6. **Route Review (`/review`)**: Audited review portal for `AUTHORISED_REVIEWER` role to approve routes requiring exception review (`REQUIRES_REVIEW` state).
7. **System (`/system`)**: Connectivity status, database provider info, and telemetry telemetry health.

---

## 2. Manager Fleet Map Audit (`FleetMap.tsx`)

- **Map Engine:** `MapLibre GL JS` with OSM raster tiles (zero external API key / billing dependency).
- **Web Worker Bundling:** Verified `FleetMap.worker.build.test.ts` passes. Static worker bundling via `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` ensures offline/production reliability.
- **Layer Semantics & Polyline Styling (No Blue-Line Bug):**
  - `PLANNED_ROUTE`: Deep indigo solid polyline (`#2457D6`, width 5) with white casing (`#FFFFFF`, width 8) to distinguish from generic roads.
  - `OBSERVED_TRACK`: Teal directional breadcrumb trail (`#0B756B`, width 4) showing verified GPS fixes.
  - `ALTERNATIVE_ROUTE`: Muted dashed polyline (`#64748B`, width 3, dash 2,2) for unselected candidates.
  - `RISK_SEGMENT`: Warning amber overlay (`#F59E0B`, width 6) applied only where deterministic risk score exceeds threshold.
- **Interaction Pattern:**
  - Selecting a truck opens a side drawer with status, speed, last fix timestamp, and trip details without obscuring the map canvas.
  - Selecting a trip zooms the camera to fit planned route bounds while maintaining visible truck position.
  - "Fit Fleet" button smoothly frames all active units without jumpy camera snaps.
- **TC-08 Fix Verification:** Ensured map-fit buttons have at least 8px clearance across all breakpoints (no button overlap).

---

## 3. Address Entry & Geocoding UX (`AddressPicker.tsx`)

- **Audit:**
  - Previously showed raw latitude/longitude prominently, which caused cognitive friction for dispatchers.
  - Late network responses could overwrite user-shortened manual queries (fixed in TC-02 with sequence cancellation).
- **Enhanced UX Standard:**
  - Primary Display: Human-readable location / landmark name.
  - Secondary Display: Locality, City, State / Region.
  - Coordinates: Displayed in subtle monospace tag below the address for technical verification, never replacing the street name.

---

## 4. Multi-Zoom & Responsive Reflow Audit

Target resolutions evaluated:
- Desktop Large: 1920x1080 (100% and 125% DPI scale)
- Desktop Standard: 1440x900 and 1366x768 (100%, 90%, 80%, 75% browser zoom)
- Tablet Landscape: 1024x768 / 834x1194
- Mobile Reference: 390x844

### Key Invariants Enforced:
1. **No Zoom-Dependent Usability:** Core navigation, fleet list, and dispatch buttons must remain fully accessible without requiring browser zoom-out.
2. **Side Drawer over Giant Modals:** Contextual drawers preserve map visibility and situational awareness.
3. **Responsive Grid:** The left sidebar gracefully collapses into an icon rail on viewports under 1024px.
4. **No Dead Controls:** Every button links directly to an active API action or is explicitly disabled with an accessible tooltip stating the unmet prerequisite.
