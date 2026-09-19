/**
 * Trip state and GPS tracking, owned at TRIP scope rather than screen scope.
 *
 * WHY THIS EXISTS (DRV-002)
 *
 * `useLocationTracking` used to be mounted inside `TripScreen`. Its effect
 * cleanup calls `tracker.stop()`, which ends the GPS watch AND the flush
 * timer - so navigating to another tab unmounted the screen and silently
 * stopped the truck reporting its position. With two tabs that was rarely
 * reached. With four, and with `safety` being the tab a driver opens during
 * an incident, the app would have gone quiet at exactly the moment a
 * dispatcher most needed to see where the truck was.
 *
 * The fix is not "never unmount the screen". It is that tracking's lifetime
 * was never a screen's business. A truck is reporting because a TRIP is in
 * progress, and that fact outlives whatever the driver happens to be looking
 * at. So the trip - and the tracker it implies - lives here, above the
 * navigation, and screens became pure views of it.
 *
 * TRIP STATE COMES WITH IT, NOT SEPARATELY
 *
 * The tracker's three inputs (`id`, `tracking_expected`, `tracking`) all come
 * out of the trip payload. Leaving the fetch in the screen and putting only
 * the hook up here would mean two components fetching `api.myTrip()` and
 * disagreeing about the answer. One owner, one fetch.
 *
 * MOUNTED ONLY WHILE SIGNED IN
 *
 * Rendered inside the signed-in branch, so it mounts when a driver signs in
 * and unmounts when they sign out - and signing out therefore stops tracking,
 * which is correct.
 *
 * POLLING (LS-9)
 *
 * Previously the trip was read once and re-read only from a mutation response
 * or a pull-to-refresh. That left a real hole: a manager changing the SELECTED
 * ROUTE mid-trip is a change the driver makes no action to cause, so nothing
 * fetched it and the driver kept following the old road until they happened to
 * pull down. A route change nobody delivers is not a route change.
 *
 * So this provider now polls, keeping the disciplines the manager's
 * `useFleetPoll` already proves out:
 *
 *   one request in flight   ticks cannot stack up behind a slow response
 *   no duplicate timers     one loop, owned here, the single fetcher
 *   stops at sign-out       the provider unmounts with the signed-in branch,
 *                           and the effect's cleanup clears the timer
 *   never goes backwards    a poll that started before a mutation is DISCARDED
 *                           if anything newer landed first, so an in-flight
 *                           read cannot overwrite a fresh response
 *   last good data retained a failed poll sets `isStale` and leaves the trip on
 *                           screen; it never flips the whole screen to `error`,
 *                           which would replace a working trip with a banner
 *                           because one request blipped
 *
 * There is no event channel (no websocket, no push) in this build, so this is
 * polling and is described as such. `TRIP_POLL_MS` is the one place to change
 * the cadence.
 */

import type { RerouteApproved, TripDelivered } from './tripNotices'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AppState } from 'react-native'

import { api, type CurrentTrip } from '../api/client'
import { currentAppLanguage } from '../i18n/language'
import { tx } from '../i18n/tx'
import { notifyInBackground } from '../notify/local'

/** Translate a background notification. Outside React, so not `useT`. */
const say = (en: string): string => tx(currentAppLanguage(), en)
import { errorMessage } from '../components/ui'
import { useLocationTracking } from '../tracking/useLocationTracking'
import { useAuth } from '../auth/AuthProvider'
import { cacheTrip, readCachedTrip } from '../auth/sessionCache'

export type Phase = 'loading' | 'ready' | 'error'

/**
 * How often the trip is re-read while a driver is signed in.
 *
 * 10 s, matching the manager's `FLEET_POLL_MS` and the moving GPS upload
 * interval in `telemetry_policy.py`, so a route change and the position that
 * follows it arrive on the same cadence rather than one lagging the other.
 *
 * ponytail: one fixed interval. A phone on a hill road would be better served
 * by backing off when the app is backgrounded (AppState) and when no trip is
 * loaded; add that when battery on a real handset says it matters, which is
 * not measurable here - no native build exists yet (BLOCKER-4).
 */
export const TRIP_POLL_MS = 10_000

/** One presence beat a minute.
 *
 *  The server treats a gap under 90 s as present, so 60 s tolerates one
 *  lost request without a driver blinking out on somebody's board. Faster
 *  would buy nothing: the server coalesces anything inside 45 s. */
export const HEARTBEAT_MS = 60_000

/** The server's MAX_BACKDATE: a fix older than this is rejected, so a cached
 *  trip last seen longer ago than this may be over and never restarts GPS. */
const CACHED_TRIP_TRACKING_MS = 24 * 60 * 60 * 1000

