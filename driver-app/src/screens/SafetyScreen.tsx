/**
 * Driver Safety.
 *
 * Emergency numbers first, then rest, then the bundled guidance: what to do
 * in a landslide warning, heavy rain, flooding, a breakdown, a lost network,
 * a medical emergency. All of it works with the radio off.
 *
 * The LIVE route assessment is not here any more. It lives on the Navigation
 * screen as the Personal Route AI card, beside the road it describes; a
 * second copy on this page let the two drift apart and put a "needs a
 * connection" panel on the screen whose whole point is working without one.
 *
 * NO TYPING, NO SEARCH, NO CHAT
 *
 * A list you scroll and tap. There is no text input on this screen at all -
 * not because a search box would be hard, but because a keyboard is the wrong
 * interaction at the moment this screen is open. Emergency topics sort to the
 * top so the worst cases are reachable without scrolling.
 *
 * DIALLING OPENS THE DIALLER - IT DOES NOT PLACE THE CALL
 *
 * `tel:` hands the number to the phone's dialler with the driver's thumb
 * still required. An app that silently dialled 112 from a mis-tap would waste
 * an emergency operator's time, and drivers would learn to avoid the screen.
 *
 * UNKNOWN IS NOT SAFE
 *
 * Seven of the ten safety factors in this build have no provider behind them.
 * They are rendered as cards saying so, in grey, with an action that hands the
 * judgement back to the driver - not hidden, and never green. See
 * `src/safety/riskCards.ts`, where that rule is a test.
 *
 * LAYOUT (Phase B2, driver_03): a photo hero with the GPS and theme chips, the
 * emergency numbers card, the Call 112 card, a Safety tools grid, a photo
 * banner, then the break card, the guidance list and its provenance. The
 * tools are audit s7's mapping of the reference's four, each onto a real
 * function: Your location (the GPS state, opens Navigate - nothing is shared),
 * Safety guidance, Emergency contact (read-only in My details - nothing is
 * managed here) and the Driver Assistant. While a trip runs, the stop request
 * (it lands on the Trip tab's control) and Breaks join them; before that they
 * are not drawn, so the grid never shows a dead tile. Safety is a tab root, so
 * its hero has no back arrow; topic detail keeps "All topics".
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Linking, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native'

import { guidanceIsTranslated, useGuidanceLanguage } from '../i18n/language'
import { useAppLanguage } from '../i18n/AppLanguageProvider'
import { assessBreak, formatElapsed, type BreakLevel } from '../safety/breaks'
import { readLastBreak, recordBreak } from '../safety/breakStore'
import { useTrip } from '../trip/TripProvider'
import {
  REVISED,
  SOURCES,
  VERSION,
  disclaimer,
  emergencyBanner,
  emergencyNumbers,
  emergencySteps,
  topicsFor,
  type Topic,
} from '../safety/guide'
import AiPanel from '../ai/AiPanel'
import { useLocalAi } from '../ai/useLocalAi'
import { TOUCH_TARGET } from '../theme'
import { Icon, type IconName } from '../components/icons'
import { PHOTOS } from '../components/photoCredits'
import { CoverPhoto, IconDisc, ScreenHero, StatusChip, emergencyNumberLook, gradient, useTopInset, type Tone } from '../components/scenic'
import { useGpsStatus } from '../map/useGpsStatus'
import { useT } from '../i18n/tx'
import { makeStyles, useTheme } from '../theme-context'

/** `tel:` opens the dialler; it never places the call. Failure is silent on
 *  purpose: a device with no dialler (a tablet, the web build) must not crash
 *  the safety screen, and the number stays on screen to read. */
function dial(number: string) {
  void Linking.openURL(`tel:${number}`).catch(() => {})
}

function Bullets({ items, tone }: { items: string[]; tone?: 'bad' }) {
  const styles = useStyles()
  return (
    <View style={styles.bullets}>
      {items.map((item, i) => (
        <View key={i} style={styles.bullet}>
          <Text style={[styles.bulletDot, tone === 'bad' && styles.badText]}>•</Text>
          <Text style={[styles.bulletText, tone === 'bad' && styles.badText]}>{item}</Text>
        </View>
      ))}
    </View>
  )
}

