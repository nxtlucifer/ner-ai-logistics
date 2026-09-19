/**
 * A push notification is the one thing a driver reads with the app closed.
 *
 * THE DEFECT THIS CATCHES
 *
 * `TripProvider` raises two notifications — a new trip, and an approved
 * reroute — from an effect. Every label around them goes through `useT`, but
 * an effect has no hook to call, so both were English literals. A driver who
 * had chosen Assamese, and whose entire app was in Assamese, was woken at
 * 3am by "Reroute approved. Your manager approved a new road."
 *
 * It is the worst place for the language setting to quietly stop working,
 * and nothing failed: the notification fired, delivered, and read perfectly
 * well — in the wrong language.
 */

import { describe, expect, it } from 'vitest'

import { PHRASES, tx } from '../i18n/tx'

const NOTIFICATION_STRINGS = [
  'New trip assigned',
  'open RASTA to accept.',
  'Reroute approved',
  'Your manager approved a new road. Open Navigate to follow it.',
]

describe('background notification strings', () => {
  it('are in the phrasebook, not only in the component', () => {
    for (const en of NOTIFICATION_STRINGS) {
      expect(PHRASES[en], `"${en}" has no entry in phrases.ts`).toBeDefined()
    }
  })

  it('actually differ from English in every drafted language', () => {
    for (const en of NOTIFICATION_STRINGS) {
      for (const lang of ['hi', 'gu', 'as', 'bn'] as const) {
        const out = tx(lang, en)
        expect(out, `${lang}: "${en}" fell back to English`).not.toBe(en)
        expect(out.length, `${lang}: "${en}" is empty`).toBeGreaterThan(0)
      }
    }
  })

  it('still returns the English source for a language with no draft', () => {
    // Explicit fallback, never a blank and never a key. A Santali driver
    // reads English here, which is honest; a blank notification is not.
    expect(tx('sat', 'Reroute approved')).toBe('Reroute approved')
    expect(tx('en', 'Reroute approved')).toBe('Reroute approved')
  })
})