export interface TripContextValue {
  trip: CurrentTrip | null
  /**
   * When `trip` was last successfully read from the server.
   *
   * Exists so the assistant can state the AGE of what it is showing. Without
   * it, an answer built after two hours offline looks exactly like one built
   * a second ago, which is the failure the offline package was designed to
   * avoid for risk and would reintroduce for everything else.
   */
  loadedAt: number | null
  phase: Phase
  loadError: unknown
  actionError: { title: string; detail: string } | null
  isBusy: boolean
  /**
   * True when the most recent BACKGROUND refresh failed while a trip is still
   * on screen.
   *
   * Distinct from `phase === 'error'`, which means there is nothing to show.
   * This one means "what you are looking at is real, but it is not current" -
   * and a driver deciding whether to trust the road in front of them needs
   * those two told apart. `loadedAt` says how old it is.
   */
  isStale: boolean
  /** Undefined means the refresh failed or was superseded. Null means no trip. */
  load: () => Promise<CurrentTrip | null | undefined>
  act: (action: () => Promise<CurrentTrip>) => Promise<void>
  tracking: ReturnType<typeof useLocationTracking>
  /** True while an offline seed older than 24 h holds the tracker off. The map
   *  then shows position from its upload-free watch instead of nothing. */
  gpsHeld: boolean
  /** The road a manager moved this trip onto while the app was open, and when
   *  the poll saw it: the in-app "Reroute approved" (FV-E2E-2). The background
   *  notification only fires with the app in the background. */
  rerouteApproved: RerouteApproved | null
  /** The trip this driver delivered, from the moment the poll stopped
   *  returning it: the server's current trip is an open one, so "Trip
   *  complete" otherwise lasted one poll (RE2E-2). */
  delivered: TripDelivered | null
}

const TripContext = createContext<TripContextValue | null>(null)

