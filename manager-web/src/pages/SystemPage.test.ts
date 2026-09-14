import { describe, expect, it } from 'vitest'

import type { ProviderHealthRow } from '../api/client'
import { capabilityState } from './SystemPage'

function row(provider: string, state: ProviderHealthRow['state'], freshness: ProviderHealthRow['freshness'] = 'FRESH'): ProviderHealthRow {
  return {
    provider, product: provider, evidence_type: 'FORECAST', state, freshness,
    last_success_at: null, last_error_at: null, last_error: null, data_at: null, calls: 1, failures: 0, cadence_s: null, detail: {},
  }
}

describe('capabilityState — one throttled provider is not a broken system', () => {
  it('reports weather as available via fallback when Open-Meteo is rate limited and MET Norway is healthy', () => {
    const rows = [row('OPEN_METEO', 'RATE_LIMITED', 'UNKNOWN'), row('MET_NORWAY', 'HEALTHY', 'AGING')]
    const out = capabilityState(rows, ['OPEN_METEO', 'MET_NORWAY'])
    expect(out.state).toBe('FALLBACK_ACTIVE')
    expect(out.detail).toMatch(/OPEN METEO: rate limited/)
    expect(out.detail).toMatch(/MET NORWAY: healthy/)
  })

  it('is healthy when the primary answers, degraded when its data is aging', () => {
    expect(capabilityState([row('OSRM', 'HEALTHY')], ['OSRM']).state).toBe('HEALTHY')
    expect(capabilityState([row('OSRM', 'HEALTHY', 'AGING')], ['OSRM']).state).toBe('DEGRADED')
    expect(capabilityState([row('NASA_GLC', 'STATIC', 'STATIC')], ['NASA_GLC']).state).toBe('HEALTHY')
  })

  it('is unavailable only when every provider is failing, unknown when none has been called', () => {
    expect(capabilityState([row('OPEN_METEO', 'FAILED', 'STALE'), row('MET_NORWAY', 'FAILED', 'EXPIRED')], ['OPEN_METEO', 'MET_NORWAY']).state).toBe('UNAVAILABLE')
    expect(capabilityState([row('GOOGLE_GEMINI', 'UNKNOWN', 'UNKNOWN'), row('OPENROUTER', 'UNKNOWN', 'UNKNOWN')], ['GOOGLE_GEMINI', 'OPENROUTER']).state).toBe('UNKNOWN')
    expect(capabilityState([row('OPENROUTER', 'NOT_CONFIGURED', 'UNKNOWN')], ['OPENROUTER']).state).toBe('UNAVAILABLE')
    expect(capabilityState([], ['MISSING']).state).toBe('UNAVAILABLE')
  })
})
