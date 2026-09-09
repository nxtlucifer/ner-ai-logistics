/**
 * Driver Safety & First-Aid.
 *
 * Read at a roadside, one-handed, possibly at night in rain, possibly by
 * someone who is frightened. Everything below follows from that.
 *
 * NO TYPING, NO SEARCH, NO CHAT
 *
 * A list you scroll and tap. There is no text input on this screen at all -
 * not because a search box would be hard, but because a keyboard is the wrong
 * interaction at the moment this screen is open. Emergency topics sort to the
 * top so the worst cases are reachable without scrolling.
 *
 * NO NETWORK, EVER
 *
 * Every string comes from `src/safety/guide.json`, bundled in the app. This
 * screen renders identically with the radio off, which is the whole point.
 *
 * DIALLING OPENS THE DIALLER - IT DOES NOT PLACE THE CALL
 *
 * `tel:` hands the number to the phone's dialler with the driver's thumb
 * still required. An app that silently dialled 112 from a mis-tap would waste
 * an emergency operator's time, and drivers would learn to avoid the screen.
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
import { COLORS, TOUCH_TARGET } from '../theme'

function Bullets({ items, tone }: { items: string[]; tone?: 'bad' }) {
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
  if (items.length === 0) return null
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeading}>{heading}</Text>
      <Bullets items={items} tone={tone} />
    </View>
  )
}

function Detail({ topic, onBack }: { topic: Topic; onBack: () => void }) {
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
      <Text style={styles.topicTitle}>{topic.title}</Text>
      {/* Text, not only colour: risk must never be conveyed by hue alone. */}
      {topic.emergency ? <Text style={styles.topicTag}>EMERGENCY</Text> : null}
    </Pressable>
  )
}

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
  )
}

export default function SafetyScreen() {
  const lang = resolveLanguage()
  const [openId, setOpenId] = useState<string | null>(null)

  const topics = topicsFor(lang)
  const open = openId ? topics.find((t) => t.id === openId) : undefined

  if (open) return <Detail topic={open} onBack={() => setOpenId(null)} />

  return (
    <ScrollView contentContainerStyle={styles.content}>
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

      <BreakCard />

      <Text style={styles.disclaimer}>{disclaimer(lang)}</Text>

      {topics.map((topic) => (
        <TopicButton key={topic.id} topic={topic} onPress={() => setOpenId(topic.id)} />
      ))}

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

const styles = StyleSheet.create({
  // Bounded and centred. These screens are built for a phone, and on the
  // desktop browser they are demonstrated in an unbounded column stretches a
  // sentence across the whole window. Below the maximum it simply fills.
  content: { padding: 16, paddingBottom: 40,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },

  numbers: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  number: {
    flex: 1,
    minHeight: TOUCH_TARGET + 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.badBorder,
    backgroundColor: COLORS.badBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  numberDigits: { color: COLORS.bad, fontSize: 22, fontWeight: '800' },
  numberLabel: { color: COLORS.muted, fontSize: 11, textAlign: 'center', marginTop: 2 },

  breakCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    padding: 14,
    marginBottom: 16,
  },
  breakWarn: { borderColor: COLORS.warnBorder, backgroundColor: COLORS.warnBg },
  breakBad: { borderColor: COLORS.badBorder, backgroundColor: COLORS.badBg },
  breakHeadline: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  warnText: { color: COLORS.warn },
  breakElapsed: {
    color: COLORS.text,
    fontSize: 30,
    fontWeight: '800',
    marginTop: 4,
  },
  breakBasis: { color: COLORS.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  breakButton: {
    minHeight: TOUCH_TARGET,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breakButtonLabel: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  breakFailed: { color: COLORS.bad, fontSize: 12, lineHeight: 17, marginTop: 8 },

  disclaimer: {
    color: COLORS.faint,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 16,
  },

  topic: {
    minHeight: TOUCH_TARGET + 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    justifyContent: 'center',
  },
  topicEmergency: { borderColor: COLORS.badBorder, backgroundColor: COLORS.badBg },
  topicTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  topicTag: {
    color: COLORS.bad,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 3,
  },
  pressed: { opacity: 0.75 },

  back: { minHeight: TOUCH_TARGET, justifyContent: 'center' },
  backLabel: { color: COLORS.muted, fontSize: 16, fontWeight: '600' },
  detailTitle: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 14,
  },

  emergency: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.badBorder,
    backgroundColor: COLORS.badBg,
    padding: 14,
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
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.warnBorder,
    backgroundColor: COLORS.warnBg,
    padding: 14,
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

  provenance: { marginTop: 12, gap: 3 },
  provenanceText: { color: COLORS.faint, fontSize: 11 },
})
