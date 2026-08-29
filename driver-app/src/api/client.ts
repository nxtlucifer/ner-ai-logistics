/**
 * Backend API client for the driver app.
 *
 * Only the system endpoints exist so far. Driver endpoints arrive in phase P5 -
 * see docs/API_CONTRACTS.md.
 *
 * Expo inlines every EXPO_PUBLIC_-prefixed variable into the app bundle, so ONLY
 * non-sensitive values may use that prefix. Tokens will be held in
 * expo-secure-store, never here. See docs/SECURITY.md section 5.
 */

import Constants from 'expo-constants'

/**
 * Resolve the backend base URL.
 *
 * A physical phone cannot reach the Windows host on localhost - that resolves to
 * the phone itself. The dev server already knows the LAN address the phone used
 * to load the bundle (`hostUri`, e.g. "192.168.1.6:8081"), so reusing its host
 * gives a working default without anyone editing a config file. An explicit
 * EXPO_PUBLIC_API_BASE_URL always wins.
 */
function resolveBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL
  if (explicit) return explicit

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)
      ?.debuggerHost

  const host = hostUri?.split(':')[0]
  if (host) return `http://${host}:8000`

  // Last resort: works in a web preview and on an emulator with port forwarding.
  return 'http://127.0.0.1:8000'
}

export const API_BASE_URL = resolveBaseUrl()

export interface DependencyCheck {
  ok: boolean
  detail: string
}

export interface ReadyResponse {
  status: 'ready' | 'not_ready'
  checks: {
    database: DependencyCheck
    postgis: DependencyCheck
  }
}

export class BackendUnreachableError extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? `Backend unreachable: ${cause.message}`
        : 'Backend unreachable',
    )
    this.name = 'BackendUnreachableError'
  }
}

async function request<T>(path: string, timeoutMs = 5000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
  } catch (cause) {
    throw new BackendUnreachableError(cause)
  } finally {
    clearTimeout(timer)
  }

  // 503 from /ready is a well-formed answer carrying dependency detail, not a
  // transport failure.
  if (!response.ok && response.status !== 503) {
    throw new Error(`${path} returned ${response.status}`)
  }

  return (await response.json()) as T
}

export const getHealth = () => request<{ status: string }>('/health')
export const getReady = () => request<ReadyResponse>('/ready')
