/**
 * The whole navigation pipeline, driven fix by fix over recorded scenarios.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE UNIT TESTS
 *
 * `navState.test.ts`, `speech.test.ts`, `arrival.test.ts` and
 * `maneuvers.test.ts` each hold one module still and push inputs at it. Every
 * failure this file is about is a failure of the modules TOGETHER over time:
 * progress that jumps between two polls, a cue for a turn already passed, a
 * reroute triggered by a parked truck's receiver, arrival announced twice. None
 * of them is visible one call at a time.
 *
 * WHAT IT IS NOT. It is not a device test and proves nothing about audio: the
 * scheduler's OUTPUT is asserted, never that a phone made a sound. It contains
 * no real journey - see the fixture's own note.
 */

import { describe, expect, it } from 'vitest'

import fixtures from './replay.fixtures.json'
import type { NavigationManeuver } from '../api/client'
import { NOT_ARRIVED, trackArrival, type ArrivalTrack } from './arrival'
import type { LatLon } from './geo'
import { upcomingManeuver } from './maneuvers'
import {
  ON_ROUTE,
  OFF_ROUTE_FIXES,
  projectOntoRouteNear,
  trackOffRoute,
  type OffRouteTrack,
  type Projection,
} from './navState'
import { emptySpokenState, nextAnnouncement, type Announcement } from './speech'

interface ReplayFix {
  lat: number
  lon: number
  at_ms: number
  accuracy_m: number
  speed_kmh: number
  fresh: boolean
}

const ROUTE = fixtures.route
const GEOMETRY = ROUTE.geometry as unknown as LatLon[]
const MANEUVERS = ROUTE.maneuvers as NavigationManeuver[]
const DESTINATION = ROUTE.destination as unknown as LatLon
const ROUTE_ID = ROUTE.route_id
const SCENARIOS = fixtures.scenarios as Record<
  string,
  { fixes: ReplayFix[]; true_along_m?: number[]; ambiguous_from?: number }
>

interface Step {
  fix: ReplayFix
  projection: Projection | null
  travelledM: number | null
  offRoute: OffRouteTrack
  arrival: ArrivalTrack
  next: { maneuver: NavigationManeuver; distanceM: number } | null
  said: Announcement | null
}

/**
 * Replay one scenario through the same sequence `MapScreen` runs per fix.
 *
 * The order is the screen's order and matters: project against the REMEMBERED
 * along-distance, decide off-route from the cross-track, decide arrival, pick
 * the maneuver, then ask the scheduler. Reordering any of it would test a
 * pipeline the app does not have.
 */
function replay(name: string): Step[] {
  const { fixes } = SCENARIOS[name]
  const spoken = emptySpokenState()
  let lastAlongM: number | null = null
  let offRoute = ON_ROUTE
  let arrival = NOT_ARRIVED
  const steps: Step[] = []

  for (const fix of fixes) {
    const position: LatLon = [fix.lat, fix.lon]
    const projection = projectOntoRouteNear(GEOMETRY, position, lastAlongM)
    // Only an on-corridor fix seeds the next window, exactly as the screen does.
    if (projection && projection.crossTrackM <= 200) lastAlongM = projection.alongM

    offRoute = projection
      ? trackOffRoute(offRoute, projection.crossTrackM, fix.accuracy_m)
      : offRoute

    const travelledM =
      fix.fresh && projection
        ? (projection.alongM / projection.totalM) * ROUTE.distance_m
        : null

    const remainingM = projection ? Math.max(0, projection.totalM - projection.alongM) : null
    arrival = trackArrival(arrival, {
      position,
      destination: DESTINATION,
      remainingM,
      crossTrackM: projection?.crossTrackM ?? null,
      accuracyM: fix.accuracy_m,
      fresh: fix.fresh,
    })

    // Guidance is held without a trustworthy position or once off the corridor -
    // the same two reasons `guidanceHold` gives.
    const held = !fix.fresh || offRoute.off
    const next = upcomingManeuver(MANEUVERS, held ? null : travelledM)
    const i = next ? MANEUVERS.indexOf(next.maneuver) : -1
    const then = i >= 0 ? MANEUVERS[i + 1] ?? null : null

    const said = nextAnnouncement(
      {
        next,
        then,
        routeId: ROUTE_ID,
        mode: 'GUIDANCE',
        held,
        event: arrival.arrived ? 'ARRIVED' : offRoute.off ? 'OFF_ROUTE' : !fix.fresh ? 'GPS_LOST' : null,
        speedMps: fix.speed_kmh / 3.6,
        now: fix.at_ms,
      },
      spoken,
    )

    steps.push({ fix, projection, travelledM, offRoute, arrival, next, said })
  }
  return steps
}

