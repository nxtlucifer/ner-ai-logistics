/**
 * The client's job is delegation and construction, not rules.
 *
 * Every configuration RULE is owned and tested by releaseConfig.ts, which the
 * pre-bundle build gate runs too. Re-asserting the rules here would be a second
 * copy free to drift from the one the gate enforces, so this file only proves
 * that the client reads the right variables, delegates, and refuses to build a
 * client when the answer is "no".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
  WHEN_UNLOCKED: 'WHEN_UNLOCKED',
}))

const GOOD_URL = 'https://znaveeefzgfxsblsobdb.supabase.co'
const GOOD_KEY = 'sb_publishable_synthetic0000'

const load = async (url?: string, key?: string, ref?: string) => {
  vi.resetModules()
  process.env.EXPO_PUBLIC_SUPABASE_URL = url ?? ''
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key ?? ''
  if (ref) process.env.EXPO_PUBLIC_SUPABASE_PROJECT_REF = ref
  else delete process.env.EXPO_PUBLIC_SUPABASE_PROJECT_REF
  return import('./supabaseClient')
}

beforeEach(async () => {
  const SecureStore = await import('expo-secure-store')
  vi.mocked(SecureStore.getItemAsync).mockReset().mockResolvedValue(null)
  vi.mocked(SecureStore.setItemAsync).mockReset().mockResolvedValue(undefined)
  vi.mocked(SecureStore.deleteItemAsync).mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL
  delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  delete process.env.EXPO_PUBLIC_SUPABASE_PROJECT_REF
})

describe('configuration delegation', () => {
  it('accepts a valid hosted configuration', async () => {
    const m = await load(GOOD_URL, GOOD_KEY)
    expect(m.configurationProblem()).toBeNull()
    expect(m.isSupabaseConfigured()).toBe(true)
  })

  it('passes the approved project ref through to the rules', async () => {
    const m = await load('https://xhapouexwacixuvvgdde.supabase.co', GOOD_KEY, 'znaveeefzgfxsblsobdb')
    expect(m.configurationProblem()).toMatch(/approved for project znaveeefzgfxsblsobdb/)
  })

  it('rejects the exact endpoint the vc3 APK shipped', async () => {
    const m = await load('http://172.24.85.80:8000', GOOD_KEY)
    expect(m.isSupabaseConfigured()).toBe(false)
  })

  it('refuses to construct a client on bad configuration', async () => {
    const m = await load('http://172.24.85.80:8000', GOOD_KEY)
    expect(() => m.supabase()).toThrow(/not configured/)
  })

  it('never puts the key in the failure message', async () => {
    const secret = 'sb_secret_synthetic'
    const m = await load(GOOD_URL, secret)
    expect(m.configurationProblem() ?? '').not.toContain(secret)
  })
})

describe('chunkedSecureStorage', () => {
  it('stores small payloads directly without chunking', async () => {
    const SecureStore = await import('expo-secure-store')
    const { chunkedSecureStorage } = await import('./supabaseClient')

    await chunkedSecureStorage.setItem('test-key', 'small-payload')
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'test-key',
      'small-payload',
      expect.objectContaining({ keychainAccessible: 'WHEN_UNLOCKED' }),
    )
  })

  it('splits large payloads exceeding 1024 bytes into chunked subkeys', async () => {
    const SecureStore = await import('expo-secure-store')
    const { chunkedSecureStorage } = await import('./supabaseClient')

    const largePayload = 'A'.repeat(2500)
    await chunkedSecureStorage.setItem('large-key', largePayload)

    // Should write header with count = 3
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'large-key',
      '__chunked__:3',
      expect.anything(),
    )
    // Should write 3 chunks
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'large-key.0',
      'A'.repeat(1024),
      expect.anything(),
    )
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'large-key.1',
      'A'.repeat(1024),
      expect.anything(),
    )
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'large-key.2',
      'A'.repeat(452),
      expect.anything(),
    )
  })

  it('reassembles chunked payloads on getItem', async () => {
    const SecureStore = await import('expo-secure-store')
    const { chunkedSecureStorage } = await import('./supabaseClient')

    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key: string) => {
      if (key === 'chunked-item') return '__chunked__:2'
      if (key === 'chunked-item.0') return 'PART1_'
      if (key === 'chunked-item.1') return 'PART2'
      return null
    })

    const result = await chunkedSecureStorage.getItem('chunked-item')
    expect(result).toBe('PART1_PART2')
  })

  it('deletes all chunked subkeys on removeItem', async () => {
    const SecureStore = await import('expo-secure-store')
    const { chunkedSecureStorage } = await import('./supabaseClient')

    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key: string) => {
      if (key === 'chunked-del') return '__chunked__:2'
      return null
    })

    await chunkedSecureStorage.removeItem('chunked-del')
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('chunked-del.0')
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('chunked-del.1')
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('chunked-del')
  })
})

