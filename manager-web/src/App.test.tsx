// @vitest-environment jsdom
/**
 * A screen the signed-in role cannot use is never mounted - arriving at its
 * URL directly lands on the first screen that role CAN use, instead of a page
 * whose every request 403s.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const role = vi.hoisted(() => ({ permissions: new Set<string>() }))

vi.mock('./auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: { id: 'u', role: 'X', display_name: 'U', email: null, phone: null },
    isInitialising: false,
    logout: vi.fn(),
    can: (p: string) => role.permissions.has(p),
  }),
}))
vi.mock('./api/connectivity', () => ({
  useConnectivity: () => ({ online: true, lastOkAt: null }),
  ageLabel: () => '',
}))
vi.mock('./pages/FleetPage', () => ({ default: () => <div>fleet-page</div> }))
vi.mock('./pages/TripsPage', () => ({ default: () => <div>trips-page</div> }))
vi.mock('./pages/DriversPage', () => ({ default: () => <div>drivers-page</div> }))
vi.mock('./pages/TrucksPage', () => ({ default: () => <div>trucks-page</div> }))
vi.mock('./pages/AssignmentsPage', () => ({ default: () => <div>assignments-page</div> }))
vi.mock('./pages/SystemPage', () => ({ default: () => <div>system-page</div> }))
vi.mock('./pages/ReviewPage', () => ({ default: () => <div>review-page</div> }))
vi.mock('./pages/LoginPage', () => ({ default: () => <div>login-page</div> }))

import App from './App'

afterEach(cleanup)

describe('route guards', () => {
  it('sends a reviewer who opens /drivers by URL to the first screen they can use', () => {
    role.permissions = new Set(['trip:read', 'route:read', 'route:review_authorize'])
    window.history.pushState({}, '', '/drivers')
    render(<App />)
    expect(screen.getByText('trips-page')).toBeTruthy()
    expect(screen.queryByText('drivers-page')).toBeNull()
    expect(window.location.pathname).toBe('/trips')
  })

  it('lets a manager open every workflow screen', () => {
    role.permissions = new Set(['fleet:location_read', 'trip:read', 'driver:read', 'truck:read', 'assignment:read', 'route:read'])
    window.history.pushState({}, '', '/assignments')
    render(<App />)
    expect(screen.getByText('assignments-page')).toBeTruthy()
  })
})
