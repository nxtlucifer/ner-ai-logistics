/**
 * One hook, three screens.
 *
 * Assistant, Safety and Talk all ask the same local model through the same
 * endpoint, so they share the same status, the same cancellation and the same
 * unavailable state. Three copies of this would be three chances for one screen
 * to claim a model that another screen knows is gone.
 *
 * WHAT IT REFUSES TO DO
 *
 * It never generates on render, on focus, or on a poll. `ask` runs when the
 * driver presses something, and nothing else starts a decode - a local model on
 * the same laptop as the database is a resource the GPS path has to share.
 *
 * A CANCELLED ANSWER IS DISCARDED, NOT SHOWN LATE
 *
 * Every request carries an AbortController and a sequence number. The abort
 * stops the wait; the sequence number is what stops a slow first answer landing
 * on screen after the driver has already asked something else - which is the
 * bug that makes an assistant look like it is answering the wrong question.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { api, type AiAnswer, type AiStatus } from '../api/client'

export type AiMode = 'assistant' | 'safety' | 'translate'

export interface AskOptions {
  guidance?: string
  sourceLanguage?: string
  targetLanguage?: string
}

export type AiState =
  | { kind: 'IDLE' }
  | { kind: 'ASKING' }
  | { kind: 'ANSWER'; answer: AiAnswer; question: string }
  /** The model is installed but refused, or is busy. Retryable. */
  | { kind: 'ERROR'; message: string }

export interface LocalAi {
  /** Null until the first check answers. Not the same as unavailable. */
  status: AiStatus | null
  state: AiState
  ask: (mode: AiMode, question: string, options?: AskOptions) => void
  cancel: () => void
  reset: () => void
}

export function useLocalAi(): LocalAi {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [state, setState] = useState<AiState>({ kind: 'IDLE' })
  const inFlight = useRef<AbortController | null>(null)
  const issued = useRef(0)

  // Checked once when the screen mounts. Not polled: a status that flickers
  // would move the composer in and out of the layout while somebody types.
  useEffect(() => {
    const controller = new AbortController()
    api
      .aiStatus(controller.signal)
      .then(setStatus)
      .catch(() => {
        // The API itself is unreachable, which is a different thing from the
        // model being absent - but from this screen both mean "no generated
        // answers", and the bundled content is what the driver falls back to.
        setStatus({
          available: false,
          provider: null,
          model: null,
          detail: 'The app cannot reach the server, so AI answers are off.',
          languages: {},
        })
      })
    return () => controller.abort()
  }, [])

  const cancel = useCallback(() => {
    issued.current += 1
    inFlight.current?.abort()
    inFlight.current = null
    setState({ kind: 'IDLE' })
  }, [])

  const reset = useCallback(() => setState({ kind: 'IDLE' }), [])

  const ask = useCallback(
    (mode: AiMode, question: string, options: AskOptions = {}) => {
      const trimmed = question.trim()
      if (!trimmed) return

      const id = ++issued.current
      inFlight.current?.abort()
      const controller = new AbortController()
      inFlight.current = controller
      setState({ kind: 'ASKING' })

      api
        .aiAsk(
          {
            mode,
            question: trimmed,
            guidance: options.guidance,
            source_language: options.sourceLanguage,
            target_language: options.targetLanguage,
          },
          controller.signal,
        )
        .then((answer) => {
          if (id !== issued.current) return
          setState({ kind: 'ANSWER', answer, question: trimmed })
        })
        .catch((error: unknown) => {
          if (id !== issued.current) return
          if (error instanceof DOMException && error.name === 'AbortError') return
          setState({ kind: 'ERROR', message: messageFor(error) })
        })
    },
    [],
  )

  useEffect(() => () => inFlight.current?.abort(), [])

  return { status, state, ask, cancel, reset }
}

/**
 * A sentence for the driver, from whatever the server refused with.
 *
 * Each of these is a different action on the driver's part - wait, retry,
 * rephrase - so they are not collapsed into one "something went wrong".
 */
function messageFor(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : ''

  if (code === 'AI_BUSY') return 'Still answering the last question. Try again in a moment.'
  if (code === 'TRANSLATION_UNAVAILABLE')
    return 'The installed model cannot translate into that language. The saved phrases below still work.'
  if (code === 'AI_UNAVAILABLE')
    return 'The local model is not answering right now. The saved guidance below still works.'
  return 'That could not be answered. The saved guidance below still works.'
}
