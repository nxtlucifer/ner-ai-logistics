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
 *
 * WHY THE EVENT IS DERIVED HERE AND NOT PASSED IN
 *
 * `nextAnnouncement` takes a state CONDITION, not a command. The screen has
 * conditions that persist - off-route lasts as long as the truck is off the
 * road - and a scheduler that re-announced a persisting condition would nag.
 * Deriving the condition from what CHANGED belongs next to the engine, because
 * it is the same question as "is there anything new to say"; the screen passes
 * plain facts and cannot get the transition wrong.
 *
 * ONE SPEAKER. Every utterance goes through `say`, which stops the engine first
 * rather than queueing behind whatever is in flight: the newest sentence is the
 * only one that is still true. There is no other `Speech.speak` in the
 * navigation path.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import * as Speech from 'expo-speech'

import type { NavigationManeuver } from '../api/client'
import { speechLocale } from '../i18n/appLanguage'
import { useAppLanguage } from '../i18n/AppLanguageProvider'
import { useT } from '../i18n/tx'
import {
  emptySpokenState,
  nextAnnouncement,
  repeatInstruction,
  type GuidanceEvent,
  type VoiceMode,
} from './speech'

export interface SpokenGuidanceInput {
  next: { maneuver: NavigationManeuver; distanceM: number } | null
  /** The maneuver after the next, for the combined "then" instruction. */
  then?: NavigationManeuver | null
  routeId: string | null
  /** True whenever guidance is held for any reason. */
  held: boolean
  mode: VoiceMode
  /** Ground speed from the fix, m/s; null when the platform reported none. */
  speedMps?: number | null
  /**
   * The conditions the screen is in right now, as facts. The hook works out
   * which of them is NEW and therefore worth saying.
   */
  condition?: {
    rerouting?: boolean
    offRoute?: boolean
    /** No usable fix. Distinct from off-route: one is unknown, one is known-wrong. */
    gpsLost?: boolean
    arrived?: boolean
    stopReached?: boolean
  }
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
  /** Speak the current instruction because the driver asked. Ignores the mode. */
  repeat: () => void
  /** Whether there is a current instruction to repeat. */
  canRepeat: boolean
  /**
   * Say a fixed test line, so "voice is on" can be verified by EAR.
   *
   * `getAvailableVoicesAsync` returning a non-empty list is not the same fact
   * as sound coming out of the phone: the media volume can be at zero, the
   * output can be routed to a disconnected Bluetooth handsfree, and the engine
   * can accept an utterance and drop it. Nothing in the API reports any of
   * that, so the only honest check is one the driver performs.
   */
  test: () => void
}

/** The condition to report, highest priority first, or null when nothing is up. */
function conditionEvent(c: SpokenGuidanceInput['condition']): GuidanceEvent | null {
  if (!c) return null
  if (c.arrived) return 'ARRIVED'
  if (c.stopReached) return 'STOP_REACHED'
  if (c.gpsLost) return 'GPS_LOST'
  if (c.rerouting) return 'REROUTING'
  if (c.offRoute) return 'OFF_ROUTE'
  return null
}

export function useSpokenGuidance({
  next,
  then = null,
  routeId,
  held,
  mode,
  speedMps = null,
  condition,
}: SpokenGuidanceInput): SpokenGuidance {
  const { language } = useAppLanguage()
  const t = useT()
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

  // Everything audible goes through here. Stop, then speak: the sentence in
  // flight is by definition the older one.
  const say = useCallback(
    (text: string) => {
      void Speech.stop()
      Speech.speak(text, { language: speechLocale(language), rate: 0.95 })
    },
    [language],
  )

  // Stop talking the moment guidance must be silent. Separate from the
  // announce effect below so it fires on the transition itself, not only when
  // a new maneuver happens to arrive.
  //
  // A held or muted app still has to be able to announce that GPS was lost -
  // that is the state change the driver most needs - so this stops the ENGINE
  // and leaves the scheduler to decide what may follow.
  useEffect(() => {
    if (mode === 'MUTED' || held) void Speech.stop()
  }, [mode, held])

  // A new route version voids anything mid-sentence about the old one.
  useEffect(() => {
    void Speech.stop()
  }, [routeId])

  // Derived, not passed: see the header. Recomputed every render from plain
  // facts, so the screen cannot report a transition that did not happen.
  const event = conditionEvent(condition)

  useEffect(() => {
    if (available !== true) return
    const announcement = nextAnnouncement(
      { next, then, routeId, mode, held, event, speedMps, now: Date.now(), t },
      spoken.current,
    )
    if (announcement === null) return
    say(announcement.text)
    // `t` is a new closure every render and would retrigger this on every poll;
    // the language it closes over is in the dependency list instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, next, then, routeId, mode, held, event, speedMps, language, say])

  // Leaving the screen stops the voice. Without this the driver hears a turn
  // announced from a map they have closed.
  useEffect(() => () => void Speech.stop(), [])

  const repeatText = repeatInstruction({ next, then, held, t })
  const repeat = useCallback(() => {
    if (repeatText !== null) say(repeatText)
  }, [repeatText, say])

  const test = useCallback(() => {
    say(t('Voice guidance is on.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [say, language])

  return { available, repeat, canRepeat: repeatText !== null, test }
}
