/**
 * Contract tests for the Supabase adapter.
 *
 * These prove the CLIENT half: that the adapter sends what the guarded database
 * functions expect and maps what they return. The SERVER half - that those
 * functions actually refuse the wrong caller - is proven separately and for
 * real in backend/scripts/rls_harness.py (48/48), against Postgres with
 * Supabase's own auth.uid() predicate.
 *
 * Neither half substitutes for an end-to-end run against a deployed project,
 * which has not happened.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const invoke = vi.fn()
const single = vi.fn()
const maybeSingle = vi.fn()
const eq = vi.fn(() => ({ maybeSingle }))
const select = vi.fn((_columns: string) => ({ single, eq }))
const from = vi.fn(() => ({ select }))
const signInWithPassword = vi.fn()
const signOut = vi.fn()

vi.mock('./supabaseClient', () => ({
  supabase: () => ({ rpc, from, functions: { invoke }, auth: { signInWithPassword, signOut } }),
}))

import { IntelligenceUnavailableError } from './intelligence'
import { NotMigratedError, supabaseApi } from './supabaseApi'

beforeEach(() => {
  rpc.mockReset()
  invoke.mockReset()
  single.mockReset()
  maybeSingle.mockReset()
  eq.mockClear()
  select.mockClear()
  from.mockClear()
  signInWithPassword.mockReset()
  signOut.mockReset()
})

describe('acceptTrip', () => {
  it('reaches the guarded RPC and returns the acceptance', async () => {
    rpc.mockResolvedValue({ data: { driver_accepted_at: '2026-09-07T10:00:00Z' }, error: null })
    const r = await supabaseApi.acceptTrip('trip-1')
    expect(rpc).toHaveBeenCalledWith('accept_trip', { p_trip_id: 'trip-1' })
    expect(r.driver_accepted_at).toBe('2026-09-07T10:00:00Z')
  })

  it('surfaces the structured code, not the raw postgres message', async () => {
    rpc.mockResolvedValue({
      error: { message: 'This trip is no longer running.', details: '{"code":"TRIP_NOT_ACCEPTABLE","status":"CLOSED"}' },
    })
    await expect(supabaseApi.acceptTrip('t')).rejects.toThrow(/TRIP_NOT_ACCEPTABLE/)
  })
})

describe('sendLocation', () => {
  const fix = (id: string): never =>
    ({ device_fix_id: id, location: { lat: 26.1, lon: 91.7 }, recorded_at: '2026-09-07T10:00:00Z' }) as never

  it('sends the fixes array and never the caller-supplied trip id', async () => {
    rpc.mockResolvedValue({
      data: { trip_id: 't1', accepted: 2, duplicates_ignored: 0, rejected: 0, rejected_reasons: {} },
      error: null,
    })
    const r = await supabaseApi.sendLocation('trip-from-client', [fix('a'), fix('b')])
    const [name, args] = rpc.mock.calls[0]
    expect(name).toBe('submit_location_batch')
    // The trip is resolved server-side from the authenticated driver. If the
    // client's id were forwarded it could be used to post another driver's
    // positions, so it must not appear in the payload at all.
    expect(JSON.stringify(args)).not.toContain('trip-from-client')
    expect(r.accepted).toBe(2)
  })

  it('preserves duplicates_ignored so a replay is not double-counted', async () => {
    rpc.mockResolvedValue({
      data: { trip_id: 't1', accepted: 0, duplicates_ignored: 3, rejected: 0, rejected_reasons: {} },
      error: null,
    })
    const r = await supabaseApi.sendLocation('t', [fix('a')])
    expect(r).toMatchObject({ accepted: 0, duplicates_ignored: 3 })
  })
})

describe('me', () => {
  it('reads the caller-scoped driver row', async () => {
    single.mockResolvedValue({ data: { id: 'd1', full_name: 'A', phone: '9', licence_number: 'L', licence_expiry: '2030-01-01', status: 'AVAILABLE' }, error: null })
    const r = await supabaseApi.me()
    expect(from).toHaveBeenCalledWith('drivers')
    expect(r.id).toBe('d1')
  })

  it('never selects a column the grant withholds', async () => {
    single.mockResolvedValue({ data: {}, error: null })
    await supabaseApi.me()
    const columns = select.mock.calls[0][0]
    for (const withheld of ['password_hash', 'base_salary_monthly', '*']) {
      expect(columns).not.toContain(withheld)
    }
  })
})

describe('startTrip', () => {
  it('calls the guarded RPC and does not re-implement the gate', async () => {
    rpc.mockResolvedValue({ data: { status: 'ACTIVE', started_at: '2026-09-07T10:00:00Z' }, error: null })
    const r = await supabaseApi.startTrip('trip-1')
    expect(rpc).toHaveBeenCalledWith('start_trip', { p_trip_id: 'trip-1' })
    expect(r.status).toBe('ACTIVE')
  })

  it('surfaces the blocker code the gate raised', async () => {
    rpc.mockResolvedValue({
      error: { message: 'Check the truck before starting the trip.', details: '{"code":"ASSIGNMENT_NOT_VERIFIED"}' },
    })
    await expect(supabaseApi.startTrip('t')).rejects.toThrow(/ASSIGNMENT_NOT_VERIFIED/)
  })

  it('reads the disable reason from the same server rule', async () => {
    rpc.mockResolvedValue({ data: [{ blocked_code: 'TRUCK_NOT_OPERATIONAL', blocked_reason: 'Truck is breakdown and cannot start a trip.' }], error: null })
    const g = await supabaseApi.startGate('t')
    expect(g).toEqual({ code: 'TRUCK_NOT_OPERATIONAL', reason: 'Truck is breakdown and cannot start a trip.' })
  })
})

describe('myTrip', () => {
  it('calls the driver-trip Edge Function', async () => {
    invoke.mockResolvedValue({ data: { id: 't1', trip_code: 'TRP-1', progress: null }, error: null })
    const r = await supabaseApi.myTrip()
    expect(invoke).toHaveBeenCalledWith('driver-trip', { method: 'GET' })
    expect(r?.trip_code).toBe('TRP-1')
  })

  it('treats a null body as "no assignment yet", not an error', async () => {
    invoke.mockResolvedValue({ data: null, error: null })
    await expect(supabaseApi.myTrip()).resolves.toBeNull()
  })

  it('surfaces the structured code from the function', async () => {
    invoke.mockResolvedValue({ error: Object.assign(new Error('bad'), { context: { code: 'FORBIDDEN' } }) })
    await expect(supabaseApi.myTrip()).rejects.toThrow(/FORBIDDEN/)
  })
})

describe('workflow completion', () => {
  it('verifyAssignment sends only the registration', async () => {
    rpc.mockResolvedValue({ data: { verified_at: '2026-09-07T10:00:00Z', mismatch_flagged: false }, error: null })
    const r = await supabaseApi.verifyAssignment({ reported_registration: 'AS99TC2994' })
    expect(rpc).toHaveBeenCalledWith('verify_assignment', { p_registration: 'AS99TC2994' })
    expect(r.mismatch_flagged).toBe(false)
  })

  it('a mismatch comes back flagged, not as an error', async () => {
    rpc.mockResolvedValue({ data: { verified_at: '2026-09-07T10:00:00Z', mismatch_flagged: true }, error: null })
    await expect(supabaseApi.verifyAssignment({ reported_registration: 'WRONG' }))
      .resolves.toMatchObject({ mismatch_flagged: true })
  })

  it.each([
    ['arriveAtStop', 'arrive_at_stop'],
    ['completeStop', 'complete_stop'],
  ])('%s calls %s', async (method, fn) => {
    rpc.mockResolvedValue({ data: { stop_id: 's1', status: 'ARRIVED', idempotent: false }, error: null })
    await (supabaseApi as unknown as Record<string, (id: string) => Promise<unknown>>)[method]('s1')
    expect(rpc).toHaveBeenCalledWith(fn, { p_stop_id: 's1' })
  })

  it('surfaces STOP_OUT_OF_ORDER as a structured code', async () => {
    rpc.mockResolvedValue({ error: { message: 'Stops are completed in order.', details: '{"code":"STOP_OUT_OF_ORDER"}' } })
    await expect(supabaseApi.completeStop('s2')).rejects.toThrow(/STOP_OUT_OF_ORDER/)
  })

  it('completeTrip surfaces STOPS_INCOMPLETE', async () => {
    rpc.mockResolvedValue({ error: { message: '1 stop(s) are not finished yet.', details: '{"code":"STOPS_INCOMPLETE"}' } })
    await expect(supabaseApi.completeTrip('t1')).rejects.toThrow(/STOPS_INCOMPLETE/)
  })
})

describe('ai assistant edge function integration', () => {
  it('aiStatus invokes gemini-ai edge function', async () => {
    invoke.mockResolvedValue({
      data: { available: true, provider: 'GOOGLE_GEMINI', model: 'gemini-2.5-flash', detail: null, languages: { hi: 'Hindi' } },
      error: null,
    })
    const res = await supabaseApi.aiStatus()
    expect(invoke).toHaveBeenCalledWith('gemini-ai', { method: 'POST', body: { mode: 'status' } })
    expect(res.available).toBe(true)
    expect(res.provider).toBe('GOOGLE_GEMINI')
  })

  it('aiAsk invokes gemini-ai edge function with question body', async () => {
    invoke.mockResolvedValue({
      data: { answer: 'Next stop is Jorhat', generated: true, model: 'gemini-2.5-flash', facts_as_of: null, severity: 'INFO', source_mode: 'LIVE_DATA', actions: [], disclaimer: null },
      error: null,
    })
    const res = await supabaseApi.aiAsk({ mode: 'assistant', question: 'Next stop?' })
    expect(invoke).toHaveBeenCalledWith('gemini-ai', { method: 'POST', body: { mode: 'assistant', question: 'Next stop?' } })
    expect(res.answer).toBe('Next stop is Jorhat')
  })
})

describe('unmigrated operations', () => {
  // An empty result is indistinguishable on screen from "no trip" or "no
  // assignments". Throwing is what keeps an unavailable capability visible.
  it.each([
    ['myAssignment', () => (supabaseApi.myAssignment as () => unknown)()],
    ['ready', () => (supabaseApi.ready as () => unknown)()],
  ])('%s throws NotMigratedError instead of a plausible empty value', async (_name, call) => {
    await expect(async () => await call()).rejects.toThrowError(NotMigratedError)
  })
})

describe('the route packages and roadside services', () => {
  // These are served by the hosted intelligence plane. When unreachable or
  // unconfigured, they throw IntelligenceUnavailableError rather than returning
  // empty collections.
  it.each([
    ['offlinePackage', () => (supabaseApi.offlinePackage as () => unknown)()],
    ['navigationPackage', () => (supabaseApi.navigationPackage as () => unknown)()],
    [
      'places',
      () =>
        (supabaseApi.places as (q: any) => unknown)({
          category: 'HOTEL',
          south: 25,
          west: 90,
          north: 27,
          east: 93,
          anchor: 'MAP_AREA',
        }),
    ],
  ])('%s refuses rather than returning an empty package', async (_name, call) => {
    // EXPO_PUBLIC_INTELLIGENCE_BASE_URL is unset under test, so this exercises
    // the "not configured" branch specifically.
    await expect(async () => await call()).rejects.toThrowError(
      IntelligenceUnavailableError,
    )
  })

  it('names the reason so the screen can say which capability is missing', async () => {
    await expect(
      (supabaseApi.offlinePackage as () => Promise<unknown>)(),
    ).rejects.toMatchObject({ reason: 'not configured' })
  })
})

describe('login and driver identity', () => {
  it('normalizes 10-digit phone to canonical @driver.ner.local email', async () => {
    signInWithPassword.mockResolvedValue({
      data: {
        session: { access_token: 'tok-1', refresh_token: 'ref-1', expires_in: 3600 },
        user: { id: 'u1', email: '9430000777@driver.ner.local' },
      },
      error: null,
    })
    maybeSingle.mockResolvedValue({
      data: { id: 'u1', role: 'DRIVER', display_name: 'Driver One', is_active: true },
      error: null,
    })

    const res = await supabaseApi.login('9430000777', '  secretPass123  ')
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: '9430000777@driver.ner.local',
      password: 'secretPass123',
    })
    expect(res.access_token).toBe('tok-1')
    expect(res.user.role).toBe('DRIVER')
  })

  it('normalizes +91 country code in phone input', async () => {
    signInWithPassword.mockResolvedValue({
      data: {
        session: { access_token: 'tok-2', refresh_token: null, expires_in: 3600 },
        user: { id: 'u2', email: '9430000777@driver.ner.local' },
      },
      error: null,
    })
    maybeSingle.mockResolvedValue({
      data: { id: 'u2', role: 'DRIVER', display_name: 'Driver Two', is_active: true },
      error: null,
    })

    await supabaseApi.login('+91 94300 00777', 'pass')
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: '9430000777@driver.ner.local',
      password: 'pass',
    })
  })

  it('rejects inactive user with ACCOUNT_DISABLED', async () => {
    signInWithPassword.mockResolvedValue({
      data: {
        session: { access_token: 'tok-3', refresh_token: null, expires_in: 3600 },
        user: { id: 'u3' },
      },
      error: null,
    })
    maybeSingle.mockResolvedValue({
      data: { id: 'u3', role: 'DRIVER', is_active: false },
      error: null,
    })

    await expect(supabaseApi.login('9430000777', 'pass')).rejects.toThrow(
      /This driver account is inactive/,
    )
    expect(signOut).toHaveBeenCalled()
  })

  it('rejects non-driver role with NO_DRIVER_PROFILE', async () => {
    signInWithPassword.mockResolvedValue({
      data: {
        session: { access_token: 'tok-4', refresh_token: null, expires_in: 3600 },
        user: { id: 'u4' },
      },
      error: null,
    })
    maybeSingle.mockResolvedValue({
      data: { id: 'u4', role: 'MANAGER', is_active: true },
      error: null,
    })

    await expect(supabaseApi.login('demo.manager@fleet.example', 'pass')).rejects.toThrow(
      /no driver profile is assigned/,
    )
    expect(signOut).toHaveBeenCalled()
  })

  it('rejects suspended driver status on me()', async () => {
    single.mockResolvedValue({
      data: { id: 'd1', full_name: 'Driver', status: 'SUSPENDED' },
      error: null,
    })

    await expect(supabaseApi.me()).rejects.toThrow(/This driver account is inactive/)
  })
})
