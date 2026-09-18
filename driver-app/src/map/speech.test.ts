/**
 * The ways voice guidance lies or nags.
 *
 * Every case here is a thing a driver would actually experience: the same turn
 * announced on every poll, a turn from the corridor they were moved off,
 * talking during a hold, or talking after mute.
 */

import { describe, expect, it } from 'vitest'

import type { NavigationManeuver } from '../api/client'
import { tx } from '../i18n/tx'
import {
  emptySpokenState,
  nextAnnouncement,
  repeatInstruction,
  stageTriggerM,
  type GuidanceEvent,
  type SpokenState,
} from './speech'

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

/**
 * The scheduler beyond a single turn cue: modes, state changes, combined
 * instructions, speed, language, and the explicit repeat.
 *
 * Every case is again a thing a driver would experience - audio in English on
 * a Gujarati phone, "turn right" and "keep left" arriving as two sentences on a
 * 60 m link, a flapping GPS fix narrating itself, or arrival announced twice.
 */
describe('voice modes', () => {
  it('says nothing at all when muted, including state changes', () => {
    const state = emptySpokenState()
    expect(
      nextAnnouncement(
        { next: { maneuver: turn(5000), distanceM: 90 }, routeId: R1, mode: 'MUTED', held: false, event: 'ARRIVED' },
        state,
      ),
    ).toBeNull()
  })

  it('gives state changes but not turn cues in alerts-only', () => {
    const state = emptySpokenState()
    const turnCue = nextAnnouncement(
      { next: { maneuver: turn(5000), distanceM: 90 }, routeId: R1, mode: 'ALERTS', held: false },
      state,
    )
    expect(turnCue).toBeNull()
    const event = nextAnnouncement(
      { next: null, routeId: R1, mode: 'ALERTS', held: false, event: 'REROUTING' },
      state,
    )
    expect(event?.text).toBe('Recalculating route.')
    expect(event?.reason).toBe('EVENT')
  })

  it('treats the old muted boolean as MUTED', () => {
    expect(speak(90, emptySpokenState(), { muted: true })).toBeNull()
  })
})

describe('state changes', () => {
  const evt = (event: GuidanceEvent, state: SpokenState, now = 0) =>
    nextAnnouncement({ next: null, routeId: R1, mode: 'GUIDANCE', held: true, event, now }, state)

  it('announces a condition once and stays quiet while it persists', () => {
    const state = emptySpokenState()
    expect(evt('REROUTING', state)?.text).toBe('Recalculating route.')
    expect(evt('REROUTING', state, 1_000)).toBeNull()
    expect(evt('REROUTING', state, 200_000)).toBeNull()
  })

  it('does not narrate a flapping GPS fix', () => {
    // At the edge of coverage the fix drops and returns repeatedly. The screen
    // must update every time; the voice must not.
    const state = emptySpokenState()
    expect(evt('GPS_LOST', state, 0)?.text).toContain('GPS signal lost')
    expect(evt('GPS_RECOVERED', state, 3_000)).toBeNull()
    expect(evt('GPS_LOST', state, 6_000)).toBeNull()
    // Once the cooldown has passed a genuine change is still reported.
    expect(evt('GPS_RECOVERED', state, 40_000)?.text).toContain('restored')
  })

  it('announces arrival exactly once, cooldown or not', () => {
    const state = emptySpokenState()
    expect(evt('ARRIVED', state, 0)?.text).toBe('You have arrived at your destination.')
    expect(evt('ARRIVED', state, 1_000)).toBeNull()
    expect(evt('ARRIVED', state, 10_000_000)).toBeNull()
  })

  it('reports a state change ahead of a turn cue that is about to be wrong', () => {
    const state = emptySpokenState()
    const out = nextAnnouncement(
      {
        next: { maneuver: turn(5000), distanceM: 90 },
        routeId: R1,
        mode: 'GUIDANCE',
        held: false,
        event: 'OFF_ROUTE',
      },
      state,
    )
    expect(out?.reason).toBe('EVENT')
    expect(out?.text).toBe('You are off the planned route.')
  })

  it('a condition that is merely still true does not silence the turns', () => {
    // The bug this guards: returning early for as long as a condition lasts.
    // REROUTING can hold for a minute, and the turns either side of it matter.
    const state = emptySpokenState()
    expect(evt('REROUTING', state, 0)).not.toBeNull()
    const cue = nextAnnouncement(
      {
        next: { maneuver: turn(5000), distanceM: 90 },
        routeId: R1,
        mode: 'GUIDANCE',
        held: false,
        event: 'REROUTING',
        now: 1_000,
      },
      state,
    )
    expect(cue?.reason).toBe('TURN')
  })
})

