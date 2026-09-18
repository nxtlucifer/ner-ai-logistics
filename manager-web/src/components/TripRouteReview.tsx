import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { api, type ReviewAuthorization, type RouteRecommendation, type RouteRiskSummary, type Trip, type TripDetail, type TripRoute } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Button, Card, EmptyState, ErrorState, LoadingState, StatusPill } from './ui'
import { RouteApprovalDialog } from './RouteApprovalDialog'
import { factorLabels, translateReasonCodes } from '../i18n/reasonCodes'

const FleetMap = lazy(() => import('./FleetMap'))

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

function TerrainHazardSummary({ risk }: { risk: RouteRiskSummary }) {
  const terrain = risk.terrain ?? null
  const history = risk.landslide_history ?? null
  const flood = risk.flood ?? null
  const warnings = risk.official_warnings ?? null
  const traffic = risk.traffic ?? null
  if (!terrain && !history && !flood && !warnings && !traffic) return null
  const tone = (label: string) =>
    label === 'HIGH'
      ? 'bg-danger-soft text-danger'
      : label === 'MODERATE'
        ? 'bg-warning-soft text-warning'
        : label === 'LOW'
          ? 'bg-primary-soft text-primary'
          : 'bg-soft text-muted'
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <div className="rounded-[10px] border border-line bg-surface p-3" data-testid="terrain-summary">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted">Terrain</span>
          {terrain ? (
            <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${terrain.usable ? (terrain.steep_km > 0 ? tone('MODERATE') : tone('LOW')) : tone('UNKNOWN')}`}>
              {terrain.usable ? (terrain.steep_km > 0 ? `${terrain.steep_km.toFixed(1)} KM STEEP` : 'NO STEEP STRETCH') : 'PARTIAL'}
            </span>
          ) : (
            <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${tone('UNKNOWN')}`}>NOT MEASURED</span>
          )}
        </div>
        {terrain ? (
          <>
            <p className="tnum mt-1.5 text-[13px] leading-snug">
              {terrain.min_elevation_m !== null && terrain.max_elevation_m !== null
                ? `${Math.round(terrain.min_elevation_m)}–${Math.round(terrain.max_elevation_m)} m`
                : 'Height range not known'}
              {' · '}
              {Math.round(terrain.total_ascent_m)} m climb · steepest {terrain.max_grade_pct.toFixed(1)}%
            </p>
            <p className="tnum mt-1 text-[12px] text-muted">
              {(['FLAT', 'ROLLING', 'HILLY', 'STEEP'] as const)
                .filter(k => (terrain.class_km[k] ?? 0) > 0)
                .map(k => `${k.toLowerCase()} ${(terrain.class_km[k] ?? 0).toFixed(1)} km`)
                .join(' · ')}
            </p>
            <p className="mt-1.5 text-[11.5px] text-muted">
              {terrain.source} · {Math.round(terrain.coverage * 100)}% of {terrain.samples_requested} samples answered
              {terrain.usable ? '' : ' — below the floor to score, shown for completeness'}
            </p>
          </>
        ) : (
          <p className="mt-1.5 text-[12.5px] text-muted">The elevation model did not answer for this route.</p>
        )}
      </div>

      <div className="rounded-[10px] border border-line bg-surface p-3" data-testid="history-summary">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted">Landslide history</span>
          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${tone(history?.exposure ?? 'UNKNOWN')}`}>
            {history ? `${history.exposure} EXPOSURE` : 'NOT MEASURED'}
          </span>
        </div>
        {history && history.exposure !== 'UNKNOWN' ? (
          <>
            <p className="tnum mt-1.5 text-[13px] leading-snug">
              {history.on_route_count === 0
                ? 'No recorded landslide within 5 km of the road'
                : `${history.on_route_count} recorded landslide${history.on_route_count === 1 ? '' : 's'} within 5 km of the road`}
              {history.nearest_km !== null ? `, nearest ${history.nearest_km.toFixed(1)} km` : ''}
            </p>
            <p className="mt-1 text-[12px] text-muted">
              {history.imprecise_count > 0 ? `${history.imprecise_count} more nearby placed too imprecisely to count · ` : ''}
              HIGH is three or more; MODERATE is one or two
            </p>
            <p className="mt-1.5 text-[11.5px] text-muted">
              NASA Global Landslide Catalog · inventory {history.inventory_from_year}–{history.inventory_to_year}
              {history.reason_codes.includes('LANDSLIDE_HISTORY_INVENTORY_AGED') ? ' — aged, recent years not covered' : ''}
            </p>
          </>
        ) : (
          <p className="mt-1.5 text-[12.5px] text-muted">
            {history ? 'The inventory could not be read for this corridor.' : 'No landslide inventory answered for this route.'}
          </p>
        )}
      </div>
      <div className="rounded-[10px] border border-line bg-surface p-3 sm:col-span-2" data-testid="flood-summary">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted">River levels</span>
          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${flood?.level === 'ELEVATED' ? 'bg-warning-soft text-warning' : flood?.level === 'NORMAL' ? 'bg-primary-soft text-primary' : 'bg-soft text-muted'}`}>
            {flood && flood.level !== 'UNKNOWN' ? flood.level : 'NOT MEASURED'}
          </span>
        </div>
        <p className="mt-1.5 text-[12.5px] text-muted">
          {flood && flood.level !== 'UNKNOWN' && flood.ratio_max !== null
            ? `Discharge at ${flood.cells} river cell${flood.cells === 1 ? '' : 's'} along the corridor, highest ${flood.ratio_max.toFixed(1)}× its own 30-day mean · GloFAS via Open-Meteo, ${flood.observed_on ?? 'today'}. A level, not a flood forecast and not a road-closure claim.`
            : 'No river discharge data for this corridor.'}
        </p>
      </div>
      <div className="rounded-[10px] border border-line bg-surface p-3 sm:col-span-2" data-testid="warnings-summary">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted">Official alerts</span>
          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${warnings?.level === 'ACTIVE' ? 'bg-danger-soft text-danger' : warnings?.level === 'CLEAR' ? 'bg-primary-soft text-primary' : 'bg-soft text-muted'}`}>
            {warnings && warnings.level !== 'UNKNOWN' ? (warnings.level === 'ACTIVE' ? `${warnings.on_route.length} ON CORRIDOR` : 'NONE ON CORRIDOR') : 'NOT CHECKED'}
          </span>
        </div>
        {warnings && warnings.level !== 'UNKNOWN' ? (
          <>
            {warnings.on_route.map((w) => (
              <p key={w.identifier} className="mt-1.5 text-[12.5px] text-ink">
                <span className="font-semibold">{w.event} · {w.severity}</span> — {w.headline} <span className="text-muted">({w.sender}, {w.area_desc}{w.expires ? `, until ${new Date(w.expires).toLocaleString()}` : ''})</span>
              </p>
            ))}
            <p className="mt-1.5 text-[12.5px] text-muted">
              NDMA SACHET CAP feed, {warnings.considered} alerts nationwide{warnings.fetched_at ? ` at ${new Date(warnings.fetched_at).toLocaleTimeString()}` : ''} · placed by district name ({warnings.districts.join(', ')}) · {warnings.in_states} more active elsewhere in the corridor states, not placeable on this road.
            </p>
          </>
        ) : (
          <p className="mt-1.5 text-[12.5px] text-muted">The alert feed or the district lookup did not answer for this corridor.</p>
        )}
      </div>
      <div className="rounded-[10px] border border-line bg-surface p-3 sm:col-span-2" data-testid="traffic-summary">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted">Fleet traffic</span>
          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${traffic?.status === 'CONGESTED' ? 'bg-danger-soft text-danger' : traffic?.status === 'SLOW' ? 'bg-warning-soft text-warning' : traffic?.status === 'NORMAL' ? 'bg-primary-soft text-primary' : 'bg-soft text-muted'}`}>
            {traffic && traffic.status !== 'UNKNOWN' ? traffic.status : 'UNKNOWN'}
          </span>
        </div>
        <p className="mt-1.5 text-[12.5px] text-muted">
          {traffic && traffic.status !== 'UNKNOWN'
            ? `${Math.round(traffic.coverage * 100)}% of the road graded from ${traffic.vehicle_count} RASTA truck${traffic.vehicle_count === 1 ? '' : 's'} (${traffic.sample_count} probes)${traffic.newest_age_seconds !== null ? `, updated ${Math.max(1, Math.round(traffic.newest_age_seconds / 60))} min ago` : ''}${traffic.delay_min > 0 ? ` · about ${Math.round(traffic.delay_min)} min slower than the planned pace` : ''}. Observed by our own fleet against the router's planned pace - not Google live traffic.`
            : `No RASTA truck has driven this road in the last 15 minutes${traffic && traffic.sample_count > 0 ? ` (${traffic.sample_count} probe${traffic.sample_count === 1 ? '' : 's'} from one truck - one vehicle is not traffic)` : ''}. Unknown, not clear.`}
        </p>
      </div>
    </div>
  )
}