export function TripProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [trip, setTrip] = useState<CurrentTrip | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [actionError, setActionError] = useState<{
    title: string
    detail: string
  } | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const [isStale, setIsStale] = useState(false)
  const [rerouteApproved, setRerouteApproved] = useState<TripContextValue['rerouteApproved']>(null)
  const [delivered, setDelivered] = useState<TripDelivered | null>(null)
  // The offline seed is a cached trip last seen over 24 h ago: shown as sent,
  // but GPS stays off until a live read. Cleared by the first one.
  const [seededTooOld, setSeededTooOld] = useState(false)
  // A manager's support view must never watch the MANAGER's position.
  const { supportView, offline } = useAuth()

  // Refs, not state: a poll must not re-run the effect that owns its timer, or
  // the loop restarts on every tick.
  const inFlight = useRef(false)
  // Bumped by EVERY accepted write to `trip`. A poll captures this before it
  // asks and refuses to apply its answer if the value moved meanwhile, which is
  // how an in-flight read is stopped from overwriting a newer mutation
  // response with the state that preceded it.
  const writeSeq = useRef(0)
  const mutationInFlight = useRef(false)
  const hasLoaded = useRef(false)
  const lastSeen = useRef<CurrentTrip | null>(null)

  const load = useCallback(async () => {
    const version = ++writeSeq.current
    try {
      const fresh = await api.myTrip()
      if (writeSeq.current !== version) return undefined
      hasLoaded.current = true
      setTrip(fresh)
      setLoadedAt(Date.now())
      setLoadError(null)
      setIsStale(false)
      setPhase('ready')
      return fresh
    } catch (error) {
      if (writeSeq.current !== version) return undefined
      setLoadError(error)
      if (hasLoaded.current) setIsStale(true)
      else setPhase('error')
      return undefined
    }
  }, [])

  useEffect(() => {
    // FE-01: an offline launch shows the last trip the server sent, marked
    // stale, until a live read replaces it - so the trip, its stops and the
    // stored route package stay reachable after an OS kill in a dead zone.
    // Read once, at mount: going live later is the poll's job.
    if (offline) {
      void readCachedTrip().then((cached) => {
        if (!cached || hasLoaded.current) return
        hasLoaded.current = true
        setSeededTooOld(Date.now() - cached.at > CACHED_TRIP_TRACKING_MS)
        setTrip(cached.trip)
        setLoadedAt(cached.at)
        setIsStale(true)
        setPhase('ready')
      })
    }
    void load()
    return () => { writeSeq.current += 1 }
  }, [load])

  // Every fresh server answer is remembered for the next offline launch. A
  // stale one is never written back as if it were current.
  useEffect(() => {
    if (loadedAt !== null && !isStale) cacheTrip(trip, loadedAt)
    if (!isStale) setSeededTooOld(false)
  }, [trip, loadedAt, isStale])

  /**
   * The background refresh. Quiet on failure, by design.
   *
   * Deliberately NOT `load`: that one sets `phase = 'error'`, which is right
   * for a first load with nothing to show and wrong for a poll, where it would
   * throw away a perfectly good trip because one request timed out on a bad
   * link - the exact failure `useFleetPoll` calls "last good data retained".
   */
  useEffect(() => {
    let cancelled = false

    async function tick() {
      if (cancelled || inFlight.current || mutationInFlight.current) return
      inFlight.current = true
      const seenAt = writeSeq.current
      try {
        const fresh = await api.myTrip()
        // Something newer landed while this was in flight - a mutation
        // response, or a manual reload. Its answer is more current than ours,
        // so ours is dropped rather than applied on top of it.
        if (cancelled || writeSeq.current !== seenAt) return
        writeSeq.current += 1
        // BACKGROUND ALERTS from the same poll, never a second one. Only the
        // two transitions a driver must not miss while the phone is in a
        // pocket; the route-danger card has its own key on the map screen.
        const before = lastSeen.current
        if (fresh && (!before || before.id !== fresh.id) && fresh.status === 'ASSIGNED') {
          void notifyInBackground(
            `trip-assigned:${fresh.id}`,
            say('New trip assigned'),
            `${fresh.trip_code} - ${say('open RASTA to accept.')}`,
          )
        } else if (fresh && before && before.id === fresh.id && before.selected_route_id && fresh.selected_route_id && before.selected_route_id !== fresh.selected_route_id) {
          setRerouteApproved({ tripId: fresh.id, routeId: fresh.selected_route_id, at: Date.now() })
          void notifyInBackground(
            `reroute:${fresh.selected_route_id}`,
            say('Reroute approved'),
            say('Your manager approved a new road. Open Navigate to follow it.'),
          )
        }
        if (!fresh && before?.status === 'DELIVERED') setDelivered({ tripId: before.id, at: Date.now() })
        lastSeen.current = fresh
        setTrip(fresh)
        setLoadedAt(Date.now())
        setIsStale(false)
        setPhase('ready')
        hasLoaded.current = true
      } catch {
        // Keep whatever is on screen and say it may be out of date.
        if (!cancelled && writeSeq.current === seenAt) setIsStale(true)
      } finally {
        inFlight.current = false
      }
    }

    // PRESENCE. One beat a minute, on its own slow timer rather than
    // piggybacking the 10 s trip poll: a manager's board needs to know the
    // app is alive, not to be told sixty times a minute. The server
    // coalesces anything faster than 45 s, so this is already the floor.
    //
    // Deliberately NOT tied to the foreground. A driver whose phone is in a
    // cradle with the screen off is present, and a board that called them
    // offline for that would be wrong in the most common case there is.
    const beat = () => {
      api.heartbeat().catch(() => {
        // A missed beat is a gap the manager's board shows honestly. It is
        // never worth surfacing to the driver, who can do nothing about it.
      })
    }
    beat()
    const heartbeat = setInterval(beat, HEARTBEAT_MS)

    // BATTERY-AWARE: the same poll runs three times slower while the app is
    // in the background. Alerts still arrive (within 30 s); the radio is not
    // woken every ten seconds for a screen nobody is looking at.
    let timer = setInterval(() => void tick(), TRIP_POLL_MS)
    const sub = AppState.addEventListener('change', (state) => {
      clearInterval(timer)
      timer = setInterval(() => void tick(), state === 'active' ? TRIP_POLL_MS : TRIP_POLL_MS * 3)
      if (state === 'active') void tick()
    })
    return () => {
      cancelled = true
      clearInterval(timer)
      clearInterval(heartbeat)
      sub.remove()
    }
  }, [])

  // Tracking runs only while the SERVER says this trip is in progress. The app
  // does not decide for itself when it is allowed to collect position.
  const tracking = useLocationTracking(
    trip?.id ?? null,
    Boolean(trip?.tracking_expected) && !supportView && !seededTooOld,
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
      if (mutationInFlight.current) return
      mutationInFlight.current = true
      writeSeq.current += 1
      setIsBusy(true)
      setActionError(null)
      try {
        const applied = await action()
        writeSeq.current += 1
        // What the app now knows, for the poll's comparisons: a delivery
        // confirmed here is the trip the next empty poll takes away.
        lastSeen.current = applied
        setTrip(applied)
        // A mutation's response IS a fresh read of the trip, so it advances
        // the age just as `load` does.
        setLoadedAt(Date.now())
        setIsStale(false)
        setPhase('ready')
        hasLoaded.current = true
      } catch (error) {
        setActionError(errorMessage(error))
        void load() // the trip may have moved underneath us
      } finally {
        mutationInFlight.current = false
        setIsBusy(false)
      }
    },
    [load],
  )

  // NOT memoised, deliberately. `useLocationTracking` returns
  // `{ ...state, requestPermission: () => ... }` - a fresh object with a fresh
  // closure on every render - so `tracking` can never be a stable dependency
  // and a useMemo here would recompute every time anyway. It would imply a
  // guarantee it cannot make, which is worse than not being there.
  //
  // It costs nothing: this provider only re-renders when its own state
  // changes, and when that happens the one consumer needs to re-render too.
  const value: TripContextValue = {
    trip,
    loadedAt,
    phase,
    loadError,
    actionError,
    isBusy,
    isStale,
    load,
    act,
    tracking,
    gpsHeld: seededTooOld,
    rerouteApproved,
    delivered,
  }

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>
}

/**
 * The current trip and its tracker.
 *
 * Throws when used outside the provider rather than returning a null-ish
 * default: a screen that silently rendered "no trip" because somebody moved
 * it out of the tree would look like a driver with nothing to do, which is
 * the most misleading possible failure for this app.
 */
export function useTrip(): TripContextValue {
  const value = useContext(TripContext)
  if (value === null) {
    throw new Error('useTrip must be used inside <TripProvider>')
  }
  return value
}
