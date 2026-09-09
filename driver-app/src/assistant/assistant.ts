/**
 * Driver Assistant V1 — deterministic, offline, and it cannot act.
 *
 * WHY THERE IS NO MODEL IN HERE
 *
 * `docs/AI_MODELS.md` records `AI_ML = BLOCKED_BY_DATA` for this project, and
 * there is no LLM provider anywhere in the repository - no client, no
 * credential, no key. So V1 answers from application state and nothing else.
 * `composeAnswer` returns STRUCTURED facts rather than prose precisely so a
 * cloud model can later be handed those facts to word nicely without ever
 * being the thing that decides what is true. Truth here, wording there.
 *
 * THE SECURITY PROPERTY IS STRUCTURAL, NOT A GUARD
 *
 * This module imports no API client, no storage and no network. Every tool is
 * a pure function of an `AssistantContext` that was already fetched by the
 * caller. The assistant cannot change a route, close a trip or send a fix
 * because there is no code path here that could - not because a validator
 * says no. A validator can be bypassed by the next person to add a tool; an
 * absent import cannot. `assistant.test.ts` asserts the absence.
 *
 * IT NEVER INVENTS A FACT
 *
 * Every answer carries `unavailable`. A missing route progress produces
 * "not available", never a zero - the same rule `progressFormat` already
 * follows, for the same reason: "0 km left" at the start of a shift is a lie
 * the app would be telling by itself.
 *
 * CACHED IS NEVER CALLED LIVE
 *
 * Route risk comes from the offline package, which is a SNAPSHOT with a
 * capture time. Any answer built on it carries its age and is labelled
 * `cached`. A risk panel that still reads LOW six hours after the weather
 * turned is worse than no panel.
 */

import type { CurrentTrip, OfflineRisk, TripStop } from '../api/client'
import type { StoredPackage } from '../offline/packageStore'
import type { BreakAdvice } from '../safety/breaks'
import { formatElapsed } from '../safety/breaks'
import type { TrackerState } from '../tracking/tracker'

/** Everything the assistant is allowed to know. Assembled by the caller. */
export interface AssistantContext {
  trip: CurrentTrip | null
  /** When `trip` was last read from the server. Drives freshness. */
  tripLoadedAt: number | null
  tracking: TrackerState | null
  /** Cached route + risk snapshot, or null when nothing was downloaded. */
  offlinePackage: StoredPackage | null
  breakAdvice: BreakAdvice
  /** Whether the app currently believes it can reach the server. */
  online: boolean
  now: number
}

export type Intent =
  | 'MY_TRIP'
  | 'MY_ROUTE'
  | 'NEXT_STOP'
  | 'ROUTE_RISK'
  | 'BREAK'
  | 'CONNECTIVITY'
  | 'EMERGENCY'
  | 'TRANSLATE'
  | 'VEHICLE_ISSUE'
  | 'UNKNOWN'

/** One checkable statement. `value` is already formatted for display. */
export interface Fact {
  code: string
  label: string
  value: string
}

/** How old the information behind an answer is. */
export interface Freshness {
  ageMinutes: number
  /** True when the answer is built on a stored snapshot, not a live read. */
  cached: boolean
  stale: boolean
}

/**
 * What the driver may do next.
 *
 * Deliberately a closed set of NAVIGATION targets and nothing else. There is
 * no `CHANGE_ROUTE`, no `CLOSE_TRIP`, no `SEND_SOS` - a reroute is a manager
 * decision and this screen explains it rather than offering it.
 */
export type AllowedAction =
  | 'OPEN_SAFETY_GUIDE'
  | 'OPEN_PHRASEBOOK'
  | 'OPEN_TRIP'
  | 'RECORD_BREAK'
  | 'CONTACT_DISPATCH'

export interface Answer {
  intent: Intent
  /** Short, deterministic. Not model output. */
  headline: string
  facts: Fact[]
  /** Backend/domain codes, translated at render time. Never sentences. */
  reasonCodes: string[]
  freshness: Freshness | null
  allowedActions: AllowedAction[]
  /** Named missing inputs. An empty answer is never silently a confident one. */
  unavailable: string[]
}

