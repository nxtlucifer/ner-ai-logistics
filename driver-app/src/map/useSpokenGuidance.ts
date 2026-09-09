/**
 * Saying the next turn out loud, and shutting up when it stops being true.
 *
 * The policy - what to say, when, and only once - is `speech.ts`, which has no
 * engine in it. This hook is the thin part: it owns the engine handle, so the
 * one thing it must get right is CANCELLING.
 *
 * WHY CANCELLING IS THE WHOLE JOB
 *
 * `Speech.speak` queues. A sentence that starts as the truck goes off-route, or
 * as the manager replans, finishes speaking regardless - and what the driver
 * hears is a confident instruction for a road they are no longer on, arriving
 * after the screen has already said guidance is paused. So every transition
 * into a state where guidance must be silent stops the engine, and unmounting
 * stops it too.
 */

import { useEffect, useRef, useState } from 'react'
import * as Speech from 'expo-speech'

import type { NavigationManeuver } from '../api/client'
import { emptySpokenState, nextAnnouncement } from './speech'

export interface SpokenGuidanceInput {
  next: { maneuver: NavigationManeuver; distanceM: number } | null
  routeId: string | null
  /** True whenever guidance is held for any reason. */
  held: boolean
  muted: boolean
}

export interface SpokenGuidance {
  /**
   * Whether this device can speak at all.
   *
   * Null while unknown - the check is asynchronous - so the control can show a
   * pending state instead of claiming voice is missing on a device that simply
   * has not answered yet.
   */
  available: boolean | null
}

export function useSpokenGuidance({
  next,
  routeId,
  held,
  muted,
}: SpokenGuidanceInput): SpokenGuidance {
  const [available, setAvailable] = useState<boolean | null>(null)
  const spoken = useRef(emptySpokenState())

  // Ask the platform once. A device with no voices installed - which is a real
  // state on a stripped Android build - reports an empty list rather than
  // throwing, and speaking into it is silence the driver cannot distinguish
  // from a bug.
  useEffect(() => {
    let cancelled = false
    Speech.getAvailableVoicesAsync()
      .then((voices) => {
        if (!cancelled) setAvailable(voices.length > 0)
      })
      .catch(() => {
        if (!cancelled) setAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Stop talking the moment guidance must be silent. Separate from the
  // announce effect below so it fires on the transition itself, not only when
  // a new maneuver happens to arrive.
  useEffect(() => {
    if (muted || held) void Speech.stop()
  }, [muted, held])

  // A new route version voids anything mid-sentence about the old one.
  useEffect(() => {
    void Speech.stop()
  }, [routeId])

  useEffect(() => {
    if (available !== true) return
    const announcement = nextAnnouncement(
      { next, routeId, muted, held },
      spoken.current,
    )
    if (announcement === null) return
    // Stop before speaking rather than queueing behind whatever is in flight:
    // the newest instruction is the only one that is still true.
    void Speech.stop()
    Speech.speak(announcement.text, { language: 'en-IN', rate: 0.95 })
  }, [available, next, routeId, muted, held])

  // Leaving the screen stops the voice. Without this the driver hears a turn
  // announced from a map they have closed.
  useEffect(() => () => void Speech.stop(), [])

  return { available }
}
