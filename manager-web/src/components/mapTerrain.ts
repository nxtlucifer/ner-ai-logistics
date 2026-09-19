/**
 * Terrain for the fleet map — as an addition to the 2D map, never a
 * replacement for it.
 *
 * WHY THIS SOURCE
 *
 * MapLibre needs a `raster-dem` source to shade or extrude terrain.
 * Verified on 20 September 2026 before adopting anything:
 *
 *   AWS Open Data "Terrain Tiles" (tilezen/joerd)
 *   https://registry.opendata.aws/terrain-tiles/
 *     - anonymous, no key, no billing
 *     - every constituent source permits commercial use
 *     - attribution required, and given below
 *     - over the North-East the underlying data is SRTM / GMTED2010
 *       (USGS, public domain)
 *     - tiles fetched for z8/z9/z10 over 26°N 92°E: HTTP 200, 256×256 PNG
 *
 * MapTiler's terrain-RGB was the other candidate and is rejected here for
 * one reason: it needs a key, and a map that blanks when a key is missing
 * is not a fallback, it is a second failure mode.
 *
 * WHAT THIS IS NOT
 *
 * Not a hazard layer. A hillshade shows where the ground is steep; it says
 * nothing about whether a road is passable today. Nothing in this module
 * produces a route decision, and none of it feeds the deterministic policy.
 */

import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'

import type { ThemedPaint } from './mapSetup'

/** 2D is the product. The other two are enhancements to it. */
export type MapMode = 'standard' | 'terrain' | 'terrain3d'

export const DEM_SOURCE_ID = 'terrain-dem'
export const HILLSHADE_LAYER_ID = 'terrain-hillshade'

/** The hillshade's colours come from the theme (index.css), painted by the map's owner. */
export const HILLSHADE_PAINT: ThemedPaint[] = [
  [HILLSHADE_LAYER_ID, 'hillshade-shadow-color', (t) => t('map-hillshade-shadow')],
  [HILLSHADE_LAYER_ID, 'hillshade-highlight-color', (t) => t('map-hillshade-highlight')],
]

/**
 * Attribution required by the Terrain Tiles licence. Shortened to the
 * sources that actually cover this region — the full notice names eleven
 * national datasets, none of which contribute a pixel over the North-East.
 */
export const DEM_ATTRIBUTION =
  'Elevation: SRTM &amp; GMTED2010 courtesy of the U.S. Geological Survey, ' +
  'via <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a>'

export const DEM_SOURCE = {
  type: 'raster-dem' as const,
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  // Terrarium encoding, not Mapbox's. Getting this wrong does not error —
  // it produces plausible, wrong elevations, which is the worse outcome.
  encoding: 'terrarium' as const,
  tileSize: 256,
  maxzoom: 13,
  attribution: DEM_ATTRIBUTION,
}

/**
 * Vertical exaggeration.
 *
 * Deliberately conservative. The Shillong plateau rises about 1,200 m over
 * ~40 km; at 1.0 that is visible without turning a hill road into a cliff.
 * Exaggeration makes terrain look more dangerous than it is, and this map
 * is read by someone deciding whether to send a truck.
 */
export const TERRAIN_EXAGGERATION = 1.0

/** Pitch used by the 3D mode. Shallow enough that the route stays readable. */
export const TERRAIN_PITCH = 55

export interface TerrainHandle {
  /** What actually ended up applied — may differ from what was asked. */
  mode: MapMode
  /** Set when the DEM could not be used, for the UI to show plainly. */
  failure: string | null
}

/**
 * Apply a mode to a live map, and report what actually happened.
 *
 * Every failure path lands on `standard`, because the 2D map with a route
 * on it is the product and terrain is decoration by comparison. A thrown
 * error here must never leave the operator without a map.
 */
