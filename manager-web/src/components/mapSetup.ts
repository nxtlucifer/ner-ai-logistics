/**
 * What every MapLibre map in this console needs before it is constructed:
 * the stylesheet, a worker the bundler emits, and where to open.
 *
 * Imported only by lazily loaded map modules (FleetMap, MapPointPicker), so
 * MapLibre stays out of the entry chunk. Importing it from anything a page
 * loads eagerly puts the whole library back on the first paint.
 */

import { setWorkerUrl, type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import { cssToken, onThemeChange } from '../theme'

// Point MapLibre at a worker the bundler actually emits.
//
// Left alone, MapLibre derives the worker URL at RUNTIME from its own
// `import.meta.url` and guesses a sibling file:
//
//     new URL('./maplibre-gl-worker.mjs', import.meta.url)
//
// That string is built at runtime, so no bundler can see it and none emits the
// file. In a production build the request resolves to /assets/…-worker.mjs,
// which does not exist, and the SPA fallback answers it with index.html - a
// 200 with `Content-Type: text/html`, which the browser rejects for a module
// worker. MapLibre then has no worker, so every GeoJSON source stays unparsed:
// `isSourceLoaded()` never turns true and nothing is drawn. Raster tiles and
// DOM markers never touch the worker, so the map still LOOKS healthy while the
// planned route and the observed GPS track are silently missing.
//
// `?worker&url` makes the reference static, so Vite bundles the worker with its
// shared chunks and hands back the emitted asset's URL. This is one statement
// at module scope, not an effect: it must run before any Map is constructed,
// and every module that constructs one imports this module first.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

setWorkerUrl(maplibreWorkerUrl)

/** Assam, so an empty map still opens somewhere meaningful to these operators. */
export const NER_CENTRE: [number, number] = [92.9376, 26.2006]
export const NER_ZOOM = 6

export const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      // Required by the OSM tile usage policy.
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

// --- Theme ------------------------------------------------------------------
//
// Map paint cannot read a CSS variable, so each themed paint property names
// the tokens it is made of and is recomputed from the stylesheet whenever the
// theme changes. setPaintProperty, never setStyle: a style reload would drop
// the sources, the markers and the operator's camera.

/** [layer, paint property, value built from tokens]. */
export type ThemedPaint = [
  layer: string,
  property: Parameters<MapLibreMap['setPaintProperty']>[1],
  value: (token: (name: string) => string) => unknown,
]

/** The OSM raster: the tiles as published in Light, a neutral dark basemap in Dark. */
export const BASEMAP_PAINT: ThemedPaint[] = [
  ['osm', 'raster-brightness-min', (t) => Number(t('map-raster-brightness-min'))],
  ['osm', 'raster-brightness-max', (t) => Number(t('map-raster-brightness-max'))],
  ['osm', 'raster-hue-rotate', (t) => Number(t('map-raster-hue-rotate'))],
  ['osm', 'raster-saturation', (t) => Number(t('map-raster-saturation'))],
  ['osm', 'raster-contrast', (t) => Number(t('map-raster-contrast'))],
]

/** OSM_STYLE with the basemap already painted for the current theme, so a Dark map never opens Light. */
export function themedStyle(): StyleSpecification {
  const paint = Object.fromEntries(BASEMAP_PAINT.map(([, property, value]) => [property, value(cssToken)]))
  return { ...OSM_STYLE, layers: [{ id: 'osm', type: 'raster', source: 'osm', paint }] }
}

/** Paint the layers that exist now from the current tokens. A layer not yet added is skipped. */
export function paintFromTokens(map: MapLibreMap, paint: ThemedPaint[]): void {
  for (const [layer, property, value] of paint) {
    if (!map.getLayer(layer)) continue
    // The value is typed loosely on purpose: the table spans several layer types.
    map.setPaintProperty(layer, property, value(cssToken) as never)
  }
}

/**
 * Keep `paint` in step with the theme: once when the style has loaded (layers
 * added in an earlier 'load' listener get their colours in the same frame),
 * then on every theme change. Returns the unsubscribe; call it before
 * `map.remove()`.
 */
export function followTheme(map: MapLibreMap, paint: ThemedPaint[]): () => void {
  const apply = () => paintFromTokens(map, paint)
  map.on('load', apply)
  const stop = onThemeChange(apply)
  return () => {
    stop()
    map.off('load', apply)
  }
}
