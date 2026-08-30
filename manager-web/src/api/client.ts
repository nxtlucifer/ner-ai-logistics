/**
 * Backend API client.
 *
 * Token handling follows docs/SECURITY.md section 1:
 *
 *   access token  - held in memory only. Never localStorage: anything readable
 *                   by JavaScript is readable by an XSS payload.
 *   refresh token - never seen by this code at all. It lives in an HttpOnly
 *                   cookie the browser attaches to /api/auth/* automatically.
 *
 * The cost is that a page reload loses the in-memory access token. That is
 * handled by silently calling /api/auth/refresh on startup: the cookie is still
 * there, so the session survives without ever exposing a token to script.
 *
 * VITE_ variables are inlined into the bundle and are therefore public. Only
 * the API base URL uses that prefix - never a key or token.
 */

export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'

// --- Error model ----------------------------------------------------------

/** The uniform envelope every backend failure uses. */
export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
    request_id?: string
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error?.message ?? fallback)
    this.name = 'ApiError'
    this.status = status
    this.code = body?.error?.code ?? 'UNKNOWN'
    this.details = body?.error?.details ?? {}
  }

  /** Whether retrying the same request could plausibly succeed. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.status === 429
  }
}

export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? `Cannot reach the backend: ${cause.message}`
        : 'Cannot reach the backend',
    )
    this.name = 'NetworkError'
  }
}

// --- Token state ----------------------------------------------------------

let accessToken: string | null = null
let onUnauthenticated: (() => void) | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

/** Called when the session is definitively gone, so the UI can show login. */
export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler
}

// --- Core request ---------------------------------------------------------

interface RequestOptions {
  method?: string
  body?: unknown
  /** Internal: prevents infinite refresh recursion. */
  skipRefresh?: boolean
  signal?: AbortSignal
}

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      // Required for the HttpOnly refresh cookie to be sent and stored.
      credentials: 'include',
      signal: options.signal,
    })
  } catch (cause) {
    throw new NetworkError(cause)
  }
}

/**
 * In-flight refresh, shared by every concurrent caller.
 *
 * Refresh tokens rotate with reuse detection: presenting an already-rotated
 * token revokes the whole family, because that is how a stolen token is caught.
 * Two simultaneous refreshes therefore log the user out - the second one is
 * indistinguishable from a replay.
 *
 * That is not hypothetical. It happens whenever two API calls 401 at the same
 * moment, and reliably under React StrictMode, which double-invokes effects in
 * development. Single-flighting makes concurrent callers await one request.
 */
let refreshInFlight: Promise<string | null> | null = null

/** Exchange the refresh cookie for a new access token. */
export function refreshSession(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      const response = await rawRequest('/api/auth/refresh', {
        method: 'POST',
        body: {},
        skipRefresh: true,
      })
      if (!response.ok) return null
      const data = (await response.json()) as { access_token: string }
      accessToken = data.access_token
      return accessToken
    } catch {
      return null
    } finally {
      // Cleared only after the promise settles, so a caller arriving mid-flight
      // joins this request instead of starting another.
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await rawRequest(path, options)

  // A 401 on a normal call usually means the 15-minute access token expired.
  // Try exactly one silent refresh before giving up, so an active manager is
  // never bounced to the login screen mid-task.
  if (response.status === 401 && !options.skipRefresh) {
    const renewed = await refreshSession()
    if (renewed) {
      response = await rawRequest(path, { ...options, skipRefresh: true })
    } else {
      accessToken = null
      onUnauthenticated?.()
    }
  }

  if (response.status === 204) return undefined as T

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload as ApiErrorBody | null,
      `Request to ${path} failed with ${response.status}`,
    )
  }
  return payload as T
}

// --- Types ----------------------------------------------------------------

