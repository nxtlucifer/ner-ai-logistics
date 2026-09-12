import { describe, expect, it } from 'vitest'

import { assess } from '../../../supabase/functions/_shared/routeProgress'
import type { LatLon } from './geo'
import {
  navState,
  ON_ROUTE,
  OFF_ROUTE_FIXES,
  projectOntoRoute,
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
