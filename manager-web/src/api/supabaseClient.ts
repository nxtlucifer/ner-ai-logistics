/**
 * Supabase client configuration for Manager Web.
 *
 * Configured from VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY).
 * Inlined at build time by Vite.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://znaveeefzgfxsblsobdb.supabase.co'

export const SUPABASE_PUBLISHABLE_KEY: string =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  ''

let clientInstance: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!clientInstance) {
    if (!SUPABASE_URL) {
      throw new Error('Supabase URL is not configured (VITE_SUPABASE_URL)')
    }
    clientInstance = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY || 'anon-placeholder', {
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
