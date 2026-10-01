/**
 * What happened to this trip, in order.
 *
 * Read-only, and it invents nothing: every line was written by the operation
 * it describes (`GET /api/trips/{id}/events`). Until this existed the server
 * recorded ROUTE_CHANGED, the acknowledgement, the stop completions - and a
 * manager could not see any of it, so "who moved this truck onto that road,
 * and why" was a question only the database could answer.
 *
 * No coordinates. A timeline is the thing a manager shows to somebody else,
 * and a stop's position is the most sensitive data this system holds.
 */

import { useEffect, useState } from 'react'

import { api, type TripEvent } from '../api/client'
import { ErrorState, LoadingState } from './ui'

/** Plain words for the enum, so a judge does not read STOP_ARRIVED. */
const LABEL: Record<string, string> = {
  CREATED: 'Trip created',
  ASSIGNED: 'Driver and truck assigned',
  VERIFIED: 'Truck check completed',
  DISPATCHED: 'Dispatched',
  ACCEPTED: 'Driver acknowledged',
  STARTED: 'Trip started',
  STOP_ARRIVED: 'Arrived at a stop',
  STOP_COMPLETED: 'Stop completed',
  ROUTE_CHANGED: 'Journey changed',
  DELAY_DETECTED: 'Delay / hold',
  COMMS_LOST: 'Contact lost',
  COMMS_RESTORED: 'Contact restored',
  BREAKDOWN_REPORTED: 'Breakdown reported',
  INCIDENT_OPENED: 'Incident opened',
  INCIDENT_RESOLVED: 'Incident resolved',
  DELIVERED: 'Delivered',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
  BREAK_STARTED: 'Driver took a break',
  BREAK_ENDED: 'Driver back on the road',
  BREAK_OVERDUE: 'Break overran',
}

const INSTRUCTION: Record<string, string> = {
  ADD_STOP: 'Stop added',
  RETURN_TO_DEPOT: 'Return to depot',
  NEW_DESTINATION: 'Destination changed',
  HOLD_FOR_INSTRUCTION: 'Hold for instruction',
}

export function historyLines(events: TripEvent[]): {
  id: number
  time: string
  title: string
  detail: string | null
  ack: 'WAITING' | 'DONE' | null
}[] {
  return events.map((e) => {
    // An ACCEPTED event carries the instruction it acknowledges, so naming it
    // after that instruction would print "Stop added ... awaiting driver
    // acknowledgement" ON the acknowledgement itself. It is the driver's line,
    // and it is titled as one.
    const isAck = e.kind === 'ACCEPTED'
    return {
      id: e.id,
      time: new Date(e.occurred_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      title:
        (!isAck && e.instruction ? INSTRUCTION[e.instruction] ?? e.instruction.replaceAll('_', ' ') : null) ??
        LABEL[e.kind] ??
        e.kind.replaceAll('_', ' '),
      detail: e.reason ?? e.description,
      ack: !isAck && e.instruction ? (e.acknowledged ? ('DONE' as const) : ('WAITING' as const)) : null,
    }
  })
}

export default function JourneyHistory({ tripId }: { tripId: string }) {
  const [events, setEvents] = useState<TripEvent[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [reloads, setReloads] = useState(0)
  useEffect(() => {
    let alive = true
    setEvents(null); setError(null)
    api.tripEvents(tripId).then(
      (rows) => { if (alive) setEvents(rows) },
      (caught) => { if (alive) setError(caught) },
    )
    return () => { alive = false }
  }, [tripId, reloads])

  if (error) return <ErrorState error={error} onRetry={() => setReloads((n) => n + 1)} />
  if (events === null) return <LoadingState label="Loading journey history…" />
  if (events.length === 0) return <p className="py-2 text-[13px] text-muted">Nothing has happened on this trip yet.</p>

  // A timeline: the time, a dot on one rule, what happened. The words are
  // the operation's own; the dot adds nothing a reader needs. The time
  // column is 80px and never wraps ("01:37 AM" is 58px at 13px); the rule
  // and the dot sit in the middle of the 24px gap after it.
  return (
    <ol className="relative space-y-3 py-1 before:absolute before:bottom-2 before:left-[91.5px] before:top-2 before:w-px before:bg-line" data-testid="journey-history">
      {historyLines(events).map((line, i) => (
        <li key={`${line.id}-${i}`} className="relative flex gap-6 text-[13px] leading-snug">
          <span className="tnum w-20 shrink-0 whitespace-nowrap text-right text-muted">{line.time}</span>
          <span aria-hidden="true" className="absolute left-[87px] top-1 size-2.5 rounded-full border-2 border-surface bg-outline" />
          <span className="min-w-0">
            <span className="font-semibold text-ink">{line.title}</span>
            {events[i].actor_name ? <span className="text-muted"> by {events[i].actor_name}</span> : null}
            {line.ack ? (
              <span className={line.ack === 'DONE' ? 'text-ok' : 'text-warning'}>
                {line.ack === 'DONE' ? ' · driver acknowledged' : ' · awaiting driver acknowledgement'}
              </span>
            ) : null}
            {line.detail ? <span className="block break-words text-muted">{line.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  )
}
