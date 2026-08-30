/**
 * Backend API client for the driver app.
 *
 * Session model, per docs/SECURITY.md section 1:
 *
 *   access token  - memory only, never persisted
 *   refresh token - expo-secure-store on native (Keystore/Keychain). On web
 *                   nothing is persisted and the driver signs in again.
 *                   See src/auth/tokenStore.ts.
 *
 * Cookies are never used. The token is always supplied explicitly, so this app
 * cannot adopt a session belonging to another application on the same host.
 *
 * Expo inlines every EXPO_PUBLIC_-prefixed variable into the app bundle, so
 * only non-sensitive values may use that prefix. No token ever goes there.
 */

import Constants from 'expo-constants'

import {
  clearRefreshToken,
  loadRefreshToken,
  saveRefreshToken,
} from '../auth/tokenStore'

/**
 * Resolve the backend base URL.
 *
 * A physical phone cannot reach the laptop on localhost - that resolves to the
 * phone itself. The dev server already knows the LAN address the phone used to
 * fetch the bundle, so reusing its host gives a working default with no manual
 * configuration. An explicit EXPO_PUBLIC_API_BASE_URL always wins.
 */
function resolveBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL
  if (explicit) return explicit

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost

  const host = hostUri?.split(':')[0]
  if (host) return `http://${host}:8000`
  return 'http://localhost:8000'
}

export const API_BASE_URL = resolveBaseUrl()

// --- Errors ---------------------------------------------------------------

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error?.message ?? fallback)
    this.name = 'ApiError'
    this.status = status
    this.code = body?.error?.code ?? 'UNKNOWN'
  }
}

export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? `Cannot reach the server: ${cause.message}`
        : 'Cannot reach the server',
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

export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler
}

// --- Requests -------------------------------------------------------------

/**
 * How long any single request may hang before it is abandoned.
 *
 * A truck cab moves through cells with a usable signal strength and no usable
 * throughput. `fetch` does not time out on its own there: the socket stays open
 * and the promise never settles, so the screen sits on "Signing in…" forever
 * with no error and no way back. A bounded wait turns that into an ordinary
 * NetworkError the driver can retry.
 */
export const REQUEST_TIMEOUT_MS = 15_000

interface RequestOptions {
  method?: string
  body?: unknown
  skipRefresh?: boolean
  /** Override for a request that is legitimately slower. */
  timeoutMs?: number
}

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  )

  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      // Deliberately NOT 'include'.
      //
      // The driver app owns its refresh token explicitly (expo-secure-store on
      // native). Sending cookies would make the web build adopt whatever
      // session already exists for the API host - and during development the
      // manager app runs on the same host, so the driver app silently
      // bootstrapped a MANAGER session from the manager's cookie. The
      // authorization boundary caught it (GET /api/driver/me returned 403), but
      // one application must not pick up another's session at all.
      //
      // On native there is no shared cookie jar, so this changes nothing there.
      credentials: 'omit',
    })
  } catch (cause) {
    throw new NetworkError(cause)
  } finally {
    // Cleared whether the request succeeded, failed or timed out. A leaked
    // timer would abort a later request that happened to reuse the controller.
    clearTimeout(timer)
  }
}

// Single-flight, for the same reason as the manager app: refresh tokens rotate
// with reuse detection, so two simultaneous refreshes look like a replay and
// revoke the whole family. One app process only needs this in-process guard -
// there are no sibling tabs to coordinate with.
let refreshInFlight: Promise<string | null> | null = null