function Section({
  heading,
  items,
  tone,
}: {
  heading: string
  items: string[]
  tone?: 'bad'
}) {
  const styles = useStyles()
  const t = useT()
  if (items.length === 0) return null
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeading}>{t(heading)}</Text>
      <Bullets items={items} tone={tone} />
    </View>
  )
}

function Detail({ topic, onBack, status }: { topic: Topic; onBack: () => void; status?: ReactNode }) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  const lang = useGuidanceLanguage()
  const ai = useLocalAi()
  // No hero here to take the status bar (CERT-DRV-08): the column starts under it.
  const inset = useTopInset()

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: 16 + inset }]}>
      {/* The GPS chip rides with the back link: this view has no hero, and
          GPS state stays on every driver screen. */}
      <View style={styles.detailTop}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to safety topics"
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Icon name="chevron-left" size={20} color={COLORS.textMuted} />
          <Text style={styles.backLabel}>{t('All topics')}</Text>
        </Pressable>
        {status}
      </View>

      <Text style={styles.detailTitle}>{topic.title}</Text>

      {topic.emergency ? (
        // The escalation block is rendered from ONE source for every
        // emergency topic. See the comment in guide.json: eleven hand-copied
        // versions of "call 112" is eleven chances for one to be wrong.
        <View accessibilityRole="alert" style={styles.emergency}>
          <Text style={styles.emergencyBanner}>{emergencyBanner(lang)}</Text>
          <Bullets items={emergencySteps(lang)} />
        </View>
      ) : null}

      <Section heading="What you may see" items={topic.recognise} />
      <Section heading="Do this now" items={topic.do} />
      <Section heading="Do not" items={topic.avoid} tone="bad" />

      {topic.escalate.length > 0 ? (
        <View style={styles.escalate}>
          <Text style={styles.escalateHeading}>{t('Call 112 now if')}</Text>
          <Bullets items={topic.escalate} />
        </View>
      ) : null}

      <Text style={styles.disclaimer}>{disclaimer(lang)}</Text>

      {/* LAST ON THE SCREEN, DELIBERATELY. Everything above is reviewed,
          bundled guidance that works with no server and no model, and the
          emergency block is at the top where a driver reaches it first. The
          model only rewords the text already on this page - it is given that
          text as its source and told it may not add medicine, doses, a
          road-is-clear verdict or a promise that help is coming. */}
      <AiPanel
        ai={ai}
        mode="safety"
        lead={`${t('Ask about')} ${topic.title.toLowerCase()}`}
        placeholder={t('Ask about this guidance')}
        askOptions={{ guidance: guidanceText(topic) }}
        fallbackName="guidance above"
      />
    </ScrollView>
  )
}

/**
 * The bundled topic as plain text, for the model to explain.
 *
 * The model is handed THIS page's own words rather than a server-side copy, so
 * it can only ever reword what the driver is already reading. A second copy of
 * the guidance on the server would be a second thing to keep reviewed.
 */
function guidanceText(topic: Topic): string {
  const block = (heading: string, items: readonly string[]) =>
    items.length > 0
      ? `${heading}:\n${items.map((i) => `- ${i}`).join('\n')}`
      : ''
  return [
    topic.title,
    block('What you may see', topic.recognise),
    block('Do this now', topic.do),
    block('Do not', topic.avoid),
    block('Call 112 now if', topic.escalate),
  ]
    .filter(Boolean)
    .join('\n\n')
}

function TopicButton({ topic, onPress }: { topic: Topic; onPress: () => void }) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // The label carries the urgency too. A screen reader user must not
      // depend on the red border to know this one is an emergency.
      accessibilityLabel={
        topic.emergency ? `${topic.title}. Emergency topic.` : topic.title
      }
      style={({ pressed }) => [
        styles.topic,
        topic.emergency && styles.topicEmergency,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.topicText}>
        <Text style={styles.topicTitle}>{topic.title}</Text>
        {/* Text, not only colour: risk must never be conveyed by hue alone. */}
        {topic.emergency ? <Text style={styles.topicTag}>{t('EMERGENCY')}</Text> : null}
      </View>
      <Icon name="chevron-right" size={20} color={COLORS.textFaint} />
    </Pressable>
  )
}

/* --- Route conditions ---------------------------------------------------- */

const BREAK_TONE: Record<BreakLevel, 'muted' | 'warn' | 'bad'> = {
  NONE: 'muted',
  DUE_SOON: 'warn',
  RECOMMENDED: 'warn',
  OVERDUE: 'bad',
}

