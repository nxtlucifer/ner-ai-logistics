/**
 * The first sign-in of the day must outlast a sleeping backend.
 *
 * MEASURED, 20 September 2026, `GET /health` on the hosted service:
 *
 *   request 1   32.85 s    <- Render's free tier waking up
 *   request 2    0.35 s
 *   request 3    0.19 s
 *   request 4    0.17 s
 *   request 5    0.42 s
 *
 * The client's default abort was 15 s, so the first login against a slept
 * server could not succeed. It failed seventeen seconds before the server
 * finished starting, and told the manager the backend was unreachable — by
 * a request that would have worked had it waited. Retrying appeared to
 * "fix" it, because the failed attempt was what woke the service.
 *
 * This test holds the budget above the measured wake. If someone lowers it
 * back to the default to make a test faster, the demo breaks on the one
 * request a judge makes first, and this fails instead.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const CLIENT = readFileSync(join(__dirname, 'client.ts'), 'utf8')

/** The worst cold start actually observed, in milliseconds. */
const MEASURED_COLD_START_MS = 32_850

function constant(name: string): number {
  const match = CLIENT.match(new RegExp(`const ${name} = ([0-9_]+)`))
  if (!match) throw new Error(`${name} is not declared in client.ts`)
  return Number(match[1].replaceAll('_', ''))
}

describe('request budgets', () => {
  it('gives auth more than the measured cold start, with margin', () => {
    const auth = constant('AUTH_TIMEOUT_MS')
    expect(auth).toBeGreaterThan(MEASURED_COLD_START_MS)
    // Margin for a slow network on top of the wake itself.
    expect(auth).toBeGreaterThanOrEqual(MEASURED_COLD_START_MS * 1.5)
  })

  it('still aborts eventually, so a dead backend is not a hang', () => {
    expect(constant('AUTH_TIMEOUT_MS')).toBeLessThanOrEqual(120_000)
    expect(constant('REQUEST_TIMEOUT_MS')).toBeLessThanOrEqual(30_000)
  })

  it('applies the longer budget to login AND to session restore', () => {
    // A reload on a cold server goes through /api/auth/me, not /login.
    // Fixing only one of them leaves the same failure on refresh.
    const login = CLIENT.slice(CLIENT.indexOf('login: ('), CLIENT.indexOf('logout: ('))
    expect(login).toContain('AUTH_TIMEOUT_MS')
    const me = CLIENT.slice(CLIENT.indexOf('me: ()'), CLIENT.indexOf('me: ()') + 200)
    expect(me).toContain('AUTH_TIMEOUT_MS')
  })

  it('applies it to the silent refresh too - a reload refreshes before /me', () => {
    const at = CLIENT.indexOf("rawRequest('/api/auth/refresh'")
    expect(at).toBeGreaterThan(-1)
    const call = CLIENT.slice(at, CLIENT.indexOf('})', at))
    expect(call).toContain('timeoutMs: AUTH_TIMEOUT_MS')
  })

  it('keeps the ordinary default short — only auth waits for a wake', () => {
    expect(constant('REQUEST_TIMEOUT_MS')).toBeLessThan(constant('AUTH_TIMEOUT_MS'))
  })
})
