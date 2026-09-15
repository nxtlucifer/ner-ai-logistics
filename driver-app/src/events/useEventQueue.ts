/**
 * React binding for the durable event queue.
 *
 * Deliberately thin, for the same reason `useLocationTracking` is: every
 * decision - the bound, the priority order, the backoff, what counts as
 * settled - lives in `eventQueue.ts`, which has no React and no Expo in it and
 * is therefore testable without a device. This file owns only what React owns:
 * creating the queue for a trip, hydrating anything a previous run left,
 * ticking the flush, and tearing it down.
 *
 * The flush tick is slower than the tracker's. Events are episodic - a handful
 * across a shift, not one every ten seconds - so a one-second tick would wake
 * the radio for nothing. The backoff inside the queue governs failures, and a
 * driver pressing SOS is not waiting on this timer: the press reaches durable
 * storage in the same tick as the button, which is the part that matters.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { ApiError, api } from '../api/client'
import {
  EventQueue,
  PersistentEventStore,
  type DeviceEventKind,
  type SyncSummary,
} from './eventQueue'

/** How often to consider sending. The queue decides whether there is anything. */
export const EVENT_FLUSH_TICK_MS = 5_000

const IDLE: SyncSummary = {
  queued: 0,
  accepted: 0,
  duplicatesIgnored: 0,
  rejected: 0,
  dropped: 0,
  droppedCritical: 0,
  lastSyncAt: null,
  lastError: null,
  persistence: 'memory',
}

export interface TripEvents {
  /** Record something that happened. Never throws, never awaits the network. */
  record: (
    kind: DeviceEventKind,
    options?: {
      location?: { lat: number; lon: number } | null
      accuracyM?: number | null
      payload?: Record<string, string | number | boolean | null> | null
    },
  ) => void
  /** True when an event of this kind is already waiting to be sent. */
  hasPending: (kind: DeviceEventKind) => boolean
  summary: SyncSummary
}

/**
 * Classify a send failure.
 *
 * The same rule the tracker uses, and it must stay the same rule: a 4xx other
 * than 429 will never succeed on retry - the trip ended, or this build sent
 * something the server does not understand - and holding those forever would
 * block every later event behind a request that cannot succeed.
 */
function classify(error: unknown): { retryable: boolean; message: string } {
  if (error instanceof ApiError) {
    return {
      retryable: error.status >= 500 || error.status === 429,
      message: error.message,
    }
  }
  return { retryable: true, message: 'Cannot reach the server. Retrying.' }
}

/** RFC 4122 v4, without a dependency for one call site. */
function randomId(): string {
  const cryptoRef = (globalThis as { crypto?: Crypto }).crypto
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function useEventQueue(tripId: string | null, enabled: boolean): TripEvents {
  const [summary, setSummary] = useState<SyncSummary>(IDLE)
  const queueRef = useRef<EventQueue | null>(null)

  useEffect(() => {
    if (!enabled || !tripId) {
      queueRef.current = null
      setSummary(IDLE)
      return
    }

    const queue = new EventQueue({
      send: async (events) => api.sendTripEvents(tripId, events),
      classify,
      now: () => Date.now(),
      newId: randomId,
      // Durable from the start. The whole point is an SOS pressed in a dead
      // zone surviving the OS killing the app before signal returns.
      store: new PersistentEventStore(AsyncStorage),
    })
    queueRef.current = queue

    const unsubscribe = queue.subscribe(setSummary)
    // Anything a previous run left unsent. Safe to replay: the server
    // deduplicates on device_event_id.
    void queue.hydrate()

    const timer = setInterval(() => void queue.flush(), EVENT_FLUSH_TICK_MS)
    return () => {
      clearInterval(timer)
      unsubscribe()
      // NOT reset: unmounting is not the trip ending. A screen change, a
      // background/foreground cycle or a re-render must not throw away an
      // unsent SOS. The queue is cleared when the trip itself goes away,
      // which is the `enabled`/`tripId` branch above starting a new one.
      queueRef.current = null
    }
  }, [tripId, enabled])

  const record = useCallback<TripEvents['record']>((kind, options) => {
    queueRef.current?.enqueue(kind, options)
  }, [])

  const hasPending = useCallback(
    (kind: DeviceEventKind) => queueRef.current?.hasPending(kind) ?? false,
    [],
  )

  return { record, hasPending, summary }
}
