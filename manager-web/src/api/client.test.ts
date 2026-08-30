/**
 * Refresh coordination.
 *
 * These tests exist because two separate bugs in this area both presented as
 * "the user was randomly logged out", and neither was reproducible by reading
 * the code:
 *
 *   1. Two refreshes in one tab (React StrictMode) - the second looked like a
 *      replay, so reuse detection revoked the family.
 *   2. Two refreshes across tabs - same cause, different trigger.
 *
 * The property under test is therefore: however many callers ask to refresh,
 * only ONE request reaches the server at a time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, NetworkError, refreshSession, setAccessToken } from './client'

/** Minimal Web Locks stand-in that actually serialises, so the test is real. */
function installLockManager() {
  const held = new Map<string, Promise<unknown>>()
  const request = vi.fn(async (name: string, fn: () => Promise<unknown>) => {
    const previous = held.get(name) ?? Promise.resolve()
    const run = previous.then(fn, fn)
    held.set(
      name,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  })
  // defineProperty, not assignment: `navigator` is a getter-only property on
  // globalThis in modern Node, so a plain assignment throws.
  Object.defineProperty(globalThis, 'navigator', {
    value: { locks: { request } },
    configurable: true,
    writable: true,
  })
  return request
}

describe('refreshSession', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setAccessToken(null)
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(globalThis, 'navigator')
  })

  function okResponse(token: string) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ access_token: token }),
    } as unknown as Response
  }

  it('issues exactly one request for concurrent callers in the same tab', async () => {
    installLockManager()
    let resolve!: (v: Response) => void
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)))

    const calls = [refreshSession(), refreshSession(), refreshSession()]
    resolve(okResponse('token-a'))
    const results = await Promise.all(calls)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(results).toEqual(['token-a', 'token-a', 'token-a'])
  })

  it('takes the cross-tab lock so refreshes cannot overlap', async () => {
    const request = installLockManager()
    fetchMock.mockResolvedValue(okResponse('token-b'))

    await refreshSession()

    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe('ner-auth-refresh')
  })

  it('serialises sequential refreshes through the lock', async () => {
    installLockManager()
    const order: string[] = []
    fetchMock.mockImplementation(async () => {
      order.push('start')
      await new Promise((r) => setTimeout(r, 5))
      order.push('end')
      return okResponse('token-c')
    })

    // Awaited separately so each is a distinct single-flight cycle, mimicking
    // two tabs refreshing moments apart.
    await refreshSession()
    await refreshSession()

    // No interleaving: a second request never begins before the first finishes.
    expect(order).toEqual(['start', 'end', 'start', 'end'])
  })

  it('still works when the browser has no Web Locks support', async () => {
    // No navigator installed - older browsers must degrade, not crash.
    fetchMock.mockResolvedValue(okResponse('token-d'))
    await expect(refreshSession()).resolves.toBe('token-d')
  })

  it('returns null when the refresh is rejected, without throwing', async () => {
    installLockManager()
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'UNAUTHENTICATED', message: 'no' } }),
    } as unknown as Response)

    await expect(refreshSession()).resolves.toBeNull()
  })

  it('recovers after a failure instead of wedging the lock', async () => {
    installLockManager()
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await expect(refreshSession()).resolves.toBeNull()

    fetchMock.mockResolvedValue(okResponse('token-e'))
    await expect(refreshSession()).resolves.toBe('token-e')
  })

  it('refreshes anyway when the lock manager itself rejects', async () => {
    // navigator.locks rejects in an insecure context and during page teardown.
    // That is a failure of the coordination primitive, not of the session, so
    // it must not surface as a rejected promise the caller reads as "signed
    // out".
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        locks: { request: vi.fn().mockRejectedValue(new Error('lock denied')) },
      },
      configurable: true,
      writable: true,
    })
    fetchMock.mockResolvedValue(okResponse('token-f'))

    await expect(refreshSession()).resolves.toBe('token-f')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not refresh twice if the lock rejects after the callback ran', async () => {
    // Rotation already happened inside the lock. Retrying would present a spent
    // refresh token, which reuse detection correctly treats as a replay and
    // punishes by revoking the whole family.
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        locks: {
          request: vi.fn(async (_name: string, fn: () => Promise<unknown>) => {
            await fn()
            throw new Error('lock released abnormally')
          }),
        },
      },
      configurable: true,
      writable: true,
    })
    fetchMock.mockResolvedValue(okResponse('token-g'))

    await expect(refreshSession()).rejects.toThrow('lock released abnormally')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('ApiError', () => {
  it('treats 5xx and 429 as retryable and 4xx as not', () => {
    const body = { error: { code: 'X', message: 'm' } }
    expect(new ApiError(500, body, 'f').isRetryable).toBe(true)
    expect(new ApiError(429, body, 'f').isRetryable).toBe(true)
    expect(new ApiError(409, body, 'f').isRetryable).toBe(false)
    expect(new ApiError(403, body, 'f').isRetryable).toBe(false)
  })

  it('falls back to a safe message when the body is not our envelope', () => {
    const error = new ApiError(500, null, 'Request failed')
    expect(error.message).toBe('Request failed')
    expect(error.code).toBe('UNKNOWN')
  })

  it('carries the details a form needs to map 422s onto fields', () => {
    const error = new ApiError(
      422,
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'bad',
          details: { errors: [{ loc: ['body', 'phone'], msg: 'invalid' }] },
        },
      },
      'f',
    )
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.details).toHaveProperty('errors')
  })
})

describe('NetworkError', () => {
  it('is distinguishable from an HTTP failure', () => {
    const error = new NetworkError(new Error('connection refused'))
    expect(error).toBeInstanceOf(NetworkError)
    expect(error).not.toBeInstanceOf(ApiError)
    expect(error.message).toContain('connection refused')
  })
})
