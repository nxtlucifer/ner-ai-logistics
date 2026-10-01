import { useState } from 'react'
import { Link2 } from 'lucide-react'

import { api, unavailableReason } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import AssignTruckDialog from '../components/AssignTruckDialog'
import AuthImage from '../components/AuthImage'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusPill,
  TABLE,
  TABLE_ROW,
  TABLE_TD,
  TABLE_TH,
} from '../components/ui'
import { PHONE_LABEL } from '../components/pageKit'
import { useMutation, useResource } from '../hooks/useResource'

const CELL_PHONE = `max-md:h-auto max-md:py-0 max-md:pr-0! min-w-0 ${PHONE_LABEL}`

export default function AssignmentsPage() {
  const { can } = useAuth()
  const [assigning, setAssigning] = useState(false)

  const assignments = useResource(() => api.listAssignments({ activeOnly: true }), [], 'assignments:active', 5_000)
  const drivers = useResource(() => api.listDrivers({ limit: 100 }), [], 'drivers:100')
  const trucks = useResource(() => api.listTrucks({ limit: 100 }), [], 'trucks:100')

  const end = useMutation((id: string) => api.endAssignment(id))
  // No-smartphone fallback: the manager confirms the plate by hand. The
  // record says MANAGER_MANUAL; no photo is pretended.
  const manual = useMutation((id: string, plate: string) => api.verifyAssignmentManually(id, plate))
  const [manualFor, setManualFor] = useState<string | null>(null)
  const [manualPlate, setManualPlate] = useState('')
  const endBlocked = unavailableReason('endAssignment')

  const driverName = (id: string) =>
    drivers.data?.items.find((d) => d.id === id)?.full_name ?? id.slice(0, 8)
  const truckReg = (id: string) =>
    trucks.data?.items.find((t) => t.id === id)?.registration_number ?? id.slice(0, 8)

  async function handleEnd(id: string) {
    if (!window.confirm('End this assignment?')) return
    if ((await end.submit(id)).data) assignments.reload()
  }

  const canAssign = can('assignment:create')
  const rows = assignments.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assignment Records"
        meta="A driver holds one truck at a time, and a truck one driver — enforced by the database, not just here. Pair or change from Fleet, a driver's profile or a truck's row."
        actions={canAssign ? <Button size="sm" onClick={() => setAssigning(true)}>Assign truck</Button> : null}
      />
      {assigning ? <AssignTruckDialog onClose={() => setAssigning(false)} onChanged={assignments.reload} /> : null}

      <Card
        title="Active Assignments"
        subtitle={assignments.data ? `${rows.length} active · the driver check is read again every 5 seconds` : undefined}
      >
        {assignments.status === 'loading' ? (
          <LoadingState label="Loading assignments…" />
        ) : assignments.status === 'error' ? (
          <ErrorState centered error={assignments.error} onRetry={assignments.reload} />
        ) : assignments.data && assignments.data.length === 0 ? (
          <EmptyState
            icon={Link2}
            title="No active assignments"
            description="Assign a driver to a truck to see it here."
          />
        ) : (
          <div className="scroll-x-hint relative overflow-x-auto">
            {/* Below 768px each row is a card (RESP-2), so End is on screen. */}
            <table className={`${TABLE} max-md:block`}>
              <thead className="max-md:sr-only">
                <tr>
                  <th className={TABLE_TH}>Driver</th>
                  <th className={TABLE_TH}>Truck</th>
                  <th className={TABLE_TH}>Status</th>
                  <th className={TABLE_TH}>Driver check</th>
                  <th className={TABLE_TH}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="max-md:block">
                {assignments.data?.map((a) => (
                  <tr key={a.id} className={`${TABLE_ROW} max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-3 max-md:py-3`}>
                    <td className={`${TABLE_TD} font-semibold text-ink max-md:col-span-2 max-md:h-auto max-md:py-0`}>
                      {driverName(a.driver_id)}
                    </td>
                    <td className={`${TABLE_TD} font-mono text-[13px] text-ink ${CELL_PHONE} max-md:before:font-sans`} data-label="Truck">
                      {truckReg(a.truck_id)}
                    </td>
                    <td className={`${TABLE_TD} ${CELL_PHONE}`} data-label="Status">
                      {/* An assignment in force is a success state, not a road. */}
                      <StatusPill status={a.status} tone={a.status === 'ACTIVE' ? 'success' : undefined} />
                    </td>
                    <td className={`${TABLE_TD} py-2.5 ${CELL_PHONE} max-md:col-span-2`} data-label="Driver check">
                      {/* The operational answer a manager actually wants: has
                          the driver physically confirmed this truck? */}
                      {a.verified_at ? (
                        a.mismatch_flagged ? (
                          <div>
                            <StatusPill status="NEEDS_REVIEW" />
                            <div className="mt-1 text-xs text-warning">
                              driver reported a different registration
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-3">
                            <div>
                              <StatusPill status="VERIFIED" />
                              <div className="mt-1 text-xs text-muted">
                                {new Date(a.verified_at).toLocaleString()}
                                {' · '}
                                {a.verification_source === 'DRIVER_APP_PHOTO' ? 'driver photo' : a.verification_source === 'MANAGER_MANUAL' ? 'manager by hand (no photo)' : 'driver, plate only'}
                              </div>
                            </div>
                            {a.verification_photo_url ? (
                              <AuthImage src={a.verification_photo_url} alt="Trip verification photo" className="h-12 w-16 shrink-0 rounded-[6px]" label="trip verification photo" />
                            ) : null}
                          </div>
                        )
                      ) : (
                        <div>
                          <StatusPill status="AWAITING_DRIVER" />
                          {can('assignment:review') ? (
                            manualFor === a.id ? (
                              <form
                                className="mt-2 flex flex-wrap items-center gap-2"
                                onSubmit={(e) => { e.preventDefault(); void manual.submit(a.id, manualPlate).then((r) => { if (r.data) { setManualFor(null); setManualPlate(''); assignments.reload() } }) }}
                              >
                                <input aria-label="Number plate on the truck" value={manualPlate} onChange={(e) => setManualPlate(e.target.value.toUpperCase())} placeholder={truckReg(a.truck_id)} className="w-36 rounded-[var(--radius-control)] border border-outline bg-surface px-3 font-mono text-[13px] text-ink placeholder:text-muted focus:border-route" />
                                {/* md buttons: the plate box is a 44px field, and one row shares one height. */}
                                <Button type="submit" busy={manual.isSubmitting} disabled={manualPlate.trim().length < 4} title={manualPlate.trim().length < 4 ? 'Type the plate as it reads on the truck (at least 4 characters)' : undefined} describedBy={manualPlate.trim().length < 4 ? `manual-hint-${a.id}` : undefined}>Confirm</Button>
                                <Button variant="secondary" onClick={() => setManualFor(null)}>Cancel</Button>
                                {manualPlate.trim().length < 4 ? <span id={`manual-hint-${a.id}`} className="basis-full text-xs text-muted">Type the plate as it reads on the truck, at least 4 characters.</span> : null}
                              </form>
                            ) : (
                              <div className="mt-2">
                                <button type="button" onClick={() => { setManualFor(a.id); setManualPlate('') }} className="inline-flex min-h-9 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-soft" data-testid={`manual-verify-${a.id}`}>
                                  Verify by hand (driver has no smartphone)
                                </button>
                              </div>
                            )
                          ) : null}
                          {manual.error && manualFor === a.id ? <div role="alert" className="mt-1 text-xs text-danger">{manual.error instanceof Error ? manual.error.message : 'Could not verify.'}</div> : null}
                        </div>
                      )}
                    </td>
                    <td className={`${TABLE_TD} text-right max-md:col-span-2 max-md:h-auto max-md:py-0 max-md:text-left`}>
                      {can('assignment:end') ? (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleEnd(a.id)}
                          busy={end.isSubmitting}
                          disabled={endBlocked !== null}
                          title={endBlocked ?? undefined}
                        >
                          End
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {end.error ? (
          <div className="mt-3">
            <ErrorState error={end.error} />
          </div>
        ) : null}
      </Card>
    </div>
  )
}
