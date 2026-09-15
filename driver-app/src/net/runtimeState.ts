/**
 * The seven states the app may be in, decided in one place.
 *
 * Before this, "are we all right" was answered ad hoc in every screen, from
 * whatever was nearest: the trip poll's last error, the age of a GPS fix, a
 * boolean called `isStale` that meant the poll had failed. Two of those
 * answers contradicted each other on a phone that had a live satellite fix and
 * no signal - the badge read GPS STALE beside a green marker - and the fix for
 * that, recorded in `MapScreen`, was to stop conflating the network with the
 * receiver. This module is that separation, made explicit and testable.
 *
 * THREE AXES, NOT ONE LIST
 *
 * The mission brief names seven states in one table. They are not mutually
 * exclusive, and pretending they are is how a screen ends up unable to say "no
 * signal, good GPS, cached weather from this morning" - which is the exact
 * situation a driver in a valley is in.
 *
 *   link      ONLINE / NETWORK_LOST / BACKEND_UNAVAILABLE / UNKNOWN
 *   position  GPS_OK / GPS_DEGRADED / GPS_LOST / GPS_OFF / UNKNOWN
 *   data      CURRENT / STALE_DATA / UNKNOWN
 *
 * A screen renders all three. `headline` picks the one to lead with when there
 * is room for only one word.
 *
 * NETWORK_LOST VERSUS BACKEND_UNAVAILABLE
 *
 * A 5xx proves the network works and the server does not: the phone reached
 * something that answered. A request that never completed proves only that we
 * could not get there, so a timeout is NETWORK_LOST rather than a guess about
 * whose fault it was. The two differ in what the driver should do - one is
 * "keep driving, it will sync" and the other is "the service is having
 * trouble, it will retry" - so they must not be collapsed.
 *
 * UNKNOWN IS NEVER UPGRADED
 *
 * Nothing here turns absence of evidence into a healthy state. Before the
 * first request completes the link is UNKNOWN, not ONLINE; with no position
 * the state is GPS_LOST or GPS_OFF, never GPS_OK; with no cached package the
 * data state is UNKNOWN, never CURRENT.
 */

export type LinkState = 'ONLINE' | 'NETWORK_LOST' | 'BACKEND_UNAVAILABLE' | 'UNKNOWN'
export type PositionState = 'GPS_OK' | 'GPS_DEGRADED' | 'GPS_LOST' | 'GPS_OFF' | 'UNKNOWN'
export type DataState = 'CURRENT' | 'STALE_DATA' | 'UNKNOWN'

/** How the last attempt to reach the service ended. */
export type RequestOutcome =
  /** A response arrived and was usable. */
  | 'OK'
  /** Nothing arrived: DNS, refused, timeout, radio off. */
  | 'NETWORK_ERROR'
  /** Something answered and it was a server or dependency failure. */
  | 'SERVER_ERROR'
  /** Nothing has been attempted yet. */
  | 'NONE'

export interface LinkInputs {
  lastOutcome: RequestOutcome
}

export interface PositionInputs {
  /** The tracker's permission state. */
  permission: 'unknown' | 'requesting' | 'granted' | 'denied' | 'unavailable'
  /** Age of the newest fix this device kept, ms. Null when there is none. */
  fixAgeMs: number | null
  /** Reported accuracy of that fix, metres. Null when the platform gave none. */
  accuracyM: number | null
  /** Above this age a fix is no longer current. Server-published. */
  freshMs: number
  /** Above this age a fix is not evidence of where the truck is now. */
  lostAfterMs: number
  /** Above this radius the fix is a tower estimate, not a position. */
  poorAccuracyM: number
}

export interface DataInputs {
  /** Age of the cached safety package, ms. Null when nothing is cached. */
  ageMs: number | null
  /** How long that package stays current, ms. */
  validForMs: number
}

