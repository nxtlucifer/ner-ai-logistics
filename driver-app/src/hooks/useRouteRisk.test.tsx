// @vitest-environment jsdom
/**
 * The shared risk read never invents an assessment.
 *
 * Live wins. When live fails, the stored package's assessment is shown ONLY
 * for the same trip and ONLY labelled STALE with its capture time; any other
 * failure is UNAVAILABLE, and 404/409 stay the states they are.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true })
})

const routeRisk = vi.fn()
const stored = vi.fn()

vi.mock('../api/client', () => ({
  api: { routeRisk: (...a: unknown[]) => routeRisk(...a) },
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, _body: unknown = null, fallback = `http ${status}`) {
      super(fallback)
      this.status = status
    }
  },
}))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }))
vi.mock('../offline/packageStore', () => ({
  OfflinePackageStore: class {
    read() {
      return stored()
    }
  },
}))

import { ApiError } from '../api/client'
import { useRouteRisk, type RouteRiskRead } from './useRouteRisk'

const RISK = {
  score: 35,
  band: 'MODERATE',
  components: [],
  inputs: { weather: 'AVAILABLE' },
  unavailable: [],
  reason_codes: [],
  observations_used: 5,
  observations_stale: 0,
  assessed_at: '2026-09-11T09:00:00Z',
}

let latest: RouteRiskRead | null = null
function Probe({ tripId }: { tripId: string | null }) {
  latest = useRouteRisk('route-1', tripId)
  return null
}

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => {})
}

describe('useRouteRisk', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  beforeEach(() => {
    latest = null
    routeRisk.mockReset()
    stored.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
  })

  const mount = async (tripId: string | null = 'trip-1') => {
    await act(async () => root?.render(createElement(Probe, { tripId })))
    await flush()
  }

  it('reads live and is READY', async () => {
    routeRisk.mockResolvedValue(RISK)
    await mount()
    expect(latest?.state).toBe('READY')
    expect(latest?.risk?.band).toBe('MODERATE')
    expect(stored).not.toHaveBeenCalled()
  })

  it('falls back to the stored package for the same trip, labelled STALE', async () => {
    routeRisk.mockRejectedValue(new TypeError('Failed to fetch'))
    stored.mockResolvedValue({
      packageData: { trip_id: 'trip-1', risk: RISK, risk_captured_at: '2026-09-11T08:30:00Z' },
    })
    await mount()
    expect(latest?.state).toBe('STALE')
    expect(latest?.risk?.band).toBe('MODERATE')
    expect(latest?.capturedAt).toBe('2026-09-11T08:30:00Z')
  })

  it("refuses another trip's package - that road is not this road", async () => {
    routeRisk.mockRejectedValue(new TypeError('Failed to fetch'))
    stored.mockResolvedValue({
      packageData: { trip_id: 'trip-OLD', risk: RISK, risk_captured_at: '2026-09-11T08:30:00Z' },
    })
    await mount()
    expect(latest?.state).toBe('UNAVAILABLE')
    expect(latest?.risk).toBeNull()
  })

  it('keeps 404 and 409 as states, without touching the package', async () => {
    routeRisk.mockRejectedValue(new ApiError(409, null, 'http 409'))
    await mount()
    expect(latest?.state).toBe('NO_ROUTE')
    routeRisk.mockRejectedValue(new ApiError(404, null, 'http 404'))
    await mount('trip-2')
    expect(latest?.state).toBe('NO_TRIP')
    expect(stored).not.toHaveBeenCalled()
  })
})