describe('closely spaced turns', () => {
  const right = (at: number): NavigationManeuver => ({ ...turn(at), modifier: 'right', name: null })
  const fork = (at: number): NavigationManeuver => ({ ...turn(at), type: 'fork', modifier: 'left', name: null })

  it('combines two maneuvers inside the combine window into one sentence', () => {
    const out = nextAnnouncement(
      { next: { maneuver: right(5000), distanceM: 90 }, then: fork(5080), routeId: R1, held: false },
      emptySpokenState(),
    )
    expect(out?.text).toBe('Turn right, then Keep left')
  })

  it('leaves two distant maneuvers as separate sentences', () => {
    const out = nextAnnouncement(
      { next: { maneuver: right(5000), distanceM: 90 }, then: fork(6000), routeId: R1, held: false },
      emptySpokenState(),
    )
    expect(out?.text).toBe('Turn right')
  })

  it('ignores a "then" that is not actually after the next maneuver', () => {
    const out = nextAnnouncement(
      { next: { maneuver: right(5000), distanceM: 90 }, then: fork(4900), routeId: R1, held: false },
      emptySpokenState(),
    )
    expect(out?.text).toBe('Turn right')
  })
})

describe('cue timing at speed', () => {
  it('widens the approach cue at highway speed and not in a jam', () => {
    // 100 km/h is 27.8 m/s; 25 s of lead is 695 m, past the fixed 500 m.
    expect(stageTriggerM('APPROACH', 27.8)).toBeCloseTo(695, 0)
    // Crawling: the fixed band is the right answer, not 40 m.
    expect(stageTriggerM('APPROACH', 1.5)).toBe(500)
    // No reported speed must never SHRINK a cue.
    expect(stageTriggerM('APPROACH', null)).toBe(500)
    expect(stageTriggerM('APPROACH', Number.NaN)).toBe(500)
  })

  it('reaches the approach stage sooner at speed', () => {
    // 600 m from the turn, both speeds are inside the 2 km advance band - so
    // the question is not whether anything is said but WHICH stage is reached.
    // Crawling, 600 m is still only the advance cue. At 100 km/h the same 600 m
    // is already the commitment point, and the driver is told the turn itself.
    const slow = speak(600, emptySpokenState(), { speedMps: 2 })
    expect(slow?.token.endsWith('ADVANCE')).toBe(true)
    expect(slow?.text).toContain('In 2 kilometres')

    const fast = speak(600, emptySpokenState(), { speedMps: 27.8 })
    expect(fast?.token.endsWith('APPROACH')).toBe(true)
    // The preamble quotes the widened stage distance, not the fixed 500 m.
    expect(fast?.text).toContain('In 700 metres')
  })

  it('quotes the stage distance, not the fix distance', () => {
    // "in 487 metres" is precision the fix does not have.
    expect(speak(487, emptySpokenState())?.text).toContain('In 500 metres')
  })
})

describe('language', () => {
  // The catalogue is real; a stub here would prove nothing about the app.
  const gu = (en: string) => tx('gu', en)

  it('speaks the same language the panel renders', () => {
    const out = speak(90, emptySpokenState(), { t: gu })
    expect(out?.text).toBe(`${tx('gu', 'Turn')} ${tx('gu', 'left')} ${tx('gu', 'onto')} NH27`)
    // The regression this pins: the sentence used to come out in English
    // because `instructionFor` was called without the translator.
    expect(out?.text).not.toContain('Turn')
  })

  it('translates the distance preamble and keeps the number where the language puts it', () => {
    const out = speak(480, emptySpokenState(), { t: gu })
    expect(out?.text).toContain(tx('gu', 'In %s metres').replace('%s', '500'))
    expect(out?.text).not.toContain('In 500 metres')
  })

  it('translates state changes too', () => {
    const out = nextAnnouncement(
      { next: null, routeId: R1, held: true, event: 'ARRIVED', t: gu },
      emptySpokenState(),
    )
    expect(out?.text).toBe(tx('gu', 'You have arrived at your destination.'))
  })

  it('keeps a road number as a road number', () => {
    // `toLowerCase()` here turns NH27 into a word the engine reads as "nh27".
    expect(speak(90, emptySpokenState())?.text).toContain('NH27')
  })
})

describe('repeatInstruction', () => {
  it('speaks on request even though the app is muted, and does not dedupe', () => {
    const next = { maneuver: turn(5000), distanceM: 90 }
    expect(repeatInstruction({ next, held: false })).toBe('Turn left onto NH27')
    // Twice in a row, because the driver asked twice.
    expect(repeatInstruction({ next, held: false })).toBe('Turn left onto NH27')
  })

  it('carries the real current distance, unlike a staged cue', () => {
    expect(repeatInstruction({ next: { maneuver: turn(5000), distanceM: 1_800 }, held: false })).toBe(
      'In 1.8 kilometres, Turn left onto NH27',
    )
  })

  it('has nothing to repeat while guidance is held or there is no turn', () => {
    expect(repeatInstruction({ next: { maneuver: turn(5000), distanceM: 90 }, held: true })).toBeNull()
    expect(repeatInstruction({ next: null, held: false })).toBeNull()
  })
})
