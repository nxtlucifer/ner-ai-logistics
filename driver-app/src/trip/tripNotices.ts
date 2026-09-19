/**
 * Two things the trip poll learns in the foreground and the app says once:
 * a manager moved the trip onto a new road (FV-E2E-2), and the trip the
 * driver just delivered left the poll (RE2E-2). The background notification
 * covers neither with the app open.
 */
import type { CurrentTrip } from '../api/client'

/** The road a manager moved a trip onto while the app was open, and when the
 *  trip poll saw it (FV-E2E-2). */
export interface RerouteApproved {
  tripId: string
  routeId: string
  at: number
}

/** How long "Reroute approved" stays up after the poll saw the new road. */
export const REROUTE_APPROVED_SHOWN_MS = 5 * 60_000

/** Whether to say "Reroute approved" now: the road the manager moved THIS
 *  trip onto is still its road, and that was a few minutes ago at most. */
export function rerouteJustApproved(
  approved: RerouteApproved | null | undefined,
  trip: Pick<CurrentTrip, 'id' | 'selected_route_id'> | null,
  now: number,
): boolean {
  return !!approved && !!trip && approved.tripId === trip.id && approved.routeId === trip.selected_route_id && now - approved.at < REROUTE_APPROVED_SHOWN_MS
}

/** The trip this driver delivered, once the poll stops returning it. */
export interface TripDelivered {
  tripId: string
  at: number
}

/** How long "Trip complete" stays on the empty Trip page after delivery. */
export const DELIVERED_SHOWN_MS = 30 * 60_000

/** Whether the empty Trip page still says the last trip was delivered. */
export function justDelivered(delivered: TripDelivered | null | undefined, now: number): boolean {
  return !!delivered && now - delivered.at < DELIVERED_SHOWN_MS
}
