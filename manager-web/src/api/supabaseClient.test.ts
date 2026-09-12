/**
 * Configuration must fail loudly, not silently.
 *
 * `manager-web/.env.production` is git-ignored, so a hosted build only sees the
 * environment variables entered in the host dashboard. Missing one used to be
 * invisible: the URL fell back to a hardcoded project and the key to the
 * literal `'anon-placeholder'`, so the app built, deployed, rendered, and
 * returned 401 on every request. The reported symptom was "login is broken",
 * several layers from the cause.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

describe('Supabase client configuration', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('refuses to build a client when the key is missing, naming the variable', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const mod = await import('./supabaseClient')
    expect(() => mod.getSupabase()).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/)
  })

  it('refuses to build a client when the URL is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
    const mod = await import('./supabaseClient')
    // Previously unreachable: the URL had a hardcoded fallback, so the guard
    // that appeared to cover this could never fire.
    expect(() => mod.getSupabase()).toThrow(/VITE_SUPABASE_URL/)
  })

  it('says where the values belong, because that is the actionable part', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const mod = await import('./supabaseClient')
    expect(() => mod.getSupabase()).toThrow(/hosting dashboard/)
  })

  it('never substitutes a placeholder key', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const mod = await import('./supabaseClient')
    expect(() => mod.getSupabase()).toThrow()
    expect(mod.SUPABASE_PUBLISHABLE_KEY).not.toBe('anon-placeholder')
  })

  it('builds a client when both values are present', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
    const mod = await import('./supabaseClient')
    expect(mod.getSupabase()).toBeTruthy()
  })
})
