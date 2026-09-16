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

import { markOffline, markOnline } from './connectivity'
import { getSupabase } from './supabaseClient'
import { UNAVAILABLE_OPERATIONS, supabaseManagerApi } from './supabaseManagerApi'

export const BACKEND_TARGET: string =
  import.meta.env.VITE_BACKEND ?? (import.meta.env.VITE_SUPABASE_URL ? 'supabase' : 'local')

export const API_BASE_URL: string =
  BACKEND_TARGET === 'supabase' ? '' : (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000')

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
  /** True when the request was abandoned because the backend took too long. */
  readonly timedOut: boolean

  constructor(cause: unknown) {
    const timedOut = cause instanceof Error && cause.name === 'TimeoutError'
    super(
      timedOut
        ? 'The backend did not answer in time. It may still be working on the request.'
        : cause instanceof Error
          ? `Cannot reach the backend: ${cause.message}`
          : 'Cannot reach the backend',
    )
    this.name = 'NetworkError'
    this.timedOut = timedOut
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
  /** Raw bytes with their own type (a photo). Sent as-is, not JSON. */
  raw?: Blob
  /** Internal: prevents infinite refresh recursion. */
  skipRefresh?: boolean
  signal?: AbortSignal
  /** Longer than the default for a read that fans out to slow providers. */
  timeoutMs?: number
}

const REQUEST_TIMEOUT_MS = 15_000
/**
 * A route assessment asks weather at up to ten points per route, plus terrain,
 * river levels, official alerts and fleet traffic; on the hosted backend a cold
 * two-corridor check was observed to outlast the 15 s default, which left the
 * manager a "Cannot reach the backend" they never saw and a NOT ASSESSED panel.
 * The answer arrives; it needs the time it costs.
 */
const SLOW_READ_TIMEOUT_MS = 90_000

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.raw) headers['Content-Type'] = options.raw.type || 'application/octet-stream'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  // A backend that accepts the connection and never answers (pool exhausted,
  // upstream database gone) must not hold a page on "Loading…" forever. The
  // caller's own signal still aborts sooner.
  const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS)
  const signal =
    options.signal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([options.signal, timeout])
      : (options.signal ?? timeout)

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      // Required for the HttpOnly refresh cookie to be sent and stored.
      credentials: 'include',
      signal,
    })
    markOnline()
    return response
  } catch (cause) {
    // The caller cancelling is not the backend being away.
    if (!options.signal?.aborted) markOffline(`${API_BASE_URL}/health`)
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

export const REFRESH_LOCK = 'ner-auth-refresh'

/**
 * Serialise refresh across TABS, not just within one.
 *
 * Single-flighting fixes duplicate refreshes inside one tab. It cannot help
 * across tabs: two tabs are separate JavaScript contexts that share only the
 * cookie. Both would present the SAME refresh token, the second would look like
 * a replay, and reuse detection would revoke the family - logging the user out
 * of every tab.
 *
 * The Web Locks API is exactly the right primitive: same-origin, cross-tab, and
 * the lock is released automatically if the holding tab crashes or is closed,
 * so a dead leader cannot wedge the others. Whoever waits then refreshes using
 * the cookie the leader already rotated, which is a legitimate new rotation
 * rather than a replay.
 *
 * Crucially this does NOT weaken reuse detection. The lock is scoped to one
 * browser profile and one origin. An attacker replaying a stolen token from
 * another browser, profile or machine never acquires it, reaches the server
 * with a spent token, and still revokes the family. What is suppressed is only
 * the false positive our own tabs were generating.
 *
 * No token crosses the lock. Waiting tabs re-refresh rather than receiving a
 * broadcast token, so the access token never leaves the tab that obtained it.
 */
async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (
    globalThis as { navigator?: { locks?: LockManager } }
  ).navigator?.locks
  if (!locks?.request) {
    // Older browsers, or a non-DOM environment. Same-tab single-flight still
    // applies; cross-tab falls back to the previous behaviour.
    return fn()
  }
  // Tracked so a lock failure cannot cause a SECOND refresh. If `fn` already
  // ran, its token was already rotated; re-running it would present a spent
  // token and trip the very reuse detection this lock exists to avoid.
  let started = false
  const once = () => {
    started = true
    return fn()
  }

  try {
    return (await locks.request(REFRESH_LOCK, once)) as T
  } catch (error) {
    // The lock manager itself failed, not the refresh. navigator.locks rejects
    // in an insecure context and can reject while a page is being torn down.
    // Falling through to an unlocked refresh loses cross-tab coordination;
    // letting the rejection escape would instead reach the UI as an
    // unrecognised error and sign the manager out for a reason that has nothing
    // to do with their session.
    if (!started) return fn()
    throw error
  }
}

