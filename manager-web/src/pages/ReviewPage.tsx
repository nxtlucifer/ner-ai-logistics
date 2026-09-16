/**
 * The authorised reviewer's screen.
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

import {
  api,
  type ReviewAuthorization,
  type RouteComparison,
  type Trip,
  type TripRoute,
  unavailableReason,
} from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Button, Card, EmptyState, ErrorState, LoadingState } from '../components/ui'
import { translateReasonCodes } from '../i18n/reasonCodes'

/** Long enough that "ok" cannot pass, matching the server's own floor. */
const MIN_RATIONALE = 20

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-1 text-xs">
      <span className="text-muted">{label}</span>
      <span className="text-right text-ink">{value}</span>
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

  if (loadError) return <ErrorState error={loadError} />
  if (trips === null) return <LoadingState label="Loading trips…" />

  const byRoute = new Map(candidates.map((c) => [c.route_id, c]))
  const live = routes.filter((r) => r.state !== 'SUPERSEDED')

  return (
    <div className="space-y-4">
      <div>
        <h1>Route review</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
          Authorising a route records that <strong>you accepted incomplete
          hazard evidence</strong> for one dispatch. It does not mark the road
          checked, and the route continues to report its evidence as missing
          afterwards. A road an authority has closed cannot be authorised by
          anyone.
        </p>
      </div>

      <Card>
        <label className="block text-xs">
          <span className="mb-1 block text-muted">Trip</span>
          <select
            className="w-full rounded border border-line bg-surface px-2 py-1.5 text-ink"
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
      </Card>

      {detailError ? <ErrorState error={detailError} /> : null}

      {tripId ? (
        <Card>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-primary">
              Routes on this trip
            </h3>
            <Button
              variant="secondary"
              busy={isAssessing}
              disabled={isAssessing}
              onClick={() => void assess()}
            >
              {isAssessing ? 'Checking…' : 'Check hazard evidence'}
            </Button>
          </div>

          {live.length === 0 ? (
            <EmptyState
              title="No live routes"
              description="Plan a route for this trip first."
            />
          ) : (
            <ul className="space-y-3">
              {live.map((route) => {
                const assessed = byRoute.get(route.id)
                const held = authorizations[route.id] ?? null
                const expired =
                  held !== null && new Date(held.expires_at) <= new Date()
                const reviewable = assessed?.eligibility === 'REQUIRES_REVIEW'
                const text = rationale[route.id] ?? ''
                const busy = busyRoute === route.id

                return (
                  <li
                    key={route.id}
                    className="rounded border border-line bg-surface/40 p-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-semibold text-ink">
                        {route.kind.replace(/_/g, ' ')}
                        {route.is_current ? (
                          <span className="ml-2 font-normal text-ok">
                            currently followed
                          </span>
                        ) : null}
                      </span>
                      <span className="text-[11px] text-muted">
                        {route.distance_km
                          ? `${Number(route.distance_km).toLocaleString()} km`
                          : 'distance unavailable'}
                      </span>
                    </div>

                    {/* The evidence, in words, never a bare score. */}
                    <p className="mt-2 text-[11px] text-muted">
                      {assessed === undefined
                        ? 'Hazard evidence not checked yet.'
                        : assessed.eligibility === 'REQUIRES_REVIEW'
                          ? 'Hazard data incomplete — this route needs review.'
                          : assessed.eligibility === 'REJECTED'
                            ? 'Blocked by an active hazard. This cannot be authorised by anyone.'
                            : assessed.eligibility === 'ELIGIBLE'
                              ? 'Eligible under the checks that ran. No authorisation needed.'
                              : 'Could not be assessed. This is a fault to fix, not a risk to accept.'}
                    </p>
                    {assessed ? (
                      <p className="mt-1 text-[11px] text-muted">
                        {translateReasonCodes(
                          assessed.risk.reason_codes,
                          'en',
                        ).join(' · ')}
                      </p>
                    ) : null}

                    {held ? (
                      <div className="mt-3 rounded border border-warning/40 bg-warning-strong/10 p-2">
                        <p className="text-[11px] font-semibold text-warning">
                          {expired
                            ? 'Authorisation expired — a fresh review is needed'
                            : 'Hazard data incomplete — authorized for this selection'}
                        </p>
                        <Field label="Basis" value={held.basis.replace(/_/g, ' ')} />
                        <Field
                          label="Expires"
                          value={new Date(held.expires_at).toLocaleString()}
                        />
                        <Field label="Rationale" value={held.rationale} />
                        <div className="mt-2">
                          <Button
                            variant="secondary"
                            busy={busy}
                            disabled={busy || revokeBlocked !== null}
                            title={revokeBlocked ?? undefined}
                            onClick={() => void revoke(route.id, held.id)}
                          >
                            {busy ? 'Revoking…' : 'Revoke'}
                          </Button>
                        </div>
                      </div>
                    ) : reviewable && !mayAuthorize ? (
                      <p className="mt-3 text-[11px] text-warning">
                        Only an authorised reviewer can accept this. Ask one to sign in and open this trip under Review; then check conditions again on the trip.
                      </p>
                    ) : reviewable ? (
                      <div className="mt-3 space-y-2">
                        <label className="block text-[11px]">
                          <span className="mb-1 block text-muted">
                            Why are you accepting this? Required — this is the
                            only record of the reason.
                          </span>
                          <textarea
                            className="w-full rounded border border-line bg-surface px-2 py-1.5 text-xs text-ink"
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
                        <Button
                          busy={busy}
                          disabled={busy || text.trim().length < MIN_RATIONALE}
                          onClick={() => void authorize(route.id)}
                        >
                          {busy ? 'Recording…' : 'Authorise one selection'}
                        </Button>
                        {text.trim().length < MIN_RATIONALE ? (
                          <p className="text-[11px] text-muted">
                            At least {MIN_RATIONALE} characters of reasoning.
                          </p>
                        ) : null}
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
