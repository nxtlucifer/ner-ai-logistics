// @vitest-environment jsdom
/**
 * A screen the signed-in role cannot use is never mounted - arriving at its
 * URL directly lands on the first screen that role CAN use, instead of a page
 * whose every request 403s.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const role = vi.hoisted(() => ({ permissions: new Set<string>(), user: null as Record<string, unknown> | null, initialising: false, signedOut: false }))

vi.mock('./auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: role.signedOut ? null : role.user ?? { id: 'u', role: 'X', display_name: 'U', email: null, phone: null },
    isInitialising: role.initialising,
    logout: vi.fn(),
    can: (p: string) => role.permissions.has(p),
  }),
}))
vi.mock('./api/connectivity', () => ({
  useConnectivity: () => ({ online: true, lastOkAt: null }),
  ageLabel: () => '',
  getConnectivity: () => ({ online: true, lastOkAt: null }),
  subscribeConnectivity: () => () => {},
  readCache: () => null,
  writeCache: () => {},
  markOnline: () => {},
  markOffline: () => {},
}))
vi.mock('./pages/FleetPage', () => ({ default: () => <div>fleet-page</div> }))
vi.mock('./pages/TripsPage', () => ({ default: () => <div>trips-page</div> }))
vi.mock('./pages/DriversPage', () => ({ default: () => <div>drivers-page</div> }))
vi.mock('./pages/TrucksPage', () => ({ default: () => <div>trucks-page</div> }))
vi.mock('./pages/AssignmentsPage', () => ({ default: () => <div>assignments-page</div> }))
vi.mock('./pages/SystemPage', () => ({ default: () => <div>system-page</div> }))
vi.mock('./pages/ReviewPage', () => ({ default: () => <div>review-page</div> }))
vi.mock('./pages/LoginPage', () => ({ default: () => <div>login-page</div> }))
vi.mock('./pages/NotificationsPage', () => ({ default: () => <div>notifications-page</div> }))
vi.mock('./pages/StatesPage', () => ({ default: () => <div>states-page</div> }))
vi.mock('./pages/ManagersPage', () => ({ default: () => <div>managers-page</div> }))
vi.mock('./components/FleetMap', () => ({ default: () => null }))
// A chunk that never arrives (LAZY-1): the import rejects, as a dropped network does.
vi.mock('./pages/ReportsPage', () => {
  throw new TypeError('Failed to fetch dynamically imported module: /assets/ReportsPage.js')
})

import App, { scopeLabel } from './App'
import { api, type Emergency } from './api/client'

afterEach(() => { cleanup(); role.user = null; role.initialising = false; role.signedOut = false; vi.restoreAllMocks() })

describe('session gate', () => {
  it('says it is restoring the session instead of flashing the sign-in, then shows sign-in when there is none', () => {
    role.initialising = true
    role.signedOut = true
    const { rerender } = render(<App />)
    expect(screen.getByText('Restoring session…')).toBeTruthy()
    expect(screen.queryByText('login-page')).toBeNull()
    role.initialising = false
    rerender(<App />)
    expect(screen.getByText('login-page')).toBeTruthy()
  })
})

describe('route guards', () => {
  it('sends a reviewer who opens /drivers by URL to the first screen they can use', async () => {
    role.permissions = new Set(['trip:read', 'route:read', 'route:review_authorize'])
    window.history.pushState({}, '', '/drivers')
    render(<App />)
    // Pages are lazy chunks (PERF-1): the page arrives a tick later.
    expect(await screen.findByText('trips-page')).toBeTruthy()
    expect(screen.queryByText('drivers-page')).toBeNull()
    expect(window.location.pathname).toBe('/trips')
  })

  it('lets a manager open every workflow screen', async () => {
    role.permissions = new Set(['fleet:location_read', 'trip:read', 'driver:read', 'truck:read', 'assignment:read', 'route:read'])
    window.history.pushState({}, '', '/assignments')
    render(<App />)
    expect(await screen.findByText('assignments-page')).toBeTruthy()
  })

  // The nav hides States from a district manager (it holds trip:read, the
  // screen is not theirs); its URL must not open it either.
  it('sends a district manager who opens /states by URL to their Overview, and lets a regional role in', async () => {
    vi.spyOn(api, 'activeEmergencies').mockResolvedValue([])
    vi.spyOn(api, 'listRegions').mockResolvedValue([])
    role.permissions = new Set(DISTRICT_PERMS)
    role.user = { id: 'u', role: 'DISTRICT_MANAGER', display_name: 'U', email: null, phone: null, state_id: 's1', district_id: 'd1' }
    window.history.pushState({}, '', '/states')
    const { unmount } = render(<App />)
    expect(screen.queryByText('states-page')).toBeNull()
    expect(window.location.pathname).toBe('/overview')
    unmount()
    role.permissions = new Set([...MANAGER_PERMS, 'notification:read'])
    role.user = { id: 'u', role: 'NORTH_EAST_MANAGER', display_name: 'U', email: null, phone: null, state_id: null, district_id: null }
    window.history.pushState({}, '', '/states')
    render(<App />)
    expect(await screen.findByText('states-page')).toBeTruthy()
  })
})

/**
 * A driver's SOS reaches the manager on EVERY screen, not only on Fleet.
 */
