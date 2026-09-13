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
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
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
import { TOUCH_TARGET } from '../theme'
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

export default function TranslateBox() {
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
    <View style={styles.container} testID="translate-box">
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t('Driver Translator')}</Text>
        <View
          style={[
            styles.modeBadge,
            isAiOnline ? styles.modeBadgeAi : styles.modeBadgeOffline,
          ]}
        >
          <Text
            style={[
              styles.modeBadgeText,
              isAiOnline ? styles.modeBadgeTextAi : styles.modeBadgeTextOffline,
            ]}
          >
            {t(isAiOnline ? 'ONLINE TRANSLATION' : 'LOCAL PHRASEBOOK')}
          </Text>
        </View>
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
          style={styles.swapButton}
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

      {/* Text Input Area */}
      <View style={styles.inputContainer}>
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v)
            setCopied(false)
          }}
          placeholder="Type or select a message to translate..."
          placeholderTextColor={COLORS.muted}
          maxLength={1500}
          multiline
          style={styles.input}
          accessibilityLabel="Text to translate"
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
            style={[styles.micButton, speech.listening && styles.micButtonOn, !speech.available && styles.buttonDisabled]}
            testID="translate-mic"
          >
            <Text style={styles.micButtonText}>
              {speech.listening ? '■ Stop' : `🎤 Speak ${SUPPORTED_LANGUAGES[source]?.nativeName ?? source}`}
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

      {/* Action Buttons Row */}
      <View style={styles.actionRow}>
        <Pressable
          onPress={handleTranslate}
          disabled={isAsking || text.trim().length === 0}
          accessibilityRole="button"
          style={[
            styles.primaryButton,
            (isAsking || text.trim().length === 0) && styles.buttonDisabled,
          ]}
          testID="translate-go"
        >
          {isAsking ? (
            <View style={styles.spinnerRow}>
              <ActivityIndicator size="small" color={COLORS.onAccent} />
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

      {/* Offline Status Warning */}
      {!isAiOnline && (
        <View style={styles.noticeBox} testID="translate-unavailable">
          <Text style={styles.noticeTitle}>
            {t('Online translation unavailable. Showing the local phrasebook.')}
          </Text>
          <Text style={styles.noticeSubtitle}>
            Verified emergency and highway phrases function completely offline without
            cellular connectivity.
          </Text>
        </View>
      )}

      {/* Error Message */}
      {ai.state.kind === 'ERROR' && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{ai.state.message}</Text>
          <Text style={styles.errorSubtext}>
            Showing available offline verified phrases below.
          </Text>
        </View>
      )}

      {/* Translation Result View */}
      {activeDisplay && (
        <View style={styles.resultCard} testID="translate-result">
          <View style={styles.resultHeader}>
            <Text style={styles.resultTargetTitle}>
              {t('SHOW THIS TO THE OTHER PERSON')}
            </Text>
            <View
              style={[
                styles.provenanceBadge,
                activeDisplay.sourceMode === 'ONLINE_AI'
                  ? styles.provenanceAi
                  : styles.provenanceOffline,
              ]}
            >
              <Text style={styles.provenanceText}>
                {activeDisplay.sourceMode === 'ONLINE_AI'
                  ? 'ONLINE TRANSLATION'
                  : 'LOCAL PHRASEBOOK'}
              </Text>
            </View>
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
              <Text style={styles.resultButtonText}>
                {t(isSpeaking ? 'Stop' : 'Speak')}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Offline Matches List (Shown when offline or as reference) */}
      {(!isAiOnline || offlineResult !== null) && offlineMatches.length > 0 && (
        <View style={styles.offlineListContainer}>
          <Text style={styles.offlineListHeading}>
            Verified Offline Phrases ({SUPPORTED_LANGUAGES[target]?.name})
          </Text>
          {offlineMatches.slice(0, 5).map((match) => (
            <View key={match.id} style={styles.offlineCard}>
              <View style={styles.offlineCardHeader}>
                <Text style={styles.offlineCategory}>{match.category}</Text>
                <Pressable
                  onPress={() => handleSpeak(match.translation, target)}
                  style={styles.quickSpeakButton}
                  accessibilityLabel="Speak phrase"
                >
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
  const { colors: COLORS } = useTheme()
  return (
    <View style={styles.pickerBlock}>
      <Text style={styles.pickerHeading}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pickerOptions}
      >
        {LANGUAGE_CODES.map((code) => {
          const selected = code === value
          const lang = SUPPORTED_LANGUAGES[code]
          return (
            <Pressable
              key={code}
              onPress={() => onChange(code)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
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
  container: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 16,
    gap: 14,
    backgroundColor: COLORS.card,
    marginBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  modeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  modeBadgeAi: {
    backgroundColor: COLORS.okBg,
  },
  modeBadgeOffline: {
    backgroundColor: COLORS.raised,
  },
  modeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  modeBadgeTextAi: {
    color: COLORS.aqua,
  },
  modeBadgeTextOffline: {
    color: COLORS.muted,
  },
  pickersContainer: {
    gap: 10,
  },
  pickerBlock: {
    gap: 6,
  },
  pickerHeading: {
    color: COLORS.faint,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  pickerOptions: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  langChip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.sunken,
  },
  langChipSelected: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  langChipText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  langChipTextSelected: {
    color: COLORS.onAccent,
    fontWeight: '700',
  },
  swapButton: {
    alignSelf: 'center',
    minHeight: 38,
    minWidth: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.raised,
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
    color: COLORS.faint,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  quickPhrasesScroll: {
    gap: 8,
    paddingVertical: 2,
  },
  quickPhraseChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.raised,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  quickPhraseChipSelected: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.routeBg,
  },
  quickPhraseText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '500',
  },
  quickPhraseTextSelected: {
    color: COLORS.routeOn,
    fontWeight: '700',
  },
  inputContainer: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.sunken,
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
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.raised,
    justifyContent: 'center',
  },
  micButtonOn: { backgroundColor: COLORS.badBg, borderColor: COLORS.bad },
  micButtonText: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  speechNote: { color: COLORS.faint, fontSize: 11, marginTop: 4 },
  charCountRow: {
    alignItems: 'flex-end',
  },
  charCountText: {
    color: COLORS.faint,
    fontSize: 11,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  primaryButton: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: COLORS.accent,
    flex: 1,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: COLORS.onAccent,
    fontSize: 15,
    fontWeight: '700',
  },
  spinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  secondaryButton: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'transparent',
  },
  secondaryButtonText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  noticeBox: {
    backgroundColor: COLORS.raised,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.warn,
    padding: 12,
    borderRadius: 6,
    gap: 4,
  },
  noticeTitle: {
    color: COLORS.warn,
    fontSize: 13,
    fontWeight: '700',
  },
  noticeSubtitle: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  errorBox: {
    backgroundColor: COLORS.badBg,
    padding: 10,
    borderRadius: 6,
    gap: 4,
  },
  errorText: {
    color: COLORS.bad,
    fontSize: 13,
    fontWeight: '600',
  },
  errorSubtext: {
    color: COLORS.bad,
    fontSize: 11,
  },
  resultCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.routeBg,
    padding: 14,
    gap: 10,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resultTargetTitle: {
    color: COLORS.routeOn,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  provenanceBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  provenanceAi: {
    backgroundColor: COLORS.okBg,
  },
  provenanceOffline: {
    backgroundColor: COLORS.raised,
  },
  provenanceText: {
    color: COLORS.text,
    fontSize: 10,
    fontWeight: '700',
  },
  langPair: {
    color: COLORS.faint,
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
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  resultActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  resultButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.raised,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultButtonSuccess: {
    backgroundColor: COLORS.okBg,
    borderColor: COLORS.ok,
  },
  resultButtonSpeaking: {
    backgroundColor: COLORS.badBg,
    borderColor: COLORS.bad,
  },
  resultButtonText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '700',
  },
  offlineListContainer: {
    marginTop: 8,
    gap: 8,
  },
  offlineListHeading: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  offlineCard: {
    backgroundColor: COLORS.sunken,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  offlineCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  offlineCategory: {
    color: COLORS.faint,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  quickSpeakButton: {
    padding: 4,
  },
  quickSpeakIcon: {
    fontSize: 16,
  },
  offlineEnglish: {
    color: COLORS.muted,
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
