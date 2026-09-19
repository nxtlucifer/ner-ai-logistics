/**
 * Everything that does not belong on the driving surface.
 *
 * Assistant and the translator used to hold permanent slots in the bottom
 * navigation and a duplicate quick-action row on the map. Neither is something
 * a moving driver reaches for, and the language control in particular is set
 * once and then never touched. They live here so Navigate, Trip and Safety are
 * the only things competing for a thumb at speed.
 *
 * ONLY REAL ACTIONS. There is no Profile or Help page in this app, so there is
 * no Profile or Help row - a menu item that opens nothing is worse than an
 * absent one, because the driver pays the tap to find out.
 *
 * LAYOUT (Phase B1, driver_04): a photo hero with the title, large rounded row
 * cards with discs, a filled Sign Out, the tagline, an Image credits link and
 * a vector mountain band. The reference's back arrow is omitted (More is a tab root) and so is
 * its "R" mark (not a RASTA asset). The GPS chip in the hero replaces the
 * shell header this tab no longer shows, so GPS state is never off screen.
 */
import { useState, type ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

import { Icon } from '../components/icons'
import { PHOTOS } from '../components/photoCredits'
import { ImageCreditsSheet, MountainBand, RowCard, ScreenHero } from '../components/scenic'
import { useT } from '../i18n/tx'
import { useAuth } from '../auth/AuthProvider'
import { useAppLanguage } from '../i18n/AppLanguageProvider'
import { APP_LANGUAGES } from '../i18n/appLanguage'
import { LanguageSheet } from '../i18n/LanguageSheet'
import { TOUCH_TARGET } from '../theme'
import { makeStyles, useTheme } from '../theme-context'

export default function MoreScreen({
  onOpenAssistant,
  onOpenDetails,
  onOpenTutorial,
  status,
}: {
  onOpenAssistant: () => void
  onOpenDetails: () => void
  onOpenTutorial: () => void
  /** The GPS status chip, from the shell (it reads the tracker). */
  status?: ReactNode
}) {
  const styles = useStyles()
  const { colors: COLORS, mode, toggle } = useTheme()
  const { language, t } = useAppLanguage()
  const tx = useT()
  const { logout } = useAuth()
  const [langOpen, setLangOpen] = useState(false)
  const [creditsOpen, setCreditsOpen] = useState(false)

  const active = APP_LANGUAGES.find((l) => l.code === language)
  const themeName = tx(mode === 'light' ? 'Light' : 'Dark')

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ScreenHero
        photo={PHOTOS.more}
        title={t('nav_more')}
        subtitle={tx('Your details, help and settings')}
        status={status}
      />

      <View style={styles.list}>
        {/* Green disc: the one row that holds the driver's own records. The
            rest carry no status, so they take the neutral disc. */}
        <RowCard
          icon="user"
          tone="action"
          title={tx('My Details')}
          subtitle={tx('Profile, documents and insurance')}
          onPress={onOpenDetails}
          testID="more-my-details"
        />
        <RowCard
          icon="message-circle"
          title={tx('Driver Assistant')}
          subtitle={tx('Offline guidance and the translator')}
          onPress={onOpenAssistant}
          testID="more-assistant"
        />
        <RowCard
          icon="globe"
          title={tx('Language')}
          subtitle={`${active?.nativeLabel ?? 'English'} · ${tx("changes the app's own labels")}`}
          onPress={() => setLangOpen(true)}
          accessibilityLabel={`Language: ${active?.label ?? 'English'}. Opens language chooser`}
          testID="more-language"
        />
        <RowCard
          icon={mode === 'light' ? 'sun' : 'moon'}
          title={tx('Theme')}
          subtitle={tx(mode === 'light' ? 'Light — light surfaces' : 'Dark — dark cab surfaces')}
          value={themeName}
          onPress={toggle}
          accessibilityLabel={`${tx('Theme')}: ${themeName}. ${mode === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}`}
          testID="more-theme"
        />
        <RowCard
          icon="help-circle"
          title={tx('How RASTA Works')}
          subtitle={tx('The short tour, any time you want it')}
          onPress={onOpenTutorial}
          testID="more-tutorial"
        />

        <Pressable
          style={({ pressed }) => [styles.signOut, pressed && styles.signOutPressed]}
          onPress={() => void logout()}
          accessibilityRole="button"
          testID="more-sign-out"
        >
          <Icon name="log-out" color={COLORS.danger} size={22} />
          <Text style={styles.signOutText}>{t('btn_sign_out')}</Text>
        </Pressable>
      </View>

      {/* Brand line, like the login's old motto: decoration, not a claim. */}
      <View style={styles.tagline} accessible={false}>
        <Text style={styles.taglineText}>PEOPLE · PLACES · PROGRESS</Text>
        <View style={styles.taglineRule} />
      </View>
      {/* A quiet link, not a sixth row: the credits are a reference the
          driver rarely needs, and a full row pushed Sign Out off the first
          screen. The hero's own credit stays on the photo. */}
      <Pressable
        style={styles.creditsLink}
        onPress={() => setCreditsOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={tx('Image credits')}
        testID="more-image-credits"
      >
        <Icon name="image" color={COLORS.textMuted} size={16} />
        <Text style={styles.creditsLinkText}>{tx('Image credits')}</Text>
      </Pressable>
      <MountainBand />

      <LanguageSheet open={langOpen} onClose={() => setLangOpen(false)} />
      <ImageCreditsSheet open={creditsOpen} onClose={() => setCreditsOpen(false)} />
    </ScrollView>
  )
}

const useStyles = makeStyles((COLORS) => ({
  content: { paddingBottom: 0, backgroundColor: COLORS.bg },
  // Rides 26 px up over the hero's rounded foot, as driver_04's first card does.
  list: { marginTop: -26, paddingHorizontal: 14, gap: 6 },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: TOUCH_TARGET,
    marginTop: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.dangerBorder,
    backgroundColor: COLORS.dangerSoft,
  },
  signOutPressed: { opacity: 0.85 },
  signOutText: { color: COLORS.danger, fontSize: 16, fontWeight: '700' },
  tagline: { alignItems: 'center', marginTop: 22, gap: 10 },
  taglineText: { color: COLORS.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 4 },
  taglineRule: { width: 40, height: 2, borderRadius: 1, backgroundColor: COLORS.accent },
  creditsLink: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 48,
    paddingHorizontal: 14,
    marginTop: 2,
  },
  creditsLinkText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
}))
