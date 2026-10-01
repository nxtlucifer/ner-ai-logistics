import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera, Plus, Truck as TruckIcon } from 'lucide-react'

import AssignTruckDialog from '../components/AssignTruckDialog'

import { api, type Truck, fieldErrors as fieldErrorsOf, unavailableReason } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import AuthImage from '../components/AuthImage'
import { ActionButton, InlineError, PageHeader, Quiet, STACK, SearchInput, TH } from '../components/pageKit'
import { Field, LoadingState, Panel, Spinner, StatusPill } from '../components/ui'
import { useMutation, useResource } from '../hooks/useResource'
import { heldBy } from './planValidation'

/** Trip states that commit a driver to a truck: the server refuses a pairing
 *  change only for these (backend/app/domain/trip_state.py). */
const COMMITTED = new Set(['ACTIVE', 'DELAYED', 'INCIDENT', 'DELIVERED'])

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
  // Every open trip, the list the planner reads (same query, same cache): a
  // draft reserves its truck there, so it must here too.
  const trips = useResource(() => api.listTrips({ open_only: true, limit: 100 }), [], 'trips:open:100')
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
  const tripFor = (truckId: string) => heldBy(trips.data?.items, { truckId })

  // A reference photo upload, one row at a time: it says it is working and
  // says when it failed (audit 11.3 D6 - failures used to vanish).
  const [photo, setPhoto] = useState<{ id: string; error?: unknown } | null>(null)
  async function uploadPhoto(truck: Truck, file: File) {
    setPhoto({ id: truck.id })
    try {
      await api.uploadTruckPhoto(truck.id, file)
      setPhoto(null)
      trucks.reload()
    } catch (error) {
      setPhoto({ id: truck.id, error })
    }
  }

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
    setFieldErrors(fieldErrorsOf(error))
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
  const rows = trucks.data?.items ?? []
  const headerNote = [canCreate ? addBlocked : null, can('truck:retire') && retireBlocked ? `Retire: ${retireBlocked}` : null].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col gap-[14px]">
      <PageHeader
        title="Trucks"
        meta={
          <>
            Capacity is a safety limit enforced by the database. Pair a truck with a driver from the driver's profile;{' '}
            <Link to="/assignments" className="font-medium text-ink underline underline-offset-2 hover:text-accent">assignment records</Link> keep the history.
          </>
        }
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Search registration" label="Search trucks by registration" />
            {canCreate ? (
              <ActionButton
                icon={showForm ? undefined : Plus}
                onClick={() => setShowForm((v) => !v)}
                disabled={addBlocked !== null}
                title={addBlocked ?? undefined}
              >
                {showForm ? 'Cancel' : 'Add truck'}
              </ActionButton>
            ) : null}
          </>
        }
        note={headerNote || null}
      />

      {showForm && canCreate ? (
        <Panel title="New Truck" subtitle="The capacity is the most a trip on this truck may carry.">
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

          {create.error && !Object.keys(fieldErrors).length ? <InlineError compact error={create.error} /> : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton variant="primary" onClick={handleCreate} busy={create.isSubmitting}>
              {create.isSubmitting ? 'Creating…' : 'Create truck'}
            </ActionButton>
            <ActionButton onClick={() => setShowForm(false)}>Cancel</ActionButton>
          </div>
        </Panel>
      ) : null}

      <Panel
        title="Fleet Register"
        subtitle={
          trucks.data
            ? `${search ? `Matching “${search}” · ` : ''}${rows.length} truck${rows.length === 1 ? '' : 's'}${trucks.data.next_cursor ? ' shown, more exist · search to narrow' : ''}`
            : 'Registration, capacity, and who holds each truck'
        }
      >
        {trucks.status === 'loading' ? (
          <LoadingState label="Loading trucks…" />
        ) : trucks.status === 'error' ? (
          <InlineError what="Trucks could not be loaded" error={trucks.error} onRetry={trucks.reload} />
        ) : trucks.data && rows.length === 0 ? (
          <Quiet
            icon={TruckIcon}
            title={search ? 'No trucks match that search' : 'No trucks yet'}
            action={
              !search && canCreate ? (
                <ActionButton
                  variant="primary"
                  icon={Plus}
                  onClick={() => setShowForm(true)}
                  disabled={addBlocked !== null}
                  title={addBlocked ?? undefined}
                >
                  Add truck
                </ActionButton>
              ) : null
            }
          >
            {search ? 'Try a different registration number.' : 'Add your first truck to start building the fleet.'}
          </Quiet>
        ) : (
          <div className="relative -mx-4 overflow-x-auto px-4">
            <table className={STACK.table}>
              <thead className={STACK.head}>
                <tr>
                  <th className={TH}>Registration</th>
                  <th className={TH}>Capacity</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Assigned driver</th>
                  <th className={TH}>Current trip</th>
                  <th className={TH}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className={STACK.body}>
                {rows.map((truck) => {
                  const holder = driverFor(truck.id)
                  const open = tripFor(truck.id)
                  // The truck's own status is authoritative: the open list is
                  // the first 100 in the caller's scope, and a truck can be on
                  // a trip outside it.
                  const busyWhy = open ? `${open.status === 'DRAFT' ? 'Reserved by' : 'On'} ${open.trip_code}` : 'On a trip'
                  // The server lets a pairing change until the trip commits the
                  // driver to the truck (backend/app/domain/trip_state.py
                  // COMMITS_DRIVER_TO_TRUCK); a draft only reserves them.
                  const pairLocked = truck.status === 'ON_TRIP' || (open !== null && COMMITTED.has(open.status))
                  const reservedNote = open && !pairLocked ? ` · ${open.status.toLowerCase()} ${open.trip_code} holds this truck` : ''
                  const canPair = can('assignment:create') && assignments.status === 'success' && truck.status !== 'RETIRED'
                  const canEnd = can('assignment:end') && holder !== null
                  const canRetire = can('truck:retire')
                  // The tooltips' reason, as text, under the trip that causes it.
                  const why = !(canPair || canEnd || canRetire)
                    ? null
                    : pairLocked
                      ? 'Locked until that trip ends'
                      : open && canRetire
                        ? 'Retire waits for that trip; the pairing can still change'
                        : null
                  const uploading = photo?.id === truck.id && !photo.error
                  // Make and model (or the type) under the plate, when recorded: a
                  // column of its own was all dashes and pushed the row actions out
                  // of the card on a laptop.
                  const kind = [truck.make, truck.model].filter(Boolean).join(' ') || truck.truck_type
                  return (
                  <tr key={truck.id} className={STACK.row}>
                    <td className={STACK.lead}>
                      <span className="inline-flex items-center gap-3">
                        <AuthImage src={truck.photo_url} alt={`${truck.registration_number} photo`} className="h-10 w-14 rounded-md" label="reference" />
                        <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span className="font-mono font-semibold text-ink">{truck.registration_number}</span>
                          {can('truck:update') ? (
                            <label className={`inline-flex min-h-7 items-center gap-1 rounded-[6px] border border-line bg-surface px-2 text-xs font-semibold text-ink hover:border-outline hover:bg-soft focus-within:ring-2 focus-within:ring-route ${uploading ? 'pointer-events-none' : 'cursor-pointer'}`}>
                              {uploading ? <Spinner /> : <Camera className="size-3.5" aria-hidden="true" />}
                              {uploading ? 'Uploading…' : truck.photo_url ? 'Replace photo' : 'Photo'}
                              <input
                                type="file"
                                accept="image/jpeg,image/png"
                                className="sr-only"
                                disabled={uploading}
                                aria-label={`Upload a reference photo for ${truck.registration_number}`}
                                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadPhoto(truck, f) }}
                              />
                            </label>
                          ) : null}
                          {kind ? <span className="basis-full text-xs text-muted">{kind}</span> : null}
                        </span>
                      </span>
                      {photo?.id === truck.id && photo.error ? <InlineError compact what="The photo was not saved" error={photo.error} /> : null}
                    </td>
                    <td className={`${STACK.cell} tnum whitespace-nowrap text-ink`} data-label="Capacity">
                      {Number(truck.max_capacity_kg).toLocaleString()} kg
                    </td>
                    <td className={STACK.cell} data-label="Status">
                      <StatusPill status={truck.status} />
                    </td>
                    <td className={`${STACK.cell} text-[13px]`} data-label="Assigned driver">
                      {assignments.status === 'success' ? (
                        holder ? (
                          <span className="text-ink">
                            {holder.name}
                            <span className={`block text-xs ${holder.mismatch ? 'text-warning' : holder.verified ? 'text-ok' : 'text-muted'}`}>
                              {holder.mismatch ? 'plate mismatch — needs review' : holder.verified ? 'truck verified by driver' : 'awaiting driver check'}
                            </span>
                          </span>
                        ) : <span className="text-muted">none</span>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td className={`${STACK.cell} text-[13px]`} data-label="Current trip">
                      {trips.status === 'success' ? (open ? <span className="text-ink">{open.status === 'DRAFT' ? 'Reserved by ' : ''}{open.trip_code} <span className="text-muted">· {open.status.replaceAll('_', ' ').toLowerCase()}</span></span> : truck.status === 'ON_TRIP' ? <span className="text-ink">on a trip <span className="text-muted">· not in your open trip list</span></span> : <span className="text-muted">none</span>) : <span className="text-muted">—</span>}
                      {/* Why the buttons at the end of the row are shut, beside the trip that shuts them. */}
                      {why ? <span className="block text-xs text-muted">{why}</span> : null}
                    </td>
                    <td className={STACK.actions}>
                      <div className={STACK.actionRow}>
                      {canPair ? (
                        <ActionButton
                          disabled={pairLocked}
                          title={pairLocked ? `${busyWhy} — the pairing cannot change until it ends` : (holder ? 'Move this truck to another driver - the current pairing ends in the same step' : 'Pair a driver with this truck') + reservedNote}
                          onClick={() => setAssignFor(truck.id)}
                        >
                          {holder ? 'Change driver' : 'Assign driver'}
                        </ActionButton>
                      ) : null}
                      {canEnd ? (
                        <ActionButton
                          busy={endingId === truck.id}
                          disabled={pairLocked || (endingId !== null && endingId !== truck.id)}
                          title={pairLocked ? `${busyWhy} — cannot end while the trip is under way` : 'Free this truck and its driver from each other' + reservedNote}
                          onClick={() => void handleEndAssignment(truck)}
                        >
                          End assignment
                        </ActionButton>
                      ) : null}
                      {canRetire ? (
                        <ActionButton
                          variant="danger"
                          onClick={() => handleRetire(truck)}
                          busy={retire.isSubmitting}
                          disabled={retireBlocked !== null || truck.status === 'ON_TRIP' || open !== null}
                          title={retireBlocked ?? (open ? `${busyWhy} — finish or cancel it first` : 'Removes the truck from the active fleet. Trip history is kept.')}
                        >
                          Retire
                        </ActionButton>
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

        {retire.error ? <InlineError compact what="The truck was not retired" error={retire.error} /> : null}
        {endAssignment.error ? <InlineError compact what="The assignment did not end" error={endAssignment.error} /> : null}
      </Panel>
      {assignFor ? (
        <AssignTruckDialog truckId={assignFor} onClose={() => setAssignFor(null)} onChanged={() => { assignments.reload(); drivers.reload(); trucks.reload() }} />
      ) : null}
    </div>
  )
}
