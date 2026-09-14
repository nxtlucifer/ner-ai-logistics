/**
 * ONE login, the SERVER's role. Drivers and managers type the same credentials
 * into the same screen; `GET /api/auth/me` says who they are and the shell
 * (App.tsx Gate) renders the driver app or the manager app from that answer.
 * Nothing on the device chooses a role - no selector, no cached screen state.
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
  api,
  refreshSession,
  setAccessToken,
  setUnauthenticatedHandler,
  type AuthenticatedUser,
  type DriverMe,
} from '../api/client'
import { clearRefreshToken } from './tokenStore'

interface AuthState {
  /** Server identity for any role; null when signed out. */
  user: AuthenticatedUser | null
  permissions: string[]
  /** Driver profile - only when `user.role === 'DRIVER'`. */
  driver: DriverMe | null
  isInitialising: boolean
  /** A manager is looking at this driver's app through a read-only token. */
  supportView: boolean
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [isInitialising, setIsInitialising] = useState(true)
  const [supportView, setSupportView] = useState(false)

  const clear = useCallback(() => {
    setAccessToken(null)
    setIdentity(null)
  }, [])

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
        }
      } catch (error) {
        // No usable session - the normal state on first launch.
        if (!cancelled) clear()
        // A stored token the server actually refuses is discarded. On a
        // NetworkError the token may be perfectly good and the driver has no
        // signal to sign in again with - keep it.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          await clearRefreshToken().catch(() => undefined)
        }
      } finally {
        if (!cancelled) setIsInitialising(false)
      }
    })()

    return () => {
      cancelled = true
      setUnauthenticatedHandler(null)
    }
  }, [clear])

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
      login,
      logout,
      can,
    }),
    [identity, isInitialising, supportView, login, logout, can],
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
