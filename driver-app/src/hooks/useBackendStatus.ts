/**
 * Polls backend availability and exposes the real result.
 *
 * No optimistic state: until a request returns, status is 'checking'.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BackendUnreachableError,
  getHealth,
  getReady,
  type ReadyResponse,
} from '../api/client'

export type ConnectionStatus = 'checking' | 'connected' | 'disconnected'
export type DependencyStatus = 'checking' | 'ready' | 'not_ready' | 'unknown'

export interface BackendStatus {
  connection: ConnectionStatus
  database: DependencyStatus
  databaseDetail: string | null
  error: string | null
  lastCheckedAt: Date | null
  isRefreshing: boolean
  refresh: () => void
}

const POLL_INTERVAL_MS = 15_000

export function useBackendStatus(): BackendStatus {
  const [connection, setConnection] = useState<ConnectionStatus>('checking')
  const [database, setDatabase] = useState<DependencyStatus>('checking')
  const [databaseDetail, setDatabaseDetail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const mounted = useRef(true)

  const check = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await getHealth()
      if (!mounted.current) return
      setConnection('connected')
      setError(null)

      const ready: ReadyResponse = await getReady()
      if (!mounted.current) return
      setDatabase(ready.checks.database.ok ? 'ready' : 'not_ready')
      setDatabaseDetail(ready.checks.database.detail)
    } catch (err) {
      if (!mounted.current) return
      setConnection('disconnected')
      // Unreachable backend means the database state was never observed.
      setDatabase('unknown')
      setDatabaseDetail(null)
      setError(
        err instanceof BackendUnreachableError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err),
      )
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
    connection,
    database,
    databaseDetail,
    error,
    lastCheckedAt,
    isRefreshing,
    refresh: () => void check(),
  }
}
