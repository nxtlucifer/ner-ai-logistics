/**
 * Break guidance invariants.
 *
 * The clock is injected, so the whole range is testable without waiting four
 * hours. The cases that matter are the ones where a naive implementation
 * would UNDERSTATE the elapsed span - a break record from a previous trip, or
 * a clock that has jumped - because understating it is what tells a tired
 * driver they are fine.
 */

import { describe, expect, it } from 'vitest'

import {
  DUE_SOON_MINUTES,
  OVERDUE_MINUTES,
  RECOMMENDED_MINUTES,
  REASON_NOT_STARTED,
  REASON_SINCE_BREAK,
  REASON_SINCE_START,
  assessBreak,
  formatElapsed,
} from './breaks'

const START = Date.parse('2026-09-05T06:00:00Z')
const at = (minutes: number) => START + minutes * 60_000
const iso = (t: number) => new Date(t).toISOString()

describe('break guidance', () => {
  it('says nothing measurable before the trip has started', () => {
    // Null, not zero. Zero would render as "you just had a break".
    const advice = assessBreak({
      startedAt: null,
      lastBreakAt: null,
      now: at(600),
    })
    expect(advice.level).toBe('NONE')
    expect(advice.elapsedMinutes).toBeNull()
    expect(advice.minutesUntilRecommended).toBeNull()
    expect(advice.reasonCode).toBe(REASON_NOT_STARTED)
  })

  it('escalates through the thresholds in order', () => {
    const level = (m: number) =>
      assessBreak({ startedAt: iso(START), lastBreakAt: null, now: at(m) }).level

    expect(level(0)).toBe('NONE')
    expect(level(DUE_SOON_MINUTES - 1)).toBe('NONE')
    expect(level(DUE_SOON_MINUTES)).toBe('DUE_SOON')
    expect(level(RECOMMENDED_MINUTES - 1)).toBe('DUE_SOON')
    expect(level(RECOMMENDED_MINUTES)).toBe('RECOMMENDED')
    expect(level(OVERDUE_MINUTES - 1)).toBe('RECOMMENDED')
    expect(level(OVERDUE_MINUTES)).toBe('OVERDUE')
    expect(level(OVERDUE_MINUTES + 600)).toBe('OVERDUE')
  })

  it('measures from the last break once one is recorded', () => {
    const advice = assessBreak({
      startedAt: iso(START),
      lastBreakAt: iso(at(240)),
      now: at(300),
    })
    expect(advice.elapsedMinutes).toBe(60)
    expect(advice.level).toBe('NONE')
    expect(advice.sinceBreak).toBe(true)
    expect(advice.reasonCode).toBe(REASON_SINCE_BREAK)
  })

  it('ignores a break recorded before this trip began', () => {
    // A break from yesterday's trip says nothing about today's. Falling back
    // to the trip start can only LENGTHEN the elapsed span, which is the safe
    // direction: understating it is what tells a tired driver they are fine.
    const advice = assessBreak({
      startedAt: iso(START),
      lastBreakAt: iso(START - 60 * 60_000),
      now: at(RECOMMENDED_MINUTES),
    })
    expect(advice.sinceBreak).toBe(false)
    expect(advice.reasonCode).toBe(REASON_SINCE_START)
    expect(advice.elapsedMinutes).toBe(RECOMMENDED_MINUTES)
    expect(advice.level).toBe('RECOMMENDED')
  })

  it('ignores a break timestamped in the future', () => {
    // A clock that has jumped forward would otherwise reset the counter and
    // silently hide an overdue break.
    const advice = assessBreak({
      startedAt: iso(START),
      lastBreakAt: iso(at(999)),
      now: at(OVERDUE_MINUTES),
    })
    expect(advice.sinceBreak).toBe(false)
    expect(advice.level).toBe('OVERDUE')
  })

  it('never reports negative elapsed time', () => {
    // `now` before the recorded start is a clock problem, not a negative span.
    const advice = assessBreak({
      startedAt: iso(START),
      lastBreakAt: null,
      now: START - 5 * 60_000,
    })
    expect(advice.elapsedMinutes).toBe(0)
    expect(advice.level).toBe('NONE')
  })

  it('counts down to the recommendation, then stops counting', () => {
    const before = assessBreak({
      startedAt: iso(START),
      lastBreakAt: null,
      now: at(RECOMMENDED_MINUTES - 30),
    })
    expect(before.minutesUntilRecommended).toBe(30)

    const after = assessBreak({
      startedAt: iso(START),
      lastBreakAt: null,
      now: at(RECOMMENDED_MINUTES + 30),
    })
    expect(after.minutesUntilRecommended).toBeNull()
  })

  it('survives an unparseable timestamp instead of throwing', () => {
    // A malformed value from storage or a rolled-back API must not crash the
    // safety screen.
    const advice = assessBreak({
      startedAt: 'not-a-date',
      lastBreakAt: 'also-not-a-date',
      now: at(300),
    })
    expect(advice.level).toBe('NONE')
    expect(advice.reasonCode).toBe(REASON_NOT_STARTED)
  })

  it('emits reason codes, never sentences', () => {
    // Same convention as the backend's risk reasons: a sentence built here
    // arrives in English no matter who is holding the phone.
    const advice = assessBreak({
      startedAt: iso(START),
      lastBreakAt: null,
      now: at(300),
    })
    expect(advice.reasonCode).toMatch(/^[A-Z_]+$/)
  })

  it('writes an elapsed span the way a tired person reads it', () => {
    // "247 min" is a number a driver has to convert while deciding whether to
    // stop. The project makes the same argument about distance.
    expect(formatElapsed(0)).toBe('0m')
    expect(formatElapsed(45)).toBe('45m')
    expect(formatElapsed(60)).toBe('1h 00m')
    expect(formatElapsed(247)).toBe('4h 07m')
    expect(formatElapsed(300)).toBe('5h 00m')
    expect(formatElapsed(null)).toBe('not known')
    expect(formatElapsed(Number.NaN)).toBe('not known')
    expect(formatElapsed(-5)).toBe('0m')
  })
})
