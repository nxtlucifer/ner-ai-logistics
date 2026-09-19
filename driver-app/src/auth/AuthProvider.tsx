/**
 * ONE login, the SERVER's role. Drivers and managers type the same credentials
 * into the same screen; `GET /api/auth/me` says who they are and the shell
 * (App.tsx Gate) renders the driver app or the manager app from that answer.
 * Nothing on the device chooses a role - no selector, no cached screen state.
 * An offline launch (FE-01) reuses the last server-confirmed identity - name
 * and role, never licence or contact details - until the session is live.
 *
 * DRIVER  -> `driver` is the profile from /api/driver/me (unchanged contract)
 * MANAGER / ADMIN -> `user` + `permissions`; `driver` stays null
 *
 * Restore on launch goes through the same path, so a cached manager session
 * opens the manager shell and a cached driver session the driver shell.
 * Logout clears everything (token, identity, permissions) before the next
 * sign-in: no role UI survives a switch.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import {
  ApiError,
  NetworkError,
  api,
  refreshSession,
  setAccessToken,
  setUnauthenticatedHandler,
  type AuthenticatedUser,
  type DriverMe,
} from '../api/client'
import { cacheIdentity, clearSessionCache, readCachedIdentity } from './sessionCache'
import { clearRefreshToken, loadRefreshToken } from './tokenStore'

interface AuthState {
  /** Server identity for any role; null when signed out. */
  user: AuthenticatedUser | null
  permissions: string[]
  /** Driver profile - only when `user.role === 'DRIVER'`. */
  driver: DriverMe | null
  isInitialising: boolean
  /** A manager is looking at this driver's app through a read-only token. */
  supportView: boolean
  /**
   * The server could not be reached at launch, so identity is the last one it
   * returned (FE-01). The session is retried in the background; screens show
   * their data as not up to date until it is live again.
   */
  offline: boolean
  login: (identifier: string, password: string) => Promise<void>
  logout: () => Promise<void>
  can: (permission: string) => boolean
}

const AuthContext = createContext<AuthState | null>(null)

interface Identity {
  user: AuthenticatedUser
  permissions: string[]
  driver: DriverMe | null
}

/** Who the current token is, from the server only. */
async function identify(): Promise<Identity> {
  const me = await api.authMe()
  const driver = me.user.role === 'DRIVER' ? await api.me() : null
  return { user: me.user, permissions: me.permissions, driver }
}

/** Only what an offline launch needs to open the right shell and greet the
 *  driver. AsyncStorage is plaintext and Android backs it up: no licence, no
 *  phone, no email. */
function cacheable({ user, permissions, driver }: Identity) {
  return {
    user: { ...user, email: null, phone: null },
    permissions,
    driver: driver && { id: driver.id, full_name: driver.full_name },
  }
}

/** How often an offline launch retries the session. */
export const SESSION_RETRY_MS = 30_000

/** No signal, a waking server, the refresh limiter: nothing said about the session. */
function retryable(error: unknown): boolean {
  return error instanceof NetworkError || (error instanceof ApiError && (error.status >= 500 || error.status === 429))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [isInitialising, setIsInitialising] = useState(true)
  const [supportView, setSupportView] = useState(false)
  const [offline, setOffline] = useState(false)

  const clear = useCallback(() => {
    setAccessToken(null)
    setIdentity(null)
    setOffline(false)
    clearSessionCache()
  }, [])

  /** No usable session. A stored token the server actually refused goes too. */
  const endSession = useCallback(async (error: unknown) => {
    clear()
    // On a NetworkError the token may be perfectly good and the driver has no
    // signal to sign in again with - keep it.
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      await clearRefreshToken().catch(() => undefined)
    }
  }, [clear])

  // Restore the session on launch. A driver starting a shift should not have to
  // type a password on a phone in the cab; the refresh token in the keystore
  // makes that unnecessary while the access token still expires in 15 minutes.
  useEffect(() => {
    let cancelled = false
    setUnauthenticatedHandler(() => {
      if (!cancelled) clear()
    })

    void (async () => {
      try {
        // Manager support view (web only): the token arrives in the URL
        // FRAGMENT - never sent to any server - and is dropped from the bar.
        const support = supportTokenFromUrl()
        const token = support ?? (await refreshSession())
        if (support) {
          setAccessToken(support)
          setSupportView(true)
        }
        if (cancelled) return
        if (token) {
          const who = await identify()
          if (!cancelled) setIdentity(who)
        } else clear() // nothing stored, or refused: no cached identity may outlive it
      } catch (error) {
        if (cancelled) return
        // FE-01: with a token still stored, a retryable failure opens the last
        // identity OFFLINE, so the cached trip and route package stay reachable
        // after an OS kill in a dead zone. Otherwise: the login screen, the
        // normal state on first launch.
        const cached = retryable(error) && (await loadRefreshToken()) ? await readCachedIdentity<Identity>() : null
        if (cancelled) return
        if (cached?.user) {
          setIdentity(cached)
          setOffline(true)
        } else await endSession(error)
      } finally {
        if (!cancelled) setIsInitialising(false)
      }
    })()

    return () => {
      cancelled = true
      setUnauthenticatedHandler(null)
    }
  }, [clear, endSession])

  // While offline, keep trying to turn the stored token into a live session.
  useEffect(() => {
    if (!offline) return
    let stopped = false
    let busy = false
    const timer = setInterval(() => {
      if (busy) return
      busy = true
      void (async () => {
        try {
          const token = await refreshSession()
          const who = token ? await identify() : null
          if (stopped) return
          if (!who) return clear() // refused: refreshSession already dropped the token
          setIdentity(who)
          setOffline(false)
        } catch (error) {
          if (!stopped && !retryable(error)) await endSession(error)
        } finally {
          busy = false
        }
      })()
    }, SESSION_RETRY_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [offline, clear, endSession])

  // The last identity the SERVER confirmed, for an offline launch. Never the
  // cached one written back, and never a token.
  useEffect(() => {
    if (identity && !offline) cacheIdentity(cacheable(identity))
  }, [identity, offline])

  const login = useCallback(async (identifier: string, password: string) => {
    await api.login(identifier, password)
    try {
      // Identity comes from the server, not from the login response body.
      setIdentity(await identify())
    } catch (error) {
      // Valid credentials but no usable identity (a suspended driver profile,
      // for instance). api.login() has already written a refresh token to the
      // keystore; leaving it there would resurrect the session on every
      // launch and fail the same way. Give the token back.
      await api.logout().catch(() => undefined)
      clear()
      throw error
    }
  }, [clear])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      clear()
    }
  }, [clear])

  const can = useCallback(
    (permission: string) => identity?.permissions.includes(permission) ?? false,
    [identity],
  )

  const value = useMemo(
    () => ({
      user: identity?.user ?? null,
      permissions: identity?.permissions ?? [],
      driver: identity?.driver ?? null,
      isInitialising,
      supportView,
      offline,
      login,
      logout,
      can,
    }),
    [identity, isInitialising, supportView, offline, login, logout, can],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function supportTokenFromUrl(): string | null {
  if (typeof window === 'undefined' || !window.location?.hash) return null
  const token = new URLSearchParams(window.location.hash.slice(1)).get('support')
  if (token) window.history.replaceState(null, '', window.location.pathname)
  return token
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