describe('SOS badge', () => {
  it('shows the active count in the topbar, announces it, and links to Fleet', async () => {
    role.permissions = new Set(['trip:read', 'emergency:read'])
    vi.spyOn(api, 'activeEmergencies').mockResolvedValue([
      { id: 'e1', state: 'SOS_ESCALATED' },
      { id: 'e2', state: 'DRIVER_CHECK_REQUIRED' },
    ] as unknown as Emergency[])
    window.history.pushState({}, '', '/trips')
    render(<App />)
    // The name starts with the visible "SOS 2", so a voice command for it works.
    const badge = await screen.findByRole('link', { name: 'SOS 2: 2 active emergencies - open Fleet' })
    expect(badge.getAttribute('href')).toBe('/fleet')
    expect(badge.textContent).toContain('SOS 2')
    expect((await screen.findByText('2 active emergencies. Open Fleet to respond.')).getAttribute('aria-live')).toBe('assertive')
  })

  it('says the status is unknown when the poll fails, never "no SOS"', async () => {
    role.permissions = new Set(['trip:read', 'emergency:read'])
    vi.spyOn(api, 'activeEmergencies').mockRejectedValue(new Error('backend down'))
    window.history.pushState({}, '', '/trips')
    render(<App />)
    expect(await screen.findByRole('link', { name: /SOS status unknown/ })).toBeTruthy()
  })

  it('says it is still checking before the first answer, which is not "no SOS"', () => {
    role.permissions = new Set(['trip:read', 'emergency:read'])
    vi.spyOn(api, 'activeEmergencies').mockReturnValue(new Promise(() => {}))
    window.history.pushState({}, '', '/trips')
    render(<App />)
    expect(screen.getByText('Checking SOS…')).toBeTruthy()
  })

  it('names a count as last known once the latest check fails', async () => {
    role.permissions = new Set(['trip:read', 'emergency:read'])
    vi.spyOn(api, 'activeEmergencies')
      .mockResolvedValueOnce([{ id: 'e1', state: 'SOS_ESCALATED' }] as unknown as Emergency[])
      .mockRejectedValue(new Error('backend down'))
    window.history.pushState({}, '', '/trips')
    render(<App />)
    await screen.findByRole('link', { name: 'SOS 1: 1 active emergency - open Fleet' })
    // Coming back to the tab polls at once; this time the check fails.
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(await screen.findByRole('link', { name: 'SOS 1: 1 active emergency, last known - open Fleet' })).toBeTruthy()
  })

  it('does not poll, or show a badge, without emergency:read', () => {
    role.permissions = new Set(['trip:read'])
    const poll = vi.spyOn(api, 'activeEmergencies').mockResolvedValue([])
    window.history.pushState({}, '', '/trips')
    render(<App />)
    expect(poll).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: /SOS|emergenc/ })).toBeNull()
    expect(screen.queryByText(/Checking SOS/)).toBeNull()
  })
})

