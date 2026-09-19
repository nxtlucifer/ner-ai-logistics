/**
 * The redesign's shared driver chrome (Phase B1), drawn from the four driver
 * references: ScreenHero, RowCard, IconDisc, PhotoCredit, ImageCreditsSheet,
 * MountainBand and FloatingTabBar.
 *
 * Every colour is a palette token and nothing here asks which theme is
 * showing: Light and Dark differ only in the token values (theme.ts).
 *
 * THE COLOUR RULE HOLDS HERE TOO: green = action, blue = route, amber =
 * caution, red = emergency. A disc takes one of those tones only when the row
 * means it; everything else is `neutral`. The references' lavender and beige
 * discs are not reproduced, because a hue that means nothing next to hues
 * that do is noise a driver has to learn to ignore.
 */
import { Fragment, createContext, useContext, useState, type ReactNode } from 'react'
import {
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'

import { useT } from '../i18n/tx'
import type { Tab } from '../navigation'
import { TOUCH_TARGET, type Palette } from '../theme'
import { makeStyles, useTheme } from '../theme-context'
import { Icon, type IconName } from './icons'
import { LICENCE_URL, PHOTOS, type PhotoCredit as Photo } from './photoCredits'

/** A CSS linear-gradient as a View background: React Native's new
 *  architecture paints `experimental_backgroundImage`, react-native-web maps
 *  `backgroundImage` to CSS. */
export function gradient(css: string): ViewStyle {
  return (Platform.OS === 'web' ? { backgroundImage: css } : { experimental_backgroundImage: css }) as ViewStyle
}

const openUrl = (url: string) => {
  Linking.openURL(url).catch(() => {})
}

/* --- IconDisc ------------------------------------------------------------ */

export type Tone = 'action' | 'route' | 'caution' | 'emergency' | 'neutral'

function toneColours(c: Palette, tone: Tone): { fill: string; ink: string } {
  switch (tone) {
    case 'action': return { fill: c.discAction, ink: c.success }
    case 'route': return { fill: c.infoSoft, ink: c.info }
    case 'caution': return { fill: c.warningSoft, ink: c.warning }
    case 'emergency': return { fill: c.dangerSoft, ink: c.danger }
    default: return { fill: c.discNeutral, ink: c.text }
  }
}

export function IconDisc({ icon, tone = 'neutral', size = 52 }: { icon: IconName; tone?: Tone; size?: number }) {
  const { colors } = useTheme()
  const { fill, ink } = toneColours(colors, tone)
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: fill, alignItems: 'center', justifyContent: 'center' }}
      accessible={false}
    >
      <Icon name={icon} size={Math.round(size * 0.44)} color={ink} />
    </View>
  )
}

/** A status word on its tone's tint: the disc colours as a pill, so a trip or
 *  a document state follows the same hue rule as every disc. The word carries
 *  the state; the colour only repeats it. */
export function StatusPill({ text, tone = 'neutral' }: { text: string; tone?: Tone }) {
  const { colors } = useTheme()
  const { fill, ink } = toneColours(colors, tone)
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: fill }} testID="status-pill">
      <Text style={{ color: ink, fontSize: 11, fontWeight: '800', letterSpacing: 0.4 }} numberOfLines={1}>{text}</Text>
    </View>
  )
}

/** One look per emergency number wherever the list is drawn (Safety, Trip):
 *  108 is an ambulance, so emergency red; 1033 is the highway helpline, not
 *  an emergency, so neutral; 112 is the one strong tile, drawn by its screen
 *  (B3D-R10). */
export function emergencyNumberLook(number: string): { icon: IconName; tone: Tone } {
  if (number === '108') return { icon: 'plus-square', tone: 'emergency' }
  if (number === '112') return { icon: 'phone', tone: 'emergency' }
  return { icon: number === '1033' ? 'truck' : 'phone', tone: 'neutral' }
}

/* --- RowCard ------------------------------------------------------------- */

