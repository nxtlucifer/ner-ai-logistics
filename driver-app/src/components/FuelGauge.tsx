/**
 * A fuel gauge the driver matches against the one in the cab.
 *
 * WHY NOT A PERCENTAGE BOX
 *
 * The old field asked for "a whole percentage between 0 and 100". No truck
 * has that. A driver looking at a needle between a half and three-quarters
 * had to invent a number - 60? 65? - and the number they invented was then
 * stored as though it had been measured. A gauge that offers the positions a
 * real dial has asks a question the driver can actually answer.
 *
 * WHY THESE FIVE
 *
 * E, quarter, half, three-quarters, F are the marks on the dial. Offering
 * eighths would be inventing precision the driver cannot read off the
 * instrument.
 *
 * WHAT THIS IS NOT
 *
 * Not telemetry. There is no CAN bus, no OBD dongle and no sender unit in
 * this system, so every value here is DRIVER REPORTED and the caller must
 * label it that way with the time it was given. A gauge that looks live
 * while being a memory of a glance an hour ago is worse than no gauge.
 *
 * No SVG dependency: the arc is a bordered half-disc and the needle is a
 * rotated View. Adding a drawing library for one dial would be a bigger
 * change than the dial.
 */

import { Pressable, Text, View } from 'react-native'

import { FUEL_LEVELS, needleAngle, type FuelPct } from './fuelLevels'
import { useT } from '../i18n/tx'
import { TOUCH_TARGET } from '../theme'
import { makeStyles, useTheme } from '../theme-context'

const DIAL_WIDTH = 176

export { FUEL_LEVELS, needleAngle, type FuelPct }

export default function FuelGauge({
  value,
  onChange,
  disabled = false,
}: {
  /** null when the driver has not said. Never defaulted to a number. */
  value: number | null
  onChange: (pct: FuelPct) => void
  disabled?: boolean
}) {
  const styles = useStyles()
  const { colors: COLORS } = useTheme()
  const t = useT()
  const angle = needleAngle(value ?? 0)

  return (
    <View style={styles.wrap}>
      <View style={styles.dial} accessibilityRole="image" accessibilityLabel={
        value === null
          ? t('Fuel not reported')
          : `${t('Fuel')}: ${FUEL_LEVELS.find((l) => l.pct === value)?.label ?? `${value}%`}`
      }>
        <Text style={[styles.endMark, styles.endMarkLeft]}>E</Text>
        <Text style={[styles.endMark, styles.endMarkRight]}>F</Text>
        {value === null ? null : (
          <View style={[styles.needle, { transform: [{ rotate: `${angle}deg` }] }]}>
            <View style={styles.needleBar} />
          </View>
        )}
        <View style={[styles.hub, { backgroundColor: value === null ? COLORS.textFaint : COLORS.accent }]} />
      </View>

      <Text style={styles.reading}>
        {value === null
          ? t('Fuel not reported')
          : t(FUEL_LEVELS.find((l) => l.pct === value)?.label ?? 'Fuel')}
      </Text>

      <View style={styles.marks}>
        {FUEL_LEVELS.map((level) => {
          const selected = value === level.pct
          return (
            <Pressable
              key={level.pct}
              onPress={() => onChange(level.pct)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={t(level.label)}
              style={[styles.mark, selected && styles.markSelected, disabled && styles.markDisabled]}
            >
              <Text style={[styles.markText, selected && styles.markTextSelected]}>
                {level.mark}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const useStyles = makeStyles((COLORS) => ({
  wrap: { alignItems: 'center', gap: 10 },
  dial: {
    width: DIAL_WIDTH,
    height: DIAL_WIDTH / 2,
    borderWidth: 3,
    borderBottomWidth: 0,
    borderColor: COLORS.borderStrong,
    borderTopLeftRadius: DIAL_WIDTH / 2,
    borderTopRightRadius: DIAL_WIDTH / 2,
    backgroundColor: COLORS.surfaceSunken,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  endMark: { position: 'absolute', bottom: 6, color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  endMarkLeft: { left: 12 },
  endMarkRight: { right: 12 },
  // The needle rotates about the bottom-centre hub, so the container is the
  // full dial and the bar is drawn upward from its own bottom edge.
  needle: {
    position: 'absolute',
    bottom: 0,
    width: 4,
    height: DIAL_WIDTH / 2 - 14,
    alignItems: 'center',
    transformOrigin: 'bottom',
  },
  needleBar: { flex: 1, width: 4, borderRadius: 2, backgroundColor: COLORS.accent },
  hub: { position: 'absolute', bottom: -7, width: 14, height: 14, borderRadius: 7 },
  reading: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  marks: { flexDirection: 'row', gap: 8 },
  mark: {
    minWidth: TOUCH_TARGET,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  // Selected is a filled box AND a heavier border, not a colour swap: a
  // gauge read in sunlight through a windscreen cannot rely on hue.
  markSelected: { backgroundColor: COLORS.surfaceSoft, borderColor: COLORS.accent, borderWidth: 2 },
  markDisabled: { opacity: 0.5 },
  markText: { color: COLORS.textMuted, fontSize: 18, fontWeight: '700' },
  markTextSelected: { color: COLORS.accent },
}))
