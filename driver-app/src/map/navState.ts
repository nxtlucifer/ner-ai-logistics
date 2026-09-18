/**
 * Where the truck is on the road, and what the navigation screen is doing.
 *
 * Pure arithmetic and pure reducers, no React and no API - the same reason
 * `maneuvers.ts` is separate from the hooks that feed it. Three things live
 * here:
 *
 *   `projectOntoRoute`  the local fix projected onto the planned line: the
 *                        same algorithm as `app/domain/route_progress.py`
 *                        (planar-degrees choice of segment, haversine
 *                        distances), so the phone's number between trip polls
 *                        agrees with the server's number at each poll.
 *   `trackOffRoute`     off-route with hysteresis and a fix count. One fix
 *                        2.4 km off the road moved the countdown 50 km in the
 *                        browser capture; three in a row is a truck that has
 *                        left the corridor, one is a hillside.
 *   `navState`          the seven states the screen can be in, in the order
 *                        they win.
 */

import { distanceMetres, type LatLon } from './geo'

export type NavState =
  | 'IDLE'
  | 'OVERVIEW'
  | 'FOLLOWING'
  | 'OFF_ROUTE'
  | 'REROUTING'
  | 'GPS_STALE'
  | 'OFFLINE'

/** Same figure as the server's OFF_ROUTE_THRESHOLD_M, on purpose. */
export const OFF_ROUTE_ENTER_M = 200
/** Rejoin only when clearly back on the line, so a truck skirting the threshold does not flap. */
export const OFF_ROUTE_EXIT_M = 80
/** Consecutive fixes past the threshold before it is believed. */
export const OFF_ROUTE_FIXES = 3
/** No second reroute request for the same episode unless this long has passed AND the truck moved. */
export const REROUTE_MIN_INTERVAL_MS = 120_000
export const REROUTE_MIN_MOVE_M = 500

export interface Projection {
  /** Distance along the polyline to the nearest point, metres. */
  alongM: number
  /** Polyline length, metres. Scale by the provider's distance the way the server does. */
  totalM: number
  /** Distance from the fix to the nearest point on the line, metres. */
  crossTrackM: number
}

export function projectOntoRoute(points: readonly LatLon[], fix: LatLon): Projection | null {
  if (points.length < 2) return null
  let totalM = 0
  let bestGap = Infinity
  let bestAlong = 0
  for (let i = 1; i < points.length; i += 1) {
    const [aLat, aLon] = points[i - 1]
    const [bLat, bLon] = points[i]
    // Planar in degrees for the CHOICE of segment, haversine for the distance -
    // the server's trade-off, kept so the two agree; see route_progress.py.
    const dLat = bLat - aLat
    const dLon = bLon - aLon
    const len2 = dLat * dLat + dLon * dLon
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((fix[0] - aLat) * dLat + (fix[1] - aLon) * dLon) / len2))
    const near: LatLon = [aLat + t * dLat, aLon + t * dLon]
    const gap = distanceMetres(fix, near)
    const segM = distanceMetres(points[i - 1], points[i])
    if (gap < bestGap) {
      bestGap = gap
      bestAlong = totalM + t * segM
    }
    totalM += segM
  }
  if (totalM <= 0) return null
  return { alongM: Math.max(0, Math.min(totalM, bestAlong)), totalM, crossTrackM: bestGap }
}

/**
 * How far back and ahead of the last known along-distance a fix may be matched.
 *
 * WHY A WINDOW AT ALL
 *
 * `projectOntoRoute` takes the nearest point ANYWHERE on the line, which is the
 * server's algorithm and right for the server: it gets one fix at a time with no
 * memory of the last one. On the phone, matching without memory is wrong in a
 * way that only shows up on real roads:
 *
 *   A corridor that doubles back - a valley road in and out, a bypass parallel
 *   to the road it bypasses, a flyover over the street beneath it - has two
 *   stretches of line within a few hundred metres of each other. A fix on the
 *   outbound leg is sometimes marginally nearer the return leg, and the global
 *   match then reports the truck kilometres further along than it is. Distance
 *   to the next turn jumps, maneuvers are skipped, and the panel announces a
 *   turn that was passed an hour ago with complete confidence.
 *
 * The phone has the memory the server does not: where this truck was a few
 * seconds ago. Constraining the search to a window around that makes progress
 * continuous, which is the property the guidance needs.
 *
 * BACK IS SMALL AND AHEAD IS LARGE because that is how trucks move. The window
 * still allows reversing out of a yard, and allows a poll or two to be missed at
 * highway speed (3 km is 100 s at 110 km/h).
 */
