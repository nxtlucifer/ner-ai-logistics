/**
 * Transport selection — the switch that was previously only claimed to exist.
 *
 * An earlier revision carried a comment saying `client.ts` chose between
 * transports. It did not; `supabaseApi` was written but nothing imported it, so
 * nothing routed through Supabase. These tests exist so that claim is checked
 * rather than asserted in prose.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('expo-constants', () => ({ default: { expoConfig: null, expoGoConfig: null } }))
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED: 'WHEN_UNLOCKED',
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }))

const GOOD_URL = 'https://znaveeefzgfxsblsobdb.supabase.co'
const GOOD_KEY = 'sb_publishable_synthetic0000'

const load = async (url?: string, key?: string, mode?: string) => {
  vi.resetModules()
  if (url) process.env.EXPO_PUBLIC_SUPABASE_URL = url
  else delete process.env.EXPO_PUBLIC_SUPABASE_URL
  if (key) process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key
  else delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (mode) process.env.EXPO_PUBLIC_BACKEND = mode
  else delete process.env.EXPO_PUBLIC_BACKEND
  return import('./client')
}

afterEach(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL
  delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  delete process.env.EXPO_PUBLIC_BACKEND
})

describe('transport selection', () => {
  it('uses REST only as an explicit local-development choice', async () => {
    const m = await load()
    expect(m.backendMode).toBe('local')
    expect(m.api).toBe(m.restApi)
    const explicit = await load(undefined, undefined, 'local')
    expect(explicit.api).toBe(explicit.restApi)
  })

  it('switches the whole api object to Supabase when configured', async () => {
    const m = await load(GOOD_URL, GOOD_KEY)
    expect(m.usingSupabase).toBe(true)
    expect(m.api).not.toBe(m.restApi)
  })

  it('does NOT fall back per operation to the laptop backend', async () => {
    // The point of the all-or-nothing switch. If any operation were routed back
    // to restApi, a release would still dial a private LAN address and one
    // screen would hang with nothing saying why.
    //
    // This must hold for BOTH kinds of non-Supabase operation now: the ones
    // still unmigrated, and the ones served by the hosted intelligence plane.
    // Neither may resolve to the REST client.
    const m = await load(GOOD_URL, GOOD_KEY)
    for (const op of ['places', 'offlinePackage', 'navigationPackage'] as const) {
      expect(m.api[op]).not.toBe(m.restApi[op])
    }

    // Unmigrated: throws synchronously, naming itself.
    expect(() => (m.api.places as () => unknown)()).toThrowError(/not migrated/i)

    // Hosted intelligence plane: rejects when no origin is configured, which is
    // the case under test. It must never quietly resolve - an empty package
    // would draw a navigation screen with no corridor.
    for (const op of ['offlinePackage', 'navigationPackage'] as const) {
      await expect(
        (m.api[op] as () => Promise<unknown>)(),
      ).rejects.toThrowError(/unavailable/i)
    }
  })

  it('keeps the migrated core journey on Supabase', async () => {
    const m = await load(GOOD_URL, GOOD_KEY)
    for (const op of ['me', 'myTrip', 'acceptTrip', 'startTrip', 'sendLocation', 'aiStatus', 'aiAsk'] as const) {
      expect(typeof m.api[op]).toBe('function')
      expect(m.api[op]).not.toBe(m.restApi[op])
    }
  })

  it('a broken cloud configuration is an ERROR, never a fallback to REST', async () => {
    // The defect this replaces: a typo in the URL silently demoted a cloud
    // release to dialling a laptop on a private LAN.
    const m = await load('http://172.24.85.80:8000', GOOD_KEY)
    expect(m.backendMode).toBe('supabase')
    expect(m.usingSupabase).toBe(false)
    expect(m.api).not.toBe(m.restApi)
    expect(() => (m.api.myTrip as () => unknown)()).toThrowError(m.ConfigurationError)
  })

  it('makes ZERO REST requests when cloud configuration is invalid', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const m = await load('http://172.24.85.80:8000', GOOD_KEY)
    for (const op of ['me', 'myTrip', 'acceptTrip', 'startTrip', 'sendLocation'] as const) {
      expect(() => (m.api[op] as () => unknown)()).toThrow(/misconfigured/i)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('an elevated key is a configuration error, not a demotion', async () => {
    const b64 = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const serviceJwt = `${b64({ alg: 'HS256' })}.${b64({ role: 'service_role' })}.sig`
    const m = await load(GOOD_URL, serviceJwt)
    expect(m.usingSupabase).toBe(false)
    expect(m.api).not.toBe(m.restApi)
    expect(() => (m.api.me as () => unknown)()).toThrowError(/service_role|never be embedded/)
  })

  it('a half-set cloud build is diagnosed, not demoted', async () => {
    // URL present, key missing: cloud was clearly intended.
    const m = await load(GOOD_URL, undefined)
    expect(m.backendMode).toBe('supabase')
    expect(() => (m.api.me as () => unknown)()).toThrow(/PUBLISHABLE_KEY is not set/)
  })

  it('EXPO_PUBLIC_BACKEND=supabase with no config is an error, not REST', async () => {
    const m = await load(undefined, undefined, 'supabase')
    expect(m.api).not.toBe(m.restApi)
    expect(() => (m.api.me as () => unknown)()).toThrow(/SUPABASE_URL is not set/)
  })
})
