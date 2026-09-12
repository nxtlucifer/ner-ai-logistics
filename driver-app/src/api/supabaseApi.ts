/**
 * Supabase implementation of the driver app's API contract.
 *
 * Shape-compatible with the `api` object in client.ts so no screen changes.
 * The core journey - trip, accept, start, location - is backed by database
 * objects proven in `backend/scripts/rls_harness.py` (87/87) and the shared
 * route-progress port (89 parity tests). The rest deliberately THROW.
 *
 * WHY UNMIGRATED OPERATIONS THROW RATHER THAN RETURN EMPTY
 *
 * A stub returning `null` or `[]` is indistinguishable, on screen, from "you
 * have no trip" or "no hotels nearby". That is the failure mode this project
 * has rules against - unavailable data must render as unavailable, never as a
 * plausible-looking zero. `NotMigratedError` carries the operation name so the
 * UI can say which capability is missing instead of showing a confident empty
 * state.
 */

import { intelligenceFetch } from './intelligence'
import { supabase } from './supabaseClient'
import { normalizeAndValidatePhone } from '../auth/phone'
import { AuthError } from '../auth/authErrors'
import type {
  ActiveEmergency,
  AiAnswer,
  AiStatus,
  AuthenticatedUser,
  CurrentTrip,
  DriverCheckResponse,
  DriverMe,
  GpsBatchAccepted,
  GpsFix,
  PlacesQuery,
  PlacesResponse,
  TokenResponse,
  VerifyPayload,
} from './client'

export class NotMigratedError extends Error {
  readonly operation: string
  constructor(operation: string) {
    super(
      `${operation} is not migrated to Supabase yet. It still requires the FastAPI backend.`,
    )
    this.name = 'NotMigratedError'
    this.operation = operation
  }
}

const notMigrated = (operation: string) => () => {
  throw new NotMigratedError(operation)
}

/** PostgREST errors carry a code in `details` from our RAISE ... USING. */
function rethrow(operation: string, error: { message: string; details?: string | null }): never {
  let code: string | undefined
  try {
    code = error.details ? (JSON.parse(error.details) as { code?: string }).code : undefined
  } catch {
    code = undefined
  }
  const wrapped = new Error(code ? `${operation}: ${code}` : `${operation}: ${error.message}`)
  ;(wrapped as Error & { code?: string }).code = code
  throw wrapped
}

