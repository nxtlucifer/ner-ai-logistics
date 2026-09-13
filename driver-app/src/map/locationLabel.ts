/**
 * The words on the location chip. GPS is never network; stale is never live.
 *
 *   Location off          permission denied / services off
 *   GPS · ±12 m           fresh, GPS-grade
 *   Network · ±180 m      fresh, network-grade (Wi-Fi/cell assisted)
 *   Last known · 3 min    a fix older than the freshness window
 *   No fix                nothing yet
 *
 * `t` localises the words; the units and numbers stay as they are.
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
}, t: (en: string) => string = (en) => en): LocationChip {
  if (input.permission === 'denied' || input.permission === 'unavailable') return { text: t('Location off'), tone: 'off' }
  if (!input.fix || input.kind === null) return { text: t('No fix'), tone: 'off' }
  const metres = input.fix.accuracyM === null ? '' : ` · ±${Math.round(input.fix.accuracyM)} m`
  if (input.kind === 'LAST_KNOWN') {
    const ageMin = Math.max(1, Math.round((input.now - input.fix.at) / 60_000))
    return { text: `${t('Last known')} · ${ageMin < 60 ? `${ageMin} min` : `${Math.floor(ageMin / 60)} h`}`, tone: 'off' }
  }
  const source = input.fix.source ?? 'GPS'
  return { text: `${source === 'GPS' ? 'GPS' : t('Network')}${metres}`, tone: source === 'GPS' ? 'live' : 'coarse' }
}
