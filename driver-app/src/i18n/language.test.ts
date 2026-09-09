/**
 * Picking a language without asking the driver first.
 *
 * The tests that matter are the fallbacks: a phone set to a language this
 * build does not have must still show a usable screen, and a missing `Intl`
 * must not be the reason a driver cannot see their trip.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { deviceLanguage, matchLanguage, resolveLanguage } from './language'

describe('matchLanguage', () => {
  it('accepts the languages this build has', () => {
    expect(matchLanguage('en')).toBe('en')
    expect(matchLanguage('hi')).toBe('hi')
    expect(matchLanguage('as')).toBe('as')
  })

  it('ignores region and script subtags', () => {
    // hi-IN, hi-Latn and hi are all Hindi as far as this catalogue is
    // concerned. Pretending to distinguish regional variants would imply
    // translations that do not exist.
    expect(matchLanguage('hi-IN')).toBe('hi')
    expect(matchLanguage('as-IN')).toBe('as')
    expect(matchLanguage('en_GB')).toBe('en')
    expect(matchLanguage('hi-Latn-IN')).toBe('hi')
  })

  it('is case-insensitive', () => {
    expect(matchLanguage('HI-in')).toBe('hi')
  })

  it('falls back to English for a language this build does not have', () => {
    // Not because English is preferred - because there is no Bengali here yet.
    // The moment one is added to the catalogue this returns it.
    expect(matchLanguage('bn-IN')).toBe('en')
    expect(matchLanguage('ta')).toBe('en')
  })

  it('falls back for junk rather than throwing', () => {
    for (const input of ['', '   ', '-', '💥', null, undefined]) {
      expect(matchLanguage(input)).toBe('en')
    }
  })
})

describe('deviceLanguage', () => {
  const realIntl = globalThis.Intl

  afterEach(() => {
    globalThis.Intl = realIntl
    vi.restoreAllMocks()
  })

  it('reads the device locale', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ locale: 'as-IN' }),
    } as unknown as Intl.DateTimeFormat)

    expect(deviceLanguage()).toBe('as')
  })

  it('falls back when Intl is absent rather than crashing the app', () => {
    // A missing internationalisation API must not be the reason a driver
    // cannot see their trip.
    // @ts-expect-error deliberately removing a global to model a JS engine
    // built without Intl.
    globalThis.Intl = undefined

    expect(deviceLanguage()).toBe('en')
  })

  it('falls back when Intl throws', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('no ICU data')
    })

    expect(deviceLanguage()).toBe('en')
  })
})

describe('resolveLanguage', () => {
  it('honours an explicit choice over the device', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ locale: 'en-GB' }),
    } as unknown as Intl.DateTimeFormat)

    // A driver who picked Assamese meant it, whatever the handset is set to.
    expect(resolveLanguage('as')).toBe('as')
    vi.restoreAllMocks()
  })

  it('uses the device when nothing has been chosen', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ locale: 'hi-IN' }),
    } as unknown as Intl.DateTimeFormat)

    expect(resolveLanguage(null)).toBe('hi')
    expect(resolveLanguage(undefined)).toBe('hi')
    expect(resolveLanguage('')).toBe('hi')
    vi.restoreAllMocks()
  })
})
