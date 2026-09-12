/**
 * Data fetching with an explicit state machine.
 *
 *   idle -> loading -> success | error
 *
 * Every consumer must handle all four. The alternative - treating "no data yet"
 * and "the request failed" as the same thing - renders an empty list for an
 * outage, which is worse than an error message because it looks like an answer.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { readCache, subscribeConnectivity, getConnectivity, writeCache } from '../api/connectivity'

export type ResourceStatus = 'idle' | 'loading' | 'success' | 'error'

export interface Resource<T> {
  status: ResourceStatus
  data: T | null
  error: unknown
  /** True while refetching with data already on screen. */
  isRefreshing: boolean
  /** Device clock at the last successful fetch (or the cached copy's). */
  lastSyncAt: number | null
  reload: () => void
}

/**
 * `cacheKey` makes the resource stale-while-revalidate: the last successful
 * answer is kept in localStorage, hydrated synchronously on mount (so the page
 * never opens on "Loading…" when it has seen this list before), refreshed in
 * the background, and KEPT on a failed refresh - the shell's banner says the
 * console is offline; the page keeps showing what it last knew. A failure with
 * nothing cached is still `error`, because an empty list would look like an
 * answer.
 */
export function useResource<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[] = [],
  cacheKey?: string,
  /** Bounded background refresh, so a driver's state change reaches this
   *  page without a reload. Silent: data stays on screen while it runs. */
  pollMs?: number,
): Resource<T> {
  const cached = useRef(cacheKey ? readCache<T>(cacheKey) : null)
  const [status, setStatus] = useState<ResourceStatus>(cached.current ? 'success' : 'idle')
  const [data, setData] = useState<T | null>(cached.current?.data ?? null)
  const [error, setError] = useState<unknown>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(cached.current?.at ?? null)

  const mounted = useRef(true)
  // Guards against a slow earlier request resolving after a newer one and
  // overwriting fresher data.
  const requestId = useRef(0)

  const run = useCallback(async () => {
    const id = ++requestId.current
    setStatus((prev) => (prev === 'success' ? prev : 'loading'))
    setIsRefreshing(true)
    try {
      const result = await fetcher()
      if (!mounted.current || id !== requestId.current) return
      setData(result)
      setError(null)
      setStatus('success')
      setLastSyncAt(Date.now())
      if (cacheKey) writeCache(cacheKey, result)
    } catch (err) {
      if (!mounted.current || id !== requestId.current) return
      setError(err)
      // Data on screen (cached or earlier) outranks the failure.
      setStatus((prev) => (prev === 'success' && cacheKey ? prev : 'error'))
    } finally {
      if (mounted.current && id === requestId.current) setIsRefreshing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    mounted.current = true
    void run()
    // Reconnect: when the console comes back online, refresh without a reload.
    let wasOnline = getConnectivity().online
    const unsubscribe = subscribeConnectivity(() => {
      const online = getConnectivity().online
      if (online && !wasOnline) void run()
      wasOnline = online
    })
    // Not while offline: the probe in connectivity.ts already asks /health,
    // and a page hammering a dead backend every few seconds gains nothing.
    const timer = pollMs
      ? setInterval(() => {
          if (getConnectivity().online) void run()
        }, pollMs)
      : undefined
    return () => {
      mounted.current = false
      unsubscribe()
      if (timer) clearInterval(timer)
    }
  }, [run, pollMs])

  return { status, data, error, isRefreshing, lastSyncAt, reload: () => void run() }
}

/**
 * Mutation state machine.
 *
 *   idle -> submitting -> success | error
 *
 * `submit` refuses to start while one is already in flight, which is the
 * double-submit guard for anything that creates a record.
 */
export function useMutation<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const inFlight = useRef(false)

  /**
   * Returns the outcome directly rather than only setting state.
   *
   * Callers need the error synchronously - to map a 422 onto form fields, for
   * instance. Reading `error` straight after awaiting submit() would see the
   * previous render's value, because setState is asynchronous, so the mapping
   * would silently never run.
   */
  const submit = useCallback(
    async (...args: TArgs): Promise<{ data?: TResult; error?: unknown }> => {
      if (inFlight.current) return {} // double-submit guard
      inFlight.current = true
      setIsSubmitting(true)
      setError(null)
      try {
        const data = await action(...args)
        return { data }
      } catch (err) {
        setError(err)
        return { error: err }
      } finally {
        inFlight.current = false
        setIsSubmitting(false)
      }
    },
    [action],
  )

  return { submit, isSubmitting, error, clearError: () => setError(null) }
}