const BREAK_HEADLINE: Record<BreakLevel, string> = {
  NONE: 'On the road',
  DUE_SOON: 'A break is due soon',
  RECOMMENDED: 'Take a break when you can stop safely',
  OVERDUE: 'Break overdue',
}

/**
 * How long since the driver last stopped.
 *
 * Says "since", never "driving". See `src/safety/breaks.ts` - this build
 * cannot tell driving from waiting at a dock, and labelling elapsed time as
 * driving time would be the app making a false statement about the person
 * reading it.
 *
 * It advises and never blocks: there is no gate here on starting or
 * continuing a trip. Whether it is safe to carry on depends on where the next
 * safe place to stop is, which the phone does not know.
 */
function BreakCard() {
  const styles = useStyles()
  const t = useT()
  const { trip } = useTrip()
  const [lastBreakAt, setLastBreakAt] = useState<string | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  // Recomputed on a minute tick rather than per second: the thresholds are
  // hours apart, and a per-second timer would wake the JS thread 60x more
  // often for a number that changes once a minute.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    void readLastBreak().then((value) => {
      if (alive) setLastBreakAt(value)
    })
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const advice = assessBreak({
    startedAt: trip?.started_at ?? null,
    lastBreakAt,
    now,
  })

  // Nothing to measure from until the trip starts. A card reading "0m since
  // you started" before departure is noise on a safety screen.
  if (advice.elapsedMinutes === null) return null

  const tone = BREAK_TONE[advice.level]

  return (
    <View style={styles.block}>
      <Text style={styles.eyebrow}>{t('REST')}</Text>
      <View
        style={[
          styles.breakCard,
          tone === 'warn' && styles.breakWarn,
          tone === 'bad' && styles.breakBad,
        ]}
      >
        <Text
          style={[
            styles.breakHeadline,
            tone === 'warn' && styles.warnText,
            tone === 'bad' && styles.badText,
          ]}
        >
          {BREAK_HEADLINE[advice.level]}
        </Text>

        <Text style={styles.breakElapsed}>{formatElapsed(advice.elapsedMinutes)}</Text>

        {/* The measurement is named on screen, not just in the source. A driver
            who reads this as driving time will trust it further than it can
            carry. */}
        <Text style={styles.breakBasis}>
          {advice.sinceBreak
            ? 'since your last recorded break'
            : 'since this trip started'}
          {' — elapsed time, not time spent driving'}
        </Text>

        <Pressable
          onPress={() => {
            const when = new Date()
            void recordBreak(when).then((stored) => {
              setSaveFailed(!stored)
              if (stored) {
                setLastBreakAt(when.toISOString())
                setNow(Date.now())
              }
            })
          }}
          accessibilityRole="button"
          accessibilityLabel="Record that you stopped for a break"
          style={({ pressed }) => [styles.breakButton, pressed && styles.pressed]}
        >
          <Text style={styles.breakButtonLabel}>I stopped for a break</Text>
        </Pressable>

        {saveFailed ? (
          // Never claim it was logged when it was not: the driver would rely on
          // a counter that had not moved.
          <Text style={styles.breakFailed}>
            Could not save that on this phone. The time above still counts from
            the start of the trip.
          </Text>
        ) : null}
      </View>
    </View>
  )
}

/** One Safety tool. A tool that cannot act yet stays on screen with its
 *  reason and no chevron, and is disabled for touch and screen readers: a
 *  tile that silently did nothing would be a dead control. */
