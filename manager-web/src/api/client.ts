/**
 * Backend API client.
 *
 * Only the system endpoints exist so far. Domain endpoints arrive in phase P3 -
 * see docs/API_CONTRACTS.md.
 *
 * The base URL comes from VITE_API_BASE_URL. Vite inlines any VITE_-prefixed
 * variable into the client bundle, so ONLY non-sensitive values may use that
 * prefix. No token, key or password ever goes here. See docs/SECURITY.md
 * section 5.
 */

export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'

/** Health of a single backend dependency, as reported by GET /ready. */
export interface DependencyCheck {
  ok: boolean
  detail: string
}

/** Which database the backend is configured against. */
export type DatabaseProvider = 'supabase' | 'local'

export interface ReadyResponse {
  status: 'ready' | 'not_ready'
  /**
   * Safe to display: an enum naming the configured provider, never a host,
   * user or connection string. The backend deliberately exposes nothing more -
   * see docs/SECURITY.md section 5.
   */
  provider: DatabaseProvider
  checks: {
    database: DependencyCheck
    postgis: DependencyCheck
  }
}

export interface HealthResponse {
  status: string
}

/** Thrown when the backend cannot be reached at all, as distinct from a 503. */
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
    // Network failure, DNS failure, CORS rejection or timeout. The backend is
    // not answering, which is a different state from answering with an error.
    throw new BackendUnreachableError(cause)
  } finally {
    clearTimeout(timer)
  }

  // 503 from /ready is a meaningful, well-formed answer rather than a failure:
  // it carries the per-dependency detail we want to display.
  if (!response.ok && response.status !== 503) {
    throw new Error(`${path} returned ${response.status}`)
  }

  return (await response.json()) as T
}

export const getHealth = () => request<HealthResponse>('/health')
export const getReady = () => request<ReadyResponse>('/ready')
