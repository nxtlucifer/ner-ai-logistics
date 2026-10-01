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
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import {
  ActivityIndicator,
  Image,
  Text,
  View,
} from 'react-native'

import { AuthProvider, useAuth } from './src/auth/AuthProvider'
import { AppLanguageProvider, useAppLanguage } from './src/i18n/AppLanguageProvider'
import { useT } from './src/i18n/tx'
import { type TranslationKey } from './src/i18n/appLanguage'
import AssistantScreen from './src/screens/AssistantScreen'
import AssignmentScreen from './src/screens/AssignmentScreen'
import MoreScreen from './src/screens/MoreScreen'
import TutorialScreen, { tutorialSeen } from './src/screens/TutorialScreen'
import MyDetailsScreen from './src/screens/MyDetailsScreen'
import LoginScreen from './src/screens/LoginScreen'
import MapScreen from './src/screens/MapScreen'
import SafetyScreen from './src/screens/SafetyScreen'
import TripScreen from './src/screens/TripScreen'
import * as Notifications from 'expo-notifications'

import { TABS, type Tab } from './src/navigation'
import { registerPush, screenFromResponse } from './src/notify/push'
import ManagerRoot from './src/manager/ManagerRoot'
import { Icon } from './src/components/icons'
import { FloatingTabBar, StatusChip, TopInset } from './src/components/scenic'
import { useKeyboardOpen } from './src/components/useKeyboardOpen'
import { refreshProfilePhoto, useProfilePhotoUrl } from './src/files/profilePhoto'
import { useAuthImage } from './src/files/useAuthImage'
import { TripProvider } from './src/trip/TripProvider'
import { useGpsStatus } from './src/map/useGpsStatus'
import { ThemeProvider, makeStyles, useTheme } from './src/theme-context'

