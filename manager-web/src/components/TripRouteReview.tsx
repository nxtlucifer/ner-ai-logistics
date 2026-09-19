import { lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Map as MapIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api, type ReviewAuthorization, type RouteRecommendation, type RouteRiskSummary, type Trip, type TripDetail, type TripRoute } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Button, Card, EmptyState, ErrorState, LoadingState, MapLoadBoundary, StatusPill, type PillTone } from './ui'
import { RouteApprovalDialog } from './RouteApprovalDialog'
import JourneyHistory from './JourneyHistory'
import { factorLabels, translateReasonCodes } from '../i18n/reasonCodes'
import { asked } from '../staleChunk'
import { awaitingReroute, REROUTE_ASKED } from '../pages/tripExport'

// Asked for by opening the review: a stale tab reloads even if the planner's
// map prefetch is out at the same moment.
const FleetMap = lazy(() => asked(() => import('./FleetMap')))

/** Draft route review uses the same authoritative selection API as Fleet.
 * The parent keys this panel by trip id so another draft cannot inherit it.
 */
/**
 * The corridor's terrain and its recorded landslide history, with provenance.
 *
 * Two evidence blocks the engine attaches when it had them. Each says WHAT it
 * measured, from WHERE, and how COMPLETE it is - the same three things the
 * driver's Safety cards say - so a dispatcher and a driver reading the same
 * route read the same evidence.
 *
 * Nothing here is a probability. `HIGH` on the history block means three or
 * more recorded slides within 5 km of the road in the inventory - a published
 * threshold, stated in the copy.
 */
/** Weather / Terrain / Warnings / Traffic as AVAILABLE or UNKNOWN. An area
 *  nothing answered for is unknown, never clear. */
function evidenceCoverage(risk: RouteRiskSummary): string {
  const rows: [string, boolean][] = [
    ['Weather', !risk.unavailable.includes('weather')],
    ['Terrain', !!risk.terrain?.usable],
    ['Warnings', !!risk.official_warnings && risk.official_warnings.level !== 'UNKNOWN'],
    ['Traffic', !!risk.traffic && risk.traffic.status !== 'UNKNOWN'],
  ]
  return rows.map(([name, ok]) => `${name} ${ok ? 'AVAILABLE' : 'UNKNOWN'}`).join(' · ')
}

/** One evidence source: what it measured, from where, how complete. A soft
 *  tile inside the review card, never a bordered card inside it. */
