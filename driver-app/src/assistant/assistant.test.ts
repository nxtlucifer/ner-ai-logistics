/**
 * Driver Assistant V1 invariants.
 *
 * Two groups. The first is behaviour - does it answer honestly when data is
 * missing. The second is the security property: the assistant must be unable
 * to change anything, and that is asserted against the SOURCE, because a
 * behavioural test only proves the tools that exist today do not mutate.
 */

import { describe, expect, it } from 'vitest'

import { APP_LANGUAGE_CODES, t } from '../i18n/appLanguage'

// The module's own source, as text. See src/raw-modules.d.ts.
import assistantSource from './assistant.ts?raw'

import {
  QUESTIONS,
  TOOLS,
  answer,
  type AssistantContext,
  type Intent,
} from './assistant'
import { assessBreak } from '../safety/breaks'
import type { CurrentTrip } from '../api/client'
import type { StoredPackage } from '../offline/packageStore'
import type { TrackerState } from '../tracking/tracker'

const NOW = Date.parse('2026-09-05T10:00:00Z')

const tracking: TrackerState = {
  permission: 'granted',
  isTracking: true,
  uploadState: 'idle',
  queueDepth: 3,
  lastAcceptedAt: null,
  droppedCount: 0,
  lastError: null,
  persistence: 'durable',
} as TrackerState

const trip = {
  id: 't1',
  trip_code: 'NER-001',
  status: 'IN_PROGRESS',
  dispatched_at: null,
  started_at: '2026-09-05T06:00:00Z',
  delivered_at: null,
  truck: { id: 'k1', registration_number: 'AS01AB1234' },
  stops: [
    { id: 's1', sequence: 1, kind: 'PICKUP', status: 'DONE', name: 'Guwahati' },
    { id: 's2', sequence: 2, kind: 'DROP', status: 'PENDING', name: null },
  ],
  next_stop_id: 's2',
  can_start: false,
  start_blocked_code: null,
  start_blocked_reason: null,
  tracking_expected: true,
  tracking: {},
  last_fix: null,
  progress: {
    fraction_complete: 0.5,
    travelled_distance_km: 100,
    remaining_distance_km: 100,
    off_route_m: 0,
    on_route: true,
    remaining_at_planned_pace_min: 120,
    planned_average_speed_kmph: 50,
    reason_codes: [],
    version: 'p1',
  },
} as unknown as CurrentTrip

const storedPackage = {
  packageData: {
    risk: { score: 71, band: 'HIGH', unavailable: ['landslide'], reason_codes: ['HEAVY_RAIN_ON_ROUTE'] },
    risk_captured_at: '2026-09-05T09:00:00Z',
  },
  ageMs: 60 * 60 * 1000,
  freshness: 'CURRENT',
} as unknown as StoredPackage

function ctx(over: Partial<AssistantContext> = {}): AssistantContext {
  return {
    trip,
    tripLoadedAt: NOW - 5 * 60_000,
    tracking,
    offlinePackage: storedPackage,
    breakAdvice: assessBreak({
      startedAt: trip.started_at,
      lastBreakAt: null,
      now: NOW,
    }),
    online: true,
    now: NOW,
    ...over,
  }
}

const ALL_INTENTS: Intent[] = [
  'MY_TRIP', 'MY_ROUTE', 'NEXT_STOP', 'ROUTE_RISK', 'BREAK',
  'CONNECTIVITY', 'EMERGENCY', 'TRANSLATE', 'VEHICLE_ISSUE', 'UNKNOWN',
]

