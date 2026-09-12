/** The overlay lands where the DEM said, not where the nearest vertex is. */
import { describe, expect, it } from 'vitest'

import { distanceMetres } from './geo'
import { sliceRoute, terrainOverlays } from './routeDisplay'

// Three vertices due east along 26.5N; each leg is ~9.9 km.
const ROUTE = [[26.5, 91.0], [26.5, 91.1], [26.5, 91.2]] as const
const LEG = distanceMetres(ROUTE[0], ROUTE[1])

describe('sliceRoute', () => {
  it('interpolates both ends inside one leg', () => {
    const cut = sliceRoute(ROUTE, LEG * 0.25, LEG * 0.5)
    expect(cut).toHaveLength(2)
    expect(cut[0][1]).toBeCloseTo(91.025, 3)
    expect(cut[1][1]).toBeCloseTo(91.05, 3)
  })

  it('spans a vertex when the stretch crosses one', () => {
    const cut = sliceRoute(ROUTE, LEG * 0.9, LEG * 1.1)
    expect(cut).toHaveLength(3)
    expect(cut[1]).toEqual(ROUTE[1])
  })

  it('draws nothing for an empty or inverted stretch', () => {
    expect(sliceRoute(ROUTE, 500, 500)).toEqual([])
    expect(sliceRoute(ROUTE, 900, 100)).toEqual([])
  })
})

describe('terrainOverlays', () => {
  it('merges consecutive segments of one class and skips flat ones', () => {
    const overlays = terrainOverlays(ROUTE, [
      { start_m: 0, end_m: 500, terrain_class: 'FLAT' },
      { start_m: 500, end_m: 1000, terrain_class: 'HILLY' },
      { start_m: 1000, end_m: 1500, terrain_class: 'HILLY' },
      { start_m: 1500, end_m: 2000, terrain_class: 'STEEP' },
      { start_m: 2000, end_m: 2500, terrain_class: 'ROLLING' },
    ])
    expect(overlays.map((o) => o.terrainClass)).toEqual(['HILLY', 'STEEP'])
    expect(overlays[0].points[0][1]).toBeCloseTo(91.0 + 0.1 * (500 / LEG), 4)
    expect(overlays[0].points.at(-1)![1]).toBeCloseTo(91.0 + 0.1 * (1500 / LEG), 4)
  })
})
