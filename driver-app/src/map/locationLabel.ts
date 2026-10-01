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

export interface TrackerState {
  permission: string
  watching: boolean
  platformPermission: string | null
  fix: { accuracyM: number | null; source?: LocationSource; at: number } | null
  /** The guidance clock's last tick. */
  now: number
  freshMs: number
}

/**
 * The tracker's newest fix, judged once for everything that shows it: the
 * map's chip and marker, and the header.
 *
 * `now` is the guidance clock's last tick, up to 5 s old, so a fix taken since
 * that tick is NEWER than `now`. That is age 0, not a fix from the future:
 * counting it stale turned the marker grey after every fix until the next tick
 * (browser lane D1). A fix further ahead than the freshness window is a device
 * clock at odds with the receiver, and is not trusted.
 */
export function judgeFix(s: TrackerState, t: (en: string) => string = (en) => en): { ageMs: number | null; live: boolean; chip: LocationChip } {
  const ageMs = s.fix && s.fix.at - s.now <= s.freshMs ? Math.max(0, s.now - s.fix.at) : null
  const live = ageMs !== null && ageMs <= s.freshMs && s.watching && s.permission === 'granted' && s.platformPermission !== 'denied'
  const chip = locationChip({ permission: s.permission, fix: s.fix, kind: !s.fix || s.permission !== 'granted' ? null : live ? 'LIVE' : 'LAST_KNOWN', now: s.now }, t)
  return { ageMs, live, chip }
}

/**
 * A hero's GPS chip: GPS from the watch in the map chip's words, and the
 * connection on its own. It read "GPS stale" whenever the TRIP POLL failed, so
 * offline with a live receiver it blamed the GPS (browser lane D2).
 *
 * With no watch running it says why in words a driver cannot misread: the
 * phone refused ("Location off"), or `idle` - "Not tracking" for the trip
 * tracker, which is idle between trips. "GPS off" there read as "my phone's GPS
 * is off" while the phone was fine (B3).
 */
export function headerStatus(s: TrackerState & { offline: boolean }, t: (en: string) => string = (en) => en, idle = 'GPS off'): { text: string; live: boolean } {
  const { live, chip } = judgeFix(s, t)
  const refused = s.permission === 'denied' || s.permission === 'unavailable'
  const gps = s.watching ? chip.text : refused ? t('Location off') : t(idle)
  return { text: s.offline ? `${gps} · ${t('Offline')}` : gps, live }
}
