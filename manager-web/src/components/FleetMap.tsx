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

import { useEffect, useRef } from 'react'
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import type { FleetTrip, Freshness, Position } from '../api/client'

/** Assam, so an empty map still opens somewhere meaningful to these operators. */
const NER_CENTRE: [number, number] = [92.9376, 26.2006]
const NER_ZOOM = 6

const MARKER_COLOUR: Record<Freshness, string> = {
  LIVE: '#34d399',
  STALE: '#fbbf24',
  NO_CONTACT: '#f87171',
  // Never rendered - a trip with no position is not placed. Present so the
  // record is total and a future freshness value cannot silently fall through.
  NO_LOCATION: '#64748b',
}

const OSM_STYLE: StyleSpecification = {
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
}: FleetMapProps) {
  const container = useRef<HTMLDivElement | null>(null)
  const map = useRef<MapLibreMap | null>(null)
  const markers = useRef(new Map<string, MarkerHandle>())
  const ready = useRef(false)
  // Held in a ref so the marker click handler never closes over a stale prop.
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect

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
    instance.on('load', () => {
      ready.current = true
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
          // Dashed and violet against the observed track's solid sky blue.
          // Distinguishable without relying on colour alone, which matters for
          // a dispatcher who may be colour-blind and is why the dash is here
          // rather than a second shade.
          'line-color': '#a78bfa',
          'line-width': 4,
          'line-opacity': 0.7,
          'line-dasharray': [2, 2],
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
          'line-color': '#38bdf8',
          'line-width': 3,
          'line-opacity': 0.85,
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

    // Reversed: the API returns newest first, a line reads oldest to newest.
    const coordinates = [...track]
      .reverse()
      .map((p) => [p.location.lon, p.location.lat] as [number, number])

    source.setData(
      coordinates.length >= 2
        ? {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates },
            properties: {},
          }
        : { type: 'FeatureCollection', features: [] },
    )
  }, [track])

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
  }, [plannedRoute])

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

  return (
    <div className="relative h-[460px] overflow-hidden rounded-xl border border-slate-800">
      <div ref={container} className="h-full w-full" />
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
        className="absolute left-3 top-3 rounded-md border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
      >
        Fit fleet
      </button>
    </div>
  )
}
