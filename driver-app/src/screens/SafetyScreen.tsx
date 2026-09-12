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
 */

import { useEffect, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { resolveLanguage } from '../i18n/language'
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
import { makeStyles } from '../theme-context'

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
  if (items.length === 0) return null
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeading}>{heading}</Text>
      <Bullets items={items} tone={tone} />
    </View>
  )
}

function Detail({ topic, onBack }: { topic: Topic; onBack: () => void }) {
  const styles = useStyles()
  const lang = resolveLanguage()
  const ai = useLocalAi()

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back to safety topics"
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <Text style={styles.backLabel}>‹ All topics</Text>
      </Pressable>

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
          <Text style={styles.escalateHeading}>Call 112 now if</Text>
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
        lead={`Ask about ${topic.title.toLowerCase()}`}
        placeholder="Ask about this guidance"
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
        {topic.emergency ? <Text style={styles.topicTag}>EMERGENCY</Text> : null}
      </View>
      <Text style={styles.chevron}>›</Text>
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
      <Text style={styles.eyebrow}>REST</Text>
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

export default function SafetyScreen() {
  const styles = useStyles()
  const lang = resolveLanguage()
  const [openId, setOpenId] = useState<string | null>(null)

  const topics = topicsFor(lang)
  const open = openId ? topics.find((t) => t.id === openId) : undefined

  if (open) return <Detail topic={open} onBack={() => setOpenId(null)} />

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {/* First on the screen and reachable without scrolling. Everything else
          here can wait; this cannot. */}
      <View style={styles.numbers}>
        {emergencyNumbers(lang).map((entry) => (
          <Pressable
            key={entry.number}
            onPress={() => {
              // Failure here is silent on purpose: a device with no dialler
              // (a tablet, the web build) must not crash the safety screen.
              // The number is on screen either way, which is the fallback
              // that actually matters.
              void Linking.openURL(`tel:${entry.number}`).catch(() => {})
            }}
            accessibilityRole="button"
            accessibilityLabel={`Call ${entry.number}, ${entry.label}`}
            style={({ pressed }) => [styles.number, pressed && styles.pressed]}
          >
            <Text style={styles.numberDigits}>{entry.number}</Text>
            <Text style={styles.numberLabel}>{entry.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.numbersNote}>
        Tapping opens your dialler. You still press call.
      </Text>

      <BreakCard />

      <View style={styles.block}>
        <View style={styles.sectionHead}>
          <View>
            <Text style={styles.eyebrow}>GUIDANCE</Text>
            <Text style={styles.sectionNote}>Bundled in the app · works offline</Text>
          </View>
        </View>

        <Text style={styles.disclaimer}>{disclaimer(lang)}</Text>

        {topics.map((topic) => (
          <TopicButton key={topic.id} topic={topic} onPress={() => setOpenId(topic.id)} />
        ))}
      </View>

      <View style={styles.provenance}>
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
  // Bounded and centred. These screens are built for a phone, and on the
  // desktop browser they are demonstrated in an unbounded column stretches a
  // sentence across the whole window. Below the maximum it simply fills.
  content: {
    padding: 16,
    paddingBottom: 40,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },

  /** One section. The rhythm between them is what makes the two halves of
   *  this screen read as two halves rather than one long list. */
  block: { marginBottom: 28 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  eyebrow: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  sectionNote: { color: COLORS.faint, fontSize: 12, marginTop: 3 },
  recheck: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  recheckLabel: { color: COLORS.text, fontSize: 13, fontWeight: '700' },

  numbers: { flexDirection: 'row', gap: 8 },
  number: {
    flex: 1,
    minHeight: TOUCH_TARGET + 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.badBorder,
    backgroundColor: COLORS.badBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 10,
  },
  numberDigits: { color: COLORS.bad, fontSize: 24, fontWeight: '800' },
  numberLabel: { color: COLORS.muted, fontSize: 11, textAlign: 'center', marginTop: 3 },
  numbersNote: { color: COLORS.faint, fontSize: 12, marginTop: 8, marginBottom: 28 },

  /* --- Route conditions -------------------------------------------------- */

  summary: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    padding: 18,
    marginBottom: 10,
  },
  summaryHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  summaryBandBox: { flexShrink: 1 },
  summaryBand: { color: COLORS.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  summaryScore: { color: COLORS.muted, fontSize: 13, marginTop: 2 },
  summaryCount: { alignItems: 'flex-end' },
  summaryCountValue: { color: COLORS.text, fontSize: 22, fontWeight: '800' },
  summaryCountLabel: {
    color: COLORS.faint,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.9,
    marginTop: 2,
  },
  summaryTitle: { color: COLORS.text, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  summaryDetail: { color: COLORS.muted, fontSize: 14, lineHeight: 20 },
  summaryAge: { color: COLORS.faint, fontSize: 12, marginTop: 8 },
  staleBanner: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.warnBorder,
    backgroundColor: COLORS.warnBg,
    padding: 12,
  },
  staleTitle: { color: COLORS.warn, fontSize: 11, fontWeight: '800', letterSpacing: 0.9 },
  staleDetail: { color: COLORS.text, fontSize: 13, lineHeight: 18, marginTop: 4 },
  reasons: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    gap: 4,
  },
  reason: { color: COLORS.text, fontSize: 14, lineHeight: 20 },

  factor: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    padding: 16,
    marginBottom: 8,
  },
  // Only the two bands that change what a driver should do get a tinted
  // surface. Tinting all five would spend the alarm on the ordinary case.
  factorWarn: { borderColor: COLORS.warnBorder, backgroundColor: COLORS.warnBg },
  factorBad: { borderColor: COLORS.badBorder, backgroundColor: COLORS.badBg },
  factorHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  factorTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700', flexShrink: 1 },
  factorState: {
    color: COLORS.faint,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.9,
    marginTop: 8,
  },
  factorWhy: { color: COLORS.text, fontSize: 15, lineHeight: 21, marginTop: 4 },

  factorMeta: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    gap: 4,
  },
  metaRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  metaLabel: {
    color: COLORS.faint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    width: 78,
  },
  metaValue: { color: COLORS.muted, fontSize: 13, lineHeight: 18, flex: 1 },

  factorActionLabel: {
    color: COLORS.faint,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.9,
    marginTop: 12,
  },
  factorAction: { color: COLORS.text, fontSize: 15, lineHeight: 21, marginTop: 3 },

  pill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.raised,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  // UNKNOWN keeps the neutral pill on purpose: it is neither the reassurance
  // of green nor the alarm of red, and reaching for either would be this
  // screen making a claim it has no evidence for.
  pillOk: { borderColor: COLORS.okBorder, backgroundColor: COLORS.okBg },
  pillWarn: { borderColor: COLORS.warnBorder, backgroundColor: COLORS.warnBg },
  pillBad: { borderColor: COLORS.badBorder, backgroundColor: COLORS.badBg },
  pillText: { color: COLORS.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  pillTextOk: { color: COLORS.ok },
  pillTextWarn: { color: COLORS.warn },
  pillTextBad: { color: COLORS.bad },

  /* --- Breaks ------------------------------------------------------------ */

  breakCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    padding: 18,
  },
  breakWarn: { borderColor: COLORS.warnBorder, backgroundColor: COLORS.warnBg },
  breakBad: { borderColor: COLORS.badBorder, backgroundColor: COLORS.badBg },
  breakHeadline: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  warnText: { color: COLORS.warn },
  breakElapsed: {
    color: COLORS.text,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 4,
  },
  breakBasis: { color: COLORS.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  breakButton: {
    minHeight: TOUCH_TARGET,
    marginTop: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breakButtonLabel: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  breakFailed: { color: COLORS.bad, fontSize: 12, lineHeight: 17, marginTop: 8 },

  /* --- Guidance ---------------------------------------------------------- */

  disclaimer: {
    color: COLORS.faint,
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
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
  },
  topicText: { flexShrink: 1 },
  topicEmergency: { borderColor: COLORS.badBorder, backgroundColor: COLORS.badBg },
  topicTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  topicTag: {
    color: COLORS.bad,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 3,
  },
  chevron: { color: COLORS.faint, fontSize: 22, fontWeight: '600' },
  pressed: { opacity: 0.75 },

  back: { minHeight: TOUCH_TARGET, justifyContent: 'center' },
  backLabel: { color: COLORS.muted, fontSize: 16, fontWeight: '600' },
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
    borderColor: COLORS.badBorder,
    backgroundColor: COLORS.badBg,
    padding: 16,
    marginBottom: 18,
  },
  emergencyBanner: {
    color: COLORS.bad,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 8,
  },

  escalate: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.warnBorder,
    backgroundColor: COLORS.warnBg,
    padding: 16,
    marginTop: 4,
    marginBottom: 18,
  },
  escalateHeading: {
    color: COLORS.warn,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
  },

  section: { marginBottom: 18 },
  sectionHeading: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },

  bullets: { gap: 8 },
  bullet: { flexDirection: 'row', gap: 8, paddingRight: 4 },
  bulletDot: { color: COLORS.muted, fontSize: 16, lineHeight: 23 },
  bulletText: { color: COLORS.text, fontSize: 16, lineHeight: 23, flex: 1 },
  badText: { color: COLORS.bad },

  provenance: { gap: 3 },
  provenanceText: { color: COLORS.faint, fontSize: 11 },
}))
