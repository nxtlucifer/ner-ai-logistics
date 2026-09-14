// @vitest-environment jsdom

import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type AddressSuggestions, type ResolvedAddress } from '../api/client'
import AddressPicker, { EMPTY_ENDPOINT, type EndpointValue } from './AddressPicker'

const mapState = vi.hoisted(() => ({
  maps: [] as Array<{
    options: { center: [number, number] }
    handlers: Record<string, (event: { lngLat: { lng: number; lat: number } }) => void>
    remove: ReturnType<typeof vi.fn>
  }>,
  markers: [] as Array<{
    setLngLat: ReturnType<typeof vi.fn>
    addTo: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
  }>,
}))

// WebGL is exercised in the browser; here the map boundary records the point
// actually requested and exposes click events to the real picker component.
vi.mock('./FleetMap', () => ({ NER_CENTRE: [92, 26], NER_ZOOM: 6, OSM_STYLE: {} }))
vi.mock('maplibre-gl', () => ({
  Map: vi.fn(function (options) {
    const map = {
      options,
      handlers: {} as Record<string, (event: { lngLat: { lng: number; lat: number } }) => void>,
      on: vi.fn((event: string, callback: (event: { lngLat: { lng: number; lat: number } }) => void) => {
        map.handlers[event] = callback
        return map
      }),
      remove: vi.fn(),
    }
    mapState.maps.push(map)
    return map
  }),
  Marker: vi.fn(function () {
    const marker = {
      setLngLat: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
      getLngLat: vi.fn(() => ({ lng: 93, lat: 27 })),
      remove: vi.fn(),
    }
    mapState.markers.push(marker)
    return marker
  }),
}))

