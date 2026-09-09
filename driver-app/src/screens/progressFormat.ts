/**
 * Turning route progress into the words on a driver's screen.
 *
 * Pulled out of `ProgressCard` because this is where the honesty lives, and a
 * screen cannot be tested in this project - there is no React Native testing
 * library installed, and the app's convention is that logic is tested and
 * screens are thin. Formatting is logic.
 *
 * THE RULE EVERY FUNCTION HERE ENFORCES
 *
 *     null is a word, never a number.
 *
 * The backend is careful to send `null` rather than `0` when a figure cannot be
 * computed - a truck with no fix has not arrived. All of that care is undone by
 * a screen that renders `null` through a formatter and gets "0.0 km". "0 km
 * left" at the start of a shift is a lie the app would be telling entirely by
 * itself, on a screen the driver has no way to check.
 *
 * So each of these returns a WORD for absent and a number only for present, and
 * `0` - a real, measured zero - still formats as a number, because a truck that
 * genuinely has arrived should say so.
 */

/** What to show when a figure could not be computed at all. */
export const UNKNOWN = 'unknown'

/** What to show when a derived time has no pace to derive it from. */
export const NOT_WORKED_OUT = 'cannot be worked out'

export function formatDistanceKm(km: number | null | undefined): string {
  // `== null` catches undefined too. Number.isFinite rejects NaN and Infinity,
  // which JSON can genuinely carry and which would otherwise render as "NaN km".
  if (km == null || !Number.isFinite(km)) return UNKNOWN
  return `${km.toFixed(1)} km`
}

/**
 * Minutes remaining AT THE PLANNED PACE. Never an arrival time.
 *
 * The caller is responsible for saying what it assumes; this only refuses to
 * invent a number when there is none.
 */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return NOT_WORKED_OUT
  return `${Math.round(minutes)} min`
}

/**
 * How far off the planned road the truck is.
 *
 * Metres below a kilometre, kilometres above it: "1300 m" is a number a driver
 * has to convert while driving, and "1.3 km" is not.
 */
export function formatOffRoute(metres: number | null | undefined): string {
  if (metres == null || !Number.isFinite(metres)) return UNKNOWN
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${(metres / 1000).toFixed(1)} km`
}

/**
 * The off-route sentence, or null when there is nothing to say.
 *
 * Returns null rather than an empty string so a caller cannot render an empty
 * banner - a warning box with no words in it reads as a rendering bug and
 * teaches a driver to ignore the box.
 */
export function offRouteDetail(metres: number | null | undefined): string | null {
  if (metres == null || !Number.isFinite(metres)) {
    return 'Your position is away from the planned road.'
  }
  return `About ${formatOffRoute(metres)} from the planned road.`
}
