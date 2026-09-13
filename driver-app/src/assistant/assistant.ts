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
import type { TranslationKey } from '../i18n/appLanguage'
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
  /** The live assessment the Navigation screen holds, when the server
   *  answered. Preferred over the package's snapshot, and labelled live. */
  liveRisk?: { risk: OfflineRisk; assessedAt: string } | null
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
  | 'WEATHER'
  | 'TERRAIN'
  | 'LANDSLIDE'
  | 'WARNING'
  | 'TRAFFIC'
  | 'BREAK'
  | 'CONNECTIVITY'
  | 'EMERGENCY'
  | 'TRANSLATE'
  | 'VEHICLE_ISSUE'
  /** Unwell (dizzy, headache, vomiting, fever...): stop, rest, water, help. */
  | 'HEALTH'
  /** A red flag (chest pain, breathing, fainting, stroke signs, heavy bleeding): stop, call 112/108. */
  | 'HEALTH_URGENT'
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
  /** Opens the dialler on 112. The driver still presses call. */
  | 'CALL_EMERGENCY'

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
  /** Short steps to take, as English keys the screen localises. Health only. */
  guidance?: string[]
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
): { risk: OfflineRisk; capturedAt: string | null; live: boolean } | null {
  if (ctx.liveRisk) return { risk: ctx.liveRisk.risk, capturedAt: ctx.liveRisk.assessedAt, live: true }
  const pkg = ctx.offlinePackage?.packageData
  if (!pkg?.risk) return null
  return { risk: pkg.risk, capturedAt: pkg.risk_captured_at, live: false }
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
  /** Key into the app's translation table, so the chips follow the language
   *  the driver picked. Short enough for a gloved thumb on a 320 px screen. */
  labelKey: TranslationKey
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
  { id: 'q-route', intent: 'MY_ROUTE', labelKey: 'ask_route' },
  { id: 'q-stop', intent: 'NEXT_STOP', labelKey: 'ask_stop' },
  { id: 'q-risk', intent: 'ROUTE_RISK', labelKey: 'ask_risk' },
  { id: 'q-weather', intent: 'WEATHER', labelKey: 'ask_weather' },
  { id: 'q-terrain', intent: 'TERRAIN', labelKey: 'ask_terrain' },
  { id: 'q-slide', intent: 'LANDSLIDE', labelKey: 'ask_landslide' },
  { id: 'q-break', intent: 'BREAK', labelKey: 'ask_break' },
  { id: 'q-trip', intent: 'MY_TRIP', labelKey: 'ask_trip' },
  { id: 'q-net', intent: 'CONNECTIVITY', labelKey: 'ask_online' },
  { id: 'q-safety', intent: 'EMERGENCY', labelKey: 'ask_emergency' },
  { id: 'q-talk', intent: 'TRANSLATE', labelKey: 'ask_talk' },
  { id: 'q-vehicle', intent: 'VEHICLE_ISSUE', labelKey: 'ask_truck' },
  { id: 'q-health', intent: 'HEALTH', labelKey: 'ask_health' },
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
    headline: 'Your trip',
    facts: [
      { code: 'TRIP_CODE', label: 'Trip code', value: trip.trip_code },
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
    headline: 'Route risk',
    facts: [
      { code: 'RISK_BAND', label: 'Risk', value: found.risk.band },
      { code: 'RISK_SCORE', label: 'Score', value: `${found.risk.score}/100` },
    ],
    reasonCodes: found.risk.reason_codes ?? [],
    freshness: riskFreshness(ctx, found.live, age),
    // The important one. A driver may not change route, and the assistant
    // says so rather than offering a control that would fail.
    allowedActions: ['CONTACT_DISPATCH'],
    // The datasets the score was made WITHOUT travel with the score.
    unavailable: found.risk.unavailable ?? [],
  }
}

function riskFreshness(ctx: AssistantContext, live: boolean, age: number | null): Freshness | null {
  if (age === null) return null
  return {
    ageMinutes: age,
    // A stored snapshot is cached by construction; the live read is not.
    cached: !live,
    stale: !live && ctx.offlinePackage?.freshness === 'STALE',
  }
}

/** The three evidence questions. Each answers ONLY from the block the engine
 *  shipped for it, and says "not available" when that block is missing. */
