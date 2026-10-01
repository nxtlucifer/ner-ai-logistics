// @vitest-environment jsdom
/**
 * Managers: the picker offers only what the server accepts for this role, and
 * deactivating an account is asked before it is done - a cancelled question
 * sends nothing.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api, type ManagerRow } from '../api/client'

const role = { current: 'NORTH_EAST_MANAGER' }
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: role.current }, can: () => true }) }))

import ManagersPage from './ManagersPage'

const row = (over: Partial<ManagerRow> = {}): ManagerRow => ({
  id: 'm1', email: 'kamrup@x.test', display_name: 'Kamrup Manager', role: 'DISTRICT_MANAGER',
  state_id: null, district_id: 'd1', is_active: true, must_reset_password: false, ...over,
})

beforeEach(() => {
  vi.spyOn(api, 'listStates').mockResolvedValue([{ id: 's1', name: 'Assam', slug: 'assam', source_name: 'x', district_count: 3 }])
  vi.spyOn(api, 'listDistricts').mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  role.current = 'NORTH_EAST_MANAGER'
})

it('asks before deactivating, and sends nothing when the question is cancelled', async () => {
  vi.spyOn(api, 'listManagers').mockResolvedValue([row()])
  const deactivate = vi.spyOn(api, 'deactivateManager').mockResolvedValue(undefined as never)
  const confirm = vi.fn(() => false)
  vi.stubGlobal('confirm', confirm)
  render(<ManagersPage />)

  fireEvent.click(await screen.findByRole('button', { name: 'Deactivate Kamrup Manager' }))
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(String((confirm.mock.calls[0] as unknown[])[0])).toMatch(/^Deactivate Kamrup Manager\?/)
  expect(deactivate).not.toHaveBeenCalled()

  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Deactivate Kamrup Manager' }))
  await waitFor(() => expect(deactivate).toHaveBeenCalledWith('m1'))
})

it('says an inactive account is inactive, never "cancelled", and offers no second deactivation', async () => {
  vi.spyOn(api, 'listManagers').mockResolvedValue([row({ is_active: false })])
  render(<ManagersPage />)
  expect(await screen.findByText('Inactive')).toBeDefined()
  expect(screen.queryByText(/cancelled/i)).toBeNull()
  expect(screen.queryByRole('button', { name: /deactivate/i })).toBeNull()
})

it('offers a state manager only the district role, and keeps Create shut with the reason shown', async () => {
  role.current = 'STATE_MANAGER'
  vi.spyOn(api, 'listManagers').mockResolvedValue([])
  render(<ManagersPage />)
  const roleSelect = (await screen.findByText('Role')).parentElement!.querySelector('select')!
  expect([...roleSelect.options].map((o) => o.value)).toEqual(['DISTRICT_MANAGER'])
  const create = screen.getByRole('button', { name: 'Create account' }) as HTMLButtonElement
  expect(create.disabled).toBe(true)
  expect(create.getAttribute('aria-disabled')).toBe('true')
  expect(screen.getByText('Choose a district and fill in the name and email.')).toBeDefined()
})
