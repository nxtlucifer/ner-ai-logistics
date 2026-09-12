/**
 * Driver Assistant - a chat, and every word in it was written by a person.
 *
 * THIS IS NOT A GENERATIVE ASSISTANT AND MUST NEVER BE DESCRIBED AS ONE
 *
 * Every reply on this screen comes from `src/assistant/assistant.ts`, which
 * imports no network client, no storage and no model. It is a pure function of
 * a context object the caller has already fetched: tap a question, get the
 * same answer every time from the same inputs. There is no model in the loop,
 * so there is nothing here to hallucinate a road being open.
 *
 * The chat shape is for the driver, not the technology. A transcript is how a
 * person expects to ask a second question after reading the first answer, and
 * it keeps the previous answer on screen instead of replacing it - which is
 * what the old panel did, so a driver comparing "next stop" against "my route"
 * had to keep re-tapping.
 *
 * IT ANSWERS OFFLINE, AND IT SAYS SO WHEN THE ANSWER IS OLD
 *
 * `Answer.freshness` travels with every reply and is rendered above the facts.
 * An answer built from a stored snapshot is labelled as one. The assistant is
 * allowed to be out of date; it is not allowed to be out of date quietly.
 *
 * IT CANNOT ACT
 *
 * `AllowedAction` is a closed set of NAVIGATION targets plus recording a break
 * on this phone. There is no reroute, no trip close, no dispatch send - a
 * route change is a manager decision, and this screen explains that rather
 * than offering it.
 *
 * THE COMPOSER: CHIPS, A TEXT BOX, AND A MICROPHONE
 *
 * Typed or spoken text goes through `assistant/intents.classifyIntent` - a
 * keyword table, not a model - and lands on the same answers the chips do.
 * Text that matches nothing is told what the assistant can do rather than
 * guessed at. The microphone is the browser's own recogniser where one exists
 * and is visibly disabled where none does; typing always works.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

import {
  QUESTIONS,
  answer,
  type AllowedAction,
  type Answer,
  type AssistantContext,
  type Intent,
} from '../assistant/assistant'
import { classifyIntent } from '../assistant/intents'
import { useAppLanguage } from '../i18n/AppLanguageProvider'
import { matchLanguage } from '../i18n/language'
import { useSpeechInput } from '../speech/useSpeechInput'
import { useRouteRisk } from '../hooks/useRouteRisk'
import { isKnownReasonCode, translateReasonCode } from '../i18n/reasonCodes'
import { OfflinePackageStore, type StoredPackage } from '../offline/packageStore'
import { BREAK_REASON_TEXT, assessBreak } from '../safety/breaks'
import { factorTitle } from '../safety/riskCards'
import { readLastBreak, recordBreak } from '../safety/breakStore'
import { useTrip } from '../trip/TripProvider'
import { TOUCH_TARGET } from '../theme'
import { makeStyles, useTheme } from '../theme-context'
import PhrasebookScreen from './PhrasebookScreen'

/** One exchange. The answer is FROZEN at the moment it was asked - re-deriving
 *  it on every render would silently rewrite what the driver already read. */
interface Turn {
  id: number
  question: string
  answer: Answer
}

/** Where each hand-off goes. `CONTACT_DISPATCH` is deliberately absent: this
 *  build has no dispatch channel, and a chip that opened nothing would be
 *  discovered at exactly the wrong moment. It renders as a line of text. */