const NOT_AVAILABLE = 'not available'

function minutesSince(then: number | null, now: number): number | null {
  if (then === null) return null
  return Math.max(0, Math.floor((now - then) / 60_000))
}

function km(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return NOT_AVAILABLE
  return `${value.toFixed(1)} km`
}

// --- Allowlisted tools ----------------------------------------------------
// Every one is a pure read of the context. There is no writer in this file
// and no import that could become one.

export function get_current_trip(ctx: AssistantContext): CurrentTrip | null {
  return ctx.trip
}

export function get_route_progress(ctx: AssistantContext) {
  return ctx.trip?.progress ?? null
}

export function get_next_stop(ctx: AssistantContext): TripStop | null {
  const trip = ctx.trip
  if (!trip || !trip.next_stop_id) return null
  return trip.stops.find((s) => s.id === trip.next_stop_id) ?? null
}

/** The CACHED risk snapshot. Never a live read - see the module docstring. */
export function get_route_risk(
  ctx: AssistantContext,
): { risk: OfflineRisk; capturedAt: string | null } | null {
  const pkg = ctx.offlinePackage?.packageData
  if (!pkg?.risk) return null
  return { risk: pkg.risk, capturedAt: pkg.risk_captured_at }
}

export function get_connectivity_status(ctx: AssistantContext) {
  return {
    online: ctx.online,
    queueDepth: ctx.tracking?.queueDepth ?? null,
    persistence: ctx.tracking?.persistence ?? null,
    permission: ctx.tracking?.permission ?? null,
    isTracking: ctx.tracking?.isTracking ?? false,
  }
}

export function get_break_status(ctx: AssistantContext): BreakAdvice {
  return ctx.breakAdvice
}

/**
 * The assistant does not carry medical knowledge. It points at the ONE
 * curated catalogue, by id. Duplicating any of it here would create a second
 * copy to drift, and the copy that drifts is the one read at a roadside.
 */
export function get_emergency_guide(): { topicIds: string[] } {
  return { topicIds: ['SEVERE_BLEEDING', 'HEART_ATTACK', 'STROKE', 'UNCONSCIOUS'] }
}

export function get_translation_phrase(): { categoryIds: string[] } {
  return { categoryIds: ['EMERGENCY', 'BREAKDOWN', 'ROAD'] }
}

/**
 * The allowlist, as data.
 *
 * A tool that is not in here cannot be reached by `answer`. Kept explicit so
 * the set is reviewable at a glance and so a test can assert what is in it.
 */
export const TOOLS = {
  get_current_trip,
  get_route_progress,
  get_next_stop,
  get_route_risk,
  get_connectivity_status,
  get_break_status,
  get_emergency_guide,
  get_translation_phrase,
} as const

export type ToolName = keyof typeof TOOLS

// --- Question catalogue ---------------------------------------------------

export interface Question {
  id: string
  intent: Intent
  /** Quick-action label. Short enough for a gloved thumb on a 320 px screen. */
  label: string
}

/**
 * Quick actions, not a text box.
 *
 * Mission Phase 10 requires minimising keyboard interaction while the vehicle
 * is moving, and there is no reliable moving/stationary signal in this build
 * to gate a text field behind. So the interface is quick-action-first
 * universally, and there is no free-text input anywhere in the assistant.
 */
export const QUESTIONS: readonly Question[] = [
  { id: 'q-route', intent: 'MY_ROUTE', label: 'My route' },
  { id: 'q-stop', intent: 'NEXT_STOP', label: 'Next stop' },
  { id: 'q-risk', intent: 'ROUTE_RISK', label: 'Is my route risky?' },
  { id: 'q-break', intent: 'BREAK', label: 'Do I need a break?' },
  { id: 'q-trip', intent: 'MY_TRIP', label: 'My trip' },
  { id: 'q-net', intent: 'CONNECTIVITY', label: 'Am I online?' },
  { id: 'q-safety', intent: 'EMERGENCY', label: 'Emergency help' },
  { id: 'q-talk', intent: 'TRANSLATE', label: 'Help me talk' },
  { id: 'q-vehicle', intent: 'VEHICLE_ISSUE', label: 'Truck problem' },
] as const

