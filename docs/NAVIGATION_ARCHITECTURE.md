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

---

## 6. Route Matching: Windowed, Not Nearest

`navState.projectOntoRoute` takes the nearest point **anywhere** on the
polyline. That is the port of `app/domain/route_progress.py` and it is left
alone: agreement with the server is the point of it, and the server has one fix
and no memory of the last one.

The phone does have that memory, and matching without it is wrong on real
corridors. Where a route doubles back — a bypass beside the road it bypasses, a
flyover over the street below, a valley road in and out — two stretches of the
line run within a few hundred metres of each other, and a fix with ordinary
error is sometimes nearer the **wrong** one.

`navState.projectOntoRouteNear(points, fix, previousAlongM)` is the client's
continuity layer over it:

1. **Window.** Only segments between `previousAlongM - PROJECTION_BACK_M` (300 m)
   and `+ PROJECTION_AHEAD_M` (3,000 m) are candidates. Back is small and ahead
   is large because that is how trucks move; 3 km is ~100 s at 110 km/h, so a
   missed poll or two is still matched.
2. **Cost, not just distance.** Inside the window, nearest-wins is the same
   mistake in miniature — on the replay corridor the return leg's matching point
   is ~2.9 km ahead, *inside* the window, and only 50 m from a fix that is 100 m
   off its own leg. Candidates are therefore scored:

   ```
   cost = crossTrackM + PROJECTION_DRIFT_WEIGHT * |alongM - previousAlongM|
   ```

   At `0.05`, a candidate pays 1 m of cost per 20 m of implied jump. An ordinary
   167 m advance pays 8 m and is unaffected; a 2.9 km leap pays 146 m and loses.
   A genuine 3 km advance after missed polls still wins, because its own
   cross-track is metres rather than hundreds.
3. **Re-acquisition.** If the chosen candidate's real cross-track exceeds
   `PROJECTION_REACQUIRE_M` (= `OFF_ROUTE_ENTER_M`, 200 m) the memory is stale —
   the app was backgrounded, the truck moved far — and the global match is
   returned instead. The test is the **cross-track**, never the cost: the drift
   penalty breaks ties between legs and must not itself trigger re-acquisition.
4. **Reset.** A new `selected_route_id` clears the memory. Only a fix within
   `OFF_ROUTE_ENTER_M` of the corridor seeds it, so an off-route position cannot
   carry its error into the next match.

**Stated limitation.** Re-acquisition triggers at 200 m while two carriageways
can be 150 m apart, so a truck that genuinely appears on the parallel leg keeps
being matched to the one it was on. That is the intended direction: a 150 m
sideways jump between two polls is a bad fix far more often than it is a truck,
and the cost of believing it — progress leaping kilometres, maneuvers skipped, a
turn announced for a road not reached — is worse than a few stale seconds. A
truck that has really moved leaves the window within a poll or two. Pinned by
`navState.test.ts`.

**Also stated:** the *first* fix of a session has no memory, so it matches
globally and can pick the wrong leg on a doubling-back corridor. Resuming
navigation mid-route is exactly when this happens. Pinned by the
`first_fix_ambiguity` scenario in `replay.test.ts`.

---

## 7. Guidance Scheduler

One module decides everything the app says during navigation: `map/speech.ts`.
It contains no speech engine, generates no language, and is pure. `map/
useSpokenGuidance.ts` is the thin part that owns the engine handle.

**Voice modes** (`VoiceMode`) are defined, not decorative:

| Mode | Turn cues | State changes | Manual repeat |
| --- | --- | --- | --- |
| `GUIDANCE` | yes | yes | yes |
| `ALERTS` | no | yes | yes |
| `MUTED` | no | no | **yes** |

A manual "repeat instruction" is an explicit playback request, not the app
deciding to talk, so it works while muted and is never deduplicated.

**Cue stages** are distance *and* time based. Each stage fires at whichever is
farther — its fixed band, or the distance covered in its lead time at the
current speed:

| Stage | Fixed | Lead |
| --- | --- | --- |
| `ADVANCE` | 2,000 m | 75 s |
| `APPROACH` | 500 m | 25 s |
| `IMMEDIATE` | 100 m | 6 s |

500 m is a comfortable warning in town and eighteen seconds on a highway, which
is why distance alone is not enough. Below `minSpeedMps` (5 m/s) the widening is
skipped — a truck in a jam would otherwise compute a 40 m advance cue — and an
absent speed never *shrinks* a cue. All of it is in `CUE_THRESHOLDS`; the values
are this project's candidate settings, **not** Google's algorithm and not
measured against it.

**Closely spaced turns** within `combineWithinM` (150 m) become one sentence:
"Turn right, then keep left". Two sentences four seconds apart on a short urban
link arrive after the first turn is taken.

