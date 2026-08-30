import { useState } from 'react'

import { ApiError, api, type Truck } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
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
  )

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
          <h1 className="text-xl font-bold text-slate-100">Trucks</h1>
          <p className="text-xs text-slate-500">
            Capacity is a safety limit enforced by the database.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search registration"
            className="w-56 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
          />
          {canCreate ? (
            <Button onClick={() => setShowForm((v) => !v)} variant="secondary">
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
                <Button onClick={() => setShowForm(true)}>Add truck</Button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="pb-2 font-medium">Registration</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Capacity</th>
                  <th className="pb-2 font-medium">Load</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {trucks.data?.items.map((truck) => (
                  <tr key={truck.id}>
                    <td className="py-3 font-mono font-medium text-slate-200">
                      {truck.registration_number}
                    </td>
                    <td className="py-3 text-slate-400">
                      {[truck.make, truck.model].filter(Boolean).join(' ') ||
                        truck.truck_type || (
                          <span className="text-slate-600">—</span>
                        )}
                    </td>
                    <td className="py-3 tabular-nums text-slate-400">
                      {Number(truck.max_capacity_kg).toLocaleString()} kg
                    </td>
                    <td className="py-3 tabular-nums text-slate-400">
                      {Number(truck.current_load_kg).toLocaleString()} kg
                    </td>
                    <td className="py-3">
                      <StatusPill status={truck.status} />
                    </td>
                    <td className="py-3 text-right">
                      {can('truck:retire') ? (
                        <Button
                          variant="danger"
                          onClick={() => handleRetire(truck)}
                          busy={retire.isSubmitting}
                        >
                          Retire
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {retire.error ? (
          <div className="mt-3">
            <ErrorState error={retire.error} />
          </div>
        ) : null}
      </Card>
    </div>
  )
}
