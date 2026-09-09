# Navigation Engine Architecture & Normalized Model

Engineering evaluation of navigation options, provider comparisons, and application model contracts.

---

## 1. Provider Evaluation Matrix

We evaluated three architectural paths for the in-app navigation capability:

| Criteria | Option A: Current Stack (MapLibre/RN-Maps + OSRM) | Option B: Google Navigation SDK | Option C: Provider Abstraction (Selected) |
| :--- | :--- | :--- | :--- |
| **Implementation Risk** | **Very Low** (already functioning and tested) | **High** (requires proprietary SDK integration & Android native build changes) | **Low** (preserves working stack, isolates interfaces) |
| **Cost & Billing Requirement**| **Zero Cost / No Billing Required** | **Requires Credit Card / GCP Billing Account** (limited to 1,000 free events/month) | **Zero Cost by Default** (pluggable if credentials exist) |
| **Current Code Reuse** | **100%** (reuses existing maneuvers, speech, progress) | < 20% (forces rewrite of map lifecycle) | **100%** (wraps existing logic behind standard interface) |
| **Offline Resilience** | **High** (offline packages cached in AsyncStorage/SQLite) | Low (requires persistent network or proprietary offline tiles) | **High** (guaranteed offline fallback) |
| **API Key Exposure Risk** | **Zero** (no commercial key needed) | High (leaked key could result in unauthorized billing) | **Zero** (server-gated when enabled) |
| **Turn Guidance** | **Full** (maneuver extraction, distance, TTS) | Full | **Full** |
| **Hackathon Readiness** | **Certified & Demo-Ready** | Blocked on billing setup | **Demo-Ready Today** |

**Architectural Decision:** **Option C (Provider Abstraction with Option A as Primary Engine).**
For the hackathon demo, reliability and zero-billing risk strictly outweigh third-party branding. Google Navigation SDK is configured as an optional provider plugin when valid billing credentials exist, while the battle-tested OSRM + `react-native-maps`/`MapLibre` engine ensures uninterrupted demo capability.

---

## 2. Normalized Navigation Domain Model

The navigation frontend consumes normalized models rather than raw provider JSON payloads.

```typescript
export interface NavigationManeuver {
  /** Sequential index within route */
  index: number
  /** Standardized maneuver type: 'depart' | 'turn' | 'fork' | 'merge' | 'roundabout' | 'arrive' */
  type: string
  /** Directional modifier: 'left' | 'slight_left' | 'sharp_left' | 'right' | 'slight_right' | 'straight' | 'uturn' */
  modifier?: string
  /** Human-readable guidance instruction, e.g. "Turn right onto NH-27" */
  instruction: string
  /** Street / highway name, e.g. "NH-27" */
  road_name: string
  /** Distance in meters from start of route to this maneuver */
  distance_from_start_m: number
  /** Distance in meters from the previous maneuver */
  distance_from_previous_m: number
  /** Coordinate of the maneuver: [latitude, longitude] */
  location: [number, number]
  /** Optional follow-up maneuver instruction, e.g. "Then keep left in 1.2 km" */
  follow_up?: {
    instruction: string
    distance_m: number
  }
}

export interface NavigationRoute {
  /** Authoritative route ID */
  id: string
  /** Routing provider that computed the route ('osrm' | 'google') */
  provider: string
  /** Full decoded polyline vertices in [lat, lon] order */
  geometry: [number, number][]
  /** Total route distance in meters */
  distance_m: number
  /** Total estimated duration in seconds */
  duration_s: number
  /** Step-by-step maneuvers */
  maneuvers: NavigationManeuver[]
  /** Route terrain hazard / risk segments */
  risk_segments?: Array<{
    start_index: number
    end_index: number
    hazard_type: string
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  }>
  /** Provider metadata */
  metadata?: Record<string, unknown>
}

export interface RouteProgress {
  /** Fraction complete between 0.0 and 1.0 */
  fraction_complete: number
  /** Distance traveled along planned route in meters */
  traveled_m: number
  /** Distance remaining along planned route in meters */
  remaining_m: number
  /** Perpendicular deviation from nearest route segment in meters */
  off_route_m: number
  /** True when off_route_m <= 200m */
  on_route: boolean
  /** Index of current active maneuver */
  current_maneuver_index: number
  /** Distance to upcoming maneuver in meters */
  distance_to_next_maneuver_m: number
}
```

---

## 3. Map Camera & Interaction Behaviors

1. **Follow Mode (Default Navigation):**
   - Camera tracks the vehicle position with smooth interpolation.
   - Heading-aligned orientation when real device compass/heading is available.
   - Preserves 35% forward visual horizon for forward-looking situational awareness.
2. **Free Pan Mode:**
   - Activated automatically when driver touches or drags the map canvas.
   - Follow mode disengages immediately; camera does NOT snap back unexpectedly.
   - Prominent floating "Recenter" button appears at bottom right.
3. **Recenter Action:**
   - Tapping "Recenter" smoothly animates the camera back to vehicle position and re-engages Follow Mode.
4. **Overview Mode:**
   - Tapping "Route Overview" adjusts camera bounds to encapsulate the full route from current position to destination.

---

## 4. Polyline Semantic Hierarchy (No Blue-Line Bug)

To eliminate visual ambiguity:
- **PLANNED ROUTE:** Thick solid blue line (`#2457D6`), width 5dp with white casing (8dp) on driver map.
- **OBSERVED TRACK:** Emerald teal breadcrumbs (`#0B756B`), width 4dp showing observed GPS fixes.
- **ALTERNATIVE ROUTE:** Neutral dashed slate (`#64748B`), width 3dp (dash 4,4).
- **HAZARD SEGMENT:** Warning amber overlay (`#F59E0B`), width 7dp positioned directly over the hazard coordinates.

---

## 5. Rerouting & Deviation Policy

- **Threshold:** Deviation is declared when device GPS fix is > 200 meters from nearest planned route segment for >= 3 consecutive fixes.
- **Honest Behavior:**
  - Upon deviation, state transitions to `OFF_ROUTE`.
  - A reroute request is sent to the routing provider.
  - If provider succeeds: new geometry is loaded and `RE_ROUTED` state is displayed.
  - If provider fails / offline: existing route geometry remains visible with a high-visibility warning: "OFF ROUTE — 320m from NH-27".
  - Never fabricate fake rerouting animations.
