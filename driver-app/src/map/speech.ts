/**
 * Deciding WHAT to say and WHEN, with no speech engine in sight.
 *
 * Split from the hook so the policy - the part that can announce a turn twice,
 * announce a turn that no longer applies, or talk over itself - is testable
 * without a speech engine, a device, or React.
 *
 * NOTHING HERE GENERATES LANGUAGE. The sentence is `instructionFor`, the same
 * template the panel renders, so what the driver hears and what they read
 * cannot disagree. No model writes a turn.
 */

import type { NavigationManeuver } from '../api/client'
import { instructionFor } from './maneuvers'

/**
 * How close to a turn each announcement fires, far to near.
 *
 * Three, not five. Every extra band is another sentence in a cab that already
 * has road noise in it, and the driver is looking at the same instruction on
 * screen the whole time. 2 km gives time to move across; 500 m is the
 * commitment point on a highway; 100 m is the turn itself.
 */
export const ANNOUNCE_BANDS_M = [2000, 500, 100] as const

/**
 * Identity of one maneuver, stable across polls.
 *
 * `distance_from_start_m` is the maneuver's own position along the route, not
 * the truck's, so it does not change as the truck moves - but it DOES change
 * when the route is replanned, which is exactly when a queued announcement
 * must be considered obsolete.
 */
export function maneuverKey(maneuver: NavigationManeuver): string {
  return `${maneuver.type}|${maneuver.modifier ?? ''}|${maneuver.distance_from_start_m}`
}

export interface AnnouncementInput {
  next: { maneuver: NavigationManeuver; distanceM: number } | null
  /** The route version the maneuver belongs to. A change voids everything. */
  routeId: string | null
  muted: boolean
  /** Non-null whenever guidance is held; nothing may be said during a hold. */
  held: boolean
}

/** What the caller already said, so the same thing is not said twice. */
export interface SpokenState {
  routeId: string | null
  /** `${routeId}|${maneuverKey}|${band}` for every announcement made. */
  said: Set<string>
}

export function emptySpokenState(): SpokenState {
  return { routeId: null, said: new Set() }
}

export interface Announcement {
  text: string
  /** The token recorded in `said`. Exposed so tests can assert it. */
  token: string
}

/**
 * The one sentence to speak now, or null.
 *
 * Returns null - and the caller cancels anything in flight - whenever guidance
 * must not be talking: muted, held, no upcoming turn, or a turn still further
 * away than the outermost band. Silence is the default; speech is the
 * exception that has to earn itself.
 *
 * `state` is MUTATED on a hit, because the alternative is a caller that must
 * remember to record what it said and will one day forget, which is a stuck
 * loop repeating "turn left" every poll.
 */
export function nextAnnouncement(
  input: AnnouncementInput,
  state: SpokenState,
): Announcement | null {
  // A new route version invalidates every announcement made against the old
  // one. Not clearing this is how a driver hears the previous corridor's turn.
  if (state.routeId !== input.routeId) {
    state.routeId = input.routeId
    state.said.clear()
  }

  if (input.muted || input.held || input.next === null || input.routeId === null) {
    return null
  }

  const { maneuver, distanceM } = input.next
  // The tightest band the truck is already inside. Passing 2 km and 500 m
  // between two polls - which a 10-second cadence on a highway does - must
  // announce once, at the nearest, not twice in a row.
  let band: number | null = null
  for (const candidate of ANNOUNCE_BANDS_M) {
    if (distanceM <= candidate) band = candidate
  }
  if (band === null) return null

  const token = `${input.routeId}|${maneuverKey(maneuver)}|${band}`
  if (state.said.has(token)) return null

  // Every band the truck has already passed for this maneuver is marked said
  // too. Otherwise a fix that jumps from 2.5 km to 80 m announces the 100 m
  // band now and the 500 m band never, which is fine - but a fix that then
  // drifts backwards to 300 m would announce 500 m late and out of order.
  for (const candidate of ANNOUNCE_BANDS_M) {
    if (distanceM <= candidate) {
      state.said.add(`${input.routeId}|${maneuverKey(maneuver)}|${candidate}`)
    }
  }

  const distance =
    band >= 1000 ? `In ${band / 1000} kilometres` : `In ${band} metres`
  // At the turn itself "in 100 metres" is already stale by the time it is
  // heard, so the nearest band drops the preamble.
  const text =
    band === ANNOUNCE_BANDS_M[ANNOUNCE_BANDS_M.length - 1]
      ? instructionFor(maneuver)
      : // NOT lower-cased. This string is only ever spoken, so the case is
        // inaudible - but `toLowerCase()` turns "NH27" into "nh27", which a
        // speech engine reads as a word rather than a road number.
        `${distance}, ${instructionFor(maneuver)}`

  return { text, token }
}