function Tool({
  icon,
  tone = 'neutral',
  title,
  subtitle,
  onPress,
  testID,
}: {
  icon: IconName
  tone?: Tone
  title: string
  subtitle: string
  onPress?: () => void
  testID?: string
}) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const off = onPress === undefined
  // Below 400 dp of room one tool per row: two columns left about 85 px for
  // the words, which broke "Emergenc-y" mid-word and clipped subtitles. Room
  // is width over font scale, as for Navigate's quick tiles: a 412 dp phone
  // at 1.3x text cut "Offline guidance and the translator" in two columns.
  const { width, fontScale } = useWindowDimensions()
  const narrow = width / (fontScale || 1) < 400
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      accessibilityState={{ disabled: off }}
      // react-native-web reads the aria-* form (see FloatingTabBar).
      aria-disabled={off}
      testID={testID}
      style={({ pressed }) => [styles.tool, narrow && styles.toolNarrow, pressed && !off && styles.pressed]}
    >
      <View style={off && styles.toolDiscOff}>
        <IconDisc icon={icon} tone={tone} size={34} />
      </View>
      {/* Dimmed words as well as the disc: a disabled tile must not read as
          tappable at a glance. textMuted keeps AA for the reason. */}
      <View style={styles.toolText}>
        <Text style={[styles.toolTitle, off && styles.toolTitleOff]} numberOfLines={2}>{title}</Text>
        <Text style={styles.toolSub} numberOfLines={3}>{subtitle}</Text>
      </View>
      {off ? null : <Icon name="chevron-right" size={18} color={COLORS.textMuted} />}
    </Pressable>
  )
}

