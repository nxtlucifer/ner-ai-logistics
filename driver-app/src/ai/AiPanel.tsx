/**
 * The chat composer, shared by the three AI surfaces.
 *
 * ONE COMPONENT, BECAUSE THE HONESTY RULES ARE THE SAME EVERYWHERE
 *
 * Generated text is labelled, the model that wrote it is named, and the time
 * the underlying facts were read is shown SEPARATELY from the answer - a fresh
 * sentence about a two-hour-old position is still a two-hour-old position. If
 * each screen implemented its own panel, that would be three places for one of
 * those to go missing.
 *
 * The bundled content each screen already had stays exactly where it is,
 * underneath. This never replaces it: when the model is absent the panel says
 * so and points down at the guide, which is the thing that works with no
 * server, no internet and no model.
 */

import { useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { TOUCH_TARGET } from '../theme'
import { useT } from '../i18n/tx'
import { makeStyles, useTheme } from '../theme-context'
import type { AiMode, AskOptions, LocalAi } from './useLocalAi'

export interface AiPanelProps {
  ai: LocalAi
  mode: AiMode
  /** One-line description of what this panel answers. */
  lead: string
  placeholder: string
  /** Tapped to fill the composer. Empty for screens that do not want them. */
  suggestions?: readonly string[]
  askOptions?: AskOptions
  /**
   * What the driver falls back to, AND where it is - "quick answers below",
   * "guidance above". The direction is part of the name because the panel sits
   * above the fallback on one screen and below it on another, and a template
   * that supplied "below" itself produced "the guidance above below still
   * works" on the Safety screen.
   */
  fallbackName: string
}

export default function AiPanel({
  ai,
  mode,
  lead,
  placeholder,
  suggestions = [],
  askOptions,
  fallbackName: _fallbackName,
}: AiPanelProps) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  const [draft, setDraft] = useState('')
  const { status, state } = ai

  // Three states, not two: null is "still checking", and rendering that as
  // unavailable would tell a driver the model is missing a moment before it
  // appears.
  if (status === null) {
    return (
      <View style={styles.panel}>
        <Text style={styles.status}>{t('Checking for the online model…')}</Text>
      </View>
    )
  }

  if (!status.available) {
    return (
      <View style={styles.panel} testID="ai-unavailable">
        <Text style={styles.statusTitle}>{t('Online answers are off')}</Text>
        <Text style={styles.status}>
          {status.detail ?? t('No model is available.')}
        </Text>
        <Text style={styles.status}>
          {t('The saved guidance still works, with no model and no internet.')}
        </Text>
      </View>
    )
  }

  const busy = state.kind === 'ASKING'

  return (
    <View style={styles.panel} testID="ai-panel">
      <Text style={styles.lead}>{lead}</Text>
      <Text style={styles.model}>
        {t('Online model · may only reword the guidance above')}
      </Text>

      {suggestions.length > 0 ? (
        <View style={styles.chips}>
          {suggestions.map((s) => (
            <Pressable
              key={s}
              onPress={() => setDraft(s)}
              accessibilityRole="button"
              style={styles.chip}
            >
              <Text style={styles.chipLabel}>{s}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder={placeholder}
        placeholderTextColor={COLORS.muted}
        multiline
        style={styles.input}
        accessibilityLabel={placeholder}
      />

      <View style={styles.row}>
        <Pressable
          onPress={() => ai.ask(mode, draft, askOptions)}
          disabled={busy || draft.trim().length === 0}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || draft.trim().length === 0 }}
          style={[
            styles.button,
            (busy || draft.trim().length === 0) && styles.buttonOff,
          ]}
          testID="ai-ask"
        >
          <Text style={[styles.buttonLabel, { color: COLORS.onAccent }]}>{t(busy ? 'Answering…' : 'Ask')}</Text>
        </Pressable>

        {/* Cancel exists because a local model on a laptop can take half a
            minute, and a driver who changes their mind must not have to wait
            for an answer they no longer want. */}
        {busy ? (
          <Pressable
            onPress={ai.cancel}
            accessibilityRole="button"
            style={[styles.button, styles.buttonQuiet]}
            testID="ai-cancel"
          >
            <Text style={styles.buttonLabel}>{t('Cancel')}</Text>
          </Pressable>
        ) : null}
      </View>

      {busy ? <ActivityIndicator color={COLORS.accent} /> : null}

      {state.kind === 'ERROR' ? (
        <View style={styles.error} testID="ai-error">
          <Text style={styles.errorText}>{state.message}</Text>
          <Pressable
            onPress={() => ai.ask(mode, draft, askOptions)}
            accessibilityRole="button"
            style={[styles.button, styles.buttonQuiet]}
          >
            <Text style={styles.buttonLabel}>{t('Try again')}</Text>
          </Pressable>
        </View>
      ) : null}

      {state.kind === 'ANSWER' ? (
        <View style={styles.answer} testID="ai-answer">
          {/* The label is not decoration. Everything else on these screens is
              reviewed, bundled text; a generated sentence was written by a
              model a moment ago and the driver is entitled to know which they
              are reading.

              WHICH IS WHY IT HAS TO BRANCH. This label was unconditional, so
              the deterministic offline assistant - bundled, reviewed guidance,
              the exact opposite of model output - was announced as "Written by
              AI - check anything important". That is wrong in both directions:
              it claims the assistant is online when it is not, and it tells a
              driver to distrust the one answer on this screen that was
              actually reviewed by a person.

              It is not a rare edge case either. When a provider's quota is
              spent every answer takes this path, so the label was false on
              every answer the driver saw. */}
          {state.answer.generated ? (
            <Text style={styles.generatedLabel}>
              {t('Written by an online model')} · {t('check anything important')}
            </Text>
          ) : (
            <View style={styles.offlineLabelRow}>
              <View style={styles.offlineDot} />
              <Text style={styles.offlineLabel}>
                {t('Offline guidance — saved on this phone')}
              </Text>
            </View>
          )}
          <Text style={styles.answerText} selectable>
            {state.answer.answer}
          </Text>
          {/* Why the assistant fell back, in the server's own words. Without
              it "Offline guidance" reads as a setting the driver chose rather
              than a condition they are in. */}
          {!state.answer.generated && state.answer.disclaimer ? (
            <Text style={styles.offlineReason}>{state.answer.disclaimer}</Text>
          ) : null}
          {state.answer.facts_as_of ? (
            <Text style={styles.factsAt}>
              Trip details read{' '}
              {new Date(state.answer.facts_as_of).toLocaleTimeString()}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const useStyles = makeStyles((COLORS) => ({
  panel: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    gap: 8,
    marginBottom: 16,
  },
  lead: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  offlineLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  offlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.warn,
  },
  offlineLabel: {
    color: COLORS.warn,
    fontSize: 12,
    fontWeight: '700',
  },
  offlineReason: {
    color: COLORS.faint,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  model: { color: COLORS.muted, fontSize: 12 },
  statusTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  status: { color: COLORS.muted, fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipLabel: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  input: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 10,
    color: COLORS.text,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  row: { flexDirection: 'row', gap: 8 },
  button: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: COLORS.accent,
  },
  buttonQuiet: { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.border },
  buttonOff: { opacity: 0.45 },
  buttonLabel: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  error: { gap: 8 },
  errorText: { color: COLORS.warn, fontSize: 13, lineHeight: 18 },
  answer: { gap: 4, marginTop: 4 },
  generatedLabel: {
    color: COLORS.warn,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  answerText: { color: COLORS.text, fontSize: 16, lineHeight: 23 },
  factsAt: { color: COLORS.muted, fontSize: 12 },
}))
