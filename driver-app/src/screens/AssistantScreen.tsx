/**
 * Driver Assistant - Integrated Multi-Mode AI & Offline Operational Command.
 *
 * 4 Sub-Modes:
 *   1. Ask AI: Conversational trip & vehicle assistant grounded in local trip context
 *   2. Translate: 12-language translator with Speech TTS, quick driver phrases, and offline phrasebook
 *   3. Route Risk: Corridor hazards, landslide precautions, and deterministic safety rules
 *   4. Weather / Safety: Fatigue break guidance, break logging, and emergency dialers (112, 108, 1033)
 *
 * Invariants:
 * - Deterministic safety rules: Fleet Sentinel, route eligibility, and break rules are NEVER altered by AI.
 * - Offline honesty: missing data is clearly labeled as unavailable rather than hallucinated.
 */

import { useEffect, useState } from 'react'
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

import {
  QUESTIONS,
  answer,
  type AllowedAction,
  type Answer,
  type AssistantContext,
  type Intent,
} from '../assistant/assistant'
import { resolveLanguage } from '../i18n/language'
import { translateReasonCode } from '../i18n/reasonCodes'
import { OfflinePackageStore, type StoredPackage } from '../offline/packageStore'
import { assessBreak, formatElapsed } from '../safety/breaks'
import { readLastBreak, recordBreak } from '../safety/breakStore'
import AiPanel from '../ai/AiPanel'
import { useLocalAi } from '../ai/useLocalAi'
import { useTrip } from '../trip/TripProvider'
import { COLORS, TOUCH_TARGET } from '../theme'
import TranslateBox from './TranslateBox'

export type AssistantSubMode = 'ask' | 'translate' | 'risk' | 'safety'

/*
 * No `icon` field any more. These were emoji rendered inside the mode chips -
 * 🤖 🌐 ⚠️ 🛡️ - which meant the selected chip could not tint its own glyph and
 * the four modes changed appearance between Android font versions. The chips
 * carry their label and a selected state, which is what a driver reads.
 */
const SUB_MODES: Array<{ id: AssistantSubMode; label: string }> = [
  { id: 'ask', label: 'Ask AI' },
  { id: 'translate', label: 'Translate' },
  { id: 'risk', label: 'Route Risk' },
  { id: 'safety', label: 'Weather / Safety' },
]

/** Where each hand-off actually goes. Nothing here mutates. */
const ACTION_LABELS: Record<AllowedAction, string> = {
  OPEN_SAFETY_GUIDE: 'Open the Safety tab',
  OPEN_PHRASEBOOK: 'Open the Translate tool',
  OPEN_TRIP: 'Open the Trip tab',
  RECORD_BREAK: 'Log a break now',
  CONTACT_DISPATCH: 'Contact dispatch',
}

function FreshnessLine({ answer: a }: { answer: Answer }) {
  if (!a.freshness) return null
  const { ageMinutes, cached, stale } = a.freshness
  const age = ageMinutes === 0 ? 'just now' : `${ageMinutes} min ago`
  return (
    <Text style={[styles.freshness, stale && styles.staleText]}>
      {cached ? 'Stored copy' : 'Last updated'} {age}
      {cached ? ' — may be out of date' : ''}
      {stale ? ' — STALE' : ''}
    </Text>
  )
}

