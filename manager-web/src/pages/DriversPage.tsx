import { useState } from 'react'
import { UserPlus, Users } from 'lucide-react'

import { api, type Driver, fieldErrors as fieldErrorsOf, unavailableReason } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import AuthImage, { initials } from '../components/AuthImage'
import AssignTruckDialog from '../components/AssignTruckDialog'
import DriverProfileDrawer, { licenceHealth, maskPhone } from '../components/DriverProfileDrawer'
import { ActionButton, InlineError, PageHeader, Pill, Quiet, STACK, SearchInput, TH } from '../components/pageKit'
import { Field, LoadingState, Panel, StatusPill } from '../components/ui'
import { useMutation, useResource } from '../hooks/useResource'
import { heldBy } from './planValidation'

const BLANK = {
  full_name: '',
  phone: '',
  email: '',
  licence_number: '',
  licence_expiry: '',
  initial_password: '',
}

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
  // The planner's list (same query, same cache): a draft reserves its driver
  // there, so the row says so here - as "reserved", not as the current trip.
  const openTrips = useResource(() => api.listTrips({ open_only: true, limit: 100 }), [], 'trips:open:100')

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
    setFieldErrors(fieldErrorsOf(error))
  }

  const canCreate = can('driver:create')
  const truckFor = (driverId: string) => {
    const live = assignments.data?.find((a) => a.driver_id === driverId && (a.status === 'ACTIVE' || a.status === 'PENDING_VERIFICATION'))
    if (!live) return null
    return trucks.data?.items.find((t) => t.id === live.truck_id)?.registration_number ?? live.truck_id.slice(0, 8)
  }
  const tripFor = (driverId: string) => heldBy(openTrips.data?.items, { driverId })
  const profile: Driver | null = profileId ? drivers.data?.items.find((d) => d.id === profileId) ?? null : null

  function reloadContext() {
    drivers.reload(); assignments.reload(); trucks.reload(); trips.reload(); openTrips.reload()
  }

  const rows = drivers.data?.items ?? []
  const listLine = drivers.data
    ? `${search ? `Matching “${search}” · ` : ''}${rows.length} driver${rows.length === 1 ? '' : 's'}${drivers.data.next_cursor ? ' shown, more exist · search to narrow' : ''}`
    : 'Name, the truck they hold, and whether they are on the road'

  return (
    <div className="flex flex-col gap-[14px]">
      <PageHeader
        title="Drivers"
        meta="Who can drive, which truck they hold, and whether they are on the road. Open a profile for details and actions."
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Search name or licence" label="Search drivers by name or licence" />
            {/* Rendered only when permitted - but the server enforces it too. */}
            {canCreate ? (
              <ActionButton
                icon={showForm ? undefined : UserPlus}
                onClick={() => setShowForm((v) => !v)}
                disabled={addBlocked !== null}
                title={addBlocked ?? undefined}
              >
                {showForm ? 'Cancel' : 'Add driver'}
              </ActionButton>
            ) : null}
          </>
        }
        note={canCreate && addBlocked ? addBlocked : null}
      />

      {showForm && canCreate ? (
        <Panel title="New Driver" subtitle="The phone number and this password are how they sign in to the driver app.">
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
              hint="10-digit mobile number, used to sign in to the driver app"
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

          {create.error && !Object.keys(fieldErrors).length ? <InlineError compact error={create.error} /> : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton variant="primary" onClick={handleCreate} busy={create.isSubmitting}>
              {create.isSubmitting ? 'Creating…' : 'Create driver'}
            </ActionButton>
            <ActionButton onClick={() => setShowForm(false)}>Cancel</ActionButton>
          </div>
        </Panel>
      ) : null}

      <Panel title="Driver Directory" subtitle={listLine}>
        {drivers.status === 'loading' ? (
          <LoadingState label="Loading drivers…" />
        ) : drivers.status === 'error' ? (
          <InlineError what="Drivers could not be loaded" error={drivers.error} onRetry={drivers.reload} />
        ) : drivers.data && rows.length === 0 ? (
          <Quiet
            icon={Users}
            title={search ? 'No drivers match that search' : 'No drivers yet'}
            action={
              !search && canCreate ? (
                <ActionButton
                  variant="primary"
                  icon={UserPlus}
                  onClick={() => setShowForm(true)}
                  disabled={addBlocked !== null}
                  title={addBlocked ?? undefined}
                >
                  Add driver
                </ActionButton>
              ) : null
            }
          >
            {search ? 'Try a different name or licence number.' : 'Add your first driver to start building the fleet.'}
          </Quiet>
        ) : (
          <div className="relative -mx-4 overflow-x-auto px-4">
            <table className={STACK.table}>
              <thead className={STACK.head}>
                <tr>
                  <th className={TH}>Driver</th>
                  <th className={TH}>Availability</th>
                  <th className={TH}>Assigned truck</th>
                  <th className={TH}>Current trip</th>
                  <th className={TH}>Licence</th>
                  <th className={TH}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className={STACK.body}>
                {rows.map((driver) => {
                  const health = licenceHealth(driver.licence_expiry)
                  const reg = truckFor(driver.id)
                  const open = tripFor(driver.id)
                  // The date never breaks at its hyphens: "Valid till 2027-10-" / "24".
                  const cut = health.label.lastIndexOf(' ') + 1
                  return (
                    <tr key={driver.id} className={STACK.row}>
                      <td className={STACK.lead}>
                        <span className="inline-flex items-center gap-3">
                          <AuthImage src={driver.photo_url} alt={`${driver.full_name} photo`} fallback={initials(driver.full_name)} />
                          <span className="min-w-0">
                            <span className="block font-semibold text-ink">{driver.full_name}</span>
                            {/* Masked in the list (audit 11); the profile, opened
                                on purpose, holds the number. */}
                            <span className="block text-[13px] text-muted">{maskPhone(driver.phone)}</span>
                          </span>
                        </span>
                      </td>
                      <td className={STACK.cell} data-label="Availability">
                        <div className="flex flex-col items-start gap-1">
                          <StatusPill status={driver.status} />
                          {/* The login state is stated in words, never by colour
                              alone: a driver the backend will refuse at dispatch
                              must not look ready to go. */}
                          {!driver.login_is_active ? (
                            <>
                              <Pill tone="warning">LOGIN INACTIVE</Pill>
                              <span className="text-xs text-muted">Cannot be dispatched</span>
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td className={`${STACK.cell} font-mono text-[13px] text-ink max-md:before:font-sans`} data-label="Assigned truck">
                        {assignments.status === 'success' ? (reg ?? <span className="font-sans text-warning">none</span>) : <span className="font-sans text-muted">—</span>}
                      </td>
                      <td className={`${STACK.cell} text-[13px]`} data-label="Current trip">
                        {openTrips.status === 'success' ? (open ? <span className="text-ink">{open.status === 'DRAFT' ? 'Reserved by ' : ''}{open.trip_code} <span className="text-muted">· {open.status.replaceAll('_', ' ').toLowerCase()}</span></span> : <span className="text-muted">none</span>) : <span className="text-muted">—</span>}
                      </td>
                      <td className={`${STACK.cell} text-[13px] ${health.tone === 'danger' ? 'font-semibold text-danger' : health.tone === 'warning' ? 'text-warning' : 'text-muted'}`} data-label="Licence">
                        {health.label.slice(0, cut)}<span className="whitespace-nowrap">{health.label.slice(cut)}</span>
                      </td>
                      <td className={STACK.actions}>
                        <div className={STACK.actionRow}>
                          {/* Contextual, not a second workflow: a driver with
                              no truck cannot be dispatched, so the fix is one
                              click away. Paired drivers change it from the profile. */}
                          {assignments.status === 'success' && !reg && driver.login_is_active && can('assignment:create') ? (
                            <ActionButton onClick={() => setAssignFor(driver.id)}>Assign truck</ActionButton>
                          ) : null}
                          <ActionButton onClick={() => setProfileId(driver.id)}>View profile</ActionButton>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

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
