/**
 * Terrain must never make the map worse, and must never invent ground.
 *
 * The two properties that matter:
 *
 *   1. Every failure path lands back on the 2D map. A route on a flat map
 *      is the product; shaded relief is decoration next to it, and an
 *      exception while adding a hillshade must not cost an operator their
 *      map mid-dispatch.
 *
 *   2. No elevation means UNKNOWN, never FLAT. A missing DEM reading and a
 *      genuinely level road produce the same empty array, and calling that
 *      FLAT converts an absence of data into a reassurance.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  applyMapMode,
  classifyTerrain,
  DEM_ATTRIBUTION,
  DEM_SOURCE,
  gradients,
} from './mapTerrain'

function fakeMap(over: Record<string, unknown> = {}) {
  return {
    getSource: vi.fn(() => undefined),
    addSource: vi.fn(),
    getLayer: vi.fn(() => undefined),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
    setTerrain: vi.fn(),
    easeTo: vi.fn(),
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('the DEM source', () => {
  it('needs no key, so a missing credential cannot blank the map', () => {
    expect(JSON.stringify(DEM_SOURCE)).not.toMatch(/key=|apikey|token|\{key\}/i)
    expect(DEM_SOURCE.tiles[0]).toMatch(/^https:\/\//)
  })

  it('declares terrarium encoding', () => {
    // Mapbox encoding against terrarium tiles does not error. It produces
    // plausible, wrong elevations — the worse failure, because nothing
    // looks broken.
    expect(DEM_SOURCE.encoding).toBe('terrarium')
  })

  it('carries the attribution the licence requires', () => {
    expect(DEM_ATTRIBUTION).toMatch(/U\.S\. Geological Survey/)
    expect(DEM_ATTRIBUTION).toMatch(/Terrain Tiles/)
  })
})

describe('applying a mode', () => {
  it('adds a hillshade for terrain, and keeps the camera flat', () => {
    const map = fakeMap()
    const result = applyMapMode(map, 'terrain')

    expect(result.mode).toBe('terrain')
    expect(result.failure).toBeNull()
    expect(map.addSource).toHaveBeenCalled()
    expect(map.addLayer).toHaveBeenCalled()
    expect(map.setTerrain).toHaveBeenCalledWith(null)
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ pitch: 0 }))
  })

  it('extrudes and pitches for 3D', () => {
    const map = fakeMap()
    const result = applyMapMode(map, 'terrain3d')

    expect(result.mode).toBe('terrain3d')
    expect(map.setTerrain).toHaveBeenCalledWith(
      expect.objectContaining({ exaggeration: expect.any(Number) }),
    )
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ pitch: 55 }))
  })

  it('keeps exaggeration conservative', () => {
    const map = fakeMap()
    applyMapMode(map, 'terrain3d')
    const [[arg]] = map.setTerrain.mock.calls.filter((c: unknown[]) => c[0] !== null)
    // Exaggerated relief makes a corridor look more dangerous than it is,
    // to someone deciding whether to send a truck down it.
    expect(arg.exaggeration).toBeLessThanOrEqual(1.5)
  })

  it('FALLS BACK TO 2D when the DEM cannot be added', () => {
    const map = fakeMap({
      addSource: vi.fn(() => {
        throw new Error('network')
      }),
    })
    const result = applyMapMode(map, 'terrain3d')

    expect(result.mode).toBe('standard')
    expect(result.failure).toMatch(/flat map/i)
    // And it must have torn down cleanly rather than leaving a half state.
    expect(map.setTerrain).toHaveBeenCalledWith(null)
  })

  it('removes everything again when asked for standard', () => {
    const map = fakeMap({
      getLayer: vi.fn(() => ({})),
      getSource: vi.fn(() => ({})),
    })
    applyMapMode(map, 'standard')
    expect(map.removeLayer).toHaveBeenCalled()
    expect(map.removeSource).toHaveBeenCalled()
    expect(map.setTerrain).toHaveBeenCalledWith(null)
  })

  it('survives a teardown on a map that is already gone', () => {
    const map = fakeMap({
      setTerrain: vi.fn(() => {
        throw new Error('map removed')
      }),
    })
    expect(() => applyMapMode(map, 'standard')).not.toThrow()
  })
})

describe('classifyTerrain', () => {
  it('returns UNKNOWN with no readings — never FLAT', () => {
    expect(classifyTerrain([])).toBe('UNKNOWN')
    expect(classifyTerrain([Number.NaN])).toBe('UNKNOWN')
  })

  it('separates the four bands on the steepest sustained gradient', () => {
    expect(classifyTerrain([0.4, 1.1, -0.8])).toBe('FLAT')
    expect(classifyTerrain([1, 4.2, -2])).toBe('ROLLING')
    expect(classifyTerrain([2, 8.5])).toBe('HILLY')
    expect(classifyTerrain([1, 2, 14])).toBe('STEEP')
  })

  it('reads a descent as steep as the equivalent climb', () => {
    // A loaded truck's brakes care as much as its engine does.
    expect(classifyTerrain([-12])).toBe('STEEP')
  })

  it('is driven by the worst section, not the average', () => {
    // Forty flat kilometres and one 11% wall is not a ROLLING corridor.
    expect(classifyTerrain([0.2, 0.1, 0.3, 0.2, 11])).toBe('STEEP')
  })
})

describe('gradients', () => {
  it('computes percent rise over run', () => {
    expect(gradients([100, 150], [1000])).toEqual([5])
  })

  it('skips a gap rather than reading a missing elevation as sea level', () => {
    // Treating null as 0 m would invent a 1,000 m cliff at every DEM hole.
    expect(gradients([100, null, 150], [1000, 1000])).toEqual([])
  })

  it('skips a zero-length segment instead of dividing by it', () => {
    expect(gradients([100, 150], [0])).toEqual([])
  })

  it('handles a descent', () => {
    expect(gradients([200, 100], [2000])).toEqual([-5])
  })
})
