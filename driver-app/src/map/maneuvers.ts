/**
 * Which instruction to show, and how far away it is.
 *
 * A separate module from the hook that fetches them, for the same reason
 * `geo.ts` is separate from the map components: this is the arithmetic, and
 * arithmetic should be testable without importing React or the API client -
 * which on this project means without pulling in React Native.
 */

import type { NavigationManeuver } from '../api/client'

/**
 * The maneuver a driver is approaching, and the distance to it.
 *
 * `travelledM` is distance along the route - the same quantity
 * `route_progress` measures server-side. Distance to the turn is the
 * maneuver's `distance_from_start_m` minus that: remaining path length, not
 * straight-line distance, and not the length of any single step.
 *
 * Returns null when there is no fresh position. A next-turn panel with no fix
 * shows nothing rather than the first instruction, because "turn left in 400 m"
 * is a claim about where the truck is.
 *
 * `depart` falls out naturally: it sits at distance zero, so it is never
 * strictly ahead of a truck that has started.
 */
export function upcomingManeuver(
  maneuvers: NavigationManeuver[],
  travelledM: number | null,
): { maneuver: NavigationManeuver; distanceM: number } | null {
  if (travelledM === null || maneuvers.length === 0) return null

  for (const maneuver of maneuvers) {
    const remaining = maneuver.distance_from_start_m - travelledM
    // Strictly ahead. A maneuver exactly at the current position has been
    // reached, and re-announcing it is how a panel sticks on a roundabout.
    if (remaining > 0) return { maneuver, distanceM: remaining }
  }
  return null
}

/**
 * Why guidance is being held, or null when it may run.
 *
 * Ordered by what the driver can act on: a permission they can grant comes
 * before a fix they can only wait for.
 */
export type GuidanceHold =
  | 'PERMISSION'
  | 'NO_FIX'
  | 'FIX_STALE'
  | 'CONTACT_LOST'
  | 'OFF_ROUTE'
  | null

export interface GuidanceInputs {
  /** Local permission state, known immediately - before any server round trip. */
  permission: string
  /** Whether a position subscription is actually running. */
  isTracking: boolean
  /** The server's own freshness label for the last fix it holds. */
  freshness: string | null | undefined
  /** When the trip payload carrying that label was fetched. */
  loadedAt: number | null
  /** Server-supplied freshness window, seconds. */
  freshSeconds: number
  /** The server's verdict on whether the fix lies on the planned line. */
  onRoute: boolean | null | undefined
  /**
   * What the PLATFORM says about location permission right now, where the
   * platform can be asked. Null where it cannot.
   *
   * Separate from `permission` because that one is the tracker's cached flag,
   * and a cached flag does not change when a driver revokes access in browser
   * settings mid-journey. Asking the platform is the difference between
   * noticing and assuming.
   */
  platformPermission?: string | null
  now: number
}

/**
 * Whether the confident countdown may run, and why not when it may not.
 *
 * TWO WAYS A `LIVE` LABEL GOES WRONG, AND NEITHER IS VISIBLE IN THE LABEL
 *
 * The panel used to consult `last_fix.freshness` alone. That reads as
 * conservative and is not, because the label is a statement about a moment that
 * has already passed by the time it is rendered:
 *
 *   Permission revoked. The server keeps saying `LIVE` for its whole freshness
 *   window - ninety seconds by default - because the last fix it holds really
 *   is recent. The truck has moved and the app knows the subscription is gone,
 *   so `permission` and `isTracking` are checked first. They are local and
 *   immediate; the label is remote and delayed.
 *
 *   Polling stops. The trip payload freezes with `freshness: 'LIVE'` in it and
 *   nothing ever contradicts it, so the countdown stays confident for as long
 *   as the app is left open. Ageing the PAYLOAD fixes this: a label may only be
 *   trusted for as long as the window it describes, so it expires with it.
 *
 * `freshSeconds` comes from the server (`trip.tracking.fresh_seconds`) rather
 * than a constant here, so the app and the manager's LIVE badge cannot drift
 * apart about what recent means.
 */
