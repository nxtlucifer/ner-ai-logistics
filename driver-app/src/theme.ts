/** Shared colours for the driver app: one Light and one Dark palette with the
 *  SAME semantic keys, so a component never needs to know which is showing.
 *
 * Deliberately high-contrast with large touch targets: this is read one-handed,
 * in a truck cab, often at night or in rain.
 *
 * THE RULE ON HUE, same as the console:
 *   green = primary action, active state, success and data - never a surface
 *   blue  = route geometry and focus
 *   amber = caution
 *   red   = emergency / error
 *
 * DARK IS BLACK, NOT GREEN. Every Dark ground below is a near-black neutral
 * (HSL saturation <= 12%); green appears only as `primary` / `accent` /
 * `success` / `brand`. `src/theme.contrast.test.ts` holds that, plus WCAG AA
 * for every readable token on every ground it can land on, in both palettes.
 *
 * KEY MAP (Phase A rename, 27 Sep 2026). Old key -> canonical key:
 *   bg -> bg                 card -> surface          raised -> surfaceRaised
 *   soft -> surfaceSoft      sunken -> surfaceSunken  border -> border
 *   borderStrong -> borderStrong                      disabled -> disabled
 *   text -> text             muted -> textMuted       faint -> textFaint
 *   dim -> textDim           aqua -> brand
 *   accent -> primary (a FILL that carries `onPrimary`, and the border of that
 *             fill) or accent (text, icon, active outline, data) - split by
 *             hand at each call site, never mechanically
 *   accentPressed -> primaryHover                     onAccent -> onPrimary
 *   route -> route           routeOn -> info          routeBg -> infoSoft
 *   ok -> success            okBg -> successSoft      okBorder -> successBorder
 *   warn -> warning          warnBg -> warningSoft    warnBorder -> warningBorder
 *   bad -> danger            badBg -> dangerSoft      badBorder -> dangerBorder
 *   badStrong -> dangerStrong
 *
 * Two deliberate differences from the audit's token table:
 *   - soft and sunken stay TWO keys. In Light they are the same value; in Dark
 *     a sunken input well sits BELOW the canvas while a soft fill (pressed,
 *     selected) sits above the card. One key could not be both.
 *   - faint and dim stay two keys (textFaint, textDim). Their Light values
 *     differ, and Phase A must not move a Light pixel. The order is the same
 *     in both palettes, loudest first: textMuted, textDim, textFaint.
 */

export type ThemeMode = 'light' | 'dark'

/** Light. Cream and sage, matching the manager console's canvas. These are
 *  the values the driver app shipped with before the rename, unchanged. */
