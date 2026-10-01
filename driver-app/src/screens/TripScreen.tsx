/**
 * The driver's MAIN page: the job on offer, and the one thing to do with it.
 *
 * NO MAP HERE (LS-12 G1A). An earlier revision of this screen was map-led,
 * with the corridor filling the first viewport. The owner's flow puts the road
 * on a dedicated page instead: this page carries the request, the trip summary
 * and the vehicle status, and hands off to `MapScreen` through **Accept trip**
 * or **Resume navigation**. So nothing here fetches geometry - one fewer
 * request on the page a driver opens most often.
 *
 * ACCEPTANCE IS THE SERVER'S TO CONFIRM. `onAccept` navigates only when the
 * response comes back carrying a non-null `driver_accepted_at`. There is no
 * local "accepted" flag that could disagree with the server, so a cancelled,
 * reassigned or refused trip leaves the driver here with the real reason.
 * Navigation happens from that ACTION, never from observing state - a redirect
 * derived from the field being set would re-fire on every ten-second poll.
 *
 * ONLY LEGAL CONTROLS ARE SHOWN. `can_start`, `next_stop_id` and the stop
 * statuses all come from the server, and the server decides them with the same
 * function the write endpoints use. There is no client-side guess at what is
 * allowed, so a button that is present is a button that will work. Accepting
 * is not one of those gates: it acknowledges the job and unlocks nothing.
 *
 * TRACKING IS REPORTED HONESTLY. "Location active" means fixes are being
 * captured AND the server is accepting them. If uploads are failing the banner
 * says so, with the queue depth, rather than showing a reassuring green dot
 * over a stalled queue. A driver who believes they are being tracked when they
 * are not is worse off than one who knows they are not.
 *
 * LAYOUT (Phase B3; no own reference, so the driver system): a photo hero with
 * the driver's photo, "Trip", the greeting, name and licence, the tracker's
 * GPS chip and the theme chip (the shell header they replace), then the cards
 * riding up over its foot. Every card is one surface - a banner is never boxed
 * inside a card. The page is ONE scroll whose children are all direct, so the
 * stop-request row's layout y is its scroll offset (Safety's jump lands on it).
 */

import { makeRequestId } from '../api/requestId'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import {
  api,
  type ActiveEmergency,
  type CurrentAssignment,
  type CurrentTrip,
  type DriverCheckResponse,
  type RouteProgress,
  type TripStop,
} from '../api/client'
import { Linking } from 'react-native'

import { useAuth } from '../auth/AuthProvider'
import { Banner, Button, ConfirmSheet, Field, Loading, Row, errorMessage } from '../components/ui'
import { BorderAdvisoryBanner } from '../components/borderAdvisory'
import { PHOTOS } from '../components/photoCredits'
import { IconDisc, ScreenHero, StatusPill, emergencyNumberLook, type Tone } from '../components/scenic'
import { emergencyNumbers } from '../safety/guide'
import { useGuidanceClock } from '../map/useGuidanceClock'
import { judgeFix } from '../map/locationLabel'
import { resolveLanguage } from '../i18n/language'
import {
  formatDistanceKm,
  formatMinutes,
  offRouteDetail,
} from './progressFormat'
import { translateReasonCode } from '../i18n/reasonCodes'
import { useRouteRisk } from '../hooks/useRouteRisk'
import { routeAiCard } from '../navigation/routeAi'
import { makeStyles, useTheme } from '../theme-context'
import { Icon, STATUS_ICON } from '../components/icons'
import { TOUCH_TARGET } from '../theme'
import { useT } from '../i18n/tx'
import { useTrip, type TripContextValue } from '../trip/TripProvider'
import { justDelivered, rerouteJustApproved } from '../trip/tripNotices'

