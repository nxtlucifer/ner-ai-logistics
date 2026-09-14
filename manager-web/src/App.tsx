/**
 * Manager application shell.
 *
 * Nothing here is decorative: every screen reads live API state, and a control
 * the current role cannot use is not rendered at all rather than shown disabled
 * or - worse - shown working and failing on click.
 */

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Activity, LayoutDashboard, LogOut, Route as RouteIcon, ShieldCheck, Truck, Users } from 'lucide-react'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'

import { ageLabel, useConnectivity } from './api/connectivity'

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
// One icon family (Lucide, 2px stroke) - the same grammar as the driver app's
// Feather set, so a truck or a shield reads the same in both products.
// Five operational screens. Driver-truck assignments live in the driver
// profile (and /assignments stays reachable as a record, linked from Trucks);
// Diagnostics is a secondary utility, rendered apart from the workflow.
const NAV = [
  { to: '/fleet', label: 'Fleet', permission: 'fleet:location_read', icon: LayoutDashboard, secondary: false },
  { to: '/trips', label: 'Trips', permission: 'trip:read', icon: RouteIcon, secondary: false },
  { to: '/drivers', label: 'Drivers', permission: 'driver:read', icon: Users, secondary: false },
  { to: '/trucks', label: 'Trucks', permission: 'truck:read', icon: Truck, secondary: false },
  { to: '/review', label: 'Review', permission: 'route:review_authorize', icon: ShieldCheck, secondary: false },
  { to: '/system', label: 'Diagnostics', permission: null, icon: Activity, secondary: true },
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

/**
 * The one place the console says it is offline. Pages keep their last-known
 * data underneath; this names the state and its age so nothing old reads as
 * live. Comes back on its own when the /health probe answers.
 */
function SyncBanner() {
  const { online, lastOkAt } = useConnectivity()
  const [, tick] = useState(0)
  useEffect(() => {
    if (online) return
    const t = setInterval(() => tick((n) => n + 1), 10_000)
    return () => clearInterval(t)
  }, [online])
  if (online) return null
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-4 border-b border-warning/40 bg-warning-soft px-4 py-2 text-xs font-medium text-warning"
    >
      <span>
        <strong className="uppercase tracking-wide">Offline</strong> · showing last known data
        {lastOkAt !== null ? ` · last synced ${ageLabel(lastOkAt)}` : ''} · reconnecting…
      </span>
    </div>
  )
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
            <img src="/brand-mark.svg" alt="" className="brand-mark" />
            <span className="brand-title">RASTA AI</span><span className="brand-caption">NER FLEET CONSOLE</span>
            {import.meta.env.DEV ? (
              <span className="ml-2 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                Dev
              </span>
            ) : null}
          </div>

          <nav aria-label="Main navigation" className="main-nav">
            {NAV.filter((item) => !item.secondary && (!item.permission || can(item.permission))).map(
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
                  <item.icon className="nav-icon" aria-hidden="true" />
                  {item.label}
                </NavLink>
              ),
            )}
          </nav>
          <nav aria-label="Utilities" className="main-nav mt-auto text-xs">
            {NAV.filter((item) => item.secondary && (!item.permission || can(item.permission))).map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : 'nav-idle'}`}>
                <item.icon className="nav-icon" aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="rail-account">
            <div className="min-w-0">
              <div className="account-name">
                {user?.display_name}
              </div>
              <div className="account-role">{user?.role}</div>
            </div>
            <Button variant="secondary" onClick={() => void logout()}>
              <LogOut className="nav-icon" aria-hidden="true" /> Sign out
            </Button>
          </div>
        </div>
      </header>
      <SyncBanner />

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
