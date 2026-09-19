import { describe, expect, it } from 'vitest'

import { assess } from '../../../supabase/functions/_shared/routeProgress'
import type { LatLon } from './geo'
import {
  navState,
  ON_ROUTE,
  OFF_ROUTE_FIXES,
  projectOntoRoute,
  projectOntoRouteNear,
  PROJECTION_AHEAD_M,
  PROJECTION_REACQUIRE_M,
  REROUTE_MIN_INTERVAL_MS,
  shouldRequestReroute,
  trackOffRoute,
  type OffRouteTrack,
} from './navState'

// Guwahati -> Shillong, coarsely. North-south, so "east of the line" is easy to write.
const ROUTE: LatLon[] = [
  [26.1445, 91.7362],
  [26.0, 91.8],
  [25.8, 91.85],
  [25.5788, 91.8933],
]
const onLine = (t: number): LatLon => [26.0 + (25.8 - 26.0) * t, 91.8 + (91.85 - 91.8) * t]
const eastOf = (p: LatLon, deg: number): LatLon => [p[0], p[1] + deg]

const run = (fixes: { cross: number; acc?: number | null }[]) =>
  fixes.reduce<OffRouteTrack>((s, f) => trackOffRoute(s, f.cross, f.acc ?? null), ON_ROUTE)

describe('projectOntoRoute', () => {
  it('agrees with the server port on cross-track and fraction', () => {
    const fix = eastOf(onLine(0.4), 0.01)
    const ours = projectOntoRoute(ROUTE, fix)!
    const theirs = assess({ geometry: ROUTE, position: fix })
    expect(ours.crossTrackM).toBeCloseTo(theirs.off_route_m!, 6)
    expect(ours.alongM / ours.totalM).toBeCloseTo(theirs.fraction_complete!, 9)
  })

  it('backtracking moves along-route backwards but stays on the line', () => {
    const ahead = projectOntoRoute(ROUTE, onLine(0.6))!
    const behind = projectOntoRoute(ROUTE, onLine(0.3))!
    expect(behind.alongM).toBeLessThan(ahead.alongM)
    expect(behind.crossTrackM).toBeLessThan(1)
  })

  it('needs two points', () => {
    expect(projectOntoRoute([ROUTE[0]], ROUTE[0])).toBeNull()
  })
})

/**
 * A corridor that comes back alongside itself, which is what breaks a
 * nearest-point matcher: out 3 km east, 150 m north, then 3 km back west.
 * Metres are converted once, here, and the numbers below are in metres along.
 */
const M_LAT = 111_320
const M_LON = 111_320 * Math.cos((26.14 * Math.PI) / 180)
const pt = (east: number, north: number): LatLon => [26.14 + north / M_LAT, 91.7 + east / M_LON]
const DOUBLE_BACK: LatLon[] = [
  ...Array.from({ length: 31 }, (_, i) => pt(i * 100, 0)),        // 0 .. 3000
  pt(3000, 150),                                                  // 3150
  ...Array.from({ length: 31 }, (_, i) => pt(3000 - i * 100, 150)), // 3150 .. 6150
]

describe('projectOntoRouteNear', () => {
  it('is exactly the global projection when there is no memory to use', () => {
    const fix = pt(1200, 20)
    expect(projectOntoRouteNear(DOUBLE_BACK, fix, null)).toEqual(projectOntoRoute(DOUBLE_BACK, fix))
  })

  it('refuses the return leg for a fix that is nearer it but behind it', () => {
    // 100 m north of the outbound leg at 1200 m, so 50 m from the return leg.
    // The global matcher takes the return leg and reports ~4.9 km; with the
    // truck's last position known, that is a 3.7 km jump in one poll.
    const fix = pt(1200, 100)
    expect(projectOntoRoute(DOUBLE_BACK, fix)!.alongM).toBeGreaterThan(4_000)
    expect(projectOntoRouteNear(DOUBLE_BACK, fix, 1_050)!.alongM).toBeCloseTo(1_200, -2)
  })

  it('keeps the full route length whatever the window does', () => {
    // `totalM` scales the provider's distance; a window that shortened it would
    // silently rescale every distance on screen.
    const whole = projectOntoRoute(DOUBLE_BACK, pt(0, 0))!.totalM
    expect(projectOntoRouteNear(DOUBLE_BACK, pt(1200, 100), 1_050)!.totalM).toBeCloseTo(whole, 6)
  })

  it('reports the real cross-track, not the scored cost', () => {
    // The drift penalty is for choosing between candidates. Leaking it into
    // `crossTrackM` would make off-route detection fire on a truck on its road.
    const near = projectOntoRouteNear(DOUBLE_BACK, pt(1200, 100), 1_050)!
    expect(near.crossTrackM).toBeCloseTo(100, -1)
    expect(near.crossTrackM).toBeLessThan(PROJECTION_REACQUIRE_M)
  })

  it('drops a stale memory rather than reporting a position from it', () => {
    // The app was backgrounded and the truck drove well past the window. Pinning
    // it to where it last looked would be worse than re-acquiring. Tested on the
    // long non-doubling corridor, where "past the window" really is far from
    // everything in it.
    const far = onLine(0.8)
    const reacquired = projectOntoRouteNear(ROUTE, far, 100)
    expect(reacquired).toEqual(projectOntoRoute(ROUTE, far))
    expect(reacquired!.alongM).toBeGreaterThan(PROJECTION_AHEAD_M)
  })

  it('prefers continuity over believing a 150 m sideways jump', () => {
    // A STATED TRADE-OFF, not an oversight. Re-acquisition triggers at 200 m and
    // these two legs are 150 m apart, so a truck that genuinely appeared on the
    // return leg keeps being matched to the outbound one. That is the right way
    // round: a 150 m lateral jump between two polls is a bad fix far more often
    // than it is a truck, and the cost of believing it - progress leaping 4 km,
    // maneuvers skipped, a turn announced for a road not reached - is much worse
    // than the cost of a few stale seconds. A truck that has really moved there
    // keeps moving, and leaves the window along the return leg within a poll or
    // two. Raising `PROJECTION_REACQUIRE_M` above the separation of two
    // carriageways would trade this for exactly the jump the window exists for.
    const onReturn = pt(1_000, 150)
    expect(projectOntoRouteNear(DOUBLE_BACK, onReturn, 100)!.alongM).toBeLessThan(1_200)
  })

  it('still needs two points', () => {
    expect(projectOntoRouteNear([DOUBLE_BACK[0]], DOUBLE_BACK[0], 0)).toBeNull()
  })
})

