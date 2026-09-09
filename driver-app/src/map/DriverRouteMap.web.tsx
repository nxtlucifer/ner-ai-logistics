/**
 * The driver's route map on web (Expo web / react-native-web).
 *
 * WHY LEAFLET HERE AND MAPLIBRE IN THE MANAGER CONSOLE
 *
 * This file was first written with MapLibre GL, to match `FleetMap.tsx` and
 * keep one map technology in the repository. Under Metro it did not work, and
 * the way it failed is worth recording because it is invisible:
 *
 *     Failed to load module script: The server responded with a non-JavaScript
 *     MIME type of "text/html".
 *
 * MapLibre derives its worker URL at RUNTIME from `import.meta.url`, so no
 * bundler can see the reference and none emits the file. The dev server
 * answers the request with index.html, the browser refuses it as a module
 * worker, and MapLibre runs with no worker at all. Raster tiles and DOM
 * markers do not touch the worker - so the basemap, the zoom control, the
 * scale bar and every stop marker rendered perfectly while the route line,
 * which is a GeoJSON source and DOES need the worker, silently never drew.
 * The map looked completely healthy and was missing the one thing it existed
 * to show.
 *
 * `FleetMap.tsx` hits the same defect and fixes it with Vite's `?worker&url`,
 * which makes the reference static so Vite emits the asset. Metro has no
 * equivalent, so the Vite fix does not transfer.
 *
 * Leaflet has no worker, no WASM and no build-time asset to emit: it draws
 * polylines as SVG in the DOM. That removes the entire class of failure rather
 * than patching one instance of it. It is also LAT-LON, like this whole
 * application, so unlike the MapLibre version there is no coordinate swap on
 * this platform at all. Two map libraries is a real cost; two bundlers with
 * genuinely different constraints is the reason.
 *
 * PLAIN DOM ON PURPOSE. Expo web IS react-dom, so a `<div>` is a real div and
 * Leaflet can own it.
 *
 * NO BASEMAP IS A FAILURE STATE. The handoff is explicit that a route line
 * over an empty background does not count as a working map, so tile errors are
 * caught and surfaced rather than left to look like an empty region.
 */

import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import { boundsOf, type LatLon } from './geo'
import { routeCameraKey, splitRoute } from './routeDisplay'
import type { DriverRouteMapProps } from './types'

/** Assam, so a map with no route still opens somewhere meaningful. */
const NER_CENTRE: [number, number] = [26.2006, 92.9376]
const NER_ZOOM = 6

/**
 * Design tokens, from `design-system/ner-fleet-intelligence/MASTER.md`.
 *
 * Chosen against a LIGHT raster basemap in daylight, not against the app's
 * dark chrome - the map is the one surface on the driver's phone that stays
 * light, because a dark basemap under a blue route is unreadable in sun.
 */
const ROUTE = '#2457D6'
const ROUTE_CASING = '#FFFFFF'
const BACKUP = '#EA580C'
const ORIGIN = '#0F172A'
const LIVE = '#0B756B'
const LAST_KNOWN = '#A65A00'

const CONTROL_STYLE = {
  position: 'absolute' as const,
  // 40 here rather than the driver-app's 48 floor: these sit ON the map, and
  // the map itself must stay usable. They are still well above the 44px WCAG
  // target once the 8px hit-slop padding is counted.
  minHeight: 48,
  padding: '0 14px',
  borderRadius: 8,
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#0F172A',
  font: '600 13px Inter, system-ui, sans-serif',
  // Above Leaflet's own panes, which sit at 400-700.
  zIndex: 800,
}

/**
 * Marker colour per service kind.
 *
 * Distinct hues so four categories are never on screen looking alike, and none
 * of them reuses the route blue or the live-position green - a pin must not
 * read as "your route" or "you are here".
 */
const CATEGORY_COLOUR: Record<string, string> = {
  EMERGENCY: '#DC2626',
  TYRES: '#7C3AED',
  HOTEL: '#0891B2',
  REST: '#CA8A04',
}