**State changes** are reported as *conditions*, each tick, and the scheduler
decides whether one is new. `GuidanceEvent` covers `REROUTING`,
`ROUTE_UPDATED`, `GPS_LOST`, `GPS_RECOVERED`, `OFF_ROUTE`, `STOP_REACHED` and
`ARRIVED`. A change outranks a turn cue, because a cue for a corridor the truck
has just left is about to be wrong. `ARRIVED` is once per route; the rest are
rate-limited by `eventCooldownMs` (30 s) so a phone at the edge of coverage
cannot narrate its own flapping. A condition that is merely *still true* does not
silence turn cues — `held` does that, derived from the position.

**Cancelling is the job.** `expo-speech`'s `speak` queues and its `stop`
"interrupts current speech and deletes all in queue" — verified against the
installed 57.0.2 typings, not the docs. Every utterance goes through one `say`
that stops first, so the newest sentence is the only live one. Muting, holding,
a route-version change and unmount each stop the engine.

**Language.** The spoken sentence is `instructionFor(maneuver, t)` — the *same*
template the panel renders, through the *same* catalogue. This was a real defect:
the panel passed `t` and the scheduler did not, so a driver with the app in Hindi
read "मुड़ें बाएँ" and heard "Turn left", and the distance preamble had no
translation path at all. Both now go through `t`. Instruction templates, distance
preambles and every state sentence exist in hi/gu/as/bn (DRAFT — **not** reviewed
by native speakers); other languages fall back to English visibly.

**Voice availability is not audibility.** `getAvailableVoicesAsync` returning a
non-empty list does not mean sound left the phone: media volume can be at zero,
output can be routed to a disconnected handsfree, and the engine can accept an
utterance and drop it. Nothing in the API reports any of that, so the UI offers
an audio **test** the driver performs by ear. "Speech API called" is never
recorded as "sound heard".

---

## 8. Arrival

`map/arrival.ts`. Arrival is the one navigation decision with a business action
behind it, so it is pure and separately tested. **Nothing there completes
anything** — it decides when the app may *say* "you have arrived" and *offer* the
completion action the trip lifecycle already owns. Arrival and successful
business completion stay different events.

Three conditions must hold together, for `ARRIVAL.fixes` (3) consecutive fixes:

| Condition | Threshold | Why |
| --- | --- | --- |
| near the point | `radiusM` 120 m | straight-line to the stop |
| at the end of the line | `remainingM` 150 m | route progress, not proximity |
| on the line | `maxCrossTrackM` 60 m | not the road past the depot |

Proximity alone completes a trip for a truck on the far side of a depot wall, or
on the flyover above the gate. Reported accuracy is **added** to the measured
distances — the opposite of `trackOffRoute`, deliberately: there the question is
"is there enough evidence the truck *left* the road", where generous accuracy
argues against acting; here it is "is there enough evidence it has *finished*",
and a 150 m accuracy circle is not evidence of standing at a gate. Cross-track is
not slackened at all, or a wide circle would let the parallel-road case through
on exactly the fixes that cannot distinguish it.

Arrival does not unlatch: a truck rolling ten metres to the loading bay has not
un-arrived, and a retracted announcement is worse than either answer. It resets
on a new route or a new leg. The final stop announces arrival; an intermediate
one announces a stop reached.

---

## 9. Replay Fixtures

`driver-app/src/map/replay.fixtures.json`, generated by
`driver-app/scripts/make_replay_fixtures.py` and regenerated byte-identically
(checked). `replay.test.ts` drives the whole pure pipeline — windowed match →
off-route → arrival → maneuver selection → scheduler — fix by fix.

**Synthetic on purpose.** No driver's recorded journey is in the repository. The
corridor is a shape chosen to contain what real corridors contain and synthetic
ones usually do not: 3 km out, 150 m across, 3 km back (two near-parallel legs),
a genuine doubling back, two turns 150 m apart, and a 500 m tail to the depot.

**Deterministic on purpose.** Every offset is written out; there is no RNG.

| Scenario | What it pins |
| --- | --- |
| `normal_drive` | progress never goes backwards or jumps; maneuvers in order; one cue per stage; the 150 m pair combined; arrival once, at the end |
| `flyover_ambiguity` | the return leg is *nearer* and must be refused; no kilometre jump; a 100 m error is not off-route |
| `first_fix_ambiguity` | the stated first-fix limitation, pinned rather than hidden |
| `missed_turn` | one bad fix is not believed; cues stop when off-route; "off the planned route" once; never "arrived" |
| `stationary_jitter` | a parked truck with a 22 m circle triggers no reroute, no arrival, no repeated cue |
| `gps_loss_recovery` | no travelled distance and no cues during the gap; "GPS signal lost" once; progress resumes forward, not from the stale position; stale fixes never arrive |

These are deterministic fixture tests. They prove nothing about audio on a
device and nothing about background operation.