export type DatabaseProvider = 'supabase' | 'local'
export type UserRole = 'ADMIN' | 'MANAGER' | 'DRIVER'
export type DriverStatus = 'AVAILABLE' | 'ON_TRIP' | 'OFF_DUTY' | 'SUSPENDED'
export type TruckStatus =
  | 'AVAILABLE'
  | 'ON_TRIP'
  | 'MAINTENANCE'
  | 'BREAKDOWN'
  | 'RETIRED'
export type AssignmentStatus =
  | 'PENDING_VERIFICATION'
  | 'ACTIVE'
  | 'ENDED'
  | 'REJECTED'

export interface DependencyCheck {
  ok: boolean
  detail: string
}

export interface ReadyResponse {
  status: 'ready' | 'not_ready'
  provider: DatabaseProvider
  checks: { database: DependencyCheck; postgis: DependencyCheck }
}

export interface AuthenticatedUser {
  id: string
  role: UserRole
  display_name: string
  email: string | null
  phone: string | null
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_at: string
  user: AuthenticatedUser
}

export interface MeResponse {
  user: AuthenticatedUser
  permissions: string[]
}

export interface Driver {
  id: string
  user_id: string
  full_name: string
  phone: string
  photo_url: string | null
  licence_number: string
  licence_expiry: string
  status: DriverStatus
  created_at: string
}

export interface Truck {
  id: string
  registration_number: string
  truck_type: string | null
  make: string | null
  model: string | null
  max_capacity_kg: string
  current_load_kg: string
  status: TruckStatus
  baseline_mileage_kmpl: string | null
  created_at: string
}

export interface Assignment {
  id: string
  driver_id: string
  truck_id: string
  status: AssignmentStatus
  assigned_at: string
  verified_at: string | null
  mismatch_flagged: boolean
  ended_at: string | null
}

export interface Page<T> {
  items: T[]
  next_cursor: string | null
}

// --- Endpoints ------------------------------------------------------------

export const api = {
  health: () => request<{ status: string }>('/health'),
  ready: () => request<ReadyResponse>('/ready'),

  login: (identifier: string, password: string) =>
    request<TokenResponse>('/api/auth/login', {
      method: 'POST',
      body: { identifier, password },
      skipRefresh: true,
    }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST', body: {} }),
  me: () => request<MeResponse>('/api/auth/me'),

  listDrivers: (params: { limit?: number; cursor?: string; search?: string } = {}) =>
    request<Page<Driver>>(`/api/drivers${toQuery(params)}`),
  createDriver: (body: Record<string, unknown>) =>
    request<Driver>('/api/drivers', { method: 'POST', body }),
  updateDriver: (id: string, body: Record<string, unknown>) =>
    request<Driver>(`/api/drivers/${id}`, { method: 'PATCH', body }),
  deactivateDriver: (id: string) =>
    request<Driver>(`/api/drivers/${id}/deactivate`, { method: 'POST' }),

  listTrucks: (params: { limit?: number; cursor?: string; search?: string } = {}) =>
    request<Page<Truck>>(`/api/trucks${toQuery(params)}`),
  createTruck: (body: Record<string, unknown>) =>
    request<Truck>('/api/trucks', { method: 'POST', body }),
  updateTruck: (id: string, body: Record<string, unknown>) =>
    request<Truck>(`/api/trucks/${id}`, { method: 'PATCH', body }),
  retireTruck: (id: string) =>
    request<Truck>(`/api/trucks/${id}/retire`, { method: 'POST' }),

  listAssignments: (params: { activeOnly?: boolean } = {}) =>
    request<Assignment[]>(
      `/api/assignments${toQuery({ active_only: params.activeOnly })}`,
    ),
  createAssignment: (driverId: string, truckId: string) =>
    request<Assignment>('/api/assignments', {
      method: 'POST',
      body: { driver_id: driverId, truck_id: truckId },
    }),
  endAssignment: (id: string) =>
    request<Assignment>(`/api/assignments/${id}/end`, { method: 'POST' }),
}

function toQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '' && v !== false,
  )
  if (entries.length === 0) return ''
  return `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}`
}
