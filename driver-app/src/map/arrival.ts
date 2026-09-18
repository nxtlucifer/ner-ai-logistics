/**
 * Whether this truck has actually arrived, or has merely driven past.
 *
 * Pure arithmetic and a pure reducer, like `navState.ts` and for the same
 * reason: arrival is the one navigation decision with a business action behind
 * it, and a decision that can complete a delivery has to be testable without a
 * device.
 *
 * ARRIVAL IS NOT COMPLETION
 *
 * Nothing here completes anything. It decides when the app may SAY "you have
 * arrived" and when it may OFFER the completion action the trip lifecycle
 * already owns. Whether the delivery is done is the server's answer, behind
 * whatever proof it requires; this module has no opinion on it.
 *
 * WHY THREE CONDITIONS AND NOT ONE
 *
 * A radius around the destination is the obvious test and on its own it is
 * wrong in a way that matters. Two roads run either side of a depot wall; the
 * flyover passes 30 m above the gate. A truck on the wrong one of those is
 * inside any useful radius and has not arrived, and announcing arrival there
 * ends guidance for a driver who still has two kilometres of one-way system to
 * go. So all three must hold together:
 *
 *   near        straight-line distance to the destination is small
 *   at the end  the remaining distance ALONG the route is small
 *   on the road the fix is on the planned corridor, not a parallel one
 *
 * and they must hold for several consecutive fixes, because a single fix is
 * noise - the same reason `trackOffRoute` counts to three.
 */

import { distanceMetres, type LatLon } from './geo'

export interface ArrivalConfig {
  /** Straight-line distance to the destination that counts as at it, metres. */
  radiusM: number
  /** Remaining distance ALONG the route that counts as at the end, metres. */
  remainingM: number
  /**
   * Cross-track distance above which the fix is on some other road.
   *
   * Deliberately tighter than `OFF_ROUTE_ENTER_M`: 200 m is the right figure
   * for "has this truck left the corridor", and far too loose for "is it at
   * this gate rather than the one on the next street".
   */
  maxCrossTrackM: number
  /** Consecutive qualifying fixes before arrival is believed. */
  fixes: number
}

export const ARRIVAL: ArrivalConfig = {
  radiusM: 120,
  remainingM: 150,
  maxCrossTrackM: 60,
  fixes: 3,
}

export interface ArrivalTrack {
  arrived: boolean
  /** Consecutive qualifying fixes so far. */
  streak: number
}

export const NOT_ARRIVED: ArrivalTrack = { arrived: false, streak: 0 }

export interface ArrivalFix {
  /** Where the truck is. */
  position: LatLon
  /** Where it is going - the destination, or this leg's stop. */
  destination: LatLon
  /** Distance along the route still to run, metres. Null when unknown. */
  remainingM: number | null
  /** Distance from the fix to the planned line, metres. Null when unknown. */
  crossTrackM: number | null
  /** Reported accuracy, metres. Null when the platform gave none. */
  accuracyM: number | null
  /** False for a stale or absent fix: an old position cannot prove arrival. */
  fresh: boolean
}

/**
 * Whether one fix counts towards arrival.
 *
 * Accuracy is ADDED to the measured distances rather than subtracted. This is
 * the opposite of `trackOffRoute`, on purpose: there the question was "is there
 * enough evidence to say the truck LEFT the road", and generous accuracy argues
 * against acting. Here the question is "is there enough evidence to say it has
 * FINISHED", and a 200 m accuracy circle is not evidence of standing at a gate.
 * Both directions are the cautious one for the decision being made.
 */
export function qualifies(fix: ArrivalFix, config: ArrivalConfig = ARRIVAL): boolean {
  if (!fix.fresh) return false
  if (fix.remainingM === null || fix.crossTrackM === null) return false
  const slack = fix.accuracyM ?? 0
  if (distanceMetres(fix.position, fix.destination) + slack > config.radiusM) return false
  if (fix.remainingM + slack > config.remainingM) return false
  // Cross-track is NOT slackened. A wide accuracy circle already failed the two
  // tests above; loosening this one as well would let the parallel-road case
  // through on exactly the fixes that cannot distinguish it.
  if (fix.crossTrackM > config.maxCrossTrackM) return false
  return true
}

/**
 * One fix in, the belief out.
 *
 * ARRIVAL DOES NOT UNLATCH. Once believed it stays believed until the caller
 * resets - on a new route, a new leg, or a new trip. A truck that rolls ten
 * metres forward to the loading bay has not un-arrived, and an announcement
 * that retracted itself would be worse than either answer.
 */
export function trackArrival(
  prev: ArrivalTrack,
  fix: ArrivalFix,
  config: ArrivalConfig = ARRIVAL,
): ArrivalTrack {
  if (prev.arrived) return prev
  if (!qualifies(fix, config)) return prev.streak === 0 ? prev : NOT_ARRIVED
  const streak = prev.streak + 1
  return { arrived: streak >= config.fixes, streak }
}