// --- Resolver -------------------------------------------------------------

function tripFreshness(ctx: AssistantContext): Freshness | null {
  const age = minutesSince(ctx.tripLoadedAt, ctx.now)
  if (age === null) return null
  // Offline means whatever is on screen came from the last successful read.
  return { ageMinutes: age, cached: !ctx.online, stale: age >= 30 }
}

function answerMyTrip(ctx: AssistantContext): Answer {
  const trip = get_current_trip(ctx)
  if (!trip) {
    return {
      intent: 'MY_TRIP',
      headline: 'No trip loaded',
      facts: [],
      reasonCodes: [],
      freshness: null,
      allowedActions: ['OPEN_TRIP'],
      unavailable: ['TRIP'],
    }
  }
  return {
    intent: 'MY_TRIP',
    headline: `Trip ${trip.trip_code}`,
    facts: [
      { code: 'TRIP_STATUS', label: 'Status', value: trip.status },
      { code: 'TRUCK', label: 'Truck', value: trip.truck.registration_number },
      { code: 'STOPS', label: 'Stops', value: String(trip.stops.length) },
    ],
    reasonCodes: [],
    freshness: tripFreshness(ctx),
    allowedActions: ['OPEN_TRIP'],
    unavailable: [],
  }
}

function answerMyRoute(ctx: AssistantContext): Answer {
  const progress = get_route_progress(ctx)
  if (!progress) {
    // Not a zero. See the module docstring.
    return {
      intent: 'MY_ROUTE',
      headline: 'Route progress is not available',
      facts: [],
      reasonCodes: [],
      freshness: tripFreshness(ctx),
      allowedActions: ['OPEN_TRIP'],
      unavailable: ctx.trip ? ['ROUTE_PROGRESS'] : ['TRIP', 'ROUTE_PROGRESS'],
    }
  }

  const facts: Fact[] = [
    {
      code: 'REMAINING_DISTANCE',
      label: 'Distance left',
      value: km(progress.remaining_distance_km),
    },
    {
      code: 'PROGRESS',
      label: 'Completed',
      value:
        progress.fraction_complete == null
          ? NOT_AVAILABLE
          : `${Math.round(progress.fraction_complete * 100)}%`,
    },
  ]

  // Off-route is stated in words before any number, because it decides
  // whether the numbers above it mean anything.
  const offRoute = progress.on_route === false
  if (progress.on_route !== null) {
    facts.unshift({
      code: 'ON_ROUTE',
      label: 'On planned route',
      value: offRoute ? 'No' : 'Yes',
    })
  }

  return {
    intent: 'MY_ROUTE',
    headline: offRoute ? 'You are off the planned route' : 'On the planned route',
    facts,
    reasonCodes: progress.reason_codes ?? [],
    freshness: tripFreshness(ctx),
    allowedActions: offRoute ? ['OPEN_TRIP', 'CONTACT_DISPATCH'] : ['OPEN_TRIP'],
    unavailable: progress.remaining_distance_km == null ? ['REMAINING_DISTANCE'] : [],
  }
}

