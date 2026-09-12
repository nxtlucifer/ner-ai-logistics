/**
 * Terrain stretches as map geometry.
 *
 * The risk payload says "STEEP from 12,000 m to 13,500 m along the route";
 * the map needs the lat/lon of that stretch. This walks the planned route's
 * cumulative length and interpolates both ends, the same arithmetic the
 * driver app uses in `src/map/routeDisplay.ts`, so the two products paint the
 * same metres of road.
 *
 * FLAT and ROLLING draw nothing. The planned route is already a line; painting
 * 290 km of "nothing to see" over it would be decoration pretending to be
 * evidence, and would bury the 1.5 km that matter.
 */

export type LatLon = readonly [number, number]

const R = 6_371_000
function distanceMetres(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLon = toRad(b[1] - a[1])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function sliceRoute(points: readonly LatLon[], startM: number, endM: number): LatLon[] {
  if (points.length < 2 || !(endM > startM) || startM < 0) return []
  const out: LatLon[] = []
  let travelled = 0
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    const length = distanceMetres(a, b)
    const segStart = travelled
    const segEnd = travelled + length
    travelled = segEnd
    if (length <= 0 || segEnd < startM) continue
    if (segStart > endM) break
    const at = (m: number): LatLon => {
      const t = Math.min(1, Math.max(0, (m - segStart) / length))
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
    if (out.length === 0) out.push(at(startM))
    out.push(segEnd <= endM ? b : at(endM))
    if (segEnd >= endM) break
  }
  return out.length > 1 ? out : []
}

export interface TerrainOverlay {
  terrainClass: string
  points: LatLon[]
}

export function terrainOverlays(
  points: readonly LatLon[],
  segments: readonly { start_m: number; end_m: number; terrain_class: string }[],
): TerrainOverlay[] {
  const out: TerrainOverlay[] = []
  let run: { terrainClass: string; start: number; end: number } | null = null
  const flush = () => {
    if (run) {
      const sliced = sliceRoute(points, run.start, run.end)
      if (sliced.length > 1) out.push({ terrainClass: run.terrainClass, points: sliced })
    }
    run = null
  }
  for (const seg of segments) {
    const marked = seg.terrain_class === 'HILLY' || seg.terrain_class === 'STEEP'
    if (!marked) {
      flush()
      continue
    }
    if (run && run.terrainClass === seg.terrain_class && Math.abs(run.end - seg.start_m) < 1) {
      run.end = seg.end_m
    } else {
      flush()
      run = { terrainClass: seg.terrain_class, start: seg.start_m, end: seg.end_m }
    }
  }
  flush()
  return out
}
