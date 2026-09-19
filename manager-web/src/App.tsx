/**
 * Manager application shell.
 *
 * Nothing here is decorative: every screen reads live API state, and a control
 * the current role cannot use is not rendered at all rather than shown disabled
 * or - worse - shown working and failing on click.
 */

import type { ReactNode } from 'react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Activity, Bell, FileText, Gauge, LayoutDashboard, Map, MapPin, Menu, Route as RouteIcon, ShieldCheck, Siren, Truck, UserCog, Users } from 'lucide-react'
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { api, type RegionRow } from './api/client'
import { ageLabel, useConnectivity } from './api/connectivity'

import { AuthProvider, useAuth } from './auth/AuthProvider'
import { LoadingState } from './components/ui'
import { ProfileMenu } from './components/ProfileMenu'
import { RouteBoundary } from './components/RouteBoundary'
import { EmergencyProvider } from './hooks/EmergencyProvider'
import { useEmergencies } from './hooks/useEmergencies'
import { useResource } from './hooks/useResource'
import { asked } from './staleChunk'
import LoginPage from './pages/LoginPage'
import OverviewPage from './pages/OverviewPage'

// The two landing screens load with the shell; every other page is its own
// chunk, fetched when it is opened (PERF-1: the entry had grown 12% gzip).
// `asked`: a stale chunk after a redeploy reloads the tab once (staleChunk.ts);
// a chunk that did not arrive shows its error in the page area (RouteBoundary,
// LAZY-1), never an empty console.
const AssignmentsPage = lazy(() => asked(() => import('./pages/AssignmentsPage')))
const DriversPage = lazy(() => asked(() => import('./pages/DriversPage')))
// FleetMap starts with its page, not after it: Fleet opened first used to wait
// for FleetPage before the map chunk could even be asked for (RPERF-2).
const FleetPage = lazy(() =>
  asked(() => {
    void import('./components/FleetMap').catch(() => {})
    return import('./pages/FleetPage')
  }),
)
const SystemPage = lazy(() => asked(() => import('./pages/SystemPage')))
const TripsPage = lazy(() => asked(() => import('./pages/TripsPage')))
const TrucksPage = lazy(() => asked(() => import('./pages/TrucksPage')))
const ManagersPage = lazy(() => asked(() => import('./pages/ManagersPage')))
const NotificationsPage = lazy(() => asked(() => import('./pages/NotificationsPage')))
const ReportsPage = lazy(() => asked(() => import('./pages/ReportsPage')))
const StatesPage = lazy(() => asked(() => import('./pages/StatesPage')))
const ReviewPage = lazy(() => asked(() => import('./pages/ReviewPage')))

// Fleet leads: it is the screen a dispatcher keeps open. A nav item whose
// permission the current role lacks is not rendered at all - never shown
// disabled, and never shown working and failing on click.
// One icon family (Lucide, 2px stroke) - the same grammar as the driver app's
// Feather set, so a truck or a shield reads the same in both products.
// Five operational screens. Driver-truck assignments live in the driver
// profile (and /assignments stays reachable as a record, linked from Trucks);
// Diagnostics is a secondary utility, rendered apart from the workflow.
/** Roles a nav item is FOR, when it is not for everyone.
 *
 *  Two gates, and both are needed. `permission` is what the server will
 *  actually allow - a link the role cannot use is not rendered, never shown
 *  disabled and never shown working and failing on click. `roles` is about
 *  RELEVANCE: a district manager holds `driver:read`, but "States &
 *  Districts" is not their screen and putting it in their sidebar makes the
 *  console harder to learn without making anything possible.
 *
 *  Relevance is not security. Everything here is enforced again server-side
 *  by app/core/scope.py, which is why hiding a link is allowed to be a
 *  judgement about clarity rather than a defence.
 */
