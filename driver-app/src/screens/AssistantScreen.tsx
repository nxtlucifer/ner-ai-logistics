/**
 * Driver Assistant - local first, online second, never in charge.
 *
 * ROUTER (one question, one answer bubble, always)
 *
 *   text -> classifyIntent (keyword table, five languages, no model)
 *     known intent  -> src/assistant/assistant.ts, a pure function of
 *                      application state. Route, stop, risk, weather, break,
 *                      truck, emergency and HEALTH answers are deterministic
 *                      and identical offline.
 *     UNKNOWN + online -> POST /api/ai/ask. The server tries Gemini, then
 *                      OpenRouter, then its own offline library; the answer
 *                      is labelled with the provider and rendered as prose.
 *                      It is given the same facts this screen holds and may
 *                      only EXPLAIN them - it cannot change a route, mark a
 *                      road safe or send anything.
 *     UNKNOWN + offline, or the server could not answer -> the local
 *                      "I can help with…" answer, in the app language.
 *
 * ONE LANGUAGE. Every headline, label and guidance line the local engine
 * produces is an English key rendered through `useT()`, the quick questions
 * come from the typed catalogue, speech input uses the app language, and the
 * online request carries it so the model answers in it.
 *
 * IT CANNOT ACT. `AllowedAction` is a closed set of navigation targets, a
 * break record on this phone, and the dialler on 112 (the driver still
 * presses call). There is no reroute, no trip close, no dispatch send.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { api } from '../api/client'
import {
  QUESTIONS,
  answer,
  contextForModel,
  type AllowedAction,
  type Answer,
  type AssistantContext,
  type Intent,
} from '../assistant/assistant'
import { classifyIntent } from '../assistant/intents'
import { Icon } from '../components/icons'
import { useAppLanguage } from '../i18n/AppLanguageProvider'
import { matchLanguage } from '../i18n/language'
import { isKnownReasonCode, translateReasonCode } from '../i18n/reasonCodes'
import { useT } from '../i18n/tx'
import { useRouteRisk } from '../hooks/useRouteRisk'
import { OfflinePackageStore, type StoredPackage } from '../offline/packageStore'
import { BREAK_REASON_TEXT, assessBreak } from '../safety/breaks'
import { factorTitle } from '../safety/riskCards'
import { readLastBreak, recordBreak } from '../safety/breakStore'
import { useSpeechInput } from '../speech/useSpeechInput'
import { TOUCH_TARGET } from '../theme'
import { makeStyles, useTheme } from '../theme-context'
import { useTrip } from '../trip/TripProvider'
import PhrasebookScreen from './PhrasebookScreen'

/** One exchange. The answer is FROZEN at the moment it was asked - re-deriving
 *  it on every render would silently rewrite what the driver already read. */
interface Turn {
  id: number
  question: string
  /** Local, deterministic. Null while an online answer is pending or shown. */
  answer: Answer | null
  /** Online prose, labelled with who wrote it. */
  online?: { text: string; provider: string; model: string | null } | null
  pending?: boolean
}

/** Where each hand-off goes. `CONTACT_DISPATCH` is deliberately absent: this
 *  build has no dispatch channel, and a chip that opened nothing would be
 *  discovered at exactly the wrong moment. It renders as a line of text. */
const ACTION_LABELS: Partial<Record<AllowedAction, string>> = {
  OPEN_TRIP: 'Open my trip',
  OPEN_SAFETY_GUIDE: 'Open Safety',
  OPEN_PHRASEBOOK: 'Open the translator',
  RECORD_BREAK: 'I stopped for a break',
  CALL_EMERGENCY: 'Call 112',
}

const PROVIDER_NAMES: Record<string, string> = { GOOGLE_GEMINI: 'Gemini', OPENROUTER: 'OpenRouter' }

/**
 * No SHOUTING_SNAKE_CASE ever reaches the screen.
 *
 * One place rather than per call site: the answer objects carry enum values in
 * three different fields (`facts[].value`, `unavailable[]`, `reasonCodes[]`),
 * and a driver reading "DUE_SOON" is reading the database, not an answer.
 * Anything that is not enum-shaped is returned untouched, so a formatted value
 * like "3h 20m" or a place name passes straight through.
 */
