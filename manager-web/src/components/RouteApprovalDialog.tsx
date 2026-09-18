/**
 * The manager's decision on a REVIEW REQUIRED route.
 *
 * The fleet manager is the operational authority. When the required hazard
 * evidence is incomplete, RASTA does not hide that and does not ask a second
 * account to sign in: it shows the manager exactly what is known and what is
 * not, requires a reason, requires an explicit acknowledgement that
 * incomplete evidence is not SAFE, and then records the approval and selects
 * the route in one server transaction (`api.approveRoute`).
 *
 * A closed road, an invalid or superseded route, or a corridor with a
 * reported hazard never reaches this dialog: those are ROUTE BLOCKED and the
 * server refuses them regardless of what is typed here.
 */

import { useState } from 'react'

import type { RouteRiskSummary } from '../api/client'
import { Button, ErrorState } from './ui'

/** Long enough that "ok" cannot pass, matching the server's own floor. */
export const MIN_RATIONALE = 20

export type EvidenceStatus = 'AVAILABLE' | 'PARTIAL' | 'STALE' | 'UNKNOWN' | 'UNAVAILABLE'

/** Each evidence source and how complete it is - the list the manager is accepting. */
export function evidenceRows(risk: RouteRiskSummary): [string, EvidenceStatus][] {
  const history = risk.landslide_history ?? null
  return [
    ['Landslide incidents (required)', risk.unavailable.includes('landslide') ? 'UNAVAILABLE' : 'AVAILABLE'],
    [
      'Landslide history',
      !history || history.exposure === 'UNKNOWN'
        ? 'UNKNOWN'
        : history.reason_codes.includes('LANDSLIDE_HISTORY_INVENTORY_AGED')
          ? 'STALE'
          : 'AVAILABLE',
    ],
    ['Weather', risk.unavailable.includes('weather') ? 'UNAVAILABLE' : 'AVAILABLE'],
    ['Terrain', risk.terrain ? (risk.terrain.usable ? 'AVAILABLE' : 'PARTIAL') : 'UNKNOWN'],
    ['River levels', risk.flood && risk.flood.level !== 'UNKNOWN' ? 'AVAILABLE' : 'UNKNOWN'],
    ['Official alerts', risk.official_warnings && risk.official_warnings.level !== 'UNKNOWN' ? 'AVAILABLE' : 'UNKNOWN'],
    ['Fleet traffic', risk.traffic && risk.traffic.status !== 'UNKNOWN' ? 'AVAILABLE' : 'UNKNOWN'],
  ]
}

const TONE: Record<EvidenceStatus, string> = {
  AVAILABLE: 'text-ok',
  PARTIAL: 'text-warning',
  STALE: 'text-warning',
  UNKNOWN: 'text-warning',
  UNAVAILABLE: 'text-danger',
}

export interface RouteApprovalDialogProps {
  risk: RouteRiskSummary
  /** Why the route needs review, already translated. */
  reasons: string[]
  busy: boolean
  error: unknown
  /** True when the trip is moving: the wording says reroute. */
  rerouting?: boolean
  onCancel: () => void
  onApprove: (rationale: string) => void
}

export function RouteApprovalDialog({ risk, reasons, busy, error, rerouting = false, onCancel, onApprove }: RouteApprovalDialogProps) {
  const [rationale, setRationale] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const rows = evidenceRows(risk)
  const complete = rows.filter(([, s]) => s === 'AVAILABLE').length
  const ready = rationale.trim().length >= MIN_RATIONALE && acknowledged && !busy
  const warnings = risk.official_warnings?.on_route ?? []

  return (
    <div role="dialog" aria-labelledby="route-approval-title" className="rounded-xl border border-warning/40 bg-surface p-4 space-y-3" data-testid="route-approval">
      <h3 id="route-approval-title" className="text-sm font-semibold text-ink">Manager decision</h3>
      <p className="text-[12.5px] text-muted">
        These conditions do not prove the road is unsafe, but they are not enough to call it verified. Approving records that <strong>you</strong> accepted that for this {rerouting ? 'reroute' : 'dispatch'}; the route keeps reporting its evidence as incomplete afterwards.
      </p>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted">
          Evidence status · {complete} of {rows.length} available
        </p>
        <ul className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2" data-testid="evidence-status">
          {rows.map(([name, status]) => (
            <li key={name} className="flex justify-between gap-3 border-b border-line py-1 text-[12px]">
              <span className="text-ink">{name}</span>
              <span className={`font-semibold ${TONE[status]}`}>{status}</span>
            </li>
          ))}
        </ul>
      </div>

      {reasons.length > 0 ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted">Why review is required</p>
          <ul className="mt-1 list-disc pl-5 text-[12px] text-ink">
            {reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted">Official alerts on this corridor</p>
          <ul className="mt-1 list-disc pl-5 text-[12px] text-ink">
            {warnings.map((w) => <li key={w.identifier}>{w.event} · {w.severity} — {w.headline}</li>)}
          </ul>
        </div>
      ) : null}

      <label className="block text-[12px]">
        <span className="mb-1 block text-muted">Reason for approval * — the only record of why this risk was accepted</span>
        <textarea
          className="w-full rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
          rows={2}
          value={rationale}
          disabled={busy}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="e.g. Depot confirms road open this morning; proceeding with current evidence"
        />
        {rationale.trim().length < MIN_RATIONALE ? (
          <span className="mt-1 block text-[11px] text-muted">At least {MIN_RATIONALE} characters of reasoning.</span>
        ) : null}
      </label>

      <label className="flex items-start gap-2 text-[12.5px] text-ink">
        <input type="checkbox" className="mt-0.5" checked={acknowledged} disabled={busy} onChange={(e) => setAcknowledged(e.target.checked)} />
        <span>I understand that incomplete evidence is not the same as SAFE.</span>
      </label>

      {error ? <ErrorState error={error} /> : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button busy={busy} disabled={!ready} title={ready ? undefined : 'Enter a reason and tick the acknowledgement first.'} onClick={() => onApprove(rationale.trim())}>
          {rerouting ? 'Approve & reroute' : 'Approve & use route'}
        </Button>
      </div>
    </div>
  )
}