export function guidanceHold(input: GuidanceInputs): GuidanceHold {
  // Local and immediate. A driver who just revoked permission gets the pause
  // now, not when the server's window happens to close.
  if (input.permission !== 'granted') return 'PERMISSION'

  // The platform's own answer wins over the tracker's cached one. Revoking
  // access in browser settings does not error an already-running watch in
  // Chrome, so without this the app keeps counting down from a position it can
  // no longer obtain - observed in the browser capture, invisible to the unit
  // tests, because the tracker's flag was still 'granted'.
  if (input.platformPermission != null && input.platformPermission !== 'granted')
    return 'PERMISSION'

  // Granted but not subscribed is a different sentence. It happens on a trip
  // that has not started, and telling that driver to "turn location on" when it
  // already is would send them into settings to find nothing wrong.
  if (!input.isTracking) return 'NO_FIX'

  if (!input.freshness || input.freshness === 'NO_LOCATION') return 'NO_FIX'
  if (input.freshness !== 'LIVE') return 'FIX_STALE'

  // The label is only as current as the payload that carried it.
  if (input.loadedAt === null) return 'CONTACT_LOST'
  if (input.now - input.loadedAt > input.freshSeconds * 1000) return 'CONTACT_LOST'

  // A fix off the planned line still PROJECTS onto it - that is what
  // `route_progress` does - but the projection is not where the truck is, and
  // the distance it produces is not a distance to anything.
  //
  // Measured on the demo corridor: a fix 2.4 km off the road moved travelled
  // distance from 124 km to 175 km, so the panel skipped every maneuver in
  // between and announced the wrong turn with full confidence. Pausing is the
  // only safe direction here; it changes no route and spends no authority.
  if (input.onRoute === false) return 'OFF_ROUTE'

  return null
}

/** Distance to a turn, rounded the way a driver reads it. */
export function formatTurnDistance(metres: number): string {
  if (metres >= 10_000) return `${Math.round(metres / 1000)} km`
  if (metres >= 1_000) return `${(metres / 1000).toFixed(1)} km`
  // Under a kilometre, to the nearest 10 m. Metre precision on a moving truck
  // is noise that makes the panel flicker without telling anyone anything.
  return `${Math.round(metres / 10) * 10} m`
}

/**
 * Instruction text from the provider's own verb and modifier.
 *
 * Unknown combinations fall back to the verb rather than guessing: OSRM
 * documents modifiers this project has not seen, and inventing "keep right"
 * for one of them would be a fabricated instruction.
 */
export function instructionFor(maneuver: NavigationManeuver): string {
  const road = maneuver.name ? ` onto ${maneuver.name}` : ''

  switch (maneuver.type) {
    case 'depart':
      return 'Start'
    case 'arrive':
      return 'Arrive'
    case 'roundabout':
    case 'rotary':
      // The exit number is the whole instruction at a roundabout, and it is
      // absent often enough that "take the exit" has to be a real answer.
      return maneuver.exit
        ? `At the roundabout, take exit ${maneuver.exit}${road}`
        : `At the roundabout, take the exit${road}`
    case 'merge':
      return maneuver.modifier ? `Merge ${maneuver.modifier}${road}` : `Merge${road}`
    case 'fork':
      return maneuver.modifier ? `Keep ${maneuver.modifier}${road}` : `Keep ahead${road}`
    case 'end of road':
      return maneuver.modifier ? `Turn ${maneuver.modifier}${road}` : `Continue${road}`
    case 'new name':
    case 'continue':
      return maneuver.modifier === 'straight' || !maneuver.modifier
        ? `Continue${road}`
        : `Continue ${maneuver.modifier}${road}`
    case 'turn':
      return maneuver.modifier ? `Turn ${maneuver.modifier}${road}` : `Turn${road}`
    default:
      return maneuver.modifier
        ? `${maneuver.type} ${maneuver.modifier}${road}`
        : `${maneuver.type}${road}`
  }
}

/**
 * Visual direction symbol for glancing at the upcoming turn.
 */
/**
 * The glyph for one maneuver.
 *
 * TYPOGRAPHIC SYMBOLS, NOT EMOJI. Arrive was 🏁 and roundabout 🔄 - the only two
 * colour-emoji in the set, so on the next-turn card they rendered at a
 * different weight and baseline from their neighbours (↰ ↱ ↑) and ignored the
 * card's own colour. '◉' and '↻' come from the same geometric block as the
 * arrows, inherit the text colour, and sit on the same baseline.
 */
export function maneuverIcon(maneuver: NavigationManeuver): string {
  const mod = maneuver.modifier ?? ''
  switch (maneuver.type) {
    case 'depart':
      return '▲'
    case 'arrive':
      return '◉'
    case 'roundabout':
    case 'rotary':
      return '↻'
    default:
      if (mod.includes('sharp_left') || mod === 'left') return '↰'
      if (mod === 'slight_left') return '↖'
      if (mod.includes('sharp_right') || mod === 'right') return '↱'
      if (mod === 'slight_right') return '↗'
      if (mod.includes('uturn')) return '↶'
      return '↑'
  }
}

