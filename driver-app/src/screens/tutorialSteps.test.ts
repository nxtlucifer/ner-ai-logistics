/**
 * A tutorial is a set of promises. These check they are promises the app
 * can keep, and that the words match the words on the real screens.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { TUTORIAL_STEPS } from './tutorialSteps'

const MISSION_TOPICS = [
  'accept',
  'truck',
  'navigate',
  'offline',
  'alert',
  'sos',
  'instruction',
  'delivery',
  'language',
  'privacy',
]

describe('tutorial content', () => {
  it('covers every topic the brief asks for', () => {
    expect(TUTORIAL_STEPS.map((s) => s.id).sort()).toEqual([...MISSION_TOPICS].sort())
  })

  it('has a unique id per step', () => {
    const ids = TUTORIAL_STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is readable on a phone: short titles, bounded bodies', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.title.length, step.id).toBeLessThanOrEqual(34)
      expect(step.body.length, step.id).toBeGreaterThan(40)
      // A wall of text on a 5-inch screen is a skipped tutorial.
      expect(step.body.length, step.id).toBeLessThanOrEqual(260)
    }
  })

  it('promises nothing about safety that the product does not claim', () => {
    // The deterministic policy decides passability, and UNKNOWN is never
    // SAFE. A tutorial is exactly where an over-promise would slip in.
    const forbidden = /\bsafe\b|\bguarantee|\balways works\b|\bnever fails\b|\bpredicts?\b/i
    for (const step of TUTORIAL_STEPS) {
      expect(forbidden.test(step.body), `${step.id}: ${step.body}`).toBe(false)
      expect(forbidden.test(step.title), step.id).toBe(false)
    }
  })

  it('names controls that actually exist in the app', () => {
    // The failure mode of a tutorial is describing a button that was
    // renamed. Each of these is asserted against the source that renders it.
    const src = (rel: string) =>
      readFileSync(join(__dirname, rel), 'utf8')
    const trip = src('TripScreen.tsx')
    const more = src('MoreScreen.tsx')

    expect(trip).toContain('Accept trip')
    expect(more).toContain('Language')
    // The stop request the sos step promises.
    expect(trip.toLowerCase()).toMatch(/request a stop|request stop/)
  })

  // The icon name is typed as Feather's own `IconName`, so an invented
  // glyph fails `tsc` rather than rendering an empty square on a phone.
  // That is a stronger check than anything assertable here.
})
