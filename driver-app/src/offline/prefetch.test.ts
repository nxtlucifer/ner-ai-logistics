/**
 * Preparing the trip kit before the signal dies.
 *
 * The cases worth reading are the ones a fixed threshold gets wrong: a truck
 * fast enough that 9 km is not enough warning, a truck slow enough that it is
 * far too much, a one-bar connection that turns a small download into a long
 * one, and the same check running several times a minute without downloading
 * the same kit over and over.
 */

import { describe, expect, it } from 'vitest'

import type { OfflineDataset } from '../api/client'
import {
  MAX_LEAD_M,
  MIN_LEAD_M,
  TYPICAL_KIT_BYTES,
  leadDistance,
  prefetchDecision,
  prefetchKey,
  readDataset,
  readiness,
  type Gap,
  type PrefetchInputs,
} from './prefetch'

const HOUR = 3_600_000

function lead(overrides: Partial<Parameters<typeof leadDistance>[0]> = {}) {
  return leadDistance({
    speedKmph: 60,
    packageBytes: TYPICAL_KIT_BYTES,
    hereState: 'GOOD',
    outageKm: 10,
    ...overrides,
  })
}

function decision(overrides: Partial<PrefetchInputs> = {}) {
  return prefetchDecision({
    tripId: 'trip-1',
    routeId: 'route-1',
    packageHash: 'hash-1',
    packageAgeMs: 60_000,
    packageValidForMs: 6 * HOUR,
    travelledM: 10_000,
    nextGap: { startM: 14_000, endM: 24_000, state: 'DEAD_ZONE' },
    leadM: 5_000,
    online: true,
    prepared: [],
    ...overrides,
  })
}

const gap: Gap = { startM: 14_000, endM: 24_000, state: 'DEAD_ZONE' }

describe('leadDistance', () => {
  // A kit of a couple of hundred kilobytes downloads in tens of seconds, so
  // for an ordinary trip the segment floor is the answer and SHOULD be: the
  // gap's start is only known to the nearest 5 km bucket. These cases use a
  // large kit and a fast truck, where the computed term takes over.
  const binding = { packageBytes: 8_000_000, hereState: 'WEAK' } as const

  it('gives a faster truck more road to prepare in', () => {
    const slow = lead({ ...binding, speedKmph: 40 })
    const fast = lead({ ...binding, speedKmph: 70 })
    expect(fast.leadM).toBeGreaterThan(slow.leadM)
  })

  it('gives a weak connection more road than a good one', () => {
    const good = lead({ ...binding, hereState: 'GOOD', speedKmph: 90 })
    const weak = lead({ ...binding, hereState: 'WEAK', speedKmph: 90 })
    expect(weak.leadM).toBeGreaterThan(good.leadM)
    expect(weak.seconds).toBeGreaterThan(good.seconds)
  })

  it('holds the floor at one connectivity segment for an ordinary kit', () => {
    // Not a rounding-up: below one segment the lead is finer than the
    // resolution the gap's position is known at.
    expect(lead({ speedKmph: 60, hereState: 'GOOD' }).leadM).toBe(MIN_LEAD_M)
  })

  it('plans for an unmeasured segment as if it were unstable, never as if good', () => {
    const unknown = lead({ hereState: 'UNKNOWN' })
    const good = lead({ hereState: 'GOOD' })
    expect(unknown.seconds).toBeGreaterThan(good.seconds)
    expect(unknown.seconds).toBe(lead({ hereState: 'UNSTABLE' }).seconds)
  })

  it('gives a bigger kit more road', () => {
    expect(lead({ packageBytes: 2_000_000 }).seconds).toBeGreaterThan(
      lead({ packageBytes: 50_000 }).seconds,
    )
  })

  it('adds margin for a longer blackout, but a bounded amount', () => {
    const short = lead({ outageKm: 1 })
    const long = lead({ outageKm: 40 })
    const absurd = lead({ outageKm: 4_000 })
    expect(long.seconds).toBeGreaterThan(short.seconds)
    // Capped: a 4,000 km outage is a bad estimate, not a reason to wait forever.
    expect(absurd.seconds - long.seconds).toBeLessThan(45)
  })

  it('still prepares a stationary truck', () => {
    expect(lead({ speedKmph: 0 }).leadM).toBe(MIN_LEAD_M)
    expect(lead({ speedKmph: null }).leadM).toBe(MIN_LEAD_M)
  })

  it('refuses a nonsense speed rather than trusting it', () => {
    expect(lead({ speedKmph: -30 }).leadM).toBe(MIN_LEAD_M)
    expect(lead({ speedKmph: Number.NaN }).leadM).toBe(MIN_LEAD_M)
  })

  it('never reaches absurdly far ahead', () => {
    const estimate = lead({ speedKmph: 200, hereState: 'WEAK', packageBytes: 50_000_000 })
    expect(estimate.leadM).toBe(MAX_LEAD_M)
    expect(estimate.clamped).toBe(true)
  })

  it('is not the hard-coded threshold the brief warns against', () => {
    // The same road, two trucks, one carrying a big kit on a bad link: a fixed
    // number cannot serve both, and these answers differ.
    const ordinary = lead({ speedKmph: 25, hereState: 'GOOD' })
    const demanding = lead({
      speedKmph: 75,
      hereState: 'WEAK',
      packageBytes: 8_000_000,
    })
    expect(demanding.leadM).toBeGreaterThan(ordinary.leadM)
    expect(demanding.leadM).not.toBe(9_000)
  })
})