/** Where a stop is, in the words the trip card uses: its address, else its name. */
const placeOf = (stop: TripStop) => stop.address ?? stop.name ?? stop.kind

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return `${Math.round(seconds)}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  return `${Math.round(seconds / 3600)} h ago`
}

/** The trip's status as a pill, by the hue rule: green only for a trip that is
 *  moving or done, amber delayed, red incident, neutral for everything that is
 *  waiting on someone. The word always says it. */
const STATUS_TONE: Record<string, Tone> = { ACTIVE: 'action', DELIVERED: 'action', DELAYED: 'caution', INCIDENT: 'emergency' }

/**
 * Progress along the PLANNED route.
 *
 * Every figure here is null when it cannot be worked out, and each renders as
 * a word rather than a zero: a truck that has sent no position has not
 * arrived, and "0 km left" on a driver's screen at the start of a shift is a
 * lie the app would be telling by itself.
 *
 * NOTHING HERE IS AN ARRIVAL TIME. The remaining figure is the distance left
 * at the average speed the routing provider's own numbers imply, and it is
 * labelled with that assumption in the same block. A driver who reads it as an
 * ETA will be late; one who reads "at planned pace" knows what it is worth.
 */
function ProgressCard({ progress }: { progress: RouteProgress }) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  const offRoute = progress.on_route === false
  // Resolved per render rather than held in state: it is a device setting a
  // driver can change from outside the app, and reading it is free.
  const language = resolveLanguage()

  return (
    <View>
      {/* Stated first and in words, because it is the fact that decides
          whether anything below it means anything. Never colour alone. A
          line with its icon, not a boxed banner inside this card. */}
      {offRoute ? (
        <View style={styles.inlineAlert} accessibilityRole="alert">
          <Icon name="alert-triangle" size={18} color={COLORS.warning} />
          <View style={styles.inlineAlertText}>
            <Text style={styles.inlineAlertTitle}>{t('Off the planned route')}</Text>
            {offRouteDetail(progress.off_route_m) ? (
              <Text style={styles.cardNote}>{t(offRouteDetail(progress.off_route_m) ?? '')}</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Formatted through progressFormat, not inline. That module is where
          "null is a word, never a number" is enforced and tested - the backend
          sends null rather than 0 when a figure cannot be computed, and a
          screen that rendered it as "0.0 km" would undo all of that care on
          the one display the driver cannot check. */}
      <Row
        label="Distance left"
        value={formatDistanceKm(progress.remaining_distance_km)}
      />
      <Row
        label="Travelled"
        value={formatDistanceKm(progress.travelled_distance_km)}
      />
      <Row
        label="At planned pace"
        value={formatMinutes(progress.remaining_at_planned_pace_min)}
      />

      {/* The server's reason codes, rendered in the driver's language from a
          file shipped inside the app. No model, no network call - which is the
          whole point of the backend never sending a sentence. Codes this build
          does not recognise fall back to themselves rather than vanishing. */}
      {progress.reason_codes.length > 0 ? (
        <View style={styles.reasons}>
          {progress.reason_codes.map((code) => (
            <Text key={code} style={styles.reason}>
              {translateReasonCode(code, language)}
            </Text>
          ))}
        </View>
      ) : null}

      <Text style={styles.cardNote}>
        Time left assumes the planned average speed. It is not an arrival time —
        it allows for no traffic, no stops and no break.
      </Text>
    </View>
  )
}

function StopRow({ stop, isNext }: { stop: TripStop; isNext: boolean }) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const tone =
    stop.status === 'COMPLETED'
      ? COLORS.success
      : stop.status === 'ARRIVED'
        ? COLORS.warning
        : isNext
          ? COLORS.text
          : COLORS.textFaint

  return (
    <View style={styles.stopRow}>
      <View style={[styles.stopMarker, { borderColor: tone }]}>
        <Text style={[styles.stopMarkerText, { color: tone }]}>
          {stop.sequence + 1}
        </Text>
      </View>
      <View style={styles.stopBody}>
        <Text style={[styles.stopName, { color: tone }]}>
          {stop.name ?? stop.kind}
        </Text>
        {stop.address ? (
          // Up to four lines: under large text two cut the PIN code and the
          // state (AUD2-02, WCAG 1.4.4).
          <Text style={styles.stopAddress} numberOfLines={4}>
            {stop.address}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.stopStatus, { color: tone }]}>
        {stop.status === 'PENDING' && isNext ? 'NEXT' : stop.status}
      </Text>
    </View>
  )
}

/**
 * A card the driver can fold. The header is a full-width 48 dp target and
 * always states what is inside; a `summary` keeps the one figure that mattered
 * visible while it is closed - folding a section must not hide the fact it
 * was carrying. The body sits in the same card, never in a card of its own.
 */
function Section({
  title,
  summary,
  children,
  initiallyOpen = false,
}: {
  title: string
  summary?: string
  children: React.ReactNode
  initiallyOpen?: boolean
}) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        // react-native-web reads the aria-* form; native reads both.
        aria-expanded={open}
        accessibilityLabel={`${t(title)}${summary ? `, ${t(summary)}` : ''}`}
        style={styles.sectionHeader}
      >
        {/* The summary under the title, not beside it: beside it, a long
            title at a large font scale left the summary a word's width. */}
        <View style={styles.sectionHeadText}>
          <Text style={styles.cardTitle}>{t(title)}</Text>
          {summary ? (
            <Text style={styles.sectionSummary} numberOfLines={2}>
              {t(summary)}
            </Text>
          ) : null}
        </View>
        {/* The chevron carries no meaning on its own - the accessible state
            above is what a screen reader uses. */}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  )
}

function SentinelCheckInCard({
  emergency,
  onCheckIn,
  busy,
}: {
  emergency: ActiveEmergency
  onCheckIn: (response: DriverCheckResponse) => Promise<void>
  busy: boolean
}) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  if (emergency.state === 'SOS_ESCALATED') {
    // The driver's own stop request, not Sentinel's; the briefing's position
    // is null when neither the phone nor telemetry had one.
    const brief = emergency.briefing_snapshot as { driver_request?: unknown; location?: { lat?: number | null } } | null | undefined
    if (brief?.driver_request) {
      return (
        <Banner
          tone="bad"
          title="SOS sent: your manager has been alerted"
          // t() here as well as in Banner: it puts both wordings where the
          // phrase-coverage test reads them, and Banner's own t() leaves an
          // already-translated string as it is.
          detail={t(
            brief.location?.lat != null
              ? 'Your manager sees your reason and your last known GPS position. If you are in danger, call 112 now.'
              : 'Your manager sees your reason. No position was available to send. If you are in danger, call 112 now.',
          )}
          style={styles.flush}
        />
      )
    }
    return (
      <Banner
        tone="bad"
        title="Fleet Sentinel: SOS Escalated"
        detail="Emergency alert transmitted to manager operations desk with your last known GPS fix. If you are in danger, call 112 now."
        style={styles.flush}
      />
    )
  }

  if (emergency.state === 'DRIVER_RESPONDED') {
    return (
      <Banner
        tone="warn"
        title="Safety Check Received"
        detail={`${t('Status recorded')}: ${(emergency.driver_response ?? 'Acknowledged').replace(/_/g, ' ')}. ${t('Manager operations desk has been notified.')}`}
        style={styles.flush}
      />
    )
  }

  if (emergency.state !== 'DRIVER_CHECK_REQUIRED') {
    return null
  }

  // One amber card: the question and its six answers, no banner boxed inside.
  return (
    <View style={[styles.card, styles.checkCard]} accessibilityRole="alert">
      <View style={styles.cardHead}>
        <IconDisc icon="alert-triangle" tone="caution" size={44} />
        <View style={styles.cardHeadText}>
          <Text style={[styles.cardTitle, styles.warnText]}>{t('Fleet Sentinel Safety Check')}</Text>
          <Text style={styles.cardBody}>
            {t('Stationary outside an approved stop for over 60 minutes. Please confirm your status to avoid automatic dispatch escalation.')}
          </Text>
        </View>
      </View>
      <Text style={styles.checkInPrompt}>{t('Select your current status:')}</Text>
      <View style={styles.checkInButtonGrid}>
        <Pressable
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="I am safe, routine pause"
          style={[styles.checkInBtn, styles.checkInBtnSafe]}
          onPress={() => void onCheckIn('I_AM_SAFE')}
        >
          <Icon name="check-circle" size={18} color={COLORS.success} />
          <Text style={styles.checkInBtnTextSafe}>I Am Safe / Routine Pause</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Traffic congestion"
          style={styles.checkInBtn}
          onPress={() => void onCheckIn('TRAFFIC')}
        >
          <Text style={styles.checkInBtnText}>{t('Traffic Congestion')}</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Rest or meal stop"
          style={styles.checkInBtn}
          onPress={() => void onCheckIn('REST_STOP')}
        >
          <Text style={styles.checkInBtnText}>{t('Rest / Meal Stop')}</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Breakdown or flat tyre"
          style={styles.checkInBtn}
          onPress={() => void onCheckIn('MECHANICAL_BREAKDOWN')}
        >
          <Text style={styles.checkInBtnText}>{t('Breakdown / Flat Tyre')}</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Landslide or weather block"
          style={styles.checkInBtn}
          onPress={() => void onCheckIn('WEATHER_LANDSLIDE')}
        >
          <Text style={styles.checkInBtnText}>{t('Landslide / Weather Block')}</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Need help, escalate now"
          style={[styles.checkInBtn, styles.checkInBtnSos]}
          onPress={() => void onCheckIn('NEED_HELP')}
        >
          <Icon name="alert-triangle" size={18} color={COLORS.danger} />
          <Text style={styles.checkInBtnTextSos}>{t('NEED HELP / ESCALATE NOW')}</Text>
        </Pressable>
      </View>
    </View>
  )
}


/** Distance / ETA / truck, and an honest blank when the server has no figure.
 *  `progress` is null until a manager selects a route, so these read
 *  "Unavailable" rather than 0 km - a zero is a measurement, not a gap. */
function TripMetrics({ trip }: { trip: CurrentTrip }) {
  const styles = useStyles()
  const t = useT()
  const km = trip.progress?.remaining_distance_km
  const min = trip.progress?.remaining_at_planned_pace_min
  const cells: Array<[string, string]> = [
    // An em dash, not a word: "Unavailable" broke mid-word inside a 66pt
    // column on 360pt screens, which reads as a bug rather than a blank.
    [t('REMAINING'), km == null ? '—' : `${km.toFixed(0)} km`],
    // Not "ETA": the figure is distance at the planned pace, which the Route
    // Progress note says is not an arrival time (B3D-R14).
    [t('At planned pace').toUpperCase(), min == null ? '—' : min >= 60 ? `${Math.floor(min / 60)} h ${Math.round(min % 60)} m` : `${Math.round(min)} min`],
    [t('Truck').toUpperCase(), trip.truck.registration_number],
  ]
  return (
    <View style={styles.metricRow}>
      {cells.map(([label, value]) => (
        <View key={label} style={styles.metricCell}>
          {/* Two lines rather than an ellipsis for a long translation: a
              clipped label reads as a bug. */}
          <Text style={styles.metricLabel} numberOfLines={2}>{label}</Text>
          <Text style={styles.metricValue} numberOfLines={2}>{value}</Text>
        </View>
      ))}
    </View>
  )
}

/** Stop progress, driven by each stop's real status - never a decorative bar.
 *  State is carried by the label AND the dot, so it survives a colour-vision
 *  deficiency and a sunlit windscreen. */
function TripStepper({ trip }: { trip: CurrentTrip }) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  return (
    <View style={styles.stepper}>
      {trip.stops.map((stop, i) => {
        // ARRIVED is not done: the driver is at the stop and still has to finish it.
        const done = stop.status === 'COMPLETED'
        const current = stop.id === trip.next_stop_id
        return (
          <View key={stop.id} style={styles.stepCell}>
            <View style={styles.stepLine}>
              <View style={[styles.stepDot, done && styles.stepDotDone, current && styles.stepDotNow]}>
                {done ? <Icon name="check" size={12} color={COLORS.onPrimary} /> : null}
              </View>
              {i < trip.stops.length - 1 ? (
                <View style={[styles.stepBar, done && styles.stepBarDone]} />
              ) : null}
            </View>
            <Text style={[styles.stepLabel, current && styles.stepLabelNow]} numberOfLines={1}>
              {stop.kind === 'PICKUP' ? 'Pickup' : stop.kind === 'DROPOFF' ? 'Deliver' : stop.name ?? `Stop ${i + 1}`}
            </Text>
            <Text style={styles.stepState} numberOfLines={1}>
              {done ? 'Done' : current ? 'Current' : 'Upcoming'}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

/** The CURRENT TRIP card: code, status, corridor, metrics, steps. */
function CurrentTripCard({ trip }: { trip: CurrentTrip }) {
  const styles = useStyles()
  const t = useT()
  const from = trip.stops[0]?.address ?? trip.stops[0]?.name ?? 'Unavailable'
  const to = trip.stops.at(-1)?.address ?? trip.stops.at(-1)?.name ?? 'Unavailable'
  // The title is the place a driver says ("Guwahati → Shillong"); the full
  // addresses stand under PICKUP and DESTINATION, whole (AUD2-02).
  const place = (address: string) => address.split(',')[0].trim() || address
  return (
    <View style={[styles.card, styles.tripCard]} testID="current-trip-card">
      <View style={styles.tripTop}>
        <Text style={styles.eyebrow}>{t('CURRENT TRIP')}</Text>
        <StatusPill text={trip.status.replace(/_/g, ' ')} tone={STATUS_TONE[trip.status] ?? 'neutral'} />
      </View>
      {/* A driver knows this job as "Guwahati to Shillong", never as
          TRP-A8BA83FC. The code is how the office refers to it and stays
          on screen for when someone reads it out on the phone - as the
          secondary line, which is what it is. */}
      <Text style={styles.tripJourney} numberOfLines={2}>
        {place(from)} {'→'} {place(to)}
      </Text>
      <Text style={styles.tripCode}>{trip.trip_code}</Text>

      <View style={styles.corridor}>
        <View style={styles.corridorRail}>
          <View style={styles.railDotStart} />
          <View style={styles.railLine} />
          <View style={styles.railDotEnd} />
        </View>
        <View style={styles.corridorText}>
          <Text style={styles.corridorLabel}>{t('PICKUP')}</Text>
          <Text style={styles.corridorPlace} numberOfLines={4}>{from}</Text>
          <Text style={[styles.corridorLabel, styles.corridorLabelGap]}>{t('DESTINATION')}</Text>
          <Text style={styles.corridorPlace} numberOfLines={4}>{to}</Text>
        </View>
      </View>

      <TripMetrics trip={trip} />
      <RouteSummary trip={trip} />
      {trip.stops.length > 1 ? <TripStepper trip={trip} /> : null}
    </View>
  )
}

/** The same assessment the Navigate tab shows, in one line: the decision,
 *  its first reason, landslide exposure. Says "not available" rather than
 *  nothing when the server has no assessment - silence reads as "fine". */
function RouteSummary({ trip }: { trip: CurrentTrip }) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  const { risk, state } = useRouteRisk(trip.selected_route_id, trip.id)
  if (trip.selected_route_id === null) return null
  const ai = routeAiCard(risk, null, resolveLanguage())
  const text = risk === null
    ? state === 'LOADING' ? 'Route assessment loading…' : 'Route assessment not available'
    : [
        ai.headline,
        ai.lines[0],
        ai.landslide ? `landslide exposure ${ai.landslide}` : null,
        risk.official_warnings?.level === 'ACTIVE' ? `${risk.official_warnings.on_route.length} official alert${risk.official_warnings.on_route.length === 1 ? '' : 's'} on route` : null,
        risk.flood?.level === 'ELEVATED' ? 'river levels elevated' : null,
        risk.traffic && risk.traffic.status !== 'UNKNOWN' && risk.traffic.status !== 'NORMAL' ? `fleet traffic ${risk.traffic.status.toLowerCase()} ahead` : null,
      ].filter(Boolean).join(' · ')
  // Icon + word + colour for the decision, never colour alone.
  const decision = risk === null ? 'UNKNOWN' : (ai.decision ?? 'UNKNOWN')
  const tone = decision === 'CONTINUE' ? COLORS.success : decision === 'CAUTION' ? COLORS.warning : decision === 'UNKNOWN' ? COLORS.textFaint : COLORS.danger
  return (
    <View style={styles.routeSummary} testID="trip-route-summary">
      <Text style={styles.metricLabel}>{t('ROUTE')}</Text>
      <View style={styles.routeSummaryRow}>
        <Icon name={STATUS_ICON[decision] ?? 'help-circle'} size={20} color={tone} />
        <Text style={styles.routeSummaryText} numberOfLines={3}>{text}</Text>
      </View>
    </View>
  )
}

function ageLabel(ms: number): string {
  const s = Math.max(0, ms / 1000)
  return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}

/**
 * The Trip page with no trip: available, and told so with real facts only.
 * Driver and truck come from the session and the assignment; the connection
 * and last-sync rows are the provider's own poll. No ETA, route, risk or
 * destination - none exists, so none is drawn. Rendered into the page's one
 * scroll, below the hero.
 */
function NoTrip({ isStale, loadedAt, delivered, onOpenMap, onCheckTruck, onReload }: {
  isStale: boolean
  loadedAt: number | null
  /** The trip that just left this screen was delivered (RE2E-2). */
  delivered: boolean
  onOpenMap: () => void
  onCheckTruck?: () => void
  onReload: () => void
}) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  const { driver } = useAuth()
  // Ticks every few seconds so "Last sync" AGES between polls - and keeps
  // ageing when the poll is failing, which is exactly when it matters.
  const clock = useGuidanceClock()
  const [assignment, setAssignment] = useState<CurrentAssignment | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    api.myAssignment().then((a) => { if (alive) setAssignment(a) }, () => { if (alive) setAssignment(null) })
    return () => { alive = false }
  }, [loadedAt])
  const numbers = emergencyNumbers(resolveLanguage()).slice(0, 3)
  // Why the last trip left this screen. Read from the notification record,
  // so it is here whether or not a push ever reached the phone; only the
  // newest cancellation, only while it is recent enough to matter, and only
  // while no LATER trip has been heard of: every dispatch records a
  // TRIP_ASSIGNED, so a newer notice for another trip means the cancelled one
  // is not the trip that just left (a delivered trip showed an old reason).
  const [notice, setNotice] = useState<Awaited<ReturnType<typeof api.myNotices>>[number] | null>(null)
  useEffect(() => {
    let alive = true
    api.myNotices(5).then((rows) => {
      if (!alive) return
      const i = rows.findIndex((n) => n.event === 'TRIP_CANCELLED')
      const latest = rows[i]
      const superseded = rows.slice(0, i).some((n) => n.trip_id != null && n.trip_id !== latest?.trip_id)
      setNotice(latest && !superseded && Date.now() - Date.parse(latest.sent_at) < 24 * 3_600_000 ? latest : null)
    }, () => { if (alive) setNotice(null) })
    return () => { alive = false }
  }, [loadedAt])
  return (
    <>
      {notice ? <Banner tone="warn" title={t('Trip cancelled by your manager')} detail={notice.body} style={styles.flush} /> : null}
      {/* The delivery confirmed here stays said after the poll drops the
          trip; the words the delivered trip card used (RE2E-2). */}
      {delivered && !notice ? (
        <Banner tone="ok" title={t('Trip complete')} detail="Your manager can see the delivery. Location sharing has stopped." style={styles.flush} />
      ) : null}
      {/* The empty state of the system: a disc, a 16 px title, a 14 px line,
          then the two real things to do. */}
      <View style={[styles.card, styles.empty]}>
        <IconDisc icon="truck" size={56} />
        <Text style={styles.emptyTitle}>{t('No active trip')}</Text>
        <Text style={styles.emptyBody}>
          {t('Your next assigned trip will appear here automatically.')}
        </Text>
        <View style={styles.emptyActions}>
          <View style={styles.emptyAction}>
            <Button label={t('Open map')} onPress={onOpenMap} />
          </View>
          <View style={styles.emptyAction}>
            <Button label={t('Check again')} variant="secondary" onPress={onReload} />
          </View>
        </View>
      </View>
      <Section title="You" summary={driver?.full_name ?? 'Signed in'} initiallyOpen>
        <Row label={t('Driver')} value={driver?.full_name ?? 'Signed in'} />
        <Row
          label={t('Truck')}
          value={assignment === undefined ? '…' : assignment === null ? t('No truck assigned') : `${assignment.truck.registration_number} · ${assignment.verified_at ? t('verified') : t('not verified')}`}
        />
        <Row label={t('Connection')} value={isStale ? t('Reconnecting — showing last sync') : t('Connected')} />
        <Row label={t('Last sync')} value={loadedAt ? ageLabel(clock.now - loadedAt) : 'never'} />
        {assignment && !assignment.verified_at && onCheckTruck ? (
          <View style={styles.sectionAction}>
            <Button label={t('Check the truck')} variant="secondary" onPress={onCheckTruck} />
          </View>
        ) : null}
      </Section>
      <Section title="Emergency Numbers" summary={t('Tap to open the dialler')} initiallyOpen>
        {numbers.map((n) => (
          <Pressable
            key={n.number}
            onPress={() => { void Linking.openURL(`tel:${n.number}`).catch(() => {}) }}
            accessibilityRole="button"
            accessibilityLabel={`Call ${n.number}, ${n.label}`}
            style={({ pressed }) => [styles.numberRow, pressed && styles.pressed]}
          >
            {/* Safety's look for the same list: 112 and 108 red, 1033 (the
                highway helpline, not an emergency) neutral (B3D-R10). */}
            <IconDisc {...emergencyNumberLook(n.number)} size={40} />
            <View style={styles.numberText}>
              <Text style={[styles.numberDigits, n.number === '112' && styles.numberDigitsPrimary]}>{n.number}</Text>
              <Text style={styles.numberLabel} numberOfLines={2}>{n.label}</Text>
            </View>
            <Icon name="chevron-right" size={20} color={COLORS.textMuted} />
          </Pressable>
        ))}
      </Section>
    </>
  )
}

/** Mirrors the server's own floor (`driver_trips.MIN_STOP_REASON`). The
 *  backend re-checks it; this is so a driver learns before they send. */
const MIN_STOP_REASON = 12


/** The hero every state shares: "Trip", the greeting, name and licence the
 *  shell header used to carry, the driver's photo, the tracker's GPS chip and
 *  the theme chip. With a trip it is the sub-screens' compact strip, so the
 *  job and what the server asks of the driver start ~70 dp higher on the
 *  landing tab (B3D-R04); with none it keeps the full photo. The credit sits
 *  at the foot like every other hero's, with the text laid out above it
 *  (B3D-R15). */
function TripHero({ status, avatar, compact }: { status?: ReactNode; avatar?: ReactNode; compact: boolean }) {
  const t = useT()
  const { driver } = useAuth()
  const hour = new Date().getHours()
  const greeting = t(hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening')
  const name = driver?.full_name ?? 'Driver'
  const licence = driver?.licence_number
  return (
    <ScreenHero
      photo={PHOTOS.login}
      title={t('Trip')}
      // One fact per line on the full hero, so a long name never breaks the
      // greeting; two lines on the strip.
      subtitle={(compact ? [`${greeting}, ${name}`, licence] : [`${greeting},`, name, licence]).filter(Boolean).join('\n')}
      status={status}
      leading={avatar}
      themeChip
      compact={compact}
      height={compact ? 176 : 250}
      overlap={compact ? 14 : 26}
      creditAt="bottom"
    />
  )
}

export default function TripScreen({
  onOpenMap,
  onCheckTruck,
  focus = null,
  onFocused,
  status,
  avatar,
}: {
  onOpenMap: () => void
  /** Opens the assignment check the start gate asks for. */
  onCheckTruck?: () => void
  /** Scroll this control into view once it is laid out (Safety's stop-request
   *  tool): landing at the top left it under the fold. */
  focus?: 'stop-request' | null
  onFocused?: () => void
  /** The shell's GPS chip for the hero (the tracker's state). */
  status?: ReactNode
  /** The driver's photo or initials, from the shell. */
  avatar?: ReactNode
}) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  // Trip state and the GPS tracker live in TripProvider, ABOVE the tab
  // navigation - see DRV-002 documented there. This screen is now a view of
  // them, which is why it is safe to unmount when the driver opens another
  // tab: nothing that must keep running lives here any more.
  const {
    trip,
    phase,
    loadError,
    actionError,
    isBusy,
    isStale,
    loadedAt,
    load,
    act,
    tracking,
    rerouteApproved,
    delivered,
  } = useTrip()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const scroll = useRef<ScrollView>(null)
  const [isAccepting, setIsAccepting] = useState(false)
  const acceptInFlight = useRef(false)
  const activeTrip = useRef(trip?.id)
  activeTrip.current = trip?.id
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  // Local, because acceptance does not go through `act` - see `onAccept`.
  const [acceptError, setAcceptError] = useState<{
    title: string
    detail: string
  } | null>(null)
  //: Which irreversible action is waiting for its second tap, if any.
  //: One value rather than three booleans: two confirmations can never be
  //: open at once, and a single state makes that unrepresentable.
  const [confirming, setConfirming] = useState<
    'ARRIVE' | 'FINISH_STOP' | 'COMPLETE_TRIP' | 'STOP_REQUEST' | null
  >(null)
  //: The emergency reason, and the id that makes the request idempotent.
  //: The id is minted at the first Send and kept, with the reason, only
  //: until the next read of the trip: a retry after a lost response reuses
  //: it and cannot raise a second emergency. Any fresh read settles it - the
  //: server shows this request (the control disables), or it does not, and
  //: then the next press is a new emergency. Keeping an id past that could
  //: reuse one the server holds for a closed emergency, which it would drop.
  const [stopReason, setStopReason] = useState('')
  const [stopRequestId, setStopRequestId] = useState<string | null>(null)
  useEffect(() => setStopRequestId(null), [trip])
  //: Sent is the server's word, not this mount's memory: a manager's resolve
  //: or the next trip re-arms the control without the driver leaving the tab.
  const stopSent = Boolean(
    (trip?.active_emergency?.briefing_snapshot as { driver_request?: unknown } | null | undefined)?.driver_request,
  )
  const [isCheckingIn, setIsCheckingIn] = useState(false)
  const [checkInError, setCheckInError] = useState<string | null>(null)

  async function onCheckIn(response: DriverCheckResponse) {
    if (!trip?.id || isCheckingIn) return
    setIsCheckingIn(true)
    setCheckInError(null)
    try {
      await api.checkInEmergency(trip.id, response)
      await load()
    } catch (err) {
      setCheckInError(errorMessage(err).detail)
    } finally {
      setIsCheckingIn(false)
    }
  }

  // NO MAP ON THIS PAGE (LS-12 G1A). The main page carries the request, the
  // summary and the vehicle status; the road lives on `MapScreen`, opened by
  // the action below. This screen therefore fetches no geometry at all - one
  // fewer request on the page a driver opens most often.

  // Re-read the trip when the driver comes BACK to this tab.
  //
  // Before the tracker moved to TripProvider, this screen owned the fetch, so
  // unmounting and remounting it on a tab switch refreshed the trip by
  // accident - which is how a driver picked up a route change a manager made
  // while they were looking at something else.
  //
  // The provider now polls as well (LS-9), so this is no longer the only way a
  // route change arrives. It is kept because it is IMMEDIATE: coming back to
  // this tab should show the current road at once rather than up to
  // TRIP_POLL_MS later.
  //
  // `phase` distinguishes the two mounts without any new state: on the very
  // first one the provider's own load is still in flight (`loading`), and on
  // every later one it has already settled.
  useEffect(() => {
    if (phase !== 'loading') void load()
    // Mount only. Re-running this on `phase` change would refetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onPullToRefresh() {
    setIsRefreshing(true)
    await load()
    setIsRefreshing(false)
  }

  const nextStop = trip?.stops.find((s) => s.id === trip.next_stop_id) ?? null
  const inProgress = Boolean(trip?.tracking_expected)

  // `?? null` because the field is ABSENT, not null, on a server built before
  // it existed - the same shape trap `selected_route_id` fell into.
  const acceptedAt = trip?.driver_accepted_at ?? null
  // A running trip counts as accepted whatever the column says: it may predate
  // the column entirely, and a driver already on the road must not be shown an
  // "Accept trip" button for the job under their wheels.
  const isAccepted = acceptedAt !== null || inProgress

  /**
   * Accept the job, then open the map - in that order, and only that order.
   *
   * The redirect is driven by the SERVER's answer: the map opens only when the
   * response comes back carrying a non-null `driver_accepted_at`. A refused,
   * cancelled or reassigned trip therefore leaves the driver on this page with
   * the real reason showing, because there is no local "accepted" boolean that
   * could disagree with the server.
   *
   * `isAccepting` guards the double tap. The server is idempotent anyway - the
   * second call returns the first acceptance - but a driver on a slow link
   * should see one busy button, not two requests they cannot tell apart.
   *
   * Navigation happens HERE, from an action, never from observing state. A
   * redirect derived from `driver_accepted_at` being set would fire again on
   * every ten-second poll and trap the driver in the map.
   */
  async function onAccept() {
    if (trip === null || acceptInFlight.current) return
    const intentId = trip.id
    acceptInFlight.current = true
    setIsAccepting(true)
    setAcceptError(null)
    try {
      // Called directly rather than through `act`, which returns void: the
      // whole point is to read the server's answer before navigating.
      const accepted = await api.acceptTrip(trip.id)
      const refreshed = await load()
      if (!mounted.current || activeTrip.current !== intentId) return
      if (accepted.id === intentId && typeof accepted.driver_accepted_at === 'string' &&
          refreshed?.id === intentId && refreshed.driver_accepted_at != null) onOpenMap()
      else setAcceptError({ title: 'Refresh your trip', detail: 'Acceptance could not be confirmed for the current trip. Refresh before opening navigation.' })
    } catch (error) {
      // No navigation on failure. `load()` puts the screen into its true
      // current state - cancelled, reassigned, gone - and the banner says why.
      setAcceptError(errorMessage(error))
      await load()
    } finally {
      acceptInFlight.current = false
      setIsAccepting(false)
    }
  }

  const compactHero = phase !== 'loading' && phase !== 'error' && trip !== null
  const hero = (
    // Full-bleed while every card keeps the page gutter; the negative bottom
    // margin lets the first card ride up over the hero's rounded foot.
    <View style={[styles.heroBleed, compactHero && styles.heroBleedCompact]}>
      <TripHero status={status} avatar={avatar} compact={compactHero} />
    </View>
  )

  // Loading, a first-load failure and "no trip" share the hero and the one
  // scroll; only a trip gets pull-to-refresh, as before.
  if (phase === 'loading' || phase === 'error' || trip === null) {
    return (
      <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
        {hero}
        {phase === 'loading' ? (
          <View style={styles.card}>
            <Loading label="Loading your trip…" />
          </View>
        ) : phase === 'error' ? (
          <>
            <Banner {...errorMessage(loadError)} tone="bad" style={styles.flush} />
            <Button label={t('Try again')} onPress={() => void load()} />
          </>
        ) : (
          <NoTrip
            isStale={isStale}
            loadedAt={loadedAt}
            delivered={justDelivered(delivered, Date.now())}
            onOpenMap={onOpenMap}
            onCheckTruck={onCheckTruck}
            onReload={() => void load()}
          />
        )}
      </ScrollView>
    )
  }

  const requestPanel = (
    <>
        {!isAccepted ? (
          <View style={styles.card} testID="trip-request">
            <View style={styles.cardHead}>
              <IconDisc icon="inbox" tone="action" size={44} />
              <View style={styles.cardHeadText}>
                <Text style={styles.cardTitle}>{t('New Trip Request')}</Text>
                {/* The places, as on the trip card - not "Pickup → Delivery"
                    (the stops' names), which says nothing about the job
                    (B3D-R14). */}
                <Text style={styles.requestBody}>
                  {trip.stops.length > 0
                    ? `${placeOf(trip.stops[0])} → ${placeOf(trip.stops[trip.stops.length - 1])}`
                    : 'Trip details below.'}
                </Text>
              </View>
            </View>
            <Text style={styles.cardNote}>
              Accepting tells your manager you have the job. It does not start
              the trip or share your location.
            </Text>
            <View style={styles.cardAction}>
              <Button
                label={isAccepting ? '…' : t('Accept trip')}
                busy={isAccepting}
                onPress={() => void onAccept()}
              />
            </View>
          </View>
        ) : (
          <View style={styles.card} testID="trip-accepted">
            <View style={styles.cardHead}>
              <IconDisc icon="check-circle" tone="action" size={44} />
              <View style={styles.cardHeadText}>
                <Text style={styles.cardTitle}>{t('Accepted')}</Text>
                <Text style={styles.cardBody}>
                  {acceptedAt !== null
                    ? `You accepted this trip ${relativeTime(acceptedAt)}.`
                    : 'This trip is already running.'}
                </Text>
              </View>
            </View>
            <View style={styles.cardAction}>
              <Button label={t('Resume navigation')} onPress={onOpenMap} />
            </View>
          </View>
        )}
    </>
  )

  // Start is blocked: the server's reason goes in the banner above the trip
  // card AND in the line under the disabled Start.
  const blocked = trip.status === 'ASSIGNED' && !trip.can_start

  // Controls first, details after. Exactly one action is offered at a time,
  // because a driver looking at several buttons at 3am will press the wrong
  // one. Which action that is comes entirely from server state. Once the job
  // is accepted it sits above the trip card, with the prompts: under it, the
  // hero and the card filled the first screen of a 640 dp phone and "Arrived
  // at" started below it (B3D-R04).
  const actions = (
    <>
      {trip.status === 'ASSIGNED' ? (
        <>
          <Button
            label={isBusy ? '…' : t('Start trip')}
            busy={isBusy}
            disabled={!trip.can_start || isAccepting}
            onPress={() => void act(() => api.startTrip(trip.id))}
          />
          {/* A disabled Start always says why, next to it: the gate banner
              just above it when accepted, else this line - the server's
              reason, or the generic one when it gave none. */}
          {blocked && (!isAccepted || !trip.start_blocked_reason) ? (
            <Text style={styles.reasonLine}>
              {trip.start_blocked_reason ?? t('Not cleared to start yet. Pull down to check again.')}
            </Text>
          ) : null}
        </>
      ) : null}

      {inProgress && nextStop ? (
        nextStop.status === 'PENDING' ? (
          <Button
            label={isBusy ? 'Saving…' : `Arrived at ${nextStop.name ?? 'stop'}`}
            busy={isBusy}
            onPress={() => setConfirming('ARRIVE')}
          />
        ) : (
          <Button
            label={isBusy ? 'Saving…' : `Finish ${nextStop.name ?? 'stop'}`}
            busy={isBusy}
            onPress={() => setConfirming('FINISH_STOP')}
          />
        )
      ) : null}

      {inProgress && !nextStop ? (
        <Button
          label={isBusy ? '…' : t('Complete trip')}
          busy={isBusy}
          onPress={() => setConfirming('COMPLETE_TRIP')}
        />
      ) : null}
    </>
  )

  return (
    <ScrollView
      ref={scroll}
      style={styles.page}
      contentContainerStyle={styles.pageContent}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onPullToRefresh}
          tintColor={COLORS.textMuted}
        />
      }
    >
        {hero}
        {!isAccepted ? requestPanel : null}

        {/* WHAT THE SERVER ASKS OF THE DRIVER NOW, above the trip card: the
            Sentinel check (timed - it escalates by itself), the manager's
            instruction to acknowledge, and why the trip cannot start. Under
            the trip card they started below the first screen of a 640 dp
            phone (B3D-R04). */}
        {trip.active_emergency ? (
          <SentinelCheckInCard
            emergency={trip.active_emergency}
            onCheckIn={onCheckIn}
            busy={isCheckingIn}
          />
        ) : null}
        {checkInError ? (
          <Banner tone="bad" title="Check-in failed" detail={checkInError} style={styles.flush} />
        ) : null}

        {/* A manager changed a loaded trip. Said in words, with the reason,
            and acknowledged with one press - the server records "seen", so
            the manager knows this reached the cab and not only the network. */}
        {trip.pending_instruction ? (
          <>
            <Banner
              tone="warn"
              title={t('Journey updated by your manager')}
              detail={`${
                trip.pending_instruction.instruction === 'RETURN_TO_DEPOT'
                  ? t('Return to depot')
                  : trip.pending_instruction.instruction === 'NEW_DESTINATION'
                    ? `${t('New destination')}: ${trip.pending_instruction.new_destination ?? ''}`
                    : trip.pending_instruction.instruction === 'ADD_STOP'
                      ? t('A stop was added to your journey. Open Trip to see the order of stops.')
                      : t('Hold for instruction')
              }${trip.pending_instruction.reason ? ` — ${trip.pending_instruction.reason}` : ''}`}
              style={styles.flush}
            />
            <Button
              label={t('Acknowledge')}
              busy={isBusy}
              onPress={() => void act(() => api.acknowledgeInstruction(trip.pending_instruction!.event_id))}
            />
          </>
        ) : null}

        {/* A break the driver started on the map: said here too, so the Trip
            tab never looks like a normal running trip while the truck rests. */}
        {trip.active_break ? (
          <>
            <Banner
              tone={trip.active_break.status === 'OVERDUE' ? 'warn' : 'ok'}
              title={trip.active_break.status === 'OVERDUE' ? t('Break overran') : t('On break')}
              detail={`${trip.active_break.planned_minutes} min · ${t('back by')} ${new Date(trip.active_break.expected_end_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
              style={styles.flush}
            />
            <Button
              label={t('Resume driving')}
              busy={isBusy}
              onPress={() => void act(() => api.resumeBreak(trip.active_break!.id))}
            />
          </>
        ) : null}

        {blocked && trip.start_blocked_reason ? (
          <Banner
            tone="warn"
            title={t('Cannot start yet')}
            detail={trip.start_blocked_reason}
            style={styles.flush}
          />
        ) : null}
        {/* The gate names the check; the button opens it. Without this the
            check screen existed but nothing on the phone led to it. */}
        {blocked && trip.start_blocked_code === 'ASSIGNMENT_NOT_VERIFIED' && onCheckTruck ? (
          <Button label={t('Check the truck')} variant="secondary" onPress={onCheckTruck} />
        ) : null}
        {isAccepted ? actions : null}

        <CurrentTripCard trip={trip} />

        {/* Official border status, only as the server sends it. */}
        <BorderAdvisoryBanner advisory={trip.border_advisory} />

        {actionError ? <Banner tone="bad" {...actionError} style={styles.flush} /> : null}
        {acceptError ? <Banner tone="bad" {...acceptError} style={styles.flush} /> : null}

        {/* A background refresh failed. What is below is real but may no
            longer be current, which is a different thing from an error -
            so it says so rather than blanking the trip. */}
        {isStale ? (
          <Banner
            tone="warn"
            title={t('Not up to date')}
            detail="Could not reach the server on the last check. This is the last information received — pull down to try again."
            style={styles.flush}
          />
        ) : null}

        {/* The manager took a new road for this trip (FV-E2E-2). */}
        {rerouteJustApproved(rerouteApproved, trip, Date.now()) ? (
          <Banner
            tone="ok"
            title={t('Reroute approved')}
            detail={t('Your manager approved a new road. Open Navigate to follow it.')}
            style={styles.flush}
          />
        ) : null}

        {trip.status === 'DELIVERED' ? (
          <Banner
            tone="ok"
            title={t('Trip complete')}
            detail="Your manager can see the delivery. Location sharing has stopped."
            style={styles.flush}
          />
        ) : null}

        {/* Location status. Never claims to be working when it is not. */}
        {inProgress ? (
          <TrackingBanner tracking={tracking} freshMs={(trip.tracking?.fresh_seconds ?? 60) * 1000} />
        ) : null}

        {/* Not accepted yet: Accept is at the top, so Start waits here,
            under the trip card, rather than beside it. */}
        {!isAccepted ? actions : null}

        {/* THE REQUEST, AND THE ONE THING TO DO WITH IT.

            Accept while the server says this driver has not acknowledged the
            job (at the top); Resume once it says they have. `isAccepted` also
            treats a running trip as accepted - starting is a stronger act than
            acknowledging, and a driver mid-journey must never be asked to
            accept the job they are already driving. Delivered: the journey is
            over, so there is nothing to resume. */}
        {isAccepted && trip.status !== 'DELIVERED' ? requestPanel : null}

        {/* One sheet, three irreversible actions. Each says what it will
            actually record, because "Are you sure?" transfers nothing and
            gets dismissed as fast as the button it guards. */}
        <ConfirmSheet
          visible={confirming === 'ARRIVE'}
          title="Confirm arrival"
          detail={`This records that the truck has reached ${nextStop?.name ?? 'this stop'}. Your manager sees it immediately.`}
          confirmLabel="Yes, I have arrived"
          busy={isBusy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const stop = nextStop
            setConfirming(null)
            if (stop) void act(() => api.arriveAtStop(stop.id))
          }}
        />
        <ConfirmSheet
          visible={confirming === 'FINISH_STOP'}
          title="Confirm this stop is finished"
          detail={`This closes ${nextStop?.name ?? 'this stop'}${
            nextStop && nextStop.id === trip.stops[trip.stops.length - 1]?.id
              ? '. It is the last stop: confirm the delivery next to end the trip.'
              : ' and moves the trip to the next one.'
          } It cannot be reopened from the phone.`}
          confirmLabel="Yes, finished here"
          busy={isBusy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const stop = nextStop
            setConfirming(null)
            if (stop) void act(() => api.completeStop(stop.id))
          }}
        />
        {/* ISSUE 11. Below the ordinary actions, with the emergency edge: it is
            the thing a driver reaches for when something is wrong, not a
            button to brush past. A direct child of the scroll, so its layout y
            is the offset Safety's stop-request tool jumps to. */}
        {inProgress ? (
          <View
            style={styles.emergencyRow}
            testID="stop-request-row"
            onLayout={(e) => {
              if (focus !== 'stop-request') return
              // Not animated: a jump respects reduced motion. The margin keeps
              // the trip context above the control in view.
              scroll.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 120), animated: false })
              onFocused?.()
            }}
          >
            <View style={styles.cardHead}>
              <IconDisc icon="alert-octagon" tone="emergency" size={40} />
              <Text style={[styles.cardBody, styles.cardHeadText]}>
                {t('Alerts your manager at once. It does not cancel the trip.')}
              </Text>
            </View>
            <Button
              label={stopSent ? 'Stop requested — manager alerted' : 'Emergency: request trip stop'}
              variant="secondary"
              disabled={stopSent}
              onPress={() => {
                if (!stopRequestId) setStopReason('')
                setConfirming('STOP_REQUEST')
              }}
            />
          </View>
        ) : null}

        <ConfirmSheet
          visible={confirming === 'STOP_REQUEST'}
          tone="danger"
          title="Request a stop"
          detail="This does not cancel the trip. Your manager is alerted immediately, sees your reason, and can call you. Say what is wrong."
          confirmLabel="Send request"
          busy={isBusy}
          // Not sendable until the reason is long enough, and it LOOKS it: an
          // enabled Send that did nothing was a tap lost in an emergency
          // (B3D-R05). The hint under the field says why. Once the server
          // shows the request, Send only closes the sheet.
          confirmDisabled={!stopSent && stopReason.trim().length < MIN_STOP_REASON}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            // The server already shows this driver's request (a read landed
            // while the sheet was open): a second send would be a second SOS.
            if (stopSent) return setConfirming(null)
            const reason = stopReason.trim()
            if (reason.length < MIN_STOP_REASON) return
            const id = stopRequestId ?? makeRequestId()
            setStopRequestId(id)
            // The phone's fix only while the map would call it live: a cached
            // or old one would send the manager to where the truck was.
            const fix = tracking.lastPosition
            const { live } = judgeFix({
              permission: tracking.permission,
              watching: tracking.isTracking,
              platformPermission: null,
              fix,
              now: Date.now(),
              freshMs: (trip.tracking?.fresh_seconds ?? 60) * 1000,
            })
            // With the fix's own time, so the manager's dossier ages it from
            // when the phone took it, not from when the request arrived.
            const position = live && fix ? { lat: fix.lat, lon: fix.lon, fixAt: new Date(fix.at).toISOString() } : {}
            setConfirming(null)
            void act(() => api.requestTripStop({ requestId: id, reason, ...position }))
          }}
        >
          <Field
            label="What is wrong?"
            value={stopReason}
            onChangeText={setStopReason}
            placeholder="Rock fall across the road just past the bridge"
            multiline
            maxLength={500}
            hint={
              stopReason.trim().length < MIN_STOP_REASON
                ? `At least ${MIN_STOP_REASON} characters — your manager reads this before they call.`
                : undefined
            }
          />
        </ConfirmSheet>

        <ConfirmSheet
          visible={confirming === 'COMPLETE_TRIP'}
          title="Confirm delivery"
          detail="This ends the trip and reports the load as delivered. It cannot be undone from the phone."
          confirmLabel="Yes, delivery complete"
          busy={isBusy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null)
            void act(() => api.completeTrip(trip.id))
          }}
        />

        {/* Everything that used to fill this screen, kept in full and folded
            away. Nothing here was deleted to make room for the map. */}
        <Section
          title="Stops"
          summary={`${trip.stops.filter((s) => s.status === 'COMPLETED').length} / ${trip.stops.length}`}
          initiallyOpen
        >
          {trip.stops.map((stop) => (
            <StopRow
              key={stop.id}
              stop={stop}
              isNext={stop.id === trip.next_stop_id}
            />
          ))}
        </Section>

        {trip.progress ? (
          <Section
            title="Route Progress"
            // Off route is in the folded summary too: the section starts
            // closed, and "98.8 km remaining" hid the one fact that mattered
            // (B3D-R14).
            summary={`${trip.progress.on_route === false ? `${t('Off the planned route')} · ` : ''}${formatDistanceKm(trip.progress.remaining_distance_km)} ${t('remaining')}`}
          >
            <ProgressCard progress={trip.progress} />
          </Section>
        ) : null}

        <Section title="Truck" summary={trip.truck.registration_number}>
          <Text style={styles.registration}>
            {trip.truck.registration_number}
          </Text>
          <Row label="Dispatched" value={relativeTime(trip.dispatched_at)} />
          {trip.started_at ? (
            <Row label="Started" value={relativeTime(trip.started_at)} />
          ) : null}
          {/* Route length lived here while this page fetched geometry. It
              does not any more - the corridor belongs to the Map page, and
              re-fetching a package on the main page just to print one number
              would undo the request this restructure saved. */}
        </Section>

        {/* The same state as the banner at the top, never its contradiction
            (RC-DRV-07): "is shared" under "Location not reaching the server". */}
        <Text style={styles.note}>
          {!inProgress || tracking.permission === 'denied' || tracking.permission === 'unavailable'
            ? t('Your location is not being shared.')
            : tracking.uploadState === 'failing'
              ? t('Your location has not reached your fleet manager yet. It is sent as soon as the connection returns, and sharing stops when the trip is complete.')
              : t('Your location is shared with your fleet manager while this trip is running. It stops when the trip is complete.')}
        </Text>
    </ScrollView>
  )
}