export default function SafetyScreen({
  onOpenTrip,
  onOpenNavigate,
  onOpenDetails,
  onOpenAssistant,
}: {
  /** The Trip tab, at its emergency stop-request control. */
  onOpenTrip?: () => void
  /** The Navigate tab: the map with the phone's own position. */
  onOpenNavigate?: () => void
  /** My details, where the emergency contact is shown read-only. */
  onOpenDetails?: () => void
  onOpenAssistant?: () => void
}) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  const lang = useGuidanceLanguage()
  const { language: appLanguage, t: tk } = useAppLanguage()
  const { trip } = useTrip()
  // One GPS reading for the hero chip and the Your location tool, by the
  // rule Navigate's map uses, so the two tabs cannot disagree (B2D-07).
  const gps = useGpsStatus(true)
  const status = <StatusChip text={gps.text} tone={gps.live ? 'live' : 'off'} />
  const [openId, setOpenId] = useState<string | null>(null)
  // Below 400 dp the three number tiles stack their disc over the number.
  const { width: windowW, fontScale } = useWindowDimensions()
  const narrow = windowW < 400
  // With large text for the width, the three tiles take a row each
  // (CERT-DRV-02): at 360 dp and font scale 1.5, "Ambulance" broke mid-word.
  const stackNumbers = windowW / (fontScale || 1) < 340
  const scroll = useRef<ScrollView>(null)
  const anchors = useRef<{ guide?: number; rest?: number }>({})
  const scrollTo = (key: 'guide' | 'rest') => {
    const y = anchors.current[key]
    // Not animated: a jump respects reduced motion and lands at once.
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - 12), animated: false })
  }

  const topics = topicsFor(lang)
  const open = openId ? topics.find((t) => t.id === openId) : undefined
  // The stop request is the Trip tab's, and only while a trip runs. The
  // break timer runs from the server's start time (BreakCard).
  const inProgress = Boolean(trip?.tracking_expected)
  const breakRunning = trip?.started_at != null && !Number.isNaN(Date.parse(trip.started_at))

  if (open) return <Detail topic={open} onBack={() => setOpenId(null)} status={status} />

  return (
    <ScrollView ref={scroll} contentContainerStyle={styles.page}>
      <ScreenHero
        photo={PHOTOS.safety}
        title={tk('nav_safety')}
        subtitle={t('Emergency numbers and offline guidance')}
        status={status}
        themeChip
        height={244}
        // Text in flow above the credit (CERT-DRV-03): at a large font scale
        // the subtitle ran under the credit plate; the hero now grows instead.
        creditAt="bottom"
      />

      <View style={styles.cards}>
        {/* First on the screen and reachable without scrolling. Everything
            else here can wait; this cannot. */}
        <View style={styles.card} testID="safety-numbers">
          <Text style={styles.cardTitle} accessibilityRole="header">{t('Emergency Numbers')}</Text>
          <Text style={styles.cardSub}>{t('Tapping opens your dialler. You still press call.')}</Text>
          <View style={[styles.numbers, stackNumbers && styles.numbersStacked]}>
            {emergencyNumbers(lang).map((entry) => {
              // 112 reaches everything, so it is the one tile that fills.
              // Three identical red slabs made the driver read all three
              // before choosing; this makes the default obvious in the
              // half-second where that matters.
              const primary = entry.number === '112'
              return (
                <Pressable
                  key={entry.number}
                  onPress={() => dial(entry.number)}
                  accessibilityRole="button"
                  accessibilityLabel={`Call ${entry.number}, ${entry.label}`}
                  testID={`call-${entry.number}`}
                  style={({ pressed }) => [styles.number, primary && styles.numberPrimary, pressed && styles.pressed]}
                >
                  {/* Disc and number share a line; the label takes the tile's
                      full width below, so "emergencies" never breaks. */}
                  <View style={styles.numberHead}>
                    {primary ? (
                      <View style={[styles.numberDiscStrong, narrow && styles.numberDiscNarrow]}>
                        <Icon name="phone" size={16} color={COLORS.onFill} />
                      </View>
                    ) : (
                      <IconDisc {...emergencyNumberLook(entry.number)} size={narrow ? 30 : 34} />
                    )}
                    <Text style={[styles.numberDigits, narrow && styles.numberDigitsNarrow, primary && styles.numberDigitsPrimary]}>{entry.number}</Text>
                  </View>
                  <Text style={styles.numberLabel} numberOfLines={3}>{entry.label}</Text>
                </Pressable>
              )
            })}
          </View>
        </View>

        <View style={[styles.card, styles.help, narrow && styles.helpNarrow]} testID="safety-help">
          <View style={styles.helpLead}>
            <IconDisc icon="phone-call" tone="emergency" size={52} />
            <View style={styles.helpText}>
              <Text style={styles.helpTitle}>{t('Need immediate help?')}</Text>
              <Text style={styles.helpSub}>{t('One number for all emergencies')}</Text>
            </View>
          </View>
          <Pressable
            onPress={() => dial('112')}
            accessibilityRole="button"
            accessibilityLabel="Call 112, all emergencies"
            testID="call-112-cta"
            style={({ pressed }) => [styles.callCta, narrow && styles.callCtaNarrow, pressed && styles.pressed]}
          >
            <Icon name="phone" size={18} color={COLORS.onFill} />
            <Text style={styles.callCtaText}>{t('Call 112')}</Text>
          </Pressable>
        </View>

        <View style={styles.card} testID="safety-tools">
          <Text style={styles.cardTitle} accessibilityRole="header">{t('Safety Tools')}</Text>
          <Text style={styles.cardSub}>{t('Help and guidance on this phone')}</Text>
          <View style={styles.tools}>
            {/* The reference's Live Location: the GPS state, never a share. */}
            <Tool
              icon="map-pin"
              tone="route"
              title={t('Your location')}
              subtitle={gps.text}
              onPress={onOpenNavigate}
              testID="tool-location"
            />
            <Tool
              icon="book-open"
              title={t('Safety guidance')}
              subtitle={`${topics.length} ${t('topics · works offline')}`}
              onPress={() => scrollTo('guide')}
              testID="tool-guidance"
            />
            {/* The reference's Emergency Contacts: read-only, one contact. */}
            <Tool
              icon="user"
              tone="emergency"
              title={t('Emergency contact')}
              subtitle={t('View in My Details')}
              onPress={onOpenDetails}
              testID="tool-contact"
            />
            <Tool
              icon="message-circle"
              title={t('Driver Assistant')}
              subtitle={t('Offline guidance and the translator')}
              onPress={onOpenAssistant}
              testID="tool-assistant"
            />
            {inProgress && onOpenTrip ? (
              <Tool
                icon="alert-octagon"
                tone="emergency"
                title={t('Emergency stop request')}
                subtitle={t('Alerts your manager · on the Trip tab')}
                onPress={onOpenTrip}
                testID="tool-stop-request"
              />
            ) : null}
            {breakRunning ? (
              <Tool
                icon="coffee"
                tone="caution"
                title={t('Breaks')}
                subtitle={t('Record a stop for a break')}
                onPress={() => scrollTo('rest')}
                testID="tool-breaks"
              />
            ) : null}
          </View>
        </View>
      </View>

      {/* The reference's banner, with a true line in place of its slogan. */}
      <View style={styles.banner} testID="safety-banner">
        <CoverPhoto photo={PHOTOS.strip} />
        <View style={[styles.fill, styles.passThrough, { backgroundColor: COLORS.imageDim }]} />
        <View
          style={[
            styles.fill,
            styles.passThrough,
            // The text keeps to the left 60%, inside the full-strength scrim:
            // past 55% the Light scrim thinned over the pale lake and the end
            // of the line fell to about 2:1 (B2D-03).
            gradient(`linear-gradient(90deg, ${COLORS.imageScrim} 0%, ${COLORS.imageScrim} 64%, transparent 100%)`),
          ]}
        />
        <View style={styles.bannerText}>
          <Text style={styles.bannerTitle}>{t('Stored on this phone')}</Text>
          <Text style={styles.bannerSub}>{t('Numbers, guidance and your break timer open with no connection.')}</Text>
        </View>
      </View>

      <View onLayout={(e) => { anchors.current.rest = e.nativeEvent.layout.y }} style={styles.pageSection}>
        <BreakCard />
      </View>

      <View onLayout={(e) => { anchors.current.guide = e.nativeEvent.layout.y }} style={styles.pageSection} testID="safety-guidance">
        <Text style={styles.cardTitle} accessibilityRole="header">{t('Safety Guidance')}</Text>
        <Text style={styles.sectionNote}>{t('Bundled in the app · works offline')}</Text>

        <Text style={styles.disclaimer}>{disclaimer(lang)}</Text>
        {/* ISSUE 12. The guidance now follows the language the driver
            CHOSE, not the one the phone was sold with. Where no reviewed
            translation exists it says so, in their language, rather than
            quietly serving English and letting them assume it is theirs.
            Machine-translating a head-injury instruction is not the
            alternative. */}
        {guidanceIsTranslated(appLanguage) ? null : (
          <Text style={styles.disclaimer}>
            {t('This guidance is reviewed in English, Hindi and Assamese only. It is shown in English because no reviewed translation exists for your language yet.')}
          </Text>
        )}

        {topics.map((topic) => (
          <TopicButton key={topic.id} topic={topic} onPress={() => setOpenId(topic.id)} />
        ))}
      </View>

      <View style={[styles.pageSection, styles.provenance]}>
        {/* Version and sources on screen, not only in the file. A guide whose
            vintage is invisible is one nobody notices has gone stale. */}
        <Text style={styles.provenanceText}>
          {VERSION} · revised {REVISED}
        </Text>
        {SOURCES.map((source) => (
          <Text key={source.id} style={styles.provenanceText}>
            {source.name}
          </Text>
        ))}
      </View>
    </ScrollView>
  )
}