function EvidenceTile({ name, tag, tone, testId, className = '', children }: { name: string; tag: string; tone: PillTone; testId: string; className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-[10px] bg-soft p-3 ${className}`} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{name}</span>
        <StatusPill status={tag} label={tag} tone={tone} />
      </div>
      {children}
    </div>
  )
}

function TerrainHazardSummary({ risk }: { risk: RouteRiskSummary }) {
  const terrain = risk.terrain ?? null
  const history = risk.landslide_history ?? null
  const flood = risk.flood ?? null
  const warnings = risk.official_warnings ?? null
  const traffic = risk.traffic ?? null
  if (!terrain && !history && !flood && !warnings && !traffic) return null
  const tone = (label: string): PillTone =>
    label === 'HIGH' ? 'danger' : label === 'MODERATE' ? 'warning' : label === 'LOW' ? 'success' : 'muted'
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <EvidenceTile
        name="Terrain"
        testId="terrain-summary"
        tag={terrain ? (terrain.usable ? (terrain.steep_km > 0 ? `${terrain.steep_km.toFixed(1)} KM STEEP` : 'NO STEEP STRETCH') : 'PARTIAL') : 'NOT MEASURED'}
        tone={terrain ? (terrain.usable ? (terrain.steep_km > 0 ? tone('MODERATE') : tone('LOW')) : tone('UNKNOWN')) : tone('UNKNOWN')}
      >
        {terrain ? (
          <>
            <p className="tnum mt-1.5 text-[13px] leading-snug text-ink">
              {terrain.min_elevation_m !== null && terrain.max_elevation_m !== null
                ? `${Math.round(terrain.min_elevation_m)}–${Math.round(terrain.max_elevation_m)} m`
                : 'Height range not known'}
              {' · '}
              {Math.round(terrain.total_ascent_m)} m climb · steepest {terrain.max_grade_pct.toFixed(1)}%
            </p>
            <p className="tnum mt-1 text-[12.5px] text-muted">
              {(['FLAT', 'ROLLING', 'HILLY', 'STEEP'] as const)
                .filter(k => (terrain.class_km[k] ?? 0) > 0)
                .map(k => `${k.toLowerCase()} ${(terrain.class_km[k] ?? 0).toFixed(1)} km`)
                .join(' · ')}
            </p>
            <p className="mt-1.5 text-xs text-muted">
              {terrain.source} · {Math.round(terrain.coverage * 100)}% of {terrain.samples_requested} samples answered
              {terrain.usable ? '' : ' — below the floor to score, shown for completeness'}
            </p>
          </>
        ) : (
          <p className="mt-1.5 text-[13px] text-muted">The elevation model did not answer for this route.</p>
        )}
      </EvidenceTile>

      <EvidenceTile name="Landslide history" testId="history-summary" tag={history ? `${history.exposure} EXPOSURE` : 'NOT MEASURED'} tone={tone(history?.exposure ?? 'UNKNOWN')}>
        {history && history.exposure !== 'UNKNOWN' ? (
          <>
            <p className="tnum mt-1.5 text-[13px] leading-snug text-ink">
              {history.on_route_count === 0
                ? 'No recorded landslide within 5 km of the road'
                : `${history.on_route_count} recorded landslide${history.on_route_count === 1 ? '' : 's'} within 5 km of the road`}
              {history.nearest_km !== null ? `, nearest ${history.nearest_km.toFixed(1)} km` : ''}
            </p>
            <p className="mt-1 text-[12.5px] text-muted">
              {history.imprecise_count > 0 ? `${history.imprecise_count} more nearby placed too imprecisely to count · ` : ''}
              HIGH is three or more; MODERATE is one or two
            </p>
            <p className="mt-1.5 text-xs text-muted">
              NASA Global Landslide Catalog · inventory {history.inventory_from_year}–{history.inventory_to_year}
              {history.reason_codes.includes('LANDSLIDE_HISTORY_INVENTORY_AGED') ? ' — aged, recent years not covered' : ''}
            </p>
          </>
        ) : (
          <p className="mt-1.5 text-[13px] text-muted">
            {history ? 'The inventory could not be read for this corridor.' : 'No landslide inventory answered for this route.'}
          </p>
        )}
      </EvidenceTile>

      <EvidenceTile
        name="River levels"
        testId="flood-summary"
        tag={flood && flood.level !== 'UNKNOWN' ? flood.level : 'NOT MEASURED'}
        tone={flood?.level === 'ELEVATED' ? 'warning' : flood?.level === 'NORMAL' ? 'success' : 'muted'}
      >
        <p className="mt-1.5 text-[13px] text-muted">
          {flood && flood.level !== 'UNKNOWN' && flood.ratio_max !== null
            ? `Discharge at ${flood.cells} river cell${flood.cells === 1 ? '' : 's'} along the corridor, highest ${flood.ratio_max.toFixed(1)}× its own 30-day mean · GloFAS via Open-Meteo, ${flood.observed_on ?? 'today'}. A level, not a flood forecast and not a road-closure claim.`
            : 'No river discharge data for this corridor.'}
        </p>
      </EvidenceTile>

      <EvidenceTile
        name="Official alerts"
        testId="warnings-summary"
        className="xl:col-span-2"
        tag={warnings && warnings.level !== 'UNKNOWN' ? (warnings.level === 'ACTIVE' ? `${warnings.on_route.length} ON CORRIDOR` : 'NONE ON CORRIDOR') : 'NOT CHECKED'}
        tone={warnings?.level === 'ACTIVE' ? 'danger' : warnings?.level === 'CLEAR' ? 'success' : 'muted'}
      >
        {warnings && warnings.level !== 'UNKNOWN' ? (
          <>
            {warnings.on_route.map((w) => (
              <p key={w.identifier} className="mt-1.5 text-[13px] text-ink">
                <span className="font-semibold">{w.event} · {w.severity}</span> — {w.headline} <span className="text-muted">({w.sender}, {w.area_desc}{w.expires ? `, until ${new Date(w.expires).toLocaleString()}` : ''})</span>
              </p>
            ))}
            <p className="mt-1.5 text-[13px] text-muted">
              NDMA SACHET CAP feed, {warnings.considered} alerts nationwide{warnings.fetched_at ? ` at ${new Date(warnings.fetched_at).toLocaleTimeString()}` : ''} · placed by district name ({warnings.districts.join(', ')}) · {warnings.in_states} more active elsewhere in the corridor states, not placeable on this road.
            </p>
          </>
        ) : (
          <p className="mt-1.5 text-[13px] text-muted">The alert feed or the district lookup did not answer for this corridor.</p>
        )}
      </EvidenceTile>

      <EvidenceTile
        name="Fleet traffic"
        testId="traffic-summary"
        tag={traffic && traffic.status !== 'UNKNOWN' ? traffic.status : 'UNKNOWN'}
        tone={traffic?.status === 'CONGESTED' ? 'danger' : traffic?.status === 'SLOW' ? 'warning' : traffic?.status === 'NORMAL' ? 'success' : 'muted'}
      >
        <p className="mt-1.5 text-[13px] text-muted">
          {traffic && traffic.status !== 'UNKNOWN'
            ? `${Math.round(traffic.coverage * 100)}% of the road graded from ${traffic.vehicle_count} RASTA truck${traffic.vehicle_count === 1 ? '' : 's'} (${traffic.sample_count} probes)${traffic.newest_age_seconds !== null ? `, updated ${Math.max(1, Math.round(traffic.newest_age_seconds / 60))} min ago` : ''}${traffic.delay_min > 0 ? ` · about ${Math.round(traffic.delay_min)} min slower than the planned pace` : ''}. Observed by our own fleet against the router's planned pace - not Google live traffic.`
            : `No RASTA truck has driven this road in the last 15 minutes${traffic && traffic.sample_count > 0 ? ` (${traffic.sample_count} probe${traffic.sample_count === 1 ? '' : 's'} from one truck - one vehicle is not traffic)` : ''}. Unknown, not clear.`}
        </p>
      </EvidenceTile>
    </div>
  )
}

