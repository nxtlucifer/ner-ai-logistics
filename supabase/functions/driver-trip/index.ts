/**
 * GET /functions/v1/driver-trip  ->  the CurrentTrip contract.
 *
 * Replaces GET /api/driver/me/trip. This file is only the runtime binding: it
 * hands `handler.ts` a real Supabase client factory and the real environment,
 * and does nothing else. All behaviour, including error mapping, lives in the
 * handler so it can be tested without a Deno runtime.
 *
 * CALLER-SCOPED, NOT SERVICE ROLE
 *
 * The caller's own Authorization header is forwarded, so PostgREST runs as
 * `authenticated` with their `auth.uid()` and RLS applies exactly as it would
 * for a direct request. A service_role client here would bypass RLS and make
 * this function the only thing standing between one driver and another's data.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

import { handleDriverTrip, type HandlerDeps } from './handler.ts'

const deps: HandlerDeps = {
  createClient: (url, key, authorization) => {
    const client = createClient(url, key, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    return {
      rpc: (fn, args, opts) => {
        const builder = client.rpc(fn, args ?? {})
        // supabase-js exposes cancellation through the builder, not through an
        // options bag; the handler stays runtime-agnostic by not knowing that.
        return (opts?.signal ? builder.abortSignal(opts.signal) : builder) as unknown as Promise<{
          data: unknown
          error: { message?: string; details?: string | null; code?: string | null } | null
        }>
      },
    }
  },
  env: (name) => Deno.env.get(name),
  log: (message, detail) => console.error(message, detail),
}

Deno.serve((req: Request) => handleDriverTrip(req, deps))
