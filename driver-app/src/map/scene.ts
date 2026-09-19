/**
 * What the map draws, as data. ONE builder for both platforms.
 *
 * The web map turns these into Leaflet layers in a DOM it owns; the native
 * map posts the same list into a WebView that runs Leaflet. The draw order,
 * the colours and the wording of every tooltip live here once, so a hazard
 * that is red on the laptop cannot be amber on the phone.
 *
 * COLOURS come from the theme (`MAP_PALETTES` in theme.ts, REG-5): chrome
 * with a Light and a Dark value, data hues with one meaning each.
 */

import { DARK, MAP_LIGHT, MAP_PALETTES, type MapPalette, type ThemeMode } from '../theme'
import { sliceRoute, splitRoute, terrainOverlays } from './routeDisplay'
import type { DriverRouteMapProps } from './types'

export type MapColours = MapPalette
export const MAP_COLOURS = MAP_PALETTES

/**
 * ONE location-marker system, colour + shape together, never colour alone:
 *   GPS, moving        live chevron, white halo, live accuracy disc
 *   GPS, parked        live dot, white halo, live accuracy disc
 *   NETWORK            amber dot, white halo, larger amber accuracy disc
 *   LAST KNOWN         grey dot, dashed grey disc (the fix is old)
 *   no fix             nothing - a marker is a claim about where the truck is
 * The accuracy disc is capped so a 900 m Wi-Fi fix does not paint the whole
 * screen; the chip still prints the real number.
 */
export const ACCURACY_DISC_MAX_M = 150

/** The truck as a triangle, rotated by heading. Inline CSS: the web map's
 *  divIcon and the WebView page both paste it verbatim, then add the layer's
 *  colour (`border-bottom-color`, the theme's gpsLive) and the rotation. */
export const ARROW_STYLE = `width:0;height:0;border-left:11px solid transparent;border-right:11px solid transparent;border-bottom:22px solid;filter:drop-shadow(0 0 2px ${MAP_LIGHT.halo});`

/**
 * Relief shading for the driver map, with a keyless fallback.
 *
 * PREFERRED: MapTiler hillshade. The key is a client key inlined at build
 * time from EXPO_PUBLIC_MAPTILER_KEY and restricted per origin/app in the
 * MapTiler dashboard; it is never in source. Terrain-RGB from the same
 * account is elevation ENCODING - the risk engine's elevation evidence
 * stays Copernicus/SRTM through the backend.
 *
 * FALLBACK: OpenTopoMap, when no key is present. Verified 20 September
 * 2026 - CC-BY-SA 3.0, no key, tiles served for z8 over 26°N 92°E, and
 * embedding in applications is permitted with attribution. It is a relief
 * MAP rather than a pure hillshade, so it carries contours as well as
 * shading; at the overlay opacity the two read much the same.
 *
 * WHY A FALLBACK AT ALL: a build without the key previously had no terrain
 * and said nothing about why. A feature that silently disappears with a
 * missing credential is indistinguishable from one that is broken.
 *
 * Neither source feeds a route decision. Shaded ground is context; the
 * gradient figures the policy reads come from the backend's DEM.
 */
const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY

export const HILLSHADE_URL: string =
  MAPTILER_KEY
    ? `https://api.maptiler.com/tiles/hillshade/{z}/{x}/{y}.webp?key=${MAPTILER_KEY}`
    : 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'

export const HILLSHADE_ATTRIBUTION = MAPTILER_KEY
  ? '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a>'
  : 'Relief: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), SRTM'

/** Which source is actually in use, for a screen that wants to say so. */
export const HILLSHADE_SOURCE: 'maptiler' | 'opentopomap' =
  MAPTILER_KEY ? 'maptiler' : 'opentopomap'

