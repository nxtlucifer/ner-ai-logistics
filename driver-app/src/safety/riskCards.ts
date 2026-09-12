/**
 * The route-risk payload, turned into one card per safety factor.
 *
 * Pure. No network, no storage, no clock of its own - `now` is passed in, the
 * same arrangement `breaks.ts` uses, so every age this file prints is testable
 * without waiting for it.
 *
 * WHY A CARD PER FACTOR RATHER THAN A SCORE
 *
 * `band=LOW score=20` computed from three of ten inputs is not the same claim
 * as `LOW`, and the difference is the entire point of this screen. So each
 * factor answers six questions in the same order every time:
 *
 *   STATE      did this input answer at all
 *   SEVERITY   how much it contributed
 *   WHY        the engine's own words for that contribution
 *   SOURCE     who would have answered
 *   FRESHNESS  how old the reading behind it is
 *   ACTION     what the driver does about it
 *
 * UNKNOWN IS NOT SAFE, AND IT IS NOT DANGEROUS EITHER
 *
 * A factor whose provider is not connected gets severity UNKNOWN - never NONE.
 * NONE is a claim ("this was measured and contributed nothing") and only a
 * factor that actually answered may make it. The ACTION for an UNKNOWN factor
 * always hands the judgement back to the driver rather than reassuring them.
 *
 * NOTHING HERE INVENTS A NUMBER
 *
 * Every point value, label and detail string comes from the payload. This file
 * chooses a heading, a source name and an action sentence; it never computes a
 * risk. The two thresholds it does own are mirrored from the engine - see
 * BAND_MODERATE_AT below.
 */

import type { LandslideHistoryRead, RouteRisk, TerrainRead } from '../api/client'
import { formatElapsed } from './breaks'

export type FactorState = 'AVAILABLE' | 'NOT_AVAILABLE'

export type Severity = 'UNKNOWN' | 'NONE' | 'LOW' | 'MODERATE' | 'HIGH'

export interface RiskCard {
  /** Raw factor key from `inputs`, e.g. `road_quality`. Stable, for keys. */
  factor: string
  title: string
  state: FactorState
  severity: Severity
  /** Points this factor contributed to the total. */
  points: number
  why: string
  source: string
  freshness: string
  action: string
}

/**
 * Mirrored from `backend/app/domain/route_risk.py` (BAND_MODERATE_AT,
 * BAND_HIGH_AT). Used here to band ONE factor's contribution, which is a
 * meaningful reading of those numbers rather than a new threshold: a factor
 * contributing 30 points is by itself enough to put the whole route in
 * MODERATE, and 60 enough to put it in HIGH.
 */
export const SEVERITY_MODERATE_AT = 30
export const SEVERITY_HIGH_AT = 60

/** Component code -> the factor in `inputs` it belongs to. Weather emits two. */
const COMPONENT_FACTOR: Record<string, string> = {
  RAIN_EXPOSURE: 'weather',
  WIND_EXPOSURE: 'weather',
  DURATION_EXPOSURE: 'duration',
  DISTANCE_EXPOSURE: 'distance',
  LANDSLIDE_EXPOSURE: 'landslide',
  TERRAIN_EXPOSURE: 'elevation',
  LANDSLIDE_HISTORY_EXPOSURE: 'historical_incidents',
}

interface FactorMeta {
  title: string
  /** Who would answer this, whether or not they did. STATE says if they did. */
  source: string
  /** Contributed points. */
  scored: string
  /** Answered, contributed nothing. */
  clear: string
  /** Did not answer. Never reassuring. */
  unknown: string
}

