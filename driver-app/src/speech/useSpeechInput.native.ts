/**
 * Speech-to-text on Android: the platform's own recogniser dialog.
 *
 * `RecognizerIntent.ACTION_RECOGNIZE_SPEECH` is what every Android phone with
 * the Google app already ships; it records, recognises (on-device or online,
 * the phone decides), shows its own "Listening…" sheet and hands back the
 * text. No speech library, no RECORD_AUDIO permission in this app - the
 * recogniser app holds it - and it runs inside Expo Go. `expo-intent-launcher`
 * is the one line that starts the activity and reads its result.
 *
 * HONEST ABOUT WHAT IT IS NOT. Stop/cancel is the dialog's own; `stop()` here
 * is a no-op while the dialog is up. A language the phone's recogniser does
 * not have comes back as NO_MATCH or an error, never as silence - the message
 * says so and typing still works. iOS has no such intent: `available` is false.
 */

import { useCallback, useState } from 'react'
import { Platform } from 'react-native'
import * as IntentLauncher from 'expo-intent-launcher'

import { SUPPORTED_LANGUAGES } from '../phrasebook/offlineTranslator'
import type { SpeechInput } from './useSpeechInput'

/** RecognizerIntent result codes (android.speech.RecognizerIntent). */
const RESULT_TEXT: Record<number, string> = {
  0: 'Listening was cancelled.',
  1: 'No speech was recognised in that language. Try again, or type.',
  2: 'The speech recogniser reported an error. Typing still works.',
  3: 'Speech recognition needs a connection and could not reach it. Typing still works.',
  4: 'The microphone could not be used. Typing still works.',
  5: 'The speech service failed. Typing still works.',
}

export function useSpeechInput(): SpeechInput {
  const available = Platform.OS === 'android'
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [confidence, setConfidence] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => { setTranscript(''); setConfidence(null); setError(null) }, [])
  const stop = useCallback(() => {}, [])

  const start = useCallback((lang: string) => {
    if (!available) { setError('Speech input is not available on this device. Typing still works.'); return }
    reset()
    setListening(true)
    void IntentLauncher.startActivityAsync('android.speech.action.RECOGNIZE_SPEECH', {
      extra: {
        'android.speech.extra.LANGUAGE_MODEL': 'free_form',
        'android.speech.extra.LANGUAGE': SUPPORTED_LANGUAGES[lang]?.voiceLocale ?? lang,
        'android.speech.extra.PROMPT': `Speak in ${SUPPORTED_LANGUAGES[lang]?.name ?? lang}`,
        'android.speech.extra.MAX_RESULTS': 1,
      },
    })
      .then((r) => {
        const extra = (r.extra ?? {}) as { 'android.speech.extra.RESULTS'?: string[]; 'android.speech.extra.CONFIDENCE_SCORES'?: number[] }
        const text = extra['android.speech.extra.RESULTS']?.[0]
        if (r.resultCode === -1 && text) {
          setTranscript(text)
          const c = extra['android.speech.extra.CONFIDENCE_SCORES']?.[0]
          setConfidence(typeof c === 'number' && c > 0 ? c : null)
        } else setError(RESULT_TEXT[r.resultCode] ?? `Speech recognition failed (${r.resultCode}). Typing still works.`)
      })
      .catch(() => setError('No speech recogniser app is installed on this phone. Typing still works.'))
      .finally(() => setListening(false))
  }, [available, reset])

  return { available, listening, transcript, confidence, error, start, stop, reset }
}
