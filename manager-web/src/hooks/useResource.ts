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

export type ResourceStatus = 'idle' | 'loading' | 'success' | 'error'

export interface Resource<T> {
  status: ResourceStatus
  data: T | null
  error: unknown
  /** True while refetching with data already on screen. */
  isRefreshing: boolean
  reload: () => void
}

export function useResource<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[] = [],
): Resource<T> {
  const [status, setStatus] = useState<ResourceStatus>('idle')
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

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
    } catch (err) {
      if (!mounted.current || id !== requestId.current) return
      setError(err)
      setStatus('error')
    } finally {
      if (mounted.current && id === requestId.current) setIsRefreshing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    mounted.current = true
    void run()
    return () => {
      mounted.current = false
    }
  }, [run])

  return { status, data, error, isRefreshing, reload: () => void run() }
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
