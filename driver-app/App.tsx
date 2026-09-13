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

import { useEffect, useState } from 'react'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { api } from './src/api/client'
import { AuthProvider, useAuth } from './src/auth/AuthProvider'
import { Button, Loading } from './src/components/ui'
import { AppLanguageProvider, useAppLanguage } from './src/i18n/AppLanguageProvider'
import { useT } from './src/i18n/tx'
import { type TranslationKey } from './src/i18n/appLanguage'
import AssistantScreen from './src/screens/AssistantScreen'
import AssignmentScreen from './src/screens/AssignmentScreen'
import MoreScreen from './src/screens/MoreScreen'
import MyDetailsScreen from './src/screens/MyDetailsScreen'
import LoginScreen from './src/screens/LoginScreen'
import MapScreen from './src/screens/MapScreen'
import SafetyScreen from './src/screens/SafetyScreen'
import TripScreen from './src/screens/TripScreen'
import * as Notifications from 'expo-notifications'

import { TABS, type Tab } from './src/navigation'
import { registerPush, screenFromResponse } from './src/notify/push'
import { Icon, MoreIcon, NavigateIcon, SafetyIcon, TripIcon } from './src/components/icons'
import { refreshProfilePhoto, useProfilePhotoUrl } from './src/files/profilePhoto'
import { useAuthImage } from './src/files/useAuthImage'
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
  // The heading arrow sits in a ring, as it does on the map's own controls.
  if (tab === 'navigate') {
    return (
      <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <NavigateIcon color={color} size={13} />
      </View>
    )
  }
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
  const { driver, supportView } = useAuth()
  const { tracking, isStale } = useTrip()
  const { t } = useAppLanguage()
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
  const tr = useT()
  const gpsLabel = tr(!tracking?.isTracking ? 'GPS off' : isStale ? 'GPS stale' : 'GPS live')
  const hour = new Date().getHours()
  const greeting = tr(hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening')
  const initials = (driver?.full_name ?? 'Driver')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  const [tab, setTab] = useState<Tab>('trip')
  const [showAssistant, setShowAssistant] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  // One photo source for every avatar (files/profilePhoto.ts); seeded once
  // here, updated by My details when a photo is uploaded.
  useEffect(refreshProfilePhoto, [])
  // Remote push: register this phone once per sign-in, and open the screen a
  // tapped notification names. Every outcome is a logged state, never a crash.
  useEffect(() => {
    registerPush().then((r) => console.log('[push]', r.status, r.reason ?? '')).catch(() => {})
    const isTab = (s: string | null): s is Tab => s !== null && (TABS as readonly string[]).includes(s)
    Notifications.getLastNotificationResponseAsync().then((res) => {
      const s = screenFromResponse(res)
      if (isTab(s)) setTab(s)
    }).catch(() => {})
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const s = screenFromResponse(res)
      if (isTab(s)) setTab(s)
    })
    return () => sub.remove()
  }, [])
  const photo = useAuthImage(useProfilePhotoUrl())
  const [showAssignment, setShowAssignment] = useState(false)

  return (
    <SafeAreaView style={styles.flex}>
        {supportView ? (
          <View style={styles.supportBanner} accessibilityRole="alert">
            <Icon name="eye" color="#7A5B12" size={16} />
            <Text style={styles.supportBannerText}>{tr('MANAGER SUPPORT VIEW · read-only')}</Text>
          </View>
        ) : null}
        {tab !== 'navigate' ? (
          <View style={styles.header}>
            <View style={styles.identity}>
              {/* The driver's own photo (My details), else initials - never a
                  stock face next to a real person's name. */}
              <View style={styles.avatar}>
                {photo ? (
                  <Image source={{ uri: photo }} style={styles.avatarImage} accessibilityLabel="Your photo" />
                ) : (
                  <Text style={styles.avatarText}>{initials}</Text>
                )}
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
                <Text style={styles.langToggleText}>{tr(mode === 'day' ? 'Day' : 'Night')}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}


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
  const tr = useT()

  if (isInitialising) {
    return (
      <SafeAreaView style={styles.splashRoot}>
        <View style={styles.splashCard}>
          <Image source={require('./assets/brand-mark.png')} style={styles.splashLogoBadge} accessibilityLabel="RASTA AI" />
          <Text style={styles.splashBrand}>NER LOGISTICS</Text>
          <Text style={styles.splashTitle}>RASTA AI</Text>
          <Text style={styles.splashSubtitle}>{tr('Restoring your session…')}</Text>
          <View style={styles.splashLoadingRow}>
            <ActivityIndicator size="small" color={COLORS.accent} />
            <Text style={styles.splashLoadingText}>{tr('Verifying credentials')}</Text>
          </View>
        </View>
        <Text style={styles.splashMotto}>{tr('Safer logistics through difficult corridors.')}</Text>
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
  splashLogoBadge: { width: 48, height: 48, borderRadius: 14, marginBottom: 14 },
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

  supportBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FDE68A', paddingVertical: 6, paddingHorizontal: 12 },
  supportBannerText: { color: '#7A5B12', fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
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
  avatarImage: { width: 40, height: 40, borderRadius: 20 },
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
  langToggleText: {
    color: COLORS.aqua,
    fontSize: 12,
    fontWeight: '700',
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
