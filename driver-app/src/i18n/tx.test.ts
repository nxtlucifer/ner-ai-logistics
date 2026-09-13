import { describe, expect, it } from 'vitest'

import { LOCALE_STATUS, PHRASES, tx } from './tx'

describe('tx', () => {
  it('translates a known phrase and falls back to the English it was given', () => {
    expect(tx('hi', 'No active trip')).toBe('कोई सक्रिय ट्रिप नहीं')
    expect(tx('as', 'Open map')).toBe('মানচিত্ৰ খোলক')
    expect(tx('gu', 'No active trip')).toBe('કોઈ સક્રિય ટ્રિપ નથી')
    expect(tx('bn', 'No active trip')).toBe('কোনো সক্রিয় ট্রিপ নেই')
    expect(tx('en', 'anything')).toBe('anything')
    expect(tx('hi', 'never translated')).toBe('never translated')
  })
  it('never ships an empty translation, covers all four languages, and never claims a native review', () => {
    for (const [en, phrase] of Object.entries(PHRASES)) {
      for (const lang of ['hi', 'gu', 'as', 'bn'] as const) expect(phrase[lang], `${en} [${lang}]`).toMatch(/\S/)
    }
    expect(LOCALE_STATUS.en).toBe('VERIFIED')
    expect(Object.values(LOCALE_STATUS).filter((s) => s === 'VERIFIED')).toHaveLength(1)
  })
})