/** Exchange the refresh cookie for a new access token. */
export function refreshSession(): Promise<string | null> {
  if (BACKEND_TARGET === 'supabase') {
    return (async () => {
      try {
        const { data, error } = await getSupabase().auth.getSession()
        if (error || !data.session) return null
        accessToken = data.session.access_token
        return accessToken
      } catch {
        return null
      }
    })()
  }

  if (refreshInFlight) return refreshInFlight

  refreshInFlight = withRefreshLock(async () => {
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
    }
  }).finally(() => {
    // Cleared only after the promise settles, so a caller arriving mid-flight
    // joins this request instead of starting another.
    refreshInFlight = null
  })

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
  /**
   * Always null for this client. The refresh token lives in an HttpOnly cookie
   * the browser attaches to /api/auth/* automatically; it is never placed in a
   * response body, so an XSS payload has nothing to read.
   */
  refresh_token: null
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
  /**
   * Whether the account behind this driver can still sign in.
   *
   * Not the same fact as `status`, and the difference is the point: `status`
   * says whether the person is free to take work, this says whether they can
   * reach the app at all. A driver can read AVAILABLE here and still be
   * refused at dispatch with DRIVER_LOGIN_INACTIVE, because a trip they
   * cannot start is a trip that strands a truck.
   */
  login_is_active: boolean
  created_at: string
}

export interface Truck {
  id: string
  registration_number: string
  /** `/api/files/{id}` - a reference or trip photo; read with AuthImage. */
  photo_url?: string | null
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
  /** DRIVER_APP_PHOTO | DRIVER_APP | MANAGER_MANUAL | null - who verified. */
  verification_source?: string | null
  verification_photo_url?: string | null
  reported_registration?: string | null
}

export interface DriverDocumentStatus {
  id: string
  doc_type: string
  number_masked: string | null
  issued_on: string | null
  expires_on: string | null
  status: string
  file_url: string | null
}

export interface Page<T> {
  items: T[]
  next_cursor: string | null
}

// --- Trips, shipments and fleet location ----------------------------------

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

/**
 * Freshness labels, decided by the SERVER.
 *
 * The threshold arrives with the data (`fresh_seconds`). A client that decided
 * for itself what "live" meant would eventually disagree with the system, and a
 * dispatcher would act on a green marker the backend does not consider current.
 */
export type Freshness = 'LIVE' | 'STALE' | 'NO_CONTACT' | 'NO_LOCATION'

export interface Shipment {
  id: string
  reference_code: string
  client_name: string
  pickup_address: string
  destination_address: string
  total_weight_kg: string
  priority: string
  status: string
  scheduled_pickup_at: string | null
  expected_delivery_at: string | null
  created_at: string
}

export interface Trip {
  id: string
  trip_code: string
  shipment_id: string
  truck_id: string
  driver_id: string
  status: TripStatus
  selected_route_id: string | null
  dispatched_at: string | null
  started_at: string | null
  delivered_at: string | null
  planned_eta: string | null
  current_eta: string | null
  delay_minutes: number | null
  created_at: string
}

export interface TripStop {
  id: string
  sequence: number
  kind: string
  status: TripStopStatus
  name: string | null
  address: string | null
  planned_arrival_at: string | null
  actual_arrival_at: string | null
  actual_departure_at: string | null
}

/** What is on the truck. Derived by the database from cargo_items. */
export interface ShipmentSummary {
  id: string
  reference_code: string
  client_name: string
  total_weight_kg: string
  priority: string
}

export interface TripDetail extends Trip {
  stops: TripStop[]
  shipment: ShipmentSummary
}

export type EmergencyState =
  | 'DRIVER_CHECK_REQUIRED'
  | 'DRIVER_RESPONDED'
  | 'SOS_ESCALATED'
  | 'RESOLVED'
  | 'FALSE_ALARM'

export type DriverCheckResponse =
  | 'I_AM_SAFE'
  | 'TRAFFIC'
  | 'MECHANICAL_BREAKDOWN'
  | 'WEATHER_LANDSLIDE'
  | 'REST_STOP'
  | 'FUEL_EMPTY'
  | 'MEDICAL_ISSUE'
  | 'POLICE_CHECKPOST'
  | 'ROAD_BLOCKED'
  | 'NEED_HELP'