describe('prefetchDecision', () => {
  it('prepares immediately when nothing is cached', () => {
    const result = decision({ packageHash: null, packageAgeMs: null })
    expect(result.prepare).toBe(true)
    expect(result.reason).toBe('NO_PACKAGE')
    expect(result.key).not.toBeNull()
  })

  it('refreshes a kit that has aged out while there is still signal', () => {
    const result = decision({ packageAgeMs: 7 * HOUR })
    expect(result.prepare).toBe(true)
    expect(result.reason).toBe('PACKAGE_STALE')
  })

  it('waits while the gap is further away than the lead distance', () => {
    const result = decision({ travelledM: 0, leadM: 5_000 })
    expect(result.prepare).toBe(false)
    expect(result.reason).toBe('GAP_TOO_FAR')
    expect(result.distanceToGapM).toBe(14_000)
  })

  it('prepares once the gap comes inside the lead distance', () => {
    const result = decision({ travelledM: 10_000, leadM: 5_000 })
    expect(result.prepare).toBe(true)
    expect(result.reason).toBe('GAP_AHEAD')
    expect(result.distanceToGapM).toBe(4_000)
  })

  it('does not prepare the same kit for the same gap twice', () => {
    const first = decision()
    expect(first.prepare).toBe(true)
    const second = decision({ prepared: [first.key!] })
    expect(second.prepare).toBe(false)
    expect(second.reason).toBe('ALREADY_PREPARED')
  })

  it('prepares again for the NEXT gap on the same route', () => {
    const first = decision()
    const later = decision({
      travelledM: 30_000,
      nextGap: { startM: 33_000, endM: 40_000, state: 'WEAK' },
      prepared: [first.key!],
    })
    expect(later.prepare).toBe(true)
    expect(later.key).not.toBe(first.key)
  })

  it('prepares again when the corridor itself changed', () => {
    const first = decision()
    const rerouted = decision({ packageHash: 'hash-2', prepared: [first.key!] })
    expect(rerouted.prepare).toBe(true)
  })

  it('does not claim it can prepare with no connection', () => {
    const result = decision({ online: false })
    expect(result.prepare).toBe(false)
    expect(result.reason).toBe('NO_LINK')
  })

  it('says nothing to do when the road ahead is measured and good', () => {
    const result = decision({ nextGap: null })
    expect(result.prepare).toBe(false)
    expect(result.reason).toBe('NO_GAP_AHEAD')
  })

  it('treats an unmeasured stretch as worth preparing for', () => {
    const result = decision({
      nextGap: { startM: 12_000, endM: 20_000, state: 'UNKNOWN' },
    })
    expect(result.prepare).toBe(true)
    expect(result.reason).toBe('GAP_AHEAD')
  })

  it('does nothing without a trip or a route', () => {
    expect(decision({ tripId: null }).prepare).toBe(false)
    expect(decision({ routeId: null }).prepare).toBe(false)
  })

  it('keys on trip, route, package and segment', () => {
    expect(prefetchKey('t', 'r', 'h', 14_000)).toBe('t:r:h:14000')
    expect(prefetchKey('t', 'r', null, null)).toBe('t:r:none:kit')
  })
})

