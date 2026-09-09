/**
 * Regression tests for the driver-trip handler's error mapping.
 *
 * The first two describes reproduce defects reported against the previous
 * version, each of which returned 400:
 *
 *   1. the abort timer fires. `.abortSignal()` does NOT throw — postgrest-js
 *      catches the fetch AbortError and RESOLVES with `{ data: null, error }`,
 *      so the `catch` that checked `aborted` never ran;
 *   2. PGRST301 (JWT rejected), which Supabase documents as HTTP 401.
 *
 * These are MOCKED HANDLER TESTS. They prove the mapping, not that the function
 * runs: no Deno runtime, no gateway, no PostgREST. Runtime and hosted
 * verification are separate gates and neither has been run.
 */

import { describe, expect, it, vi } from 'vitest'

import { classifyRpcError, handleDriverTrip, type HandlerDeps, type RpcError } from '../../../supabase/functions/driver-trip/handler'

const env = (name: string) =>
  ({ SUPABASE_URL: 'https://znaveeefzgfxsblsobdb.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_x' })[name]

const request = (method = 'GET', auth: string | null = 'Bearer synthetic.jwt.value') =>
  new Request('https://fn.local/driver-trip', {
    method,
    headers: auth ? { Authorization: auth } : {},
  })

/** A client whose rpc resolves however the test wants. */
function deps(
  rpc: (signal?: AbortSignal) => Promise<{ data: unknown; error: RpcError | null }>,
  timeoutMs?: number,
): HandlerDeps {
  return {
    createClient: () => ({ rpc: (_fn, _args, opts) => rpc(opts?.signal) }),
    env,
    timeoutMs,
    log: vi.fn(),
  }
}

const body = async (r: Response) => (await r.json()) as { code?: string; message?: string; request_id?: string }

describe('defect 1: abort resolves with an error instead of throwing', () => {
  it('returns 504 TIMEOUT, not 400', async () => {
    const res = await handleDriverTrip(
      request(),
      deps(
        (signal) =>
          new Promise((resolve) => {
            signal?.addEventListener('abort', () =>
              // Exactly what postgrest-js does: resolve, do not throw.
              resolve({ data: null, error: { message: 'AbortError', code: null, details: null } }),
            )
          }),
        5,
      ),
    )
    expect(res.status).toBe(504)
    expect((await body(res)).code).toBe('TIMEOUT')
  })

  it('still returns 504 when the abort surfaces as a throw', async () => {
    const res = await handleDriverTrip(
      request(),
      deps(
        (signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('AbortError')))
          }),
        5,
      ),
    )
    expect(res.status).toBe(504)
  })
})

describe('defect 2: PostgREST auth codes', () => {
  it.each([['PGRST301'], ['PGRST302'], ['28000']])('%s maps to 401', async (code) => {
    const res = await handleDriverTrip(
      request(),
      deps(async () => ({ data: null, error: { message: 'JWT expired', code, details: null } })),
    )
    expect(res.status).toBe(401)
    expect((await body(res)).code).toBe('NOT_AUTHENTICATED')
  })
})

describe('error mapping', () => {
  it.each([
    ['42501', 403, 'FORBIDDEN'],
    ['55000', 409, 'CONFLICT'],
    ['40001', 409, 'CONFLICT'],
    ['08006', 503, 'UNAVAILABLE'],
    ['53300', 503, 'UNAVAILABLE'],
    ['57014', 503, 'UNAVAILABLE'],
  ])('%s -> %i %s', async (code, status, expected) => {
    const res = await handleDriverTrip(
      request(),
      deps(async () => ({ data: null, error: { message: 'x', code, details: null } })),
    )
    expect(res.status).toBe(status)
    expect((await body(res)).code).toBe(expected)
  })

  it('an unrecognised database error is 500, not a client error', async () => {
    // A database fault is ours to explain, not the caller's to fix.
    const res = await handleDriverTrip(
      request(),
      deps(async () => ({ data: null, error: { message: 'relation does not exist', code: '42P01', details: null } })),
    )
    expect(res.status).toBe(500)
    expect((await body(res)).code).toBe('INTERNAL')
  })

  it('never echoes an arbitrary code from the database', async () => {
    // Only allowlisted codes are part of the client contract; a future RAISE
    // must not be able to inject one.
    const res = await handleDriverTrip(
      request(),
      deps(async () => ({
        data: null,
        error: { message: 'x', code: 'P0001', details: '{"code":"SOMETHING_INTERNAL"}' },
      })),
    )
    expect((await body(res)).code).toBe('INTERNAL')
  })

  it('never returns the raw database message', async () => {
    const res = await handleDriverTrip(
      request(),
      deps(async () => ({
        data: null,
        error: { message: 'column trips.secret_column does not exist', code: '42703', details: null },
      })),
    )
    const b = await body(res)
    expect(JSON.stringify(b)).not.toContain('secret_column')
  })

  it('honours our own structured codes', async () => {
    const res = await handleDriverTrip(
      request(),
      deps(async () => ({ data: null, error: { message: 'not a driver', code: '42501', details: '{"code":"FORBIDDEN"}' } })),
    )
    expect(res.status).toBe(403)
    expect((await body(res)).code).toBe('FORBIDDEN')
  })

  it('classifyRpcError is pure and total', () => {
    expect(classifyRpcError({}).code).toBe('INTERNAL')
    expect(classifyRpcError({ code: 'PGRST301' }).status).toBe(401)
    expect(classifyRpcError({ details: 'not json' }).code).toBe('INTERNAL')
  })
})