export const supabaseApi = {
  login: async (identifier: string, password: string): Promise<TokenResponse> => {
    let email: string
    if (identifier.includes('@')) {
      email = identifier.trim()
    } else {
      const phoneValidation = normalizeAndValidatePhone(identifier)
      if (!phoneValidation.isValid) {
        throw new AuthError(
          'INVALID_CREDENTIALS',
          'Incorrect details',
          phoneValidation.error ?? 'Phone number or password is incorrect.',
        )
      }
      email = `${phoneValidation.normalized}@driver.ner.local`
    }

    const { data, error } = await supabase().auth.signInWithPassword({
      email,
      password: password.trim(),
    })
    if (error || !data.session || !data.user) {
      throw new AuthError(
        'INVALID_CREDENTIALS',
        'Incorrect details',
        'Phone number or password is incorrect.',
      )
    }

    const { data: appUser } = await supabase()
      .from('users')
      .select('id, email, phone, role, display_name, is_active')
      .eq('id', data.user.id)
      .maybeSingle()

    if (appUser && appUser.is_active === false) {
      try {
        await supabase().auth.signOut()
      } catch {
        // Ignore
      }
      throw new AuthError(
        'ACCOUNT_DISABLED',
        'Account inactive',
        'This driver account is inactive. Contact your manager.',
      )
    }

    if (appUser && appUser.role !== 'DRIVER') {
      try {
        await supabase().auth.signOut()
      } catch {
        // Ignore
      }
      throw new AuthError(
        'NO_DRIVER_PROFILE',
        'Profile missing',
        'Your login exists, but no driver profile is assigned.',
      )
    }

    const authUser: AuthenticatedUser = {
      id: data.user.id,
      role: (appUser?.role ?? 'DRIVER') as any,
      display_name: appUser?.display_name ?? 'Driver',
      email: appUser?.email ?? data.user.email ?? null,
      phone: appUser?.phone ?? null,
    }

    const expiresAt = new Date(Date.now() + (data.session.expires_in ?? 3600) * 1000).toISOString()

    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token ?? null,
      expires_at: expiresAt,
      user: authUser,
    }
  },

  logout: async (): Promise<void> => {
    await supabase().auth.signOut()
  },

  /**
   * The caller's own driver record.
   *
   * `.single()` is what enforces "exactly one": the RLS policy already limits a
   * driver to their own row, so more than one would mean the policy changed
   * under us, and that should fail loudly rather than silently pick the first.
   */
  me: async (): Promise<DriverMe> => {
    const { data, error } = await supabase()
      .from('drivers')
      .select('id, full_name, phone, licence_number, licence_expiry, status')
      .single()
    if (error) {
      if ((error as { code?: string }).code === 'PGRST116') {
        throw new AuthError(
          'NO_DRIVER_PROFILE',
          'Profile missing',
          'Your login exists, but no driver profile is assigned.',
        )
      }
      rethrow('me', error)
    }
    if (data.status === 'SUSPENDED' || data.status === 'INACTIVE') {
      throw new AuthError(
        'ACCOUNT_DISABLED',
        'Account inactive',
        'This driver account is inactive. Contact your manager.',
      )
    }
    return data as DriverMe
  },

  /**
   * Acknowledge the dispatched trip.
   *
   * No trip id is sent. The server resolves the trip from the authenticated
   * driver, which is what makes a forged or stale id useless - the same
   * object-level binding the FastAPI service layer applies. Idempotent: a
   * double tap returns the first acceptance unchanged.
   */
  acceptTrip: async (tripId: string): Promise<{ driver_accepted_at: string | null }> => {
    const { data, error } = await supabase().rpc('accept_trip', { p_trip_id: tripId })
    if (error) rethrow('acceptTrip', error)
    return data as { driver_accepted_at: string | null }
  },

  /**
   * Flush the bounded offline queue.
   *
   * `trip_id` is not sent for the same reason as above. The counters come back
   * in the GpsBatchAccepted shape the queue already understands, so a replay
   * after reconnect reports `duplicates_ignored` rather than double-counting,
   * and one unacceptable fix does not discard the rest of the batch.
   */
  sendLocation: async (_tripId: string, fixes: GpsFix[]): Promise<GpsBatchAccepted> => {
    const { data, error } = await supabase().rpc('submit_location_batch', { p_fixes: fixes })
    if (error) rethrow('sendLocation', error)
    return data as GpsBatchAccepted
  },

  /**
   * The composed trip payload.
   *
   * NOT a table read. CurrentTrip carries can_start with its blocking reason,
   * tracking configuration, route progress and the next stop - all
   * server-computed from rules that must not move into a client, where they
   * could be edited. The `driver-trip` Edge Function composes it from
   * `app.driver_trip_payload()` (tested in rls_harness.py) and the shared
   * route-progress port (89 parity tests against Python fixtures).
   *
   * A null body is an ordinary state - no assignment yet - not an error.
   */
  myTrip: async (): Promise<CurrentTrip | null> => {
    const { data, error } = await supabase().functions.invoke('driver-trip', { method: 'GET' })
    if (error) {
      const body = (error as { context?: { code?: string } }).context
      throw new Error(`myTrip: ${body?.code ?? (error as Error).message}`)
    }
    return (data as CurrentTrip | null) ?? null
  },

  /**
   * ASSIGNED -> ACTIVE, behind the server-side start gate.
   *
   * The gate is not re-implemented here. `start_gate` and `start_trip` share one
   * definition in the database precisely so the reason a button is disabled and
   * the reason the server refuses cannot drift apart - a second copy in the
   * client is how a screen comes to show an enabled button the server rejects.
   */
  startTrip: async (tripId: string) => {
    const { data, error } = await supabase().rpc('start_trip', { p_trip_id: tripId })
    if (error) rethrow('startTrip', error)
    return data as { status: string; started_at: string | null }
  },

  /** Why Start is disabled, from the same rule the write enforces. */
  startGate: async (tripId?: string) => {
    const { data, error } = await supabase().rpc('start_gate', { p_trip_id: tripId ?? null })
    if (error) rethrow('startGate', error)
    const row = (data as Array<{ blocked_code: string | null; blocked_reason: string | null }>)[0]
    return { code: row?.blocked_code ?? null, reason: row?.blocked_reason ?? null }
  },

  /**
   * Driver confirms the physical truck.
   *
   * A registration mismatch is FLAGGED, never refused: a driver standing at the
   * wrong vehicle still needs to tell someone, and blocking the report would
   * leave the manager knowing nothing.
   */
  verifyAssignment: async (payload: VerifyPayload) => {
    const { data, error } = await supabase().rpc('verify_assignment', {
      p_registration: payload.reported_registration ?? '',
    })
    if (error) rethrow('verifyAssignment', error)
    return data as { verified_at: string | null; mismatch_flagged: boolean }
  },

  /**
   * Stop transitions. Idempotency is settled server-side and checked BEFORE the
   * ordering rule, so a retry of a completed stop succeeds instead of coming
   * back as "stop 2 is next" - the failure the Python module records having had.
   */
  arriveAtStop: async (stopId: string) => {
    const { data, error } = await supabase().rpc('arrive_at_stop', { p_stop_id: stopId })
    if (error) rethrow('arriveAtStop', error)
    return data as { stop_id: string; status: string; idempotent: boolean }
  },

  completeStop: async (stopId: string) => {
    const { data, error } = await supabase().rpc('complete_stop', { p_stop_id: stopId })
    if (error) rethrow('completeStop', error)
    return data as { stop_id: string; status: string; idempotent: boolean }
  },

  /** In progress -> DELIVERED, once every stop is settled. Server clock only. */
  completeTrip: async (tripId: string) => {
    const { data, error } = await supabase().rpc('complete_trip', { p_trip_id: tripId })
    if (error) rethrow('completeTrip', error)
    return data as { status: string; delivered_at: string | null }
  },

  // Edge Function: Gemini AI assistant with rate limiting and offline fallback
  aiStatus: async (): Promise<AiStatus> => {
    const { data, error } = await supabase().functions.invoke('gemini-ai', {
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
    _signal?: AbortSignal,
  ): Promise<AiAnswer> => {
    const { data, error } = await supabase().functions.invoke('gemini-ai', {
      method: 'POST',
      body,
    })
    if (error) {
      throw new Error(`aiAsk: ${(error as Error).message || 'Failed to call Gemini AI'}`)
    }
    return data as AiAnswer
  },

  /**
   * The corridor to draw, and the stops on it.
   *
   * Served by the hosted intelligence plane, not by Supabase: geometry is a
   * routing product, and `CurrentTrip` deliberately does not carry it (see the
   * note on that type in client.ts). While this threw, a freshly installed APK
   * had no geometry source at all and the navigation screen had no route line
   * to draw - the caller fell back to a cached package that a new install does
   * not have.
   *
   * Failure is NOT swallowed here. `useRouteGeometry` catches it and falls back
   * to the stored package for this same trip AND route, or renders an honest
   * error. An empty geometry returned from here would be indistinguishable from
   * a trip with no route.
   */
  offlinePackage: async () =>
    intelligenceFetch<unknown>('/api/driver/me/trip/offline-package'),

  /**
   * Turn instructions for the driver's current route.
   *
   * Separate from the geometry on purpose: losing directions is a degradation
   * (the corridor still draws), losing the corridor is not. The caller keeps
   * them apart and must continue to.
   */
  navigationPackage: async () =>
    intelligenceFetch<unknown>('/api/driver/me/trip/navigation'),

  /**
   * Roadside services along the corridor.
   *
   * Served by the hosted intelligence plane from its local snapshot.
   */
  places: async (query?: PlacesQuery): Promise<PlacesResponse> => {
    const q = query ?? {
      category: 'REST',
      south: 0,
      west: 0,
      north: 0,
      east: 0,
      anchor: 'MAP_AREA',
    }
    return intelligenceFetch<PlacesResponse>(
      '/api/driver/me/trip/places?' +
        new URLSearchParams({
          category: q.category,
          south: String(q.south),
          west: String(q.west),
          north: String(q.north),
          east: String(q.east),
          anchor: q.anchor,
          ...(q.anchorLat !== undefined && q.anchorLon !== undefined
            ? {
                anchor_lat: String(q.anchorLat),
                anchor_lon: String(q.anchorLon),
              }
            : {}),
          limit: String(q.limit ?? 40),
        }).toString(),
    )
  },

  /**
   * Submit safety check-in response.
   *
   * Routed through the hosted intelligence / backend service, which holds the
   * deterministic Fleet Sentinel domain logic.
   */
  checkInEmergency: async (
    tripId: string,
    response: DriverCheckResponse,
  ): Promise<ActiveEmergency> => {
    return intelligenceFetch<ActiveEmergency>('/api/driver/me/trip/check-in', {
      method: 'POST',
      body: JSON.stringify({ trip_id: tripId, response }),
    })
  },

  // Still unmigrated. Each names itself so a failure says which capability is
  // missing rather than surfacing as an empty screen.
  myAssignment: notMigrated('myAssignment'),
  ready: notMigrated('ready'),
}

export type SupabaseApi = typeof supabaseApi
