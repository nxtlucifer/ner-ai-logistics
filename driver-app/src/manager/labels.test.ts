import { describe, expect, it } from 'vitest'

import { codeWords, providerHealthy, providerName, providerState } from './labels'

describe('manager shell labels', () => {
  it('says a code in words, and prefers a translation (AUD-11)', () => {
    const en = (s: string) => s
    expect(codeWords(en, 'ON_TRIP')).toBe('On trip')
    expect(codeWords(en, 'AVAILABLE')).toBe('Available')
    expect(codeWords((s) => (s === 'AVAILABLE' ? 'उपलब्ध' : s), 'AVAILABLE')).toBe('उपलब्ध')
  })

  it('counts a provider as healthy only when it is, as the web Diagnostics does (AUD-08)', () => {
    expect(providerHealthy({ state: 'HEALTHY', freshness: 'FRESH' })).toBe(true)
    expect(providerHealthy({ state: 'STATIC', freshness: 'FRESH' })).toBe(true)
    expect(providerHealthy({ state: 'HEALTHY', freshness: 'STALE' })).toBe(false)
    for (const state of ['DEGRADED', 'UNKNOWN', 'NOT_CONFIGURED', 'FAILED', 'RATE_LIMITED']) {
      expect(providerHealthy({ state, freshness: 'FRESH' }), state).toBe(false)
    }
  })
})

describe('provider words (RC-DRV-10)', () => {
  const t = (en: string) => en
  it('names providers as people know them, never by their server id', () => {
    expect(providerName('OPEN_METEO_ELEVATION')).toBe('Open-Meteo elevation')
    expect(providerName('GOOGLE_GEMINI')).toBe('Google Gemini')
    expect(providerName('SOME_NEW_FEED')).toBe('Some new feed')
  })
  it('says a state once when the freshness is the same word', () => {
    expect(providerState(t, { state: 'UNKNOWN', freshness: 'UNKNOWN' })).toBe('Unknown')
    expect(providerState(t, { state: 'HEALTHY', freshness: 'FRESH' })).toBe('Healthy · Fresh')
  })
})
