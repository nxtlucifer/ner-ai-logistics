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

import { supabaseApi } from './supabaseApi'
import { configurationProblem } from './supabaseClient'

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
function isPrivateHost(host: string): boolean {
  return (
    host === 'localhost' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  )
}

function resolveBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_BACKEND === 'supabase') {
    return process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
  }
  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL
  if (explicit) {
    // Web build on a LAN: the browser reached the dev server at
    // window.location.hostname, and the backend sits beside it. A LAN address
    // baked in at bundle time goes stale the moment DHCP hands out a new one
    // ("No connection" on a laptop that is plainly online), so a private
    // explicit host is swapped for the page's own host. A hosted backend
    // (public name) is left alone.
    const w = (globalThis as { location?: { hostname?: string; protocol?: string } }).location
    const m = /^(https?:)\/\/([^/:]+)(?::(\d+))?/.exec(explicit)
    if (w?.hostname && m && isPrivateHost(m[2]) && w.hostname !== m[2]) {
      return `${m[1]}//${w.hostname}:${m[3] ?? '80'}`
    }
    return explicit
  }

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost

  const host = hostUri?.split(':')[0]
  if (host) return `http://${host}:8000`
  return ''
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

/** Headers for an <Image> that points at a private `/api/files/...` URL. */
export function authHeaders(): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
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
  /** Raw bytes (a photo, a PDF) with their own content type: sent as-is, not JSON. */
  raw?: { blob: Blob; contentType: string }
  skipRefresh?: boolean
  /** Override for a request that is legitimately slower. */
  timeoutMs?: number
  /**
   * Caller-owned cancellation, chained onto the timeout controller below.
   *
   * The timeout is about the SERVER being slow; this is about the driver no
   * longer wanting the answer. Both have to be able to abort the same fetch,
   * which is why the caller's signal is forwarded rather than replacing the
   * internal one.
   */
  signal?: AbortSignal
}

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.raw) headers['Content-Type'] = options.raw.contentType
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  )
  // An already-aborted signal must abort immediately: a caller that cancels
  // between deciding to retry and the fetch starting would otherwise get one
  // request it can no longer stop.
  if (options.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener('abort', () => controller.abort(), {
      once: true,
    })
  }

  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.raw ? options.raw.blob : options.body === undefined ? undefined : JSON.stringify(options.body),
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
  /** `/api/files/{id}` once a truck photo is on the assignment. */
  verification_photo_url?: string | null
  verification_source?: string | null
  truck: TruckSummary
}

export type FileKind = 'PROFILE_PHOTO' | 'TRUCK_VERIFICATION' | 'DRIVER_DOCUMENT' | 'TRUCK_DOCUMENT'

export interface StoredFileRead {
  id: string
  url: string
  content_type: string
  size_bytes: number
}

export interface DocumentRead {
  id: string
  doc_type: string
  /** Last four characters only; the full number never reaches the phone. */
  number_masked: string | null
  issued_on: string | null
  expires_on: string | null
  /** VALID | EXPIRING_SOON | EXPIRED | MISSING (no file) - derived from dates, never a government check. */
  status: string
  file_url: string | null
  created_at: string
}

export interface DocumentCreate {
  doc_type: string
  doc_number?: string
  issued_on?: string
  expires_on?: string
  file_id?: string
}

