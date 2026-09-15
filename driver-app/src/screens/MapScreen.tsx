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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Linking,
  Pressable,
  BackHandler,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'

import { SafeAreaView } from 'react-native-safe-area-context'
import { api, type Place, type PlaceCategory, type RerouteProposed, type SearchAnchor } from '../api/client'
import { useRouteRisk } from '../hooks/useRouteRisk'
import { hazardAhead, terrainAhead } from '../map/ahead'
import { factorTitle } from '../safety/riskCards'
import { Banner, Button, Loading, errorMessage } from '../components/ui'
import { resolveLanguage } from '../i18n/language'
import { emergencyNumbers } from '../safety/guide'
import DriverRouteMap from '../map/DriverRouteMap'
import { type LatLon } from '../map/geo'
import { useRouteGeometry } from '../map/useRouteGeometry'
import { useTripKit } from '../offline/useTripKit'
import { useNavigationPackage } from '../map/useNavigationPackage'
import { guidanceHold, upcomingManeuver, maneuverIcon, formatTurnDistance, instructionFor, type GuidanceHold } from '../map/maneuvers'
import { navState, ON_ROUTE, projectOntoRoute, shouldRequestReroute, trackOffRoute, type NavState, type OffRouteTrack, type RerouteMark } from '../map/navState'
import { routeAiCard } from '../navigation/routeAi'
import { useBrowsePosition } from '../tracking/useBrowsePosition'
import { locationChip } from '../map/locationLabel'
import type { LocationSource } from '../tracking/source'
import { HILLSHADE_URL } from '../map/scene'
import { settledPosition } from '../tracking/speed'
import { dangerAlert } from '../navigation/alerts'
import { notifyInBackground } from '../notify/local'
import { useT } from '../i18n/tx'
import { useSpokenGuidance } from '../map/useSpokenGuidance'
import { useGuidanceClock } from '../map/useGuidanceClock'
import type { PositionKind } from '../map/types'
import { usePlaces } from '../places/usePlaces'
import { formatDistanceKm } from './progressFormat'
import { TOUCH_TARGET } from '../theme'
import { makeStyles, useTheme } from '../theme-context'
import { AudioIcon, FitRouteIcon, Icon, RecenterIcon } from '../components/icons'
import { useTrip } from '../trip/TripProvider'
import { useAuth } from '../auth/AuthProvider'

/** The fleet-traffic fact on the card: state, share of road, and its age. */
function trafficLine(t: { status: string; coverage: number; newest_age_seconds: number | null; vehicle_count: number }): string {
  // Short, so the collapsed card stays two lines and the map keeps the screen;
  // the evidence table's traffic row carries the full reason.
  if (t.status === 'UNKNOWN') return 'unknown · no fleet data'
  const age = t.newest_age_seconds == null ? '' : ` · updated ${Math.max(1, Math.round(t.newest_age_seconds / 60))} min ago`
  return `${t.status.toLowerCase()} · ${Math.round(t.coverage * 100)}% of road · ${t.vehicle_count} truck${t.vehicle_count === 1 ? '' : 's'}${age}`
}

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

/** The nav-state chip, as words a driver reads rather than the machine name. */
const NAV_WORDS: Record<string, string> = {
  IDLE: 'Idle', OVERVIEW: 'Overview', FOLLOWING: 'Following', OFF_ROUTE: 'Off route', REROUTING: 'Rerouting', GPS_STALE: 'GPS stale', OFFLINE: 'Offline',
}

type Mode = 'NEAR_ME' | 'ALONG_ROUTE' | 'THIS_AREA'

const MODE_LABELS: { id: Mode; label: string }[] = [
  { id: 'NEAR_ME', label: 'Near me' },
  { id: 'ALONG_ROUTE', label: 'Along my route' },
  { id: 'THIS_AREA', label: 'Search this area' },
]

/** A fact nobody recorded. Never blank, never guessed. */
const UNKNOWN = 'Not provided'
/** Widest single map-area search the server accepts (MAX_BBOX_DEGREES). */
const MAX_AREA_DEGREES = 5

function MapPlaceholder({
  title,
  detail,
  onRetry,
  action,
}: {
  title: string
  detail: string
  onRetry?: () => void
  action?: { label: string; onPress: () => void }
}) {
  const styles = useStyles()
  const t = useT()
  return (
    <View style={styles.placeholder}>
      <Text style={styles.placeholderTitle}>{t(title)}</Text>
      <Text style={styles.placeholderBody}>{t(detail)}</Text>
      <View style={styles.placeholderAction}>
        {action ? (
          <View style={{ marginBottom: onRetry ? 10 : 0 }}>
            <Button label={t(action.label)} variant="primary" onPress={action.onPress} />
          </View>
        ) : null}
        {onRetry ? (
          <Button label={t('Try again')} variant="secondary" onPress={onRetry} />
        ) : null}
      </View>
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
  const styles = useStyles()
  const t = useT()
  const phone = place.contact.phone
  return (
    <View style={styles.sheet} testID="place-sheet">
      <View style={styles.sheetHandleRow}>
        <View style={styles.sheetHandle} />
      </View>
      <ScrollView contentContainerStyle={styles.sheetBody}>
        <Text style={styles.sheetTitle}>{place.name ?? t('Unnamed place')}</Text>
        <Text style={styles.sheetKind}>
          {t(CATEGORY_LABELS.find((c) => c.id === place.category)?.label ??
            place.category)}
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

        <Row label={t('Phone')} value={phone ?? UNKNOWN} />
        <Row label={t('Opening hours')} value={place.contact.opening_hours ?? UNKNOWN} />
        <Row label={t('Operator')} value={place.contact.operator ?? UNKNOWN} />
        <Row label={t('Truck access (HGV)')} value={place.access.hgv ?? UNKNOWN} />
        <Row label={t('Max height')} value={place.access.max_height ?? UNKNOWN} />
        <Row label={t('Access')} value={place.access.access ?? UNKNOWN} />
        {place.category === 'REST' ? (
          <>
            <Row label={t('Fee')} value={place.access.fee ?? UNKNOWN} />
            <Row label={t('Toilets')} value={place.access.toilets ?? UNKNOWN} />
            <Row label={t('Lit')} value={place.access.lit ?? UNKNOWN} />
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
            {t('No phone number is recorded for this place.')}
          </Text>
        )}
        <Button label={t('Close')} variant="secondary" onPress={onClose} />
      </ScrollView>
    </View>
  )
}

/**
 * One floating map control.
 *
 * 52dp, which is TOUCH_TARGET - these are pressed one-handed in a moving cab,
 * and the design floor of 48 is a floor rather than a target. There is no
 * disabled look: a control that cannot act is not rendered (see the rail).
 */
function MapControl({
  onPress,
  label,
  children,
  active = false,
  primary = false,
}: {
  onPress: () => void
  label: string
  children: ReactNode
  active?: boolean
  primary?: boolean
}) {
  const styles = useStyles()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.floatingCircleBtn,
        primary && styles.recenterCircleBtn,
        active && styles.floatingCircleBtnActive,
        pressed && styles.floatingCircleBtnPressed,
      ]}
    >
      {children}
    </Pressable>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  const styles = useStyles()
  const unknown = value === UNKNOWN
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, unknown && styles.rowUnknown]}>{value}</Text>
    </View>
  )
}

