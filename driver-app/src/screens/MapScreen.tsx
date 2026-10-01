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
 *
 * LAYOUT (Phase B2, driver_02): a short photo hero (GPS and theme chips), the
 * roadside-services search as the search field, the map in a framed card
 * (back, SOS, layers, re-centre, route overview; the route summary over its
 * foot), one CTA that is the real next step, then the quick actions (Fuel,
 * lay-bys, tyres, Request help), Route information tiles, the Personal Route
 * AI card, the details panel and a photo strip. The reference is the idle
 * state: while a trip runs the maneuver card moves into the map card and the
 * ETA row replaces the quick actions. Accept and Start stay on the Trip tab
 * with their gates; the CTA routes there rather than copying them. Before the
 * trip starts the camera frames the whole route clear of the summary (the
 * reference's overview); it follows the truck only while guiding, or with no
 * route to frame.
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

import { api, type BreakReason, type Place, type PlaceCategory, type RerouteProposed, type SearchAnchor } from '../api/client'
import { useRouteRisk } from '../hooks/useRouteRisk'
import { hazardAhead, terrainAhead } from '../map/ahead'
import { factorTitle } from '../safety/riskCards'
import { Banner, Button, Loading, errorMessage } from '../components/ui'
import { resolveLanguage } from '../i18n/language'
import { useAppLanguage } from '../i18n/AppLanguageProvider'
import { translateReasonCode } from '../i18n/reasonCodes'
import { emergencyNumbers } from '../safety/guide'
import DriverRouteMap from '../map/DriverRouteMap'
import { type LatLon } from '../map/geo'
import { useRouteGeometry } from '../map/useRouteGeometry'
import { useNavigationPackage } from '../map/useNavigationPackage'
import { guidanceHold, upcomingManeuver, maneuverIcon, formatTurnDistance, instructionFor, toldManeuvers, type GuidanceHold } from '../map/maneuvers'
import { navState, ON_ROUTE, projectOntoRoute, shouldRequestReroute, trackOffRoute, type NavState, type OffRouteTrack, type RerouteMark } from '../map/navState'
import { routeAiCard } from '../navigation/routeAi'
import { useBrowsePosition } from '../tracking/useBrowsePosition'
import { judgeFix } from '../map/locationLabel'
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
import { FitRouteIcon, Icon, RecenterIcon, type IconName } from '../components/icons'
import { PHOTOS } from '../components/photoCredits'
import { CoverPhoto, ScreenHero, StatusChip, gradient, useTopInset } from '../components/scenic'
import { useTrip } from '../trip/TripProvider'
import { makeRequestId } from '../api/requestId'
import { rerouteJustApproved } from '../trip/tripNotices'

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
  // Fuel first: it is the one a truck runs out of.
  { id: 'FUEL', label: 'Fuel' },
  { id: 'EMERGENCY', label: 'Emergency' },
  { id: 'TYRES', label: 'Puncture & tyres' },
  { id: 'HOTEL', label: 'Hotels' },
  { id: 'REST', label: 'Lay-bys & rest' },
]

/** Trips whose guidance the driver has followed in this session. Outside the
 *  screen, which remounts on every tab switch: it said "Start guidance" again
 *  after a visit to Safety (B2D-17). Memory only - nothing is stored. */
const FOLLOWED_TRIPS = new Set<string>()

/** The nav-state chip, as words a driver reads rather than the machine name. */
const NAV_WORDS: Record<string, string> = {
  IDLE: 'Idle', OVERVIEW: 'Overview', FOLLOWING: 'Following', OFF_ROUTE: 'Off route', REROUTING: 'Rerouting', GPS_STALE: 'GPS stale', OFFLINE: 'Offline',
}

type Mode = 'NEAR_ME' | 'ALONG_ROUTE' | 'THIS_AREA'

