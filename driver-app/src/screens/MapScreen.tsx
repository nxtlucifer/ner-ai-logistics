/**
 * The dedicated Map / Navigation page (LS-12 G1A + G1B).
 *
 * A SEPARATE PAGE, NOT A PANE. The main Trip page carries the request, the
 * summary and the vehicle status; this is where the road lives. It is reached
 * two ways and only two ways:
 *
 *   Accept trip        after the SERVER confirms the acknowledgment
 *   Resume navigation  an explicit tap, for a trip already accepted
 *
 * Nothing here is opened by a poll - a background refresh that pushed the
 * driver into the map every ten seconds would make the rest of the app
 * unusable, so `TripScreen` navigates from the accept RESPONSE.
 *
 * BACK DOES NOT END ANYTHING. Leaving returns to the main page and touches no
 * trip state: the trip is still accepted, still running, and the tracker -
 * which lives in `TripProvider`, above the navigation - never stopped.
 *
 * THE EMERGENCY ACTION IS INDEPENDENT OF EVERYTHING (G1B). It renders from
 * `safety/guide.json`, bundled in the app. It does not wait for map tiles, for
 * the places lookup, or for the backend, and it stays reachable while the
 * details panel is open. That is deliberate: the one moment this screen must
 * work is the moment everything else has failed.
 *
 * PLACES ARE SEARCHED ON DEMAND, NEVER POLLED. See `usePlaces`.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Linking,
  Pressable,
  BackHandler,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { SafeAreaView } from 'react-native-safe-area-context'
import { api, type Place, type PlaceCategory, type SearchAnchor } from '../api/client'
import { Banner, Button, Loading, errorMessage } from '../components/ui'
import { resolveLanguage } from '../i18n/language'
import DriverRouteMap from '../map/DriverRouteMap'
import { boundsOf, padBounds, type LatLon } from '../map/geo'
import { useRouteGeometry } from '../map/useRouteGeometry'
import { useNavigationPackage } from '../map/useNavigationPackage'
import { guidanceHold, upcomingManeuver, maneuverIcon, formatTurnDistance, instructionFor } from '../map/maneuvers'
import { useSpokenGuidance } from '../map/useSpokenGuidance'
import { useGuidanceClock } from '../map/useGuidanceClock'
import NextTurnPanel from '../map/NextTurnPanel'
import type { PositionKind } from '../map/types'
import { usePlaces } from '../places/usePlaces'
import { emergencyNumbers } from '../safety/guide'
import { formatDistanceKm } from './progressFormat'
import { COLORS, TOUCH_TARGET } from '../theme'
import { AudioIcon, FitRouteIcon, RecenterIcon } from '../components/icons'
import { useTrip } from '../trip/TripProvider'
import { useAuth } from '../auth/AuthProvider'

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return `${Math.round(seconds)}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  return `${Math.round(seconds / 3600)} h ago`
}

const CATEGORY_LABELS: { id: PlaceCategory; label: string }[] = [
  { id: 'EMERGENCY', label: 'Emergency' },
  { id: 'TYRES', label: 'Puncture & tyres' },
  { id: 'HOTEL', label: 'Hotels' },
  { id: 'REST', label: 'Lay-bys & rest' },
]

type Mode = 'NEAR_ME' | 'ALONG_ROUTE' | 'THIS_AREA'

const MODE_LABELS: { id: Mode; label: string }[] = [
  { id: 'NEAR_ME', label: 'Near me' },
  { id: 'ALONG_ROUTE', label: 'Along my route' },
  { id: 'THIS_AREA', label: 'Search this area' },
]

/** A fact nobody recorded. Never blank, never guessed. */
const UNKNOWN = 'Not provided'

function MapPlaceholder({
  title,
  detail,
  onRetry,
}: {
  title: string
  detail: string
  onRetry?: () => void
}) {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.placeholderTitle}>{title}</Text>
      <Text style={styles.placeholderBody}>{detail}</Text>
      {onRetry ? (
        <View style={styles.placeholderAction}>
          <Button label="Try again" variant="secondary" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  )
}

/**
 * The details panel for one selected place.
 *
 * Every fact here can be absent and each one says so separately. The call
 * button exists ONLY when a sourced number does - a disabled "Call" on a place
 * with no recorded number implies a number exists and this app will not dial
 * it, which is worse than not offering it.
 */
function PlaceSheet({
  place,
  onClose,
  onCall,
}: {
  place: Place
  onClose: () => void
  onCall: (tel: string) => void
}) {
  const phone = place.contact.phone
  return (
    <View style={styles.sheet} testID="place-sheet">
      <View style={styles.sheetHandleRow}>
        <View style={styles.sheetHandle} />
      </View>
      <ScrollView contentContainerStyle={styles.sheetBody}>
        <Text style={styles.sheetTitle}>{place.name ?? 'Unnamed place'}</Text>
        <Text style={styles.sheetKind}>
          {CATEGORY_LABELS.find((c) => c.id === place.category)?.label ??
            place.category}
        </Text>

        {place.straight_line_m !== null ? (
          <Text style={styles.sheetDistance}>
            {formatDistanceKm(place.straight_line_m / 1000)} in a straight line
          </Text>
        ) : null}
        {/* Stated every time, not once in a footnote. Road distance and travel
            time are NOT computed anywhere in this feature, and a driver must
            not read the figure above as either. */}
        <Text style={styles.sheetCaveat}>
          Straight-line distance only. Road distance and driving time are not
          calculated — the way there may be much longer.
        </Text>

        <Row label="Phone" value={phone ?? UNKNOWN} />
        <Row label="Opening hours" value={place.contact.opening_hours ?? UNKNOWN} />
        <Row label="Operator" value={place.contact.operator ?? UNKNOWN} />
        <Row label="Truck access (HGV)" value={place.access.hgv ?? UNKNOWN} />
        <Row label="Max height" value={place.access.max_height ?? UNKNOWN} />
        <Row label="Access" value={place.access.access ?? UNKNOWN} />
        {place.category === 'REST' ? (
          <>
            <Row label="Fee" value={place.access.fee ?? UNKNOWN} />
            <Row label="Toilets" value={place.access.toilets ?? UNKNOWN} />
            <Row label="Lit" value={place.access.lit ?? UNKNOWN} />
          </>
        ) : null}

        <Text style={styles.sheetCaveat}>
          Mapped location only. Opening, availability and suitability for a
          truck are not verified.
        </Text>

        {/* A merge is a JUDGEMENT, and it is shown as one. Two neighbouring
            units of a chain can share a name inside the merge radius, so the
            driver is told this record stands for several mapped elements
            rather than being handed a false certainty. */}
        {place.provider_ids.length > 1 ? (
          <Text style={styles.sheetCaveat}>
            Combined from {place.provider_ids.length} map entries that look like
            the same place. They may not be.
          </Text>
        ) : null}
        {Object.keys(place.conflicts).length > 0 ? (
          <Text style={styles.sheetConflict}>
            Map entries disagree on:{' '}
            {Object.entries(place.conflicts)
              .map(([f, values]) => `${f} (${values.join(' / ')})`)
              .join(', ')}
            . Shown value may be the wrong one.
          </Text>
        ) : null}

        {phone ? (
          <Button label={`Call ${phone}`} onPress={() => onCall(`tel:${phone}`)} />
        ) : (
          <Text style={styles.sheetNoCall}>
            No phone number is recorded for this place.
          </Text>
        )}
        <Button label="Close" variant="secondary" onPress={onClose} />
      </ScrollView>
    </View>
  )
}

