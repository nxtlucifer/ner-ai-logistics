/**
 * The authorised reviewer's screen - OPTIONAL, second-level.
 *
 * Since 2026-09-18 the manager approves a REVIEW REQUIRED route from the
 * trip's own route panel ("Review & approve route") and no reviewer sign-in
 * is needed for a dispatch. This page stays for audit (what was accepted, by
 * whom, and why) and for a fleet that wants a separate reviewer to pre-issue
 * an authorisation the manager then spends.
 *
 * WHAT A REVIEWER IS BEING ASKED
 *
 * Not "is this road safe" - nobody here can answer that. The question is
 * narrower and it is the only one this screen asks: *the required hazard
 * evidence for this corridor is missing; knowing that, do you accept
 * responsibility for one dispatch over it, and why?*
 *
 * So the evidence is shown as incomplete, in words, and the rationale is
 * mandatory. There is no approve button that works without one.
 *
 * WHY THIS IS A SEPARATE PAGE
 *
 * A reviewer holds `trip:read`, `route:read` and `route:review_authorize` and
 * nothing else - deliberately not `fleet:location_read`, because judging
 * hazard evidence on a corridor does not require knowing where any driver is,
 * and not `route:select`, because the person who accepts a risk must not be
 * the person who acts on it. The Fleet page needs both, so it is not reachable
 * for this role and must not be: a screen that renders and then 403s on every
 * request teaches an operator the system is broken.
 */

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Route as RouteIcon } from 'lucide-react'

import {
  api,
  type ReviewAuthorization,
  type RouteComparison,
  type Trip,
  type TripRoute,
  unavailableReason,
} from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, StatusPill } from '../components/ui'
import { translateReasonCodes } from '../i18n/reasonCodes'

/** Long enough that "ok" cannot pass, matching the server's own floor. */
const MIN_RATIONALE = 20

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-1.5 text-[13px] last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  )
}

