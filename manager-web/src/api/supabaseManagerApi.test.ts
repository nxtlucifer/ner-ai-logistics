import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabaseManagerApi, parseEwkbPoint, NotMigratedError } from './supabaseManagerApi'
import * as supabaseClient from './supabaseClient'

describe('supabaseManagerApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('throws NotMigratedError for operations not yet migrated', async () => {
    await expect(supabaseManagerApi.createDriver({})).rejects.toThrow(NotMigratedError)
    await expect(supabaseManagerApi.updateDriver('d-1', {})).rejects.toThrow(NotMigratedError)
    await expect(supabaseManagerApi.createTruck({})).rejects.toThrow(NotMigratedError)
    await expect(supabaseManagerApi.cancelTrip('t-1')).rejects.toThrow(NotMigratedError)
  })

  /**
   * These pin the property the atomicity work exists for: route mutation is
   * ONE server call. If someone reintroduces a client-side demote/promote pair
   * these fail, because the table builder would be reached and `rpc` would not.
   */
  describe('atomic route mutation', () => {
    function mockSupabase(rpc: ReturnType<typeof vi.fn>, selectedRow: unknown = null) {
      const from = vi.fn().mockReturnValue({
        select: () => ({
          eq: () => ({
            eq: () => ({ single: async () => ({ data: selectedRow, error: null }) }),
          }),
        }),
        update: () => {
          throw new Error('route mutation must not write through the table API')
        },
      })
      vi.spyOn(supabaseClient, 'getSupabase').mockReturnValue({ rpc, from } as any)
      return from
    }

    const ROW = {
      id: 'r-b',
      trip_id: 't-1',
      state: 'SELECTED',
      kind: 'PRIMARY',
      geometry: { coordinates: [[91, 26], [92, 26.5]] },
    }

    it('selects a route through select_route, in one call', async () => {
      const rpc = vi.fn().mockResolvedValue({ data: { outcome: 'APPLIED' }, error: null })
      mockSupabase(rpc, ROW)

      const route = await supabaseManagerApi.selectRoute('t-1', 'r-b')

      expect(rpc).toHaveBeenCalledTimes(1)
      expect(rpc).toHaveBeenCalledWith('select_route', {
        p_trip_id: 't-1',
        p_route_id: 'r-b',
        p_expected_route_id: null,
      })
      // Geometry is flipped to [lat, lon] for the map, as everywhere else.
      expect(route.geometry).toEqual([[26, 91], [26.5, 92]])
    })

    it('passes the expected route so a stale screen can be refused', async () => {
      const rpc = vi.fn().mockResolvedValue({ data: { outcome: 'APPLIED' }, error: null })
      mockSupabase(rpc, ROW)

      await supabaseManagerApi.selectRoute('t-1', 'r-b', 'r-a')

      expect(rpc).toHaveBeenCalledWith('select_route', {
        p_trip_id: 't-1',
        p_route_id: 'r-b',
        p_expected_route_id: 'r-a',
      })
    })

    it('accepts a reroute through accept_reroute, in one call', async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: {
          trip_id: 't-1',
          selected_route_id: 'r-b',
          selected_route_kind: 'EMERGENCY_BACKUP',
          previous_route_id: 'r-a',
        },
        error: null,
      })
      mockSupabase(rpc)

      const out = await supabaseManagerApi.acceptReroute('t-1', 'r-a', 'r-b')

      expect(rpc).toHaveBeenCalledTimes(1)
      expect(rpc).toHaveBeenCalledWith('accept_reroute', {
        p_trip_id: 't-1',
        p_from_route_id: 'r-a',
        p_to_route_id: 'r-b',
      })
      // Read from the server's answer. The old code returned a hardcoded
      // 'PRIMARY' here whatever the server had actually selected.
      expect(out.selected_route_kind).toBe('EMERGENCY_BACKUP')
      expect(out.previous_route_id).toBe('r-a')
    })

    it('reports a stale expectation as a 409 conflict, not a server fault', async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: {
          message: 'route changed elsewhere',
          code: '40001',
          details: '{"code":"STALE_ROUTE_REVISION"}',
        },
      })
      mockSupabase(rpc)

      await expect(supabaseManagerApi.selectRoute('t-1', 'r-b', 'r-a')).rejects.toMatchObject({
        status: 409,
        code: 'STALE_ROUTE_REVISION',
      })
    })

    it('reports a blocked route as a rule violation, not a conflict', async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: {
          message: 'route is blocked and cannot be selected',
          code: '55000',
          details: '{"code":"ROUTE_BLOCKED"}',
        },
      })
      mockSupabase(rpc)

      await expect(supabaseManagerApi.selectRoute('t-1', 'r-x')).rejects.toMatchObject({
        status: 422,
        code: 'ROUTE_BLOCKED',
      })
    })

    it('reports a forbidden caller as 403', async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'forbidden', code: '42501', details: '{"code":"FORBIDDEN"}' },
      })
      mockSupabase(rpc)

      await expect(supabaseManagerApi.acceptReroute('t-1', 'r-a', 'r-b')).rejects.toMatchObject({
        status: 403,
        code: 'FORBIDDEN',
      })
    })
  })

  it('delegates planTrip to public.plan_trip RPC', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        id: 't-123',
        trip_code: 'TRP-TEST',
        status: 'DRAFT',
      },
      error: null,
    })

    vi.spyOn(supabaseClient, 'getSupabase').mockReturnValue({
      rpc: mockRpc,
    } as any)

    const payload: any = {
      shipment: { client_name: 'Test Client', pickup: { lat: 26, lon: 91 }, destination: { lat: 26.5, lon: 92 } },
      trip: { trip_code: 'TRP-TEST', truck_id: 'truck-1', driver_id: 'driver-1' },
    }

    const result = await supabaseManagerApi.planTrip(payload)
    expect(mockRpc).toHaveBeenCalledWith('plan_trip', { p_payload: payload })
    expect(result.id).toBe('t-123')
    expect(result.status).toBe('DRAFT')
  })

  it('handles planTrip RPC errors gracefully', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Cargo weight exceeds truck capacity' },
    })

    vi.spyOn(supabaseClient, 'getSupabase').mockReturnValue({
      rpc: mockRpc,
    } as any)

    await expect(supabaseManagerApi.planTrip({} as any)).rejects.toThrow('Cargo weight exceeds truck capacity')
  })

  it('delegates dispatchTrip to public.dispatch_trip RPC', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        id: 't-123',
        status: 'ASSIGNED',
        dispatched_at: '2026-09-08T10:00:00Z',
      },
      error: null,
    })

    vi.spyOn(supabaseClient, 'getSupabase').mockReturnValue({
      rpc: mockRpc,
    } as any)

    const result = await supabaseManagerApi.dispatchTrip('t-123')
    expect(mockRpc).toHaveBeenCalledWith('dispatch_trip', { p_trip_id: 't-123' })
    expect(result.id).toBe('t-123')
    expect(result.status).toBe('ASSIGNED')
  })

  describe('parseEwkbPoint', () => {
    it('accurately decodes PostGIS EWKB Point with SRID into [lat, lon]', () => {
      // Guwahati EWKB Point (SRID 4326)
      const guwahatiHex = '0101000020E61000002CD49AE61DEF5640A245B6F3FD243A40'
      const pt1 = parseEwkbPoint(guwahatiHex)
      expect(pt1).not.toBeNull()
      expect(pt1![0]).toBeCloseTo(26.1445, 4)
      expect(pt1![1]).toBeCloseTo(91.7362, 4)

      // Jorhat EWKB Point (SRID 4326)
      const jorhatHex = '0101000020E61000007E8CB96B098D574000917EFB3AC03A40'
      const pt2 = parseEwkbPoint(jorhatHex)
      expect(pt2).not.toBeNull()
      expect(pt2![0]).toBeCloseTo(26.7509, 4)
      expect(pt2![1]).toBeCloseTo(94.2037, 4)
    })

    it('returns null on invalid or empty hex strings', () => {
      expect(parseEwkbPoint(null)).toBeNull()
      expect(parseEwkbPoint('')).toBeNull()
      expect(parseEwkbPoint('invalid-hex')).toBeNull()
      expect(parseEwkbPoint('010100')).toBeNull()
    })
  })
})