describe('driver assistant — it cannot act', () => {
  it('imports nothing that could mutate application state', () => {
    // The load-bearing security assertion, and it is made against the SOURCE
    // rather than behaviour: a behavioural test only proves that the tools
    // which exist TODAY do not mutate. This fails the moment somebody adds an
    // api client, storage or fetch to the module - which is the change that
    // would turn an explainer into an actor.
    const src = assistantSource

    // The distinction that matters is the import KIND, not the path.
    // `import type { CurrentTrip }` is erased at compile time and cannot
    // reach a single line of runtime code, so it is allowed and is how the
    // module knows the shapes it reads. `import { api }` would be a live
    // client sitting inside the assistant, and is not.
    const statements = [
      ...src.matchAll(/^import\s+(type\s+)?(\{[^}]*\}|[\w*]+)\s+from\s+'([^']+)'/gm),
    ]
    const dangerous = /api\/client$|async-storage|packageStore$/
    for (const [, typeKeyword, bindings, spec] of statements) {
      if (!dangerous.test(spec)) continue
      const wholeStatementIsType = Boolean(typeKeyword)
      const everyBindingIsType =
        bindings.startsWith('{') &&
        bindings
          .slice(1, -1)
          .split(',')
          .every((b: string) => b.trim() === '' || b.trim().startsWith('type '))
      expect(
        wholeStatementIsType || everyBindingIsType,
        `value import from ${spec} — the assistant must not hold a live client`,
      ).toBe(true)
    }

    // The real teeth: even an imported client would have to be CALLED.
    expect(src, 'assistant calls the api client').not.toMatch(/\bapi\s*\./)
    expect(src).not.toMatch(/\bfetch\s*\(/)
    expect(src).not.toMatch(/XMLHttpRequest/)
  })

  it('exposes only read tools, named as reads', () => {
    for (const name of Object.keys(TOOLS)) {
      expect(name, `${name} is not a getter`).toMatch(/^get_/)
      expect(name).not.toMatch(/set_|update_|delete_|create_|send_|post_/)
    }
  })

  it('never offers an action that changes a route or a trip', () => {
    // A driver may not reroute. The assistant explains and hands off; it does
    // not offer a control that would fail or, worse, one that would work.
    const forbidden = /ROUTE|REROUTE|DISPATCH_TRUCK|CLOSE_TRIP|SOS/
    for (const intent of ALL_INTENTS) {
      for (const action of answer(intent, ctx()).allowedActions) {
        // OPEN_TRIP is navigation, not mutation - allow it explicitly.
        if (action === 'OPEN_TRIP') continue
        expect(action, `${intent} offers ${action}`).not.toMatch(forbidden)
      }
    }
  })
})

describe('driver assistant — it never invents a fact', () => {
  it('answers every intent without throwing, even with an empty context', () => {
    const empty = ctx({
      trip: null,
      tripLoadedAt: null,
      tracking: null,
      offlinePackage: null,
      breakAdvice: assessBreak({ startedAt: null, lastBreakAt: null, now: NOW }),
      online: false,
    })
    for (const intent of ALL_INTENTS) {
      const a = answer(intent, empty)
      expect(a.headline.trim(), intent).not.toBe('')
      expect(Array.isArray(a.facts)).toBe(true)
    }
  })

  it('reports missing route progress as unavailable, never as zero', () => {
    // "0 km left" at the start of a shift is a lie the app would tell by
    // itself. Same rule progressFormat already follows.
    const a = answer('MY_ROUTE', ctx({ trip: { ...trip, progress: null } as CurrentTrip }))
    expect(a.unavailable).toContain('ROUTE_PROGRESS')
    expect(a.facts).toHaveLength(0)
    expect(a.headline).toMatch(/not available/i)
  })

  it('names the trip as missing when there is no trip at all', () => {
    const a = answer('MY_ROUTE', ctx({ trip: null }))
    expect(a.unavailable).toEqual(expect.arrayContaining(['TRIP', 'ROUTE_PROGRESS']))
  })

  it('states off-route in words before any number', () => {
    const offRoute = {
      ...trip,
      progress: { ...trip.progress, on_route: false, off_route_m: 800 },
    } as CurrentTrip
    const a = answer('MY_ROUTE', ctx({ trip: offRoute }))
    expect(a.headline).toMatch(/off the planned route/i)
    expect(a.facts[0].code).toBe('ON_ROUTE')
    expect(a.allowedActions).toContain('CONTACT_DISPATCH')
  })

  it('gives a nameless stop a heading a driver can match', () => {
    const a = answer('NEXT_STOP', ctx())
    expect(a.headline).toBe('Stop 2')
  })
})

describe('driver assistant — cached is never called live', () => {
  it('marks route risk as cached and carries its age', () => {
    const a = answer('ROUTE_RISK', ctx())
    expect(a.headline).toBe('Route risk')
    expect(a.facts[0]).toMatchObject({ code: 'RISK_BAND', value: 'HIGH' })
    expect(a.freshness).not.toBeNull()
    expect(a.freshness!.cached).toBe(true)
    expect(a.freshness!.ageMinutes).toBe(60)
  })

  it('carries the datasets the risk score was made WITHOUT', () => {
    // A dispatcher or driver shown a bare band assumes it is complete.
    expect(answer('ROUTE_RISK', ctx()).unavailable).toContain('landslide')
  })

  it('still refuses a reroute when no risk data exists at all', () => {
    // The rule does not depend on the score.
    const a = answer('ROUTE_RISK', ctx({ offlinePackage: null }))
    expect(a.unavailable).toContain('ROUTE_RISK')
    expect(a.allowedActions).toEqual(['CONTACT_DISPATCH'])
    expect(a.facts).toHaveLength(0)
  })

  it('propagates a stale package into the answer', () => {
    const stale = { ...storedPackage, freshness: 'STALE' } as StoredPackage
    expect(answer('ROUTE_RISK', ctx({ offlinePackage: stale })).freshness!.stale).toBe(true)
  })

  it('marks trip answers as cached when offline', () => {
    expect(answer('MY_TRIP', ctx({ online: false })).freshness!.cached).toBe(true)
    expect(answer('MY_TRIP', ctx({ online: true })).freshness!.cached).toBe(false)
  })
})

