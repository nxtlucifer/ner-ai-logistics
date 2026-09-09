/**
 * Client for the hosted intelligence plane.
 *
 * WHAT THIS IS FOR
 *
 * Supabase stays authoritative for operational state - auth, trips, fleet,
 * assignments, GPS, authorization, RLS. It is not where routing, accessibility
 * scoring or evidence aggregation live: those are the 959-test Python engine in
 * `backend/app`, which is deployed separately as a stateless intelligence
 * service. This module is the only thing in the manager app that talks to it.
 *
 * WHY IT IS NOT `VITE_API_BASE_URL`
 *
 * That variable means "the whole backend lives over there", which is the
 * single-backend deployment this app has moved away from, and in the driver app
 * it specifically means "the laptop on the LAN" - a release blocker. A separate
 * name keeps the two ideas from being confused by a copied build profile, and
 * lets `assertHostedOrigin` hold this one to a stricter rule than a dev backend
 * ever needed to meet.
 *
 * WHY AN UNCONFIGURED PLANE IS A SUPPORTED STATE
 *
 * If this is unset the honest answer is that accessibility was not assessed.
 * That renders as `UNASSESSED` / `null`, which the comparison UI already models.
 * What must never happen again is the previous behaviour: a hardcoded fixture
 * that scored routes from their `kind` and reported `weather: 'AVAILABLE'` for
 * evidence nobody had consulted. A missing assessment is a fact; a fabricated
 * one is a lie that survives into a judge's screenshot.
 */

import { getSupabase } from './supabaseClient'

const RAW_BASE = (import.meta.env.VITE_INTELLIGENCE_BASE_URL ?? '').trim()

/** Hosts that mean "this machine", in the forms a build profile realistically carries. */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', ''])

/**
 * `URL.hostname` keeps the brackets on an IPv6 literal - `https://[::1]:8000`
 * gives `'[::1]'`, not `'::1'`. Comparing the bracketed form against a plain
 * table silently accepts IPv6 loopback, which is how the first version of this
 * file let `https://[::1]:8000` through as a hosted origin.
 */
function normaliseHost(hostname: string): string {
  const lower = hostname.toLowerCase()
  return lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower
}

/**
 * Private address ranges, so a LAN address cannot reach a production build.
 * A hosted deployment is never on one of these, and a build that carries one
 * only works while someone's laptop is on the same network - exactly the
 * dependency this architecture exists to remove.
 */
function isPrivateHost(hostname: string): boolean {
  // IPv4: RFC1918 plus link-local.
  if (/^10\./.test(hostname)) return true
  if (/^192\.168\./.test(hostname)) return true
  if (/^169\.254\./.test(hostname)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true
  // IPv6: unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(hostname)) return true
  if (/^fe[89ab][0-9a-f]:/.test(hostname)) return true
  // IPv4-mapped IPv6 loopback. `URL` rewrites `::ffff:127.0.0.1` into its hex
  // form `::ffff:7f00:1`, so the dotted spelling alone never matches what
  // actually reaches this function - 127.x.x.x is 7f?? in the first group.
  if (/^::ffff:7f[0-9a-f]{2}:/.test(hostname)) return true
  if (/^::ffff:127\./.test(hostname)) return true
  return hostname.endsWith('.local')
}

export type OriginProblem = string | null

/**
 * Why this origin may not be used, or null if it may.
 *
 * Exported so the same rule can be asserted by a test and by a release check
 * rather than re-stated in each - a duplicated rule is one that drifts.
 */
export function originProblem(raw: string): OriginProblem {
  if (!raw) return 'not configured'
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'is not a valid URL'
  }
  if (url.protocol !== 'https:') {
    // Bearer tokens travel on this connection. Plain http would put a live
    // Supabase session on the wire, and Android release builds block cleartext
    // anyway, so this would fail on the phone rather than in review.
    return 'must use https'
  }
  const host = normaliseHost(url.hostname)
  if (LOCAL_HOSTNAMES.has(host) || isPrivateHost(host)) {
    return 'must not point at localhost or a private network address'
  }
  return null
}

const PROBLEM = originProblem(RAW_BASE)

/** True only when a usable hosted origin is configured. */
export const intelligenceConfigured = PROBLEM === null

/**
 * The reason the plane is unusable, for display. Null when it is usable.
 * `not configured` is deliberately distinguishable from a bad configuration:
 * one is a deployment that has not been wired yet, the other is a mistake.
 */
export const intelligenceProblem: OriginProblem = PROBLEM

const BASE = intelligenceConfigured ? RAW_BASE.replace(/\/$/, '') : ''

export class IntelligenceUnavailableError extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(`Accessibility intelligence is unavailable: ${reason}`)
    this.name = 'IntelligenceUnavailableError'
    this.reason = reason
  }
}

/**
 * Call the intelligence plane as the signed-in user.
 *
 * The Supabase access token is forwarded as a bearer token; the service
 * verifies it against the project JWKS and reads the caller's role from its own
 * `users` table (see `backend/app/auth/verifier.py`). No service key, no shared
 * secret, and nothing privileged is inlined into this bundle.
 */
export async function intelligenceFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!intelligenceConfigured) {
    throw new IntelligenceUnavailableError(PROBLEM ?? 'not configured')
  }

  const { data } = await getSupabase().auth.getSession()
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
    // Network-level failure. Surfaced as unavailable rather than as a risk of
    // zero - the distinction this whole module exists to preserve.
    throw new IntelligenceUnavailableError(
      cause instanceof Error ? cause.message : 'network error',
    )
  }

  if (!response.ok) {
    throw new IntelligenceUnavailableError(`service returned ${response.status}`)
  }
  return (await response.json()) as T
}
