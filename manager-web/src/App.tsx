/**
 * Manager application shell.
 *
 * Nothing here is decorative: every screen reads live API state, and a control
 * the current role cannot use is not rendered at all rather than shown disabled
 * or - worse - shown working and failing on click.
 */

import type { ReactNode } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'

import { AuthProvider, useAuth } from './auth/AuthProvider'
import { Button, LoadingState } from './components/ui'
import AssignmentsPage from './pages/AssignmentsPage'
import DriversPage from './pages/DriversPage'
import FleetPage from './pages/FleetPage'
import SystemPage from './pages/SystemPage'
import TripsPage from './pages/TripsPage'
import TrucksPage from './pages/TrucksPage'
import LoginPage from './pages/LoginPage'
import ReviewPage from './pages/ReviewPage'

// Fleet leads: it is the screen a dispatcher keeps open. A nav item whose
// permission the current role lacks is not rendered at all - never shown
// disabled, and never shown working and failing on click.
const NAV = [
  { to: '/fleet', label: 'Fleet', permission: 'fleet:location_read' },
  { to: '/trips', label: 'Trips', permission: 'trip:read' },
  { to: '/drivers', label: 'Drivers', permission: 'driver:read' },
  { to: '/trucks', label: 'Trucks', permission: 'truck:read' },
  { to: '/assignments', label: 'Assignments', permission: 'assignment:read' },
  { to: '/review', label: 'Review', permission: 'route:review_authorize' },
  { to: '/system', label: 'System', permission: null },
]

/**
 * Renders a screen only if the signed-in role can actually use it.
 *
 * Without this, signing in while sitting on a URL the new role lacks leaves
 * that screen mounted and 403ing on every request - which reads as a broken
 * system rather than as a permission the account does not hold. The nav
 * already hides such links; this covers arriving at the path directly.
 */
function Guarded({
  permission,
  home,
  children,
}: {
  permission: string
  home: string
  children: ReactNode
}) {
  const { can } = useAuth()
  if (!can(permission)) return <Navigate to={home} replace />
  return <>{children}</>
}

function Shell() {
  const { user, logout, can } = useAuth()
  const home =
    NAV.find((item) => !item.permission || can(item.permission))?.to ?? '/system'


  return (
    <div className="app-shell"><a className="skip-link" href="#main-content">Skip to workspace</a>
      <header className="app-rail">
        <div className="rail-inner">
          <div className="brand">
            <span className="brand-title">NER Fleet<br />Intelligence</span><span className="brand-caption">TERRAIN COMMAND</span>
            <span className="ml-2 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
              Dev
            </span>
          </div>

          <nav aria-label="Main navigation" className="main-nav">
            {NAV.filter((item) => !item.permission || can(item.permission)).map(
              (item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `nav-link ${
                      isActive
                        ? 'nav-active'
                        : 'nav-idle'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ),
            )}
          </nav>

          <div className="rail-account">
            <div className="min-w-0">
              <div className="account-name">
                {user?.display_name}
              </div>
              <div className="account-role">{user?.role}</div>
            </div>
            <Button variant="secondary" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" className="workspace">
        <Routes>
          <Route
            path="/fleet"
            element={<Guarded permission="fleet:location_read" home={home}><FleetPage /></Guarded>}
          />
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/drivers" element={<DriversPage />} />
          <Route path="/trucks" element={<TrucksPage />} />
          <Route path="/assignments" element={<AssignmentsPage />} />
          <Route path="/system" element={<SystemPage />} />
          <Route path="/review" element={<ReviewPage />} />
          {/* Land on the first screen this role can actually USE, not always
              /fleet. An authorised reviewer holds neither fleet:location_read
              nor route:select, so sending them to Fleet would render a page
              whose every request 403s - which teaches an operator the system
              is broken rather than that they lack a permission. */}
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
    </div>
  )
}

function Gate() {
  const { user, isInitialising } = useAuth()

  // Distinct from "logged out". Showing the login form during the silent
  // refresh would flash it on every page reload for an already-signed-in user.
  if (isInitialising) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <LoadingState label="Restoring session…" />
      </div>
    )
  }

  return user ? <Shell /> : <LoginPage />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  )
}
