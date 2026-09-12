import { describe, expect, it } from 'vitest'

import type { RouteRisk } from '../api/client'
import type { LatLon } from '../map/geo'
import { ALERT_AHEAD_M, dangerAlert } from './alerts'

const POINTS: LatLon[] = [[26.0, 91.8], [25.9, 91.85], [25.8, 91.9]] // ~24 km
const base = (over: Partial<RouteRisk> = {}): RouteRisk =>
  ({
    score: 27, band: 'LOW', components: [], inputs: { weather: 'AVAILABLE' }, unavailable: [], reason_codes: [],
    observations_used: 5, observations_stale: 0, assessed_at: '2026-09-12T10:00:00Z', decision: 'CAUTION',
    terrain: { usable: true, segments: [{ start_m: 5_000, end_m: 5_900, grade_pct: 12, terrain_class: 'STEEP' }] },
    landslide_history: { exposure: 'HIGH', inventory_from_year: 2007, inventory_to_year: 2017, events: [{ latitude: 25.9, longitude: 91.85, year: 2015 }] },
    ...over,
  }) as unknown as RouteRisk

describe('dangerAlert', () => {
  it('is silent until the steep stretch is inside the approach window', () => {
    expect(dangerAlert(base(), 'r1', POINTS, 1_000)).toBeNull()
    const a = dangerAlert(base(), 'r1', POINTS, 5_000 - ALERT_AHEAD_M + 100)!
    expect(a.level).toBe('CAUTION')
    expect(a.title).toBe('STEEP GROUND AHEAD')
    expect(a.where).toMatch(/Steep stretch in 2\.9 km/)
    expect(a.key).toBe('r1:steep:5000')
    expect(a.evidence.join(' ')).toMatch(/historical/)
  })

  it('names historical exposure, never a current landslide, and keys by site', () => {
    const risk = base({ terrain: { usable: true, segments: [] } } as never)
    const along = 12_000 // the recorded site sits ~12.1 km along
    const a = dangerAlert(risk, 'r1', POINTS, along)!
    expect(a.title).toBe('LANDSLIDE EXPOSURE AHEAD')
    expect(a.detail).toMatch(/Not a current incident/)
    expect(a.level).toBe('CAUTION')
  })

  it('rises to HIGH on a hold decision and to CRITICAL only on a severe official alert', () => {
    expect(dangerAlert(base({ decision: 'HOLD_AND_REVIEW' } as never), 'r1', POINTS, 4_000)!.level).toBe('HIGH')
    const official = base({ official_warnings: { level: 'ACTIVE', on_route: [{ identifier: 'IN-1', sender: 'Assam-SDMA', event: 'Flood', severity: 'Severe', urgency: 'Immediate', headline: 'River rising', area_desc: 'Ri-Bhoi', sent: null, expires: null }], in_states: 0, considered: 1, districts: [], provider: 'ndma', fetched_at: null, reason_codes: [] } } as never)
    const a = dangerAlert(official, 'r1', POINTS, null)!
    expect(a.level).toBe('CRITICAL')
    expect(a.key).toBe('r1:warning:IN-1')
  })

  it('needs a route and a fix for segment alerts', () => {
    expect(dangerAlert(base(), null, POINTS, 4_000)).toBeNull()
    expect(dangerAlert(base(), 'r1', POINTS, null)).toBeNull()
  })
})
