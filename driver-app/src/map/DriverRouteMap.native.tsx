/**
 * The driver's route map on Android and iOS.
 *
 * `react-native-maps` 1.27.2, chosen by `expo install` against the installed
 * Expo SDK 57 rather than pinned by hand, so the native module matches the
 * runtime it will be built into. It is the adapter Expo documents for this
 * stack and it works in Expo Go, which a MapLibre native choice would not
 * without its own prebuild.
 *
 * NOT VERIFIED ON HARDWARE. No device or emulator was available in the session
 * that wrote this file, so this is an implemented adapter and NOT a
 * demonstrated one. See the report: `DRIVER_NATIVE` is reported separately
 * from `DRIVER_WEB` for exactly this reason. Do not describe it as working
 * until it has been opened on a real build.
 *
 * PLATFORM ISOLATION. Metro resolves `.native.tsx` for ios/android and
 * `.web.tsx` for web, so this file - and therefore `react-native-maps` - is
 * never reachable from an Expo web bundle. That is the whole reason the two
 * implementations are separate files rather than one file branching on
 * `Platform.OS`, which would put a native import in the web graph.
 *
 * COORDINATES. `react-native-maps` is lat-lon, which is the order this whole
 * application already uses, so - unlike the web file - there is no swap here.
 * `./geo` is still the only place that knows about the other convention.
 */

import { useEffect, useRef, useState } from 'react'
import Constants from 'expo-constants'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import MapView, { Marker, Polyline, UrlTile, type MapViewProps } from 'react-native-maps'

import { boundsOf, padBounds, type LatLon } from './geo'
import type { DriverRouteMapProps } from './types'
import { regionBounds, routeCameraKey, splitRoute } from './routeDisplay'
import { COLORS } from '../theme'

/** Assam, so a map with no route still opens somewhere meaningful. */
const NER_REGION = {
  latitude: 26.2006,
  longitude: 92.9376,
  latitudeDelta: 4,
  longitudeDelta: 4,
}

/** Design tokens - see `design-system/ner-fleet-intelligence/MASTER.md`. */
const ROUTE = '#2457D6'
const ROUTE_CASING = '#FFFFFF'
const BACKUP = '#EA580C'
const ORIGIN = '#0F172A'
const LIVE = '#0B756B'
const LAST_KNOWN = '#A65A00'
const COMPLETED = '#93B9AF'

/** Marker colour per service kind. See the web map for why these four. */
const CATEGORY_COLOUR: Record<string, string> = {
  EMERGENCY: '#DC2626',
  TYRES: '#7C3AED',
  HOTEL: '#0891B2',
  REST: '#CA8A04',
}

/** `[lat, lon]` -> the `{ latitude, longitude }` this library wants. */
function toLatLng(points: readonly LatLon[]) {
  return points.map(([latitude, longitude]) => ({ latitude, longitude }))
}