export const LIGHT = {
  /* --- Ground ----------------------------------------------------------- */
  bg: '#EEF3ED',
  surface: '#FDFDFB',
  /** Above the surface. A chip or input sitting ON a card still needs to lift. */
  surfaceRaised: '#F2F7F2',
  /** Pressed, selected and active fills. */
  surfaceSoft: '#E4EDE4',
  /** Below the canvas. Input wells, code blocks, the sunken half of a split. */
  surfaceSunken: '#E4EDE4',
  border: '#D3DED2',
  /** A control outline that has to hold its own against a raised surface. */
  borderStrong: '#B6C7B8',
  /** The fill of a control that cannot be used yet. */
  disabled: '#DCE6DB',

  /* --- Type ------------------------------------------------------------- */
  text: '#101820',
  textMuted: '#4C5A51',
  textFaint: '#5E6D64',
  /** Between textMuted and textFaint: a step louder than faint. Still clears
   *  4.5:1 on every ground. */
  textDim: '#5A685F',

  /* --- Action ----------------------------------------------------------- */
  /** The CTA fill. Dark forest takes white at 12.9:1. */
  primary: '#14382E',
  primaryHover: '#0C2A21',
  onPrimary: '#FFFFFF',
  /** The CTA fill while it cannot be used, drawn at 50% (audit s16.3 #12).
   *  Light: the forest itself, which lands as sage. */
  primaryDisabled: '#14382E',
  /** Accent text, icons, active outlines, data. Same value as `primary` in
   *  Light today; the split exists so Phase B can move one without the other. */
  accent: '#14382E',
  /** Brand mint for eyebrows and brand marks - never a CTA. */
  brand: '#0F5C46',

  /* --- Route and focus - blue, reserved --------------------------------- */
  /** Route FILL: the maneuver card, progress bars, route dots. Carries white. */
  route: '#2563EB',
  /** Readable blue for labels and icons. */
  info: '#1D4ED8',
  infoSoft: '#EAF0FE',

  /* --- Status ----------------------------------------------------------- */
  /** Verified / safe. Reads as "checked and clear", never as "go". */
  success: '#076C4D',
  successSoft: '#DFEFE4',
  successBorder: '#8FD3B8',
  warning: '#8A4B09',
  warningSoft: '#F7EBD8',
  warningBorder: '#E4B778',
  danger: '#A9271D',
  dangerSoft: '#F9DDDC',
  dangerBorder: '#EBA9A2',
  /** Saturated emergency fill. Carries white, never carries small text. */
  dangerStrong: '#DC2626',
  /** Text and icons ON the two saturated fills, `route` and `dangerStrong`
   *  (the maneuver card, SOS, Call 112). White in both themes, because both
   *  fills keep their value in Dark. */
  onFill: '#FFFFFF',

  /* --- Photographs (Phase B1) -------------------------------------------
     Scrims are overlays drawn by the component, never baked into a file, so
     one photo serves both themes. Light keeps the photo bright and puts a
     forest scrim only where light text sits; Dark veils the whole photo in
     neutral black. */
  /** Where light text sits on a photo: the dense end of a scrim gradient. */
  imageScrim: 'rgba(2,33,27,0.62)',
  /** A veil over the whole photo. None in Light. */
  imageDim: 'rgba(0,0,0,0)',
  /** A veil over a photo's sky, where the login draws its wordmark in `text`
   *  ink. None in Light: dark ink on a bright sky, as driver_01. */
  imageTopVeil: 'rgba(0,0,0,0)',
  /** The plate under a photo credit: white on it clears 6:1 over a white sky. */
  imageCaption: 'rgba(0,0,0,0.62)',
  /** Text and icons drawn straight onto a scrimmed photo. */
  onPhoto: '#FFFFFF',
  onPhotoAccent: '#9BE8C8',
  /** A screen hero's veil behind its title, and the title's ink. Light
   *  follows driver_04: a pale morning veil with dark ink, so the hero
   *  stays bright. Dark: the black scrim with white ink. */
  heroVeil: 'rgba(243,249,245,0.66)',
  onHero: '#101820',
  /** A frosted card over a photo, its input wells and its edge. */
  glass: 'rgba(236,242,238,0.88)',
  glassWell: 'rgba(186,201,197,0.45)',
  glassBorder: 'rgba(255,255,255,0.7)',
  /** Behind a modal sheet. */
  overlay: 'rgba(7,12,10,0.48)',
  /** The drop shadow under a raised card (the splash). Black in both themes;
   *  the card's shadowOpacity sets how much of it shows. */
  shadow: '#000000',
  /** A row disc with no status to report: a cool grey, so it is neither the
   *  mint of an action nor the amber of a caution. */
  discNeutral: '#E9EDF1',
  /** The one row disc that means "action" (My details). */
  discAction: '#DFEFE4',

  /* --- Shell: the floating tab bar -------------------------------------
     Forest in Light (the references), charcoal in Dark. */
  shell: '#062621',
  shellBorder: '#18463B',
  /** The active tab's pill. */
  shellActive: '#136853',
  onShell: '#F5F8F6',
  onShellMuted: '#9FB0A8',
  /** The active tab's icon and label, on `shellActive`. */
  shellAccent: '#A6F0D4',
}

// Widened from `typeof LIGHT`'s literal values so a second palette can satisfy it.
export type Palette = { readonly [K in keyof typeof LIGHT]: string }

/** Dark. Black and near-black neutrals; green only where it means something. */
export const DARK: Palette = {
  bg: '#070808',
  surface: '#0E1110',
  surfaceRaised: '#151918',
  surfaceSoft: '#1B201E',
  surfaceSunken: '#050606',
  border: '#2A302D',
  borderStrong: '#6B746F',
  disabled: '#222725',

  text: '#F5F6F2',
  textMuted: '#AAB2AD',
  textFaint: '#8C958F',
  // Lighter than textFaint, as in Light: the same key keeps the same emphasis.
  textDim: '#939C96',

  /** Mint with a DARK label: white on #39D8A0 is 1.8:1, #070808 on it is 11:1. */
  primary: '#39D8A0',
  primaryHover: '#19B97F',
  onPrimary: '#070808',
  /** Grey-mint: at 50% on the charcoal card it reads as switched off, where
   *  mint at 50% still read as a live green button. */
  primaryDisabled: '#8FA59C',
  accent: '#39D8A0',
  /** A step lighter than `accent`, so a brand line never reads as a button. */
  brand: '#7FE3BE',

  /** Kept at the Light value on purpose: in this app `route` is a fill that
   *  carries white (5.2:1). The map line uses the lighter `info` blue in Dark
   *  (see map/scene.ts), and readable blue text uses `info`. */
  route: '#2563EB',
  info: '#62A8FF',
  infoSoft: '#0F1D2E',

  success: '#39D8A0',
  /** Neutral on purpose (HSL S 11.6%): a success banner must not become a
   *  green slab. The audit's #12241C is 31% saturated. */
  successSoft: '#131816',
  successBorder: '#1F7A57',
  warning: '#E6AE4A',
  warningSoft: '#2A2111',
  warningBorder: '#7A5B12',
  danger: '#FF5D67',
  dangerSoft: '#2E1517',
  dangerBorder: '#7F2A2A',
  dangerStrong: '#C62A2F',
  onFill: '#FFFFFF',

  // Neutral black only: a Dark photo keeps its colour under a black veil.
  imageScrim: 'rgba(0,0,0,0.80)',
  // Light enough that the photo still reads as a photo. The login adds
  // imageTopVeil over its sky: a white sky under both lands at #363636, a
  // charcoal rather than the mid-grey slab 0.5 left, where text is 11:1 and
  // brand 8:1 (theme.contrast.test.ts).
  imageDim: 'rgba(0,0,0,0.4)',
  imageTopVeil: 'rgba(0,0,0,0.65)',
  imageCaption: 'rgba(0,0,0,0.62)',
  onPhoto: '#FFFFFF',
  onPhotoAccent: '#39D8A0',
  heroVeil: 'rgba(0,0,0,0.80)',
  onHero: '#FFFFFF',
  glass: 'rgba(14,17,16,0.86)',
  glassWell: 'rgba(0,0,0,0.4)',
  glassBorder: 'rgba(255,255,255,0.08)',
  overlay: 'rgba(0,0,0,0.64)',
  shadow: '#000000',
  discNeutral: '#1B1F21',
  // A step LIGHTER than discNeutral, so the one toned disc is the one you
  // see; the mint ink carries the meaning. successSoft (#131816) sat at
  // 1.06:1 on the card and read as no disc at all.
  discAction: '#1D2220',

  // A step above the page (#070808), with a visible edge: at the audit's
  // #0A0C0B the bar disappeared into the ground.
  shell: '#121514',
  shellBorder: '#2A302D',
  shellActive: '#232826',
  onShell: '#F5F6F2',
  onShellMuted: '#AAB2AD',
  shellAccent: '#39D8A0',
}