export function RowCard({
  icon,
  tone = 'neutral',
  title,
  subtitle,
  value,
  onPress,
  accessibilityLabel,
  testID,
}: {
  icon: IconName
  tone?: Tone
  title: string
  subtitle?: string
  /** The current setting, shown before the chevron (Theme: Light). */
  value?: string
  onPress: () => void
  accessibilityLabel?: string
  testID?: string
}) {
  const styles = useStyles()
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <IconDisc icon={icon} tone={tone} size={56} />
      <View style={styles.rowText}>
        {/* Room to wrap at a large font scale: one line cut "How RASTA
            Wo…" and two cut the theme's line at 1.5 (CERT-DRV-04). */}
        <Text style={styles.rowTitle} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub} numberOfLines={3}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      <Icon name="chevron-right" size={20} color={colors.textMuted} />
    </Pressable>
  )
}

/* --- PhotoCredit ---------------------------------------------------------- */

/** The "Photo credits" control every photo carries (owner decision 5, 29 Sep
 *  2026): a small info disc with no text on the photo, so no credit can run
 *  into a headline, a map or a control. It opens the credits sheet with this
 *  photo first: subject, author, licence, source page and licence links. The
 *  disc is small; the pressable around it is a full touch target. */
export function PhotoCredit({ photo, style }: { photo: Photo; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles()
  const { colors } = useTheme()
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('Photo credits')}
        testID="photo-credits"
        style={[styles.creditHit, style]}
      >
        <View style={styles.creditPlate}>
          <Icon name="info" size={14} color={colors.onPhoto} />
        </View>
      </Pressable>
      {/* Mounted only while open: a hidden Modal per photo is not free. */}
      {open ? <ImageCreditsSheet open onClose={() => setOpen(false)} first={photo} /> : null}
    </>
  )
}

/* --- CoverPhoto ------------------------------------------------------------ */

/** A photo filling its box, cropped to cover. The explicit 100% size is the
 *  point: react-native-web sizes an Image from its asset's own pixels unless
 *  told otherwise, so an edge-pinned photo rendered at 1080 px wide and showed
 *  its top-left corner. Decorative: photos never carry information. */
export function CoverPhoto({ photo }: { photo: Photo }) {
  const styles = useStyles()
  return <Image source={photo.source()} style={styles.photo} resizeMode="cover" accessible={false} />
}

/* --- ScreenHero ------------------------------------------------------------ */

/** The status bar's height, provided by the shell (App.tsx), which leaves
 *  the top edge to the screens (CERT-DRV-08): a hero's photo runs under the
 *  status bar and its chips and text move down by this. 0 when not provided. */
export const TopInset = createContext(0)
export const useTopInset = () => useContext(TopInset)

/** Room under a hero's text for the foot credit: its 48 dp target is centred
 *  on the plate, so the plate's top sits ~34 dp (~36 at font scale 1.3)
 *  above `overlap`. */
const CREDIT_ROOM = 40

/** Photo, large title, subtitle, a status slot (the GPS chip) and an optional
 *  theme chip. The veil sits only where the title does (a pale morning veil
 *  under dark ink in Light, as driver_04; black under white ink in Dark), and
 *  Dark adds a neutral veil over the whole photo. `overlap` is how far the content below rides up
 *  over the rounded bottom edge, as in the references. `compact` is
 *  driver_02's short strip (Navigate): the title sits just under the chips
 *  and the subtitle keeps to one line, so the search field can ride up over
 *  the foot. `height` sets the full-size hero's height. `leading` sits at
 *  the start of the chip row: a sub-screen's way back (HeroBack), or the Trip
 *  tab's avatar. `creditAt` moves a compact hero's credit from under the chips
 *  (Navigate, a one-word title) to the foot, where a sub-screen's longer title
 *  cannot run under it; the subtitle then has the full width. With
 *  `creditAt="bottom"` the text is laid out in flow above the credit and the
 *  hero grows past `height` when it must: at a large font scale the subtitle
 *  ran into the credit plate (B3D-R02), and may now wrap instead. */