export default function MapScreen({ onBack }: { onBack: () => void }) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  // On a short screen (320x640) the five-button rail climbed into the top
  // bar. Scaled from its bottom-right corner it clears the SOS button.
  const shortScreen = useWindowDimensions().height < 700
  const { trip, tracking, loadedAt, isStale, events } = useTrip()
  const t = useT()
  // NO TRIP IS NOT NO MAP. The tracker uploads position only while the server
  // says a trip is in progress; outside that the map still needs to know
  // where the phone is, so a second, upload-free watch takes over. One watch
  // at a time: browse is off exactly when the tracker is expected.
  const browse = useBrowsePosition(!trip?.tracking_expected)
  const fix = trip?.tracking_expected ? tracking.lastPosition : browse.lastPosition
  const locPermission = trip?.tracking_expected ? tracking.permission : browse.permission
  const locWatching = trip?.tracking_expected ? tracking.isTracking : browse.permission === 'granted'
  const locRequestPermission = trip?.tracking_expected ? tracking.requestPermission : browse.requestPermission
  /** No selected road: the map is a map, not a navigator. No ETA, no route
   *  decision, no maneuvers - none of those exist yet and none is invented. */
  const browsing = trip === null || trip.selected_route_id === null
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
  const places = usePlaces(JSON.stringify([trip?.id, trip?.selected_route_id]))

  const [category, setCategory] = useState<PlaceCategory | null>(null)
  const [mode, setMode] = useState<Mode>(trip?.selected_route_id ? 'ALONG_ROUTE' : 'THIS_AREA')
  const [areaTooWide, setAreaTooWide] = useState(false)
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
  const [isSheetExpanded, setIsSheetExpanded] = useState(false)
  const [showAltRoute, setShowAltRoute] = useState(false)
  // Danger cards the driver has acknowledged, by key (route + hazard +
  // segment). Never re-shown on a poll; a new segment is a new key.
  const [acknowledged, setAcknowledged] = useState<Set<string>>(() => new Set())
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

  const selectedRouteId = trip?.selected_route_id ?? null
  const geometry = useRouteGeometry(trip?.id ?? null, selectedRouteId)
  const geometryReload = geometry.reload
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
  const serverTravelledM =
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
  const serverHold = guidanceHold({
    permission: locPermission,
    isTracking: locWatching,
    platformPermission: clock.platformPermission,
    freshness: trip?.last_fix?.freshness,
    loadedAt,
    freshSeconds: trip?.tracking.fresh_seconds ?? 60,
    onRoute: trip?.progress?.on_route,
    now: clock.now,
  })

  /**
   * The phone's own fix on the phone's own copy of the line.
   *
   * The server's figure arrives every poll and is the one the manager sees;
   * between polls - and with no connection at all - the same projection runs
   * here on the cached geometry, so the countdown moves with the truck rather
   * than in ten-second steps, and keeps moving offline. Scaled to the
   * provider's distance exactly as the server scales it.
   */
  const freshMs = (trip?.tracking.fresh_seconds ?? 60) * 1000
  const fixAgeMs = fix ? clock.now - fix.at : null
  const localFresh =
    fixAgeMs !== null && fixAgeMs >= 0 && fixAgeMs <= freshMs &&
    locWatching && locPermission === 'granted' && clock.platformPermission !== 'denied'
  /**
   * The badge says GPS, because GPS is what it measures.
   *
   * It read ONLINE/OFFLINE, which is a claim about the network - and it showed
   * OFFLINE on a phone that had just loaded this route from the server. Then
   * it read STALE whenever the TRIP POLL failed, which is the same mistake in
   * the other direction: a lost connection with a live receiver showed "GPS
   * STALE" beside a green marker. It now ages the phone's own last fix
   * (`localFresh`, below); the network has its own chip.
   */
  const chip = locationChip({
    permission: locPermission,
    fix,
    kind: !fix || locPermission !== 'granted' ? null : localFresh ? 'LIVE' : 'LAST_KNOWN',
    now: clock.now,
  }, t)
  const isOnline = chip.tone !== 'off'
  const projection = useMemo(
    () => (fix ? projectOntoRoute(geometry.points, [fix.lat, fix.lon]) : null),
    [geometry.points, fix],
  )
  const travelledM =
    localFresh && projection
      ? (projection.alongM / projection.totalM) * (geometry.distanceKm ? geometry.distanceKm * 1000 : projection.totalM)
      : serverTravelledM

  // Off-route is believed after OFF_ROUTE_FIXES consecutive fixes, not one.
  const [offRoute, setOffRoute] = useState<OffRouteTrack>(ON_ROUTE)
  const countedFixAt = useRef<number | null>(null)
  useEffect(() => {
    // One count per FIX, keyed on its timestamp - not per render or reload.
    if (!projection || !fix || countedFixAt.current === fix.at) return
    countedFixAt.current = fix.at
    setOffRoute((prev) => trackOffRoute(prev, projection.crossTrackM, fix.accuracyM))
  }, [projection, fix])
  useEffect(() => { setOffRoute(ON_ROUTE) }, [selectedRouteId])

  /**
   * A deviation is a fact about the journey, not just a state of this screen.
   *
   * Recorded the moment the hysteresis is satisfied - three consecutive fixes
   * past the threshold, accuracy already subtracted - and queued rather than
   * sent, because the reason a truck is off its corridor is very often the
   * same reason it cannot say so. The manager reads it on the trip timeline
   * whenever it arrives, with the device's own timestamp for when it happened.
   *
   * Once per episode. `trackOffRoute` only flips false to true again after the
   * truck has clearly rejoined, so this fires on the edge, not per fix.
   */
  const deviationReported = useRef(false)
  useEffect(() => {
    if (!offRoute.off) {
      deviationReported.current = false
      return
    }
    if (deviationReported.current || !fix || !projection) return
    deviationReported.current = true
    events.record('ROUTE_DEVIATION', {
      location: { lat: fix.lat, lon: fix.lon },
      accuracyM: fix.accuracyM,
      payload: {
        off_route_m: Math.round(projection.crossTrackM),
        route_id: selectedRouteId ?? null,
        travelled_m: travelledM === null ? null : Math.round(travelledM),
      },
    })
  }, [offRoute.off, fix, projection, selectedRouteId, travelledM, events])

  // Permission is local and wins; with a fresh local fix the rest is decided
  // here (the server's copy of the fix may not have uploaded yet, which is
  // exactly the offline case); otherwise the server's view stands.
  const hold: GuidanceHold =
    serverHold === 'PERMISSION' ? 'PERMISSION' : localFresh ? (offRoute.off ? 'OFF_ROUTE' : null) : serverHold
  const guidanceHasPosition = hold === null && travelledM !== null

  /**
   * A road from here, asked for once per off-route episode.
   *
   * The server plans it from the reported position and stores it as the
   * backup road; the trip stays on its selected route until the manager
   * accepts, so the proposal is drawn dashed and named as a proposal.
   */
  const [reroute, setReroute] = useState<{ inFlight: boolean; proposal: RerouteProposed | null; error: string | null; last: RerouteMark | null }>({ inFlight: false, proposal: null, error: null, last: null })
  useEffect(() => {
    if (!fix || !localFresh) return
    const position: LatLon = [fix.lat, fix.lon]
    if (!shouldRequestReroute({ off: offRoute.off, pending: reroute.inFlight, online: !isStale, last: reroute.last, position, now: clock.now })) return
    setReroute((r) => ({ ...r, inFlight: true, error: null, last: { at: clock.now, position } }))
    api.requestReroute(fix.lat, fix.lon).then(
      (proposal) => { setReroute((r) => ({ ...r, inFlight: false, proposal })); setShowAltRoute(true); geometry.reload() },
      (error) => setReroute((r) => ({ ...r, inFlight: false, error: errorMessage(error).detail })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offRoute.off, localFresh, isStale, clock.now])
  // The manager took it: it is now the selected road, not a proposal.
  useEffect(() => {
    if (reroute.proposal && selectedRouteId === reroute.proposal.route_id) setReroute((r) => ({ ...r, proposal: null, error: null }))
  }, [selectedRouteId, reroute.proposal])

  const offRouteLine = reroute.inFlight
    ? 'Off the planned road · finding a road from here'
    : reroute.proposal
      ? `Off the planned road · new road ${reroute.proposal.distance_km != null ? formatDistanceKm(reroute.proposal.distance_km) : ''} awaits manager`
      : reroute.error
        ? `Off the planned road · ${isStale ? 'no connection' : 'no road from here yet'}`
        : 'Off the planned road · rejoin it'

  /**
   * The offline trip kit: what is cached, what has gone stale on THIS device,
   * and whether the phone is preparing for the next stretch without signal.
   *
   * Fed the same package the map is drawn from, so a readiness card and a
   * corridor can never disagree about which road is cached.
   */
  const kit = useTripKit({
    tripId: trip?.id ?? null,
    routeId: selectedRouteId,
    packageData: geometry.packageData,
    travelledM: guidanceHasPosition ? travelledM : null,
    speedKmph: fix?.speedKmh ?? null,
    online: !isStale,
    reload: geometryReload,
    now: clock.now,
  })

  const [following, setFollowing] = useState(false)
  const nav: NavState = navState({
    hasRoute: geometry.points.length > 1,
    tracking: locWatching && locPermission === 'granted' && clock.platformPermission !== 'denied',
    fixAgeMs,
    freshMs,
    offRoute: offRoute.off,
    rerouting: reroute.inFlight || (reroute.proposal !== null && reroute.proposal.route_id !== selectedRouteId),
    offline: isStale,
    follow: following,
  })

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
  const canRecenter = fix != null
  const canFitRoute = geometry.points.length > 1
  const hasAlternative = geometry.backupPoints.length > 1

  // The pin holds still while the receiver says the truck is stationary: an
  // indoor fix wanders a few metres per report, and each wander redrew the
  // whole scene. `settledPosition` applies the SpeedFilter's verdict to the
  // coordinate; it is not a second filter. The array is memoised on the
  // numbers so an unchanged pin is the same object and the map does not redraw.
  const settled = useRef<LatLon | null>(null)
  settled.current = settledPosition(settled.current, fix)
  const pinLat = settled.current?.[0] ?? null
  const pinLon = settled.current?.[1] ?? null
  const pin = useMemo((): LatLon | null => (pinLat === null || pinLon === null ? null : [pinLat, pinLon]), [pinLat, pinLon])

  const marker = useMemo((): {
    position: LatLon | null
    kind: PositionKind | null
    source: LocationSource | null
    accuracyM: number | null
    headingDeg: number | null
  } => {
    if (!fix || locPermission !== 'granted' || clock.platformPermission === 'denied') return { position: null, kind: null, source: null, accuracyM: null, headingDeg: null }
    const freshMs = (trip?.tracking.fresh_seconds ?? 60) * 1000
    return {
      position: pin,
      kind: locWatching && clock.now - fix.at >= 0 && clock.now - fix.at <= freshMs ? 'LIVE' : 'LAST_KNOWN',
      source: fix.source ?? null,
      accuracyM: fix.accuracyM,
      // A heading only while the truck moves (speed.ts decides): a parked
      // phone's compass pointed the marker wherever the driver held it.
      headingDeg: fix.headingDeg ?? null,
    }
  }, [fix, pin, trip?.tracking.fresh_seconds, clock.now, clock.platformPermission, locPermission, locWatching])
  // The age the map draws is only for the LAST KNOWN tooltip and is coarse on
  // purpose: a value that ticked every five seconds redrew the scene with it.
  const ageForScene = marker.kind === 'LAST_KNOWN' && fix ? Math.max(0, Math.round((clock.now - fix.at) / 30_000) * 30) : null

  /**
   * Open the platform dialler. It does NOT place the call.
   *
   * `tel:` hands the number to the dialler with the driver's thumb still
   * required - the same rule `SafetyScreen` follows, and the reason automated
   * testing can exercise this path without ever calling an emergency service.
   */
  const call = useCallback((tel: string) => {
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
    | 'TOO_WIDE'
    | {
        south?: number
        west?: number
        north?: number
        east?: number
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
      if (!geometry.points.length) return null
      // No box: the server reads this driver's route and searches it as a
      // chain of bounded windows. A 300 km road is never one request's box.
      return {
        anchor: 'ROUTE_CORRIDOR',
        ...(marker.position
          ? { anchorLat: marker.position[0], anchorLon: marker.position[1] }
          : {}),
      }
    }
    if (viewport === null) return null
    // The server bounds a single area query; a zoomed-out map is told to zoom
    // in rather than shown the provider's limit as an error.
    if (
      viewport.north - viewport.south > MAX_AREA_DEGREES ||
      viewport.east - viewport.west > MAX_AREA_DEGREES
    ) {
      return 'TOO_WIDE'
    }
    return { ...viewport, anchor: 'MAP_AREA' }
  }

  async function runSearch(which: Mode, cat: PlaceCategory) {
    const query = queryFor(which)
    setAreaTooWide(query === 'TOO_WIDE')
    if (query === null || query === 'TOO_WIDE') { places.clear(); return }
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

  /**
   * Real deterministic risk for this route, from the backend engine the
   * manager reads - and from the SAME hook the Safety screen uses, so the two
   * surfaces can never disagree about what the assessment says.
   */
  const { risk, state: riskState, capturedAt: riskCapturedAt, refresh: refreshRisk } = useRouteRisk(selectedRouteId, trip?.id ?? null)

  // RECONNECT. The trip poll is the phone's connectivity signal: when it
  // goes from failing to answering, the saved route and the LAST KNOWN
  // assessment are refreshed in the background so the screen returns to
  // LIVE without a reload. Only the transition, never on mount.
  // One dropped request is not an outage: a route fetch that failed while
  // the trip poll stays healthy is retried after 10 s, not left on "Try again"
  // until the driver notices (seen on the phone after a manager reroute).
  useEffect(() => {
    if (!geometry.error || isStale) return
    const t = setTimeout(geometry.reload, 10_000)
    return () => clearTimeout(t)
  }, [geometry.error, geometry.reload, isStale])

  const wasStale = useRef(isStale)
  useEffect(() => {
    if (wasStale.current && !isStale) {
      geometry.reload()
      refreshRisk()
      // Directions are not cached (see useNavigationPackage): a fetch that
      // failed while the link was down stays empty until asked again.
      if (!navigation.available) navigation.reload()
    }
    wasStale.current = isStale
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStale])
  /** Terrain and landslide overlays, on by default; the rail button hides
   *  them for a driver who wants the bare road for a moment. */
  const [showHazards, setShowHazards] = useState(true)
  /** Fleet traffic stroke. On by default, but it only exists where the
   *  fleet has evidence; UNKNOWN draws nothing either way. */
  const [showTraffic, setShowTraffic] = useState(true)
  const trafficKnown = (risk?.traffic?.coverage ?? 0) > 0

  function renderCanvas() {
    // NO EARLY RETURN FOR A MISSING TRIP OR ROUTE.
    //
    // This used to swap the whole canvas for a placeholder the moment
    // `selectedRouteId` was null, which unmounted the map and left a blank
    // panel. A trip without a selected route still has a location; "no planned
    // route" is not "no map". Fall through to the empty-geometry branch below,
    // which already mounts the basemap and puts a status strip over it.
    if (geometry.isLoading && geometry.points.length === 0) {
      return <Loading label={t('Loading your route…')} />
    }
    if (geometry.error !== null) {
      const err = errorMessage(geometry.error)
      const isUnconfigured =
        err.detail.toLowerCase().includes('not configured') ||
        err.detail.toLowerCase().includes('unavailable')

      const nextStop =
        trip?.stops.find((s) => s.status === 'PENDING' || s.status === 'ARRIVED') ??
        (trip?.stops && trip.stops.length > 0 ? trip.stops[trip.stops.length - 1] : null)
      const targetDestination = nextStop?.address || nextStop?.name || ''

      const openGoogleMaps = targetDestination
        ? () => {
            const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(targetDestination)}`
            void Linking.openURL(url).catch(() => {})
          }
        : undefined

      return (
        <MapPlaceholder
          title={isUnconfigured ? 'Offline navigation mode' : 'Could not load the route'}
          detail={
            isUnconfigured
              ? 'Route intelligence service is currently unconfigured or offline. You can open your destination directly in Google Maps while live position tracking continues.'
              : err.detail
          }
          onRetry={geometry.reload}
          action={openGoogleMaps ? { label: 'Open in Google Maps', onPress: openGoogleMaps } : undefined}
        />
      )
    }
    if (geometry.points.length === 0) {
      return (
        <View style={StyleSheet.absoluteFill}>
          <DriverRouteMap
            routeId={selectedRouteId}
            progressFraction={null}
            positionAgeSeconds={ageForScene}
            points={[]}
            backupPoints={[]}
            showBackup={false}
            stops={geometry.stops}
            position={marker.position}
            positionKind={marker.kind}
            positionSource={marker.source}
            accuracyM={marker.accuracyM}
            headingDeg={marker.headingDeg}
            places={places.result?.places ?? []}
            selectedPlaceId={places.selected?.provider_id ?? null}
            onSelectPlace={places.select}
            hillshade={showHazards}
            onViewportChange={setViewport}
            cameraTrigger={cameraTrigger}
            cameraMode={cameraMode}
            testID="driver-route-map"
          />
        </View>
      )
    }

    return (
      <DriverRouteMap
        routeId={selectedRouteId}
        progressFraction={guidanceHasPosition && geometry.distanceKm && travelledM !== null ? travelledM / (geometry.distanceKm * 1000) : null}
        positionAgeSeconds={ageForScene}
        points={geometry.points}
        backupPoints={geometry.backupPoints}
        showBackup={showAltRoute}
        stops={geometry.stops}
        position={marker.position}
        positionKind={marker.kind}
        positionSource={marker.source}
        accuracyM={marker.accuracyM}
        headingDeg={marker.headingDeg}
        places={places.result?.places ?? []}
        selectedPlaceId={places.selected?.provider_id ?? null}
        onSelectPlace={places.select}
        terrainSegments={showHazards ? risk?.terrain?.segments ?? [] : []}
        hazards={showHazards ? risk?.landslide_history?.events ?? [] : []}
        hillshade={showHazards}
        trafficSegments={showTraffic ? risk?.traffic?.segments ?? [] : []}
        onViewportChange={setViewport}
        onFollowChange={setFollowing}
        cameraTrigger={cameraTrigger}
        cameraMode={cameraMode}
        testID="driver-route-map"
      />
    )
  }

  /** Results, or the honest reason there are none. Four distinct outcomes. */
  function renderResults() {
    if (category === null) return null
    if (areaTooWide) {
      return (
        <View style={styles.resultsPane}>
          <Banner
            tone="warn"
            title="Zoom in to search this area"
            detail="The map view is too wide to search at once. Zoom in, then search again."
          />
        </View>
      )
    }
    if (places.isSearching) {
      return <Text style={styles.resultsNote}>{t('Searching…')}</Text>
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
            label={t('Try again')}
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
                accessibilityLabel={`${place.name ?? t('Unnamed place')}${
                  place.straight_line_m !== null
                    ? `, ${Math.round(place.straight_line_m / 100) / 10} kilometres in a straight line`
                    : ''
                }`}
                style={[styles.resultRow, isSelected && styles.resultRowActive]}
              >
                <Text style={styles.resultName} numberOfLines={1}>
                  {place.name ?? t('Unnamed place')}
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

  /**
   * The factor rows behind the card. Operational state first - GPS is a
   * FACTOR, not a gate, so a denied permission never hides the assessment.
   */
  const gpsRow: [string, string] = ['Location', chip.text]
  const trafficRow: [string, string] = ['Fleet traffic', risk?.traffic && risk.traffic.status !== 'UNKNOWN' ? 'Available' : 'Not available · no fleet on this road in the last 15 min']
  const factorRows: [string, string][] = risk
    ? [
        gpsRow,
        trafficRow,
        ...Object.entries(risk.inputs)
          .filter(([, v]) => v === 'AVAILABLE')
          .map(([k]) => [factorTitle(k) ?? k.replace(/_/g, ' '), 'Available'] as [string, string]),
        ...risk.unavailable.map((k) => [factorTitle(k) ?? k.replace(/_/g, ' '), 'Not available'] as [string, string]),
      ]
    : [gpsRow]

  /**
   * The card. Words from the engine's own reason codes, in the app language;
   * the decision is the server's. See `navigation/routeAi`.
   */
  const ai = routeAiCard(risk, guidanceHasPosition ? travelledM : null, language)
  const alert = dangerAlert(risk, selectedRouteId, geometry.points, guidanceHasPosition ? travelledM : null)
  const shownAlert = alert && !acknowledged.has(alert.key) ? alert : null
  // The same card, as a notification when the phone is in a pocket. Same
  // key as the card, so a poll cannot repeat it; same wording, so it never
  // says more than the evidence does.
  useEffect(() => {
    if (!shownAlert) return
    void notifyInBackground(`danger:${shownAlert.key}`, `${shownAlert.title} · ${shownAlert.level}`, shownAlert.detail)
  }, [shownAlert?.key])  // eslint-disable-line react-hooks/exhaustive-deps
  const holdDecision = risk?.decision === 'HOLD_AND_REVIEW' || risk?.decision === 'REROUTE_RECOMMENDED'
  const findStop = () => {
    setIsSheetExpanded(true)
    if (category !== 'REST') onPickCategory('REST')
  }
  const riskStale = riskState === 'STALE'
  const decisionTone =
    ai.decision === 'CONTINUE'
      ? 'ok'
      : ai.decision === 'CAUTION'
        ? 'warn'
        : ai.decision === null
          ? 'off'
          : 'bad'

  /**
   * The maneuver after the next. Google's "Then ↱" line: a driver in a
   * roundabout wants the exit AND the turn after it. Only from real
   * maneuvers, never from the corridor's shape.
   */
  const thenTurn = useMemo(() => {
    if (!nextTurn) return null
    const i = navigation.maneuvers.indexOf(nextTurn.maneuver)
    return i >= 0 ? navigation.maneuvers[i + 1] ?? null : null
  }, [navigation.maneuvers, nextTurn])

  /** Arrival clock time from the server's remaining-at-planned-pace, never
   *  from a speed this screen invented. */
  const eta = (() => {
    const rem = trip?.progress?.remaining_distance_km
    const mins = trip?.progress?.remaining_at_planned_pace_min
    const haveRemaining = rem != null && Number.isFinite(rem)
    const km = haveRemaining ? rem : geometry.distanceKm
    const duration =
      haveRemaining && mins != null
        ? mins >= 60
          ? `${Math.floor(mins / 60)} h ${Math.round(mins % 60)} min`
          : `${Math.round(mins)} min`
        : null
    const arrival =
      haveRemaining && mins != null
        ? new Date(Date.now() + mins * 60_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null
    return {
      duration,
      distance: km == null || !Number.isFinite(km) ? null : formatDistanceKm(km),
      distanceLabel: haveRemaining ? 'remaining' : 'route',
      arrival,
    }
  })()

  return (
    <SafeAreaView style={styles.root}>
      {/* THE MAP OWNS THE SCREEN. A real flex child, so it reserves its space;
          everything floating inside is anchored to this box and can never sit
          under the card or the ETA bar below. */}
      <View style={styles.mapArea}>
        <View style={styles.mapCanvasWrapper}>{renderCanvas()}</View>

        {/* TOP: back · next maneuver · emergency. */}
        <View style={styles.topLayer} pointerEvents="box-none">
          <View style={styles.topRow}>
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Back to trip"
              style={styles.roundBtn}
            >
              <Icon name="chevron-left" size={26} color={COLORS.text} />
            </Pressable>

            {selectedRouteId !== null ? (
              <View style={styles.maneuverCard} testID="maneuver-card">
                <View style={styles.maneuverMain}>
                  <View style={styles.maneuverIcon}><Icon name={nextTurn ? maneuverIcon(nextTurn.maneuver) : 'navigation'} size={30} color="#FFFFFF" /></View>
                  <View style={styles.maneuverText}>
                    {nextTurn ? (
                      <>
                        <Text style={styles.maneuverDistance}>{formatTurnDistance(nextTurn.distanceM)}</Text>
                        <Text style={styles.maneuverInstruction} numberOfLines={1}>
                          {instructionFor(nextTurn.maneuver, t)}
                        </Text>
                      </>
                    ) : (
                      <>
                        {/* No maneuver means SAY no maneuver: `hold` and
                            `available` carry the real reason, and an invented
                            "continue straight" is the one thing this card must
                            never show. */}
                        <Text style={styles.maneuverInstruction} numberOfLines={1}>
                          {t(!navigation.available ? 'Guidance unavailable' : hold !== null ? 'Guidance paused' : 'No further turns')}
                        </Text>
                        <Text style={styles.maneuverSub} numberOfLines={hold === 'OFF_ROUTE' ? 3 : 1}>
                          {hold === 'OFF_ROUTE'
                            ? offRouteLine
                            : t(!navigation.available
                            ? 'Route overview active'
                            : hold === 'PERMISSION'
                              ? 'Allow location to start'
                              : hold === 'NO_FIX'
                                ? 'Waiting for a GPS fix'
                                : hold === 'FIX_STALE' || hold === 'CONTACT_LOST'
                                  ? 'GPS fix is stale'
                                  : 'Route overview active')}
                        </Text>
                      </>
                    )}
                  </View>
                </View>
                {thenTurn ? (
                  <View style={styles.thenRow}>
                    <Text style={styles.thenText} numberOfLines={1}>
                      {t('Then')} <Icon name={maneuverIcon(thenTurn)} size={13} color={COLORS.muted} /> {instructionFor(thenTurn, t)}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={styles.maneuverCard}>
                <Text style={styles.maneuverInstruction}>{trip === null ? t('Browsing the map') : selectedRouteId === null ? t('Route not selected') : t('Loading the route')}</Text>
                <Text style={styles.maneuverSub} numberOfLines={2}>{trip === null ? t('No active trip · search, terrain and SOS still work') : selectedRouteId === null ? t('Your manager assigns the road first') : t('Turn-by-turn starts once the road has loaded')}</Text>
              </View>
            )}

            <Pressable
              onPress={() => setShowEmergency((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel="Emergency help"
              style={[styles.roundBtn, styles.sosBtn]}
              testID="emergency-action"
            >
              <Text style={styles.sosGlyph}>SOS</Text>
            </Pressable>
          </View>

          {geometry.source === 'CACHED' ? (
            <View style={styles.sourceStrip}>
              <Text style={styles.sourceStripText}>
                Saved route — no connection. Downloaded {relativeTime(geometry.capturedAt)}.
              </Text>
            </View>
          ) : null}

          {shownAlert && !isSheetExpanded ? (
            <View style={[styles.alertCard, shownAlert.level !== 'CAUTION' && styles.alertCardHigh]} testID="danger-alert">
              <View style={styles.alertTitleRow}>
                <Icon name="alert-triangle" size={16} color={shownAlert.level !== 'CAUTION' ? COLORS.bad : COLORS.warn} />
                <Text style={[styles.alertTitle, shownAlert.level !== 'CAUTION' && styles.alertTitleHigh]} numberOfLines={2}>
                  {shownAlert.title} · {shownAlert.level}
                </Text>
              </View>
              <Text style={styles.alertWhere} numberOfLines={2}>{shownAlert.where}</Text>
              <Text style={styles.alertDetail} numberOfLines={2}>{shownAlert.detail}</Text>
              <Text style={styles.alertEvidence} numberOfLines={1}>Evidence · {shownAlert.evidence.join(' · ')}</Text>
              <View style={styles.alertActions}>
                <Pressable onPress={() => setIsSheetExpanded(true)} accessibilityRole="button" accessibilityLabel="View route details" style={styles.alertBtn}>
                  <Text style={styles.alertBtnText}>{t('VIEW')}</Text>
                </Pressable>
                <Pressable onPress={findStop} accessibilityRole="button" accessibilityLabel="Find a place to stop" style={styles.alertBtn}>
                  <Text style={styles.alertBtnText}>{t('STOPS')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setAcknowledged((prev) => new Set(prev).add(shownAlert.key))
                    // The manager can now tell "alert sent" from "driver saw
                    // it". Queued, so an acknowledgement given in a dead zone
                    // still reaches the timeline when signal returns.
                    events.record('ALERT_ACKNOWLEDGED', {
                      location: fix ? { lat: fix.lat, lon: fix.lon } : null,
                      accuracyM: fix?.accuracyM ?? null,
                      payload: {
                        alert_key: shownAlert.key,
                        level: shownAlert.level,
                        title: shownAlert.title,
                      },
                    })
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Acknowledge this alert"
                  style={[styles.alertBtn, styles.alertBtnPrimary]}
                  testID="danger-alert-ack"
                >
                  <Text style={[styles.alertBtnText, styles.alertBtnTextPrimary]}>{t('OK, SEEN')}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        {/* RIGHT RAIL. Only controls that DO something right now - a greyed
            button is a promise the map cannot keep, so the mute, overview,
            layers and traffic buttons appear when their function exists.
            Hidden while the details sheet has the map squeezed - a rail
            climbing into the maneuver card is worse than a tap to close. */}
        {isSheetExpanded ? null : (
        <View style={[styles.rightRail, shortScreen && { transform: [{ scale: 0.82 }], transformOrigin: 'right bottom' }]} pointerEvents="box-none">
          <MapControl
            onPress={() => setIsSheetExpanded(true)}
            label="Search roadside services"
            active={isSheetExpanded && category !== null}
          >
            <Icon name="search" size={20} color={COLORS.text} />
          </MapControl>
          {voiceUsable ? (
            <MapControl onPress={() => setMuted((v) => !v)} label={muted ? 'Unmute voice guidance' : 'Mute voice guidance'}>
              <AudioIcon color={COLORS.text} size={20} muted={muted} />
            </MapControl>
          ) : null}
          {canFitRoute ? (
            <MapControl onPress={handleFitRoute} label="Route overview — fit the whole route">
              <FitRouteIcon color={COLORS.text} size={20} />
            </MapControl>
          ) : null}
          {risk?.terrain?.usable || risk?.landslide_history?.events?.length || HILLSHADE_URL !== null ? (
            <MapControl
              onPress={() => setShowHazards((v) => !v)}
              label={showHazards ? 'Hide terrain and landslide overlays' : 'Show terrain and landslide overlays'}
              active={showHazards}
            >
              <Icon name="layers" size={20} color={showHazards ? COLORS.onAccent : COLORS.text} />
            </MapControl>
          ) : null}
          {trafficKnown ? (
            <MapControl onPress={() => setShowTraffic((v) => !v)} label={showTraffic ? 'Hide fleet traffic' : 'Show fleet traffic'} active={showTraffic}>
              <Icon name="activity" size={20} color={showTraffic ? COLORS.onAccent : COLORS.text} />
            </MapControl>
          ) : null}
          {hasAlternative ? (
            <MapControl
              onPress={() => setShowAltRoute((v) => !v)}
              label={showAltRoute ? 'Hide alternative route' : 'Show alternative route'}
              active={showAltRoute}
            >
              <Icon name="git-branch" size={20} color={showAltRoute ? COLORS.onAccent : COLORS.text} />
            </MapControl>
          ) : null}
        </View>
        )}

        {/* BOTTOM-LEFT: speed and GPS state. BOTTOM-CENTRE: re-centre.
            Hidden with the sheet open: the map is a strip then, and the
            gauge climbed into the maneuver card on a 360 dp phone. Hidden
            under a danger card too: on a 412 dp phone the card's action row
            landed on the gauge, and a gauge over OK, SEEN is a dead button. */}
        {isSheetExpanded || shownAlert ? null : (
        <View style={styles.bottomLeft} pointerEvents="box-none">
          <View style={styles.speedGauge}>
            <Text style={styles.speedValue}>
              {localFresh && fix?.speedKmh != null ? fix.speedKmh : '--'}
            </Text>
            <Text style={styles.speedUnit}>km/h</Text>
          </View>
          <View style={[styles.gpsChip, !isOnline && styles.gpsChipOff, chip.tone === 'coarse' && styles.navChipWarn]}>
            <View style={[styles.gpsDot, !isOnline && styles.gpsDotOff]} />
            <Text style={[styles.gpsText, !isOnline && styles.gpsTextOff, chip.tone === 'coarse' && styles.navChipWarnText]}>{chip.text}</Text>
          </View>
          <View style={[styles.gpsChip, styles.navChip, (nav === 'OFF_ROUTE' || nav === 'REROUTING') && styles.navChipWarn, (nav === 'GPS_STALE' || nav === 'OFFLINE' || nav === 'IDLE') && styles.gpsChipOff]} testID="nav-state">
            <Text style={[styles.gpsText, (nav === 'OFF_ROUTE' || nav === 'REROUTING') && styles.navChipWarnText, (nav === 'GPS_STALE' || nav === 'OFFLINE' || nav === 'IDLE') && styles.gpsTextOff]}>{t(NAV_WORDS[nav] ?? nav)}</Text>
          </View>
        </View>
        )}
        {/* Re-centre only while the camera is NOT on the truck - the way a
            navigation app hides it while following and shows it after a pan. */}
        {following && nav === 'FOLLOWING' ? null : (
        <View style={styles.bottomCentre} pointerEvents="box-none">
          <Pressable
            onPress={canRecenter ? handleRecenter : locPermission === 'denied' ? locRequestPermission : undefined}
            disabled={!canRecenter && locPermission !== 'denied'}
            accessibilityRole="button"
            accessibilityLabel={canRecenter ? 'Re-centre the map on the truck' : 'Waiting for a GPS position'}
            accessibilityState={{ disabled: !canRecenter && locPermission !== 'denied' }}
            style={[styles.recentrePill, !canRecenter && styles.recentrePillOff]}
          >
            <RecenterIcon color={canRecenter ? COLORS.onAccent : COLORS.faint} size={18} />
            <Text style={[styles.recentreText, !canRecenter && styles.recentreTextOff]}>
              {canRecenter ? t('Re-centre') : locPermission === 'denied' ? t('Allow location') : t('No GPS fix')}
            </Text>
          </Pressable>
        </View>
        )}
      </View>

      {/* PERSONAL ROUTE AI - the decision the engine reached, in words.
          Absent without a road: there is no decision to show and none is
          made up. */}
      {browsing ? null : (
      <View style={styles.aiCard} testID="route-ai-card">
        <View style={styles.aiHead}>
          <Text style={styles.aiEyebrow}>PERSONAL ROUTE AI{riskStale ? ' · LAST KNOWN' : isStale ? ' · OFFLINE' : ''}</Text>
          <Pressable
            onPress={() => setIsSheetExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={isSheetExpanded ? 'Hide route details' : 'Show route details'}
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            style={styles.detailsBtn}
          >
            <Text style={styles.detailsBtnText}>{isSheetExpanded ? t('HIDE') : t('DETAILS')}</Text>
          </Pressable>
        </View>
        <View style={styles.aiRow}>
          <View
            style={[
              styles.decisionPill,
              decisionTone === 'ok' && styles.decisionOk,
              decisionTone === 'warn' && styles.decisionWarn,
              decisionTone === 'bad' && styles.decisionBad,
            ]}
          >
            <Text
              style={[
                styles.decisionText,
                decisionTone === 'ok' && styles.decisionTextOk,
                decisionTone === 'warn' && styles.decisionTextWarn,
                decisionTone === 'bad' && styles.decisionTextBad,
              ]}
              numberOfLines={1}
            >
              {riskState === 'LOADING' ? 'ASSESSING' : (ai.decision ?? 'NO DATA').replace(/_/g, ' ')}
            </Text>
          </View>
          <Text style={styles.aiHeadline} numberOfLines={1}>
            {riskState === 'LOADING' ? 'Assessing the route…' : ai.headline}
          </Text>
        </View>
        <Text style={styles.aiLines} numberOfLines={2}>
          {riskState === 'LOADING' ? 'Reading terrain, weather and landslide evidence.' : ai.lines.join(' · ')}
        </Text>
        <View style={styles.aiFacts}>
          {ai.nextTerrain ? (
            <Text style={styles.aiFact} numberOfLines={1}>{t('Next terrain')}: <Text style={styles.aiFactStrong}>{ai.nextTerrain}</Text></Text>
          ) : null}
          {ai.landslide ? (
            <Text style={styles.aiFact} numberOfLines={1}>{t('Landslide exposure')}: <Text style={styles.aiFactStrong}>{ai.landslide}</Text></Text>
          ) : null}
          {ai.weather ? (
            <Text style={styles.aiFact} numberOfLines={1}>{t('Weather')}: <Text style={styles.aiFactStrong}>{ai.weather}</Text></Text>
          ) : null}
          {risk?.traffic ? (
            <Text style={styles.aiFact} numberOfLines={1}>{t('Fleet traffic')}: <Text style={styles.aiFactStrong}>{trafficLine(risk.traffic)}</Text></Text>
          ) : null}
        </View>
        {holdDecision ? (
          <Pressable onPress={findStop} accessibilityRole="button" accessibilityLabel="Find a place to stop" style={styles.stopLink}>
            <Text style={styles.stopLinkText}>{t('Find a place to stop')} →</Text>
          </Pressable>
        ) : null}
        <Text style={styles.aiStamp} numberOfLines={1}>
          {ai.evidence}
          {risk
            ? riskStale
              ? ` · captured ${relativeTime(riskCapturedAt ?? risk.assessed_at)} · STALE`
              : ` · updated ${relativeTime(risk.assessed_at)}${isStale ? ' · connection lost' : ''}`
            : ''}
        </Text>
      </View>
      )}

      {/* DETAILS SHEET - the evidence behind the card, services, trip facts. */}
      {isSheetExpanded ? (
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.detailsBody}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {browsing ? null : (<>
          <Text style={styles.sectionTitle}>{t('Evidence')}</Text>
          <View style={styles.factorGrid}>
            {factorRows.slice(0, 8).map(([name, state]) => (
              <View key={name} style={styles.factorRow}>
                <Text style={styles.factorName} numberOfLines={1}>{name}</Text>
                <Text style={[styles.factorState, state !== 'Available' && styles.factorStateOff]}>{state}</Text>
              </View>
            ))}
          </View>
          {/* OFFLINE TRIP KIT - what this phone is carrying, how old each part
              of it is on THIS device's clock, and what it has no evidence for
              at all. Rendered from the package's own manifest, so it keeps
              working with the radio off. */}
          <View style={styles.kitCard} testID="offline-kit">
            <Text style={styles.kitHeading}>
              {t('Offline kit')}
              {kit.isPreparing ? ` · ${t('preparing')}` : ''}
            </Text>
            {kit.capturedAt === null ? (
              <Text style={styles.kitLine}>
                {t('Nothing saved for this road yet.')}
                {!isStale ? ` ${t('Preparing it now.')}` : ` ${t('It will save when there is signal.')}`}
              </Text>
            ) : (
              <>
                <Text style={styles.kitLine}>
                  {t('Saved')} {relativeTime(kit.capturedAt)}
                  {kit.version ? ` · ${kit.version}` : ''}
                </Text>
                <Text style={styles.kitLine}>
                  {kit.readiness.complete
                    ? t('Every safety dataset is present and current.')
                    : [
                        kit.readiness.stale.length
                          ? `${t('Stale')}: ${kit.readiness.stale.join(', ')}`
                          : null,
                        kit.readiness.unavailable.length
                          ? `${t('No data')}: ${kit.readiness.unavailable.join(', ')}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                </Text>
              </>
            )}
            <Text style={styles.kitLine}>
              {kit.nextGap === null
                ? t('No weak or unmeasured stretch ahead on this road.')
                : `${
                    kit.nextGap.state === 'UNKNOWN'
                      ? t('Signal unmeasured')
                      : kit.nextGap.state === 'DEAD_ZONE'
                        ? t('No signal')
                        : t('Weak signal')
                  } ${t('for')} ${formatDistanceKm((kit.nextGap.endM - kit.nextGap.startM) / 1000)}${
                    kit.distanceToGapM === null
                      ? ''
                      : `, ${t('in')} ${formatDistanceKm(kit.distanceToGapM / 1000)}`
                  }`}
            </Text>
          </View>
          {risk?.terrain?.usable ? (
            <Text style={styles.detailLine}>
              {terrainAhead(risk.terrain.segments, risk.terrain.class_km, guidanceHasPosition ? travelledM : null)}
            </Text>
          ) : null}
          {risk?.landslide_history?.events?.length ? (
            <Text style={styles.detailLine}>
              {hazardAhead(geometry.points, risk.landslide_history.events, guidanceHasPosition ? travelledM : null)}
            </Text>
          ) : null}
          {risk?.landslide_history ? (
            <Text style={styles.detailLine}>
              Historical landslide sites only{risk.landslide_history.inventory_from_year && risk.landslide_history.inventory_to_year ? ` (${risk.landslide_history.inventory_from_year}–${risk.landslide_history.inventory_to_year})` : ''} — not a current incident feed.
            </Text>
          ) : null}
          {risk?.flood && risk.flood.level !== 'UNKNOWN' && risk.flood.ratio_max != null ? (
            <Text style={styles.detailLine}>
              River levels: {risk.flood.level} · highest {risk.flood.ratio_max.toFixed(1)}× the 30-day mean at {risk.flood.cells} river cell{risk.flood.cells === 1 ? '' : 's'} (GloFAS, {risk.flood.observed_on ?? 'today'}) — a level, not a flood forecast.
            </Text>
          ) : null}
          {risk?.official_warnings && risk.official_warnings.level !== 'UNKNOWN' ? (
            <Text style={styles.detailLine}>
              {risk.official_warnings.level === 'ACTIVE'
                ? risk.official_warnings.on_route.map((w) => `Official alert · ${w.event} (${w.severity}) — ${w.headline} [${w.sender}]`).join(' · ')
                : `Official alerts (NDMA SACHET): none name a district on this road · ${risk.official_warnings.in_states} active elsewhere in ${risk.official_warnings.districts.length ? 'the corridor states' : 'the region'}.`}
            </Text>
          ) : null}
          {risk?.alternative ? (
            <Text style={styles.detailLine}>
              A safer road exists: {risk.alternative.band} risk, {risk.alternative.distance_km != null ? `${formatDistanceKm(risk.alternative.distance_km)}` : 'distance unknown'}. Your manager confirms any route change.
            </Text>
          ) : selectedRouteId !== null && !hasAlternative ? (
            <Text style={styles.detailLine}>{t('No alternate route available for this corridor.')}</Text>
          ) : null}
          {risk ? (
            <Text style={styles.detailStamp}>
              Assessed {relativeTime(risk.assessed_at)} · {risk.observations_used} weather observations
              {risk.observations_stale > 0 ? ` (${risk.observations_stale} stale)` : ''} · deterministic engine, no probabilities
            </Text>
          ) : null}
          </>)}

          <Text style={styles.sectionTitle}>{t('Roadside services')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipBar} contentContainerStyle={styles.chips}>
            {CATEGORY_LABELS.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => onPickCategory(c.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: category === c.id }}
                style={[styles.chip, category === c.id && styles.chipActive]}
              >
                <Text style={[styles.chipLabel, category === c.id && styles.chipLabelActive]}>{t(c.label)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {category !== null ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipBar} contentContainerStyle={styles.chips}>
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
                    accessibilityState={{ selected: mode === m.id, disabled: unavailable }}
                    style={[styles.modeChip, mode === m.id && styles.chipActive, unavailable && styles.chipOff]}
                  >
                    <Text style={styles.modeLabel}>
                      {t(m.label)}
                      {m.id === 'NEAR_ME' && marker.position === null ? ' (no GPS)' : ''}
                    </Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          ) : null}
          {renderResults()}

          {trip === null ? null : (<>
          <Text style={styles.sectionTitle}>{t('Trip')}</Text>
          <Text style={styles.tripLine} numberOfLines={2}>
            {geometry.stops[0]?.name ?? geometry.stops[0]?.address ?? 'Origin'} → {geometry.stops.at(-1)?.name ?? geometry.stops.at(-1)?.address ?? 'Destination'}
          </Text>
          <Text style={styles.detailStamp}>
            {trip?.trip_code ?? 'TRP'} · {trip?.truck?.registration_number ?? 'Truck unassigned'} ·{' '}
            {trip?.shipment?.total_weight_kg ? `${(Number(trip.shipment.total_weight_kg) / 1000).toFixed(1)} t payload` : 'payload unspecified'}
          </Text>
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
          </>)}
        </ScrollView>
      ) : null}

      {/* ETA BAR. Duration and arrival only from the server's planned pace.
          Without a road there is no ETA, so the bar is a services handle. */}
      {browsing ? (
        <Pressable
          onPress={() => setIsSheetExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={isSheetExpanded ? 'Hide roadside services' : 'Show roadside services'}
          style={styles.etaBar}
          testID="browse-bar"
        >
          <View style={styles.etaCell}>
            <Text style={styles.etaValue} numberOfLines={1}>{isSheetExpanded ? t('HIDE') : t('SERVICES')}</Text>
            <Text style={styles.etaLabel}>{trip === null ? t('no trip') : t('no route')}</Text>
          </View>
          <View style={styles.etaCell}>
            <Text style={styles.etaValue} numberOfLines={1}>{chip.text}</Text>
            <Text style={styles.etaLabel}>{t('location')}</Text>
          </View>
        </Pressable>
      ) : (
      <Pressable
        onPress={() => setIsSheetExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={isSheetExpanded ? 'Hide route details' : 'Show route details'}
        style={styles.etaBar}
        testID="eta-bar"
      >
        <View style={styles.etaCell}>
          <Text style={styles.etaValue} numberOfLines={1}>{eta.duration ?? '—'}</Text>
          <Text style={styles.etaLabel}>{risk?.traffic && risk.traffic.delay_min > 0 ? `${t('duration')} · +${Math.round(risk.traffic.delay_min)} ${t('min traffic')}` : t('duration')}</Text>
        </View>
        <View style={styles.etaCell}>
          <Text style={styles.etaValue} numberOfLines={1}>{eta.distance ?? '—'}</Text>
          <Text style={styles.etaLabel}>{eta.distanceLabel}</Text>
        </View>
        <View style={styles.etaCell}>
          <Text style={styles.etaValue} numberOfLines={1}>{eta.arrival ?? '—'}</Text>
          <Text style={styles.etaLabel}>{t(eta.arrival ? (isStale ? 'arrival · last known' : 'arrival') : selectedRouteId === null ? 'no route' : guidanceHasPosition ? 'on route' : 'no fix')}</Text>
        </View>
      </Pressable>
      )}

      {places.selected ? (
        <PlaceSheet place={places.selected} onClose={() => places.select(null)} onCall={call} />
      ) : null}

      {/* THE EMERGENCY SHEET. Bundled numbers; it never dials by itself. */}
      {showEmergency ? (
        <View style={styles.emergencyPanel} accessibilityRole="alert">
          <Text style={styles.emergencyTitle}>{t('Emergency')}</Text>
          <Text style={styles.emergencyNote}>{t('Tapping a number opens your dialler. You still press call.')}</Text>
          {emergencyNumbers(resolveLanguage()).map((entry) => (
            <Pressable
              key={entry.number}
              onPress={() => {
                void Linking.openURL(`tel:${entry.number}`).catch(() => {})
              }}
              accessibilityRole="button"
              accessibilityLabel={`Call ${entry.number}, ${entry.label}`}
              style={styles.emergencyDial}
            >
              <Text style={styles.emergencyDialDigits}>{entry.number}</Text>
              <Text style={styles.emergencyDialLabel}>{entry.label}</Text>
            </Pressable>
          ))}
          <Button label={t('Cancel')} variant="secondary" onPress={() => setShowEmergency(false)} />
        </View>
      ) : null}
    </SafeAreaView>
  )
}