export interface BriefingSnapshot {
  version?: number
  escalated_at?: string
  escalation_reason?: string
  trip_code?: string
  driver?: {
    name?: string
    phone?: string | null
    emergency_contact_name?: string | null
    emergency_contact_phone?: string | null
  }
  truck?: {
    registration?: string
    model?: string | null
  }
  cargo?: {
    priority?: string | null
    weight_kg?: number | string | null
  }
  corridor?: {
    origin?: string | null
    destination?: string | null
  }
  last_known_location?: {
    latitude?: number
    longitude?: number
    fix_at?: string
    minutes_stationary?: number
  }
  suggested_actions?: string[]
}

export interface Emergency {
  id: string
  trip_id: string
  state: EmergencyState
  triggered_at: string
  stationary_since: string
  last_gps_point_id?: string | null
  check_sent_at?: string | null
  response_deadline_at?: string | null
  driver_response?: DriverCheckResponse | null
  responded_at?: string | null
  escalated_at?: string | null
  resolved_at?: string | null
  resolved_by_user_id?: string | null
  resolution_note?: string | null
  briefing_snapshot?: BriefingSnapshot | null
}

export interface Position {
  location: { lat: number; lon: number }
  /** Device clock: when the truck was there. */
  recorded_at: string
  /** Server clock: when we learned of it. Freshness is measured from this. */
  received_at: string
  age_seconds: number
  freshness: Freshness
  speed_kmph: number | null
  heading_deg: number | null
  accuracy_m: number | null
  is_mock_location: boolean
}

export interface FleetTrip {
  trip_id: string
  trip_code: string
  trip_status: TripStatus
  driver_id: string
  driver_name: string
  truck_id: string
  registration_number: string
  started_at: string | null
  /** Null when no fix has ever arrived — not the same as a stale one. */
  position: Position | null
  freshness: Freshness
  next_stop_sequence: number | null
  next_stop_name: string | null
  stops_done: number
  stops_total: number
}

export interface FleetSnapshot {
  trips: FleetTrip[]
  fresh_seconds: number
  stale_seconds: number
  server_time: string
}

export interface TrackSnapshot {
  trip_id: string
  points: Position[]
  truncated: boolean
}

export interface ShipmentCreate {
  reference_code: string
  client_name: string
  pickup_address: string
  pickup: { lat: number; lon: number }
  destination_address: string
  destination: { lat: number; lon: number }
  cargo_items: {
    cargo_type: string
    cargo_name: string
    weight_kg: string
    quantity?: number
  }[]
}

export type RouteKind = 'PRIMARY' | 'FUEL_EFFICIENT' | 'EMERGENCY_BACKUP'
export type RouteState = 'PROPOSED' | 'SELECTED' | 'SUPERSEDED'

/**
 * A planned route.
 *
 * Note what is NOT here. There is no `estimated_fuel_litres`: no fuel model
 * exists, and a permanently-null field invites a UI to render `0`. And
 * `estimated_duration_min` is the provider's FREE-FLOW TRAVEL TIME, not an ETA
 * — no departure time, traffic or stop dwell is accounted for, so it must never
 * be shown as an arrival time.
 */
export interface TripRoute {
  id: string
  kind: RouteKind
  state: RouteState
  distance_km: string | null
  estimated_duration_min: number | null
  routing_provider: string | null
  created_at: string
  /** [[lat, lon], ...] in travel order. */
  geometry: [number, number][]
  /**
   * Whether this is the route the trip is ACTUALLY following — the row
   * `trips.selected_route_id` points at.
   *
   * Not the same question as `state === 'SELECTED'`, and this is the field to
   * trust. Trips whose assignment was retired by a planning request before
   * that was fixed still point at a row reading `SUPERSEDED`; the driver is
   * following it, and inferring "current" from the lifecycle state hides it.
   */
  is_current: boolean
  estimated_fuel_litres?: number | string | null
}

export interface RouteRiskSummary {
  /**
   * Null when no assessment was made at all - see `band`.
   *
   * Nullable rather than 0 on purpose. Zero is a legitimate score meaning "we
   * looked and found nothing wrong"; null means "nobody looked". Collapsing the
   * two is the single failure mode this domain cannot afford, and it is what a
   * hardcoded fixture used to do here.
   */
  score: number | null
  /**
   * `UNASSESSED` when the intelligence plane could not be reached, or is not
   * configured for this deployment. It is NOT a synonym for LOW: an unassessed
   * route is an unchecked road, not a clear one.
   */
  band: 'LOW' | 'MODERATE' | 'HIGH' | 'UNASSESSED'
  unavailable: string[]
  reason_codes: string[]
  /**
   * Evidence blocks the engine attaches when it had them. Optional: an older
   * backend, or a route the DEM could not see, simply omits them.
   */
  terrain?: TerrainProfileRead | null
  landslide_history?: LandslideHistoryRead | null
  flood?: FloodContextRead | null
  official_warnings?: OfficialWarningsRead | null
  /** RASTA fleet traffic from our own trucks' probes. UNKNOWN until proven. */
  traffic?: TrafficRead | null
}