const useStyles = makeStyles((COLORS) => ({
  // The topic detail keeps the bounded column it had.
  content: {
    padding: 16,
    paddingBottom: 40,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  page: { paddingBottom: 28, backgroundColor: COLORS.bg },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  passThrough: { pointerEvents: 'none' },
  pressed: { opacity: 0.75 },

  /* --- driver_03 cards: 94% of the width (13 dp gutters), radius 14 ---- */
  // Rides up over the hero's rounded foot, as the reference's first card.
  cards: { marginTop: -26, paddingHorizontal: 13, gap: 8 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    padding: 12,
  },
  cardTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  cardSub: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 1, marginBottom: 8 },

  numbers: { flexDirection: 'row', gap: 8 },
  numbersStacked: { flexDirection: 'column' },
  number: {
    flex: 1,
    minWidth: 0,
    minHeight: 60,
    gap: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceRaised,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  numberHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  numberPrimary: { backgroundColor: COLORS.dangerSoft, borderColor: COLORS.dangerBorder },
  numberDiscStrong: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.dangerStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberDiscNarrow: { width: 30, height: 30, borderRadius: 15 },
  // 18 against the reference's 15: the one figure a driver must read at a
  // glance. Recorded as a cab-legibility decision in the mismatch log.
  numberDigits: { flexShrink: 1, color: COLORS.text, fontSize: 18, fontWeight: '800' },
  numberDigitsNarrow: { fontSize: 17 },
  numberDigitsPrimary: { color: COLORS.danger },
  numberLabel: { color: COLORS.textMuted, fontSize: 12, lineHeight: 15 },

  help: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  helpNarrow: { flexDirection: 'column', alignItems: 'stretch' },
  helpLead: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  helpText: { flex: 1, minWidth: 0 },
  helpTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800' },
  helpSub: { color: COLORS.textMuted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  // Red, not the reference's forest: this dials an emergency number, and red
  // is the one hue this app keeps for emergencies.
  callCta: {
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: COLORS.dangerStrong,
  },
  callCtaNarrow: { alignSelf: 'stretch' },
  callCtaText: { color: COLORS.onFill, fontSize: 16, fontWeight: '800' },

  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tool: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceRaised,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 6,
  },
  toolNarrow: { flexBasis: '100%', minHeight: 56 },
  toolDiscOff: { opacity: 0.55 },
  toolText: { flex: 1, minWidth: 0 },
  // 12 against the reference's 10: the smallest bold label in this app.
  toolTitle: { color: COLORS.text, fontSize: 12, fontWeight: '700' },
  toolTitleOff: { color: COLORS.textMuted },
  toolSub: { color: COLORS.textMuted, fontSize: 12, lineHeight: 16, marginTop: 2 },

  /* --- Banner: driver_03's 824 x 177 device px strip, radius 12 -------- */
  // Grows with its text; the bottom strip is the credit's, so a long line in
  // any language never runs under it.
  banner: {
    minHeight: 104,
    marginTop: 12,
    marginHorizontal: 19,
    paddingTop: 14,
    paddingBottom: 34,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceSoft,
  },
  bannerText: { paddingHorizontal: 16, maxWidth: '60%' },
  bannerTitle: { color: COLORS.onPhoto, fontSize: 17, fontWeight: '800' },
  bannerSub: { color: COLORS.onPhoto, fontSize: 13, lineHeight: 18, marginTop: 2 },

  /* --- Kept below the reference composition --------------------------- */
  pageSection: { paddingHorizontal: 16, marginTop: 20 },
  eyebrow: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    marginBottom: 8,
  },
  sectionNote: { color: COLORS.textFaint, fontSize: 12, marginTop: 3, marginBottom: 10 },

  /* --- Breaks ------------------------------------------------------------ */

  // BreakCard's own wrapper; the page section supplies the spacing.
  block: {},
  breakCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    padding: 18,
  },
  breakWarn: { borderColor: COLORS.warningBorder, backgroundColor: COLORS.warningSoft },
  breakBad: { borderColor: COLORS.dangerBorder, backgroundColor: COLORS.dangerSoft },
  breakHeadline: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  warnText: { color: COLORS.warning },
  breakElapsed: {
    color: COLORS.text,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 4,
  },
  breakBasis: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  breakButton: {
    minHeight: TOUCH_TARGET,
    marginTop: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breakButtonLabel: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  breakFailed: { color: COLORS.danger, fontSize: 12, lineHeight: 17, marginTop: 8 },

  /* --- Guidance ---------------------------------------------------------- */

  disclaimer: {
    color: COLORS.textFaint,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 12,
  },

  topic: {
    minHeight: TOUCH_TARGET + 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
  },
  topicText: { flexShrink: 1 },
  /* A RED EDGE, NOT A RED FIELD - and now a hairline, not the 2 dp frame.
     Every one of these topics is an emergency, so filling all of them with
     dangerSoft made the whole list a wall of red - and a list where everything
     shouts is a list where nothing does. The card carries the word EMERGENCY
     in red; the edge only groups them. */
  topicEmergency: { borderColor: COLORS.dangerBorder },
  topicTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  topicTag: {
    color: COLORS.danger,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 3,
  },

  detailTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  back: { minHeight: TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: 2 },
  backLabel: { color: COLORS.textMuted, fontSize: 16, fontWeight: '600' },
  detailTitle: {
    color: COLORS.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 14,
  },

  emergency: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.dangerBorder,
    backgroundColor: COLORS.dangerSoft,
    padding: 16,
    marginBottom: 18,
  },
  emergencyBanner: {
    color: COLORS.danger,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 8,
  },

  escalate: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.warningBorder,
    backgroundColor: COLORS.warningSoft,
    padding: 16,
    marginTop: 4,
    marginBottom: 18,
  },
  escalateHeading: {
    color: COLORS.warning,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
  },

  section: { marginBottom: 18 },
  sectionHeading: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },

  bullets: { gap: 8 },
  bullet: { flexDirection: 'row', gap: 8, paddingRight: 4 },
  bulletDot: { color: COLORS.textMuted, fontSize: 16, lineHeight: 23 },
  bulletText: { color: COLORS.text, fontSize: 16, lineHeight: 23, flex: 1 },
  badText: { color: COLORS.danger },

  provenance: { gap: 3 },
  provenanceText: { color: COLORS.textFaint, fontSize: 11 },
}))
