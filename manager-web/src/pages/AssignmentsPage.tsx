import { useState } from 'react'

import { api } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
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
  const [driverId, setDriverId] = useState('')
  const [truckId, setTruckId] = useState('')

  const assignments = useResource(() => api.listAssignments({ activeOnly: true }), [])
  const drivers = useResource(() => api.listDrivers({ limit: 100 }), [])
  const trucks = useResource(() => api.listTrucks({ limit: 100 }), [])

  const assign = useMutation((d: string, t: string) => api.createAssignment(d, t))
  const end = useMutation((id: string) => api.endAssignment(id))

  const driverName = (id: string) =>
    drivers.data?.items.find((d) => d.id === id)?.full_name ?? id.slice(0, 8)
  const truckReg = (id: string) =>
    trucks.data?.items.find((t) => t.id === id)?.registration_number ?? id.slice(0, 8)

  async function handleAssign() {
    if (!driverId || !truckId) return
    if ((await assign.submit(driverId, truckId)).data) {
      setDriverId('')
      setTruckId('')
      assignments.reload()
    }
  }

  async function handleEnd(id: string) {
    if (!window.confirm('End this assignment?')) return
    if ((await end.submit(id)).data) assignments.reload()
  }

  const canAssign = can('assignment:create')
  const referencesLoading =
    drivers.status === 'loading' || trucks.status === 'loading'

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Assignments</h1>
        <p className="text-xs text-slate-500">
          A driver holds one truck at a time, and a truck one driver — enforced by
          the database, not just here.
        </p>
      </div>

      {canAssign ? (
        <Card title="Assign a driver to a truck">
          {referencesLoading ? (
            <LoadingState label="Loading drivers and trucks…" />
          ) : drivers.status === 'error' || trucks.status === 'error' ? (
            <ErrorState
              error={drivers.error ?? trucks.error}
              onRetry={() => {
                drivers.reload()
                trucks.reload()
              }}
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-slate-300">Driver</span>
                  <select
                    value={driverId}
                    onChange={(e) => setDriverId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-600 focus:outline-none"
                  >
                    <option value="">Select a driver…</option>
                    {drivers.data?.items.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.full_name} — {d.licence_number}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs font-medium text-slate-300">Truck</span>
                  <select
                    value={truckId}
                    onChange={(e) => setTruckId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-600 focus:outline-none"
                  >
                    <option value="">Select a truck…</option>
                    {trucks.data?.items.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.registration_number} —{' '}
                        {Number(t.max_capacity_kg).toLocaleString()} kg
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {assign.error ? (
                <div className="mt-3">
                  <ErrorState error={assign.error} />
                </div>
              ) : null}

              <div className="mt-4">
                <Button
                  onClick={handleAssign}
                  busy={assign.isSubmitting}
                  // Disabled until both are chosen, so the action is never
                  // present-but-broken.
                  disabled={!driverId || !truckId}
                >
                  {assign.isSubmitting ? 'Assigning…' : 'Assign'}
                </Button>
              </div>
            </>
          )}
        </Card>
      ) : null}

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
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="pb-2 font-medium">Driver</th>
                  <th className="pb-2 font-medium">Truck</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Verified</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {assignments.data?.map((a) => (
                  <tr key={a.id}>
                    <td className="py-3 font-medium text-slate-200">
                      {driverName(a.driver_id)}
                    </td>
                    <td className="py-3 font-mono text-slate-300">
                      {truckReg(a.truck_id)}
                    </td>
                    <td className="py-3">
                      <StatusPill status={a.status} />
                      {a.mismatch_flagged ? (
                        <span className="ml-2 text-[11px] font-semibold text-amber-400">
                          mismatch flagged
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 text-xs text-slate-400">
                      {a.verified_at ? (
                        new Date(a.verified_at).toLocaleString()
                      ) : (
                        <span className="text-slate-600">awaiting driver</span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      {can('assignment:end') ? (
                        <Button
                          variant="danger"
                          onClick={() => handleEnd(a.id)}
                          busy={end.isSubmitting}
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
