/**
 * A trip's driver breaks, newest first (`GET /api/trips/{id}/breaks`): why,
 * how long was planned, when it started and was due to end, whether the
 * driver resumed or overran, and where the truck stopped.
 *
 * The place is shown because a manager deciding whether to call needs it;
 * it needs the fleet-location permission, the same as the Fleet map.
 */

import { useEffect, useState } from 'react'

import { api, type TripBreak } from '../api/client'
import { ErrorState, LoadingState } from './ui'

export const BREAK_REASON: Record<TripBreak['reason'], string> = {
  TEA_REST: 'Tea / rest',
  FOOD: 'Food',
  WASHROOM: 'Washroom',
  FUEL: 'Fuel',
  EMERGENCY: 'Emergency',
  OTHER: 'Other',
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** "On break · Food · 30 min · back by 11:42" / "Break overran · …" — one line, for Fleet. */
export function breakLine(b: TripBreak): string {
  const head = b.status === 'OVERDUE' ? 'Break overran' : 'On break'
  return `${head} · ${BREAK_REASON[b.reason] ?? b.reason} · ${b.planned_minutes} min · due back ${clock(b.expected_end_at)}`
}

export default function BreakHistory({ tripId }: { tripId: string }) {
  const [rows, setRows] = useState<TripBreak[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [reloads, setReloads] = useState(0)
  useEffect(() => {
    let alive = true
    setRows(null); setError(null)
    api.tripBreaks(tripId).then(
      (r) => { if (alive) setRows(r) },
      (caught) => { if (alive) setError(caught) },
    )
    return () => { alive = false }
  }, [tripId, reloads])

  if (error) return <ErrorState error={error} onRetry={() => setReloads((n) => n + 1)} />
  if (rows === null) return <LoadingState label="Loading breaks…" />
  if (rows.length === 0) return <p className="py-1 text-[13px] text-muted">No breaks on this trip.</p>
  return (
    <ul className="space-y-2" data-testid="break-history">
      {rows.map((b) => (
        <li key={b.id} className="rounded-[var(--radius-control)] border border-line p-2.5 text-[13px] leading-snug">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-ink">
              {BREAK_REASON[b.reason] ?? b.reason} · {b.planned_minutes} min planned
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                b.status === 'ENDED' && !b.overdue
                  ? 'border-line bg-soft text-muted'
                  : b.overdue
                    ? 'border-warning/30 bg-warning-soft text-warning'
                    : 'border-primary/30 bg-primary-soft text-primary'
              }`}
            >
              {b.status === 'ENDED' ? (b.overdue ? 'RESUMED LATE' : 'RESUMED') : b.status === 'OVERDUE' ? 'OVERDUE' : 'ON BREAK'}
            </span>
          </div>
          <div className="mt-1 text-muted">
            Started {clock(b.started_at)} · due back {clock(b.expected_end_at)}
            {b.ended_at ? ` · resumed ${clock(b.ended_at)} (${Math.round((b.actual_seconds ?? 0) / 60)} min)` : ''}
          </div>
          <div className="text-muted">
            {b.location
              ? `Stopped at ${b.location.lat.toFixed(4)}, ${b.location.lon.toFixed(4)}${b.location_source === 'LAST_FIX' ? ' (last GPS fix)' : ''}`
              : 'Place not known: no GPS fix at the time'}
          </div>
        </li>
      ))}
    </ul>
  )
}
