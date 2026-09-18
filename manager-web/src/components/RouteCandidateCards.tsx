/**
 * The trip's road options: one card per distinct route, stacked vertically.
 *
 * WHAT THIS REPLACES. A three-column card grid squeezed into the inspector
 * panel - each card a hundred pixels wide, every label wrapping word by word -
 * that carried a "physics fuel model", an "ALL 5 STAGES VERIFIED" badge and a
 * hard-coded paragraph about NH27 and Kaziranga regardless of the trip. None
 * of that was measured. Everything here is the server's: distance and
 * free-flow time from the routing provider, risk and eligibility from the
 * last assessment a dispatcher asked for, the recommendation from the
 * published comparison rule.
 *
 * ONE STATE PER CARD, and the button obeys it. A route is SELECTED,
 * SELECTABLE, REVIEW REQUIRED, BLOCKED, NOT CHECKED or STALE, the state is
 * written in words next to the pill, and a control that would be refused by
 * the server is disabled with that same sentence as its title. "Use this
 * route, then an error" is the failure this exists to remove.
 *
 * REVIEW REQUIRED is the manager's own decision. The card offers "Review &
 * approve route", which opens the decision panel: what evidence is missing,
 * a required reason, an explicit acknowledgement that incomplete is not SAFE,
 * then one click that records the approval and applies the route. On the
 * hosted deployment, with no landslide inventory configured, every corridor
 * starts in this state; a greyed "Use this route" that can never work is the
 * failure this exists to remove. BLOCKED stays blocked for everyone.
 */

import { Button, StatusPill } from './ui'
import { RouteApprovalDialog } from './RouteApprovalDialog'
import type { ReviewAuthorization, RouteComparison, TripRoute } from '../api/client'
import { translateReasonCodes } from '../i18n/reasonCodes'

export type CandidateState =
  | 'SELECTED'
  | 'SELECTABLE'
  | 'REVIEW_REQUIRED'
  | 'BLOCKED'
  | 'NOT_CHECKED'
  | 'STALE'

export interface Candidate {
  route: TripRoute
  /** From the last recommendation run. Null: nobody has checked this route. */
  assessed: RouteComparison | null
  /** A reviewer's live, unspent authorisation for this route, if one is held. */
  authorization: ReviewAuthorization | null
}

export function candidateState(c: Candidate): CandidateState {
  if (c.route.is_current) return c.route.state === 'SUPERSEDED' ? 'STALE' : 'SELECTED'
  const eligibility = c.assessed?.eligibility ?? null
  if (eligibility === 'ELIGIBLE') return 'SELECTABLE'
  if (eligibility === 'REQUIRES_REVIEW') return c.authorization ? 'SELECTABLE' : 'REVIEW_REQUIRED'
  if (eligibility === 'REJECTED') return 'BLOCKED'
  return 'NOT_CHECKED'
}

/** The one sentence that explains the state - and the disabled button. */
export function candidateMessage(c: Candidate, state: CandidateState, inTransit: boolean): string {
  switch (state) {
    case 'SELECTED':
      return inTransit ? 'Following this route.' : 'Selected for dispatch.'
    case 'SELECTABLE':
      return c.authorization
        ? 'Authorised for one selection by a reviewer. The hazard evidence is still incomplete — this records who accepted that, not that the road was checked.'
        : 'Eligible under the checks that ran. Not a safety guarantee.'
    case 'REVIEW_REQUIRED':
      return 'Review required — hazard evidence is incomplete. It does not prove the road is unsafe, but it is not enough to call it verified. Review it and decide.'
    case 'BLOCKED':
      return 'Blocked by an active hazard. This road cannot be used, and nobody can override that.'
    case 'STALE':
      return 'Selected route is no longer current — an earlier re-plan retired it while the trip was following it. Choose another route to change road.'
    case 'NOT_CHECKED':
      return c.assessed
        ? 'Route evidence is incomplete — the hazard checks could not run. Check again before this road can be chosen.'
        : 'Route evidence is incomplete — check route conditions before this road can be chosen.'
  }
}

function minutes(m: number | null): string {
  if (m === null) return 'time unavailable'
  return `${Math.floor(m / 60)}h ${m % 60}m free-flow`
}

export interface RouteCandidateCardsProps {
  candidates: Candidate[]
  /** From the comparison rule. Null when nothing was compared. */
  recommendedRouteId: string | null
  inTransit: boolean
  /**
   * True when choosing means leaving a road the truck is on: the action is a
   * reroute and says so. A moving trip with no current route selects plainly.
   */
  rerouting: boolean
  choosingId: string | null
  previewId: string | null
  onPreview: (routeId: string | null) => void
  onChoose: (routeId: string, authorizationId?: string) => void
  /** Which REVIEW REQUIRED card has its decision panel open, if any. */
  approvingId: string | null
  onApproving: (routeId: string | null) => void
  onApprove: (routeId: string, rationale: string) => void
  /** The server's refusal of the last approval, shown inside the panel. */
  approveError?: unknown
}