/**
 * Opens the trip on Fleet's Route tab, where a driver's reroute proposal is
 * one of the route options and is taken through the ordinary reroute path
 * (review, approve, accept). No second way to accept it (E2E-R2).
 */
export function ReviewNewRoadButton({ tripId, describedBy, size = 'sm' }: { tripId: string; describedBy?: string; size?: 'sm' | 'md' }) {
  const navigate = useNavigate()
  return (
    <Button size={size} describedBy={describedBy} onClick={() => navigate('/fleet', { state: { tripId, tab: 'route' } })}>
      Review new road
    </Button>
  )
}

export default function TripRouteReview({ trip, listed = true, onChanged }: {
  trip: Trip
  /** False once the trip's row has left the list it was opened from: an open
   *  list drops a trip that was cancelled or closed. */
  listed?: boolean
  onChanged: () => void
}) {
  const { can } = useAuth()
  const [detail, setDetail] = useState<TripDetail | null>(null)
  const [routes, setRoutes] = useState<TripRoute[]>([])
  const [preview, setPreview] = useState<string | null>(null)
  const [assessment, setAssessment] = useState<RouteRecommendation | null>(null)
  const [authorizations, setAuthorizations] = useState<Record<string, ReviewAuthorization | null>>({})
  const [busy, setBusy] = useState<string | null>('load')
  // Which action failed travels with the error, so "Try again" repeats THAT
  // action - a failed conditions check is retried as a check, not as a reload.
  const [error, setError] = useState<{ name: string; error: unknown } | null>(null)
  // The manager's decision panel for a REVIEW REQUIRED route.
  const [approving, setApproving] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const active = useRef(true)
  const locked = useRef(false)
  // The verdict sentence is the reason a shut decision control gives.
  const verdictId = useId()

  async function read() {
    const [info, rows] = await Promise.all([api.getTrip(trip.id), api.listRoutes(trip.id)])
    if (!active.current) return
    setDetail(info)
    setRoutes(rows)
    setPreview((id) => rows.some(r => r.id === id) ? id : rows.find(r => r.is_current)?.id ?? rows.find(r => r.state !== 'SUPERSEDED')?.id ?? null)
    // Who accepted the evidence for the assigned route, if anyone had to -
    // shown after a reload, not only in the moment of approval.
    const current = rows.find(r => r.is_current)
    if (current) {
      const spent = await api.reviewAuthorization(trip.id, current.id).catch(() => null)
      if (active.current) setAuthorizations(prev => ({ ...prev, [current.id]: spent }))
    }
  }
  async function run(name: string, action: () => Promise<unknown>) {
    if (locked.current) return
    locked.current = true
    setBusy(name)
    setError(null)
    try { await action() } catch (caught) { if (active.current) setError({ name, error: caught }) }
    finally { locked.current = false; if (active.current) setBusy(null) }
  }
  useEffect(() => {
    active.current = true
    void run('load', read)
    return () => { active.current = false }
  }, [])
  // An open review follows its polled list row (FV-E2E-1): when the row's
  // status, selected route or driver's proposal changes, or the row leaves
  // the list, the trip is read again, so a cancelled trip stops offering
  // "Plan route" and a driver's request shows without closing the review.
  // Not through run(): a busy action must not swallow the re-read, and it
  // shows no spinner.
  const rowKey = `${listed}|${trip.status}|${trip.selected_route_id}|${trip.proposed_reroute?.route_id ?? ''}`
  const readFor = useRef(rowKey)
  useEffect(() => {
    if (readFor.current === rowKey) return
    readFor.current = rowKey
    read().catch(caught => { if (active.current) setError({ name: 'load', error: caught }) })
  }, [rowKey])

  // Superseded corridors are history, not choices - except the assigned one,
  // which must stay visible even after a replan.
  const selectableRoutes = routes.filter(r => r.state !== 'SUPERSEDED' || r.is_current)
  const route = routes.find(r => r.id === preview) ?? null
  const eligible = assessment?.candidates.find(c => c.route_id === preview)
  const held = preview ? authorizations[preview] : null
  const authorization = held && !held.consumed_at && !held.revoked_at && Date.parse(held.expires_at) > Date.now() ? held : null
  // A spent authorisation on the assigned route: who accepted the evidence.
  const spent = held && held.consumed_at ? held : null
  const selectable = eligible?.eligibility === 'ELIGIBLE' || (eligible?.eligibility === 'REQUIRES_REVIEW' && authorization !== null)
  // The way forward is the manager's own decision: review the evidence here,
  // say why, acknowledge that incomplete is not SAFE, approve.
  const needsReview = eligible?.eligibility === 'REQUIRES_REVIEW' && authorization === null
  // A row that already says the trip ended wins over an older read: a
  // finished trip is never planned again, even for the moment before the
  // re-read lands.
  const editable = (detail?.status === 'DRAFT' || detail?.status === 'ASSIGNED') && !['CANCELLED', 'CLOSED', 'DELIVERED'].includes(trip.status)
  // One sentence per state - shown above the control and carried as its title
  // when it is shut, so a greyed button is never unexplained.
  const verdict = eligible?.eligibility === 'REJECTED'
    ? 'An active hazard blocks this road. It cannot be selected, and nobody can override that.'
    : eligible?.eligibility === 'REQUIRES_REVIEW'
      ? authorization
        ? 'A reviewer authorized one selection. Hazard evidence remains incomplete.'
        : 'Review required. Hazard evidence is incomplete — it does not prove the road is unsafe, but it is not enough to call it verified. Review it and decide.'
      : eligible?.eligibility === 'ELIGIBLE'
        ? 'Eligible under the checks that ran. This is not a safety guarantee.'
        : eligible?.eligibility === 'NOT_ASSESSED'
          ? 'The hazard check could not run. This is a fault to fix, not a risk to accept.'
          : route?.is_current
            ? 'Assigned route. Check conditions again if time has passed since it was approved.'
            : 'Check current conditions before selecting a route.'

  async function assess() {
    const result = await api.routeRecommendation(trip.id)
    const pairs = await Promise.all(result.candidates.map(async candidate => [candidate.route_id, await api.reviewAuthorization(trip.id, candidate.route_id)] as const))
    if (!active.current) return
    setAssessment(result)
    setAuthorizations(Object.fromEntries(pairs))
  }

  async function approve(rationale: string) {
    if (!route) return
    try {
      await api.approveRoute(trip.id, route.id, rationale)
    } catch (caught) {
      // The server's refusal is the truth (a closure may have appeared, the
      // route may have been superseded): re-read eligibility, then show it.
      await assess().catch(() => {})
      throw caught
    }
    if (!active.current) return
    setApproving(false)
    setAssessment(null); setAuthorizations({})
    await read(); onChanged()
  }

  const selectedRoute = detail?.selected_route_id ?? trip.selected_route_id
  const retry = error ? { load: () => void run('load', read), assess: () => void run('assess', assess) }[error.name] : undefined
  // The failure is shown where the manager is looking: beside the decision
  // block once a route exists (a check or a selection failed there), at the
  // top only while there is no route to stand beside. An approval failure is
  // shown inside the decision panel instead.
  const dialogOpen = approving && needsReview && !!eligible && can('route:select') && editable
  const failure = error && !(error.name === 'approve' && dialogOpen) ? <ErrorState error={error.error} onRetry={retry} /> : null
  // Every stop the server holds, in order: an added stop is part of the
  // journey the route is judged for. None yet reads Unavailable, not blank.
  const stops = detail?.stops.length ? detail.stops : [undefined, undefined]
  const stopLabel = (index: number) => (index === 0 ? 'Pickup' : index === stops.length - 1 ? 'Destination' : `Stop ${index}`)
  const cargo = detail?.shipment
  // A driver off the planned road asked for a new one (E2E-R2). The newest
  // read wins; the list row is the fallback until the trip has loaded.
  const proposal = (detail ?? trip).proposed_reroute
  const rerouteAsked = awaitingReroute(detail?.status ?? trip.status, proposal) ? proposal ?? null : null
  const proposedKm = rerouteAsked ? Number(rerouteAsked.distance_km) : NaN
  return <Card
    title={`Trip Review · ${trip.trip_code}`}
    subtitle={cargo ? `${cargo.client_name} · ${Number(cargo.total_weight_kg).toLocaleString()} kg` : undefined}
    action={<span className="flex flex-wrap items-center gap-2"><StatusPill status={selectedRoute ? 'ROUTE_SELECTED' : 'NO_ROUTE_SELECTED'} /><StatusPill status={detail?.status ?? trip.status} /></span>}
  >
    {error && !route ? failure : null}
    {busy === 'load' && !detail ? <LoadingState label="Loading trip review…" /> : <>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] min-[2000px]:grid-cols-[minmax(0,720px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          {rerouteAsked ? <div className="rounded-md border border-warning/30 bg-warning-soft/40 p-3" data-testid="reroute-asked">
            <p className="text-sm font-semibold text-warning" id={`${verdictId}-reroute`}>{REROUTE_ASKED}</p>
            <p className="mt-1 text-[13px] leading-snug text-ink">
              Proposed {new Date(rerouteAsked.proposed_at).toLocaleString()}{rerouteAsked.distance_km !== null && Number.isFinite(proposedKm) ? ` · ${proposedKm.toLocaleString()} km from where the truck was` : ''}.
              {' '}The trip stays on its current road until a manager accepts the new one on Fleet's Route tab.
            </p>
            {can('fleet:location_read') ? <div className="mt-2"><ReviewNewRoadButton tripId={trip.id} describedBy={`${verdictId}-reroute`} /></div> : null}
          </div> : null}
          <ol className="relative space-y-3 pl-6 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-0.5 before:bg-line" data-testid="trip-stops">
            {stops.map((stop, index) => <li key={stop?.id ?? index} className="relative">
              <span aria-hidden="true" className={`absolute -left-6 top-1 size-4 rounded-full border-2 bg-surface ${stop?.status === 'COMPLETED' ? 'border-ok' : 'border-outline'}`} />
              <span className="text-xs text-muted">{stopLabel(index)}{stop?.status && stop.status !== 'PENDING' ? ` · ${stop.status.toLowerCase().replaceAll('_', ' ')}` : ''}</span>
              <p className="text-sm font-semibold text-ink break-words">{stop?.address ?? stop?.name ?? 'Unavailable'}</p>
            </li>)}
          </ol>
          {route ? <dl className="grid grid-cols-3 gap-2">
            {([
              ['Route distance', route.distance_km === null ? 'Unavailable' : `${Number(route.distance_km).toLocaleString()} km`],
              ['Free-flow travel', route.estimated_duration_min === null ? 'Unavailable' : `${route.estimated_duration_min} min`],
              ['Source', route.routing_provider ?? 'Unavailable'],
            ] as const).map(([name, value]) => <div key={name} className="min-w-0 rounded-[10px] bg-soft px-3 py-2.5">
              <dt className="text-xs text-muted">{name}</dt>
              <dd className="tnum mt-0.5 truncate text-[15px] font-semibold text-ink" title={value}>{value}</dd>
            </div>)}
          </dl> : null}
          <div className="flex flex-wrap gap-2">
            {can('route:plan') && editable ? <Button busy={busy === 'plan'} disabled={busy !== null} onClick={() => void run('plan', async () => {
              setAssessment(null); setAuthorizations({})
              const result = await api.planRoute(trip.id)
              if (!active.current) return
              setPreview(result.route.id)
              await read()
            })}>{route ? 'Replan route' : 'Plan route'}</Button> : null}
            {route ? <Button variant="secondary" busy={busy === 'assess'} disabled={busy !== null} onClick={() => void run('assess', assess)}>Check conditions & review</Button> : null}
          </div>
          {/*
            AVAILABLE FEASIBLE ROUTES - the count is whatever the provider returned,
            and the wording says so.

            Measured against the live provider on eight real NER corridors, this is
            one route on six of them and two on Guwahati-Itanagar and
            Shillong-Silchar. Never three. The selector used to appear silently only
            when a second corridor existed, which left the ordinary single-road case
            looking like a missing feature rather than the honest answer that there
            is one sensible road. It now says which case the dispatcher is in.
          */}
          {selectableRoutes.length > 0 ? (
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Available feasible routes
                </span>
                <span className="tnum text-xs text-muted">
                  {selectableRoutes.length === 1
                    ? '1 corridor offered'
                    : `${selectableRoutes.length} corridors offered`}
                </span>
              </div>
              {selectableRoutes.length > 1 ? (
                <select
                  aria-label="Preview a corridor"
                  className="mt-2 block w-full rounded-[var(--radius-control)] border border-outline bg-surface px-3 py-2 text-sm text-ink focus:border-route"
                  value={preview ?? ''}
                  onChange={e => setPreview(e.target.value)}
                >
                  {selectableRoutes.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.kind.replaceAll('_', ' ')} · {new Date(r.created_at).toLocaleTimeString()}
                      {r.is_current ? ' · Assigned' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-1.5 text-[13px] leading-snug text-muted">
                  The routing provider found one sensible road for this corridor.
                  That is the answer, not a shortfall.
                </p>
              )}
            </div>
          ) : null}
          {route ? <div className="space-y-3 border-t border-line pt-4" data-testid="route-decision">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={eligible?.eligibility ?? 'NOT_ASSESSED'} />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Route decision</span>
            </div>
            <p className="text-sm text-ink" id={verdictId}>{verdict}</p>
            {eligible ? <p className="text-[13px] text-muted">{translateReasonCodes(eligible.risk.reason_codes, 'en').join(' · ')}</p> : null}
            {assessment?.unavailable_inputs.length ? <p className="text-[13px] text-muted">Unavailable: {factorLabels(assessment.unavailable_inputs)}</p> : null}
            {eligible ? <p className="text-[13px] text-muted" data-testid="evidence-coverage">Evidence coverage · {evidenceCoverage(eligible.risk)}</p> : null}
            {route ? failure : null}
            {route.is_current && spent ? (
              <p className="text-[13px] text-ink" data-testid="approved-by">
                Approved by <strong>{spent.reviewer_name ?? 'a reviewer'}</strong>{spent.reviewer_role ? ` (${spent.reviewer_role.toLowerCase().replaceAll('_', ' ')})` : ''} · {new Date(spent.consumed_at ?? spent.issued_at).toLocaleString()} · “{spent.rationale}”
              </p>
            ) : null}
            {can('route:select') && editable ? (
              route.is_current ? <Button disabled describedBy={verdictId}>Route assigned</Button>
              : needsReview ? (approving ? null : <Button variant="secondary" disabled={busy !== null} onClick={() => { setError(null); setApproving(true) }}>Review & approve route</Button>)
              // No control until conditions were checked: "Check conditions &
              // review" above is the only way forward, not a greyed button.
              : !eligible || eligible.eligibility === 'NOT_ASSESSED' ? null
              : <Button disabled={busy !== null || !selectable} busy={busy === 'select'} title={selectable ? undefined : verdict} describedBy={verdictId} onClick={() => void run('select', async () => {
                if (!selectable) return
                try {
                  await api.selectRoute(trip.id, route.id, authorization?.id)
                } catch (caught) {
                  // The server's refusal is the truth: re-read eligibility so the
                  // control shown next is the right one (an authorisation may have
                  // been spent or expired since the check), then show the refusal.
                  await assess().catch(() => {})
                  throw caught
                }
                if (!active.current) return
                setAssessment(null); setAuthorizations({})
                await read(); onChanged()
              })}>{eligible?.eligibility === 'REJECTED' ? 'Route blocked' : 'Use this route'}</Button>
            ) : null}
            {dialogOpen && eligible ? (
              <RouteApprovalDialog
                risk={eligible.risk}
                reasons={translateReasonCodes(eligible.risk.reason_codes, 'en')}
                busy={busy === 'approve'}
                error={error?.name === 'approve' ? error.error : null}
                onCancel={() => { setError(null); setApproving(false) }}
                onApprove={(rationale) => void run('approve', () => approve(rationale))}
              />
            ) : null}
          </div> : null}
        </div>

        <div className="min-w-0">
          {route ? <>
            <MapLoadBoundary><Suspense fallback={<LoadingState label="Loading route map…" />}>
              <FleetMap
                trips={[]}
                selectedTripId={trip.id}
                onSelect={() => {}}
                track={[]}
                plannedRoute={route.geometry}
                previewRouteId={route.id}
                terrainSegments={eligible?.risk.terrain?.segments ?? []}
                hazards={eligible?.risk.landslide_history?.events ?? []}
                trafficSegments={eligible?.risk.traffic?.segments ?? []}
                frameClassName="h-[clamp(360px,calc(100dvh-340px),580px)] rounded-[8px] border border-line"
              />
            </Suspense></MapLoadBoundary>
            <p className="mt-2 text-[13px] text-muted">{route.is_current ? 'Assigned route' : 'Route preview'} · Planned {new Date(route.created_at).toLocaleString()}. Free-flow time excludes traffic, breaks and stops; arrival time is unavailable.</p>
          </> : <div className="grid h-full min-h-[240px] place-items-center rounded-[8px] border border-dashed border-line">{(detail?.status ?? trip.status) === 'DRAFT'
            ? <EmptyState icon={MapIcon} title="Preview your road" description="Plan the route for this draft, review its conditions, then select it before dispatch." />
            // Not a draft (COPY-1): say what is missing, not a planning step.
            : <EmptyState icon={MapIcon} title="No route selected" description="This trip has no selected route to preview." />}</div>}
        </div>
      </div>

      {/* The evidence behind the decision, under both columns: each source
          says what it measured, from where, and how complete it is. */}
      {eligible ? <div className="mt-5 border-t border-line pt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Route evidence</h3>
        <TerrainHazardSummary risk={eligible.risk} />
      </div> : null}

      {/* What has already happened to this trip, from the records the server
          writes. Last, because it is context rather than an action. */}
      <details
        className="group mt-5 border-t border-line pt-1"
        data-testid="journey-history-panel"
        onToggle={(e) => setHistoryOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
          Journey History
          <ChevronDown aria-hidden="true" className="size-4 text-muted transition-transform group-open:rotate-180" />
        </summary>
        {/* Fetched when it is opened, not when the panel renders: this is
            context a manager asks for, and an unasked request is one more
            thing that can fail behind a closed section. */}
        <div className="pb-1">{historyOpen ? <JourneyHistory tripId={trip.id} /> : null}</div>
      </details>
    </>}
  </Card>
}
