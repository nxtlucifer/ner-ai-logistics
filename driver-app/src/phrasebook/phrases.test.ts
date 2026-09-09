/**
 * Phrasebook invariants.
 *
 * A phrasebook fails silently. A phrase missing in Bengali still renders -
 * in English - and the driver holds the phone out to someone who cannot read
 * it, at night, beside a broken truck. Nothing on screen says anything went
 * wrong. That is what these assertions are for.
 */

import { describe, expect, it } from 'vitest'

import catalogue from './phrases.json'
import { LANGUAGES, phrasebook, phraseIds, type PhraseLanguage } from './phrases'

const CODES = LANGUAGES.map((l) => l.code)

describe('phrasebook', () => {
  it('ships every phrase in every language it offers', () => {
    // The failure this catches is a phrase added in English and forgotten in
    // the other three, which the fallback would hide completely.
    for (const category of catalogue.categories) {
      for (const code of CODES) {
        expect((category as Record<string, unknown>)[code], `${category.id}/${code}`)
          .toBeTruthy()
        for (const phrase of category.phrases) {
          const text = (phrase as Record<string, unknown>)[code]
          expect(text, `${phrase.id}/${code} missing`).toBeTruthy()
          expect(String(text).trim(), `${phrase.id}/${code} blank`).not.toBe('')
        }
      }
    }
  })

  it('actually differs between languages rather than falling back', () => {
    // Completeness alone would pass if every 'as' string were a copy of the
    // English. Checked on the whole book at once: identical halves for a
    // different language pair means the catalogue is not really translated.
    for (const code of CODES.filter((c) => c !== 'en')) {
      const english = phrasebook('en', 'en').flatMap((c) => c.phrases.map((p) => p.mine))
      const other = phrasebook(code, code).flatMap((c) => c.phrases.map((p) => p.mine))
      const identical = english.filter((text, i) => text === other[i])
      expect(identical, `${code} repeats the English text`).toHaveLength(0)
    }
  })

  it('pairs the same phrase on both sides', () => {
    // The load-bearing property of the whole screen: the driver's half and
    // the listener's half must be the SAME sentence. If these ever came from
    // different indexes the driver would hand over a phrase they did not mean.
    const hi = phrasebook('en', 'hi')
    const en = phrasebook('en', 'en')
    for (const [c, category] of hi.entries()) {
      for (const [p, phrase] of category.phrases.entries()) {
        expect(phrase.id).toBe(en[c].phrases[p].id)
        expect(phrase.mine).toBe(en[c].phrases[p].mine)
      }
    }
  })

  it('carries the phrases a broken-down driver actually needs', () => {
    // Named explicitly so a future tidy-up cannot quietly drop them: these
    // are the ones the mission called out as the point of the feature.
    const ids = phraseIds()
    for (const required of [
      'NEED_MECHANIC',
      'NEAREST_HOSPITAL',
      'CALL_POLICE',
      'TRUCK_BROKEN',
      'ROAD_BLOCKED',
      'ROAD_SAFE_TRUCK',
      'DRINKING_WATER',
      'SAFE_PARKING',
    ]) {
      expect(ids, `phrasebook lost ${required}`).toContain(required)
    }
  })

  it('has unique phrase ids', () => {
    const ids = phraseIds()
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('falls back to English for a language it does not have', () => {
    const rogue = 'ta' as PhraseLanguage
    const [first] = phrasebook(rogue, rogue)
    expect(first.phrases[0].mine).toBe(phrasebook('en', 'en')[0].phrases[0].mine)
  })

  it('names each language in its own script', () => {
    // A picker that lists "Assamese" in English is a picker for people who
    // already read English. Same rule as LANGUAGE_NAMES in reasonCodes.
    expect(LANGUAGES.find((l) => l.code === 'as')?.name).toBe('অসমীয়া')
    expect(LANGUAGES.find((l) => l.code === 'bn')?.name).toBe('বাংলা')
    expect(LANGUAGES.find((l) => l.code === 'hi')?.name).toBe('हिन्दी')
  })
})