export function RouteCandidateCards({
  candidates,
  recommendedRouteId,
  inTransit,
  rerouting,
  choosingId,
  previewId,
  onPreview,
  onChoose,
  approvingId,
  onApproving,
  onApprove,
  approveError = null,
}: RouteCandidateCardsProps) {
  const n = candidates.length
  // Labels come from the figures, never from a fixed slot. A unique minimum
  // earns FASTEST or SHORTEST; a tie earns nothing, because "fastest" of two
  // equal times is not information.
  const durations = candidates.map((c) => c.route.estimated_duration_min).filter((v): v is number => v !== null)
  const distances = candidates.map((c) => Number(c.route.distance_km)).filter((v) => Number.isFinite(v) && v > 0)
  const fastest = durations.length > 1 && durations.filter((v) => v === Math.min(...durations)).length === 1 ? Math.min(...durations) : null
  const shortest = distances.length > 1 && distances.filter((v) => v === Math.min(...distances)).length === 1 ? Math.min(...distances) : null

  return (
    <div data-testid="route-options">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-primary">
          Planned route options
        </h3>
        <span className="tnum text-[11.5px] text-muted">
          {n} distinct road route{n === 1 ? '' : 's'} available
        </span>
      </div>
      {n === 1 ? (
        <p className="mt-1 text-[11.5px] leading-snug text-muted">
          The routing provider found one sensible road for this corridor. That is the answer, not a shortfall.
        </p>
      ) : null}

      <ul className="mt-2 space-y-2">
        {candidates.map((c) => {
          const r = c.route
          const state = candidateState(c)
          const message = candidateMessage(c, state, inTransit)
          const km = Number(r.distance_km)
          const chips: string[] = []
          if (state === 'SELECTED' || state === 'STALE') chips.push('CURRENT')
          if (recommendedRouteId === r.id) chips.push('RECOMMENDED')
          if (fastest !== null && r.estimated_duration_min === fastest) chips.push('FASTEST')
          if (shortest !== null && km === shortest) chips.push('SHORTEST')
          if (r.kind === 'EMERGENCY_BACKUP') chips.push('EMERGENCY BACKUP')
          const actionable = state === 'SELECTABLE'
          const busy = choosingId === r.id
          const risk = c.assessed?.risk
          return (
            <li
              key={r.id}
              data-testid={`route-card-${r.id}`}
              className={`rounded-xl border p-3 ${
                state === 'SELECTED'
                  ? 'border-route bg-route-soft'
                  : previewId === r.id
                    ? 'border-outline bg-surface'
                    : 'border-line bg-surface'
              }`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {chips.map((chip) => (
                  <span
                    key={chip}
                    className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-wider ${
                      chip === 'CURRENT'
                        ? 'border-route/30 bg-route/10 text-route'
                        : chip === 'RECOMMENDED'
                          ? 'border-ok/30 bg-ok-soft text-ok'
                          : 'border-line bg-soft text-muted'
                    }`}
                  >
                    {chip}
                  </span>
                ))}
                <span className="text-[11px] text-muted">
                  planned {new Date(r.created_at).toLocaleTimeString()}
                </span>
              </div>

              <p className="mt-2 text-sm font-semibold text-ink">
                <span className="tnum">{Number.isFinite(km) && km > 0 ? `${km.toLocaleString()} km` : 'distance unavailable'}</span>
                <span className="font-normal text-muted"> · {minutes(r.estimated_duration_min)}</span>
              </p>
              <p className="text-[11px] text-muted">
                Free-flow travel time from {r.routing_provider ?? 'the routing provider'} — not an ETA: no departure time, traffic or stop dwell.
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusPill status={state} />
                <span className="tnum text-[11px] text-muted">
                  {risk && risk.score !== null ? `Risk ${Math.round(risk.score)} · ${risk.band}` : 'Risk not checked'}
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-snug text-ink">{message}</p>
              {risk && risk.reason_codes.length > 0 ? (
                <p className="mt-1 text-[11px] leading-snug text-muted">
                  {translateReasonCodes(risk.reason_codes, 'en').join(' · ')}
                </p>
              ) : null}
              {risk && risk.unavailable.length > 0 ? (
                <p className="mt-1 text-[11px] text-muted">Assessed without: {risk.unavailable.join(', ')}.</p>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-2">
                {state === 'REVIEW_REQUIRED' ? (
                  approvingId === r.id ? null : (
                    <Button variant="secondary" disabled={choosingId !== null} onClick={() => onApproving(r.id)}>
                      Review & approve route
                    </Button>
                  )
                ) : state !== 'SELECTED' && state !== 'STALE' ? (
                  <Button
                    busy={busy}
                    disabled={!actionable || (choosingId !== null && !busy)}
                    title={actionable ? undefined : message}
                    onClick={() => onChoose(r.id, c.authorization?.id)}
                  >
                    {busy ? 'Applying…' : state === 'BLOCKED' ? 'Route blocked' : rerouting ? 'Reroute onto this' : 'Use this route'}
                  </Button>
                ) : null}
                <Button variant="secondary" onClick={() => onPreview(previewId === r.id ? null : r.id)}>
                  {previewId === r.id ? 'Shown on map' : 'Show on map'}
                </Button>
              </div>
              {state === 'REVIEW_REQUIRED' && approvingId === r.id && c.assessed ? (
                <div className="mt-2">
                  <RouteApprovalDialog
                    risk={c.assessed.risk}
                    reasons={translateReasonCodes(c.assessed.risk.reason_codes, 'en')}
                    busy={busy}
                    error={approveError}
                    rerouting={rerouting}
                    onCancel={() => onApproving(null)}
                    onApprove={(rationale) => onApprove(r.id, rationale)}
                  />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