export interface DriverProfile {
  id: string
  full_name: string
  phone: string
  photo_url: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  licence_expiry: string
  truck_registration: string | null
  truck_photo_url: string | null
  truck_verified: boolean
  documents: DocumentRead[]
  insurance: DocumentRead[]
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

/**
 * How far along the PLANNED corridor the truck is.
 *
 * Measured by projecting the last observed fix onto the planned line, which is
 * why `off_route_m` is here: the planned route and the observed track are
 * different things, and the distance between them says whether the rest of
 * these numbers mean anything.
 *
 * THERE IS NO ETA. `remaining_at_planned_pace_min` is the remaining distance
 * at the average speed the routing provider's own figures imply - the name
 * says what it assumes and `REMAINING_TIME_ASSUMES_PLANNED_PACE` travels with
 * it. Every value is null rather than zero when it cannot be computed: a truck
 * with no fix has not arrived.
 */
export interface RouteProgress {
  fraction_complete: number | null
  travelled_distance_km: number | null
  remaining_distance_km: number | null
  off_route_m: number | null
  on_route: boolean | null
  remaining_at_planned_pace_min: number | null
  planned_average_speed_kmph: number | null
  reason_codes: string[]
  version: string
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
  /** Null only when the trip has no selected route at all. */
  progress: RouteProgress | null
  /**
   * WHICH route the driver is on. Null when none is selected yet.
   *
   * The geometry is deliberately not on this payload - see the backend note on
   * `CurrentTrip.selected_route_id`. This id is what the map watches: it
   * changes exactly when a manager selects or reroutes, and that is the only
   * moment the corridor needs re-fetching. It is also how the map, the steps
   * and the progress figures are proven to describe the same approved route.
   */
  selected_route_id: string | null
  /**
   * When THIS driver acknowledged the job, or null if they have not.
   *
   * Drives the main page's action: **Accept trip** while null, **Resume
   * navigation** once set. The app opens the Map page only after the server
   * returns a non-null value here, so the redirect follows a persisted fact
   * rather than an optimistic local boolean.
   *
   * Not a start gate - `can_start` is still the only thing that says whether
   * travel may begin. And it is per-driver: a reassigned trip reports null
   * here for its new driver, so nobody inherits somebody else's acceptance.
   */
  driver_accepted_at: string | null
  shipment?: { total_weight_kg?: string | number | null } | null
  driver?: { full_name?: string | null } | null
  active_emergency?: ActiveEmergency | null
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

export interface ActiveEmergency {
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
  briefing_snapshot?: Record<string, unknown> | null
}

/** The four service kinds the map offers. Matches the backend enum. */
export type PlaceCategory = 'EMERGENCY' | 'TYRES' | 'HOTEL' | 'REST'

/**
 * What the search was centred on, so the screen can say so out loud.
 *
 * With GPS denied there is no driver position, and the anchor must never be
 * silently faked. `TRIP_ORIGIN` and `MAP_AREA` are honest substitutes and the
 * UI labels whichever one produced what is on screen.
 */
export type SearchAnchor =
  | 'DRIVER_POSITION'
  | 'ROUTE_CORRIDOR'
  | 'TRIP_ORIGIN'
  | 'MAP_AREA'

/**
 * Whether anybody could look, distinct from what they found.
 *
 * `AVAILABLE` with an empty list means nothing of that kind is MAPPED here.
 * `OUTSIDE_COVERAGE` means the area was never searched. `UNAVAILABLE` means
 * the lookup failed. Rendering all three as "no results" is the defect this
 * field exists to prevent.
 */
export type PlacesState =
  | 'AVAILABLE'
  | 'OUTSIDE_COVERAGE'
  | 'UNAVAILABLE'
  | 'NOT_CONFIGURED'

/** Every field independently null. Null means nobody recorded it. */
export interface PlaceContact {
  phone: string | null
  opening_hours: string | null
  operator: string | null
}

/** Access as MAPPED. A missing value is unknown, never permitted. */
export interface PlaceAccess {
  hgv: string | null
  max_height: string | null
  access: string | null
  fee: string | null
  toilets: string | null
  lit: string | null
}

export interface Place {
  provider_id: string
  category: PlaceCategory
  name: string | null
  lat: number
  lon: number
  contact: PlaceContact
  access: PlaceAccess
  /**
   * APPROXIMATE STRAIGHT-LINE metres, or null.
   *
   * Never a driving distance and never to be rendered as one: a shop across a
   * river is 200 m away and 20 km to reach. No road distance or travel time is
   * computed anywhere in this feature.
   */
  straight_line_m: number | null
  /**
   * Every source element behind this record.
   *
   * More than one means several mapped elements were judged to be the same
   * place - LIKELY, not certainly. The ids travel so the judgement can be
   * checked rather than trusted.
   */
  provider_ids: string[]
  /** Fields where merged elements disagreed. Shown as disputed, not hidden. */
  conflicts: Record<string, string[]>
}

export interface PlaceSource {
  name: string
  attribution: string
  licence: string
  retrieved_at: string
  coverage_description: string
  limits: string
  /** False for the corridor snapshot. Not a live availability feed. */
  is_live: boolean
  raw_records: number
  unique_places: number
  merged_duplicates: number
}

export interface PlacesResponse {
  state: PlacesState
  anchor: SearchAnchor
  places: Place[]
  source: PlaceSource | null
  truncated: boolean
  error: string | null
}

export interface PlacesQuery {
  category: PlaceCategory
  /** Omitted for ROUTE_CORRIDOR: the server derives bounded windows from the
   *  driver's own route, so the phone never sends one 300 km box. */
  south?: number
  west?: number
  north?: number
  east?: number
  anchor: SearchAnchor
  anchorLat?: number
  anchorLon?: number
  limit?: number
}

/** One corridor, as coordinates the phone can draw with no network. */
export interface OfflineRoute {
  route_id: string
  kind: string
  distance_km: number | null
  estimated_duration_min: number | null
  /** [[lat, lon], ...] in travel order. */
  geometry: [number, number][]
}

export interface OfflineStop {
  stop_id: string
  sequence: number
  kind: string
  name: string | null
  address: string | null
  lat: number | null
  lon: number | null
}

/**
 * The package carries the FULL assessment (the server builds it with the same
 * `risk_read` as the live endpoint), so a phone in a valley can render the
 * same per-factor cards it had online - labelled as a stored copy. This was a
 * four-field subset, which is why the monitor could not show a last-known
 * assessment offline: the data was there, the type hid it.
 */
export type OfflineRisk = RouteRisk

/**
 * The whole journey, downloaded so it survives losing the network.
 *
 * WHAT IT IS AND IS NOT. It carries the route already chosen - geometry, stops,
 * estimates - so a phone in a valley has the journey in front of it. It is NOT
 * a routing engine: computing a NEW route offline needs a road graph on the
 * device and does not exist. A driver following a known road needs the road.
 *
 * `basemap` is `BUNDLED_NONE`. That is a licence answer, not a missing feature:
 * the OSM Foundation tile policy prohibits prefetching tiles for offline use,
 * and bulk-caching them would be a policy violation dressed up as a feature.
 * The gap is declared so a driver is told now rather than discovering it in a
 * valley.
 *
 * `risk` is a SNAPSHOT taken at `risk_captured_at`, never live. It must be
 * rendered against that timestamp and allowed to go stale on screen using the
 * device clock alone - a weather panel still reading LIGHT RAIN ten hours into
 * a blackout is the failure the field exists to prevent.
 *
 * `package_hash` covers only the durable parts, so "has the corridor changed"
 * can be asked without the answer flipping every time the weather does.
 */
/** Mirrors backend RouteRiskRead. `score` alone is dishonest, which is why
 *  `inputs` and `unavailable` travel with it - see app/api/trips.py. */
export interface RouteRiskComponent {
  code: string
  label: string
  points: number
  detail: string | null
}

export interface TerrainSegment {
  start_m: number
  end_m: number
  grade_pct: number
  terrain_class: 'FLAT' | 'ROLLING' | 'HILLY' | 'STEEP' | string
}

/** The DEM profile of the selected route. `usable` is false below the
 *  engine's coverage floor, and the block still ships so the gap is visible. */
export interface TerrainRead {
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
  segments: TerrainSegment[]
}

export interface LandslideEvent {
  latitude: number
  longitude: number
  year: number | null
  name: string | null
}

/** Recorded-landslide exposure. A label from published thresholds, never a
 *  probability; `inventory_to_year` is the honest freshness. */
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
  events: LandslideEvent[]
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

export interface TrafficSegmentRead {
  start_m: number
  end_m: number
  /** UNKNOWN / NORMAL / SLOW / CONGESTED */
  state: string
  observed_kmph: number | null
  baseline_kmph: number | null
  sample_count: number
  vehicle_count: number
  newest_age_seconds: number | null
}

export interface TrafficRead {
  status: string
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

export interface RouteRisk {
  score: number
  band: string
  components: RouteRiskComponent[]
  /** factor name -> "AVAILABLE" | "NOT_AVAILABLE" */
  inputs: Record<string, string>
  unavailable: string[]
  reason_codes: string[]
  observations_used: number
  observations_stale: number
  assessed_at: string
  /** Absent on older servers and packages. */
  terrain?: TerrainRead | null
  landslide_history?: LandslideHistoryRead | null
  flood?: FloodContextRead | null
  official_warnings?: OfficialWarningsRead | null
  /** RASTA fleet traffic - our own trucks' probes, never Google. Absent on older packages. */
  traffic?: TrafficRead | null
  /** CONTINUE / CAUTION / HOLD_AND_REVIEW / REROUTE_RECOMMENDED, derived
   *  server-side from the band and the reroute assessment. Absent in older
   *  cached packages. */
  decision?: string | null
  decision_reason_codes?: string[]
  /** Present only when a genuinely better road exists. */
  alternative?: {
    route_id: string
    band: string
    score: number
    distance_km: number | null
    estimated_duration_min: number | null
  } | null
}

export interface OfflinePackage {
  trip_id: string
  trip_code: string
  captured_at: string
  selected_route: OfflineRoute | null
  backup_route: OfflineRoute | null
  stops: OfflineStop[]
  risk: OfflineRisk | null
  risk_captured_at: string | null
  basemap: string
  reason_codes: string[]
  package_hash: string
  version: string
}

/**
 * One turn instruction, positioned along the route it belongs to.
 *
 * `distance_from_start_m` is the field a next-turn panel needs: distance along
 * this route from its beginning to this maneuver. Distance to the turn is that
 * minus how far the truck has travelled.
 *
 * `step_distance_m` is NOT that. It measures FORWARD - from this maneuver to
 * the next one - because that is what OSRM's `step.distance` means. Rendering
 * it as "in X m, turn left" is wrong by exactly one step. It is exposed for leg
 * display and labelled here so the mistake is harder to make than to avoid.
 */
export interface NavigationManeuver {
  type: string
  modifier: string | null
  lat: number
  lon: number
  geometry_index: number
  distance_from_start_m: number
  step_distance_m: number
  /** Free-flow provider seconds for that leg. Not an ETA. */
  duration_s: number | null
  name: string | null
  exit: number | null
}

/**
 * Turn instructions for the corridor this driver's trip currently follows.
 *
 * `available` is false whenever guidance cannot be driven, with `reason_codes`
 * saying why. `geometry` is still populated in that case: losing directions is
 * not losing the road, and a map that blanks because maneuvers are missing has
 * turned a degraded feature into a broken screen.
 *
 * `route_id` and `route_revision` bind the package to one corridor. Both are
 * checked before anything is drawn - directions from a superseded route render
 * perfectly and point somewhere the driver is no longer going.
 */
export interface NavigationPackage {
  trip_id: string
  trip_code: string
  route_id: string | null
  route_revision: string | null
  available: boolean
  reason_codes: string[]
  geometry: number[][]
  maneuvers: NavigationManeuver[]
  distance_m: number | null
  /** Provider free-flow duration. NOT an arrival time. */
  duration_s: number | null
  provider: string | null
  provider_route_id: string | null
  captured_at: string
  coordinate_format: string
  distance_unit: string
  duration_unit: string
  version: string
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

// --- Local AI -------------------------------------------------------------

/**
 * Whether a model is actually reachable, checked live by the server.
 *
 * `available: false` is a first-class state, not an error. The three AI
 * surfaces all still work without it - they fall back to the bundled guide,
 * the deterministic assistant and the reviewed phrase pack - and they are
 * required to say which of the two the driver is reading.
 */
export interface AiStatus {
  /**
   * A generated answer is expected. NOT "a key is configured" - see the Edge
   * handler: with both provider quotas spent, key-presence reported available
   * while every answer came from the offline assistant.
   */
  available: boolean
  /**
   * Finer detail behind `available`. Optional because a client may be talking
   * to an older deployment of the function that predates the field.
   */
  state?: 'OFFLINE' | 'CONFIGURED' | 'USABLE' | 'QUOTA_EXHAUSTED' | 'FALLBACK'
  provider: string | null
  model: string | null
  /** Why not, in words a driver can act on. */
  detail: string | null
  /** Language codes the demo is prepared to translate between. */
  languages: Record<string, string>
}

export interface AiAnswer {
  answer: string
  /**
   * True only when a model actually produced this text.
   *
   * NOT "always true from this endpoint", which is what this comment used to
   * say and what led the UI to label every answer as model-written. The hosted
   * function answers `false` whenever it falls back to its deterministic
   * offline assistant - a provider timeout, a 429, or a reply it could not use
   * - and when a provider's free-tier quota is spent that is EVERY answer.
   */
  generated: boolean
  model: string | null
  /** When the trip facts behind the answer were read. Null for translation. */
  facts_as_of: string | null
  /**
   * Why the assistant answered the way it did, when it has something to say -
   * a quota exhaustion, a timeout, a filter that fired. Present on fallback
   * and refusal answers, null on a clean generated one.
   */
  disclaimer?: string | null
}

const restApi = {
  /** Is a local model there right now. Cheap; safe to call on screen focus. */
  aiStatus: (signal?: AbortSignal) => request<AiStatus>('/api/ai/status', { signal }),

  /**
   * One question, one answer. No history is sent and none is stored.
   *
   * The trip context is resolved SERVER-side from the signed-in driver's
   * token - there is no trip id to pass, and therefore none to tamper with.
   */
  aiAsk: (
    body: {
      mode: 'assistant' | 'safety' | 'translate'
      question: string
      guidance?: string
      source_language?: string
      target_language?: string
    },
    signal?: AbortSignal,
  ) => request<AiAnswer>('/api/ai/ask', { method: 'POST', body, signal }),

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

  /** My details: profile, assigned truck, masked documents and insurance. */
  myProfile: () => request<DriverProfile>('/api/driver/me/profile'),
  myDocuments: () => request<DocumentRead[]>('/api/driver/me/documents'),
  addDocument: (body: DocumentCreate) => request<DocumentRead>('/api/driver/me/documents', { method: 'POST', body }),
  addTruckDocument: (body: DocumentCreate) => request<DocumentRead>('/api/driver/me/truck-documents', { method: 'POST', body }),
  /**
   * Upload one private file as raw bytes. The server sniffs the type (JPEG,
   * PNG, PDF only), caps it at 5 MB and, by `kind`, attaches it: a profile
   * photo to me, a truck photo to my current assignment. 60 s: a photo on a
   * hill-road connection.
   */
  uploadFile: async (uri: string, kind: FileKind, contentType: string) => {
    const blob = await (await fetch(uri)).blob()
    return request<StoredFileRead>(`/api/files?kind=${kind}`, { method: 'POST', raw: { blob, contentType }, timeoutMs: 60_000 })
  },
  verifyAssignment: (payload: VerifyPayload) =>
    request<VerifyResult>('/api/driver/me/assignment/verify', {
      method: 'POST',
      body: payload,
    }),

  // Trip execution. No trip id in any path: the server resolves the trip from
  // the token. Where one is sent in a body it can only narrow the request.
  myTrip: () => request<CurrentTrip | null>('/api/driver/me/trip'),

  /**
   * Download the whole journey for offline use.
   *
   * 404 when there is no current trip - unlike `myTrip`, which answers null
   * because between-trips is a normal screen. Asking to download a journey
   * that does not exist is a request that cannot be satisfied, and null would
   * leave the app guessing whether to retry.
   */
  offlinePackage: () =>
    request<OfflinePackage>('/api/driver/me/trip/offline-package'),

  /**
   * Turn instructions for this driver's own current route.
   *
   * 404 only when there is no current trip, matching `offlinePackage`. Having a
   * trip whose route cannot drive guidance is a 200 with `available: false` -
   * that is a state the map renders, not an error it should retry.
   */
  navigationPackage: () =>
    request<NavigationPackage>('/api/driver/me/trip/navigation'),

  /**
   * Deterministic risk for this driver's OWN selected route.
   *
   * 404 no trip, 409 trip with no route selected. Both are states the Route
   * Monitor renders, not errors to retry - a driver whose manager has not
   * picked a road yet is not a failure.
   */
  routeRisk: () => request<RouteRisk>('/api/driver/me/trip/route-risk'),

  /**
   * Roadside services near this driver's own trip.
   *
   * Served from a local corridor snapshot on the backend - no request leaves
   * the server, so changing category or panning the map issues no external
   * lookup. Called only from an explicit action, never from the trip poll.
   */
  places: (query: PlacesQuery) =>
    request<PlacesResponse>(
      '/api/driver/me/trip/places?' +
        new URLSearchParams({
          category: query.category,
          ...(query.south !== undefined && query.west !== undefined && query.north !== undefined && query.east !== undefined
            ? {
                south: String(query.south),
                west: String(query.west),
                north: String(query.north),
                east: String(query.east),
              }
            : {}),
          anchor: query.anchor,
          ...(query.anchorLat !== undefined && query.anchorLon !== undefined
            ? {
                anchor_lat: String(query.anchorLat),
                anchor_lon: String(query.anchorLon),
              }
            : {}),
          limit: String(query.limit ?? 40),
        }).toString(),
    ),

  /**
   * Acknowledge the dispatched job. This does NOT start travel.
   *
   * The server records who accepted and when, and returns the trip with
   * `driver_accepted_at` set. The app opens the Map page only after seeing
   * that value come back - never from a local flag - so a failed or refused
   * acceptance leaves the driver on the main page with the real reason.
   *
   * Idempotent server-side: a double tap or a retry after a lost response
   * returns the first acceptance unchanged.
   */
  acceptTrip: (tripId: string) =>
    request<CurrentTrip>('/api/driver/me/trip/accept', {
      method: 'POST',
      body: { trip_id: tripId },
    }),
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
  checkInEmergency: (tripId: string, response: DriverCheckResponse) =>
    request<ActiveEmergency>('/api/driver/me/trip/check-in', {
      method: 'POST',
      body: { trip_id: tripId, response },
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

  /**
   * A road from where the truck is now, planned by the routing provider and
   * stored as the trip's backup route. The trip stays on its selected road
   * until the manager accepts the proposal; 409 when not under way, 503 when
   * no provider answers.
   */
  requestReroute: (lat: number, lon: number) =>
    request<RerouteProposed>('/api/driver/me/trip/reroute', {
      method: 'POST',
      body: { lat, lon },
      timeoutMs: 15_000,
    }),
}

export interface RerouteProposed {
  route_id: string
  kind: string
  distance_km: number | null
  estimated_duration_min: number | null
  provider: string
  has_guidance: boolean
}

// ---------------------------------------------------------------------------
// Transport selection
// ---------------------------------------------------------------------------

/**
 * Which backend this build talks to. Decided ONCE, at module load, from
 * EXPLICIT configuration.
 *
 * `local` is a deliberate choice, never a consequence. An earlier version chose
 * REST whenever `isSupabaseConfigured()` was false, which meant a cloud release
 * with a typo in its URL silently fell back to dialling a laptop on a private
 * LAN - the exact failure this migration exists to remove, reintroduced by the
 * error path. A broken cloud configuration is now an ERROR, not a fallback:
 * every operation throws `ConfigurationError` and NO REST request is ever made.
 *
 * ALL OR NOTHING within cloud mode too. An operation that is not migrated yet
 * throws `NotMigratedError` naming itself rather than routing back to the
 * laptop, so a driver on mobile data cannot end up with most of the app working
 * and one screen hanging forever with nothing saying why.
 *
 * ONE REFRESH LOOP. Only one of these objects is ever used, so supabase-js's
 * auto-refresh timer and `refreshSession()` above are never both live against
 * the same identity.
 */
export type BackendMode = 'supabase' | 'local'

export class ConfigurationError extends Error {
  readonly code = 'CONFIGURATION_ERROR'
  constructor(problem: string) {
    super(`Backend is misconfigured: ${problem}`)
    this.name = 'ConfigurationError'
  }
}

/**
 * `EXPO_PUBLIC_BACKEND` decides it outright. Without it, the presence of ANY
 * Supabase variable means cloud was intended - so a half-set cloud build is
 * diagnosed rather than quietly demoted to REST.
 */
export function resolveBackendMode(): BackendMode {
  const declared = process.env.EXPO_PUBLIC_BACKEND
  if (declared === 'supabase' || declared === 'local') return declared
  return process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ? 'supabase'
    : 'local'
}

export const backendMode: BackendMode = resolveBackendMode()

/** Every operation refuses, identically, with the reason. */
function misconfiguredApi(problem: string): typeof restApi {
  const refuse = () => {
    throw new ConfigurationError(problem)
  }
  return new Proxy({} as typeof restApi, { get: () => refuse })
}

export const configurationProblemMessage: string | null =
  backendMode === 'supabase' ? configurationProblem() : null

export const usingSupabase = backendMode === 'supabase' && configurationProblemMessage === null

export const api = (backendMode === 'local'
  ? restApi
  : configurationProblemMessage !== null
    ? misconfiguredApi(configurationProblemMessage)
    : (supabaseApi as unknown as typeof restApi)) as typeof restApi

/** The REST implementation, for tests and for the explicit local profile. */
export { restApi }