const REGIONAL = ['ADMIN', 'MANAGER', 'NORTH_EAST_MANAGER'] as const
const MANAGES_A_FLEET = [
  'ADMIN',
  'MANAGER',
  'NORTH_EAST_MANAGER',
  'STATE_MANAGER',
  'DISTRICT_MANAGER',
] as const
const ADMINISTERS = ['ADMIN', 'MANAGER', 'NORTH_EAST_MANAGER', 'STATE_MANAGER'] as const

//: Pages whose content is a table, a grid or a map - they use the whole
//: screen. Everything else keeps the reading-width bound, which is there
//: so prose does not run to 2000 pixels.
const WIDE_PAGES = [
  '/overview',
  '/trips',
  '/drivers',
  '/trucks',
  '/fleet',
  '/reports',
  '/notifications',
  '/states',
  '/managers',
]

// Three groups, divided in the sidebar as the reference divides them: the
// daily work, the region's oversight screens, and the one utility.
type NavGroup = 'work' | 'region' | 'tools'
const NAV_GROUPS: NavGroup[] = ['work', 'region', 'tools']

const NAV: { to: string; label: string; permission: string | null; icon: typeof Gauge; group: NavGroup; roles: readonly string[] | null }[] = [
  // Not for a reviewer. They hold trip:read, so permission alone would
  // land them here - on a dashboard whose every count is zero, because
  // their scope covers no fleet. Their screen is Review.
  { to: '/overview', label: 'Overview', permission: 'trip:read', icon: Gauge, group: 'work', roles: MANAGES_A_FLEET },
  { to: '/fleet', label: 'Fleet', permission: 'fleet:location_read', icon: LayoutDashboard, group: 'work', roles: null },
  { to: '/trips', label: 'Trips', permission: 'trip:read', icon: RouteIcon, group: 'work', roles: null },
  { to: '/drivers', label: 'Drivers', permission: 'driver:read', icon: Users, group: 'work', roles: null },
  { to: '/trucks', label: 'Trucks', permission: 'truck:read', icon: Truck, group: 'work', roles: null },
  // The region's own screens. A state or district manager reaches neither:
  // one is the map of all eight states, the other is where State Managers
  // are appointed.
  { to: '/states', label: 'States & districts', permission: 'trip:read', icon: Map, group: 'region', roles: REGIONAL },
  { to: '/managers', label: 'Managers', permission: 'manager_account:manage', icon: UserCog, group: 'region', roles: ADMINISTERS },
  { to: '/reports', label: 'Reports', permission: 'trip:read', icon: FileText, group: 'region', roles: MANAGES_A_FLEET },
  { to: '/review', label: 'Review', permission: 'route:review_authorize', icon: ShieldCheck, group: 'region', roles: null },
  // Only the scoped roles hold notification:read, so a fleet-wide
  // MANAGER never sees a bell with nothing behind it.
  { to: '/notifications', label: 'Notifications', permission: 'notification:read', icon: Bell, group: 'region', roles: null },
  { to: '/system', label: 'Diagnostics', permission: null, icon: Activity, group: 'tools', roles: null },
]

/** What this account is: the scope, in words, in the header.
 *
 *  A console that looks identical for a district manager and a regional one
 *  is a console where somebody eventually acts on the wrong fleet. */
