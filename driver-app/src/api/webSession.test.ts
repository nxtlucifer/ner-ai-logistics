/**
 * Driver web keeps its session past the access token's 15 minutes (E2E-D1).
 *
 * Web stores nothing, so the refresh token returned at sign-in used to be
 * dropped: the first 401 found nothing to refresh with and signed the driver
 * out mid-trip. It is now held in module memory - never storage - and a 401
 * renews the session and retries. A reload still ends it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED: 'WHEN_UNLOCKED',
}))
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }))
vi.mock('expo-constants', () => ({ default: { expoConfig: null, expoGoConfig: null } }))
vi.mock('expo-secure-store', () => store)
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }))

const { api, request, setUnauthenticatedHandler } = await import('./client')
const { loadRefreshToken } = await import('../auth/tokenStore')

const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => setUnauthenticatedHandler(null))

describe('driver web session', () => {
  it('renews with the in-memory refresh token on a 401 and retries, storing nothing', async () => {
    const signedOut = vi.fn()
    setUnauthenticatedHandler(signedOut)
    const refreshBodies: unknown[] = []
    let expired = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/api/auth/login')) return reply(200, { access_token: 'a1', refresh_token: 'r1', token_type: 'bearer' })
        if (url.endsWith('/api/auth/refresh')) {
          refreshBodies.push(JSON.parse(String(init?.body)))
          return reply(200, { access_token: 'a2', refresh_token: 'r2', token_type: 'bearer' })
        }
        const auth = new Headers(init?.headers).get('Authorization')
        if (expired && auth === 'Bearer a1') return reply(401)
        return reply(200, { trip: null })
      }),
    )
    await api.login('driver', 'secret')
    expired = true
    await expect(request('/api/driver/me/trip')).resolves.toEqual({ trip: null })
    expect(refreshBodies).toEqual([{ refresh_token: 'r1', client: 'mobile' }])
    // Rotated, still in memory only.
    await expect(loadRefreshToken()).resolves.toBe('r2')
    expect(store.setItemAsync).not.toHaveBeenCalled()
    expect(signedOut).not.toHaveBeenCalled()
  })

  it('forgets the token on sign-out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    await api.logout()
    await expect(loadRefreshToken()).resolves.toBeNull()
  })
})
