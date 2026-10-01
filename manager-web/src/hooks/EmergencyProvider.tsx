/** The one SOS poll behind useEmergencies (see useEmergencies.ts). */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { api, type Emergency } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { EmergencyContext, SOS_HIDDEN_POLL_MS, SOS_POLL_MS } from './useEmergencies'

export function EmergencyProvider({ children }: { children: ReactNode }) {
  const { can } = useAuth()
  // The permission GET /api/emergencies/active requires (EMERGENCY_READ).
  const allowed = can('emergency:read')
  const [emergencies, setEmergencies] = useState<Emergency[]>([])
  const [loaded, setLoaded] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  // Newest request wins; the poll skips a tick while any is outstanding.
  const latest = useRef(0)
  const pending = useRef(0)

  const reload = useCallback(async () => {
    const id = ++latest.current
    pending.current += 1
    try {
      const data = await api.activeEmergencies()
      if (id === latest.current) {
        setEmergencies(data)
        setUnavailable(false)
      }
    } catch {
      if (id === latest.current) setUnavailable(true)
    } finally {
      pending.current -= 1
      if (id === latest.current) setLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!allowed) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      if (pending.current === 0) void reload()
      timer = setTimeout(tick, document.visibilityState === 'hidden' ? SOS_HIDDEN_POLL_MS : SOS_POLL_MS)
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      clearTimeout(timer)
      tick()
    }
    tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [allowed, reload])

  const value = useMemo(() => ({ emergencies, loaded, unavailable, reload }), [emergencies, loaded, unavailable, reload])
  return <EmergencyContext.Provider value={value}>{children}</EmergencyContext.Provider>
}
