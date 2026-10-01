/**
 * What the dial can say, with no React and no react-native in sight.
 *
 * Split from the component so it can be tested directly: the view needs a
 * native runtime, the rule about which marks exist does not, and the rule is
 * the part that stopped a driver inventing "60%".
 */

/** The marks on a real dial, and the percentage each one means. */
export const FUEL_LEVELS = [
  { pct: 0, mark: 'E', label: 'Empty' },
  { pct: 25, mark: '¼', label: 'One quarter' },
  { pct: 50, mark: '½', label: 'Half' },
  { pct: 75, mark: '¾', label: 'Three quarters' },
  { pct: 100, mark: 'F', label: 'Full' },
] as const

export type FuelPct = (typeof FUEL_LEVELS)[number]['pct']

/**
 * Needle angle for a level: -90 degrees at empty, +90 at full.
 *
 * Clamped, because older rows hold free-typed percentages from the field
 * this replaced and one of them being 140 must not draw a needle pointing
 * into the dashboard.
 */
export function needleAngle(pct: number): number {
  const clamped = Math.max(0, Math.min(100, pct))
  return -90 + (clamped / 100) * 180
}