export function ScreenHero({
  photo,
  title,
  subtitle,
  status,
  themeChip = false,
  overlap = 26,
  compact = false,
  height,
  leading,
  creditAt,
}: {
  photo: Photo
  title: string
  subtitle?: string
  status?: ReactNode
  /** `'icon'`: the 48 dp round form, for a sub-screen whose chip row also
   *  carries a back pill and the GPS chip - on a 360 dp phone the worded
   *  chip cut the back pill to "M…". */
  themeChip?: boolean | 'icon'
  overlap?: number
  compact?: boolean
  height?: number
  leading?: ReactNode
  creditAt?: 'top' | 'bottom'
}) {
  const styles = useStyles()
  const { colors } = useTheme()
  const footCredit = creditAt ? creditAt === 'bottom' : !compact
  const flow = creditAt === 'bottom'
  // Navigate: the credit shares the title's line while both fit. At a large
  // font scale it wraps under the title instead of running into it
  // (CERT-DRV-03), and the hero grows rather than covering its own text.
  const inlineCredit = compact && !footCredit
  const inset = useTopInset()
  const base = (height ?? (compact ? 158 : 272)) + inset
  const textTop = (compact ? 64 : 82) + inset
  return (
    <View style={[styles.hero, flow || inlineCredit ? { height: 'auto', minHeight: base } : { height: base }]}>
      <CoverPhoto photo={photo} />
      <View style={[styles.fill, styles.passThrough, { backgroundColor: colors.imageDim }]} />
      {/* Stops in px, not %: the title block sits a fixed 28-198 px from the
          left, so its veil must not thin out on a narrow screen. At 100deg a
          point (x, y) lies about 0.985x + 0.17(y - H/2) + 24 px along the
          line, so the subtitle's far corner (198, 170) is at ~225 px: inside
          the full-strength veil on every width. */}
      <View
        style={[
          styles.fill,
          styles.passThrough,
          gradient(`linear-gradient(100deg, ${colors.heroVeil} 0px, ${colors.heroVeil} 232px, transparent 360px)`),
        ]}
      />
      <View style={[styles.heroTop, { top: 14 + inset }]}>
        {leading ? <View style={styles.heroLead}>{leading}</View> : null}
        {status}
        {themeChip ? <ThemeChip iconOnly={themeChip === 'icon'} /> : null}
      </View>
      <View
        style={[
          styles.heroText,
          { top: textTop },
          // In flow: the chips' 14 + 48 above, the credit's room below.
          flow && { position: 'relative', top: 0, left: 0, right: 0, marginTop: textTop, marginHorizontal: 28, marginBottom: overlap + CREDIT_ROOM },
          // In flow, ending where the absolute block ended (158 = 64 + 37 +
          // 21 + 36 at scale 1), so the hero is the same height until the
          // text needs more.
          inlineCredit && { position: 'relative', top: 0, left: 0, right: 0, marginTop: textTop, marginLeft: 28, marginRight: 14, marginBottom: overlap + 10 },
        ]}
      >
        {inlineCredit ? (
          <View style={styles.heroTitleRow}>
            {/* The title in a box of its own: the credit beside it is not
                part of the heading's text block. */}
            <View style={styles.heroTitleBox}>
              <Text style={styles.heroTitle} accessibilityRole="header" numberOfLines={1}>{title}</Text>
            </View>
            <PhotoCredit photo={photo} style={styles.heroCreditInline} />
          </View>
        ) : (
          <Text style={styles.heroTitle} accessibilityRole="header" numberOfLines={1}>{title}</Text>
        )}
        {subtitle ? (
          <Text style={[styles.heroSubtitle, compact && styles.heroSubtitleCompact, compact && footCredit && styles.heroSubtitleWide]} numberOfLines={compact && !flow ? (inlineCredit ? 2 : 1) : undefined}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {inlineCredit ? null : <PhotoCredit photo={photo} style={[styles.heroCredit, { bottom: overlap }]} />}
    </View>
  )
}

/** A hero's status chip (GPS state): dot AND word, never state by colour
 *  alone. Not pressable. `warn` is a coarse (network-grade) fix. No label of
 *  its own: on a role-less View it became aria-label on a generic div, which
 *  ARIA prohibits; the word inside is what a screen reader reads. */
export function StatusChip({ text, tone }: { text: string; tone: 'live' | 'off' | 'warn' }) {
  const styles = useStyles()
  return (
    <View style={styles.statusChip} testID="status-chip">
      <View style={[styles.statusDot, tone === 'off' && styles.statusDotOff, tone === 'warn' && styles.statusDotWarn]} />
      {/* Two lines before an ellipsis: "Last known · 12 min · Offline" must
          not lose its last word on a narrow phone. */}
      <Text style={styles.statusChipText} numberOfLines={2}>{text}</Text>
    </View>
  )
}

/** A sub-screen's way back, as the references' round back button: a 48 dp
 *  pill on the photo that names where it goes. `label` is the accessible name
 *  ("Back to More"). A tab root has none (audit s7, s8). `mark` is a state
 *  icon after the name (the truck check's "checked"). */
export function HeroBack({ label, text, onPress, icon = 'chevron-left', mark }: { label: string; text: string; onPress: () => void; icon?: IconName; mark?: IconName }) {
  const styles = useStyles()
  const { colors } = useTheme()
  const t = useT()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t(label)}
      style={({ pressed }) => [styles.chip, styles.back, pressed && styles.chipPressed]}
    >
      <Icon name={icon} size={20} color={colors.text} />
      <Text style={styles.chipText} numberOfLines={1}>{text}</Text>
      {mark ? <Icon name={mark} size={16} color={colors.success} /> : null}
    </Pressable>
  )
}