export interface RuntimeState {
  link: LinkState
  position: PositionState
  data: DataState
  /**
   * The single state to lead with, worst first.
   *
   * A driver reading one chip should see the thing that changes what they do.
   * Losing the receiver outranks losing the network, because guidance runs
   * from the cached corridor without a network and cannot run at all without a
   * position.
   */
  headline: LinkState | PositionState | DataState
  /** True when the app should be queueing rather than sending. */
  shouldQueue: boolean
}

export function linkState(inputs: LinkInputs): LinkState {
  switch (inputs.lastOutcome) {
    case 'OK':
      return 'ONLINE'
    case 'NETWORK_ERROR':
      return 'NETWORK_LOST'
    case 'SERVER_ERROR':
      return 'BACKEND_UNAVAILABLE'
    default:
      return 'UNKNOWN'
  }
}

export function positionState(inputs: PositionInputs): PositionState {
  if (inputs.permission === 'denied' || inputs.permission === 'unavailable') {
    // The driver turned it off, or the device has no receiver. Distinct from
    // GPS_LOST: nothing is wrong, and nothing will improve until someone acts.
    return 'GPS_OFF'
  }
  if (inputs.permission === 'unknown' || inputs.permission === 'requesting') {
    return 'UNKNOWN'
  }
  if (inputs.fixAgeMs === null) return 'GPS_LOST'
  // A clock that jumped backwards would otherwise make an old fix look new.
  if (inputs.fixAgeMs < 0) return 'GPS_DEGRADED'
  if (inputs.fixAgeMs > inputs.lostAfterMs) return 'GPS_LOST'
  if (inputs.fixAgeMs > inputs.freshMs) return 'GPS_DEGRADED'
  if (inputs.accuracyM !== null && inputs.accuracyM > inputs.poorAccuracyM) {
    // A 500 m circle is a cell-tower estimate. The position exists; it is not
    // precise enough to say which road the truck is on.
    return 'GPS_DEGRADED'
  }
  return 'GPS_OK'
}

export function dataState(inputs: DataInputs): DataState {
  if (inputs.ageMs === null) return 'UNKNOWN'
  return inputs.ageMs <= inputs.validForMs ? 'CURRENT' : 'STALE_DATA'
}

/** Worst first. The order a driver should be told about things. */
const HEADLINE_ORDER: string[] = [
  'GPS_OFF',
  'GPS_LOST',
  'BACKEND_UNAVAILABLE',
  'NETWORK_LOST',
  'GPS_DEGRADED',
  'STALE_DATA',
  'UNKNOWN',
  'ONLINE',
  'GPS_OK',
  'CURRENT',
]

export function runtimeState(inputs: {
  link: LinkInputs
  position: PositionInputs
  data: DataInputs
}): RuntimeState {
  const link = linkState(inputs.link)
  const position = positionState(inputs.position)
  const data = dataState(inputs.data)

  const headline = [link, position, data].sort(
    (a, b) => HEADLINE_ORDER.indexOf(a) - HEADLINE_ORDER.indexOf(b),
  )[0] as RuntimeState['headline']

  return {
    link,
    position,
    data,
    headline,
    // UNKNOWN queues too: before the first request completes there is no
    // evidence the service is reachable, and an event recorded in that window
    // must not be dropped on the assumption that it is.
    shouldQueue: link !== 'ONLINE',
  }
}

/**
 * Classify a thrown error into a request outcome.
 *
 * Kept beside the reducer rather than in the API client, because what an error
 * MEANS for the runtime state is a policy decision and the client's job is
 * only to say what happened. `status` is the HTTP status when there was one.
 */
export function outcomeOf(error: unknown): RequestOutcome {
  if (error === null || error === undefined) return 'OK'
  const status = (error as { status?: number }).status
  if (typeof status === 'number') {
    // 5xx and 429 are the service failing or protecting itself: something
    // answered, so the network is fine.
    if (status >= 500 || status === 429) return 'SERVER_ERROR'
    // Any other 4xx is this request being wrong, not the link being down.
    return 'OK'
  }
  return 'NETWORK_ERROR'
}