const ACTION_LABELS: Partial<Record<AllowedAction, string>> = {
  OPEN_TRIP: 'Open my trip',
  OPEN_SAFETY_GUIDE: 'Open Safety',
  OPEN_PHRASEBOOK: 'Open the translator',
  RECORD_BREAK: 'I stopped for a break',
}

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
  if (!a.freshness) return null
  const { ageMinutes, cached, stale } = a.freshness
  const age = ageMinutes === 0 ? 'just now' : `${ageMinutes} min ago`
  return (
    <Text style={[styles.freshness, stale && styles.staleText]}>
      {cached ? 'Stored copy' : 'Last updated'} {age}
      {cached ? ' — may be out of date' : ''}
      {stale ? ' — STALE' : ''}
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
  const { language: appLanguage, t } = useAppLanguage()
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

  /** Typed or spoken text: classify locally, answer from the same context. */
  const submit = useCallback(
    (text: string) => {
      const question = text.trim()
      if (!question) return
      setDraft('')
      speech.reset()
      ask(question, classifyIntent(question), lastBreakAt)
    },
    [ask, lastBreakAt, speech],
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
  // Not animated: a smooth scroll started against the pre-layout height and
  // landed a few pixels down instead of at the new reply. It is also the right
  // behaviour in a cab - the answer is there, rather than sliding into place.
  const toEnd = useCallback(() => scroller.current?.scrollToEnd?.({ animated: false }), [])

  const runAction = (action: AllowedAction) => {
    if (action === 'OPEN_TRIP') return onOpenTrip?.()
    if (action === 'OPEN_SAFETY_GUIDE') return onOpenSafety?.()
    if (action === 'OPEN_PHRASEBOOK') return setView('phrasebook')
    if (action === 'RECORD_BREAK') {
      void recordBreak(new Date()).then(async (stored) => {
        // Never claim it was logged when it was not - the driver would rely on
        // a counter that had not moved.
        if (!stored) {
          setTurns((previous) => [
            ...previous,
            {
              id: nextId.current++,
              question: 'I stopped for a break',
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
        ask('I stopped for a break', 'BREAK', updated)
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
          <Text style={styles.backLabel}>‹ Assistant</Text>
        </Pressable>
        <PhrasebookScreen />
      </View>
    )
  }

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
            <Text style={styles.backLabel}>‹ More</Text>
          </Pressable>
        ) : null}

        <Text style={styles.title}>Assistant</Text>

        {/* The opening line is a claim about how this screen works, and it is
            a true one: no network call is made to answer anything below. */}
        <View style={styles.bubbleThem}>
          <Text style={styles.opener}>
            I answer from what this phone already knows — your trip, your stored
            route package and your break timer. No connection needed.
          </Text>
          <Text style={styles.openerNote}>
            I cannot change your route or close a stop. Those are your manager's
            to decide and yours to do on the Trip screen.
          </Text>
        </View>

        {turns.map((turn) => (
          <View key={turn.id}>
            <View style={styles.bubbleMeRow}>
              <View style={styles.bubbleMe}>
                <Text style={styles.bubbleMeText}>{turn.question}</Text>
              </View>
            </View>

            <View style={styles.bubbleThem}>
              <Text style={styles.headline}>{turn.answer.headline}</Text>
              <Freshness answer={turn.answer} />

              {turn.answer.facts.map((fact, i) => (
                <View key={`${fact.code}-${i}`} style={styles.fact}>
                  <Text style={styles.factLabel}>{fact.label}</Text>
                  <Text style={styles.factValue}>{readable(fact.value)}</Text>
                </View>
              ))}

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
                  Not included: {turn.answer.unavailable.map(label).join(', ')}
                </Text>
              ) : null}

              {turn.answer.allowedActions.includes('CONTACT_DISPATCH') ? (
                <Text style={styles.unavailable}>
                  Tell dispatch on the number your operator gave you. This app has
                  no dispatch line.
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
                        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                      >
                        <Text style={styles.actionLabel}>{ACTION_LABELS[action]}</Text>
                      </Pressable>
                    ))}
                </View>
              ) : null}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* The composer: quick questions, then a box and a microphone. */}
      <View style={styles.composer}>
        <Text style={styles.composerLabel}>{t('ask_label')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {QUESTIONS.map((q) => (
            <Pressable
              key={q.id}
              onPress={() => ask(t(q.labelKey), q.intent, lastBreakAt)}
              accessibilityRole="button"
              testID={`ask-${q.id}`}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
            >
              <Text style={styles.chipLabel}>{t(q.labelKey)}</Text>
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
            <Text style={[styles.micGlyph, !speech.available && styles.micGlyphOff]}>{speech.listening ? '■' : '🎤'}</Text>
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => submit(draft)}
            placeholder={speech.listening ? t('ask_listening') : t('ask_placeholder')}
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
            disabled={!draft.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !draft.trim() }}
            style={[styles.sendBtn, !draft.trim() && styles.sendBtnOff]}
            testID="assistant-send"
          >
            <Text style={[styles.sendGlyph, !draft.trim() && styles.sendGlyphOff]}>➤</Text>
          </Pressable>
        </View>
        {speech.error ? <Text style={styles.speechNote}>{speech.error}</Text> : null}
        {speech.confidence !== null && speech.transcript ? (
          <Text style={styles.speechNote}>Heard with {Math.round(speech.confidence * 100)}% confidence (engine figure)</Text>
        ) : speech.available ? (
          <Text style={styles.speechNote}>{speech.listening ? 'Listening…' : 'Device speech · needs a connection · typing always works'}</Text>
        ) : (
          <Text style={styles.speechNote}>Speech input not available on this device · typing works</Text>
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

  backRow: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 16 },
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
  opener: { color: COLORS.text, fontSize: 15, lineHeight: 22 },
  openerNote: { color: COLORS.muted, fontSize: 13, lineHeight: 19, marginTop: 8 },

  /** Mine: right-aligned, tinted, and short. It only ever holds one of the
   *  nine labels, so it never needs to wrap far. */
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
  actionLabel: { color: COLORS.accent, fontSize: 14, fontWeight: '700' },

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
  micGlyph: { fontSize: 20, color: COLORS.text },
  micGlyphOff: { color: COLORS.faint },
  sendBtn: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { backgroundColor: COLORS.raised, borderWidth: 1, borderColor: COLORS.border },
  sendGlyph: { fontSize: 18, color: COLORS.onAccent, fontWeight: '800' },
  sendGlyphOff: { color: COLORS.faint },
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