export default function TripRouteReview({ trip, onChanged }: { trip: Trip; onChanged: () => void }) {
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
  const active = useRef(true)
  const locked = useRef(false)

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
  const editable = detail?.status === 'DRAFT' || detail?.status === 'ASSIGNED'
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
  return <Card title={`Trip review · ${trip.trip_code}`} action={<span className="flex items-center gap-2"><StatusPill status={selectedRoute ? 'ROUTE_SELECTED' : 'NO_ROUTE_SELECTED'} /><StatusPill status={detail?.status ?? trip.status} /></span>}>
    {error && !route ? failure : null}
    {busy === 'load' && !detail ? <LoadingState label="Loading trip review…" /> : <>
      <ol className="space-y-4 mb-5 border-l-2 border-line pl-4">
        {[detail?.stops[0], detail?.stops.at(-1)].map((stop, index) => <li key={index}>
          <span className="text-xs text-muted">{index === 0 ? 'Pickup' : 'Destination'}</span>
          <p className="text-sm font-semibold text-ink break-words">{stop?.address ?? stop?.name ?? 'Unavailable'}</p>
        </li>)}
      </ol>
      {route ? <>
        <div className="grid grid-cols-3 gap-3 py-4 border-t border-line">
          <div><p className="text-xs text-muted">Route distance</p><p className="font-semibold">{route.distance_km === null ? 'Unavailable' : `${Number(route.distance_km).toLocaleString()} km`}</p></div>
          <div><p className="text-xs text-muted">Free-flow travel</p><p className="font-semibold">{route.estimated_duration_min === null ? 'Unavailable' : `${route.estimated_duration_min} min`}</p></div>
          <div><p className="text-xs text-muted">Source</p><p className="font-semibold">{route.routing_provider ?? 'Unavailable'}</p></div>
        </div>
        <Suspense fallback={<LoadingState label="Loading route map…" />}>
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
          />
        </Suspense>
        <p className="text-xs text-muted my-3">{route.is_current ? 'Assigned route' : 'Route preview'} · Planned {new Date(route.created_at).toLocaleString()}. Free-flow time excludes traffic, breaks and stops; arrival time is unavailable.</p>
      </> : <EmptyState title="Preview your road" description="Plan the route for this draft, review its conditions, then select it before dispatch." />}
      <div className="flex flex-wrap gap-2 my-4">
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
        <div className="mb-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted">
              Available feasible routes
            </span>
            <span className="tnum text-[11.5px] text-muted">
              {selectableRoutes.length === 1
                ? '1 corridor offered'
                : `${selectableRoutes.length} corridors offered`}
            </span>
          </div>
          {selectableRoutes.length > 1 ? (
            <select
              aria-label="Preview a corridor"
              className="mt-2 block w-full rounded-[10px] border border-line bg-surface p-2 text-sm"
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
            <p className="mt-1.5 text-[12.5px] leading-snug text-muted">
              The routing provider found one sensible road for this corridor.
              That is the answer, not a shortfall.
            </p>
          )}
        </div>
      ) : null}
      {route ? <div className="rounded-xl bg-soft p-4 space-y-3">
        <StatusPill status={eligible?.eligibility ?? 'NOT_ASSESSED'} />
        <p className="text-sm">{verdict}</p>
        {eligible ? <p className="text-xs text-muted">{translateReasonCodes(eligible.risk.reason_codes, 'en').join(' · ')}</p> : null}
        {assessment?.unavailable_inputs.length ? <p className="text-xs text-muted">Unavailable: {factorLabels(assessment.unavailable_inputs)}</p> : null}
        {eligible ? <p className="text-xs text-muted" data-testid="evidence-coverage">Evidence coverage · {evidenceCoverage(eligible.risk)}</p> : null}
        {eligible ? <TerrainHazardSummary risk={eligible.risk} /> : null}
        {route ? failure : null}
        {route.is_current && spent ? (
          <p className="text-xs text-ink" data-testid="approved-by">
            Approved by <strong>{spent.reviewer_name ?? 'a reviewer'}</strong>{spent.reviewer_role ? ` (${spent.reviewer_role.toLowerCase().replaceAll('_', ' ')})` : ''} · {new Date(spent.consumed_at ?? spent.issued_at).toLocaleString()} · “{spent.rationale}”
          </p>
        ) : null}
        {can('route:select') && editable ? (
          route.is_current ? <Button disabled>Route assigned</Button>
          : needsReview ? (approving ? null : <Button variant="secondary" disabled={busy !== null} onClick={() => { setError(null); setApproving(true) }}>Review & approve route</Button>)
          // No control until conditions were checked: "Check conditions &
          // review" above is the only way forward, not a greyed button.
          : !eligible || eligible.eligibility === 'NOT_ASSESSED' ? null
          : <Button disabled={busy !== null || !selectable} busy={busy === 'select'} title={selectable ? undefined : verdict} onClick={() => void run('select', async () => {
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
    </>}
  </Card>
}
