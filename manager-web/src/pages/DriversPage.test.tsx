/**
 * The driver list must never present a driver as more usable than they are.
 *
 * `drivers.status` and the login behind the driver are separate facts, and the
 * list showed only the first. A driver whose account cannot sign in still read
 * AVAILABLE, so a manager would pick them, dispatch, and produce a trip that
 * can never be started - the driver is refused at login, so the start endpoint
 * is never reached and the truck stays held.
 *
 * These tests assert the honest rendering, not the styling: what a manager can
 * READ off the row, in words rather than colour.
 */

// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type Driver } from '../api/client'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 'u1',
      role: 'MANAGER' as const,
      display_name: 'Test Manager',
      email: 'm@example.com',
      phone: null,
    },
    isInitialising: false,
    logout: vi.fn(),
    can: () => true,
  }),
}))

import DriversPage from './DriversPage'

function driver(over: Partial<Driver> = {}): Driver {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    user_id: 'u2',
    full_name: 'Bipul Das',
    phone: '9435012345',
    photo_url: null,
    licence_number: 'AS-1234',
    licence_expiry: '2030-01-01',
    status: 'AVAILABLE',
    login_is_active: true,
    created_at: new Date().toISOString(),
    ...over,
  }
}

describe('DriversPage login state', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(api, 'listAssignments').mockResolvedValue([
      { id: 'a1', driver_id: '22222222-2222-4222-8222-222222222222', truck_id: 't1', status: 'ACTIVE', assigned_at: '', verified_at: null, mismatch_flagged: false, ended_at: null },
    ])
    vi.spyOn(api, 'listTrucks').mockResolvedValue({
      items: [{ id: 't1', registration_number: 'AS86QQ7606', truck_type: null, make: null, model: null, max_capacity_kg: '16000', current_load_kg: '0', status: 'AVAILABLE', baseline_mileage_kmpl: null, created_at: '' }],
      next_cursor: null,
    })
    vi.spyOn(api, 'listTrips').mockResolvedValue({ items: [], next_cursor: null })
    vi.spyOn(api, 'driverDocuments').mockResolvedValue([])
  })
  afterEach(cleanup)

  it('opens a driver PROFILE from the row - never the driver app, never a bare Deactivate', async () => {
    vi.spyOn(api, 'listDrivers').mockResolvedValue({ items: [driver()], next_cursor: null })
    const support = vi.spyOn(api, 'supportSession')
    const open = vi.fn()
    vi.stubGlobal('open', open)

    render(<DriversPage />)
    await screen.findByText('Bipul Das')
    expect(screen.queryByRole('button', { name: /view as driver/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^deactivate$/i })).toBeNull()
    // The pairing is readable off the row.
    expect(screen.getByText('AS86QQ7606')).toBeDefined()

    screen.getByRole('button', { name: /view profile/i }).click()
    const dialog = await screen.findByRole('dialog', { name: /bipul das/i })
    expect(dialog.textContent).toContain('9435012345')
    expect(dialog.textContent).toContain('AS-1234')
    expect(dialog.textContent).toContain('AS86QQ7606')
    expect(dialog.textContent).toContain('No open trip')
    // Nothing from inside the driver's app, and no app opened.
    expect(dialog.textContent).not.toMatch(/assistant|translator|navigate/i)
    expect(open).not.toHaveBeenCalled()
    expect(support).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('marks a driver whose login is inactive as not dispatchable', async () => {
    vi.spyOn(api, 'listDrivers').mockResolvedValue({
      items: [driver({ login_is_active: false })],
      next_cursor: null,
    })

    render(<DriversPage />)

    // The operational status is still shown - the driver has not been
    // suspended, and pretending otherwise would be its own lie.
    expect(await screen.findByText('AVAILABLE')).toBeDefined()
    // ...but it is no longer the whole story.
    expect(screen.getByText('LOGIN INACTIVE')).toBeDefined()
    expect(screen.getByText('Cannot be dispatched')).toBeDefined()
  })

  it('says nothing extra about a driver who can sign in', async () => {
    vi.spyOn(api, 'listDrivers').mockResolvedValue({
      items: [driver()],
      next_cursor: null,
    })

    render(<DriversPage />)

    expect(await screen.findByText('AVAILABLE')).toBeDefined()
    await waitFor(() =>
      expect(screen.queryByText('LOGIN INACTIVE')).toBeNull(),
    )
    expect(screen.queryByText('Cannot be dispatched')).toBeNull()
  })
})
