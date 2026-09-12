import { describe, expect, it } from 'vitest'

import { sliceRoute, terrainOverlays } from './terrain'

const ROUTE = [[26.5, 91.0], [26.5, 91.1], [26.5, 91.2]] as const

describe('terrain overlays (manager)', () => {
  it('slices a stretch out of the planned route by distance', () => {
    const cut = sliceRoute(ROUTE, 2_000, 4_000)
    expect(cut).toHaveLength(2)
    expect(cut[0][1]).toBeGreaterThan(91.0)
    expect(cut[1][1]).toBeGreaterThan(cut[0][1])
  })

  it('paints only hilly and steep, merged by run', () => {
    const overlays = terrainOverlays(ROUTE, [
      { start_m: 0, end_m: 1000, terrain_class: 'FLAT' },
      { start_m: 1000, end_m: 1500, terrain_class: 'HILLY' },
      { start_m: 1500, end_m: 2000, terrain_class: 'HILLY' },
      { start_m: 2000, end_m: 2500, terrain_class: 'STEEP' },
    ])
    expect(overlays.map(o => o.terrainClass)).toEqual(['HILLY', 'STEEP'])
  })
})
