import { describe, expect, it } from 'vitest'

import { sceneLayers } from './scene'

const base = { points: [[26.1, 91.7], [26.2, 91.8], [26.3, 91.9]] as [number, number][], backupPoints: [], showBackup: false, stops: [], position: null, positionKind: null, accuracyM: null }

describe('sceneLayers', () => {
  it('draws casing, remaining and completed once progress is known', () => {
    const kinds = sceneLayers({ ...base, progressFraction: 0.5 }).map((l) => l.k + ':' + l.c)
    expect(kinds).toEqual(['line:#FFFFFF', 'line:#2563EB', 'line:#93B9AF'])
  })
  it('turns a live fix with a heading into an arrow, never a last-known one', () => {
    const live = sceneLayers({ ...base, position: [26.15, 91.75], positionKind: 'LIVE', accuracyM: 20, headingDeg: 45 })
    expect(live.filter((l) => l.k === 'circle')).toHaveLength(1)
    expect(live.at(-1)).toMatchObject({ k: 'arrow', h: 45 })
    const stale = sceneLayers({ ...base, position: [26.15, 91.75], positionKind: 'LAST_KNOWN', accuracyM: 20, headingDeg: 45, positionAgeSeconds: 90 })
    expect(stale.at(-1)).toMatchObject({ k: 'dot', o: 0, tip: 'Last known position — 90s ago' })
    expect(stale.some((l) => l.k === 'circle' || l.k === 'arrow')).toBe(false)
  })
  it('paints only KNOWN fleet traffic as a thin stroke inside the route', () => {
    const layers = sceneLayers({ ...base, progressFraction: null, trafficSegments: [
      { start_m: 0, end_m: 8000, state: 'CONGESTED', observed_kmph: 12, baseline_kmph: 48, vehicle_count: 2, newest_age_seconds: 240 },
      { start_m: 8000, end_m: 16000, state: 'UNKNOWN', observed_kmph: null, baseline_kmph: 48, vehicle_count: 0, newest_age_seconds: null },
    ] })
    const traffic = layers.filter((l) => l.k === 'line' && l.w === 3)
    expect(traffic).toHaveLength(1)
    expect(traffic[0]).toMatchObject({ c: '#DC2626', tip: 'Fleet traffic: congested · 12 km/h vs 48 planned · 2 trucks · 4 min ago' })
  })
  it('draws nothing for a null position and keeps place ids for taps', () => {
    const layers = sceneLayers({ ...base, points: [], places: [{ provider_id: 'osm:1', name: 'Lay-by', category: 'REST', lat: 26, lon: 91 } as never] })
    expect(layers).toEqual([expect.objectContaining({ k: 'dot', id: 'osm:1', tip: 'Lay-by - rest' })])
  })
})