export const PROJECTION_BACK_M = 300
export const PROJECTION_AHEAD_M = 3_000

/**
 * How far off the windowed corridor a fix must be before the window is
 * abandoned and the whole line searched again.
 *
 * The window is a memory, and a stale memory has to be droppable. A phone that
 * was backgrounded for twenty minutes, or an app resumed after the truck was
 * driven 30 km, would otherwise be pinned to where it last looked. Set at the
 * off-route threshold: past that distance the screen is already treating the
 * truck as off the corridor, so re-acquiring costs nothing that was being
 * trusted anyway - while a truck on a parallel carriageway 150 m away stays
 * inside it and keeps its continuous progress.
 */
export const PROJECTION_REACQUIRE_M = OFF_ROUTE_ENTER_M

/**
 * How much a candidate is penalised for being far from where the truck was.
 *
 * WHY A WINDOW ALONE IS NOT ENOUGH, measured on the replay corridor.
 *
 * The window bounds the search; inside it, taking the nearest line is still the
 * global mistake in miniature. On a corridor whose outbound and return legs run
 * 150 m apart for three kilometres, the return leg's matching point is only
 * ~2.9 km ahead - inside a 3 km look-ahead - so a fix pushed 100 m off the
 * outbound leg is 50 m from the return leg and wins on distance alone. Progress
 * jumped 2,913 m between two fixes of a truck that had driven 167.
 *
 * So candidates are scored, not just filtered:
 *
 *     cost = crossTrackM + DRIFT_WEIGHT * |alongM - previousAlongM|
 *
 * At 0.05 a candidate pays 1 m of cost for every 20 m it asks the truck to have
 * jumped. Cross-track evidence is therefore worth twenty times along-distance
 * plausibility - enough that an ordinary 167 m advance pays 8 m and is unaffected,
 * while a 2.9 km leap pays 146 m and loses to a 100 m cross-track it would
 * otherwise have beaten. A genuine 3 km advance after missed polls still wins,
 * because its own cross-track is metres rather than hundreds.
 *
 * This is a plausibility weight, not a physical model. It does not know the
 * truck's speed and does not pretend to; `PROJECTION_REACQUIRE_M` is what
 * handles the case where the memory has simply become wrong.
 */
export const PROJECTION_DRIFT_WEIGHT = 0.05

/**
 * The fix projected onto the line NEAR where the truck already was.
 *
 * `previousAlongM` null - a first fix, a new route, a resumed session - searches
 * the whole line, so this is exactly `projectOntoRoute` with no memory to use.
 *
 * `projectOntoRoute` is deliberately left alone rather than changed: it is the
 * port of `app/domain/route_progress.py` and its agreement with the server is
 * the point of it. This is the client's own continuity layer on top.
 */
