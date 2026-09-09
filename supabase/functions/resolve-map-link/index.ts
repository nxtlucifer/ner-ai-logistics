/**
 * Hosted Supabase Edge Function: resolve-map-link
 *
 * Resolves Google Maps URLs and short links with SSRF protection.
 */

import { handleResolveMapLink, type ResolveMapLinkDeps } from './handler.ts'

const deps: ResolveMapLinkDeps = {
  fetch: globalThis.fetch,
  timeoutMs: 5000,
}

Deno.serve((req: Request) => handleResolveMapLink(req, deps))
