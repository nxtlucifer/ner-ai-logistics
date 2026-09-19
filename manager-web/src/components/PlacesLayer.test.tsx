// @vitest-environment jsdom
/**
 * A view wider than the server searches is never asked about: the server
 * answers 422 for it, which logged a console error per chip click. The layer
 * says the server's own words instead, and asks once the view is narrow.
 */

import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { usePlacesLayer } from './PlacesLayer'

vi.mock('maplibre-gl', () => ({ Marker: vi.fn(), Popup: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function view(south: number, west: number, north: number, east: number) {
  return {
    getBounds: () => ({ getSouth: () => south, getWest: () => west, getNorth: () => north, getEast: () => east }),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as MapLibreMap
}

it('does not ask the server about a view it would refuse, and asks about one it will answer', async () => {
  const ask = vi.spyOn(api, 'placesInArea').mockResolvedValue({ places: [], truncated: false, source: null, error: null } as never)

  // The browser proof's default Fleet view: 4.6 degrees tall, 7.0 wide.
  const fleetDefault = view(23.8816, 89.433, 28.4743, 96.4422)
  const wide = renderHook(() => usePlacesLayer(fleetDefault, 'FUEL'))
  expect(wide.result.current.notice).toBe('Zoom in to search this area - the map view is too wide.')
  expect(ask).not.toHaveBeenCalled()
  wide.unmount()

  // Exactly five degrees is still inside the server's limit.
  const fiveByFive = view(25, 90, 30, 95)
  renderHook(() => usePlacesLayer(fiveByFive, 'FUEL'))
  await waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
  expect(ask.mock.calls[0][1]).toEqual({ south: 25, west: 90, north: 30, east: 95 })
})
