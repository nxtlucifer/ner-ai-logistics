/**
 * The first-run tour, and the one a driver can come back to.
 *
 * WHY A LIST AND NOT A CAROUSEL
 *
 * A ten-panel swipe carousel is the conventional answer and the wrong one
 * here. A driver opening this in a cab wants to find the one thing they
 * forgot — "how do I ask to stop?" — not swipe through nine panels to
 * reach it. A scrollable list is searchable by eye, works with a screen
 * reader in one pass, and needs no gesture library.
 *
 * SKIPPABLE, AND IT MEANS IT
 *
 * The dismiss control is at the TOP, reachable before reading anything - the
 * first control in the hero's chip row. A tutorial that holds a working
 * driver hostage is worse than no tutorial.
 *
 * LAYOUT (Phase B3; no own reference, so the driver system): More's photo in a
 * compact hero with Skip / Close and the GPS chip, then one card per step with
 * its disc.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import type { ReactNode } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { Button } from '../components/ui'
import { PHOTOS } from '../components/photoCredits'
import { HeroBack, IconDisc, ScreenHero } from '../components/scenic'
import { useT } from '../i18n/tx'
import { makeStyles } from '../theme-context'

import { TUTORIAL_SEEN_KEY, TUTORIAL_STEPS } from './tutorialSteps'

/** Record that the tour has been seen. Failure is not an error: the worst
 *  case is the driver is offered it again, which is survivable. */
export async function markTutorialSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(TUTORIAL_SEEN_KEY, '1')
  } catch {
    // Storage unavailable. Showing it twice beats blocking the app.
  }
}

/** Has this driver already been shown the tour? Defaults to "yes" on a
 *  storage failure, so a broken read never traps someone in onboarding. */
export async function tutorialSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(TUTORIAL_SEEN_KEY)) === '1'
  } catch {
    return true
  }
}

export default function TutorialScreen({
  onDone,
  firstRun = false,
  status,
}: {
  onDone: () => void
  /** First run gets "Skip"; reopening from More gets "Close". */
  firstRun?: boolean
  /** The shell's GPS chip for the hero. */
  status?: ReactNode
}) {
  const styles = useStyles()
  const t = useT()

  async function finish() {
    await markTutorialSeen()
    onDone()
  }

  const dismiss = t(firstRun ? 'Skip' : 'Close')
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} testID="tutorial">
      <View style={styles.heroBleed}>
        <ScreenHero
          photo={PHOTOS.more}
          // No subtitle: the lead line under the hero says it in full, and a
          // one-line hero subtitle clipped at a large font scale.
          title={t('How RASTA Works')}
          status={status}
          // The Light/Dark chip the shell header gave this screen (B3D-R01).
          themeChip="icon"
          compact
          height={176}
          overlap={14}
          creditAt="bottom"
          leading={<HeroBack label={dismiss} text={dismiss} icon="x" onPress={() => void finish()} />}
        />
      </View>

      <Text style={styles.lead}>{t('Ten short things. You can read this again from More.')}</Text>
      {TUTORIAL_STEPS.map((step, index) => (
        <View key={step.id} style={styles.step} testID={`tutorial-${step.id}`}>
          <IconDisc icon={step.icon} size={44} />
          <View style={styles.stepText}>
            <Text style={styles.stepTitle}>
              {index + 1}. {t(step.title)}
            </Text>
            <Text style={styles.stepBody}>{t(step.body)}</Text>
          </View>
        </View>
      ))}
      <Button label={t(firstRun ? 'Start driving' : 'Done')} onPress={() => void finish()} />
    </ScrollView>
  )
}

const useStyles = makeStyles((COLORS) => ({
  page: { flex: 1, backgroundColor: COLORS.bg },
  content: { paddingHorizontal: 13, paddingBottom: 32, gap: 8, width: '100%', maxWidth: 700, alignSelf: 'center' },
  // Full-bleed; the first step rides up over the hero's foot.
  heroBleed: { marginHorizontal: -13, marginBottom: -24 },
  // On the page ground under the hero's foot, clear of the photo.
  lead: { color: COLORS.textMuted, fontSize: 13, lineHeight: 19, paddingHorizontal: 4, paddingTop: 30 },
  step: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    padding: 14,
  },
  stepText: { flex: 1, minWidth: 0 },
  stepTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  stepBody: { color: COLORS.textMuted, fontSize: 13.5, lineHeight: 19, marginTop: 3 },
}))
