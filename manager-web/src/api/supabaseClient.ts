/**
 * Supabase client configuration for Manager Web.
 *
 * Configured from VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY).
 * Inlined at build time by Vite.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? ''

export const SUPABASE_PUBLISHABLE_KEY: string =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  ''

let clientInstance: SupabaseClient | null = null

/**
 * THIS FAILS CLOSED, AND IT DID NOT USED TO.
 *
 * `manager-web/.env.production` is matched by `.gitignore` (`.env.*`), so a
 * Vercel or Netlify build never sees it - every `VITE_` value has to be entered
 * in the host dashboard. Forgetting one was silent:
 *
 *   - `SUPABASE_URL` defaulted to a hardcoded project URL, which made the
 *     `if (!SUPABASE_URL) throw` below UNREACHABLE. It could never be falsy, so
 *     the guard that looked like it protected this path protected nothing.
 *   - The key fell back to the literal string `'anon-placeholder'`, so
 *     `createClient` succeeded, the app rendered, and every request came back
 *     401. The visible symptom was "login is broken", several layers away from
 *     the cause.
 *
 * The driver app already fails closed here - `scripts/check-release-config.mjs`
 * exits non-zero rather than bundling an unconfigured APK. The manager failing
 * open was an inconsistency, not a design.
 *
 * Naming the missing variable matters: this message is the only thing standing
 * between a misconfigured deploy and an afternoon spent debugging auth.
 */
export function getSupabase(): SupabaseClient {
  if (!clientInstance) {
    const missing = [
      SUPABASE_URL ? null : 'VITE_SUPABASE_URL',
      SUPABASE_PUBLISHABLE_KEY
        ? null
        : 'VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY)',
    ].filter(Boolean)

    if (missing.length > 0) {
      throw new Error(
        `Supabase is not configured: ${missing.join(' and ')} ` +
          'must be set as environment variables in the hosting dashboard. ' +
          'A .env.production file is git-ignored and never reaches a hosted build.',
      )
    }

    clientInstance = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return clientInstance
}

export const supabase = getSupabase