export function applyMapMode(map: MapLibreMap, mode: MapMode): TerrainHandle {
  try {
    if (mode === 'standard') {
      clearTerrain(map)
      return { mode: 'standard', failure: null }
    }

    if (!map.getSource(DEM_SOURCE_ID)) {
      map.addSource(DEM_SOURCE_ID, DEM_SOURCE)
    }
    if (!map.getLayer(HILLSHADE_LAYER_ID)) {
      map.addLayer({
        id: HILLSHADE_LAYER_ID,
        type: 'hillshade',
        source: DEM_SOURCE_ID,
        paint: {
          // Low intensity: this sits UNDER the route line and the truck
          // markers, and must not compete with either. Colours: HILLSHADE_PAINT.
          'hillshade-exaggeration': 0.45,
        },
      })
    }

    if (mode === 'terrain3d') {
      map.setTerrain({ source: DEM_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION })
      map.easeTo({ pitch: TERRAIN_PITCH, duration: 600 })
      return { mode: 'terrain3d', failure: null }
    }

    // Plain terrain: shaded relief, camera stays flat and readable.
    map.setTerrain(null)
    map.easeTo({ pitch: 0, duration: 400 })
    return { mode: 'terrain', failure: null }
  } catch (error) {
    clearTerrain(map)
    return {
      mode: 'standard',
      failure:
        error instanceof Error
          ? `Terrain unavailable (${error.message}). Showing the flat map.`
          : 'Terrain unavailable. Showing the flat map.',
    }
  }
}

/** Remove everything terrain added, leaving the 2D map exactly as it was. */
export function clearTerrain(map: MapLibreMap): void {
  try {
    map.setTerrain(null)
    if (map.getLayer(HILLSHADE_LAYER_ID)) map.removeLayer(HILLSHADE_LAYER_ID)
    if (map.getSource(DEM_SOURCE_ID)) map.removeSource(DEM_SOURCE_ID)
    map.easeTo({ pitch: 0, bearing: 0, duration: 400 })
  } catch {
    // Tearing down a map that is already gone is not an error worth
    // propagating to an operator.
  }
}

/** Is this style one terrain can be added to? */
export function supportsTerrain(style: StyleSpecification | undefined): boolean {
  return Boolean(style && style.version === 8)
}

// --- Terrain classification -------------------------------------------

export type TerrainClass = 'FLAT' | 'ROLLING' | 'HILLY' | 'STEEP' | 'UNKNOWN'

/**
 * Classify a corridor from its gradients.
 *
 * `UNKNOWN` when there is no elevation, and **never FLAT**. A missing DEM
 * reading and a genuinely level road produce the same empty array, and
 * calling that FLAT would turn an absence of data into a reassurance —
 * exactly the failure `UNKNOWN != SAFE` exists to prevent.
 *
 * Thresholds are the maximum sustained gradient, in percent, because that
 * is what limits a loaded truck: a long 8% climb is the constraint, not the
 * average over a route that is mostly valley floor.
 */
export function classifyTerrain(gradientsPercent: readonly number[]): TerrainClass {
  const usable = gradientsPercent.filter((g) => Number.isFinite(g))
  if (usable.length === 0) return 'UNKNOWN'
  const steepest = Math.max(...usable.map(Math.abs))
  if (steepest < 2) return 'FLAT'
  if (steepest < 5) return 'ROLLING'
  if (steepest < 9) return 'HILLY'
  return 'STEEP'
}

/** Percent gradient between consecutive points. */
export function gradients(
  elevations: readonly (number | null)[],
  spacingMetres: readonly number[],
): number[] {
  const out: number[] = []
  for (let i = 1; i < elevations.length; i += 1) {
    const a = elevations[i - 1]
    const b = elevations[i]
    const run = spacingMetres[i - 1]
    // A null elevation contributes nothing rather than being read as 0 m,
    // which would invent a cliff at every gap in the DEM.
    if (a === null || b === null || !run || run <= 0) continue
    out.push(((b - a) / run) * 100)
  }
  return out
}