export interface TrafficSegmentRead {
  start_m: number
  end_m: number
  state: 'UNKNOWN' | 'NORMAL' | 'SLOW' | 'CONGESTED' | string
  observed_kmph: number | null
  baseline_kmph: number | null
  sample_count: number
  vehicle_count: number
  newest_age_seconds: number | null
}

export interface TrafficRead {
  status: 'UNKNOWN' | 'NORMAL' | 'SLOW' | 'CONGESTED' | string
  coverage: number
  delay_min: number
  sample_count: number
  vehicle_count: number
  newest_age_seconds: number | null
  updated_at: string
  provider: string
  reason_codes: string[]
  segments: TrafficSegmentRead[]
}

/** NDMA SACHET (CAP) alerts naming a district the corridor crosses. Placement by district name. */
export interface OfficialWarningRead {
  identifier: string
  sender: string
  event: string
  severity: string
  urgency: string
  headline: string
  area_desc: string
  sent: string | null
  expires: string | null
}

export interface OfficialWarningsRead {
  level: 'ACTIVE' | 'CLEAR' | 'UNKNOWN' | string
  on_route: OfficialWarningRead[]
  in_states: number
  considered: number
  districts: string[]
  provider: string
  fetched_at: string | null
  reason_codes: string[]
}

/** River discharge along the corridor against its own 30-day mean. Context, not a flood claim. */
export interface FloodContextRead {
  level: 'NORMAL' | 'ELEVATED' | 'UNKNOWN' | string
  ratio_max: number | null
  provider: string
  observed_on: string | null
  cells: number
  reason_codes: string[]
}

export interface TerrainSegmentRead {
  start_m: number
  end_m: number
  grade_pct: number
  terrain_class: 'FLAT' | 'ROLLING' | 'HILLY' | 'STEEP' | string
}

/** Copernicus DEM profile of one route. `coverage` is how much of it the DEM answered. */
export interface TerrainProfileRead {
  source: string
  fetched_at: string
  spacing_m: number
  samples_requested: number
  samples_answered: number
  coverage: number
  usable: boolean
  min_elevation_m: number | null
  max_elevation_m: number | null
  total_ascent_m: number
  total_descent_m: number
  max_grade_pct: number
  steep_km: number
  class_km: Record<string, number>
  segments: TerrainSegmentRead[]
}

export interface LandslideEventRead {
  latitude: number
  longitude: number
  year: number | null
  name: string | null
}

/** Recorded-landslide exposure for the corridor. A label, never a probability. */
export interface LandslideHistoryRead {
  exposure: 'UNKNOWN' | 'LOW' | 'MODERATE' | 'HIGH' | string
  data_status: string
  provider: string | null
  considered_count: number
  on_route_count: number
  imprecise_count: number
  unlocatable_count: number
  nearest_km: number | null
  inventory_from_year: number | null
  inventory_to_year: number | null
  reason_codes: string[]
  events: LandslideEventRead[]
}

export interface RouteTradeoff {
  /** Positive means the recommendation takes LONGER than the baseline. */
  duration_delta_min: number | null
  distance_delta_km: number | null
  /** Negative means the recommendation is SAFER. */
  risk_delta_points: number
  fuel_delta_litres?: number | null
}

/**
 * A named person's single-use acceptance of incomplete hazard evidence.
 *
 * NOT a statement that the road is clear. After this is consumed the route
 * still assesses UNKNOWN and every screen still says the evidence is
 * incomplete - that is the whole design, and any UI that renders this as
 * "safe" or "verified" is wrong.
 */
export interface ReviewAuthorization {
  id: string
  trip_id: string
  route_id: string
  basis: string
  rationale: string
  reviewer_user_id: string
  issued_at: string
  expires_at: string
  consumed_at: string | null
  consumed_by_trip_id?: string | null
  revoked_at: string | null
  revoked_by?: string | null
  policy_version: string
  evidence_version: string
  evidence_digest?: string | null
  /** The assessment as the reviewer saw it. Incomplete, shown as incomplete. */
  evidence_snapshot: Record<string, unknown>
}