export function scopeLabel(
  role: string | undefined,
  stateName?: string | null,
  districtName?: string | null,
): string {
  switch (role) {
    case 'NORTH_EAST_MANAGER':
      return 'North-East · all states'
    case 'STATE_MANAGER':
      return stateName ? `${stateName} · state` : 'State'
    case 'DISTRICT_MANAGER':
      return districtName ? `${districtName} · district` : 'District'
    case 'ADMIN':
      return 'Administrator'
    case 'MANAGER':
      return 'Fleet'
    default:
      return role ?? ''
  }
}

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
  roles = null,
  home,
  children,
}: {
  permission: string
  /** Who the screen is FOR, as on its nav item: a screen the sidebar hides
   *  from a role is not reachable by typing its URL either. */
  roles?: readonly string[] | null
  home: string
  children: ReactNode
}) {
  const { can, user } = useAuth()
  if (!can(permission) || (roles && !(user?.role && roles.includes(user.role)))) return <Navigate to={home} replace />
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

/** Who is signed in, what they are looking at, and how fresh it is.
 *
 *  Deliberately NOT a global search box. The reference has one; there is no
 *  cross-entity search endpoint behind it, and a box that silently searched
 *  only open trips would be a worse lie than an absent control. Trips,
 *  Drivers and Trucks each keep their own server-side search.
 */
/** The header's scope in words, with the NAME of the state or district.
 *  Only scoped roles look it up; the public regions list carries the names. */
function useScopeLabel(): string {
  const { user } = useAuth()
  const scoped = user?.role === 'STATE_MANAGER' || user?.role === 'DISTRICT_MANAGER'
  const regions = useResource(
    () => (scoped ? api.listRegions() : Promise.resolve([] as RegionRow[])),
    [scoped],
    scoped ? 'regions' : undefined,
  )
  const state = regions.data?.find((r) => r.id === user?.state_id)
  const district = state?.districts.find((d) => d.id === user?.district_id)
  return scopeLabel(user?.role, state?.name, district?.name)
}

/** A driver's SOS, on every screen. Fleet holds the dossier; this is how a
 *  manager working anywhere else learns to go there. A failed poll says the
 *  status is unknown - it never reads as "no SOS". */
function SosBadge() {
  const { emergencies, loaded, unavailable } = useEmergencies()
  const count = emergencies.length
  const label = `${count} active ${count === 1 ? 'emergency' : 'emergencies'}`
  // Announced when the count RISES. Cleared on a fall so the same number
  // coming back is announced again.
  const [announcement, setAnnouncement] = useState('')
  const previous = useRef(0)
  useEffect(() => {
    setAnnouncement(count > previous.current ? `${label}. Open Fleet to respond.` : '')
    previous.current = count
  }, [count, label])

  return (
    <>
      <span className="sr-only" aria-live="assertive" aria-atomic="true">{announcement}</span>
      {count > 0 ? (
        <NavLink
          to="/fleet"
          // Starts with the visible text, so "click SOS 2" finds it (WCAG 2.5.3).
          aria-label={`SOS ${count}: ${label}${unavailable ? ', last known' : ''} - open Fleet`}
          title={unavailable ? 'Last known - the latest check failed' : undefined}
          className="flex h-10 items-center gap-2 rounded-[var(--radius-control)] bg-danger-strong px-3 text-sm font-bold uppercase tracking-wide text-white shadow-sm"
        >
          <Siren className="size-[18px] motion-safe:animate-pulse" aria-hidden="true" />
          SOS {count}
        </NavLink>
      ) : unavailable ? (
        <NavLink
          to="/fleet"
          className="flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-warning px-3 text-xs font-semibold text-warning"
        >
          <Siren className="size-4" aria-hidden="true" />
          SOS status unknown
        </NavLink>
      ) : !loaded ? (
        // Before the first answer: not yet known, which must not look like "no SOS".
        <span className="flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-line px-3 text-xs font-semibold text-muted">
          <Siren className="size-4" aria-hidden="true" />
          Checking SOS…
        </span>
      ) : null}
    </>
  )
}

/** The mountain line drawing behind the header's right side (manager_03). Decoration only. */
function HeaderRidge() {
  return (
    <svg viewBox="0 0 320 60" className="topbar-ridge" aria-hidden="true" focusable="false" preserveAspectRatio="xMaxYMax meet">
      <path d="M0 60 L46 34 L70 44 L112 14 L140 32 L168 22 L206 46 L236 28 L262 38 L292 20 L320 34 L320 60 Z" className="fill-soft" />
      <path d="M0 60 L46 34 L70 44 L112 14 L140 32 L168 22 L206 46 L236 28 L262 38 L292 20 L320 34" fill="none" className="stroke-line" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M104 20 L112 14 L120 20 M286 24 L292 20 L298 24" fill="none" className="stroke-outline" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
    </svg>
  )
}

/** Who is signed in, what they are looking at and how fresh it is, as the
 *  reference's greeting band: no border, on the surface token. */
function Topbar() {
  const { user, logout, can } = useAuth()
  const scope = useScopeLabel()
  const { online, lastOkAt } = useConnectivity()
  const [, tick] = useState(0)
  // Re-render so "last synced" ages rather than freezing at its first value.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  // The bar's real height, for the page's scroll-padding and Fleet's sticky
  // Details panel (index.css): it wraps, so a fixed number would be wrong.
  const bar = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = bar.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const root = document.documentElement
    const observer = new ResizeObserver(() => root.style.setProperty('--topbar-h', `${el.offsetHeight}px`))
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--topbar-h')
    }
  }, [])

  return (
    <header ref={bar} className="topbar">
      <HeaderRidge />
      <div className="topbar-scope">
        <p data-testid="greeting" className="topbar-greeting">Welcome, {user?.display_name || 'manager'}</p>
        <p className="topbar-meta">
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className={`topbar-dot${online ? '' : ' topbar-dot--off'}`} />
            <strong>{scope}</strong>
          </span>
          <span aria-hidden="true" className="topbar-sep">|</span>
          <span>
            {online
              ? lastOkAt !== null
                ? `Last synced ${ageLabel(lastOkAt)}`
                : 'Connected'
              : 'Offline · showing last known data'}
          </span>
        </p>
      </div>

      <div className="topbar-actions">
        {can('emergency:read') ? <SosBadge /> : null}
        {can('notification:read') ? (
          <NavLink to="/notifications" className="topbar-icon" aria-label="Notifications">
            <Bell className="size-5" aria-hidden="true" />
          </NavLink>
        ) : null}
        {/* Theme, image credits and Sign out live behind the avatar. Sign out
            behaves as it always has: it clears the session locally whatever
            the server says. */}
        <ProfileMenu name={user?.display_name ?? ''} role={roleLabel(user?.role)} onSignOut={logout} />
      </div>
    </header>
  )
}

