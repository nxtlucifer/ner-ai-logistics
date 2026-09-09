/**
 * Coordinates, once, in one place.
 *
 * THE BUG THIS FILE EXISTS TO PREVENT
 *
 * This application is lat-lon everywhere. PostGIS WKT is lon-lat, and the
 * backend already does that swap exactly once, in
 * `app/domain/routing.py::parse_wkt_linestring`, with a comment saying why.
 * So everything arriving over the API - `OfflineRoute.geometry`, stop
 * `lat`/`lon`, GPS fixes - is `[lat, lon]`.
 *
 * MapLibre GL is lon-lat. So is GeoJSON, so is every `LngLat` in that library.
 * `react-native-maps` is lat-lon, matching the API.
 *
 * That means the web map needs a swap and the native map does not, and a swap
 * that lives inside a renderer is a swap nobody can test. So it lives here,
 * named after what it produces, beside the check that catches it going wrong.
 *
 * A silent lon/lat inversion does not throw. It draws a confident, smooth,
 * completely wrong line - Guwahati at 26.1N 91.7E becomes 91.7N 26.1E, which
 * is in the Arctic Ocean north of Svalbard. The map still "works".
 */

/** `[latitude, longitude]` - the shape everything from this API uses. */
export type LatLon = readonly [number, number]

/**
 * `[longitude, latitude]` - the shape MapLibre and GeoJSON use.
 *
 * Mutable, unlike `LatLon`, because MapLibre's own `LngLatLike` is a mutable
 * tuple and will not accept a readonly one. These are always freshly built by
 * the functions below, so nothing is aliased and there is nothing to protect.
 */
export type LngLat = [number, number]

export interface Bounds {
  minLat: number
  minLon: number
  maxLat: number
  maxLon: number
}

/**
 * Whether a pair is a usable position.
 *
 * The latitude range is what catches an inversion for this deployment. Indian
 * longitudes run to about 97E, and no latitude may exceed 90 - so a swapped
 * NER coordinate fails this check rather than rendering in the Arctic. It is
 * not a general inversion detector (a point near the equator survives being
 * swapped), which is why it is documented as a range check that happens to
 * catch the local case, not as a proof of correctness.
 */
export function isValidLatLon(point: unknown): point is LatLon {
  if (!Array.isArray(point) || point.length < 2) return false
  const [lat, lon] = point as [unknown, unknown]
  if (typeof lat !== 'number' || typeof lon !== 'number') return false
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}

/**
 * The drawable subset of a route.
 *
 * Invalid points are DROPPED, not repaired and not fatal. A provider that
 * returns one bad vertex in fifty should not blank the map a driver is using;
 * a route that is entirely bad returns `[]`, and the caller renders the
 * "route geometry unusable" state rather than an empty basemap that looks like
 * a loading failure.
 */
export function validGeometry(geometry: readonly unknown[] | null | undefined): LatLon[] {
  if (!Array.isArray(geometry)) return []
  return geometry.filter(isValidLatLon).map((p) => [p[0], p[1]] as LatLon)
}

/** `[lat, lon][]` -> `[lon, lat][]`, for MapLibre and GeoJSON. */
export function toLngLat(points: readonly LatLon[]): LngLat[] {
  return points.map(([lat, lon]) => [lon, lat] as LngLat)
}

/** A single pair, same swap. */
export function lngLatOf(point: LatLon): LngLat {
  return [point[1], point[0]]
}

/** The box containing every point, or null when there are none. */
export function boundsOf(points: readonly LatLon[]): Bounds | null {
  if (points.length === 0) return null
  let minLat = Infinity
  let minLon = Infinity
  let maxLat = -Infinity
  let maxLon = -Infinity
  for (const [lat, lon] of points) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
  }
  return { minLat, minLon, maxLat, maxLon }
}

/**
 * Grow a box so the route does not touch the edge of the viewport.
 *
 * A degenerate box - one point, or a route that runs exactly north-south -
 * has zero extent on an axis, and every "fit these bounds" API either divides
 * by that or zooms to its maximum. So the minimum span is applied first and
 * the padding after. 0.01 degrees is roughly a kilometre, which is a sensible
 * frame around a single stop.
 */
export function padBounds(bounds: Bounds, fraction = 0.15, minSpan = 0.01): Bounds {
  const latSpan = Math.max(bounds.maxLat - bounds.minLat, minSpan)
  const lonSpan = Math.max(bounds.maxLon - bounds.minLon, minSpan)
  const latMid = (bounds.maxLat + bounds.minLat) / 2
  const lonMid = (bounds.maxLon + bounds.minLon) / 2
  const latPad = (latSpan * (1 + fraction * 2)) / 2
  const lonPad = (lonSpan * (1 + fraction * 2)) / 2
  return {
    minLat: latMid - latPad,
    maxLat: latMid + latPad,
    minLon: lonMid - lonPad,
    maxLon: lonMid + lonPad,
  }
}

/**
 * Great-circle distance in metres.
 *
 * Haversine on a spherical earth. Good to about 0.5% against the WGS-84
 * ellipsoid, which is far inside the error of a phone GPS fix and of a
 * 52-vertex simplified corridor. The backend uses PostGIS geography for the
 * figures it publishes; this one is for on-device decisions only (am I near
 * this stop, how far to the next turn) and must never be used to contradict a
 * distance the server stated.
 */
export function distanceMetres(a: LatLon, b: LatLon): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLon = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
