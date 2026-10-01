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
 * page says so, the same failure mode the web map names.
 *
 * SUBRESOURCE INTEGRITY (SEC-008). Both unpkg assets carry a pinned
 * `sha384` digest. Without one, a compromised or substituted CDN response
 * would execute inside the WebView that draws a driver's route - and the
 * version pin alone does not prevent that, because it trusts the CDN to
 * serve what the pin names. The browser now verifies the bytes and refuses
 * anything else: `if(!window.L)` below already reports the failure to RN
 * as a tile error, so a rejected script degrades to "map unavailable"
 * rather than to a blank screen. No map rotation:
 * the camera stays north-up and the truck arrow turns instead.
 *
 * The bridge is two one-liners: RN -> page `scene(layers)` / `cam(cmd)` via
 * injectJavaScript, page -> RN `{t: ...}` via postMessage.
 *
 * THEME. The page is built ONCE per mount, already in the theme it opens in
 * (no light frame under a Dark screen), and a later switch only toggles
 * `dark` on <html> through injectJavaScript. Regenerating the HTML would
 * reload Leaflet and every tile and throw away the camera the driver set.
 * If the page reloads on its own (renderer restart), its next 'ready' gets
 * the current class, scene, hillshade and framing again.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import { useT } from '../i18n/tx'
import { useTheme } from '../theme-context'
import { boundsOf } from './geo'
import { routeCameraKey } from './routeDisplay'
import { ARROW_STYLE, HILLSHADE_ATTRIBUTION, HILLSHADE_URL, MAP_COLOURS, leafletDarkCss, sceneLayers } from './scene'
import type { DriverRouteMapProps } from './types'

/** Assam, so a map with no route still opens somewhere meaningful. */
const NER_CENTRE = '[26.2006, 92.9376]'
/** Zoom used while following the truck: roads and villages readable. */
const FOLLOW_ZOOM = 13

