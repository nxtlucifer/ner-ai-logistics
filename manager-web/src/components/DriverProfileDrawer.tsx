/**
 * The manager's view of one driver: operational facts, the live truck pairing,
 * the current trip, documents - and nothing from inside the driver's app.
 *
 * Replaces "View as driver" in the normal workflow. The support session (a
 * read-only look at the driver's app, GET-only, 15 minutes, audited) still
 * exists, but sits under Support at the bottom, behind its own permission,
 * with the consequence written next to it. Destructive actions live there too.
 */
import { useEffect, useRef, useState } from 'react'

import { DRIVER_WEB_URL, api, type Assignment, type Driver, type Trip, type Truck, unavailableReason } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import AuthImage, { initials } from './AuthImage'
import { Button, ErrorState, LoadingState, StatusPill } from './ui'
import AssignTruckDialog from './AssignTruckDialog'
import { useMutation, useResource } from '../hooks/useResource'

// A draft is the manager's, not the driver's: only a dispatched trip is "current".
const OPEN_TRIP = new Set(['ASSIGNED', 'VERIFICATION_PENDING', 'ACTIVE', 'DELAYED'])

export function licenceHealth(expiry: string, today = new Date()): { label: string; tone: 'ok' | 'warning' | 'danger' } {
  const days = Math.floor((new Date(expiry).getTime() - new Date(today.toDateString()).getTime()) / 86_400_000)
  if (days < 0) return { label: `Expired ${expiry}`, tone: 'danger' }
  if (days <= 30) return { label: `Expires in ${days} day${days === 1 ? '' : 's'} (${expiry})`, tone: 'warning' }
  return { label: `Valid to ${expiry}`, tone: 'ok' }
}

const TONE = { ok: 'text-ok', warning: 'text-warning', danger: 'text-danger' } as const

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink break-words">{children}</dd>
    </div>
  )
}

export interface DriverProfileDrawerProps {
  driver: Driver
  trucks: Truck[]
  assignments: Assignment[]
  trips: Trip[]
  onClose: () => void
  /** Something changed (assignment, deactivation): the owner reloads its lists. */
  onChanged: () => void
}