export const PALETTES: Record<ThemeMode, Palette> = { light: LIGHT, dark: DARK }

/* --- The route map -------------------------------------------------------
   What map/scene.ts draws on both platforms; raw hex in scene.ts until
   REG-5. Two kinds of colour:
   - Chrome that only exists to sit on a LIGHT basemap (the route and its
     casing, the backup line, the driven stretch, the ground, the in-map
     buttons) has a Light value and a Dark one taken from DARK.
   - Data hues (terrain, fleet traffic, GPS state, service categories) are
     meanings, so they keep ONE value in both themes and stay true colour over
     the Dark basemap. Except green: Dark keeps green for the accent, so where
     the meaning is green (a live GPS fix, flowing traffic) Dark draws
     `success`, as the manager's --map-flowing does. No service pin is green
     in either theme. Every Light value is the one the map drew before. */
export const MAP_LIGHT = {
  route: LIGHT.route,
  casing: '#FFFFFF',
  /** The edge under a terrain stroke. Light: the route casing already is it. */
  terrainCasing: '#FFFFFF',
  backup: '#475569',
  completed: '#93B9AF',
  /** Fallback fill for a service category with no colour of its own. */
  place: '#75847D',
  /** Behind the tiles, before they load: must match the theme or it flashes. */
  ground: '#E8EDEB',
  control: '#FFFFFF',
  controlBorder: '#D5DEDA',
  controlText: LIGHT.text,

  hilly: '#B45309',
  steep: '#B42318',
  /** The first stop's fill. */
  origin: '#101820',
  /** Pin rims, the landslide dot's centre and the truck arrow's halo. */
  halo: '#FFFFFF',
  gpsLive: '#087F5B',
  gpsNetwork: '#B45309',
  gpsLastKnown: '#6B7280',
  /** Fleet traffic per KNOWN state; UNKNOWN has no colour on purpose. */
  traffic: { NORMAL: '#16A34A', SLOW: '#D97706', CONGESTED: '#DC2626' } as Record<string, string>,
  /** Service pins. None reuses route blue or live green; FUEL and TYRES are
   *  the manager's --poi-fuel and --poi-tyres, so one category is one colour
   *  in both apps. FUEL was green (#15803D) until REG-5. */
  category: { FUEL: '#6D28D9', EMERGENCY: '#B42318', TYRES: '#475569', HOTEL: '#0891B2', REST: '#CA8A04' } as Record<string, string>,
}

export type MapPalette = typeof MAP_LIGHT

export const MAP_DARK: MapPalette = {
  ...MAP_LIGHT,
  // The lighter route blue on the dark basemap (the manager console uses it too).
  route: DARK.info,
  // A dark casing separates the line from the tiles the way white does on Light.
  casing: DARK.bg,
  // Terrain keeps the light edge it has in Light: on the black casing the
  // steep red is 3.05:1, on this edge 6.1:1. The data hue itself stays.
  terrainCasing: DARK.text,
  backup: DARK.textMuted,
  // Neutral grey for the driven stretch: the Light sage is a green tint.
  completed: DARK.borderStrong,
  place: DARK.textFaint,
  ground: DARK.bg,
  control: DARK.surface,
  controlBorder: DARK.border,
  controlText: DARK.text,
  gpsLive: DARK.success,
  traffic: { ...MAP_LIGHT.traffic, NORMAL: DARK.success },
}

export const MAP_PALETTES: Record<ThemeMode, MapPalette> = { light: MAP_LIGHT, dark: MAP_DARK }

/** Minimum comfortable touch target. Gloved hands, moving vehicle. */
export const TOUCH_TARGET = 52
