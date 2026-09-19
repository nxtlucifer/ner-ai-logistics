/**
 * What is coming up on the road, in one line each.
 *
 * Pure functions over the risk payload's terrain segments and recorded
 * landslide positions plus the server-projected distance travelled. Nothing
 * here estimates time - "in 12 km" is a distance along the corridor, which
 * the geometry knows, and never an ETA, which nothing in this build does.
 *
 * With no fix (`travelledM === null`) the answer describes the WHOLE route,
 * labelled as such, rather than pretending the truck is at the start.
 */

import type { LatLon } from './geo'
import { distanceMetres } from './geo'

interface Segment {
  start_m: number
  end_m: number
  terrain_class: string
}

const km = (m: number) => (m >= 950 ? `${(m / 1000).toFixed(m >= 9_500 ? 0 : 1)} km` : `${Math.round(m / 100) * 100} m`)

/** The next hilly or steep stretch ahead, or the whole-route terrain picture. */
export function terrainAhead(
  segments: readonly Segment[] | null | undefined,
  classKm: Record<string, number> | null | undefined,
  travelledM: number | null,
): string | null {
  if (!segments || segments.length === 0) return null
  const marked = segments.filter((s) => s.terrain_class === 'HILLY' || s.terrain_class === 'STEEP')

  if (travelledM === null) {
    const steep = classKm?.STEEP ?? 0
    const hilly = classKm?.HILLY ?? 0
    if (steep === 0 && hilly === 0) return 'Whole route: no hilly or steep stretch on the DEM profile'
    const parts = []
    if (steep > 0) parts.push(`${steep.toFixed(1)} km steep`)
    if (hilly > 0) parts.push(`${hilly.toFixed(1)} km hilly`)
    return `Whole route: ${parts.join(', ')} — position needed to say where`
  }

  // The contiguous run of marked segments that contains or follows the
  // truck, labelled by the worst class in it - a driver plans for the steep
  // part of a hill, not its average.
  const index = marked.findIndex((s) => s.end_m > travelledM)
  if (index === -1) return 'No hilly or steep stretch ahead on the DEM profile'
  const next = marked[index]
  let end = next.end_m
  let cls = next.terrain_class
  for (let i = index + 1; i < marked.length; i += 1) {
    const s = marked[i]
    if (Math.abs(s.start_m - end) >= 1) break
    end = s.end_m
    if (s.terrain_class === 'STEEP') cls = 'STEEP'
  }
  const word = cls === 'STEEP' ? 'Steep stretch (10%+)' : 'Hilly stretch (6–10%)'
  const start = Math.max(next.start_m, travelledM)
  const ahead = next.start_m - travelledM
  return ahead <= 0
    ? `${word} now, ${km(end - start)} to go`
    : `${word} in ${km(ahead)}, ${km(end - next.start_m)} long`
}

/** A recorded site as the road sees it: how far along the route its nearest
 *  point is, and how far off the road the site itself lies. */
export interface HazardSite {
  at: number
  year: number | null
  /** Straight-line metres from the site to the nearest route vertex. */
  offM: number
}

/** Within this of the road a recorded site is "here"; beyond it the card
 *  says how far off the road it is (E2E-R3: sites 2.0-3.6 km away were
 *  announced as "here"). Project heuristic. */
export const ON_ROAD_M = 500

/** Every recorded site projected onto the route, in order along it. */
export function hazardSites(
  points: readonly LatLon[],
  hazards: readonly { latitude: number; longitude: number; year: number | null }[] | null | undefined,
): HazardSite[] {
  if (!hazards || hazards.length === 0 || points.length < 2) return []
  // Cumulative distance per vertex, once.
  const along: number[] = [0]
  for (let i = 1; i < points.length; i += 1) along.push(along[i - 1] + distanceMetres(points[i - 1], points[i]))

  const sites = hazards.map((h) => {
    let nearest = Number.POSITIVE_INFINITY
    let at = 0
    for (let i = 0; i < points.length; i += 1) {
      const d = distanceMetres(points[i], [h.latitude, h.longitude])
      if (d < nearest) {
        nearest = d
        at = along[i]
      }
    }
    return { at, year: h.year, offM: nearest }
  })
  // Stable: two sites at one point keep their inventory order.
  return sites.sort((a, b) => a.at - b.at)
}

/**
 * The first recorded landslide site at or after `travelledM` (or on the whole
 * corridor when there is no fix): its along-route position, year and
 * distance off the road.
 */
export function nextHazard(
  points: readonly LatLon[],
  hazards: readonly { latitude: number; longitude: number; year: number | null }[] | null | undefined,
  travelledM: number | null,
): HazardSite | null {
  return hazardSites(points, hazards).find((s) => travelledM === null || s.at >= travelledM) ?? null
}

/** "here" only for a site on the road; otherwise where it is, from the road. */
export function siteWords(site: HazardSite, aheadM: number, distance: (m: number) => string = km): string {
  const off = site.offM > ON_ROAD_M ? distance(site.offM) : null
  if (aheadM < 500) return off ? `Recorded landslide site ${off} off the road, near here` : 'Recorded landslide site here'
  return `Recorded landslide site in ${distance(aheadM)}${off ? `, ${off} off the road` : ''}`
}

/** The nearest recorded landslide position ahead along the corridor. */
export function hazardAhead(
  points: readonly LatLon[],
  hazards: readonly { latitude: number; longitude: number; year: number | null }[] | null | undefined,
  travelledM: number | null,
): string | null {
  if (!hazards || hazards.length === 0 || points.length < 2) return null
  const best = nextHazard(points, hazards, travelledM)
  if (best === null) return 'No recorded landslide site ahead'
  const when = best.year ? ` (recorded ${best.year})` : ''
  if (travelledM === null) return `${hazards.length} recorded landslide site${hazards.length === 1 ? '' : 's'} on this corridor${when ? `, earliest at ${km(best.at)}` : ''}`
  return `${siteWords(best, best.at - travelledM)}${when}`
}
