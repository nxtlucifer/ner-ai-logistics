/**
 * The operational fleet map.
 *
 * MapLibre GL JS over OpenStreetMap raster tiles: no API key, no billing
 * account, no vendor lock. The style is declared inline rather than fetched
 * from a hosted style URL, so the map has exactly one external dependency - the
 * tile server - and nothing else to fail at load.
 *
 * WHAT IS AND IS NOT PLOTTED
 *
 * Only trips with a real observed position get a marker. A trip whose truck has
 * never reported (`NO_LOCATION`) appears in the list and in the counts but is
 * NOT placed on the map, because there is no coordinate for it and inventing
 * one - the depot, the region centre, anywhere - would put a truck on a
 * dispatcher's screen in a place nobody has observed it.
 *
 * Marker colour is the server's freshness label, never a locally recomputed
 * one. See app/domain/telemetry_policy.py.
 *
 * NO AUTO-PAN ON POLL. The camera moves when the operator asks - selecting a
 * truck, pressing "Fit fleet" - and never on a background refresh. A map that
 * re-centres every ten seconds cannot be read, let alone worked with.
 */

import { useEffect, useRef, useState } from 'react'
import { Navigation2 } from 'lucide-react'
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  type GeoJSONSource,
  type PaddingOptions,
} from 'maplibre-gl'

import { applyMapMode, HILLSHADE_PAINT, type MapMode } from './mapTerrain'
import { usePlacesLayer } from './PlacesLayer'
import { PoiChips } from './PoiChips'
import type { PlaceCategory } from '../api/client'
// MapLibre's stylesheet and worker URL are set in ./mapSetup, before any Map
// is constructed; every module that constructs one imports it.
import {
  BASEMAP_PAINT,
  followTheme,
  NER_CENTRE,
  NER_ZOOM,
  paintFromTokens,
  themedStyle,
  type ThemedPaint,
} from './mapSetup'

import type { FleetTrip, Freshness, Position } from '../api/client'
import { drawableSegments, isolatedFixes, splitTrack } from './track'
import { labelsToHide } from './markerLabels'
import { sliceRoute, terrainOverlays } from './terrain'

/** Freshness hues, from the theme tokens (index.css, REG-1). In Dark, LIVE
 *  is the accent itself rather than a green of its own. */
const MARKER_COLOUR: Record<Freshness, string> = {
  LIVE: 'var(--marker-live)',
  STALE: 'var(--marker-stale)',
  NO_CONTACT: 'var(--marker-no-contact)',
  // Never rendered - a trip with no position is not placed. Present so the
  // record is total and a future freshness value cannot silently fall through.
  NO_LOCATION: 'var(--marker-none)',
}

/**
 * Overlay colours, from the theme tokens (index.css). The layers below are
 * added without colour; these paint them in the same 'load' dispatch and
 * again on every theme change. In Light every value is the one this map
 * always drew; in Dark the route is the lighter blue at full opacity (at
 * 0.7 it fell under 3:1 on the grey the forest turns into) and the observed
 * track goes from ink to near-white, which is what stays readable on a dark
 * basemap.
 */
const OVERLAY_PAINT: ThemedPaint[] = [
  ['planned-route', 'line-color', (t) => t('route')],
  ['planned-route', 'line-opacity', (t) => Number(t('map-route-opacity'))],
  ['terrain-overlay', 'line-color', (t) => ['match', ['get', 'cls'], 'STEEP', t('map-steep'), t('map-hilly')]],
  [
    'traffic-overlay',
    'line-color',
    (t) => ['match', ['get', 'state'], 'CONGESTED', t('map-congested'), 'SLOW', t('map-slow'), t('map-flowing')],
  ],
  ['hazard-sites', 'circle-color', (t) => t('surface-raised')],
  ['hazard-sites', 'circle-stroke-color', (t) => t('map-steep')],
  ['observed-track', 'line-color', (t) => t('text')],
  ['observed-fixes', 'circle-color', (t) => t('text')],
  ['observed-fixes', 'circle-stroke-color', (t) => t('surface-raised')],
]
const THEMED_PAINT = [...BASEMAP_PAINT, ...OVERLAY_PAINT, ...HILLSHADE_PAINT]

