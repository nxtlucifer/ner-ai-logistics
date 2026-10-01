// @vitest-environment jsdom
/**
 * The directory pages' shared pieces: a shut action says so to assistive
 * technology as well as by colour, a busy one does not claim to be refused,
 * and a boxless error keeps ErrorState's words (a 403 never offers a retry).
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { ApiError } from '../api/client'
import { ActionButton, InlineError, PageHeader } from './pageKit'

afterEach(cleanup)

it('marks a shut action disabled AND aria-disabled, and a busy one only disabled', () => {
  render(
    <>
      <ActionButton disabled title="Why it is shut">Shut</ActionButton>
      <ActionButton busy>Working</ActionButton>
      <ActionButton>Open</ActionButton>
    </>,
  )
  const shut = screen.getByRole('button', { name: 'Shut' }) as HTMLButtonElement
  expect(shut.disabled).toBe(true)
  expect(shut.getAttribute('aria-disabled')).toBe('true')
  expect(shut.title).toBe('Why it is shut')
  const busy = screen.getByRole('button', { name: 'Working' }) as HTMLButtonElement
  expect(busy.disabled).toBe(true)
  expect(busy.getAttribute('aria-disabled')).toBeNull()
  expect(busy.getAttribute('aria-busy')).toBe('true')
  expect((screen.getByRole('button', { name: 'Open' }) as HTMLButtonElement).disabled).toBe(false)
})

it('words a refusal as ErrorState does, without a retry for a 403', () => {
  const retry = vi.fn()
  render(<InlineError what="Drivers could not be loaded" error={new ApiError(403, { error: { code: 'FORBIDDEN', message: 'No access to drivers' } } as never, 'fallback')} onRetry={retry} />)
  const alert = screen.getByRole('alert')
  expect(alert.textContent).toContain('Drivers could not be loaded')
  expect(alert.textContent).toContain('Not permitted. No access to drivers')
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
})

it('offers a retry for a failure that can pass', () => {
  const retry = vi.fn()
  render(<InlineError error={new Error('boom')} onRetry={retry} />)
  screen.getByRole('button', { name: 'Try again' }).click()
  expect(retry).toHaveBeenCalledTimes(1)
})

it('puts one h1 in the header, with the meta line and the note', () => {
  render(<PageHeader title="Drivers" meta="Who can drive" actions={<button>Add</button>} note="Why Add is shut" />)
  expect(screen.getByRole('heading', { level: 1, name: 'Drivers' })).toBeDefined()
  expect(screen.getByTestId('page-meta').textContent).toBe('Who can drive')
  expect(screen.getByText('Why Add is shut')).toBeDefined()
})
