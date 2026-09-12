/** "In 12 km" must be a distance along the road, from the truck, never a guess. */
import { describe, expect, it } from 'vitest'

import { hazardAhead, terrainAhead } from './ahead'

const SEGS = [
  { start_m: 0, end_m: 500, terrain_class: 'FLAT' },
  { start_m: 500, end_m: 1000, terrain_class: 'FLAT' },
  { start_m: 1000, end_m: 1500, terrain_class: 'HILLY' },
  { start_m: 1500, end_m: 2000, terrain_class: 'STEEP' },
  { start_m: 2000, end_m: 2500, terrain_class: 'FLAT' },
]

describe('terrainAhead', () => {
  it('describes the whole route when there is no fix, and says a position is needed', () => {
    expect(terrainAhead(SEGS, { FLAT: 1.5, HILLY: 0.5, STEEP: 0.5, ROLLING: 0 }, null)).toBe(
      'Whole route: 0.5 km steep, 0.5 km hilly — position needed to say where',
    )
    expect(terrainAhead(SEGS, { FLAT: 2.5 }, null)).toContain('no hilly or steep stretch')
  })

  it('finds the next marked stretch ahead of the truck and merges the run', () => {
    // 1 km of hilly-then-steep starting 800 m ahead. Reported as steep because
    // the run contains a steep segment - the driver plans for the worst of it.
    expect(terrainAhead(SEGS, null, 200)).toBe('Steep stretch (10%+) in 800 m, 1.0 km long')
  })

  it('reports a stretch the truck is already on as now', () => {
    expect(terrainAhead(SEGS, null, 1200)).toBe('Steep stretch (10%+) now, 800 m to go')
  })

  it('says so when nothing is ahead', () => {
    expect(terrainAhead(SEGS, null, 2100)).toBe('No hilly or steep stretch ahead on the DEM profile')
  })

  it('is null without a profile', () => {
    expect(terrainAhead(null, null, 0)).toBeNull()
    expect(terrainAhead([], null, 0)).toBeNull()
  })
})

describe('hazardAhead', () => {
  const ROUTE = [[26.5, 91.0], [26.5, 91.1], [26.5, 91.2]] as const
  const LEG = 9_930 // metres per 0.1 degree of longitude at 26.5N, approx

  it('reports the nearest recorded site ahead, in distance along the road', () => {
    const line = hazardAhead(ROUTE, [{ latitude: 26.5, longitude: 91.2, year: 2017 }], 1000)
    expect(line).toMatch(/^Recorded landslide site in \d+ km \(recorded 2017\)$/)
    expect(line).toContain(`${Math.round((2 * LEG - 1000) / 1000)} km`)
  })

  it('ignores a site the truck has already passed', () => {
    expect(hazardAhead(ROUTE, [{ latitude: 26.5, longitude: 91.0, year: 2017 }], 5000)).toBe(
      'No recorded landslide site ahead',
    )
  })

  it('counts the corridor when there is no fix', () => {
    expect(
      hazardAhead(ROUTE, [{ latitude: 26.5, longitude: 91.1, year: 2016 }, { latitude: 26.5, longitude: 91.2, year: 2017 }], null),
    ).toMatch(/^2 recorded landslide sites on this corridor, earliest at \d+ km$/)
  })
})
