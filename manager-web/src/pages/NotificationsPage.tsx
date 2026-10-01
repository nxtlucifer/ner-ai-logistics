/**
 * A scoped manager's inbox.
 *
 * WHAT IS HERE THAT IS NOT IN THE TRIP LIST
 *
 * Trips are a register: everything, ordered by status. This is the list of
 * things that HAPPENED to someone else's trip that a district or state
 * manager has to act on - a truck dispatched towards them, a route changed
 * under a driver they cover, a driver asking to stop. A destination
 * district manager who was asleep when a truck left finds it here.
 *
 * WHY THE SENTENCE IS BUILT IN THE BROWSER
 *
 * The server stores `kind` plus a payload, never a written sentence. A
 * sentence frozen into a row in September cannot be translated in October,
 * and this console will be read in more than one language.
 *
 * URGENT IS RESERVED
 *
 * Only a person asking for help. If routine dispatch were urgent, nothing
 * would be.
 */

import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, CheckCircle2, Clock, Coffee, MapPin, PackageCheck, Route, ShieldCheck, Siren, Truck, type LucideIcon } from 'lucide-react'

import { api, type Notification } from '../api/client'
import { ageLabel } from '../api/connectivity'
import { useEmergencies } from '../hooks/useEmergencies'
import { useMutation, useResource } from '../hooks/useResource'
import { LoadingState, Panel } from '../components/ui'
import { ActionButton, InlineError, PageHeader, Pill, Quiet, actionClass } from '../components/pageKit'
import { detail, headline } from './notificationText'

/** Newest first, and never so many that the page becomes a scroll. */
const PAGE = 50

// The activity rail's grammar (manager_03): a 36px tinted tile by severity,
// the glyph by kind. Red is kept for a person asking for help.
const KIND_ICON: Record<Notification['kind'], LucideIcon> = {
  TRIP_DISPATCHED: Truck,
  INCOMING_TRIP: Truck,
  ROUTE_CHANGED: Route,
  TRIP_DELAYED: Clock,
  TRIP_ARRIVED: MapPin,
  TRIP_DELIVERED: PackageCheck,
  DRIVER_EMERGENCY_STOP: Siren,
  EMERGENCY_RESOLVED: ShieldCheck,
  ROUTE_APPROVED: CheckCircle2,
  DRIVER_BREAK_STARTED: Coffee,
  DRIVER_BREAK_ENDED: Truck,
  DRIVER_BREAK_OVERDUE: Clock,
}
const SEVERITY_TILE: Record<Notification['severity'], string> = {
  URGENT: 'bg-danger-soft text-danger',
  WARNING: 'bg-warning-soft text-warning',
  INFO: 'bg-primary-soft text-primary',
}

