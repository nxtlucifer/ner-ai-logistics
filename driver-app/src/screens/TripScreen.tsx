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
 */

import { useEffect, useRef, useState } from 'react'
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { api, type RouteProgress, type TripStop } from '../api/client'
import { Banner, Button, Loading, Row, errorMessage } from '../components/ui'
import { resolveLanguage } from '../i18n/language'
import {
  formatDistanceKm,
  formatMinutes,
  offRouteDetail,
} from './progressFormat'
import { translateReasonCode } from '../i18n/reasonCodes'
import { COLORS } from '../theme'
import { useTrip, type TripContextValue } from '../trip/TripProvider'

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return `${Math.round(seconds)}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  return `${Math.round(seconds / 3600)} h ago`
}

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
  const offRoute = progress.on_route === false
  // Resolved per render rather than held in state: it is a device setting a
  // driver can change from outside the app, and reading it is free.
  const language = resolveLanguage()

  return (
    <View style={styles.card}>
      {/* Stated first and in words, because it is the fact that decides
          whether anything below it means anything. Never colour alone. */}
      {offRoute ? (
        <Banner
          tone="warn"
          title="Off the planned route"
          detail={offRouteDetail(progress.off_route_m) ?? ''}
        />
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
  const tone =
    stop.status === 'COMPLETED'
      ? COLORS.ok
      : stop.status === 'ARRIVED'
        ? COLORS.warn
        : isNext
          ? COLORS.text
          : COLORS.faint

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
          <Text style={styles.stopAddress} numberOfLines={2}>
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
 * A detail panel the driver can fold away.
 *
 * Collapsed by DEFAULT so the map keeps the screen, expanded by a tap that is
 * a full-width 48px target. The header always states what is inside, and a
 * `summary` keeps the one figure that mattered visible while it is closed -
 * folding a section must not hide the fact it was carrying.
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
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <View style={styles.section}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}${summary ? `, ${summary}` : ''}`}
        style={styles.sectionHeader}
      >
        <Text style={styles.sectionTitle}>{title}</Text>
        {summary ? (
          <Text style={styles.sectionSummary} numberOfLines={1}>
            {summary}
          </Text>
        ) : null}
        {/* A caret drawn as text, not an emoji. It carries no meaning on its
            own - the accessible state above is what a screen reader uses. */}
        <Text style={styles.sectionCaret}>{open ? '–' : '+'}</Text>
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  )
}