const TAB_TRANSLATIONS: Record<Tab, TranslationKey> = {
  navigate: 'nav_navigate',
  trip: 'nav_trip',
  safety: 'nav_safety',
  more: 'nav_more',
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

/** The GPS state as a hero chip: dot AND word, never state by colour alone.
 *  Not pressable. Every screen's hero carries one (audit s16.2), so the shell
 *  has no header of its own any more.
 *  - `browse`: More and its sub-screens read the phone's GPS the way Navigate
 *    does (useGpsStatus), so they cannot disagree.
 *  - not `browse`: the Trip tab reads the tracker only - no watch of its own on
 *    the landing tab - and an idle tracker says "Not tracking". */
function GpsChip({ browse }: { browse: boolean }) {
  const status = useGpsStatus(browse)
  return <StatusChip text={status.text} tone={status.live ? 'live' : 'off'} />
}

function SignedShell() {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const { driver, supportView } = useAuth()
  const { t } = useAppLanguage()
  const tr = useT()
  const initials = (driver?.full_name ?? 'Driver')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  const [tab, setTab] = useState<Tab>('trip')
  // Safety's stop-request tool lands on this control, not the top of Trip.
  const [tripFocus, setTripFocus] = useState<'stop-request' | null>(null)
  const [showAssistant, setShowAssistant] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)
  // Null while the stored flag is being read. Rendering the tour before
  // the answer arrives would flash it at a driver who dismissed it weeks
  // ago, every single launch.
  const [firstRun, setFirstRun] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    void tutorialSeen().then((seen) => {
      if (!live) return
      setFirstRun(!seen)
      if (!seen) setShowTutorial(true)
    })
    return () => {
      live = false
    }
  }, [])
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
  // The Navigate map's full screen hides the tab bar; Exit or Back brings it back.
  const [mapFull, setMapFull] = useState(false)
  // Every screen draws its own photo hero with a GPS chip (Navigate's reads
  // the map's own fix), so the shell has no header. The driver's photo - else
  // initials, never a stock face next to a real name - rides in Trip's hero.
  const avatar = (
    <View style={styles.avatar}>
      {photo ? (
        <Image source={{ uri: photo }} style={styles.avatarImage} accessibilityLabel="Your photo" />
      ) : (
        <Text style={styles.avatarText} accessible={false}>{initials}</Text>
      )}
    </View>
  )
  const tripChip = <GpsChip browse={false} />
  const moreChip = <GpsChip browse />
  // The bar steps aside while the soft keyboard is up (B3D-R03), as a tab
  // bar does on Android: it sat over the field being typed into.
  const keyboardOpen = useKeyboardOpen()
  const topInset = useSafeAreaInsets().top

  return (
    // No top edge: every screen's photo hero runs under the status bar and
    // moves its own chips and text down by `TopInset` (ScreenHero,
    // CERT-DRV-08). The support banner has no photo, so with it the shell
    // keeps the top edge and the screens get 0.
    <SafeAreaView style={styles.flex} edges={supportView ? undefined : ['left', 'right', 'bottom']}>
      <TopInset.Provider value={supportView ? 0 : topInset}>
        {supportView ? (
          <View style={styles.supportBanner} accessibilityRole="alert">
            <Icon name="eye" color={COLORS.warning} size={16} />
            <Text style={styles.supportBannerText}>{tr('MANAGER SUPPORT VIEW · read-only')}</Text>
          </View>
        ) : null}
        <View style={styles.flex}>
          {tab === 'navigate' ? (
            <MapScreen
              onBack={() => setTab('trip')}
              onFullscreenChange={setMapFull}
              // The Trip tab's own gate path: the truck check it opens.
              onCheckTruck={() => {
                setShowAssignment(true)
                setTab('trip')
              }}
            />
          ) : null}
          {!showTutorial && tab === 'trip' && !showAssignment ? (
            <TripScreen
              onOpenMap={() => setTab('navigate')}
              onCheckTruck={() => setShowAssignment(true)}
              focus={tripFocus}
              onFocused={() => setTripFocus(null)}
              status={tripChip}
              avatar={avatar}
            />
          ) : null}
          {!showTutorial && tab === 'trip' && showAssignment ? (
            <AssignmentScreen onBack={() => setShowAssignment(false)} status={tripChip} />
          ) : null}
          {tab === 'safety' ? (
            <SafetyScreen
              onOpenTrip={() => {
                setShowAssignment(false)
                setTripFocus('stop-request')
                setTab('trip')
              }}
              onOpenNavigate={() => setTab('navigate')}
              onOpenDetails={() => {
                setShowAssistant(false)
                setShowDetails(true)
                setTab('more')
              }}
              onOpenAssistant={() => {
                setShowDetails(false)
                setShowAssistant(true)
                setTab('more')
              }}
            />
          ) : null}
          {showTutorial ? (
            <TutorialScreen
              // The chip of the screen it opened over: More's when reopened
              // from More (both read the phone's GPS), the tracker's on first
              // run, so one path never shows two wordings (B3D-R09).
              status={firstRun === true ? tripChip : moreChip}
              firstRun={firstRun === true}
              onDone={() => {
                setShowTutorial(false)
                setFirstRun(false)
              }}
            />
          ) : null}
          {!showTutorial && tab === 'more' && !showAssistant && showDetails ? (
            <MyDetailsScreen onBack={() => setShowDetails(false)} status={moreChip} />
          ) : null}
          {!showTutorial && tab === 'more' && !showAssistant && !showDetails ? (
            <MoreScreen
              onOpenAssistant={() => setShowAssistant(true)}
              onOpenDetails={() => setShowDetails(true)}
              onOpenTutorial={() => setShowTutorial(true)}
              status={moreChip}
            />
          ) : null}
          {!showTutorial && tab === 'more' && showAssistant ? (
            // The assistant's own hand-offs land on real tabs. Without these
            // its "Open Safety" chip would be a button that did nothing, and
            // there was no way back out of the screen except leaving More.
            <AssistantScreen
              status={moreChip}
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

        {keyboardOpen || (tab === 'navigate' && mapFull) ? null : (
          <FloatingTabBar
            tabs={TABS}
            active={tab}
            onSelect={(value) => {
              if (value !== 'more') setShowAssistant(false)
              setTripFocus(null)
              setTab(value)
            }}
            label={(value) => t(TAB_TRANSLATIONS[value])}
          />
        )}
      </TopInset.Provider>
    </SafeAreaView>
  )
}

function Gate() {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const { driver, user, isInitialising } = useAuth()
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

  // The SERVER's role picks the shell: a driver profile -> the driver app; a
  // manager/admin identity -> the manager shell. Never a selector, never a
  // cached screen. A signed-in user with neither (a suspended driver) is
  // shown the login again rather than a half-shell.
  if (driver) return <Signed />
  if (user && user.role !== 'DRIVER') return <ManagerRoot />
  // The login follows the driver's stored Light/Dark choice like every other
  // screen. It used to be pinned to Light, which flashed a light page at a
  // driver who had chosen Dark every time they signed out.
  // The status bar is Root's, which follows the theme. The photo runs
  // full-bleed under it; LoginScreen insets its own content.
  return <LoginScreen />
}

/** Inside the provider, so the root surface and the status bar can both follow
 *  the palette. `App` itself renders the provider and therefore cannot read it. */
function Root() {
  const styles = useStyles()
  const { mode } = useTheme()
  return (
    <View style={styles.root}>
      {/* Dark glyphs on the Light ground, light glyphs on Dark. A fixed
          style="light" left the clock invisible in Light. */}
      <StatusBar style={mode === 'light' ? 'dark' : 'light'} />
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
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    shadowColor: COLORS.shadow,
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
    color: COLORS.brand,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 2,
  },
  splashSubtitle: {
    color: COLORS.textMuted,
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
    color: COLORS.textFaint,
    fontSize: 12,
    fontWeight: '600',
  },
  splashMotto: {
    position: 'absolute',
    bottom: 32,
    color: COLORS.textDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },

  supportBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.warningSoft, borderBottomWidth: 1, borderBottomColor: COLORS.warningBorder, paddingVertical: 6, paddingHorizontal: 12 },
  supportBannerText: { color: COLORS.warning, fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  // The Trip hero's avatar: 48 dp on the chip row, ringed in the surface
  // colour so it holds its own against the photo in both themes.
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.surface,
    // A 3:1 ring, so the disc holds its shape on a dark or bright photo.
    borderWidth: 2,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarText: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  avatarImage: { width: 44, height: 44, borderRadius: 22 },

}))
