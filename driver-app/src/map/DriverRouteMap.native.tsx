/**
 * The driver's route map on Android and iOS: Leaflet inside a WebView.
 *
 * WHY NOT A NATIVE MAP SDK. `react-native-maps` on Android is Google's SDK
 * and needs a Google Maps key; without one it renders black, and Expo Go's
 * own key is refused on the demo phone. MapLibre needs a custom native build
 * that Expo Go cannot run. `react-native-webview` ships inside Expo Go, and
 * Leaflet over OpenStreetMap tiles is the SAME map the web app already
 * draws - so the phone now shows exactly what the laptop shows, keys or no
 * keys, from the same `scene.ts`.
 *
 * TRADE-OFFS, STATED. Tiles and Leaflet itself come from the network (OSM
 * tiles, unpkg for the 40 KB library, cached by the WebView after the first
 * load); with no connection the route still draws over a blank ground and the
 * page says so, the same failure mode the web map names. No map rotation:
 * the camera stays north-up and the truck arrow turns instead.
 *
 * The bridge is two one-liners: RN -> page `scene(layers)` / `cam(cmd)` via
 * injectJavaScript, page -> RN `{t: ...}` via postMessage.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import { useT } from '../i18n/tx'
import { boundsOf } from './geo'
import { routeCameraKey } from './routeDisplay'
import { ARROW_STYLE, HILLSHADE_ATTRIBUTION, HILLSHADE_URL, sceneLayers } from './scene'
import type { DriverRouteMapProps } from './types'

/** Assam, so a map with no route still opens somewhere meaningful. */
const NER_CENTRE = '[26.2006, 92.9376]'
/** Zoom used while following the truck: roads and villages readable. */
const FOLLOW_ZOOM = 13

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#m{margin:0;height:100%;background:#E8EDEB}.leaflet-control-attribution{font-size:9px}</style>
</head><body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var send=function(m){window.ReactNativeWebView.postMessage(JSON.stringify(m))};
if(!window.L){send({t:'tileerror'})}else{
var map=L.map('m',{center:${NER_CENTRE},zoom:6,zoomControl:false});
var tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
tiles.on('tileerror',function(){send({t:'tileerror'})});tiles.on('tileload',function(){send({t:'tileload'})});
map.on('dragstart',function(){send({t:'drag'})});
map.on('moveend',function(){var b=map.getBounds();send({t:'bounds',south:b.getSouth(),west:b.getWest(),north:b.getNorth(),east:b.getEast()})});
var esc=function(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
var drawn=[];
window.scene=function(layers){drawn.forEach(function(l){l.remove()});drawn=[];layers.forEach(function(s){var l;
 if(s.k==='line')l=L.polyline(s.p,{color:s.c,weight:s.w,dashArray:s.d,lineJoin:'round',lineCap:'round'});
 else if(s.k==='circle')l=L.circle(s.p,{radius:s.r,color:s.c,weight:1,dashArray:s.d,fillColor:s.c,fillOpacity:.15});
 else if(s.k==='dot')l=L.circleMarker(s.p,{radius:s.r,color:s.c,weight:s.w,fillColor:s.f,fillOpacity:s.o});
 else l=L.marker(s.p,{icon:L.divIcon({className:'',html:'<div style="${ARROW_STYLE}transform:rotate('+s.h+'deg)"></div>',iconSize:[22,22],iconAnchor:[11,11]})});
 if(s.tip)l.bindTooltip(esc(s.tip));if(s.id)l.on('click',function(){send({t:'place',id:s.id})});l.addTo(map);drawn.push(l)})};
var hill=null;window.hill=function(u){if(hill){hill.remove();hill=null}if(!u)return;hill=L.tileLayer(u,{maxNativeZoom:12,maxZoom:19,opacity:.55,attribution:${JSON.stringify(HILLSHADE_ATTRIBUTION)}});hill.on('tileerror',function(){if(hill){hill.remove();hill=null}});hill.addTo(map)};
window.cam=function(c){if(c.fit)map.fitBounds(c.fit,{padding:[40,40],animate:c.animate});else if(c.view)map.setView(c.view,Math.max(map.getZoom(),c.zoom),{animate:true});else if(c.pan)map.panTo(c.pan,{animate:true})};
send({t:'ready'});}
</script></body></html>`

export default function DriverRouteMap({
  routeId,
  progressFraction,
  points,
  backupPoints,
  showBackup,
  stops,
  position,
  positionKind,
  positionSource = null,
  accuracyM,
  positionAgeSeconds,
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
  const web = useRef<WebView | null>(null)
  const [ready, setReady] = useState(false)
  const t = useT()
  const [tileError, setTileError] = useState(false)
  const [following, setFollowing] = useState(false)
  useEffect(() => { onFollowChange?.(following) }, [following, onFollowChange])
  const run = useCallback((js: string) => { web.current?.injectJavaScript(js + ';true;') }, [])

  const viewportRef = useRef(onViewportChange)
  viewportRef.current = onViewportChange
  const placesRef = useRef(places)
  placesRef.current = places
  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let m: { t: string; id?: string; south?: number; west?: number; north?: number; east?: number }
    try { m = JSON.parse(e.nativeEvent.data) } catch { return }
    if (m.t === 'ready') setReady(true)
    else if (m.t === 'drag') setFollowing(false)
    else if (m.t === 'tileerror') setTileError(true)
    else if (m.t === 'tileload') setTileError(false)
    else if (m.t === 'bounds') viewportRef.current?.({ south: m.south!, west: m.west!, north: m.north!, east: m.east! })
    else if (m.t === 'place') { const place = placesRef.current.find((p) => p.provider_id === m.id); if (place) onSelectPlace?.(place) }
  }, [onSelectPlace])

  // Everything drawn from props, as one list, whenever any of it changes.
  // The screen re-renders every second (its clock), so the list is compared
  // as text and only crosses the bridge when something on it moved.
  const lastScene = useRef('')
  useEffect(() => {
    if (!ready) return
    const json = JSON.stringify(sceneLayers({ points, progressFraction, backupPoints, showBackup, terrainSegments, hazards, stops, position, positionKind, positionSource, accuracyM, positionAgeSeconds, headingDeg, places, selectedPlaceId, trafficSegments }))
    if (json === lastScene.current) return
    lastScene.current = json
    run('window.scene(' + json + ')')
  }, [ready, run, points, progressFraction, backupPoints, showBackup, terrainSegments, hazards, stops, position, positionKind, positionSource, accuracyM, positionAgeSeconds, headingDeg, places, selectedPlaceId, trafficSegments])

  useEffect(() => {
    if (ready) run(`window.hill(${JSON.stringify(hillshade ? HILLSHADE_URL : null)})`)
  }, [ready, run, hillshade])

  function fitRoute(animate = true, keepFollowing = false) {
    if (!keepFollowing) setFollowing(false)
    const box = boundsOf(points)
    if (box === null) return
    run(`window.cam({fit:[[${box.minLat},${box.minLon}],[${box.maxLat},${box.maxLon}]],animate:${animate}})`)
  }

  // Frame the route ONCE per route, not on every poll.
  const cameraKey = routeCameraKey(routeId, points)
  const fittedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!ready || points.length === 0 || fittedFor.current === cameraKey) return
    fittedFor.current = cameraKey
    // The automatic frame does NOT cancel following (see the web map).
    fitRoute(false, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cameraKey])

  // Camera control signals from screen floating buttons.
  useEffect(() => {
    if (!cameraTrigger || !cameraMode) return
    if (cameraMode === 'FIT_ROUTE') fitRoute(true)
    else if (position) { setFollowing(positionKind === 'LIVE'); run(`window.cam({pan:[${position[0]},${position[1]}]})`) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraTrigger, cameraMode])

  useEffect(() => {
    if (following && position && positionKind === 'LIVE') {
      // Following means a road-reading zoom, not the region overview.
      if (ready) run(`window.cam({view:[${position[0]},${position[1]}],zoom:${FOLLOW_ZOOM}})`)
    } else if (positionKind !== 'LIVE') setFollowing(false)
  }, [following, ready, run, position?.[0], position?.[1], positionKind]) // eslint-disable-line react-hooks/exhaustive-deps

  // Follow from the first LIVE fix; a drag hands the camera back; Recenter
  // resumes it. Only the transition into LIVE arms it.
  const wasLive = useRef(false)
  useEffect(() => {
    const live = positionKind === 'LIVE' && position !== null
    if (live && !wasLive.current) setFollowing(true)
    wasLive.current = live
  }, [positionKind, position !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasRoute = points.length > 0

  return (
    <View style={styles.root} testID={testID}>
      <WebView
        ref={web}
        style={StyleSheet.absoluteFill}
        source={{ html: HTML, baseUrl: 'https://driver.rasta.local/' }}
        originWhitelist={['*']}
        onMessage={onMessage}
        onError={() => setTileError(true)}
        setBuiltInZoomControls={false}
        overScrollMode="never"
        bounces={false}
        androidLayerType="hardware"
      />

      {tileError ? (
        <View style={styles.tileError} accessibilityRole="alert">
          <Text style={styles.tileErrorText}>
            {t('Map tiles could not load. The route shown is from your trip and is still correct.')}
          </Text>
        </View>
      ) : null}

      {cameraTrigger === undefined ? (
        <>
          <Pressable
            onPress={() => fitRoute()}
            disabled={!hasRoute}
            accessibilityRole="button"
            accessibilityLabel="Fit the whole route on screen"
            style={[styles.control, styles.fit, !hasRoute && styles.controlOff]}
          >
            <Text style={styles.controlLabel}>Fit route</Text>
          </Pressable>
          {position !== null ? (
            <Pressable
              onPress={() => { setFollowing(positionKind === 'LIVE'); run(`window.cam({pan:[${position[0]},${position[1]}]})`) }}
              accessibilityRole="button"
              accessibilityLabel={positionKind === 'LIVE' ? 'Recenter and follow my location' : 'Center the map on my last known location'}
              accessibilityState={{ selected: following }}
              style={[styles.control, styles.recentre]}
            >
              <Text style={styles.controlLabel}>{following ? 'Following location' : positionKind === 'LIVE' ? 'Recenter' : 'Last known fix'}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: '#E8EDEB' },
  control: {
    position: 'absolute',
    // 48 is the driver-app floor for a primary control: gloved hands, moving
    // vehicle. See MASTER.md "Touch targets".
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D5DEDA',
  },
  controlOff: { opacity: 0.5 },
  fit: { left: 12, top: 12 },
  recentre: { left: 12, top: 68 },
  controlLabel: { color: '#101820', fontSize: 14, fontWeight: '700' },
  tileError: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 40,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(69,26,3,0.95)',
    borderWidth: 1,
    borderColor: '#78350F',
  },
  tileErrorText: { color: '#FDE68A', fontSize: 13, fontWeight: '500' },
})