/**
 * Tracking status, stated plainly.
 *
 * The distinction that matters: capturing fixes and delivering them are
 * different things, and only the second one puts a truck on a manager's screen.
 * "Location active" also needs a FRESH fix, judged by the same rule as the
 * hero's GPS chip: a green banner under a chip reading "Last known · 2 min"
 * told the driver two different things (B3D-R14).
 */
function TrackingBanner({
  tracking,
  freshMs,
}: {
  tracking: TripContextValue['tracking']
  freshMs: number
}) {
  const styles = useStyles()
  const t = useT()
  const clock = useGuidanceClock()
  if (tracking.permission === 'denied') {
    return (
      <View style={styles.group}>
        <Banner
          tone="warn"
          title="Location permission needed"
          detail="Your manager cannot see where this truck is, and your position will not appear on the map. Your route is still correct — you can grant permission at any time."
          style={styles.flush}
        />
        <Button
          label="Allow location"
          variant="secondary"
          onPress={tracking.requestPermission}
        />
      </View>
    )
  }

  if (tracking.permission === 'unavailable') {
    return (
      <Banner
        tone="warn"
        title="Location unavailable"
        detail={
          tracking.lastError ??
          t('Location services are switched off on this device. Turn them on to share your position.')
        }
        style={styles.flush}
      />
    )
  }

  if (
    tracking.permission === 'requesting' ||
    tracking.permission === 'unknown'
  ) {
    return <Banner tone="warn" title="Checking location permission…" style={styles.flush} />
  }

  if (tracking.uploadState === 'failing') {
    return (
      <Banner
        tone="bad"
        title="Location not reaching the server"
        detail={`${tracking.queueDepth} ${t(tracking.queueDepth === 1 ? 'fix waiting. Retrying automatically' : 'fixes waiting. Retrying automatically')} — ${
          tracking.lastError ?? t('no connection')
        }`}
        style={styles.flush}
      />
    )
  }

  if (!tracking.isTracking) {
    return <Banner tone="warn" title="Starting location…" style={styles.flush} />
  }

  const sent = `${t('Last sent')} ${
    tracking.lastAcceptedAt
      ? relativeTime(tracking.lastAcceptedAt.toISOString())
      : t('not yet')
  }${tracking.queueDepth ? ` · ${tracking.queueDepth} ${t('queued')}` : ''}`
  const fix = judgeFix({
    permission: tracking.permission,
    watching: tracking.isTracking,
    platformPermission: clock.platformPermission,
    fix: tracking.lastPosition,
    now: clock.now,
    freshMs,
  }, t)
  if (!fix.live) {
    return <Banner tone="warn" title="No fresh GPS fix" detail={`${fix.chip.text} · ${sent}`} style={styles.flush} />
  }

  return <Banner tone="ok" title="Location active" detail={sent} style={styles.flush} />
}

