/**
 * Offline phrasebook.
 *
 * The interaction is: find the sentence you mean, then turn the phone round.
 * So the driver's own language is the small label they scan with, and the
 * other person's language is the large high-contrast line, because that half
 * is read at arm's length by a stranger who may be holding a torch.
 *
 * MACHINE TRANSLATION SITS ON TOP, NOT INSTEAD
 *
 * `TranslateBox` adds free-text translation from the local model, and it is
 * placed above rather than merged in: the phrases below carry a version and a
 * revision date, the model's output carries neither, and the screen must not
 * let those read as the same kind of thing. When the model is absent the box
 * says so and this phrasebook is untouched - the same arrangement the offline
 * package uses for routes.
 *
 * STILL NO MICROPHONE BUTTON
 *
 * There is no speech recognition in this build, so there is no control that
 * implies one. A microphone that did nothing would be discovered at exactly
 * the wrong moment.
 *
 * LAYOUT (Phase B3): `header` (the Assistant's photo hero, with its way back)
 * scrolls with the page; the translator card, the listener picker and one card
 * per category follow on the driver card geometry.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

import { resolveLanguage } from '../i18n/language'
import {
  LANGUAGES,
  REVISED,
  VERSION,
  phrasebook,
  type PhraseLanguage,
} from '../phrasebook/phrases'
import { useKeyboardOpen } from '../components/useKeyboardOpen'
import { TOUCH_TARGET } from '../theme'
import { useT } from '../i18n/tx'
import { makeStyles } from '../theme-context'
import TranslateBox from './TranslateBox'

export default function PhrasebookScreen({ header }: { header?: ReactNode } = {}) {
  const styles = useStyles()
  const t = useT()
  // The driver's own language comes from the device, exactly as everywhere
  // else in the app. Only the LISTENER's language is a choice, because only
  // that one is a fact about the person in front of them.
  const mine = resolveLanguage() as PhraseLanguage
  const [theirs, setTheirs] = useState<PhraseLanguage>(() =>
    // Default to a language that is not the driver's - defaulting to their own
    // would show two identical columns and look broken.
    mine === 'hi' ? 'as' : 'hi',
  )
  // With the soft keyboard up, keep the translator's Translate row in view
  // under the text box: the platform scrolls only the focused box itself into
  // view, which left Translate one scroll below it (B3D-R03).
  const keyboardOpen = useKeyboardOpen()
  const scroll = useRef<ScrollView>(null)
  const scrollY = useRef(0)
  const [viewHeight, setViewHeight] = useState(0)
  const [boxY, setBoxY] = useState(0)
  const [typingBottom, setTypingBottom] = useState<number | null>(null)
  useEffect(() => {
    if (!keyboardOpen || typingBottom === null || !viewHeight) return
    const bottom = boxY + typingBottom + 12
    if (bottom > scrollY.current + viewHeight) scroll.current?.scrollTo({ y: bottom - viewHeight, animated: false })
  }, [keyboardOpen, typingBottom, viewHeight, boxY])

  return (
    <ScrollView
      ref={scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      onLayout={(e) => setViewHeight(e.nativeEvent.layout.height)}
      onScroll={(e) => {
        scrollY.current = e.nativeEvent.contentOffset.y
      }}
      scrollEventThrottle={32}
    >
      {header ? <View style={styles.heroBleed}>{header}</View> : null}
      {/* Free typing FIRST, reviewed phrases below. The order says which is
          which: a driver who scrolls past the box lands on sentences that have
          a version and a revision date. */}
      <View onLayout={(e) => setBoxY(e.nativeEvent.layout.y)}>
        <TranslateBox onTypingBottom={setTypingBottom} />
      </View>

      <Text style={styles.lead}>{t('Find the sentence, then turn the phone round.')}</Text>

      <Text style={styles.pickerLabel}>{t('They speak')}</Text>
      <View style={styles.picker} accessibilityRole="radiogroup">
        {LANGUAGES.map((option) => {
          const selected = option.code === theirs
          return (
            <Pressable
              key={option.code}
              onPress={() => setTheirs(option.code)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              aria-checked={selected}
              accessibilityLabel={`Listener speaks ${option.name}`}
              style={({ pressed }) => [
                styles.chip,
                selected && styles.chipActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.chipLabel, selected && styles.chipLabelActive]}>
                {option.name}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {phrasebook(mine, theirs).map((category) => (
        <View key={category.id} style={styles.category}>
          <Text style={styles.categoryTitle} accessibilityRole="header">{category.title}</Text>
          {category.phrases.map((phrase) => (
            <View key={phrase.id} style={styles.phrase}>
              <Text style={styles.mine}>{phrase.mine}</Text>
              <Text style={styles.theirs}>{phrase.theirs}</Text>
            </View>
          ))}
        </View>
      ))}

      <View style={styles.provenance}>
        <Text style={styles.provenanceText}>
          {VERSION} · revised {REVISED}
        </Text>
        {/* On screen, not only in the file. Someone is about to rely on these
            sentences with a stranger, and they have not been checked by a
            native speaker. */}
        <Text style={styles.provenanceText}>
          {t('Translations are not yet reviewed by a native speaker.')}
        </Text>
      </View>
    </ScrollView>
  )
}

const useStyles = makeStyles((COLORS) => ({
  // Bounded and centred. These screens are built for a phone, and on the
  // desktop browser they are demonstrated in an unbounded column stretches a
  // sentence across the whole window. Below the maximum it simply fills.
  content: { paddingHorizontal: 13, paddingBottom: 40,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  // Full-bleed; the translator card rides up over the hero's foot.
  heroBleed: { marginHorizontal: -13, marginBottom: -14 },

  lead: { color: COLORS.textMuted, fontSize: 13, marginBottom: 16, paddingHorizontal: 4 },

  pickerLabel: {
    color: COLORS.textFaint,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  // 48 dp, and a 3:1 outline (borderStrong) so an unselected chip is still
  // found as a control; the selected one fills.
  chip: {
    minHeight: TOUCH_TARGET - 4,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipLabel: { color: COLORS.textMuted, fontSize: 15, fontWeight: '600' },
  chipLabelActive: { color: COLORS.onPrimary },
  pressed: { opacity: 0.75 },

  category: {
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    padding: 14,
  },
  categoryTitle: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },

  // A row inside the category card, divided by a hairline - not a card in
  // a card.
  phrase: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  mine: { color: COLORS.textMuted, fontSize: 13, marginBottom: 6 },
  theirs: { color: COLORS.text, fontSize: 20, fontWeight: '700', lineHeight: 29 },

  provenance: { marginTop: 4, gap: 3, paddingHorizontal: 4 },
  provenanceText: { color: COLORS.textFaint, fontSize: 11 },
}))