function answerEvidence(ctx: AssistantContext, intent: 'WEATHER' | 'TERRAIN' | 'LANDSLIDE' | 'WARNING' | 'TRAFFIC'): Answer {
  const found = get_route_risk(ctx)
  const headline = { WEATHER: 'Weather on the route', TERRAIN: 'Terrain on the route', LANDSLIDE: 'Landslide exposure', WARNING: 'Official warnings and incidents', TRAFFIC: 'Traffic on the route' }[intent]
  if (!found) {
    return {
      intent,
      headline: `${headline}: not available`,
      facts: [],
      reasonCodes: [],
      freshness: null,
      allowedActions: ['CONTACT_DISPATCH'],
      unavailable: ['ROUTE_RISK'],
    }
  }
  const risk = found.risk
  const captured = found.capturedAt ? Date.parse(found.capturedAt) : null
  const freshness = riskFreshness(ctx, found.live, minutesSince(Number.isNaN(captured) ? null : captured, ctx.now))
  const codes = risk.reason_codes ?? []
  const facts: Fact[] = []
  const unavailable: string[] = []

  if (intent === 'WEATHER') {
    if (risk.inputs?.weather === 'AVAILABLE') {
      facts.push({ code: 'WEATHER_OBS', label: 'Observations', value: `${risk.observations_used}${risk.observations_stale ? ` (${risk.observations_stale} stale)` : ''}` })
      const rain = codes.includes('HEAVY_RAIN_ON_ROUTE') ? 'heavy' : codes.includes('MODERATE_RAIN_ON_ROUTE') ? 'moderate' : 'none reported'
      facts.push({ code: 'RAIN', label: 'Rain on route', value: rain })
      if (codes.includes('HIGH_WIND_GUSTS')) facts.push({ code: 'WIND', label: 'Wind', value: 'high gusts' })
    } else {
      unavailable.push('WEATHER')
    }
    return { intent, headline, facts, reasonCodes: codes.filter((c) => /RAIN|WIND|WEATHER/.test(c)), freshness, allowedActions: [], unavailable }
  }

  if (intent === 'WARNING' || intent === 'TRAFFIC') {
    // Deterministic: the reason codes the risk engine already emitted, nothing inferred here.
    const pick = intent === 'WARNING' ? /WARNING|INCIDENT|CLOSURE|FLOOD/ : /TRAFFIC/
    const mine = codes.filter((c) => pick.test(c))
    if (!mine.length) unavailable.push(intent === 'WARNING' ? 'OFFICIAL_WARNINGS' : 'TRAFFIC')
    return { intent, headline, facts, reasonCodes: mine, freshness, allowedActions: ['CONTACT_DISPATCH'], unavailable }
  }

  if (intent === 'TERRAIN') {
    const t = risk.terrain
    if (t?.usable) {
      facts.push({ code: 'ELEVATION', label: 'Elevation', value: `${Math.round(t.min_elevation_m ?? 0)}–${Math.round(t.max_elevation_m ?? 0)} m` })
      facts.push({ code: 'CLIMB', label: 'Total climb', value: `${Math.round(t.total_ascent_m)} m` })
      facts.push({ code: 'STEEPEST', label: 'Steepest', value: `${t.max_grade_pct.toFixed(1)}%` })
      facts.push({ code: 'STEEP_KM', label: 'Steep (10%+)', value: `${(t.class_km?.STEEP ?? 0).toFixed(1)} km` })
      facts.push({ code: 'HILLY_KM', label: 'Hilly (6–10%)', value: `${(t.class_km?.HILLY ?? 0).toFixed(1)} km` })
    } else {
      unavailable.push('TERRAIN')
    }
    return { intent, headline, facts, reasonCodes: codes.filter((c) => /TERRAIN|GRADIENT/.test(c)), freshness, allowedActions: [], unavailable }
  }

  const h = risk.landslide_history
  if (h) {
    facts.push({ code: 'EXPOSURE', label: 'Historical exposure', value: h.exposure })
    facts.push({ code: 'SITES', label: 'Recorded sites within 5 km', value: String(h.on_route_count) })
    if (h.nearest_km != null) facts.push({ code: 'NEAREST', label: 'Nearest site', value: `${h.nearest_km} km from the road` })
    facts.push({ code: 'INVENTORY', label: 'Inventory', value: `${h.inventory_from_year ?? '?'}–${h.inventory_to_year ?? '?'} (history, not a current feed)` })
  } else {
    unavailable.push('LANDSLIDE_HISTORY')
  }
  if (risk.inputs?.landslide !== 'AVAILABLE') unavailable.push('CURRENT_LANDSLIDE_INCIDENTS')
  return { intent, headline, facts, reasonCodes: codes.filter((c) => /LANDSLIDE/.test(c)), freshness, allowedActions: ['CONTACT_DISPATCH'], unavailable }
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

/**
 * Not medical advice: stop driving safely, rest, water, and where to get
 * help. The one thing this may not do is name a condition or a medicine -
 * the same boundary the online model is held to in ai_prompts.py.
 */
function answerHealth(urgent: boolean): Answer {
  if (urgent) {
    return {
      intent: 'HEALTH_URGENT',
      headline: 'Stop driving now — call 112 or 108',
      facts: [],
      reasonCodes: [],
      freshness: null,
      guidance: [
        'Stop the truck safely and switch on the hazard lights.',
        'Call 112 or 108 now and say where you are.',
        'Sit upright, do not eat or drink, do not drive.',
        'Open Safety for the step-by-step guide.',
      ],
      allowedActions: ['CALL_EMERGENCY', 'OPEN_SAFETY_GUIDE'],
      unavailable: [],
    }
  }
  return {
    intent: 'HEALTH',
    headline: 'Stop driving safely and rest',
    facts: [],
    reasonCodes: [],
    freshness: null,
    guidance: [
      'Pull over where it is safe and switch the engine off.',
      'Sit or lie down, loosen tight clothing, drink water in small sips.',
      'Do not drive again until you feel steady. Tell your manager you have stopped.',
      'If it gets worse or does not pass in 30 minutes, call 108 for an ambulance.',
    ],
    allowedActions: ['OPEN_SAFETY_GUIDE', 'CALL_EMERGENCY'],
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
    case 'WEATHER':
    case 'TERRAIN':
    case 'LANDSLIDE':
    case 'WARNING':
    case 'TRAFFIC':
      return answerEvidence(ctx, intent)
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
    case 'HEALTH':
      return answerHealth(false)
    case 'HEALTH_URGENT':
      return answerHealth(true)
    default:
      return {
        intent: 'UNKNOWN',
        headline: 'I can help with route, weather, warnings, traffic, terrain, landslide exposure, stops, breaks, the truck, health and emergencies.',
        facts: [],
        reasonCodes: [],
        freshness: null,
        allowedActions: ['OPEN_TRIP', 'OPEN_SAFETY_GUIDE'],
        unavailable: [],
      }
  }
}

/**
 * What the online model is told, as text. The SAME facts the local answers
 * are built from - route decision, reasons, weather/terrain lines, the next
 * stop, break state - and nothing about who the driver is: no name, phone,
 * licence, document or insurance number ever enters this string. The model
 * may restate these; it is told it may not add to them.
 */
export function contextForModel(ctx: AssistantContext): string {
  const lines: string[] = []
  const trip = answer('MY_TRIP', ctx)
  for (const f of trip.facts) lines.push(`- ${f.label}: ${f.value}`)
  const risk = answer('ROUTE_RISK', ctx)
  if (!risk.unavailable.includes('ROUTE_RISK')) {
    for (const f of risk.facts) lines.push(`- Route ${f.label.toLowerCase()}: ${f.value}`)
    if (risk.reasonCodes.length) lines.push(`- Risk reasons: ${risk.reasonCodes.join(', ')}`)
    if (risk.freshness) lines.push(`- Risk assessed ${risk.freshness.ageMinutes} min ago${risk.freshness.cached ? ' (stored copy)' : ''}${risk.freshness.stale ? ' (STALE)' : ''}`)
  } else {
    lines.push('- Route risk: unavailable')
  }
  for (const intent of ['WEATHER', 'TERRAIN', 'LANDSLIDE'] as const) {
    const a = answer(intent, ctx)
    for (const f of a.facts) lines.push(`- ${a.headline} — ${f.label}: ${f.value}`)
  }
  const stop = answer('NEXT_STOP', ctx)
  if (!stop.unavailable.length) lines.push(`- Next stop: ${stop.headline}`)
  const route = answer('MY_ROUTE', ctx)
  for (const f of route.facts) lines.push(`- ${f.label}: ${f.value}`)
  const brk = answer('BREAK', ctx)
  lines.push(`- Break: ${brk.headline}`)
  return lines.join('\n').slice(0, 2000)
}
