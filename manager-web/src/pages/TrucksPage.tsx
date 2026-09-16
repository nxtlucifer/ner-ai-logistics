import { useState } from 'react'
import { Link } from 'react-router-dom'

import AssignTruckDialog from '../components/AssignTruckDialog'

import { ApiError, api, type Truck, unavailableReason } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import AuthImage from '../components/AuthImage'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  StatusPill,
} from '../components/ui'
import { useMutation, useResource } from '../hooks/useResource'

const BLANK = {
  registration_number: '',
  max_capacity_kg: '',
  truck_type: '',
  make: '',
  model: '',
  baseline_mileage_kmpl: '',
}

export default function TrucksPage() {
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const trucks = useResource(
    () => api.listTrucks({ search: search || undefined }),
    [search],
    search ? undefined : 'trucks:all',
  )
  // Who holds each truck and whether it is on a trip: read-only context here;
  // the pairing itself is changed from the driver's profile.
  const assignments = useResource(() => api.listAssignments({ activeOnly: true }), [], 'assignments:active')
  const drivers = useResource(() => api.listDrivers({ limit: 100 }), [], 'drivers:100')
  const trips = useResource(() => api.listTrips({ limit: 50 }), [], 'trips:50')
  const driverFor = (truckId: string) => {
    const live = assignments.data?.find((a) => a.truck_id === truckId && (a.status === 'ACTIVE' || a.status === 'PENDING_VERIFICATION'))
    if (!live) return null
    return { id: live.id, name: drivers.data?.items.find((d) => d.id === live.driver_id)?.full_name ?? live.driver_id.slice(0, 8), verified: live.verified_at !== null, mismatch: live.mismatch_flagged }
  }
  // Assign / change driver and End assignment: the same dialog and the same
  // server calls the driver profile uses. The truck is preselected here.
  const [assignFor, setAssignFor] = useState<string | null>(null)
  const endAssignment = useMutation((id: string) => api.endAssignment(id))
  const [endingId, setEndingId] = useState<string | null>(null)
  async function handleEndAssignment(truck: Truck) {
    const holder = driverFor(truck.id)
    if (!holder || !window.confirm(`End ${holder.name}'s assignment to ${truck.registration_number}? Trips already dispatched keep their record.`)) return
    setEndingId(truck.id)
    try {
      if ((await endAssignment.submit(holder.id)).data) { assignments.reload(); drivers.reload() }
    } finally {
      setEndingId(null)
    }
  }
  const tripFor = (truckId: string) => trips.data?.items.find((t) => t.truck_id === truckId && ['ASSIGNED', 'VERIFICATION_PENDING', 'ACTIVE', 'DELAYED'].includes(t.status)) ?? null

  const create = useMutation(async (payload: typeof BLANK) => {
    const body: Record<string, unknown> = {
      registration_number: payload.registration_number.trim(),
      max_capacity_kg: payload.max_capacity_kg,
    }
    for (const key of ['truck_type', 'make', 'model'] as const) {
      if (payload[key].trim()) body[key] = payload[key].trim()
    }
    if (payload.baseline_mileage_kmpl.trim()) {
      body.baseline_mileage_kmpl = payload.baseline_mileage_kmpl
    }
    return api.createTruck(body)
  })

  const retire = useMutation((id: string) => api.retireTruck(id))

  async function handleCreate() {
    setFieldErrors({})
    const { data, error } = await create.submit(form)
    if (data) {
      setForm(BLANK)
      setShowForm(false)
      trucks.reload()
      return
    }
    // Read the error from the return value, not from state: setState is
    // asynchronous, so create.error would still hold the previous value here
    // and this mapping would silently never run.
    if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
      const errors: Record<string, string> = {}
      const details = error.details as {
        errors?: { loc?: unknown[]; msg?: string }[]
      }
      for (const item of details.errors ?? []) {
        const field = String(item.loc?.[item.loc.length - 1] ?? '')
        if (field) errors[field] = item.msg ?? 'Invalid value'
      }
      setFieldErrors(errors)
    }
  }

  // Asked once, used by every control below. A button whose backend has no
  // implementation is rendered disabled with the reason on it, never left
  // looking live so the click can throw.
  const addBlocked = unavailableReason('createTruck')
  const retireBlocked = unavailableReason('retireTruck')

  async function handleRetire(truck: Truck) {
    if (
      !window.confirm(
        `Retire ${truck.registration_number}? It is removed from the active fleet. Trip history is kept.`,
      )
    ) {
      return
    }
    if ((await retire.submit(truck.id)).data) trucks.reload()
  }

  const canCreate = can('truck:create')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Trucks</h1>
          <p className="text-xs text-muted">
            Capacity is a safety limit enforced by the database. Pair a truck with a driver from the driver's profile;{' '}
            <Link to="/assignments" className="text-route hover:underline">assignment records</Link> keep the history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search registration"
            className="w-56 rounded-[var(--radius-control)] border border-outline bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-route focus:ring-1 focus:ring-route"
          />
          {canCreate ? (
            <Button
              onClick={() => setShowForm((v) => !v)}
              variant="secondary"
              disabled={addBlocked !== null}
              title={addBlocked ?? undefined}
            >
              {showForm ? 'Cancel' : 'Add truck'}
            </Button>
          ) : null}
        </div>
      </div>

      {showForm && canCreate ? (
        <Card title="New truck">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Registration number"
              name="registration_number"
              value={form.registration_number}
              onChange={(v) => setForm({ ...form, registration_number: v })}
              required
              placeholder="AS01AB1234"
              hint="Spacing and case are normalised"
              error={fieldErrors.registration_number}
            />
            <Field
              label="Max capacity (kg)"
              name="max_capacity_kg"
              type="number"
              value={form.max_capacity_kg}
              onChange={(v) => setForm({ ...form, max_capacity_kg: v })}
              required
              error={fieldErrors.max_capacity_kg}
            />
            <Field
              label="Type"
              name="truck_type"
              value={form.truck_type}
              onChange={(v) => setForm({ ...form, truck_type: v })}
              placeholder="Open body"
            />
            <Field
              label="Make"
              name="make"
              value={form.make}
              onChange={(v) => setForm({ ...form, make: v })}
              placeholder="Tata"
            />
            <Field
              label="Model"
              name="model"
              value={form.model}
              onChange={(v) => setForm({ ...form, model: v })}
            />
            <Field
              label="Baseline mileage (km/l)"
              name="baseline_mileage_kmpl"
              type="number"
              value={form.baseline_mileage_kmpl}
              onChange={(v) => setForm({ ...form, baseline_mileage_kmpl: v })}
              hint="Fallback used when the fuel model is unavailable"
              error={fieldErrors.baseline_mileage_kmpl}
            />
          </div>

          {create.error && !Object.keys(fieldErrors).length ? (
            <div className="mt-3">
              <ErrorState error={create.error} />
            </div>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button onClick={handleCreate} busy={create.isSubmitting}>
              {create.isSubmitting ? 'Creating…' : 'Create truck'}
            </Button>
            <Button variant="secondary" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      <Card>
        {trucks.status === 'loading' ? (
          <LoadingState label="Loading trucks…" />
        ) : trucks.status === 'error' ? (
          <ErrorState error={trucks.error} onRetry={trucks.reload} />
        ) : trucks.data && trucks.data.items.length === 0 ? (
          <EmptyState
            title={search ? 'No trucks match that search' : 'No trucks yet'}
            description={
              search
                ? 'Try a different registration number.'
                : 'Add your first truck to start building the fleet.'
            }
            action={
              !search && canCreate ? (
                <Button
                  onClick={() => setShowForm(true)}
                  disabled={addBlocked !== null}
                  title={addBlocked ?? undefined}
                >
                  Add truck
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="pb-2 font-medium">Registration</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Capacity</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Assigned driver</th>
                  <th className="pb-2 font-medium">Current trip</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {trucks.data?.items.map((truck) => {
                  const holder = driverFor(truck.id)
                  const open = tripFor(truck.id)
                  // The truck's own status is authoritative: the trips list is
                  // the newest 50, and a long-running trip ages out of it.
                  const busy = open !== null || truck.status === 'ON_TRIP'
                  const busyWhy = open ? `On ${open.trip_code}` : 'On a trip'
                  return (
                  <tr key={truck.id}>
                    <td className="py-3 font-mono font-medium text-ink">
                      <span className="inline-flex items-center gap-2">
                        <AuthImage src={truck.photo_url} alt={`${truck.registration_number} photo`} className="h-10 w-14 rounded-md" label="reference" />
                        {truck.registration_number}
                        {can('truck:update') ? (
                          <label className="cursor-pointer text-[11px] font-normal text-route hover:underline">
                            photo
                            <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void api.uploadTruckPhoto(truck.id, f).then(() => trucks.reload()) }} />
                          </label>
                        ) : null}
                      </span>
                    </td>
                    <td className="py-3 text-muted">
                      {[truck.make, truck.model].filter(Boolean).join(' ') ||
                        truck.truck_type || (
                          <span className="text-muted">—</span>
                        )}
                    </td>
                    <td className="py-3 tabular-nums text-muted">
                      {Number(truck.max_capacity_kg).toLocaleString()} kg
                    </td>
                    <td className="py-3">
                      <StatusPill status={truck.status} />
                    </td>
                    <td className="py-3 text-xs">
                      {assignments.status === 'success' ? (
                        holder ? (
                          <span className="text-ink">
                            {holder.name}
                            <span className={`block text-[11px] ${holder.mismatch ? 'text-warning' : holder.verified ? 'text-ok' : 'text-muted'}`}>
                              {holder.mismatch ? 'plate mismatch — needs review' : holder.verified ? 'truck verified by driver' : 'awaiting driver check'}
                            </span>
                          </span>
                        ) : <span className="text-muted">none</span>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td className="py-3 text-xs">
                      {trips.status === 'success' ? (open ? <span className="text-ink">{open.trip_code} <span className="text-muted">· {open.status.replaceAll('_', ' ').toLowerCase()}</span></span> : truck.status === 'ON_TRIP' ? <span className="text-ink">on a trip <span className="text-muted">· older than the newest 50</span></span> : <span className="text-muted">none</span>) : <span className="text-muted">—</span>}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                      {can('assignment:create') && assignments.status === 'success' && truck.status !== 'RETIRED' ? (
                        <Button
                          variant={holder ? 'secondary' : 'primary'}
                          className="min-h-9 px-2 py-1 text-xs"
                          disabled={busy}
                          title={busy ? `${busyWhy} — the pairing cannot change until it ends` : holder ? 'Move this truck to another driver - the current pairing ends in the same step' : 'Pair a driver with this truck'}
                          onClick={() => setAssignFor(truck.id)}
                        >
                          {holder ? 'Change driver' : 'Assign driver'}
                        </Button>
                      ) : null}
                      {can('assignment:end') && holder ? (
                        <Button
                          variant="secondary"
                          className="min-h-9 px-2 py-1 text-xs"
                          busy={endingId === truck.id}
                          disabled={busy || endingId !== null}
                          title={busy ? `${busyWhy} — cannot end while the trip is open` : 'Free this truck and its driver from each other'}
                          onClick={() => void handleEndAssignment(truck)}
                        >
                          End assignment
                        </Button>
                      ) : null}
                      {can('truck:retire') ? (
                        <Button
                          variant="danger"
                          className="min-h-9 px-2 py-1 text-xs"
                          onClick={() => handleRetire(truck)}
                          busy={retire.isSubmitting}
                          disabled={retireBlocked !== null || truck.status === 'ON_TRIP' || open !== null}
                          title={retireBlocked ?? (open ? `On ${open.trip_code} — finish or cancel it first` : 'Removes the truck from the active fleet. Trip history is kept.')}
                        >
                          Retire
                        </Button>
                      ) : null}
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {retire.error ? (
          <div className="mt-3">
            <ErrorState error={retire.error} />
          </div>
        ) : null}
        {endAssignment.error ? (
          <div className="mt-3">
            <ErrorState error={endAssignment.error} />
          </div>
        ) : null}
      </Card>
      {assignFor ? (
        <AssignTruckDialog truckId={assignFor} onClose={() => setAssignFor(null)} onChanged={() => { assignments.reload(); drivers.reload(); trucks.reload() }} />
      ) : null}
    </div>
  )
}