export function refreshSession(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      // The token is always supplied explicitly - never taken from a cookie.
      // On web there is no secure storage, so there is nothing to restore and
      // the driver simply signs in again. That is the correct trade: the web
      // build is a development convenience, and persisting a refresh token in
      // browser storage would be strictly worse than asking for a password.
      const stored = await loadRefreshToken()
      if (!stored) return null

      const response = await rawRequest('/api/auth/refresh', {
        method: 'POST',
        // `client: 'mobile'` is what makes the server return the rotated token
        // in the body. Web callers get an HttpOnly cookie instead and no token
        // at all, which is why this must be declared rather than assumed.
        body: { refresh_token: stored, client: 'mobile' },
        skipRefresh: true,
      })
      if (!response.ok) {
        await clearRefreshToken()
        return null
      }
      const data = (await response.json()) as TokenResponse
      accessToken = data.access_token
      if (data.refresh_token) await saveRefreshToken(data.refresh_token)
      return accessToken
    } catch {
      return null
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  let response = await rawRequest(path, options)

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

export type AssignmentStatus =
  | 'PENDING_VERIFICATION'
  | 'ACTIVE'
  | 'ENDED'
  | 'REJECTED'

export interface AuthenticatedUser {
  id: string
  role: 'ADMIN' | 'MANAGER' | 'DRIVER'
  display_name: string
  email: string | null
  phone: string | null
}

export interface TokenResponse {
  access_token: string
  /**
   * Present only for the `mobile` contract, which this app declares.
   * A web caller gets an HttpOnly cookie and `null` here - the long-lived
   * credential is never handed to page JavaScript.
   */
  refresh_token: string | null
  expires_at: string
  user: AuthenticatedUser
}

export interface DriverMe {
  id: string
  full_name: string
  phone: string
  licence_number: string
  licence_expiry: string
  status: string
}

export interface TruckSummary {
  id: string
  registration_number: string
  truck_type: string | null
  make: string | null
  model: string | null
  max_capacity_kg: string
  status: string
}

export interface CurrentAssignment {
  id: string
  status: AssignmentStatus
  assigned_at: string
  verified_at: string | null
  mismatch_flagged: boolean
  truck: TruckSummary
}

export interface VerifyResult {
  assignment: CurrentAssignment
  already_verified: boolean
}

export interface VerifyPayload {
  assignment_id?: string
  reported_registration?: string
  reported_odometer_km?: string
  reported_fuel_level_pct?: number
  reported_damage_notes?: string
}

export interface ReadyResponse {
  status: 'ready' | 'not_ready'
  provider: string
  checks: {
    database: { ok: boolean; detail: string }
    postgis: { ok: boolean; detail: string }
  }
}

// --- Trip and location types ----------------------------------------------

export type TripStatus =
  | 'DRAFT'
  | 'ASSIGNED'
  | 'VERIFICATION_PENDING'
  | 'MANAGER_REVIEW'
  | 'ACTIVE'
  | 'DELAYED'
  | 'INCIDENT'
  | 'DELIVERED'
  | 'CLOSED'
  | 'CANCELLED'

export type TripStopStatus = 'PENDING' | 'ARRIVED' | 'COMPLETED' | 'SKIPPED'

export interface TripStop {
  id: string
  sequence: number
  kind: string
  status: TripStopStatus
  name: string | null
  address: string | null
  planned_arrival_at: string | null
  actual_arrival_at: string | null
}

export interface LastFix {
  recorded_at: string
  received_at: string
  age_seconds: number
  freshness: string
}

/**
 * Upload cadence, decided by the server.
 *
 * Not a local constant. If the app picked its own interval it would eventually
 * disagree with the threshold the manager's "LIVE" label uses, and every
 * healthy truck would read as stale.
 */
export interface TrackingConfig {
  moving_interval_seconds: number
  stationary_interval_seconds: number
  stationary_distance_m: number
  batch_size: number
  queue_limit: number
  fresh_seconds: number
}

export interface CurrentTrip {
  id: string
  trip_code: string
  status: TripStatus
  dispatched_at: string | null
  started_at: string | null
  delivered_at: string | null
  truck: TruckSummary
  stops: TripStop[]
  next_stop_id: string | null
  can_start: boolean
  start_blocked_code: string | null
  start_blocked_reason: string | null
  tracking_expected: boolean
  tracking: TrackingConfig
  last_fix: LastFix | null
}

/** One position fix. `device_fix_id` is what makes a retry safe. */
export interface GpsFix {
  device_fix_id: string
  location: { lat: number; lon: number }
  recorded_at: string
  altitude_m?: string
  speed_kmph?: string
  heading_deg?: string
  accuracy_m?: string
  is_mock_location?: boolean
}

export interface GpsBatchAccepted {
  trip_id: string
  accepted: number
  duplicates_ignored: number
  rejected: number
  rejected_reasons: Record<string, number>
  anomalies: string[]
  server_time: string
}

// --- Endpoints ------------------------------------------------------------

export const api = {
  ready: () => request<ReadyResponse>('/ready'),

  login: async (identifier: string, password: string): Promise<TokenResponse> => {
    const result = await request<TokenResponse>('/api/auth/login', {
      method: 'POST',
      body: { identifier, password, client: 'mobile' },
      skipRefresh: true,
    })
    accessToken = result.access_token
    if (result.refresh_token) await saveRefreshToken(result.refresh_token)
    return result
  },

  logout: async (): Promise<void> => {
    const stored = await loadRefreshToken()
    try {
      await request<void>('/api/auth/logout', {
        method: 'POST',
        body: stored ? { refresh_token: stored } : {},
      })
    } finally {
      accessToken = null
      await clearRefreshToken()
    }
  },

  me: () => request<DriverMe>('/api/driver/me'),
  myAssignment: () => request<CurrentAssignment | null>('/api/driver/me/assignment'),
  verifyAssignment: (payload: VerifyPayload) =>
    request<VerifyResult>('/api/driver/me/assignment/verify', {
      method: 'POST',
      body: payload,
    }),

  // Trip execution. No trip id in any path: the server resolves the trip from
  // the token. Where one is sent in a body it can only narrow the request.
  myTrip: () => request<CurrentTrip | null>('/api/driver/me/trip'),
  startTrip: (tripId: string) =>
    request<CurrentTrip>('/api/driver/me/trip/start', {
      method: 'POST',
      body: { trip_id: tripId },
    }),
  arriveAtStop: (stopId: string) =>
    request<CurrentTrip>(`/api/driver/me/trip/stops/${stopId}/arrive`, {
      method: 'POST',
    }),
  completeStop: (stopId: string) =>
    request<CurrentTrip>(`/api/driver/me/trip/stops/${stopId}/complete`, {
      method: 'POST',
    }),
  completeTrip: (tripId: string) =>
    request<CurrentTrip>('/api/driver/me/trip/complete', {
      method: 'POST',
      body: { trip_id: tripId },
    }),

  // Location upload gets its own timeout. It runs on a background cadence, so a
  // long hang would stall the queue behind it; failing sooner and retrying is
  // better than blocking the next batch.
  sendLocation: (tripId: string, fixes: GpsFix[]) =>
    request<GpsBatchAccepted>('/api/driver/me/location', {
      method: 'POST',
      body: { trip_id: tripId, fixes },
      timeoutMs: 10_000,
    }),
}
