/**
 * The GPS state a screen shows, from ONE rule: the tracker's fix while it owns
 * the GPS (a trip the server tracks), otherwise the upload-free browse watch -
 * the same split Navigate's map makes. Safety, More and Navigate therefore
 * cannot disagree about the same phone: Safety read "GPS off" (the idle
 * tracker) while Navigate, on the same phone, read "GPS · ±10 m" (B2D-07).
 *
 * `browse: false` starts no watch of its own and reads the tracker only. The
 * Trip tab uses that: it is the landing tab, and a high-accuracy watch there
 * would run all day with no trip. An idle tracker says "Not tracking" - true of
 * this app, and not a claim about the phone's GPS (B3). A browse watch that has
 * no permission yet says "No fix".
 */

import { useT } from '../i18n/tx'
import { useBrowsePosition } from '../tracking/useBrowsePosition'
import { useTrip } from '../trip/TripProvider'
import { headerStatus } from './locationLabel'
import { useGuidanceClock } from './useGuidanceClock'

export function useGpsStatus(browse: boolean): { text: string; live: boolean } {
  const tr = useT()
  const { tracking, trip, isStale, gpsHeld } = useTrip()
  const clock = useGuidanceClock()
  const trackerOwnsGps = Boolean(trip?.tracking_expected) && !gpsHeld
  const own = !browse || trackerOwnsGps
  const watch = useBrowsePosition(!own)
  return headerStatus({
    permission: own ? tracking?.permission ?? 'unknown' : watch.permission,
    watching: own ? Boolean(tracking?.isTracking) : watch.permission === 'granted',
    platformPermission: clock.platformPermission,
    fix: own ? tracking?.lastPosition ?? null : watch.lastPosition,
    now: clock.now,
    freshMs: (trip?.tracking.fresh_seconds ?? 60) * 1000,
    offline: isStale,
  }, tr, own ? 'Not tracking' : 'No fix')
}