type Pt = [number, number]
export type SceneLayer = (
  | { k: 'line'; p: Pt[]; c: string; w: number; d?: string; tip?: string }
  /** Accuracy disc, radius in metres. */
  | { k: 'circle'; p: Pt; r: number; c: string; d?: string; tip?: undefined }
  /** Circle marker, radius in pixels. `id` = place provider_id, for taps. */
  | { k: 'dot'; p: Pt; r: number; c: string; w: number; f: string; o: number; tip?: string; id?: string }
  /** The truck with a known heading, degrees clockwise from north. */
  | { k: 'arrow'; p: Pt; h: number; c: string; tip?: string }
) & {
  /**
   * Changes with every fix: the truck, its accuracy disc, the driven part of
   * the road. Everything else - the route, backup, terrain, traffic, hazards,
   * stops, places - is static between plans. A renderer redraws the two sets
   * separately, so a 4,000-point polyline is not torn down and rebuilt each
   * time the phone reports where it is.
   */
  live?: true
}

export type SceneProps = Pick<
  DriverRouteMapProps,
  | 'points' | 'progressFraction' | 'backupPoints' | 'showBackup' | 'terrainSegments' | 'hazards' | 'stops' | 'trafficSegments'
  | 'position' | 'positionKind' | 'positionSource' | 'accuracyM' | 'positionAgeSeconds' | 'headingDeg' | 'places' | 'selectedPlaceId'
>

export function sceneLayers(p: SceneProps, mode: ThemeMode = 'light'): SceneLayer[] {
  const c = MAP_COLOURS[mode]
  const out: SceneLayer[] = []
  const points = p.points as Pt[]
  const { completed } = splitRoute(points, p.progressFraction)
  if (points.length > 1) {
    // Casing first so the route draws on top of it; a bare 6px blue line
    // disappears over water and motorway fills on this style. The whole road
    // is drawn in route blue and the driven part is painted over it as a
    // live layer, so progress never redraws the road itself.
    out.push({ k: 'line', p: points, c: c.casing, w: 10 })
    out.push({ k: 'line', p: points, c: c.route, w: 6 })
  }
  if (completed.length > 1) out.push({ k: 'line', p: completed as Pt[], c: c.completed, w: 6, live: true })
  if (p.showBackup && p.backupPoints.length > 1) {
    out.push({ k: 'line', p: p.backupPoints as Pt[], c: c.casing, w: 8 })
    out.push({ k: 'line', p: p.backupPoints as Pt[], c: c.backup, w: 4, d: '10 8' })
  }
  // Terrain in caution and emergency hues. Solid: dash already means "planned".
  for (const o of terrainOverlays(points, p.terrainSegments ?? [])) {
    const steep = o.terrainClass === 'STEEP'
    // Only where the edge differs from the route casing already under it, so
    // Light draws exactly what it drew before.
    if (c.terrainCasing !== c.casing) out.push({ k: 'line', p: o.points as Pt[], c: c.terrainCasing, w: 10 })
    out.push({ k: 'line', p: o.points as Pt[], c: steep ? c.steep : c.hilly, w: 6, tip: steep ? 'Steep: 10% grade or more' : 'Hilly: 6–10% grade' })
  }
  // Fleet traffic as a thin stroke inside the route: the road stays blue,
  // the stretch says how the fleet is moving on it. Only KNOWN states.
  for (const t of p.trafficSegments ?? []) {
    const colour = c.traffic[t.state]
    if (!colour) continue
    const sliced = sliceRoute(points, t.start_m, t.end_m)
    if (sliced.length < 2) continue
    const age = t.newest_age_seconds == null ? '' : ` · ${Math.max(1, Math.round(t.newest_age_seconds / 60))} min ago`
    out.push({ k: 'line', p: sliced as Pt[], c: colour, w: 3, tip: `Fleet traffic: ${t.state.toLowerCase()}${t.observed_kmph != null && t.baseline_kmph != null ? ` · ${Math.round(t.observed_kmph)} km/h vs ${Math.round(t.baseline_kmph)} planned` : ''} · ${t.vehicle_count} truck${t.vehicle_count === 1 ? '' : 's'}${age}` })
  }
  for (const h of p.hazards ?? []) {
    out.push({ k: 'dot', p: [h.latitude, h.longitude], r: 6, c: c.steep, w: 2, f: c.halo, o: 1, tip: `Recorded landslide${h.year ? ` (${h.year})` : ''}${h.name ? ` — ${h.name}` : ''}` })
  }
  p.stops.forEach((s, i) => {
    if (s.lat === null || s.lon === null) return
    out.push({ k: 'dot', p: [s.lat, s.lon], r: 7, c: c.halo, w: 2, f: i === 0 ? c.origin : c.route, o: 1, tip: s.name ?? 'Stop ' + s.sequence })
  })
  // Only from a real fix. Null draws nothing - never a placeholder.
  if (p.position !== null && p.positionKind !== null) {
    const live = p.positionKind === 'LIVE'
    const coarse = p.positionSource === 'NETWORK'
    const colour = !live ? c.gpsLastKnown : coarse ? c.gpsNetwork : c.gpsLive
    const tip = live
      ? (coarse ? 'Network position' : 'GPS position') + (p.accuracyM === null ? '' : ', accurate to ' + Math.round(p.accuracyM) + ' m')
      : `Last known position — ${p.positionAgeSeconds == null ? 'age unavailable' : `${Math.round(p.positionAgeSeconds)}s ago`}`
    // The accuracy disc only when the platform reported one: an invented
    // radius is an invented claim about certainty.
    if (p.accuracyM !== null) out.push({ k: 'circle', p: p.position as Pt, r: Math.min(p.accuracyM, ACCURACY_DISC_MAX_M), c: colour, d: live ? undefined : '6 6', live: true })
    const heading = p.headingDeg
    if (live && !coarse && heading != null && Number.isFinite(heading) && heading >= 0) out.push({ k: 'arrow', p: p.position as Pt, h: heading, c: c.gpsLive, tip, live: true })
    else out.push({ k: 'dot', p: p.position as Pt, r: coarse ? 10 : 9, c: c.halo, w: 3, f: colour, o: 1, tip, live: true })
  }
  // Roadside services LAST so a pin is never hidden under the route casing.
  // The category is in the tooltip as WORDS, not only in the colour.
  for (const place of p.places ?? []) {
    const sel = place.provider_id === p.selectedPlaceId
    out.push({ k: 'dot', p: [place.lat, place.lon], r: sel ? 11 : 7, c: c.halo, w: sel ? 3 : 2, f: c.category[place.category] ?? c.place, o: 1, tip: (place.name ?? 'Unnamed') + ' - ' + place.category.toLowerCase(), id: place.provider_id })
  }
  return out
}