export interface FleetMapProps {
  trips: FleetTrip[]
  selectedTripId: string | null
  onSelect: (tripId: string) => void
  /** Observed GPS breadcrumb for the selected trip, newest first. */
  track: Position[]
  /**
   * The PLANNED route for the selected trip, as [lat, lon] in travel order.
   *
   * Drawn deliberately unlike the observed track: dashed, in a different
   * colour, and underneath it. One is where a provider says the truck should
   * go; the other is where the truck has actually been. Rendering them alike
   * would let a dispatcher read a plan as an observation — which is the same
   * class of mistake as plotting a truck that has never reported.
   */
  plannedRoute?: [number, number][]
  /**
   * DEM segments of the previewed route, from the risk payload. Only HILLY
   * and STEEP stretches are painted - caution amber and emergency red over
   * the planned blue - so "flat" never gets a colour of its own.
   */
  terrainSegments?: { start_m: number; end_m: number; terrain_class: string }[]
  /** Precisely-placed recorded landslides within the corridor buffer. */
  hazards?: { latitude: number; longitude: number; year: number | null; name: string | null }[]
  /** RASTA fleet traffic per stretch; only KNOWN states are painted, inside the route. */
  trafficSegments?: { start_m: number; end_m: number; state: string }[]
  /** Draft preview: frame once when the chosen route changes. */
  previewRouteId?: string
  /**
   * The roadside-services layer, when the PAGE owns its toggles (the Fleet
   * map card puts them in its header, clear of the map). Left undefined, the
   * map shows its own chips at the top; null with no chips means "none".
   */
  placeCategory?: PlaceCategory | null
  /**
   * A glance, not a workbench (the Overview card): no trip tools, no route
   * toggles, no 2D/3D - there is no selected trip for them to act on.
   */
  compact?: boolean
  /** The frame's size and edge; the default is the Fleet page's map-first clamp. */
  frameClassName?: string
}

interface MarkerHandle {
  marker: Marker
  element: HTMLButtonElement
  dot: HTMLSpanElement
  label: HTMLSpanElement
  /** Stacking and label priority: selected, then LIVE, STALE, NO CONTACT. */
  z: number
}

/**
 * Restyle a marker in place.
 *
 * In place rather than by swapping the element, which would mean writing to
 * MapLibre's private `_element`. Colour, label and the selection ring all
 * derive from here, so there is one place they can disagree.
 */
function paintMarker(
  handle: MarkerHandle,
  trip: FleetTrip,
  isSelected: boolean,
): void {
  const colour = MARKER_COLOUR[trip.freshness]
  // ISSUE 6b. A manager looking at the map is looking for a PERSON - "where
  // is Bipul" - not for a plate. The plate is one click away in the drawer,
  // and stays in the accessible name so a screen reader still gets the
  // identity that matters to anyone outside the company.
  handle.element.setAttribute(
    'aria-label',
    `${trip.driver_name}, ${trip.registration_number}, ${trip.freshness}`,
  )
  // Opaque: at 0.82 a light basemap showed through and the red (No
  // contact) name fell to 3.7:1 in Light. On the solid marker chip every
  // freshness colour clears 4.5:1 at 11px (theme.test.tsx); selection is the
  // light edge and ring.
  handle.element.style.background = 'var(--marker-bg)'
  handle.element.style.border = `2px solid ${isSelected ? 'var(--marker-selected)' : colour}`
  handle.element.style.color = colour
  handle.element.style.boxShadow = isSelected
    ? '0 0 0 4px var(--marker-selected-ring)'
    : 'none'
  handle.dot.style.background = colour
  handle.label.textContent = trip.driver_name || trip.registration_number
  // Fresher on top (MAP-1): at one depot a NO CONTACT label hid the only
  // LIVE truck. The selected one is above them all.
  handle.z = isSelected ? 4 : (FRESHNESS_Z[trip.freshness] ?? 0)
  handle.element.style.zIndex = String(handle.z)
  handle.element.title = handle.label.textContent
}

const FRESHNESS_Z: Partial<Record<Freshness, number>> = { LIVE: 3, STALE: 2, NO_CONTACT: 1 }

/** Fold every label that would cover a more important one to its dot
 *  (markerLabels.ts). Measured with every label shown, then written once. */
