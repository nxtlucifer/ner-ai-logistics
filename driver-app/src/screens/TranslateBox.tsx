/**
 * Multi-Language Driver Translator with Voice TTS & Offline Fallback.
 *
 * Implements:
 * - 12 Regional & National Languages: English, Hindi, Gujarati, Assamese, Bengali,
 *   Marathi, Punjabi, Odia, Tamil, Telugu, Malayalam, Kannada
 * - 8 Quick Driver Phrases (Loading gate, Delivery receipt, Fuel, Blocked road,
 *   Mechanic, Medical, Manager, Checkpoint)
 * - Actions: Translate, Swap, Copy (expo-clipboard), Speak (expo-speech), Clear
 * - Input validation: 1500 max characters, character counter, HTML sanitization
 * - High-contrast truck-friendly UI with large readable target text
 * - Dual Source Modes: ONLINE_AI (Gemini, via the backend) vs OFFLINE_PHRASEBOOK
 *   (reviewed local phrases). The badge names which one produced the text on
 *   screen - "ONLINE TRANSLATION" only when the provider actually generated it.
 * - Quick phrases render in the FROM language and translate from the verified
 *   table, so they work with the radio off and never wait on a model.
 * - Microphone input where the platform has a recogniser (see useSpeechInput).
 * - Phase B3: three sibling cards (translator, result, verified list) on the
 *   driver card geometry, every control 48 dp, glyph emoji replaced by icons,
 *   and the mode as a status pill (green only when online translation is on).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as Speech from 'expo-speech'

import { useLocalAi } from '../ai/useLocalAi'
import { useSpeechInput } from '../speech/useSpeechInput'
import {
  findOfflinePhrases,
  LANGUAGE_CODES,
  MatchedPhrase,
  QUICK_DRIVER_PHRASES,
  QuickPhrase,
  sanitizeInput,
  SUPPORTED_LANGUAGES,
  VERIFIED_QUICK_TRANSLATIONS,
} from '../phrasebook/offlineTranslator'
import { Icon } from '../components/icons'
import { StatusPill } from '../components/scenic'
import { useT } from '../i18n/tx'
import { makeStyles, useTheme } from '../theme-context'

export type SourceMode = 'ONLINE_AI' | 'OFFLINE_PHRASEBOOK'

export interface TranslationDisplay {
  original: string
  translated: string
  sourceLang: string
  targetLang: string
  sourceMode: SourceMode
  category?: string
}

/** `onTypingBottom`: while the text box has focus, the bottom of the
 *  Translate row (in this box's own coordinates), else null - so the page can
 *  keep Translate above the soft keyboard (B3D-R03). */
