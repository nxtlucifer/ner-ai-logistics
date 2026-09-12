import { describe, expect, it } from 'vitest'

import type { RouteRisk } from '../api/client'
import { nextTerrain, routeAiCard } from './routeAi'

const base: RouteRisk = {
  score: 35,
  band: 'MODERATE',
  components: [],
  inputs: { weather: 'AVAILABLE', elevation: 'AVAILABLE', flood: 'NOT_AVAILABLE' },
  unavailable: ['flood'],
  reason_codes: ['WEATHER_COVERAGE_PARTIAL', 'STEEP_GRADIENT_ON_ROUTE', 'HEAVY_RAIN_ON_ROUTE'],
  observations_used: 5,
  observations_stale: 0,
  assessed_at: '2026-09-12T04:00:00Z',
  decision: 'CAUTION',
  terrain: {
    usable: true,
    segments: [
      { start_m: 0, end_m: 500, grade_pct: 1, terrain_class: 'FLAT' },
      { start_m: 4200, end_m: 4700, grade_pct: 11, terrain_class: 'STEEP' },
      { start_m: 4700, end_m: 5200, grade_pct: 7, terrain_class: 'HILLY' },
    ],
  } as RouteRisk['terrain'],
  landslide_history: { exposure: 'HIGH' } as RouteRisk['landslide_history'],
}

describe('routeAiCard', () => {
  it('says the decision the server made and the two most urgent reasons, in order', () => {
    const card = routeAiCard(base, 0, 'en')
    expect(card.headline).toBe('Caution')
    expect(card.lines).toEqual(['Heavy rain on this route', 'Steep gradients on this route'])
    expect(card.nextTerrain).toBe('STEEP · 4.2 km')
    expect(card.landslide).toBe('HIGH')
    expect(card.evidence).toBe('2 of 3 evidence factors available')
  })

  it('never invents a decision or a next stretch', () => {
    expect(routeAiCard(null, 0, 'en').decision).toBeNull()
    expect(routeAiCard({ ...base, decision: null }, 0, 'en').headline).toBe('MODERATE risk')
    expect(nextTerrain(base.terrain?.segments, null)).toBeNull()
    expect(nextTerrain(base.terrain?.segments, 6000)).toBeNull()
    expect(nextTerrain(base.terrain?.segments, 4300)).toBe('STEEP · now, 900 m to go')
  })
})
