import { describe, expect, it } from 'vitest'

import { LOCALE_STATUS, PHRASES, tx } from './tx'

describe('tx', () => {
  it('translates a known phrase and falls back to the English it was given', () => {
    expect(tx('hi', 'No active trip')).toBe('कोई सक्रिय ट्रिप नहीं')
    expect(tx('as', 'Open map')).toBe('মানচিত্ৰ খোলক')
    expect(tx('gu', 'No active trip')).toBe('No active trip') // FALLBACK_ENGLISH, visibly
    expect(tx('en', 'anything')).toBe('anything')
    expect(tx('hi', 'never translated')).toBe('never translated')
  })
  it('never ships an empty translation and never claims a native review', () => {
    for (const [en, phrase] of Object.entries(PHRASES)) {
      for (const v of Object.values(phrase)) expect(v, en).toMatch(/\S/)
    }
    expect(LOCALE_STATUS.en).toBe('VERIFIED')
    expect(Object.values(LOCALE_STATUS).filter((s) => s === 'VERIFIED')).toHaveLength(1)
  })
})