/**
 * The header says which fleet you are looking at.
 *
 * A console that reads identically for a district manager and a regional
 * one is a console where somebody eventually dispatches against the wrong
 * fleet. Hiding a nav link is about RELEVANCE, never security - every one
 * of these screens is enforced again by app/core/scope.py, and the IDOR
 * suite is what proves that.
 */
describe('scopeLabel', () => {
  it('names the region for the regional role', () => {
    expect(scopeLabel('NORTH_EAST_MANAGER')).toMatch(/North-East/)
    expect(scopeLabel('NORTH_EAST_MANAGER')).toMatch(/all states/)
  })

  it('names the state or district the account actually holds', () => {
    expect(scopeLabel('STATE_MANAGER', 'Assam')).toBe('Assam · state')
    expect(scopeLabel('DISTRICT_MANAGER', 'Assam', 'Kamrup Metropolitan')).toBe(
      'Kamrup Metropolitan · district',
    )
  })

  it('degrades to the bare scope rather than inventing a place', () => {
    expect(scopeLabel('STATE_MANAGER')).toBe('State')
    expect(scopeLabel('DISTRICT_MANAGER')).toBe('District')
  })

  it('keeps the pre-existing roles readable and never prints undefined', () => {
    expect(scopeLabel('ADMIN')).toBe('Administrator')
    expect(scopeLabel('MANAGER')).toBe('Fleet')
    expect(scopeLabel(undefined)).toBe('')
  })
})

describe('scope in the header', () => {
  it('names the state a state manager holds, not just "State"', async () => {
    role.permissions = new Set(['trip:read'])
    role.user = { id: 'u', role: 'STATE_MANAGER', display_name: 'U', email: null, phone: null, state_id: 's1', district_id: null }
    vi.spyOn(api, 'listRegions').mockResolvedValue([{ id: 's1', name: 'Meghalaya', slug: 'meghalaya', districts: [] }])
    window.history.pushState({}, '', '/trips')
    render(<App />)
    expect((await screen.findAllByText('Meghalaya · state')).length).toBeGreaterThan(0)
  })
})

describe('role-aware navigation', () => {
  it('offers the regional screens only to a regional role', () => {
    // A district manager holds driver:read, so permission alone would show
    // them "States & districts". It is not their screen.
    role.permissions = new Set(['trip:read', 'driver:read', 'manager_account:manage'])
    window.history.pushState({}, '', '/trips')
    render(<App />)
    expect(screen.queryByText('States & districts')).toBeNull()
  })
})

/**
 * Sidebar groups per role (audit 12, Shell). Permission sets mirror
 * backend/app/core/permissions.py: a nav item is rendered only when the role
 * holds its permission AND the screen is for that role.
 */