const mapHtml = (dark: boolean) => `<!doctype html><html${dark ? ' class="dark"' : ''}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  integrity="sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H"
  crossorigin="anonymous">
<style>html,body,#m{margin:0;height:100%;background:${MAP_COLOURS.light.ground}}.leaflet-control-attribution{font-size:9px}
html.dark,html.dark body,html.dark #m{background:${MAP_COLOURS.dark.ground}}
${leafletDarkCss('html.dark')}</style>
</head><body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
  integrity="sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH"
  crossorigin="anonymous"></script>
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
 else l=L.marker(s.p,{icon:L.divIcon({className:'',html:'<div style="${ARROW_STYLE}border-bottom-color:'+s.c+';transform:rotate('+s.h+'deg)"></div>',iconSize:[22,22],iconAnchor:[11,11]})});
 if(s.tip)l.bindTooltip(esc(s.tip));if(s.id)l.on('click',function(){send({t:'place',id:s.id})});l.addTo(map);drawn.push(l)})};
var hill=null;window.hill=function(u){if(hill){hill.remove();hill=null}if(!u)return;hill=L.tileLayer(u,{maxNativeZoom:12,maxZoom:19,opacity:.55,attribution:${JSON.stringify(HILLSHADE_ATTRIBUTION)}});hill.on('tileerror',function(){if(hill){hill.remove();hill=null}});hill.addTo(map)};
var rm=function(){return !!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)};
var framing=function(b,f){if(!f)return{padding:[40,40]};var g=12,s=map.getSize(),room=function(o){return o.paddingTopLeft.add(o.paddingBottomRight)},
 a={paddingTopLeft:L.point(g,f.top),paddingBottomRight:L.point(f.right,f.obstacle.height+g)},
 c={paddingTopLeft:L.point(f.obstacle.width+g,f.top),paddingBottomRight:L.point(f.right,g)},
 ok=[a,c].filter(function(o){var p=room(o);return p.x<s.x-40&&p.y<s.y-40});
 if(!ok.length)return{padding:[40,40]};var z=function(o){return map.getBoundsZoom(b,false,room(o))};
 return ok.reduce(function(x,y){return z(y)>z(x)?y:x})};
window.cam=function(c){var an=!rm();if(c.fit){var b=L.latLngBounds(c.fit),o=framing(b,c.frame);o.animate=c.animate&&an;map.fitBounds(b,o)}else if(c.view)map.setView(c.view,c.exact?c.zoom:Math.max(map.getZoom(),c.zoom),{animate:an&&!c.exact});else if(c.pan)map.panTo(c.pan,{animate:an})};
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
  autoFollow = true,
  frame,
  cameraTrigger,
  cameraMode,
  testID,
}: DriverRouteMapProps) {
  const { mode, colors } = useTheme()
  const mc = MAP_COLOURS[mode]
  // Built from the theme at mount and never again: see THEME above.
  const [html] = useState(() => mapHtml(mode === 'dark'))
  const web = useRef<WebView | null>(null)
  // Counts the page's 'ready' messages, not just the first: an Android
  // renderer restart or an iOS content-process kill reloads the page from the
  // mount-time html, and everything injected since (theme class, scene,
  // hillshade, camera) has to be sent again. Every effect below keys on it.
  const [ready, setReady] = useState(0)
  // What the page last drew and framed. Reset on every 'ready', because a
  // reloaded page has drawn nothing.
  const lastScene = useRef('')
  const fittedFor = useRef<string | null>(null)
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
    if (m.t === 'ready') {
      lastScene.current = ''
      fittedFor.current = null
      setReady((n) => n + 1)
    }
    else if (m.t === 'drag') setFollowing(false)
    else if (m.t === 'tileerror') setTileError(true)
    else if (m.t === 'tileload') setTileError(false)
    else if (m.t === 'bounds') viewportRef.current?.({ south: m.south!, west: m.west!, north: m.north!, east: m.east! })
    else if (m.t === 'place') { const place = placesRef.current.find((p) => p.provider_id === m.id); if (place) onSelectPlace?.(place) }
  }, [onSelectPlace])

  // Everything drawn from props, as one list, whenever any of it changes.
  // The screen re-renders every second (its clock), so the list is compared
  // as text and only crosses the bridge when something on it moved.
  useEffect(() => {
    if (!ready) return
    const json = JSON.stringify(sceneLayers({ points, progressFraction, backupPoints, showBackup, terrainSegments, hazards, stops, position, positionKind, positionSource, accuracyM, positionAgeSeconds, headingDeg, places, selectedPlaceId, trafficSegments }, mode))
    if (json === lastScene.current) return
    lastScene.current = json
    run('window.scene(' + json + ')')
  }, [ready, run, points, progressFraction, backupPoints, showBackup, terrainSegments, hazards, stops, position, positionKind, positionSource, accuracyM, positionAgeSeconds, headingDeg, places, selectedPlaceId, trafficSegments, mode])

  // A theme switch is one class on the page: tiles, camera and layers stay.
  useEffect(() => {
    if (ready) run(`document.documentElement.classList.toggle('dark', ${mode === 'dark'})`)
  }, [ready, run, mode])

  useEffect(() => {
    if (ready) run(`window.hill(${JSON.stringify(hillshade ? HILLSHADE_URL : null)})`)
  }, [ready, run, hillshade])

  // The frame and the reduced-motion rule are the web map's (see there).
  const frameRef = useRef(frame)
  frameRef.current = frame
  function fitRoute(animate = true, keepFollowing = false) {
    if (!keepFollowing) setFollowing(false)
    const box = boundsOf(points)
    if (box === null) return
    run(`window.cam({fit:[[${box.minLat},${box.minLon}],[${box.maxLat},${box.maxLon}]],animate:${animate},frame:${JSON.stringify(frameRef.current ?? null)}})`)
  }

  // No route to frame: open on the phone's own position at a road-reading
  // zoom, not the whole North East. Once per loaded page (see the web map).
  const placedAt = useRef(0)
  useEffect(() => {
    if (!ready || placedAt.current === ready || points.length > 0 || position === null) return
    placedAt.current = ready
    run(`window.cam({view:[${position[0]},${position[1]}],zoom:${FOLLOW_ZOOM},exact:true})`)
  }, [ready, run, position?.[0], position?.[1], points.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Frame the route ONCE per route, not on every poll.
  const cameraKey = routeCameraKey(routeId, points)
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
    const live = autoFollow && positionKind === 'LIVE' && position !== null
    if (live && !wasLive.current) setFollowing(true)
    wasLive.current = live
  }, [autoFollow, positionKind, position !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasRoute = points.length > 0

  return (
    <View style={[styles.root, { backgroundColor: mc.ground }]} testID={testID}>
      <WebView
        ref={web}
        // The native view's own background, painted before the page loads:
        // white here was a flash under a Dark screen on every mount.
        style={[StyleSheet.absoluteFill, { backgroundColor: mc.ground }]}
        source={{ html, baseUrl: 'https://driver.rasta.local/' }}
        originWhitelist={['*']}
        onMessage={onMessage}
        onError={() => setTileError(true)}
        setBuiltInZoomControls={false}
        overScrollMode="never"
        bounces={false}
        androidLayerType="hardware"
      />

      {tileError ? (
        <View style={[styles.tileError, { backgroundColor: colors.warningSoft, borderColor: colors.warningBorder }]} accessibilityRole="alert">
          <Text style={[styles.tileErrorText, { color: colors.warning }]}>
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
            style={[styles.control, { backgroundColor: mc.control, borderColor: mc.controlBorder }, styles.fit, !hasRoute && styles.controlOff]}
          >
            <Text style={[styles.controlLabel, { color: mc.controlText }]}>Fit route</Text>
          </Pressable>
          {position !== null ? (
            <Pressable
              onPress={() => { setFollowing(positionKind === 'LIVE'); run(`window.cam({pan:[${position[0]},${position[1]}]})`) }}
              accessibilityRole="button"
              accessibilityLabel={positionKind === 'LIVE' ? 'Recenter and follow my location' : 'Center the map on my last known location'}
              accessibilityState={{ selected: following }}
              style={[styles.control, { backgroundColor: mc.control, borderColor: mc.controlBorder }, styles.recentre]}
            >
              <Text style={[styles.controlLabel, { color: mc.controlText }]}>{following ? 'Following location' : positionKind === 'LIVE' ? 'Recenter' : 'Last known fix'}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  control: {
    position: 'absolute',
    // 48 is the driver-app floor for a primary control: gloved hands, moving
    // vehicle. See MASTER.md "Touch targets".
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  controlOff: { opacity: 0.5 },
  fit: { left: 12, top: 12 },
  recentre: { left: 12, top: 68 },
  controlLabel: { fontSize: 14, fontWeight: '700' },
  tileError: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 40,
    padding: 10,
    borderRadius: 8,
    // Colours from the theme at render (REG-4).
    borderWidth: 1,
  },
  tileErrorText: { fontSize: 13, fontWeight: '500' },
})
