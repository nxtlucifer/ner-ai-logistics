// @vitest-environment jsdom
/**
 * The map dialog's module comes over the network when it is first asked for.
 * Until it arrives: a focused stand-in that Escape cancels. If it never does
 * (offline, a flaky link): a message, and the rest of the planner untouched -
 * not a blank console.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import AddressPicker, { EMPTY_ENDPOINT } from './AddressPicker'

const chunk = vi.hoisted(() => {
  let fail!: (error: Error) => void
  const arrived = new Promise<never>((_, no) => { fail = no })
  arrived.catch(() => {}) // failing before the import asks is not an unhandled rejection
  return { arrived, fail }
})
vi.mock('./MapPointPicker', () => chunk.arrived)

const settle = () => act(() => new Promise((done) => setTimeout(done, 0)))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('says so, and points at typed coordinates, when the map arrives but cannot start', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // MapLibre's own complaint on a machine without WebGL: no connection is at fault.
  vi.doMock('./MapPointPicker', () => ({
    default: () => { throw new Error('WebGL2 is required to display this map.') },
  }))
  render(<AddressPicker label="Origin" name="origin" value={EMPTY_ENDPOINT} onChange={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Choose on map' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Map could not start in this browser — enter coordinates under Advanced instead.')
  expect(screen.queryByRole('dialog')).toBeNull()
  vi.doMock('./MapPointPicker', () => chunk.arrived)
})

it('shows a focused stand-in, and a message instead of a blank console when the map never arrives', async () => {
  // React reports the error it caught; what the manager sees is under test.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  render(<>
    <AddressPicker label="Origin" name="origin" value={EMPTY_ENDPOINT} onChange={() => {}} />
    <input aria-label="Planner notes" defaultValue="half-filled" />
  </>)
  const trigger = screen.getByRole('button', { name: 'Choose on map' })

  fireEvent.click(trigger)
  const loading = screen.getByRole('dialog', { name: 'Loading map' })
  expect(loading.getAttribute('aria-modal')).toBe('true')
  expect(document.activeElement).toBe(loading)

  await act(async () => chunk.fail(new Error('Failed to fetch dynamically imported module')))
  expect((await screen.findByRole('alert')).textContent).toBe('Map could not load — check the connection.')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  expect((screen.getByRole('textbox', { name: 'Planner notes' }) as HTMLInputElement).value).toBe('half-filled')

  // The map's stylesheet failed with its chunk, and Vite asks for each one
  // only once: the next click puts the failed link back so it is fetched
  // again. A link still loading has no sheet either, and is left alone:
  // replacing it would strand the load waiting on it. (jsdom fetches
  // nothing; the real offline -> online retry is checked in a browser.)
  const missing = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/assets/mapSetup.css' })
  const pending = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/assets/pending.css' })
  document.head.append(missing, pending)
  missing.dispatchEvent(new Event('error'))

  // Asking again tries again (a failed lazy load is not remembered), and the
  // stand-in is cancellable while it waits.
  fireEvent.click(trigger)
  const again = document.head.querySelector('link[href="/assets/mapSetup.css"]')
  expect(again).not.toBeNull()
  expect(again).not.toBe(missing)
  expect(pending.isConnected).toBe(true)
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Loading map' }), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  await settle()
  again?.remove()
  pending.remove()
})

it('starts the download on hover and on focus, with no click, and only the click reloads a stale tab', async () => {
  // Fresh modules: the lazy map an earlier case left rejected would answer
  // the click without asking the network.
  vi.resetModules()
  const { reloadOnStaleChunk } = await import('../staleChunk')
  const { default: Picker } = await import('./AddressPicker')
  const reload = vi.fn()
  const win = Object.assign(new EventTarget(), {
    sessionStorage: window.sessionStorage,
    location: { reload },
    navigator: { onLine: true },
  })
  reloadOnStaleChunk(win as unknown as Window)
  // Each prefetch fails as it does on a stale tab: Vite's helper raises the
  // event while the load is still out, then the import rejects.
  const requested = vi.fn(async () => {
    win.dispatchEvent(new Event('vite:preloadError'))
    throw new Error('Failed to fetch dynamically imported module')
  })
  vi.doMock('./MapPointPicker', requested)
  render(<Picker label="Origin" name="origin" value={EMPTY_ENDPOINT} onChange={() => {}} />)
  const trigger = screen.getByRole('button', { name: 'Choose on map' })

  fireEvent.mouseEnter(trigger)
  await waitFor(() => expect(requested).toHaveBeenCalledTimes(1))
  fireEvent.focus(trigger)
  await waitFor(() => expect(requested).toHaveBeenCalledTimes(2))
  await settle()

  // Nobody asked for the map yet: no reload (the planner stays), no message.
  expect(reload).not.toHaveBeenCalled()
  expect(screen.queryByRole('alert')).toBeNull()

  // The click is somebody asking: the same stale tab reloads, once.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  fireEvent.click(trigger)
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  await settle()
  window.sessionStorage.clear()
})
