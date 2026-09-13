/**
 * NER Driver App - Terrain Command.
 *
 * Bottom navigation, left to right:
 *   - TRIP:     the job. Accept, truck check, stops, completion. The landing tab.
 *   - NAVIGATE: map-first guidance over the manager-selected route, with the
 *               Route Monitor reading the same deterministic risk engine the
 *               fleet console reads.
 *   - SAFETY:   live route conditions above bundled offline guidance, and the
 *               emergency numbers.
 *   - MORE:     assistant, language, theme, sign out.
 *
 * The assistant under MORE is deterministic and offline - it answers from this
 * phone's own state, with no model in the loop. It is not a generative
 * assistant and must not be described as one.
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
import AssignmentScreen from './src/screens/AssignmentScreen'
import MoreScreen from './src/screens/MoreScreen'
import MyDetailsScreen from './src/screens/MyDetailsScreen'
import LoginScreen from './src/screens/LoginScreen'
import MapScreen from './src/screens/MapScreen'
import SafetyScreen from './src/screens/SafetyScreen'
import TripScreen from './src/screens/TripScreen'
import { TABS, type Tab } from './src/navigation'
import { MoreIcon, NavigateIcon, SafetyIcon, TripIcon } from './src/components/icons'
import { TripProvider, useTrip } from './src/trip/TripProvider'
import { TOUCH_TARGET } from './src/theme'
import { ThemeProvider, makeStyles, useTheme } from './src/theme-context'

const TAB_TRANSLATIONS: Record<Tab, TranslationKey> = {
  navigate: 'nav_navigate',
  trip: 'nav_trip',
  safety: 'nav_safety',
  more: 'nav_more',
}

/** One tab's glyph. Colour is passed in so the active tab can tint. */
function TabIcon({ tab, color }: { tab: Tab; color: string }) {
  if (tab === 'navigate') return <NavigateIcon color={color} size={21} />
  if (tab === 'trip') return <TripIcon color={color} size={21} />
  if (tab === 'safety') return <SafetyIcon color={color} size={21} />
  return <MoreIcon color={color} size={21} />
}

/** `Signed` renders TripProvider, so it cannot read it. The header needs live
 *  tracking state, so the whole signed-in shell moved inside the provider and
 *  `Signed` is now just the boundary. Same shape of mistake as App/Theme. */
function Signed() {
  return (
    <TripProvider>
      <SignedShell />
    </TripProvider>
  )
}

