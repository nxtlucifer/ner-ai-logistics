/**
 * A refresh the server did not REFUSE must not delete the driver's session.
 *
 * A 5xx while the backend wakes or redeploys, or a 429 from the per-IP
 * refresh limiter (drivers behind one carrier NAT share it), used to clear the
 * stored token exactly like a 401 - signing a driver out in a dead zone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED: 'WHEN_UNLOCKED',
}))
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('expo-constants', () => ({ default: { expoConfig: null, expoGoConfig: null } }))
vi.mock('expo-secure-store', () => store)
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }))

const { ApiError, NetworkError, refreshSession, request, setUnauthenticatedHandler } = await import('./client')

const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  store.getItemAsync.mockResolvedValue('stored-refresh')
})

describe('refreshSession', () => {
  it.each([503, 429])('keeps the token and rejects retryably on %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(status)))
    const failure = await refreshSession().catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as InstanceType<typeof ApiError>).status).toBe(status)
    expect(store.deleteItemAsync).not.toHaveBeenCalled()
  })

  it('keeps the token on no signal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Network request failed') }))
    await expect(refreshSession()).rejects.toBeInstanceOf(NetworkError)
    expect(store.deleteItemAsync).not.toHaveBeenCalled()
  })

  it.each([401, 403])('discards the token only when the server refuses it (%i)', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(status)))
    await expect(refreshSession()).resolves.toBeNull()
    expect(store.deleteItemAsync).toHaveBeenCalledTimes(1)
  })

  it('a 401 whose refresh hits a waking server does not sign the driver out', async () => {
    const signedOut = vi.fn()
    setUnauthenticatedHandler(signedOut)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => reply(url.endsWith('/api/auth/refresh') ? 502 : 401)))
    await expect(request('/api/driver/me/trip')).rejects.toMatchObject({ status: 502 })
    expect(signedOut).not.toHaveBeenCalled()
    expect(store.deleteItemAsync).not.toHaveBeenCalled()
    setUnauthenticatedHandler(null)
  })
})
