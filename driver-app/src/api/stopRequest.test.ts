/**
 * The emergency stop request, over the wire.
 *
 * The RULES are the server's and are proved in
 * `backend/tests/test_driver_stop_request.py`. What this catches is the
 * failure that unit tests on the server can never see: the client sending a
 * field the server does not read. `request_id` is the one that matters - if
 * it were misspelled, every retry would look like a new emergency and a
 * driver on a bad connection would raise four.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

// The same mock set transport.test.ts uses: the client module reaches
// react-native and expo for platform details, none of which has anything to
// do with the shape of a request body.
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('expo-constants', () => ({ default: { expoConfig: null, expoGoConfig: null } }))
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED: 'WHEN_UNLOCKED',
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }))

const { api } = await import('./client')

type Captured = { url: string; body: Record<string, unknown> }

function captureFetch(): Captured[] {
  const calls: Captured[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) })
      return new Response(JSON.stringify({ trip: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestTripStop', () => {
  it('sends the reason and the idempotency id the server reads', async () => {
    const calls = captureFetch()
    await api.requestTripStop({
      requestId: '11111111-1111-4111-8111-111111111111',
      reason: 'Rock fall across the road just past the bridge',
      category: 'ROAD_BLOCKED',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/driver/me/trip/stop-request')
    expect(calls[0].body).toMatchObject({
      request_id: '11111111-1111-4111-8111-111111111111',
      reason: 'Rock fall across the road just past the bridge',
      category: 'ROAD_BLOCKED',
    })
  })

  it('repeats the same id on a retry, so one press stays one emergency', async () => {
    const calls = captureFetch()
    const once = {
      requestId: '22222222-2222-4222-8222-222222222222',
      reason: 'Engine temperature warning, pulling over now',
    }
    await api.requestTripStop(once)
    await api.requestTripStop(once)

    expect(calls.map((c) => c.body.request_id)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '22222222-2222-4222-8222-222222222222',
    ])
  })

  it('omits the position entirely when there is no fix', async () => {
    // Not `lat: null`: the server's schema would reject a null where it
    // expects a number, and a driver in a signal hole is the exact case
    // this request exists for.
    const calls = captureFetch()
    await api.requestTripStop({
      requestId: '33333333-3333-4333-8333-333333333333',
      reason: 'Road blocked by a landslide near the hairpin',
    })
    expect('lat' in calls[0].body).toBe(false)
    expect('lon' in calls[0].body).toBe(false)
    expect('fix_at' in calls[0].body).toBe(false)
  })

  it('sends a position, and when the phone took it, when there is one', async () => {
    const calls = captureFetch()
    await api.requestTripStop({
      requestId: '44444444-4444-4444-8444-444444444444',
      reason: 'Road blocked by a landslide near the hairpin',
      lat: 26.1445,
      lon: 91.7362,
      fixAt: '2026-09-27T04:34:00.000Z',
    })
    expect(calls[0].body).toMatchObject({ lat: 26.1445, lon: 91.7362, fix_at: '2026-09-27T04:34:00.000Z' })
  })
})