const spoken = (steps: Step[]) => steps.map((s) => s.said?.text).filter((x): x is string => !!x)

describe('normal drive', () => {
  const steps = replay('normal_drive')

  it('never moves backwards along the route', () => {
    // The single most damaging failure: progress that goes back a step makes the
    // countdown climb and re-arms every cue behind it.
    const along = steps.filter((s) => s.projection).map((s) => s.projection!.alongM)
    for (let i = 1; i < along.length; i += 1) {
      expect(along[i], `fix ${i} went backwards`).toBeGreaterThanOrEqual(along[i - 1] - 1e-6)
    }
  })

  it('advances in steps the size the truck actually drove', () => {
    // 60 km/h for 10 s is ~167 m. A jump of a kilometre means the matcher moved
    // to a different part of the line, not that the truck teleported.
    const along = steps.filter((s) => s.projection).map((s) => s.projection!.alongM)
    for (let i = 1; i < along.length; i += 1) {
      expect(along[i] - along[i - 1], `fix ${i} jumped`).toBeLessThan(400)
    }
  })

  it('stays on the corridor throughout', () => {
    expect(steps.every((s) => !s.offRoute.off)).toBe(true)
  })

  it('never announces a maneuver that has been passed', () => {
    for (const s of steps) {
      if (!s.next || s.travelledM === null) continue
      expect(s.next.maneuver.distance_from_start_m).toBeGreaterThan(s.travelledM)
    }
  })

  it('works through the maneuvers in order and ends on arrive', () => {
    const seen: string[] = []
    for (const s of steps) {
      const key = s.next ? `${s.next.maneuver.type}@${s.next.maneuver.distance_from_start_m}` : null
      if (key && seen[seen.length - 1] !== key) seen.push(key)
    }
    expect(seen).toEqual([
      'turn@3000',
      'turn@3150',
      'turn@6150',
      'arrive@6650',
    ])
  })

  it('announces each maneuver at most once per cue stage', () => {
    const counts = new Map<string, number>()
    for (const s of steps) {
      if (s.said?.reason !== 'TURN') continue
      counts.set(s.said.token, (counts.get(s.said.token) ?? 0) + 1)
    }
    expect([...counts.values()].filter((n) => n > 1)).toEqual([])
  })

  it('says the two turns 150 m apart as one sentence', () => {
    // Two left turns 150 m apart are the corner onto the bypass. "Turn left"
    // then "turn left" four seconds later arrives after the first is taken.
    const combined = spoken(steps).filter((line) => line.includes(', then '))
    expect(combined.length).toBeGreaterThan(0)
    expect(combined[0]).toContain('Turn left onto Bypass Connector')
    expect(combined[0]).toContain('Turn left onto Kamrup Bypass')
  })

  it('announces arrival exactly once, at the end and not before', () => {
    const arrivals = steps.filter((s) => s.said?.text.includes('arrived'))
    expect(arrivals).toHaveLength(1)
    // And only after the fix count was met, which is at the gate - not at the
    // moment the truck first came within a radius of it.
    expect(steps.indexOf(arrivals[0])).toBeGreaterThan(steps.length - 5)
  })

  it('does not claim arrival while route remains', () => {
    for (const s of steps) {
      if (!s.arrival.arrived) continue
      expect(s.projection!.totalM - s.projection!.alongM).toBeLessThan(200)
    }
  })
})

