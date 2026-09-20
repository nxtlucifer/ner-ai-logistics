/**
 * The ways an app completes a delivery that has not happened.
 *
 * Every case is a real geometry: a truck on the road past a depot, a flyover
 * over the gate, a wide fix in an urban canyon, a stale position left on screen
 * while the phone had no signal.
 */

import { describe, expect, it } from 'vitest'

import { ARRIVAL, NOT_ARRIVED, qualifies, trackArrival, type ArrivalFix } from './arrival'
import type { LatLon } from './geo'

/** The destination, and a point a given distance north of it. */
const DEST: LatLon = [26.1445, 91.7362]
/** ~111,320 m per degree of latitude, so this is metres north, near enough. */
const north = (metres: number): LatLon => [DEST[0] + metres / 111_320, DEST[1]]

function fix(over: Partial<ArrivalFix> = {}): ArrivalFix {
  return {
    position: north(20),
    destination: DEST,
    remainingM: 40,
    crossTrackM: 10,
    accuracyM: 8,
    fresh: true,
    ...over,
  }
}

/** Feed the same fix n times and return the belief. */
function drive(f: ArrivalFix, times: number) {
  let track = NOT_ARRIVED
  for (let i = 0; i < times; i += 1) track = trackArrival(track, f)
  return track
}

describe('qualifies', () => {
  it('accepts a fix at the gate, on the line, at the end of the route', () => {
    expect(qualifies(fix())).toBe(true)
  })

  it('refuses a stale fix however well placed', () => {
    // The whole point: a position from four minutes ago cannot prove a truck is
    // standing anywhere now.
    expect(qualifies(fix({ fresh: false }))).toBe(false)
  })

  it('refuses a truck on a parallel road beside the depot', () => {
    // Inside the radius, at the end of the line by distance - and 90 m off the
    // corridor, which is the other carriageway or the service road.
    expect(qualifies(fix({ crossTrackM: 90 }))).toBe(false)
  })

  it('refuses a truck passing the destination with route still to run', () => {
    // The one-way system case: 30 m from the gate and 1.8 km of route left.
    expect(qualifies(fix({ remainingM: 1_800 }))).toBe(false)
  })

  it('refuses a truck that is simply not there yet', () => {
    expect(qualifies(fix({ position: north(400), remainingM: 400 }))).toBe(false)
  })

  it('counts a wide accuracy circle AGAINST arrival, not for it', () => {
    // 20 m from the gate with 150 m of uncertainty is not evidence of standing
    // at the gate. This is deliberately the opposite of the off-route rule.
    expect(qualifies(fix({ accuracyM: 150 }))).toBe(false)
  })

  it('does not slacken the cross-track test with accuracy', () => {
    // Exactly at the cross-track limit plus a metre; a generous accuracy must
    // not be what lets the parallel-road case through.
    expect(qualifies(fix({ crossTrackM: ARRIVAL.maxCrossTrackM + 1, accuracyM: 0 }))).toBe(false)
  })

  it('treats unknown progress or unknown cross-track as not arrived', () => {
    expect(qualifies(fix({ remainingM: null }))).toBe(false)
    expect(qualifies(fix({ crossTrackM: null }))).toBe(false)
  })
})

describe('trackArrival', () => {
  it('needs several consecutive fixes, not one', () => {
    expect(drive(fix(), 1).arrived).toBe(false)
    expect(drive(fix(), ARRIVAL.fixes - 1).arrived).toBe(false)
    expect(drive(fix(), ARRIVAL.fixes).arrived).toBe(true)
  })

  it('resets the streak when a fix stops qualifying', () => {
    let track = trackArrival(NOT_ARRIVED, fix())
    track = trackArrival(track, fix())
    expect(track.streak).toBe(2)
    // One bad fix - a jump onto the parallel road - and the count starts again.
    track = trackArrival(track, fix({ crossTrackM: 300 }))
    expect(track).toEqual(NOT_ARRIVED)
    track = trackArrival(track, fix())
    expect(track.streak).toBe(1)
  })

  it('does not un-arrive when the truck rolls to the loading bay', () => {
    const arrived = drive(fix(), ARRIVAL.fixes)
    expect(arrived.arrived).toBe(true)
    // Ten metres forward, now 30 m off the stored line. Still arrived: an
    // announcement that retracted itself is worse than either answer.
    expect(trackArrival(arrived, fix({ crossTrackM: 300, remainingM: 900 }))).toBe(arrived)
  })

  it('never arrives from a run of stale fixes, however long', () => {
    // A phone with no signal keeps its last position. Replaying it must not
    // eventually satisfy the fix count.
    expect(drive(fix({ fresh: false }), 50).arrived).toBe(false)
  })
})
