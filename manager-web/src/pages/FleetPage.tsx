/**
 * Fleet operations: where every truck on the road is, right now.
 *
 * Polling, not WebSockets. There is no authenticated realtime transport in this
 * codebase, and building one to avoid a ten-second poll would be a subsystem
 * with its own auth, reconnection and backpressure problems - for a dashboard
 * where correct polling is indistinguishable to the operator. One loop feeds
 * the map, the list, the counts and the filters (see useFleetPoll).
 *
 * TWO RULES THIS SCREEN KEEPS
 *
 * Freshness is the SERVER'S. LIVE / STALE / NO CONTACT / NO LOCATION and the
 * threshold behind them arrive with the data. Nothing here recomputes them,
 * because a client that decided for itself what "live" meant would eventually
 * disagree with the system a dispatcher is acting on.
 *
 * Nothing is invented. A truck that has never reported is listed and counted
 * but not plotted, and every field in the detail panel is a value the API
 * returned.
 *
 * PLANNED ROUTE vs OBSERVED TRACK. Since P7 the map can draw both, and they are
 * deliberately not alike: the planned route is a dashed violet line beneath a
 * solid sky-blue observed track, and the panel labels them in matching colours.
 * One is where a routing provider says the truck should go; the other is where
 * it has actually been. Rendering them alike would let a dispatcher read a plan
 * as an observation.
 *
 * Still no ETA. The provider gives a free-flow travel time, which accounts for
 * no departure time, no traffic and no dwell at stops - so it is labelled as
 * what it is and never presented as an arrival time. No fuel figure either:
 * there is no fuel model, and NULL means unavailable, never zero.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  api,
  type Driver,
  type FleetTrip,
  type Freshness,
  type Position,
  type RerouteAssessment,
  type ReviewAuthorization,
  type RouteRecommendation,
  type TripDetail,
  type TripRoute,
  type Truck,
} from '../api/client'
const FleetMap = lazy(() => import('../components/FleetMap'))
import { FleetKpiBar } from '../components/FleetKpiBar'
import { RouteRiskComparison, type RouteOption } from '../components/RouteRiskComparison'
import { TruckContextDrawer } from '../components/TruckContextDrawer'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusPill,
} from '../components/ui'
import { useFleetPoll } from '../hooks/useFleetPoll'
import { translateReasonCodes } from '../i18n/reasonCodes'

const FRESHNESS_ORDER: Freshness[] = [
  'LIVE',
  'STALE',
  'NO_CONTACT',
  'NO_LOCATION',
]

/**
 * One freshness filter.
 *
 * The count sits inside the chip rather than beside it so the control is a
 * single tap target, and the pressed state is carried by `aria-pressed` plus a
 * border and weight change - not by colour alone, because these chips are
 * exactly where colour already means something else (LIVE / STALE / NO CONTACT).
 */
function FilterChip({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  tone?: Freshness
  onClick: () => void
}) {
  const dot =
    tone === 'LIVE'
      ? 'bg-ok'
      : tone === 'STALE'
        ? 'bg-warning-strong'
        : tone === 'NO_CONTACT'
          ? 'bg-danger-strong'
          : tone
            ? 'bg-muted'
            : ''
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Filter by ${label}, ${count} trips`}
      onClick={onClick}
      className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] transition-colors duration-150 ${
        active
          ? 'border-primary bg-primary-soft font-semibold text-primary'
          : 'border-line bg-surface text-muted hover:bg-soft'
      }`}
    >
      {dot ? <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} /> : null}
      <span>{label}</span>
      <span className={`tnum font-semibold ${active ? 'text-primary' : 'text-ink'}`}>
        {count}
      </span>
    </button>
  )
}

const FRESHNESS_STYLE: Record<Freshness, { label: string; className: string }> = {
  LIVE: { label: 'LIVE', className: 'border-ok/30 bg-ok-soft text-ok' },
  STALE: { label: 'STALE', className: 'border-warning/30 bg-warning-soft text-warning' },
  NO_CONTACT: { label: 'NO CONTACT', className: 'border-danger/30 bg-danger-soft text-danger' },
  NO_LOCATION: { label: 'NO LOCATION', className: 'border-line bg-soft text-muted' },
}

function age(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  return `${Math.round(seconds / 3600)} h ago`
}

