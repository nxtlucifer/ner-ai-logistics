/**
 * PERSONAL ROUTE AI - the card's words, from the engine's evidence.
 *
 * Nothing here decides anything. The backend's deterministic engine scored
 * the road and `app/domain/reroute.driver_decision` turned that into one of
 * four instructions; this module only puts them into a driver's sentences,
 * in the driver's language, from the reason-code catalogue the backend
 * publishes. It cannot add a factor the payload does not carry, and a payload
 * with no decision is said to have none.
 *
 * Pure, so the card's wording can be pinned by a test and cannot drift
 * between the live read and the offline package's stored copy.
 */

import type { RouteRisk } from '../api/client'
import { translateReasonCode, type Language } from '../i18n/reasonCodes'

export type Decision = 'CONTINUE' | 'CAUTION' | 'HOLD_AND_REVIEW' | 'REROUTE_RECOMMENDED'

export interface RouteAiCard {
  decision: Decision | null
  headline: string
  /** One or two sentences from the highest-priority reason codes present. */
  lines: string[]
  /** "STEEP · 4.2 km" - the next hilly/steep run ahead, or null. */
  nextTerrain: string | null
  /** LOW / MODERATE / HIGH / UNKNOWN from the history inventory. */
  landslide: string | null
  /** "current · 5 obs" when the engine scored live weather, "not available" otherwise. */
  weather: string | null
  /** "5 / 10 factors available" */
  evidence: string
}

/** What the driver hears first. Situation before setup: a road under heavy
 *  rain outranks "the weather feed was partial". */
const PRIORITY: readonly string[] = [
  'BETTER_ROUTE_AVAILABLE',
  'SEVERE_CONDITIONS_ON_ROUTE',
  'LANDSLIDE_OFFICIAL_ROAD_CLOSURE',
  'LANDSLIDE_OFFICIAL_INCIDENT_ON_ROUTE',
  'LANDSLIDE_CORROBORATED_INCIDENT_ON_ROUTE',
  'HEAVY_RAIN_ON_ROUTE',
  'STEEP_GRADIENT_ON_ROUTE',
  'HIGH_WIND_GUSTS',
  'LANDSLIDE_HISTORY_ON_ROUTE',
  'MODERATE_RAIN_ON_ROUTE',
  'HEAVY_RECENT_RAINFALL',
  'LANDSLIDE_UNVERIFIED_REPORT_ON_ROUTE',
  'NO_BETTER_ALTERNATIVE',
  'SELECTED_ROUTE_DETERIORATED',
  'LONG_TRAVEL_DURATION',
  'LONG_DISTANCE',
  'WEATHER_UNAVAILABLE',
  'TERRAIN_DATA_UNAVAILABLE',
]

export const HEADLINES: Record<Decision, string> = {
  CONTINUE: 'Continue',
  CAUTION: 'Caution',
  HOLD_AND_REVIEW: 'Hold — review with dispatch',
  REROUTE_RECOMMENDED: 'Reroute recommended',
}

const km = (m: number) => (m >= 950 ? `${(m / 1000).toFixed(m >= 9_500 ? 0 : 1)} km` : `${Math.round(m / 100) * 100} m`)

/**
 * The next hilly or steep run at or after `travelledM`, as "STEEP · 4.2 km"
 * (distance to it) or "STEEP · now, 1.2 km to go". Null without a fix: with
 * no position there is no "next", and the whole-route figures are on the
 * details sheet instead.
 */
/** The next contiguous hilly/steep run at or after `travelledM`, labelled by its worst class. */
export function nextTerrainRun(
  segments: readonly { start_m: number; end_m: number; terrain_class: string }[] | null | undefined,
  travelledM: number | null,
): { cls: string; start_m: number; end_m: number } | null {
  if (!segments || travelledM === null) return null
  const marked = segments.filter((s) => s.terrain_class === 'HILLY' || s.terrain_class === 'STEEP')
  const index = marked.findIndex((s) => s.end_m > travelledM)
  if (index === -1) return null
  const next = marked[index]
  let end = next.end_m
  let cls = next.terrain_class
  for (let i = index + 1; i < marked.length; i += 1) {
    const s = marked[i]
    if (Math.abs(s.start_m - end) >= 1) break
    end = s.end_m
    if (s.terrain_class === 'STEEP') cls = 'STEEP'
  }
  return { cls, start_m: next.start_m, end_m: end }
}

export function nextTerrain(
  segments: readonly { start_m: number; end_m: number; terrain_class: string }[] | null | undefined,
  travelledM: number | null,
): string | null {
  const run = nextTerrainRun(segments, travelledM)
  if (!run || travelledM === null) return null
  const ahead = run.start_m - travelledM
  return ahead <= 0 ? `${run.cls} · now, ${km(run.end_m - travelledM)} to go` : `${run.cls} · ${km(ahead)}`
}

export function routeAiCard(
  risk: RouteRisk | null,
  travelledM: number | null,
  language: Language,
): RouteAiCard {
  if (risk === null) {
    return {
      decision: null,
      headline: 'No assessment',
      lines: ['The route assessment is not available. This is not a statement that the road is clear.'],
      nextTerrain: null,
      landslide: null,
      weather: null,
      evidence: '0 of 0 evidence factors available',
    }
  }
  const decision = (risk.decision ?? null) as Decision | null
  const codes = new Set([...(risk.reason_codes ?? []), ...(risk.decision_reason_codes ?? [])])
  const lines = PRIORITY.filter((c) => codes.has(c))
    .slice(0, 2)
    .map((c) => translateReasonCode(c, language))
  const total = Object.keys(risk.inputs).length
  const available = Object.values(risk.inputs).filter((v) => v === 'AVAILABLE').length
  return {
    decision,
    headline: decision ? HEADLINES[decision] : `${risk.band} risk`,
    lines: lines.length ? lines : [`${risk.band} risk from the factors available.`],
    nextTerrain: nextTerrain(risk.terrain?.usable ? risk.terrain.segments : null, travelledM),
    landslide: risk.landslide_history?.exposure ?? null,
    weather:
      risk.inputs.weather === 'AVAILABLE'
        ? `current · ${risk.observations_used} obs${risk.observations_stale ? `, ${risk.observations_stale} stale` : ''}`
        : 'not available',
    evidence: `${available} of ${total} evidence factors available`,
  }
}
