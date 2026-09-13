import { useState } from 'react'

import { ApiError, api, type Driver, unavailableReason } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import AuthImage, { initials } from '../components/AuthImage'
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

export default function DriversPage() {
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const drivers = useResource(
    () => api.listDrivers({ search: search || undefined }),
    [search],
    search ? undefined : 'drivers:all',
  )

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

  const deactivate = useMutation((id: string) => api.deactivateDriver(id))

  // See UNAVAILABLE_OPERATIONS: these have no hosted implementation, so the
  // controls say so rather than throwing when pressed.
  const addBlocked = unavailableReason('createDriver')
  const deactivateBlocked = unavailableReason('deactivateDriver')

  async function handleCreate() {
    setFieldErrors({})
    const { data, error } = await create.submit(form)
    if (data) {
      setForm(BLANK)
      setShowForm(false)
      drivers.reload()
      return
    }
    // Surface 422 details against the fields that caused them.
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

  async function handleDeactivate(driver: Driver) {
    if (
      !window.confirm(
        `Deactivate ${driver.full_name}? Their login is disabled and they are hidden from the fleet. Trip history is kept.`,
      )
    ) {
      return
    }
    if ((await deactivate.submit(driver.id)).data) drivers.reload()
  }

  const canCreate = can('driver:create')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Drivers</h1>
          <p className="text-xs text-muted">
            Creating a driver also creates their login.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or licence"
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
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Phone</th>
                  <th className="pb-2 font-medium">Licence</th>
                  <th className="pb-2 font-medium">Expiry</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {drivers.data?.items.map((driver) => {
                  const expired = new Date(driver.licence_expiry) < new Date()
                  return (
                    <tr key={driver.id}>
                      <td className="py-3 font-medium text-ink">
                        <span className="inline-flex items-center gap-2">
                          <AuthImage src={driver.photo_url} alt={`${driver.full_name} photo`} fallback={initials(driver.full_name)} />
                          {driver.full_name}
                        </span>
                      </td>
                      <td className="py-3 text-muted">{driver.phone}</td>
                      <td className="py-3 font-mono text-xs text-muted">
                        {driver.licence_number}
                      </td>
                      <td
                        className={`py-3 text-xs ${expired ? 'font-semibold text-danger' : 'text-muted'}`}
                      >
                        {driver.licence_expiry}
                        {expired ? ' (expired)' : ''}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-col items-start gap-1">
                          <StatusPill status={driver.status} />
                          {/*
                            drivers.status describes the person; it says nothing
                            about whether the account behind them can sign in.
                            Showing only the pill above would present a driver
                            the backend will refuse at dispatch as ready to go,
                            so the login state is stated in words rather than
                            left to be inferred - and never by colour alone.
                          */}
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
                      <td className="py-3 text-right">
                        {can('driver:deactivate') ? (
                          <Button
                            variant="danger"
                            onClick={() => handleDeactivate(driver)}
                            busy={deactivate.isSubmitting}
                            disabled={deactivateBlocked !== null}
                            title={deactivateBlocked ?? undefined}
                          >
                            Deactivate
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {deactivate.error ? (
          <div className="mt-3">
            <ErrorState error={deactivate.error} />
          </div>
        ) : null}
      </Card>
    </div>
  )
}