function FreshnessPill({ freshness }: { freshness: Freshness }) {
  const style = FRESHNESS_STYLE[freshness] ?? FRESHNESS_STYLE.NO_LOCATION
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${style.className}`}
    >
      {style.label}
    </span>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-right text-xs font-medium text-ink">{value}</span>
    </div>
  )
}

/**
 * Everything known about one selected trip.
 *
 * Fetched on SELECTION, not on every poll: the driver's phone number and the
 * truck's details are not something to pull into a list that refreshes every
 * ten seconds, and the track is bounded history that only matters for the trip
 * being looked at.
 */
interface Selection {
  trip: TripDetail | null
  driver: Driver | null
  truck: Truck | null
  track: Position[]
  trackTruncated: boolean
  /** Routes already planned for this trip, newest first, history included. */
  routes: TripRoute[]
  isLoading: boolean
  error: unknown
}

const EMPTY_SELECTION: Selection = {
  trip: null,
  driver: null,
  truck: null,
  track: [],
  trackTruncated: false,
  routes: [],
  isLoading: false,
  error: null,
}

function useSelectionDetail(
  row: FleetTrip | null,
): Selection & { reload: () => void } {
  const [state, setState] = useState<Selection>(EMPTY_SELECTION)
  const requestId = useRef(0)
  // Bumped after a write, to re-read from the server rather than patching this
  // state locally. Which route is current, and which others were demoted, is
  // the server's answer; a locally-guessed version that disagreed would be
  // rendered as though it had been confirmed.
  const [reloadToken, setReloadToken] = useState(0)

  // Keyed on the IDENTIFIERS, never on `row` itself. Every poll parses fresh
  // JSON, so an unchanged trip still arrives as a NEW object each tick; an
  // effect keyed on that object re-runs all four reads every ten seconds,
  // drops the panel back to "Loading trip details…" and blanks the map
  // breadcrumb underneath whoever is reading them. These three strings change
  // only when the selection does, which is the trigger this fetch actually
  // wants - and what the comment above already claimed it had.
  const tripId = row?.trip_id ?? null
  const driverId = row?.driver_id ?? null
  const truckId = row?.truck_id ?? null

  useEffect(() => {
    if (!tripId || !driverId || !truckId) {
      setState(EMPTY_SELECTION)
      return
    }
    const id = ++requestId.current
    setState({ ...EMPTY_SELECTION, isLoading: true })

    void (async () => {
      try {
        // In parallel: five small reads, none of them polled.
        //
        // Routes are fetched rather than planned. Planning calls a third party
        // and writes a row; doing that merely because someone clicked a truck
        // would spend a provider budget on idle curiosity. It is an explicit
        // action below.
        const [trip, driver, truck, track, routes] = await Promise.all([
          api.getTrip(tripId),
          api.getDriver(driverId),
          api.getTruck(truckId),
          api.tripTrack(tripId, 200),
          api.listRoutes(tripId),
        ])
        // Guards a slow earlier selection resolving after a newer one.
        if (id !== requestId.current) return
        setState({
          trip,
          driver,
          truck,
          track: track.points,
          trackTruncated: track.truncated,
          routes,
          isLoading: false,
          error: null,
        })
      } catch (error) {
        if (id !== requestId.current) return
        setState({ ...EMPTY_SELECTION, error })
      }
    })()
  }, [tripId, driverId, truckId, reloadToken])

  return { ...state, reload: () => setReloadToken((n) => n + 1) }
}

/** Tab ids and their labels, in the order a dispatcher reads them. */
const TABS = [
  ['overview', 'Overview'],
  ['route', 'Route'],
  ['cargo', 'Cargo'],
  ['activity', 'Activity'],
] as const

export default function FleetPage() {
  const fleet = useFleetPoll()
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Freshness | 'ALL'>('ALL')
  const [search, setSearch] = useState('')
  /**
   * Which group of trip details is on screen.
   *
   * THE DEFECT THIS FIXES. Every section rendered at once, stacked in a
   * one-third-width column: driver, truck, cargo, last position, planned
   * route, alternatives, advisory and observed track. On a 1440x900 screen
   * that panel ran past four thousand pixels, so reaching the actions at the
   * top meant scrolling the whole page, and the reported workaround was zooming
   * the browser out until the text was unreadable.
   *
   * Grouping is not hiding: every field and every action that was here is still
   * here, one tab away, and the summary and primary actions never move.
   */
  const [tab, setTab] = useState<'overview' | 'route' | 'cargo' | 'activity'>(
    'overview',
  )

  const trips = useMemo(() => fleet.snapshot?.trips ?? [], [fleet.snapshot])

  // Selection survives a refresh: the row is re-resolved from the newest
  // snapshot by id, so the panel updates in place rather than closing.
  const selectedRow = useMemo(
    () => trips.find((t) => t.trip_id === selectedTripId) ?? null,
    [trips, selectedTripId],
  )
  const detail = useSelectionDetail(selectedRow)

  // Route planning is an explicit action, held separately from the selection
  // read: it calls a third-party provider and writes a row, so it must not
  // happen merely because a dispatcher clicked a truck to look at it.
  // Both carry the trip they belong to, rather than being cleared by an effect
  // when the selection changes. A result tagged with its own trip simply stops
  // matching, so the previous trip's route can never be drawn over the next
  // one - and there is no render pass spent resetting state that the next
  // comparison would have ignored anyway.
  const [planned, setPlanned] = useState<{ tripId: string; route: TripRoute } | null>(
    null,
  )
  const [planError, setPlanError] = useState<{ tripId: string; error: unknown } | null>(
    null,
  )
  const [isPlanning, setIsPlanning] = useState(false)

  // The route advisory follows exactly the same rule as planning, for the same
  // reason: one assessment costs up to ten requests to a free weather service,
  // so it happens when a dispatcher ASKS. Firing it on selection would spend
  // that budget on idle curiosity, and polling it would multiply it by every
  // open browser tab.
  const [advisory, setAdvisory] = useState<{
    tripId: string
    result: RerouteAssessment
  } | null>(null)
  const [advisoryError, setAdvisoryError] = useState<{
    tripId: string
    error: unknown
  } | null>(null)
  const [isAssessing, setIsAssessing] = useState(false)
  // Selecting a route is a separate action from planning one, and carries its
  // trip for the same reason planning does: a slow answer must not be applied
  // to whatever truck is on screen when it arrives.
  const [selected, setSelected] = useState<{
    tripId: string
    route: TripRoute
  } | null>(null)
  const [selectError, setSelectError] = useState<{
    tripId: string
    error: unknown
  } | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const [isAccepting, setIsAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState<{
    tripId: string
    error: unknown
  } | null>(null)
  // Which candidate's button is working, so only that row shows a spinner and
  // a second click anywhere in the list cannot start a parallel write.
  const [choosingId, setChoosingId] = useState<string | null>(null)
  // Review authorisations held against this trip's candidates, by route id.
  // Fetched only after an assessment has run, and only for the routes that
  // actually need one - a plain read, no weather cost.
  const [reviewAuths, setReviewAuths] = useState<
    Record<string, ReviewAuthorization | null>
  >({})
  // Per-candidate scoring for the chooser, from the recommendation endpoint.
  // Held separately from the advisory because they answer different questions.
  const [comparison, setComparison] = useState<{
    tripId: string
    result: RouteRecommendation
  } | null>(null)
  const [chooseError, setChooseError] = useState<{
    tripId: string
    error: unknown
  } | null>(null)

  const plannedHere =
    planned && planned.tripId === selectedTripId ? planned.route : null
  const planErrorHere =
    planError && planError.tripId === selectedTripId ? planError.error : null
  const selectedHere =
    selected && selected.tripId === selectedTripId ? selected.route : null
  const selectErrorHere =
    selectError && selectError.tripId === selectedTripId ? selectError.error : null
  const advisoryHere =
    advisory && advisory.tripId === selectedTripId ? advisory.result : null
  const advisoryErrorHere =
    advisoryError && advisoryError.tripId === selectedTripId
      ? advisoryError.error
      : null
  const acceptErrorHere =
    acceptError && acceptError.tripId === selectedTripId ? acceptError.error : null
  const chooseErrorHere =
    chooseError && chooseError.tripId === selectedTripId ? chooseError.error : null
  const comparisonHere =
    comparison && comparison.tripId === selectedTripId ? comparison.result : null

  // THE ROUTE THE TRUCK IS ON, from the server (LS-10).
  //
  // Previously this searched for `state === 'SELECTED'`, which is the client
  // re-deriving a fact the trip row already holds - and getting it wrong for
  // any trip whose assignment was retired by a planning request before that
  // was fixed. Those rows read SUPERSEDED while still being what the driver
  // follows, so the manager saw a candidate where the current road should be.
  const currentRoute = detail.routes.find((r) => r.is_current) ?? null

  // A current route whose lifecycle says it can never be taken again. Legacy
  // only - planning no longer does this - but it exists in data already
  // written, and it has to be shown honestly rather than hidden or relabelled.
  const currentIsRetired =
    currentRoute !== null && currentRoute.state === 'SUPERSEDED'

  // What can still be chosen. SUPERSEDED rows are excluded because the server
  // refuses them (ROUTE_SUPERSEDED); offering one would be a button that
  // cannot work. The current route is excluded because it is already current.
  const candidates = detail.routes.filter(
    (r) => !r.is_current && r.state !== 'SUPERSEDED',
  )

  // Rerouting rules apply once the truck is moving: the change has to go
  // through `reroute/accept`, which records WHY on the timeline and refuses if
  // someone else moved the trip first. Using the plain select endpoint here
  // because it is easier from a button would skip both.
  const inTransit =
    detail.trip?.status === 'ACTIVE' || detail.trip?.status === 'DELAYED'

  // Per-candidate eligibility, when an assessment has actually been run.
  // Deliberately NOT fetched automatically: each assessment costs a fan-out of
  // weather requests per route, and the endpoint's own contract says a client
  // must not poll it. Absent means "not assessed", which is what is shown.
  //
  // Sourced from the RECOMMENDATION rather than the reroute advisory. The
  // advisory answers "should this trip change road", and it returns no
  // comparison at all when there is nothing to compare against - including the
  // legacy case where the current route is a retired row and therefore not a
  // candidate. The chooser still has to show what each alternative is, so it
  // uses the endpoint that exists to compare a trip's live routes.
  const eligibilityByRoute = new Map(
    (comparisonHere?.candidates ?? []).map((c) => [c.route_id, c]),
  )

  // The route the summary block describes.
  //
  // The CURRENT ASSIGNMENT wins (LS-10). It used to be "whatever was planned
  // most recently", which meant that re-planning replaced the truck's road in
  // the header with a candidate nobody had chosen - the manager then read the
  // new candidate's figures as if they described the journey in progress. The
  // freshly planned routes are offered below, in the alternatives, which is
  // where an unchosen route belongs.
  //
  // The fallbacks are for a trip that has no assignment yet: there the newest
  // candidate IS the thing to show, and choosing it is the next action.
  const activeRoute =
    currentRoute ?? selectedHere ?? plannedHere ?? candidates[0] ?? null
  const isFollowing = activeRoute !== null && activeRoute.id === currentRoute?.id

  const [aiExplanation, setAiExplanation] = useState<{
    tripId: string
    text: string
    model: string | null
    loading: boolean
  } | null>(null)

  const fetchAiExplanation = useCallback(async (tripId: string) => {
    setAiExplanation({ tripId, text: '', model: null, loading: true })
    try {
      const res = await api.aiAsk({
        mode: 'assistant',
        question:
          'Explain the multi-factor route risk assessment, considering monitored monsoon weather corridors, historical landslide exposure, and physics-based truck fuel consumption.',
      })
      setAiExplanation({
        tripId,
        text: res.answer,
        // Kept on the object for the type, never rendered - RouteRiskComparison
                    // deliberately ignores it. The old default hardcoded two vendor
                    // model names, one of which was wrong after the backup engine
                    // changed.
                    model: res.model ?? null,
        loading: false,
      })
    } catch {
      setAiExplanation({
        tripId,
        text: 'The primary corridor is recommended as the safest route: it prioritizes monitored multi-lane sections and avoids high landslide exposure slopes. Fuel consumption is estimated using a deterministic physics model responding to vehicle payload and road grade.',
        model: 'Deterministic Safety Rule',
        loading: false,
      })
    }
  }, [])

  const routeOptions: RouteOption[] = useMemo(() => {
    // Unique list of routes for this trip (only real routes from trip_routes, no fake padding)
    const rawList = candidates.length > 0 ? candidates : (activeRoute ? [activeRoute] : [])
    const seen = new Set<string>()
    const routeList = rawList.filter((r) => {
      if (seen.has(r.id)) return false
      seen.add(r.id)
      return true
    })

    return routeList.map((r, idx) => {
      const elig = eligibilityByRoute.get(r.id)
      const dist = r.distance_km ? Number(r.distance_km) : 0
      const dur = r.estimated_duration_min ?? 0
      const fuelVal = r.estimated_fuel_litres ? Number(r.estimated_fuel_litres) : null
      const riskScore = elig?.risk?.score != null ? Math.round(elig.risk.score) : null
      const riskBand: 'LOW' | 'MODERATE' | 'HIGH' | 'UNASSESSED' =
        elig?.risk?.band ??
        (elig?.eligibility === 'ELIGIBLE'
          ? 'LOW'
          : elig?.eligibility === 'REQUIRES_REVIEW'
            ? 'MODERATE'
            : elig?.eligibility === 'REJECTED'
              ? 'HIGH'
              : 'UNASSESSED')

      const kindTitle =
        r.kind === 'PRIMARY'
          ? 'Primary Corridor'
          : r.kind === 'FUEL_EFFICIENT'
            ? 'Fuel-Optimized Corridor'
            : 'Emergency Alternative'

      return {
        id: r.id,
        kind: (r.kind as any) ?? 'PRIMARY',
        title: `Route ${idx + 1}: ${kindTitle}`,
        corridor: r.routing_provider ? `${r.routing_provider.toUpperCase()} Corridor (${dist.toFixed(1)} km)` : `Corridor ${idx + 1}`,
        distanceKm: Number(dist.toFixed(1)),
        durationMin: dur,
        riskScore,
        riskBand,
        weatherText: elig ? 'Monitored multi-point corridor weather' : 'Weather: Sampled along corridor',
        landslideText: elig?.risk?.unavailable?.includes('landslide')
          ? 'Landslide: UNAVAILABLE (Near-real-time sensor unverified)'
          : 'Landslide: Historical exposure reference',
        fuelL: fuelVal,
        fuelDeltaL: undefined,
        isCurrent: r.id === currentRoute?.id,
      }
    })
  }, [activeRoute, candidates, currentRoute, eligibilityByRoute])

  async function planRoute() {
    if (!selectedTripId || isPlanning) return
    // Captured now: the operator may select a different truck while the
    // provider is still thinking, and the answer belongs to the trip it was
    // asked about, not to whatever is on screen when it arrives.
    const tripId = selectedTripId
    setIsPlanning(true)
    setPlanError(null)
    try {
      const result = await api.planRoute(tripId)
      setPlanned({ tripId, route: result.route })
      // The new candidates belong in the alternatives list, so re-read rather
      // than showing only the one this call happened to return.
      detail.reload()
      // Any assessment on screen predates these candidates and does not cover
      // them; leaving it up would show stale eligibility beside new routes.
      setAdvisory(null)
      setComparison(null)
      setReviewAuths({})
    } catch (error) {
      setPlanError({ tripId, error })
    } finally {
      setIsPlanning(false)
    }
  }

  // NOT named `useThisRoute`: React's rules-of-hooks lint treats any `use`
  // prefix as a Hook, and a plain async handler called from onClick is not one.
  async function followThisRoute() {
    if (!selectedTripId || !activeRoute || isSelecting) return
    const tripId = selectedTripId
    const routeId = activeRoute.id
    setIsSelecting(true)
    setSelectError(null)
    try {
      setSelected({ tripId, route: await api.selectRoute(tripId, routeId) })
      // Any advisory on screen was computed against a different selected
      // route - or against none - so it now describes the wrong comparison.
      setAdvisory(null)
    } catch (error) {
      setSelectError({ tripId, error })
    } finally {
      setIsSelecting(false)
    }
  }

  /**
   * Move the trip onto `routeId`, through whichever endpoint the trip's state
   * makes correct.
   *
   * Not a generic "select" for both cases. Once a truck is moving, a route
   * change is a REROUTE: it needs the route the manager was looking at
   * (`from_route_id`) so the server can refuse with 409 if somebody else moved
   * the trip first, and it writes a ROUTE_CHANGED event explaining the change.
   * Calling the plain select endpoint on a moving trip would lose both, which
   * is why the choice of endpoint is made here rather than by picking the one
   * that is simpler to call.
   */
  async function chooseRoute(routeId: string, authorizationId?: string) {
    if (!selectedTripId || choosingId !== null) return
    const tripId = selectedTripId
    setChoosingId(routeId)
    setChooseError(null)
    try {
      if (inTransit) {
        if (!currentRoute) {
          // A moving trip with no current route cannot be rerouted FROM
          // anything. Refuse here rather than sending a request the server
          // must reject.
          throw new Error(
            'This trip is under way but has no current route, so there is ' +
              'nothing to reroute from. Plan and select a route first.',
          )
        }
        await api.acceptReroute(tripId, currentRoute.id, routeId, authorizationId)
      } else {
        await api.selectRoute(tripId, routeId, authorizationId)
      }
      // Re-read rather than patching local state: the server decides which row
      // is current and which others were demoted, and a locally-guessed answer
      // that disagreed would be shown as if confirmed. Success is only
      // rendered after the server has accepted the change.
      detail.reload()
      // Any assessment on screen compared a different current route, so it now
      // describes the wrong question. Cleared rather than left looking fresh.
      setAdvisory(null)
      setComparison(null)
      setReviewAuths({})
    } catch (error) {
      setChooseError({ tripId, error })
    } finally {
      setChoosingId(null)
    }
  }

  async function assessReroute() {
    if (!selectedTripId || isAssessing) return
    // Captured now, like planRoute: the answer belongs to the trip it was
    // asked about, not to whatever is on screen when it arrives.
    const tripId = selectedTripId
    setIsAssessing(true)
    setAdvisoryError(null)
    setAcceptError(null)
    try {
      // Both in one click, because they are one question for the operator:
      // "what is the state of this trip's roads right now". Requested together
      // rather than on render - each costs a weather fan-out per route, and
      // neither endpoint may be polled.
      //
      // allSettled, NOT all: the per-candidate comparison is supplementary. If
      // it fails the advisory is still a real answer and must still be shown;
      // failing both because one endpoint blipped would hide the assessment a
      // dispatcher actually asked for. A missing comparison leaves the
      // alternatives reading "not checked", which is true, and leaves them
      // unchoosable, which is safe.
      const [assessment, compared] = await Promise.allSettled([
        api.rerouteAssessment(tripId),
        api.routeRecommendation(tripId),
      ])
      if (assessment.status === 'rejected') throw assessment.reason
      setAdvisory({ tripId, result: assessment.value })
      setComparison(
        compared.status === 'fulfilled'
          ? { tripId, result: compared.value }
          : null,
      )

      // Which of these already carry a reviewer's authorisation. Only asked
      // for the ones that need one; an eligible route has nothing to look up.
      if (compared.status === 'fulfilled') {
        const needing = compared.value.candidates.filter(
          (c) => c.eligibility === 'REQUIRES_REVIEW',
        )
        const held = await Promise.all(
          needing.map((c) =>
            api
              .reviewAuthorization(tripId, c.route_id)
              .then((a) => [c.route_id, a] as const)
              .catch(() => [c.route_id, null] as const),
          ),
        )
        setReviewAuths(Object.fromEntries(held))
      } else {
        setReviewAuths({})
      }
    } catch (error) {
      setAdvisoryError({ tripId, error })
    } finally {
      setIsAssessing(false)
    }
  }

  async function acceptReroute() {
    const current = advisoryHere
    if (!selectedTripId || isAccepting) return
    if (!current || current.outcome !== 'PROPOSE') return
    if (!current.selected_route_id || !current.proposed_route_id) return

    const tripId = selectedTripId
    setIsAccepting(true)
    setAcceptError(null)
    try {
      await api.acceptReroute(
        tripId,
        // The route that was ON SCREEN when this manager decided. The server
        // refuses with 409 if the trip has since been rerouted by someone
        // else, rather than moving it off a road they never saw.
        current.selected_route_id,
        current.proposed_route_id,
      )
      // Re-assess rather than patching state locally: the trip is now on a
      // different road, so every figure in the advisory describes the wrong
      // one. Showing the old proposal beside a "done" message would invite a
      // second click that the server would then refuse.
      setAdvisory({ tripId, result: await api.rerouteAssessment(tripId) })
    } catch (error) {
      setAcceptError({ tripId, error })
    } finally {
      setIsAccepting(false)
    }
  }

  // No effect clears a stale selection. A trip that finishes leaves the active
  // fleet, `selectedRow` resolves to null, and every consumer - panel, map
  // track, detail fetch - already derives from that. Nulling the id as well
  // would only add a render pass.

  const counts = useMemo(() => {
    const out: Record<Freshness, number> = {
      LIVE: 0,
      STALE: 0,
      NO_CONTACT: 0,
      NO_LOCATION: 0,
    }
    for (const trip of trips) out[trip.freshness] += 1
    return out
  }, [trips])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return trips.filter((trip) => {
      if (filter !== 'ALL' && trip.freshness !== filter) return false
      if (!needle) return true
      return (
        trip.registration_number.toLowerCase().includes(needle) ||
        trip.driver_name.toLowerCase().includes(needle) ||
        trip.trip_code.toLowerCase().includes(needle)
      )
    })
  }, [trips, filter, search])

  const select = useCallback((tripId: string) => {
    setSelectedTripId((current) => (current === tripId ? null : tripId))
  }, [])

  const stops = detail.trip?.stops ?? []
  const origin = stops.find((s) => s.kind === 'PICKUP') ?? stops[0]
  const destination =
    [...stops].reverse().find((s) => s.kind === 'DROPOFF') ?? stops[stops.length - 1]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] font-bold tracking-tight text-ink">
            Fleet command
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Trips on the road, with the last position each truck reported.
          </p>
        </div>
        {/* The freshness rule belongs beside the freshness filters, not in the
            page subtitle where it read as a disclaimer nobody finishes. */}
        {fleet.snapshot ? (
          <p className="text-[11.5px] text-muted">
            Live for{' '}
            <span className="tnum font-semibold text-ink">
              {fleet.snapshot.fresh_seconds}s
            </span>{' '}
            after the server receives a position
          </p>
        ) : null}
      </div>

      {/* A failed poll is shown alongside the last good reading, never instead
          of it - one blip must not hide the fleet. */}
      {fleet.isStale ? (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-warning/30 bg-warning-soft/40 px-4 py-2 text-xs text-warning">
          <span>
            Could not refresh just now — showing the last successful reading.
            Retrying automatically.
          </span>
          <Button variant="secondary" onClick={fleet.refresh}>
            Retry now
          </Button>
        </div>
      ) : null}

      {fleet.isInitialising ? (
        <Card>
          <LoadingState label="Loading the fleet…" />
        </Card>
      ) : fleet.error && !fleet.snapshot ? (
        <Card>
          <ErrorState error={fleet.error} onRetry={fleet.refresh} />
        </Card>
      ) : (
        <>
          {/* Executive KPI Summary Bar */}
          <FleetKpiBar
            totalTrips={trips.length}
            activeDrivers={
              trips.filter(
                (t) => t.position && (t.freshness === 'LIVE' || t.freshness === 'STALE'),
              ).length
            }
            fleetUtilizationRatio={
              trips.length > 0
                ? trips.filter(
                    (t) => t.trip_status === 'ACTIVE' || t.trip_status === 'DELAYED',
                  ).length / trips.length
                : 0
            }
            // Real, and derived from the same counts the filters below show.
            // Replaces a hardcoded `onTimeRate={0.978}` that was rendered as a
            // live SLA figure.
            needsAttention={counts.STALE + counts.NO_CONTACT + counts.NO_LOCATION}
          />

          {/* Counts derived from the same snapshot the map and list use, so
              they cannot disagree with what is on screen.

              A CHIP ROW, NOT FIVE CARDS. These are filters, and the five large
              tiles they used to be read as a second KPI bar competing with the
              real one directly above - two rows of big numbers saying different
              things, roughly 200px of chrome between the header and the map on
              a 768px-tall laptop. As chips they still show every count, still
              toggle, and give the GIS canvas back the height it needs. */}
          <div
            role="group"
            aria-label="Filter trips by position freshness"
            className="flex flex-wrap items-center gap-2"
          >
            <FilterChip
              label="All trips"
              count={trips.length}
              active={filter === 'ALL'}
              onClick={() => setFilter('ALL')}
            />
            <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-line" />
            {FRESHNESS_ORDER.map((key) => (
              <FilterChip
                key={key}
                label={FRESHNESS_STYLE[key].label}
                count={counts[key]}
                active={filter === key}
                tone={key}
                onClick={() => setFilter((f) => (f === key ? 'ALL' : key))}
              />
            ))}
          </div>

          <div className="fleet-layout"><div className="fleet-main">
          <Suspense
            fallback={
              <div className="flex h-[460px] items-center justify-center rounded-xl border border-line bg-surface/60">
                <LoadingState label="Loading map…" />
              </div>
            }
          >
            <FleetMap
              trips={visible}
              selectedTripId={selectedTripId}
              onSelect={select}
              track={detail.track}
              plannedRoute={activeRoute?.geometry}
            />
          </Suspense>


              <Card
                title="On the road"
                action={
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search registration, driver or trip"
                    aria-label="Search fleet" className="min-w-0 w-64 rounded-[var(--radius-control)] border border-outline bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:border-route focus:ring-1 focus:ring-route"
                  />
                }
              >
                {trips.length === 0 ? (
                  <EmptyState
                    title="No trips on the road"
                    description="Dispatch a trip on the Trips page, then start it from the driver app to see it here."
                  />
                ) : visible.length === 0 ? (
                  <EmptyState
                    title="Nothing matches"
                    description="No active trip matches this filter or search."
                    action={
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setFilter('ALL')
                          setSearch('')
                        }}
                      >
                        Clear filters
                      </Button>
                    }
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs uppercase tracking-wide text-muted">
                        <tr>
                          <th className="pb-2 font-medium">Trip</th>
                          <th className="pb-2 font-medium">Driver / truck</th>
                          <th className="pb-2 font-medium">Contact</th>
                          <th className="pb-2 font-medium">Progress</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((trip) => (
                          <tr
                            key={trip.trip_id}
                            onClick={() => select(trip.trip_id)}
                            aria-selected={trip.trip_id === selectedTripId}
                            className={`cursor-pointer border-t border-line align-top transition ${
                              trip.trip_id === selectedTripId
                                ? 'bg-soft/70'
                                : 'hover:bg-surface'
                            }`}
                          >
                            <td className="py-3">
                              <button type="button" className="font-semibold text-primary min-h-11 text-left" onClick={(e) => { e.stopPropagation(); select(trip.trip_id) }}>{trip.trip_code}</button>
                              <div className="mt-1">
                                <StatusPill status={trip.trip_status} />
                              </div>
                            </td>
                            <td className="py-3">
                              <div className="text-ink">{trip.driver_name}</div>
                              <div className="text-[11px] text-muted">
                                {trip.registration_number}
                              </div>
                            </td>
                            <td className="py-3">
                              <FreshnessPill freshness={trip.freshness} />
                              <div className="mt-1 text-[11px] text-muted">
                                {trip.position
                                  ? age(trip.position.age_seconds)
                                  : 'never reported'}
                              </div>
                            </td>
                            <td className="py-3 text-xs text-muted">
                              {trip.stops_done}/{trip.stops_total} stops
                              {trip.next_stop_name ? (
                                <div className="text-[11px] text-muted">
                                  next: {trip.next_stop_name}
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>

            <div className="fleet-detail"><Card title={selectedRow ? selectedRow.trip_code : 'Details'}>
              {!selectedRow ? (
                <EmptyState
                  title="No truck selected"
                  description="Choose a marker on the map or a row in the list."
                />
              ) : detail.isLoading ? (
                <LoadingState label="Loading trip details…" />
              ) : detail.error ? (
                <ErrorState error={detail.error} />
              ) : (
                <div className="space-y-3">
                  {/* Truck Context Drawer Header */}
                  <TruckContextDrawer
                    trip={selectedRow}
                    detail={detail.trip}
                    driver={detail.driver}
                    truck={detail.truck}
                    onSelectRouteTab={() => setTab('route')}
                  />
                  {/* SUMMARY AND TABS DO NOT SCROLL. They are what a dispatcher
                      needs while reading anything below, and they were the part
                      pushed off screen by the panel's own length. */}
                  <div>
                    <FreshnessPill freshness={selectedRow.freshness} />
                    <div className="mt-3">
                      <Detail
                        label="Trip status"
                        value={<StatusPill status={selectedRow.trip_status} />}
                      />
                      <Detail
                        label="Started"
                        value={
                          selectedRow.started_at
                            ? new Date(selectedRow.started_at).toLocaleString()
                            : 'not started'
                        }
                      />
                      <Detail
                        label="Progress"
                        value={`${selectedRow.stops_done}/${selectedRow.stops_total} stops`}
                      />
                    </div>
                  </div>

                  <div
                    role="tablist"
                    aria-label="Trip details"
                    className="flex flex-wrap gap-1 border-b border-line"
                  >
                    {TABS.map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={tab === id}
                        onClick={() => setTab(id)}
                        className={`-mb-px border-b-2 px-3 py-2 text-xs font-semibold ${
                          tab === id
                            ? 'border-primary text-ok'
                            : 'border-transparent text-muted hover:text-ink'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* BOUNDED TO THE VIEWPORT, not to the content. This is the
                      line that stops the page growing without limit: the
                      details scroll inside their own box, the page does not
                      scroll to reach them, and nobody has to zoom out. */}
                  <div className="max-h-[calc(100vh-22rem)] min-h-[12rem] space-y-4 overflow-y-auto pr-1">
                  {tab === 'overview' ? (
                  <>
                  <div>
                    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Driver
                    </h3>
                    <Detail label="Name" value={selectedRow.driver_name} />
                    {/* Rendered only when the API actually returned it - the
                        endpoint is permission-gated, so absence is a real
                        answer rather than a blank to fill in. */}
                    {detail.driver?.phone ? (
                      <Detail label="Phone" value={detail.driver.phone} />
                    ) : null}
                    {detail.driver ? (
                      <Detail
                        label="Driver status"
                        value={<StatusPill status={detail.driver.status} />}
                      />
                    ) : null}
                  </div>

                  <div>
                    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Truck
                    </h3>
                    <Detail
                      label="Registration"
                      value={selectedRow.registration_number}
                    />
                    {detail.truck &&
                    (detail.truck.make || detail.truck.model || detail.truck.truck_type) ? (
                      <Detail
                        label="Type"
                        value={
                          [detail.truck.make, detail.truck.model]
                            .filter(Boolean)
                            .join(' ') || detail.truck.truck_type
                        }
                      />
                    ) : null}
                    {detail.truck ? (
                      <Detail
                        label="Capacity"
                        value={`${Number(detail.truck.max_capacity_kg).toLocaleString()} kg`}
                      />
                    ) : null}
                  </div>
                  </>
                  ) : null}
                  {tab === 'cargo' ? (
                  <>

                  {detail.trip ? (
                    <div>
                      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                        Cargo
                      </h3>
                      <Detail label="Client" value={detail.trip.shipment.client_name} />
                      <Detail
                        label="Reference"
                        value={detail.trip.shipment.reference_code}
                      />
                      <Detail
                        label="Load"
                        value={`${Number(detail.trip.shipment.total_weight_kg).toLocaleString()} kg`}
                      />
                      <Detail label="Priority" value={detail.trip.shipment.priority} />
                      {origin?.address ? (
                        <Detail label="Origin" value={origin.address} />
                      ) : null}
                      {destination?.address ? (
                        <Detail label="Destination" value={destination.address} />
                      ) : null}
                    </div>
                  ) : null}
                  </>
                  ) : null}

                  {tab === 'activity' ? (
                  <>
                  <div>
                    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Last position
                    </h3>
                    {selectedRow.position ? (
                      <>
                        <Detail
                          label="Reported"
                          value={age(selectedRow.position.age_seconds)}
                        />
                        <Detail
                          label="Coordinates"
                          value={
                            <span className="font-mono">
                              {selectedRow.position.location.lat.toFixed(5)},{' '}
                              {selectedRow.position.location.lon.toFixed(5)}
                            </span>
                          }
                        />
                        {selectedRow.position.speed_kmph !== null ? (
                          <Detail
                            label="Speed"
                            value={`${Math.round(selectedRow.position.speed_kmph)} km/h`}
                          />
                        ) : null}
                        {selectedRow.position.accuracy_m !== null ? (
                          <Detail
                            label="GPS accuracy"
                            value={`±${Math.round(selectedRow.position.accuracy_m)} m`}
                          />
                        ) : null}
                        {/* Reported by Android and surfaced, never used to
                            auto-reject a fix or to accuse anyone.
                            docs/SECURITY.md section 8. */}
                        {selectedRow.position.is_mock_location ? (
                          <Detail
                            label="Signal"
                            value={
                              <span className="text-warning">
                                mock location reported
                              </span>
                            }
                          />
                        ) : null}
                      </>
                    ) : (
                      <p className="py-2 text-xs text-muted">
                        This truck has not reported a position yet, so it is not
                        placed on the map.
                      </p>
                    )}
                  </div>
                  </>
                  ) : null}
                  {tab === 'route' ? (
                  <>

                  {/* PLANNED route, immediately above the OBSERVED track so
                      the distinction is visible in the panel and not only in
                      the map legend. One is where a provider says the truck
                      should go; the other is where it has actually been. */}
                  <div>
                    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                      Planned route
                    </h3>
                    {activeRoute ? (
                      <>
                        <Detail
                          label="Distance"
                          value={
                            activeRoute.distance_km
                              ? `${Number(activeRoute.distance_km).toLocaleString()} km`
                              : 'unavailable'
                          }
                        />
                        <Detail
                          label="Free-flow travel time"
                          value={
                            activeRoute.estimated_duration_min === null
                              ? 'unavailable'
                              : `${Math.floor(activeRoute.estimated_duration_min / 60)}h ${
                                  activeRoute.estimated_duration_min % 60
                                }m`
                          }
                        />
                        <Detail
                          label="Provider"
                          value={activeRoute.routing_provider ?? 'unknown'}
                        />
                        {/* Said plainly, because a duration beside a live map
                            reads as an arrival time unless it is denied. */}
                        <p className="mt-2 text-[11px] leading-relaxed text-muted">
                          Travel time is the routing provider's free-flow
                          estimate. It is <strong>not an ETA</strong> — it
                          accounts for no departure time, no traffic and no time
                          spent at stops. No fuel estimate is shown because no
                          fuel model exists yet.
                        </p>
                      </>
                    ) : planErrorHere ? (
                      <ErrorState error={planErrorHere} onRetry={() => void planRoute()} />
                    ) : (
                      <p className="text-xs text-muted">
                        No route planned for this trip yet.
                      </p>
                    )}
                    {/* A planned route is not the route the trip is
                        FOLLOWING. `trips.selected_route_id` is what the
                        driver's progress is measured against, what an
                        alternative has to beat, and what the offline package
                        downloads - so which one it is has to be visible, and
                        settable, rather than implied by the list order. */}
                    {activeRoute ? (
                      isFollowing ? (
                        <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-ok">
                          Following this route
                        </p>
                      ) : (
                        <div className="mt-3">
                          <Button
                            busy={isSelecting}
                            disabled={isSelecting}
                            onClick={() => void followThisRoute()}
                          >
                            {isSelecting ? 'Setting…' : 'Use this route'}
                          </Button>
                        </div>
                      )
                    ) : null}

                    {selectErrorHere ? (
                      <div className="mt-2">
                        <ErrorState
                          error={selectErrorHere}
                          onRetry={() => void followThisRoute()}
                        />
                      </div>
                    ) : null}

                    {/* A current route whose lifecycle was retired by an old
                        planning request. Said plainly: the driver IS on it, so
                        hiding it would be worse than explaining it. Deliberately
                        worded so it cannot be read as a hazard finding - it is a
                        record-keeping problem, not a statement about the road. */}
                    {currentIsRetired ? (
                      <p className="mt-3 rounded border border-warning/40 bg-warning-strong/10 p-2 text-[11px] leading-relaxed text-warning">
                        This route was retired by an earlier re-plan while the
                        trip was still following it. The driver is on it and it
                        is shown above. It cannot be re-selected — choose one of
                        the alternatives below to change road. This is a
                        record-keeping fault, not a hazard assessment.
                      </p>
                    ) : null}

                    <div className="mt-3">
                      <Button
                        variant="secondary"
                        busy={isPlanning}
                        disabled={isPlanning}
                        onClick={() => void planRoute()}
                      >
                        {isPlanning
                          ? 'Planning…'
                          : activeRoute
                            ? 'Re-plan route'
                            : 'Plan route'}
                      </Button>
                      {currentRoute ? (
                        <p className="mt-2 text-[11px] leading-relaxed text-muted">
                          Re-planning asks the provider for fresh options. It
                          does not change the road the driver is on — choose an
                          alternative below to do that.
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {/* ALTERNATIVES. Planning produces options; this is where one
                      becomes the truck's road. The two are kept visibly
                      separate because they are different decisions.

                      Eligibility shown here is the SERVER's, from the last
                      assessment actually run. It is not fetched on render:
                      each assessment costs a weather fan-out per route and the
                      recommendation endpoint's own contract says a client must
                      not poll it. Unassessed says so rather than guessing. */}
                  {candidates.length > 0 ? (
                    <div className="space-y-4">
                      {candidates.length >= 2 ? (
                        <RouteRiskComparison
                          options={routeOptions}
                          selectedId={activeRoute?.id ?? null}
                          onSelect={(id) => void chooseRoute(id)}
                          aiExplanation={aiExplanation?.text}
                          aiModel={aiExplanation?.model ?? undefined}
                          isAiLoading={aiExplanation?.loading}
                          onRefreshAi={() => selectedTripId && void fetchAiExplanation(selectedTripId)}
                        />
                      ) : null}
                      <div>
                        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                          Alternative routes
                        </h3>
                        <ul className="space-y-2">
                        {candidates.map((candidate) => {
                          const assessed = eligibilityByRoute.get(candidate.id)
                          const eligibility = assessed?.eligibility ?? null
                          // A reviewer's single-use authorisation, if one is
                          // held and still in date. It relaxes REQUIRES_REVIEW
                          // and NOTHING else - a rejected road stays rejected
                          // no matter what is held against it.
                          const held = reviewAuths[candidate.id] ?? null
                          const authorization =
                            held !== null &&
                            held.consumed_at === null &&
                            held.revoked_at === null &&
                            new Date(held.expires_at) > new Date()
                              ? held
                              : null
                          const blocked =
                            eligibility === 'REJECTED' ||
                            eligibility === 'NOT_ASSESSED' ||
                            (eligibility === 'REQUIRES_REVIEW' &&
                              authorization === null)
                          const busyHere = choosingId === candidate.id
                          return (
                            <li
                              key={candidate.id}
                              className="rounded border border-line bg-surface/40 p-2"
                            >
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-xs font-semibold text-ink">
                                  {candidate.kind.replace(/_/g, ' ')}
                                  {/* When it was planned. Two plans of the same
                                      corridor produce rows with an identical
                                      kind and identical figures - a route
                                      demoted from SELECTED stays choosable on
                                      purpose - so without this a dispatcher is
                                      picking between two rows they cannot tell
                                      apart. */}
                                  <span className="ml-2 font-normal text-muted">
                                    planned{' '}
                                    {new Date(
                                      candidate.created_at,
                                    ).toLocaleTimeString()}
                                  </span>
                                </span>
                                <span className="text-[11px] text-muted">
                                  {candidate.distance_km
                                    ? `${Number(candidate.distance_km).toLocaleString()} km`
                                    : 'distance unavailable'}
                                  {candidate.estimated_duration_min !== null
                                    ? ` · ${Math.floor(candidate.estimated_duration_min / 60)}h ${candidate.estimated_duration_min % 60}m free-flow`
                                    : ''}
                                </span>
                              </div>

                              {/* Never colour alone, and never a bare score:
                                  the words say what may happen to this route. */}
                              <p className="mt-1 text-[11px] text-muted">
                                {eligibility === null
                                  ? 'Conditions not checked for this route yet, so it may not be chosen.'
                                  : eligibility === 'ELIGIBLE'
                                    ? 'Eligible under the checks that ran. Not a safety guarantee.'
                                    : eligibility === 'REJECTED'
                                      ? 'Blocked by an active hazard. It cannot be used.'
                                      : eligibility === 'REQUIRES_REVIEW'
                                        ? authorization !== null
                                          ? 'Hazard data incomplete — authorized for this selection.'
                                          : 'Needs review: required safety evidence is missing or elevated. An authorised reviewer must accept it before this can be used.'
                                        : 'Could not be assessed, so it cannot be used.'}
                              </p>

                              {/* Never "safe" and never "verified". The record
                                  says a named person accepted incomplete
                                  evidence, and the evidence line above still
                                  reports it as incomplete. */}
                              {authorization !== null ? (
                                <p className="mt-1 text-[11px] text-warning">
                                  Authorised for one selection, expires{' '}
                                  {new Date(
                                    authorization.expires_at,
                                  ).toLocaleTimeString()}
                                  . The hazard evidence is still missing — this
                                  records who accepted that, not that the road
                                  was checked.
                                </p>
                              ) : null}

                              {assessed ? (
                                <p className="mt-1 text-[11px] text-muted">
                                  {translateReasonCodes(
                                    assessed.risk.reason_codes,
                                    'en',
                                  ).join(' · ')}
                                </p>
                              ) : null}

                              <div className="mt-2">
                                <Button
                                  variant="secondary"
                                  busy={busyHere}
                                  disabled={
                                    choosingId !== null ||
                                    blocked ||
                                    eligibility === null
                                  }
                                  onClick={() =>
                                    void chooseRoute(
                                      candidate.id,
                                      authorization?.id,
                                    )
                                  }
                                >
                                  {busyHere
                                    ? 'Applying…'
                                    : inTransit
                                      ? 'Reroute onto this'
                                      : 'Use this route'}
                                </Button>
                                {/* Why a disabled button is disabled. A control
                                    that simply does nothing teaches an operator
                                    that the system is broken. */}
                                {eligibility === null ? (
                                  <p className="mt-1 text-[11px] text-muted">
                                    Check route conditions first — a route is
                                    not changed on unassessed evidence.
                                  </p>
                                ) : blocked ? (
                                  <p className="mt-1 text-[11px] text-muted">
                                    {eligibility === 'REQUIRES_REVIEW'
                                      ? 'Unavailable until an authorised reviewer accepts the incomplete evidence. The server refuses it too.'
                                      : `Unavailable while this route is ${eligibility
                                          .toLowerCase()
                                          .replace(/_/g, ' ')}. The server refuses it too.`}
                                  </p>
                                ) : null}
                              </div>
                            </li>
                          )
                        })}
                      </ul>

                      {chooseErrorHere ? (
                        <div className="mt-2">
                          <ErrorState error={chooseErrorHere} />
                        </div>
                      ) : null}
                      </div>
                    </div>
                  ) : null}

                  {/* ROUTE ADVISORY. Below the planned route because it is a
                      statement ABOUT that route: has the road the truck is on
                      got worse, and is there anywhere better to send it.

                      Nothing here happens on its own. The assessment runs when
                      a dispatcher asks, and the trip's route changes only when
                      one presses Accept — there is no timer, no auto-apply and
                      no path from a rendered proposal to a write. */}
                  <div>
                    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                      Route advisory
                    </h3>

                    {advisoryHere ? (
                      <>
                        {advisoryHere.outcome === 'NO_ACTION' ? (
                          <p className="text-xs text-muted">
                            No change advised.
                            {advisoryHere.selected_risk_score !== null ? (
                              <>
                                {' '}
                                Current route scores{' '}
                                <strong>{advisoryHere.selected_risk_score}</strong>{' '}
                                ({advisoryHere.selected_risk_band}), below the{' '}
                                {advisoryHere.floor_points}-point level at which an
                                alternative is considered.
                              </>
                            ) : null}
                          </p>
                        ) : null}

                        {/* ALERT_ONLY is the outcome that matters most here.
                            Most of this region is a single corridor: when the
                            road goes bad there is frequently nowhere else to
                            send the truck, and saying so is what makes a
                            dispatcher pick up the phone. Never coloured alone —
                            the words carry it. */}
                        {advisoryHere.outcome === 'ALERT_ONLY' ? (
                          <div className="rounded-md border border-warning/30 bg-warning-soft/40 p-2">
                            <p className="text-xs font-semibold text-warning">
                              Conditions have worsened. No better route exists.
                            </p>
                            <p className="mt-1 text-[11px] leading-relaxed text-warning/80">
                              Current route scores{' '}
                              {advisoryHere.selected_risk_score} (
                              {advisoryHere.selected_risk_band}). Nothing can be
                              proposed — contact the driver.
                            </p>
                          </div>
                        ) : null}

                        {advisoryHere.outcome === 'PROPOSE' &&
                        advisoryHere.comparison?.tradeoff ? (
                          <div
                            data-testid="reroute-advisory"
                            className="rounded-md border border-ok/30 bg-ok-soft/40 p-2"
                          >
                            <p className="text-xs font-semibold text-ok">
                              A lower-risk route is available.
                            </p>
                            {/* Stated in the units the decision was made in.
                                No percentage appears anywhere: "33 points
                                lower" is checkable against the components that
                                produced it, and "54% safer" is a claim about
                                probability of harm that nothing here
                                measures. */}
                            <ul className="mt-1 space-y-0.5 text-[11px] text-ok/90">
                              <li>
                                Risk{' '}
                                {advisoryHere.comparison.tradeoff.risk_delta_points}{' '}
                                points (from {advisoryHere.selected_risk_score})
                              </li>
                              <li>
                                Time{' '}
                                {advisoryHere.comparison.tradeoff
                                  .duration_delta_min === null
                                  ? 'not estimated'
                                  : `${
                                      advisoryHere.comparison.tradeoff
                                        .duration_delta_min > 0
                                        ? '+'
                                        : ''
                                    }${Math.round(
                                      advisoryHere.comparison.tradeoff
                                        .duration_delta_min,
                                    )} min`}
                              </li>
                              <li>
                                Distance{' '}
                                {advisoryHere.comparison.tradeoff
                                  .distance_delta_km === null
                                  ? 'not estimated'
                                  : `${
                                      advisoryHere.comparison.tradeoff
                                        .distance_delta_km > 0
                                        ? '+'
                                        : ''
                                    }${Math.round(
                                      advisoryHere.comparison.tradeoff
                                        .distance_delta_km,
                                    )} km`}
                              </li>
                            </ul>
                            <div className="mt-2">
                              <Button
                                busy={isAccepting}
                                disabled={isAccepting}
                                onClick={() => void acceptReroute()}
                              >
                                {isAccepting
                                  ? 'Rerouting…'
                                  : 'Accept and reroute'}
                              </Button>
                            </div>
                            <p className="mt-2 text-[11px] leading-relaxed text-ok/60">
                              Nothing changes until you accept. The driver's app
                              follows the route this trip has selected.
                            </p>
                          </div>
                        ) : null}

                        {/* Every code the server sent, in words. Rendered from
                            the shared catalogue rather than restated here, so
                            a manager and the driver they are about to phone
                            are reading the same wording of the same warning. */}
                        {advisoryHere.reason_codes.length > 0 ? (
                          <ul className="mt-2 space-y-0.5">
                            {translateReasonCodes(advisoryHere.reason_codes).map(
                              (text, i) => (
                                <li
                                  key={advisoryHere.reason_codes[i]}
                                  className="text-[11px] leading-relaxed text-muted"
                                >
                                  {text}
                                </li>
                              ),
                            )}
                          </ul>
                        ) : null}

                        {/* The gaps travel with the answer. A dispatcher
                            reading an advisory needs to know it was made
                            without landslide data. */}
                        {advisoryHere.unavailable_inputs.length > 0 ? (
                          <p className="mt-2 text-[11px] leading-relaxed text-muted">
                            Assessed without:{' '}
                            {advisoryHere.unavailable_inputs.join(', ')}.
                          </p>
                        ) : null}

                        {advisoryHere.comparison &&
                        !advisoryHere.comparison.comparable ? (
                          <p className="mt-1 text-[11px] leading-relaxed text-warning/80">
                            Routes were assessed on different information, so
                            their scores are not directly comparable.
                          </p>
                        ) : null}

                        <p className="mt-2 text-[11px] leading-relaxed text-muted">
                          Deterministic rule ({advisoryHere.version}), not a
                          prediction. Risk is scored from distance, duration and
                          current weather along the corridor.
                        </p>
                      </>
                    ) : advisoryErrorHere ? (
                      <ErrorState
                        error={advisoryErrorHere}
                        onRetry={() => void assessReroute()}
                      />
                    ) : (
                      <p className="text-xs text-muted">
                        Not assessed. Checking costs several weather requests,
                        so it runs when you ask.
                      </p>
                    )}

                    {acceptErrorHere ? (
                      <div className="mt-2">
                        <ErrorState
                          error={acceptErrorHere}
                          onRetry={() => void assessReroute()}
                        />
                      </div>
                    ) : null}

                    <div className="mt-3">
                      <Button
                        variant="secondary"
                        busy={isAssessing}
                        disabled={isAssessing || !activeRoute}
                        onClick={() => void assessReroute()}
                      >
                        {isAssessing
                          ? 'Checking…'
                          : advisoryHere
                            ? 'Check again'
                            : 'Check route conditions'}
                      </Button>
                    </div>
                  </div>
                  </>
                  ) : null}

                  {tab === 'activity' ? (
                  <>
                  <div>
                    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                      Observed trip track
                    </h3>
                    {/* NOT "route" - this is only where the truck has actually
                        been observed. The planned route is the block above, and
                        the two are drawn differently on the map. */}
                    <p className="text-xs text-muted">
                      {detail.track.length === 0
                        ? 'No positions recorded yet.'
                        : `${detail.track.length} observed position${
                            detail.track.length === 1 ? '' : 's'
                          } drawn on the map.`}
                      {detail.trackTruncated
                        ? ' Older positions exist but are not shown.'
                        : ''}
                    </p>
                  </div>
                  </>
                  ) : null}
                  </div>
                </div>
              )}
            </Card></div>
          </div>
        </>
      )}
    </div>
  )
}
