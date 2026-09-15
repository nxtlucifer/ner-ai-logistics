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
import { notifyInBackground } from '../notify/local'
import { errorMessage } from '../components/ui'
import { useEventQueue, type TripEvents } from '../events/useEventQueue'
import { useLocationTracking } from '../tracking/useLocationTracking'
import { useAuth } from '../auth/AuthProvider'

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
  /**
   * The durable queue for what the phone SAW, and its sync diagnostics.
   *
   * Lives here rather than on a screen because it must outlive every screen:
   * an SOS pressed on Safety, a deviation seen on Navigate and the outage that
   * spans both belong to the TRIP, and a queue owned by a screen would be torn
   * down by a tab change with an unsent call for help in it.
   */
  events: TripEvents
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
    void load()
    return () => { writeSeq.current += 1 }
  }, [load])

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
          void notifyInBackground(`trip-assigned:${fresh.id}`, 'New trip assigned', `${fresh.trip_code} - open RASTA to accept.`)
        } else if (fresh && before && before.id === fresh.id && before.selected_route_id && fresh.selected_route_id && before.selected_route_id !== fresh.selected_route_id) {
          void notifyInBackground(`reroute:${fresh.selected_route_id}`, 'Reroute approved', 'Your manager approved a new road. Open Navigate to follow it.')
        }
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
      sub.remove()
    }
  }, [])

  // Tracking runs only while the SERVER says this trip is in progress. The app
  // does not decide for itself when it is allowed to collect position.
  // A manager's support view must never watch the MANAGER's position.
  const { supportView } = useAuth()
  const tracking = useLocationTracking(
    trip?.id ?? null,
    Boolean(trip?.tracking_expected) && !supportView,
    trip?.tracking ?? null,
  )

  // Same gate as tracking, for the same reasons: only while the server says
  // this trip is under way, and never under a manager's read-only support
  // view - a support session must not write events as the driver.
  const events = useEventQueue(
    trip?.id ?? null,
    Boolean(trip?.tracking_expected) && !supportView,
  )

  /**
   * The outage, recorded as it happens.
   *
   * The trip poll is this app's own heartbeat: it runs every ten seconds and
   * it is the first thing to fail when the data path goes. So the transition
   * of `isStale` IS the connection going and coming back, and recording it
   * here gives the manager the one thing "the truck went quiet" never told
   * them - when it went quiet, when it came back, and how much was waiting.
   *
   * Recorded on the DEVICE clock at the moment it happened, queued like
   * everything else, and delivered when there is something to deliver it over.
   */
  const commsLost = useRef(false)
  useEffect(() => {
    if (!trip?.id) {
      commsLost.current = false
      return
    }
    if (isStale && !commsLost.current) {
      commsLost.current = true
      events.record('COMMS_LOST')
      return
    }
    if (!isStale && commsLost.current) {
      commsLost.current = false
      events.record('COMMS_RESTORED', {
        payload: { queued_events: events.summary.queued },
      })
    }
  }, [isStale, trip?.id, events])

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
    events,
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
