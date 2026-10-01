/**
 * Planning on the hosted Supabase transport: the server decides WHERE, and the
 * browser never routes (RG-7, P1R-15).
 *
 * public.plan_trip checks auth and existence, not the country or the
 * North-East, and the old planRoute called the public OSRM demo server from
 * the browser and, when that failed, stored a made-up Guwahati-Jorhat corridor
 * as the trip's route. Both now run on the intelligence plane or not at all.
 *
 * Moved from the reproduction red test
 * (.runtime/production/repro/routing-android/supabase_planroute_fabricated_fallback.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sb = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  getSession: vi.fn(),
}))
vi.mock('./supabaseClient', () => ({
  getSupabase: () => ({ from: sb.from, rpc: sb.rpc, auth: { getSession: sb.getSession } }),
  SUPABASE_URL: 'https://example.invalid',
  SUPABASE_PUBLISHABLE_KEY: 'test',
}))

const PLANE = 'https://intelligence.example.com'
const PLAN = {
  shipment: { client_name: 'Brahmaputra Traders', pickup: { lat: 26.1445, lon: 91.7362 }, destination: { lat: 23.8103, lon: 90.4125 } },
  trip: { trip_code: 'TRP-1', truck_id: 'truck-1', driver_id: 'driver-1' },
} as never

/** The transport as a build with (or without) a plane configured sees it. */
async function transport(plane: string) {
  vi.stubEnv('VITE_INTELLIGENCE_BASE_URL', plane)
  vi.resetModules()
  return import('./supabaseManagerApi')
}

const osrmCalls = () =>
  vi.mocked(fetch).mock.calls.map((c) => String(c[0])).filter((u) => u.includes('project-osrm.org'))

beforeEach(() => {
  sb.from.mockReset().mockImplementation((table: string) => {
    throw new Error(`the browser must not touch ${table} while planning`)
  })
  sb.rpc.mockReset().mockRejectedValue(new Error('public.plan_trip must not be called: it has no geography check'))
  sb.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'session-token' } } })
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('with no intelligence plane configured', () => {
  it('planRoute fabricates nothing: it refuses with ROUTING_UNAVAILABLE and writes nothing (RG-7)', async () => {
    const { supabaseManagerApi } = await transport('')
    await expect(supabaseManagerApi.planRoute('trip-1')).rejects.toMatchObject({ status: 503, code: 'ROUTING_UNAVAILABLE' })
    expect(sb.from).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(osrmCalls()).toEqual([])
  })

  it('planTrip refuses rather than calling public.plan_trip, which checks no geography (P1R-15)', async () => {
    const { supabaseManagerApi } = await transport('')
    const refusal = supabaseManagerApi.planTrip(PLAN)
    await expect(refusal).rejects.toMatchObject({ status: 503, code: 'PLANNING_UNAVAILABLE' })
    await expect(refusal).rejects.toThrow(/checks on the server that both places are in India.*Nothing was saved/)
    expect(sb.rpc).not.toHaveBeenCalled()
    expect(sb.from).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('names both as unavailable, so the planner and route buttons say why instead of throwing', async () => {
    const { UNAVAILABLE_OPERATIONS } = await transport('')
    expect(UNAVAILABLE_OPERATIONS.planTrip).toMatch(/RASTA API service/)
    expect(UNAVAILABLE_OPERATIONS.planRoute).toMatch(/RASTA API service/)
  })
})

describe('with the intelligence plane configured', () => {
  const answer = (status: number, body: unknown) =>
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

  it('planTrip goes to the plane, which checks the geography, as the signed-in user', async () => {
    const { supabaseManagerApi, UNAVAILABLE_OPERATIONS } = await transport(PLANE)
    expect(UNAVAILABLE_OPERATIONS.planTrip).toBeUndefined()
    answer(201, { id: 't-1', trip_code: 'TRP-1', status: 'DRAFT' })
    const trip = await supabaseManagerApi.planTrip(PLAN)
    expect(trip).toMatchObject({ id: 't-1', status: 'DRAFT' })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${PLANE}/api/trips/plan`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual(PLAN)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer session-token')
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it("passes the plane's geography refusal through with its code", async () => {
    const { supabaseManagerApi } = await transport(PLANE)
    answer(422, { error: { code: 'OUTSIDE_SUPPORTED_COUNTRY', message: 'This location is outside the currently supported country.', details: { field: 'destination' } } })
    await expect(supabaseManagerApi.planTrip(PLAN)).rejects.toMatchObject({
      status: 422,
      code: 'OUTSIDE_SUPPORTED_COUNTRY',
      details: { field: 'destination' },
    })
  })

  it('planRoute asks the plane for detailed routes and never calls a routing server itself', async () => {
    const { supabaseManagerApi } = await transport(PLANE)
    answer(201, { route: { id: 'r-1' }, provider: 'osrm', used_fallback: false, providers_attempted: ['osrm'] })
    const result = await supabaseManagerApi.planRoute('trip-1')
    expect(result.route.id).toBe('r-1')
    expect(vi.mocked(fetch).mock.calls.map((c) => String(c[0]))).toEqual([`${PLANE}/api/trips/trip-1/routes/recalculate?detailed=true`])
    expect(sb.from).not.toHaveBeenCalled()
  })

  it('an unreachable plane is ROUTING_UNAVAILABLE, and nothing is written from the browser (RG-7)', async () => {
    const { supabaseManagerApi } = await transport(PLANE)
    await expect(supabaseManagerApi.planRoute('trip-1')).rejects.toMatchObject({ status: 503, code: 'ROUTING_UNAVAILABLE' })
    expect(sb.from).not.toHaveBeenCalled()
    expect(osrmCalls()).toEqual([])
  })

  it("keeps the plane's own routing outage code", async () => {
    const { supabaseManagerApi } = await transport(PLANE)
    answer(503, { error: { code: 'ROUTING_UNAVAILABLE', message: 'No routing provider is reachable right now.' } })
    await expect(supabaseManagerApi.planRoute('trip-1')).rejects.toMatchObject({ status: 503, code: 'ROUTING_UNAVAILABLE', message: 'No routing provider is reachable right now.' })
  })
})
