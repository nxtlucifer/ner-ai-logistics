/**
 * The driver's trip: what to do next, and whether position is actually going up.
 *
 * Two rules shape this screen.
 *
 * ONLY LEGAL CONTROLS ARE SHOWN. `can_start`, `next_stop_id` and the stop
 * statuses all come from the server, and the server decides them with the same
 * function the write endpoints use. There is no client-side guess at what is
 * allowed, so a button that is present is a button that will work.
 *
 * TRACKING IS REPORTED HONESTLY. "Location active" means fixes are being
 * captured AND the server is accepting them. If uploads are failing the banner
 * says so, with the queue depth, rather than showing a reassuring green dot
 * over a stalled queue. A driver who believes they are being tracked when they
 * are not is worse off than one who knows they are not.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { api, type CurrentTrip, type TripStop } from '../api/client'
import { Banner, Button, Loading, Row, errorMessage } from '../components/ui'
import { COLORS } from '../theme'
import { useLocationTracking } from '../tracking/useLocationTracking'

type Phase = 'loading' | 'ready' | 'error'

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return `${Math.round(seconds)}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  return `${Math.round(seconds / 3600)} h ago`
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

export default function TripScreen() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [trip, setTrip] = useState<CurrentTrip | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [actionError, setActionError] = useState<{
    title: string
    detail: string
  } | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setTrip(await api.myTrip())
      setLoadError(null)
      setPhase('ready')
    } catch (error) {
      setLoadError(error)
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Tracking runs only while the SERVER says this trip is in progress. The app
  // does not decide for itself when it is allowed to collect position.
  const tracking = useLocationTracking(
    trip?.id ?? null,
    Boolean(trip?.tracking_expected),
    trip?.tracking ?? null,
  )

  /**
   * Every mutation reloads from the response.
   *
   * State transitions are never assumed to have succeeded - the screen renders
   * what the server returned. A failure leaves the previous state visible and
   * surfaces the reason, so the driver retries deliberately rather than the app
   * guessing on their behalf.
   */
  const act = useCallback(
    async (action: () => Promise<CurrentTrip>) => {
      if (isBusy) return
      setIsBusy(true)
      setActionError(null)
      try {
        setTrip(await action())
      } catch (error) {
        setActionError(errorMessage(error))
        void load() // the trip may have moved underneath us
      } finally {
        setIsBusy(false)
      }
    },
    [isBusy, load],
  )

  async function onPullToRefresh() {
    setIsRefreshing(true)
    await load()
    setIsRefreshing(false)
  }

  const nextStop = trip?.stops.find((s) => s.id === trip.next_stop_id) ?? null
  const inProgress = Boolean(trip?.tracking_expected)

  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onPullToRefresh}
            tintColor={COLORS.muted}
          />
        }
      >
        {phase === 'loading' ? (
          <Loading label="Loading your trip…" />
        ) : phase === 'error' ? (
          <>
            <Banner {...errorMessage(loadError)} tone="bad" />
            <Button label="Try again" onPress={() => void load()} />
          </>
        ) : trip === null ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No trip right now</Text>
            <Text style={styles.emptyBody}>
              When your manager dispatches a trip it will appear here. Pull down
              to refresh.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.header}>
              <Text style={styles.code}>{trip.trip_code}</Text>
              <Text style={styles.status}>{trip.status.replace(/_/g, ' ')}</Text>
            </View>

            {actionError ? <Banner tone="bad" {...actionError} /> : null}

            {trip.status === 'DELIVERED' ? (
              <Banner
                tone="ok"
                title="Trip complete"
                detail="Your manager can see the delivery. Location sharing has stopped."
              />
            ) : null}

            {/* Location status. Never claims to be working when it is not. */}
            {inProgress ? <TrackingBanner tracking={tracking} /> : null}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Truck</Text>
              <Text style={styles.registration}>
                {trip.truck.registration_number}
              </Text>
              <Row label="Dispatched" value={relativeTime(trip.dispatched_at)} />
              {trip.started_at ? (
                <Row label="Started" value={relativeTime(trip.started_at)} />
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Stops</Text>
              {trip.stops.map((stop) => (
                <StopRow
                  key={stop.id}
                  stop={stop}
                  isNext={stop.id === trip.next_stop_id}
                />
              ))}
            </View>

            {/* Controls. Exactly one action is offered at a time, because a
                driver looking at several buttons at 3am will press the wrong
                one. Which action that is comes entirely from server state. */}
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
                  disabled={!trip.can_start}
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

            <Text style={styles.note}>
              {inProgress
                ? 'Your location is shared with your fleet manager while this trip is running. It stops when the trip is complete.'
                : 'Your location is not being shared.'}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
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
  tracking: ReturnType<typeof useLocationTracking>
}) {
  if (tracking.permission === 'denied') {
    return (
      <View>
        <Banner
          tone="warn"
          title="Location permission needed"
          detail="Your manager cannot see where this truck is. The trip still works — you can grant permission at any time."
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

  if (tracking.permission === 'requesting' || tracking.permission === 'unknown') {
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
  container: { padding: 20, paddingBottom: 48 },

  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  code: { color: COLORS.text, fontSize: 22, fontWeight: '800' },
  status: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },

  card: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 18,
    marginBottom: 16,
  },
  cardTitle: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
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

  empty: { alignItems: 'center', paddingVertical: 64 },
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
})
