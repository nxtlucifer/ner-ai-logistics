/**
 * Assign a truck to a driver - one dialog, opened from wherever the manager
 * happens to be (Fleet quick actions, a driver row or profile, a truck row).
 *
 * The rules shown here are the SERVER's rules restated so the manager sees
 * the refusal before pressing anything: one driver holds one truck, one truck
 * one driver; a pairing with a trip under way cannot be broken
 * (ASSIGNMENT_HAS_LIVE_TRIP); a suspended driver, an expired licence or a
 * truck that is not operational are refused. Choosing a truck another driver
 * holds is allowed and said plainly - the server ends that pairing in the same
 * transaction. The server still decides; this only stops the dead click.
 */
import { useEffect, useRef, useState } from 'react'

import { api, type Assignment, type Driver, type Trip, type Truck } from '../api/client'
import { Button, ErrorState, LoadingState } from './ui'
import { useMutation, useResource } from '../hooks/useResource'
import { licenceHealth } from './DriverProfileDrawer'
import { wrapTab } from './focusTrap'

const OPEN_TRIP = new Set(['ASSIGNED', 'VERIFICATION_PENDING', 'ACTIVE', 'DELAYED'])
const HELD = new Set(['ACTIVE', 'PENDING_VERIFICATION'])

export interface AssignTruckDialogProps {
  /** Preselect, when opened from a driver's row or profile. */
  driverId?: string
  /** Preselect, when opened from a truck's row. */
  truckId?: string
  onClose: () => void
  /** Called after the server accepted the assignment. */
  onChanged: () => void
}

/** Why this pair cannot be assigned right now, or null. Pure, for the test. */
export function assignmentBlocker(input: {
  driver: Driver | null
  truck: Truck | null
  assignments: Assignment[]
  trips: Trip[]
  drivers: Driver[]
}): string | null {
  const { driver, truck, assignments, trips, drivers } = input
  if (!driver) return 'Choose a driver.'
  if (!truck) return 'Choose a truck.'
  if (!driver.login_is_active) return `${driver.full_name}'s login is inactive — reactivate them first.`
  if (driver.status === 'SUSPENDED') return `${driver.full_name} is suspended.`
  if (licenceHealth(driver.licence_expiry).tone === 'danger') return `${driver.full_name}'s licence has expired.`
  if (truck.status !== 'AVAILABLE' && truck.status !== 'ON_TRIP') return `${truck.registration_number} is ${truck.status.toLowerCase().replaceAll('_', ' ')} — not operational.`
  const held = (id: string, key: 'driver_id' | 'truck_id') => assignments.find((a) => a[key] === id && HELD.has(a.status)) ?? null
  const driverHolds = held(driver.id, 'driver_id')
  if (driverHolds && driverHolds.truck_id === truck.id) return `${driver.full_name} is already paired with ${truck.registration_number}.`
  // The trips list is the newest 50 and a long trip ages out of it, so the
  // driver's and the truck's own ON_TRIP status are read as well - they are
  // what the server's live-trip guard will find.
  const driverTrip = trips.find((t) => t.driver_id === driver.id && OPEN_TRIP.has(t.status))
  if (driverHolds && (driverTrip || driver.status === 'ON_TRIP')) {
    return `${driver.full_name} is on ${driverTrip ? driverTrip.trip_code : 'a trip'} — the pairing cannot change until it ends.`
  }
  const truckHolds = held(truck.id, 'truck_id')
  const truckTrip = trips.find((t) => t.truck_id === truck.id && OPEN_TRIP.has(t.status))
  if (truckHolds && (truckTrip || truck.status === 'ON_TRIP')) {
    const who = drivers.find((d) => d.id === truckHolds.driver_id)?.full_name ?? 'another driver'
    return `${truck.registration_number} is on ${truckTrip ? truckTrip.trip_code : 'a trip'} with ${who} — it cannot be reassigned until that trip ends.`
  }
  return null
}