describe('driver assistant — break, safety and translation', () => {
  it('recommends a break from elapsed time and says which span it measured', () => {
    const a = answer('BREAK', ctx())
    expect(a.headline).toBe('Break recommended') // 4h since 06:00
    expect(a.facts[0].label).toBe('Since trip start')
    expect(a.facts[0].value).toBe('4h 00m')
  })

  it('never suggests a stop, because no verified safe-stop data exists', () => {
    // Inventing a safe place to park is the one thing this must not do.
    expect(answer('BREAK', ctx()).unavailable).toContain('VERIFIED_SAFE_STOP')
  })

  it('gives no break signal before the trip starts', () => {
    const a = answer(
      'BREAK',
      ctx({ breakAdvice: assessBreak({ startedAt: null, lastBreakAt: null, now: NOW }) }),
    )
    expect(a.headline).toBe('No break signal')
    expect(a.unavailable).toContain('TRIP_START')
  })

  it('hands emergencies to the curated guide instead of repeating it', () => {
    const a = answer('EMERGENCY', ctx())
    expect(a.allowedActions).toContain('OPEN_SAFETY_GUIDE')
    // Topic IDS only - no medical prose may live in the assistant.
    for (const fact of a.facts) expect(fact.value).toMatch(/^[A-Z_]+$/)
  })

  it('reports a vehicle problem without pretending to diagnose one', () => {
    const a = answer('VEHICLE_ISSUE', ctx())
    expect(a.unavailable).toContain('VEHICLE_DIAGNOSTICS')
    expect(a.allowedActions).toContain('OPEN_PHRASEBOOK')
  })

  it('shows queued positions and storage durability when offline', () => {
    const a = answer('CONNECTIVITY', ctx({ online: false }))
    expect(a.headline).toBe('You are offline')
    expect(a.facts.map((f) => f.code)).toEqual(
      expect.arrayContaining(['NETWORK', 'QUEUED_FIXES', 'QUEUE_STORAGE']),
    )
  })

  it('does not report queue storage when nothing is being tracked', () => {
    // ASSIST-1, found by rendering: with no trip the tracker has never
    // started, and its INITIAL state carries `persistence: 'memory'`. Showing
    // "Queue storage: memory" there states something about a queue that does
    // not exist yet, and implies the driver's positions would be lost on a
    // restart - which is not what that default means.
    const idle = { ...tracking, isTracking: false, queueDepth: 0 } as TrackerState
    const a = answer('CONNECTIVITY', ctx({ trip: null, tracking: idle }))
    const codes = a.facts.map((f) => f.code)
    expect(codes).not.toContain('QUEUE_STORAGE')
    expect(codes).not.toContain('QUEUED_FIXES')
    expect(codes).toContain('TRACKING')
  })

  it('does report the queue once tracking is actually running', () => {
    const codes = answer('CONNECTIVITY', ctx()).facts.map((f) => f.code)
    expect(codes).toEqual(
      expect.arrayContaining(['NETWORK', 'TRACKING', 'QUEUED_FIXES', 'QUEUE_STORAGE']),
    )
  })

  it('still reports queued positions when tracking stopped with a backlog', () => {
    // Stopped with 4 unsent fixes is exactly when a driver needs to be told.
    const stopped = { ...tracking, isTracking: false, queueDepth: 4 } as TrackerState
    const codes = answer('CONNECTIVITY', ctx({ tracking: stopped })).facts.map((f) => f.code)
    expect(codes).toContain('QUEUED_FIXES')
  })

  it('names tracking state as unavailable rather than guessing it', () => {
    expect(answer('CONNECTIVITY', ctx({ tracking: null })).unavailable).toContain(
      'TRACKING_STATE',
    )
  })
})

describe('driver assistant — catalogue', () => {
  it('keeps every quick question short enough for 320 px, in every app language', () => {
    for (const q of QUESTIONS) {
      for (const lang of APP_LANGUAGE_CODES) {
        expect(t(lang, q.labelKey).length, `${q.id}/${lang} label too long for 320 px`).toBeLessThanOrEqual(28)
      }
      expect(q.intent).not.toBe('UNKNOWN')
    }
  })

  it('every catalogue question resolves to a real answer', () => {
    for (const q of QUESTIONS) {
      expect(answer(q.intent, ctx()).intent, q.id).toBe(q.intent)
    }
  })

  it('has unique question ids', () => {
    const ids = QUESTIONS.map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