/** Declared order. Also the fallback ordering for factors that tie. */
const FACTORS: Record<string, FactorMeta> = {
  weather: {
    title: 'Weather',
    source: 'Open-Meteo readings along the corridor',
    scored:
      'Slow down and lengthen your following distance. Stop somewhere safe if you cannot see the road.',
    clear: 'Current readings added nothing to the score. Conditions can still change ahead of you.',
    unknown:
      'No current readings. Judge the sky and the road surface yourself — this is not a report that the weather is fine.',
  },
  landslide: {
    title: 'Landslide',
    source: 'Landslide incident provider',
    scored:
      'Do not stop or park under a cut slope. Report any blockage or fresh debris to dispatch.',
    clear: 'No recorded incidents on this corridor.',
    unknown:
      'No landslide source answered for this corridor. Watch cut slopes yourself, especially after rain.',
  },
  duration: {
    title: 'Time on the road',
    source: 'Selected route geometry',
    scored: 'A long shift. Decide where you will stop before you set off, not when you are tired.',
    clear: 'Not long enough to add exposure to the score.',
    unknown: 'Not measured on this assessment.',
  },
  distance: {
    title: 'Distance',
    source: 'Selected route geometry',
    scored: 'Plan fuel and rest stops for the whole distance before you leave.',
    clear: 'Not far enough to add exposure to the score.',
    unknown: 'Not measured on this assessment.',
  },
  fuel_model: {
    title: 'Fuel range',
    source: 'Fuel physics model',
    scored: 'Refuel before the stretch this flags, not after it.',
    clear: 'The range estimate added nothing to the score.',
    unknown: 'No range estimate. Check your own fuel against the corridor before you start.',
  },
  flood: {
    title: 'River levels',
    source: 'GloFAS river discharge via Open-Meteo',
    scored: 'Rivers near the road are well above their recent average. Do not enter standing water. Turn back and tell dispatch.',
    clear: 'River levels near the road are close to their recent average. Not a flood forecast - check low crossings yourself.',
    unknown: 'Not measured. Check water levels yourself at low crossings and causeways.',
  },
  official_warnings: {
    title: 'Official alerts',
    source: 'NDMA SACHET (CAP)',
    scored: 'A government alert names a district on this road. Read it in Details and call dispatch before the stretch.',
    clear: 'No government alert names a district on this road right now.',
    unknown: 'Not checked. Listen for local warnings and ask dispatch.',
  },
  road_quality: {
    title: 'Road quality',
    source: 'Road-condition provider',
    scored: 'Expect broken surface. Reduce speed before the stretch, not on it.',
    clear: 'No surface problems reported.',
    unknown: 'Not measured. Judge the surface and the width yourself.',
  },
  truck_restrictions: {
    title: 'Truck restrictions',
    source: 'Restriction provider',
    scored: 'A restriction applies to this vehicle. Confirm with dispatch before you commit to it.',
    clear: 'No restriction reported for this vehicle on this corridor.',
    unknown: 'Not measured. Read the posted height, width and weight limits yourself.',
  },
  historical_incidents: {
    title: 'Landslide history',
    source: 'NASA Global Landslide Catalog, bundled 2007–2017 inventory',
    scored:
      'This corridor has slid before. Watch cut slopes and debris after rain, and do not stop under them.',
    clear: 'No recorded landslides along this corridor in the inventory. That inventory ends in 2017.',
    unknown: 'Not measured. No past-incident history informs this score.',
  },
  elevation: {
    title: 'Terrain',
    source: 'Copernicus DEM GLO-90 via Open-Meteo',
    scored: 'Sustained gradient. Use engine braking on the descent and let the brakes cool.',
    clear: 'No stretch at 10% grade or steeper. Hills are still hills — read the road.',
    unknown: 'Not measured. Gradient and altitude are not in this score.',
  },
}

const ORDER = Object.keys(FACTORS)

/**
 * The driver-facing name for a risk-engine factor key, or null if this build
 * has no name for it.
 *
 * Exported so the assistant's "not included" list says "Fuel range" - the same
 * words as the Safety card and the manager's evidence panel. Three surfaces
 * describing the same ten factors should not each invent their own vocabulary.
 */
export function factorTitle(key: string): string | null {
  return FACTORS[key]?.title ?? null
}

/** A factor the backend added and this build has not been taught yet. It gets
 *  a card rather than being dropped: a silently omitted safety input is the
 *  one failure this screen exists to prevent. */
function unknownFactor(key: string): FactorMeta {
  const title = key.replace(/_/g, ' ')
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    source: 'Not named by this app version',
    scored: 'Contributed to the score. This app version cannot explain it — ask dispatch.',
    clear: 'Answered and contributed nothing.',
    unknown: 'Not measured.',
  }
}

function severityFor(state: FactorState, points: number): Severity {
  if (state === 'NOT_AVAILABLE') return 'UNKNOWN'
  if (points >= SEVERITY_HIGH_AT) return 'HIGH'
  if (points >= SEVERITY_MODERATE_AT) return 'MODERATE'
  if (points > 0) return 'LOW'
  return 'NONE'
}

/** "just now" / "12m ago" / "3h 04m ago". Never a bare zero. */
export function ageLabel(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return 'age not known'
  if (minutes < 1) return 'just now'
  return `${formatElapsed(minutes)} ago`
}

function minutesSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return null
  return Math.max(0, Math.floor((now - then) / 60_000))
}

/**
 * One card per factor in `inputs`, worst first.
 *
 * Ordered by contribution, then by UNKNOWN ahead of NONE - a factor nobody
 * measured is more worth a driver's attention than one that was measured and
 * came back at zero. Ties fall back to the declared order above so the list
 * does not reshuffle between refreshes.
 */
