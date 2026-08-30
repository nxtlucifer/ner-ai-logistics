/**
 * Manager application shell.
 *
 * Nothing here is decorative: every screen reads live API state, and a control
 * the current role cannot use is not rendered at all rather than shown disabled
 * or - worse - shown working and failing on click.
 */

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

// Fleet leads: it is the screen a dispatcher keeps open. A nav item whose
// permission the current role lacks is not rendered at all - never shown
// disabled, and never shown working and failing on click.
const NAV = [
  { to: '/fleet', label: 'Fleet', permission: 'fleet:location_read' },
  { to: '/trips', label: 'Trips', permission: 'trip:read' },
  { to: '/drivers', label: 'Drivers', permission: 'driver:read' },
  { to: '/trucks', label: 'Trucks', permission: 'truck:read' },
  { to: '/assignments', label: 'Assignments', permission: 'assignment:read' },
  { to: '/system', label: 'System', permission: null },
]

function Shell() {
  const { user, logout, can } = useAuth()

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-3">
          <div className="mr-auto">
            <span className="text-sm font-bold">NER Fleet Intelligence</span>
            <span className="ml-2 rounded-full bg-amber-950 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
              Dev
            </span>
          </div>

          <nav className="flex items-center gap-1">
            {NAV.filter((item) => !item.permission || can(item.permission)).map(
              (item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-1.5 text-sm transition ${
                      isActive
                        ? 'bg-slate-800 font-medium text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ),
            )}
          </nav>

          <div className="flex items-center gap-3 border-l border-slate-800 pl-4">
            <div className="text-right">
              <div className="text-xs font-medium text-slate-300">
                {user?.display_name}
              </div>
              <div className="text-[11px] text-slate-500">{user?.role}</div>
            </div>
            <Button variant="secondary" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <Routes>
          <Route path="/fleet" element={<FleetPage />} />
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/drivers" element={<DriversPage />} />
          <Route path="/trucks" element={<TrucksPage />} />
          <Route path="/assignments" element={<AssignmentsPage />} />
          <Route path="/system" element={<SystemPage />} />
          <Route path="*" element={<Navigate to="/fleet" replace />} />
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
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
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
