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
