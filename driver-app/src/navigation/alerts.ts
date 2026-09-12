/**
 * The danger card: what the driver is about to reach, from evidence the
 * engine already scored. Pure; MapScreen decides when it has been seen.
 *
 * ONE ALERT AT A TIME, THE NEAREST. A steep stretch in 2 km and a recorded
 * slide in 5 km are one card ("steep stretch, then a recorded slide") - two
 * stacked cards on a moving phone are read as none.
 *
 * LEVELS ARE EVIDENCE CLASSES, NOT PROBABILITIES.
 *   CRITICAL  only an official Extreme/Severe alert naming a corridor district
 *   HIGH      an official alert, or the server's HOLD/REROUTE decision
 *   CAUTION   steep terrain (DEM) or recorded-landslide concentration (history)
 * Historical data alone never produces CRITICAL; the key and the copy say
 * "recorded", never "landslide ahead".
 */

import type { RouteRisk } from '../api/client'
import { nextHazard } from '../map/ahead'
import type { LatLon } from '../map/geo'
import { nextTerrainRun } from './routeAi'

export type AlertLevel = 'CAUTION' | 'HIGH' | 'CRITICAL'

export interface DangerAlert {
  /** Stable per route + hazard + segment; acknowledged keys are not re-shown. */
  key: string
  level: AlertLevel
  title: string
  detail: string
  /** "Steep stretch in 2.1 km · 900 m long" - the approach, in distance. */
  where: string
  /** The evidence lines the card cites. */
  evidence: string[]
}

/** How far ahead a segment counts as "approaching". Project heuristic. */
export const ALERT_AHEAD_M = 3_000

const km = (m: number) => (m >= 950 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 100) * 100} m`)

export function dangerAlert(
  risk: RouteRisk | null,
  routeId: string | null,
  points: readonly LatLon[],
  travelledM: number | null,
): DangerAlert | null {
  if (!risk || !routeId) return null
  const evidence: string[] = []
  if (risk.terrain?.usable) evidence.push('terrain: DEM profile')
  if (risk.inputs.weather === 'AVAILABLE') evidence.push(`weather: current (${risk.observations_used} obs)`)
  if (risk.landslide_history) {
    const { inventory_from_year: from, inventory_to_year: to } = risk.landslide_history
    evidence.push(`landslide inventory${from && to ? ` ${from}–${to}` : ''} (historical)`)
  }
  if (risk.official_warnings?.level === 'ACTIVE') evidence.push('official alert: NDMA SACHET')

  // An official alert naming a corridor district applies to the whole road,
  // not a segment: it is shown as soon as the trip is under way.
  const warning = risk.official_warnings?.level === 'ACTIVE' ? risk.official_warnings.on_route[0] : null
  if (warning) {
    const severe = warning.severity === 'Extreme' || warning.severity === 'Severe'
    return {
      key: `${routeId}:warning:${warning.identifier}`,
      level: severe ? 'CRITICAL' : 'HIGH',
      title: `OFFICIAL ${warning.event.toUpperCase()} ALERT`,
      detail: `${warning.headline} (${warning.sender}, ${warning.severity})`,
      where: warning.area_desc,
      evidence,
    }
  }

  if (travelledM === null) return null

  // Steep ground or a recorded slide site inside the approach window. The
  // same run the card's "Next terrain" names, so the two never disagree.
  const run = nextTerrainRun(risk.terrain?.usable ? risk.terrain.segments : null, travelledM)
  const steep = run && run.cls === 'STEEP' && run.start_m - travelledM <= ALERT_AHEAD_M ? run : null
  const slide = nextHazard(points, risk.landslide_history?.events, travelledM)
  const slideAhead = slide && slide.at - travelledM <= ALERT_AHEAD_M ? slide : null
  if (!steep && !slideAhead) return null

  const exposure = risk.landslide_history?.exposure
  const parts: string[] = []
  if (steep) {
    const ahead = steep.start_m - travelledM
    parts.push(ahead <= 0 ? `Steep stretch now, ${km(steep.end_m - travelledM)} to go` : `Steep stretch in ${km(ahead)} · ${km(steep.end_m - steep.start_m)} long`)
  }
  if (slideAhead) {
    const ahead = slideAhead.at - travelledM
    parts.push(`${ahead < 500 ? 'Recorded landslide site here' : `Recorded landslide site in ${km(ahead)}`}${slideAhead.year ? ` (${slideAhead.year})` : ''}`)
  }
  const anchor = steep ? Math.round(steep.start_m) : Math.round(slideAhead!.at)
  const hold = risk.decision === 'HOLD_AND_REVIEW' || risk.decision === 'REROUTE_RECOMMENDED'
  return {
    key: `${routeId}:${steep ? 'steep' : 'slide'}:${anchor}`,
    level: hold ? 'HIGH' : 'CAUTION',
    title: slideAhead && exposure === 'HIGH' ? 'LANDSLIDE EXPOSURE AHEAD' : steep ? 'STEEP GROUND AHEAD' : 'RECORDED SLIDE SITE AHEAD',
    detail:
      exposure === 'HIGH'
        ? 'High historical exposure: steep terrain with recorded landslides on this corridor. Not a current incident.'
        : 'Steep gradient on the DEM profile. Slow down before the stretch, not on it.',
    where: parts.join(' · '),
    evidence,
  }
}
