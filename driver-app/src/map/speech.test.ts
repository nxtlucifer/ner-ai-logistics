/**
 * The ways voice guidance lies or nags.
 *
 * Every case here is a thing a driver would actually experience: the same turn
 * announced on every poll, a turn from the corridor they were moved off,
 * talking during a hold, or talking after mute.
 */

import { describe, expect, it } from 'vitest'

import type { NavigationManeuver } from '../api/client'
import { emptySpokenState, nextAnnouncement } from './speech'

function turn(distanceFromStart: number, name = 'NH27'): NavigationManeuver {
  return {
    type: 'turn',
    modifier: 'left',
    lat: 26.1,
    lon: 91.7,
    geometry_index: 0,
    distance_from_start_m: distanceFromStart,
    step_distance_m: 100,
    duration_s: null,
    name,
    exit: null,
  }
}

const R1 = 'route-1'

function speak(distanceM: number, state = emptySpokenState(), opts = {}) {
  return nextAnnouncement(
    {
      next: { maneuver: turn(5000), distanceM },
      routeId: R1,
      muted: false,
      held: false,
      ...opts,
    },
    state,
  )
}

describe('nextAnnouncement', () => {
  it('says nothing until the turn is inside the outermost band', () => {
    expect(speak(2500)).toBeNull()
  })

  it('announces once at 2 km and not again on the next poll', () => {
    const state = emptySpokenState()
    const first = speak(1900, state)
    expect(first?.text).toContain('2 kilometres')
    expect(first?.text).toContain('Turn left onto NH27')
    expect(speak(1800, state)).toBeNull()
    expect(speak(1200, state)).toBeNull()
  })

  it('announces each band once as the truck closes', () => {
    const state = emptySpokenState()
    expect(speak(1900, state)?.text).toContain('2 kilometres')
    expect(speak(480, state)?.text).toContain('500 metres')
    expect(speak(90, state)?.text).toBe('Turn left onto NH27')
    expect(speak(60, state)).toBeNull()
  })

  it('does not double-announce when a poll skips a band', () => {
    // 10-second cadence at highway speed crosses 2 km and 500 m in one step.
    const state = emptySpokenState()
    expect(speak(80, state)?.text).toBe('Turn left onto NH27')
    expect(speak(2000, state)).toBeNull()
    expect(speak(500, state)).toBeNull()
  })

  it('stays silent while guidance is held', () => {
    expect(speak(90, emptySpokenState(), { held: true })).toBeNull()
  })

  it('stays silent when muted', () => {
    expect(speak(90, emptySpokenState(), { muted: true })).toBeNull()
  })

  it('stays silent with no upcoming turn', () => {
    expect(
      nextAnnouncement(
        { next: null, routeId: R1, muted: false, held: false },
        emptySpokenState(),
      ),
    ).toBeNull()
  })

  it('forgets what it said when the route version changes', () => {
    const state = emptySpokenState()
    expect(speak(90, state)).not.toBeNull()
    expect(speak(90, state)).toBeNull()
    const afterReplan = nextAnnouncement(
      {
        next: { maneuver: turn(5000), distanceM: 90 },
        routeId: 'route-2',
        muted: false,
        held: false,
      },
      state,
    )
    expect(afterReplan).not.toBeNull()
    expect(state.routeId).toBe('route-2')
  })

  it('treats a different turn on the same route as a new announcement', () => {
    const state = emptySpokenState()
    expect(speak(90, state)).not.toBeNull()
    const other = nextAnnouncement(
      {
        next: { maneuver: turn(9000, 'NH37'), distanceM: 90 },
        routeId: R1,
        muted: false,
        held: false,
      },
      state,
    )
    expect(other?.text).toBe('Turn left onto NH37')
  })

  it('says nothing with no route version, however close the turn', () => {
    expect(speak(50, emptySpokenState(), { routeId: null })).toBeNull()
  })
})
