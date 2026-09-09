/**
 * NER Driver App - Terrain Command Industrial Edition.
 *
 * 4 Primary Bottom Navigation Tabs:
 *   - NAVIGATE: Map-first turn guidance (75-80% viewport)
 *   - TRIP: Trip workflow, truck check, stop completion
 *   - SAFETY: Fatigue management & Emergency 112/108/1033 dialer
 *   - AI: Gemini logistics assistant & offline fallback
 */

import { useState } from 'react'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { AuthProvider, useAuth } from './src/auth/AuthProvider'
import { Button, Loading } from './src/components/ui'
import { AppLanguageProvider, useAppLanguage } from './src/i18n/AppLanguageProvider'
import { APP_LANGUAGES, type TranslationKey } from './src/i18n/appLanguage'
import AssistantScreen from './src/screens/AssistantScreen'
import LoginScreen from './src/screens/LoginScreen'
import MapScreen from './src/screens/MapScreen'
import SafetyScreen from './src/screens/SafetyScreen'
import TripScreen from './src/screens/TripScreen'
import { TABS, type Tab } from './src/navigation'
import { AiIcon, NavigateIcon, SafetyIcon, TripIcon } from './src/components/icons'
import { TripProvider } from './src/trip/TripProvider'
import { COLORS, TOUCH_TARGET } from './src/theme'

const TAB_TRANSLATIONS: Record<Tab, TranslationKey> = {
  navigate: 'nav_navigate',
  trip: 'nav_trip',
  safety: 'nav_safety',
  ai: 'nav_ai',
}

/** One tab's glyph. Colour is passed in so the active tab can tint. */
function TabIcon({ tab, color }: { tab: Tab; color: string }) {
  if (tab === 'navigate') return <NavigateIcon color={color} size={21} />
  if (tab === 'trip') return <TripIcon color={color} size={21} />
  if (tab === 'safety') return <SafetyIcon color={color} size={21} />
  return <AiIcon color={color} size={21} />
}

