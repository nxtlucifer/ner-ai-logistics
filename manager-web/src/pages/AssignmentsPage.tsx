import { useState } from 'react'

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
  StatusPill,
} from '../components/ui'
import { useMutation, useResource } from '../hooks/useResource'

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Assignment records</h1>
          <p className="text-xs text-muted">
            A driver holds one truck at a time, and a truck one driver — enforced by
            the database, not just here. Pair or change from Fleet, a driver's profile or a truck's row.
          </p>
        </div>
        {canAssign ? <Button onClick={() => setAssigning(true)}>Assign truck</Button> : null}
      </div>
      {assigning ? <AssignTruckDialog onClose={() => setAssigning(false)} onChanged={assignments.reload} /> : null}

      <Card title="Active assignments">
        {assignments.status === 'loading' ? (
          <LoadingState label="Loading assignments…" />
        ) : assignments.status === 'error' ? (
          <ErrorState error={assignments.error} onRetry={assignments.reload} />
        ) : assignments.data && assignments.data.length === 0 ? (
          <EmptyState
            title="No active assignments"
            description="Assign a driver to a truck to see it here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="pb-2 font-medium">Driver</th>
                  <th className="pb-2 font-medium">Truck</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Driver check</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {assignments.data?.map((a) => (
                  <tr key={a.id}>
                    <td className="py-3 font-medium text-ink">
                      {driverName(a.driver_id)}
                    </td>
                    <td className="py-3 font-mono text-ink">
                      {truckReg(a.truck_id)}
                    </td>
                    <td className="py-3">
                      <StatusPill status={a.status} />
                    </td>
                    <td className="py-3">
                      {/* The operational answer a manager actually wants: has
                          the driver physically confirmed this truck? */}
                      {a.verified_at ? (
                        a.mismatch_flagged ? (
                          <div>
                            <span className="inline-block rounded-full border border-warning/30 bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
                              NEEDS REVIEW
                            </span>
                            <div className="mt-1 text-[11px] text-warning/80">
                              driver reported a different registration
                            </div>
                          </div>
                        ) : (
                          <div>
                            <span className="inline-block rounded-full border border-ok/30 bg-ok-soft px-2 py-0.5 text-[11px] font-semibold text-ok">
                              VERIFIED
                            </span>
                            <div className="mt-1 text-[11px] text-muted">
                              {new Date(a.verified_at).toLocaleString()}
                              {' · '}
                              {a.verification_source === 'DRIVER_APP_PHOTO' ? 'driver photo' : a.verification_source === 'MANAGER_MANUAL' ? 'manager by hand (no photo)' : 'driver, plate only'}
                            </div>
                            {a.verification_photo_url ? (
                              <div className="mt-1"><AuthImage src={a.verification_photo_url} alt="Trip verification photo" className="h-12 w-16 rounded-md" label="trip verification photo" /></div>
                            ) : null}
                          </div>
                        )
                      ) : (
                        <div>
                          <span className="inline-block rounded-full border border-line bg-soft px-2 py-0.5 text-[11px] font-semibold text-muted">
                            AWAITING DRIVER
                          </span>
                          {can('assignment:review') ? (
                            manualFor === a.id ? (
                              <form
                                className="mt-1 flex items-center gap-1"
                                onSubmit={(e) => { e.preventDefault(); void manual.submit(a.id, manualPlate).then((r) => { if (r.data) { setManualFor(null); setManualPlate(''); assignments.reload() } }) }}
                              >
                                <input aria-label="Number plate on the truck" value={manualPlate} onChange={(e) => setManualPlate(e.target.value.toUpperCase())} placeholder={truckReg(a.truck_id)} className="w-32 rounded border border-line bg-surface px-1.5 py-1 font-mono text-xs" />
                                <Button type="submit" busy={manual.isSubmitting} disabled={manualPlate.trim().length < 4}>Confirm</Button>
                                <button type="button" onClick={() => setManualFor(null)} className="text-[11px] text-muted hover:text-ink">cancel</button>
                              </form>
                            ) : (
                              <button type="button" onClick={() => { setManualFor(a.id); setManualPlate('') }} className="mt-1 block text-[11px] text-route hover:underline" data-testid={`manual-verify-${a.id}`}>
                                Verify by hand (driver has no smartphone)
                              </button>
                            )
                          ) : null}
                          {manual.error && manualFor === a.id ? <div className="mt-1 text-[11px] text-danger">{manual.error instanceof Error ? manual.error.message : 'Could not verify.'}</div> : null}
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      {can('assignment:end') ? (
                        <Button
                          variant="danger"
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
