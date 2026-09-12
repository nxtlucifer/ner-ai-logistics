/** Shared colours and text styles for the driver app — TERRAIN night palette.
 *
 * Deliberately high-contrast with large touch targets: this is read one-handed,
 * in a truck cab, often at night or in rain. The cab is why this surface stays
 * dark while the manager console is light — they are the same design language
 * rendered for two very different rooms, not two products.
 *
 * TERRAIN'S RULE ON HUE, same as the console:
 *   green = primary action and success
 *   blue  = route geometry and focus, NOTHING else
 *   amber = caution
 *   red   = emergency / error
 *
 * ON DARK, THE LIGHT-MODE VALUES DO NOT TRANSFER. Terrain's light primary
 * (#087F5B) is 1.6:1 on this canvas and its emergency red (#B42318) is 3.0:1 —
 * both unreadable in a cab. The night column is a different set of numbers
 * expressing the same meanings, and every value below was checked against
 * `bg` rather than assumed from the light palette:
 *
 *   text     #F5F8F6 -> 16.6:1      muted   #B4C2BA ->  9.6:1
 *   accent   #34D399 ->  9.2:1      aqua    #6EE7B7 -> 11.6:1
 *   routeOn  #93B4FF ->  8.6:1      warn    #FBBF24 -> 10.6:1
 *   bad      #F87171 ->  6.4:1      faint   #8B9C93 ->  6.2:1
 *   dim      #7D8E85 ->  5.1:1
 */

export const COLORS = {
  /* --- Ground ----------------------------------------------------------- */
  bg: '#101820',
  /** Below the canvas. Inset wells, code blocks, the sunken half of a split. */
  sunken: '#0B1116',
  card: '#1D2A32',
  /** Above the card. A chip or input sitting ON a card still needs to lift. */
  raised: '#26343D',
  border: '#2C3B44',
  /** For a border that has to hold its own against a raised surface. */
  borderStrong: '#3B4C56',
  soft: '#1B2632',
  disabled: '#233039',

  /* --- Type ------------------------------------------------------------- */
  text: '#F5F8F6',
  muted: '#B4C2BA',
  faint: '#8B9C93',
  /** Quietest readable step. Still clears 4.5:1 — the slate it replaced
   *  (#475569) was 2.1:1, i.e. decoration masquerading as text. */
  dim: '#7D8E85',

  /* --- Action ----------------------------------------------------------- */
  /**
   * Terrain's night action: mint with a DARK label. Inverting the label is not
   * a style choice — white on #34D399 is 2.1:1 and fails outright, while
   * #101820 on it is 9.2:1. This was #2563EB with a white label, which is the
   * console's action colour; on this surface blue now means route only.
   */
  accent: '#34D399',
  accentPressed: '#10B981',
  onAccent: '#101820',

  /** Brand mint. Eyebrows, brand marks, quiet emphasis — never a CTA. Kept a
   *  step lighter than `accent` so a brand line never reads as a button. */
  aqua: '#6EE7B7',

  /* --- Route and focus — blue, reserved --------------------------------- */
  /** Geometry fill: map strokes, the route chip. Not for text — 2.9:1 here. */
  route: '#2563EB',
  /** The readable form of route blue, for labels and icons on dark. */
  routeOn: '#93B4FF',
  routeBg: '#16273D',

  /* --- Status ----------------------------------------------------------- */
  /** Verified / safe. Reads as "checked and clear", never as "go". */
  ok: '#34D399',
  okBg: '#0E2A22',
  okBorder: '#186449',
  warn: '#FBBF24',
  warnBg: '#2E2410',
  warnBorder: '#7A5B12',
  bad: '#F87171',
  badBg: '#2E1516',
  badBorder: '#7F2A2A',
  /** Saturated emergency fill. Carries white, never carries small text. */
  badStrong: '#DC2626',
} as const

/** Minimum comfortable touch target. Gloved hands, moving vehicle. */
export const TOUCH_TARGET = 52

/* ---------------------------------------------------------------------------
   DAY / NIGHT
   ---------------------------------------------------------------------------
   `COLORS` above is the night palette and stays the default export shape, so
   nothing that already imports it changes meaning. DAY has the identical key
   set - that is the whole contract, and it is what lets a screen's stylesheet
   be rebuilt for either palette without touching a single call site.

   Why a factory rather than a mutable object: StyleSheet.create copies values
   at module import, so mutating a shared COLORS object after a toggle changes
   nothing on screen. Styles have to be BUILT per palette.
   --------------------------------------------------------------------------- */

// Widened from `typeof COLORS`: that palette is `as const`, so its type is the
// literal hex strings and a second palette could never satisfy it.
export type Palette = { readonly [K in keyof typeof COLORS]: string }

/** Day palette. Same keys as COLORS, tuned for a lit cab and daylight glare. */
export const DAY: Palette = {
  bg: '#F5F7FA',
  sunken: '#EEF2F7',
  card: '#FFFFFF',
  raised: '#F1F5F9',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  soft: '#F1F5F9',
  disabled: '#E2E8F0',

  text: '#0F172A',
  muted: '#64748B',
  faint: '#7C8B9C',
  dim: '#8A97A6',

  /* Green stays the action, but the DAY value is the darker one: #34D399
     carries white at 1.9:1 and is unreadable as a button on a light ground.
     #16875F takes white at 4.9:1. onAccent flips to white for the same
     reason the night palette flips it to charcoal. */
  accent: '#16875F',
  accentPressed: '#0F6B4B',
  onAccent: '#FFFFFF',

  aqua: '#0F766E',

  route: '#2563EB',
  routeOn: '#1D4ED8',
  routeBg: '#EAF0FE',

  ok: '#16875F',
  okBg: '#E7F3EE',
  okBorder: '#8FD3B8',
  warn: '#B45309',
  warnBg: '#FBF1E3',
  warnBorder: '#E4B778',
  bad: '#B42318',
  badBg: '#FCEFED',
  badBorder: '#EBA9A2',
  badStrong: '#DC2626',
}

export const NIGHT: Palette = COLORS
