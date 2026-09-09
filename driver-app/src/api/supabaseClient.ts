/**
 * The one configured Supabase client for this app's lifecycle.
 *
 * SESSION STORAGE PRESERVES THE EXISTING, DELIBERATE POLICY
 *
 * `src/auth/tokenStore.ts` already decided where a refresh token may live, and
 * that decision is not revisited here:
 *
 *   native - expo-secure-store (Keystore / Keychain). Never AsyncStorage: that
 *            is plaintext on the device, and a driver's phone is exactly the
 *            one most likely to be lost or shared around a depot.
 *   web    - NOWHERE. The session ends at reload, on purpose. localStorage is
 *            readable by any XSS payload, and the backend's HttpOnly cookie is
 *            deliberately not used because both apps share an API host and the
 *            driver app once adopted the manager's session through it.
 *
 * So on web `persistSession` is false and no storage adapter is supplied. That
 * keeps the documented web behaviour (a reload signs the driver out) rather
 * than quietly improving it, which would change a security decision as a side
 * effect of a backend migration.
 *
 * ONE CLIENT, ONE REFRESH LOOP - NOT YET WIRED
 *
 * supabase-js runs its own auto-refresh timer. The existing REST client also
 * has one (`refreshSession()` in client.ts). Two loops racing on the same
 * identity is the "second competing refresh loop" to avoid.
 *
 * There is NO transport switch in client.ts today, and an earlier version of
 * this comment wrongly said there was. `client.ts` still exports the REST
 * `api`, and this client is constructed only by `supabaseApi`, which is not
 * imported by any screen. Nothing routes through Supabase at runtime yet.
 *
 * The switch is deliberately withheld until the core workflow exists. Enabling
 * it now would either break the app (most operations still throw
 * NotMigratedError) or require per-operation fallback to the laptop backend -
 * and a silent fallback to a LAN address is the exact failure this migration is
 * meant to end. It goes in when `myTrip`, start, stops and completion are
 * served, as one all-or-nothing selection.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

import { releaseConfigProblem } from './releaseConfig.mjs'

/** Public configuration, inlined by Expo at build time. Never a secret key. */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''

/** The approved project for a release build, when the build declares one. */
export const SUPABASE_EXPECTED_REF = process.env.EXPO_PUBLIC_SUPABASE_PROJECT_REF ?? ''

/**
 * Why a release build must fail loudly rather than fall back.
 *
 * The shipped vc3 APK baked `http://172.24.85.80:8000` - a laptop on a LAN -
 * and on mobile data that is simply unroutable. The app could not tell "server
 * down" from "this address can never work from here", so it showed a spinner.
 *
 * The rules live in releaseConfig.ts, which is pure and has no native imports,
 * so the SAME code runs in the pre-bundle build gate. A runtime check alone
 * cannot prevent a leak: by the time this executes on a phone, Expo has already
 * inlined the key into a readable APK.
 */
export function configurationProblem(): string | null {
  return releaseConfigProblem({
    url: SUPABASE_URL,
    key: SUPABASE_PUBLISHABLE_KEY,
    expectedRef: SUPABASE_EXPECTED_REF || undefined,
  })
}

export function isSupabaseConfigured(): boolean {
  return configurationProblem() === null
}

const CHUNK_SIZE = 1024

/**
 * Keystore-backed storage in the shape supabase-js expects.
 *
 * Android SharedPreferences / Keystore has a strict 2048-byte limit per key.
 * Supabase auth sessions (JWT + refresh token + full user metadata) often
 * exceed 2048 bytes (e.g. 2100+ bytes), which causes SecureStore.setItemAsync
 * to throw SizeLimitException and fail the login on physical devices.
 * We chunk values larger than 1024 bytes into indexed sub-keys.
 */
export const chunkedSecureStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const header = await SecureStore.getItemAsync(key)
      if (!header) return null
      if (header.startsWith('__chunked__:')) {
        const count = parseInt(header.slice('__chunked__:'.length), 10)
        const parts: string[] = []
        for (let i = 0; i < count; i++) {
          const part = await SecureStore.getItemAsync(`${key}.${i}`)
          if (part === null) return null
          parts.push(part)
        }
        return parts.join('')
      }
      return header
    } catch {
      return null
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      if (value.length <= CHUNK_SIZE) {
        try {
          await SecureStore.deleteItemAsync(`${key}.0`)
        } catch {
          // Ignore
        }
        await SecureStore.setItemAsync(key, value, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED,
        })
        return
      }
      const count = Math.ceil(value.length / CHUNK_SIZE)
      await SecureStore.setItemAsync(key, `__chunked__:${count}`, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED,
      })
      for (let i = 0; i < count; i++) {
        const chunk = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
        await SecureStore.setItemAsync(`${key}.${i}`, chunk, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED,
        })
      }
    } catch {
      // Keystore write failure must not crash the app
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      let header: string | null = null
      try {
        header = await SecureStore.getItemAsync(key)
      } catch {
        header = null
      }
      if (header && header.startsWith('__chunked__:')) {
        const count = parseInt(header.slice('__chunked__:'.length), 10)
        for (let i = 0; i < count; i++) {
          try {
            await SecureStore.deleteItemAsync(`${key}.${i}`)
          } catch {
            // Ignore
          }
        }
      }
      try {
        await SecureStore.deleteItemAsync(key)
      } catch {
        // Ignore
      }
    } catch {
      // Ignored
    }
  },
}

let client: SupabaseClient | null = null

/** The single client instance. Throws rather than guessing at a bad config. */
export function supabase(): SupabaseClient {
  const problem = configurationProblem()
  if (problem) throw new Error(`Supabase is not configured: ${problem}`)
  if (client) return client

  const native = Platform.OS !== 'web'
  client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      // Native keeps the session in the Keystore and refreshes it; web keeps
      // nothing, exactly as tokenStore.ts documents.
      storage: native ? chunkedSecureStorage : undefined,
      persistSession: native,
      autoRefreshToken: native,
      // No OAuth redirect is used, and parsing the URL on a native cold start
      // is a way to pick up a session that was never meant for this app.
      detectSessionInUrl: false,
    },
  })
  return client
}

/** Test seam. */
export function __resetSupabaseClientForTests(): void {
  client = null
}
