/**
 * THE language chooser - Login and More open the same sheet.
 *
 * Search (English name, native name or code: "hindi", "हिन्दी", "hi" all find
 * Hindi), then the driver's recent picks, then every scheduled language A-Z.
 * A row says when a language is a DRAFT or renders English, so nobody is
 * promised a translation this build does not have.
 */

import { useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { Icon } from '../components/icons'
import { TOUCH_TARGET } from '../theme'
import { makeStyles, useTheme } from '../theme-context'
import { useAppLanguage } from './AppLanguageProvider'
import { APP_LANGUAGES, type AppLanguage, type AppLanguageOption } from './appLanguage'
import { useT } from './tx'

export function matchesLanguage(opt: AppLanguageOption, query: string): boolean {
  const q = query.trim()
  if (!q) return true
  const s = q.toLowerCase()
  return opt.code === s || opt.label.toLowerCase().includes(s) || opt.nativeLabel.includes(q)
}

export function LanguageSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const { language, setLanguage, recent } = useAppLanguage()
  const t = useT()
  const [query, setQuery] = useState('')
  const all = useMemo(() => APP_LANGUAGES.filter((o) => matchesLanguage(o, query)), [query])
  const recentOpts = query
    ? []
    : recent.map((c) => APP_LANGUAGES.find((o) => o.code === c)).filter((o): o is AppLanguageOption => !!o)

  const pick = (code: AppLanguage) => {
    void setLanguage(code)
    setQuery('')
    onClose()
  }

  const row = (opt: AppLanguageOption, keyPrefix: string) => {
    const selected = opt.code === language
    const note = [
      opt.label !== opt.nativeLabel ? opt.label : null,
      opt.status === 'DRAFT' ? t('Draft') : opt.status === 'FALLBACK_ENGLISH' ? t('English fallback') : null,
    ].filter(Boolean).join(' · ')
    return (
      <Pressable
        key={keyPrefix + opt.code}
        onPress={() => pick(opt.code)}
        style={[styles.row, selected && styles.rowActive]}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`${opt.label}${note ? ` · ${note}` : ''}`}
      >
        <View style={styles.rowText}>
          <Text style={[styles.native, opt.rtl && styles.rtl]}>{opt.nativeLabel}</Text>
          {note ? <Text style={styles.latin}>{note}</Text> : null}
        </View>
        {selected ? <Icon name="check" color={COLORS.info} size={20} /> : null}
      </Pressable>
    )
  }

  return (
    // Fade, not slide: no travel for a driver who has asked for reduced motion.
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        {/* A tap outside closes, for touch. A plain View, not a Pressable:
            nothing focusable, so neither Tab nor the web modal's focus trap
            (which focuses the first element that takes focus) lands on it.
            The named Close button below is the way out (CERT-DRV-06). */}
        <View style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => true} onResponderRelease={onClose} aria-hidden />
        <View style={styles.sheet}>
          <View style={styles.grip} />
          <View style={styles.head}>
            <Text style={styles.title}>{t('Language').toUpperCase()}</Text>
            {/* A visible way out, not only a tap outside the sheet. */}
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('Close')} testID="language-close" style={styles.close}>
              <Icon name="x" color={COLORS.textMuted} size={22} />
            </Pressable>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('Search language…')}
            placeholderTextColor={COLORS.textFaint}
            style={styles.search}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search language"
            testID="language-search"
          />
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
            {recentOpts.length ? <Text style={styles.section}>{t('Recently used')}</Text> : null}
            {recentOpts.map((o) => row(o, 'r-'))}
            <Text style={styles.section}>{t('All languages')}</Text>
            {all.length ? all.map((o) => row(o, 'a-')) : <Text style={styles.empty}>{t('No language matches')}</Text>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const useStyles = makeStyles((COLORS) => ({
  // The theme's modal backdrop (REG-6), not a colour of its own.
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: COLORS.overlay },
  sheet: {
    maxHeight: '85%',
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 20,
  },
  grip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.borderStrong, marginBottom: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: COLORS.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  close: { minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', marginRight: -12 },
  search: {
    // A full touch target (CERT-DRV-06): it was 44.
    minHeight: TOUCH_TARGET,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceSunken,
    color: COLORS.text,
    paddingHorizontal: 14,
    fontSize: 16,
    marginBottom: 6,
  },
  // A bounded list: RN's default flexShrink is 0, so a percentage maxHeight on the sheet alone let it overflow the viewport on web.
  list: { flexGrow: 0, flexShrink: 1, maxHeight: 400 },
  section: { color: COLORS.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginTop: 10, marginBottom: 4, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12 },
  rowActive: { backgroundColor: COLORS.surfaceSunken },
  rowText: { flex: 1 },
  native: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  rtl: { writingDirection: 'rtl', textAlign: 'left' },
  latin: { color: COLORS.textMuted, fontSize: 12, marginTop: 1 },
  empty: { color: COLORS.textMuted, fontSize: 14, padding: 14 },
}))