export default function DriverRouteMap({
  routeId,
  progressFraction,
  points,
  backupPoints,
  showBackup,
  stops,
  position,
  positionKind,
  accuracyM,
  positionAgeSeconds,
  places = [],
  selectedPlaceId = null,
  onSelectPlace,
  onViewportChange,
  cameraTrigger,
  cameraMode,
  testID,
}: DriverRouteMapProps) {
  const map = useRef<MapView | null>(null)
  const [ready, setReady] = useState(false)
  const [following, setFollowing] = useState(false)
  const cameraKey = routeCameraKey(routeId, points)
  const { completed, remaining } = splitRoute(points, progressFraction)

  // Frame the route once per route, not on every poll - the same rule the web
  // map and the manager's fleet map both follow. A camera that re-centres
  // every ten seconds cannot be read while driving.
  const fittedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!ready || map.current === null || points.length === 0) return
    if (fittedFor.current === cameraKey) return
    fittedFor.current = cameraKey
    setFollowing(false)

    const box = boundsOf(points)
    if (box === null) return
    const framed = padBounds(box)
    map.current.animateToRegion(
      {
        latitude: (framed.minLat + framed.maxLat) / 2,
        longitude: (framed.minLon + framed.maxLon) / 2,
        latitudeDelta: framed.maxLat - framed.minLat,
        longitudeDelta: framed.maxLon - framed.minLon,
      },
      0,
    )
  }, [cameraKey, ready])

  useEffect(() => {
    if (positionKind !== 'LIVE' || position === null) {
      setFollowing(false)
      return
    }
    if (ready && following) {
      // Update only the centre. The zoom/heading chosen by the driver remains
      // intact rather than jumping to a fixed region on every GPS sample.
      map.current?.animateCamera({ center: { latitude: position[0], longitude: position[1] } }, { duration: 300 })
    }
  }, [following, ready, position?.[0], position?.[1], positionKind])

  function fitRoute() {
    setFollowing(false)
    const box = boundsOf(points)
    if (map.current === null || box === null) return
    const framed = padBounds(box)
    map.current.animateToRegion(
      {
        latitude: (framed.minLat + framed.maxLat) / 2,
        longitude: (framed.minLon + framed.maxLon) / 2,
        latitudeDelta: framed.maxLat - framed.minLat,
        longitudeDelta: framed.maxLon - framed.minLon,
      },
      400,
    )
  }

  function goToPosition() {
    if (map.current === null || position === null) return
    setFollowing(positionKind === 'LIVE')
    map.current.animateCamera({ center: { latitude: position[0], longitude: position[1] } }, { duration: 300 })
  }

  // Camera control signals from screen floating buttons
  useEffect(() => {
    if (!cameraTrigger || !cameraMode) return
    if (cameraMode === 'FIT_ROUTE') {
      fitRoute()
    } else if (cameraMode === 'RECENTER') {
      goToPosition()
    }
  }, [cameraTrigger, cameraMode])

  // `showsUserLocation` is deliberately OFF. The platform blue dot is drawn
  // from the OS location service directly, which would put a live-looking
  // marker on screen even when this app has decided the fix is too old to
  // trust or has no permission at all. The marker below is drawn from the SAME
  // fix the rest of the app reasons about, or not at all.
  const mapProps: MapViewProps = {
    initialRegion: NER_REGION,
    showsUserLocation: false,
    showsMyLocationButton: false,
    showsCompass: true,
    showsScale: true,
    toolbarEnabled: false,
    onMapReady: () => setReady(true),
    onPanDrag: () => setFollowing(false),
    onRegionChangeComplete: (region, details) => {
      if (details?.isGesture) setFollowing(false)
      onViewportChange?.(regionBounds(region))
    },
  }

  const hasRoute = points.length > 0
  const isGoogleConfigured = Constants.expoConfig?.extra?.googleMapsConfigured !== false

  return (
    <View style={styles.root} testID={testID}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        mapType={isGoogleConfigured ? 'standard' : 'none'}
        {...mapProps}
      >
        {!isGoogleConfigured ? (
          <UrlTile
            urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maximumZ={19}
            flipY={false}
            zIndex={0}
          />
        ) : null}

        {showBackup && backupPoints.length > 1 ? (
          <Polyline
            coordinates={toLatLng(backupPoints)}
            strokeColor={BACKUP}
            strokeWidth={4}
            lineDashPattern={[8, 8]}
            zIndex={1}
          />
        ) : null}

        {hasRoute ? (
          <Polyline
            coordinates={toLatLng(points)}
            strokeColor={ROUTE_CASING}
            strokeWidth={10}
            zIndex={2}
          />
        ) : null}
        {remaining.length > 1 ? (
          <Polyline
            coordinates={toLatLng(remaining)}
            strokeColor={ROUTE}
            strokeWidth={6}
            zIndex={3}
          />
        ) : null}
        {completed.length > 1 ? (
          <Polyline coordinates={toLatLng(completed)} strokeColor={COMPLETED} strokeWidth={6} zIndex={3} />
        ) : null}

        {stops.map((stop, index) =>
          stop.lat === null || stop.lon === null ? null : (
            <Marker
              key={stop.stop_id}
              coordinate={{ latitude: stop.lat, longitude: stop.lon }}
              title={stop.name ?? 'Stop ' + stop.sequence}
              description={stop.address ?? undefined}
              pinColor={index === 0 ? ORIGIN : ROUTE}
            />
          ),
        )}

        {/* Only from a real fix. Null draws nothing - never a placeholder. */}
        {position !== null && positionKind !== null ? (
          <Marker
            coordinate={{ latitude: position[0], longitude: position[1] }}
            title={
              positionKind === 'LIVE'
                ? 'Live position'
                : `Last known position — ${positionAgeSeconds == null ? 'age unavailable' : `${Math.round(positionAgeSeconds)}s ago`}`
            }
            description={
              accuracyM === null
                ? undefined
                : 'Accurate to about ' + Math.round(accuracyM) + ' m'
            }
            pinColor={positionKind === 'LIVE' ? LIVE : LAST_KNOWN}
          />
        ) : null}
        {/* Roadside services from the current search. */}
        {places.map((place) => (
          <Marker
            key={place.provider_id}
            coordinate={{ latitude: place.lat, longitude: place.lon }}
            title={place.name ?? 'Unnamed'}
            // The category in words, not only in the pin colour.
            description={place.category.toLowerCase()}
            pinColor={CATEGORY_COLOUR[place.category] ?? '#475569'}
            onPress={() => onSelectPlace?.(place)}
            zIndex={place.provider_id === selectedPlaceId ? 20 : 10}
          />
        ))}
      </MapView>

      {cameraTrigger === undefined ? (
        <>
          <Pressable
            onPress={fitRoute}
            disabled={!hasRoute}
            accessibilityRole="button"
            accessibilityLabel="Fit the whole route on screen"
            style={[styles.control, styles.fit, !hasRoute && styles.controlOff]}
          >
            <Text style={styles.controlLabel}>Fit route</Text>
          </Pressable>

          {position !== null ? (
            <Pressable
              onPress={goToPosition}
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
  root: { flex: 1, overflow: 'hidden' },
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
    borderColor: '#D7E0DE',
  },
  controlOff: { opacity: 0.5 },
  fit: { left: 12, top: 12 },
  recentre: { left: 12, top: 68 },
  controlLabel: { color: '#14282F', fontSize: 14, fontWeight: '700' },
  unconfigured: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
    backgroundColor: COLORS.bg,
  },
  unconfiguredTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  unconfiguredBody: {
    color: COLORS.muted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
})
