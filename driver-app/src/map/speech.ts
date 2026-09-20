/**
 * Deciding WHAT to say and WHEN, with no speech engine in sight.
 *
 * Split from the hook so the policy - the part that can announce a turn twice,
 * announce a turn that no longer applies, or talk over itself - is testable
 * without a speech engine, a device, or React.
 *
 * NOTHING HERE GENERATES LANGUAGE. The sentence is `instructionFor`, the same
 * template the panel renders, so what the driver hears and what they read
 * cannot disagree. No model writes a turn.
 *
 * ONE SCHEDULER, NOT SPEECH CALLS SPREAD THROUGH THE UI
 *
 * Everything the app says during navigation is decided by `nextAnnouncement`:
 * turn cues, the combined cue for two turns in a row, and the state changes
 * (recalculating, route updated, GPS lost and recovered, arrival). There is one
 * place that can produce an utterance, one place that deduplicates, and one
 * precedence order between them - which is the only way "cancel the obsolete
 * one" is a statement about the whole app rather than about one component.
 *
 * WHY THE TRANSLATOR IS A PARAMETER
 *
 * It used to not be, and the module claimed above that what is heard and what
 * is read cannot disagree. They did: the panel renders `instructionFor(m, t)`
 * and this file called `instructionFor(m)`, so a driver with the app in Hindi
 * read "मुड़ें बाएँ" and heard "Turn left". The preamble was worse - "In 500
 * metres" had no translation path at all. Both now go through the same `t` the
 * panel uses.
 */

import type { NavigationManeuver } from '../api/client'
import { instructionFor } from './maneuvers'

/** Identity translator, so a caller with no catalogue still gets English. */
const EN = (en: string): string => en

/**
 * How much the app is allowed to say.
 *
 *   GUIDANCE  turn cues and state changes - the full experience
 *   ALERTS    state changes only: recalculating, GPS lost, arrival. No turn
 *             cues. For a driver who knows the road and wants to be told when
 *             something CHANGES, which is the only reason to keep audio on.
 *   MUTED     nothing. Not "quieter" - silent.
 *
 * An explicit tap on "repeat instruction" is not governed by this at all; see
 * `repeatInstruction`. Asking to hear something is not the app deciding to
 * talk, and a mode that swallowed a direct request would just look broken.
 */
export type VoiceMode = 'GUIDANCE' | 'ALERTS' | 'MUTED'

/**
 * The three cue stages, far to near.
 *
 * Three, not five. Every extra band is another sentence in a cab that already
 * has road noise in it, and the driver is looking at the same instruction on
 * screen the whole time.
 */
export type CueStage = 'ADVANCE' | 'APPROACH' | 'IMMEDIATE'

export const CUE_STAGES: readonly CueStage[] = ['ADVANCE', 'APPROACH', 'IMMEDIATE']

/**
 * Everything the scheduler's timing depends on, in one place.
 *
 * CANDIDATE SETTINGS, NOT UNIVERSAL RULES. These are this project's starting
 * figures, chosen to be legible and adjustable; they are not Google's
 * algorithm and nothing here was measured against it.
 */
export interface CueThresholds {
  /** Along-route distance at which each stage fires, metres. */
  distanceM: Record<CueStage, number>
  /**
   * Seconds of lead time each stage wants at the current speed.
   *
   * WHY DISTANCE ALONE IS NOT ENOUGH. 500 m is a comfortable warning in town
   * and eighteen seconds on a highway. The stage fires at whichever is
   * FARTHER - the fixed distance or what the truck covers in this many seconds
   * - so a cue arrives with time to act on it at speed without moving the
   * in-town cue kilometres out.
   */
  leadSeconds: Record<CueStage, number>
  /**
   * Two maneuvers closer together than this are one sentence, not two.
   *
   * "Turn right, then keep left" said once beats "turn right" followed four
   * seconds later by "keep left", which on a short urban link arrives after
   * the first turn has already been taken.
   */
  combineWithinM: number
  /**
   * Below this speed the lead-time widening is skipped, metres per second.
   *
   * A truck crawling in a jam has a speed that would compute a 40 m advance
   * cue; the fixed distances are the right answer there. ~18 km/h.
   */
  minSpeedMps: number
  /**
   * Shortest gap between two STATE announcements, milliseconds.
   *
   * A phone at the edge of coverage drops and regains its fix repeatedly, and
   * without this the driver hears "GPS signal lost" / "GPS signal restored"
   * alternating for as long as it lasts. The condition on screen still changes
   * immediately - only the voice waits.
   */
  eventCooldownMs: number
}

