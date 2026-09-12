/**
 * The invariants the Safety screen is built on.
 *
 * The fixture is the payload the live endpoint actually returned for
 * Guwahati -> Jorhat: LOW/20, weather answering with 5 current readings, and
 * seven of ten factors with nothing behind them. The cases that matter are the
 * ones where a naive mapping would render a gap as reassurance.
 */

import { describe, expect, it } from 'vitest'

import type { RouteRisk } from '../api/client'
import { riskCards, riskSummary } from './riskCards'

const NOW = Date.parse('2026-09-09T12:00:00Z')

const LIVE: RouteRisk = {
  score: 20,
  band: 'LOW',
  components: [
    {
      code: 'DURATION_EXPOSURE',
      label: 'Time on the road',
      points: 12,
      detail: '5h 40m of driving',
    },
    {
      code: 'DISTANCE_EXPOSURE',
      label: 'Distance',
      points: 8,
      detail: '305.4 km',
    },
  ],
  inputs: {
    distance: 'AVAILABLE',
    duration: 'AVAILABLE',
    weather: 'AVAILABLE',
    landslide: 'NOT_AVAILABLE',
    fuel_model: 'NOT_AVAILABLE',
    flood: 'NOT_AVAILABLE',
    road_quality: 'NOT_AVAILABLE',
    truck_restrictions: 'NOT_AVAILABLE',
    historical_incidents: 'NOT_AVAILABLE',
    elevation: 'NOT_AVAILABLE',
  },
  unavailable: [
    'landslide',
    'fuel_model',
    'flood',
    'road_quality',
    'truck_restrictions',
    'historical_incidents',
    'elevation',
  ],
  reason_codes: ['LANDSLIDE_DATA_NOT_CONFIGURED'],
  observations_used: 5,
  observations_stale: 0,
  assessed_at: '2026-09-09T11:48:00Z',
}

const cardFor = (risk: RouteRisk, factor: string) => {
  const card = riskCards(risk, NOW).find((c) => c.factor === factor)
  if (!card) throw new Error(`no card for ${factor}`)
  return card
}

describe('riskCards', () => {
  it('gives every declared input a card, including the ones nobody answered', () => {
    expect(riskCards(LIVE, NOW)).toHaveLength(10)
  })

  it('never reports an unanswered factor as NONE', () => {
    // NONE is a claim: measured, contributed nothing. A factor with no source
    // may not make it - this is the assertion the whole screen rests on.
    for (const card of riskCards(LIVE, NOW)) {
      if (card.state === 'NOT_AVAILABLE') expect(card.severity).toBe('UNKNOWN')
    }
    expect(cardFor(LIVE, 'landslide').severity).toBe('UNKNOWN')
  })

  it('hands the judgement back rather than reassuring, when a factor is unknown', () => {
    const action = cardFor(LIVE, 'landslide').action
    expect(action).toContain('yourself')
    expect(action.toLowerCase()).not.toContain('clear')
    expect(action.toLowerCase()).not.toContain('safe')
  })

  it('uses the engine’s own words for a scored factor', () => {
    expect(cardFor(LIVE, 'duration').why).toBe('5h 40m of driving')
    expect(cardFor(LIVE, 'duration').points).toBe(12)
  })

  it('carries the weather observation counts in its freshness line', () => {
    expect(cardFor(LIVE, 'weather').freshness).toBe(
      '5 current readings, 0 stale · assessed 12m ago',
    )
  })

  it('ages an unavailable factor as having no reading rather than a fresh one', () => {
    expect(cardFor(LIVE, 'flood').freshness).toBe('No reading to age')
  })

  it('orders worst first, and an unmeasured factor above a measured-clear one', () => {
    const order = riskCards(LIVE, NOW).map((c) => c.factor)
    expect(order.slice(0, 2)).toEqual(['duration', 'distance'])
    // weather answered and scored nothing; the seven gaps come before it.
    expect(order.indexOf('landslide')).toBeLessThan(order.indexOf('weather'))
    expect(order[order.length - 1]).toBe('weather')
  })

  it('bands one factor’s contribution on the engine’s own thresholds', () => {
    const heavy: RouteRisk = {
      ...LIVE,
      components: [
        { code: 'RAIN_EXPOSURE', label: 'Rain', points: 45, detail: 'heavy rain' },
        { code: 'WIND_EXPOSURE', label: 'Wind', points: 22, detail: 'severe gusts' },
      ],
    }
    // Weather emits two components; they belong to ONE factor and sum.
    const weather = cardFor(heavy, 'weather')
    expect(weather.points).toBe(67)
    expect(weather.severity).toBe('HIGH')
    expect(weather.why).toBe('heavy rain · severe gusts')

    const moderate = cardFor(
      { ...LIVE, components: [{ code: 'RAIN_EXPOSURE', label: 'Rain', points: 30, detail: 'rain' }] },
      'weather',
    )
    expect(moderate.severity).toBe('MODERATE')
  })

  it('still shows a factor this build has never heard of', () => {
    const future: RouteRisk = {
      ...LIVE,
      inputs: { ...LIVE.inputs, seismic_activity: 'NOT_AVAILABLE' },
    }
    const card = cardFor(future, 'seismic_activity')
    expect(card.title).toBe('Seismic activity')
    expect(card.severity).toBe('UNKNOWN')
  })
})