export default function AssignTruckDialog({ driverId, truckId, onClose, onChanged }: AssignTruckDialogProps) {
  const drivers = useResource(() => api.listDrivers({ limit: 100 }), [], 'drivers:100')
  const trucks = useResource(() => api.listTrucks({ limit: 100 }), [], 'trucks:100')
  const assignments = useResource(() => api.listAssignments({ activeOnly: true }), [], 'assignments:active')
  const trips = useResource(() => api.listTrips({ limit: 50 }), [], 'trips:50')
  const [pickDriver, setPickDriver] = useState(driverId ?? '')
  const [pickTruck, setPickTruck] = useState(truckId ?? '')
  const assign = useMutation((d: string, t: string) => api.createAssignment(d, t))

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

  const loading = [drivers, trucks, assignments, trips].some((r) => r.status === 'loading')
  const failed = [drivers, trucks, assignments, trips].find((r) => r.status === 'error')
  const driverList = drivers.data?.items ?? []
  const truckList = trucks.data?.items ?? []
  const live = assignments.data ?? []
  const tripList = trips.data?.items ?? []
  const driver = driverList.find((d) => d.id === pickDriver) ?? null
  const truck = truckList.find((t) => t.id === pickTruck) ?? null
  const holderOf = (t: Truck) => {
    const a = live.find((x) => x.truck_id === t.id && HELD.has(x.status))
    return a ? driverList.find((d) => d.id === a.driver_id)?.full_name ?? 'another driver' : null
  }
  const truckOf = (d: Driver) => {
    const a = live.find((x) => x.driver_id === d.id && HELD.has(x.status))
    return a ? truckList.find((t) => t.id === a.truck_id)?.registration_number ?? 'a truck' : null
  }
  const tripOf = (key: 'driver_id' | 'truck_id', id: string) => tripList.find((t) => t[key] === id && OPEN_TRIP.has(t.status)) ?? null
  const blocker = loading || failed ? null : assignmentBlocker({ driver, truck, assignments: live, trips: tripList, drivers: driverList })
  // What the server will do when the pair is valid - said before the click.
  const ending: string[] = []
  if (driver && truck && !blocker) {
    const prev = truckOf(driver)
    if (prev) ending.push(`ends ${driver.full_name}'s pairing with ${prev}`)
    const who = holderOf(truck)
    if (who) ending.push(`takes ${truck.registration_number} from ${who}`)
  }

  async function submit() {
    if (!driver || !truck || blocker) return
    if ((await assign.submit(driver.id, truck.id)).data) { onChanged(); onClose() }
  }

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label="Assign a truck"
      // Handled here and stopped: when this dialog sits inside the profile
      // drawer, the drawer's own trap must not also act on the same key.
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } else if (e.key === 'Tab') { e.stopPropagation(); wrapTab(e) } }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-canvas/80 p-4"
    >
      <div className="w-full max-w-lg space-y-3 rounded-xl border border-line bg-surface p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">Assign a truck</h2>
            <p className="text-xs text-muted">One driver holds one truck, one truck one driver. A pairing with a trip under way cannot change.</p>
          </div>
          <button ref={closeButton} type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted hover:text-ink" aria-label="Close">Close</button>
        </div>

        {loading ? <LoadingState label="Loading drivers and trucks…" /> : failed ? <ErrorState error={failed.error} onRetry={() => { drivers.reload(); trucks.reload(); assignments.reload(); trips.reload() }} /> : (
          <>
            <label className="block">
              <span className="text-xs font-medium text-ink">Driver<span className="ml-0.5 text-danger">*</span></span>
              <select value={pickDriver} onChange={(e) => setPickDriver(e.target.value)} aria-label="Driver" className="mt-1 w-full rounded-[var(--radius-control)] border border-outline bg-surface px-3 py-2 text-sm text-ink">
                <option value="">Choose a driver…</option>
                {driverList.map((d) => {
                  const t = truckOf(d); const trip = tripOf('driver_id', d.id)
                  return (
                    <option key={d.id} value={d.id}>
                      {d.full_name} — {d.status.toLowerCase().replaceAll('_', ' ')}{t ? ` · holds ${t}` : ' · no truck'}{trip ? ` · on ${trip.trip_code}` : ''}{d.login_is_active ? '' : ' · login inactive'}
                    </option>
                  )
                })}
              </select>
            </label>
            {driver ? (
              <p className="text-xs text-muted">
                Licence: <span className={licenceHealth(driver.licence_expiry).tone === 'ok' ? 'text-ok' : licenceHealth(driver.licence_expiry).tone === 'warning' ? 'text-warning' : 'text-danger'}>{licenceHealth(driver.licence_expiry).label}</span>
                {' · '}{driver.login_is_active ? 'can sign in' : 'login inactive'}
              </p>
            ) : null}

            <label className="block">
              <span className="text-xs font-medium text-ink">Truck<span className="ml-0.5 text-danger">*</span></span>
              <select value={pickTruck} onChange={(e) => setPickTruck(e.target.value)} aria-label="Truck" className="mt-1 w-full rounded-[var(--radius-control)] border border-outline bg-surface px-3 py-2 text-sm text-ink">
                <option value="">Choose a truck…</option>
                {truckList.filter((t) => t.status !== 'RETIRED').map((t) => {
                  const who = holderOf(t); const trip = tripOf('truck_id', t.id)
                  return (
                    <option key={t.id} value={t.id}>
                      {t.registration_number} — {Number(t.max_capacity_kg).toLocaleString()} kg · {t.status.toLowerCase().replaceAll('_', ' ')}{who ? ` · with ${who}` : ' · free'}{trip ? ` · on ${trip.trip_code}` : ''}
                    </option>
                  )
                })}
              </select>
            </label>

            {/* The verdict, in words, before the button. */}
            {blocker ? (
              <p className="text-xs text-warning" role="status" data-testid="assign-blocker">{blocker}</p>
            ) : driver && truck ? (
              <p className="text-xs text-ink" role="status" data-testid="assign-summary">
                <span className="font-semibold">{driver.full_name}</span> → <span className="font-mono font-semibold">{truck.registration_number}</span>
                {ending.length ? <span className="text-muted"> · {ending.join(' and ')}</span> : null}
                <span className="block text-muted">The driver confirms the physical truck in the app before the first trip can start.</span>
              </p>
            ) : null}
            {assign.error ? <ErrorState error={assign.error} /> : null}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button busy={assign.isSubmitting} disabled={!!blocker || !driver || !truck || assign.isSubmitting} title={blocker ?? undefined} onClick={() => void submit()}>
                {ending.length ? 'Change pairing' : 'Assign truck'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