const MANAGER_PERMS = [
  'driver:read', 'driver:create', 'driver:update', 'driver:deactivate', 'driver:support_view',
  'truck:read', 'truck:create', 'truck:update', 'truck:retire',
  'assignment:read', 'assignment:create', 'assignment:end', 'assignment:review',
  'shipment:read', 'shipment:create',
  'trip:read', 'trip:create', 'trip:dispatch', 'trip:cancel', 'trip:close',
  'route:read', 'route:plan', 'route:select', 'fleet:location_read', 'audit:read',
  'emergency:read', 'emergency:resolve',
]
const SCOPED_WRITES = ['driver:update', 'driver:deactivate', 'driver:support_view', 'truck:update', 'truck:retire', 'assignment:create', 'assignment:end', 'assignment:review', 'emergency:resolve']
const DISTRICT_PERMS = [...MANAGER_PERMS.filter((p) => !SCOPED_WRITES.includes(p)), 'notification:read']
const ROLES: Record<string, { perms: string[]; groups: string[][] }> = {
  ADMIN: {
    perms: [...MANAGER_PERMS, 'notification:read', 'manager_account:manage', 'route:review_authorize', 'driver:read_sensitive'],
    groups: [['Overview', 'Fleet', 'Trips', 'Drivers', 'Trucks'], ['States & districts', 'Managers', 'Reports', 'Review', 'Notifications'], ['Diagnostics']],
  },
  MANAGER: {
    perms: MANAGER_PERMS,
    groups: [['Overview', 'Fleet', 'Trips', 'Drivers', 'Trucks'], ['States & districts', 'Reports'], ['Diagnostics']],
  },
  NORTH_EAST_MANAGER: {
    perms: [...MANAGER_PERMS, 'notification:read', 'manager_account:manage'],
    groups: [['Overview', 'Fleet', 'Trips', 'Drivers', 'Trucks'], ['States & districts', 'Managers', 'Reports', 'Notifications'], ['Diagnostics']],
  },
  STATE_MANAGER: {
    perms: [...DISTRICT_PERMS, 'manager_account:manage'],
    groups: [['Overview', 'Fleet', 'Trips', 'Drivers', 'Trucks'], ['Managers', 'Reports', 'Notifications'], ['Diagnostics']],
  },
  DISTRICT_MANAGER: {
    perms: DISTRICT_PERMS,
    groups: [['Overview', 'Fleet', 'Trips', 'Drivers', 'Trucks'], ['Reports', 'Notifications'], ['Diagnostics']],
  },
}

describe('sidebar per role', () => {
  for (const [name, { perms, groups }] of Object.entries(ROLES)) {
    it(`${name}: shows exactly its screens, in three divided groups`, async () => {
      role.permissions = new Set(perms)
      role.user = { id: 'u', role: name, display_name: 'Asha Das', email: null, phone: null, state_id: null, district_id: null }
      vi.spyOn(api, 'activeEmergencies').mockResolvedValue([])
      vi.spyOn(api, 'listRegions').mockResolvedValue([])
      window.history.pushState({}, '', '/trips')
      render(<App />)
      const nav = screen.getByRole('navigation', { name: 'Main navigation' })
      const drawn = [...nav.querySelectorAll('.nav-group')].map((g) => [...g.querySelectorAll('a')].map((a) => a.textContent))
      expect(drawn).toEqual(groups)
      // The region card states the scope; nothing offers to change it.
      expect(screen.queryByText(/change region/i)).toBeNull()
      expect(screen.getByText('Set by your account')).toBeTruthy()
      expect(screen.getByText('Welcome, Asha Das')).toBeTruthy()
      // The bell is there only for a role with an inbox.
      expect(!!document.querySelector('.topbar a[aria-label="Notifications"]')).toBe(perms.includes('notification:read'))
      await screen.findByText('trips-page')
    })
  }

  it('marks the page you are on as the active item', () => {
    role.permissions = new Set(MANAGER_PERMS)
    vi.spyOn(api, 'activeEmergencies').mockResolvedValue([])
    window.history.pushState({}, '', '/trips')
    render(<App />)
    const active = document.querySelectorAll('.nav-active')
    expect([...active].map((a) => a.textContent)).toEqual(['Trips'])
    expect(active[0].getAttribute('aria-current')).toBe('page')
  })
})

