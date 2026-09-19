/**
 * Active emergencies (driver SOS), polled ONCE for the whole console.
 *
 * Only the Fleet page used to ask, so a manager working in Trips or Drivers
 * learned a driver had pressed SOS when they next happened to open Fleet. The
 * shell asks now, for every account the server lets read emergencies; the
 * topbar shows the count on every screen and Fleet reads this same list.
 *
 * A failed poll keeps the last-known list and says it is `unavailable`. An
 * outage is never shown as "no SOS".
 */

import { createContext, useContext } from 'react'

import type { Emergency } from '../api/client'

export const SOS_POLL_MS = 10_000
/** A hidden tab still asks, slower: the SOS must be waiting when they return. */
export const SOS_HIDDEN_POLL_MS = 30_000

export interface Emergencies {
  emergencies: Emergency[]
  /** False until the first poll answers or fails: not yet known is not "no SOS". */
  loaded: boolean
  /** The last poll failed: the list is last-known, not "all clear". */
  unavailable: boolean
  reload: () => Promise<void>
}

export const EmergencyContext = createContext<Emergencies>({
  emergencies: [],
  loaded: false,
  unavailable: false,
  reload: async () => {},
})

export function useEmergencies(): Emergencies {
  return useContext(EmergencyContext)
}
