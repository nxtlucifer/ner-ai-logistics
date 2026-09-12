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
