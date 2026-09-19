/**
 * Date entry for the documents and insurance forms.
 *
 * THREE DEFECTS THIS FIXES
 *
 * 1. The field asked for `YYYY-MM-DD` and opened a NUMERIC keypad. Most
 *    Android numeric keypads have no hyphen, so the requested format was
 *    literally untypeable on the phone the app ships to. `autoFormat` puts
 *    the separators in as digits arrive, so the numeric keypad becomes the
 *    right keyboard rather than the wrong one.
 *
 * 2. Nothing was validated before the request. "31-01-2024", "2024-13-45"
 *    and "hello" all went to the server, which rejected them, so the driver
 *    learned about a typo through a backend error banner.
 *
 * 3. An expiry BEFORE the issue date was accepted by both sides.
 *
 * All pure, so the screen stays a screen and this is what gets tested.
 */

/** Digits only, hyphens re-inserted: 20240131 -> 2024-01-31. */
export function autoFormat(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 4) return digits
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`
}

/**
 * Is this a real calendar date written as YYYY-MM-DD?
 *
 * `new Date('2024-02-31')` does NOT throw - it rolls over to 2 March - so
 * the parsed parts are compared back against the input. Rolling over would
 * mean a licence "expiring" on a day that does not exist.
 */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false
  const parsed = new Date(Date.UTC(y, m - 1, d))
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d
  )
}

export interface DateProblems {
  issued?: string
  expires?: string
}

/**
 * What is wrong with the two dates, as messages to put under the fields.
 *
 * Both are optional on the server, so blank is not an error here. An
 * incomplete date IS: a half-typed `2024-01` would otherwise be sent and
 * refused.
 */
export function checkDates(issued: string, expires: string): DateProblems {
  const problems: DateProblems = {}
  const i = issued.trim()
  const e = expires.trim()

  if (i && !isCalendarDate(i)) problems.issued = 'Use YYYY-MM-DD, for example 2024-01-31.'
  if (e && !isCalendarDate(e)) problems.expires = 'Use YYYY-MM-DD, for example 2028-01-31.'

  if (!problems.issued && !problems.expires && i && e && i > e) {
    // String comparison is correct for ISO dates and needs no Date object.
    problems.expires = 'Expiry cannot be before the issue date.'
  }
  return problems
}

/** Longest value each field accepts. A document number is not an essay. */
export const LIMITS = { number: 40, date: 10 } as const
