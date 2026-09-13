/**
 * The words on the location chip. GPS is never network; stale is never live.
 *
 *   LOCATION OFF          permission denied / services off
 *   GPS ±12 m             fresh, GPS-grade
 *   NETWORK ±180 m        fresh, network-grade (Wi-Fi/cell assisted)
 *   LAST KNOWN 3 min      a fix older than the freshness window
 *   NO FIX                nothing yet
 */

import type { LocationSource } from '../tracking/source'

export interface LocationChip {
  text: string
  /** 'live' green, 'coarse' amber, 'off' grey. */
  tone: 'live' | 'coarse' | 'off'
}

export function locationChip(input: {
  permission: string
  fix: { accuracyM: number | null; source?: LocationSource; at: number } | null
  kind: 'LIVE' | 'LAST_KNOWN' | null
  now: number
}): LocationChip {
  if (input.permission === 'denied' || input.permission === 'unavailable') return { text: 'LOCATION OFF', tone: 'off' }
  if (!input.fix || input.kind === null) return { text: 'NO FIX', tone: 'off' }
  const metres = input.fix.accuracyM === null ? '' : ` ±${Math.round(input.fix.accuracyM)} m`
  if (input.kind === 'LAST_KNOWN') {
    const ageMin = Math.max(1, Math.round((input.now - input.fix.at) / 60_000))
    return { text: `LAST KNOWN ${ageMin < 60 ? `${ageMin} min` : `${Math.floor(ageMin / 60)} h`}`, tone: 'off' }
  }
  const source = input.fix.source ?? 'GPS'
  return { text: `${source}${metres}`, tone: source === 'GPS' ? 'live' : 'coarse' }
}
