/**
 * Session state for the manager app.
 *
 * `permissions` comes from the server and drives what the UI *renders*. It is
 * never an authorization decision - the backend re-checks every request, so
 * hiding a button is a courtesy, not a control.
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
  api,
  refreshSession,
  setAccessToken,
  setUnauthenticatedHandler,
  type AuthenticatedUser,
} from '../api/client'

interface AuthState {
  user: AuthenticatedUser | null
  permissions: string[]
  /** True until the initial silent-refresh attempt resolves. */
  isInitialising: boolean
  login: (identifier: string, password: string) => Promise<void>
  logout: () => Promise<void>
  can: (permission: string) => boolean
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [isInitialising, setIsInitialising] = useState(true)

  const clear = useCallback(() => {
    setAccessToken(null)
    setUser(null)
    setPermissions([])
  }, [])

  // Restore the session on load. The access token is memory-only and therefore
  // gone after a reload, but the HttpOnly refresh cookie survives - so one
  // silent refresh puts the manager back where they were instead of bouncing
  // them to a login screen on every page refresh.
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
          if (cancelled) return
          setUser(me.user)
          setPermissions(me.permissions)
        }
      } catch {
        // No usable session. Not an error worth showing - it is the normal
        // state for a first visit.
        if (!cancelled) clear()
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
    const result = await api.login(identifier, password)
    setAccessToken(result.access_token)
    const me = await api.me()
    setUser(me.user)
    setPermissions(me.permissions)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      // Clear locally even if the call failed - the user asked to leave, and
      // the refresh cookie is scoped so a stale server session cannot be used
      // from this browser without it.
      clear()
    }
  }, [clear])

  const can = useCallback(
    (permission: string) => permissions.includes(permission),
    [permissions],
  )

  const value = useMemo(
    () => ({ user, permissions, isInitialising, login, logout, can }),
    [user, permissions, isInitialising, login, logout, can],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
