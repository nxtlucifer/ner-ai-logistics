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
 */
import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { Icon } from '../components/icons'
import { useT } from '../i18n/tx'
import { useAuth } from '../auth/AuthProvider'
import { useAppLanguage } from '../i18n/AppLanguageProvider'
import { APP_LANGUAGES } from '../i18n/appLanguage'
import { TOUCH_TARGET } from '../theme'
import { makeStyles, useTheme } from '../theme-context'

export default function MoreScreen({
  onOpenAssistant,
  onOpenDetails,
}: {
  onOpenAssistant: () => void
  onOpenDetails: () => void
}) {
  const styles = useStyles()
  const { colors: COLORS, mode, toggle } = useTheme()
  const { language, setLanguage, t } = useAppLanguage()
  const tx = useT()
  const { logout } = useAuth()
  const [langOpen, setLangOpen] = useState(false)

  const active = APP_LANGUAGES.find((l) => l.code === language)

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.section}>{tx('You').toUpperCase()}</Text>
      <Pressable style={styles.row} onPress={onOpenDetails} accessibilityRole="button" testID="more-my-details">
        <Icon name="user" color={COLORS.muted} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{tx('My details')}</Text>
          <Text style={styles.rowSub}>{tx('Profile, documents and insurance')}</Text>
        </View>
        <Icon name="chevron-right" color={COLORS.faint} size={20} />
      </Pressable>

      <Text style={styles.section}>{tx('Assistant').toUpperCase()}</Text>
      <Pressable style={styles.row} onPress={onOpenAssistant} accessibilityRole="button">
        <Icon name="message-circle" color={COLORS.muted} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{tx('Driver Assistant')}</Text>
          <Text style={styles.rowSub}>{tx('Offline guidance and the translator')}</Text>
        </View>
        <Icon name="chevron-right" color={COLORS.faint} size={20} />
      </Pressable>

      <Text style={styles.section}>{t('common_change_language').toUpperCase()}</Text>
      <Pressable
        style={styles.row}
        onPress={() => setLangOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Language: ${active?.label ?? 'English'}. Opens language chooser`}
      >
        <Icon name="globe" color={COLORS.muted} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{tx('Language')}</Text>
          <Text style={styles.rowSub}>
            {active?.nativeLabel ?? 'English'} · {tx("changes the app's own labels")}
          </Text>
        </View>
        <Icon name="chevron-right" color={COLORS.faint} size={20} />
      </Pressable>

      <Text style={styles.section}>{tx('Appearance').toUpperCase()}</Text>
      <Pressable style={styles.row} onPress={toggle} accessibilityRole="button">
        <Icon name={mode === 'day' ? 'sun' : 'moon'} color={COLORS.muted} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{tx('Theme')}</Text>
          <Text style={styles.rowSub}>
            {tx(mode === 'day' ? 'Day — light surfaces' : 'Night — dark cab surfaces')}
          </Text>
        </View>
        <Text style={styles.value}>{tx(mode === 'day' ? 'Day' : 'Night')}</Text>
      </Pressable>

      <Pressable
        style={[styles.row, styles.signOut]}
        onPress={() => void logout()}
        accessibilityRole="button"
      >
        <Icon name="log-out" color={COLORS.bad} size={20} />
        <Text style={[styles.rowTitle, { color: COLORS.bad }]}>{t('btn_sign_out')}</Text>
      </Pressable>

      <Modal
        visible={langOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setLangOpen(false)}
      >
        <View style={styles.sheetRoot}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityLabel="Close language chooser"
            onPress={() => setLangOpen(false)}
          />
          <View style={styles.sheet}>
            <View style={styles.grip} />
            <Text style={styles.section}>{t('common_change_language').toUpperCase()}</Text>
            {/* Only languages with a real dictionary in appLanguage.ts. There
                is no "coming soon" row: an option that cannot be chosen is
                chrome, and this list is the actual coverage. */}
            {APP_LANGUAGES.map((opt) => {
              const selected = opt.code === language
              return (
                <Pressable
                  key={opt.code}
                  onPress={() => {
                    void setLanguage(opt.code)
                    setLangOpen(false)
                  }}
                  style={[styles.sheetRow, selected && styles.sheetRowActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <View style={styles.sheetText}>
                    <Text style={styles.sheetNative}>{opt.nativeLabel}</Text>
                    {opt.label !== opt.nativeLabel ? <Text style={styles.sheetLatin}>{opt.label}</Text> : null}
                  </View>
                  {selected ? <Icon name="check" color={COLORS.routeOn} size={20} /> : null}
                </Pressable>
              )
            })}
          </View>
        </View>
      </Modal>
    </ScrollView>
  )
}

const useStyles = makeStyles((COLORS) => ({
  content: { padding: 16, paddingBottom: 32, gap: 8 },
  section: {
    color: COLORS.faint,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  rowSub: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  value: { color: COLORS.muted, fontSize: 13, fontWeight: '700' },
  signOut: { marginTop: 20, justifyContent: 'center', gap: 8, borderColor: COLORS.badBorder },

  sheetRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11,17,22,0.72)' },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
  },
  grip: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.borderStrong,
    marginBottom: 10,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 56,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  sheetRowActive: { backgroundColor: COLORS.sunken },
  sheetText: { flex: 1 },
  sheetNative: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  sheetLatin: { color: COLORS.muted, fontSize: 12, marginTop: 1 },
}))
