/**
 * Driver session state.
 *
 * The driver's identity is never taken from the device. `api.me()` resolves it
 * server-side from the access token, so a tampered local store cannot make the
 * app act as a different driver - it can only fail to authenticate.
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
  type DriverMe,
} from '../api/client'
import { clearRefreshToken } from './tokenStore'

interface AuthState {
  driver: DriverMe | null
  isInitialising: boolean
  login: (identifier: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [driver, setDriver] = useState<DriverMe | null>(null)
  const [isInitialising, setIsInitialising] = useState(true)

  const clear = useCallback(() => {
    setAccessToken(null)
    setDriver(null)
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
        const token = await refreshSession()
        if (cancelled) return
        if (token) {
          const me = await api.me()
          if (!cancelled) setDriver(me)
        }
      } catch (error) {
        // No usable session - the normal state on first launch.
        if (!cancelled) clear()
        // A stored token that authenticates but is not a driver will fail this
        // way on every launch. Discard it, but ONLY when the server actually
        // said so: on a NetworkError the token may be perfectly good and the
        // driver has no signal to sign in again with.
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
      setDriver(await api.me())
    } catch (error) {
      // The credentials were valid but this is not a driver - a manager typing
      // their own login into the driver app is the realistic case. api.login()
      // has already written a refresh token to the keystore, so leaving it
      // there would persist a MANAGER session on a driver's phone that silently
      // reappears on every launch and fails the same way. Give the token back.
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

  const value = useMemo(
    () => ({ driver, isInitialising, login, logout }),
    [driver, isInitialising, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
