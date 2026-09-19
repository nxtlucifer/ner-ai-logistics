/**
 * The first screen, and it is a different screen per role.
 *
 * WHY THE SERVER SHAPES IT
 *
 * The alternative - fetch the region and hide what the role may not see -
 * is not a dashboard, it is a data leak with a stylesheet. Everything here
 * renders `/api/dashboard`, whose numbers are already counted over rows the
 * caller is allowed to read. A district manager's "12 under way" is twelve
 * trips touching their district, not twelve out of the region.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * No utilisation percentage, no efficiency score, no predicted arrival, no
 * trend and no sparkline (nothing keeps history). Every figure is a count of
 * rows that exist, because the project has no ground truth for anything else
 * and a dashboard that guesses is worse than one that is quiet.
 *
 * WHAT A NUMBER IS FOR
 *
 * Each one is a link to the rows behind it. A count you cannot open is
 * trivia; a count that takes you to the work is a dashboard.
 *
 * THE LAYOUT IS manager_03, and it fits one 1600x900 screen: four KPI cards;
 * the fleet card beside the recent activity; then who is on (with the state or
 * district table one tab away), what is waiting for a decision, and a
 * photograph. The ten figures sit in the four cards (a figure and a caption
 * each, plus "of N" and the fleet card's trucks in transit).
 *
 * THE LIVE MAP WAITS TO BE ASKED. It is the one thing here that polls every
 * ten seconds and pulls most of a megabyte, so the landing page does not
 * start it (audit 16.2 network gate): the card opens on the count and a
 * schematic of the area, and "Show live map" starts Fleet's own poll.
 */

