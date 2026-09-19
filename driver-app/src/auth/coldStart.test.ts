/**
 * A sleeping server must never be reported to a driver as a broken phone.
 *
 * MEASURED ON THE PHYSICAL DEVICE (OnePlus CPH2691, Android 16), 20 Sep 2026:
 *
 *   adb shell ping 8.8.8.8                        0% packet loss
 *   adb shell curl .../health                     http 200 in 23.2 s
 *   a second probe, from the laptop                        32.9 s
 *
 *   The app, at a 15 s budget, showed:
 *     "No connection — Unable to reach the service. Check your internet
 *      or Wi-Fi."
 *
 * Two faults, and the second is the worse one. The budget was too short,
 * so the first sign-in of the day could not succeed. And the diagnosis was
 * derived by testing `/abort/i` against the error message — which never
 * matches on React Native, because RN rejects an aborted fetch with
 * "Network request failed", the same words a genuine failure produces.
 *
 * So the person least able to fix a sleeping server — a driver in the
 * hills, who will reasonably conclude they have no signal — was the person
 * being told to check their connection.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

// The real client pulls in react-native, which this environment cannot
// parse. Only the error shape matters here; the numbers are read from the
// source below so the test still asserts the REAL budget, not a copy.
vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  NetworkError: class NetworkError extends Error {
    readonly timedOut: boolean
    constructor(cause: unknown, timedOut = false) {
      super(cause instanceof Error ? `Cannot reach the server: ${cause.message}` : 'Cannot reach the server')
      this.name = 'NetworkError'
      this.timedOut = timedOut
    }
  },
}))

const { NetworkError } = await import('../api/client')
const { categorizeAuthError } = await import('./authErrors')

const CLIENT_SOURCE = readFileSync(join(__dirname, '..', 'api', 'client.ts'), 'utf8')
const budget = (name: string): number => {
  const m = CLIENT_SOURCE.match(new RegExp(`export const ${name} = ([0-9_]+)`))
  if (!m) throw new Error(`${name} is not exported from client.ts`)
  return Number(m[1].replaceAll('_', ''))
}
const AUTH_TIMEOUT_MS = budget('AUTH_TIMEOUT_MS')
const REQUEST_TIMEOUT_MS = budget('REQUEST_TIMEOUT_MS')

/** The worst cold start actually observed. */
const MEASURED_COLD_START_MS = 32_900

describe('the auth budget', () => {
  it('outlasts a measured cold start, with margin', () => {
    expect(AUTH_TIMEOUT_MS).toBeGreaterThan(MEASURED_COLD_START_MS)
    expect(AUTH_TIMEOUT_MS).toBeGreaterThanOrEqual(MEASURED_COLD_START_MS * 1.5)
  })

  it('is longer than the ordinary one, not a blanket increase', () => {
    // Every other request runs against an already-awake server. Raising
    // them all would turn one dead endpoint into a minute of spinner.
    expect(REQUEST_TIMEOUT_MS).toBeLessThan(AUTH_TIMEOUT_MS)
  })

  it('still gives up eventually', () => {
    expect(AUTH_TIMEOUT_MS).toBeLessThanOrEqual(120_000)
  })

  it('is actually applied to login AND to session restore', () => {
    // Declaring the constant and forgetting a call site leaves the same
    // failure on whichever path was missed. A relaunch uses refresh, not
    // login, and a cold relaunch is the commoner case.
    const login = CLIENT_SOURCE.slice(CLIENT_SOURCE.indexOf('login: async'), CLIENT_SOURCE.indexOf('logout: async'))
    expect(login).toContain('AUTH_TIMEOUT_MS')
    const refresh = CLIENT_SOURCE.slice(CLIENT_SOURCE.indexOf('export function refreshSession'), CLIENT_SOURCE.indexOf('export function refreshSession') + 1800)
    expect(refresh).toContain('AUTH_TIMEOUT_MS')
  })
})

describe('telling a slow server from a dead network', () => {
  it('reads React Native’s abort correctly, despite its message', () => {
    // THE REGRESSION. RN gives the abort this exact text, identical to a
    // real failure. Only the flag distinguishes them.
    const rnAbort = new NetworkError(new TypeError('Network request failed'), true)
    const result = categorizeAuthError(rnAbort)

    expect(result.code).toBe('TIMEOUT')
    expect(result.title).toMatch(/waking/i)
    expect(result.detail).toMatch(/connection is fine/i)
    // It must NOT send the driver to look at their Wi-Fi.
    expect(result.detail).not.toMatch(/check your internet/i)
  })

  it('still calls a genuine network failure a network failure', () => {
    const dead = new NetworkError(new TypeError('Network request failed'), false)
    const result = categorizeAuthError(dead)

    expect(result.code).toBe('NETWORK')
    expect(result.detail).toMatch(/check your internet/i)
  })

  it('keeps working on web, where the abort does say so', () => {
    // No flag, but the DOMException text carries it. Both signals are
    // honoured; neither alone covers both runtimes.
    const webAbort = new NetworkError(
      new DOMException('The user aborted a request', 'AbortError'),
    )
    expect(categorizeAuthError(webAbort).code).toBe('TIMEOUT')
  })

  it('carries the flag on the error, not in prose', () => {
    expect(new NetworkError(new Error('x'), true).timedOut).toBe(true)
    expect(new NetworkError(new Error('x')).timedOut).toBe(false)
  })
})