export function projectOntoRouteNear(
  points: readonly LatLon[],
  fix: LatLon,
  previousAlongM: number | null,
): Projection | null {
  const global = projectOntoRoute(points, fix)
  if (global === null || previousAlongM === null) return global

  const from = previousAlongM - PROJECTION_BACK_M
  const to = previousAlongM + PROJECTION_AHEAD_M

  let totalM = 0
  let bestCost = Infinity
  let bestGap = Infinity
  let bestAlong = 0
  for (let i = 1; i < points.length; i += 1) {
    const [aLat, aLon] = points[i - 1]
    const [bLat, bLon] = points[i]
    const segM = distanceMetres(points[i - 1], points[i])
    const segStart = totalM
    const segEnd = totalM + segM
    totalM = segEnd
    // Only segments overlapping the window are candidates. The accumulation
    // above still walks the WHOLE line, because `totalM` is the route length
    // and scaling the provider's distance by it must not change with the window.
    if (segEnd < from || segStart > to) continue
    const dLat = bLat - aLat
    const dLon = bLon - aLon
    const len2 = dLat * dLat + dLon * dLon
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((fix[0] - aLat) * dLat + (fix[1] - aLon) * dLon) / len2))
    const near: LatLon = [aLat + t * dLat, aLon + t * dLon]
    const gap = distanceMetres(fix, near)
    const along = segStart + t * segM
    const cost = gap + PROJECTION_DRIFT_WEIGHT * Math.abs(along - previousAlongM)
    if (cost < bestCost) {
      bestCost = cost
      bestGap = gap
      bestAlong = along
    }
  }

  // Nothing in the window, or the truck is nowhere near it any more: the memory
  // is stale, so drop it rather than report a position from it. The test is the
  // chosen candidate's real CROSS-TRACK, not its cost - the drift penalty exists
  // to break ties between legs, and must not by itself trigger re-acquisition.
  if (!Number.isFinite(bestGap) || bestGap > PROJECTION_REACQUIRE_M) return global

  return {
    alongM: Math.max(0, Math.min(global.totalM, bestAlong)),
    totalM: global.totalM,
    crossTrackM: bestGap,
  }
}

export interface OffRouteTrack {
  off: boolean
  /** Consecutive fixes past the threshold while still counted as on-route. */
  streak: number
}

export const ON_ROUTE: OffRouteTrack = { off: false, streak: 0 }

/**
 * One fix in; the belief out. A fix whose accuracy circle reaches the line is
 * not evidence of anything, so the reported accuracy is subtracted first.
 */
export function trackOffRoute(prev: OffRouteTrack, crossTrackM: number, accuracyM: number | null): OffRouteTrack {
  const clear = Math.max(0, crossTrackM - (accuracyM ?? 0))
  if (prev.off) return clear <= OFF_ROUTE_EXIT_M ? ON_ROUTE : prev
  if (clear <= OFF_ROUTE_ENTER_M) return prev.streak === 0 ? prev : ON_ROUTE
  const streak = prev.streak + 1
  return { off: streak >= OFF_ROUTE_FIXES, streak }
}

export interface RerouteMark {
  at: number
  position: LatLon
}

/** Whether to ask the server for a road from here. One request per episode, not one per fix. */
export function shouldRequestReroute(
  input: { off: boolean; pending: boolean; online: boolean; last: RerouteMark | null; position: LatLon; now: number },
): boolean {
  if (!input.off || input.pending || !input.online) return false
  if (input.last === null) return true
  return (
    input.now - input.last.at >= REROUTE_MIN_INTERVAL_MS &&
    distanceMetres(input.last.position, input.position) >= REROUTE_MIN_MOVE_M
  )
}

export interface NavInputs {
  hasRoute: boolean
  /** Position subscription running with permission. */
  tracking: boolean
  /** Age of the newest local fix, ms; null when there is none. */
  fixAgeMs: number | null
  freshMs: number
  offRoute: boolean
  /** A road from here has been requested or proposed and the truck is still off the planned one. */
  rerouting: boolean
  /** The trip poll is failing; guidance runs from the saved package. */
  offline: boolean
  follow: boolean
}

export function navState(i: NavInputs): NavState {
  if (!i.hasRoute || !i.tracking) return 'IDLE'
  if (i.fixAgeMs === null || i.fixAgeMs > i.freshMs) return 'GPS_STALE'
  if (i.offRoute) return i.rerouting ? 'REROUTING' : 'OFF_ROUTE'
  if (i.offline) return 'OFFLINE'
  return i.follow ? 'FOLLOWING' : 'OVERVIEW'
}
