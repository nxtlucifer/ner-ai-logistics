/**
 * Polls the backend system endpoints and exposes the real result.
 *
 * Deliberately has no optimistic or placeholder state: until a request has
 * actually returned, status is 'checking', never a guessed 'online'. Every value
 * the dashboard renders traces back to a response received here.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BackendUnreachableError,
  getHealth,
  getReady,
  type DatabaseProvider,
  type ReadyResponse,
} from '../api/client'

export type BackendStatus = 'checking' | 'online' | 'offline'
export type DatabaseStatus = 'checking' | 'ready' | 'not_ready' | 'unknown'

export interface SystemStatus {
  backend: BackendStatus
  database: DatabaseStatus
  postgis: DatabaseStatus
  /**
   * Which database the backend is configured against, as reported by the
   * backend. Never hardcoded - if the backend switches provider, this follows.
   */
  provider: DatabaseProvider | null
  /** Server-reported detail, e.g. the PostgreSQL version string. */
  databaseDetail: string | null
  postgisDetail: string | null
  /** Why the backend is unreachable, when it is. */
  error: string | null
  lastCheckedAt: Date | null
  isRefreshing: boolean
  refresh: () => void
}

const POLL_INTERVAL_MS = 10_000

export function useSystemStatus(): SystemStatus {
  const [backend, setBackend] = useState<BackendStatus>('checking')
  const [database, setDatabase] = useState<DatabaseStatus>('checking')
  const [postgis, setPostgis] = useState<DatabaseStatus>('checking')
  const [provider, setProvider] = useState<DatabaseProvider | null>(null)
  const [databaseDetail, setDatabaseDetail] = useState<string | null>(null)
  const [postgisDetail, setPostgisDetail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Guards against a slow response from an unmounted component writing state.
  const mounted = useRef(true)

  const check = useCallback(async () => {
    setIsRefreshing(true)
    try {
      // /health first: it proves the process is alive without touching the
      // database, so a database outage is reported as exactly that rather than
      // as the backend being down.
      await getHealth()
      if (!mounted.current) return
      setBackend('online')
      setError(null)

      const ready: ReadyResponse = await getReady()
      if (!mounted.current) return

      setProvider(ready.provider)
      setDatabase(ready.checks.database.ok ? 'ready' : 'not_ready')
      setDatabaseDetail(ready.checks.database.detail)
      setPostgis(ready.checks.postgis.ok ? 'ready' : 'not_ready')
      setPostgisDetail(ready.checks.postgis.detail)
    } catch (err) {
      if (!mounted.current) return
      if (err instanceof BackendUnreachableError) {
        setBackend('offline')
        // The database state is genuinely unknown when the backend cannot be
        // reached - reporting it as "not ready" would assert something we did
        // not observe.
        setDatabase('unknown')
        setPostgis('unknown')
        setDatabaseDetail(null)
        setPostgisDetail(null)
        setProvider(null)
      } else {
        setBackend('offline')
        setDatabase('unknown')
        setPostgis('unknown')
        setProvider(null)
      }
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (mounted.current) {
        setLastCheckedAt(new Date())
        setIsRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void check()
    const id = setInterval(() => void check(), POLL_INTERVAL_MS)
    return () => {
      mounted.current = false
      clearInterval(id)
    }
  }, [check])

  return {
    backend,
    database,
    postgis,
    provider,
    databaseDetail,
    postgisDetail,
    error,
    lastCheckedAt,
    isRefreshing,
    refresh: () => void check(),
  }
}
