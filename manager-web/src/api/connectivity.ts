/**
 * One answer to "can this browser reach the backend right now?".
 *
 * Every request reports here: a NetworkError (refused, DNS, timeout) flips the
 * console OFFLINE, any completed response flips it LIVE. While offline a
 * bounded /health probe runs so the console comes back on its own - no page
 * reload, no request storm (one small GET every PROBE_MS).
 *
 * Pages keep rendering their last successful data throughout; the shell shows
 * ONE banner with the last sync time. Nothing here is auth: an OFFLINE console
 * is a read-only view of what it already had.
 */

import { useSyncExternalStore } from 'react'

export interface Connectivity {
  online: boolean
  /** Device clock at the last completed backend response, null before any. */
  lastOkAt: number | null
}

const PROBE_MS = 5_000

let state: Connectivity = { online: true, lastOkAt: null }
const listeners = new Set<() => void>()
let probe: ReturnType<typeof setInterval> | undefined
let probeUrl = ''

function emit(next: Connectivity) {
  state = next
  listeners.forEach((l) => l())
}

export function markOnline() {
  if (probe) {
    clearInterval(probe)
    probe = undefined
  }
  emit({ online: true, lastOkAt: Date.now() })
}

export function markOffline(healthUrl: string) {
  probeUrl = healthUrl
  if (state.online) emit({ ...state, online: false })
  if (!probe && typeof setInterval === 'function') {
    probe = setInterval(() => {
      fetch(probeUrl, { cache: 'no-store' })
        .then((r) => {
          if (r.ok) markOnline()
        })
        .catch(() => {})
    }, PROBE_MS)
  }
}

export function getConnectivity(): Connectivity {
  return state
}

export function subscribeConnectivity(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useConnectivity(): Connectivity {
  return useSyncExternalStore(subscribeConnectivity, getConnectivity, getConnectivity)
}

// --- Last-known cache -------------------------------------------------------
//
// localStorage, on purpose: synchronous, so a page hydrates in the same render
// it mounts in - no "Loading…" flash before the cached list appears. Sizes here
// are list pages of at most a hundred rows and one fleet snapshot.
// ponytail: localStorage (~5 MB), move to IndexedDB if a page ever caches tracks.

const PREFIX = 'ner:cache:'

export interface Cached<T> {
  at: number
  data: T
}

export function readCache<T>(key: string): Cached<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Cached<T>
    return typeof parsed?.at === 'number' ? parsed : null
  } catch {
    return null
  }
}

export function writeCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), data }))
  } catch {
    // Quota or private mode: the live data is still on screen.
  }
}

/** Another account must not inherit this one's last-known fleet. */
export function clearCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    // nothing to clear
  }
}

export function ageLabel(at: number | null, now = Date.now()): string {
  if (at === null) return 'never'
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}
