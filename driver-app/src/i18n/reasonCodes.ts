/**
 * Turning a backend reason code into something a driver can read.
 *
 * The backend never sends a sentence. It sends `HEAVY_RAIN_ON_ROUTE`, and this
 * is where that becomes "इस मार्ग पर भारी वर्षा" - from a file shipped inside
 * the app, with no model, no network call and no server round trip.
 *
 * THAT IS THE WHOLE POINT OF THE CONVENTION
 *
 * A driver in a valley on NH-715 with no signal reads the same warning as one
 * parked in Guwahati. A translation fetched on demand would be missing exactly
 * when the alert mattered, and a sentence built on the server would arrive in
 * English no matter who was holding the phone.
 *
 * IT NEVER THROWS AND NEVER RENDERS NOTHING
 *
 * An unknown code is a code this build has not been taught yet - a newer
 * backend, a rolled-back app. The fallback chain is: requested language, then
 * English, then the code itself. The last one is ugly on screen and it is
 * still better than a blank space where a warning should be, and better than a
 * crash on a truck. `backend/tests/test_reason_code_coverage.py` exists so the
 * ugly case does not happen in practice.
 *
 * THE CATALOGUE IS MIRRORED, NOT FORKED
 *
 * `i18n/reason_codes.json` at the repository root is the source of truth; this
 * copy exists because Metro will not resolve imports above the app root
 * without extra configuration. The backend suite asserts the two are
 * byte-identical, so the mirror cannot quietly drift.
 */

import catalogue from './reasonCodes.json'

export type Language = 'en' | 'hi' | 'as'

export const LANGUAGES: readonly Language[] = ['en', 'hi', 'as'] as const

export const LANGUAGE_NAMES: Record<Language, string> = {
  // Each language names ITSELF, in its own script. A picker that lists
  // "Assamese" in English is a picker for people who already read English.
  en: 'English',
  hi: 'हिन्दी',
  as: 'অসমীয়া',
}

interface Entry {
  speak: boolean
  en: string
  hi: string
  as: string
}

const CODES = (catalogue as { codes: Record<string, Entry> }).codes

/** Whether this build knows how to render a code at all. */
export function isKnownReasonCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(CODES, code)
}

/**
 * A reason code as a sentence, in `language`.
 *
 * Falls back through English to the raw code. Returning the code rather than
 * an empty string is deliberate: a dispatcher reading a support call can act
 * on `VEHICLE_OFF_PLANNED_ROUTE`, and nobody can act on "".
 */
export function translateReasonCode(code: string, language: Language): string {
  const entry = CODES[code]
  if (!entry) return code
  return entry[language] || entry.en || code
}

/**
 * Whether this code is cleared to be read aloud.
 *
 * Opt-in per code, and unknown codes are silent. A build that spoke everything
 * it did not recognise would narrate a backend's internal vocabulary at a
 * driver on a hill road.
 */
export function shouldSpeak(code: string): boolean {
  return CODES[code]?.speak === true
}

/**
 * The subset of `codes` worth saying out loud, in the order given.
 *
 * Filtered rather than sorted by severity: the backend already returns its
 * reason codes most-relevant first, and re-ranking them here would be this
 * layer inventing a judgement it has no evidence for.
 */
export function spokenCodes(codes: readonly string[]): string[] {
  return codes.filter(shouldSpeak)
}

/**
 * One spoken line from a list of reason codes.
 *
 * Joined with a full stop so a speech engine pauses between them, and capped:
 * a driver cannot hold six warnings, and the ones after the third are read
 * while they are still thinking about the first. Anything cut is still on
 * screen.
 */
export const MAX_SPOKEN_ALERTS = 3

export function speechFor(
  codes: readonly string[],
  language: Language,
): string | null {
  const speakable = spokenCodes(codes).slice(0, MAX_SPOKEN_ALERTS)
  if (speakable.length === 0) return null
  return speakable.map((c) => translateReasonCode(c, language)).join('. ')
}
