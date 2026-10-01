// @vitest-environment jsdom
/**
 * On a transport where planning cannot be checked by the server (the hosted
 * Supabase target with no intelligence plane: P1R-15, RG-7) the planner is
 * closed and says why, before anything else - never a button that throws.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const REASON = 'Trip planning needs the RASTA API service.'
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  unavailableReason: (operation: string) => (operation === 'planTrip' ? REASON : null),
}))
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', role: 'MANAGER' as const, display_name: 'Test', email: null, phone: null },
    isInitialising: false,
    logout: vi.fn(),
    can: () => true,
  }),
}))
vi.mock('../components/FleetMap', () => ({ default: () => <div>Map loaded</div> }))

import { api } from '../api/client'
import TripsPage from './TripsPage'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the planner on a transport that cannot check geography', () => {
  it('is disabled with the reason, whatever the form holds', async () => {
    vi.spyOn(api, 'listTrips').mockResolvedValue({ items: [], next_cursor: null })
    vi.spyOn(api, 'listDrivers').mockResolvedValue({ items: [], next_cursor: null })
    vi.spyOn(api, 'listTrucks').mockResolvedValue({ items: [], next_cursor: null })
    vi.spyOn(api, 'listAssignments').mockResolvedValue([])
    const planTrip = vi.spyOn(api, 'planTrip')
    render(<TripsPage />)
    const create = (await screen.findByRole('button', { name: /create draft trip/i })) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    expect(screen.getByTestId('plan-blocker').textContent).toBe(REASON)
    expect(create.getAttribute('aria-describedby')).toBe('plan-blocker')
    expect(planTrip).not.toHaveBeenCalled()
  })
})