function answerNextStop(ctx: AssistantContext): Answer {
  const stop = get_next_stop(ctx)
  if (!stop) {
    return {
      intent: 'NEXT_STOP',
      headline: 'No next stop',
      facts: [],
      reasonCodes: [],
      freshness: tripFreshness(ctx),
      allowedActions: ['OPEN_TRIP'],
      unavailable: ctx.trip ? ['NEXT_STOP'] : ['TRIP', 'NEXT_STOP'],
    }
  }
  return {
    intent: 'NEXT_STOP',
    // `name` is nullable in the API. A stop with none still needs a heading,
    // and its sequence is the thing a driver can match against the trip list.
    headline: stop.name ?? `Stop ${stop.sequence}`,
    facts: [
      { code: 'STOP_SEQUENCE', label: 'Stop', value: String(stop.sequence) },
      { code: 'STOP_KIND', label: 'Kind', value: stop.kind },
    ],
    reasonCodes: [],
    freshness: tripFreshness(ctx),
    allowedActions: ['OPEN_TRIP'],
    unavailable: [],
  }
}

function answerRouteRisk(ctx: AssistantContext): Answer {
  const found = get_route_risk(ctx)
  if (!found) {
    return {
      intent: 'ROUTE_RISK',
      headline: 'No route risk information on this phone',
      facts: [],
      reasonCodes: [],
      freshness: null,
      // Stated even with no data: the rule does not depend on the score.
      allowedActions: ['CONTACT_DISPATCH'],
      unavailable: ['ROUTE_RISK'],
    }
  }

  const captured = found.capturedAt ? Date.parse(found.capturedAt) : null
  const age = minutesSince(Number.isNaN(captured) ? null : captured, ctx.now)

  return {
    intent: 'ROUTE_RISK',
    headline: `Route risk ${found.risk.band}`,
    facts: [
      { code: 'RISK_BAND', label: 'Risk', value: found.risk.band },
      { code: 'RISK_SCORE', label: 'Score', value: `${found.risk.score}/100` },
    ],
    reasonCodes: found.risk.reason_codes ?? [],
    freshness:
      age === null
        ? null
        : {
            ageMinutes: age,
            // ALWAYS cached. This is a stored snapshot by construction.
            cached: true,
            stale: ctx.offlinePackage?.freshness === 'STALE',
          },
    // The important one. A driver may not change route, and the assistant
    // says so rather than offering a control that would fail.
    allowedActions: ['CONTACT_DISPATCH'],
    // The datasets the score was made WITHOUT travel with the score.
    unavailable: found.risk.unavailable ?? [],
  }
}

function answerBreak(ctx: AssistantContext): Answer {
  const advice = get_break_status(ctx)
  if (advice.elapsedMinutes === null) {
    return {
      intent: 'BREAK',
      headline: 'No break signal',
      facts: [],
      reasonCodes: [advice.reasonCode],
      freshness: null,
      allowedActions: [],
      unavailable: ['TRIP_START'],
    }
  }

  const recommended = advice.level === 'RECOMMENDED' || advice.level === 'OVERDUE'
  return {
    intent: 'BREAK',
    headline: recommended ? 'Break recommended' : 'No break signal',
    facts: [
      {
        code: 'ELAPSED',
        // The label carries the caveat. This is elapsed time, not driving
        // time - nothing in this build measures driving time.
        label: advice.sinceBreak ? 'Since your last break' : 'Since trip start',
        value: formatElapsed(advice.elapsedMinutes),
      },
      { code: 'BREAK_LEVEL', label: 'Level', value: advice.level },
    ],
    reasonCodes: [advice.reasonCode],
    freshness: null,
    allowedActions: ['RECORD_BREAK'],
    // There is no verified safe-stop dataset in this build, so no stop is
    // suggested. Naming one would be inventing a safe place.
    unavailable: ['VERIFIED_SAFE_STOP'],
  }
}