export default function TripScreen({ onOpenMap }: { onOpenMap: () => void }) {
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
    load,
    act,
    tracking,
  } = useTrip()
  const [isRefreshing, setIsRefreshing] = useState(false)
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

  if (phase === 'loading') {
    return (
      <View style={styles.centre}>
        <Loading label="Loading your trip…" />
      </View>
    )
  }

  if (phase === 'error') {
    return (
      <View style={styles.centrePadded}>
        <Banner {...errorMessage(loadError)} tone="bad" />
        <Button label="Try again" onPress={() => void load()} />
      </View>
    )
  }

  if (trip === null) {
    return (
      <View style={styles.centrePadded}>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No trip right now</Text>
          <Text style={styles.emptyBody}>
            When your manager dispatches a trip it will appear here.
          </Text>
          <View style={styles.emptyAction}>
            <Button
              label="Check again"
              variant="secondary"
              onPress={() => void load()}
            />
          </View>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.flex}>
      <ScrollView
        style={styles.sheet}
        contentContainerStyle={styles.sheetContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onPullToRefresh}
            tintColor={COLORS.muted}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.code}>{trip.trip_code}</Text>
          <Text style={styles.status}>{trip.status.replace(/_/g, ' ')}</Text>
        </View>

        {actionError ? <Banner tone="bad" {...actionError} /> : null}
        {acceptError ? <Banner tone="bad" {...acceptError} /> : null}

        {/* A background refresh failed. What is below is real but may no
            longer be current, which is a different thing from an error -
            so it says so rather than blanking the trip. */}
        {isStale ? (
          <Banner
            tone="warn"
            title="Not up to date"
            detail="Could not reach the server on the last check. This is the last information received — pull down to try again."
          />
        ) : null}

        {trip.status === 'DELIVERED' ? (
          <Banner
            tone="ok"
            title="Trip complete"
            detail="Your manager can see the delivery. Location sharing has stopped."
          />
        ) : null}

        {/* Location status. Never claims to be working when it is not. */}
        {inProgress ? <TrackingBanner tracking={tracking} /> : null}

        {/* THE REQUEST, AND THE ONE THING TO DO WITH IT.

            Accept while the server says this driver has not acknowledged the
            job; Resume once it says they have. `isAccepted` also treats a
            running trip as accepted - starting is a stronger act than
            acknowledging, and a driver mid-journey must never be asked to
            accept the job they are already driving. */}
        {!isAccepted ? (
          <View style={styles.request}>
            <Text style={styles.endpointLabel}>PICKUP</Text>
            <Text style={styles.endpointAddress}>{trip.stops[0]?.address ?? trip.stops[0]?.name ?? 'Unavailable'}</Text>
            <Text style={styles.endpointLabel}>DESTINATION</Text>
            <Text style={styles.endpointAddress}>{trip.stops.at(-1)?.address ?? trip.stops.at(-1)?.name ?? 'Unavailable'}</Text>
            <Text style={styles.requestTitle}>New trip request</Text>
            <Text style={styles.requestBody}>
              {trip.stops.length > 0
                ? `${trip.stops[0].name ?? trip.stops[0].kind} → ${
                    trip.stops[trip.stops.length - 1].name ??
                    trip.stops[trip.stops.length - 1].kind
                  }`
                : 'Trip details below.'}
            </Text>
            <Text style={styles.requestNote}>
              Accepting tells your manager you have the job. It does not start
              the trip or share your location.
            </Text>
            <Button
              label={isAccepting ? 'Accepting…' : 'Accept trip'}
              busy={isAccepting}
              onPress={() => void onAccept()}
            />
          </View>
        ) : (
          <View style={styles.request}>
            <Text style={styles.endpointLabel}>PICKUP</Text>
            <Text style={styles.endpointAddress}>{trip.stops[0]?.address ?? trip.stops[0]?.name ?? 'Unavailable'}</Text>
            <Text style={styles.endpointLabel}>DESTINATION</Text>
            <Text style={styles.endpointAddress}>{trip.stops.at(-1)?.address ?? trip.stops.at(-1)?.name ?? 'Unavailable'}</Text>
            <Text style={styles.requestTitle}>Accepted</Text>
            <Text style={styles.requestBody}>
              {acceptedAt !== null
                ? `You accepted this trip ${relativeTime(acceptedAt)}.`
                : 'This trip is already running.'}
            </Text>
            <Button label="Resume navigation" onPress={onOpenMap} />
          </View>
        )}

        {/* Controls first, details after. Exactly one action is offered at a
            time, because a driver looking at several buttons at 3am will press
            the wrong one. Which action that is comes entirely from server
            state. */}
        {trip.status === 'ASSIGNED' ? (
          <>
            {!trip.can_start && trip.start_blocked_reason ? (
              <Banner
                tone="warn"
                title="Cannot start yet"
                detail={trip.start_blocked_reason}
              />
            ) : null}
            <Button
              label={isBusy ? 'Starting…' : 'Start trip'}
              busy={isBusy}
              disabled={!trip.can_start || isAccepting}
              onPress={() => void act(() => api.startTrip(trip.id))}
            />
          </>
        ) : null}

        {inProgress && nextStop ? (
          nextStop.status === 'PENDING' ? (
            <Button
              label={isBusy ? 'Saving…' : `Arrived at ${nextStop.name ?? 'stop'}`}
              busy={isBusy}
              onPress={() => void act(() => api.arriveAtStop(nextStop.id))}
            />
          ) : (
            <Button
              label={isBusy ? 'Saving…' : `Finish ${nextStop.name ?? 'stop'}`}
              busy={isBusy}
              onPress={() => void act(() => api.completeStop(nextStop.id))}
            />
          )
        ) : null}

        {inProgress && !nextStop ? (
          <Button
            label={isBusy ? 'Completing…' : 'Complete trip'}
            busy={isBusy}
            onPress={() => void act(() => api.completeTrip(trip.id))}
          />
        ) : null}

        {/* Everything that used to fill this screen, kept in full and folded
            away. Nothing here was deleted to make room for the map. */}
        <Section
          title="Stops"
          summary={`${trip.stops.filter((s) => s.status === 'COMPLETED').length} of ${trip.stops.length} done`}
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
            title="Route progress"
            summary={formatDistanceKm(trip.progress.remaining_distance_km) + ' left'}
          >
            <ProgressCard progress={trip.progress} />
          </Section>
        ) : null}

        <Section title="Truck" summary={trip.truck.registration_number}>
          <View style={styles.card}>
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
          </View>
        </Section>

        <Text style={styles.note}>
          {inProgress
            ? 'Your location is shared with your fleet manager while this trip is running. It stops when the trip is complete.'
            : 'Your location is not being shared.'}
        </Text>
      </ScrollView>
    </View>
  )
}

