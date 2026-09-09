/**
 * The four ways a track lies about where a truck went.
 *
 * Case 2 is the one that produced the reported defect: TRP-DEMO1560's fixes 11
 * and 12 are 98.8 km apart and 21.5 seconds apart, which drew a straight line
 * down the Guwahati-Nagaon corridor. The numbers in that test are the measured
 * ones, not invented.
 */

import { describe, expect, it } from 'vitest'

import type { Position } from '../api/client'
import {
  drawableSegments,
  isolatedFixes,
  splitTrack,
  TRACK_GAP_SECONDS,
} from './track'

const T0 = Date.parse('2026-09-06T10:00:00.000Z')

function fix(secondsFromT0: number, lat: number, lon: number): Position {
  const at = new Date(T0 + secondsFromT0 * 1000).toISOString()
  return {
    location: { lat, lon },
    recorded_at: at,
    received_at: at,
    age_seconds: 0,
    freshness: 'LIVE',
    speed_kmph: null,
    heading_deg: null,
    accuracy_m: null,
    is_mock_location: false,
  }
}

// Guwahati, and a point ~1 km along. Ten seconds apart is the moving cadence.
const GUWAHATI: [number, number] = [26.1445, 91.7362]
const NAGAON: [number, number] = [26.3464, 92.6840]

describe('splitTrack', () => {
  it('keeps a normally sampled run in one segment', () => {
    const segments = splitTrack([
      fix(0, 26.1445, 91.7362),
      fix(10, 26.1455, 91.7372),
      fix(20, 26.1465, 91.7382),
    ])
    expect(segments).toHaveLength(1)
    expect(segments[0].points).toHaveLength(3)
    expect(segments[0].brokenBy).toBeNull()
  })

  it('breaks the measured Guwahati-Nagaon simulator jump', () => {
    // 98.8 km in 21.5 s is 16,545 km/h. It is not a road.
    const segments = splitTrack([
      fix(0, ...GUWAHATI),
      fix(10, 26.1455, 91.7372),
      fix(31.5, ...NAGAON),
      fix(41.5, 26.3474, 92.685),
    ])
    expect(segments).toHaveLength(2)
    expect(segments[1].brokenBy).toBe('IMPLAUSIBLE_SPEED')
    expect(segments[0].points).toHaveLength(2)
    expect(segments[1].points).toHaveLength(2)
  })

  it('breaks a two-fix long gap even when the movement is plausible', () => {
    // 1 km apart, so ~0.5 km/h over the gap - entirely believable, and still
    // not evidence of the road taken across eleven minutes of silence.
    const segments = splitTrack([
      fix(0, 26.1445, 91.7362),
      fix(TRACK_GAP_SECONDS + 60, 26.1535, 91.7362),
    ])
    expect(segments).toHaveLength(2)
    expect(segments[1].brokenBy).toBe('TIME_GAP')
    expect(drawableSegments(segments)).toHaveLength(0)
    expect(isolatedFixes(segments)).toHaveLength(2)
  })

  it('breaks a simulator restart that rewinds the clock', () => {
    // Run 1 gets 50 km along. The simulator restarts: the clock rewinds and
    // the truck reappears at the start. Ordered by device clock the two runs
    // interleave, and every crossing between them is a jump no truck made.
    const segments = splitTrack([
      fix(0, 26.1445, 91.7362),
      fix(600, 26.55, 91.75),
      fix(1200, 26.95, 91.77),
      // Restart, clock back near zero, truck back at the depot.
      fix(1, 26.1445, 91.7362),
      fix(601, 26.55, 91.75),
    ])
    expect(segments.length).toBeGreaterThan(1)
    expect(segments.some((s) => s.brokenBy === 'IMPLAUSIBLE_SPEED')).toBe(true)
    const total = segments.reduce((n, s) => n + s.points.length, 0)
    expect(total).toBe(5)
  })

  it('breaks a duplicate timestamp rather than guessing an order', () => {
    const segments = splitTrack([
      fix(0, 26.1445, 91.7362),
      fix(0, 26.1446, 91.7363),
    ])
    expect(segments).toHaveLength(2)
    expect(segments[1].brokenBy).toBe('OUT_OF_ORDER')
  })

  it('sorts an out-of-order upload into travel order', () => {
    const segments = splitTrack([
      fix(20, 26.1465, 91.7382),
      fix(0, 26.1445, 91.7362),
      fix(10, 26.1455, 91.7372),
    ])
    expect(segments).toHaveLength(1)
    expect(segments[0].points.map((p) => p.location.lat)).toEqual([
      26.1445, 26.1455, 26.1465,
    ])
  })

  it('loses no observation and mutates no input', () => {
    const input = [fix(0, ...GUWAHATI), fix(31.5, ...NAGAON), fix(41.5, 26.35, 92.69)]
    const copy = [...input]
    const segments = splitTrack(input)
    expect(segments.reduce((n, s) => n + s.points.length, 0)).toBe(3)
    expect(input).toEqual(copy)
  })

  it('returns nothing for an empty track', () => {
    expect(splitTrack([])).toEqual([])
  })
})
