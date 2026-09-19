/**
 * Appointing and retiring the managers below you.
 *
 * WHAT THE SCREEN IS ALLOWED TO OFFER
 *
 * Only what the server will accept. A State Manager sees one role in the
 * picker - District Manager - because that is the only one
 * `scope.may_manage_user` will let them create. Offering "State Manager"
 * and refusing it on submit would teach people that half the console is
 * decoration.
 *
 * THE TEMPORARY PASSWORD
 *
 * Shown once, in a panel that says so, and never fetched again. There is no
 * endpoint that could return it: it is stored only as a hash, and the new
 * account cannot do anything but change it.
 */

import { useState } from 'react'
import { UserCog } from 'lucide-react'

import { api, type DistrictRow, type ManagerRow, type StateRow } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { useMutation, useResource } from '../hooks/useResource'
import { ErrorState, Field, LoadingState, Panel } from '../components/ui'
import { ActionButton, InlineError, PageHeader, Pill, Quiet, STACK, TH } from '../components/pageKit'

const ROLE_LABEL: Record<ManagerRow['role'], string> = {
  STATE_MANAGER: 'State manager',
  DISTRICT_MANAGER: 'District manager',
}

const SELECT =
  'mt-1.5 w-full rounded-[var(--radius-control)] border border-outline bg-surface px-3 py-2 text-sm text-ink focus:border-route focus:ring-1 focus:ring-route disabled:cursor-not-allowed disabled:opacity-60'