/** The role in words, for the person badge. `scopeLabel` answers "which
 *  fleet"; this answers "as what", and they are not the same question. */
function roleLabel(role: string | undefined): string {
  switch (role) {
    case 'NORTH_EAST_MANAGER':
      return 'Regional head'
    case 'STATE_MANAGER':
      return 'State manager'
    case 'DISTRICT_MANAGER':
      return 'District manager'
    case 'ADMIN':
      return 'Administrator'
    case 'MANAGER':
      return 'Fleet manager'
    default:
      return role ?? ''
  }
}

/** Misted pines at the foot of the rail (manager_03). Decoration only; the
 *  colours are the shell tokens, so Dark turns them charcoal. */
function RailPines() {
  const pine = (x: number, base: number, h: number) => {
    const w = h * 0.3
    return `M${x} ${base - h} L${x + w * 0.55} ${base - h * 0.55} L${x + w * 0.3} ${base - h * 0.55} L${x + w * 0.8} ${base - h * 0.2} L${x + w * 0.4} ${base - h * 0.2} L${x + w} ${base} L${x - w} ${base} L${x - w * 0.4} ${base - h * 0.2} L${x - w * 0.8} ${base - h * 0.2} L${x - w * 0.3} ${base - h * 0.55} L${x - w * 0.55} ${base - h * 0.55} Z`
  }
  const back = [[10, 116, 56], [30, 118, 72], [52, 116, 50], [96, 118, 44], [140, 116, 58], [164, 118, 78], [190, 116, 62], [212, 118, 70]] as const
  const front = [[6, 160, 76], [26, 162, 104], [50, 160, 70], [74, 162, 52], [150, 160, 60], [172, 162, 96], [198, 160, 112], [216, 162, 80]] as const
  return (
    <svg viewBox="0 0 216 160" preserveAspectRatio="xMidYMax slice" className="rail-pines" focusable="false">
      {/* Mist, a ridge of far pines, more mist, the near pines. */}
      <path d="M0 90 Q54 70 108 88 T216 80 L216 160 L0 160 Z" style={{ fill: 'var(--shell-ring)' }} opacity="0.6" />
      {back.map(([x, b, h]) => (
        <path key={`b${x}`} d={pine(x, b, h)} style={{ fill: 'var(--shell-raised)' }} />
      ))}
      <path d="M0 120 Q60 104 118 122 T216 114 L216 160 L0 160 Z" style={{ fill: 'var(--shell-surface)' }} opacity="0.85" />
      {front.map(([x, b, h]) => (
        <path key={`f${x}`} d={pine(x, b, h)} style={{ fill: 'var(--shell)' }} />
      ))}
    </svg>
  )
}

