/**
 * Roadside place lookup, driven by explicit actions only.
 *
 * NOT A POLLER, AND NOT ON THE RENDER PATH. Nothing here runs on a timer, on
 * a map render, or on the ten-second trip poll. A search happens when the
 * driver picks a category, switches mode, or presses "Search this area" - and
 * at no other time. That is the acceptance rule "category changes and trip
 * polling do not trigger external requests", and it holds twice over: the
 * backend serves a local snapshot, so even the request it does make leaves
 * nothing to an external service.
 *
 * LATE RESULTS ARE DISCARDED. Every search carries a sequence number and only
 * the newest one may write state. Tapping Hotels then Emergency must not end
 * with hotel pins under an Emergency chip because the first response came back
 * second.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { api, type Place, type PlacesQuery, type PlacesResponse } from '../api/client'

export interface PlacesView {
  /** Null until a search has been run. Distinct from a search that found none. */
  result: PlacesResponse | null
  isSearching: boolean
  /** Set only when the request itself failed, never for an empty result. */
  error: unknown
  selected: Place | null
  search: (query: PlacesQuery) => Promise<void>
  select: (place: Place | null) => void
  /** Drop everything - used on sign-out and when the trip changes. */
  clear: () => void
}

export function usePlaces(scope = ''): PlacesView {
  const [result, setResult] = useState<PlacesResponse | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [selected, setSelected] = useState<Place | null>(null)
  const [resultScope, setResultScope] = useState(scope)

  // Refs, not state: bumping this must not re-render, and a stale closure
  // reading an old value is exactly the bug it exists to prevent.
  const seq = useRef(0)

  const search = useCallback(async (query: PlacesQuery) => {
    const mine = ++seq.current
    setResultScope(scope)
    setIsSearching(true)
    setError(null)
    setResult(null)
    // The previous selection belongs to the previous search. Keeping it would
    // leave a details panel open on a place no longer in the list.
    setSelected(null)
    try {
      const response = await api.places(query)
      if (seq.current !== mine) return // superseded
      setResult(response)
    } catch (caught) {
      if (seq.current !== mine) return
      // A failed REQUEST, distinct from a successful search that found
      // nothing. The screen renders these differently on purpose.
      setError(caught)
      setResult(null)
    } finally {
      if (seq.current === mine) setIsSearching(false)
    }
  }, [scope])

  const clear = useCallback(() => {
    seq.current += 1 // invalidate anything in flight
    setResult(null)
    setSelected(null)
    setError(null)
    setIsSearching(false)
  }, [])

  useEffect(() => {
    clear()
    // Invalidate a pending result on trip/route change and on unmount.
    return () => { seq.current += 1 }
  }, [scope, clear])

  const matches = resultScope === scope
  return {
    result: matches ? result : null,
    isSearching: matches && isSearching,
    error: matches ? error : null,
    selected: matches ? selected : null,
    search, select: setSelected, clear,
  }
}
