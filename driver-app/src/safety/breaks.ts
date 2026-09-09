/**
 * Break guidance.
 *
 * WHAT THIS MEASURES, AND WHAT IT DOES NOT
 *
 * It measures **elapsed time since the trip started, or since the driver last
 * recorded a break** - whichever is later. It does NOT measure driving time,
 * and it must never be labelled as such.
 *
 * The difference is not pedantry. A driver who started at 06:00 and spent two
 * of the last four hours waiting at a loading dock has not driven for four
 * hours, and telling them "4h continuous driving" is a false statement made by
 * the app about the person reading it. This build cannot tell driving from
 * waiting: the tracker distinguishes moving from stationary for the purpose of
 * GPS cadence, but that signal is not accumulated anywhere and a stationary
 * truck in traffic is not a resting driver. Until something measures it, the
 * honest quantity is elapsed time, and every string here says "since".
 *
 * IT DOES NOT DETECT FATIGUE
 *
 * There is no sensor here and no model. Fatigue detection needs validated
 * hardware this product does not have, and a system that claimed it would be
 * making a medical assertion about a person from a clock. This is a clock.
 *
 * THE THRESHOLDS ARE PROJECT CONSTANTS, NOT LAW
 *
 * Stated in the same way `route_risk` states its rainfall cut-offs: these are
 * this project's operational values, chosen to be conservative. They are NOT a
 * transcription of the Motor Transport Workers Act, of EU drivers' hours, or
 * of any carrier's policy, and nothing here should be presented as compliance
 * with a regulation. A deployment with a real policy should replace them.
 *
 * ADVICE, NEVER ENFORCEMENT
 *
 * Nothing in this module blocks a trip, and it must not start doing so. A
 * driver stopping is a decision made with information the phone does not have
 * - where the next safe place is, what the load is, what the weather is doing.
 * The app's job is to say the elapsed time out loud.
 */

/** Elapsed minutes at which the app first mentions a break. */
export const DUE_SOON_MINUTES = 210 // 3h 30m

/** At which it recommends one. */
export const RECOMMENDED_MINUTES = 240 // 4h

/** At which it says so more firmly. */
export const OVERDUE_MINUTES = 300 // 5h

export type BreakLevel = 'NONE' | 'DUE_SOON' | 'RECOMMENDED' | 'OVERDUE'

/**
 * Reason codes rather than sentences, following the same convention as the
 * backend's risk reasons: a sentence built here arrives in English no matter
 * who is holding the phone.
 */
export const REASON_SINCE_START = 'BREAK_ELAPSED_SINCE_TRIP_START'
export const REASON_SINCE_BREAK = 'BREAK_ELAPSED_SINCE_LAST_BREAK'
export const REASON_NOT_STARTED = 'BREAK_TRIP_NOT_STARTED'

export interface BreakAdvice {
  level: BreakLevel
  /**
   * Elapsed minutes since the later of trip start and last recorded break.
   * Null when the trip has not started, in which case there is nothing to
   * measure from - NOT zero, which would read as "just had a break".
   */
  elapsedMinutes: number | null
  /** Minutes until `RECOMMENDED`. Null once reached, or when unmeasurable. */
  minutesUntilRecommended: number | null
  reasonCode: string
  /** True when the elapsed span is measured from a break, not from the start. */
  sinceBreak: boolean
}

function parse(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/**
 * How long since the driver last stopped, and whether to say something.
 *
 * `now` is injected rather than read, so the thresholds can be tested across
 * the whole range without waiting four hours.
 */
export function assessBreak({
  startedAt,
  lastBreakAt,
  now,
}: {
  /** Server truth: `CurrentTrip.started_at`. */
  startedAt: string | null
  /** Local record of the driver tapping "I stopped for a break". */
  lastBreakAt: string | null
  now: number
}): BreakAdvice {
  const started = parse(startedAt)
  const lastBreak = parse(lastBreakAt)

  if (started === null) {
    return {
      level: 'NONE',
      elapsedMinutes: null,
      minutesUntilRecommended: null,
      reasonCode: REASON_NOT_STARTED,
      sinceBreak: false,
    }
  }

  // A break recorded BEFORE this trip began says nothing about this trip, and
  // one recorded in the future is a clock problem. Both fall back to the trip
  // start, which is the conservative direction: it can only ever make the
  // elapsed span longer, never shorter, and understating it is the failure
  // that matters here.
  const useBreak = lastBreak !== null && lastBreak > started && lastBreak <= now
  const from = useBreak ? (lastBreak as number) : started

  const elapsedMinutes = Math.max(0, Math.floor((now - from) / 60_000))

  let level: BreakLevel = 'NONE'
  if (elapsedMinutes >= OVERDUE_MINUTES) level = 'OVERDUE'
  else if (elapsedMinutes >= RECOMMENDED_MINUTES) level = 'RECOMMENDED'
  else if (elapsedMinutes >= DUE_SOON_MINUTES) level = 'DUE_SOON'

  return {
    level,
    elapsedMinutes,
    minutesUntilRecommended:
      elapsedMinutes >= RECOMMENDED_MINUTES
        ? null
        : RECOMMENDED_MINUTES - elapsedMinutes,
    reasonCode: useBreak ? REASON_SINCE_BREAK : REASON_SINCE_START,
    sinceBreak: useBreak,
  }
}

/**
 * An elapsed span, written the way a tired person reads it.
 *
 * "4h 07m", not "247 min". The project already makes this argument about
 * distance in `progressFormat.formatOffRoute` - "1300 m" is a number a driver
 * has to convert while driving - and it applies at least as strongly to a
 * duration being used to decide whether to stop.
 */
export function formatElapsed(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return 'not known'
  const whole = Math.max(0, Math.floor(minutes))
  const hours = Math.floor(whole / 60)
  const mins = whole % 60
  if (hours === 0) return `${mins}m`
  return `${hours}h ${String(mins).padStart(2, '0')}m`
}