export default function TranslateBox({ onTypingBottom }: { onTypingBottom?: (y: number | null) => void } = {}) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  const ai = useLocalAi()
  const [text, setText] = useState('')
  const [source, setSource] = useState('en')
  const [target, setTarget] = useState('as')
  const [copied, setCopied] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [offlineResult, setOfflineResult] = useState<TranslationDisplay | null>(null)
  const speech = useSpeechInput()
  const [focused, setFocused] = useState(false)
  const [actionsBottom, setActionsBottom] = useState(0)
  useEffect(() => onTypingBottom?.(focused ? actionsBottom : null), [focused, actionsBottom, onTypingBottom])

  const isAiOnline = Boolean(ai.status?.available)
  const isAsking = ai.state.kind === 'ASKING'

  // Stop speaking on unmount or new translation
  const handleStopSpeaking = useCallback(() => {
    try {
      Speech.stop()
    } catch {
      // safe fallback
    }
    setIsSpeaking(false)
  }, [])

  const handleSpeak = useCallback((spokenText: string, langCode: string) => {
    try {
      Speech.stop()
      const langInfo = SUPPORTED_LANGUAGES[langCode]
      const voiceLocale = langInfo?.voiceLocale ?? langCode
      setIsSpeaking(true)
      Speech.speak(spokenText, {
        language: voiceLocale,
        rate: 0.9,
        pitch: 1.0,
        onDone: () => setIsSpeaking(false),
        onError: () => setIsSpeaking(false),
      })
    } catch {
      setIsSpeaking(false)
    }
  }, [])

  const handleClear = useCallback(() => {
    handleStopSpeaking()
    setText('')
    setCopied(false)
    setOfflineResult(null)
    ai.reset()
  }, [ai, handleStopSpeaking])

  const handleSwap = useCallback(() => {
    handleStopSpeaking()
    const nextSource = target
    const nextTarget = source
    setSource(nextSource)
    setTarget(nextTarget)

    const activeTranslated =
      offlineResult?.translated ??
      (ai.state.kind === 'ANSWER' ? ai.state.answer.answer : null)

    if (activeTranslated) {
      setText(activeTranslated)
    }
    setOfflineResult(null)
    ai.reset()
  }, [source, target, offlineResult, ai, handleStopSpeaking])

  const handleSelectQuickPhrase = useCallback(
    (phrase: QuickPhrase) => {
      handleStopSpeaking()
      setCopied(false)
      // The chip the driver tapped was in the FROM language; the box gets
      // that text, and the answer comes from the reviewed table - not from a
      // model - so it is the same with or without a connection.
      const transMap = VERIFIED_QUICK_TRANSLATIONS[phrase]
      const fromText = source === 'en' ? phrase : transMap?.[source] ?? phrase
      const toText = target === 'en' ? phrase : transMap?.[target]
      setText(fromText)
      ai.reset()
      if (!toText) {
        // No reviewed text in the target language: say so rather than
        // handing over Hindi as if it were Odia.
        setOfflineResult({
          original: fromText,
          translated: `[No reviewed phrase in ${SUPPORTED_LANGUAGES[target]?.name ?? target}. Use Translate for a generated one.]`,
          sourceLang: source,
          targetLang: target,
          sourceMode: 'OFFLINE_PHRASEBOOK',
          category: 'Quick Driver Phrase',
        })
        return
      }
      setOfflineResult({
        original: fromText,
        translated: toText,
        sourceLang: source,
        targetLang: target,
        sourceMode: 'OFFLINE_PHRASEBOOK',
        category: 'Quick Driver Phrase',
      })
    },
    [source, target, ai, handleStopSpeaking],
  )

  // A finished recognition lands in the box for the driver to check before
  // it is translated.
  useEffect(() => {
    if (speech.transcript) {
      setText(speech.transcript)
      setCopied(false)
    }
  }, [speech.transcript])

  const handleTranslate = useCallback(() => {
    handleStopSpeaking()
    const sanitized = sanitizeInput(text, 1500)
    if (!sanitized) return

    setCopied(false)

    // Check if input matches any verified quick phrase or offline phrase
    if (!isAiOnline) {
      const matched = findOfflinePhrases(sanitized, target)
      if (matched.length > 0) {
        const top = matched[0]
        setOfflineResult({
          original: sanitized,
          translated: top.translation,
          sourceLang: source,
          targetLang: target,
          sourceMode: 'OFFLINE_PHRASEBOOK',
          category: top.category,
        })
        return
      }

      // If no phrasebook match and AI is offline
      setOfflineResult({
        original: sanitized,
        translated: `[Offline Phrasebook: No exact match for "${sanitized}". Showing matching phrase options below.]`,
        sourceLang: source,
        targetLang: target,
        sourceMode: 'OFFLINE_PHRASEBOOK',
      })
      return
    }

    // AI is online
    setOfflineResult(null)
    ai.ask('translate', sanitized, {
      sourceLanguage: source,
      targetLanguage: target,
    })
  }, [text, isAiOnline, target, source, ai, handleStopSpeaking])

  // Active translation resolution
  let activeDisplay: TranslationDisplay | null = null
  if (offlineResult) {
    activeDisplay = offlineResult
  } else if (ai.state.kind === 'ANSWER') {
    activeDisplay = {
      original: ai.state.question,
      translated: ai.state.answer.answer,
      sourceLang: source,
      targetLang: target,
      sourceMode: ai.state.answer.generated ? 'ONLINE_AI' : 'OFFLINE_PHRASEBOOK',
    }
  }

  // Matching offline phrases for suggestions / offline view
  const offlineMatches: MatchedPhrase[] = findOfflinePhrases(text, target)

  return (
    // Three sibling cards - the translator, the result, the verified list -
    // never a card boxed inside another (Phase B3).
    <View style={styles.stack} testID="translate-box">
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.title} accessibilityRole="header">{t('Driver Translator')}</Text>
          <StatusPill
            text={t(isAiOnline ? 'ONLINE TRANSLATION' : 'LOCAL PHRASEBOOK')}
            tone={isAiOnline ? 'action' : 'neutral'}
          />
        </View>

        {/* Language Pickers */}
        <View style={styles.pickersContainer}>
          <LanguagePicker
            label={t('From')}
            value={source}
            onChange={(val) => {
              handleStopSpeaking()
              setSource(val)
            }}
          />

          <Pressable
            onPress={handleSwap}
            accessibilityRole="button"
            accessibilityLabel="Swap languages"
            style={({ pressed }) => [styles.swapButton, pressed && styles.pressed]}
          >
            <Text style={styles.swapIcon}>⇄</Text>
          </Pressable>

          <LanguagePicker
            label={t('To')}
            value={target}
            onChange={(val) => {
              handleStopSpeaking()
              setTarget(val)
            }}
          />
        </View>

        {/* Quick Driver Phrases */}
        <View style={styles.quickPhrasesContainer}>
          <Text style={styles.sectionLabel}>{t('Quick Driver Phrases')}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickPhrasesScroll}
          >
            {QUICK_DRIVER_PHRASES.map((phrase) => {
              // The key IS the English phrase; other languages come from the table.
              const label = source === 'en' ? phrase : VERIFIED_QUICK_TRANSLATIONS[phrase]?.[source] ?? phrase
              return (
                <Pressable
                  key={phrase}
                  onPress={() => handleSelectQuickPhrase(phrase)}
                  style={({ pressed }) => [
                    styles.quickPhraseChip,
                    text === label && styles.quickPhraseChipSelected,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={phrase}
                >
                  <Text
                    style={[
                      styles.quickPhraseText,
                      text === label && styles.quickPhraseTextSelected,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>

        {/* Text Input Area: a sunken well, the one box you type into. */}
        <View style={styles.inputContainer}>
          <TextInput
            value={text}
            onChangeText={(v) => {
              setText(v)
              setCopied(false)
            }}
            placeholder="Type or select a message to translate..."
            placeholderTextColor={COLORS.textMuted}
            maxLength={1500}
            multiline
            style={styles.input}
            accessibilityLabel="Text to translate"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          <View style={styles.charCountRow}>
            <Pressable
              onPress={() => (speech.listening ? speech.stop() : speech.start(source))}
              disabled={!speech.available}
              accessibilityRole="button"
              accessibilityLabel={
                !speech.available
                  ? 'Speech input is not available on this device'
                  : speech.listening
                    ? 'Stop listening'
                    : `Speak in ${SUPPORTED_LANGUAGES[source]?.name ?? source}`
              }
              accessibilityState={{ disabled: !speech.available, selected: speech.listening }}
              aria-disabled={!speech.available}
              style={[styles.micButton, speech.listening && styles.micButtonOn, !speech.available && styles.buttonDisabled]}
              testID="translate-mic"
            >
              <Icon name={speech.listening ? 'square' : 'mic'} size={16} color={speech.listening ? COLORS.danger : COLORS.text} />
              <Text style={styles.micButtonText}>
                {speech.listening ? t('Stop') : `${t('Speak')} ${SUPPORTED_LANGUAGES[source]?.nativeName ?? source}`}
              </Text>
            </Pressable>
            <Text style={styles.charCountText}>{text.length}/1500</Text>
          </View>
          <Text style={styles.speechNote}>
            {speech.error
              ? speech.error
              : speech.listening
                ? 'Listening…'
                : speech.available
                  ? 'Device speech · needs a connection · typing always works'
                  : 'Speech input not available on this device · typing works'}
          </Text>
        </View>

        {/* Action Buttons Row. The card is this box's first child at y 0,
            so the row's own layout is its place in the box. */}
        <View
          style={styles.actionRow}
          onLayout={(e) => setActionsBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
        >
          <Pressable
            onPress={handleTranslate}
            disabled={isAsking || text.trim().length === 0}
            accessibilityRole="button"
            aria-disabled={isAsking || text.trim().length === 0}
            style={[
              styles.primaryButton,
              (isAsking || text.trim().length === 0) && styles.primaryDisabled,
            ]}
            testID="translate-go"
          >
            {isAsking ? (
              <View style={styles.spinnerRow}>
                <ActivityIndicator size="small" color={COLORS.onPrimary} />
                <Text style={styles.primaryButtonText}>{t('Translating…')}</Text>
              </View>
            ) : (
              <Text style={styles.primaryButtonText}>{t('Translate')}</Text>
            )}
          </Pressable>

          {text.length > 0 && (
            <Pressable
              onPress={handleClear}
              accessibilityRole="button"
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>{t('Clear')}</Text>
            </Pressable>
          )}

          {isAsking && (
            <Pressable
              onPress={ai.cancel}
              accessibilityRole="button"
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>{t('Cancel')}</Text>
            </Pressable>
          )}
        </View>
        {/* The disabled Translate says why, next to it. */}
        {!isAsking && text.trim().length === 0 ? (
          <Text style={styles.reasonLine}>{t('Type or pick a phrase first.')}</Text>
        ) : null}

        {/* Offline status: a line with its icon inside this card, not a box. */}
        {!isAiOnline && (
          <View style={styles.inlineNote} testID="translate-unavailable">
            <Icon name="wifi-off" size={16} color={COLORS.warning} />
            <View style={styles.inlineNoteText}>
              <Text style={styles.noticeTitle}>
                {t('Online translation unavailable. Showing the local phrasebook.')}
              </Text>
              <Text style={styles.noticeSubtitle}>
                Verified emergency and highway phrases function completely offline without
                cellular connectivity.
              </Text>
            </View>
          </View>
        )}

        {/* Error Message */}
        {ai.state.kind === 'ERROR' && (
          <View style={styles.inlineNote} accessibilityRole="alert">
            <Icon name="alert-circle" size={16} color={COLORS.danger} />
            <View style={styles.inlineNoteText}>
              <Text style={styles.errorText}>{ai.state.message}</Text>
              <Text style={styles.errorSubtext}>
                Showing available offline verified phrases below.
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Translation Result: its own card, the one a stranger reads. */}
      {activeDisplay && (
        <View style={styles.resultCard} testID="translate-result">
          <View style={styles.resultHeader}>
            <Text style={styles.resultTargetTitle}>
              {t('SHOW THIS TO THE OTHER PERSON')}
            </Text>
            <StatusPill
              text={activeDisplay.sourceMode === 'ONLINE_AI' ? 'ONLINE TRANSLATION' : 'LOCAL PHRASEBOOK'}
              tone={activeDisplay.sourceMode === 'ONLINE_AI' ? 'action' : 'neutral'}
            />
          </View>

          <Text style={styles.langPair}>
            {SUPPORTED_LANGUAGES[activeDisplay.sourceLang]?.name ?? activeDisplay.sourceLang}{' '}
            →{' '}
            {SUPPORTED_LANGUAGES[activeDisplay.targetLang]?.nativeName ??
              SUPPORTED_LANGUAGES[activeDisplay.targetLang]?.name ??
              activeDisplay.targetLang}
          </Text>

          {/* High-Contrast Large Result for Roadside Visibility */}
          <Text style={styles.resultLargeText} selectable>
            {activeDisplay.translated}
          </Text>

          <Text style={styles.originalSubtext}>
            Original ({SUPPORTED_LANGUAGES[activeDisplay.sourceLang]?.name}):{' '}
            {activeDisplay.original}
          </Text>

          {/* Result Interaction Buttons: Copy, Speak */}
          <View style={styles.resultActionRow}>
            <Pressable
              onPress={() => {
                void Clipboard.setStringAsync(activeDisplay.translated).then(() =>
                  setCopied(true),
                )
              }}
              accessibilityRole="button"
              style={[styles.resultButton, copied && styles.resultButtonSuccess]}
            >
              <Icon name={copied ? 'check' : 'copy'} size={16} color={COLORS.text} />
              <Text style={styles.resultButtonText}>
                {copied ? 'Copied' : 'Copy'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                if (isSpeaking) {
                  handleStopSpeaking()
                } else {
                  handleSpeak(activeDisplay.translated, activeDisplay.targetLang)
                }
              }}
              accessibilityRole="button"
              style={[styles.resultButton, isSpeaking && styles.resultButtonSpeaking]}
            >
              <Icon name={isSpeaking ? 'square' : 'volume-2'} size={16} color={COLORS.text} />
              <Text style={styles.resultButtonText}>
                {t(isSpeaking ? 'Stop' : 'Speak')}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Offline Matches List (Shown when offline or as reference): one card,
          rows divided by hairlines. */}
      {(!isAiOnline || offlineResult !== null) && offlineMatches.length > 0 && (
        <View style={styles.container}>
          <Text style={styles.offlineListHeading}>
            Verified Offline Phrases ({SUPPORTED_LANGUAGES[target]?.name})
          </Text>
          {offlineMatches.slice(0, 5).map((match) => (
            <View key={match.id} style={styles.offlineRow}>
              <View style={styles.offlineCardHeader}>
                <Text style={styles.offlineCategory}>{match.category}</Text>
                <Pressable
                  onPress={() => handleSpeak(match.translation, target)}
                  style={styles.quickSpeakButton}
                  accessibilityRole="button"
                  accessibilityLabel="Speak phrase"
                >
                  <Icon name="volume-2" size={16} color={COLORS.text} />
                  <Text style={styles.quickSpeakIcon}>{t('Speak')}</Text>
                </Pressable>
              </View>
              <Text style={styles.offlineEnglish}>{match.english}</Text>
              <Text style={styles.offlineTranslation}>{match.translation}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function LanguagePicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (code: string) => void
}) {
  const styles = useStyles()
  // The chosen language scrolled into view: Assamese, the default "To", sat
  // off the right edge, so the target language could not be seen (B3D-R13).
  // Only when it is out of view, so a tap never moves the row under a finger.
  const row = useRef<ScrollView>(null)
  const seen = useRef({ x: 0, width: 0 })
  const chips = useRef<Record<string, { x: number; width: number }>>({})
  const reveal = useCallback(() => {
    const chip = chips.current[value]
    const { x, width } = seen.current
    if (!chip || !width) return
    if (chip.x < x || chip.x + chip.width > x + width) row.current?.scrollTo({ x: Math.max(0, chip.x - 16), animated: false })
  }, [value])
  useEffect(reveal, [reveal])
  return (
    <View style={styles.pickerBlock}>
      <Text style={styles.pickerHeading}>{label}</Text>
      <ScrollView
        ref={row}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pickerOptions}
        accessibilityRole="radiogroup"
        onLayout={(e) => {
          seen.current.width = e.nativeEvent.layout.width
          reveal()
        }}
        onScroll={(e) => {
          seen.current.x = e.nativeEvent.contentOffset.x
        }}
        scrollEventThrottle={32}
      >
        {LANGUAGE_CODES.map((code) => {
          const selected = code === value
          const lang = SUPPORTED_LANGUAGES[code]
          return (
            <Pressable
              key={code}
              onLayout={(e) => {
                chips.current[code] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width }
                if (selected) reveal()
              }}
              onPress={() => onChange(code)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              aria-checked={selected}
              accessibilityLabel={`${label} ${lang.name}`}
              style={[styles.langChip, selected && styles.langChipSelected]}
            >
              <Text
                style={[
                  styles.langChipText,
                  selected && styles.langChipTextSelected,
                ]}
              >
                {lang.nativeName} ({lang.name})
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

const useStyles = makeStyles((COLORS) => ({
  stack: { gap: 10, marginBottom: 20 },
  // The driver card geometry: radius 16, hairline, surface.
  container: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    padding: 14,
    gap: 14,
    backgroundColor: COLORS.surface,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '800',
    flexShrink: 1,
  },
  pickersContainer: {
    gap: 10,
  },
  pickerBlock: {
    gap: 6,
  },
  pickerHeading: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  pickerOptions: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  // 48 dp targets with a 3:1 outline; the selected language fills.
  langChip: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.surface,
  },
  langChipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  langChipText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  langChipTextSelected: {
    color: COLORS.onPrimary,
    fontWeight: '700',
  },
  swapButton: {
    alignSelf: 'center',
    minHeight: 48,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.surface,
  },
  swapIcon: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: 'bold',
  },
  quickPhrasesContainer: {
    gap: 6,
  },
  sectionLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  quickPhrasesScroll: {
    gap: 8,
    paddingVertical: 2,
  },
  quickPhraseChip: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  quickPhraseChipSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  quickPhraseText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '500',
  },
  quickPhraseTextSelected: {
    color: COLORS.onPrimary,
    fontWeight: '700',
  },
  inputContainer: {
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceSunken,
    padding: 10,
    gap: 6,
  },
  input: {
    minHeight: 72,
    color: COLORS.text,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  micButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.surface,
  },
  micButtonOn: { backgroundColor: COLORS.dangerSoft, borderColor: COLORS.danger },
  micButtonText: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  speechNote: { color: COLORS.textFaint, fontSize: 11, marginTop: 4 },
  charCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  charCountText: {
    color: COLORS.textFaint,
    fontSize: 11,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  primaryButton: {
    minHeight: 52,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    flex: 1,
  },
  // Audit s16.3 #12: the same CTA at 50%, the reason under it.
  primaryDisabled: {
    opacity: 0.5,
    backgroundColor: COLORS.primaryDisabled,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: COLORS.onPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  spinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  secondaryButton: {
    minHeight: 52,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: 'transparent',
  },
  secondaryButtonText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  reasonLine: { color: COLORS.textMuted, fontSize: 12, marginTop: -6 },
  inlineNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  inlineNoteText: { flex: 1, minWidth: 0, gap: 2 },
  noticeTitle: {
    color: COLORS.warning,
    fontSize: 13,
    fontWeight: '700',
  },
  noticeSubtitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  errorSubtext: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
  // Neutral on purpose: a translation is none of action, route, caution or
  // emergency. A strong outline and the largest type on the screen carry it.
  resultCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.surface,
    padding: 14,
    gap: 10,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  resultTargetTitle: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    flexShrink: 1,
  },
  langPair: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
  resultLargeText: {
    color: COLORS.text,
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '800',
    paddingVertical: 4,
  },
  originalSubtext: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  resultActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  resultButton: {
    minHeight: 48,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultButtonSuccess: {
    backgroundColor: COLORS.successSoft,
    borderColor: COLORS.success,
  },
  resultButtonSpeaking: {
    backgroundColor: COLORS.dangerSoft,
    borderColor: COLORS.danger,
  },
  resultButtonText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '700',
  },
  offlineListHeading: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  offlineRow: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 10,
    gap: 4,
  },
  offlineCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  offlineCategory: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  quickSpeakButton: {
    minHeight: 48,
    minWidth: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  quickSpeakIcon: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '700',
  },
  offlineEnglish: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
  offlineTranslation: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.75,
  },
}))