describe('request handling', () => {
  it('a missing Authorization header is 401 and never reaches the database', async () => {
    const rpc = vi.fn()
    const res = await handleDriverTrip(request('GET', null), { ...deps(async () => ({ data: null, error: null })), createClient: () => ({ rpc }) })
    expect(res.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('answers a CORS preflight without credentials', async () => {
    const res = await handleDriverTrip(request('OPTIONS', null), deps(async () => ({ data: null, error: null })))
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('rejects other methods', async () => {
    const res = await handleDriverTrip(request('DELETE'), deps(async () => ({ data: null, error: null })))
    expect(res.status).toBe(405)
  })

  it('no trip is 200 + null, not 404', async () => {
    const res = await handleDriverTrip(request(), deps(async () => ({ data: null, error: null })))
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it('carries a request id on success and failure', async () => {
    const ok = await handleDriverTrip(request(), deps(async () => ({ data: null, error: null })))
    expect(ok.headers.get('x-request-id')).toMatch(/[0-9a-f-]{36}/)
    const bad = await handleDriverTrip(request(), deps(async () => ({ data: null, error: { code: 'PGRST301' } })))
    expect((await body(bad)).request_id).toMatch(/[0-9a-f-]{36}/)
  })
})

describe('progress composition', () => {
  const payload = (progressInput: unknown) => ({
    id: 't1', trip_code: 'TRP-1', status: 'ACTIVE', _progress_input: progressInput,
  })

  it('computes progress and strips the internal input', async () => {
    const res = await handleDriverTrip(
      request(),
      deps(async () => ({
        data: payload({
          geometry: [[26.1445, 91.7362], [26.7509, 94.2037]],
          position: [26.4, 93.0],
          plannedDistanceKm: '305.4',   // numeric arrives as a string
          plannedDurationMin: 420,
        }),
        error: null,
      })),
    )
    const b = (await res.json()) as Record<string, unknown>
    expect(b._progress_input).toBeUndefined()
    const progress = b.progress as { travelled_distance_km: number; reason_codes: string[] }
    expect(progress.travelled_distance_km).toBeGreaterThan(0)
    expect(progress.reason_codes).toContain('REMAINING_TIME_ASSUMES_PLANNED_PACE')
  })

  it('progress is null only when the trip has no route at all', async () => {
    const res = await handleDriverTrip(
      request(),
      deps(async () => ({ data: payload({ geometry: null, position: null, plannedDistanceKm: null, plannedDurationMin: null }), error: null })),
    )
    expect(((await res.json()) as Record<string, unknown>).progress).toBeNull()
  })

  it('a route with no fix reports nulls WITH a reason, not a null progress', async () => {
    // A truck with no fix has not arrived.
    const res = await handleDriverTrip(
      request(),
      deps(async () => ({
        data: payload({ geometry: [[26.1, 91.7], [26.7, 94.2]], position: null, plannedDistanceKm: null, plannedDurationMin: null }),
        error: null,
      })),
    )
    const progress = ((await res.json()) as Record<string, unknown>).progress as {
      fraction_complete: number | null; reason_codes: string[]
    }
    expect(progress.fraction_complete).toBeNull()
    expect(progress.reason_codes).toContain('NO_POSITION_AVAILABLE')
  })
})
