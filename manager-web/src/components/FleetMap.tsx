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
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
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
// and this module is the only place that constructs one.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

setWorkerUrl(maplibreWorkerUrl)

import type { FleetTrip, Freshness, Position } from '../api/client'
import { drawableSegments, isolatedFixes, splitTrack } from './track'
import { sliceRoute, terrainOverlays } from './terrain'

/** Assam, so an empty map still opens somewhere meaningful to these operators. */
export const NER_CENTRE: [number, number] = [92.9376, 26.2006]
export const NER_ZOOM = 6

const MARKER_COLOUR: Record<Freshness, string> = {
  LIVE: '#34d399',
  STALE: '#fbbf24',
  NO_CONTACT: '#f87171',
  // Never rendered - a trip with no position is not placed. Present so the
  // record is total and a future freshness value cannot silently fall through.
  NO_LOCATION: '#64748b',
}

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
}

interface MarkerHandle {
  marker: Marker
  element: HTMLButtonElement
  dot: HTMLSpanElement
  label: HTMLSpanElement
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
  handle.element.setAttribute(
    'aria-label',
    `${trip.registration_number}, ${trip.freshness}`,
  )
  handle.element.style.background = isSelected ? '#0f172a' : 'rgba(15,23,42,0.82)'
  handle.element.style.border = `2px solid ${isSelected ? '#f1f5f9' : colour}`
  handle.element.style.color = colour
  handle.element.style.boxShadow = isSelected
    ? '0 0 0 4px rgba(241,245,249,0.25)'
    : 'none'
  handle.dot.style.background = colour
  handle.label.textContent = trip.registration_number
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
      style: OSM_STYLE,
      center: NER_CENTRE,
      zoom: NER_ZOOM,
      attributionControl: { compact: true },
    })
    instance.addControl(new NavigationControl({}), 'top-right')
    instance.on('error', () => setMapError(true))
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
          // from the broken line. The colour comment used to say violet and sky
          // blue, neither of which had been on this map for some time.
          'line-color': '#2563EB',
          'line-width': 4,
          'line-opacity': 0.7,
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
          'line-color': ['match', ['get', 'cls'], 'STEEP', '#B42318', '#B45309'],
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
          'line-color': ['match', ['get', 'state'], 'CONGESTED', '#DC2626', 'SLOW', '#D97706', '#16A34A'],
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
          'circle-color': '#FFFFFF',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#B42318',
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
          'line-color': '#101820',
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
          'circle-color': '#101820',
          'circle-opacity': 0.9,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#FFFFFF',
        },
      })
    })
    map.current = instance

    return () => {
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
    instance.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 0 })
    const pins = [corners[0], corners.at(-1)!].map((point, index) => {
      const label = document.createElement('span')
      label.textContent = index === 0 ? 'Pickup' : 'Destination'
      label.style.cssText = 'background:white;color:#14282F;padding:6px 10px;border:2px solid #2457D6;border-radius:20px;font:600 12px system-ui'
      return new Marker({ element: label }).setLngLat(point).addTo(instance)
    })
    return () => { pins.forEach(pin => pin.remove()) }
    // Camera follows a deliberate corridor change, never a GPS poll.
  }, [previewRouteId, loaded])

  return (
    // MAP-FIRST. A fixed 460px made the GIS canvas about half the viewport on a
    // laptop and left it unchanged on a 1080p desk monitor, where there was
    // room to spare. The clamp keeps it at roughly two thirds of the viewport
    // across the whole supported range - ~61% at 1366x768, ~67% at 1440x900,
    // ~70% at 1920x1080 - with a floor so it never collapses on a short window
    // and a ceiling so it does not dwarf the fleet list beneath it.
    <div className="relative h-[clamp(420px,calc(100dvh-300px),760px)] overflow-hidden rounded-[14px] border border-line">
      <div ref={container} className="h-full w-full" />
      {mapError ? <p role="status" className="absolute top-16 left-3 right-12 rounded-lg bg-warning-soft p-3 text-xs text-warning">Some map data could not load. Check your connection. Route details remain available.</p> : null}
      {/*
        TWO HARDCODED HAZARD BANNERS WERE REMOVED FROM HERE.

        They read "Monitored Monsoon Corridor: Kaziranga Sector" and "Landslide
        Hazard Exposure: NH715 Sector 4", pinned to the top-right of the map on
        every screen, for every trip, in every region. Neither was derived from
        anything: no snapshot, no assessment, no trip. They carried honest
        qualifiers - HISTORICAL HAZARD AREA, STATIC REFERENCE - but a fixed
        string dressed as a hazard readout on an operational GIS console is the
        same class of thing this codebase refuses to do with weather and GPS,
        and a viewer has no way to tell it apart from a live detection.

        They also sat over the corridor a dispatcher is trying to read, on a
        screen whose whole design goal is map dominance.

        Real hazard rendering already exists and is data-driven: risk segments
        come through the route assessment and are drawn on the line itself.
      */}
      {/* One row, not two absolute offsets. The second button used to be pinned
          at left-24, which assumed the first was under 6rem wide - "Region
          overview" is not, so they overlapped on the review panel. */}
      <div className="absolute left-3 top-3 flex flex-wrap items-start gap-2">
      <button
        type="button"
        onClick={() => {
          const instance = map.current
          if (!instance) return
          const located = trips.filter((t) => t.position)
          if (located.length === 0) {
            instance.easeTo({ center: NER_CENTRE, zoom: NER_ZOOM })
            return
          }
          const bounds = located.reduce(
            (acc, t) =>
              acc.extend([t.position!.location.lon, t.position!.location.lat]),
            new LngLatBounds(
              [
                located[0].position!.location.lon,
                located[0].position!.location.lat,
              ],
              [
                located[0].position!.location.lon,
                located[0].position!.location.lat,
              ],
            ),
          )
          instance.fitBounds(bounds, {
            padding: 64,
            maxZoom: 12,
            duration: 600,
          })
        }}
        className="rounded-md border border-line bg-surface/90 px-3 py-1.5 text-xs font-medium text-ink hover:bg-soft"
      >
        {previewRouteId ? 'Region overview' : 'Fit fleet'}
      </button>
      {/* Fitting the SELECTED trip, not the fleet. "Fit fleet" frames the
          markers - where each truck is now - which for one truck is a street
          view. Reviewing what a trip did needs its whole planned corridor and
          its whole observed track in frame at once. */}
      <button
        type="button"
        disabled={!selectedTripId}
        onClick={() => {
          const instance = map.current
          if (!instance) return
          const corners: [number, number][] = [
            ...(plannedRoute ?? []).map(
              ([lat, lon]) => [lon, lat] as [number, number],
            ),
            ...track.map(
              (p) => [p.location.lon, p.location.lat] as [number, number],
            ),
          ]
          if (corners.length === 0) return
          const bounds = corners.reduce(
            (acc, c) => acc.extend(c),
            new LngLatBounds(corners[0], corners[0]),
          )
          instance.fitBounds(bounds, { padding: 48, duration: 600 })
        }}
        className="rounded-md border border-line bg-surface/90 px-3 py-1.5 text-xs font-medium text-ink hover:bg-soft disabled:cursor-not-allowed disabled:opacity-40"
      >
        Fit trip
      </button>
      </div>
      {/* The legend is not decoration. Two lines on one map that mean
          different things need saying which is which, and the gap rule is a
          claim about the data that the operator is entitled to see stated. */}
      <div className="absolute bottom-3 left-3 max-w-[15rem] rounded-md border border-line bg-surface/90 px-3 py-2 text-[11px] leading-relaxed text-ink">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={showPlanned}
            onChange={(e) => setShowPlanned(e.target.checked)}
            className="h-3.5 w-3.5 !min-h-0 accent-route"
          />
          <span
            aria-hidden
            className="h-0 w-6 shrink-0 border-t-2 border-dashed"
            style={{ borderColor: '#2563EB' }}
          />
          <span>Planned route</span>
        </label>
        <label className="mt-1 flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={showObserved}
            onChange={(e) => setShowObserved(e.target.checked)}
            className="h-3.5 w-3.5 !min-h-0 accent-ink"
          />
          <span
            aria-hidden
            className="h-0 w-6 shrink-0 border-t-2"
            style={{ borderColor: '#101820' }}
          />
          <span>Observed track</span>
        </label>
        <p className="mt-1.5 text-muted">
          The observed track breaks where GPS stopped. A gap is not a road.
        </p>
      </div>
    </div>
  )
}
