/**
 * Client for the hosted intelligence plane, driver side.
 *
 * Supabase owns the driver's operational state - session, trip, lifecycle
 * transitions, GPS. Route geometry and turn instructions are produced by the
 * routing and navigation services in `backend/app`, deployed separately, and
 * this module is the only thing in the app that calls them.
 *
 * WHY THIS IS NOT `EXPO_PUBLIC_API_BASE_URL`
 *
 * That variable means "the laptop on the LAN", and `scripts/check-release-config.mjs`
 * fails the build when a release profile carries it - a legacy fallback shipped
 * in vc3 and the gate exists so it cannot happen again. Reusing the name here
 * would either force that gate open or make a hosted origin look like the thing
 * it refuses. A separate variable, held to a stricter rule (https, never
 * private, never loopback), keeps both properties.
 *
 * The rules live in `releaseConfig.mjs` so the pre-bundle gate can run them
 * under plain Node, exactly as the Supabase rules already are. A rule that is
 * restated in two places is a rule that drifts.
 */

import { intelligenceOriginProblem } from './releaseConfig.mjs'
import { supabase } from './supabaseClient'

const RAW_BASE = (process.env.EXPO_PUBLIC_INTELLIGENCE_BASE_URL ?? '').trim()

const PROBLEM: string | null = intelligenceOriginProblem(RAW_BASE)

/** True only when a usable hosted origin is configured. */
export const intelligenceConfigured = PROBLEM === null

/** Why the plane is unusable, for an honest on-screen message. Null when usable. */
export const intelligenceProblem = PROBLEM

const BASE = intelligenceConfigured ? RAW_BASE.replace(/\/$/, '') : ''

export class IntelligenceUnavailableError extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(`Route intelligence is unavailable: ${reason}`)
    this.name = 'IntelligenceUnavailableError'
    this.reason = reason
  }
}

/**
 * Call the intelligence plane as the signed-in driver.
 *
 * The Supabase access token is forwarded as a bearer token and verified by the
 * service against the project JWKS; the driver's role and trip ownership are
 * read from the service's own tables, never from the token. Nothing privileged
 * is inlined into the APK - `EXPO_PUBLIC_*` values are readable in a shipped
 * bundle, and this one is a public URL.
 */
export async function intelligenceFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!intelligenceConfigured) {
    throw new IntelligenceUnavailableError(PROBLEM ?? 'not configured')
  }

  const { data } = await supabase().auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new IntelligenceUnavailableError('no active session')

  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
  } catch (cause) {
    // On a phone this is the normal case, not an exceptional one: NER corridors
    // lose signal. The caller falls back to the cached package for THIS trip and
    // route, or shows an honest error - never an empty map.
    throw new IntelligenceUnavailableError(
      cause instanceof Error ? cause.message : 'network error',
    )
  }

  if (!response.ok) {
    throw new IntelligenceUnavailableError(`service returned ${response.status}`)
  }
  return (await response.json()) as T
}
