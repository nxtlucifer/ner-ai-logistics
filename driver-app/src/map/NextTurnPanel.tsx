/**
 * The next instruction, or an honest statement of why there isn't one.
 *
 * WHAT IT WILL NOT DO
 *
 * It does not count down on a timer. Every distance on screen comes from a
 * server-derived position along the route, so when the fixes stop the number
 * stops with them and the panel says the guidance is paused. A panel that keeps
 * ticking without a fix is inventing progress, and it is convincing precisely
 * because it looks alive.
 *
 * It does not invent an instruction from geometry. A route with no stored
 * maneuvers shows "directions unavailable" over a perfectly good map, which is
 * the honest degradation: the road is still the road.
 *
 * WORDING IS A TEMPLATE, NOT A SENTENCE FROM A MODEL
 *
 * `type` and `modifier` come from the provider and are composed here into
 * fixed phrasing. Nothing generates prose. The full localisation of these
 * templates is G4 work; today they are English with the structure in place for
 * the catalogue to fill.
 */

import { StyleSheet, Text, View } from 'react-native'

import type { NavigationManeuver } from '../api/client'
import {
  formatTurnDistance,
  instructionFor,
  maneuverIcon,
  type GuidanceHold,
} from './maneuvers'
import { translateReasonCode, type Language } from '../i18n/reasonCodes'

import { Icon } from '../components/icons'
import { useT } from '../i18n/tx'
import { makeStyles, useTheme } from '../theme-context'

export interface NextTurnPanelProps {
  /** Null when nothing is upcoming - no fix, no directions, or arrived. */
  next: { maneuver: NavigationManeuver; distanceM: number } | null
  /** Whether the server could supply guidance for this route at all. */
  available: boolean
  /** Why not, when it could not. Rendered through the shared catalogue. */
  reasonCodes: readonly string[]
  /** Why guidance is held, or null when it may run. */
  hold: GuidanceHold
  language: Language
}

/**
 * What to tell the driver for each hold.
 *
 * Each says what happened AND that the route is still there, because the most
 * likely reading of a paused navigation panel is "the app has broken".
 */
const HOLD_TEXT: Record<Exclude<GuidanceHold, null>, [string, string]> = {
  PERMISSION: [
    'Guidance paused',
    'Location is off. Turn it on to see turn-by-turn directions. The route is still shown.',
  ],
  NO_FIX: [
    'Guidance paused',
    'Waiting for a location fix. The route is still shown.',
  ],
  FIX_STALE: [
    'Guidance paused',
    'Your last position is too old to guide from. The route is still shown.',
  ],
  CONTACT_LOST: [
    'Guidance paused',
    'No recent contact with the server, so your position cannot be confirmed. The route is still shown.',
  ],
  // Stated, not acted on. Choosing a different road is a manager decision with
  // a hazard review behind it, and a GPS reading is not permission to make it.
  OFF_ROUTE: [
    'Off the planned route',
    'Directions are paused because your position is not on the assigned road. Ask your manager to replan.',
  ],
}

export default function NextTurnPanel({
  next,
  available,
  reasonCodes,
  hold,
  language,
}: NextTurnPanelProps) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  if (!available) {
    // The route is drawable; only the instructions are missing. Say which.
    const explained = reasonCodes
      .map((code) => translateReasonCode(code, language))
      .filter(Boolean)
    return (
      <View style={styles.panel} testID="next-turn-panel">
        <Text style={styles.state}>{t('Directions unavailable')}</Text>
        <Text style={styles.detail} numberOfLines={2}>
          {explained[0] ?? t('This route has no stored directions.')}
        </Text>
      </View>
    )
  }

  if (hold !== null) {
    // Guidance exists; a trustworthy position does not. NOT the same as
    // unavailable, and the driver needs to know it resumes on its own.
    const [state, detail] = HOLD_TEXT[hold]
    return (
      <View style={styles.panel} testID="next-turn-panel">
        <Text style={styles.state}>{t(state)}</Text>
        <Text style={styles.detail}>{t(detail)}</Text>
      </View>
    )
  }

  if (next === null) {
    return (
      <View style={styles.panel} testID="next-turn-panel">
        <Text style={styles.state}>{t('No further turns')}</Text>
        <Text style={styles.detail}>{t('Continue to the destination.')}</Text>
      </View>
    )
  }

  const icon = maneuverIcon(next.maneuver)

  return (
    <View style={styles.panel} testID="next-turn-panel">
      <View style={styles.topRow}>
        <Icon name={icon} size={28} color={COLORS.text} />
        <Text style={styles.distance} testID="next-turn-distance">
          {formatTurnDistance(next.distanceM)}
        </Text>
      </View>
      <Text style={styles.instruction} numberOfLines={2} testID="next-turn-instruction">
        {instructionFor(next.maneuver, t)}
      </Text>
      {next.maneuver.name ? (
        <Text style={styles.roadName} numberOfLines={1}>
          {next.maneuver.name}
        </Text>
      ) : null}
    </View>
  )
}

/**
 * Terrain puts the maneuver card in CHARCOAL, not blue.
 *
 * The card used to be a blue panel with blue-tinted text on it, floating over a
 * map whose route line is also blue. Over a blue basemap stretch the card lost
 * its edge entirely, and the one element that must never be ambiguous — the
 * next turn — was the same hue as the road it was describing. Charcoal gives
 * the card a constant, map-independent ground, and frees blue to mean route.
 * The maneuver ARROW keeps route blue, because that is the one glyph that is
 * genuinely about the road.
 */
const useStyles = makeStyles((COLORS) => ({
  panel: {
    backgroundColor: COLORS.bg,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 3,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  icon: {
    color: COLORS.routeOn,
    fontSize: 30,
    fontWeight: '900',
  },
  // Large because it is read at a glance from a driving position.
  distance: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  instruction: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  roadName: {
    color: COLORS.routeOn,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 1,
  },
  state: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
  },
  detail: {
    color: COLORS.muted,
    fontSize: 13,
  },
}))