export default function DriverProfileDrawer({ driver, trucks, assignments, trips, onClose, onChanged }: DriverProfileDrawerProps) {
  const { can } = useAuth()
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const dialog = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const previous = document.activeElement
    closeButton.current?.focus()
    const keep = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.current?.contains(event.target)) closeButton.current?.focus()
    }
    document.addEventListener('focusin', keep)
    return () => {
      document.removeEventListener('focusin', keep)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  const documents = useResource(() => api.driverDocuments(driver.id), [driver.id])
  const live = assignments.find((a) => a.driver_id === driver.id && (a.status === 'ACTIVE' || a.status === 'PENDING_VERIFICATION')) ?? null
  const truck = live ? trucks.find((t) => t.id === live.truck_id) ?? null : null
  const current = trips.find((t) => t.driver_id === driver.id && OPEN_TRIP.has(t.status)) ?? null
  const history = trips.filter((t) => t.driver_id === driver.id)
  const delivered = history.filter((t) => t.status === 'DELIVERED' || t.status === 'CLOSED').length
  const health = licenceHealth(driver.licence_expiry)

  // Assign / change go through the shared dialog, the same one Fleet and
  // Trucks open - one place that knows the pairing rules.
  const [assigning, setAssigning] = useState(false)
  const end = useMutation((id: string) => api.endAssignment(id))
  const manual = useMutation((id: string, plate: string) => api.verifyAssignmentManually(id, plate))
  const deactivate = useMutation((id: string) => api.deactivateDriver(id))
  const support = useMutation((id: string) => api.supportSession(id))
  const [plate, setPlate] = useState('')
  const endBlocked = unavailableReason('endAssignment')
  const deactivateBlocked = unavailableReason('deactivateDriver')
  const supportBlocked = unavailableReason('supportSession')

  async function handleEnd() {
    if (!live || !window.confirm(`End ${driver.full_name}'s assignment to ${truck?.registration_number ?? 'this truck'}? Trips already dispatched keep their record.`)) return
    if ((await end.submit(live.id)).data) onChanged()
  }
  async function handleManual() {
    if (!live) return
    if ((await manual.submit(live.id, plate.trim())).data) { setPlate(''); onChanged() }
  }
  async function handleDeactivate() {
    if (!window.confirm(`Deactivate ${driver.full_name}?\n\n• Their login is disabled immediately\n• Future dispatch to them is blocked\n• Trip history is preserved`)) return
    if ((await deactivate.submit(driver.id)).data) { onChanged(); onClose() }
  }
  async function handleSupport() {
    const { data } = await support.submit(driver.id)
    if (data) window.open(`${DRIVER_WEB_URL}/#support=${encodeURIComponent(data.token)}`, '_blank', 'noopener')
  }

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="driver-profile-title"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}
      className="fixed inset-0 z-50 flex justify-end bg-canvas/70"
      data-testid="driver-profile"
    >
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-line bg-surface shadow-[var(--shadow-panel)]">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <AuthImage src={driver.photo_url} alt={`${driver.full_name} photo`} fallback={initials(driver.full_name)} className="h-14 w-14 rounded-full" />
            <div className="min-w-0">
              <h2 id="driver-profile-title" className="text-lg font-bold text-ink">{driver.full_name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <StatusPill status={driver.status} />
                <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${driver.login_is_active ? 'border-ok/30 bg-ok-soft text-ok' : 'border-warning/30 bg-warning-soft text-warning'}`}>
                  {driver.login_is_active ? 'LOGIN ACTIVE' : 'LOGIN INACTIVE'}
                </span>
              </div>
            </div>
          </div>
          <button ref={closeButton} type="button" onClick={onClose} className="min-h-11 rounded-md px-3 text-sm text-muted hover:text-ink" aria-label="Close driver profile">Close</button>
        </div>

        <div className="space-y-5 px-5 py-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Phone">{driver.phone}</Fact>
            <Fact label="Driver ID"><span className="font-mono text-xs">{driver.id.slice(0, 8)}</span></Fact>
            <Fact label="Licence"><span className="font-mono text-xs">{driver.licence_number}</span></Fact>
            <Fact label="Licence status"><span className={TONE[health.tone]}>{health.label}</span></Fact>
            <Fact label="Availability">{driver.status.replaceAll('_', ' ')}</Fact>
            <Fact label="Login">{driver.login_is_active ? 'Can sign in to the driver app' : 'Disabled — cannot be dispatched'}</Fact>
          </dl>

          <section className="rounded-[10px] border border-line p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Assigned truck</h3>
            {live ? (
              <div className="mt-1.5 space-y-1 text-sm">
                <p className="font-mono font-semibold text-ink">{truck?.registration_number ?? live.truck_id.slice(0, 8)}{truck ? <span className="ml-2 font-sans text-xs font-normal text-muted">{Number(truck.max_capacity_kg).toLocaleString()} kg</span> : null}</p>
                <p className="text-xs">
                  {live.verified_at ? (
                    live.mismatch_flagged
                      ? <span className="text-warning">Driver reported a different registration — needs review</span>
                      : <span className="text-ok">Verified {new Date(live.verified_at).toLocaleString()} · {live.verification_source === 'DRIVER_APP_PHOTO' ? 'driver photo' : live.verification_source === 'MANAGER_MANUAL' ? 'manager by hand' : 'driver, plate only'}</span>
                  ) : <span className="text-muted">Awaiting the driver's truck check</span>}
                </p>
                {!live.verified_at && can('assignment:review') ? (
                  <form className="mt-1 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void handleManual() }}>
                    <input aria-label="Number plate on the truck" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder={truck?.registration_number ?? 'PLATE'} className="w-36 rounded border border-line bg-surface px-2 py-1 font-mono text-xs" />
                    <Button type="submit" variant="secondary" busy={manual.isSubmitting} disabled={plate.trim().length < 4} title="Driver has no smartphone: confirm the plate by hand. Recorded as MANAGER_MANUAL.">Verify by hand</Button>
                  </form>
                ) : null}
                {manual.error ? <ErrorState error={manual.error} /> : null}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {can('assignment:create') ? (
                    <Button variant="secondary" className="min-h-9 px-2 py-1 text-xs" disabled={current !== null} title={current ? `Cannot change while ${current.trip_code} is open` : 'Move this driver to another truck - the current pairing ends in the same step'} onClick={() => setAssigning(true)}>Change truck</Button>
                  ) : null}
                  {can('assignment:end') ? (
                    <Button variant="danger" className="min-h-9 px-2 py-1 text-xs" busy={end.isSubmitting} disabled={endBlocked !== null || current !== null} title={endBlocked ?? (current ? `Cannot end while ${current.trip_code} is open` : undefined)} onClick={() => void handleEnd()}>End assignment</Button>
                  ) : null}
                </div>
                {end.error ? <ErrorState error={end.error} /> : null}
              </div>
            ) : (
              <div className="mt-1.5 space-y-2 text-sm">
                <p className="text-warning">No truck assigned — this driver cannot be dispatched until one is.</p>
                {can('assignment:create') ? (
                  <Button disabled={!driver.login_is_active} title={driver.login_is_active ? 'Pair this driver with a truck' : 'Login inactive — reactivate first'} onClick={() => setAssigning(true)}>Assign truck</Button>
                ) : null}
              </div>
            )}
            {assigning ? <AssignTruckDialog driverId={driver.id} onClose={() => setAssigning(false)} onChanged={onChanged} /> : null}
          </section>

          <section className="rounded-[10px] border border-line p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Current trip</h3>
            {current ? (
              <p className="mt-1.5 text-sm"><span className="font-semibold text-ink">{current.trip_code}</span> <StatusPill status={current.status} />{current.started_at ? <span className="ml-2 text-xs text-muted">started {new Date(current.started_at).toLocaleString()}</span> : current.dispatched_at ? <span className="ml-2 text-xs text-muted">dispatched {new Date(current.dispatched_at).toLocaleString()}</span> : null}</p>
            ) : <p className="mt-1.5 text-sm text-muted">No open trip.</p>}
            <p className="mt-1 text-xs text-muted">{history.length} trip{history.length === 1 ? '' : 's'} in the last 50 · {delivered} delivered</p>
          </section>

          <section className="rounded-[10px] border border-line p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Documents</h3>
            {documents.status === 'loading' ? <LoadingState label="Reading documents…" /> : documents.status === 'error' ? <ErrorState error={documents.error} onRetry={documents.reload} /> : documents.data && documents.data.length > 0 ? (
              <ul className="mt-1.5 space-y-1 text-sm">
                {documents.data.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-ink">{d.doc_type.replaceAll('_', ' ')}{d.number_masked ? <span className="ml-2 font-mono text-xs text-muted">{d.number_masked}</span> : null}</span>
                    <span className="text-xs text-muted">{d.status.replaceAll('_', ' ')}{d.expires_on ? ` · expires ${d.expires_on}` : ''}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1.5 text-sm text-muted">No documents on file. Numbers are shown masked; document images are not opened from here.</p>}
          </section>

          {(can('driver:deactivate') || can('driver:support_view')) ? (
            <details className="rounded-[10px] border border-danger/30 p-3">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-danger">Support &amp; danger zone</summary>
              <div className="mt-3 space-y-3">
                {can('driver:support_view') && driver.login_is_active ? (
                  <div>
                    <Button variant="secondary" busy={support.isSubmitting} disabled={supportBlocked !== null} title={supportBlocked ?? undefined} onClick={() => void handleSupport()}>Open read-only support view</Button>
                    <p className="mt-1 text-xs text-muted">Opens this driver's app read-only for 15 minutes, audited. No password is shared. For support only, not for operations.</p>
                    {support.error ? <ErrorState error={support.error} /> : null}
                  </div>
                ) : null}
                {can('driver:deactivate') ? (
                  <div>
                    <Button variant="danger" busy={deactivate.isSubmitting} disabled={deactivateBlocked !== null || !driver.login_is_active} title={deactivateBlocked ?? (!driver.login_is_active ? 'Already inactive' : undefined)} onClick={() => void handleDeactivate()}>Deactivate driver</Button>
                    <p className="mt-1 text-xs text-muted">Login disabled · future dispatch blocked · trip history preserved.</p>
                    {deactivate.error ? <ErrorState error={deactivate.error} /> : null}
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  )
}
