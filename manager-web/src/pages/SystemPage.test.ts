// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, type ProviderHealthRow } from '../api/client'
import SystemPage, { capabilityState } from './SystemPage'

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

describe('the Diagnostics page says what is true, in words', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('shows fallback-active, rate-limited and not-called-yet as themselves, and keeps the ML wording', async () => {
    vi.spyOn(api, 'ready').mockResolvedValue({ status: 'ok', provider: 'local', checks: { database: { ok: true, detail: 'PostgreSQL 18' }, postgis: { ok: true, detail: '3.6' } } } as never)
    vi.spyOn(api, 'systemProviders').mockResolvedValue({
      providers: [row('OPEN_METEO', 'RATE_LIMITED', 'UNKNOWN'), row('MET_NORWAY', 'HEALTHY'), row('GOOGLE_GEMINI', 'UNKNOWN', 'UNKNOWN')],
      intelligence: { counts: { TRUE_LOCAL_ML: 0, TRUE_LOCAL_ML_EXPERIMENTAL: 1 }, TOTAL_TRUE_LOCAL_AI: 0, TOTAL_LOCAL_INTELLIGENCE: 0, modules: [] },
    })
    render(createElement(SystemPage))

    const weather = (await screen.findByText('Weather')).parentElement!.parentElement!
    expect(within(weather).getByText('Available via fallback')).toBeDefined()
    expect(within(weather).getByText(/OPEN METEO: rate limited/)).toBeDefined()
    // Not called yet is neutral - never the green of Healthy.
    const ai = screen.getByText('AI assistant').parentElement!.parentElement!
    const pill = within(ai).getByText('Not called yet')
    expect(pill.className).toMatch(/text-muted/)
    expect(pill.className).not.toMatch(/text-ok/)
    // Routing has no provider row at all: unavailable, in red, not a quiet blank.
    const routing = screen.getByText('Routing').parentElement!.parentElement!
    expect(within(routing).getByText('Unavailable').className).toMatch(/text-danger/)
    expect(screen.getByText('1 · not deployed')).toBeDefined()
    expect(document.body.textContent).toContain('the online models only word answers')
    expect(document.body.textContent).toContain('It controls nothing here.')
    expect(document.body.textContent).toContain('is never scored as safe')
  })
})