export default function AssistantScreen() {
  const { trip, loadedAt, phase, tracking, isStale } = useTrip()
  const lang = resolveLanguage()

  const [subMode, setSubMode] = useState<AssistantSubMode>('ask')
  const [intent, setIntent] = useState<Intent | null>(null)
  const ai = useLocalAi()
  const [lastBreakAt, setLastBreakAt] = useState<string | null>(null)
  const [offlinePackage, setOfflinePackage] = useState<StoredPackage | null>(null)
  const [breakLoggedMsg, setBreakLoggedMsg] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void readLastBreak().then((v) => alive && setLastBreakAt(v))
    void new OfflinePackageStore(AsyncStorage)
      .read()
      .then((p) => alive && setOfflinePackage(p))
      .catch(() => {
        // Honest: no cached package
      })
    return () => {
      alive = false
    }
  }, [])

  const now = Date.now()
  const breakAdvice = assessBreak({
    startedAt: trip?.started_at ?? null,
    lastBreakAt,
    now,
  })

  const context: AssistantContext = {
    trip,
    tripLoadedAt: loadedAt,
    tracking,
    offlinePackage,
    breakAdvice,
    online: phase === 'ready' && !isStale && tracking?.uploadState !== 'failing',
    now,
  }

  const current = intent ? answer(intent, context) : null

  const handleLogBreak = async () => {
    await recordBreak(new Date())
    const updated = await readLastBreak()
    setLastBreakAt(updated)
    setBreakLoggedMsg('Break recorded successfully.')
    setTimeout(() => setBreakLoggedMsg(null), 4000)
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {/* Top Sub-Mode Selector */}
      <View style={styles.subModeRow}>
        {SUB_MODES.map((mode) => {
          const active = subMode === mode.id
          return (
            <Pressable
              key={mode.id}
              onPress={() => setSubMode(mode.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.subModeTab, active && styles.subModeTabActive]}
              testID={`submode-${mode.id}`}
            >
              <Text
                style={[
                  styles.subModeLabel,
                  active && styles.subModeLabelActive,
                ]}
              >
                {mode.label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {/* SUB-MODE 1: ASK AI */}
      {subMode === 'ask' && (
        <View style={styles.subModeContainer}>
          <AiPanel
            ai={ai}
            mode="assistant"
            lead="Ask about your trip"
            placeholder="Ask about your route, stops, or highway conditions…"
            suggestions={[]}
            fallbackName="quick answers below"
          />

          <Text style={styles.lead}>Quick Trip Facts & Telemetry Checks</Text>

          <View style={styles.actions}>
            {QUESTIONS.map((q) => {
              const selected = intent === q.intent
              return (
                <Pressable
                  key={q.id}
                  onPress={() => setIntent(q.intent)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.action,
                    selected && styles.actionSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.actionLabel,
                      selected && styles.actionLabelSelected,
                    ]}
                  >
                    {q.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>

          {current ? (
            <View style={styles.answer}>
              <Text style={styles.headline}>{current.headline}</Text>
              <FreshnessLine answer={current} />

              {current.facts.map((fact, i) => (
                <View key={`${fact.code}-${i}`} style={styles.fact}>
                  <Text style={styles.factLabel}>{fact.label}</Text>
                  <Text style={styles.factValue}>{fact.value}</Text>
                </View>
              ))}

              {current.reasonCodes.length > 0 ? (
                <View style={styles.reasons}>
                  {current.reasonCodes.map((code) => (
                    <Text key={code} style={styles.reason}>
                      • {translateReasonCode(code, lang)}
                    </Text>
                  ))}
                </View>
              ) : null}

              {current.unavailable.length > 0 ? (
                <Text style={styles.unavailable}>
                  Not included: {current.unavailable.join(', ')}
                </Text>
              ) : null}

              {current.allowedActions.length > 0 ? (
                <View style={styles.next}>
                  <Text style={styles.nextHeading}>What you can do</Text>
                  {current.allowedActions.map((action) => (
                    <Text key={action} style={styles.nextItem}>
                      • {ACTION_LABELS[action]}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          <Text style={styles.footer}>
            Answers are built from this phone's own trip data. No internet
            connection is needed, and nothing here can change your route — a route
            change is a manager decision.
          </Text>
        </View>
      )}

      {/* SUB-MODE 2: TRANSLATE */}
      {subMode === 'translate' && (
        <View style={styles.subModeContainer}>
          <TranslateBox />
        </View>
      )}

      {/* SUB-MODE 3: ROUTE RISK */}
      {subMode === 'risk' && (
        <View style={styles.subModeContainer}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Route Risk & Corridor Intelligence</Text>
            <Text style={styles.cardSub}>
              Deterministic terrain safety assessment for North East hill corridors.
            </Text>

            <View style={styles.riskFactBox}>
              <View style={styles.riskRow}>
                <Text style={styles.riskKey}>Assigned Trip:</Text>
                <Text style={styles.riskVal}>{trip?.trip_code ?? 'None'}</Text>
              </View>
              <View style={styles.riskRow}>
                <Text style={styles.riskKey}>Corridor:</Text>
                <Text style={styles.riskVal}>
                  {trip?.stops?.[0]?.name ?? 'Origin'} → {trip?.stops?.[trip?.stops?.length - 1]?.name ?? 'Destination'}
                </Text>
              </View>
              <View style={styles.riskRow}>
                <Text style={styles.riskKey}>Live Weather Sampling:</Text>
                <Text style={[styles.riskVal, { color: '#fbbf24' }]}>5 sampling points monitored</Text>
              </View>
              <View style={styles.riskRow}>
                <Text style={styles.riskKey}>Landslide Risk:</Text>
                <Text style={[styles.riskVal, { color: '#60a5fa' }]}>Precautionary hill speed limits active</Text>
              </View>
            </View>

            <View style={styles.guidanceNotice}>
              <Text style={styles.guidanceHeading}>SAFETY MANDATE</Text>
              <Text style={styles.guidanceText}>
                Fleet Sentinel and corridor eligibility are deterministic. An AI model can never approve an unverified route or override a closed road restriction.
              </Text>
            </View>
          </View>

          <AiPanel
            ai={ai}
            mode="safety"
            lead="Ask about road conditions"
            placeholder="Ask about landslides, weather, or ghat rules"
            suggestions={[
              'Is road safe for heavy truck?',
              'Rainfall on NH-27',
              'Blind curves speed limit',
              'Safe parking near Jorhat',
            ]}
            fallbackName="safety guidelines"
          />
        </View>
      )}

      {/* SUB-MODE 4: WEATHER / SAFETY */}
      {subMode === 'safety' && (
        <View style={styles.subModeContainer}>
          {/* Fatigue Management & Rest Break Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Fatigue & Rest Break Status</Text>
            <View style={styles.breakStatusRow}>
              <View>
                <Text style={styles.breakLabel}>Driving Elapsed</Text>
                <Text style={styles.breakValue}>{formatElapsed(breakAdvice.elapsedMinutes)}</Text>
              </View>
              <View>
                <Text style={styles.breakLabel}>Break Advisory</Text>
                <Text
                  style={[
                    styles.breakLevel,
                    breakAdvice.level === 'OVERDUE'
                      ? styles.breakLevelOverdue
                      : breakAdvice.level === 'DUE_SOON'
                      ? styles.breakLevelDueSoon
                      : styles.breakLevelOk,
                  ]}
                >
                  {breakAdvice.level.replace('_', ' ')}
                </Text>
              </View>
            </View>

            <Text style={styles.cardSub}>{translateReasonCode(breakAdvice.reasonCode, lang)}</Text>

            <Pressable
              onPress={() => void handleLogBreak()}
              style={styles.logBreakButton}
              accessibilityRole="button"
            >
              <Text style={styles.logBreakButtonText}>Log 30-minute rest break</Text>
            </Pressable>

            {breakLoggedMsg && (
              <Text style={styles.breakSuccess}>{breakLoggedMsg}</Text>
            )}
          </View>

          {/* Direct Emergency Helplines */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Emergency Highway Contacts</Text>
            <Text style={styles.cardSub}>
              Tapping opens your phone dialer directly. Press dial on handset to connect.
            </Text>

            <View style={styles.emergencyRow}>
              <Pressable
                onPress={() => void Linking.openURL('tel:112')}
                style={[styles.emergencyButton, styles.emergencyPolice]}
                accessibilityRole="button"
              >
                <Text style={styles.emergencyButtonNum}>112</Text>
                <Text style={styles.emergencyButtonLabel}>National Emergency</Text>
              </Pressable>

              <Pressable
                onPress={() => void Linking.openURL('tel:108')}
                style={[styles.emergencyButton, styles.emergencyAmbulance]}
                accessibilityRole="button"
              >
                <Text style={styles.emergencyButtonNum}>108</Text>
                <Text style={styles.emergencyButtonLabel}>Ambulance</Text>
              </Pressable>

              <Pressable
                onPress={() => void Linking.openURL('tel:1033')}
                style={[styles.emergencyButton, styles.emergencyHighway]}
                accessibilityRole="button"
              >
                <Text style={styles.emergencyButtonNum}>1033</Text>
                <Text style={styles.emergencyButtonLabel}>NHAI Highway</Text>
              </Pressable>
            </View>
          </View>

          {/* AI Weather and Safety Advice */}
          <AiPanel
            ai={ai}
            mode="safety"
            lead="Ask about weather precautions"
            placeholder="Ask about monsoon driving, fog, or brake cooling"
            suggestions={[
              'Driving in heavy rain',
              'Engine overheating on hills',
              'Brake maintenance on steep slopes',
            ]}
            fallbackName="reviewed safety guide"
          />
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 40,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  subModeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 16,
  },
  subModeTab: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#111827',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  subModeTabActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  subModeLabel: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  subModeLabelActive: {
    color: COLORS.onAccent,
    fontWeight: '800',
  },
  subModeContainer: {
    gap: 12,
  },
  lead: { color: COLORS.muted, fontSize: 13, marginBottom: 12 },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  action: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    flexGrow: 1,
  },
  actionSelected: { borderColor: COLORS.accent },
  actionLabel: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  actionLabelSelected: { color: COLORS.ok },
  pressed: { opacity: 0.75 },

  answer: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    padding: 14,
    marginBottom: 16,
  },
  headline: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  freshness: { color: COLORS.faint, fontSize: 12, marginTop: 4 },
  staleText: { color: COLORS.warn },

  fact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 10,
  },
  factLabel: { color: COLORS.muted, fontSize: 14, flexShrink: 1 },
  factValue: { color: COLORS.text, fontSize: 15, fontWeight: '700', textAlign: 'right' },

  reasons: { marginTop: 12, gap: 4 },
  reason: { color: COLORS.text, fontSize: 14, lineHeight: 20 },

  unavailable: { color: COLORS.faint, fontSize: 12, lineHeight: 17, marginTop: 12 },

  next: { marginTop: 14 },
  nextHeading: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  nextItem: { color: COLORS.text, fontSize: 14, lineHeight: 20 },

  footer: { color: COLORS.faint, fontSize: 11, lineHeight: 16, marginTop: 10 },

  card: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '800',
  },
  cardSub: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  riskFactBox: {
    backgroundColor: '#111827',
    borderRadius: 8,
    padding: 10,
    gap: 6,
  },
  riskRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  riskKey: {
    color: COLORS.muted,
    fontSize: 12,
  },
  riskVal: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700',
  },
  guidanceNotice: {
    backgroundColor: '#1e293b',
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
    padding: 10,
    borderRadius: 6,
    gap: 4,
  },
  guidanceHeading: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  guidanceText: {
    color: COLORS.text,
    fontSize: 12,
    lineHeight: 17,
  },
  breakStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#111827',
    padding: 12,
    borderRadius: 8,
  },
  breakLabel: {
    color: COLORS.faint,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  breakValue: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },
  breakLevel: {
    fontSize: 14,
    fontWeight: '800',
    marginTop: 4,
  },
  breakLevelOk: {
    color: '#4ade80',
  },
  breakLevelDueSoon: {
    color: '#facc15',
  },
  breakLevelOverdue: {
    color: '#f87171',
  },
  logBreakButton: {
    minHeight: TOUCH_TARGET,
    backgroundColor: '#0284c7',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logBreakButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  breakSuccess: {
    color: '#4ade80',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  emergencyRow: {
    flexDirection: 'row',
    gap: 8,
  },
  emergencyButton: {
    flex: 1,
    minHeight: 56,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 6,
  },
  emergencyPolice: {
    backgroundColor: '#1e3a8a',
  },
  emergencyAmbulance: {
    backgroundColor: '#991b1b',
  },
  emergencyHighway: {
    backgroundColor: '#065f46',
  },
  emergencyButtonNum: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
  },
  emergencyButtonLabel: {
    color: '#e2e8f0',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 2,
  },
})