function Signed() {
  const { driver, logout } = useAuth()
  const { language, setLanguage, t } = useAppLanguage()
  const [tab, setTab] = useState<Tab>('navigate')
  const [showLangModal, setShowLangModal] = useState(false)

  return (
    <TripProvider>
      <SafeAreaView style={styles.flex}>
        {tab !== 'navigate' ? (
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.brand}>NER DRIVER · TERRAIN COMMAND</Text>
              <Text style={styles.name} numberOfLines={1}>
                {driver?.full_name ?? 'Driver'}
              </Text>
              <Text style={styles.licence}>{driver?.licence_number}</Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => setShowLangModal((v) => !v)}
                style={styles.langToggle}
                accessibilityRole="button"
                accessibilityLabel="Switch language"
              >
                {/* The native label alone. The globe emoji it carried could
                    not take the control's colour and rendered at a different
                    baseline from the script beside it, which on Assamese and
                    Bengali labels left the row visibly uneven. */}
                <Text style={styles.langToggleText}>
                  {APP_LANGUAGES.find((l) => l.code === language)?.nativeLabel ?? 'EN'}
                </Text>
              </Pressable>
              <Button
                label={t('btn_sign_out')}
                variant="secondary"
                onPress={() => void logout()}
              />
            </View>
          </View>
        ) : null}

        {showLangModal && (
          <View style={styles.langModalBanner}>
            <Text style={styles.langModalTitle}>Select App Language</Text>
            <View style={styles.langModalRow}>
              {APP_LANGUAGES.map((opt) => (
                <Pressable
                  key={opt.code}
                  onPress={() => {
                    void setLanguage(opt.code)
                    setShowLangModal(false)
                  }}
                  style={[
                    styles.langModalChip,
                    language === opt.code && styles.langModalChipActive,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: language === opt.code }}
                >
                  <Text
                    style={[
                      styles.langModalChipText,
                      language === opt.code && styles.langModalChipTextActive,
                    ]}
                  >
                    {opt.nativeLabel} ({opt.label})
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <View style={styles.flex}>
          {tab === 'navigate' ? (
            <MapScreen onBack={() => setTab('trip')} />
          ) : null}
          {tab === 'trip' ? (
            <TripScreen onOpenMap={() => setTab('navigate')} />
          ) : null}
          {tab === 'safety' ? <SafetyScreen /> : null}
          {tab === 'ai' ? <AssistantScreen /> : null}
        </View>

        <View style={styles.tabs}>
          {TABS.map((value) => (
            <Pressable
              key={value}
              onPress={() => setTab(value)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === value }}
              style={[styles.tab, tab === value && styles.tabActive]}
            >
              {/* Drawn, not typed. See src/components/icons.tsx: an emoji
                  glyph carries its own palette, so an active tab could not
                  tint its own icon. */}
              <View style={styles.tabIcon}>
                <TabIcon tab={value} color={tab === value ? COLORS.accent : COLORS.muted} />
              </View>
              <Text
                style={[
                  styles.tabLabel,
                  tab === value && styles.tabLabelActive,
                ]}
              >
                {t(TAB_TRANSLATIONS[value])}
              </Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </TripProvider>
  )
}

function Gate() {
  const { driver, isInitialising } = useAuth()

  if (isInitialising) {
    return (
      <SafeAreaView style={styles.splashRoot}>
        <View style={styles.splashCard}>
          <View style={styles.splashLogoBadge}>
            <Text style={styles.splashLogoIcon}>▲▲</Text>
          </View>
          <Text style={styles.splashBrand}>NER LOGISTICS</Text>
          <Text style={styles.splashTitle}>DRIVER COMMAND</Text>
          <Text style={styles.splashSubtitle}>Restoring secure driver session…</Text>
          <View style={styles.splashLoadingRow}>
            <ActivityIndicator size="small" color="#22C55E" />
            <Text style={styles.splashLoadingText}>Verifying credentials</Text>
          </View>
        </View>
        <Text style={styles.splashMotto}>Safe Routes. Stronger India.</Text>
      </SafeAreaView>
    )
  }

  return driver ? (
    <Signed />
  ) : (
    <SafeAreaView style={styles.flex}>
      <LoginScreen />
    </SafeAreaView>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style="light" />
        <AuthProvider>
          <AppLanguageProvider>
            <Gate />
          </AppLanguageProvider>
        </AuthProvider>
      </View>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1, backgroundColor: COLORS.bg },
  centre: { flex: 1, justifyContent: 'center', backgroundColor: COLORS.bg },

  splashRoot: {
    flex: 1,
    backgroundColor: '#0B1016',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  splashCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  splashLogoBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#0F172A',
    borderWidth: 2,
    borderColor: '#22C55E',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  splashLogoIcon: {
    color: '#22C55E',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -2,
  },
  splashBrand: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
  },
  splashTitle: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 2,
  },
  splashSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
  splashLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
  },
  splashLoadingText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  splashMotto: {
    position: 'absolute',
    bottom: 32,
    color: '#475569',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  headerText: { flexShrink: 1 },
  brand: {
    color: COLORS.accent,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  name: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  licence: { color: COLORS.faint, fontSize: 12, marginTop: 1 },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  langToggle: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#111827',
  },
  langToggleText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
  },
  langModalBanner: {
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    padding: 12,
    gap: 8,
  },
  langModalTitle: {
    color: COLORS.faint,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  langModalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  langModalChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  langModalChipActive: {
    borderColor: COLORS.accent,
    backgroundColor: '#0c4a6e',
  },
  langModalChipText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  langModalChipTextActive: {
    color: '#38bdf8',
    fontWeight: '800',
  },

  tabs: {
    flexDirection: 'row',
    gap: 6,
    borderTopWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabActive: {
    backgroundColor: COLORS.soft,
    borderColor: COLORS.accent,
  },
  tabIcon: {
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  tabLabel: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: COLORS.accent,
    fontWeight: '700',
  },
})
