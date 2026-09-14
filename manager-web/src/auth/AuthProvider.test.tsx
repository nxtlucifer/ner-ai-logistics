// @vitest-environment jsdom
/**
 * The console is for managers. A driver's valid credentials authenticate and
 * are then refused: session revoked, state cleared, one sentence shown - on
 * login AND on the silent restore a reload performs.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({
  login: vi.fn(),
  me: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
  setAccessToken: vi.fn(),
  clearCache: vi.fn(),
}))

vi.mock('../api/client', () => ({
  api: { login: mocked.login, me: mocked.me, logout: mocked.logout },
  refreshSession: mocked.refreshSession,
  setAccessToken: mocked.setAccessToken,
  setUnauthenticatedHandler: () => {},
}))
vi.mock('../api/connectivity', () => ({ clearCache: mocked.clearCache }))

import { AuthProvider, MANAGER_ACCOUNT_REQUIRED, useAuth } from './AuthProvider'

const manager = { user: { id: 'm1', role: 'MANAGER', display_name: 'Dispatch', email: 'd@x', phone: null }, permissions: ['trip:read'] }
const driver = { user: { id: 'd1', role: 'DRIVER', display_name: 'A driver', email: null, phone: '9' }, permissions: ['trip:execute_own'] }

let ctx: ReturnType<typeof useAuth> | null = null
function Probe() {
  ctx = useAuth()
  return <div>{ctx.isInitialising ? 'init' : ctx.user ? `user:${ctx.user.role}` : `denied:${ctx.deniedReason ?? '-'}`}</div>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocked.logout.mockResolvedValue(undefined)
  mocked.login.mockResolvedValue({ access_token: 't' })
})
afterEach(cleanup)

describe('manager console role gate', () => {
  it('restores a manager session on reload', async () => {
    mocked.refreshSession.mockResolvedValue('t')
    mocked.me.mockResolvedValue(manager)
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('user:MANAGER')).toBeTruthy())
    expect(mocked.logout).not.toHaveBeenCalled()
  })

  it('admits the authorised reviewer, who holds only the review permissions', async () => {
    mocked.refreshSession.mockResolvedValue('t')
    mocked.me.mockResolvedValue({ user: { id: 'r1', role: 'AUTHORISED_REVIEWER', display_name: 'Reviewer', email: 'r@x', phone: null }, permissions: ['trip:read', 'route:read', 'route:review_authorize'] })
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('user:AUTHORISED_REVIEWER')).toBeTruthy())
    expect(mocked.logout).not.toHaveBeenCalled()
    expect(ctx!.can('route:review_authorize')).toBe(true)
    expect(ctx!.can('route:select')).toBe(false)
  })

  it('refuses a driver session on reload: revoked, cleared, explained', async () => {
    mocked.refreshSession.mockResolvedValue('t')
    mocked.me.mockResolvedValue(driver)
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText(`denied:${MANAGER_ACCOUNT_REQUIRED}`)).toBeTruthy())
    expect(mocked.logout).toHaveBeenCalledTimes(1)
    expect(mocked.setAccessToken).toHaveBeenLastCalledWith(null)
    expect(mocked.clearCache).toHaveBeenCalled()
  })

  it('refuses a driver login the same way and keeps no permissions', async () => {
    mocked.refreshSession.mockResolvedValue(null)
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('denied:-')).toBeTruthy())
    mocked.me.mockResolvedValue(driver)
    await act(async () => {
      await expect(ctx!.login('9', 'pw')).rejects.toThrow(MANAGER_ACCOUNT_REQUIRED)
    })
    expect(mocked.logout).toHaveBeenCalledTimes(1)
    expect(ctx!.user).toBeNull()
    expect(ctx!.can('trip:execute_own')).toBe(false)
    expect(screen.getByText(`denied:${MANAGER_ACCOUNT_REQUIRED}`)).toBeTruthy()
    // a manager can still sign in afterwards on the same page
    mocked.me.mockResolvedValue(manager)
    await act(async () => { await ctx!.login('d@x', 'pw') })
    expect(screen.getByText('user:MANAGER')).toBeTruthy()
    expect(ctx!.deniedReason).toBeNull()
  })
})