export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(true)
  const key = `notifications:${unreadOnly}`
  const inbox = useResource(
    () => api.listNotifications({ unread_only: unreadOnly, limit: PAGE }),
    [key],
    key,
  )
  const navigate = useNavigate()
  const markRead = useMutation(api.markNotificationsRead)
  // Whether a driver's stop request still needs an answer is the SOS list's
  // answer (the shell's poll), not the notice's severity: a resolved SOS kept
  // saying "needs an answer now" in red for 32 hours (AUD2-04). Until the list
  // has answered, and when its last check failed, the notice keeps its urgency.
  const sos = useEmergencies()
  const answered = (n: Notification) =>
    n.kind === 'DRIVER_EMERGENCY_STOP' &&
    sos.loaded &&
    !sos.unavailable &&
    !sos.emergencies.some((e) => e.trip_id === n.trip_id)

  const markAll = useCallback(async () => {
    const ids = (inbox.data ?? []).filter((n) => !n.is_read).map((n) => n.id)
    if (ids.length === 0) return
    const { error } = await markRead.submit(ids)
    if (!error) inbox.reload()
  }, [inbox, markRead])

  const rows = inbox.data ?? []
  const unread = rows.filter((n) => !n.is_read).length
  const loaded = !inbox.error && inbox.data !== null

  return (
    <div className="flex flex-col gap-[14px]">
      <PageHeader
        title="Notifications"
        meta="What the system needed you to know, kept after it was sent. Nothing here expires on a refresh."
      />
      <Panel
        title={!loaded ? 'Inbox' : unread > 0 ? `${unread} Unread` : 'All Read'}
        subtitle={`${unreadOnly ? 'Unread only' : 'Read and unread'} · newest first, up to ${PAGE}${loaded && unread === 0 ? ' · nothing left to mark read' : ''}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* The filter: the same unread_only query as before, as two choices. */}
            <div role="group" aria-label="Show notifications" className="inline-flex rounded-[6px] border border-line bg-soft p-0.5">
              {([['Unread', true], ['All', false]] as const).map(([label, value]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={unreadOnly === value}
                  onClick={() => setUnreadOnly(value)}
                  // The ring is the state cue (WCAG 1.4.11, A11Y-4): 3:1 on the
                  // track in both themes, as on the profile menu's theme toggle.
                  className={`min-h-8 rounded-[5px] px-3 text-[13px] font-semibold ${unreadOnly === value ? 'bg-surface-raised text-ink shadow-[var(--shadow-card)] ring-1 ring-outline' : 'text-muted hover:text-ink'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* Outlined: the one filled button on a row is a call to a driver
                asking to stop, and it must not compete with housekeeping. */}
            <ActionButton
              onClick={() => void markAll()}
              disabled={!loaded || unread === 0}
              busy={markRead.isSubmitting}
              title={loaded && unread === 0 ? 'Nothing unread to mark' : undefined}
            >
              Mark all read
            </ActionButton>
          </div>
        }
      >
        {inbox.error ? (
          <InlineError what="Your notifications could not be loaded" error={inbox.error} onRetry={inbox.reload} />
        ) : !inbox.data ? (
          <LoadingState label="Loading your notifications" />
        ) : rows.length === 0 ? (
          <Quiet icon={BellRing} title={unreadOnly ? 'Nothing unread' : 'Nothing yet'}>
            A truck dispatched towards your district, a route changed under a driver you cover, or a driver asking to stop will appear here — and will still be here if you were away when it happened.
          </Quiet>
        ) : (
          <ul>
            {rows.map((n) => {
              const Icon = KIND_ICON[n.kind] ?? BellRing
              const line = detail(n)
              const closed = answered(n)
              return (
                <li key={n.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-line py-3 first:border-t-0 first:pt-1">
                  <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-[8px] ${SEVERITY_TILE[n.severity]}`}>
                    <Icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className={`text-sm text-ink ${n.is_read ? 'font-medium' : 'font-semibold'}`}>{headline(n)}</p>
                      {/* In words, not by fading the row: a faded row fails contrast. */}
                      {n.is_read ? null : <Pill tone={n.severity === 'URGENT' ? 'danger' : 'neutral'}>Unread</Pill>}
                    </div>
                    {line ? <p className="mt-0.5 text-[13px] text-muted">{line}</p> : null}
                    <p className="mt-1 text-xs text-muted">
                      {new Date(n.created_at).toLocaleString()}
                      {n.severity !== 'URGENT' ? null : closed ? (
                        <span className="font-medium text-muted"> · no SOS is open on this trip now</span>
                      ) : (
                        <span className="font-semibold text-danger"> · needs an answer now</span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full max-sm:pl-12">
                    <time dateTime={n.created_at} className="mr-1 text-[13px] text-muted max-sm:hidden">
                      {ageLabel(Date.parse(n.created_at))}
                    </time>
                    {/* A driver asking to stop is a phone call, not a form. The
                        number travels in the payload so this button needs no
                        second request to exist. */}
                    {n.kind === 'DRIVER_EMERGENCY_STOP' && n.payload?.driver_phone ? (
                      <a className={actionClass(closed ? 'outline' : 'primary')} href={`tel:${n.payload.driver_phone}`}>
                        Call {n.payload.driver_name ?? 'driver'}
                      </a>
                    ) : null}
                    {n.trip_id ? (
                      <ActionButton onClick={() => navigate('/trips')}>Open trips</ActionButton>
                    ) : null}
                    {!n.is_read ? (
                      <ActionButton
                        disabled={markRead.isSubmitting}
                        onClick={async () => {
                          const { error } = await markRead.submit([n.id])
                          if (!error) inbox.reload()
                        }}
                      >
                        Mark read
                      </ActionButton>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {markRead.error ? <InlineError compact what="Not marked as read" error={markRead.error} /> : null}
      </Panel>
    </div>
  )
}