/**
 * Tracking status, stated plainly.
 *
 * The distinction that matters: capturing fixes and delivering them are
 * different things, and only the second one puts a truck on a manager's screen.
 */
function TrackingBanner({
  tracking,
}: {
  tracking: TripContextValue['tracking']
}) {
  if (tracking.permission === 'denied') {
    return (
      <View>
        <Banner
          tone="warn"
          title="Location permission needed"
          detail="Your manager cannot see where this truck is, and your position will not appear on the map. Your route is still correct — you can grant permission at any time."
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
          'Location services are switched off on this device. Turn them on to share your position.'
        }
      />
    )
  }

  if (
    tracking.permission === 'requesting' ||
    tracking.permission === 'unknown'
  ) {
    return <Banner tone="warn" title="Checking location permission…" />
  }

  if (tracking.uploadState === 'failing') {
    return (
      <Banner
        tone="bad"
        title="Location not reaching the server"
        detail={`${tracking.queueDepth} fix(es) waiting. Retrying automatically — ${
          tracking.lastError ?? 'no connection'
        }`}
      />
    )
  }

  if (!tracking.isTracking) {
    return <Banner tone="warn" title="Starting location…" />
  }

  return (
    <Banner
      tone="ok"
      title="Location active"
      detail={`Last sent ${
        tracking.lastAcceptedAt
          ? relativeTime(tracking.lastAcceptedAt.toISOString())
          : 'not yet'
      }${tracking.queueDepth ? ` · ${tracking.queueDepth} queued` : ''}`}
    />
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  centre: { flex: 1, justifyContent: 'center', backgroundColor: COLORS.bg },
  centrePadded: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: COLORS.bg,
  },

  /**
   * The map's share of the screen.
   *
   * A flex ratio rather than a pixel height, so it holds its proportion on a
   * 320px phone and on a tablet alike. 5:6 against the sheet leaves the map
   * clearly dominant while still showing the trip code, the current action and
   * the first stops without scrolling.
   */

  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 16,
  },

  /** The request card: what the job is, and the one action for it. */
  endpointLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 4 },
  endpointAddress: { color: COLORS.text, fontSize: 18, fontWeight: '700', lineHeight: 25, marginBottom: 12 },
  request: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: 12,
    padding: 18,
    marginBottom: 16,
    gap: 8,
  },
  requestTitle: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  // No fixed height and no nowrap: a translated origin/destination pair runs
  // far longer than the English, and must wrap rather than clip.
  requestBody: { color: COLORS.text, fontSize: 18, fontWeight: '700', lineHeight: 24 },
  requestNote: { color: COLORS.faint, fontSize: 12, lineHeight: 17 },
  code: { color: COLORS.text, fontSize: 22, fontWeight: '800' },
  status: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },

  section: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    // 48 is the driver-app floor for a tap target. See MASTER.md.
    minHeight: 48,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  // flexShrink so a long translated summary truncates instead of pushing the
  // caret off the row.
  sectionSummary: { color: COLORS.faint, fontSize: 13, flexShrink: 1, flex: 1 },
  sectionCaret: { color: COLORS.muted, fontSize: 20, fontWeight: '700' },
  sectionBody: { paddingBottom: 8 },

  card: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 18,
    marginBottom: 16,
  },
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
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
  stopAddress: { color: COLORS.faint, fontSize: 12, marginTop: 2 },
  stopStatus: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  sheet: { flex: 1, backgroundColor: COLORS.bg },
  sheetContent: { padding: 20, paddingBottom: 32, width: '100%', maxWidth: 700, alignSelf: 'center' },

  empty: { alignItems: 'center', paddingVertical: 64 },
  emptyAction: { marginTop: 16, alignSelf: 'stretch', maxWidth: 320 },
  emptyTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  emptyBody: {
    color: COLORS.muted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
    maxWidth: 300,
  },

  note: { color: COLORS.faint, fontSize: 12, marginTop: 24, lineHeight: 18 },
  cardNote: {
    color: COLORS.faint,
    fontSize: 12,
    marginTop: 10,
    lineHeight: 17,
  },
  reasons: { marginTop: 10, gap: 4 },
  reason: { color: COLORS.faint, fontSize: 13, lineHeight: 18 },
})