export function riskCards(risk: RouteRisk, now: number): RiskCard[] {
  const assessedAge = minutesSince(risk.assessed_at, now)

  const byFactor = new Map<string, { points: number; details: string[] }>()
  for (const component of risk.components) {
    const factor = COMPONENT_FACTOR[component.code] ?? component.code.toLowerCase()
    const entry = byFactor.get(factor) ?? { points: 0, details: [] }
    entry.points += component.points
    if (component.detail) entry.details.push(component.detail)
    byFactor.set(factor, entry)
  }

  const cards = Object.entries(risk.inputs).map(([factor, rawState]) => {
    const meta = FACTORS[factor] ?? unknownFactor(factor)
    const state: FactorState = rawState === 'AVAILABLE' ? 'AVAILABLE' : 'NOT_AVAILABLE'
    const scored = byFactor.get(factor)
    const points = scored?.points ?? 0
    let severity = severityFor(state, points)

    // The engine's own sentence wherever it produced one - including for a
    // factor that did NOT answer, because "no landslide data for this
    // corridor" is exactly the thing the driver needs to read.
    let why =
      scored && scored.details.length > 0
        ? scored.details.join(' · ')
        : state === 'AVAILABLE'
          ? 'Measured for this route. It added nothing to the score.'
          : 'No source answered for this corridor, so it was not scored.'

    let freshness =
      state === 'NOT_AVAILABLE'
        ? 'No reading to age'
        : factor === 'weather'
          ? `${risk.observations_used} current reading${risk.observations_used === 1 ? '' : 's'}, ` +
            `${risk.observations_stale} stale · assessed ${ageLabel(assessedAge)}`
          : `Assessed ${ageLabel(assessedAge)}`

    // Two factors carry their own evidence block on the wire. Their WHY and
    // FRESHNESS come from that block rather than from the one-line component
    // detail, because "13 slides within 5 km, nearest 0.4 km, inventory ends
    // 2017" is the evidence and "+15" is only its weight.
    const terrain = risk.terrain
    if (factor === 'elevation' && terrain) {
      why = terrainWhy(terrain)
      freshness =
        `${Math.round(terrain.coverage * 100)}% of ${terrain.samples_requested} samples answered · ` +
        `profile fetched ${ageLabel(minutesSince(terrain.fetched_at, now))}`
    }
    const history = risk.landslide_history
    if (factor === 'historical_incidents' && history) {
      if (history.exposure !== 'UNKNOWN') severity = history.exposure as Severity
      why = historyWhy(history)
      freshness =
        history.inventory_from_year !== null && history.inventory_to_year !== null
          ? `Inventory covers ${history.inventory_from_year}–${history.inventory_to_year}` +
            (history.reason_codes.includes('LANDSLIDE_HISTORY_INVENTORY_AGED')
              ? ' — aged, recent years not covered'
              : '')
          : 'Inventory years not stated'
    }

    const action =
      state === 'NOT_AVAILABLE' ? meta.unknown : points > 0 ? meta.scored : meta.clear

    return {
      factor,
      title: meta.title,
      state,
      severity,
      points,
      why,
      source: meta.source,
      freshness,
      action,
    }
  })

  const rank = (card: RiskCard) => {
    const declared = ORDER.indexOf(card.factor)
    return [
      -card.points,
      card.severity === 'UNKNOWN' ? 0 : 1,
      declared === -1 ? ORDER.length : declared,
    ]
  }
  return cards.sort((a, b) => {
    const [ap, au, ad] = rank(a)
    const [bp, bu, bd] = rank(b)
    return ap - bp || au - bu || ad - bd
  })
}

function terrainWhy(t: TerrainRead): string {
  const range =
    t.min_elevation_m !== null && t.max_elevation_m !== null
      ? `${Math.round(t.min_elevation_m)}–${Math.round(t.max_elevation_m)} m`
      : 'height range not known'
  const steep =
    t.steep_km > 0
      ? `${t.steep_km.toFixed(1)} km at 10% grade or steeper`
      : 'no stretch at 10% grade or steeper'
  return `${range} · ${Math.round(t.total_ascent_m)} m of climbing · steepest ${t.max_grade_pct.toFixed(1)}% · ${steep}`
}

function historyWhy(h: LandslideHistoryRead): string {
  if (h.exposure === 'UNKNOWN') return 'The inventory could not be read for this corridor.'
  const placed =
    h.on_route_count === 0
      ? 'No recorded landslide within 5 km of the route'
      : `${h.on_route_count} recorded landslide${h.on_route_count === 1 ? '' : 's'} within 5 km of the route` +
        (h.nearest_km !== null ? `, nearest ${h.nearest_km.toFixed(1)} km away` : '')
  const imprecise =
    h.imprecise_count > 0
      ? ` · ${h.imprecise_count} more nearby placed too imprecisely to count`
      : ''
  return placed + imprecise
}

export interface RiskSummary {
  band: string
  score: number
  available: number
  total: number
  unavailable: number
  /** Age of the SERVER's assessment, on this device's clock. */
  assessedLabel: string
}

/** The one line that must never appear without its gaps. */
export function riskSummary(risk: RouteRisk, now: number): RiskSummary {
  const total = Object.keys(risk.inputs).length
  const unavailable = risk.unavailable.length
  return {
    band: risk.band,
    score: risk.score,
    available: total - unavailable,
    total,
    unavailable,
    assessedLabel: ageLabel(minutesSince(risk.assessed_at, now)),
  }
}
