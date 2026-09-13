/**
 * What the map draws, as data. ONE builder for both platforms.
 *
 * The web map turns these into Leaflet layers in a DOM it owns; the native
 * map posts the same list into a WebView that runs Leaflet. The draw order,
 * the colours and the wording of every tooltip live here once, so a hazard
 * that is red on the laptop cannot be amber on the phone.
 *
 * Tokens are LIGHT-basemap values (see the web map's header for why they are
 * not read from `COLORS`).
 */

import { sliceRoute, splitRoute, terrainOverlays } from './routeDisplay'
import type { DriverRouteMapProps } from './types'

export const ROUTE = '#2563EB'
export const ROUTE_CASING = '#FFFFFF'
export const BACKUP = '#475569'
export const COMPLETED = '#93B9AF'
export const TERRAIN_HILLY = '#B45309'
export const TERRAIN_STEEP = '#B42318'
export const ORIGIN = '#101820'
export const TRAFFIC: Record<string, string> = { NORMAL: '#16A34A', SLOW: '#D97706', CONGESTED: '#DC2626' }
export const LIVE = '#087F5B'
export const LAST_KNOWN = '#B45309'

/** The truck as a triangle, rotated by heading. Inline CSS: the web map's
 *  divIcon and the WebView page both paste it verbatim. */
export const ARROW_STYLE = `width:0;height:0;border-left:11px solid transparent;border-right:11px solid transparent;border-bottom:22px solid ${LIVE};filter:drop-shadow(0 0 2px #fff);`

/**
 * MapTiler hillshade tiles (relief shading), or null without a key. The key
 * is a client key inlined at build time from EXPO_PUBLIC_MAPTILER_KEY and is
 * restricted per origin/app in the MapTiler dashboard; it is never in source.
 * Terrain-RGB from the same account is elevation ENCODING - the risk engine's
 * elevation evidence stays Copernicus/SRTM through the backend.
 */
export const HILLSHADE_URL: string | null = process.env.EXPO_PUBLIC_MAPTILER_KEY
  ? `https://api.maptiler.com/tiles/hillshade/{z}/{x}/{y}.webp?key=${process.env.EXPO_PUBLIC_MAPTILER_KEY}`
  : null
export const HILLSHADE_ATTRIBUTION = '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a>'

/** Marker colour per service kind: none reuses route blue or live green. */
export const CATEGORY_COLOUR: Record<string, string> = {
  EMERGENCY: '#B42318',
  TYRES: '#7C3AED',
  HOTEL: '#0891B2',
  REST: '#CA8A04',
}

type Pt = [number, number]
export type SceneLayer =
  | { k: 'line'; p: Pt[]; c: string; w: number; d?: string; tip?: string }
  /** Accuracy disc, radius in metres. */
  | { k: 'circle'; p: Pt; r: number; c: string; tip?: undefined }
  /** Circle marker, radius in pixels. `id` = place provider_id, for taps. */
  | { k: 'dot'; p: Pt; r: number; c: string; w: number; f: string; o: number; tip?: string; id?: string }
  /** The truck with a known heading, degrees clockwise from north. */
  | { k: 'arrow'; p: Pt; h: number; c: string; tip?: string }

export type SceneProps = Pick<
  DriverRouteMapProps,
  | 'points' | 'progressFraction' | 'backupPoints' | 'showBackup' | 'terrainSegments' | 'hazards' | 'stops' | 'trafficSegments'
  | 'position' | 'positionKind' | 'accuracyM' | 'positionAgeSeconds' | 'headingDeg' | 'places' | 'selectedPlaceId'
>