const useStyles = makeStyles((COLORS) => ({
  /* --- Page: the hero full-bleed, every card on a 13 dp gutter ---------- */
  page: { flex: 1, backgroundColor: COLORS.bg },
  // gap, not per-card margins: every child is a direct child of the scroll
  // (see the stop-request row), and one rhythm spaces them all. Banner keeps
  // its own marginBottom, so the gap is small.
  pageContent: { paddingHorizontal: 13, paddingBottom: 28, gap: 10, width: '100%', maxWidth: 700, alignSelf: 'center' },
  // -13 undoes the gutter; -36 = the 10 gap plus the hero's 26 overlap.
  heroBleed: { marginHorizontal: -13, marginBottom: -36 },
  // The compact strip's 14 overlap.
  heroBleedCompact: { marginBottom: -24 },
  // Banner's own 16 dp foot, on a page that already spaces by `gap`: the
  // gate banner sat 26 dp from its buttons.
  flush: { marginBottom: 0 },
  // A banner and the button it asks for, spaced like the page.
  group: { gap: 10 },
  pressed: { opacity: 0.75 },

  /* --- The one card geometry (Safety/More): radius 16, hairline, surface - */
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    padding: 14,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardHeadText: { flex: 1, minWidth: 0 },
  cardTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  cardBody: { color: COLORS.textMuted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  cardNote: { color: COLORS.textFaint, fontSize: 12, marginTop: 10, lineHeight: 17 },
  cardAction: { marginTop: 12 },
  warnText: { color: COLORS.warning },

  // No fixed height and no nowrap: a translated origin/destination pair runs
  // far longer than the English, and must wrap rather than clip.
  requestBody: { color: COLORS.text, fontSize: 17, fontWeight: '700', lineHeight: 23, marginTop: 2 },
  reasonLine: { color: COLORS.textMuted, fontSize: 13, lineHeight: 18, textAlign: 'center' },

  /* --- Section: a foldable card ------------------------------------------ */
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    // 48 is the driver-app floor for a tap target. See MASTER.md.
    minHeight: 48,
    marginVertical: -8,
  },
  // flexShrink so a long translated summary truncates instead of pushing the
  // chevron off the row.
  sectionHeadText: { flex: 1, minWidth: 0 },
  sectionSummary: { color: COLORS.textFaint, fontSize: 13, marginTop: 1 },
  sectionBody: { marginTop: 8 },
  sectionAction: { marginTop: 12 },

  registration: {
    color: COLORS.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 6,
  },

  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    // Above, like ui.Row, so a card never ends in a hairline (B3D-R11).
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  stopMarker: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopMarkerText: { fontSize: 12, fontWeight: '800' },
  stopBody: { flex: 1 },
  stopName: { fontSize: 15, fontWeight: '600' },
  stopAddress: { color: COLORS.textFaint, fontSize: 12, marginTop: 2 },
  stopStatus: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  /* --- No trip ------------------------------------------------------------ */
  empty: { alignItems: 'center', paddingVertical: 24 },
  emptyTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800', marginTop: 12 },
  emptyBody: {
    color: COLORS.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
    maxWidth: 320,
  },
  emptyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16, alignSelf: 'stretch' },
  emptyAction: { flexGrow: 1, flexBasis: 140 },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  numberText: { flex: 1, minWidth: 0 },
  numberDigits: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  numberDigitsPrimary: { color: COLORS.danger },
  numberLabel: { color: COLORS.textMuted, fontSize: 13, marginTop: 1 },

  note: { color: COLORS.textFaint, fontSize: 12, marginTop: 8, lineHeight: 18, paddingHorizontal: 4 },
  inlineAlert: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  inlineAlertText: { flex: 1, minWidth: 0 },
  inlineAlertTitle: { color: COLORS.warning, fontSize: 14, fontWeight: '800' },
  reasons: { marginTop: 10, gap: 4 },
  reason: { color: COLORS.textFaint, fontSize: 13, lineHeight: 18 },

  /* --- Sentinel check: one amber card ------------------------------------ */
  checkCard: { borderColor: COLORS.warningBorder },
  checkInPrompt: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 14,
    marginBottom: 10,
  },
  checkInButtonGrid: {
    gap: 8,
  },
  checkInBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceRaised,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: TOUCH_TARGET,
  },
  checkInBtnText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  // Tokens, not the dark-green / dark-red hexes these used to be: those were
  // drawn for the old night palette and painted a dark slab into Light, and a
  // green surface into Dark. Soft ground + status border + status ink reads
  // the same way in both, and the AA pairs are held by theme.contrast.test.ts.
  checkInBtnSafe: {
    backgroundColor: COLORS.successSoft,
    borderColor: COLORS.success,
  },
  checkInBtnTextSafe: {
    color: COLORS.success,
    fontWeight: '700',
  },
  checkInBtnSos: {
    backgroundColor: COLORS.dangerSoft,
    borderColor: COLORS.danger,
    marginTop: 4,
  },
  checkInBtnTextSos: {
    color: COLORS.danger,
    fontWeight: '800',
  },

  /* --- The stop request: one card with a red edge and a red disc, as
     Safety's "Need immediate help?" card - a red FIELD would hide its disc. */
  emergencyRow: {
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.dangerBorder,
    backgroundColor: COLORS.surface,
    padding: 14,
  },

  /* --- CURRENT TRIP card -------------------------------------------------- */
  tripCard: { gap: 12 },
  tripTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  eyebrow: { color: COLORS.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  tripJourney: { color: COLORS.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4, lineHeight: 28 },
  tripCode: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600', letterSpacing: 0.2, marginTop: -8 },

  // Origin/destination as one rail, so the pair reads as a corridor rather
  // than two unrelated address blocks.
  corridor: { flexDirection: 'row', gap: 12 },
  corridorRail: { alignItems: 'center', paddingTop: 4, width: 12 },
  railDotStart: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: COLORS.success },
  railLine: { flex: 1, width: 2, minHeight: 34, backgroundColor: COLORS.border, marginVertical: 2 },
  railDotEnd: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.route },
  corridorText: { flex: 1, minWidth: 0 },
  corridorLabel: { color: COLORS.textFaint, fontSize: 10, fontWeight: '800', letterSpacing: 0.9 },
  corridorLabelGap: { marginTop: 12 },
  corridorPlace: { color: COLORS.text, fontSize: 16, fontWeight: '700', marginTop: 2 },

  metricRow: {
    flexDirection: 'row',
    // Wraps rather than squeezes: on a 320pt screen the truck cell drops to
    // its own line instead of breaking a registration mid-word.
    flexWrap: 'wrap',
    rowGap: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 12,
  },
  // Sized by their content (basis auto, no shrink), so when the text is
  // large the truck cell drops to its own line instead of a registration or
  // "REMAINING" breaking mid-word (a fixed basis did both at font scale 1.3).
  metricCell: { flexGrow: 1, flexShrink: 0, flexBasis: 'auto', paddingHorizontal: 10 },
  metricLabel: { color: COLORS.textFaint, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  // 13pt, not 16: at three columns on a 390pt screen "Unavailable" was
  // truncating to "Unavaila…", which reads as a broken value rather than a
  // missing one. The label above already carries the emphasis.
  metricValue: { color: COLORS.text, fontSize: 13, fontWeight: '800', marginTop: 3 },
  routeSummary: { paddingHorizontal: 10 },
  routeSummaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 4 },
  routeSummaryText: { color: COLORS.text, fontSize: 13, fontWeight: '600', lineHeight: 18, flex: 1 },

  stepper: { flexDirection: 'row' },
  stepCell: { flex: 1, minWidth: 0 },
  stepLine: { flexDirection: 'row', alignItems: 'center' },
  stepDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  stepDotNow: { borderColor: COLORS.route, borderWidth: 3 },
  stepBar: { flex: 1, height: 2, backgroundColor: COLORS.border },
  stepBarDone: { backgroundColor: COLORS.success },
  stepLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', marginTop: 6 },
  stepLabelNow: { color: COLORS.text },
  stepState: { color: COLORS.textFaint, fontSize: 10, fontWeight: '600', marginTop: 1 },
}))
