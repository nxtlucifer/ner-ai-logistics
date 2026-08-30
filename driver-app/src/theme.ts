/** Shared colours and text styles for the driver app.
 *
 * Deliberately high-contrast with large touch targets: this is read one-handed,
 * in a truck cab, often at night or in rain.
 */

export const COLORS = {
  bg: '#0f172a',
  card: '#1e293b',
  border: '#334155',
  text: '#f1f5f9',
  muted: '#94a3b8',
  faint: '#64748b',
  ok: '#34d399',
  okBg: '#052e1f',
  bad: '#f87171',
  badBg: '#450a0a',
  badBorder: '#7f1d1d',
  warn: '#fbbf24',
  warnBg: '#451a03',
  warnBorder: '#78350f',
  accent: '#059669',
  accentPressed: '#047857',
  disabled: '#1e3a32',
} as const

/** Minimum comfortable touch target. Gloved hands, moving vehicle. */
export const TOUCH_TARGET = 52