function declutter(handles: Iterable<MarkerHandle>): void {
  const list = [...handles]
  for (const h of list) h.label.style.display = ''
  const hide = labelsToHide(
    list.map((h, i) => {
      const r = h.element.getBoundingClientRect()
      return { id: String(i), priority: h.z, left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    }),
  )
  list.forEach((h, i) => { h.label.style.display = hide.has(String(i)) ? 'none' : '' })
}

/**
 * Camera padding that keeps a framed route clear of the map's own overlays:
 * the tool and chip column (top-left), the legend (top-right) and the zoom
 * and view controls along the foot. A flat 64 put the Pickup pin under the
 * review map's chip row. Measured, not assumed: the chips wrap with the
 * width, and on a phone-width frame they make a tall column, so the route
 * goes under both, or beside the column, whichever leaves it more room.
 */
function overlayPadding(instance: MapLibreMap): PaddingOptions {
  const frame = instance.getContainer().parentElement
  const F = frame?.getBoundingClientRect()
  if (!frame || !F?.height) return { top: 64, bottom: 64, left: 64, right: 64 }
  const boxes = (selector: string) =>
    [...frame.querySelectorAll(selector)].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0)
  // A pin is centred on its point: half its height (or width) plus a gap.
  const PIN_H = 28
  const PIN_W = 64
  const [tools] = boxes('[data-map-overlay="tools"]')
  const [legend] = boxes('[data-map-overlay="legend"]')
  const under = (r?: DOMRect) => (r ? r.bottom - F.top : 0) + PIN_H
  const foot =
    Math.max(0, ...boxes('[data-map-overlay="foot"], .maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right').map((r) => F.bottom - r.top)) + PIN_H
  const candidates = [
    { top: Math.max(under(tools), under(legend)), bottom: foot, left: PIN_W, right: PIN_W },
    { top: under(legend), bottom: foot, left: (tools ? tools.right - F.left : 0) + PIN_W, right: PIN_W },
    { top: under(tools), bottom: foot, left: PIN_W, right: (legend ? F.right - legend.left : 0) + PIN_W },
  ]
  const room = (p: (typeof candidates)[number]) =>
    Math.max(0, F.width - p.left - p.right) * Math.max(0, F.height - p.top - p.bottom)
  const best = candidates.reduce((a, c) => (room(c) > room(a) ? c : a))
  // A frame too small for any of them still gets framed, overlays or not:
  // MapLibre refuses a fit whose padding leaves no room.
  return room(best) > 0 ? best : { top: 16, bottom: 16, left: 16, right: 16 }
}

function createMarkerElement(): {
  element: HTMLButtonElement
  dot: HTMLSpanElement
  label: HTMLSpanElement
} {
  const el = document.createElement('button')
  el.type = 'button'
  el.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:6px',
    'padding:3px 8px 3px 4px',
    'border-radius:999px',
    'cursor:pointer',
    'font:600 11px/1 ui-sans-serif,system-ui,sans-serif',
    'white-space:nowrap',
  ].join(';')

  const dot = document.createElement('span')
  dot.style.cssText = [
    'width:9px',
    'height:9px',
    'border-radius:999px',
    'flex:none',
  ].join(';')

  const label = document.createElement('span')
  el.append(dot, label)
  return { element: el, dot, label }
}