function answerConnectivity(ctx: AssistantContext): Answer {
  const net = get_connectivity_status(ctx)
  const facts: Fact[] = [
    { code: 'NETWORK', label: 'Network', value: net.online ? 'Online' : 'Offline' },
  ]

  if (ctx.tracking !== null) {
    facts.push({
      code: 'TRACKING',
      label: 'Position reporting',
      value: net.isTracking ? 'Running' : 'Not running',
    })
  }

  // ASSIST-1. Only describe the queue when there IS one.
  //
  // The tracker's INITIAL state carries `persistence: 'memory'` because no
  // tracker has been constructed yet - it is a default, not a measurement.
  // Reporting it before tracking starts told a driver with no trip that their
  // positions would be lost on a restart, which is not what that value means.
  //
  // A stopped tracker holding unsent fixes is the exception: a backlog is
  // exactly what someone needs to be told about, running or not.
  const hasBacklog = (net.queueDepth ?? 0) > 0
  if (net.isTracking || hasBacklog) {
    if (net.queueDepth !== null) {
      facts.push({
        code: 'QUEUED_FIXES',
        label: 'Queued positions',
        value: String(net.queueDepth),
      })
    }
    if (net.persistence !== null) {
      facts.push({ code: 'QUEUE_STORAGE', label: 'Queue storage', value: net.persistence })
    }
  }

  return {
    intent: 'CONNECTIVITY',
    headline: net.online ? 'You are online' : 'You are offline',
    facts,
    reasonCodes: [],
    freshness: null,
    allowedActions: [],
    unavailable: ctx.tracking === null ? ['TRACKING_STATE'] : [],
  }
}

function answerEmergency(): Answer {
  const guide = get_emergency_guide()
  return {
    intent: 'EMERGENCY',
    headline: 'Emergency help',
    facts: guide.topicIds.map((id) => ({
      code: 'GUIDE_TOPIC',
      label: 'Topic',
      value: id,
    })),
    reasonCodes: [],
    freshness: null,
    // Hands off to the curated screen rather than repeating any of it.
    allowedActions: ['OPEN_SAFETY_GUIDE'],
    unavailable: [],
  }
}

function answerTranslate(): Answer {
  const phrases = get_translation_phrase()
  return {
    intent: 'TRANSLATE',
    headline: 'Help me talk',
    facts: phrases.categoryIds.map((id) => ({
      code: 'PHRASE_CATEGORY',
      label: 'Category',
      value: id,
    })),
    reasonCodes: [],
    freshness: null,
    allowedActions: ['OPEN_PHRASEBOOK'],
    unavailable: [],
  }
}

function answerVehicleIssue(): Answer {
  // No vehicle diagnostics exist in this build - no OBD, no fault codes. The
  // useful, honest answer is the phrases that get a stranger to help and the
  // instruction to tell dispatch.
  return {
    intent: 'VEHICLE_ISSUE',
    headline: 'Truck problem',
    facts: [
      { code: 'PHRASE_CATEGORY', label: 'Category', value: 'BREAKDOWN' },
    ],
    reasonCodes: [],
    freshness: null,
    allowedActions: ['OPEN_PHRASEBOOK', 'CONTACT_DISPATCH'],
    unavailable: ['VEHICLE_DIAGNOSTICS'],
  }
}

/**
 * Answer one intent from context.
 *
 * Total: every intent, including `UNKNOWN`, returns an Answer. Nothing here
 * throws, because this runs on a screen a driver may open at a roadside.
 */
export function answer(intent: Intent, ctx: AssistantContext): Answer {
  switch (intent) {
    case 'MY_TRIP':
      return answerMyTrip(ctx)
    case 'MY_ROUTE':
      return answerMyRoute(ctx)
    case 'NEXT_STOP':
      return answerNextStop(ctx)
    case 'ROUTE_RISK':
      return answerRouteRisk(ctx)
    case 'BREAK':
      return answerBreak(ctx)
    case 'CONNECTIVITY':
      return answerConnectivity(ctx)
    case 'EMERGENCY':
      return answerEmergency()
    case 'TRANSLATE':
      return answerTranslate()
    case 'VEHICLE_ISSUE':
      return answerVehicleIssue()
    default:
      return {
        intent: 'UNKNOWN',
        headline: 'I do not know that one',
        facts: [],
        reasonCodes: [],
        freshness: null,
        allowedActions: ['OPEN_TRIP', 'OPEN_SAFETY_GUIDE'],
        unavailable: [],
      }
  }
}