import {
  AlertTriangle,
  ArrowRight,
  BellOff,
  BellRing,
  CheckCircle2,
  Clock,
  MapPin,
  PackageCheck,
  Radio,
  Route,
  ShieldCheck,
  Siren,
  Truck,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { createContext, lazy, Suspense, type KeyboardEvent, type ReactNode, useContext, useEffect, useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { api, type Dashboard, type Notification, type PersonPresence, type RegionRow, type Trip } from '../api/client'
import { ageLabel, readCache } from '../api/connectivity'
import { useAuth } from '../auth/AuthProvider'
import { KpiCard } from '../components/KpiCard'
import { NorthEastMap } from '../components/NorthEastMap'
import { ScenicImage } from '../components/ScenicImage'
import { ErrorState, LoadingState, MapLoadBoundary, Panel, Spinner, VIEW_ALL } from '../components/ui'
import { useEmergencies } from '../hooks/useEmergencies'
import { useFleetPoll } from '../hooks/useFleetPoll'
import { useResource } from '../hooks/useResource'
import { PHOTOS } from '../imageCredits'
import { asked } from '../staleChunk'
import { detail as notificationDetail, headline } from './notificationText'

// The map library is most of a megabyte; the Overview's first paint must not wait for it.
const FleetMap = lazy(() => asked(() => import('../components/FleetMap')))

/** How often the overview re-reads. Matches the fleet page: fast enough to
 *  notice a dispatch, slow enough not to be a poll storm. */
const OVERVIEW_POLL_MS = 15_000

/** Settles once the headline figures have (PERF-2). The side cards' first
 *  reads wait on it, so /api/dashboard is not queued behind them; later polls
 *  do not wait. Resolved by default, so a card rendered alone asks at once. */
const DashboardFirst = createContext<Promise<void>>(Promise.resolve())

/** Presence and GPS are two facts and are shown as two. Ages read as the
 *  rest of the console reads them - "9 d ago", not "12605 min ago" (AUD2-08). */
export function presenceLine(p: PersonPresence): string {
  const ago = (seconds: number, unit: string) => (seconds < 60 ? `${seconds}${unit} ago` : ageLabel(0, seconds * 1000))
  const seen = p.seen_seconds_ago === null ? 'never seen' : ago(p.seen_seconds_ago, 's')
  if (p.location === 'UNAVAILABLE') return `${p.presence} · Location unavailable`
  const gps = p.gps_seconds_ago === null ? '' : `GPS ${ago(p.gps_seconds_ago, ' sec')}`
  return `${p.presence} · ${gps}${p.location === 'STALE' ? ' (stale)' : ''} · seen ${seen}`
}

/** The next step that is the MANAGER'S on a trip, or null when it is someone else's. */
export function decisionFor(trip: Trip): { text: string; tone: string } | null {
  switch (trip.status) {
    case 'MANAGER_REVIEW':
      return { text: 'Truck check needs a manager', tone: 'text-warning' }
    case 'DELIVERED':
      return { text: 'Close to release the truck', tone: 'text-muted' }
    case 'CLOSED':
    case 'CANCELLED':
      return null
  }
  // The dashboard's "awaiting a route": any open trip with no route selected,
  // including one already on the road - planning it is the manager's move.
  if (!trip.selected_route_id) return { text: 'Needs a route', tone: 'text-warning' }
  return trip.status === 'DRAFT' ? { text: 'Ready to dispatch', tone: 'text-ok' } : null
}

/** A card's quiet state (audit 4, system rules): an icon disc, a 16px title, a 14px line. */
function Quiet({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-2 py-3 text-center">
      <span aria-hidden="true" className="grid size-11 place-items-center rounded-full bg-soft text-muted">
        <Icon className="size-5" />
      </span>
      <p className="mt-2 text-base font-semibold text-ink">{title}</p>
      {children ? <p className="mt-0.5 max-w-sm text-sm text-muted">{children}</p> : null}
    </div>
  )
}

/** A failed read inside a card: the words and a retry, never an empty list. */
function Failed({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <p className="text-sm font-semibold text-danger">{what} could not be loaded</p>
      <p className="max-w-sm text-xs text-muted">
        {error instanceof Error && error.message ? error.message : 'The request failed.'}
      </p>
      <button type="button" onClick={onRetry} className={VIEW_ALL}>
        Try again
      </button>
    </div>
  )
}

const Arrow = () => <ArrowRight className="size-4" aria-hidden="true" />

export default function OverviewPage() {
  const { can } = useAuth()
  const overview = useResource<Dashboard>(() => api.dashboard(), [], 'dashboard', OVERVIEW_POLL_MS)
  const d = overview.data
  const [first] = useState(() => {
    let settle = () => {}
    const settled = new Promise<void>((resolve) => { settle = resolve })
    return { settled, settle }
  })
  useEffect(() => {
    if (overview.data || overview.error) first.settle()
  }, [first, overview.data, overview.error])
  const inbox = can('notification:read')
  // Positions and presence are both fleet:location_read on the server.
  const locate = can('fleet:location_read')

  return (
    <DashboardFirst.Provider value={first.settled}>
    <div className="flex flex-col gap-[13px]">
      {/* The greeting in the topbar is the visual heading; this names the page. */}
      <h1 className="sr-only">Overview</h1>

      {!d ? (
        overview.error ? (
          <ErrorState error={overview.error} onRetry={overview.reload} />
        ) : (
          <LoadingState label="Loading your overview" />
        )
      ) : (
        <section aria-label="Headline figures" className="grid gap-[13px] sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Trips under way"
            icon={Route}
            value={d.trips_under_way}
            to="/trips"
            // Null only for a district manager, whose boundary is the district.
            caption={d.cross_state_trips === null ? null : { value: d.cross_state_trips, text: 'crossing a state border', to: '/trips' }}
          />
          <KpiCard
            label="Needing attention"
            icon={AlertTriangle}
            tone="danger"
            value={d.trips_needing_attention}
            to="/trips"
            hint="Delayed or incident"
            // Drafts AND trips already on the road: "cannot be dispatched" was false for the second kind.
            caption={{ value: d.trips_awaiting_route, text: 'awaiting a route', to: '/trips', tone: 'warning', hint: 'No route selected yet' }}
          />
          <KpiCard
            label="Drivers online"
            icon={Radio}
            value={d.drivers_online}
            of={d.drivers_in_scope}
            to="/drivers"
            hint="Heartbeat in the last 90 seconds"
            caption={{ value: d.drivers_with_stale_gps, text: 'with stale GPS', to: '/fleet', tone: 'warning', hint: 'Last position over 10 minutes old' }}
          />
          {/* The fourth card is the inbox for a role that has one. A fleet
              manager has none, so their fourth figure is the trucks out. */}
          {inbox ? (
            <UrgentKpi urgentUnread={d.urgent_notifications} unread={d.unread_notifications} />
          ) : (
            <KpiCard label="Trucks in transit" icon={Truck} value={d.trucks_in_transit} to="/fleet" hint="On an active or delayed trip" />
          )}
        </section>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,923fr)_minmax(0,410fr)]">
        <LiveFleetCard inTransit={d ? d.trucks_in_transit : null} canLocate={locate} />
        {inbox ? <ActivityRail /> : <NoInbox />}
      </div>

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(0,463fr)_minmax(0,496fr)_minmax(0,358fr)]">
        <AreaCard d={d} error={overview.error} presence={locate} />
        <AwaitingDecision />
        <ScenicCard />
      </div>
    </div>
    </DashboardFirst.Provider>
  )
}

/**
 * The inbox roles' fourth figure: drivers asking for help NOW.
 *
 * It counts open SOS, the same shell poll as the topbar badge. It used to
 * count unread URGENT notifications, so a resolved SOS whose notice nobody
 * had marked read kept the landing page saying a driver needed help while
 * the badge, correctly, showed none (AUD2-01). The unread notices are the
 * caption: mail, not an emergency.
 */
function UrgentKpi({ urgentUnread, unread }: { urgentUnread: number; unread: number }) {
  const { emergencies, loaded, unavailable } = useEmergencies()
  const open = emergencies.length
  return (
    <KpiCard
      label="Urgent alerts"
      icon={BellRing}
      tone="danger"
      value={loaded ? open : '—'}
      // An open SOS is answered on Fleet, where its dossier is.
      to={open > 0 ? '/fleet' : '/notifications'}
      hint={
        !loaded
          ? 'Checking for an open SOS'
          : unavailable
            ? 'Open SOS, last known: the latest check failed'
            : open > 0
              ? 'A driver asking for help'
              : 'No driver is asking for help'
      }
      caption={{
        value: unread,
        text: 'unread',
        to: '/notifications',
        hint: urgentUnread > 0 ? `${urgentUnread} marked urgent` : undefined,
      }}
    />
  )
}

const PRIMARY_SM =
  'inline-flex min-h-9 shrink-0 items-center rounded-[6px] bg-primary px-3 text-[13px] font-semibold text-on-primary hover:bg-primary-hover'
const INSET = 'h-[max(302px,18.9vw)] rounded-[8px]'

function LiveFleetCard({ inTransit, canLocate }: { inTransit: number | null; canLocate: boolean }) {
  const [live, setLive] = useState(false)
  return (
    <Panel
      large
      testId="map-card"
      title="Live fleet"
      subtitle={
        inTransit === null ? 'Trucks in transit: checking' : `${inTransit} ${inTransit === 1 ? 'truck' : 'trucks'} in transit`
      }
      // Positions are fleet:location_read, like Fleet itself; a role without
      // it gets the count and no control that would only fail (B2R11).
      action={
        canLocate ? (
          <div className="flex flex-wrap gap-2">
            {/* One button that stays put, so focus is never dropped when the map swaps in. */}
            <button type="button" onClick={() => setLive((on) => !on)} className={live ? VIEW_ALL : PRIMARY_SM}>
              {live ? 'Hide live map' : 'Show live map'}
            </button>
            <Link to="/fleet" className={VIEW_ALL}>
              View full map <Arrow />
            </Link>
          </div>
        ) : null
      }
    >
      {live ? <LiveMap /> : <AreaSketch canLocate={canLocate} />}
    </Panel>
  )
}

/** Mounted only on request: the poll starts with it and stops with it. */
function LiveMap() {
  const fleet = useFleetPoll()
  const navigate = useNavigate()
  return (
    <>
      {fleet.error && !fleet.snapshot ? (
        // The frame's content, not a card inside the card (B2R10).
        <div className={`flex ${INSET} bg-soft`}>
          <Failed what="Fleet positions" error={fleet.error} onRetry={fleet.refresh} />
        </div>
      ) : (
        <MapLoadBoundary instead="the full map is on Fleet">
          <Suspense
            fallback={
              <div className={`flex ${INSET} items-center justify-center bg-soft`}>
                <LoadingState label="Loading map…" />
              </div>
            }
          >
            {/* A marker opens that trip on Fleet, where its tools are. */}
            <FleetMap
              compact
              placeCategory={null}
              trips={fleet.snapshot?.trips ?? []}
              selectedTripId={null}
              onSelect={(tripId) => navigate('/fleet', { state: { tripId } })}
              track={[]}
              frameClassName={INSET}
            />
          </Suspense>
        </MapLoadBoundary>
      )}
      {fleet.isStale ? (
        <p role="status" className="mt-2 text-xs text-warning">
          Could not refresh just now: these are the last positions received.
        </p>
      ) : null}
    </>
  )
}

/**
 * The card before the map is asked for: a schematic of this account's area
 * (the same drawing as the sign-in step, which already ships in this bundle)
 * and what the button will do. It places no truck, so it claims no position.
 */
function AreaSketch({ canLocate }: { canLocate: boolean }) {
  const { user } = useAuth()
  const scoped = user?.role === 'STATE_MANAGER' || user?.role === 'DISTRICT_MANAGER'
  // The shell has already read the regions list for a scoped role; its
  // cached copy names the state without asking the server again.
  const state = scoped ? readCache<RegionRow[]>('regions')?.data.find((r) => r.id === user?.state_id) : undefined
  const district = state?.districts.find((x) => x.id === user?.district_id)
  return (
    <div className={`flex ${INSET} items-center gap-6 overflow-hidden bg-soft px-6 py-4`}>
      <NorthEastMap
        highlight={scoped ? state?.name ?? null : 'all'}
        callout={district?.name}
        // Height-bound, so the drawing grows with the inset (18.9vw) instead of staying 340px wide.
        className="hidden aspect-[976/790] h-full max-w-[45%] shrink-0 sm:block"
      />
      <div className="min-w-0">
        <p className="text-base font-semibold text-ink">
          {canLocate ? 'Live positions load when you ask' : 'Positions are not part of this account'}
        </p>
        <p className="mt-1 max-w-md text-sm text-muted">
          {canLocate
            ? 'Show live map places each truck at its last reported position and refreshes every 10 seconds. Fleet has the full map and its tools.'
            : 'The count above is from your overview. Truck positions need the fleet map permission.'}
        </p>
        <p className="mt-3 text-xs text-faint">Schematic of your area. State outlines are approximate; no truck is placed on it.</p>
      </div>
    </div>
  )
}

const KIND_ICON: Record<Notification['kind'], LucideIcon> = {
  TRIP_DISPATCHED: Truck,
  INCOMING_TRIP: Truck,
  ROUTE_CHANGED: Route,
  TRIP_DELAYED: Clock,
  TRIP_ARRIVED: MapPin,
  TRIP_DELIVERED: PackageCheck,
  DRIVER_EMERGENCY_STOP: Siren,
  EMERGENCY_RESOLVED: ShieldCheck,
  ROUTE_APPROVED: CheckCircle2,
}
const SEVERITY_TILE: Record<Notification['severity'], string> = {
  URGENT: 'bg-danger-soft text-danger',
  WARNING: 'bg-warning-soft text-warning',
  INFO: 'bg-primary-soft text-primary',
}

/** The five newest notifications - the inbox's own rows, in its own words. */
function ActivityRail() {
  const first = useContext(DashboardFirst)
  const feed = useResource<Notification[]>(
    () => first.then(() => api.listNotifications({ limit: 5 })),
    [],
    'overview:notifications',
    OVERVIEW_POLL_MS,
  )
  return (
    <Panel
      testId="activity-rail"
      title="Recent activity"
      subtitle="Your notifications, newest first"
      action={
        <Link to="/notifications" className={VIEW_ALL}>
          View all <Arrow />
        </Link>
      }
    >
      {feed.error && !feed.data ? (
        <Failed what="Notifications" error={feed.error} onRetry={feed.reload} />
      ) : !feed.data ? (
        <LoadingState label="Loading notifications" />
      ) : feed.data.length === 0 ? (
        <Quiet icon={BellRing} title="Nothing yet">
          A truck dispatched towards you, a route changed or a driver asking to stop will show here.
        </Quiet>
      ) : (
        <ul className="-mx-1">
          {feed.data.map((n) => {
            const Icon = KIND_ICON[n.kind] ?? BellRing
            const line = notificationDetail(n)
            return (
              <li key={n.id} className="border-b border-line last:border-0">
                <Link to="/notifications" className="flex items-center gap-3 rounded-[8px] px-1 py-2 hover:bg-soft">
                  <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-[8px] ${SEVERITY_TILE[n.severity]}`}>
                    <Icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm text-ink ${n.is_read ? 'font-medium' : 'font-semibold'}`}>
                      {/* First, not last: after a truncated line a screen-reader
                          span would sit past the card's edge and widen the page. */}
                      {n.is_read ? null : <span className="sr-only">Unread: </span>}
                      {headline(n)}
                    </span>
                    {line ? <span className="block truncate text-[13px] text-muted">{line}</span> : null}
                  </span>
                  <time dateTime={n.created_at} className="shrink-0 text-[13px] text-muted">
                    {ageLabel(Date.parse(n.created_at))}
                  </time>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/** A fleet manager's account has no inbox; the rail says so rather than sitting empty. */
function NoInbox() {
  return (
    <Panel testId="activity-rail" title="Recent activity" subtitle="Notifications">
      <Quiet icon={BellOff} title="No inbox for this account">
        Notifications go to administrators and to regional, state and district managers. The figures,
        the map and Trips are this role's live view.
      </Quiet>
    </Panel>
  )
}

type AreaView = 'people' | 'places'

/**
 * Lower slot (a): who is on (audit 16.1) and, one tab away, the state or
 * district table the reference's "Top Districts" card stands for. Two views
 * in one card is what keeps the page inside one screen; both stay mounted,
 * so switching is instant and the presence poll never restarts.
 */
function AreaCard({ d, error, presence }: { d: Dashboard | null; error: unknown; presence: boolean }) {
  const id = useId()
  const [view, setView] = useState<AreaView>('people')
  const places = !d ? 'Districts' : d.states.length > 0 ? 'States' : d.role === 'DISTRICT_MANAGER' ? 'Your district' : 'Districts'
  // Presence is fleet:location_read on the server; without it the card is the table alone, no tabs.
  const shown: AreaView = presence ? view : 'places'
  const tabs: [AreaView, string][] = [['people', 'Who is on'], ['places', places]]
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const next: AreaView = view === 'people' ? 'places' : 'people'
    setView(next)
    document.getElementById(`${id}-${next}`)?.focus()
  }
  const subtitle =
    shown === 'people'
      ? 'Heartbeat, not signal bars'
      : d && d.states.length > 0
        ? 'Trips under way and needing attention, by state'
        : 'Trips in and out, by district'
  return (
    <section
      data-testid="lower-card"
      aria-labelledby={`${id}-title`}
      className="flex min-w-0 flex-col rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3.5 shadow-[var(--shadow-card)]"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          {presence ? (
            <>
              <h2 id={`${id}-title`} className="sr-only">{`Who is on, and ${places.toLowerCase()}`}</h2>
              <div role="tablist" aria-labelledby={`${id}-title`} className="flex gap-4">
                {tabs.map(([key, label]) => (
                  <button
                    key={key}
                    id={`${id}-${key}`}
                    type="button"
                    role="tab"
                    aria-selected={view === key}
                    aria-controls={`${id}-${key}-panel`}
                    tabIndex={view === key ? 0 : -1}
                    onKeyDown={onKey}
                    onClick={() => setView(key)}
                    className={`-mb-px border-b-2 pb-0.5 text-base font-bold leading-tight ${
                      view === key ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <h2 id={`${id}-title`} className="text-base font-bold leading-tight text-ink">
              {places}
            </h2>
          )}
          <p className="mt-1 text-[13px] leading-[18px] text-muted">{subtitle}</p>
        </div>
        {shown === 'places' && d && d.states.length > 0 ? (
          <Link to="/states" className={VIEW_ALL}>
            States &amp; districts <Arrow />
          </Link>
        ) : null}
      </header>
      {presence ? (
        tabs.map(([key]) => (
          <div
            key={key}
            id={`${id}-${key}-panel`}
            role="tabpanel"
            aria-labelledby={`${id}-${key}`}
            hidden={view !== key}
            className={view === key ? 'mt-2 flex min-h-0 flex-1 flex-col' : 'hidden'}
          >
            {key === 'people' ? <WhoIsOn /> : <Directory d={d} error={error} />}
          </div>
        ))
      ) : (
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          <Directory d={d} error={error} />
        </div>
      )}
    </section>
  )
}

/** Presence. A failed read says so: it is not "nobody is on" (audit 11.3 D4). */
function WhoIsOn() {
  const first = useContext(DashboardFirst)
  const people = useResource<PersonPresence[]>(() => first.then(() => api.presence()), [], 'presence', OVERVIEW_POLL_MS)
  const drivers = (people.data ?? []).filter((p) => p.driver_id)
  return people.error && !people.data ? (
    <Failed what="Presence" error={people.error} onRetry={people.reload} />
  ) : !people.data ? (
    <LoadingState label="Checking who is on" />
  ) : drivers.length === 0 ? (
    // The server lists every driver in scope, heartbeat or not (B2R3), so
    // empty means no driver is in scope - not that nobody checked in.
    <Quiet icon={UserRound} title="No drivers in scope">
      Each driver in your scope appears here, with their last check-in.
    </Quiet>
  ) : (
    // Scrolls inside the card; focusable so a keyboard can scroll it too.
    <div role="region" aria-label="Drivers reporting" tabIndex={0} className="-mx-1 max-h-[138px] overflow-y-auto px-1">
      <ul>
        {drivers.slice(0, 12).map((p) => (
          <li key={p.user_id} className="flex items-center gap-3 border-b border-line py-1.5 last:border-0">
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-soft text-xs font-bold text-ink">
              {p.display_name.trim().charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{p.display_name}</span>
              <span
                className={`block truncate text-xs ${
                  p.presence === 'ONLINE' ? 'text-ok' : p.presence === 'IDLE' ? 'text-warning' : 'text-muted'
                }`}
              >
                {presenceLine(p)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Trips whose next step is the manager's, from the FIRST PAGE of open trips -
 * the same request the Trips page opens with. It says so: a quiet card here
 * is "nothing on that page", not "nothing anywhere".
 */
function AwaitingDecision() {
  const { can } = useAuth()
  const first = useContext(DashboardFirst)
  const page = useResource(() => first.then(() => api.listTrips({ open_only: true, limit: 20 })), [], 'overview:trips', OVERVIEW_POLL_MS)
  const rows = page.data?.items ?? []
  const waiting = rows.flatMap((trip) => {
    const decision = decisionFor(trip)
    return decision ? [{ trip, decision }] : []
  })
  return (
    <Panel
      testId="lower-card"
      title="Awaiting a decision"
      // What is counted, and from where (COPY-2).
      subtitle={page.data ? `${waiting.length} of ${rows.length} open trips need a decision (first page)` : 'First page of open trips'}
      action={
        <div className="flex gap-2">
          {/* Planning lives on Trips; a role that cannot plan is not offered it (audit 11.3 D7). */}
          {can('trip:create') ? (
            <Link to="/trips" className={PRIMARY_SM}>
              New trip
            </Link>
          ) : null}
          <Link to="/trips" className={VIEW_ALL}>
            Trips <Arrow />
          </Link>
        </div>
      }
    >
      {page.error && !page.data ? (
        <Failed what="Trips" error={page.error} onRetry={page.reload} />
      ) : !page.data ? (
        <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-muted">
          <Spinner /> Loading trips
        </div>
      ) : waiting.length === 0 ? (
        <Quiet icon={CheckCircle2} title="Nothing waiting on this page">
          None of the first {rows.length} open trips needs a route, a truck check or closing.
        </Quiet>
      ) : (
        <>
          <ul>
            {waiting.slice(0, 4).map(({ trip, decision }) => (
              <li key={trip.id} className="border-b border-line last:border-0">
                <Link to="/trips" className="flex items-center gap-3 rounded-[6px] px-1 py-1.5 hover:bg-soft">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{trip.trip_code}</span>
                    <span className="block truncate text-xs text-muted">
                      {trip.origin && trip.destination ? `${trip.origin} → ${trip.destination}` : trip.client_name ?? ''}
                    </span>
                  </span>
                  <span className={`shrink-0 text-[13px] font-semibold ${decision.tone}`}>{decision.text}</span>
                </Link>
              </li>
            ))}
          </ul>
          {waiting.length > 4 ? (
            <p className="mt-1 text-xs text-muted">{waiting.length - 4} more on that page, in Trips.</p>
          ) : null}
        </>
      )}
    </Panel>
  )
}

/** Decoration, never data: a licensed photograph with its Photo credits (i).
 *
 *  The truck fills the middle band of a 2.79:1 panorama (about 20-63% of its
 *  height, in its right third). The photo is anchored right, the (i) sits in
 *  the top corner over the hills, and the tagline is two lines in the
 *  bottom third, under the truck's tyres: measured from a 390 phone to a 2560
 *  desk, neither covers the truck (.runtime/redesign/cert/integrate). */
function ScenicCard() {
  return (
    <div data-testid="scenic-card" className="min-h-[300px] overflow-hidden lg:col-span-2 lg:min-h-[240px] xl:col-span-1 xl:min-h-[200px] rounded-[var(--radius-card)] shadow-[var(--shadow-card)]">
      <ScenicImage
        photo={PHOTOS.khasiTruck}
        // The DRAWN width on a desk: where the card is narrower than the
        // panorama, cover fills the height and draws it ~2.8x as wide (about
        // 620px on the 221px desktop row). On a phone the card's own width
        // (PERF-7): the drawn 840px there picked the 165 KB file for a card
        // that shows a 358px slice of it; the 68 KB one is enough for decoration.
        sizes="(min-width: 1280px) 640px, (min-width: 1024px) 80vw, calc(100vw - 32px)"
        position="100% 45%"
        className="relative size-full min-h-[300px] lg:min-h-[240px] xl:min-h-[200px]"
        creditClassName="right-2 top-2"
      >
        <div className="absolute inset-x-0 bottom-0 p-5 pb-4 xl:p-4 xl:pb-3">
          <p className="font-display text-[17px] font-semibold leading-snug text-on-image xl:text-[15px]">
            Stronger Communities,
            <br />A More Connected North East.
          </p>
          <span aria-hidden="true" className="mt-3 block h-[3px] w-10 rounded-full bg-brand-gold xl:mt-2" />
        </div>
      </ScenicImage>
    </div>
  )
}

/** The region's states, or the manager's districts - the tables the figures summarise. */
function Directory({ d, error }: { d: Dashboard | null; error: unknown }) {
  const navigate = useNavigate()
  if (!d) {
    // The KPI row above already offers the retry; this only says why it is empty.
    return error ? (
      <p role="alert" className="text-sm text-danger">The overview could not be loaded, so neither could this table.</p>
    ) : (
      <LoadingState label="Loading the table" />
    )
  }
  if (d.states.length === 0 && d.districts.length === 0) {
    return (
      <Quiet icon={MapPin} title="No verified district directory has been loaded for this state yet">
        A district list is a government notification, and none has been verified for this deployment. Trips,
        drivers and trucks all work; they simply carry no district, so nothing is counted that cannot be sourced.
      </Quiet>
    )
  }
  const th = 'sticky top-0 bg-surface pb-1.5 text-xs font-medium uppercase tracking-wide text-muted'
  return (
    // Scrolls inside the card, like Who is on; focusable so a keyboard can scroll it.
    <div role="region" aria-label={d.states.length > 0 ? 'States' : 'Districts'} tabIndex={0} className="-mx-1 max-h-[138px] overflow-auto px-1">
      {d.states.length > 0 ? (
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr>
              <th className={th}>State</th>
              {/* Verified or demo rows alike (dashboard.py OPERATIONAL_SOURCES):
                  "on file", as on States, never "verified" (TRUTH-1). */}
              <th className={th}>Districts on file</th>
              <th className={th}>Under way</th>
              <th className={th}>Attention</th>
            </tr>
          </thead>
          <tbody>
            {d.states.map((s) => (
              <tr key={s.state_id} className="cursor-pointer border-t border-line hover:bg-soft" onClick={() => navigate('/states')}>
                <td className="py-1.5 font-medium text-ink">{s.name}</td>
                <td className="py-1.5">
                  {s.districts_configured > 0 ? (
                    <span className="tabular-nums">{s.districts_configured}</span>
                  ) : (
                    // Not "0". A zero reads as a measurement of a state with
                    // no districts; this is an absence of a verified list,
                    // which is a different thing entirely.
                    <span className="text-warning">Official list pending</span>
                  )}
                </td>
                <td className="py-1.5 tabular-nums">{s.trips_under_way}</td>
                <td className={`py-1.5 tabular-nums ${s.trips_needing_attention > 0 ? 'text-danger' : ''}`}>
                  {s.trips_needing_attention}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr>
              <th className={th}>District</th>
              <th className={th}>Incoming</th>
              <th className={th}>Outgoing</th>
            </tr>
          </thead>
          <tbody>
            {d.districts.map((row) => (
              <tr key={row.district_id} className="border-t border-line">
                <td className="py-1.5 font-medium text-ink">{row.name}</td>
                <td className="py-1.5 tabular-nums">{row.incoming}</td>
                <td className="py-1.5 tabular-nums">{row.outgoing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