describe('flyover and parallel carriageway', () => {
  const steps = replay('flyover_ambiguity')
  const truth = SCENARIOS.flyover_ambiguity.true_along_m!

  it('keeps the truck on the leg it is actually on', () => {
    // The fixture is built so that, from the fifth fix on, the nearest point
    // ANYWHERE on the line is the return leg ~3 km further along. Windowed
    // matching must refuse it. The clean approach fixes before it are what give
    // the matcher the memory to refuse it WITH.
    steps.forEach((s, i) => {
      expect(s.projection, `fix ${i}`).not.toBeNull()
      expect(Math.abs(s.projection!.alongM - truth[i]), `fix ${i} matched the wrong leg`).toBeLessThan(150)
    })
  })

  it('matches globally on a first fix, with no memory to use', () => {
    // NOT a bug being papered over - a stated limit. Resuming navigation
    // mid-route on a doubling-back corridor has no previous position to window
    // against, and the nearest line wins. The recovery is the next few fixes:
    // once a direction of travel exists the window takes over. Guidance during
    // those first seconds is therefore no better than the global match.
    const [only] = replay('first_fix_ambiguity')
    const wrongLeg = Math.abs(only.projection!.alongM - SCENARIOS.first_fix_ambiguity.true_along_m![0])
    expect(wrongLeg).toBeGreaterThan(1_000)
  })

  it('does not report a kilometre jump between consecutive fixes', () => {
    for (let i = 1; i < steps.length; i += 1) {
      expect(
        Math.abs(steps[i].projection!.alongM - steps[i - 1].projection!.alongM),
        `fix ${i} jumped`,
      ).toBeLessThan(400)
    }
  })

  it('does not call a 100 m error off-route once accuracy is allowed for', () => {
    // 100 m out with a 25 m circle is inside the 200 m threshold. Rerouting
    // here would replan a truck that never left its road.
    expect(steps.every((s) => !s.offRoute.off)).toBe(true)
  })
})

describe('missed turn', () => {
  const steps = replay('missed_turn')

  it('does not believe one bad fix', () => {
    const firstOff = steps.findIndex((s) => s.offRoute.off)
    expect(firstOff).toBeGreaterThan(-1)
    const firstPast = steps.findIndex((s) => s.offRoute.streak > 0 || s.offRoute.off)
    expect(firstOff - firstPast).toBeGreaterThanOrEqual(OFF_ROUTE_FIXES - 1)
  })

  it('stops giving turn cues once it is confidently off the corridor', () => {
    const afterOff = steps.slice(steps.findIndex((s) => s.offRoute.off))
    expect(afterOff.every((s) => s.said?.reason !== 'TURN')).toBe(true)
    expect(afterOff.every((s) => s.next === null)).toBe(true)
  })

  it('says it is off the route, once, and never says arrived', () => {
    const lines = spoken(steps)
    expect(lines.filter((l) => l.includes('off the planned route'))).toHaveLength(1)
    expect(lines.some((l) => l.includes('arrived'))).toBe(false)
  })
})

describe('stationary jitter', () => {
  const steps = replay('stationary_jitter')

  it('never reads as off-route', () => {
    // A parked truck whose receiver wanders 13 m must not trigger a reroute.
    expect(steps.every((s) => !s.offRoute.off)).toBe(true)
  })

  it('never arrives 5 km from the destination', () => {
    expect(steps.every((s) => !s.arrival.arrived)).toBe(true)
  })

  it('does not re-announce the same turn as the receiver wanders', () => {
    const turns = steps.filter((s) => s.said?.reason === 'TURN')
    const tokens = new Set(turns.map((s) => s.said!.token))
    expect(turns.length).toBe(tokens.size)
  })

  it('keeps matched progress inside the wander, not the whole route', () => {
    const along = steps.map((s) => s.projection!.alongM)
    expect(Math.max(...along) - Math.min(...along)).toBeLessThan(60)
  })
})

describe('GPS loss and recovery', () => {
  const steps = replay('gps_loss_recovery')

  it('has no travelled distance while the fix is unusable', () => {
    for (const s of steps) {
      if (!s.fix.fresh) expect(s.travelledM).toBeNull()
    }
  })

  it('gives no turn cue during the gap and says the signal was lost, once', () => {
    const gap = steps.filter((s) => !s.fix.fresh)
    expect(gap.every((s) => s.said?.reason !== 'TURN')).toBe(true)
    expect(spoken(steps).filter((l) => l.includes('GPS signal lost'))).toHaveLength(1)
  })

  it('picks progress back up after re-acquisition without going backwards', () => {
    const after = steps.filter((s) => s.fix.fresh).slice(-2)
    expect(after[0].travelledM).not.toBeNull()
    expect(after[1].travelledM!).toBeGreaterThan(after[0].travelledM!)
    // ~2.1 km along, which is where the fixture puts it - not reset to zero and
    // not carried on from the stale position.
    expect(after[0].travelledM!).toBeGreaterThan(2_000)
    expect(after[0].travelledM!).toBeLessThan(2_200)
  })

  it('never announces arrival from a run of stale fixes', () => {
    expect(steps.every((s) => !s.arrival.arrived)).toBe(true)
  })
})
