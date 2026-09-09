/**
 * The driver-trip request handler, separated from `Deno.serve` so it can be
 * exercised without a Deno runtime.
 *
 * Nothing here references a Deno global: the Supabase client factory and the
 * environment arrive as dependencies. `index.ts` is the only file that binds
 * them to the real runtime.
 *
 * WHY THE ERROR MAPPING IS ITS OWN THING
 *
 * Two defects lived in the first version and both were invisible without tests:
 *
 *   1. `.abortSignal()` does NOT throw when it fires. postgrest-js catches the
 *      fetch AbortError and RESOLVES with `{ data: null, error }`, so the
 *      `catch` block that checked `abort.signal.aborted` never ran and a
 *      timeout was reported as 400. The timeout is therefore checked BEFORE any
 *      error is interpreted.
 *   2. Every database error became 400. A rejected JWT (PGRST301) is 401, a
 *      permission failure is 403, a lost connection is 503 — and a code we do
 *      not recognise is OUR failure, not a bad client request, so it is 500.
 *
 * And the first version returned `error.details.code` to the caller verbatim.
 * That string comes from the database; echoing an arbitrary one lets a future
 * `RAISE` leak internals into a client contract. Only codes on the allowlist
 * below are ever returned.
 */

import { assess, type LatLon } from '../_shared/routeProgress.ts'

export interface ProgressInput {
  geometry: number[][] | null
  position: number[] | null
  plannedDistanceKm: number | string | null
  plannedDurationMin: number | null
}

export interface RpcError {
  message?: string
  details?: string | null
  hint?: string | null
  code?: string | null
}

export interface HandlerDeps {
  /** Builds a caller-scoped client. Injected so tests need no network. */
  createClient: (url: string, key: string, authorization: string) => {
    rpc: (fn: string, args?: Record<string, unknown>, opts?: { signal?: AbortSignal }) =>
      Promise<{ data: unknown; error: RpcError | null }>
  }
  env: (name: string) => string | undefined
  timeoutMs?: number
  log?: (message: string, detail?: unknown) => void
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

/**
 * Codes this function is willing to put in a response body.
 *
 * An allowlist, not a passthrough: these are part of the client contract and
 * the driver app branches on them. Anything else becomes INTERNAL.
 */
const CLIENT_CODES = new Set([
  'NOT_AUTHENTICATED',
  'FORBIDDEN',
  'NO_ACTIVE_TRIP',
  'TRIP_NOT_ACCEPTABLE',
])

/** PostgREST / SQLSTATE codes with a defined HTTP meaning. */
function mapKnownCode(code: string | null | undefined): { code: string; status: number } | null {
  switch (code) {
    // PostgREST: JWT missing, invalid, or expired. Documented as 401.
    case 'PGRST301':
    case 'PGRST302':
      return { code: 'NOT_AUTHENTICATED', status: 401 }
    // SQLSTATE 28000 invalid_authorization_specification.
    case '28000':
      return { code: 'NOT_AUTHENTICATED', status: 401 }
    // SQLSTATE 42501 insufficient_privilege.
    case '42501':
      return { code: 'FORBIDDEN', status: 403 }
    // Our own RAISE for a state conflict.
    case '55000':
      return { code: 'CONFLICT', status: 409 }
    // Serialization failure / deadlock — genuinely retryable.
    case '40001':
    case '40P01':
      return { code: 'CONFLICT', status: 409 }
    default:
      break
  }
  // Connection and resource classes: the database is unavailable, not the
  // caller's fault, and a client should back off rather than re-authenticate.
  if (code && /^(08|53|57|58)/.test(code)) {
    return { code: 'UNAVAILABLE', status: 503 }
  }
  return null
}

/** The structured code our own functions attach via `RAISE ... USING detail`. */
function structuredCode(error: RpcError): string | null {
  if (!error.details) return null
  try {
    const parsed = JSON.parse(error.details) as { code?: unknown }
    return typeof parsed.code === 'string' ? parsed.code : null
  } catch {
    return null
  }
}

export function classifyRpcError(error: RpcError): { code: string; status: number } {
  // Our own structured code wins when it is one we publish, because it is more
  // specific than the SQLSTATE that carried it.
  const own = structuredCode(error)
  if (own && CLIENT_CODES.has(own)) {
    const status =
      own === 'NOT_AUTHENTICATED' ? 401
      : own === 'FORBIDDEN' ? 403
      : own === 'NO_ACTIVE_TRIP' ? 404
      : 409
    return { code: own, status }
  }
  const known = mapKnownCode(error.code)
  if (known) return known
  // Unrecognised: ours to explain, not the caller's to fix.
  return { code: 'INTERNAL', status: 500 }
}

function json(body: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json', 'x-request-id': requestId },
  })
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  // Structured, and never the raw database message: those carry schema detail.
  return json({ code, message, request_id: requestId }, status, requestId)
}

const MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'Sign in to load your trip.',
  FORBIDDEN: 'This account is not a driver.',
  NO_ACTIVE_TRIP: 'You have no trip right now.',
  CONFLICT: 'Your trip changed while loading. Try again.',
  UNAVAILABLE: 'The server is busy. Try again shortly.',
  TIMEOUT: 'The server took too long. Try again.',
  INTERNAL: 'Something went wrong loading your trip.',
}

export async function handleDriverTrip(req: Request, deps: HandlerDeps): Promise<Response> {
  const requestId = crypto.randomUUID()

  if (req.method === 'OPTIONS') {
    // CORS is not authorization. A preflight carries no credentials by design;
    // the actual request below still requires a JWT.
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return fail('METHOD_NOT_ALLOWED', 'Use GET.', 405, requestId)
  }

  const authorization = req.headers.get('Authorization')
  if (!authorization) {
    return fail('NOT_AUTHENTICATED', MESSAGES.NOT_AUTHENTICATED, 401, requestId)
  }

  const url = deps.env('SUPABASE_URL')
  const key = deps.env('SUPABASE_ANON_KEY')
  if (!url || !key) {
    return fail('MISCONFIGURED', 'The function is not configured.', 500, requestId)
  }

  const supabase = deps.createClient(url, key, authorization)

  // Bounded. A driver on a hillside with one bar needs a definite failure far
  // sooner than a socket timeout would give them.
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), deps.timeoutMs ?? 10_000)
  try {
    const { data, error } = await supabase.rpc('driver_trip_payload', {}, { signal: abort.signal })

    // FIRST. `.abortSignal()` resolves with an error rather than throwing, so a
    // timeout arrives here looking like an ordinary database failure.
    if (abort.signal.aborted) {
      return fail('TIMEOUT', MESSAGES.TIMEOUT, 504, requestId)
    }

    if (error) {
      const { code, status } = classifyRpcError(error)
      if (status >= 500) {
        // The real message is logged, never returned.
        deps.log?.(`[${requestId}] driver_trip_payload failed`, error)
      }
      return fail(code, MESSAGES[code] ?? MESSAGES.INTERNAL, status, requestId)
    }

    // No current trip is an ordinary state - the app renders "no assignment
    // yet" - so it is a 200 with null, not a 404.
    if (data === null || data === undefined) return json(null, 200, requestId)

    const payload = data as Record<string, unknown>
    const input = payload._progress_input as ProgressInput | undefined
    delete payload._progress_input

    // `progress` is null ONLY when the trip has no selected route at all, which
    // is what the client contract documents. With a route but no fix, assess()
    // returns a populated object whose fields are null and whose reason code
    // says why - a truck with no fix has not arrived.
    payload.progress = input?.geometry
      ? assess({
          geometry: input.geometry.map((p) => [p[0], p[1]] as LatLon),
          position: input.position ? ([input.position[0], input.position[1]] as LatLon) : null,
          // numeric arrives as a string from PostgREST; Number() here rather
          // than in SQL keeps the database emitting exact values.
          plannedDistanceKm:
            input.plannedDistanceKm === null || input.plannedDistanceKm === undefined
              ? null
              : Number(input.plannedDistanceKm),
          plannedDurationMin: input.plannedDurationMin,
        })
      : null

    return json(payload, 200, requestId)
  } catch (caught) {
    // A genuine throw (network stack, JSON, a bug). Timeout is still checked
    // first because an aborted fetch can surface either way depending on where
    // it was cancelled.
    if (abort.signal.aborted) {
      return fail('TIMEOUT', MESSAGES.TIMEOUT, 504, requestId)
    }
    deps.log?.(`[${requestId}] driver-trip threw`, caught)
    return fail('INTERNAL', MESSAGES.INTERNAL, 500, requestId)
  } finally {
    clearTimeout(timer)
  }
}
