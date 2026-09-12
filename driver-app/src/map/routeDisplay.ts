import { distanceMetres, type LatLon } from './geo'

/** Camera identity covers the corridor, including changes between its ends. */
export function routeCameraKey(routeId: string | null | undefined, points: readonly LatLon[]): string {
  return JSON.stringify([routeId ?? null, points])
}

/** Draw server-provided progress on the assigned polyline, never a new road. */
export function splitRoute(points: readonly LatLon[], fraction: number | null | undefined): {
  completed: readonly LatLon[]
  remaining: readonly LatLon[]
} {
  if (fraction == null || !Number.isFinite(fraction) || fraction < 0 || fraction > 1 || points.length < 2) {
    return { completed: [], remaining: points }
  }
  if (fraction === 0) return { completed: [], remaining: points }
  if (fraction === 1) return { completed: points, remaining: [] }
  const lengths = points.slice(1).map((point, index) => distanceMetres(points[index], point))
  const target = lengths.reduce((sum, length) => sum + length, 0) * fraction
  let travelled = 0
  for (let i = 0; i < lengths.length; i += 1) {
    const length = lengths[i]
    if (length > 0 && travelled + length >= target) {
      const ratio = (target - travelled) / length
      const start = points[i]
      const end = points[i + 1]
      const boundary: LatLon = [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio]
      return { completed: [...points.slice(0, i + 1), boundary], remaining: [boundary, ...points.slice(i + 1)] }
    }
    travelled += length
  }
  return { completed: [], remaining: points }
}

export function regionBounds(region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }) {
  return {
    south: region.latitude - region.latitudeDelta / 2,
    north: region.latitude + region.latitudeDelta / 2,
    west: region.longitude - region.longitudeDelta / 2,
    east: region.longitude + region.longitudeDelta / 2,
  }
}

/**
 * The corridor between two distances along the route, as its own polyline.
 *
 * Walks the same cumulative lengths `splitRoute` does and interpolates both
 * ends, so an overlay starts and stops exactly where the DEM segment does
 * rather than snapping to the nearest vertex - on a sparse straight leg that
 * snap could move a 500 m "steep" stretch by kilometres.
 */
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

/**
 * Coloured stretches for the map: every run of consecutive HILLY or STEEP
 * segments, merged, sliced from the route. FLAT and ROLLING draw nothing -
 * the base route is already the blue line, and painting 290 km of "flat" over
 * it would be decoration pretending to be evidence.
 */
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
