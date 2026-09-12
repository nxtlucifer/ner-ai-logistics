/**
 * Speech-to-text, where the platform has it.
 *
 * WEB: the browser's own SpeechRecognition (Chrome, Edge, Safari). Android
 * resolves `useSpeechInput.native.ts` instead - the platform recogniser
 * dialog. Chrome's recogniser sends audio to Google, so it needs a connection
 * - `available` says whether an engine exists, not whether it will work in a
 * valley, and every failure comes back as `error` rather than as silence.
 *
 * NO INVENTED ACCURACY. `confidence` is the engine's own figure when it gives
 * one and null when it does not. Nothing here rounds a missing number into
 * "95%".
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'

import { SUPPORTED_LANGUAGES } from '../phrasebook/offlineTranslator'

export interface SpeechInput {
  /** An engine exists on this platform. */
  available: boolean
  listening: boolean
  transcript: string
  /** 0..1 from the engine, or null when the engine reports none. */
  confidence: number | null
  error: string | null
  start: (lang: string) => void
  stop: () => void
  reset: () => void
}

type Recogniser = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }>> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

function engine(): (new () => Recogniser) | null {
  if (Platform.OS !== 'web') return null
  const w = globalThis as { SpeechRecognition?: new () => Recogniser; webkitSpeechRecognition?: new () => Recogniser }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': 'Microphone permission was refused. Typing still works.',
  'service-not-allowed': 'Speech recognition is blocked on this device. Typing still works.',
  network: 'Speech recognition needs a connection and could not reach it. Typing still works.',
  'no-speech': 'No speech was heard. Try again closer to the microphone.',
  'audio-capture': 'No microphone was found.',
  aborted: 'Listening was cancelled.',
}

export function useSpeechInput(): SpeechInput {
  const Engine = engine()
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [confidence, setConfidence] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = useRef<Recogniser | null>(null)

  const stop = useCallback(() => {
    current.current?.stop()
  }, [])

  const reset = useCallback(() => {
    setTranscript('')
    setConfidence(null)
    setError(null)
  }, [])

  const start = useCallback(
    (lang: string) => {
      if (!Engine) {
        setError('Speech input is not available on this device. Typing still works.')
        return
      }
      current.current?.abort()
      const r = new Engine()
      r.lang = SUPPORTED_LANGUAGES[lang]?.voiceLocale ?? lang
      r.interimResults = false
      r.maxAlternatives = 1
      r.onresult = (e) => {
        const best = e.results[0]?.[0]
        if (!best) return
        setTranscript(best.transcript)
        setConfidence(typeof best.confidence === 'number' && best.confidence > 0 ? best.confidence : null)
      }
      r.onerror = (e) => setError(ERROR_TEXT[e.error] ?? `Speech recognition failed (${e.error}). Typing still works.`)
      r.onend = () => {
        setListening(false)
        if (current.current === r) current.current = null
      }
      current.current = r
      setError(null)
      setTranscript('')
      setConfidence(null)
      setListening(true)
      try {
        r.start()
      } catch {
        setListening(false)
        setError('Could not start listening. Typing still works.')
      }
    },
    [Engine],
  )

  useEffect(() => () => current.current?.abort(), [])

  return { available: Engine !== null, listening, transcript, confidence, error, start, stop, reset }
}