/** "Shillong, Mylliem, East Khasi Hills, ..." -> "Shillong": the place a driver says. */
const placeName = (address: string) => address.split(',')[0].trim() || address

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
  disabled = false,
}: {
  onPress?: () => void
  label: string
  children: ReactNode
  active?: boolean
  /** Waiting on a precondition it names in its label (no GPS fix yet). */
  disabled?: boolean
}) {
  const styles = useStyles()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      aria-pressed={active}
      aria-disabled={disabled}
      style={({ pressed }) => [
        styles.floatingCircleBtn,
        active && styles.floatingCircleBtnActive,
        disabled && styles.floatingCircleBtnOff,
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

export default function MapScreen({
  onBack,
  onCheckTruck,
  onFullscreenChange,
}: {
  /** The Trip tab: accept, start and every gate on them live there. */
  onBack: () => void
  /** The Trip tab's truck check, when the start gate names it. */
  onCheckTruck?: () => void
  /** The shell hides its tab bar while the map is full screen. */
  onFullscreenChange?: (on: boolean) => void
}) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const { trip, tracking, loadedAt, isStale, gpsHeld, rerouteApproved, act, isBusy, actionError } = useTrip()
  const t = useT()
  const { t: tk } = useAppLanguage()
  // NO TRIP IS NOT NO MAP. The tracker uploads position only while the server
  // says a trip is in progress; outside that the map still needs to know
  // where the phone is, so a second, upload-free watch takes over. One watch
  // at a time: browse is off exactly when the tracker owns the GPS - expected
  // by the server and not held off by a day-old offline seed (`gpsHeld`).
  const trackerOwnsGps = Boolean(trip?.tracking_expected) && !gpsHeld
  const browse = useBrowsePosition(!trackerOwnsGps)
  const fix = trackerOwnsGps ? tracking.lastPosition : browse.lastPosition
  const locPermission = trackerOwnsGps ? tracking.permission : browse.permission
  const locWatching = trackerOwnsGps ? tracking.isTracking : browse.permission === 'granted'
  const locRequestPermission = trackerOwnsGps ? tracking.requestPermission : browse.requestPermission
  /** No selected road: the map is a map, not a navigator. No ETA, no route
   *  decision, no maneuvers - none of those exist yet and none is invented. */
  const browsing = trip === null || trip.selected_route_id === null
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
  /** The layers panel on the map card (overlays, voice, traffic, alternative). */
  const [showLayers, setShowLayers] = useState(false)
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
  // FULL SCREEN is a layout switch, never a second map: the same canvas,
  // GPS watch and polls stay mounted; only the cards around the map step
  // aside and the card grows to the screen. The page's scroll position is
  // kept so Exit lands where Expand was pressed.
  const [fullscreen, setFullscreen] = useState(false)
  // TWO LAYERS OF CONTROLS. Hiding takes away the secondary tools (layers,
  // re-centre, overview, break) for a clean map; the essentials - next turn,
  // speed, the time/arrival/remaining line, SOS and full screen - never hide.
  const [controlsHidden, setControlsHidden] = useState(false)
  // THE BREAK SHEET. One request id per opening, reused on a retry, so a lost
  // response cannot start two breaks (the server is idempotent on it).
  const [showBreak, setShowBreak] = useState(false)
  const [breakMinutes, setBreakMinutes] = useState<15 | 30>(15)
  const [breakReason, setBreakReason] = useState<BreakReason | null>(null)
  const breakRequestId = useRef('')
  const activeBreak = trip?.active_break ?? null
  useEffect(() => {
    if (activeBreak) setShowBreak(false)
  }, [activeBreak])
  const [rootH, setRootH] = useState(0)
  const scrollY = useRef(0)
  const savedY = useRef(0)
  const inset = useTopInset()
  useEffect(() => {
    onFullscreenChange?.(fullscreen)
  }, [fullscreen, onFullscreenChange])
  useEffect(() => () => onFullscreenChange?.(false), [onFullscreenChange])

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
      else if (showBreak) setShowBreak(false)
      else if (showLayers) setShowLayers(false)
      else if (places.selected) places.select(null)
      else if (fullscreen) setFullscreen(false)
      else if (category) { setCategory(null); places.clear() }
      else onBack()
      return true
    })
    return () => handler.remove()
  }, [showEmergency, showBreak, showLayers, places.selected, fullscreen, category, onBack, places.clear, places.select])

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
  /**
   * The badge says GPS, because GPS is what it measures.
   *
   * It read ONLINE/OFFLINE, which is a claim about the network - and it showed
   * OFFLINE on a phone that had just loaded this route from the server. Then
   * it read STALE whenever the TRIP POLL failed, which is the same mistake in
   * the other direction: a lost connection with a live receiver showed "GPS
   * STALE" beside a green marker. It now ages the phone's own last fix
   * (`localFresh`, from `judgeFix`); the network has its own chip.
   */
  const { ageMs: fixAgeMs, live: localFresh, chip } = judgeFix({
    permission: locPermission,
    watching: locWatching,
    platformPermission: clock.platformPermission,
    fix,
    now: clock.now,
    freshMs,
  }, t)
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

  // Permission is local and wins; with a fresh local fix the rest is decided
  // here (the server's copy of the fix may not have uploaded yet, which is
  // exactly the offline case). A local fix that has aged out holds the card
  // too: the chip said "GPS stale" while the card, on the server's freshness,
  // still read "270 m Turn right" (B2D-10). Only with no local fix at all does
  // the server's view stand.
  const hold: GuidanceHold =
    serverHold === 'PERMISSION' ? 'PERMISSION' : localFresh ? (offRoute.off ? 'OFF_ROUTE' : null) : fix ? 'FIX_STALE' : serverHold
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

  // What the card, the Then line and the voice are told: a roundabout once,
  // not again as its own exit step (FV-DRV-02).
  const maneuvers = useMemo(() => toldManeuvers(navigation.maneuvers), [navigation.maneuvers])
  const nextTurn = useMemo(
    () => upcomingManeuver(maneuvers, guidanceHasPosition ? travelledM : null),
    [maneuvers, travelledM, guidanceHasPosition],
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
    return {
      position: pin,
      // The chip's judgement, so marker and chip cannot disagree.
      kind: localFresh ? 'LIVE' : 'LAST_KNOWN',
      source: fix.source ?? null,
      accuracyM: fix.accuracyM,
      // A heading only while the truck moves (speed.ts decides): a parked
      // phone's compass pointed the marker wherever the driver held it.
      headingDeg: fix.headingDeg ?? null,
    }
  }, [fix, pin, localFresh, clock.platformPermission, locPermission])
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
  // A failed fetch over a saved route leaves error null (the cache stays on
  // screen), so it counts as failed here too.
  const geometryFailed = Boolean(geometry.error) || (geometry.source === 'CACHED' && !geometry.isLoading)
  useEffect(() => {
    if (!geometryFailed || isStale) return
    const t = setTimeout(geometry.reload, 10_000)
    return () => clearTimeout(t)
  }, [geometryFailed, geometry.reload, isStale])

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
            onAttributionHeight={setAttributionH}
            autoFollow
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
        onAttributionHeight={setAttributionH}
        autoFollow={guiding}
        frame={frame}
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
  const findStop = () => openCategory('REST')
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
    const i = maneuvers.indexOf(nextTurn.maneuver)
    return i >= 0 ? maneuvers[i + 1] ?? null : null
  }, [maneuvers, nextTurn])

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

  /* --- Phase B2 (driver_02) derived view state ------------------------- */

  /** A started trip on a selected road: the guidance panel replaces the
   *  quick actions, and the map card grows. */
  const guiding = !browsing && Boolean(trip?.tracking_expected)
  const { width: windowW, height: windowH, fontScale } = useWindowDimensions()
  // Room for the quick cards' chevrons and four tiles in one row. Below it the
  // chevrons go (at 412 "112 · 108 · 1033" lost 1033 to an ellipsis, B2D-04)
  // and the tiles take two rows (at 412 "No weather flag" was clamped).
  // Room is width over font scale: at 450 dp and 1.3x text four tiles in a
  // row cut "No weather flag" and "Terrain · max grade 17%".
  const roomy = windowW / (fontScale || 1) >= 440
  // The four quick actions take a 2 x 2 grid below 400 dp of room, width over
  // font scale (CERT-DRV-02). Four in a row give each label 60 px at 360 dp,
  // and "Puncture" needs 55 at scale 1: any larger text broke it mid-word
  // ("Punctu re", "Reques t" at 1.3). Web reports no font scale, and browser
  // zoom narrows the width instead, so the width alone decides there.
  const quickGrid = windowW / (fontScale || 1) < 400
  // The maneuver card sits between Back and SOS: 204 px wide at 360 dp, and
  // with the icon beside it the instruction had 128 px. "Keep slight right
  // onto Bhangagarh Flyover" lost the road name, and at x1.5 the name broke
  // mid-word (RC-DRV-01). Below 420 dp of room the instruction takes the
  // card's full width, under the icon and the distance, on up to 4 lines.
  const narrowCard = windowW / (fontScale || 1) < 420
  // Where the card ends, so the guiding camera keeps the truck below it
  // however many lines the instruction took.
  const [cardBottom, setCardBottom] = useState(0)
  // Room for the could-not-load card and its two buttons when the route failed.
  const baseMapHeight = Math.round(Math.min(440, Math.max(geometry.error !== null ? 340 : guiding ? 300 : 236, windowH * (guiding ? 0.4 : 0.3))))
  // While guiding the map is at least as tall as what floats on it: under
  // large text at 360 dp the maneuver card, the gauge and the rail outgrew a
  // 300 px map, the rail ran out of the card, and the summary and gauge sat
  // on the OpenStreetMap attribution (RC-DRV-01, RC-DRV-09). Measured, so the
  // normal size keeps its height.
  const [overlayH, setOverlayH] = useState(0)
  const [summaryH, setSummaryH] = useState(0)
  // The rail (right) must end above the attribution strip; the card and the
  // gauge (left) above the summary, which sits on that strip.
  // The attribution strip grows with the text (the Android WebView scales
  // its 9 px line by the font scale), so the room kept for it does too. The
  // web map also reports what the line really takes: its CSS text grows and
  // wraps with no font scale to read (RC-DRV-09); 5 px clear above it.
  const [attributionH, setAttributionH] = useState(0)
  const attributionStrip = Math.max(Math.round(22 * (fontScale || 1)), attributionH + 5)
  // Browsing, the left column is the top row alone; the summary must still
  // fit between it and the attribution once large text lifts it (RC-DRV-09).
  // The rail counts in every state since it carries the show/hide toggle:
  // browsing, it pushed Expand off the card's foot on a phone (1 Oct 2026).
  const leftBottom = guiding ? Math.max(cardBottom, 48) + 8 + 48 : 48
  const mapHeight = Math.max(baseMapHeight, 8 + leftBottom + 12 + summaryH + attributionStrip, 8 + overlayH + attributionStrip + 4)
  // The summary keeps to about 60% of the card (the reference's box is 40%);
  // the camera frames the route clear of it and of the top row and the rail.
  const summaryMax = Math.min(260, Math.round((windowW - 26) * 0.62))
  const frame = useMemo(
    () => ({ top: (guiding ? Math.max(132, cardBottom + 20) : 64) + (fullscreen ? inset : 0), right: 64, obstacle: { width: 8 + summaryMax, height: guiding ? 60 : 112 } }),
    [guiding, summaryMax, cardBottom, fullscreen, inset],
  )

  const scroll = useRef<ScrollView>(null)
  const detailsY = useRef<number | null>(null)
  const servicesY = useRef(0)
  const scrollPending = useRef<'top' | 'services' | null>(null)
  const scrollToDetails = (to: 'top' | 'services') => {
    if (detailsY.current === null) return
    scroll.current?.scrollTo({ y: Math.max(0, detailsY.current + (to === 'services' ? servicesY.current : 0) - 12), animated: false })
  }
  /** Bring the details panel (evidence, services, trip) into view - at the
   *  services when the driver asked for services. Not animated: a jump
   *  respects reduced motion and lands at once. */
  const showDetails = (to: 'top' | 'services' = 'top') => {
    setIsSheetExpanded(true)
    if (detailsY.current !== null) scrollToDetails(to)
    else scrollPending.current = to
  }
  function openCategory(next: PlaceCategory) {
    showDetails('services')
    if (category !== next) onPickCategory(next)
  }

  const hazardsUsable = Boolean(risk?.terrain?.usable || risk?.landslide_history?.events?.length || HILLSHADE_URL !== null)
  const layerRows: { key: string; label: string; on: boolean; a11y: string; toggle: () => void }[] = [
    ...(hazardsUsable ? [{ key: 'hazards', label: t('Terrain & landslides'), on: showHazards, a11y: showHazards ? 'Hide terrain and landslide overlays' : 'Show terrain and landslide overlays', toggle: () => setShowHazards((v) => !v) }] : []),
    ...(voiceUsable ? [{ key: 'voice', label: t('Voice guidance'), on: !muted, a11y: muted ? 'Unmute voice guidance' : 'Mute voice guidance', toggle: () => setMuted((v) => !v) }] : []),
    ...(trafficKnown ? [{ key: 'traffic', label: t('Fleet traffic'), on: showTraffic, a11y: showTraffic ? 'Hide fleet traffic' : 'Show fleet traffic', toggle: () => setShowTraffic((v) => !v) }] : []),
    ...(hasAlternative ? [{ key: 'alt', label: t('Alternative route'), on: showAltRoute, a11y: showAltRoute ? 'Hide alternative route' : 'Show alternative route', toggle: () => setShowAltRoute((v) => !v) }] : []),
  ]

  // "Start" the first time, "Resume" once guidance has been followed on this
  // trip - even after the screen remounted (FOLLOWED_TRIPS).
  if (following && guiding && trip) FOLLOWED_TRIPS.add(trip.id)
  const followedOnce = trip !== null && FOLLOWED_TRIPS.has(trip.id)

  /**
   * THE ONE NEXT STEP, and only a real one.
   *
   * Accept and Start live on the Trip tab with their gates (`can_start`, the
   * `start_blocked_reason` banner, the in-flight guards); a CTA here routes
   * there rather than copying them. The truck check is the Trip tab's own
   * path. While the trip runs, the step is guidance: follow the truck, or
   * open the route details once it is followed. No trip, no CTA.
   */
  const cta: { label: string; icon: IconName; onPress?: () => void; testID: string; note?: string | null } | null = (() => {
    if (trip === null || ['DELIVERED', 'CLOSED', 'CANCELLED'].includes(trip.status)) return null
    if (trip.driver_accepted_at == null && !trip.tracking_expected) {
      return { label: t('Accept on the Trip tab'), icon: 'check-circle', onPress: onBack, testID: 'cta-accept' }
    }
    if (trip.status === 'ASSIGNED') {
      if (trip.can_start) return { label: t('Start the trip on the Trip tab'), icon: 'play', onPress: onBack, testID: 'cta-start' }
      if (trip.start_blocked_code === 'ASSIGNMENT_NOT_VERIFIED' && onCheckTruck) {
        return { label: t('Check the truck'), icon: 'clipboard', onPress: onCheckTruck, testID: 'cta-check-truck', note: trip.start_blocked_reason }
      }
      return { label: t('Open Trip'), icon: 'truck', onPress: onBack, testID: 'cta-open-trip', note: trip.start_blocked_reason }
    }
    if (!guiding) return null
    if (following && nav === 'FOLLOWING') {
      return { label: t(isSheetExpanded ? 'Hide route details' : 'Route details'), icon: 'list', onPress: () => (isSheetExpanded ? setIsSheetExpanded(false) : showDetails('top')), testID: 'cta-details' }
    }
    if (canRecenter) return { label: t(followedOnce ? 'Resume guidance' : 'Start guidance'), icon: 'navigation', onPress: handleRecenter, testID: 'cta-guidance' }
    if (locPermission === 'denied') return { label: t('Allow location'), icon: 'map-pin', onPress: locRequestPermission, testID: 'cta-allow-location' }
    return { label: t('Waiting for a GPS fix'), icon: 'navigation', testID: 'cta-no-fix' }
  })()

  /** The route summary on the map card: real names, real figures, UNKNOWN
   *  where the server gave none. Never "safe", never an invented ETA. */
  // The place before the stop's kind: a stop is named "Pickup" / "Delivery"
  // and its address is where it is.
  const origin = geometry.stops[0]?.address ?? geometry.stops[0]?.name ?? null
  const destination = geometry.stops.at(-1)?.address ?? geometry.stops.at(-1)?.name ?? null
  const plannedMin = eta.duration !== null ? null : geometry.durationMin
  const paceText = eta.duration ?? (plannedMin != null ? formatMinutes(plannedMin) : null)
  const riskLine =
    riskState === 'LOADING'
      ? `${t('Route check')}: ASSESSING`
      : risk
        // The engine's decision where it made one: the band alone read
        // "LOW" beside a CAUTION card on the same road.
        ? `${t('Route check')}: ${risk.decision ? risk.decision.replace(/_/g, ' ') : `${risk.band} risk`}${riskStale ? ' · STALE' : ''}`
        : `${t('Route check')}: NOT ASSESSED`
  const summary =
    trip === null
      ? { title: t('Browsing the map'), line: t('No active trip · search, terrain and SOS still work'), evidence: null }
      : selectedRouteId === null
        ? { title: t('Route not selected'), line: t('Your manager assigns the road first'), evidence: null }
        : geometry.points.length === 0
          ? { title: t('Loading the route'), line: t('Turn-by-turn starts once the road has loaded'), evidence: null }
          : {
              title: `${origin ?? t('Origin')} → ${destination ?? t('Destination')}`,
              line: `${eta.distance ?? 'UNKNOWN'} · ${paceText ? `${paceText} ${t('at planned pace')}` : `${t('time')} UNKNOWN`}`,
              evidence: riskLine,
            }

  /** Route information tiles, each from the evidence or saying it has none. */
  const terrainTile = (() => {
    const terrain = risk?.terrain
    if (!terrain?.usable) return { value: 'NOT ASSESSED', sub: t('Terrain') }
    const worst = (['STEEP', 'HILLY', 'ROLLING', 'FLAT'] as const).find((c) => (terrain.class_km[c] ?? 0) > 0)
    if (!worst) return { value: 'NOT ASSESSED', sub: t('Terrain') }
    return { value: `${worst} · ${formatDistanceKm(terrain.class_km[worst])}`, sub: `${t('Terrain')} · ${t('max grade')} ${Math.round(terrain.max_grade_pct)}%${riskStale ? ' · STALE' : ''}` }
  })()
  const weatherTile = (() => {
    if (!risk) return { value: riskState === 'LOADING' ? '…' : 'NOT ASSESSED', sub: t('Weather') }
    if (risk.inputs.weather !== 'AVAILABLE') return { value: 'UNAVAILABLE', sub: t('Weather') }
    const codes = new Set([...(risk.reason_codes ?? []), ...(risk.decision_reason_codes ?? [])])
    const flag = WEATHER_CODES.find((c) => codes.has(c))
    return {
      value: flag ? translateReasonCode(flag, language) : t('No weather flag'),
      sub: `${t('Weather')} · ${risk.observations_used} obs${riskStale ? ' · STALE' : ''}`,
    }
  })()
  // While guiding the ETA row directly above states distance and time, so
  // those two tiles give way to the next stop and the next marked terrain
  // (B2D-08). Each is real or says it is not known.
  const nextStop = trip?.stops.find((s) => s.status === 'PENDING' || s.status === 'ARRIVED') ?? null
  const tiles: { icon: IconName; value: string; sub: string; testID: string }[] = [
    ...(guiding
      ? [
          // The place, not the postal address: two lines of a tile cut it at
          // "793001, Indi" (AUD2-02). The Trip tab has the address whole.
          { icon: 'flag' as IconName, value: nextStop ? (nextStop.address ? placeName(nextStop.address) : nextStop.name ?? 'UNKNOWN') : t('None left'), sub: t('Next stop'), testID: 'tile-next-stop' },
          {
            icon: 'chevrons-up' as IconName,
            value: ai.nextTerrain ?? (!risk?.terrain?.usable ? 'NOT ASSESSED' : guidanceHasPosition ? t('None marked ahead') : 'UNKNOWN'),
            sub: t('Next terrain'),
            testID: 'tile-next-terrain',
          },
        ]
      : [
          { icon: 'map' as IconName, value: eta.distance ?? 'UNKNOWN', sub: t(eta.distanceLabel === 'remaining' ? 'Remaining' : 'Distance'), testID: 'tile-distance' },
          { icon: 'clock' as IconName, value: paceText ?? 'UNKNOWN', sub: t('At planned pace'), testID: 'tile-time' },
        ]),
    { icon: 'trending-up', value: terrainTile.value, sub: terrainTile.sub, testID: 'tile-terrain' },
    { icon: 'cloud-rain', value: weatherTile.value, sub: weatherTile.sub, testID: 'tile-weather' },
  ]

  // Destination first, so a narrow screen cuts the code, not the place. The
  // place a driver says ("Shillong"), not the postal address: at 360 dp the
  // full address was cut at "793001, Indi" (AUD2-02). It stands whole in the
  // route summary and on the Trip tab.
  const lastStop = trip?.stops.at(-1)
  const heroPlace = lastStop?.address ? placeName(lastStop.address) : lastStop?.name
  const heroSubtitle = trip
    ? [heroPlace, trip.trip_code].filter(Boolean).join(' · ')
    : t('Roadside services, terrain and help')

  const speedGauge = (
    <View style={styles.speedGauge} accessibilityLabel={`${localFresh && fix?.speedKmh != null ? fix.speedKmh : 'No'} km/h`}>
      <Text style={styles.speedValue}>
        {localFresh && fix?.speedKmh != null ? fix.speedKmh : '--'}
      </Text>
      <Text style={styles.speedUnit}>km/h</Text>
    </View>
  )

  // A safety notice: in full screen it floats over the map's foot instead
  // of stepping aside with the other cards.
  const alertCard = shownAlert ? (
    <View style={[styles.alertCard, shownAlert.level !== 'CAUTION' && styles.alertCardHigh]} testID="danger-alert">
      <View style={styles.alertTitleRow}>
        <Icon name="alert-triangle" size={16} color={shownAlert.level !== 'CAUTION' ? COLORS.danger : COLORS.warning} />
        <Text style={[styles.alertTitle, shownAlert.level !== 'CAUTION' && styles.alertTitleHigh]} numberOfLines={2}>
          {shownAlert.title} · {shownAlert.level}
        </Text>
      </View>
      {/* Room to finish: the card is a safety notice and its evidence
          ("landslide inventory ... (historical)") is what keeps it
          honest; one line cut it even at normal size (RC-DRV-02). */}
      <Text style={styles.alertWhere} numberOfLines={3}>{shownAlert.where}</Text>
      <Text style={styles.alertDetail} numberOfLines={4}>{shownAlert.detail}</Text>
      <Text style={styles.alertEvidence} numberOfLines={3}>Evidence · {shownAlert.evidence.join(' · ')}</Text>
      <View style={styles.alertActions}>
        <Pressable onPress={() => showDetails()} accessibilityRole="button" accessibilityLabel="View route details" style={styles.alertBtn}>
          <Text style={styles.alertBtnText}>{t('VIEW')}</Text>
        </Pressable>
        <Pressable onPress={findStop} accessibilityRole="button" accessibilityLabel="Find a place to stop" style={styles.alertBtn}>
          <Text style={styles.alertBtnText}>{t('STOPS')}</Text>
        </Pressable>
        <Pressable
          onPress={() => setAcknowledged((prev) => new Set(prev).add(shownAlert.key))}
          accessibilityRole="button"
          accessibilityLabel="Acknowledge this alert"
          style={[styles.alertBtn, styles.alertBtnPrimary]}
          testID="danger-alert-ack"
        >
          <Text style={[styles.alertBtnText, styles.alertBtnTextPrimary]}>{t('OK, SEEN')}</Text>
        </Pressable>
      </View>
    </View>
  ) : null

  // The hero's GPS chip and the saved-route strip are hidden in full screen;
  // their words ride in the summary so offline is never silent.
  const nowText = new Date(clock.now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  // THE TRIP STATUS LINE while guiding, in both sizes: the time now, the
  // arrival and what is left - from the server's planned pace, never invented.
  const navStatus = [
    nowText,
    eta.arrival ? `${t('Arrive')} ${eta.arrival}` : null,
    eta.duration ? `${eta.duration} ${t('left')}` : paceText ? `${paceText} ${t('at planned pace')}` : `${t('time')} UNKNOWN`,
    eta.distance ?? 'UNKNOWN',
  ].filter(Boolean).join(' · ')
  const canBreak = guiding && !activeBreak && (trip?.status === 'ACTIVE' || trip?.status === 'DELAYED')
  const breakLeftMin = activeBreak ? Math.round((Date.parse(activeBreak.expected_end_at) - clock.now) / 60_000) : 0
  const breakBackBy = activeBreak ? new Date(activeBreak.expected_end_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
  const openBreak = () => {
    breakRequestId.current = makeRequestId()
    setBreakMinutes(15)
    setBreakReason(null)
    setShowBreak(true)
  }
  const startBreak = () => {
    if (!breakReason || isBusy) return
    void act(() =>
      api.startBreak({
        requestId: breakRequestId.current,
        minutes: breakMinutes,
        reason: breakReason,
        ...(fix ? { lat: fix.lat, lon: fix.lon, fixAt: new Date(fix.at).toISOString() } : {}),
      }),
    )
  }
  const fullStatus = [fullscreen && !guiding ? nowText : null, chip.text, geometry.source === 'CACHED' ? t(isStale ? 'Saved route — no connection.' : 'Saved route') : null].filter(Boolean).join(' · ')
  const enterFullscreen = () => {
    savedY.current = scrollY.current
    setFullscreen(true)
    scroll.current?.scrollTo({ y: 0, animated: false })
  }
  const exitFullscreen = () => {
    setFullscreen(false)
    requestAnimationFrame(() => scroll.current?.scrollTo({ y: savedY.current, animated: false }))
  }

  return (
    <View style={styles.root} onLayout={(e) => setRootH(Math.round(e.nativeEvent.layout.height))}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!fullscreen}
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y
        }}
        scrollEventThrottle={100}
      >
        {fullscreen ? null : (<>
        <ScreenHero
          photo={PHOTOS.navigate}
          title={tk('nav_navigate')}
          subtitle={heroSubtitle}
          status={<StatusChip text={chip.text} tone={chip.tone === 'off' ? 'off' : chip.tone === 'coarse' ? 'warn' : 'live'} />}
          themeChip
          compact
        />

        {/* The real search on this screen: roadside services along the road,
            near the truck or in the map area. No free text and no mic -
            neither exists - so the field opens the category search. */}
        <Pressable
          onPress={() => showDetails('services')}
          accessibilityRole="button"
          accessibilityLabel="Search roadside services"
          testID="search-field"
          style={({ pressed }) => [styles.search, pressed && styles.pressed]}
        >
          <Icon name="search" size={20} color={COLORS.textMuted} />
          <Text style={styles.searchText} numberOfLines={2}>{t('Search roadside services')}</Text>
          <Icon name="chevron-down" size={18} color={COLORS.textMuted} />
        </Pressable>
        </>)}

        {/* THE MAP CARD. A real box of its own, so everything floating inside
            is anchored to it and can never sit under the cards below. */}
        <View style={[styles.mapCard, { height: fullscreen && rootH ? rootH : mapHeight }, fullscreen && styles.mapCardFull]} testID="map-card">
          <View style={styles.mapArea}>
            {/* THE MAP'S OWN CONTROLS, in two rows so nothing overlaps at any
                height. Top: back, then the next maneuver while guiding (the
                speed otherwise), then SOS - the emergency action first on
                the right and independent of everything. Below: the speed
                while guiding, and the rail: only controls that DO something
                right now. Voice, traffic and the alternative road live in the
                layers panel with the overlays. */}
            <View style={[styles.mapOverlay, fullscreen && { top: 8 + inset }]} pointerEvents="box-none" testID="map-overlay" onLayout={(e) => setOverlayH(Math.round(e.nativeEvent.layout.height))}>
              <View style={styles.mapTopRow} pointerEvents="box-none">
                {fullscreen ? (
                  <Pressable
                    onPress={exitFullscreen}
                    accessibilityRole="button"
                    accessibilityLabel="Exit full screen"
                    style={[styles.roundBtn, styles.exitFullBtn]}
                    testID="map-exit-fullscreen"
                  >
                    <Icon name="minimize-2" size={22} color={COLORS.onPrimary} />
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={onBack}
                    accessibilityRole="button"
                    accessibilityLabel="Back to trip"
                    style={styles.roundBtn}
                  >
                    <Icon name="chevron-left" size={24} color={COLORS.text} />
                  </Pressable>
                )}
                {guiding ? (
                <View
                  style={[styles.maneuverCard, styles.maneuverInMap]}
                  testID="maneuver-card"
                  onLayout={(e) => setCardBottom(Math.round(e.nativeEvent.layout.y + e.nativeEvent.layout.height))}
                >
                  <View style={styles.maneuverMain}>
                    <View style={styles.maneuverIcon}><Icon name={nextTurn ? maneuverIcon(nextTurn.maneuver) : 'navigation'} size={30} color={COLORS.onFill} /></View>
                    <View style={styles.maneuverText}>
                      {nextTurn ? (
                        <>
                          <Text style={styles.maneuverDistance}>{formatTurnDistance(nextTurn.distanceM)}</Text>
                          {/* Three lines: two cut the road name ("onto Bha…",
                              CERT-DRV-05, RC-DRV-01). */}
                          {narrowCard ? null : (
                            <Text style={styles.maneuverInstruction} numberOfLines={3} testID="maneuver-instruction">
                              {instructionFor(nextTurn.maneuver, t)}
                            </Text>
                          )}
                        </>
                      ) : (
                        <>
                          {/* No maneuver means SAY no maneuver: `hold` and
                              `available` carry the real reason, and an invented
                              "continue straight" is the one thing this card must
                              never show. */}
                          {/* Two lines: at 360 dp "Guidance paused" lost its last
                              letters between back and SOS. */}
                          {/* While the directions are still on their way this is a
                              wait, not a failure (RC-DRV-11). */}
                          <Text style={styles.maneuverInstruction} numberOfLines={2}>
                            {!navigation.available && navigation.isLoading
                              ? t('Loading guidance…')
                              : t(!navigation.available ? 'Guidance unavailable' : hold !== null ? 'Guidance paused' : 'No further turns')}
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
                  {nextTurn && narrowCard ? (
                    <Text style={styles.maneuverInstruction} numberOfLines={4} testID="maneuver-instruction">
                      {instructionFor(nextTurn.maneuver, t)}
                    </Text>
                  ) : null}
                  {thenTurn ? (
                    <View style={styles.thenRow}>
                      {/* Wraps like the instruction below 420 dp of room: at
                          360 under larger text two lines cut the next road's
                          name (FV-DRV-01). */}
                      <Text style={styles.thenText} numberOfLines={narrowCard ? 4 : 2} testID="maneuver-then">
                        {t('Then')} <Icon name={maneuverIcon(thenTurn)} size={13} color={COLORS.onFill} /> {instructionFor(thenTurn, t)}
                      </Text>
                    </View>
                  ) : null}
                </View>
                ) : (
                  <>
                    {speedGauge}
                    <View style={styles.flex1} pointerEvents="none" />
                  </>
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
              <View style={styles.mapSecondRow} pointerEvents="box-none">
                {guiding ? speedGauge : <View />}
                <View style={styles.rail} pointerEvents="box-none">
                  <MapControl
                    onPress={() => {
                      setShowLayers(false)
                      setControlsHidden((v) => !v)
                    }}
                    label={controlsHidden ? 'Show map controls' : 'Hide map controls'}
                    active={controlsHidden}
                  >
                    <Icon name={controlsHidden ? 'sliders' : 'eye-off'} size={20} color={controlsHidden ? COLORS.onPrimary : COLORS.text} />
                  </MapControl>
                  {controlsHidden ? null : (<>
                  {layerRows.length ? (
                    <MapControl onPress={() => setShowLayers((v) => !v)} label={showLayers ? 'Close map layers' : 'Map layers'} active={showLayers}>
                      <Icon name="layers" size={20} color={showLayers ? COLORS.onPrimary : COLORS.text} />
                    </MapControl>
                  ) : null}
                  <MapControl
                    onPress={canRecenter ? handleRecenter : locPermission === 'denied' ? locRequestPermission : undefined}
                    label={canRecenter ? 'Re-centre the map on the truck' : locPermission === 'denied' ? 'Allow location' : 'Waiting for a GPS position'}
                    active={following && nav === 'FOLLOWING'}
                    disabled={!canRecenter && locPermission !== 'denied'}
                  >
                    <RecenterIcon color={following && nav === 'FOLLOWING' ? COLORS.onPrimary : canRecenter || locPermission === 'denied' ? COLORS.text : COLORS.textFaint} size={20} />
                  </MapControl>
                  {canFitRoute ? (
                    <MapControl onPress={handleFitRoute} label="Route overview — fit the whole route">
                      <FitRouteIcon color={COLORS.text} size={20} />
                    </MapControl>
                  ) : null}
                  {canBreak ? (
                    <MapControl onPress={openBreak} label="Take a break">
                      <Icon name="coffee" size={20} color={COLORS.text} />
                    </MapControl>
                  ) : null}
                  </>)}
                  {fullscreen ? null : (
                    <MapControl onPress={enterFullscreen} label="Expand map to full screen">
                      <Icon name="maximize-2" size={20} color={COLORS.text} />
                    </MapControl>
                  )}
                  {showLayers && !controlsHidden && layerRows.length ? (
                    <View style={styles.layers} testID="layers-panel">
                      {layerRows.map((row) => (
                        <Pressable
                          key={row.key}
                          onPress={row.toggle}
                          accessibilityRole="button"
                          accessibilityLabel={row.a11y}
                          accessibilityState={{ selected: row.on }}
                          aria-pressed={row.on}
                          style={({ pressed }) => [styles.layerRow, pressed && styles.pressed]}
                        >
                          <Text style={styles.layerLabel} numberOfLines={1}>{row.label}</Text>
                          <Text style={[styles.layerState, row.on && styles.layerStateOn]}>{t(row.on ? 'On' : 'Off')}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              </View>
            </View>

            {/* After the controls in the DOM, drawn under them (zIndex): Tab
                reads Back, SOS and the rail at the map's top before the map
                and the attribution link at its foot (RC-DRV-06). */}
            <View style={styles.mapCanvasWrapper}>{renderCanvas()}</View>

            {/* BOTTOM-LEFT: the route summary, over the attribution line. While
                guiding it is the nav chip and one line - the ETA row carries
                the figures, and the map needs the room (B2D-05). The chip is
                guidance state, so it exists only while guiding: "Following"
                on a trip not yet accepted read as guidance running (B2D-09). */}
            {activeBreak ? (
              <View style={[styles.breakCard, { bottom: attributionStrip }, activeBreak.status === 'OVERDUE' && styles.breakCardOver]} testID="break-banner" accessibilityRole="alert">
                <View style={styles.flexShrink}>
                  <Text style={styles.breakTitle} numberOfLines={1}>{t('On break')} · {t(BREAK_REASONS.find((r) => r.id === activeBreak.reason)?.label ?? 'Other')}</Text>
                  <Text style={styles.breakLine} numberOfLines={2}>
                    {activeBreak.status === 'OVERDUE' || breakLeftMin < 0
                      ? `${t('Overran by')} ${Math.max(1, -breakLeftMin)} min · ${t('your manager has been told')}`
                      : `${Math.max(0, breakLeftMin)} min ${t('left')} · ${t('back by')} ${breakBackBy}`}
                  </Text>
                </View>
                <Pressable
                  onPress={() => void act(() => api.resumeBreak(activeBreak.id))}
                  disabled={isBusy}
                  accessibilityRole="button"
                  accessibilityLabel="Resume driving"
                  style={({ pressed }) => [styles.breakResume, pressed && styles.pressed]}
                  testID="break-resume"
                >
                  <Text style={styles.breakResumeText}>{t('Resume driving')}</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={[styles.summary, { maxWidth: guiding ? windowW - 26 - 72 : summaryMax, bottom: attributionStrip }, guiding && styles.summaryGuiding, activeBreak && styles.hidden]} pointerEvents="none" testID="route-summary" onLayout={(e) => setSummaryH(Math.round(e.nativeEvent.layout.height))}>
              {guiding ? (
                <>
                  <View style={[styles.navChip, (nav === 'OFF_ROUTE' || nav === 'REROUTING') && styles.navChipWarn, (nav === 'GPS_STALE' || nav === 'OFFLINE' || nav === 'IDLE') && styles.navChipOff]} testID="nav-state">
                    <Text style={[styles.navChipText, (nav === 'OFF_ROUTE' || nav === 'REROUTING') && styles.navChipWarnText]}>{t(NAV_WORDS[nav] ?? nav)}</Text>
                  </View>
                  {/* Two lines, never an ellipsis: this is the route verdict
                      ("Route check: CAUTION" was cut to "Route check: …"
                      under large text, RC-DRV-02). */}
                  <View style={styles.flexShrink}>
                    <Text style={styles.summaryEvidence} numberOfLines={2}>{summary.evidence ?? summary.title}</Text>
                    <Text style={styles.summaryLine} numberOfLines={2} testID="nav-status">{navStatus}</Text>
                    {fullscreen ? <Text style={styles.summaryLine} numberOfLines={2}>{fullStatus}</Text> : null}
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.summaryTitle} numberOfLines={2}>{summary.title}</Text>
                  <Text style={styles.summaryLine} numberOfLines={3}>{summary.line}</Text>
                  {summary.evidence ? <Text style={styles.summaryEvidence} numberOfLines={1}>{summary.evidence}</Text> : null}
                  {fullscreen ? <Text style={styles.summaryLine} numberOfLines={2}>{fullStatus}</Text> : null}
                </>
              )}
            </View>
          </View>
        </View>

        {fullscreen ? null : (<>
        {geometry.source === 'CACHED' ? (
          <View style={styles.sourceStrip}>
            <Text style={styles.sourceStripText}>
              {/* While the fetch is in flight the saved corridor is a stand-in,
                  not an outage; "no connection" only when the trip poll says so. */}
              {geometry.isLoading ? t('Saved route — checking for updates.') : isStale ? t('Saved route — no connection.') : t('Saved route — could not update.')} Downloaded {relativeTime(geometry.capturedAt)}.
            </Text>
          </View>
        ) : null}

        {/* The road the driver asked for, or any new road, was taken by the
            manager: guidance has switched to it (FV-E2E-2). */}
        {rerouteJustApproved(rerouteApproved, trip, clock.now) ? (
          <Banner tone="ok" title="Reroute approved" style={styles.approvedBanner} />
        ) : null}

        {alertCard}

        {cta ? (
          <View style={styles.ctaBlock}>
            <Pressable
              onPress={cta.onPress}
              disabled={!cta.onPress}
              accessibilityRole="button"
              accessibilityState={{ disabled: !cta.onPress }}
              aria-disabled={!cta.onPress}
              testID={cta.testID}
              style={({ pressed }) => [styles.cta, !cta.onPress && styles.ctaOff, pressed && styles.pressed]}
            >
              <Icon name={cta.icon} size={20} color={COLORS.onPrimary} />
              <Text style={styles.ctaText} numberOfLines={1}>{cta.label}</Text>
              <Icon name="arrow-right" size={20} color={COLORS.onPrimary} />
            </Pressable>
            {/* The server's own words for the gate, as the Trip tab shows them. */}
            {cta.note ? <Text style={styles.ctaNote}>{cta.note}</Text> : null}
          </View>
        ) : null}

        {guiding ? (
          <View style={styles.guidance} testID="guidance-panel">
            {/* Duration and arrival only from the server's planned pace. */}
            <Pressable
              onPress={() => (isSheetExpanded ? setIsSheetExpanded(false) : showDetails('top'))}
              accessibilityRole="button"
              accessibilityLabel={isSheetExpanded ? 'Hide route details' : 'Show route details'}
              style={styles.etaBar}
              testID="eta-bar"
            >
              <View style={styles.etaCell}>
                {/* Wraps rather than cuts: "03:41 …" is not an arrival time (RC-DRV-02). */}
                <Text style={styles.etaValue} numberOfLines={2}>{eta.duration ?? '—'}</Text>
                <Text style={styles.etaLabel}>{risk?.traffic && risk.traffic.delay_min > 0 ? `${t('duration')} · +${Math.round(risk.traffic.delay_min)} ${t('min traffic')}` : t('duration')}</Text>
              </View>
              <View style={styles.etaCell}>
                <Text style={styles.etaValue} numberOfLines={2}>{eta.distance ?? '—'}</Text>
                <Text style={styles.etaLabel}>{t(eta.distanceLabel)}</Text>
              </View>
              <View style={styles.etaCell}>
                <Text style={styles.etaValue} numberOfLines={2}>{eta.arrival ?? '—'}</Text>
                {/* The arrival is the server's remaining-at-planned-pace from now,
                    so it is labelled as such (audit s16.1), not as a promise. */}
                <Text style={styles.etaLabel}>{t(eta.arrival ? (isStale ? 'arrival · last known' : 'arrival · at planned pace') : selectedRouteId === null ? 'no route' : guidanceHasPosition ? 'on route' : 'no fix')}</Text>
              </View>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.quick, quickGrid && styles.quickGrid]} testID="quick-actions">
            {QUICK.map((q) => (
              <Pressable
                key={q.id}
                onPress={() => openCategory(q.id)}
                accessibilityRole="button"
                // "Fuel: search this area" - the mode label already says search (RC-DRV-04).
                accessibilityLabel={`${t(q.label)}: ${t(MODE_LABELS.find((m) => m.id === mode)?.label ?? '').toLowerCase()}`}
                accessibilityState={{ selected: category === q.id }}
                testID={`quick-${q.id.toLowerCase()}`}
                style={({ pressed }) => [styles.quickCard, quickGrid && styles.quickCardGrid, category === q.id && styles.quickCardOn, pressed && styles.pressed]}
              >
                <Icon name={q.icon} size={24} color={COLORS.text} />
                <View style={styles.quickRow}>
                  <Text style={styles.quickTitle} numberOfLines={2}>{t(q.label)}</Text>
                  {roomy ? <Icon name="chevron-right" size={16} color={COLORS.textMuted} /> : null}
                </View>
                <Text style={styles.quickSub} numberOfLines={2}>{t(MODE_LABELS.find((m) => m.id === mode)?.label ?? '')}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setShowEmergency(true)}
              accessibilityRole="button"
              accessibilityLabel="Request help: emergency numbers 112, 108 and 1033"
              testID="quick-help"
              style={({ pressed }) => [styles.quickCard, quickGrid && styles.quickCardGrid, pressed && styles.pressed]}
            >
              <Icon name="plus-circle" size={24} color={COLORS.danger} />
              <View style={styles.quickRow}>
                <Text style={styles.quickTitle} numberOfLines={2}>{t('Request help')}</Text>
                {roomy ? <Icon name="chevron-right" size={16} color={COLORS.textMuted} /> : null}
              </View>
              <Text style={styles.quickSub} numberOfLines={2}>112 · 108 · 1033</Text>
            </Pressable>
          </View>
        )}

        {browsing ? null : (
          <View style={styles.infoCard} testID="route-info">
            <View style={styles.infoHead}>
              <Text style={styles.infoTitle} accessibilityRole="header">{t('Route Information')}</Text>
              <Pressable
                onPress={() => (isSheetExpanded ? setIsSheetExpanded(false) : showDetails('top'))}
                accessibilityRole="button"
                accessibilityLabel={isSheetExpanded ? 'Hide route details' : 'Show route details'}
                style={styles.infoLink}
              >
                <Text style={styles.infoLinkText}>{t(isSheetExpanded ? 'Hide details' : 'View details')}</Text>
                <Icon name={isSheetExpanded ? 'chevron-up' : 'arrow-right'} size={16} color={COLORS.info} />
              </Pressable>
            </View>
            <View style={styles.tiles}>
              {tiles.map((tile) => (
                <View key={tile.testID} style={[styles.tile, !roomy && styles.tileNarrow]} testID={tile.testID}>
                  <Icon name={tile.icon} size={22} color={COLORS.text} />
                  <Text style={styles.tileValue} numberOfLines={2}>{tile.value}</Text>
                  <Text style={styles.tileSub} numberOfLines={2}>{tile.sub}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* PERSONAL ROUTE AI - the decision the engine reached, in words.
            Absent without a road: there is no decision to show and none is
            made up. */}
        {browsing ? null : (
        <View style={styles.aiCard} testID="route-ai-card">
          <View style={styles.aiHead}>
            <Text style={styles.aiEyebrow}>PERSONAL ROUTE AI{riskStale ? ' · LAST KNOWN' : isStale ? ' · OFFLINE' : ''}</Text>
            <Pressable
              onPress={() => (isSheetExpanded ? setIsSheetExpanded(false) : showDetails('top'))}
              accessibilityRole="button"
              accessibilityLabel={isSheetExpanded ? 'Hide route details' : 'Show route details'}
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
            <Text style={styles.aiHeadline} numberOfLines={2}>
              {riskState === 'LOADING' ? 'Assessing the route…' : ai.headline}
            </Text>
          </View>
          <Text style={styles.aiLines} numberOfLines={4}>
            {riskState === 'LOADING' ? 'Reading terrain, weather and landslide evidence.' : ai.lines.join(' · ')}
          </Text>
          <View style={styles.aiFacts}>
            {ai.nextTerrain ? (
              <Text style={styles.aiFact} numberOfLines={2}>{t('Next terrain')}: <Text style={styles.aiFactStrong}>{ai.nextTerrain}</Text></Text>
            ) : null}
            {ai.landslide ? (
              <Text style={styles.aiFact} numberOfLines={2}>{t('Landslide exposure')}: <Text style={styles.aiFactStrong}>{ai.landslide}</Text></Text>
            ) : null}
            {ai.weather ? (
              <Text style={styles.aiFact} numberOfLines={2}>{t('Weather')}: <Text style={styles.aiFactStrong}>{ai.weather}</Text></Text>
            ) : null}
            {risk?.traffic ? (
              <Text style={styles.aiFact} numberOfLines={2}>{t('Fleet traffic')}: <Text style={styles.aiFactStrong}>{trafficLine(risk.traffic)}</Text></Text>
            ) : null}
          </View>
          {holdDecision ? (
            <Pressable onPress={findStop} accessibilityRole="button" accessibilityLabel="Find a place to stop" style={styles.stopLink}>
              <Text style={styles.stopLinkText}>{t('Find a place to stop')} →</Text>
            </Pressable>
          ) : null}
          <Text style={styles.aiStamp} numberOfLines={2}>
            {ai.evidence}
            {risk
              ? riskStale
                ? ` · captured ${relativeTime(riskCapturedAt ?? risk.assessed_at)} · STALE`
                : ` · updated ${relativeTime(risk.assessed_at)}${isStale ? ' · connection lost' : ''}`
              : ''}
          </Text>
        </View>
        )}

        {/* DETAILS - the evidence behind the card, services, trip facts. */}
        {isSheetExpanded ? (
          <View
            style={styles.details}
            testID="details-panel"
            onLayout={(e) => {
              detailsY.current = e.nativeEvent.layout.y
              if (scrollPending.current === 'top') {
                scrollPending.current = null
                scrollToDetails('top')
              }
            }}
          >
            {browsing ? null : (<>
            <Text style={styles.sectionTitle}>{t('Evidence')}</Text>
            <View style={styles.factorGrid}>
              {factorRows.slice(0, 8).map(([name, state]) => (
                <View key={name} style={styles.factorRow}>
                  <Text style={styles.factorName} numberOfLines={2}>{name}</Text>
                  <Text style={[styles.factorState, state !== 'Available' && styles.factorStateOff]}>{state}</Text>
                </View>
              ))}
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

            <View
              style={styles.services}
              onLayout={(e) => {
                servicesY.current = e.nativeEvent.layout.y
                if (scrollPending.current === 'services') {
                  scrollPending.current = null
                  scrollToDetails('services')
                }
              }}
            >
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
            </View>

            {trip === null ? null : (<>
            <Text style={styles.sectionTitle}>{t('Trip')}</Text>
            {/* The two addresses whole: two lines cut the destination (AUD2-02). */}
            <Text style={styles.tripLine} numberOfLines={5}>
              {origin ?? 'Origin'} → {destination ?? 'Destination'}
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
          </View>
        ) : null}

        {/* driver_02's scenic foot: decoration with its credit, no claim. It
            follows the last card at a fixed gap and grows to the foot of a
            short page, so no empty band sits above it (B2D-12). */}
        <View style={styles.strip} accessible={false}>
          <CoverPhoto photo={PHOTOS.strip} />
          <View style={[styles.fill, styles.passThrough, { backgroundColor: COLORS.imageDim }]} />
          <View style={[styles.fill, styles.passThrough, gradient(`linear-gradient(180deg, ${COLORS.bg} 0%, transparent 45%)`)]} />
        </View>
        </>)}
      </ScrollView>

      {fullscreen && alertCard ? <View style={[styles.fullAlert, { bottom: attributionStrip }]}>{alertCard}</View> : null}

      {places.selected ? (
        <PlaceSheet place={places.selected} onClose={() => places.select(null)} onCall={call} />
      ) : null}

      {/* THE BREAK SHEET: how long and why. The manager is told both, with
          where the truck stopped; the trip and its road stay as they are. */}
      {showBreak ? (
        <View style={styles.breakPanel} testID="break-sheet">
          <Text style={styles.emergencyTitle}>{t('Take a break')}</Text>
          <Text style={styles.emergencyNote}>{t('Your manager is told why, for how long and where you stopped.')}</Text>
          <Text style={styles.breakLabel}>{t('How long')}</Text>
          <View style={styles.breakChips}>
            {([15, 30] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => setBreakMinutes(m)}
                accessibilityRole="button"
                accessibilityLabel={`${m} minute break`}
                accessibilityState={{ selected: breakMinutes === m }}
                aria-pressed={breakMinutes === m}
                style={[styles.breakChip, breakMinutes === m && styles.breakChipOn]}
                testID={`break-${m}`}
              >
                <Text style={[styles.breakChipText, breakMinutes === m && styles.breakChipTextOn]}>{m} min</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.breakLabel}>{t('Why')}</Text>
          <View style={styles.breakChips}>
            {BREAK_REASONS.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => setBreakReason(r.id)}
                accessibilityRole="button"
                accessibilityLabel={r.label}
                accessibilityState={{ selected: breakReason === r.id }}
                aria-pressed={breakReason === r.id}
                style={[styles.breakChip, breakReason === r.id && styles.breakChipOn]}
                testID={`break-reason-${r.id}`}
              >
                <Text style={[styles.breakChipText, breakReason === r.id && styles.breakChipTextOn]}>{t(r.label)}</Text>
              </Pressable>
            ))}
          </View>
          {actionError ? <Text style={styles.breakError} accessibilityRole="alert">{actionError.detail}</Text> : null}
          <View style={styles.breakActions}>
            <Pressable onPress={() => setShowBreak(false)} accessibilityRole="button" accessibilityLabel="Cancel" style={[styles.breakChip, styles.flex1]}>
              <Text style={styles.breakChipText}>{t('Cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={startBreak}
              disabled={!breakReason || isBusy}
              accessibilityRole="button"
              accessibilityLabel={`Start ${breakMinutes} minute break`}
              accessibilityState={{ disabled: !breakReason || isBusy }}
              aria-disabled={!breakReason || isBusy}
              style={[styles.breakStart, styles.flex1, (!breakReason || isBusy) && styles.ctaOff]}
              testID="break-start"
            >
              <Text style={styles.breakStartText}>{isBusy ? t('Sending…') : t('Start break')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* THE EMERGENCY SHEET. Bundled numbers; it never dials by itself. */}
      {showEmergency ? (
        <View style={styles.emergencyPanel} accessibilityRole="alert" testID="emergency-sheet">
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
    </View>
  )
}

/** The reasons a driver can give; the server keeps the same six (0017). */
const BREAK_REASONS: { id: BreakReason; label: string }[] = [
  { id: 'TEA_REST', label: 'Tea / rest' },
  { id: 'FOOD', label: 'Food' },
  { id: 'WASHROOM', label: 'Washroom' },
  { id: 'FUEL', label: 'Fuel' },
  { id: 'EMERGENCY', label: 'Emergency' },
  { id: 'OTHER', label: 'Other' },
]

/** "2 h 10 min" / "45 min" - the same shape as the ETA bar's duration. */
function formatMinutes(mins: number): string {
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${Math.round(mins % 60)} min` : `${Math.round(mins)} min`
}

/** Weather reason codes, loudest first, for the Weather tile. */
const WEATHER_CODES = [
  'SEVERE_CONDITIONS_ON_ROUTE',
  'HEAVY_RAIN_ON_ROUTE',
  'HIGH_WIND_GUSTS',
  'MODERATE_RAIN_ON_ROUTE',
  'HEAVY_RECENT_RAINFALL',
] as const

/** driver_02's quick actions, on real place categories. The reference's
 *  "Food Stop" has no category behind it (HOTEL means rooms, not meals), so
 *  the third card is tyres. */
const QUICK: { id: PlaceCategory; label: string; icon: IconName }[] = [
  { id: 'FUEL', label: 'Fuel', icon: 'droplet' },
  { id: 'REST', label: 'Lay-bys & rest', icon: 'coffee' },
  { id: 'TYRES', label: 'Puncture & tyres', icon: 'tool' },
]

const useStyles = makeStyles((COLORS) => ({
  root: { flex: 1, backgroundColor: COLORS.bg },
  page: { flexGrow: 1, paddingBottom: 0, backgroundColor: COLORS.bg },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  passThrough: { pointerEvents: 'none' },
  pressed: { opacity: 0.8 },

  /* --- driver_02: search pill riding the hero's foot ------------------- */
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    marginTop: -26,
    marginHorizontal: 13,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  searchText: { flex: 1, color: COLORS.textMuted, fontSize: 15 },

  /* --- The map card: 94% of the width, radius 14 ----------------------- */
  mapCard: {
    marginTop: 10,
    marginHorizontal: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceSoft,
  },
  hidden: { display: 'none' },
  breakCard: {
    position: 'absolute', left: 8, right: 8, zIndex: 12, flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10, borderRadius: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.accent,
  },
  breakCardOver: { borderColor: COLORS.warning, backgroundColor: COLORS.warningSoft },
  breakTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  breakLine: { color: COLORS.textMuted, fontSize: 13 },
  breakResume: { minHeight: 48, paddingHorizontal: 14, borderRadius: 10, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  breakResumeText: { color: COLORS.onPrimary, fontSize: 14, fontWeight: '800' },
  breakPanel: {
    position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, gap: 10, zIndex: 30,
    backgroundColor: COLORS.surface, borderTopWidth: 2, borderTopColor: COLORS.accent, borderTopLeftRadius: 16, borderTopRightRadius: 16,
  },
  breakLabel: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  breakChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  breakChip: { minHeight: 48, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  breakChipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  breakChipText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  breakChipTextOn: { color: COLORS.onPrimary },
  breakActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  breakStart: { minHeight: 48, borderRadius: 10, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  breakStartText: { color: COLORS.onPrimary, fontSize: 15, fontWeight: '800' },
  breakError: { color: COLORS.danger, fontSize: 13 },
  mapCardFull: { marginTop: 0, marginHorizontal: 0, borderRadius: 0, borderWidth: 0 },
  exitFullBtn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  fullAlert: { position: 'absolute', left: 0, right: 0, zIndex: 20 },
  mapArea: { flex: 1, minHeight: 0, position: 'relative' },
  mapCanvasWrapper: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 },
  mapOverlay: { position: 'absolute', top: 8, left: 8, right: 8, gap: 8, zIndex: 10 },
  mapTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  mapSecondRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  flex1: { flex: 1 },
  roundBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosBtn: { backgroundColor: COLORS.dangerStrong, borderColor: COLORS.dangerStrong },
  sosGlyph: { color: COLORS.onFill, fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  speedGauge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedValue: { color: COLORS.text, fontSize: 16, fontWeight: '900', lineHeight: 18 },
  speedUnit: { color: COLORS.textMuted, fontSize: 9, fontWeight: '700' },
  rail: { gap: 8 },
  layers: {
    position: 'absolute',
    top: 0,
    right: 56,
    width: 212,
    zIndex: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingVertical: 4,
  },
  layerRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  layerLabel: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: '600' },
  layerState: { color: COLORS.textMuted, fontSize: 13, fontWeight: '800' },
  layerStateOn: { color: COLORS.accent },

  /* The reference's dark translucent overlay; it sits clear of the rail and
     above the OSM attribution line, which must stay readable. */
  summary: {
    position: 'absolute',
    left: 8,
    bottom: 22,
    zIndex: 10,
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
    backgroundColor: COLORS.imageCaption,
  },
  summaryGuiding: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  flexShrink: { flexShrink: 1 },
  summaryTitle: { color: COLORS.onPhoto, fontSize: 14, fontWeight: '800', lineHeight: 18 },
  summaryLine: { color: COLORS.onPhoto, fontSize: 12, lineHeight: 16 },
  summaryEvidence: { color: COLORS.onPhoto, fontSize: 12, fontWeight: '700' },
  navChip: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.success,
    backgroundColor: COLORS.successSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  navChipOff: { backgroundColor: COLORS.surfaceRaised, borderColor: COLORS.textDim },
  navChipWarn: { backgroundColor: COLORS.warningSoft, borderColor: COLORS.warning },
  navChipText: { color: COLORS.text, fontSize: 11, fontWeight: '800' },
  navChipWarnText: { color: COLORS.warning },

  /* --- CTA: driver_02's full pill (76 device px) ------------------------ */
  ctaBlock: { marginTop: 10, marginHorizontal: 13, gap: 6 },
  cta: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 18,
    borderRadius: 26,
    backgroundColor: COLORS.primary,
  },
  ctaOff: { backgroundColor: COLORS.primaryDisabled, opacity: 0.5 },
  ctaText: { flexShrink: 1, color: COLORS.onPrimary, fontSize: 16, fontWeight: '800' },
  ctaNote: { color: COLORS.textMuted, fontSize: 13, lineHeight: 18, paddingHorizontal: 6 },

  /* --- Quick actions: four cards, gap 8, radius 12 ---------------------- */
  quick: { flexDirection: 'row', gap: 8, marginTop: 10, marginHorizontal: 13 },
  quickCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 84,
    gap: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  quickCardOn: { borderColor: COLORS.accent },
  quickGrid: { flexWrap: 'wrap' },
  quickCardGrid: { flexBasis: '46%', flexGrow: 1 },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  quickTitle: { flex: 1, color: COLORS.text, fontSize: 13, fontWeight: '700' },
  quickSub: { color: COLORS.textMuted, fontSize: 11 },

  /* --- Route information: title row, four tiles ------------------------ */
  infoCard: {
    marginTop: 10,
    marginHorizontal: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    padding: 12,
  },
  infoHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  infoTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  infoLink: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8 },
  infoLinkText: { color: COLORS.info, fontSize: 14, fontWeight: '700' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 0,
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceSoft,
    paddingHorizontal: 6,
    paddingVertical: 10,
  },
  tileNarrow: { flexBasis: '46%' },
  tileValue: { color: COLORS.text, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  tileSub: { color: COLORS.textMuted, fontSize: 11, textAlign: 'center' },

  /* --- Guidance (replaces the quick actions while a trip runs) ---------- */
  guidance: { marginTop: 10, marginHorizontal: 13, gap: 8 },
  // In the map's top row, between back and SOS.
  maneuverInMap: { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 8 },
  maneuverCard: {
    backgroundColor: COLORS.route,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  maneuverMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  maneuverIcon: { width: 40, alignItems: 'center', justifyContent: 'center' },
  maneuverText: { flex: 1, minWidth: 0 },
  maneuverDistance: { color: COLORS.onFill, fontSize: 26, fontWeight: '900', lineHeight: 30 },
  maneuverInstruction: { color: COLORS.onFill, fontSize: 16, fontWeight: '700' },
  maneuverSub: { color: COLORS.onFill, fontSize: 12, fontWeight: '600', marginTop: 2 },
  thenRow: { borderTopWidth: 1, borderTopColor: COLORS.onFill, paddingTop: 6 },
  thenText: { color: COLORS.onFill, fontSize: 13, fontWeight: '700' },
  etaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 8,
  },
  etaCell: { flex: 1, alignItems: 'center', minWidth: 0 },
  etaValue: { color: COLORS.text, fontSize: 17, fontWeight: '900' },
  etaLabel: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'center' },

  /* --- Personal Route AI ---------------------------------------------- */
  aiCard: {
    marginTop: 10,
    marginHorizontal: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 10,
    gap: 4,
  },
  aiHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aiEyebrow: { color: COLORS.brand, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  detailsBtn: { minHeight: 48, minWidth: 72, justifyContent: 'center', alignItems: 'flex-end' },
  detailsBtnText: { color: COLORS.info, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  aiRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  decisionPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.border },
  decisionOk: { backgroundColor: COLORS.successSoft, borderColor: COLORS.successBorder },
  decisionWarn: { backgroundColor: COLORS.warningSoft, borderColor: COLORS.warningBorder },
  decisionBad: { backgroundColor: COLORS.dangerSoft, borderColor: COLORS.dangerBorder },
  decisionText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  decisionTextOk: { color: COLORS.success },
  decisionTextWarn: { color: COLORS.warning },
  decisionTextBad: { color: COLORS.danger },
  aiHeadline: { flex: 1, minWidth: 0, color: COLORS.text, fontSize: 17, fontWeight: '800' },
  aiLines: { color: COLORS.text, fontSize: 13, lineHeight: 18 },
  aiFacts: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  aiFact: { color: COLORS.textMuted, fontSize: 12 },
  aiFactStrong: { color: COLORS.text, fontWeight: '800' },
  aiStamp: { color: COLORS.textFaint, fontSize: 11 },

  /* --- Details panel -------------------------------------------------- */
  details: {
    marginTop: 10,
    marginHorizontal: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  services: { gap: 8 },
  sectionTitle: { color: COLORS.brand, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 6 },
  detailLine: { color: COLORS.text, fontSize: 13, lineHeight: 18 },
  detailStamp: { color: COLORS.textFaint, fontSize: 11, lineHeight: 15 },
  tripLine: { color: COLORS.text, fontSize: 14, fontWeight: '700' },

  /* --- Scenic foot ------------------------------------------------------ */
  strip: { flexGrow: 1, minHeight: 120, marginTop: 14, overflow: 'hidden', backgroundColor: COLORS.surfaceSoft },

  /* --- Kept from the previous layout (helpers, results, sheets) ------- */
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: COLORS.surface,
  },
  placeholderTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  placeholderBody: {
    color: COLORS.textMuted,
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
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.accent,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    zIndex: 20,
    elevation: 20,
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
  sheetKind: { color: COLORS.textMuted, fontSize: 13, marginBottom: 4 },
  sheetDistance: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  sheetCaveat: {
    color: COLORS.textFaint,
    fontSize: 12,
    lineHeight: 17,
    marginVertical: 6,
  },
  sheetNoCall: { color: COLORS.textFaint, fontSize: 13, marginVertical: 8 },
  sheetConflict: {
    color: COLORS.warning,
    fontSize: 12,
    lineHeight: 17,
    marginVertical: 6,
  },
  floatingCircleBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  floatingCircleBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  floatingCircleBtnOff: { opacity: 0.6 },
  floatingCircleBtnPressed: {
    backgroundColor: COLORS.surfaceSoft,
    transform: [{ scale: 0.94 }],
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  rowLabel: { color: COLORS.textMuted, fontSize: 13, flexShrink: 0 },
  rowValue: { color: COLORS.text, fontSize: 13, flexShrink: 1, textAlign: 'right' },
  rowUnknown: { color: COLORS.textFaint, fontStyle: 'italic' },
  resultsPane: {
    maxHeight: 220,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  resultsNote: { color: COLORS.textMuted, fontSize: 12, paddingVertical: 6 },
  resultsList: { maxHeight: 130 },
  resultRow: {
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  resultRowActive: { backgroundColor: COLORS.surfaceSoft },
  resultName: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  resultMeta: { color: COLORS.textFaint, fontSize: 12, marginTop: 2 },
  sourceNote: {
    color: COLORS.textFaint,
    fontSize: 11,
    lineHeight: 15,
    paddingVertical: 8,
  },
  sourceStrip: {
    marginTop: 8,
    marginHorizontal: 13,
    borderRadius: 12,
    backgroundColor: COLORS.warningSoft,
    borderWidth: 1,
    borderColor: COLORS.warningBorder,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  sourceStripText: { color: COLORS.warning, fontSize: 12, fontWeight: '600' },
  approvedBanner: { marginTop: 10, marginHorizontal: 13, marginBottom: 0 },
  alertCard: {
    marginTop: 10,
    marginHorizontal: 13,
    padding: 12,
    borderRadius: 14,
    backgroundColor: COLORS.warningSoft,
    borderWidth: 1,
    borderColor: COLORS.warningBorder,
    gap: 3,
  },
  alertCardHigh: { backgroundColor: COLORS.dangerSoft, borderColor: COLORS.dangerBorder },
  alertTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  alertTitle: { color: COLORS.warning, fontSize: 13, fontWeight: '900', letterSpacing: 0.6, flex: 1 },
  alertTitleHigh: { color: COLORS.danger },
  alertWhere: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  alertDetail: { color: COLORS.textMuted, fontSize: 12 },
  alertEvidence: { color: COLORS.textFaint, fontSize: 11 },
  alertActions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  alertBtn: { minHeight: 48, paddingHorizontal: 14, borderRadius: 24, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, justifyContent: 'center' },
  alertBtnPrimary: { backgroundColor: COLORS.primary, borderColor: COLORS.primary, flex: 1, alignItems: 'center' },
  alertBtnText: { color: COLORS.text, fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  alertBtnTextPrimary: { color: COLORS.onPrimary },
  stopLink: { alignSelf: 'flex-start', minHeight: 48, justifyContent: 'center' },
  stopLinkText: { color: COLORS.accent, fontSize: 13, fontWeight: '800' },
  factorGrid: { marginTop: 8, gap: 3 },
  factorRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  // The name keeps its width and the state wraps beside it: a long state
  // ("Not available · no fleet on this road ...") squeezed "Fleet traffic"
  // to 21 px and broke it mid-word.
  factorName: { color: COLORS.textMuted, fontSize: 11, flexShrink: 0, maxWidth: '50%' },
  factorState: { color: COLORS.success, fontSize: 11, fontWeight: '700', flex: 1, minWidth: 0, textAlign: 'right' },
  factorStateOff: { color: COLORS.warning },
  chipBar: { flexGrow: 0 },
  chips: { flexDirection: 'row', gap: 8, paddingVertical: 6 },
  chip: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.surfaceSoft, borderColor: COLORS.accent },
  chipOff: { opacity: 0.45 },
  chipLabel: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  chipLabelActive: { color: COLORS.text },
  modeChip: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modeLabel: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  progressBarBg: {
    height: 4,
    backgroundColor: COLORS.surfaceRaised,
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
    backgroundColor: COLORS.surface,
    borderTopWidth: 2,
    borderTopColor: COLORS.danger,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    // Above the place sheet. Without these the panel rendered UNDERNEATH it
    // and only its heading was visible. `elevation` is the Android half.
    zIndex: 30,
    elevation: 30,
  },
  emergencyTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  emergencyNote: { color: COLORS.textFaint, fontSize: 12, lineHeight: 17 },
  emergencyDial: {
    minHeight: TOUCH_TARGET,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.dangerBorder,
    backgroundColor: COLORS.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  emergencyDialDigits: { color: COLORS.danger, fontSize: 22, fontWeight: '800' },
  emergencyDialLabel: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
}))
