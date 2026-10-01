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

  // E2E-R3. A dense route (41 vertices, ~500 m apart, along 26.5 N).
  const LINE: LatLon[] = Array.from({ length: 41 }, (_, i) => [26.5, 91.0 + i * 0.005] as LatLon)
  const slides = (events: { latitude: number; longitude: number; year: number | null }[]) =>
    base({ terrain: { usable: true, segments: [] }, landslide_history: { exposure: 'HIGH', inventory_from_year: 2007, inventory_to_year: 2017, events } } as never)

  it('keys one card per stretch of recorded sites, so one acknowledgement covers the stretch', () => {
    const risk = slides([91.01, 91.015, 91.03, 91.15].map((lon) => ({ latitude: 26.5, longitude: lon, year: 2015 })))
    // Before the first site, between the first and second, past the second: one card.
    const keys = [0, 1_200, 1_800].map((m) => dangerAlert(risk, 'r1', LINE, m)!.key)
    expect(new Set(keys).size).toBe(1)
    // A site 12 km further on is a new stretch, and a new card.
    expect(dangerAlert(risk, 'r1', LINE, 13_000)!.key).not.toBe(keys[0])
  })

  it('says "here" only for a site on the road, and how far off it lies otherwise', () => {
    // ~2 km north of the road, level with ~5 km along.
    const off = dangerAlert(slides([{ latitude: 26.518, longitude: 91.05, year: 2015 }]), 'r1', LINE, 4_800)!
    expect(off.where).toContain('Recorded landslide site 2.0 km off the road, near here')
    expect(off.where).not.toContain('site here')
    const on = dangerAlert(slides([{ latitude: 26.5, longitude: 91.05, year: 2015 }]), 'r1', LINE, 4_800)!
    expect(on.where).toContain('Recorded landslide site here')
  })

  it('needs a route and a fix for segment alerts', () => {
    expect(dangerAlert(base(), null, POINTS, 4_000)).toBeNull()
    expect(dangerAlert(base(), 'r1', POINTS, null)).toBeNull()
  })
})
