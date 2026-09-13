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

import { boundsOf } from './geo'
import { routeCameraKey } from './routeDisplay'
import { ARROW_STYLE, HILLSHADE_ATTRIBUTION, HILLSHADE_URL, sceneLayers } from './scene'
import type { DriverRouteMapProps } from './types'

/** Assam, so a map with no route still opens somewhere meaningful. */
const NER_CENTRE: [number, number] = [26.2006, 92.9376]
/** Zoom used while following the truck: roads and villages readable. */
const FOLLOW_ZOOM = 13
const NER_ZOOM = 6

/** Colours and tooltips live in `scene.ts`, shared with the phone. */

const CONTROL_STYLE = {
  position: 'absolute' as const,
  // 40 here rather than the driver-app's 48 floor: these sit ON the map, and
  // the map itself must stay usable. They are still well above the 44px WCAG
  // target once the 8px hit-slop padding is counted.
  minHeight: 48,
  padding: '0 14px',
  borderRadius: 8,
  border: '1px solid #D5DEDA',
  background: '#FFFFFF',
  color: '#101820',
  font: '600 13px Inter, system-ui, sans-serif',
  // Above Leaflet's own panes, which sit at 400-700.
  zIndex: 800,
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
  headingDeg = null,
  places = [],
  selectedPlaceId = null,
  terrainSegments = [],
  hazards = [],
  hillshade = false,
  trafficSegments,
  onSelectPlace,
  onViewportChange,
  onFollowChange,
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
  useEffect(() => { onFollowChange?.(following) }, [following, onFollowChange])

  // Construct once. A map rebuilt on every prop change loses the camera the
  // driver just set, which is the difference between a map and a slideshow.
  useEffect(() => {
    if (holder.current === null || map.current !== null) return

    const instance = L.map(holder.current, {
      center: NER_CENTRE,
      zoom: NER_ZOOM,
      // The screen's own rail owns the corners: top has the maneuver card and
      // SOS, bottom-right the controls. Leaflet's zoom buttons sat under SOS.
      // Pinch and scroll zoom remain. No scale bar either: every corner is
      // spoken for, and the ETA bar states the distance in figures.
      zoomControl: false,
      attributionControl: true,
    })

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

  // Relief shading between the base tiles and the route. Its own failure
  // removes only itself: a hillshade that cannot load is not an error state.
  useEffect(() => {
    const instance = map.current
    if (instance === null || !hillshade || HILLSHADE_URL === null) return
    const layer = L.tileLayer(HILLSHADE_URL, { maxNativeZoom: 12, maxZoom: 19, opacity: 0.55, attribution: HILLSHADE_ATTRIBUTION })
    layer.on('tileerror', () => layer.remove())
    layer.addTo(instance)
    return () => { layer.remove() }
  }, [hillshade])

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

    function keep(layer: L.Layer) {
      layer.addTo(instance!)
      drawn.current.push(layer)
    }
    const safeLabel = (text: string) => { const el = document.createElement('span'); el.textContent = text; return el }
    for (const s of sceneLayers({ points, progressFraction, backupPoints, showBackup, terrainSegments, hazards, stops, position, positionKind, accuracyM, positionAgeSeconds, headingDeg, places, selectedPlaceId, trafficSegments })) {
      let layer: L.Layer
      if (s.k === 'line') layer = L.polyline(s.p, { color: s.c, weight: s.w, dashArray: s.d, lineJoin: 'round', lineCap: 'round' })
      else if (s.k === 'circle') layer = L.circle(s.p, { radius: s.r, color: s.c, weight: 1, fillColor: s.c, fillOpacity: 0.15 })
      else if (s.k === 'dot') layer = L.circleMarker(s.p, { radius: s.r, color: s.c, weight: s.w, fillColor: s.f, fillOpacity: s.o })
      else layer = L.marker(s.p, { icon: L.divIcon({ className: '', html: `<div style="${ARROW_STYLE}transform:rotate(${s.h}deg)"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) })
      if (s.tip) layer.bindTooltip(safeLabel(s.tip))
      if (s.k === 'dot' && s.id && onSelectPlace) { const id = s.id; layer.on('click', () => { const place = places.find((x) => x.provider_id === id); if (place) onSelectPlace(place) }) }
      keep(layer)
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
    headingDeg,
    places,
    selectedPlaceId,
    onSelectPlace,
    terrainSegments,
    hazards,
  ])

  // Fit the route ONCE per route, not on every poll. Re-framing the camera
  // every ten seconds is the behaviour `FleetMap` calls out as unreadable.
  const fittedFor = useRef<string | null>(null)
  useEffect(() => {
    if (map.current === null || points.length === 0) return
    const key = routeCameraKey(routeId, points)
    if (fittedFor.current === key) return
    fittedFor.current = key
    // The automatic frame does NOT cancel following: a trip started with a
    // live fix shows the road once, then follows the truck from the next fix.
    fitRoute(false, true)
    // `fitRoute` is stable for this purpose - it reads refs and props directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, routeId])

  function fitRoute(animate = true, keepFollowing = false) {
    if (!keepFollowing) setFollowing(false)
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
    if (following && position && positionKind === 'LIVE') {
      // Following means a road-reading zoom, not the region overview the
      // route was framed at: a truck at zoom 8 is a dot on a province.
      const m = map.current
      if (m) m.setView([position[0], position[1]], Math.max(m.getZoom(), FOLLOW_ZOOM), { animate: true })
    } else if (positionKind !== 'LIVE') setFollowing(false)
  }, [following, position?.[0], position?.[1], positionKind])

  // Navigation follows the truck from the first LIVE fix, the way a driver
  // expects; a drag hands the camera back (dragstart above) and Re-centre
  // resumes it. Only the transition into LIVE arms it, so a driver who panned
  // away is not snapped back on every fix.
  const wasLive = useRef(false)
  useEffect(() => {
    const live = positionKind === 'LIVE' && position !== null
    if (live && !wasLive.current) setFollowing(true)
    wasLive.current = live
  }, [positionKind, position !== null])
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