describe('readDataset', () => {
  const dataset = (overrides: Partial<OfflineDataset> = {}): OfflineDataset => ({
    name: 'weather',
    state: 'AVAILABLE',
    captured_at: new Date(0).toISOString(),
    valid_for_seconds: 3_600,
    source: 'Open-Meteo',
    detail: null,
    ...overrides,
  })

  it('ages a block on the device clock', () => {
    const reading = readDataset(dataset(), 30 * 60_000)
    expect(reading.state).toBe('AVAILABLE')
    expect(reading.ageMs).toBe(30 * 60_000)
  })

  it('turns available into stale as the phone sits in a valley', () => {
    const reading = readDataset(dataset(), 4 * HOUR)
    expect(reading.state).toBe('STALE')
    // Still carried, with its age, so the driver can weigh it.
    expect(reading.ageMs).toBe(4 * HOUR)
  })

  it('never turns unavailable into anything else', () => {
    const reading = readDataset(
      dataset({ state: 'NOT_AVAILABLE', captured_at: null, detail: 'no answer' }),
      4 * HOUR,
    )
    expect(reading.state).toBe('NOT_AVAILABLE')
    expect(reading.detail).toBe('no answer')
  })

  it('leaves a bundled block alone - it does not age', () => {
    const reading = readDataset(
      dataset({ name: 'emergency_contacts', state: 'BUNDLED_IN_APP', captured_at: null, valid_for_seconds: null }),
      400 * HOUR,
    )
    expect(reading.state).toBe('BUNDLED_IN_APP')
    expect(reading.ageMs).toBeNull()
  })

  it('refuses to call a block current when it cannot be aged', () => {
    const reading = readDataset(dataset({ captured_at: 'not a date' }), HOUR)
    expect(reading.state).toBe('NOT_AVAILABLE')
  })

  it('clamps a phone clock that is behind the server', () => {
    const reading = readDataset(dataset({ captured_at: new Date(HOUR).toISOString() }), 0)
    expect(reading.ageMs).toBe(0)
    expect(reading.state).toBe('AVAILABLE')
  })
})

describe('readiness', () => {
  const rows: OfflineDataset[] = [
    {
      name: 'route',
      state: 'AVAILABLE',
      captured_at: new Date(0).toISOString(),
      valid_for_seconds: 7 * 24 * 3600,
      source: 'routing',
      detail: null,
    },
    {
      name: 'weather',
      state: 'AVAILABLE',
      captured_at: new Date(0).toISOString(),
      valid_for_seconds: 3_600,
      source: 'Open-Meteo',
      detail: null,
    },
    {
      name: 'connectivity',
      state: 'NOT_AVAILABLE',
      captured_at: null,
      valid_for_seconds: 86_400,
      source: 'fleet',
      detail: 'Signal is UNKNOWN, which is not coverage.',
    },
  ]

  it('names what has gone stale and what was never there', () => {
    const result = readiness(rows, 4 * HOUR)
    expect(result.stale).toEqual(['weather'])
    expect(result.unavailable).toEqual(['connectivity'])
    expect(result.complete).toBe(false)
  })

  it('is complete only when every block is present and current', () => {
    const result = readiness(rows.slice(0, 2), 10 * 60_000)
    expect(result.complete).toBe(true)
  })

  it('does not call an old package with no manifest ready', () => {
    expect(readiness(undefined, 0).complete).toBe(false)
    expect(readiness([], 0).complete).toBe(false)
  })
})
