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
 */

import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { resolveLanguage } from '../i18n/language'
import {
  LANGUAGES,
  REVISED,
  VERSION,
  phrasebook,
  type PhraseLanguage,
} from '../phrasebook/phrases'
import { TOUCH_TARGET } from '../theme'
import { useT } from '../i18n/tx'
import { makeStyles, useTheme } from '../theme-context'
import TranslateBox from './TranslateBox'

export default function PhrasebookScreen() {
  const styles = useStyles()
  const t = useT()
  const { colors: COLORS } = useTheme()
  // The driver's own language comes from the device, exactly as everywhere
  // else in the app. Only the LISTENER's language is a choice, because only
  // that one is a fact about the person in front of them.
  const mine = resolveLanguage() as PhraseLanguage
  const [theirs, setTheirs] = useState<PhraseLanguage>(() =>
    // Default to a language that is not the driver's - defaulting to their own
    // would show two identical columns and look broken.
    mine === 'hi' ? 'as' : 'hi',
  )

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {/* Free typing FIRST, reviewed phrases below. The order says which is
          which: a driver who scrolls past the box lands on sentences that have
          a version and a revision date. */}
      <TranslateBox />

      <Text style={styles.lead}>{t('Find the sentence, then turn the phone round.')}</Text>

      <Text style={styles.pickerLabel}>{t('They speak')}</Text>
      <View style={styles.picker}>
        {LANGUAGES.map((option) => {
          const selected = option.code === theirs
          return (
            <Pressable
              key={option.code}
              onPress={() => setTheirs(option.code)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
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
          <Text style={styles.categoryTitle}>{category.title}</Text>
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
  content: { padding: 16, paddingBottom: 40,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },

  lead: { color: COLORS.muted, fontSize: 13, marginBottom: 16 },

  pickerLabel: {
    color: COLORS.faint,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: {
    minHeight: TOUCH_TARGET - 8,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.card, borderColor: COLORS.accent },
  chipLabel: { color: COLORS.muted, fontSize: 15, fontWeight: '600' },
  chipLabelActive: { color: COLORS.text },
  pressed: { opacity: 0.75 },

  category: { marginBottom: 22 },
  categoryTitle: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },

  phrase: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    padding: 14,
    marginBottom: 8,
  },
  mine: { color: COLORS.muted, fontSize: 13, marginBottom: 6 },
  theirs: { color: COLORS.text, fontSize: 20, fontWeight: '700', lineHeight: 29 },

  provenance: { marginTop: 4, gap: 3 },
  provenanceText: { color: COLORS.faint, fontSize: 11 },
}))
