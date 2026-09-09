/**
 * Hosted Supabase Edge Function: Gemini Driver AI Assistant.
 *
 * Exposes the Gemini Driver AI endpoint at /functions/v1/gemini-ai.
 * Protects GEMINI_API_KEY as a server-side secret (never exposed to clients).
 */

import { handleGeminiAi, type HandlerDeps } from './handler.ts'

const deps: HandlerDeps = {
  fetch: globalThis.fetch,
  env: (name: string) => Deno.env.get(name),
  now: () => Date.now(),
  log: (msg: string, detail?: unknown) => console.error(msg, detail),
}

Deno.serve((req: Request) => handleGeminiAi(req, deps))
