// @vitest-environment jsdom
/**
 * LAZY-1: a page chunk that fails to load takes down the page area, never the
 * console. "Try again" loads the page again (a browser keeps a failed module
 * import for good), but not while offline; a render failure just re-renders.
 */
import { lazy, Suspense } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { RouteBoundary } from './RouteBoundary'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const chunkFailure = () =>
  lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/ReportsPage-x.js')))

function drawn(Page: React.ComponentType, reload = vi.fn()) {
  render(
    <div>
      <nav aria-label="Main navigation">rail</nav>
      <RouteBoundary reload={reload}>
        <Suspense fallback={<p>Loading…</p>}>
          <Page />
        </Suspense>
      </RouteBoundary>
    </div>,
  )
  return reload
}

it('shows a chunk that did not arrive in the page area, and reloads the page on Try again', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const reload = drawn(chunkFailure())
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('This screen could not be loaded')
  // The shell around the page is still there.
  expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(reload).toHaveBeenCalledTimes(1)
})

it('does not reload into the browser error page while offline', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const reload = drawn(chunkFailure())
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
  expect(reload).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('Still offline')
})

it('renders a page that failed while rendering again, without a reload', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let fail = true
  function Flaky() {
    if (fail) throw new Error('Cannot read properties of undefined')
    return <h1>Reports</h1>
  }
  const reload = drawn(Flaky)
  expect((await screen.findByRole('alert')).textContent).toContain('This screen failed')
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('heading', { name: 'Reports' })).toBeTruthy()
  expect(reload).not.toHaveBeenCalled()
})