export type RouteEligibility =
  | 'ELIGIBLE'
  | 'REQUIRES_REVIEW'
  | 'REJECTED'
  | 'NOT_ASSESSED'

export interface RouteComparison {
  route_id: string
  kind: RouteKind
  distance_km: number | null
  estimated_duration_min: number | null
  risk: RouteRiskSummary
  /**
   * Decided by the server from this route's own hazard evidence.
   *
   * Never re-derive this here. `risk.reason_codes` says WHY; this says WHAT,
   * and a client holding its own copy of the eligibility rule is a client
   * asserting its own eligibility.
   */
  eligibility: RouteEligibility
}

export interface RouteRecommendation {
  recommended_route_id: string | null
  baseline_route_id: string | null
  /**
   * False when the answer does NOT rest on a like-for-like comparison: only
   * one route existed, or the candidates were scored from different evidence.
   * Read this before the recommendation itself.
   */
  comparable: boolean
  reason_codes: string[]
  tradeoff: RouteTradeoff | null
  candidates: RouteComparison[]
  unavailable_inputs: string[]
  margin_points: number
  version: string
}

/**
 * Whether anything should be raised about the road a moving truck is on.
 *
 * Three outcomes, and ALERT_ONLY is the one to read first: the road has
 * deteriorated and there is NOTHING better to offer. On a single corridor -
 * most of the North East - that is the common case, and a UI that only knows
 * how to render a proposal falls silent exactly when it matters.
 */
export interface RerouteAssessment {
  outcome: 'NO_ACTION' | 'ALERT_ONLY' | 'PROPOSE'
  selected_route_id: string | null
  selected_risk_score: number | null
  selected_risk_band: string | null
  /** Populated only for PROPOSE. Null on ALERT_ONLY, deliberately. */
  proposed_route_id: string | null
  reason_codes: string[]
  comparison: RouteRecommendation | null
  unavailable_inputs: string[]
  floor_points: number
  /**
   * The second trigger: how severe the CONDITIONS alone must be, regardless of
   * how long the trip is.
   *
   * `floor_points` is measured against a score that includes distance and
   * duration, which a short trip structurally cannot reach - heavy rain along
   * a whole 150 km corridor scores 53 against a floor of 60. Exposure is a
   * property of the journey, not of the storm sitting on it, so conditions get
   * their own threshold.
   */
  severe_conditions_points: number
  margin_points: number
  version: string
}

export interface RerouteAccepted {
  trip_id: string
  previous_route_id: string
  selected_route_id: string
  selected_route_kind: RouteKind
}

export interface AiStatus {
  available: boolean
  provider: string | null
  model: string | null
  detail: string | null
  languages: Record<string, string>
}

export interface AiAnswer {
  answer: string
  generated: boolean
  model: string | null
  facts_as_of: string | null
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  source_mode: 'LIVE_DATA' | 'CACHED_DATA' | 'GENERAL'
  actions: string[]
  disclaimer: string | null
}

export interface RoutePlanResult {
  route: TripRoute
  provider: string
  /** True when the primary provider had to be skipped. Worth surfacing. */
  used_fallback: boolean
  providers_attempted: string[]
}

/**
 * Plan a shipment and its trip together.
 *
 * The trip half carries no `shipment_id` — the server creates the shipment in
 * the same transaction, so the id does not exist when this request is written.
 * That absence is what makes the operation atomic rather than two calls.
 */
export interface TripPlanCreate {
  shipment: ShipmentCreate
  trip: {
    trip_code: string
    truck_id: string
    driver_id: string
  }
}

// --- Endpoints ------------------------------------------------------------

// --- Address search -------------------------------------------------------

/** One autocomplete row. `place_id` is the only thing that resolves. */
export interface AddressSuggestion {
  place_id: string
  primary_text: string
  secondary_text: string
}

export interface AddressSuggestions {
  /**
   * False when no provider is configured on the SERVER.
   *
   * Distinct from an empty list, which means a provider looked and found
   * nothing. The client must not collapse the two: one is a setup step, the
   * other is a different search term.
   */
  available: boolean
  provider: string | null
  suggestions: AddressSuggestion[]
  /** Set when a configured provider refused - quota, a bad key, a dead API. */
  error: string | null
}

/** A resolved endpoint. The address and the coordinate arrive together. */
export interface ResolvedAddress {
  place_id: string
  address: string
  lat: number
  lon: number
  /** Google requires attribution wherever its results are displayed. */
  attribution: string
}