const suggestion = { place_id: 'test-place', primary_text: 'Test address result', secondary_text: 'Synthetic fixture' }
const results: AddressSuggestions = {
  available: true, provider: 'GOOGLE', error: null, suggestions: [suggestion],
}
const resolved: ResolvedAddress = {
  place_id: suggestion.place_id, address: 'Resolved test address', lat: 26.15, lon: 91.74, attribution: 'Google',
}
const swapped: EndpointValue = {
  address: 'Swapped endpoint', lat: '27', lon: '94', source: 'MAP', attribution: null,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function Harness({ initial = EMPTY_ENDPOINT, onChange = () => {} }: {
  initial?: EndpointValue
  onChange?: (value: EndpointValue) => void
}) {
  const [value, setValue] = useState(initial)
  return <>
    <AddressPicker label="Origin" name="origin" value={value} onChange={(next) => { setValue(next); onChange(next) }} />
    <button type="button" onClick={() => setValue(swapped)}>Swap endpoint</button>
  </>
}

async function searchFor(query = 'Test address') {
  fireEvent.change(screen.getByRole('combobox'), { target: { value: query } })
  await act(() => vi.advanceTimersByTimeAsync(700))
}

async function startDetails() {
  const pending = deferred<ResolvedAddress>()
  vi.spyOn(api, 'resolveAddress').mockReturnValue(pending.promise)
  await searchFor()
  fireEvent.click(screen.getByRole('option', { name: /Test address result/ }))
  expect(api.resolveAddress).toHaveBeenCalledOnce()
  return pending
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(api, 'addressSuggestions').mockResolvedValue(results)
  mapState.maps.length = 0
  mapState.markers.length = 0
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('AddressPicker request ownership', () => {
  it.each(['resolve', 'reject'] as const)('ignores a late suggestion %s after shortening below the search minimum', async (outcome) => {
    const pending = deferred<AddressSuggestions>()
    vi.mocked(api.addressSuggestions).mockReturnValue(pending.promise)
    render(<Harness />)
    await searchFor()
    const signal = vi.mocked(api.addressSuggestions).mock.calls[0][2]
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Te' } })
    expect(signal?.aborted).toBe(true)
    await act(async () => {
      if (outcome === 'resolve') pending.resolve(results)
      else pending.reject(new Error('Old provider failure'))
    })
    expect(screen.queryByRole('option')).toBeNull()
    expect(screen.queryByText(/Address search is unavailable/)).toBeNull()
    expect(screen.queryByText('Searching…')).toBeNull()
  })

  it('does not display suggestions from the previous query while the new query is debouncing', async () => {
    render(<Harness />)
    await searchFor()
    expect(screen.getByRole('option')).toBeDefined()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Different destination' } })
    expect(screen.queryByRole('option')).toBeNull()
  })

  it.each(['edit', 'manual', 'swap', 'map', 'escape'] as const)('a late address resolution cannot override %s intent', async (intent) => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const pending = await startDetails()
    if (intent === 'edit') fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Edited destination' } })
    if (intent === 'manual') {
      fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
      fireEvent.change(screen.getByRole('textbox', { name: 'Latitude' }), { target: { value: '28' } })
    }
    if (intent === 'swap') fireEvent.click(screen.getByRole('button', { name: 'Swap endpoint' }))
    if (intent === 'map') fireEvent.click(screen.getByRole('button', { name: 'Choose on map' }))
    if (intent === 'escape') fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    const changesBeforeLateResult = onChange.mock.calls.length
    const addressBeforeLateResult = (screen.getByRole('combobox') as HTMLInputElement).value
    await act(async () => pending.resolve(resolved))
    expect(onChange).toHaveBeenCalledTimes(changesBeforeLateResult)
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe(addressBeforeLateResult)
    expect(screen.queryByText(/From address search/)).toBeNull()
  })

  it('ignores a rejected details call after editing and preserves the current search state', async () => {
    render(<Harness />)
    const pending = await startDetails()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
    await act(async () => pending.reject(new Error('Old details request failed')))
    expect(screen.queryByText(/Address search is unavailable/)).toBeNull()
    expect(screen.queryByText('Searching…')).toBeNull()
  })

  it('does not invoke its owner when details arrive after unmount', async () => {
    const onChange = vi.fn()
    const view = render(<Harness onChange={onChange} />)
    const pending = await startDetails()
    onChange.mockClear()
    view.unmount()
    await act(async () => pending.resolve(resolved))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('starts a fresh billing session when a new search follows an outstanding details call', async () => {
    render(<Harness />)
    const pending = await startDetails()
    const firstSession = vi.mocked(api.resolveAddress).mock.calls[0][1]
    await searchFor('Another destination')
    const nextSession = vi.mocked(api.addressSuggestions).mock.calls.at(-1)?.[1]
    expect(nextSession).not.toBe(firstSession)
    await act(async () => pending.resolve(resolved))
  })

  it('resolves the active selection and invalidates its coordinate when the address is edited', async () => {
    render(<Harness />)
    const pending = await startDetails()
    await act(async () => pending.resolve(resolved))
    expect(screen.getByTestId('origin-confirmed').textContent).toContain('From address search · 26.15000, 91.74000')
    await act(() => vi.advanceTimersByTimeAsync(700))
    expect(screen.queryByRole('option')).toBeNull()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Changed after selection' } })
    expect(screen.queryByTestId('origin-confirmed')).toBeNull()
    expect(screen.getByText(/No location set yet/)).toBeDefined()
  })

  it('selects the last suggestion when ArrowUp is pressed from an unhighlighted list', async () => {
    vi.spyOn(api, 'resolveAddress').mockResolvedValue(resolved)
    render(<Harness />)
    await searchFor()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    await act(async () => {})
    expect(api.resolveAddress).toHaveBeenCalledWith(suggestion.place_id, expect.any(String))
    expect(screen.getByTestId('origin-confirmed').textContent).toContain('From address search')
  })
})

describe('AddressPicker coordinates and map dialog', () => {
  it.each([
    { lat: '26', lon: '' },
    { lat: '26', lon: ' ' },
    { lat: '91', lon: '92' },
    { lat: '26', lon: '181' },
    { lat: 'not a number', lon: '92' },
  ])('never presents an incomplete or invalid manual pair as a confirmed location: %j', (coordinates) => {
    render(<Harness initial={{ ...EMPTY_ENDPOINT, ...coordinates, source: 'MANUAL' }} />)
    expect(screen.queryByTestId('origin-confirmed')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Choose on map' }))
    expect(mapState.markers[0].setLngLat).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Use this point' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps Google coordinates off the manual OpenStreetMap picker', () => {
    render(<Harness initial={{ address: resolved.address, lat: '26.15', lon: '91.74', source: 'GOOGLE', attribution: 'Google' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose on map' }))
    expect(mapState.markers[0].setLngLat).not.toHaveBeenCalled()
    expect(mapState.maps[0].options.center).toEqual([92, 26])
  })

  it('traps keyboard focus, closes with Escape, restores the trigger and disposes map resources', () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Choose on map' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog')
    const close = screen.getByRole('button', { name: 'Close' })
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancel)
    fireEvent.keyDown(cancel, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    screen.getByRole('button', { name: 'Swap endpoint' }).focus()
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(close, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(mapState.maps[0].remove).toHaveBeenCalledOnce()
    expect(mapState.markers[0].remove).toHaveBeenCalledOnce()
  })

  it('confirms the point the manager actually clicked and preserves their address', () => {
    const onChange = vi.fn()
    render(<Harness initial={{ ...EMPTY_ENDPOINT, address: 'Test loading gate' }} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose on map' }))
    act(() => mapState.maps[0].handlers.click({ lngLat: { lng: 93, lat: 27 } }))
    fireEvent.click(screen.getByRole('button', { name: 'Use this point' }))
    expect(onChange).toHaveBeenLastCalledWith({ address: 'Test loading gate', lat: '27', lon: '93', source: 'MAP', attribution: '© OpenStreetMap contributors' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('origin-confirmed').textContent).toContain('Pinned on map · 27.00000, 93.00000')
  })

  it('drops a confirmed pin when the address text is edited, so words and point never diverge', () => {
    const onChange = vi.fn()
    render(<Harness initial={{ address: 'Old gate', lat: '27', lon: '93', source: 'MAP', attribution: '© OpenStreetMap contributors' }} onChange={onChange} />)
    expect(screen.getByTestId('origin-confirmed').textContent).toContain('Old gate')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Guwahati' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_ENDPOINT, address: 'Guwahati' })
    expect(screen.queryByTestId('origin-confirmed')).toBeNull()
    expect(screen.getByText(/No location set yet/)).toBeDefined()
  })
})

describe('AddressPicker Google Maps link resolution', () => {
  it('toggles the paste link panel open and closed', () => {
    render(<Harness />)
    expect(screen.queryByTestId('origin-link-panel')).toBeNull()
    const toggleBtn = screen.getByTestId('origin-paste-link-button')
    fireEvent.click(toggleBtn)
    expect(screen.getByTestId('origin-link-panel')).toBeDefined()
    fireEvent.click(toggleBtn)
    expect(screen.queryByTestId('origin-link-panel')).toBeNull()
  })

  it('resolves a direct coordinates link locally without calling resolveMapLink', async () => {
    const spyResolve = vi.spyOn(api, 'resolveMapLink')
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(screen.getByTestId('origin-paste-link-button'))
    const input = screen.getByTestId('origin-link-input')
    fireEvent.change(input, { target: { value: 'https://maps.google.com/?q=26.1445,91.7362' } })
    fireEvent.click(screen.getByTestId('origin-resolve-link-button'))
    await act(async () => {})
    expect(spyResolve).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      lat: '26.1445',
      lon: '91.7362',
      source: 'GOOGLE_MAPS_LINK',
      attribution: 'Google Maps',
    }))
    expect(screen.queryByTestId('origin-link-panel')).toBeNull()
    expect(screen.getByTestId('origin-confirmed').textContent).toContain('From Google Maps link · 26.14450, 91.73620')
  })

  it('resolves a short link via api.resolveMapLink', async () => {
    const spyResolve = vi.spyOn(api, 'resolveMapLink').mockResolvedValue({
      latitude: 26.1512,
      longitude: 91.7456,
      label: 'Guwahati Depot',
      normalized_url: 'https://www.google.com/maps/place/Guwahati+Depot/@26.1512,91.7456,17z',
      resolved_via: 'REDIRECT_FOLLOW',
    })
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(screen.getByTestId('origin-paste-link-button'))
    const input = screen.getByTestId('origin-link-input')
    fireEvent.change(input, { target: { value: 'https://maps.app.goo.gl/abc123xyz' } })
    fireEvent.click(screen.getByTestId('origin-resolve-link-button'))
    await act(async () => {})
    expect(spyResolve).toHaveBeenCalledWith('https://maps.app.goo.gl/abc123xyz')
    expect(onChange).toHaveBeenCalledWith({
      address: 'Guwahati Depot',
      lat: '26.1512',
      lon: '91.7456',
      source: 'GOOGLE_MAPS_LINK',
      attribution: 'Google Maps',
    })
    expect(screen.queryByTestId('origin-link-panel')).toBeNull()
  })

  it('shows error message if resolution fails', async () => {
    vi.spyOn(api, 'resolveMapLink').mockRejectedValue(new Error('Invalid short link or could not extract coordinates'))
    render(<Harness />)
    fireEvent.click(screen.getByTestId('origin-paste-link-button'))
    const input = screen.getByTestId('origin-link-input')
    fireEvent.change(input, { target: { value: 'https://maps.app.goo.gl/invalidlink' } })
    fireEvent.click(screen.getByTestId('origin-resolve-link-button'))
    await act(async () => {})
    expect(screen.getByText('Invalid short link or could not extract coordinates')).toBeDefined()
    expect(screen.getByTestId('origin-link-panel')).toBeDefined()
  })
})

