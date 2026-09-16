/**
 * Tab never leaves an open dialog. The hosted keyboard walk found one empty
 * stop: Tab off the profile drawer's last control (the closed "Support &
 * danger zone" summary) parked focus on the document before wrapping. The
 * wrap now happens at the edges, in one helper every dialog shares.
 */

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, type Driver } from '../api/client'
import DriverProfileDrawer from './DriverProfileDrawer'
import { wrapTab } from './focusTrap'

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ can: () => true }) }))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('wrapTab', () => {
  function Fixture() {
    return (
      <div role="dialog" onKeyDown={(e) => wrapTab(e)}>
        <button>first</button>
        <input aria-label="middle" />
        <details><summary>last</summary><p>hidden until opened</p></details>
      </div>
    )
  }
  it('wraps Tab from the last control to the first, and Shift+Tab from the first to the last', () => {
    render(<Fixture />)
    const first = screen.getByText('first')
    const last = screen.getByText('last')
    last.focus()
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })
  it('leaves a Tab in the middle alone, so the browser moves focus normally', () => {
    render(<Fixture />)
    const middle = screen.getByLabelText('middle')
    middle.focus()
    const event = fireEvent.keyDown(middle, { key: 'Tab' })
    expect(event).toBe(true) // not defaultPrevented
    expect(document.activeElement).toBe(middle)
  })
})

describe('DriverProfileDrawer keyboard', () => {
  const driver: Driver = {
    id: 'd1', user_id: 'u1', full_name: 'Bipul Das', phone: '9435012345', photo_url: null,
    licence_number: 'AS-1234', licence_expiry: '2030-01-01', status: 'AVAILABLE', login_is_active: true, created_at: '',
  }
  it('Tab from the last control returns to Close; Shift+Tab from Close reaches the last control; Escape closes', () => {
    vi.spyOn(api, 'driverDocuments').mockResolvedValue([])
    const onClose = vi.fn()
    render(<DriverProfileDrawer driver={driver} trucks={[]} assignments={[]} trips={[]} onClose={onClose} onChanged={() => {}} />)
    const close = screen.getByRole('button', { name: /close driver profile/i })
    const last = screen.getByText(/Support & danger zone/)
    expect(document.activeElement).toBe(close) // opens on Close
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(close, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