describe('terrain and history evidence', () => {
  const MEASURED: RouteRisk = {
    ...LIVE,
    score: 35,
    band: 'MODERATE',
    components: [
      ...LIVE.components,
      {
        code: 'LANDSLIDE_HISTORY_EXPOSURE',
        label: 'Landslide history',
        points: 15,
        detail: '13 recorded slide(s) within 5 km of the route, 2007-2017',
      },
    ],
    inputs: { ...LIVE.inputs, elevation: 'AVAILABLE', historical_incidents: 'AVAILABLE' },
    unavailable: ['landslide', 'fuel_model', 'flood', 'road_quality', 'truck_restrictions'],
    terrain: {
      source: 'Copernicus DEM GLO-90 via Open-Meteo',
      fetched_at: '2026-09-09T11:30:00Z',
      spacing_m: 500,
      samples_requested: 611,
      samples_answered: 600,
      coverage: 0.982,
      usable: true,
      min_elevation_m: 52,
      max_elevation_m: 149,
      total_ascent_m: 985,
      total_descent_m: 946,
      max_grade_pct: 10,
      steep_km: 0,
      class_km: { FLAT: 293.75, ROLLING: 4.5, HILLY: 1.5, STEEP: 0 },
      segments: [],
    },
    landslide_history: {
      exposure: 'HIGH',
      data_status: 'AVAILABLE',
      provider: 'nasa-glc-2007-2017-snapshot',
      considered_count: 56,
      on_route_count: 13,
      imprecise_count: 10,
      unlocatable_count: 0,
      nearest_km: 0.4,
      inventory_from_year: 2007,
      inventory_to_year: 2017,
      reason_codes: ['LANDSLIDE_HISTORY_ON_ROUTE', 'LANDSLIDE_HISTORY_INVENTORY_AGED'],
      events: [],
    },
  }

  it('shows the DEM evidence, not just the weight, on the terrain card', () => {
    const card = cardFor(MEASURED, 'elevation')
    expect(card.state).toBe('AVAILABLE')
    expect(card.severity).toBe('NONE') // flat valley road: measured, nothing to add
    expect(card.why).toContain('52–149 m')
    expect(card.why).toContain('985 m of climbing')
    expect(card.source).toContain('Copernicus')
    expect(card.freshness).toContain('98% of 611 samples')
  })

  it('carries the inventory exposure label and its age on the history card', () => {
    const card = cardFor(MEASURED, 'historical_incidents')
    expect(card.state).toBe('AVAILABLE')
    // The published label, not a banding of +15 points.
    expect(card.severity).toBe('HIGH')
    expect(card.why).toContain('13 recorded landslides within 5 km')
    expect(card.why).toContain('nearest 0.4 km')
    expect(card.why).toContain('10 more nearby placed too imprecisely')
    expect(card.freshness).toContain('2007–2017')
    expect(card.freshness).toContain('aged')
    expect(card.source).toContain('NASA')
  })

  it('still counts the current landslide feed as unknown alongside the history', () => {
    // History is not a substitute for a live feed, and the cards must not
    // let it read as one.
    expect(cardFor(MEASURED, 'landslide').severity).toBe('UNKNOWN')
    expect(riskSummary(MEASURED, NOW)).toMatchObject({ available: 5, total: 10, unavailable: 5 })
  })
})

describe('riskSummary', () => {
  it('never states a band without the count of what was missing', () => {
    const summary = riskSummary(LIVE, NOW)
    expect(summary).toMatchObject({
      band: 'LOW',
      score: 20,
      available: 3,
      total: 10,
      unavailable: 7,
      assessedLabel: '12m ago',
    })
  })
})