export const CUE_THRESHOLDS: CueThresholds = {
  // 2 km gives time to move across; 500 m is the commitment point on a
  // highway; 100 m is the turn itself.
  distanceM: { ADVANCE: 2000, APPROACH: 500, IMMEDIATE: 100 },
  leadSeconds: { ADVANCE: 75, APPROACH: 25, IMMEDIATE: 6 },
  combineWithinM: 150,
  minSpeedMps: 5,
  eventCooldownMs: 30_000,
}

/**
 * A change in state worth interrupting for, or null when nothing changed.
 *
 * These are CONDITIONS the caller reports each tick, not commands to speak.
 * The scheduler decides whether the condition is new.
 */
export type GuidanceEvent =
  | 'REROUTING'
  | 'ROUTE_UPDATED'
  | 'GPS_LOST'
  | 'GPS_RECOVERED'
  | 'OFF_ROUTE'
  | 'STOP_REACHED'
  | 'ARRIVED'

/**
 * What each state change says.
 *
 * Fixed sentences, in the same catalogue as everything else on screen. None of
 * them asserts anything the app does not know: "Recalculating route" is what
 * the app is doing, and the off-route line does not tell the driver to turn
 * around - improvising a U-turn to regain a corridor is not an instruction this
 * app gives.
 */
const EVENT_TEXT: Record<GuidanceEvent, string> = {
  REROUTING: 'Recalculating route.',
  ROUTE_UPDATED: 'Route updated.',
  GPS_LOST: 'GPS signal lost. Guidance paused.',
  GPS_RECOVERED: 'GPS signal restored.',
  OFF_ROUTE: 'You are off the planned route.',
  STOP_REACHED: 'You have reached your stop.',
  ARRIVED: 'You have arrived at your destination.',
}

/** Arrival is said once per route and never withdrawn; the rest can recur. */
const ONCE_PER_ROUTE: readonly GuidanceEvent[] = ['ARRIVED']

/**
 * Identity of one maneuver, stable across polls.
 *
 * `distance_from_start_m` is the maneuver's own position along the route, not
 * the truck's, so it does not change as the truck moves - but it DOES change
 * when the route is replanned, which is exactly when a queued announcement
 * must be considered obsolete.
 */
export function maneuverKey(maneuver: NavigationManeuver): string {
  return `${maneuver.type}|${maneuver.modifier ?? ''}|${maneuver.distance_from_start_m}`
}

export interface AnnouncementInput {
  next: { maneuver: NavigationManeuver; distanceM: number } | null
  /**
   * The maneuver after the next one, when there is one. Used only to decide
   * whether the two are close enough to be one sentence.
   */
  then?: NavigationManeuver | null
  /** The route version the maneuver belongs to. A change voids everything. */
  routeId: string | null
  /** How much the app may say. `muted` is the older boolean form of this. */
  mode?: VoiceMode
  /** Deprecated spelling of `mode: 'MUTED'`. Kept so callers need not change. */
  muted?: boolean
  /** Non-null whenever guidance is held; no TURN cue may be given during one. */
  held: boolean
  /** The condition to report this tick, or null when nothing changed. */
  event?: GuidanceEvent | null
  /** Ground speed from the fix, m/s. Null when the platform reported none. */
  speedMps?: number | null
  /** Monotonic clock, for the state-announcement cooldown. */
  now?: number
  /** The app's translator. Defaults to English. */
  t?: (en: string) => string
  /** Overridable for tests and tuning. */
  thresholds?: CueThresholds
}

/** What the caller already said, so the same thing is not said twice. */
export interface SpokenState {
  routeId: string | null
  /** `${routeId}|${maneuverKey}|${stage}` for every announcement made. */
  said: Set<string>
  /** The last state condition announced, so an unchanged one stays silent. */
  lastEvent: GuidanceEvent | null
  /** When that happened, for the cooldown. */
  lastEventAt: number
}

export function emptySpokenState(): SpokenState {
  return { routeId: null, said: new Set(), lastEvent: null, lastEventAt: 0 }
}

