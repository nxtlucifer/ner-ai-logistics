import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { api, type ReviewAuthorization, type RouteRecommendation, type Trip, type TripDetail, type TripRoute } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Button, Card, EmptyState, ErrorState, LoadingState, StatusPill } from './ui'
import { translateReasonCodes } from '../i18n/reasonCodes'

const FleetMap = lazy(() => import('./FleetMap'))

/** Draft route review uses the same authoritative selection API as Fleet.
 * The parent keys this panel by trip id so another draft cannot inherit it.
 */
export default function TripRouteReview({ trip, onChanged }: { trip: Trip; onChanged: () => void }) {
  const { can } = useAuth()
  const [detail, setDetail] = useState<TripDetail | null>(null)
  const [routes, setRoutes] = useState<TripRoute[]>([])
  const [preview, setPreview] = useState<string | null>(null)
  const [assessment, setAssessment] = useState<RouteRecommendation | null>(null)
  const [authorizations, setAuthorizations] = useState<Record<string, ReviewAuthorization | null>>({})
  const [busy, setBusy] = useState<string | null>('load')
  const [error, setError] = useState<unknown>(null)
  const active = useRef(true)
  const locked = useRef(false)

  async function read() {
    const [info, rows] = await Promise.all([api.getTrip(trip.id), api.listRoutes(trip.id)])
    if (!active.current) return
    setDetail(info)
    setRoutes(rows)
    setPreview((id) => rows.some(r => r.id === id) ? id : rows.find(r => r.is_current)?.id ?? rows.find(r => r.state !== 'SUPERSEDED')?.id ?? null)
  }
  async function run(name: string, action: () => Promise<unknown>) {
    if (locked.current) return
    locked.current = true
    setBusy(name)
    setError(null)
    try { await action() } catch (caught) { if (active.current) setError(caught) }
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
  const selectable = eligible?.eligibility === 'ELIGIBLE' || (eligible?.eligibility === 'REQUIRES_REVIEW' && authorization !== null)
  const editable = detail?.status === 'DRAFT' || detail?.status === 'ASSIGNED'

  async function assess() {
    const result = await api.routeRecommendation(trip.id)
    const pairs = await Promise.all(result.candidates.map(async candidate => [candidate.route_id, await api.reviewAuthorization(trip.id, candidate.route_id)] as const))
    if (!active.current) return
    setAssessment(result)
    setAuthorizations(Object.fromEntries(pairs))
  }

  return <Card title={`Trip review · ${trip.trip_code}`} action={<StatusPill status={detail?.status ?? trip.status} />}>
    {error ? <ErrorState error={error} onRetry={() => void run('load', read)} /> : null}
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
          <FleetMap trips={[]} selectedTripId={trip.id} onSelect={() => {}} track={[]} plannedRoute={route.geometry} previewRouteId={route.id} />
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
        <p className="text-sm">{eligible?.eligibility === 'REJECTED' ? 'An active hazard blocks this road. It cannot be selected.' : eligible?.eligibility === 'REQUIRES_REVIEW' ? authorization ? 'A reviewer authorized one selection. Hazard evidence remains incomplete.' : 'Hazard evidence is incomplete or elevated. An authorised reviewer must review this route before selection. Refresh conditions after review.' : eligible?.eligibility === 'ELIGIBLE' ? 'Eligible under the checks that ran. This is not a safety guarantee.' : 'Check current conditions before selecting a route.'}</p>
        {eligible ? <p className="text-xs text-muted">{translateReasonCodes(eligible.risk.reason_codes, 'en').join(' · ')}</p> : null}
        {assessment?.unavailable_inputs.length ? <p className="text-xs text-muted">Unavailable: {assessment.unavailable_inputs.join(', ')}</p> : null}
        {can('route:select') && editable ? <Button disabled={busy !== null || !selectable || route.is_current} busy={busy === 'select'} onClick={() => void run('select', async () => {
          if (!selectable) return
          await api.selectRoute(trip.id, route.id, authorization?.id)
          if (!active.current) return
          setAssessment(null); setAuthorizations({})
          await read(); onChanged()
        })}>{route.is_current ? 'Route assigned' : 'Use this route'}</Button> : null}
      </div> : null}
    </>}
  </Card>
}