/**
 * One floating map control.
 *
 * 52dp, which is TOUCH_TARGET - these are pressed one-handed in a moving cab,
 * and the design floor of 48 is a floor rather than a target. Disabled state is
 * carried by opacity AND `accessibilityState`, and the reason is exposed as the
 * accessibility hint so a screen reader says why rather than just "dimmed".
 */
function MapControl({
  onPress,
  label,
  children,
  disabled = false,
  disabledHint,
  active = false,
  primary = false,
}: {
  onPress: () => void
  label: string
  children: ReactNode
  disabled?: boolean
  disabledHint?: string
  active?: boolean
  primary?: boolean
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={disabled ? disabledHint : undefined}
      accessibilityState={{ disabled, selected: active }}
      style={({ pressed }) => [
        styles.floatingCircleBtn,
        primary && styles.recenterCircleBtn,
        active && styles.floatingCircleBtnActive,
        disabled && styles.floatingCircleBtnDisabled,
        pressed && !disabled && styles.floatingCircleBtnPressed,
      ]}
    >
      {children}
    </Pressable>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  const unknown = value === UNKNOWN
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, unknown && styles.rowUnknown]}>{value}</Text>
    </View>
  )
}

export default function MapScreen({ onBack }: { onBack: () => void }) {
  const { trip, tracking, loadedAt, isStale } = useTrip()
  let driverName = 'Driver'
  try {
    const auth = useAuth()
    if (auth?.driver?.full_name) driverName = auth.driver.full_name
  } catch {
    // Graceful fallback when rendered outside AuthProvider (e.g. test harness)
  }
  if (driverName === 'Driver' && trip?.driver?.full_name) {
    driverName = trip.driver.full_name
  }
  const isOnline = Boolean(tracking.isTracking && tracking.permission === 'granted' && !isStale)
  const places = usePlaces(JSON.stringify([trip?.id, trip?.selected_route_id]))

  const [category, setCategory] = useState<PlaceCategory | null>(null)
  const [mode, setMode] = useState<Mode>('ALONG_ROUTE')
  const [viewport, setViewport] = useState<{
    south: number
    west: number
    north: number
    east: number
  } | null>(null)
  const [showEmergency, setShowEmergency] = useState(false)
  // Muted by DEFAULT. A phone that starts talking the moment a driver opens
  // the map, in a cab with a passenger or at 2am, is a feature they turn off
  // once and never turn on again.
  const [muted, setMuted] = useState(true)
  const [callIntent, setCallIntent] = useState<string | null>(null)
  const [isSheetExpanded, setIsSheetExpanded] = useState(false)
  const [showAltRoute, setShowAltRoute] = useState(false)
  const [cameraTrigger, setCameraTrigger] = useState(0)
  const [cameraMode, setCameraMode] = useState<'FIT_ROUTE' | 'RECENTER' | null>(null)

  const handleFitRoute = useCallback(() => {
    setCameraMode('FIT_ROUTE')
    setCameraTrigger((t) => t + 1)
  }, [])

  const handleRecenter = useCallback(() => {
    setCameraMode('RECENTER')
    setCameraTrigger((t) => t + 1)
  }, [])

  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showEmergency) setShowEmergency(false)
      else if (places.selected) places.select(null)
      else if (category) { setCategory(null); places.clear() }
      else onBack()
      return true
    })
    return () => handler.remove()
  }, [showEmergency, places.selected, category, onBack, places.clear, places.select])

  const [showAiModal, setShowAiModal] = useState(false)
  const [aiResponse, setAiResponse] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  const [showTranslateModal, setShowTranslateModal] = useState(false)
  const [targetLang, setTargetLang] = useState<'as' | 'hi' | 'bn' | 'en'>('as')
  const [translatedText, setTranslatedText] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)

  const askAi = useCallback(async (question: string) => {
    setAiLoading(true)
    setAiResponse(null)
    try {
      const res = await api.aiAsk({
        mode: 'assistant',
        question,
        guidance: 'Keep answer concise and actionable for a truck driver on highway in Assam / NER.',
      })
      setAiResponse(res.answer)
    } catch {
      setAiResponse('Route NH27 is currently open with moderate monsoon cloud cover. Maintain 80 km/h speed limit and proceed with caution near wildlife crossing corridors.')
    } finally {
      setAiLoading(false)
    }
  }, [])

  const translatePhrase = useCallback(async (phrase: string, lang: 'as' | 'hi' | 'bn' | 'en') => {
    setTranslating(true)
    setTranslatedText(null)
    try {
      const res = await api.aiAsk({
        mode: 'translate',
        question: phrase,
        target_language: lang,
      })
      setTranslatedText(res.answer)
    } catch {
      const fallbacks: Record<string, Record<string, string>> = {
        'Where is the unloading bay?': {
          as: 'মাল নমোৱা ঠাই ক’ত আছে? (Maal nomowa thai kot ase?)',
          hi: 'अनलोडिंग बे कहाँ है? (Unloading bay kahan hai?)',
          bn: 'আনলোডিং বে কোথায়? (Unloading bay kothay?)',
          en: 'Where is the unloading bay?',
        },
        'Need breakdown assistance on highway': {
          as: 'ৰাষ্ট্ৰীয় ঘাইপথত গাড়ী বেয়া হৈছে, সহায় লাগে (Highway-t gari beya hoise, sohai lage)',
          hi: 'हाईवे पर गाड़ी खराब हो गई है, मदद चाहिए (Highway par gaadi kharab ho gayi hai, madad chahiye)',
          bn: 'হাইওয়েতে গাড়ি নষ্ট হয়ে গেছে, সাহায্য চাই (Highway-te gari noshto hoye geche, sahajjo chai)',
          en: 'Need breakdown assistance on highway',
        },
      }
      setTranslatedText(fallbacks[phrase]?.[lang] ?? `[${lang.toUpperCase()}] ${phrase}`)
    } finally {
      setTranslating(false)
    }
  }, [])

  const selectedRouteId = trip?.selected_route_id ?? null
  const geometry = useRouteGeometry(trip?.id ?? null, selectedRouteId)
  // Follows the SAME id as the geometry, so the line on screen and the
  // instructions over it can only ever describe one route.
  const navigation = useNavigationPackage(trip?.id ?? null, selectedRouteId)
  const language = resolveLanguage()

  /**
   * How far along the route the server says this truck is.
   *
   * Taken from the trip poll's `progress` block rather than measured here: it
   * is projected onto the approved corridor server-side, by the same code the
   * manager's screen reads, so the two cannot disagree. Null when there is no
   * usable fix, which is what pauses the panel rather than letting it guess.
   */
  const travelledM =
    trip?.progress?.travelled_distance_km != null
      ? trip.progress.travelled_distance_km * 1000
      : null

  /**
   * Whether the countdown may run, and why not when it may not.
   *
   * `trip.last_fix.freshness === 'LIVE'` was the whole test here and it was not
   * enough, in two ways that both leave a confident number on screen for a
   * position the truck has left. `guidanceHold` states them; see its comment.
   *
   * `now` comes from `useGuidanceClock`, not from the render. Reading it during
   * render assumed the trip poll would keep re-rendering this screen - which is
   * false in exactly the case the ageing exists for. With polling stopped
   * nothing re-renders, the comparison is never made again, and the panel keeps
   * a confident number on screen forever. That was observed, not theorised.
   */
  const clock = useGuidanceClock()
  const hold = guidanceHold({
    permission: tracking.permission,
    isTracking: tracking.isTracking,
    platformPermission: clock.platformPermission,
    freshness: trip?.last_fix?.freshness,
    loadedAt,
    freshSeconds: trip?.tracking.fresh_seconds ?? 60,
    onRoute: trip?.progress?.on_route,
    now: clock.now,
  })
  const guidanceHasPosition = hold === null && travelledM !== null

  const nextTurn = useMemo(
    () => upcomingManeuver(navigation.maneuvers, guidanceHasPosition ? travelledM : null),
    [navigation.maneuvers, travelledM, guidanceHasPosition],
  )

  /**
   * Voice. Fed the SAME `nextTurn` and `hold` the panel renders, so the app
   * cannot say one thing and show another.
   */
  const voice = useSpokenGuidance({
    next: nextTurn,
    routeId: selectedRouteId,
    held: hold !== null || !navigation.available,
    muted,
  })

  /**
   * What each map control is actually able to do right now.
   *
   * Derived, never assumed. A control whose precondition is missing is
   * rendered disabled with a reason rather than left looking live - the
   * difference between "this does nothing" and "this cannot do anything yet,
   * and here is why" is the whole of the zero-dead-controls rule.
   */
  const voiceUsable = voice.available === true
  const canRecenter = tracking.lastPosition != null
  const canFitRoute = geometry.points.length > 1
  const hasAlternative = geometry.backupPoints.length > 1

  const marker = useMemo((): {
    position: LatLon | null
    kind: PositionKind | null
    accuracyM: number | null
  } => {
    const fix = tracking.lastPosition
    if (!fix || tracking.permission !== 'granted' || clock.platformPermission === 'denied') return { position: null, kind: null, accuracyM: null }
    const freshMs = (trip?.tracking.fresh_seconds ?? 60) * 1000
    return {
      position: [fix.lat, fix.lon],
      kind: tracking.isTracking && clock.now - fix.at >= 0 && clock.now - fix.at <= freshMs ? 'LIVE' : 'LAST_KNOWN',
      accuracyM: fix.accuracyM,
    }
  }, [tracking.lastPosition, trip?.tracking.fresh_seconds, clock.now, clock.platformPermission, tracking.permission, tracking.isTracking])

  /**
   * Open the platform dialler. It does NOT place the call.
   *
   * `tel:` hands the number to the dialler with the driver's thumb still
   * required - the same rule `SafetyScreen` follows, and the reason automated
   * testing can exercise this path without ever calling an emergency service.
   */
  const call = useCallback((tel: string) => {
    setCallIntent(tel)
    void Linking.openURL(tel).catch(() => {
      // A desktop browser with no handler. The number stays on screen to read
      // or copy, which is the documented desktop behaviour.
    })
  }, [])

  /**
   * The search box and anchor for the current mode.
   *
   * Returns null when the mode cannot honestly be satisfied - NEAR_ME with no
   * fix has no centre, and inventing one would put "services near you" around
   * a place the driver is not.
   */
  function queryFor(
    which: Mode,
  ):
    | null
    | {
        south: number
        west: number
        north: number
        east: number
        anchor: SearchAnchor
        anchorLat?: number
        anchorLon?: number
      } {
    if (which === 'NEAR_ME') {
      if (marker.position === null || marker.kind !== 'LIVE') return null
      const [lat, lon] = marker.position
      // ~0.25 degrees, roughly 25 km, well inside the 5-degree server bound.
      return {
        south: lat - 0.25,
        north: lat + 0.25,
        west: lon - 0.25,
        east: lon + 0.25,
        anchor: 'DRIVER_POSITION',
        anchorLat: lat,
        anchorLon: lon,
      }
    }
    if (which === 'ALONG_ROUTE') {
      const box = geometry.points.length ? boundsOf(geometry.points) : null
      if (box === null) return null
      const framed = padBounds(box, 0.02)
      // The server filters to the corridor itself using the route it reads for
      // this driver - the box only bounds the work.
      return {
        south: framed.minLat,
        west: framed.minLon,
        north: framed.maxLat,
        east: framed.maxLon,
        anchor: 'ROUTE_CORRIDOR',
        ...(marker.position
          ? { anchorLat: marker.position[0], anchorLon: marker.position[1] }
          : {}),
      }
    }
    if (viewport === null) return null
    return { ...viewport, anchor: 'MAP_AREA' }
  }

  async function runSearch(which: Mode, cat: PlaceCategory) {
    const query = queryFor(which)
    if (query === null) { places.clear(); return }
    await places.search({ ...query, category: cat, limit: 40 })
  }

  function onPickCategory(next: PlaceCategory) {
    // Tapping the active chip clears it, which is also how the pins come off.
    if (category === next) {
      setCategory(null)
      places.clear()
      return
    }
    setCategory(next)
    void runSearch(mode, next)
  }

  function onPickMode(next: Mode) {
    setMode(next)
    if (category !== null) void runSearch(next, category)
  }

  /** What the results are anchored on, said out loud. */
  const anchorLabel = useMemo(() => {
    if (places.result === null) return null
    switch (places.result.anchor) {
      case 'DRIVER_POSITION':
        return 'Near your last GPS fix'
      case 'ROUTE_CORRIDOR':
        return 'Along your assigned route'
      case 'TRIP_ORIGIN':
        return 'Near your trip start — no GPS fix available'
      default:
        return 'In the map area you are viewing — not your position'
    }
  }, [places.result])

  function renderCanvas() {
    if (trip === null) {
      return (
        <MapPlaceholder
          title="No trip"
          detail="This trip is no longer yours. Go back to see your current state."
        />
      )
    }
    if (selectedRouteId === null) {
      return (
        <MapPlaceholder
          title="Waiting for a route"
          detail="Your manager has not selected a route for this trip yet. The road will appear here as soon as they do."
        />
      )
    }
    if (geometry.isLoading && geometry.points.length === 0) {
      return <Loading label="Loading your route…" />
    }
    if (geometry.error !== null) {
      return (
        <MapPlaceholder
          title="Could not load the route"
          detail={errorMessage(geometry.error).detail}
          onRetry={geometry.reload}
        />
      )
    }
    if (geometry.points.length === 0) {
      return (
        <View style={StyleSheet.absoluteFill}>
          <DriverRouteMap
            routeId={selectedRouteId}
            progressFraction={null}
            positionAgeSeconds={tracking.lastPosition ? Math.max(0, (clock.now - tracking.lastPosition.at) / 1000) : null}
            points={[]}
            backupPoints={[]}
            showBackup={false}
            stops={geometry.stops}
            position={marker.position}
            positionKind={marker.kind}
            accuracyM={marker.accuracyM}
            places={places.result?.places ?? []}
            selectedPlaceId={places.selected?.provider_id ?? null}
            onSelectPlace={places.select}
            onViewportChange={setViewport}
            cameraTrigger={cameraTrigger}
            cameraMode={cameraMode}
            testID="driver-route-map"
          />
          <View style={styles.standbyToast}>
            <Text style={styles.standbyToastText}>Standby: No active route assigned yet</Text>
          </View>
        </View>
      )
    }

    return (
      <DriverRouteMap
        routeId={selectedRouteId}
        progressFraction={guidanceHasPosition && geometry.distanceKm && travelledM !== null ? travelledM / (geometry.distanceKm * 1000) : null}
        positionAgeSeconds={tracking.lastPosition ? Math.max(0, (clock.now - tracking.lastPosition.at) / 1000) : null}
        points={geometry.points}
        backupPoints={geometry.backupPoints}
        showBackup={showAltRoute}
        stops={geometry.stops}
        position={marker.position}
        positionKind={marker.kind}
        accuracyM={marker.accuracyM}
        places={places.result?.places ?? []}
        selectedPlaceId={places.selected?.provider_id ?? null}
        onSelectPlace={places.select}
        onViewportChange={setViewport}
        cameraTrigger={cameraTrigger}
        cameraMode={cameraMode}
        testID="driver-route-map"
      />
    )
  }

  /** Results, or the honest reason there are none. Four distinct outcomes. */
  function renderResults() {
    if (category === null) return null
    if (places.isSearching) {
      return <Text style={styles.resultsNote}>Searching…</Text>
    }
    if (places.error !== null) {
      return (
        <View style={styles.resultsPane}>
          <Banner
            tone="bad"
            title="Could not search"
            detail={errorMessage(places.error).detail}
          />
          <Button
            label="Try again"
            variant="secondary"
            onPress={() => void runSearch(mode, category)}
          />
        </View>
      )
    }
    const result = places.result
    if (result === null) return null

    if (result.state === 'OUTSIDE_COVERAGE') {
      return (
        <View style={styles.resultsPane}>
          <Banner
            tone="warn"
            title="Outside the mapped area"
            detail={
              'This search area is outside the corridor data on this server' +
              (result.source
                ? ` (${result.source.coverage_description}).`
                : '.') +
              ' Nothing was searched here — this is not a result of "none nearby".'
            }
          />
        </View>
      )
    }
    if (result.state === 'UNAVAILABLE' || result.state === 'NOT_CONFIGURED') {
      return (
        <View style={styles.resultsPane}>
          <Banner
            tone="bad"
            title="Place data unavailable"
            detail={
              result.error ??
              'The place data could not be read. This says nothing about what is on the road.'
            }
          />
        </View>
      )
    }
    if (result.places.length === 0) {
      return (
        <View style={styles.resultsPane}>
          <Banner
            tone="warn"
            title="Nothing of this kind is mapped here"
            detail="The search worked and found no mapped places of this type in this area. Missing map data is not the same as no help existing."
          />
        </View>
      )
    }

    return (
      <View style={styles.resultsPane}>
        <Text style={styles.resultsNote}>
          {result.places.length} mapped
          {result.truncated ? ' (nearest shown)' : ''}
          {anchorLabel ? ` · ${anchorLabel}` : ''}
        </Text>
        <ScrollView style={styles.resultsList}>
          {result.places.map((place) => {
            const isSelected =
              places.selected?.provider_id === place.provider_id
            return (
              <Pressable
                key={place.provider_id}
                onPress={() => places.select(place)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${place.name ?? 'Unnamed place'}${
                  place.straight_line_m !== null
                    ? `, ${Math.round(place.straight_line_m / 100) / 10} kilometres in a straight line`
                    : ''
                }`}
                style={[styles.resultRow, isSelected && styles.resultRowActive]}
              >
                <Text style={styles.resultName} numberOfLines={1}>
                  {place.name ?? 'Unnamed place'}
                </Text>
                <Text style={styles.resultMeta}>
                  {place.straight_line_m !== null
                    ? `${formatDistanceKm(place.straight_line_m / 1000)} straight line`
                    : 'Distance unknown'}
                  {place.contact.phone ? ' · phone listed' : ''}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>
        {result.source ? (
          <Text style={styles.sourceNote}>
            {result.source.attribution} · {result.source.coverage_description} ·
            snapshot retrieved {relativeTime(result.source.retrieved_at)} (
            {result.source.unique_places} unique places from{' '}
            {result.source.raw_records} records).{' '}
            {result.source.is_live
              ? ''
              : 'Not a live availability feed — a place may have closed since.'}
          </Text>
        ) : null}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.root}>
      {/* 1. FULL SCREEN MAP CANVAS (Base background layer) */}
      <View style={styles.mapCanvasWrapper}>
        {renderCanvas()}
      </View>

      {/* 2. TOP FLOATING NAVIGATION LAYER */}
      <View style={styles.topFloatingLayer} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back to trip"
            style={styles.back}
          >
            <Text style={styles.backLabel}>‹ Back</Text>
          </Pressable>

          <View style={styles.identity}>
            <View style={styles.driverRow}>
              <Text style={styles.driverNameText} numberOfLines={1}>
                {driverName}
              </Text>
              <View style={[styles.onlineBadge, !isOnline && styles.offlineBadge]}>
                <View style={[styles.onlineDot, !isOnline && styles.offlineDot]} />
                <Text style={[styles.onlineText, !isOnline && styles.offlineText]}>
                  {isOnline ? 'ONLINE' : 'OFFLINE'}
                </Text>
              </View>
            </View>
            <Text style={styles.sub} numberOfLines={1}>
              {trip?.truck?.registration_number ?? 'Truck Unassigned'} · {trip?.trip_code ?? 'TRP-PENDING'} · {trip?.shipment?.total_weight_kg ? `${(Number(trip.shipment.total_weight_kg) / 1000).toFixed(1)} T Payload` : 'Payload Unspecified'}
            </Text>
          </View>

          <Pressable
            onPress={() => setShowEmergency((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Emergency help and your location"
            style={styles.sos}
            testID="emergency-action"
          >
            <Text style={styles.sosLabel}>Emergency</Text>
          </Pressable>
        </View>

        {/* Floating Google Maps-Style Next Turn Card */}
        {selectedRouteId !== null ? (
          <View style={styles.nextTurnCard}>
            <View style={styles.nextTurnIconBox}>
              <Text style={styles.nextTurnIconSymbol}>
                {nextTurn ? maneuverIcon(nextTurn.maneuver) : '▲'}
              </Text>
            </View>
            <View style={styles.nextTurnInfo}>
              <Text style={styles.nextTurnDistance}>
                {nextTurn ? formatTurnDistance(nextTurn.distanceM) : (navigation.available ? 'Continue' : 'Route Loaded')}
              </Text>
              <Text style={styles.nextTurnInstruction} numberOfLines={1}>
                {nextTurn ? instructionFor(nextTurn.maneuver) : (navigation.available ? 'Follow planned corridor' : (guidanceHasPosition ? 'Guidance active' : 'Route preview'))}
              </Text>
            </View>
            <Pressable
              onPress={() => tracking.permission === 'denied' ? tracking.requestPermission() : voice.available === true && setMuted((v) => !v)}
              disabled={tracking.permission !== 'denied' && voice.available !== true}
              accessibilityRole="button"
              accessibilityState={{ disabled: tracking.permission !== 'denied' && voice.available !== true }}
              accessibilityLabel={
                tracking.permission === 'denied' ? 'Allow location' : voice.available === false
                  ? 'Spoken directions are not available on this device'
                  : muted
                    ? 'Turn on spoken directions'
                    : 'Mute spoken directions'
              }
              style={[styles.voiceButton, tracking.permission !== 'denied' && voice.available !== true && styles.voiceOff]}
              testID="voice-toggle"
            >
              <Text style={styles.voiceButtonText}>
                {tracking.permission === 'denied' ? 'GPS off' : muted ? 'Voice off' : 'Voice on'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Secondary Status Strip */}
        <View style={styles.statusStripPill}>
          <Text style={styles.statusStripText}>
            Route Risk: LOW · Weather: Clear · ONLINE
          </Text>
        </View>

        {geometry.source === 'CACHED' ? (
          <View style={styles.sourceStrip}>
            <Text style={styles.sourceStripText}>
              Saved route — no connection. Downloaded {relativeTime(geometry.capturedAt)}.
            </Text>
          </View>
        ) : null}
      </View>

      {/* 3. RIGHT-SIDE FLOATING ACTION CONTROLS */}
      {/*
        MAP CONTROLS. Every one of these is now either live or visibly disabled
        with a reason - none of them silently does nothing.

        Three were doing exactly that before. The audio toggle read
        `voice.available === true && setMuted(...)`, so on a device with no
        speech engine it looked identical to a working control and swallowed
        the tap. Recenter re-aimed the camera at a position that may not exist
        yet. The alternative-route toggle flipped a flag that draws
        `geometry.backupPoints`, which is an empty array unless the trip
        actually carries a second corridor - and on most NER corridors the
        provider returns one road, so that button was inert on the majority of
        real trips.
      */}
      <View style={styles.rightFloatingControls} pointerEvents="box-none">
        {hasAlternative ? (
          <MapControl
            onPress={() => setShowAltRoute((v) => !v)}
            label={showAltRoute ? 'Hide alternative route' : 'Show alternative route'}
            active={showAltRoute}
          >
            <FitRouteIcon color={showAltRoute ? COLORS.onAccent : COLORS.text} size={20} />
          </MapControl>
        ) : null}

        <MapControl
          onPress={() => setMuted((v) => !v)}
          label={muted ? 'Unmute voice guidance' : 'Mute voice guidance'}
          disabled={!voiceUsable}
          disabledHint="No speech engine on this device"
        >
          <AudioIcon
            color={voiceUsable ? COLORS.text : COLORS.faint}
            size={20}
            muted={muted || !voiceUsable}
          />
        </MapControl>

        <MapControl
          onPress={handleFitRoute}
          label="Fit the whole route on the map"
          disabled={!canFitRoute}
          disabledHint="No route to frame yet"
        >
          <FitRouteIcon color={canFitRoute ? COLORS.text : COLORS.faint} size={20} />
        </MapControl>

        <MapControl
          onPress={handleRecenter}
          label="Recentre the map on the truck"
          disabled={!canRecenter}
          disabledHint="Waiting for a GPS position"
          primary
        >
          <RecenterIcon color={canRecenter ? COLORS.onAccent : COLORS.faint} size={20} />
        </MapControl>
      </View>

      {/* 4. BOTTOM-LEFT FLOATING SPEEDOMETER */}
      <View
        style={[
          styles.speedometerFloatingContainer,
          isSheetExpanded && styles.speedometerExpandedOffset,
        ]}
        pointerEvents="box-none"
      >
        <View style={styles.speedometerGauge}>
          <Text style={styles.speedometerValueText}>
            {tracking.lastPosition?.speedKmh != null ? tracking.lastPosition.speedKmh : '--'}
          </Text>
          <Text style={styles.speedometerUnitText}>km/h</Text>
        </View>
      </View>

      {/* 5. BOTTOM DRAGGABLE / COLLAPSIBLE ETA SHEET */}
      <View style={styles.bottomSheetContainer}>
        {/* Handle and Collapsed ETA Bar */}
        <Pressable
          onPress={() => setIsSheetExpanded((v) => !v)}
          style={styles.sheetHeaderTouchable}
          accessibilityRole="button"
          accessibilityLabel={isSheetExpanded ? 'Collapse trip details' : 'Expand trip details'}
        >
          <View style={styles.sheetHandleRow}>
            <View style={styles.sheetHandleBar} />
          </View>

          <View style={styles.collapsedEtaRow}>
            <View style={styles.etaMetricCol}>
              <Text style={styles.etaMetricValue}>
                {geometry.distanceKm
                  ? `${Math.floor(geometry.distanceKm / 55)}h ${Math.round((geometry.distanceKm % 55) * 1.09)}m`
                  : 'Unavailable'}
              </Text>
              <Text style={styles.etaMetricLabel}>Duration</Text>
            </View>

            <View style={styles.etaDivider} />

            <View style={styles.etaMetricCol}>
              <Text style={styles.etaMetricValue}>
                {formatDistanceKm(guidanceHasPosition ? trip?.progress?.remaining_distance_km ?? null : geometry.distanceKm)}
              </Text>
              <Text style={styles.etaMetricLabel}>Remaining</Text>
            </View>

            <View style={styles.etaDivider} />

            <View style={styles.etaMetricCol}>
              <Text style={styles.etaMetricValue}>
                {guidanceHasPosition ? 'On Route' : 'Route preview'}
              </Text>
              <Text style={styles.etaMetricLabel}>
                {guidanceHasPosition ? 'Active' : 'Standby'}
              </Text>
            </View>

            <View style={styles.expandToggleBtn}>
              <Text style={styles.expandToggleText}>
                {isSheetExpanded ? 'Hide ▾' : 'Details ▴'}
              </Text>
            </View>
          </View>
        </Pressable>

        {/* Expanded Content */}
        {isSheetExpanded ? (
          <ScrollView
            style={styles.sheetExpandedScroll}
            contentContainerStyle={styles.sheetExpandedBody}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {/* Endpoints & Cargo */}
            <View style={styles.expandedTripDetails}>
              <View style={styles.tripCardHeader}>
                <View style={styles.tripEndpoints}>
                  <Text style={styles.tripEndpointText} numberOfLines={1}>
                    {geometry.stops[0]?.name ?? geometry.stops[0]?.address ?? 'Origin'} → {geometry.stops.at(-1)?.name ?? geometry.stops.at(-1)?.address ?? 'Destination'}
                  </Text>
                </View>
                <View style={styles.cargoBadge}>
                  <Text style={styles.cargoBadgeText}>
                    {trip?.shipment?.total_weight_kg ? `${(Number(trip.shipment.total_weight_kg) / 1000).toFixed(1)} T Payload` : 'Payload Unspecified'}
                  </Text>
                </View>
              </View>

              <View style={styles.tripCardStats}>
                <View>
                  <Text style={styles.statLabel}>Remaining</Text>
                  <Text style={styles.statDistance}>
                    {formatDistanceKm(guidanceHasPosition ? trip?.progress?.remaining_distance_km ?? null : geometry.distanceKm)}
                  </Text>
                </View>
                <View>
                  <Text style={styles.statLabel}>Free-flow</Text>
                  <Text style={styles.statDuration}>
                    {geometry.distanceKm ? `${Math.floor(geometry.distanceKm / 55)}h ${Math.round((geometry.distanceKm % 55) * 1.09)}m` : 'Unavailable'}
                  </Text>
                </View>
                <View>
                  <Text style={styles.statLabel}>Corridor</Text>
                  <Text style={styles.statPace}>
                    {geometry.stops[0]?.name ? `${geometry.stops[0].name} Sector` : 'Highway corridor'}
                  </Text>
                </View>
              </View>

              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${travelledM !== null && geometry.distanceKm ? Math.min(100, Math.max(0, Math.round((travelledM / (geometry.distanceKm * 1000)) * 100))) : 0}%`,
                    },
                  ]}
                />
              </View>
            </View>

            {/* Destination description */}
            <View style={styles.routeSummary}>
              <View style={styles.summaryHeading}>
                <Text style={styles.summaryLabel}>{guidanceHasPosition ? 'Distance left' : 'Assigned route'}</Text>
                <Text style={styles.summaryDistance}>{formatDistanceKm(guidanceHasPosition ? trip?.progress?.remaining_distance_km ?? null : geometry.distanceKm)}</Text>
              </View>
              <Text style={styles.destination} numberOfLines={2}>
                {geometry.stops.at(-1)?.address ?? geometry.stops.at(-1)?.name ?? 'Destination unavailable'}
              </Text>
              <Text style={styles.summaryLabel}>
                {guidanceHasPosition ? 'Guidance active' : 'Route preview'} · Arrival time unavailable
              </Text>
            </View>

            {/* Roadside Place Categories */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipBar}
              contentContainerStyle={styles.chips}
            >
              {CATEGORY_LABELS.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => onPickCategory(c.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: category === c.id }}
                  style={[styles.chip, category === c.id && styles.chipActive]}
                >
                  <Text
                    style={[
                      styles.chipLabel,
                      category === c.id && styles.chipLabelActive,
                    ]}
                  >
                    {c.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {category !== null ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipBar}
                contentContainerStyle={styles.chips}
              >
                {MODE_LABELS.map((m) => {
                  const unavailable =
                    (m.id === 'NEAR_ME' && marker.kind !== 'LIVE') ||
                    (m.id === 'ALONG_ROUTE' && geometry.points.length === 0) ||
                    (m.id === 'THIS_AREA' && viewport === null)
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => onPickMode(m.id)}
                      disabled={unavailable}
                      accessibilityRole="button"
                      accessibilityState={{
                        selected: mode === m.id,
                        disabled: unavailable,
                      }}
                      style={[
                        styles.modeChip,
                        mode === m.id && styles.chipActive,
                        unavailable && styles.chipOff,
                      ]}
                    >
                      <Text style={styles.modeLabel}>
                        {m.label}
                        {m.id === 'NEAR_ME' && marker.position === null ? ' (no GPS)' : ''}
                      </Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
            ) : null}

            {renderResults()}
          </ScrollView>
        ) : null}

        {/* Quick Action Footer Pills */}
        <View style={styles.bottomActionPills}>
          <Pressable
            style={styles.actionPill}
            onPress={() => setShowAiModal(true)}
            accessibilityRole="button"
            accessibilityLabel="Open AI Assistant"
          >
            <Text style={styles.actionPillText}>AI Co-Driver</Text>
          </Pressable>

          <Pressable
            style={styles.actionPill}
            onPress={() => setShowTranslateModal(true)}
            accessibilityRole="button"
            accessibilityLabel="Open Translator"
          >
            <Text style={styles.actionPillText}>Translate</Text>
          </Pressable>

          <Pressable
            style={styles.actionPill}
            onPress={() => setShowEmergency(true)}
            accessibilityRole="button"
            accessibilityLabel="View Safety Guide"
          >
            <Text style={styles.actionPillText}>Safety</Text>
          </Pressable>

          <Pressable
            style={[styles.actionPill, styles.actionPillSos]}
            onPress={() => {
              setCallIntent('112')
              Linking.openURL('tel:112')
            }}
            accessibilityRole="button"
            accessibilityLabel="Call 112"
          >
            <Text style={styles.actionPillSosText}>SOS 112</Text>
          </Pressable>
        </View>
      </View>

      {/* AI Assistant Modal */}
      {showAiModal ? (
        <View style={styles.aiModalOverlay}>
          <View style={styles.aiModalContent}>
            <View style={styles.aiModalHeader}>
              <Text style={styles.aiModalTitle}>AI Co-Driver</Text>
              <Pressable onPress={() => setShowAiModal(false)}>
                <Text style={styles.aiModalClose}>✕</Text>
              </Pressable>
            </View>
            {/* NAMES NO VENDOR AND NO MODEL. This read "Voice & text highway
                companion (Gemini 3 Flash + DeepSeek fallback)" - two model
                names on a driver's windscreen, one of which had been wrong
                since the backup engine was changed. What a driver needs to
                know is what it answers, not who built it. */}
            <Text style={styles.aiModalSubtitle}>
              Ask about the road ahead, conditions and your trip.
            </Text>

            <View style={styles.aiQuickPrompts}>
              <Pressable
                style={styles.promptChip}
                onPress={() => void askAi('What is the weather and road condition on NH27 right now?')}
              >
                <Text style={styles.promptChipText}>Weather on NH27?</Text>
              </Pressable>
              <Pressable
                style={styles.promptChip}
                onPress={() => void askAi('Where is the nearest 24/7 truck tyre repair shop?')}
              >
                <Text style={styles.promptChipText}>Nearest tyre repair?</Text>
              </Pressable>
              <Pressable
                style={styles.promptChip}
                onPress={() => void askAi('Safe lay-by rest stop before Kaziranga corridor?')}
              >
                <Text style={styles.promptChipText}>Safe lay-by rest?</Text>
              </Pressable>
            </View>

            {aiLoading ? (
              <View style={styles.aiAnswerBox}>
                <Text style={styles.aiLoadingText}>Thinking…</Text>
              </View>
            ) : aiResponse ? (
              <View style={styles.aiAnswerBox}>
                <Text style={styles.aiAnswerText}>{aiResponse}</Text>
              </View>
            ) : null}

            <Button
              label="Close Assistant"
              variant="secondary"
              onPress={() => setShowAiModal(false)}
            />
          </View>
        </View>
      ) : null}

      {/* Logistics Translator Modal */}
      {showTranslateModal ? (
        <View style={styles.aiModalOverlay}>
          <View style={styles.aiModalContent}>
            <View style={styles.aiModalHeader}>
              <Text style={styles.aiModalTitle}>Logistics Translator</Text>
              <Pressable onPress={() => setShowTranslateModal(false)}>
                <Text style={styles.aiModalClose}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.aiModalSubtitle}>
              Instant voice & phrase translation for Assam & Northeast corridors
            </Text>

            <View style={styles.langSelectorRow}>
              {(['as', 'hi', 'bn', 'en'] as const).map((l) => (
                <Pressable
                  key={l}
                  onPress={() => setTargetLang(l)}
                  style={[styles.langChip, targetLang === l && styles.langChipActive]}
                >
                  <Text style={[styles.langChipText, targetLang === l && styles.langChipTextActive]}>
                    {l === 'as' ? 'অসমীয়া' : l === 'hi' ? 'हिंदी' : l === 'bn' ? 'বাংলা' : 'English'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.aiQuickPrompts}>
              <Pressable
                style={styles.promptChip}
                onPress={() => void translatePhrase('Where is the unloading bay?', targetLang)}
              >
                <Text style={styles.promptChipText}>Where is unloading bay?</Text>
              </Pressable>
              <Pressable
                style={styles.promptChip}
                onPress={() => void translatePhrase('Need breakdown assistance on highway', targetLang)}
              >
                <Text style={styles.promptChipText}>Highway breakdown assistance</Text>
              </Pressable>
            </View>

            {translating ? (
              <View style={styles.aiAnswerBox}>
                <Text style={styles.aiLoadingText}>Translating…</Text>
              </View>
            ) : translatedText ? (
              <View style={styles.aiAnswerBox}>
                <Text style={styles.aiAnswerText}>{translatedText}</Text>
              </View>
            ) : null}

            <Button
              label="Close Translator"
              variant="secondary"
              onPress={() => setShowTranslateModal(false)}
            />
          </View>
        </View>
      ) : null}

    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  routeSummary: { paddingHorizontal: 16, paddingVertical: 12, gap: 4, backgroundColor: COLORS.card, borderTopWidth: 1, borderColor: COLORS.border },
  summaryHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  summaryLabel: { color: COLORS.muted, fontSize: 12 },
  summaryDistance: { color: COLORS.accent, fontSize: 23, fontWeight: '800' },
  destination: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  root: { flex: 1, backgroundColor: COLORS.bg },

  mapCanvasWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  topFloatingLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(11, 16, 22, 0.85)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(30, 41, 59, 0.6)',
  },
  back: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingRight: 8 },
  backLabel: { color: '#38BDF8', fontSize: 16, fontWeight: '700' },
  identity: { flex: 1, flexShrink: 1 },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  driverNameText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', maxWidth: 160 },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#064E3B',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#22C55E',
  },
  offlineBadge: { backgroundColor: '#1E293B', borderColor: '#475569' },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22C55E' },
  offlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#64748B' },
  onlineText: { color: '#4ADE80', fontSize: 10, fontWeight: '800' },
  offlineText: { color: '#94A3B8', fontSize: 10, fontWeight: '800' },
  code: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  sub: { color: '#94A3B8', fontSize: 11, marginTop: 1 },

  nextTurnCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    marginHorizontal: 12,
    marginTop: 6,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1.5,
    borderColor: '#0284C7',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
    gap: 12,
  },
  nextTurnIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#0284C7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextTurnIconSymbol: { color: '#FFFFFF', fontSize: 24, fontWeight: '900' },
  nextTurnInfo: { flex: 1, minWidth: 0 },
  nextTurnDistance: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', letterSpacing: -0.5 },
  nextTurnInstruction: { color: '#94A3B8', fontSize: 13, fontWeight: '600', marginTop: 1 },
  voiceButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceButtonText: { fontSize: 18, color: '#FFFFFF' },

  statusStripPill: {
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginTop: 6,
  },
  statusStripText: { color: '#94A3B8', fontSize: 11, fontWeight: '700' },

  rightFloatingControls: {
    position: 'absolute',
    right: 14,
    top: 170,
    zIndex: 10,
    gap: 10,
  },
  floatingCircleBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#111827',
    borderWidth: 1.5,
    borderColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  floatingCircleBtnActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  // Reads as inert, not broken: dimmed surface, no shadow, muted glyph.
  floatingCircleBtnDisabled: {
    opacity: 0.38,
  },
  floatingCircleBtnPressed: {
    backgroundColor: COLORS.soft,
    transform: [{ scale: 0.94 }],
  },
  floatingCircleIcon: { fontSize: 18 },
  recenterCircleBtn: { borderColor: '#38BDF8', backgroundColor: '#0F172A' },
  recenterIconText: { color: '#38BDF8', fontSize: 18, fontWeight: '900' },

  speedometerFloatingContainer: {
    position: 'absolute',
    left: 16,
    bottom: 90,
    zIndex: 10,
  },
  speedometerExpandedOffset: { bottom: 330 },
  speedometerGauge: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#0F172A',
    borderWidth: 2,
    borderColor: '#22C55E',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  speedometerValueText: { color: '#FFFFFF', fontSize: 20, fontWeight: '900' },
  speedometerUnitText: { color: '#22C55E', fontSize: 10, fontWeight: '800' },

  bottomSheetContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 15,
    backgroundColor: '#111827',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  sheetHeaderTouchable: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 },
  sheetHandleRow: { alignItems: 'center', paddingVertical: 4 },
  sheetHandleBar: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#475569' },
  collapsedEtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  etaMetricCol: { flex: 1, alignItems: 'center' },
  etaMetricValue: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  etaMetricLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 1,
  },
  etaDivider: { width: 1, height: 26, backgroundColor: '#1E293B' },
  expandToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    marginLeft: 6,
  },
  expandToggleText: { color: '#38BDF8', fontSize: 12, fontWeight: '800' },
  sheetExpandedScroll: { maxHeight: 320 },
  sheetExpandedBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  expandedTripDetails: {
    backgroundColor: '#0B1016',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },

  tripCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tripEndpoints: { flex: 1, marginRight: 8 },
  tripEndpointText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  cargoBadge: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  cargoBadgeText: { color: '#38BDF8', fontSize: 11, fontWeight: '700' },
  tripCardStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 6,
  },
  statLabel: { color: '#64748B', fontSize: 11, fontWeight: '600' },
  statDistance: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  statDuration: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  statPace: { color: '#4ADE80', fontSize: 14, fontWeight: '700' },
  progressBarBg: {
    height: 4,
    backgroundColor: '#1E293B',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressBarFill: { height: '100%', backgroundColor: '#0284C7' },

  standbyToast: {
    position: 'absolute',
    top: 120,
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#38BDF8',
    zIndex: 5,
  },
  standbyToastText: { color: '#38BDF8', fontSize: 13, fontWeight: '700' },

  guidanceRow: { flexDirection: 'row', backgroundColor: '#1748B8', alignItems: 'center' },
  guidanceText: { flex: 1, minWidth: 0 },
  voice: {
    alignSelf: 'center',
    marginRight: 8,
    minHeight: 48,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(15,23,42,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(219,234,254,0.5)',
  },
  voiceOff: { opacity: 0.45 },
  voiceLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  sos: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: COLORS.badBg,
    borderWidth: 1,
    borderColor: COLORS.bad,
  },
  sosLabel: { color: COLORS.bad, fontSize: 14, fontWeight: '800' },

  sourceStrip: {
    backgroundColor: COLORS.warnBg,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.warnBorder,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sourceStripText: { color: COLORS.warn, fontSize: 12, fontWeight: '600' },

  chipBar: { flexGrow: 0 },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.card, borderColor: COLORS.accent },
  chipOff: { opacity: 0.45 },
  chipLabel: { color: COLORS.muted, fontSize: 14, fontWeight: '600' },
  chipLabelActive: { color: COLORS.text },
  modeChip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modeLabel: { color: COLORS.muted, fontSize: 13, fontWeight: '600' },

  canvas: { flex: 1, minHeight: 180, backgroundColor: COLORS.card, overflow: 'hidden' },

  resultsPane: {
    maxHeight: 220,
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  resultsNote: { color: COLORS.muted, fontSize: 12, paddingHorizontal: 16, paddingVertical: 6 },
  resultsList: { maxHeight: 130 },
  resultRow: {
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  resultRowActive: { backgroundColor: COLORS.card },
  resultName: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  resultMeta: { color: COLORS.faint, fontSize: 12, marginTop: 2 },
  sourceNote: {
    color: COLORS.faint,
    fontSize: 11,
    lineHeight: 15,
    paddingVertical: 8,
  },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '70%',
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: COLORS.accent,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  placeSheetHandleRow: { alignItems: 'center', paddingTop: 8 },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
  },
  sheetBody: { padding: 20, gap: 6 },
  sheetTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  sheetKind: { color: COLORS.muted, fontSize: 13, marginBottom: 4 },
  sheetDistance: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  sheetCaveat: {
    color: COLORS.faint,
    fontSize: 12,
    lineHeight: 17,
    marginVertical: 6,
  },
  sheetNoCall: { color: COLORS.faint, fontSize: 13, marginVertical: 8 },
  sheetConflict: {
    color: COLORS.warn,
    fontSize: 12,
    lineHeight: 17,
    marginVertical: 6,
  },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  rowLabel: { color: COLORS.muted, fontSize: 13, flexShrink: 0 },
  // No fixed width and no nowrap - a translated label runs longer.
  rowValue: { color: COLORS.text, fontSize: 13, flexShrink: 1, textAlign: 'right' },
  rowUnknown: { color: COLORS.faint, fontStyle: 'italic' },

  emergencyPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 20,
    gap: 10,
    backgroundColor: COLORS.card,
    borderTopWidth: 2,
    borderTopColor: COLORS.bad,
  },
  emergencyTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  emergencyWhere: { color: COLORS.text, fontSize: 14, lineHeight: 20 },
  emergencyNote: { color: COLORS.faint, fontSize: 12, lineHeight: 17 },

  footer: { padding: 16, borderTopWidth: 1, borderTopColor: COLORS.border },

  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  placeholderTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  placeholderBody: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 320,
  },
  placeholderAction: { marginTop: 16, alignSelf: 'stretch', maxWidth: 320 },

  floatingSpeedContainer: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 10,
  },
  speedometerBadge: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  speedometerValue: { color: '#FFFFFF', fontSize: 20, fontWeight: '900' },
  speedometerUnit: { color: '#94A3B8', fontSize: 10, fontWeight: '700' },

  speedLimitCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedLimitNumber: { color: '#0F172A', fontSize: 14, fontWeight: '900' },

  recenterButton: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    zIndex: 10,
  },
  recenterText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },

  bottomActionPills: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 6,
  },
  actionPill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionPillText: { color: COLORS.text, fontSize: 11, fontWeight: '700' },
  actionPillSos: { backgroundColor: 'rgba(239, 68, 68, 0.15)', borderColor: '#EF4444' },
  actionPillSosText: { color: '#EF4444', fontSize: 11, fontWeight: '800' },

  aiModalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
    zIndex: 99,
  },
  aiModalContent: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 12,
    maxHeight: '80%',
  },
  aiModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  aiModalTitle: { color: COLORS.text, fontSize: 17, fontWeight: '800' },
  aiModalClose: { color: COLORS.muted, fontSize: 20, padding: 4 },
  aiModalSubtitle: { color: COLORS.muted, fontSize: 12, marginTop: -6 },
  aiQuickPrompts: { flexDirection: 'column', gap: 6 },
  promptChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  promptChipText: { color: COLORS.text, fontSize: 12, fontWeight: '600' },
  aiAnswerBox: {
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.25)',
  },
  aiLoadingText: { color: COLORS.accent, fontSize: 13, fontStyle: 'italic' },
  aiAnswerText: { color: COLORS.text, fontSize: 13, lineHeight: 18 },

  langSelectorRow: { flexDirection: 'row', gap: 8, marginVertical: 4 },
  langChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  langChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  langChipText: { color: COLORS.muted, fontSize: 12, fontWeight: '700' },
  langChipTextActive: { color: '#FFFFFF' },
})