export interface Announcement {
  text: string
  /** The token recorded in `said`. Exposed so tests can assert it. */
  token: string
  /**
   * Why this is being said. The hook uses it for nothing; a caller that wants
   * to log or test precedence needs to tell a turn cue from a state change.
   */
  reason: 'TURN' | 'EVENT'
}

/** Whether this mode may give turn cues at all. */
export function speaksTurns(mode: VoiceMode): boolean {
  return mode === 'GUIDANCE'
}

/** Whether this mode may report state changes. */
export function speaksEvents(mode: VoiceMode): boolean {
  return mode === 'GUIDANCE' || mode === 'ALERTS'
}

/** `muted: true` is the same thing as `mode: 'MUTED'`; mode wins if both. */
function resolveMode(input: AnnouncementInput): VoiceMode {
  if (input.mode) return input.mode
  return input.muted ? 'MUTED' : 'GUIDANCE'
}

/**
 * The distance at which one stage fires, given the current speed.
 *
 * Whichever is farther: the fixed band, or the distance covered in that
 * stage's lead time. Speed is ignored below `minSpeedMps` and whenever the
 * platform did not report one - an absent speed must not shrink a cue.
 */
export function stageTriggerM(
  stage: CueStage,
  speedMps: number | null | undefined,
  thresholds: CueThresholds = CUE_THRESHOLDS,
): number {
  const fixed = thresholds.distanceM[stage]
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < thresholds.minSpeedMps) {
    return fixed
  }
  return Math.max(fixed, speedMps * thresholds.leadSeconds[stage])
}

/**
 * The sentence for one maneuver, combined with the one after it when they are
 * close enough to be a single instruction.
 */
export function instructionText(
  maneuver: NavigationManeuver,
  then: NavigationManeuver | null | undefined,
  thresholds: CueThresholds = CUE_THRESHOLDS,
  t: (en: string) => string = EN,
): string {
  const first = instructionFor(maneuver, t)
  if (!then) return first
  const gap = then.distance_from_start_m - maneuver.distance_from_start_m
  // A non-positive gap means the two are not in order, which is a provider or
  // caller problem and not something to render as an instruction.
  if (!(gap > 0) || gap > thresholds.combineWithinM) return first
  return `${first}, ${t('then')} ${instructionFor(then, t)}`
}

/** "In 500 metres" / "In 2 kilometres", through the catalogue. */
function preamble(metres: number, t: (en: string) => string): string {
  if (metres >= 1000) {
    const km = metres / 1000
    const shown = Number.isInteger(km) ? String(km) : km.toFixed(1)
    return t('In %s kilometres').replace('%s', shown)
  }
  return t('In %s metres').replace('%s', String(Math.round(metres / 50) * 50))
}

/**
 * The one sentence to speak now, or null.
 *
 * PRECEDENCE. A state change outranks a turn cue, because the turn cue is
 * probably about to be wrong: a truck that has just gone off-route does not
 * need "in 500 metres, turn left" for a corridor it has left. Arrival outranks
 * everything.
 *
 * Returns null - and the caller cancels anything in flight - whenever guidance
 * must not be talking: muted, held, no upcoming turn, or a turn still further
 * away than the outermost stage. Silence is the default; speech is the
 * exception that has to earn itself.
 *
 * `state` is MUTATED on a hit, because the alternative is a caller that must
 * remember to record what it said and will one day forget, which is a stuck
 * loop repeating "turn left" every poll.
 */