/**
 * Leaflet's own chrome and the basemap in Dark, as CSS for one scope
 * (`.rasta-map-dark` on web, `html.dark` in the phone's WebView).
 *
 * The filter is on `.leaflet-tile-pane` ONLY. Tiles are the one thing that
 * is light by construction; inverting them (then rotating the hue back and
 * draining the colour) gives a near-black basemap from the same OSM images,
 * with no second tile provider and no extra request. The route, markers and
 * tooltips live in other panes and keep their true colour.
 */
export function leafletDarkCss(scope: string): string {
  const tip = DARK.surfaceRaised
  return [
    `${scope} .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.95) contrast(.9) saturate(.12)}`,
    `${scope} .leaflet-container{background:${DARK.bg}}`,
    // Leaflet sets this one as .leaflet-container .leaflet-control-attribution:
    // match that specificity and add the scope, so load order cannot matter.
    `${scope} .leaflet-container .leaflet-control-attribution{background:${DARK.surface}CC;color:${DARK.textMuted}}`,
    `${scope} .leaflet-control-attribution a{color:${DARK.info}}`,
    `${scope} .leaflet-bar a{background:${DARK.surfaceRaised};color:${DARK.text};border-bottom-color:${DARK.border}}`,
    `${scope} .leaflet-tooltip{background:${tip};color:${DARK.text};border-color:${DARK.border}}`,
    `${scope} .leaflet-tooltip-top:before{border-top-color:${tip}}`,
    `${scope} .leaflet-tooltip-bottom:before{border-bottom-color:${tip}}`,
    `${scope} .leaflet-tooltip-left:before{border-left-color:${tip}}`,
    `${scope} .leaflet-tooltip-right:before{border-right-color:${tip}}`,
  ].join(' ')
}
