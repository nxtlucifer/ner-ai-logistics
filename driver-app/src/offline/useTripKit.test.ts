/**
 * Reading the corridor's connectivity segments the way the phone does.
 *
 * The rules worth pinning are the two that decide whether a driver arrives at
 * a dead zone prepared: which segment the truck is in now (which sets the
 * download speed to plan for), and which stretch ahead is the next one worth
 * preparing for. An unmeasured stretch counts as one, and that is the whole
 * point of the layer - assuming coverage where nobody has looked is the
 * failure it exists to end.
 */

import { describe, expect, it } from 'vitest'

import {
  nextGapAfter,
  shouldTriggerRefresh,
  stateAt,
  type ConnectivitySegmentView,
} from './useTripKit'

const SEGMENTS: ConnectivitySegmentView[] = [
  { start_m: 0, end_m: 5_000, state: 'GOOD' },
  { start_m: 5_000, end_m: 10_000, state: 'UNSTABLE' },
  { start_m: 10_000, end_m: 15_000, state: 'WEAK' },
  { start_m: 15_000, end_m: 20_000, state: 'DEAD_ZONE' },
  { start_m: 20_000, end_m: 25_000, state: 'UNKNOWN' },
]

describe('stateAt', () => {
  it('reads the segment the truck is inside', () => {
    expect(stateAt(SEGMENTS, 0)).toBe('GOOD')
    expect(stateAt(SEGMENTS, 4_999)).toBe('GOOD')
    expect(stateAt(SEGMENTS, 5_000)).toBe('UNSTABLE')
    expect(stateAt(SEGMENTS, 17_000)).toBe('DEAD_ZONE')
  })

  it('is UNKNOWN with no position, never GOOD', () => {
    expect(stateAt(SEGMENTS, null)).toBe('UNKNOWN')
  })

  it('is UNKNOWN past the end of the measured road', () => {
    expect(stateAt(SEGMENTS, 99_000)).toBe('UNKNOWN')
  })

  it('is UNKNOWN when nothing has been measured at all', () => {
    expect(stateAt([], 1_000)).toBe('UNKNOWN')
  })
})

describe('nextGapAfter', () => {
  it('finds the first weak stretch ahead', () => {
    const gap = nextGapAfter(SEGMENTS, 2_000)
    expect(gap).toEqual({ startM: 10_000, endM: 15_000, state: 'WEAK' })
  })

  it('reports the stretch the truck is already inside', () => {
    const gap = nextGapAfter(SEGMENTS, 12_000)
    expect(gap?.state).toBe('WEAK')
    expect(gap?.startM).toBe(10_000)
  })

  it('moves on to the next one once the first is behind', () => {
    expect(nextGapAfter(SEGMENTS, 15_500)?.state).toBe('DEAD_ZONE')
    expect(nextGapAfter(SEGMENTS, 20_500)?.state).toBe('UNKNOWN')
  })

  it('treats an unmeasured stretch as worth preparing for', () => {
    const unmeasured: ConnectivitySegmentView[] = [
      { start_m: 0, end_m: 5_000, state: 'GOOD' },
      { start_m: 5_000, end_m: 10_000, state: 'UNKNOWN' },
    ]
    expect(nextGapAfter(unmeasured, 0)?.state).toBe('UNKNOWN')
  })

  it('never invents a gap on a road measured and found good', () => {
    const good: ConnectivitySegmentView[] = [
      { start_m: 0, end_m: 5_000, state: 'GOOD' },
      { start_m: 5_000, end_m: 10_000, state: 'UNSTABLE' },
    ]
    expect(nextGapAfter(good, 0)).toBeNull()
  })

  it('says nothing without a position', () => {
    expect(nextGapAfter(SEGMENTS, null)).toBeNull()
  })
})

describe('shouldTriggerRefresh', () => {
  it('acts on the anticipation this hook adds', () => {
    expect(shouldTriggerRefresh('GAP_AHEAD')).toBe(true)
    expect(shouldTriggerRefresh('PACKAGE_STALE')).toBe(true)
  })

  it('leaves first acquisition to the fetcher that owns it', () => {
    // useRouteGeometry already downloads on mount and already has a tested
    // retry delay. Two downloads racing on mount would be a regression.
    expect(shouldTriggerRefresh('NO_PACKAGE')).toBe(false)
  })

  it('does nothing for the states that are not a reason to download', () => {
    expect(shouldTriggerRefresh('GAP_TOO_FAR')).toBe(false)
    expect(shouldTriggerRefresh('NO_GAP_AHEAD')).toBe(false)
    expect(shouldTriggerRefresh('ALREADY_PREPARED')).toBe(false)
    expect(shouldTriggerRefresh('NO_LINK')).toBe(false)
  })
})