export function nextAnnouncement(
  input: AnnouncementInput,
  state: SpokenState,
): Announcement | null {
  const t = input.t ?? EN
  const thresholds = input.thresholds ?? CUE_THRESHOLDS
  const mode = resolveMode(input)
  const now = input.now ?? 0

  // A new route version invalidates every announcement made against the old
  // one. Not clearing this is how a driver hears the previous corridor's turn.
  if (state.routeId !== input.routeId) {
    state.routeId = input.routeId
    state.said.clear()
    // The state condition is NOT cleared: "recalculating" was said about the
    // change that produced this very route, and repeating it now would be the
    // scheduler announcing its own bookkeeping.
  }

  if (mode === 'MUTED') return null

  // --- State changes, ahead of any turn cue -------------------------------
  //
  // Only a state change that is actually SPOKEN suppresses this tick's turn
  // cue. A condition that is merely still true must not: `REROUTING` can hold
  // for a minute, and a scheduler that returned early for as long as it lasted
  // would go silent on the turns either side of it. What blocks a turn cue is
  // `held`, which the caller derives from the position - not this.
  const event = input.event ?? null
  if (event === null) {
    state.lastEvent = null
  } else if (speaksEvents(mode)) {
    const once = ONCE_PER_ROUTE.includes(event)
    const token = `${input.routeId}|event:${event}`
    const alreadyOnce = once && state.said.has(token)
    const unchanged = !once && state.lastEvent === event
    const cooling =
      !once && state.lastEvent !== null && now - state.lastEventAt < thresholds.eventCooldownMs
    // Remember the condition either way, so the cooldown expiring does not then
    // announce a state that is by then old news.
    if (!once) state.lastEvent = event
    if (!alreadyOnce && !unchanged && !cooling) {
      state.lastEventAt = now
      if (once) state.said.add(token)
      return { text: t(EVENT_TEXT[event]), token, reason: 'EVENT' }
    }
  }

  // --- Turn cues ----------------------------------------------------------
  if (!speaksTurns(mode) || input.held || input.next === null || input.routeId === null) {
    return null
  }

  const { maneuver, distanceM } = input.next
  // The tightest stage the truck is already inside. Passing 2 km and 500 m
  // between two polls - which a 10-second cadence on a highway does - must
  // announce once, at the nearest, not twice in a row.
  let stage: CueStage | null = null
  for (const candidate of CUE_STAGES) {
    if (distanceM <= stageTriggerM(candidate, input.speedMps, thresholds)) stage = candidate
  }
  if (stage === null) return null

  const token = `${input.routeId}|${maneuverKey(maneuver)}|${stage}`
  if (state.said.has(token)) return null

  // Every stage the truck has already passed for this maneuver is marked said
  // too. Otherwise a fix that jumps from 2.5 km to 80 m announces the
  // immediate stage now and the approach stage never, which is fine - but a fix
  // that then drifts backwards to 300 m would announce it late and out of order.
  for (const candidate of CUE_STAGES) {
    if (distanceM <= stageTriggerM(candidate, input.speedMps, thresholds)) {
      state.said.add(`${input.routeId}|${maneuverKey(maneuver)}|${candidate}`)
    }
  }

  const sentence = instructionText(maneuver, input.then, thresholds, t)
  // At the turn itself "in 100 metres" is already stale by the time it is
  // heard, so the nearest stage drops the preamble.
  //
  // The preamble quotes the STAGE's distance, not the truck's: "in 500 metres"
  // for a cue that fired at 487 m is what a driver expects to hear, and
  // "in 487 metres" is precision the fix does not have.
  const text =
    stage === 'IMMEDIATE'
      ? sentence
      : // NOT lower-cased. This string is only ever spoken, so the case is
        // inaudible - but `toLowerCase()` turns "NH27" into "nh27", which a
        // speech engine reads as a word rather than a road number.
        `${preamble(stageTriggerM(stage, input.speedMps, thresholds), t)}, ${sentence}`

  return { text, token, reason: 'TURN' }
}

/**
 * The sentence for an explicit "repeat instruction" tap, or null.
 *
 * NOT governed by the voice mode and NOT deduplicated: the driver asked, so
 * saying it again is the whole point, and a muted app that ignored the request
 * would be indistinguishable from a broken one.
 *
 * Still null while guidance is held or there is no maneuver - there is no
 * current instruction to repeat, and inventing one for a truck whose position
 * is unknown is the failure this module exists to prevent. The control is
 * disabled in that state rather than silently doing nothing.
 */
export function repeatInstruction(
  input: Pick<AnnouncementInput, 'next' | 'then' | 'held' | 'thresholds' | 't'>,
): string | null {
  if (input.held || !input.next) return null
  const t = input.t ?? EN
  const thresholds = input.thresholds ?? CUE_THRESHOLDS
  const { maneuver, distanceM } = input.next
  const sentence = instructionText(maneuver, input.then, thresholds, t)
  // A repeat DOES carry the real current distance, unlike a staged cue: the
  // driver asked "what now", and the honest answer is where the turn actually
  // is, rounded the way the panel rounds it.
  if (distanceM < thresholds.distanceM.IMMEDIATE) return sentence
  return `${preamble(distanceM, t)}, ${sentence}`
}

/** The spoken form of one state change, for a caller that needs the text. */
export function eventText(event: GuidanceEvent, t: (en: string) => string = EN): string {
  return t(EVENT_TEXT[event])
}
