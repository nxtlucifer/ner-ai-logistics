/**
 * Turning a backend reason code into something a dispatcher can read.
 *
 * The same catalogue the driver app ships, for the same reason: the backend
 * never builds a sentence, it emits `HEAVY_RAIN_ON_ROUTE`, and exactly one
 * file decides what that means in English, Hindi and Assamese. A manager and
 * the driver they are calling must not be looking at two different wordings of
 * the same warning.
 *
 * WHY A MIRROR AND NOT AN IMPORT
 *
 * `i18n/reason_codes.json` at the repository root is the source of truth. Both
 * apps ship a copy because neither bundler resolves above its own root without
 * extra configuration, and configuring that is a build-time risk taken for an
 * aesthetic gain. `backend/tests/test_reason_code_coverage.py` asserts both
 * copies are byte-identical to the root, so a mirror cannot quietly become a
 * fork.
 *
 * NEVER THROWS, NEVER RENDERS NOTHING
 *
 * An unknown code is a newer backend than this build. The fallback chain is
 * requested language, then English, then the raw code - which is ugly on
 * screen and still better than a blank space where a warning should be. A
 * dispatcher on a phone call can act on `VEHICLE_OFF_PLANNED_ROUTE`; nobody
 * can act on "".
 */

import catalogue from './reasonCodes.json'

export type Language = 'en' | 'hi' | 'as'

export const LANGUAGES: readonly Language[] = ['en', 'hi', 'as'] as const

interface Entry {
  speak: boolean
  en: string
  hi: string
  as: string
}

const CODES = (catalogue as { codes: Record<string, Entry> }).codes

export function isKnownReasonCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(CODES, code)
}

export function translateReasonCode(
  code: string,
  language: Language = 'en',
): string {
  const entry = CODES[code]
  if (!entry) return code
  return entry[language] || entry.en || code
}

/**
 * Render a list of codes, dropping none.
 *
 * Every code the server sent is shown. Filtering to "the interesting ones"
 * here would be this layer deciding what a dispatcher may see, on no evidence
 * the server did not already have - and the codes that get dropped in that
 * kind of filter are the ones about missing data.
 */
export function translateReasonCodes(
  codes: readonly string[],
  language: Language = 'en',
): string[] {
  return codes.map((c) => translateReasonCode(c, language))
}

/**
 * A risk-engine factor key as something a dispatcher reads.
 *
 * `truck_restrictions` is a column name; "Truck restrictions" is evidence. The
 * driver app makes the same substitution in `src/safety/riskCards.ts`, and both
 * screens are describing the same ten factors - so the words match.
 *
 * Unknown keys are humanised rather than dropped: a factor this build has not
 * been taught is still a gap the dispatcher must see.
 */
export function factorLabel(factor: string): string {
  const named: Record<string, string> = {
    weather: 'Weather',
    landslide: 'Landslide',
    duration: 'Time on the road',
    distance: 'Distance',
    fuel_model: 'Fuel range',
    flood: 'River levels',
    official_warnings: 'Official alerts',
    road_quality: 'Road quality',
    truck_restrictions: 'Truck restrictions',
    historical_incidents: 'Past incidents',
    elevation: 'Elevation',
    traffic: 'Fleet traffic',
  }
  if (named[factor]) return named[factor]
  const words = factor.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The same list, joined for a sentence. */
export function factorLabels(factors: readonly string[]): string {
  return factors.map(factorLabel).join(', ')
}