function readable(value: string): string {
  // A token with a DIGIT in it is never an enum here - it is a registration or
  // a trip code. `AS01AB1234` matched an earlier version of this test and came
  // out as "As01ab1234", which is a worse bug than the one being fixed.
  const enumish =
    /^[A-Z][A-Z_]*$/.test(value) || /^[a-z]+(_[a-z0-9]+)+$/.test(value)
  if (!enumish) return value
  const words = value.replace(/_/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A named safety factor keeps its curated name; anything else is humanised. */
function label(key: string): string {
  return factorTitle(key) ?? readable(key)
}

/** Catalogue first, then the module that owns the code, then humanised. */
function explain(code: string, lang: Parameters<typeof translateReasonCode>[1]): string {
  if (isKnownReasonCode(code)) return translateReasonCode(code, lang)
  return BREAK_REASON_TEXT[code] ?? readable(code)
}

function Freshness({ answer: a }: { answer: Answer }) {
  const styles = useStyles()
  const t = useT()
  if (!a.freshness) return null
  const { ageMinutes, cached, stale } = a.freshness
  const age = ageMinutes === 0 ? t('just now') : `${ageMinutes} ${t('min ago')}`
  return (
    <Text style={[styles.freshness, stale && styles.staleText]}>
      {t(cached ? 'Stored copy' : 'Last updated')} {age}
      {cached ? ` — ${t('may be out of date')}` : ''}
      {stale ? ` — ${t('STALE')}` : ''}
    </Text>
  )
}

export default function AssistantScreen({
  onBack,
  onOpenTrip,
  onOpenSafety,
}: {
  onBack?: () => void
  onOpenTrip?: () => void
  onOpenSafety?: () => void
}) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  // The APP's language, not the device's: a driver who picked Assamese in
  // the header meant it here too. Reason codes exist in en/hi/as; gu/bn fall
  // back to English there, by `matchLanguage`, rather than to a guess.
  const { language: appLanguage, t: tk } = useAppLanguage()
  const t = useT()
  const lang = matchLanguage(appLanguage)
  const [draft, setDraft] = useState('')
  const speech = useSpeechInput()
  const { trip, loadedAt, phase, tracking, isStale } = useTrip()
  // The same live read the Navigation card shows, so "is my route risky"
  // here and the card there cannot disagree. Falls back to the package.
  const live = useRouteRisk(trip?.id ?? null, trip?.id ?? null)

  const [view, setView] = useState<'chat' | 'phrasebook'>('chat')
  const [turns, setTurns] = useState<Turn[]>([])
  const [lastBreakAt, setLastBreakAt] = useState<string | null>(null)
  const [offlinePackage, setOfflinePackage] = useState<StoredPackage | null>(null)
  const nextId = useRef(1)
  const scroller = useRef<ScrollView | null>(null)
  const inFlight = useRef<AbortController | null>(null)

  useEffect(() => {
    let alive = true
    void readLastBreak().then((v) => alive && setLastBreakAt(v))
    void new OfflinePackageStore(AsyncStorage)
      .read()
      .then((p) => alive && setOfflinePackage(p))
      .catch(() => {
        // No cached package is a state, not a failure. The answers that depend
        // on one already say "not available" rather than guessing.
      })
    return () => {
      alive = false
      inFlight.current?.abort()
    }
  }, [])

  /**
   * Everything the assistant is allowed to know, at the instant of the tap.
   *
   * `lastBreak` is passed rather than read from state so that recording a
   * break and asking about it in the same handler cannot answer from the value
   * React has not flushed yet.
   */
  const contextAt = useCallback(
    (lastBreak: string | null): AssistantContext => {
      const now = Date.now()
      return {
        trip,
        tripLoadedAt: loadedAt,
        tracking,
        offlinePackage,
        liveRisk: live.state === 'READY' && live.risk ? { risk: live.risk, assessedAt: live.risk.assessed_at } : null,
        breakAdvice: assessBreak({
          startedAt: trip?.started_at ?? null,
          lastBreakAt: lastBreak,
          now,
        }),
        online: phase === 'ready' && !isStale && tracking?.uploadState !== 'failing',
        now,
      }
    },
    [trip, loadedAt, tracking, offlinePackage, phase, isStale, live.state, live.risk],
  )

  const ask = useCallback(
    (question: string, intent: Intent, lastBreak: string | null) => {
      setTurns((previous) => [
        ...previous,
        { id: nextId.current++, question, answer: answer(intent, contextAt(lastBreak)) },
      ])
    },
    [contextAt],
  )

  /** A free-form question the local engine cannot place: the online model, then the local fallback. */
  const askOnline = useCallback(
    (question: string, ctx: AssistantContext) => {
      const id = nextId.current++
      setTurns((previous) => [...previous, { id, question, answer: null, pending: true }])
      inFlight.current?.abort()
      const controller = new AbortController()
      inFlight.current = controller
      const settle = (patch: Partial<Turn>) =>
        setTurns((previous) => previous.map((turn) => (turn.id === id ? { ...turn, pending: false, ...patch } : turn)))
      api
        .aiAsk({ mode: 'assistant', question, language: appLanguage, context: contextForModel(ctx) }, controller.signal)
        .then((res) => {
          const provider = res.provider ?? 'OFFLINE_ASSISTANT'
          if (res.generated && provider !== 'OFFLINE_ASSISTANT' && res.answer.trim()) {
            settle({ online: { text: res.answer.trim(), provider, model: res.model } })
          } else {
            // The server fell back to its English library: the local answer
            // says the same thing in the driver's language.
            settle({ answer: answer('UNKNOWN', ctx) })
          }
        })
        .catch(() => settle({ answer: answer('UNKNOWN', ctx) }))
    },
    [appLanguage],
  )

  /** Typed or spoken text: classify locally; only the unplaceable goes online. */
  const submit = useCallback(
    (text: string) => {
      const question = text.trim()
      if (!question) return
      setDraft('')
      speech.reset()
      const intent = classifyIntent(question)
      const ctx = contextAt(lastBreakAt)
      if (intent === 'UNKNOWN' && ctx.online) askOnline(question, ctx)
      else ask(question, intent, lastBreakAt)
    },
    [ask, askOnline, contextAt, lastBreakAt, speech],
  )

  // A finished recognition lands in the box for the driver to read before it
  // is sent - a misheard "stop" must not become a question by itself.
  useEffect(() => {
    if (speech.transcript) setDraft(speech.transcript)
  }, [speech.transcript])

  // Newest exchange into view. Driven by the CONTENT SIZE rather than by the
  // turn count: an effect on `turns.length` runs before the new bubble has
  // been measured, so it scrolled to the old end and the reply stayed below
  // the fold - which reads as a tap that did nothing.
  const toEnd = useCallback(() => scroller.current?.scrollToEnd?.({ animated: false }), [])

  const runAction = (action: AllowedAction) => {
    if (action === 'OPEN_TRIP') return onOpenTrip?.()
    if (action === 'OPEN_SAFETY_GUIDE') return onOpenSafety?.()
    if (action === 'OPEN_PHRASEBOOK') return setView('phrasebook')
    // The dialler, not a call: the driver's thumb is still required.
    if (action === 'CALL_EMERGENCY') return void Linking.openURL('tel:112').catch(() => {})
    if (action === 'RECORD_BREAK') {
      void recordBreak(new Date()).then(async (stored) => {
        // Never claim it was logged when it was not - the driver would rely on
        // a counter that had not moved.
        if (!stored) {
          setTurns((previous) => [
            ...previous,
            {
              id: nextId.current++,
              question: t('I stopped for a break'),
              answer: {
                intent: 'BREAK',
                headline: 'Could not save that on this phone',
                facts: [],
                reasonCodes: [],
                freshness: null,
                allowedActions: [],
                unavailable: ['BREAK_STORAGE'],
              },
            },
          ])
          return
        }
        const updated = await readLastBreak()
        setLastBreakAt(updated)
        ask(t('I stopped for a break'), 'BREAK', updated)
      })
    }
  }

  if (view === 'phrasebook') {
    return (
      <View style={styles.flex}>
        <Pressable
          onPress={() => setView('chat')}
          accessibilityRole="button"
          accessibilityLabel="Back to the assistant"
          style={({ pressed }) => [styles.backRow, pressed && styles.pressed]}
        >
          <Icon name="chevron-left" size={20} color={COLORS.muted} />
          <Text style={styles.backLabel}>{t('Assistant')}</Text>
        </Pressable>
        <PhrasebookScreen />
      </View>
    )
  }

  const canSend = draft.trim().length > 0

  return (
    <View style={styles.flex}>
      <ScrollView
        ref={scroller}
        onContentSizeChange={toEnd}
        contentContainerStyle={styles.content}
      >
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back to More"
            style={({ pressed }) => [styles.backRow, pressed && styles.pressed]}
          >
            <Icon name="chevron-left" size={20} color={COLORS.muted} />
            <Text style={styles.backLabel}>{t('More')}</Text>
          </Pressable>
        ) : null}

        <Text style={styles.title}>{t('Assistant')}</Text>

        {/* The opening line is a claim about how this screen works, and it is
            a true one: trip, route, risk, break and health answers are computed
            on this phone; only a question none of those cover goes online. */}
        <View style={styles.bubbleThem}>
          <Text style={styles.opener}>
            {t('I answer from what this phone already knows — your trip, route, risk, breaks and how you feel. No connection needed.')}
          </Text>
          <Text style={styles.openerNote}>
            {t('I cannot change your route or close a stop. Those are your manager\'s to decide and yours to do on the Trip screen.')}
          </Text>
        </View>

        {turns.map((turn) => (
          <View key={turn.id}>
            <View style={styles.bubbleMeRow}>
              <View style={styles.bubbleMe}>
                <Text style={styles.bubbleMeText}>{turn.question}</Text>
              </View>
            </View>

            {turn.pending ? (
              <View style={styles.bubbleThem}>
                <Text style={styles.openerNote}>{t('Thinking…')}</Text>
              </View>
            ) : turn.online ? (
              <View style={styles.bubbleThem}>
                <Text style={styles.prose}>{turn.online.text}</Text>
                <Text style={styles.unavailable}>
                  {t('Written by an online model')} · {PROVIDER_NAMES[turn.online.provider] ?? turn.online.provider} · {t('check anything important')}
                </Text>
              </View>
            ) : turn.answer ? (
              <View style={[styles.bubbleThem, turn.answer.intent === 'HEALTH_URGENT' && styles.bubbleUrgent]}>
                <Text style={[styles.headline, turn.answer.intent === 'HEALTH_URGENT' && styles.headlineUrgent]}>{t(turn.answer.headline)}</Text>
                <Freshness answer={turn.answer} />

                {turn.answer.facts.map((fact, i) => (
                  <View key={`${fact.code}-${i}`} style={styles.fact}>
                    <Text style={styles.factLabel}>{t(fact.label)}</Text>
                    <Text style={styles.factValue}>{t(readable(fact.value))}</Text>
                  </View>
                ))}

                {turn.answer.guidance?.length ? (
                  <View style={styles.reasons}>
                    {turn.answer.guidance.map((line) => (
                      <Text key={line} style={styles.reason}>• {t(line)}</Text>
                    ))}
                  </View>
                ) : null}

                {turn.answer.reasonCodes.length > 0 ? (
                  <View style={styles.reasons}>
                    {turn.answer.reasonCodes.map((code) => (
                      <Text key={code} style={styles.reason}>
                        • {explain(code, lang)}
                      </Text>
                    ))}
                  </View>
                ) : null}

                {turn.answer.unavailable.length > 0 ? (
                  // Named gaps, every time. An answer that quietly omitted its
                  // missing inputs would read as a confident one.
                  <Text style={styles.unavailable}>
                    {t('Not included')}: {turn.answer.unavailable.map((u) => t(label(u))).join(', ')}
                  </Text>
                ) : null}

                {turn.answer.allowedActions.includes('CONTACT_DISPATCH') ? (
                  <Text style={styles.unavailable}>
                    {t('Tell dispatch on the number your operator gave you. This app has no dispatch line.')}
                  </Text>
                ) : null}

                {turn.answer.allowedActions.some((a) => ACTION_LABELS[a]) ? (
                  <View style={styles.actions}>
                    {turn.answer.allowedActions
                      .filter((a) => ACTION_LABELS[a])
                      .map((action) => (
                        <Pressable
                          key={action}
                          onPress={() => runAction(action)}
                          accessibilityRole="button"
                          style={({ pressed }) => [styles.action, action === 'CALL_EMERGENCY' && styles.actionUrgent, pressed && styles.pressed]}
                        >
                          <Text style={[styles.actionLabel, action === 'CALL_EMERGENCY' && styles.actionLabelUrgent]}>{t(ACTION_LABELS[action] as string)}</Text>
                        </Pressable>
                      ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>

      {/* The composer: quick questions, then a box, a microphone and send. */}
      <View style={styles.composer}>
        <Text style={styles.composerLabel}>{tk('ask_label')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {QUESTIONS.map((q) => (
            <Pressable
              key={q.id}
              onPress={() => ask(tk(q.labelKey), q.intent, lastBreakAt)}
              accessibilityRole="button"
              testID={`ask-${q.id}`}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
            >
              <Text style={styles.chipLabel}>{tk(q.labelKey)}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.inputRow}>
          <Pressable
            onPress={() => (speech.listening ? speech.stop() : speech.start(appLanguage))}
            disabled={!speech.available}
            accessibilityRole="button"
            accessibilityLabel={
              !speech.available
                ? 'Speech input is not available on this device'
                : speech.listening
                  ? 'Stop listening'
                  : 'Speak your question'
            }
            accessibilityState={{ disabled: !speech.available, selected: speech.listening }}
            style={[styles.micBtn, speech.listening && styles.micBtnOn, !speech.available && styles.micBtnOff]}
            testID="assistant-mic"
          >
            <Icon name={speech.listening ? 'square' : 'mic'} size={20} color={!speech.available ? COLORS.faint : speech.listening ? COLORS.bad : COLORS.text} />
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => submit(draft)}
            placeholder={speech.listening ? tk('ask_listening') : tk('ask_placeholder')}
            placeholderTextColor={COLORS.faint}
            returnKeyType="send"
            blurOnSubmit={false}
            editable={!speech.listening}
            style={styles.input}
            accessibilityLabel="Ask about this trip"
            testID="assistant-input"
          />
          <Pressable
            onPress={() => submit(draft)}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
            style={[styles.sendBtn, !canSend && styles.sendBtnOff]}
            testID="assistant-send"
          >
            <Icon name="send" size={18} color={canSend ? COLORS.onAccent : COLORS.faint} />
          </Pressable>
        </View>
        {speech.error ? <Text style={styles.speechNote}>{speech.error}</Text> : null}
        {speech.confidence !== null && speech.transcript ? (
          <Text style={styles.speechNote}>{t('Heard with')} {Math.round(speech.confidence * 100)}% {t('confidence (engine figure)')}</Text>
        ) : speech.available ? (
          <Text style={styles.speechNote}>{t(speech.listening ? 'Listening…' : 'Device speech · needs a connection · typing always works')}</Text>
        ) : (
          <Text style={styles.speechNote}>{t('Speech input not available on this device · typing works')}</Text>
        )}
      </View>
    </View>
  )
}

const useStyles = makeStyles((COLORS) => ({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  content: {
    padding: 16,
    paddingBottom: 24,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },

  backRow: { minHeight: TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 12 },
  backLabel: { color: COLORS.muted, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.75 },

  title: {
    color: COLORS.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 14,
  },

  /** Theirs: a card on the left, full width, because an answer is a document
   *  with facts in it - not a speech bubble that has to stay narrow. */
  bubbleThem: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    padding: 16,
    marginBottom: 12,
  },
  bubbleUrgent: { borderColor: COLORS.badBorder, backgroundColor: COLORS.badBg },
  opener: { color: COLORS.text, fontSize: 15, lineHeight: 22 },
  openerNote: { color: COLORS.muted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  prose: { color: COLORS.text, fontSize: 15, lineHeight: 22 },

  /** Mine: right-aligned, tinted, and short. */
  bubbleMeRow: { alignItems: 'flex-end', marginBottom: 8 },
  bubbleMe: {
    maxWidth: '85%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.raised,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleMeText: { color: COLORS.text, fontSize: 15, fontWeight: '600' },

  headline: { color: COLORS.text, fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
  headlineUrgent: { color: COLORS.bad },
  freshness: { color: COLORS.faint, fontSize: 12, marginTop: 4 },
  staleText: { color: COLORS.warn },

  fact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 10,
  },
  factLabel: { color: COLORS.muted, fontSize: 14, flexShrink: 1 },
  factValue: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 1,
  },

  reasons: {
    marginTop: 12,
    gap: 4,
  },
  reason: { color: COLORS.text, fontSize: 14, lineHeight: 20 },

  unavailable: { color: COLORS.faint, fontSize: 12, lineHeight: 18, marginTop: 12 },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  action: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.card,
  },
  actionUrgent: { borderColor: COLORS.bad, backgroundColor: COLORS.bad },
  actionLabel: { color: COLORS.accent, fontSize: 14, fontWeight: '700' },
  actionLabelUrgent: { color: '#FFFFFF' },

  composer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.card,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 10,
  },
  composerLabel: {
    color: COLORS.faint,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  chips: { flexDirection: 'row', gap: 8, paddingBottom: 2 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: COLORS.text,
    fontSize: 15,
    backgroundColor: COLORS.bg,
  },
  micBtn: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnOn: { backgroundColor: COLORS.badBg, borderColor: COLORS.bad },
  micBtnOff: { opacity: 0.45 },
  sendBtn: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { backgroundColor: COLORS.raised, borderWidth: 1, borderColor: COLORS.border },
  speechNote: { color: COLORS.faint, fontSize: 11 },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.bg,
  },
  chipLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
}))