export interface ResolvedMapLink {
  latitude: number
  longitude: number
  label: string | null
  normalized_url: string
  resolved_via: string
  attribution?: string
}

export const restApi = {
  /**
   * Address suggestions for the trip planner.
   *
   * The KEY IS NOT HERE. Google is called by the backend, which holds the
   * credential; a `VITE_`-prefixed key would be inlined into this bundle.
   */
  addressSuggestions: (q: string, sessionToken: string, signal?: AbortSignal) =>
    request<AddressSuggestions>(
      `/api/geocoding/suggest?q=${encodeURIComponent(q)}` +
        `&session_token=${encodeURIComponent(sessionToken)}`,
      { signal },
    ),

  /** Resolve one suggestion to an address and a coordinate. */
  resolveAddress: (placeId: string, sessionToken: string) =>
    request<ResolvedAddress>(
      `/api/geocoding/details?place_id=${encodeURIComponent(placeId)}` +
        `&session_token=${encodeURIComponent(sessionToken)}`,
    ),

  /**
   * Resolve a pasted Google Maps link (full or maps.app.goo.gl) through our
   * backend, which follows the share redirect by header only and hands any
   * place text to our own geocoder. Nothing of Google's is scraped.
   */
  resolveMapLink: (url: string) =>
    request<ResolvedMapLink>('/api/geocoding/resolve-link', { method: 'POST', body: { url } }),

  health: () => request<{ status: string }>('/health'),
  ready: () => request<ReadyResponse>('/ready'),
  /** Data-source health + the code-audited intelligence inventory (System page). */
  systemProviders: () => request<SystemProviders>('/api/system/providers'),

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
  getDriver: (id: string) => request<Driver>(`/api/drivers/${id}`),
  deactivateDriver: (id: string) =>
    request<Driver>(`/api/drivers/${id}/deactivate`, { method: 'POST' }),
  /** 15-minute read-only token that opens the driver app as this driver. */
  supportSession: (id: string) =>
    request<SupportSession>(`/api/drivers/${id}/support-session`, { method: 'POST' }),

  listTrucks: (params: { limit?: number; cursor?: string; search?: string } = {}) =>
    request<Page<Truck>>(`/api/trucks${toQuery(params)}`),
  createTruck: (body: Record<string, unknown>) =>
    request<Truck>('/api/trucks', { method: 'POST', body }),
  updateTruck: (id: string, body: Record<string, unknown>) =>
    request<Truck>(`/api/trucks/${id}`, { method: 'PATCH', body }),
  getTruck: (id: string) => request<Truck>(`/api/trucks/${id}`),
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
  /** A driver without a smartphone: the manager confirms the plate by hand. */
  verifyAssignmentManually: (id: string, registration: string, note?: string) =>
    request<Assignment>(`/api/assignments/${id}/verify-manual`, { method: 'POST', body: { reported_registration: registration, note } }),
  /** Masked document status for one driver (never the number). */
  driverDocuments: (driverId: string) => request<DriverDocumentStatus[]>(`/api/drivers/${driverId}/documents`),
  /** A truck's reference photo (JPEG/PNG bytes). Labelled DEMO_REFERENCE or TRUCK_PHOTO by kind. */
  uploadTruckPhoto: (truckId: string, file: File, kind: 'TRUCK_PHOTO' | 'DEMO_REFERENCE' = 'TRUCK_PHOTO') =>
    request<{ id: string; url: string }>(`/api/files?kind=${kind}&truck_id=${truckId}`, { method: 'POST', raw: file }),

  listShipments: (params: { limit?: number } = {}) =>
    request<Page<Shipment>>(`/api/shipments${toQuery(params)}`),
  createShipment: (body: ShipmentCreate) =>
    request<Shipment>('/api/shipments', { method: 'POST', body }),

  listTrips: (params: { limit?: number; trip_status?: string } = {}) =>
    request<Page<Trip>>(`/api/trips${toQuery(params)}`),
  getTrip: (id: string) => request<TripDetail>(`/api/trips/${id}`),
  createTrip: (body: {
    trip_code: string
    shipment_id: string
    truck_id: string
    driver_id: string
  }) => request<Trip>('/api/trips', { method: 'POST', body }),
  /**
   * Plan a shipment and its trip in ONE request, so they are ONE transaction.
   *
   * Calling createShipment then createTrip cannot be atomic across a network:
   * the shipment commits, the capacity gate refuses the trip, and a cargo
   * record nothing references is stranded - one more on every retry. The
   * server does both or neither.
   */
  planTrip: (body: TripPlanCreate) =>
    request<Trip>('/api/trips/plan', { method: 'POST', body }),
  dispatchTrip: (id: string) =>
    request<Trip>(`/api/trips/${id}/dispatch`, { method: 'POST' }),
  /**
   * Before pickup the body is optional. Once cargo is on the truck the server
   * requires `reason` (10+ chars) and a `disposition` - RETURN_TO_DEPOT,
   * NEW_DESTINATION (+ destination), HOLD_FOR_INSTRUCTION,
   * COMPLETE_CURRENT_LEG or CARGO_UNLOADED - and refuses otherwise with
   * CANCEL_REASON_REQUIRED / POST_PICKUP_RESOLUTION_REQUIRED.
   */
  cancelTrip: (
    id: string,
    body?: {
      reason?: string
      disposition?: string
      destination?: { lat: number; lon: number }
      destination_address?: string
    },
  ) => request<Trip>(`/api/trips/${id}/cancel`, { method: 'POST', body: body ?? {} }),
  closeTrip: (id: string) =>
    request<Trip>(`/api/trips/${id}/close`, { method: 'POST' }),

  listRoutes: (tripId: string) =>
    request<TripRoute[]>(`/api/trips/${tripId}/routes`),
  /**
   * Insert a new route and supersede the previous one — never an update.
   *
   * Two failures are worth distinguishing in the UI:
   *   503 ROUTING_UNAVAILABLE — every provider is down; retrying may work
   *   422 NO_VIABLE_ROUTE     — a provider answered and no route exists
   */
  // `detailed=true`: a route planned here is reviewed, selected and DRIVEN.
  // Without it the server stores a simplified overview with no turn steps, and
  // the driver's screen reads "Guidance unavailable" on a manager-planned trip.
  planRoute: (tripId: string) =>
    request<RoutePlanResult>(`/api/trips/${tripId}/routes/recalculate?detailed=true`, {
      method: 'POST',
    }),
  /**
   * `authorizationId` is optional and only ever relaxes REQUIRES_REVIEW.
   *
   * It never touches REJECTED or NOT_ASSESSED, and presenting one asserts
   * nothing: the server revalidates it against the live evidence inside the
   * selection's own transaction and spends it there, or refuses.
   */
  selectRoute: (tripId: string, routeId: string, authorizationId?: string) =>
    request<TripRoute>(
      `/api/trips/${tripId}/routes/${routeId}/select` +
        (authorizationId ? `?authorization_id=${authorizationId}` : ''),
      { method: 'POST' },
    ),

  /** The live authorisation for a route, or null. Expired ones are returned
   *  too, so a screen can say "expired" rather than showing nothing - which
   *  looks identical to never having been reviewed. */
  reviewAuthorization: (tripId: string, routeId: string) =>
    request<ReviewAuthorization | null>(
      `/api/trips/${tripId}/routes/${routeId}/review-authorization`,
    ),

  /**
   * A reviewer accepts THIS evidence for ONE selection of THIS route.
   *
   * `rationale` is the only thing sent. Everything bound to the record - the
   * evidence digest and snapshot, policy and evidence versions, basis, issue
   * and expiry times - is computed server-side from the route's own
   * assessment. Requires `route:review_authorize`, which MANAGER does not have.
   */
  authorizeReview: (tripId: string, routeId: string, rationale: string) =>
    request<ReviewAuthorization>(
      `/api/trips/${tripId}/routes/${routeId}/review-authorization`,
      { method: 'POST', body: { rationale } },
    ),

  revokeReviewAuthorization: (
    tripId: string,
    routeId: string,
    authorizationId: string,
  ) =>
    request<ReviewAuthorization>(
      `/api/trips/${tripId}/routes/${routeId}` +
        `/review-authorization/${authorizationId}`,
      { method: 'DELETE' },
    ),

  /**
   * Compare this trip's live routes and advise one.
   *
   * A CONSIDERED READ, not a feed. Each call costs up to ten requests to a
   * free weather service, so it is triggered by an operator asking - never
   * polled, and never fired merely because a row was clicked.
   */
  routeRecommendation: (tripId: string) =>
    request<RouteRecommendation>(`/api/trips/${tripId}/routes/recommendation`, { timeoutMs: SLOW_READ_TIMEOUT_MS }),

  /** Same cost, same rule: ask, do not poll. */
  rerouteAssessment: (tripId: string) =>
    request<RerouteAssessment>(`/api/trips/${tripId}/reroute`, { timeoutMs: SLOW_READ_TIMEOUT_MS }),

  /**
   * Move a moving trip onto another route, because a person decided to.
   *
   * `fromRouteId` is the route that was on screen when the manager decided. If
   * the trip has since been rerouted by someone else the server answers 409
   * ROUTE_SUPERSEDED rather than moving it off a road this manager never saw.
   */
  acceptReroute: (
    tripId: string,
    fromRouteId: string,
    toRouteId: string,
    authorizationId?: string,
  ) =>
    request<RerouteAccepted>(`/api/trips/${tripId}/reroute/accept`, {
      method: 'POST',
      body: {
        from_route_id: fromRouteId,
        to_route_id: toRouteId,
        // Omitted entirely when absent, so the ordinary reroute contract is
        // unchanged. Only ever relaxes REQUIRES_REVIEW, and only after the
        // server revalidates it against the live evidence.
        ...(authorizationId ? { authorization_id: authorizationId } : {}),
      },
    }),

  // `signal` is threaded through so a poll can be cancelled on unmount rather
  // than resolving into a component that is gone.
  activeFleet: (signal?: AbortSignal) =>
    request<FleetSnapshot>('/api/fleet/active', { signal }),
  tripTrack: (id: string, limit = 200) =>
    request<TrackSnapshot>(`/api/trips/${id}/track?limit=${limit}`),
  aiStatus: async (): Promise<AiStatus> => {
    return {
      available: false,
      provider: null,
      model: null,
      detail: 'Rest API does not host edge functions',
      languages: {},
    }
  },
  aiAsk: async (_body: {
    mode: 'assistant' | 'safety' | 'translate'
    question: string
    guidance?: string
    source_language?: string
    target_language?: string
  }): Promise<AiAnswer> => {
    return {
      answer: 'Rest API fallback explanation.',
      generated: false,
      model: null,
      facts_as_of: new Date().toISOString(),
      severity: 'INFO',
      source_mode: 'GENERAL',
      actions: [],
      disclaimer: null,
    }
  },
  activeEmergencies: () => request<Emergency[]>('/api/emergencies/active'),
  triggerSentinelSweep: () =>
    request<Emergency[]>('/api/emergencies/sweep', { method: 'POST' }),
  resolveEmergency: (
    emergencyId: string,
    note?: string,
    isFalseAlarm?: boolean,
  ) =>
    request<Emergency>(`/api/emergencies/${emergencyId}/resolve`, {
      method: 'POST',
      body: { note, is_false_alarm: isFalseAlarm ?? false },
    }),
}