const useStyles = makeStyles((COLORS) => ({
  root: { flex: 1, backgroundColor: COLORS.bg },
  mapArea: { flex: 1, minHeight: 0, position: 'relative' },
  mapCanvasWrapper: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 },

  /* --- Top: back · maneuver · SOS ------------------------------------- */
  topLayer: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 10, paddingTop: 8 },
  roundBtn: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    backgroundColor: COLORS.card,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  sosBtn: { backgroundColor: COLORS.badStrong, borderColor: COLORS.badStrong },
  sosGlyph: { color: '#FFFFFF', fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  maneuverCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: COLORS.route,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  maneuverMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  maneuverIcon: { width: 40, alignItems: 'center', justifyContent: 'center' },
  maneuverText: { flex: 1, minWidth: 0 },
  maneuverDistance: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', lineHeight: 30 },
  maneuverInstruction: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  maneuverSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600', marginTop: 2 },
  thenRow: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.25)', paddingTop: 6 },
  thenText: { color: 'rgba(255,255,255,0.92)', fontSize: 13, fontWeight: '700' },

  /* --- Rail, gauge, chips over the map -------------------------------- */
  rightRail: { position: 'absolute', right: 10, bottom: 12, gap: 10, zIndex: 10 },
  bottomLeft: { position: 'absolute', left: 10, bottom: 12, gap: 8, zIndex: 10, alignItems: 'flex-start' },
  speedGauge: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.card,
    borderWidth: 2,
    borderColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
  },
  speedValue: { color: COLORS.text, fontSize: 18, fontWeight: '900', lineHeight: 20 },
  speedUnit: { color: COLORS.muted, fontSize: 9, fontWeight: '700' },
  gpsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.okBg,
    borderWidth: 1,
    borderColor: COLORS.ok,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  gpsChipOff: { backgroundColor: COLORS.raised, borderColor: COLORS.dim },
  navChip: { marginTop: 4 },
  navChipWarn: { backgroundColor: COLORS.warnBg, borderColor: COLORS.warn },
  navChipWarnText: { color: COLORS.warn },
  gpsDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.ok },
  gpsDotOff: { backgroundColor: COLORS.faint },
  gpsText: { color: COLORS.ok, fontSize: 10, fontWeight: '800' },
  gpsTextOff: { color: COLORS.muted },
  bottomCentre: { position: 'absolute', left: 0, right: 0, bottom: 14, alignItems: 'center', zIndex: 9 },
  recentrePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: COLORS.accent,
    elevation: 5,
  },
  recentrePillOff: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  recentreText: { color: COLORS.onAccent, fontSize: 14, fontWeight: '800' },
  recentreTextOff: { color: COLORS.muted },

  /* --- Personal Route AI ---------------------------------------------- */
  aiCard: {
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 4,
  },
  aiHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aiEyebrow: { color: COLORS.aqua, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  detailsBtn: { minHeight: 36, minWidth: 72, justifyContent: 'center', alignItems: 'flex-end' },
  detailsBtnText: { color: COLORS.routeOn, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  aiRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  decisionPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: COLORS.raised, borderWidth: 1, borderColor: COLORS.border },
  decisionOk: { backgroundColor: COLORS.okBg, borderColor: COLORS.okBorder },
  decisionWarn: { backgroundColor: COLORS.warnBg, borderColor: COLORS.warnBorder },
  decisionBad: { backgroundColor: COLORS.badBg, borderColor: COLORS.badBorder },
  decisionText: { color: COLORS.muted, fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  decisionTextOk: { color: COLORS.ok },
  decisionTextWarn: { color: COLORS.warn },
  decisionTextBad: { color: COLORS.bad },
  aiHeadline: { flex: 1, minWidth: 0, color: COLORS.text, fontSize: 17, fontWeight: '800' },
  aiLines: { color: COLORS.text, fontSize: 13, lineHeight: 18 },
  aiFacts: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  aiFact: { color: COLORS.muted, fontSize: 12 },
  aiFactStrong: { color: COLORS.text, fontWeight: '800' },
  aiStamp: { color: COLORS.faint, fontSize: 11 },

  /* --- Details sheet -------------------------------------------------- */
  sheetScroll: { maxHeight: 300, backgroundColor: COLORS.bg, borderTopWidth: 1, borderTopColor: COLORS.border },
  detailsBody: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  sectionTitle: { color: COLORS.aqua, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 6 },
  detailLine: { color: COLORS.text, fontSize: 13, lineHeight: 18 },
  kitCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  kitHeading: { color: COLORS.faint, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  kitLine: { color: COLORS.text, fontSize: 13, lineHeight: 18 },
  detailStamp: { color: COLORS.faint, fontSize: 11, lineHeight: 15 },
  tripLine: { color: COLORS.text, fontSize: 14, fontWeight: '700' },

  /* --- ETA bar -------------------------------------------------------- */
  etaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: 8,
  },
  etaCell: { flex: 1, alignItems: 'center', minWidth: 0 },
  etaValue: { color: COLORS.text, fontSize: 17, fontWeight: '900' },
  etaLabel: { color: COLORS.muted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },

  /* --- Kept from the previous layout (helpers, results, sheets) ------- */
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
  sheetHandleRow: { alignItems: 'center', paddingVertical: 4 },
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
  floatingCircleBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.card,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  recenterCircleBtn: { borderColor: COLORS.routeOn, backgroundColor: COLORS.sunken },
  floatingCircleBtnActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  floatingCircleBtnPressed: {
    backgroundColor: COLORS.soft,
    transform: [{ scale: 0.94 }],
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  rowLabel: { color: COLORS.muted, fontSize: 13, flexShrink: 0 },
  rowValue: { color: COLORS.text, fontSize: 13, flexShrink: 1, textAlign: 'right' },
  rowUnknown: { color: COLORS.faint, fontStyle: 'italic' },
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
  sourceStrip: {
    backgroundColor: COLORS.warnBg,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.warnBorder,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sourceStripText: { color: COLORS.warn, fontSize: 12, fontWeight: '600' },
  alertCard: {
    marginLeft: 10,
    // Clear the right rail: on a 360 dp phone its five buttons climb to the
    // card's height, and a rail over the ACKNOWLEDGE button is a dead button.
    marginRight: 76,
    marginTop: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: COLORS.warnBg,
    borderWidth: 1,
    borderColor: COLORS.warnBorder,
    gap: 3,
  },
  alertCardHigh: { backgroundColor: COLORS.badBg, borderColor: COLORS.badBorder },
  alertTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  alertTitle: { color: COLORS.warn, fontSize: 13, fontWeight: '900', letterSpacing: 0.6, flex: 1 },
  alertTitleHigh: { color: COLORS.bad },
  alertWhere: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  alertDetail: { color: COLORS.muted, fontSize: 12 },
  alertEvidence: { color: COLORS.faint, fontSize: 11 },
  alertActions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  alertBtn: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card, justifyContent: 'center' },
  alertBtnPrimary: { backgroundColor: COLORS.accent, borderColor: COLORS.accent, flex: 1, alignItems: 'center' },
  alertBtnText: { color: COLORS.text, fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  alertBtnTextPrimary: { color: COLORS.onAccent },
  stopLink: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center', marginTop: 2 },
  stopLinkText: { color: COLORS.accent, fontSize: 13, fontWeight: '800' },
  factorGrid: { marginTop: 8, gap: 3 },
  factorRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  factorName: { color: COLORS.muted, fontSize: 11, flex: 1, minWidth: 0 },
  factorState: { color: COLORS.ok, fontSize: 11, fontWeight: '700' },
  factorStateOff: { color: COLORS.warn },
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
  progressBarBg: {
    height: 4,
    backgroundColor: COLORS.raised,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressBarFill: { height: '100%', backgroundColor: COLORS.route },
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
    // Above the route sheet. Without these the panel rendered UNDERNEATH it and
    // only its heading was visible - the numbers, the note and Cancel were all
    // covered. `elevation` is the Android half of the same statement.
    zIndex: 30,
    elevation: 30,
  },
  emergencyTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  emergencyNote: { color: COLORS.faint, fontSize: 12, lineHeight: 17 },
  emergencyDial: {
    minHeight: TOUCH_TARGET,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.badBorder,
    backgroundColor: COLORS.badBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  emergencyDialDigits: { color: COLORS.bad, fontSize: 22, fontWeight: '800' },
  emergencyDialLabel: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
}))