function Shell() {
  const location = useLocation()
  const { user, can } = useAuth()
  const scope = useScopeLabel()
  // The landing screen is the first one this account can BOTH use and see.
  // Matching the sidebar filter matters: without the role check, a role
  // whose first permitted item is hidden would land on a screen that is
  // not in their navigation, with no way back to it.
  const shown = (item: (typeof NAV)[number]) =>
    (!item.permission || can(item.permission)) &&
    (!item.roles || (!!user?.role && item.roles.includes(user.role)))
  const home = NAV.find(shown)?.to ?? '/system'
  // Up to 800px the nav and the region card fold under a Menu button, so a
  // phone (or a desktop at 200% zoom) opens on the page, not the chrome
  // (RESP-4). Open only while the location it was opened at stands: any
  // navigation, even back to the same screen, folds it in the same render.
  const [openAt, setOpenAt] = useState<typeof location | null>(null)
  const menuOpen = openAt === location
  const menuButton = useRef<HTMLButtonElement>(null)
  // A page chosen from the open Menu folds it in the same render, and the
  // focused link goes with it; focus would fall to <body> (MENU-1). It moves
  // to the page instead, once the page is there.
  const toPage = useRef(false)
  useEffect(() => {
    if (!toPage.current) return
    toPage.current = false
    document.getElementById('main-content')?.focus()
  }, [location])

  return (
    <EmergencyProvider>
    <div className="app-shell"><a className="skip-link" href="#main-content">Skip to workspace</a>
      {/* An aside, not a header: the topbar is the page's one banner landmark. */}
      <aside className="app-rail" aria-label="Sidebar">
        <div
          className={`rail-inner ${menuOpen ? 'menu-open' : ''}`}
          // Escape folds the open Menu and returns to its button (MENU-2).
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || !menuOpen) return
            setOpenAt(null)
            menuButton.current?.focus()
          }}
        >
          <div className="brand">
            <img src="/brand-mark.svg" alt="" className="brand-mark" />
            <span className="brand-title">RASTA AI</span>
            <span className="brand-caption">Manager console</span>
            {import.meta.env.DEV ? <span className="brand-dev">Dev</span> : null}
            <button
              ref={menuButton}
              type="button"
              className="rail-menu"
              aria-expanded={menuOpen}
              aria-controls="main-nav rail-region"
              onClick={() => setOpenAt(menuOpen ? null : location)}
            >
              <Menu className="size-5" aria-hidden="true" />
              Menu
            </button>
          </div>

          {/* One landmark, three groups with a rule between them. A group
              the role has nothing in is not drawn, so no rule dangles. */}
          <nav id="main-nav" aria-label="Main navigation" className="main-nav">
            {NAV_GROUPS.map((group) => {
              const items = NAV.filter((item) => item.group === group && shown(item))
              return items.length === 0 ? null : (
                <div key={group} className="nav-group">
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => {
                        toPage.current = menuOpen
                      }}
                      className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : 'nav-idle'}`}
                    >
                      <item.icon className="nav-icon" aria-hidden="true" />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )
            })}
          </nav>

          {/* The reference offers "Change Region" here. The scope belongs to
              the ACCOUNT - the region chosen at sign-in only refuses a
              mismatch, it never changes what this account may see - so the
              card states the scope and says where it comes from. */}
          <div id="rail-region" className="rail-region">
            <div className="flex items-center gap-2.5">
              <span aria-hidden="true" className="rail-region-pin">
                <MapPin className="size-4" />
              </span>
              <span className="min-w-0">
                <b>{scope}</b>
                <span className="rail-region-sub">Operational region</span>
              </span>
            </div>
            <p className="rail-region-note">Set by your account</p>
          </div>

          <div className="rail-scenery" aria-hidden="true">
            <RailPines />
            <p>
              Smarter Routes
              <br />
              Stronger North East
            </p>
          </div>
        </div>
      </aside>
      <div className="app-main">
      <SyncBanner />
      <Topbar />

      {/* Trips is the one page whose table wants every pixel of a wide
          screen; everything else keeps the reading cap. */}
      {/* Tables and dashboards take the screen; reading-width pages keep
          their bound. Measured at 2560 CSS px, an overview capped at
          1800px left a 272px dead gutter while the data it holds is a
          grid that would happily use it. */}
      <main
        id="main-content"
        // Focusable by script only: the Menu hands focus here (MENU-1).
        tabIndex={-1}
        className={`workspace focus-target${WIDE_PAGES.some((p) => location.pathname.startsWith(p)) ? ' workspace--wide' : ''}`}
      >
        {/* Keyed on the path: a page that failed is not the next page's
            problem, and a page still loading says so ("Loading…") instead of
            leaving the last one on screen under the new address (LAZY-2). */}
        <RouteBoundary key={location.pathname}>
        <Suspense fallback={<LoadingState label="Loading…" />}>
        <Routes>
          <Route
            path="/fleet"
            element={<Guarded permission="fleet:location_read" home={home}><FleetPage /></Guarded>}
          />
          <Route path="/trips" element={<Guarded permission="trip:read" home={home}><TripsPage /></Guarded>} />
          <Route path="/drivers" element={<Guarded permission="driver:read" home={home}><DriversPage /></Guarded>} />
          <Route path="/trucks" element={<Guarded permission="truck:read" home={home}><TrucksPage /></Guarded>} />
          <Route path="/assignments" element={<Guarded permission="assignment:read" home={home}><AssignmentsPage /></Guarded>} />
          <Route path="/system" element={<SystemPage />} />
          {/* Review is readable by any role that can read routes (a manager sees
              the audit trail); the authorise form inside is gated on its own. */}
          <Route path="/review" element={<Guarded permission="route:read" home={home}><ReviewPage /></Guarded>} />
          <Route path="/notifications" element={<Guarded permission="notification:read" home={home}><NotificationsPage /></Guarded>} />
          {/* These four carry their nav item's whole gate, permission AND
              role: a district manager holds trip:read, but States is not
              their screen, and a URL must not reach what the sidebar hides. */}
          <Route path="/overview" element={<Guarded permission="trip:read" roles={MANAGES_A_FLEET} home={home}><OverviewPage /></Guarded>} />
          <Route path="/reports" element={<Guarded permission="trip:read" roles={MANAGES_A_FLEET} home={home}><ReportsPage /></Guarded>} />
          <Route path="/states" element={<Guarded permission="trip:read" roles={REGIONAL} home={home}><StatesPage /></Guarded>} />
          <Route path="/managers" element={<Guarded permission="manager_account:manage" roles={ADMINISTERS} home={home}><ManagersPage /></Guarded>} />
          {/* Land on the first screen this role can actually USE, not always
              /fleet. An authorised reviewer holds neither fleet:location_read
              nor route:select, so sending them to Fleet would render a page
              whose every request 403s - which teaches an operator the system
              is broken rather than that they lack a permission. */}
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
        </Suspense>
        </RouteBoundary>
      </main>
      </div>
    </div>
    </EmergencyProvider>
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