export default function DriverRouteMap({
  points,
  routeId,
  progressFraction,
  positionAgeSeconds,
  backupPoints,
  showBackup,
  stops,
  position,
  positionKind,
  accuracyM,
  places = [],
  selectedPlaceId = null,
  onSelectPlace,
  onViewportChange,
  cameraTrigger,
  cameraMode,
  testID,
}: DriverRouteMapProps) {
  const holder = useRef<HTMLDivElement | null>(null)
  const map = useRef<L.Map | null>(null)
  /** Everything redrawn from props, kept together so it can be cleared as one. */
  const drawn = useRef<L.Layer[]>([])
  const [tileError, setTileError] = useState(false)
  const [following, setFollowing] = useState(false)

  // Construct once. A map rebuilt on every prop change loses the camera the
  // driver just set, which is the difference between a map and a slideshow.
  useEffect(() => {
    if (holder.current === null || map.current !== null) return

    const instance = L.map(holder.current, {
      center: NER_CENTRE,
      zoom: NER_ZOOM,
      // Leaflet's default is top-left, where the "Fit route" button lives.
      zoomControl: false,
      attributionControl: true,
    })
    L.control.zoom({ position: 'topright' }).addTo(instance)
    L.control.scale({ metric: true, imperial: false }).addTo(instance)

    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // Required by the OSM tile usage policy. Not optional and not decoration.
      attribution: '&copy; OpenStreetMap contributors',
    })
    // A route drawn over a blank background is the failure mode the handoff
    // names by hand. Distinguish it from "no route".
    tiles.on('tileerror', () => setTileError(true))
    tiles.on('tileload', () => setTileError(false))
    tiles.addTo(instance)

    const pauseFollow = () => setFollowing(false)
    instance.on('dragstart', pauseFollow)
    const resize = new ResizeObserver(() => instance.invalidateSize({ pan: false }))
    resize.observe(holder.current)
    map.current = instance
    return () => {
      resize.disconnect()
      instance.off('dragstart', pauseFollow)
      instance.remove()
      map.current = null
    }
  }, [])

  // Report the visible area on `moveend` only - not on every frame of a pan,
  // which would fire hundreds of times and is why this is not a render-path
  // concern. The screen uses it for "Search this area" and nothing else; it
  // triggers no lookup by itself.
  const viewportRef = useRef(onViewportChange)
  viewportRef.current = onViewportChange
  useEffect(() => {
    const instance = map.current
    if (instance === null) return
    function report() {
      const b = instance!.getBounds()
      viewportRef.current?.({
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      })
    }
    instance.on('moveend', report)
    report()
    return () => {
      instance.off('moveend', report)
    }
  }, [])

  // Route, backup, stops and the position marker. Redrawn together because
  // they are few, and a diff would be more code than it saves.
  useEffect(() => {
    const instance = map.current
    if (instance === null) return

    for (const layer of drawn.current) layer.remove()
    drawn.current = []

    const { completed, remaining } = splitRoute(points, progressFraction)
    function keep(layer: L.Layer) {
      layer.addTo(instance!)
      drawn.current.push(layer)
    }

    if (showBackup && backupPoints.length > 1) {
      keep(
        L.polyline(backupPoints as [number, number][], {
          color: BACKUP,
          weight: 4,
          dashArray: '8 8',
        }),
      )
    }

    if (points.length > 1) {
      // Casing first, so the route draws on top of it. Without it a 6px blue
      // line disappears over water and over motorway fills on this style.
      keep(
        L.polyline(points as [number, number][], {
          color: ROUTE_CASING,
          weight: 10,
          lineJoin: 'round',
          lineCap: 'round',
        }),
      )
      keep(
        L.polyline(remaining as [number, number][], {
          color: ROUTE,
          weight: 6,
          lineJoin: 'round',
          lineCap: 'round',
        }),
      )
    }

    if (completed.length > 1) keep(L.polyline(completed.map(([lat, lon]) => [lat, lon] as [number, number]), { color: '#93B9AF', weight: 6 }))
    const safeLabel = (text: string) => { const el = document.createElement('span'); el.textContent = text; return el }
    stops.forEach((stop, index) => {
      if (stop.lat === null || stop.lon === null) return
      const label = stop.name ?? 'Stop ' + stop.sequence
      keep(
        L.circleMarker([stop.lat, stop.lon], {
          radius: 7,
          color: '#FFFFFF',
          weight: 2,
          fillColor: index === 0 ? ORIGIN : ROUTE,
          fillOpacity: 1,
        }).bindTooltip(safeLabel(label)),
      )
    })

    // Only from a real fix. `position === null` draws nothing at all - no
    // depot fallback, nothing derived from the route.
    if (position !== null && positionKind !== null) {
      const isLive = positionKind === 'LIVE'
      const accuracyNote =
        accuracyM === null ? '' : ', accurate to ' + Math.round(accuracyM) + ' m'
      // The accuracy circle is drawn only when the platform actually reported
      // an accuracy. An invented radius is an invented claim about certainty.
      if (isLive && accuracyM !== null) {
        keep(
          L.circle([position[0], position[1]], {
            radius: accuracyM,
            color: LIVE,
            weight: 1,
            fillColor: LIVE,
            fillOpacity: 0.15,
          }),
        )
      }
      keep(
        L.circleMarker([position[0], position[1]], {
          radius: 9,
          color: isLive ? '#FFFFFF' : LAST_KNOWN,
          weight: 3,
          fillColor: isLive ? LIVE : 'transparent',
          fillOpacity: isLive ? 1 : 0,
        }).bindTooltip(
          isLive
            ? 'Live position' + accuracyNote
            : `Last known position — ${positionAgeSeconds == null ? 'age unavailable' : `${Math.round(positionAgeSeconds)}s ago`}`,
        ),
      )
    }

    // Roadside services from the current search. Drawn LAST so a pin is never
    // hidden under the route casing.
    for (const place of places) {
      const isSelected = place.provider_id === selectedPlaceId
      const marker = L.circleMarker([place.lat, place.lon], {
        radius: isSelected ? 11 : 7,
        color: '#FFFFFF',
        weight: isSelected ? 3 : 2,
        fillColor: CATEGORY_COLOUR[place.category] ?? '#475569',
        fillOpacity: 1,
      })
      // The category is in the tooltip as WORDS, not only in the colour - a
      // driver who cannot separate the hues still gets the kind.
      marker.bindTooltip(
        safeLabel((place.name ?? 'Unnamed') + ' - ' + place.category.toLowerCase()),
      )
      if (onSelectPlace) marker.on('click', () => onSelectPlace(place))
      keep(marker)
    }
  }, [
    points,
    backupPoints,
    showBackup,
    stops,
    position,
    positionKind,
    accuracyM,
    progressFraction,
    positionAgeSeconds,
    places,
    selectedPlaceId,
    onSelectPlace,
  ])

  // Fit the route ONCE per route, not on every poll. Re-framing the camera
  // every ten seconds is the behaviour `FleetMap` calls out as unreadable.
  const fittedFor = useRef<string | null>(null)
  useEffect(() => {
    if (map.current === null || points.length === 0) return
    const key = routeCameraKey(routeId, points)
    if (fittedFor.current === key) return
    fittedFor.current = key
    fitRoute(false)
    // `fitRoute` is stable for this purpose - it reads refs and props directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, routeId])

  function fitRoute(animate = true) {
    setFollowing(false)
    const instance = map.current
    const box = boundsOf(points)
    if (instance === null || box === null) return
    instance.fitBounds(
      L.latLngBounds([box.minLat, box.minLon], [box.maxLat, box.maxLon]),
      { padding: [40, 40], animate },
    )
  }

  // Camera control signals from screen floating buttons
  useEffect(() => {
    if (!cameraTrigger || !cameraMode) return
    if (cameraMode === 'FIT_ROUTE') {
      fitRoute(true)
    } else if (cameraMode === 'RECENTER') {
      if (position) {
        setFollowing(positionKind === 'LIVE')
        map.current?.panTo([position[0], position[1]], { animate: true })
      }
    }
  }, [cameraTrigger, cameraMode])

  useEffect(() => {
    if (following && position && positionKind === 'LIVE') map.current?.panTo([position[0], position[1]], { animate: true })
    else if (positionKind !== 'LIVE') setFollowing(false)
  }, [following, position?.[0], position?.[1], positionKind])
  const hasRoute = points.length > 0

  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%' }}
      data-testid={testID}
    >
      <div ref={holder} style={{ position: 'absolute', inset: 0 }} />

      {tileError ? (
        <div
          role="status"
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 40,
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(69,26,3,0.95)',
            border: '1px solid #78350F',
            color: '#FDE68A',
            font: '500 13px Inter, system-ui, sans-serif',
            zIndex: 800,
          }}
        >
          Map tiles could not load. The route shown is from your trip and is
          still correct.
        </div>
      ) : null}

      {cameraTrigger === undefined ? (
        <>
          <button
            type="button"
            onClick={() => fitRoute()}
            disabled={!hasRoute}
            style={{
              ...CONTROL_STYLE,
              left: 12,
              top: 12,
              cursor: hasRoute ? 'pointer' : 'not-allowed',
              opacity: hasRoute ? 1 : 0.5,
            }}
          >
            Fit route
          </button>

          {position !== null ? (
            <button
              type="button"
              onClick={() => { if (!position) return; setFollowing(positionKind === 'LIVE'); map.current?.panTo([position[0], position[1]]) }}
              aria-pressed={following}
              style={{ ...CONTROL_STYLE, left: 12, top: 68, cursor: 'pointer' }}
            >
              {following ? 'Following location' : positionKind === 'LIVE' ? 'Recenter' : 'Last known fix'}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