export function sceneLayers(p: SceneProps): SceneLayer[] {
  const out: SceneLayer[] = []
  const points = p.points as Pt[]
  const { completed, remaining } = splitRoute(points, p.progressFraction)
  if (points.length > 1) {
    // Casing first so the route draws on top of it; a bare 6px blue line
    // disappears over water and motorway fills on this style.
    out.push({ k: 'line', p: points, c: ROUTE_CASING, w: 10 })
    out.push({ k: 'line', p: remaining as Pt[], c: ROUTE, w: 6 })
  }
  if (completed.length > 1) out.push({ k: 'line', p: completed as Pt[], c: COMPLETED, w: 6 })
  if (p.showBackup && p.backupPoints.length > 1) {
    out.push({ k: 'line', p: p.backupPoints as Pt[], c: ROUTE_CASING, w: 8 })
    out.push({ k: 'line', p: p.backupPoints as Pt[], c: BACKUP, w: 4, d: '10 8' })
  }
  // Terrain in caution and emergency hues. Solid: dash already means "planned".
  for (const o of terrainOverlays(points, p.terrainSegments ?? [])) {
    const steep = o.terrainClass === 'STEEP'
    out.push({ k: 'line', p: o.points as Pt[], c: steep ? TERRAIN_STEEP : TERRAIN_HILLY, w: 6, tip: steep ? 'Steep: 10% grade or more' : 'Hilly: 6–10% grade' })
  }
  // Fleet traffic as a thin stroke inside the route: the road stays blue,
  // the stretch says how the fleet is moving on it. Only KNOWN states.
  for (const t of p.trafficSegments ?? []) {
    const colour = TRAFFIC[t.state]
    if (!colour) continue
    const sliced = sliceRoute(points, t.start_m, t.end_m)
    if (sliced.length < 2) continue
    const age = t.newest_age_seconds == null ? '' : ` · ${Math.max(1, Math.round(t.newest_age_seconds / 60))} min ago`
    out.push({ k: 'line', p: sliced as Pt[], c: colour, w: 3, tip: `Fleet traffic: ${t.state.toLowerCase()}${t.observed_kmph != null && t.baseline_kmph != null ? ` · ${Math.round(t.observed_kmph)} km/h vs ${Math.round(t.baseline_kmph)} planned` : ''} · ${t.vehicle_count} truck${t.vehicle_count === 1 ? '' : 's'}${age}` })
  }
  for (const h of p.hazards ?? []) {
    out.push({ k: 'dot', p: [h.latitude, h.longitude], r: 6, c: TERRAIN_STEEP, w: 2, f: '#FFFFFF', o: 1, tip: `Recorded landslide${h.year ? ` (${h.year})` : ''}${h.name ? ` — ${h.name}` : ''}` })
  }
  p.stops.forEach((s, i) => {
    if (s.lat === null || s.lon === null) return
    out.push({ k: 'dot', p: [s.lat, s.lon], r: 7, c: '#FFFFFF', w: 2, f: i === 0 ? ORIGIN : ROUTE, o: 1, tip: s.name ?? 'Stop ' + s.sequence })
  })
  // Only from a real fix. Null draws nothing - never a placeholder.
  if (p.position !== null && p.positionKind !== null) {
    const live = p.positionKind === 'LIVE'
    const tip = live
      ? 'Live position' + (p.accuracyM === null ? '' : ', accurate to ' + Math.round(p.accuracyM) + ' m')
      : `Last known position — ${p.positionAgeSeconds == null ? 'age unavailable' : `${Math.round(p.positionAgeSeconds)}s ago`}`
    // The accuracy disc only when the platform reported one: an invented
    // radius is an invented claim about certainty.
    if (live && p.accuracyM !== null) out.push({ k: 'circle', p: p.position as Pt, r: p.accuracyM, c: LIVE })
    const heading = p.headingDeg
    if (live && heading != null && Number.isFinite(heading) && heading >= 0) out.push({ k: 'arrow', p: p.position as Pt, h: heading, c: LIVE, tip })
    else out.push({ k: 'dot', p: p.position as Pt, r: 9, c: live ? '#FFFFFF' : LAST_KNOWN, w: 3, f: live ? LIVE : 'transparent', o: live ? 1 : 0, tip })
  }
  // Roadside services LAST so a pin is never hidden under the route casing.
  // The category is in the tooltip as WORDS, not only in the colour.
  for (const place of p.places ?? []) {
    const sel = place.provider_id === p.selectedPlaceId
    out.push({ k: 'dot', p: [place.lat, place.lon], r: sel ? 11 : 7, c: '#FFFFFF', w: sel ? 3 : 2, f: CATEGORY_COLOUR[place.category] ?? '#75847D', o: 1, tip: (place.name ?? 'Unnamed') + ' - ' + place.category.toLowerCase(), id: place.provider_id })
  }
  return out
}