export default function ManagersPage() {
  const { user } = useAuth()
  // A State Manager may create exactly one kind of account. The regional
  // roles may create both.
  const canMakeStateManagers =
    user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'NORTH_EAST_MANAGER'

  const managers = useResource<ManagerRow[]>(
    () => api.listManagers(),
    [],
    'org:managers',
  )
  const states = useResource<StateRow[]>(() => api.listStates(), [], 'org:states')

  const [role, setRole] = useState<ManagerRow['role']>(
    canMakeStateManagers ? 'STATE_MANAGER' : 'DISTRICT_MANAGER',
  )
  const [stateId, setStateId] = useState('')
  const [districtId, setDistrictId] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const districts = useResource<DistrictRow[]>(
    () => (stateId ? api.listDistricts(stateId) : Promise.resolve([])),
    [stateId],
    stateId ? `org:districts:${stateId}` : undefined,
  )

  const create = useMutation(api.createManager)
  const deactivate = useMutation(api.deactivateManager)

  const needsDistrict = role === 'DISTRICT_MANAGER'
  const ready =
    email.trim().length > 4 &&
    displayName.trim().length > 1 &&
    (needsDistrict ? Boolean(districtId) : Boolean(stateId))

  async function submit() {
    setProblem(null)
    setIssued(null)
    const { data, error } = await create.submit({
      email: email.trim(),
      display_name: displayName.trim(),
      role,
      ...(needsDistrict ? { district_id: districtId } : { state_id: stateId }),
    })
    if (error) {
      setProblem(error instanceof Error ? error.message : 'Could not create that account.')
      return
    }
    if (data) {
      setIssued({ name: data.manager.display_name, password: data.temporary_password })
      setEmail('')
      setDisplayName('')
      managers.reload()
    }
  }

  // Deactivation is a record, not a deletion - but it signs the person out of
  // their fleet at once, so it is asked before it is done.
  async function handleDeactivate(m: ManagerRow) {
    if (!window.confirm(`Deactivate ${m.display_name}?\n\n• They can no longer sign in\n• The account stays on this list as a record`)) return
    const { error } = await deactivate.submit(m.id)
    if (!error) managers.reload()
  }

  const header = (
    <PageHeader
      title="Managers"
      meta="Who holds a state or a district, and what they can see. A new account is shown its temporary password once."
    />
  )
  if (managers.error) return <div className="flex flex-col gap-[14px]">{header}<ErrorState error={managers.error} onRetry={managers.reload} /></div>
  if (!managers.data) return <div className="flex flex-col gap-[14px]">{header}<LoadingState label="Loading managers" /></div>

  const active = managers.data.filter((m) => m.is_active).length

  return (
    <div className="flex flex-col gap-[14px]">
      {header}
      <Panel
        title="Appoint a Manager"
        subtitle={canMakeStateManagers ? 'A state manager covers one state; a district manager one district.' : 'You may appoint district managers inside your state.'}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-ink">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as ManagerRow['role'])}
              className={SELECT}
            >
              {canMakeStateManagers ? <option value="STATE_MANAGER">State manager</option> : null}
              <option value="DISTRICT_MANAGER">District manager</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-ink">State</span>
            <select
              value={stateId}
              onChange={(e) => {
                setStateId(e.target.value)
                setDistrictId('')
              }}
              className={SELECT}
            >
              <option value="">Choose a state</option>
              {(states.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>

          {needsDistrict ? (
            <label className="block">
              <span className="text-xs font-medium text-ink">District</span>
              <select
                value={districtId}
                onChange={(e) => setDistrictId(e.target.value)}
                disabled={!stateId || (districts.data ?? []).length === 0}
                className={SELECT}
              >
                <option value="">
                  {!stateId
                    ? 'Choose a state first'
                    : (districts.data ?? []).length === 0
                      ? 'Official district list pending'
                      : 'Choose a district'}
                </option>
                {(districts.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
          ) : null}

          <Field label="Name" name="manager-name" value={displayName} onChange={setDisplayName} placeholder="Kamrup District Manager" />
          <Field label="Email" name="manager-email" type="email" value={email} onChange={setEmail} placeholder="kamrup@assam.example" />
        </div>

        {problem ? (
          <p role="alert" className="mt-3 text-sm font-semibold text-danger">
            {problem}
          </p>
        ) : null}

        {issued ? (
          // Shown once. There is no endpoint that could return it again:
          // only a hash is stored, and the account can do nothing but
          // change it at first sign-in.
          <div role="status" className="mt-4 border-l-4 border-ok pl-3 text-sm">
            <p className="font-medium text-ink">
              {issued.name} created. Hand over this temporary password now — it is shown once and cannot be retrieved.
            </p>
            <p className="mt-2 select-all font-mono text-base text-ink">{issued.password}</p>
            <p className="mt-2 text-xs text-muted">
              Their first sign-in can do nothing but change it, and every session is revoked when they do.
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <ActionButton variant="primary" onClick={() => void submit()} disabled={!ready} busy={create.isSubmitting}>
            {create.isSubmitting ? 'Creating…' : 'Create account'}
          </ActionButton>
          {!ready ? (
            <span className="text-[13px] text-muted">
              {needsDistrict ? 'Choose a district and fill in the name and email.' : 'Choose a state and fill in the name and email.'}
            </span>
          ) : null}
        </div>
      </Panel>

      <Panel title="Manager Accounts" subtitle={`${managers.data.length} accounts · ${active} active`}>
        {managers.data.length === 0 ? (
          <Quiet icon={UserCog} title="No managers appointed yet">
            Create the first one above. Retired accounts stay on this list — deactivation is a record, not a deletion.
          </Quiet>
        ) : (
          <div className="relative -mx-4 overflow-x-auto px-4">
            <table className={STACK.table}>
              <thead className={STACK.head}>
                <tr>
                  <th className={TH}>Name</th>
                  <th className={TH}>Role</th>
                  <th className={TH}>Email</th>
                  <th className={TH}>Status</th>
                  <th className={TH}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className={STACK.body}>
                {managers.data.map((m) => (
                  <tr key={m.id} className={STACK.row}>
                    <td className={`${STACK.lead} font-semibold text-ink`}>{m.display_name}</td>
                    <td className={`${STACK.cell} text-ink`} data-label="Role">{ROLE_LABEL[m.role]}</td>
                    <td className={`${STACK.cellWide} break-words text-muted max-md:order-last`} data-label="Email">{m.email}</td>
                    <td className={STACK.cell} data-label="Status">
                      {!m.is_active ? (
                        <Pill tone="neutral">Inactive</Pill>
                      ) : m.must_reset_password ? (
                        <Pill tone="warning">Awaiting first sign-in</Pill>
                      ) : (
                        <Pill tone="ok">Active</Pill>
                      )}
                    </td>
                    <td className={`${STACK.actions} max-md:order-last`}>
                      {/* Outlined like every row action (manager_03); red is kept for
                          the question it asks, not for five buttons down a column. */}
                      {m.is_active ? (
                        <ActionButton
                          className="enabled:hover:text-danger"
                          disabled={deactivate.isSubmitting}
                          ariaLabel={`Deactivate ${m.display_name}`}
                          onClick={() => void handleDeactivate(m)}
                        >
                          Deactivate
                        </ActionButton>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {deactivate.error ? <InlineError compact what="The account was not deactivated" error={deactivate.error} /> : null}
      </Panel>
    </div>
  )
}