/** The quick Light/Dark switch the Navigate and Safety references carry.
 *  `iconOnly`: sun for Light, moon for Dark, named by its label. */
export function ThemeChip({ iconOnly = false }: { iconOnly?: boolean }) {
  const styles = useStyles()
  const { colors, mode, toggle } = useTheme()
  const t = useT()
  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={mode === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
      style={[styles.chip, iconOnly && styles.chipRound]}
    >
      <Icon name={mode === 'light' ? 'sun' : 'moon'} size={iconOnly ? 20 : 16} color={colors.text} />
      {iconOnly ? null : <Text style={styles.chipText}>{t(mode === 'light' ? 'Light' : 'Dark')}</Text>}
    </Pressable>
  )
}

/* --- Image credits ---------------------------------------------------------- */

/** `first`: the photo whose Photo credits control opened the sheet, listed
 *  before the others. */
export function ImageCreditsSheet({ open, onClose, first }: { open: boolean; onClose: () => void; first?: Photo }) {
  const styles = useStyles()
  const { colors } = useTheme()
  const t = useT()
  const photos = first ? [first, ...Object.values(PHOTOS).filter((p) => p.file !== first.file)] : Object.values(PHOTOS)
  return (
    // Fade, not slide: no travel for a driver who has asked for reduced motion.
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        {/* Tap outside to close, for touch. A plain View, not a Pressable:
            the web modal's focus trap gives focus to the first thing that
            takes it, and that was this role-less backdrop (RC-DRV-03). The
            named Close button is the way out, as on the Language sheet. */}
        <View style={styles.fill} onStartShouldSetResponder={() => true} onResponderRelease={onClose} aria-hidden testID="credits-backdrop" />
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle} accessibilityRole="header">{t('Image credits')}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('Close')} style={styles.sheetClose}>
              <Icon name="x" size={22} color={colors.text} />
            </Pressable>
          </View>
          <Text style={styles.sheetIntro}>
            {t('Photos from Wikimedia Commons, cropped and resized for this app. Each keeps its own licence.')}
          </Text>
          <ScrollView style={styles.sheetList}>
            {photos.map((p) => (
              <View key={p.file} style={styles.creditRow} testID={`credit-${p.file}`}>
                <Image source={p.source()} style={styles.creditThumb} resizeMode="cover" accessible={false} />
                <View style={styles.creditBody}>
                  <Text style={styles.creditSubject}>{p.subject}</Text>
                  <Text style={styles.creditMeta}>{p.author} · {p.licence}</Text>
                  <View style={styles.creditLinks}>
                    <Pressable
                      onPress={() => openUrl(p.page)}
                      accessibilityRole="link"
                      accessibilityLabel={`${p.subject}: open the source page`}
                      style={styles.linkButton}
                    >
                      <Icon name="external-link" size={16} color={colors.info} />
                      <Text style={styles.linkText}>{t('Source page')}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => openUrl(LICENCE_URL[p.licence])}
                      accessibilityRole="link"
                      accessibilityLabel={`${p.licence}: open the licence`}
                      style={styles.linkButton}
                    >
                      <Icon name="file-text" size={16} color={colors.info} />
                      <Text style={styles.linkText}>{t('Licence')}</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

/* --- MountainBand ------------------------------------------------------------ */

/** The misty ridge band under More's tagline. Vector, not a photo: border
 *  triangles in three neutral steps, the same trick the old login ridges used,
 *  so it costs no asset and turns grey in Dark on its own. Pines sit at a
 *  share of the width, so they reach both edges on any screen, and a mist
 *  fades the foot into the page instead of cutting it off. */
export function MountainBand() {
  const styles = useStyles()
  const { colors } = useTheme()
  return (
    <View style={styles.band} accessible={false}>
      <View style={[styles.ridge, styles.ridgeFarLeft]} />
      <View style={[styles.ridge, styles.ridgeFarRight]} />
      <View style={[styles.ridge, styles.ridgeMid]} />
      <View style={[styles.ridge, styles.ridgeNearLeft]} />
      <View style={[styles.ridge, styles.ridgeNearRight]} />
      {PINES.map(([left, h], i) => (
        <View key={i} style={[styles.pine, { left: `${left}%`, borderBottomWidth: h, borderLeftWidth: h / 3.2, borderRightWidth: h / 3.2 }]} />
      ))}
      <View style={[styles.fill, styles.passThrough, gradient(`linear-gradient(180deg, transparent 45%, ${colors.bg} 100%)`)]} />
    </View>
  )
}
/** [left as % of the width, height] of each pine, left and right of the centre. */
const PINES: [number, number][] = [
  [1, 30], [4, 44], [7.5, 34], [11, 26], [14.5, 38], [21, 22],
  [62.5, 26], [66.5, 40], [70.5, 52], [74.5, 36], [79, 30], [83, 46], [88, 34], [92, 28],
]

/* --- FloatingTabBar ------------------------------------------------------------ */

const TAB_ICON: Record<Tab, IconName> = {
  trip: 'truck',
  navigate: 'navigation',
  safety: 'shield',
  more: 'grid',
}

/** The driver_04 bottom navigation: a floating rounded bar (forest in Light,
 *  charcoal in Dark) with the active tab in a pill. It sits in flow at the
 *  bottom of the shell's SafeAreaView, so the gesture area and the status of
 *  the screen above are never covered. */
export function FloatingTabBar({
  tabs,
  active,
  onSelect,
  label,
}: {
  tabs: readonly Tab[]
  active: Tab
  onSelect: (tab: Tab) => void
  label: (tab: Tab) => string
}) {
  const styles = useStyles()
  const { colors } = useTheme()
  return (
    <View style={styles.bar} accessibilityRole="tablist">
      {tabs.map((tab, i) => {
        const on = tab === active
        // A divider only between two resting tabs: next to the pill it
        // would draw a line through the pill's own margin.
        const divider = i > 0 && !on && tabs[i - 1] !== active
        return (
          <Fragment key={tab}>
            {i > 0 ? <View style={[styles.tabDivider, !divider && styles.tabDividerOff]} /> : null}
            <Pressable
              onPress={() => onSelect(tab)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              // react-native-web reads the aria-* form; native reads both.
              aria-selected={on}
              accessibilityLabel={label(tab)}
              testID={`tab-${tab}`}
              style={[styles.tab, on && styles.tabActive]}
            >
              <Icon name={TAB_ICON[tab]} size={22} color={on ? colors.shellAccent : colors.onShell} />
              <Text style={[styles.tabLabel, on && styles.tabLabelActive]} numberOfLines={1}>
                {label(tab)}
              </Text>
              {/* The selected state is not left to hue: the pill is under
                  3:1 against the bar, so a mint bar marks it as a shape
                  (WCAG 1.4.1 / 1.4.11; theme.contrast.test.ts). */}
              {on ? <View style={styles.tabIndicator} testID="tab-indicator" /> : null}
            </Pressable>
          </Fragment>
        )
      })}
    </View>
  )
}

const useStyles = makeStyles((COLORS) => ({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  photo: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  passThrough: { pointerEvents: 'none' },

  /* RowCard: driver_04 rows are 150 device px (75 CSS), radius 28 (14), a
     110 px (55) disc and the text starting about 106 CSS in. */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    minHeight: 75,
    paddingVertical: 8,
    paddingLeft: 16,
    paddingRight: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  rowPressed: { backgroundColor: COLORS.surfaceSoft },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  rowSub: { color: COLORS.textMuted, fontSize: 13, marginTop: 3, lineHeight: 18 },
  rowValue: { color: COLORS.accent, fontSize: 14, fontWeight: '700' },

  /* PhotoCredit: a 26 dp disc inside a 48 dp target, no text. */
  creditHit: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center' },
  creditPlate: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.imageCaption,
  },

  /* ScreenHero: driver_04 hero is 490 device px (245 CSS) plus the overlap.
     Its height (272, 158 compact) is set by ScreenHero, plus the status bar. */
  hero: {
    overflow: 'hidden',
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    backgroundColor: COLORS.surfaceSoft,
  },
  heroTop: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },
  // Takes the free start of the chip row, so the chips stay right-aligned,
  // and never shrinks: when the row is short (360 dp, large text) the GPS
  // chip wraps to two lines instead of the back pill reading "M…".
  heroLead: { flexGrow: 1, flexShrink: 0, flexBasis: 'auto', flexDirection: 'row', alignItems: 'center' },
  // `top` is set by ScreenHero: 82, or 64 compact - under the 48 dp chips
  // (14 + 48), never beside them: at 360 dp a chip row and the title cannot
  // share a line - plus the status bar.
  heroText: { position: 'absolute', left: 28, right: 28 },
  // 30: inside +-10% of both driver_04's 32 CSS px and driver_02/03's 28.
  heroTitle: { color: COLORS.onHero, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  // Two short lines, as driver_04's subtitle, so the text stays over the
  // dense end of the scrim.
  heroSubtitle: { color: COLORS.onHero, fontSize: 15, lineHeight: 21, marginTop: 4, maxWidth: 170 },
  heroSubtitleCompact: { marginTop: 0, maxWidth: 232 },
  heroSubtitleWide: { maxWidth: '100%' },
  heroCredit: { position: 'absolute', right: 14 },
  // Title and credit on one line, the credit to the right; wrapped under the
  // title when they do not fit. The credit's 48 dp target overhangs the line
  // by 6 above and below, so the line is the title's height.
  heroTitleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4 },
  heroTitleBox: { flexShrink: 1, minWidth: 0 },
  heroCreditInline: { marginLeft: 'auto', marginVertical: -6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 24,
    backgroundColor: COLORS.surface,
  },
  chipText: { color: COLORS.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  chipRound: { width: 48, paddingHorizontal: 0, justifyContent: 'center' },
  chipPressed: { backgroundColor: COLORS.surfaceSoft },
  back: { flexShrink: 1, paddingLeft: 10, gap: 2 },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    maxWidth: 230,
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.success },
  statusDotOff: { backgroundColor: COLORS.textFaint },
  statusDotWarn: { backgroundColor: COLORS.warning },
  statusChipText: { color: COLORS.text, fontSize: 13, fontWeight: '700', flexShrink: 1 },

  /* ImageCreditsSheet */
  sheetRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: COLORS.overlay },
  sheet: {
    maxHeight: '88%',
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: COLORS.text, fontSize: 18, fontWeight: '800' },
  sheetClose: { width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', marginRight: -12 },
  sheetIntro: { color: COLORS.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  sheetList: { flexGrow: 0, flexShrink: 1 },
  creditRow: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: COLORS.border },
  creditThumb: { width: 64, height: 64, borderRadius: 10, marginTop: 2, backgroundColor: COLORS.surfaceSoft },
  creditBody: { flex: 1, minWidth: 0 },
  creditSubject: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  creditMeta: { color: COLORS.textMuted, fontSize: 13, marginTop: 2 },
  creditLinks: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, marginTop: 4 },
  linkButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TOUCH_TARGET, paddingRight: 12 },
  linkText: { color: COLORS.info, fontSize: 14, fontWeight: '700' },

  /* MountainBand */
  band: { height: 86, overflow: 'hidden', marginTop: -6 },
  ridge: {
    position: 'absolute',
    bottom: 0,
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  ridgeFarLeft: { left: -60, borderLeftWidth: 150, borderRightWidth: 150, borderBottomWidth: 64, borderBottomColor: COLORS.border },
  ridgeFarRight: { right: -80, borderLeftWidth: 170, borderRightWidth: 170, borderBottomWidth: 74, borderBottomColor: COLORS.border },
  ridgeMid: { left: '13%', borderLeftWidth: 140, borderRightWidth: 140, borderBottomWidth: 50, borderBottomColor: COLORS.borderStrong, opacity: 0.55 },
  ridgeNearLeft: { left: -90, borderLeftWidth: 160, borderRightWidth: 160, borderBottomWidth: 34, borderBottomColor: COLORS.borderStrong, opacity: 0.8 },
  ridgeNearRight: { right: -140, borderLeftWidth: 170, borderRightWidth: 170, borderBottomWidth: 30, borderBottomColor: COLORS.borderStrong, opacity: 0.8 },
  pine: {
    position: 'absolute',
    bottom: 0,
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: COLORS.textFaint,
    opacity: 0.32,
  },

  /* FloatingTabBar: driver_04 bar is 844 x 124 device px (14 CSS gutters, 62
     tall), radius 40 (20), with the active tab in a pill. */
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 14,
    // 4 + 10: the bar costs the screen above it 6 dp less than it did.
    marginTop: 4,
    marginBottom: 10,
    padding: 4,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.shellBorder,
    backgroundColor: COLORS.shell,
  },
  tab: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    // Lifts the icon and label 3 dp so the indicator bar has its own room.
    paddingBottom: 6,
    borderRadius: 18,
  },
  tabActive: { backgroundColor: COLORS.shellActive },
  tabDivider: { width: 1, height: 28, backgroundColor: COLORS.shellBorder },
  tabDividerOff: { backgroundColor: 'transparent' },
  tabLabel: { color: COLORS.onShell, fontSize: 12, lineHeight: 15, fontWeight: '600' },
  tabIndicator: { position: 'absolute', bottom: 3, width: 18, height: 3, borderRadius: 2, backgroundColor: COLORS.shellAccent },
  tabLabelActive: { color: COLORS.shellAccent, fontWeight: '700' },
}))
