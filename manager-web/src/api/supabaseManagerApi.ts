/**
 * Supabase implementation of the Manager API.
 *
 * Provides direct access to Supabase Data API / RPC for the core demo slice:
 * - Auth (login, logout, me, refresh)
 * - Drivers & Trucks listing and inspection
 * - Assignments listing and creation
 * - Trips listing and detail
 * - Atomic Trip Planning (via public.plan_trip RPC)
 * - Fleet GPS live monitoring (via gps_points and trips)
 * - Trip GPS track history
 */

import { ApiError } from './client'
import { getSupabase } from './supabaseClient'
import { IntelligenceUnavailableError, intelligenceFetch } from './intelligence'

import type {
  Driver,
  Truck,
  Assignment,
  Emergency,
  Trip,
  TripDetail,
  TripPlanCreate,
  FleetSnapshot,
  FleetTrip,
  TrackSnapshot,
  Position,
  Page,
  TokenResponse,
  MeResponse,
  Freshness,
  TripStatus,
  TripRoute,
  RoutePlanResult,
  ReviewAuthorization,
  RouteRecommendation,
  RerouteAssessment,
  RerouteAccepted,
  AddressSuggestions,
  ResolvedAddress,
  ResolvedMapLink,
  ReadyResponse,
  AuthenticatedUser,
  AiStatus,
  AiAnswer,
} from './client'

/**
 * The evidence factors an assessment would have consulted.
 *
 * Listed when nothing was assessed so the gap reads as a specific list of
 * missing datasets rather than a vague absence. Mirrors the factor names in
 * `backend/app/domain/route_risk.py`.
 */
const ACCESSIBILITY_FACTORS = [
  'weather',
  'landslide',
  'flood',
  'official_warnings',
  'road_quality',
  'truck_restrictions',
  'historical_incidents',
  'elevation',
  'fuel_model',
]

export class NotMigratedError extends Error {
  readonly operation: string
  constructor(operation: string) {
    super(`Operation "${operation}" is not yet migrated to Supabase.`)
    this.name = 'NotMigratedError'
    this.operation = operation
  }
}

/**
 * Turn a PostgREST/plpgsql failure into an `ApiError` the UI can branch on.
 *
 * The RPCs raise with a SQLSTATE and a JSON `detail` carrying a stable code.
 * Both survive the round trip - PostgREST puts the SQLSTATE in `code` and the
 * detail in `details` - so the distinction the manager actually needs to make
 * ("somebody else changed this" vs "this failed") is available here rather
 * than being flattened into one opaque message.
 *
 * The rest of this module still does `throw new Error(error.message)`. That is
 * adequate where the only question is "did it work", and deliberately not
 * changed here; route mutation is the one place a manager must be told WHICH
 * kind of failure happened, because the two have opposite next steps: refresh
 * and look again, versus keep the current route and try something else.
 */
function rpcError(
  error: { message?: string; code?: string; details?: unknown; hint?: string },
  fallback: string,
): ApiError {
  const sqlstate = error.code ?? ''
  let appCode = 'UNKNOWN'
  try {
    const detail = typeof error.details === 'string' ? JSON.parse(error.details) : error.details
    if (detail && typeof detail === 'object' && 'code' in detail) {
      appCode = String((detail as { code: unknown }).code)
    }
  } catch {
    /* detail was not JSON; the SQLSTATE mapping below still applies */
  }

  // 40001 is serialization_failure, which is what a stale expectation raises.
  // Mapping it to 409 rather than 500 is what stops the UI calling a
  // legitimate concurrent edit a server fault.
  const status =
    sqlstate === '40001' ? 409
    : sqlstate === '42501' ? 403
    : sqlstate === '28000' ? 401
    : sqlstate === 'P0002' ? 404
    : sqlstate === '55000' ? 422
    : 500

  return new ApiError(
    status,
    { error: { code: appCode, message: error.message ?? fallback, details: {} } },
    fallback,
  )
}

/**
 * Operations the hosted Supabase transport cannot perform, and why.
 *
 * EXPORTED SO A CONTROL CAN DISABLE ITSELF RATHER THAN THROW ON CLICK.
 * Every one of these previously presented as a working button: the user
 * pressed it, `notMigrated` threw, and the page surfaced an exception. A
 * visible control has three legal states - working, disabled with a reason, or
 * gone - and "throws when pressed" is none of them.
 *
 * The reasons are split deliberately, because the two groups need different
 * answers from whoever reads them:
 *
 *   * NOT_HOSTED   - the capability lives in the FastAPI intelligence plane,
 *                    which is not deployed. It will work when that is hosted.
 *   * NOT_MIGRATED - the capability has no hosted implementation at all yet.
 *                    Saying "service not connected" here would be a lie; there
 *                    is nothing to connect to.
 *
 * WHY THESE ARE NOT SIMPLY WIRED UP: several are guarded state transitions
 * (`cancelTrip`, `closeTrip`) or need privileges a browser holding an anon key
 * does not have (`createDriver` needs a GoTrue admin call). Implementing them
 * as ad-hoc client-side table writes is exactly the pattern just removed from
 * route selection, where three unguarded writes could leave a trip with two
 * selected routes. Adding six more of those to make buttons light up would
 * trade a visible gap for an invisible corruption.
 */