describe('trackOffRoute', () => {
  it('ignores jitter: two bounces off the line and back are on-route', () => {
    expect(run([{ cross: 900 }, { cross: 900 }, { cross: 10 }, { cross: 900 }]).off).toBe(false)
  })

  it('believes N consecutive fixes', () => {
    const fixes = Array.from({ length: OFF_ROUTE_FIXES }, () => ({ cross: 400 }))
    expect(run(fixes).off).toBe(true)
    expect(run(fixes.slice(1)).off).toBe(false)
  })

  it('a single teleported fix is not a departure', () => {
    expect(run([{ cross: 5 }, { cross: 50_000 }, { cross: 5 }]).off).toBe(false)
  })

  it('discounts the accuracy circle', () => {
    expect(run([{ cross: 300, acc: 150 }, { cross: 300, acc: 150 }, { cross: 300, acc: 150 }]).off).toBe(false)
    expect(run([{ cross: 300, acc: 20 }, { cross: 300, acc: 20 }, { cross: 300, acc: 20 }]).off).toBe(true)
  })

  it('rejoins with hysteresis: 150 m is still off, 50 m is back', () => {
    const off = run([{ cross: 400 }, { cross: 400 }, { cross: 400 }])
    expect(trackOffRoute(off, 150, null).off).toBe(true)
    expect(trackOffRoute(off, 50, null)).toEqual(ON_ROUTE)
  })
})

describe('shouldRequestReroute', () => {
  const here: LatLon = [25.9, 92.0]
  const base = { off: true, pending: false, online: true, last: null, position: here, now: 1_000_000 }

  it('asks once per episode and not again while pending or offline', () => {
    expect(shouldRequestReroute(base)).toBe(true)
    expect(shouldRequestReroute({ ...base, pending: true })).toBe(false)
    expect(shouldRequestReroute({ ...base, online: false })).toBe(false)
    expect(shouldRequestReroute({ ...base, off: false })).toBe(false)
  })

  it('suppresses duplicates until time has passed AND the truck has moved', () => {
    const last = { at: base.now - 1_000, position: here }
    expect(shouldRequestReroute({ ...base, last })).toBe(false)
    const later = base.now + REROUTE_MIN_INTERVAL_MS
    expect(shouldRequestReroute({ ...base, last, now: later })).toBe(false) // same place
    expect(shouldRequestReroute({ ...base, last, now: later, position: [25.91, 92.0] })).toBe(true)
  })
})

describe('navState', () => {
  const live = { hasRoute: true, tracking: true, fixAgeMs: 2_000, freshMs: 60_000, offRoute: false, rerouting: false, offline: false, follow: true }

  it('orders the states by what the driver must know first', () => {
    expect(navState(live)).toBe('FOLLOWING')
    expect(navState({ ...live, follow: false })).toBe('OVERVIEW')
    expect(navState({ ...live, offline: true })).toBe('OFFLINE')
    expect(navState({ ...live, offRoute: true })).toBe('OFF_ROUTE')
    expect(navState({ ...live, offRoute: true, rerouting: true })).toBe('REROUTING')
    expect(navState({ ...live, offRoute: true, offline: true })).toBe('OFF_ROUTE')
    expect(navState({ ...live, fixAgeMs: 61_000, offRoute: true })).toBe('GPS_STALE')
    expect(navState({ ...live, fixAgeMs: null })).toBe('GPS_STALE')
    expect(navState({ ...live, tracking: false })).toBe('IDLE')
    expect(navState({ ...live, hasRoute: false })).toBe('IDLE')
  })
})