describe('sign out', () => {
  it('says it is working and cannot be pressed twice while the server answers (D8)', async () => {
    const { ProfileMenu } = await import('./components/ProfileMenu')
    const { fireEvent } = await import('@testing-library/react')
    const onSignOut = vi.fn(() => new Promise<void>(() => {}))
    render(<ProfileMenu name="Asha Das" role="State manager" onSignOut={onSignOut} />)
    fireEvent.click(screen.getByRole('button', { name: /Account menu/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    const busy = await screen.findByRole('button', { name: 'Signing out…' })
    expect(busy.hasAttribute('disabled')).toBe(true)
    fireEvent.click(busy)
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('does not print the role twice when the name is the role', async () => {
    const { ProfileMenu } = await import('./components/ProfileMenu')
    render(<ProfileMenu name="Regional Head" role="Regional head" onSignOut={() => {}} />)
    expect(screen.getAllByText(/Regional head/i)).toHaveLength(1)
  })
})

describe('phone menu', () => {
  // CSS folds the nav below 800px unless the rail is open (index.css); here
  // the state that drives it: the button, its state, and folding on arrival.
  it('opens the nav from Menu and folds it again once a screen is chosen (RESP-4)', async () => {
    role.permissions = new Set(MANAGER_PERMS)
    vi.spyOn(api, 'activeEmergencies').mockResolvedValue([])
    window.history.pushState({}, '', '/trips')
    render(<App />)
    const menu = screen.getByRole('button', { name: 'Menu' })
    const rail = document.querySelector('.rail-inner')!
    expect(menu.getAttribute('aria-expanded')).toBe('false')
    expect(menu.getAttribute('aria-controls')).toBe('main-nav rail-region')
    expect(document.getElementById('main-nav')).toBe(screen.getByRole('navigation', { name: 'Main navigation' }))
    expect(rail.classList.contains('menu-open')).toBe(false)

    fireEvent.click(menu)
    expect(menu.getAttribute('aria-expanded')).toBe('true')
    expect(rail.classList.contains('menu-open')).toBe(true)

    fireEvent.click(screen.getByRole('link', { name: 'Drivers' }))
    expect(await screen.findByText('drivers-page')).toBeTruthy()
    expect(menu.getAttribute('aria-expanded')).toBe('false')
    expect(rail.classList.contains('menu-open')).toBe(false)
    // The chosen link folded away with the menu; focus went to the page (MENU-1).
    expect(document.activeElement).toBe(document.getElementById('main-content'))

    // Back on the screen it was opened from, by a new navigation: still folded.
    fireEvent.click(menu)
    fireEvent.click(screen.getByRole('link', { name: 'Trips' }))
    expect(await screen.findByText('trips-page')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Drivers' }))
    expect(await screen.findByText('drivers-page')).toBeTruthy()
    expect(menu.getAttribute('aria-expanded')).toBe('false')
  })

  it('folds the open Menu on Escape and gives focus back to its button (MENU-2)', () => {
    role.permissions = new Set(MANAGER_PERMS)
    vi.spyOn(api, 'activeEmergencies').mockResolvedValue([])
    window.history.pushState({}, '', '/trips')
    render(<App />)
    const menu = screen.getByRole('button', { name: 'Menu' })
    fireEvent.click(menu)
    const link = screen.getByRole('link', { name: 'Drivers' })
    link.focus()
    fireEvent.keyDown(link, { key: 'Escape' })
    expect(menu.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(menu)
  })
})

describe('a page chunk that fails to load (LAZY-1)', () => {
  it('keeps the rail and topbar and says so in the page area', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    role.permissions = new Set([...MANAGER_PERMS, 'notification:read'])
    role.user = { id: 'u', role: 'NORTH_EAST_MANAGER', display_name: 'U', email: null, phone: null }
    vi.spyOn(api, 'activeEmergencies').mockResolvedValue([])
    window.history.pushState({}, '', '/reports')
    render(<App />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('This screen')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy()
    expect(screen.getByTestId('greeting')).toBeTruthy()
    // Another page opens normally: the failure belonged to Reports only.
    fireEvent.click(screen.getByRole('link', { name: 'Trips' }))
    expect(await screen.findByText('trips-page')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