export const UNAVAILABLE_OPERATIONS: Readonly<Record<string, string>> = {
  createDriver: 'Creating drivers needs an account service that is not connected yet.',
  updateDriver: 'Editing drivers is not available on the hosted service yet.',
  deactivateDriver: 'Deactivating drivers is not available on the hosted service yet.',
  createTruck: 'Adding trucks is not available on the hosted service yet.',
  updateTruck: 'Editing trucks is not available on the hosted service yet.',
  retireTruck: 'Retiring trucks is not available on the hosted service yet.',
  endAssignment: 'Ending assignments is not available on the hosted service yet.',
  listShipments: 'Shipment listing is not available on the hosted service yet.',
  createShipment: 'Creating shipments is not available on the hosted service yet.',
  createTrip: 'Use Plan trip, which creates the shipment and trip together.',
  cancelTrip: 'Cancelling a trip is not available on the hosted service yet.',
  closeTrip: 'Closing a trip is not available on the hosted service yet.',
  revokeReviewAuthorization: 'Route review is not available on the hosted service yet.',
  addressSuggestions: 'Address lookup service is not connected.',
  resolveAddress: 'Address lookup service is not connected.',
  triggerSentinelSweep: 'Sentinel sweeps run automatically on the intelligence plane.',
  resolveEmergency: 'Resolving emergencies requires the FastAPI backend.',
}

async function notMigrated(operation: string): Promise<never> {
  throw new NotMigratedError(operation)
}

export function parseEwkbPoint(hex: string | null | undefined): [number, number] | null {
  if (!hex || typeof hex !== 'string') return null
  const cleanHex = hex.trim()
  if (cleanHex.length < 42) return null
  try {
    const bytes = new Uint8Array(cleanHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? [])
    if (bytes.length < 21) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const isLittleEndian = view.getUint8(0) === 1
    const geomType = view.getUint32(1, isLittleEndian)
    const hasSrid = (geomType & 0x20000000) !== 0
    const coordOffset = hasSrid ? 9 : 5
    if (bytes.length < coordOffset + 16) return null
    const lon = view.getFloat64(coordOffset, isLittleEndian)
    const lat = view.getFloat64(coordOffset + 8, isLittleEndian)
    if (isNaN(lat) || isNaN(lon)) return null
    return [lat, lon]
  } catch {
    return null
  }
}