export interface ProviderHealthRow {
  provider: string
  product: string
  evidence_type: string
  state: 'HEALTHY' | 'FAILED' | 'RATE_LIMITED' | 'STATIC' | 'UNKNOWN' | 'NOT_CONFIGURED'
  freshness: 'FRESH' | 'AGING' | 'STALE' | 'EXPIRED' | 'UNKNOWN' | 'STATIC'
  last_success_at: number | null
  last_error_at: number | null
  last_error: string | null
  data_at: number | null
  calls: number
  failures: number
  cadence_s: number | null
  detail: Record<string, unknown>
}

export interface SystemProviders {
  providers: ProviderHealthRow[]
  intelligence: {
    counts: Record<string, number>
    TOTAL_TRUE_LOCAL_AI: number
    TOTAL_LOCAL_INTELLIGENCE: number
    modules: { category: string; module: string; what: string }[]
  }
}

export type ManagerApi = typeof restApi

/**
 * Why a control cannot work right now, or null if it can.
 *
 * The one place a page should ask before rendering an action. On the local
 * FastAPI transport everything is implemented, so this is always null; on the
 * hosted Supabase transport some operations have no implementation yet and the
 * control must say so instead of throwing when pressed.
 */
export interface SupportSession {
  token: string
  expires_at: string
  driver_id: string
}

/** Where the driver app's web build lives; the support token rides in its URL fragment. */
export const DRIVER_WEB_URL: string = import.meta.env.VITE_DRIVER_WEB_URL ?? 'http://localhost:8123'

export function unavailableReason(operation: string): string | null {
  if (BACKEND_TARGET !== 'supabase') return null
  return UNAVAILABLE_OPERATIONS[operation] ?? null
}

export const api: ManagerApi =
  BACKEND_TARGET === 'supabase'
    ? (supabaseManagerApi as unknown as ManagerApi)
    : restApi


function toQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '' && v !== false,
  )
  if (entries.length === 0) return ''
  return `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}`
}
