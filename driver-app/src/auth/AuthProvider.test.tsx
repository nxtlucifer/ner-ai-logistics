// @vitest-environment jsdom
/**
 * ONE login, the server's role. Restore and login both resolve identity from
 * /api/auth/me; a DRIVER additionally loads the driver profile; a MANAGER
 * never does; logout clears every bit of identity before the next sign-in.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({
  login: vi.fn(),
  authMe: vi.fn(),
  me: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
  setAccessToken: vi.fn(),
  clearRefreshToken: vi.fn(),
  loadRefreshToken: vi.fn(),
  readCachedIdentity: vi.fn(),
  cacheIdentity: vi.fn(),
  clearSessionCache: vi.fn(),
}))
vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(status = 0) { super(`HTTP ${status}`); this.status = status }
  },
  NetworkError: class NetworkError extends Error {},
  api: { login: mocked.login, authMe: mocked.authMe, me: mocked.me, logout: mocked.logout },
  refreshSession: mocked.refreshSession,
  setAccessToken: mocked.setAccessToken,
  setUnauthenticatedHandler: () => {},
}))
vi.mock('./tokenStore', () => ({ clearRefreshToken: mocked.clearRefreshToken, loadRefreshToken: mocked.loadRefreshToken }))
vi.mock('./sessionCache', () => ({
  readCachedIdentity: mocked.readCachedIdentity,
  cacheIdentity: mocked.cacheIdentity,
  clearSessionCache: mocked.clearSessionCache,
}))

import { ApiError, NetworkError } from '../api/client'
import { AuthProvider, SESSION_RETRY_MS, useAuth } from './AuthProvider'

const manager = { user: { id: 'm', role: 'MANAGER', display_name: 'Dispatch', email: 'd@x', phone: null }, permissions: ['trip:dispatch'] }
const driver = { user: { id: 'u', role: 'DRIVER', display_name: 'Demo', email: null, phone: '9' }, permissions: ['trip:execute_own'] }
const profile = { id: 'drv', full_name: 'RASTA Demo Driver', phone: '9', licence_number: 'L' }

let ctx: ReturnType<typeof useAuth> | null = null
function Probe() {
  ctx = useAuth()
  return createElement('div', { id: 'shell' }, ctx.isInitialising ? 'init' : ctx.driver ? 'DRIVER_SHELL' : ctx.user ? `${ctx.user.role}_SHELL` : 'LOGIN')
}

let host: HTMLDivElement
let root: Root
const shell = () => host.querySelector('#shell')?.textContent
async function mount() {
  await act(async () => root.render(createElement(AuthProvider, null, createElement(Probe))))
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocked.logout.mockResolvedValue(undefined)
  mocked.login.mockResolvedValue({ access_token: 't' })
  mocked.me.mockResolvedValue(profile)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('role-aware session', () => {
  it('restores a cached MANAGER token into the manager shell without touching the driver profile', async () => {
    mocked.refreshSession.mockResolvedValue('t')
    mocked.authMe.mockResolvedValue(manager)
    await mount()
    expect(shell()).toBe('MANAGER_SHELL')
    expect(mocked.me).not.toHaveBeenCalled()
    expect(ctx!.can('trip:dispatch')).toBe(true)
  })

  it('restores a cached DRIVER token into the driver shell', async () => {
    mocked.refreshSession.mockResolvedValue('t')
    mocked.authMe.mockResolvedValue(driver)
    await mount()
    expect(shell()).toBe('DRIVER_SHELL')
    expect(ctx!.driver?.full_name).toBe('RASTA Demo Driver')
  })

  it('switches driver -> manager -> driver with nothing carried over', async () => {
    mocked.refreshSession.mockResolvedValue(null)
    await mount()
    expect(shell()).toBe('LOGIN')
    mocked.authMe.mockResolvedValue(driver)
    await act(async () => { await ctx!.login('9', 'pw') })
    expect(shell()).toBe('DRIVER_SHELL')
    await act(async () => { await ctx!.logout() })
    expect(shell()).toBe('LOGIN')
    expect(ctx!.permissions).toEqual([])
    mocked.authMe.mockResolvedValue(manager)
    await act(async () => { await ctx!.login('d@x', 'pw') })
    expect(shell()).toBe('MANAGER_SHELL')
    expect(ctx!.driver).toBeNull()
    expect(ctx!.can('trip:execute_own')).toBe(false)
    await act(async () => { await ctx!.logout() })
    mocked.authMe.mockResolvedValue(driver)
    await act(async () => { await ctx!.login('9', 'pw') })
    expect(shell()).toBe('DRIVER_SHELL')
    expect(ctx!.can('trip:dispatch')).toBe(false)
  })

  it('a login whose identity cannot be used hands the token back', async () => {
    mocked.refreshSession.mockResolvedValue(null)
    await mount()
    mocked.authMe.mockResolvedValue(driver)
    mocked.me.mockRejectedValue(new Error('suspended'))
    await act(async () => { await expect(ctx!.login('9', 'pw')).rejects.toThrow('suspended') })
    expect(mocked.logout).toHaveBeenCalledTimes(1)
    expect(shell()).toBe('LOGIN')
  })
})

describe('cold launch with no signal (FE-01)', () => {
  const cachedDriver = { ...driver, driver: profile }

  it('opens the cached driver OFFLINE, goes live when the refresh succeeds, and clears the cache on logout', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      mocked.refreshSession.mockRejectedValue(new NetworkError('no signal'))
      mocked.loadRefreshToken.mockResolvedValue('stored')
      mocked.readCachedIdentity.mockResolvedValue(cachedDriver)
      await mount()
      expect(shell()).toBe('DRIVER_SHELL')
      expect(ctx!.offline).toBe(true)
      expect(mocked.clearRefreshToken).not.toHaveBeenCalled()
      expect(mocked.cacheIdentity).not.toHaveBeenCalled() // the cache is never written back as if live

      mocked.refreshSession.mockResolvedValue('t')
      mocked.authMe.mockResolvedValue({ ...driver, user: { ...driver.user, email: 'drv@x' } })
      await act(async () => { await vi.advanceTimersByTimeAsync(SESSION_RETRY_MS) })
      expect(ctx!.offline).toBe(false)
      // The cache keeps the name for the header, never the licence, phone or email.
      const written = mocked.cacheIdentity.mock.calls.at(-1)![0]
      expect(written.driver).toEqual({ id: 'drv', full_name: 'RASTA Demo Driver' })
      expect(written.user.phone).toBeNull()
      expect(written.user.email).toBeNull()
      expect(JSON.stringify(written)).not.toMatch(/licence/)

      await act(async () => { await ctx!.logout() })
      expect(shell()).toBe('LOGIN')
      expect(mocked.clearSessionCache).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a 503 from a waking server with a stored token opens the cached identity OFFLINE', async () => {
    mocked.refreshSession.mockRejectedValue(new ApiError(503, null, 'waking'))
    mocked.loadRefreshToken.mockResolvedValue('stored')
    mocked.readCachedIdentity.mockResolvedValue(cachedDriver)
    await mount()
    expect(shell()).toBe('DRIVER_SHELL')
    expect(ctx!.offline).toBe(true)
    expect(mocked.clearRefreshToken).not.toHaveBeenCalled()
  })

  it('while offline, a refused session goes to LOGIN and clears the cache', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      mocked.refreshSession.mockRejectedValue(new NetworkError('no signal'))
      mocked.loadRefreshToken.mockResolvedValue('stored')
      mocked.readCachedIdentity.mockResolvedValue(cachedDriver)
      await mount()
      expect(ctx!.offline).toBe(true)
      mocked.clearSessionCache.mockClear()

      mocked.refreshSession.mockResolvedValue(null)
      await act(async () => { await vi.advanceTimersByTimeAsync(SESSION_RETRY_MS) })
      expect(shell()).toBe('LOGIN')
      expect(ctx!.offline).toBe(false)
      expect(mocked.clearSessionCache).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('without a stored token a network failure is the login screen, not a cached identity', async () => {
    mocked.refreshSession.mockRejectedValue(new NetworkError('no signal'))
    mocked.loadRefreshToken.mockResolvedValue(null)
    mocked.readCachedIdentity.mockResolvedValue(cachedDriver)
    await mount()
    expect(shell()).toBe('LOGIN')
    expect(ctx!.offline).toBe(false)
  })
})