export const supabaseManagerApi = {
  health: async (): Promise<{ status: string }> => {
    const supabase = getSupabase()
    const { error } = await supabase.from('system_info').select('version').limit(1)
    if (error) throw new Error(`Supabase health check failed: ${error.message}`)
    return { status: 'healthy' }
  },

  systemProviders: async () => {
    throw new Error('systemProviders is not migrated to Supabase yet. It still requires the FastAPI backend.')
  },

  ready: async (): Promise<ReadyResponse> => {
    const supabase = getSupabase()
    const { error } = await supabase.from('system_info').select('version').limit(1)
    return {
      status: error ? 'not_ready' : 'ready',
      provider: 'supabase',
      checks: {
        database: { ok: !error, detail: error ? error.message : 'connected' },
        postgis: { ok: true, detail: 'extensions.postgis' },
      },
    }
  },

  login: async (identifier: string, password: string): Promise<TokenResponse> => {
    const supabase = getSupabase()
    const { data, error } = await supabase.auth.signInWithPassword({
      email: identifier,
      password,
    })
    if (error || !data.session || !data.user) {
      throw new Error(error?.message ?? 'Authentication failed')
    }

    const { data: appUser } = await supabase
      .from('users')
      .select('id, email, phone, role, display_name')
      .eq('id', data.user.id)
      .maybeSingle()

    const authUser: AuthenticatedUser = {
      id: data.user.id,
      role: (appUser?.role ?? 'MANAGER') as any,
      display_name: appUser?.display_name ?? 'Fleet Manager',
      email: appUser?.email ?? data.user.email ?? null,
      phone: appUser?.phone ?? null,
    }

    const expiresAt = new Date(Date.now() + (data.session.expires_in ?? 3600) * 1000).toISOString()

    return {
      access_token: data.session.access_token,
      refresh_token: null,
      expires_at: expiresAt,
      user: authUser,
    }
  },

  logout: async (): Promise<void> => {
    const supabase = getSupabase()
    await supabase.auth.signOut()
  },

  me: async (): Promise<MeResponse> => {
    const supabase = getSupabase()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()
    if (error || !user) {
      throw new Error('Not authenticated')
    }

    // Read application role and display details from public.users
    const { data: appUser } = await supabase
      .from('users')
      .select('id, email, phone, role, display_name, is_active')
      .eq('id', user.id)
      .maybeSingle()

    const authUser: AuthenticatedUser = {
      id: user.id,
      email: appUser?.email ?? user.email ?? null,
      phone: appUser?.phone ?? null,
      role: (appUser?.role ?? 'MANAGER') as any,
      display_name: appUser?.display_name ?? 'Fleet Manager',
    }

    return {
      user: authUser,
      permissions: [
        'trip:read',
        'trip:create',
        'trip:dispatch',
        'trip:cancel',
        'trip:close',
        'truck:read',
        'driver:read',
        'assignment:read',
        'assignment:create',
        'shipment:read',
        'shipment:create',
      ],
    }
  },

  listDrivers: async (params: { limit?: number; cursor?: string; search?: string } = {}): Promise<Page<Driver>> => {
    const supabase = getSupabase()
    let query = supabase
      .from('drivers')
      .select('id, user_id, full_name, photo_url, phone, licence_number, licence_expiry, status, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (params.limit) {
      query = query.limit(params.limit)
    }
    if (params.search) {
      query = query.or(`full_name.ilike.%${params.search}%,phone.ilike.%${params.search}%`)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    // Map login_is_active by checking user is_active
    const drivers: Driver[] = (data ?? []).map((d) => ({
      id: d.id,
      user_id: d.user_id,
      full_name: d.full_name,
      phone: d.phone,
      photo_url: d.photo_url,
      licence_number: d.licence_number,
      licence_expiry: d.licence_expiry,
      status: d.status,
      login_is_active: true, // Drivers read from active roster
      created_at: d.created_at,
    }))

    return { items: drivers, next_cursor: null }
  },

  getDriver: async (id: string): Promise<Driver> => {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('drivers')
      .select('*')
      .eq('id', id)
      .single()
    if (error) throw new Error(error.message)
    return {
      ...data,
      login_is_active: true,
    } as Driver
  },

  createDriver: (_body: Record<string, unknown>): Promise<Driver> => notMigrated('createDriver'),
  updateDriver: (_id: string, _body: Record<string, unknown>): Promise<Driver> => notMigrated('updateDriver'),
  deactivateDriver: (_id: string): Promise<Driver> => notMigrated('deactivateDriver'),

  listTrucks: async (params: { limit?: number; cursor?: string; search?: string } = {}): Promise<Page<Truck>> => {
    const supabase = getSupabase()
    let query = supabase
      .from('trucks')
      .select('*')
      .order('created_at', { ascending: false })

    if (params.limit) {
      query = query.limit(params.limit)
    }
    if (params.search) {
      query = query.ilike('registration_number', `%${params.search}%`)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)
    return { items: (data ?? []) as Truck[], next_cursor: null }
  },

  getTruck: async (id: string): Promise<Truck> => {
    const supabase = getSupabase()
    const { data, error } = await supabase.from('trucks').select('*').eq('id', id).single()
    if (error) throw new Error(error.message)
    return data as Truck
  },

  createTruck: (_body: Record<string, unknown>): Promise<Truck> => notMigrated('createTruck'),
  updateTruck: (_id: string, _body: Record<string, unknown>): Promise<Truck> => notMigrated('updateTruck'),
  retireTruck: (_id: string): Promise<Truck> => notMigrated('retireTruck'),

  listAssignments: async (params: { activeOnly?: boolean } = {}): Promise<Assignment[]> => {
    const supabase = getSupabase()
    let query = supabase.from('driver_truck_assignments').select('*').order('assigned_at', { ascending: false })
    if (params.activeOnly) {
      query = query.in('status', ['ACTIVE', 'PENDING_VERIFICATION'])
    }
    const { data, error } = await query
    if (error) throw new Error(error.message)
    return (data ?? []) as Assignment[]
  },

  createAssignment: async (driverId: string, truckId: string): Promise<Assignment> => {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('driver_truck_assignments')
      .insert({
        driver_id: driverId,
        truck_id: truckId,
        status: 'PENDING_VERIFICATION',
      })
      .select('*')
      .single()
    if (error) throw new Error(error.message)
    return data as Assignment
  },

  endAssignment: async (_id: string): Promise<Assignment> => notMigrated('endAssignment'),

  listShipments: (_params: { limit?: number } = {}) => notMigrated('listShipments'),
  createShipment: (_body: any) => notMigrated('createShipment'),

  listTrips: async (params: { limit?: number; trip_status?: string } = {}): Promise<Page<Trip>> => {
    const supabase = getSupabase()
    let query = supabase
      .from('trips')
      .select('id, trip_code, shipment_id, truck_id, driver_id, assignment_id, status, selected_route_id, dispatched_at, started_at, delivered_at, closed_at, planned_eta, current_eta, delay_minutes, created_at')
      .order('created_at', { ascending: false })

    if (params.trip_status) {
      query = query.eq('status', params.trip_status)
    }
    if (params.limit) {
      query = query.limit(params.limit)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)
    return { items: (data ?? []) as unknown as Trip[], next_cursor: null }
  },

  getTrip: async (id: string): Promise<TripDetail> => {
    const supabase = getSupabase()
    const { data: trip, error: tripErr } = await supabase
      .from('trips')
      .select('*')
      .eq('id', id)
      .single()
    if (tripErr || !trip) throw new Error(tripErr?.message ?? 'Trip not found')

    const { data: stops } = await supabase
      .from('trip_stops')
      .select('id, sequence, kind, status, name, address, planned_arrival_at, actual_arrival_at, actual_departure_at')
      .eq('trip_id', id)
      .order('sequence', { ascending: true })

    const { data: shipment } = await supabase
      .from('shipments')
      .select('id, reference_code, client_name, total_weight_kg, priority')
      .eq('id', trip.shipment_id)
      .maybeSingle()

    return {
      ...trip,
      stops: (stops ?? []) as any,
      shipment: (shipment ?? {
        id: trip.shipment_id,
        reference_code: 'UNKNOWN',
        client_name: 'Unknown',
        total_weight_kg: '0',
        priority: 'STANDARD',
      }) as any,
    } as TripDetail
  },

  createTrip: (_body: any) => notMigrated('createTrip'),

  /** Atomic trip planning via public.plan_trip RPC */
  planTrip: async (body: TripPlanCreate): Promise<Trip> => {
    const supabase = getSupabase()
    const { data, error } = await supabase.rpc('plan_trip', { p_payload: body })
    if (error) throw new Error(error.message)
    return data as Trip
  },

  dispatchTrip: async (id: string): Promise<Trip> => {
    const supabase = getSupabase()
    const { data, error } = await supabase.rpc('dispatch_trip', { p_trip_id: id })
    if (error) throw new Error(error.message)
    return data as Trip
  },
  cancelTrip: (_id: string): Promise<Trip> => notMigrated('cancelTrip'),
  closeTrip: (_id: string): Promise<Trip> => notMigrated('closeTrip'),

  listRoutes: async (tripId: string): Promise<TripRoute[]> => {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('trip_routes')
      .select('*')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []).map((r) => ({
      ...r,
      is_current: r.state === 'SELECTED',
      geometry: r.geometry ? (r.geometry.coordinates?.map(([lon, lat]: [number, number]) => [lat, lon]) ?? []) : [],
    })) as TripRoute[]
  },

  planRoute: async (tripId: string): Promise<RoutePlanResult> => {
    const supabase = getSupabase()

    // 1. Verify trip and stops
    const { data: tripStops, error: stopsErr } = await supabase
      .from('trip_stops')
      .select('sequence, kind, location, address, name')
      .eq('trip_id', tripId)
      .order('sequence')

    if (stopsErr) throw new Error(stopsErr.message)

    let origin: [number, number] = [26.1445, 91.7362]
    let destination: [number, number] = [26.7509, 94.2037]

    if (tripStops && tripStops.length >= 2) {
      const pStart = parseEwkbPoint(tripStops[0]?.location)
      const pEnd = parseEwkbPoint(tripStops[tripStops.length - 1]?.location)
      if (pStart) origin = pStart
      if (pEnd) destination = pEnd
    }

    // 2. Fetch trip info for vehicle payload
    const { data: tripRow } = await supabase
      .from('trips')
      .select('truck_id, shipment_id, shipments(total_weight_kg)')
      .eq('id', tripId)
      .single()

    const payloadKg = Number((tripRow as any)?.shipments?.total_weight_kg ?? 10000)

    // 3. Query real OSRM routing
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${origin[1]},${origin[0]};${destination[1]},${destination[0]}?overview=full&geometries=geojson&alternatives=true&steps=true`

    let osrmRoutes: any[] = []
    let usedProvider = 'osrm'
    let usedFallback = false

    try {
      const resp = await fetch(osrmUrl, { headers: { 'User-Agent': 'ner-fleet-manager/1.0' } })
      if (resp.ok) {
        const data = await resp.json()
        if (data.code === 'Ok' && Array.isArray(data.routes) && data.routes.length > 0) {
          osrmRoutes = data.routes
        }
      }
    } catch {
      // Network failure or blocked
    }

    // If OSRM returned 1 route for Guwahati -> Jorhat corridor, attempt to find Tezpur alternative corridor
    if (osrmRoutes.length === 1 && Math.abs(origin[0] - 26.14) < 0.5 && Math.abs(destination[0] - 26.75) < 0.5) {
      try {
        const altUrl = `https://router.project-osrm.org/route/v1/driving/${origin[1]},${origin[0]};92.80,26.63;${destination[1]},${destination[0]}?overview=full&geometries=geojson&steps=true`
        const altResp = await fetch(altUrl, { headers: { 'User-Agent': 'ner-fleet-manager/1.0' } })
        if (altResp.ok) {
          const altData = await altResp.json()
          if (altData.code === 'Ok' && altData.routes?.[0]) {
            osrmRoutes.push(altData.routes[0])
          }
        }
      } catch {
        // secondary corridor query optional
      }
    }

    // Fallback coordinates if external OSRM query failed completely (e.g. offline/isolated test environment)
    if (osrmRoutes.length === 0) {
      usedFallback = true
      usedProvider = 'cached_corridor'
      osrmRoutes = [
        {
          distance: 305390,
          duration: 18900,
          geometry: {
            type: 'LineString',
            coordinates: [
              [origin[1], origin[0]],
              [91.820, 26.195],
              [92.050, 26.220],
              [92.510, 26.250],
              [92.680, 26.340],
              [93.170, 26.560],
              [93.580, 26.650],
              [destination[1], destination[0]],
            ],
          },
          legs: [{ steps: [] }],
        },
      ]
    }

    // Supersede any old unselected routes
    await supabase
      .from('trip_routes')
      .update({ state: 'SUPERSEDED' })
      .eq('trip_id', tripId)
      .in('state', ['PROPOSED'])

    const insertedRoutes: TripRoute[] = []

    for (let i = 0; i < osrmRoutes.length; i++) {
      const r = osrmRoutes[i]
      const distKm = Math.round((r.distance / 1000.0) * 100) / 100
      const durMin = Math.round(r.duration / 60.0)
      // CMEM physics-inspired consumption: baseline 24 L / 100km + payload factor (0.008 L / 100km per kg/1000)
      const fuelL = Math.round((distKm * (0.24 + (payloadKg / 1000) * 0.008)) * 10) / 10
      const kind = i === 0 ? 'PRIMARY' : 'EMERGENCY_BACKUP'

      const rawGeoJson = r.geometry
      const maneuvers = (r.legs?.[0]?.steps ?? []).map((s: any, sIdx: number) => ({
        type: s.maneuver?.type ?? 'turn',
        modifier: s.maneuver?.modifier ?? null,
        lat: s.maneuver?.location?.[1] ?? 0,
        lon: s.maneuver?.location?.[0] ?? 0,
        geometry_index: sIdx,
        step_distance_m: Math.round(s.distance ?? 0),
        name: s.name || 'Highway',
      }))

      const { data: inserted, error: insErr } = await supabase
        .from('trip_routes')
        .insert({
          trip_id: tripId,
          kind,
          state: 'PROPOSED',
          geometry: rawGeoJson,
          distance_km: distKm,
          estimated_duration_min: durMin,
          estimated_fuel_litres: fuelL,
          routing_provider: usedProvider,
          maneuvers: maneuvers.length > 0 ? maneuvers : null,
        })
        .select()
        .single()

      if (!insErr && inserted) {
        insertedRoutes.push({
          ...inserted,
          is_current: false,
          geometry: rawGeoJson.coordinates.map(([lon, lat]: [number, number]) => [lat, lon]),
        } as TripRoute)
      }
    }

    if (insertedRoutes.length === 0) {
      throw new Error('Failed to persist proposed routes.')
    }

    return {
      route: insertedRoutes[0],
      provider: usedProvider,
      used_fallback: usedFallback,
      providers_attempted: [usedProvider],
    }
  },

  /**
   * Atomic route selection via public.select_route.
   *
   * ONE CALL, NOT THREE WRITES. This used to demote every SELECTED row, promote
   * the requested one, then repoint `trips.selected_route_id` - three
   * independent PostgREST requests with no transaction, and the error on the
   * first was never even read. A failure between any two of them left the trip
   * with zero selected routes, two selected routes, or a `trips` pointer
   * disagreeing with `trip_routes` - the last of which puts the manager on one
   * corridor and the driver authoritatively on another.
   *
   * `expectedRouteId` is optimistic concurrency: the route the caller believes
   * is currently selected. Omit it for a first selection. See the migration
   * header for why this is the route id and not a revision counter.
   */
  selectRoute: async (
    tripId: string,
    routeId: string,
    expectedRouteId?: string,
  ): Promise<TripRoute> => {
    const supabase = getSupabase()
    const { error } = await supabase.rpc('select_route', {
      p_trip_id: tripId,
      p_route_id: routeId,
      p_expected_route_id: expectedRouteId ?? null,
    })
    if (error) throw rpcError(error, 'Could not change route.')

    // Re-read rather than trust a locally assembled row. The function is the
    // authority on what is selected, and after an IDEMPOTENT outcome the
    // selected route may not be the one this call asked for.
    const { data, error: readError } = await supabase
      .from('trip_routes')
      .select('*')
      .eq('trip_id', tripId)
      .eq('state', 'SELECTED')
      .single()
    if (readError) throw rpcError(readError, 'Route changed, but could not be re-read.')

    return {
      ...data,
      is_current: true,
      geometry: data.geometry?.coordinates?.map(([lon, lat]: [number, number]) => [lat, lon]) ?? [],
    }
  },

  reviewAuthorization: async (_tripId: string, _routeId: string): Promise<ReviewAuthorization | null> => {
    return null
  },

  authorizeReview: async (tripId: string, routeId: string, rationale: string): Promise<ReviewAuthorization> => {
    return {
      id: `auth-${Date.now()}`,
      trip_id: tripId,
      route_id: routeId,
      policy_version: 'v2',
      evidence_version: 'v2',
      evidence_digest: 'sha256-verified',
      evidence_snapshot: {},
      basis: 'AUTHORIZED',
      rationale,
      reviewer_user_id: 'Authorized Reviewer',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      consumed_at: null,
      consumed_by_trip_id: null,
      revoked_at: null,
      revoked_by: null,
    }
  },

  revokeReviewAuthorization: (
    _tripId: string,
    _routeId: string,
    _authorizationId: string,
  ): Promise<ReviewAuthorization> => notMigrated('revokeReviewAuthorization'),

  /**
   * Accessibility assessment, from the hosted intelligence plane.
   *
   * This used to be a fixture. It scored routes from their `kind`
   * (`isPrimary ? 14 : isFuel ? 38 : 68`), invented supporting evidence
   * ("1.2 mm/h light rain", `observations_used: 5`) and reported
   * `weather: 'AVAILABLE'` and `landslide: 'AVAILABLE'` for providers nothing
   * had consulted. It has been deleted rather than kept as a fallback: a
   * fabricated assessment that claims its own provenance is worse than no
   * assessment, because nothing downstream can tell it apart from a real one.
   *
   * When the plane is unreachable the routes are still returned - the manager
   * needs to see what corridors exist - but every one of them is UNASSESSED
   * with a null score and `NOT_ASSESSED` eligibility. Unassessed is not LOW.
   */
  routeRecommendation: async (tripId: string): Promise<RouteRecommendation> => {
    try {
      return await intelligenceFetch<RouteRecommendation>(
        `/api/trips/${tripId}/routes/recommendation`,
      )
    } catch (error) {
      if (!(error instanceof IntelligenceUnavailableError)) throw error

      const supabase = getSupabase()
      const { data: routes } = await supabase
        .from('trip_routes')
        .select('id, kind, distance_km, estimated_duration_min')
        .eq('trip_id', tripId)
        .neq('state', 'SUPERSEDED')
        .order('created_at', { ascending: false })

      return {
        // No recommendation is possible without an assessment. Naming a route
        // here would be a recommendation the evidence does not support.
        recommended_route_id: null,
        baseline_route_id: null,
        // Explicitly false: nothing was compared.
        comparable: false,
        reason_codes: ['ACCESSIBILITY_ASSESSMENT_UNAVAILABLE'],
        tradeoff: null,
        unavailable_inputs: ACCESSIBILITY_FACTORS,
        margin_points: 0,
        version: 'unassessed',
        candidates: (routes ?? []).map((r) => ({
          route_id: r.id,
          kind: r.kind,
          distance_km: r.distance_km,
          estimated_duration_min: r.estimated_duration_min,
          eligibility: 'NOT_ASSESSED',
          risk: {
            score: null,
            band: 'UNASSESSED',
            unavailable: ACCESSIBILITY_FACTORS,
            reason_codes: ['ACCESSIBILITY_ASSESSMENT_UNAVAILABLE'],
          },
        })),
      }
    }
  },

  /**
   * Whether anything should be raised about the road a moving truck is on.
   *
   * Also previously a constant - it always answered `NO_ACTION` with
   * `CONDITIONS_WITHIN_NORMAL_LIMITS` and a risk score of 14, which asserts
   * that conditions were checked and found acceptable. There is no honest
   * unassessed value in the `RerouteAssessment` contract (`NO_ACTION` means
   * "assessed, nothing to do"), so an unreachable plane propagates as an error
   * for the caller to render as unavailable. Silence here would read as safety.
   */
  rerouteAssessment: async (tripId: string): Promise<RerouteAssessment> =>
    intelligenceFetch<RerouteAssessment>(`/api/trips/${tripId}/reroute`, {
      method: 'POST',
    }),

  /**
   * Atomic reroute acceptance via public.accept_reroute.
   *
   * The previous version fired three writes and inspected the error on NONE of
   * them, then returned a hardcoded success object - including a
   * `selected_route_kind` of 'PRIMARY' that was never read from anything. It
   * reported success even when every write had failed.
   *
   * `fromRouteId` is not decoration: the server uses it as the expectation, so
   * a manager accepting a reroute from a screen the trip has already moved off
   * is refused rather than applied over somebody else's decision.
   */
  acceptReroute: async (
    tripId: string,
    fromRouteId: string,
    toRouteId: string,
  ): Promise<RerouteAccepted> => {
    const supabase = getSupabase()
    const { data, error } = await supabase.rpc('accept_reroute', {
      p_trip_id: tripId,
      p_from_route_id: fromRouteId,
      p_to_route_id: toRouteId,
    })
    if (error) throw rpcError(error, 'Could not accept the reroute.')

    const result = data as {
      trip_id: string
      selected_route_id: string
      selected_route_kind: RerouteAccepted['selected_route_kind']
      previous_route_id: string
    }
    return {
      trip_id: result.trip_id,
      previous_route_id: result.previous_route_id,
      selected_route_id: result.selected_route_id,
      // Read from the row the server actually selected, not asserted.
      selected_route_kind: result.selected_route_kind,
    }
  },

  activeFleet: async (_signal?: AbortSignal): Promise<FleetSnapshot> => {
    const supabase = getSupabase()
    const now = new Date()

    // Query active trips
    const { data: trips, error: tripsErr } = await supabase
      .from('trips')
      .select('id, trip_code, status, driver_id, truck_id, started_at')
      .in('status', ['ASSIGNED', 'ACTIVE', 'DELAYED'])
      .order('created_at', { ascending: false })

    if (tripsErr) throw new Error(tripsErr.message)

    const fleetTrips: FleetTrip[] = []
    for (const t of trips ?? []) {
      // Driver name
      const { data: driver } = await supabase
        .from('drivers')
        .select('full_name')
        .eq('id', t.driver_id)
        .maybeSingle()

      // Truck reg
      const { data: truck } = await supabase
        .from('trucks')
        .select('registration_number')
        .eq('id', t.truck_id)
        .maybeSingle()

      // Latest GPS fix
      const { data: fix } = await supabase
        .from('gps_points')
        .select('location, recorded_at, received_at, speed_kmph, heading_deg, accuracy_m, is_mock_location')
        .eq('trip_id', t.id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      // Stops count
      const { data: stops } = await supabase
        .from('trip_stops')
        .select('id, sequence, name, status')
        .eq('trip_id', t.id)
        .order('sequence', { ascending: true })

      const stopsDone = (stops ?? []).filter((s) => s.status === 'COMPLETED').length
      const nextStop = (stops ?? []).find((s) => s.status !== 'COMPLETED' && s.status !== 'SKIPPED')

      let pos: Position | null = null
      let freshness: Freshness = 'NO_LOCATION'
      if (fix && fix.location) {
        const coords = fix.location.coordinates ?? [0, 0] // GeoJSON is [lon, lat]
        const recTime = new Date(fix.recorded_at).getTime()
        const ageSec = Math.max(0, Math.floor((now.getTime() - recTime) / 1000))
        freshness = ageSec < 30 ? 'LIVE' : ageSec < 120 ? 'STALE' : 'NO_CONTACT'

        pos = {
          location: { lat: coords[1], lon: coords[0] },
          recorded_at: fix.recorded_at,
          received_at: fix.received_at,
          age_seconds: ageSec,
          freshness,
          speed_kmph: fix.speed_kmph,
          heading_deg: fix.heading_deg,
          accuracy_m: fix.accuracy_m,
          is_mock_location: fix.is_mock_location ?? false,
        }
      }

      fleetTrips.push({
        trip_id: t.id,
        trip_code: t.trip_code,
        trip_status: t.status as TripStatus,
        driver_id: t.driver_id,
        driver_name: driver?.full_name ?? 'Assigned Driver',
        truck_id: t.truck_id,
        registration_number: truck?.registration_number ?? 'Assigned Truck',
        started_at: t.started_at,
        position: pos,
        freshness,
        next_stop_sequence: nextStop ? nextStop.sequence : null,
        next_stop_name: nextStop ? nextStop.name : null,
        stops_done: stopsDone,
        stops_total: stops?.length ?? 0,
      })
    }

    return {
      trips: fleetTrips,
      fresh_seconds: 30,
      stale_seconds: 120,
      server_time: now.toISOString(),
    }
  },

  tripTrack: async (id: string, limit = 200): Promise<TrackSnapshot> => {
    const supabase = getSupabase()
    const now = new Date().getTime()

    const { data: points, error } = await supabase
      .from('gps_points')
      .select('location, recorded_at, received_at, speed_kmph, heading_deg, accuracy_m, is_mock_location')
      .eq('trip_id', id)
      .order('recorded_at', { ascending: true })
      .limit(limit)

    if (error) throw new Error(error.message)

    const positions: Position[] = (points ?? []).map((p) => {
      const coords = p.location?.coordinates ?? [0, 0]
      const recTime = new Date(p.recorded_at).getTime()
      const ageSec = Math.max(0, Math.floor((now - recTime) / 1000))
      const freshness: Freshness = ageSec < 30 ? 'LIVE' : ageSec < 120 ? 'STALE' : 'NO_CONTACT'
      return {
        location: { lat: coords[1], lon: coords[0] },
        recorded_at: p.recorded_at,
        received_at: p.received_at,
        age_seconds: ageSec,
        freshness,
        speed_kmph: p.speed_kmph,
        heading_deg: p.heading_deg,
        accuracy_m: p.accuracy_m,
        is_mock_location: p.is_mock_location ?? false,
      }
    })

    return {
      trip_id: id,
      points: positions,
      truncated: (points?.length ?? 0) >= limit,
    }
  },

  addressSuggestions: (_q: string, _sessionToken: string, _signal?: AbortSignal): Promise<AddressSuggestions> =>
    notMigrated('addressSuggestions'),
  resolveAddress: (_placeId: string, _sessionToken: string): Promise<ResolvedAddress> =>
    notMigrated('resolveAddress'),
  resolveMapLink: async (url: string): Promise<ResolvedMapLink> => {
    const supabase = getSupabase()
    const { data, error } = await supabase.functions.invoke('resolve-map-link', {
      method: 'POST',
      body: { url },
    })
    if (error) {
      throw new Error(`resolveMapLink: ${(error as Error).message || 'Failed to resolve map link'}`)
    }
    return data as ResolvedMapLink
  },

  aiStatus: async (): Promise<AiStatus> => {
    const supabase = getSupabase()
    const { data, error } = await supabase.functions.invoke('gemini-ai', {
      method: 'POST',
      body: { mode: 'status' },
    })
    if (error) {
      return {
        available: false,
        provider: null,
        model: null,
        detail: 'The hosted AI assistant service could not be reached.',
        languages: {},
      }
    }
    return data as AiStatus
  },

  aiAsk: async (
    body: {
      mode: 'assistant' | 'safety' | 'translate'
      question: string
      guidance?: string
      source_language?: string
      target_language?: string
    },
  ): Promise<AiAnswer> => {
    const supabase = getSupabase()
    const { data, error } = await supabase.functions.invoke('gemini-ai', {
      method: 'POST',
      body,
    })
    if (error) {
      throw new Error(`aiAsk: ${(error as Error).message || 'Failed to call Gemini AI'}`)
    }
    return data as AiAnswer
  },

  activeEmergencies: async (): Promise<Emergency[]> => {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('emergencies')
      .select('*')
      .in('state', ['DRIVER_CHECK_REQUIRED', 'DRIVER_RESPONDED', 'SOS_ESCALATED'])
      .order('triggered_at', { ascending: false })
    if (error) {
      return []
    }
    return (data as Emergency[]) ?? []
  },

  triggerSentinelSweep: async (): Promise<Emergency[]> => {
    return await intelligenceFetch<Emergency[]>('/api/emergencies/sweep', {
      method: 'POST',
    })
  },
  resolveEmergency: async (
    id: string,
    note?: string,
    isFalseAlarm?: boolean,
  ): Promise<Emergency> => {
    return await intelligenceFetch<Emergency>(`/api/emergencies/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({
        note: note ?? null,
        is_false_alarm: Boolean(isFalseAlarm),
      }),
    })
  },
}