export default function FleetMap({
  trips,
  selectedTripId,
  onSelect,
  track,
  plannedRoute,
  terrainSegments,
  trafficSegments,
  hazards,
  previewRouteId,
  placeCategory: pagePlaceCategory,
  compact = false,
  frameClassName = 'h-[clamp(420px,calc(100dvh-300px),760px)] rounded-[14px] border border-line',
}: FleetMapProps) {
  const container = useRef<HTMLDivElement | null>(null)
  const map = useRef<MapLibreMap | null>(null)
  const markers = useRef(new Map<string, MarkerHandle>())
  const ready = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [mapError, setMapError] = useState(false)
  // Held in a ref so the marker click handler never closes over a stale prop.
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  // Layer visibility. Two lines that mean different things need to be
  // separable: the only way to be sure a break in the observed track is a hole
  // in the data rather than the planned route showing through is to turn the
  // other one off.
  /**
   * 2D / Terrain / 3D.
   *
   * `standard` is the default and stays the default: the flat map with a
   * route on it is the product, and terrain is an inspection aid on top of
   * it. `terrainNote` carries a failure back to the operator in words
   * rather than leaving them wondering why nothing happened.
   */
  /**
   * Which service layer is on, or null for none.
   *
   * One at a time, deliberately. Four categories at once is 700 pins over
   * a corridor a dispatcher is trying to read, and the question is always
   * "where is the nearest X", never "show me everything".
   */
  const [ownPlaceCategory, setPlaceCategory] = useState<PlaceCategory | null>(null)
  const placeCategory = pagePlaceCategory === undefined ? ownPlaceCategory : pagePlaceCategory

  const [mapMode, setMapMode] = useState<MapMode>('standard')
  const [terrainNote, setTerrainNote] = useState<string | null>(null)

  const [showPlanned, setShowPlanned] = useState(true)
  const [showObserved, setShowObserved] = useState(true)

  // Create once. The map is imperative and long-lived; re-creating it on a
  // prop change would drop the operator's zoom and pan on every poll.
  useEffect(() => {
    if (!container.current || map.current) return
    // Captured now: by the time cleanup runs the ref may point elsewhere.
    const handles = markers.current

    const instance = new MapLibreMap({
      container: container.current,
      style: themedStyle(),
      center: NER_CENTRE,
      zoom: NER_ZOOM,
      attributionControl: { compact: true },
    })
    // Zoom bottom-left, as the reference has it. The compass is our own
    // button in the top-left tool row, so Tab reaches the tools before the
    // markers and the zoom after them - the order the eye reads the map in.
    instance.addControl(new NavigationControl({ showCompass: false }), 'bottom-left')
    instance.on('error', () => setMapError(true))
    // A zoom moves markers towards or away from each other.
    instance.on('moveend', () => declutter(handles.values()))
    instance.on('load', () => {
      ready.current = true
      setLoaded(true)
      // Planned route FIRST, so it sits beneath the observed track. Where the
      // two diverge, what actually happened stays on top.
      instance.addSource('planned-route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      instance.addLayer({
        id: 'planned-route',
        type: 'line',
        source: 'planned-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          // Terrain route blue, dashed, against the observed track's solid ink.
          // The DASH is what carries the distinction, not the hue: a dispatcher
          // with a red-green or blue-yellow deficiency still reads "planned"
          // from the broken line. Colour and opacity: OVERLAY_PAINT (tokens).
          'line-width': 4,
          'line-dasharray': [2, 2],
        },
      })

      // Terrain over the planned route, solid so it cannot be mistaken for
      // the dashed plan. Colour by class from the feature property.
      instance.addSource('terrain-overlay', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      instance.addLayer({
        id: 'terrain-overlay',
        type: 'line',
        source: 'terrain-overlay',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 5,
          'line-opacity': 0.9,
        },
      })
      instance.addSource('traffic-overlay', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      instance.addLayer({
        id: 'traffic-overlay',
        type: 'line',
        source: 'traffic-overlay',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 2.5,
          'line-opacity': 0.95,
        },
      })
      instance.addSource('hazard-sites', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      instance.addLayer({
        id: 'hazard-sites',
        type: 'circle',
        source: 'hazard-sites',
        paint: {
          'circle-radius': 5,
          'circle-stroke-width': 2,
        },
      })

      instance.addSource('observed-track', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      instance.addLayer({
        id: 'observed-track',
        type: 'line',
        source: 'observed-track',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 3,
          'line-opacity': 0.85,
        },
      })

      // A fix with no neighbour close enough in time to draw a line to is a
      // place the truck was seen, and that is all it is. Drawn as a point, so
      // it can never read as a journey.
      instance.addSource('observed-fixes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      instance.addLayer({
        id: 'observed-fixes',
        type: 'circle',
        source: 'observed-fixes',
        paint: {
          'circle-radius': 4,
          'circle-opacity': 0.9,
          'circle-stroke-width': 1,
        },
      })
    })
    // After the listener above, so its layers exist when this paints them.
    const stopTheme = followTheme(instance, THEMED_PAINT)
    map.current = instance

    return () => {
      stopTheme()
      instance.remove()
      map.current = null
      ready.current = false
      handles.clear()
    }
  }, [])

  // Markers: create, move, restyle and remove to match the current fleet.
  useEffect(() => {
    const instance = map.current
    if (!instance) return

    const plotted = new Set<string>()

    for (const trip of trips) {
      // The rule that keeps the map honest: no position, no marker.
      if (!trip.position) continue
      plotted.add(trip.trip_id)

      const { lat, lon } = trip.position.location
      let handle = markers.current.get(trip.trip_id)

      if (!handle) {
        const { element, dot, label } = createMarkerElement()
        element.addEventListener('click', (event) => {
          event.stopPropagation()
          selectRef.current(trip.trip_id)
        })
        handle = {
          marker: new Marker({ element }).setLngLat([lon, lat]).addTo(instance),
          element,
          dot,
          label,
          z: 0,
        }
        markers.current.set(trip.trip_id, handle)
      } else {
        handle.marker.setLngLat([lon, lat])
      }

      paintMarker(handle, trip, trip.trip_id === selectedTripId)
    }

    // A trip that ended, or lost its position, must lose its marker.
    for (const [tripId, handle] of markers.current) {
      if (!plotted.has(tripId)) {
        handle.marker.remove()
        markers.current.delete(tripId)
      }
    }
    declutter(markers.current.values())
  }, [trips, selectedTripId])

  // The observed breadcrumb for the selected trip.
  useEffect(() => {
    const instance = map.current
    if (!instance || !ready.current) return
    const source = instance.getSource('observed-track') as
      | GeoJSONSource
      | undefined
    if (!source) return

    // ONE LINE PER OBSERVED RUN, never one line through every fix.
    //
    // `splitTrack` orders the fixes oldest-first and cuts the sequence wherever
    // the next one cannot honestly be joined to the last: a silence longer than
    // the server's own out-of-contact window, a speed no truck reaches, or a
    // pair that cannot be ordered at all. See `track.ts` for the measured case
    // that made this necessary.
    const segments = splitTrack(track)
    const fixes = instance.getSource('observed-fixes') as
      | GeoJSONSource
      | undefined

    source.setData({
      type: 'FeatureCollection',
      features: drawableSegments(segments).map((segment) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: segment.points.map(
            (p) => [p.location.lon, p.location.lat] as [number, number],
          ),
        },
        properties: { brokenBy: segment.brokenBy },
      })),
    })

    fixes?.setData({
      type: 'FeatureCollection',
      features: isolatedFixes(segments).map((p) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [p.location.lon, p.location.lat] as [number, number],
        },
        properties: {},
      })),
    })
  }, [track, loaded])

  // The PLANNED route for the selected trip. Same shape as above, different
  // source, so the two can never be confused for one another in the data.
  useEffect(() => {
    const instance = map.current
    if (!instance || !ready.current) return
    const source = instance.getSource('planned-route') as
      | GeoJSONSource
      | undefined
    if (!source) return

    // Already in travel order from the API; only the lat/lon pair is flipped,
    // because GeoJSON is [lon, lat].
    const coordinates = (plannedRoute ?? []).map(
      ([lat, lon]) => [lon, lat] as [number, number],
    )

    source.setData(
      coordinates.length >= 2
        ? {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates },
            properties: {},
          }
        : { type: 'FeatureCollection', features: [] },
    )
  }, [plannedRoute, loaded])

  // Terrain stretches and recorded slide sites for the previewed route.
  useEffect(() => {
    const instance = map.current
    if (!instance || !ready.current) return
    const overlay = instance.getSource('terrain-overlay') as GeoJSONSource | undefined
    const sites = instance.getSource('hazard-sites') as GeoJSONSource | undefined
    const traffic = instance.getSource('traffic-overlay') as GeoJSONSource | undefined
    if (!overlay || !sites) return
    const route = plannedRoute ?? []
    traffic?.setData({
      type: 'FeatureCollection',
      features: (trafficSegments ?? [])
        .filter(t => t.state === 'NORMAL' || t.state === 'SLOW' || t.state === 'CONGESTED')
        .map(t => ({ state: t.state, points: sliceRoute(route, t.start_m, t.end_m) }))
        .filter(t => t.points.length > 1)
        .map(t => ({
          type: 'Feature' as const,
          properties: { state: t.state },
          geometry: { type: 'LineString' as const, coordinates: t.points.map(([lat, lon]) => [lon, lat]) },
        })),
    })
    overlay.setData({
      type: 'FeatureCollection',
      features: terrainOverlays(route, terrainSegments ?? []).map(o => ({
        type: 'Feature',
        properties: { cls: o.terrainClass },
        geometry: { type: 'LineString', coordinates: o.points.map(([lat, lon]) => [lon, lat]) },
      })),
    })
    sites.setData({
      type: 'FeatureCollection',
      features: (hazards ?? []).map(h => ({
        type: 'Feature',
        properties: { year: h.year, name: h.name },
        geometry: { type: 'Point', coordinates: [h.longitude, h.latitude] },
      })),
    })
  }, [plannedRoute, terrainSegments, hazards, trafficSegments, loaded])

  // Apply layer visibility. Separate from the data effects so toggling does not
  // rebuild a source.
  useEffect(() => {
    const instance = map.current
    if (!instance || !ready.current) return
    const set = (id: string, on: boolean) => {
      if (instance.getLayer(id)) {
        instance.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
      }
    }
    set('planned-route', showPlanned)
    set('observed-track', showObserved)
    set('observed-fixes', showObserved)
  }, [showPlanned, showObserved, track, plannedRoute, loaded])

  // Camera follows SELECTION, which is an operator action - never a poll.
  useEffect(() => {
    const instance = map.current
    if (!instance || !selectedTripId) return
    const trip = trips.find((t) => t.trip_id === selectedTripId)
    if (!trip?.position) return

    instance.easeTo({
      center: [trip.position.location.lon, trip.position.location.lat],
      zoom: Math.max(instance.getZoom(), 9),
      duration: 600,
    })
    // Deliberately keyed on the id alone. Including `trips` would re-centre on
    // every poll, dragging the map out from under anyone reading it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTripId])

  useEffect(() => {
    const instance = map.current
    if (!instance || !loaded || !previewRouteId || !plannedRoute?.length) return
    const corners = plannedRoute.map(([lat, lon]) => [lon, lat] as [number, number])
    const bounds = corners.reduce((b, point) => b.extend(point), new LngLatBounds(corners[0], corners[0]))
    instance.fitBounds(bounds, { padding: overlayPadding(instance), maxZoom: 14, duration: 0 })
    const pins = [corners[0], corners.at(-1)!].map((point, index) => {
      const label = document.createElement('span')
      const isDestination = index !== 0
      label.textContent = isDestination ? 'Destination' : 'Pickup'
      // The destination is the end of the job and is drawn to be found at a
      // glance: filled, darker, and a size up. Pickup stays the quiet one -
      // by the time a manager is watching the map, the load is already on.
      label.style.cssText = isDestination
        ? 'background:var(--pin-destination);color:var(--on-pin-destination);padding:7px 13px;border:2px solid var(--pin-edge);border-radius:20px;font:700 13px system-ui;box-shadow:0 2px 8px var(--pin-shadow)'
        : 'background:var(--pin-pickup);color:var(--on-pin-pickup);padding:6px 10px;border:2px solid var(--pin-destination);border-radius:20px;font:600 12px system-ui'
      return new Marker({ element: label }).setLngLat(point).addTo(instance)
    })
    return () => { pins.forEach(pin => pin.remove()) }
    // Camera follows a deliberate corridor change, never a GPS poll.
  }, [previewRouteId, loaded])

  const places = usePlacesLayer(loaded ? map.current : null, placeCategory)

  // Applying the mode is an effect, not a click handler: the map may not
  // exist yet on first paint, and a style reload would otherwise drop the
  // hillshade silently.
  useEffect(() => {
    const m = map.current
    if (!m || !loaded) return
    const result = applyMapMode(m, mapMode)
    // A hillshade just added takes the current theme's colours.
    paintFromTokens(m, HILLSHADE_PAINT)
    setTerrainNote(result.failure)
    // A refused mode must not leave the toggle claiming it is on.
    if (result.mode !== mapMode) setMapMode(result.mode)
  }, [mapMode, loaded])

  const fitFleet = () => {
    const instance = map.current
    if (!instance) return
    const located = trips.filter((t) => t.position)
    if (located.length === 0) {
      instance.easeTo({ center: NER_CENTRE, zoom: NER_ZOOM })
      return
    }
    const bounds = located.reduce(
      (acc, t) => acc.extend([t.position!.location.lon, t.position!.location.lat]),
      new LngLatBounds(
        [located[0].position!.location.lon, located[0].position!.location.lat],
        [located[0].position!.location.lon, located[0].position!.location.lat],
      ),
    )
    // Clear of the legend and tools, as "Fit trip" is.
    instance.fitBounds(bounds, { padding: overlayPadding(instance), maxZoom: 12, duration: 600 })
  }

  // Fitting the SELECTED trip, not the fleet. "Fit fleet" frames the markers -
  // where each truck is now - which for one truck is a street view. Reviewing
  // what a trip did needs its whole planned corridor and its whole observed
  // track in frame at once.
  const fitTrip = () => {
    const instance = map.current
    if (!instance) return
    const corners: [number, number][] = [
      ...(plannedRoute ?? []).map(([lat, lon]) => [lon, lat] as [number, number]),
      ...track.map((p) => [p.location.lon, p.location.lat] as [number, number]),
    ]
    if (corners.length === 0) return
    const bounds = corners.reduce((acc, c) => acc.extend(c), new LngLatBounds(corners[0], corners[0]))
    instance.fitBounds(bounds, { padding: overlayPadding(instance), duration: 600 })
  }

  const TOOL =
    'min-h-8 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-xs font-semibold text-ink shadow-[var(--shadow-card)] hover:bg-soft disabled:cursor-not-allowed disabled:opacity-40'

  return (
    // MAP-FIRST. A fixed 460px made the GIS canvas about half the viewport on a
    // laptop and left it unchanged on a 1080p desk monitor, where there was
    // room to spare. The default clamp keeps it at roughly two thirds of the
    // viewport - ~61% at 1366x768, ~67% at 1440x900, ~70% at 1920x1080 - with
    // a floor and a ceiling. A card that frames the map passes its own size.
    <div className={`@container relative overflow-hidden ${frameClassName}`}>
      {/*
        TWO HARDCODED HAZARD BANNERS WERE REMOVED FROM HERE.

        They read "Monitored Monsoon Corridor: Kaziranga Sector" and "Landslide
        Hazard Exposure: NH715 Sector 4", pinned to the map on every screen, for
        every trip, in every region. Neither was derived from anything. Real
        hazard rendering is data-driven: risk segments come through the route
        assessment and are drawn on the line itself.
      */}

      {/* THE MAP'S CONTROLS, WHERE THE REFERENCE PUTS THEM (manager_03):
          compass and framing top-left, the legend top-right, zoom
          bottom-left. Nothing else sits in the lower map, where the roads
          a dispatcher is reading usually are. */}
      <div data-map-overlay="tools" className="pointer-events-none absolute left-2.5 top-2.5 z-10 flex max-w-[calc(100%-15.5rem)] flex-col items-start gap-1.5 @max-lg:max-w-[calc(100%-12.25rem)]">
        <div className="pointer-events-auto flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-label="Compass: turn the map north up and flat"
            title="North up, no tilt"
            onClick={() => map.current?.resetNorthPitch()}
            className={`${TOOL} flex w-8 flex-col items-center justify-center gap-0 !px-0 leading-none`}
          >
            <span aria-hidden="true" className="text-[9px] font-bold">N</span>
            <Navigation2 aria-hidden="true" className="size-3.5 fill-current" />
          </button>
          <button type="button" onClick={fitFleet} className={TOOL}>
            {previewRouteId ? 'Region overview' : 'Fit fleet'}
          </button>
          {compact ? null : (
            <button
              type="button"
              disabled={!selectedTripId}
              title={selectedTripId ? 'Frame the whole planned route and observed track' : 'Select a trip first to frame its route'}
              onClick={fitTrip}
              className={TOOL}
            >
              Fit trip
            </button>
          )}
        </div>
        {pagePlaceCategory === undefined ? (
          <PoiChips
            value={placeCategory}
            onChange={setPlaceCategory}
            className="pointer-events-auto rounded-[var(--radius-control)] border border-line bg-surface/95 p-1.5 shadow-[var(--shadow-card)]"
          />
        ) : null}
        {/* The source line names the snapshot and its date: a map of hotels
            with no date on it is indistinguishable from a live one. */}
        {placeCategory ? (
          <p role="status" className="pointer-events-auto max-w-[22rem] rounded-[6px] bg-surface/95 px-2 py-1 text-[10.5px] leading-snug text-muted shadow-[var(--shadow-card)]">
            {places.loading
              ? 'Looking…'
              : places.notice
                ? places.notice
                : places.places.length === 0
                  ? 'None of this kind is mapped in this view.'
                  : `${places.places.length} mapped${places.truncated ? ' (more exist — zoom in)' : ''}. ` +
                    'Mapped, not verified: nothing here says a place is open or reachable.'}
            {places.attribution && !places.notice ? (
              <span className="mt-0.5 block text-faint">
                {places.attribution}
                {places.retrievedAt ? ` · snapshot ${places.retrievedAt.slice(0, 10)}` : ''}
              </span>
            ) : null}
          </p>
        ) : null}
        {terrainNote ? (
          <p role="status" className="pointer-events-auto max-w-[22rem] rounded-lg bg-warning-soft p-2.5 text-xs text-warning">
            {terrainNote}
          </p>
        ) : null}
        {mapError ? (
          <p role="status" className="pointer-events-auto max-w-[22rem] rounded-lg bg-warning-soft p-2.5 text-xs text-warning">
            Some map data could not load. Check your connection. Route details remain available.
          </p>
        ) : null}
      </div>

      {/* The legend is not decoration. Marker colour is the server's
          freshness label, and two lines on one map that mean different
          things need saying which is which. A single-trip review
          (previewRouteId) plots no fleet, so it has no freshness to key. */}
      <div
        data-testid="map-legend"
        data-map-overlay="legend"
        className="absolute right-2.5 top-2.5 z-10 w-[13.5rem] rounded-[var(--radius-control)] border border-line bg-surface/95 px-3 py-2 text-[11.5px] leading-relaxed text-ink shadow-[var(--shadow-card)] @max-lg:w-[10rem] @max-lg:px-2 @max-lg:text-[10.5px] @max-lg:leading-snug"
      >
        <p className="sr-only">Map legend</p>
        {previewRouteId ? null : <ul>
          {(['LIVE', 'STALE', 'NO_CONTACT'] as const).map((f) => (
            <li key={f} className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: MARKER_COLOUR[f] }} />
              {f === 'LIVE' ? 'Live position' : f === 'STALE' ? 'Stale position' : 'No contact'}
            </li>
          ))}
          <li className="flex items-center gap-2 text-muted">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full border border-outline" />
            No location: not placed
          </li>
        </ul>}
        {compact ? null : (
          <div className={previewRouteId ? '' : 'mt-1.5 border-t border-line pt-1.5'}>
            <label className="flex min-h-6 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={showPlanned}
                onChange={(e) => setShowPlanned(e.target.checked)}
                className="h-3.5 w-3.5 !min-h-0 accent-route"
              />
              <span aria-hidden className="h-0 w-6 shrink-0 border-t-2 border-dashed border-route" />
              <span>Planned route</span>
            </label>
            <label className="flex min-h-6 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={showObserved}
                onChange={(e) => setShowObserved(e.target.checked)}
                className="h-3.5 w-3.5 !min-h-0 accent-ink"
              />
              <span aria-hidden className="h-0 w-6 shrink-0 border-t-2 border-ink" />
              <span>Observed track</span>
            </label>
            <p className="mt-1 text-[11px] leading-snug text-muted">
              The observed track breaks where GPS stopped. A gap is not a road.
            </p>
          </div>
        )}
      </div>

      {/* After the tools and the legend in the DOM, so Tab meets them first;
          absolutely placed overlays still draw on top of it. */}
      <div ref={container} className="h-full w-full" />

      {/* 2D / Terrain / 3D. Bottom-right, clear of the attribution strip: the
          Terrain Tiles licence requires the elevation credit to stay visible. */}
      {compact ? null : (
        <div
          data-map-overlay="foot"
          // No overflow clip: it cut each button's focus ring (A11Y-3). The
          // end buttons carry the rounding instead.
          className="absolute bottom-9 right-3 z-10 flex rounded-[var(--radius-control)] border border-line bg-surface shadow-[var(--shadow-card)]"
          role="group"
          aria-label="Map view"
        >
          {([
            ['standard', '2D', 'Flat map. Always available.'],
            ['terrain', 'Terrain', 'Shaded relief from SRTM elevation.'],
            ['terrain3d', '3D', 'Tilted, with the ground raised. Falls back to 2D if it cannot load.'],
          ] as const).map(([value, label, title]) => (
            <button
              key={value}
              type="button"
              title={title}
              aria-pressed={mapMode === value}
              onClick={() => setMapMode(value)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors first:rounded-l-[7px] last:rounded-r-[7px] focus-visible:relative focus-visible:z-10 ${
                mapMode === value ? 'bg-primary text-on-primary' : 'text-ink hover:bg-soft'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