function SignedShell() {
  const styles = useStyles()
  const { colors: COLORS, mode, toggle } = useTheme()
  const { driver, logout } = useAuth()
  const { tracking, isStale } = useTrip()
  const { language, setLanguage, t } = useAppLanguage()
  const isLive = Boolean(tracking?.isTracking) && !isStale
  /**
   * What the dot actually measures.
   *
   * It was "Online"/"Offline", which is a claim about the NETWORK - and it read
   * "Offline" on a phone that had just loaded the trip from the server, because
   * the flag behind it is the GPS watch, not connectivity. Three words for
   * three real states: the watch is off, it is running but the last fix has
   * gone stale, or it is live. Stale is not off, and neither is a decision the
   * driver has not made yet: location sharing starts with the trip.
   */
  const gpsLabel = !tracking?.isTracking ? 'GPS off' : isStale ? 'GPS stale' : 'GPS live'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const initials = (driver?.full_name ?? 'Driver')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  const [tab, setTab] = useState<Tab>('trip')
  const [showLangModal, setShowLangModal] = useState(false)
  const [showAssistant, setShowAssistant] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [showAssignment, setShowAssignment] = useState(false)

  return (
    <SafeAreaView style={styles.flex}>
        {tab !== 'navigate' ? (
          <View style={styles.header}>
            <View style={styles.identity}>
              {/* Initials, not a photo: the driver record carries no avatar
                  URL, and a stock face would be a stranger's picture next to
                  a real person's name. */}
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
              <View style={styles.headerText}>
                <Text style={styles.greeting} numberOfLines={1}>{greeting},</Text>
                <Text style={styles.name} numberOfLines={1}>
                  {driver?.full_name ?? 'Driver'}
                </Text>
                <View style={styles.identityMeta}>
                  {/* Dot AND word - never state by colour alone. */}
                  <View style={[styles.liveDot, !isLive && styles.liveDotOff]} />
                  <Text style={styles.licence} numberOfLines={1}>
                    {gpsLabel} · {driver?.licence_number ?? 'Driver'}
                  </Text>
                </View>
              </View>
            </View>
            <View style={styles.headerActions}>
              {/* Real toggle, not a decoration: it swaps the palette that every
                  converted stylesheet is built from, with no reload. Labelled
                  with a word rather than only a glyph so its state is readable
                  without relying on icon recognition. */}
              <Pressable
                onPress={toggle}
                style={styles.langToggle}
                accessibilityRole="button"
                accessibilityLabel={
                  mode === 'day' ? 'Switch to night theme' : 'Switch to day theme'
                }
              >
                <Text style={styles.langToggleText}>{mode === 'day' ? 'Day' : 'Night'}</Text>
              </Pressable>
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
                {/* Code, not the native name. "English"/"অসমীয়া" ran to 66pt
                    and, with the theme and sign-out controls beside it, left
                    the driver's own name with ~70pt and truncated to "Ritur…". */}
                <Text style={styles.langToggleText}>
                  {(language ?? 'en').toUpperCase()}
                </Text>
              </Pressable>
              {/* Was the shared Button at 107pt wide. Compact square with an
                  accessibility label: the three header controls together were
                  consuming 220 of 390pt. The glyph is drawn from two Views,
                  not an emoji, for the reason icons.tsx documents. */}
              <Pressable
                onPress={() => void logout()}
                style={styles.iconBtn}
                accessibilityRole="button"
                accessibilityLabel={t('btn_sign_out')}
              >
                <View style={styles.exitDoor} />
                <View style={styles.exitArrow} />
              </Pressable>
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
          {tab === 'trip' && !showAssignment ? (
            <TripScreen onOpenMap={() => setTab('navigate')} onCheckTruck={() => setShowAssignment(true)} />
          ) : null}
          {tab === 'trip' && showAssignment ? (
            <AssignmentScreen onBack={() => setShowAssignment(false)} />
          ) : null}
          {tab === 'safety' ? <SafetyScreen /> : null}
          {tab === 'more' && !showAssistant && showDetails ? (
            <MyDetailsScreen onBack={() => setShowDetails(false)} />
          ) : null}
          {tab === 'more' && !showAssistant && !showDetails ? (
            <MoreScreen onOpenAssistant={() => setShowAssistant(true)} onOpenDetails={() => setShowDetails(true)} />
          ) : null}
          {tab === 'more' && showAssistant ? (
            // The assistant's own hand-offs land on real tabs. Without these
            // its "Open Safety" chip would be a button that did nothing, and
            // there was no way back out of the screen except leaving More.
            <AssistantScreen
              onBack={() => setShowAssistant(false)}
              onOpenTrip={() => {
                setShowAssistant(false)
                setTab('trip')
              }}
              onOpenSafety={() => {
                setShowAssistant(false)
                setTab('safety')
              }}
            />
          ) : null}
        </View>

        <View style={styles.tabs}>
          {TABS.map((value) => (
            <Pressable
              key={value}
              onPress={() => {
                if (value !== 'more') setShowAssistant(false)
                setTab(value)
              }}
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
  )
}

function Gate() {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
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
            <ActivityIndicator size="small" color={COLORS.accent} />
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
    // LOGIN IS ALWAYS DAY. Pinned here, not in the screen, so every styled
    // child (inputs, banners, the language chooser) follows without knowing.
    <ThemeProvider fixed="day">
      <LoginSurface />
    </ThemeProvider>
  )
}

/** The login page on its own day-mode surface, with the status bar to match. */
function LoginSurface() {
  const styles = useStyles()
  return (
    <SafeAreaView style={styles.flex}>
      <StatusBar style="dark" />
      <LoginScreen />
    </SafeAreaView>
  )
}

/** Inside the provider, so the root surface and the status bar can both follow
 *  the palette. `App` itself renders the provider and therefore cannot read it. */
function Root() {
  const styles = useStyles()
  const { mode } = useTheme()
  return (
    <View style={styles.root}>
      {/* Dark glyphs on the light day ground, light on night. A fixed
          style="light" left the clock invisible in day mode. */}
      <StatusBar style={mode === 'day' ? 'dark' : 'light'} />
      <AuthProvider>
        <AppLanguageProvider>
          <Gate />
        </AppLanguageProvider>
      </AuthProvider>
    </View>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Root />
      </ThemeProvider>
    </SafeAreaProvider>
  )
}

const useStyles = makeStyles((COLORS) => ({
  root: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1, backgroundColor: COLORS.bg },
  centre: { flex: 1, justifyContent: 'center', backgroundColor: COLORS.bg },

  splashRoot: {
    flex: 1,
    backgroundColor: COLORS.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  splashCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    backgroundColor: COLORS.sunken,
    borderWidth: 2,
    borderColor: COLORS.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  splashLogoIcon: {
    color: COLORS.accent,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -2,
  },
  splashBrand: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
  },
  splashTitle: {
    color: COLORS.aqua,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 2,
  },
  splashSubtitle: {
    color: COLORS.muted,
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
    color: COLORS.faint,
    fontSize: 12,
    fontWeight: '600',
  },
  splashMotto: {
    position: 'absolute',
    bottom: 32,
    color: COLORS.dim,
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
  // flex:1 + minWidth:0, not flexShrink alone. With only flexShrink the text
  // block refused to go below its content width, so at 390pt the row overran
  // the screen and clipped "Sign Out" off the right edge.
  identity: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.raised,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  greeting: { color: COLORS.muted, fontSize: 12, fontWeight: '600' },
  identityMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.ok },
  liveDotOff: { backgroundColor: COLORS.faint },
  headerText: { flex: 1, minWidth: 0 },
  brand: {
    // Brand mint, not action mint. An eyebrow that reads in the same colour as
    // every button on the screen is claiming to be tappable.
    color: COLORS.aqua,
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
    flexShrink: 0,
  },
  langToggle: {
    // `raised`, not `card`: this chip sits ON the header, which is itself
    // `card` — so it was previously located entirely by its 1px hairline.
    // minHeight matches the sign-out Button beside it. At paddingVertical 6
    // this control was ~26dp tall: half the driver touch target, on the one
    // screen element a driver who cannot read the current language needs to
    // hit first, in a moving cab.
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.raised,
  },
  iconBtn: {
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.raised,
  },
  exitDoor: {
    width: 13,
    height: 17,
    borderWidth: 2,
    borderRightWidth: 0,
    borderColor: COLORS.text,
    borderTopLeftRadius: 2,
    borderBottomLeftRadius: 2,
  },
  exitArrow: {
    position: 'absolute',
    right: 15,
    width: 9,
    height: 2,
    backgroundColor: COLORS.text,
  },
  langToggleText: {
    color: COLORS.aqua,
    fontSize: 12,
    fontWeight: '700',
  },
  langModalBanner: {
    backgroundColor: COLORS.sunken,
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
    backgroundColor: COLORS.okBg,
  },
  langModalChipText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  langModalChipTextActive: {
    color: COLORS.aqua,
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
}))
