import { useState } from 'react'

import { ApiError, api, type Driver, unavailableReason } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import AuthImage, { initials } from '../components/AuthImage'
import AssignTruckDialog from '../components/AssignTruckDialog'
import DriverProfileDrawer, { licenceHealth } from '../components/DriverProfileDrawer'
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
  full_name: '',
  phone: '',
  email: '',
  licence_number: '',
  licence_expiry: '',
  initial_password: '',
}

// A draft is the manager's, not the driver's: only a dispatched trip is "current".
const OPEN_TRIP = new Set(['ASSIGNED', 'VERIFICATION_PENDING', 'ACTIVE', 'DELAYED'])

export default function DriversPage() {
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [profileId, setProfileId] = useState<string | null>(null)
  // Contextual "Assign truck" on a row: the same dialog Fleet and Trucks open.
  const [assignFor, setAssignFor] = useState<string | null>(null)

  const drivers = useResource(
    () => api.listDrivers({ search: search || undefined }),
    [search],
    search ? undefined : 'drivers:all',
  )
  // Secondary context for each row - the live truck pairing and the open trip.
  // A failure here degrades the row to "—", it never hides the driver.
  const assignments = useResource(() => api.listAssignments({ activeOnly: true }), [], 'assignments:active')
  const trucks = useResource(() => api.listTrucks({ limit: 100 }), [], 'trucks:100')
  const trips = useResource(() => api.listTrips({ limit: 50 }), [], 'trips:50')

  const create = useMutation(async (payload: typeof BLANK) => {
    const body: Record<string, unknown> = {
      full_name: payload.full_name.trim(),
      phone: payload.phone.trim(),
      licence_number: payload.licence_number.trim(),
      licence_expiry: payload.licence_expiry,
      initial_password: payload.initial_password,
    }
    if (payload.email.trim()) body.email = payload.email.trim()
    return api.createDriver(body)
  })

  // See UNAVAILABLE_OPERATIONS: no hosted implementation, so the control says
  // so rather than throwing when pressed.
  const addBlocked = unavailableReason('createDriver')

  async function handleCreate() {
    setFieldErrors({})
    const { data, error } = await create.submit(form)
    if (data) {
      setForm(BLANK)
      setShowForm(false)
      drivers.reload()
      return
    }
    // Surface 422 details against the fields that caused them. Read the error
    // from the return value, not from state: setState is asynchronous.
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

  const canCreate = can('driver:create')
  const truckFor = (driverId: string) => {
    const live = assignments.data?.find((a) => a.driver_id === driverId && (a.status === 'ACTIVE' || a.status === 'PENDING_VERIFICATION'))
    if (!live) return null
    return trucks.data?.items.find((t) => t.id === live.truck_id)?.registration_number ?? live.truck_id.slice(0, 8)
  }
  const tripFor = (driverId: string) => trips.data?.items.find((t) => t.driver_id === driverId && OPEN_TRIP.has(t.status)) ?? null
  const profile: Driver | null = profileId ? drivers.data?.items.find((d) => d.id === profileId) ?? null : null

  function reloadContext() {
    drivers.reload(); assignments.reload(); trucks.reload(); trips.reload()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Drivers</h1>
          <p className="text-xs text-muted">
            Who can drive, which truck they hold, and whether they are on the road. Open a profile for details and actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or licence"
            aria-label="Search drivers by name or licence"
            className="w-56 rounded-[var(--radius-control)] border border-outline bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-route focus:ring-1 focus:ring-route"
          />
          {/* Rendered only when permitted - but the server enforces it too. */}
          {canCreate ? (
            <Button
              onClick={() => setShowForm((v) => !v)}
              variant="secondary"
              disabled={addBlocked !== null}
              title={addBlocked ?? undefined}
            >
              {showForm ? 'Cancel' : 'Add driver'}
            </Button>
          ) : null}
        </div>
      </div>

      {showForm && canCreate ? (
        <Card title="New driver">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Full name"
              name="full_name"
              value={form.full_name}
              onChange={(v) => setForm({ ...form, full_name: v })}
              required
              error={fieldErrors.full_name}
            />
            <Field
              label="Phone"
              name="phone"
              value={form.phone}
              onChange={(v) => setForm({ ...form, phone: v })}
              required
              hint="Used to sign in to the driver app"
              error={fieldErrors.phone}
            />
            <Field
              label="Licence number"
              name="licence_number"
              value={form.licence_number}
              onChange={(v) => setForm({ ...form, licence_number: v })}
              required
              error={fieldErrors.licence_number}
            />
            <Field
              label="Licence expiry"
              name="licence_expiry"
              type="date"
              value={form.licence_expiry}
              onChange={(v) => setForm({ ...form, licence_expiry: v })}
              required
              hint="An expired licence blocks assignment"
              error={fieldErrors.licence_expiry}
            />
            <Field
              label="Email (optional)"
              name="email"
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
              error={fieldErrors.email}
            />
            <Field
              label="Initial password"
              name="initial_password"
              type="password"
              value={form.initial_password}
              onChange={(v) => setForm({ ...form, initial_password: v })}
              required
              hint="At least 8 characters"
              error={fieldErrors.initial_password}
            />
          </div>

          {create.error && !Object.keys(fieldErrors).length ? (
            <div className="mt-3">
              <ErrorState error={create.error} />
            </div>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button onClick={handleCreate} busy={create.isSubmitting}>
              {create.isSubmitting ? 'Creating…' : 'Create driver'}
            </Button>
            <Button variant="secondary" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      <Card>
        {drivers.status === 'loading' ? (
          <LoadingState label="Loading drivers…" />
        ) : drivers.status === 'error' ? (
          <ErrorState error={drivers.error} onRetry={drivers.reload} />
        ) : drivers.data && drivers.data.items.length === 0 ? (
          <EmptyState
            title={search ? 'No drivers match that search' : 'No drivers yet'}
            description={
              search
                ? 'Try a different name or licence number.'
                : 'Add your first driver to start building the fleet.'
            }
            action={
              !search && canCreate ? (
                <Button
                  onClick={() => setShowForm(true)}
                  disabled={addBlocked !== null}
                  title={addBlocked ?? undefined}
                >
                  Add driver
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="pb-2 font-medium">Driver</th>
                  <th className="pb-2 font-medium">Availability</th>
                  <th className="pb-2 font-medium">Assigned truck</th>
                  <th className="pb-2 font-medium">Current trip</th>
                  <th className="pb-2 font-medium">Licence</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {drivers.data?.items.map((driver) => {
                  const health = licenceHealth(driver.licence_expiry)
                  const reg = truckFor(driver.id)
                  const open = tripFor(driver.id)
                  return (
                    <tr key={driver.id}>
                      <td className="py-3 font-medium text-ink">
                        <span className="inline-flex items-center gap-2">
                          <AuthImage src={driver.photo_url} alt={`${driver.full_name} photo`} fallback={initials(driver.full_name)} />
                          <span>
                            {driver.full_name}
                            <span className="block text-xs font-normal text-muted">{driver.phone}</span>
                          </span>
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="flex flex-col items-start gap-1">
                          <StatusPill status={driver.status} />
                          {/* The login state is stated in words, never by colour
                              alone: a driver the backend will refuse at dispatch
                              must not look ready to go. */}
                          {!driver.login_is_active ? (
                            <>
                              <span className="inline-block rounded-full border border-warning/30 bg-warning-soft px-2 py-0.5 text-[11px] font-semibold tracking-wide text-warning">
                                LOGIN INACTIVE
                              </span>
                              <span className="text-[11px] text-muted">
                                Cannot be dispatched
                              </span>
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-3 font-mono text-xs text-ink">
                        {assignments.status === 'success' ? (reg ?? <span className="font-sans text-warning">none</span>) : <span className="font-sans text-muted">—</span>}
                      </td>
                      <td className="py-3 text-xs">
                        {trips.status === 'success' ? (open ? <span className="text-ink">{open.trip_code} <span className="text-muted">· {open.status.replaceAll('_', ' ').toLowerCase()}</span></span> : <span className="text-muted">none</span>) : <span className="text-muted">—</span>}
                      </td>
                      <td className={`py-3 text-xs ${health.tone === 'danger' ? 'font-semibold text-danger' : health.tone === 'warning' ? 'text-warning' : 'text-muted'}`}>
                        {health.label}
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          {/* Contextual, not a second workflow: a driver with
                              no truck cannot be dispatched, so the fix is one
                              click away. Paired drivers change it from the profile. */}
                          {assignments.status === 'success' && !reg && driver.login_is_active && can('assignment:create') ? (
                            <Button onClick={() => setAssignFor(driver.id)}>Assign truck</Button>
                          ) : null}
                          <Button variant="secondary" onClick={() => setProfileId(driver.id)}>
                            View profile
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {profile ? (
        <DriverProfileDrawer
          driver={profile}
          trucks={trucks.data?.items ?? []}
          assignments={assignments.data ?? []}
          trips={trips.data?.items ?? []}
          onClose={() => setProfileId(null)}
          onChanged={reloadContext}
        />
      ) : null}
      {assignFor ? (
        <AssignTruckDialog driverId={assignFor} onClose={() => setAssignFor(null)} onChanged={reloadContext} />
      ) : null}
    </div>
  )
}