export default function ReviewPage() {
  const { can } = useAuth()
  // A manager can read everything here and authorise nothing; the form is
  // withheld and the reason said, rather than offered and then refused (403).
  const mayAuthorize = can('route:review_authorize')
  const [params] = useSearchParams()
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [tripId, setTripId] = useState<string | null>(null)

  const [routes, setRoutes] = useState<TripRoute[]>([])
  const [candidates, setCandidates] = useState<RouteComparison[]>([])
  const [authorizations, setAuthorizations] = useState<
    Record<string, ReviewAuthorization | null>
  >({})
  const [isAssessing, setIsAssessing] = useState(false)
  const [detailError, setDetailError] = useState<unknown>(null)

  const [rationale, setRationale] = useState<Record<string, string>>({})
  const [busyRoute, setBusyRoute] = useState<string | null>(null)
  const [actionError, setActionError] = useState<unknown>(null)

  const loadTrip = useCallback(async (id: string) => {
    setTripId(id)
    setDetailError(null)
    setActionError(null)
    setCandidates([])
    try {
      const rows = await api.listRoutes(id)
      setRoutes(rows)
      // Existing authorisations, so a reviewer sees what they or a colleague
      // already issued instead of writing a duplicate the server will refuse.
      const live = await Promise.all(
        rows.map((r) =>
          api
            .reviewAuthorization(id, r.id)
            .then((a) => [r.id, a] as const)
            .catch(() => [r.id, null] as const),
        ),
      )
      setAuthorizations(Object.fromEntries(live))
    } catch (error) {
      setDetailError(error)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        // Only trips whose route can still be chosen or changed. A delivered or
        // cancelled trip has nothing left to review, so it is not offered.
        const items = (await api.listTrips({ limit: 50 })).items
        const open = items.filter((t) => ['DRAFT', 'ASSIGNED', 'VERIFICATION_PENDING', 'ACTIVE', 'DELAYED'].includes(t.status))
        setTrips(open)
        // "Open review" from a trip's route panel names the trip: land on it.
        const wanted = params.get('trip')
        if (wanted && open.some((t) => t.id === wanted)) void loadTrip(wanted)
      } catch (error) {
        setLoadError(error)
      }
    })()
  }, [])

  /**
   * Eligibility is NOT fetched on selecting a trip.
   *
   * Each assessment costs a weather fan-out per route and the recommendation
   * endpoint's own contract says a client must not poll it. So it is an
   * explicit action, and until it runs the routes read "not assessed" - which
   * is true, and which keeps the authorise button unavailable.
   */
  async function assess() {
    if (!tripId || isAssessing) return
    setIsAssessing(true)
    setDetailError(null)
    try {
      setCandidates((await api.routeRecommendation(tripId)).candidates)
    } catch (error) {
      setDetailError(error)
    } finally {
      setIsAssessing(false)
    }
  }

  async function authorize(routeId: string) {
    if (!tripId || busyRoute) return
    const text = (rationale[routeId] ?? '').trim()
    if (text.length < MIN_RATIONALE) return
    setBusyRoute(routeId)
    setActionError(null)
    try {
      const issued = await api.authorizeReview(tripId, routeId, text)
      setAuthorizations((prev) => ({ ...prev, [routeId]: issued }))
      setRationale((prev) => ({ ...prev, [routeId]: '' }))
    } catch (error) {
      setActionError(error)
    } finally {
      setBusyRoute(null)
    }
  }

  // No hosted implementation for revocation yet; the control says so rather
  // than throwing when a reviewer presses it.
  const revokeBlocked = unavailableReason('revokeReviewAuthorization')

  async function revoke(routeId: string, authorizationId: string) {
    if (!tripId || busyRoute) return
    setBusyRoute(routeId)
    setActionError(null)
    try {
      await api.revokeReviewAuthorization(tripId, routeId, authorizationId)
      setAuthorizations((prev) => ({ ...prev, [routeId]: null }))
    } catch (error) {
      setActionError(error)
    } finally {
      setBusyRoute(null)
    }
  }

  const header = (
    <PageHeader
      title="Route Review"
      meta={<>The optional second-level review, and the record of what was accepted. Managers approve routes from the trip itself (Trips › Review &amp; approve route).</>}
    />
  )
  if (loadError) return <div className="space-y-4">{header}<Card><ErrorState centered error={loadError} /></Card></div>
  if (trips === null) return <div className="space-y-4">{header}<Card><LoadingState label="Loading trips…" /></Card></div>

  const byRoute = new Map(candidates.map((c) => [c.route_id, c]))
  const live = routes.filter((r) => r.state !== 'SUPERSEDED')

  return (
    <div className="space-y-4">
      {header}

      <Card title="Trip" subtitle="Open trips whose route can still be chosen or changed.">
        <label className="block max-w-2xl">
          <span className="sr-only">Trip</span>
          <select
            className="w-full rounded-[var(--radius-control)] border border-outline bg-surface px-3 py-2 text-sm text-ink focus:border-route"
            value={tripId ?? ''}
            onChange={(e) => void loadTrip(e.target.value)}
          >
            <option value="">{trips.length === 0 ? 'Nothing awaiting review' : 'Select an open trip…'}</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.trip_code} — {t.status}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-3 max-w-4xl text-[13px] leading-5 text-muted">
          Authorising a route records that <strong className="font-semibold text-ink">you accepted incomplete
          hazard evidence</strong> for one dispatch. It does not mark the road
          checked, and the route continues to report its evidence as missing
          afterwards. A road an authority has closed cannot be authorised by
          anyone.
        </p>
      </Card>

      {detailError ? <Card><ErrorState error={detailError} /></Card> : null}

      {tripId ? (
        <Card
          title="Routes on This Trip"
          subtitle="Hazard evidence is read only when you ask: each check costs a weather lookup per route."
          action={
            <Button
              variant="secondary"
              size="sm"
              busy={isAssessing}
              disabled={isAssessing}
              onClick={() => void assess()}
            >
              {isAssessing ? 'Checking…' : 'Check hazard evidence'}
            </Button>
          }
        >
          {live.length === 0 ? (
            <EmptyState
              icon={RouteIcon}
              title="No live routes"
              description="Plan a route for this trip first."
            />
          ) : (
            <ul className="divide-y divide-line">
              {live.map((route) => {
                const assessed = byRoute.get(route.id)
                const held = authorizations[route.id] ?? null
                const spent = held !== null && held.consumed_at !== null
                const expired =
                  held !== null && !spent && new Date(held.expires_at) <= new Date()
                const reviewable = assessed?.eligibility === 'REQUIRES_REVIEW'
                const text = rationale[route.id] ?? ''
                const busy = busyRoute === route.id

                return (
                  <li
                    key={route.id}
                    className="space-y-2 py-4 first:pt-1 last:pb-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                        {route.kind.replace(/_/g, ' ')}
                        {route.is_current ? (
                          <StatusPill status="SELECTED" label="CURRENTLY FOLLOWED" tone="route" />
                        ) : null}
                      </span>
                      <span className="tnum text-[13px] text-muted">
                        {route.distance_km
                          ? `${Number(route.distance_km).toLocaleString()} km`
                          : 'distance unavailable'}
                      </span>
                    </div>

                    {/* The evidence, in words, never a bare score. */}
                    <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
                      <StatusPill status={assessed === undefined ? 'NOT_CHECKED' : assessed.eligibility} />
                      <span>
                        {assessed === undefined
                          ? 'Hazard evidence not checked yet.'
                          : assessed.eligibility === 'REQUIRES_REVIEW'
                            ? 'Hazard data incomplete — this route needs review.'
                            : assessed.eligibility === 'REJECTED'
                              ? 'Blocked by an active hazard. This cannot be authorised by anyone.'
                              : assessed.eligibility === 'ELIGIBLE'
                                ? 'Eligible under the checks that ran. No authorisation needed.'
                                : 'Could not be assessed. This is a fault to fix, not a risk to accept.'}
                      </span>
                    </p>
                    {assessed ? (
                      <p className="text-xs text-muted">
                        {translateReasonCodes(
                          assessed.risk.reason_codes,
                          'en',
                        ).join(' · ')}
                      </p>
                    ) : null}

                    {held ? (
                      <div className="border-l-4 border-warning py-1 pl-4">
                        <p className="text-[13px] font-semibold text-warning">
                          {spent
                            ? `Accepted and used for the selection that stands — by ${held.reviewer_name ?? 'a reviewer'}${held.reviewer_role ? ` (${held.reviewer_role.toLowerCase().replace(/_/g, ' ')})` : ''}`
                            : expired
                              ? 'Authorisation expired — a fresh review is needed'
                              : 'Hazard data incomplete — authorized for this selection'}
                        </p>
                        <dl className="mt-1 max-w-3xl">
                          <Field label="Basis" value={held.basis.replace(/_/g, ' ')} />
                          {spent ? (
                            <Field label="Used" value={new Date(held.consumed_at as string).toLocaleString()} />
                          ) : (
                            <Field
                              label="Expires"
                              value={new Date(held.expires_at).toLocaleString()}
                            />
                          )}
                          <Field label="Rationale" value={held.rationale} />
                        </dl>
                        {!spent && mayAuthorize ? (
                          <div className="mt-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              busy={busy}
                              disabled={busy || revokeBlocked !== null}
                              title={revokeBlocked ?? undefined}
                              onClick={() => void revoke(route.id, held.id)}
                            >
                              {busy ? 'Revoking…' : 'Revoke'}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : reviewable && !mayAuthorize ? (
                      <p className="text-[13px] text-warning">
                        Approve this from the trip itself: Trips › open the trip › Review &amp; approve route. This page only pre-issues an authorisation for a separate reviewer.
                      </p>
                    ) : reviewable ? (
                      <div className="max-w-3xl space-y-2">
                        <label className="block text-[13px]">
                          <span className="mb-1 block text-ink">
                            Why are you accepting this? <span className="text-muted">Required — this is the
                            only record of the reason.</span>
                          </span>
                          <textarea
                            className="w-full rounded-[var(--radius-control)] border border-outline bg-surface px-3 py-2 text-sm text-ink focus:border-route"
                            rows={2}
                            value={text}
                            onChange={(e) =>
                              setRationale((prev) => ({
                                ...prev,
                                [route.id]: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <div className="flex flex-wrap items-center gap-3">
                          <Button
                            size="sm"
                            busy={busy}
                            disabled={busy || text.trim().length < MIN_RATIONALE}
                            describedBy={text.trim().length < MIN_RATIONALE ? `rationale-${route.id}` : undefined}
                            onClick={() => void authorize(route.id)}
                          >
                            {busy ? 'Recording…' : 'Authorise one selection'}
                          </Button>
                          {text.trim().length < MIN_RATIONALE ? (
                            <p id={`rationale-${route.id}`} className="text-[13px] text-muted">
                              At least {MIN_RATIONALE} characters of reasoning.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}

          {actionError ? (
            <div className="mt-3">
              <ErrorState error={actionError} />
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  )
}
