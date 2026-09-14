/**
 * ONE login, the server's role. Restore and login both resolve identity from
 * /api/auth/me; a DRIVER additionally loads the driver profile; a MANAGER
 * never does; logout clears every bit of identity before the next sign-in.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({
  login: vi.fn(),
  authMe: vi.fn(),
  me: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
  setAccessToken: vi.fn(),
  clearRefreshToken: vi.fn(),
}))
vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error { status = 0 },
  api: { login: mocked.login, authMe: mocked.authMe, me: mocked.me, logout: mocked.logout },
  refreshSession: mocked.refreshSession,
  setAccessToken: mocked.setAccessToken,
  setUnauthenticatedHandler: () => {},
}))
vi.mock('./tokenStore', () => ({ clearRefreshToken: mocked.clearRefreshToken }))

import { AuthProvider, useAuth } from './AuthProvider'

const manager = { user: { id: 'm', role: 'MANAGER', display_name: 'Dispatch', email: 'd@x', phone: null }, permissions: ['trip:dispatch'] }
const driver = { user: { id: 'u', role: 'DRIVER', display_name: 'Demo', email: null, phone: '9' }, permissions: ['trip:execute_own'] }
const profile = { id: 'drv', full_name: 'RASTA Demo Driver', phone: '9', licence_number: 'L' }

let ctx: ReturnType<typeof useAuth> | null = null
function Probe() {
  ctx = useAuth()
  return <div>{ctx.isInitialising ? 'init' : ctx.driver ? 'DRIVER_SHELL' : ctx.user ? `${ctx.user.role}_SHELL` : 'LOGIN'}</div>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocked.logout.mockResolvedValue(undefined)
  mocked.login.mockResolvedValue({ access_token: 't' })
  mocked.me.mockResolvedValue(profile)
})
afterEach(cleanup)

describe('role-aware session', () => {
  it('restores a cached MANAGER token into the manager shell without touching the driver profile', async () => {
    mocked.refreshSession.mockResolvedValue('t')
    mocked.authMe.mockResolvedValue(manager)
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('MANAGER_SHELL')).toBeTruthy())
    expect(mocked.me).not.toHaveBeenCalled()
    expect(ctx!.can('trip:dispatch')).toBe(true)
  })

  it('restores a cached DRIVER token into the driver shell', async () => {
    mocked.refreshSession.mockResolvedValue('t')
    mocked.authMe.mockResolvedValue(driver)
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('DRIVER_SHELL')).toBeTruthy())
    expect(ctx!.driver?.full_name).toBe('RASTA Demo Driver')
  })

  it('switches driver -> manager -> driver with nothing carried over', async () => {
    mocked.refreshSession.mockResolvedValue(null)
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('LOGIN')).toBeTruthy())
    mocked.authMe.mockResolvedValue(driver)
    await act(async () => { await ctx!.login('9', 'pw') })
    expect(screen.getByText('DRIVER_SHELL')).toBeTruthy()
    await act(async () => { await ctx!.logout() })
    expect(screen.getByText('LOGIN')).toBeTruthy()
    expect(ctx!.permissions).toEqual([])
    mocked.authMe.mockResolvedValue(manager)
    await act(async () => { await ctx!.login('d@x', 'pw') })
    expect(screen.getByText('MANAGER_SHELL')).toBeTruthy()
    expect(ctx!.driver).toBeNull()
    expect(ctx!.can('trip:execute_own')).toBe(false)
    await act(async () => { await ctx!.logout() })
    mocked.authMe.mockResolvedValue(driver)
    await act(async () => { await ctx!.login('9', 'pw') })
    expect(screen.getByText('DRIVER_SHELL')).toBeTruthy()
    expect(ctx!.can('trip:dispatch')).toBe(false)
  })

  it('a login whose identity cannot be used hands the token back', async () => {
    mocked.refreshSession.mockResolvedValue(null)
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByText('LOGIN')).toBeTruthy())
    mocked.authMe.mockResolvedValue(driver)
    mocked.me.mockRejectedValue(new Error('suspended'))
    await act(async () => { await expect(ctx!.login('9', 'pw')).rejects.toThrow('suspended') })
    expect(mocked.logout).toHaveBeenCalledTimes(1)
    expect(screen.getByText('LOGIN')).toBeTruthy()
  })
})
