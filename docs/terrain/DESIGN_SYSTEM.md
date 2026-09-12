# TERRAIN — design system

The visual language for both surfaces of NER Fleet Intelligence (SIH26002, MDoNER).

Two token layers, one language. Neither app imports the other's:

| Surface | Token layer | Consumed by |
|---|---|---|
| `manager-web` | `@theme` in `src/index.css` | Tailwind utilities (`bg-primary`, `text-muted`, …), ~380 call sites |
| `driver-app` | `COLORS` in `src/theme.ts` | React Native `StyleSheet`, every screen |

The token **names** are load-bearing and were not renamed. `--color-navy` is now
charcoal; keeping the name meant retuning values in one file instead of editing
380 call sites to say the same thing.

---

## The one hard rule: what each hue is allowed to mean

```
green   primary action, and success
blue    route geometry, and keyboard focus — NOTHING else
amber   caution
red     emergency / error
```

A blue button in this product is a bug: it is claiming to be a road.

This rule is why several things moved during the redesign:

- `ON_TRIP` status pills went blue. Under Terrain `primary` and `ok` are the
  same green, so a moving truck rendered identically to an idle available one —
  the single most consequential pair on the fleet page to be unable to tell
  apart. Blue is also the *correct* answer, not merely a free one: a truck
  ON_TRIP is a truck on a route.
- The driver's next-maneuver card went charcoal. It was a blue panel floating
  over a map whose route line is also blue; over a blue basemap stretch it lost
  its edge entirely.
- The map's alternative-route stroke went from orange to muted grey. It sat one
  hue from the stale-position amber, so "another road you could take" and "this
  fix is stale" were nearly the same colour on the same canvas.
- The AI answer box and the "Log break" button gave up their blues. An advisory
  suggestion is the last thing that should borrow the colour meaning *this is
  your road*.

---

## Palette

### Light — manager console

| Role | Token | Value | Contrast |
|---|---|---|---|
| Canvas | `--color-canvas` | `#F6F8F7` | — |
| Surface | `--color-surface` | `#FFFFFF` | — |
| Muted surface | `--color-soft` | `#EEF3F0` | — |
| Primary text | `--color-ink` | `#101820` | 18.1:1 on surface |
| Secondary text | `--color-muted` | `#52615A` | 6.5:1 surface · 4.6:1 canvas |
| Divider | `--color-line` | `#D5DEDA` | — |
| Control outline | `--color-outline` | `#75847D` | — |
| Charcoal shell | `--color-navy` | `#101820` | — |
| Shell surface / line | `--color-navy-surface` / `-line` | `#1D2A32` / `#2C3B44` | — |
| Brand eyebrow **(dark only)** | `--color-aqua` | `#34D399` | 9.2:1 on shell · **1.9:1 on white** |
| Primary action | `--color-primary` | `#087F5B` | 5.0:1, white on it 5.0:1 |
| Pressed | `--color-primary-hover` | `#066449` | — |
| Route / focus | `--color-route` | `#2563EB` | 5.2:1 |
| Caution | `--color-warning` | `#B45309` | 5.0:1 |
| Emergency | `--color-danger` | `#B42318` | 6.7:1 |

`--color-aqua` is the one token that is **not** safe everywhere. Put it on
charcoal only. On the login mark it is swapped for `--color-primary` in the
light variant, because it was previously hard-coded to the dark value in both
places and left the product name invisible on white.

`-soft` = tint behind text. `-strong` = saturated fill for map strokes and dots,
where the colour sits under white rather than carrying text.

### Dark — driver cab

The cab is dark because it is read one-handed, at night, in rain. Terrain's
light values **do not transfer**: its primary green is 1.6:1 here and its
emergency red 3.0:1. The night column is a different set of numbers expressing
the same meanings.

| Role | Token | Value | Contrast on `bg` |
|---|---|---|---|
| Canvas | `bg` | `#101820` | — |
| Sunken (input wells) | `sunken` | `#0B1116` | — |
| Card | `card` | `#1D2A32` | — |
| Raised (chip on a card) | `raised` | `#26343D` | — |
| Border / strong | `border` / `borderStrong` | `#2C3B44` / `#3B4C56` | — |
| Text | `text` | `#F5F8F6` | 16.6:1 |
| Secondary | `muted` | `#B4C2BA` | 9.6:1 |
| Tertiary | `faint` | `#8B9C93` | 6.2:1 |
| Quietest readable | `dim` | `#7D8E85` | 5.1:1 |
| Action | `accent` + `onAccent` | `#34D399` on `#101820` | 9.2:1 |
| Brand mint | `aqua` | `#6EE7B7` | 11.6:1 |
| Route fill / route text | `route` / `routeOn` | `#2563EB` / `#93B4FF` | — / 8.6:1 |
| Caution | `warn` | `#FBBF24` | 10.6:1 |
| Error | `bad` | `#F87171` | 6.4:1 |

**The night action carries a dark label.** White on `#34D399` is 2.1:1 and fails
outright; `#101820` on it is 9.2:1. Anything placed on `accent` — label,
spinner, icon — takes `onAccent`.

`dim` replaced a `#475569` that was 2.1:1: decoration masquerading as text.

### Map geometry (light basemap, both apps)

Hard-coded in `DriverRouteMap.*` and `FleetMap.tsx` rather than read from the
palettes — the map is the one surface that stays light in both products, and cab
colours are unreadable on daylight tiles.

| Meaning | Value | Drawn as |
|---|---|---|
| Planned route | `#2563EB` | dashed |
| Observed track | `#101820` | solid |
| Alternative route | `#75847D` | solid, muted |
| Live position | `#087F5B` | — |
| Last known / stale | `#B45309` | — |

Planned vs observed is carried by the **dash**, not the hue, so a dispatcher
with a colour vision deficiency still reads which is which.

---

## Type

Sora for display, Inter for UI; both `display=swap` over a system stack, so a
blocked font never blanks a dispatcher's screen.

| Role | Size |
|---|---|
| Page heading | 28 / -0.8px |
| Section heading | 24 |
| Body | 16 (driver) · 14 (console) |
| Supporting | 14 / 12 |
| Navigation maneuver | 28–32 |

`.eyebrow` — the micro-caps register from the reference boards
("PEOPLE · GOODS · A STRONGER NORTHEAST"): 10px / 600 / `0.16em` / uppercase.
It lives in `@layer components` on purpose. Tailwind 4 orders its layers
`theme → base → components → utilities`, and an **unlayered** rule outranks every
layered one — declaring `.eyebrow` at top level would make it beat a
`text-[9.5px]` sitting on the same element.

`.tnum` for any number compared against another number. Proportional digits make
a column of ETAs jitter as it updates, which reads as instability on a live
console.

Respect device font scaling. Never shrink essential text to make a layout fit.

## Spacing, radii, elevation

Spacing `4 · 8 · 12 · 16 · 24 · 32 · 48`.

| | Console | Driver |
|---|---|---|
| Controls | 8px (`--radius-control`) | 10px |
| Cards | 12px (`--radius-card`) | 12px |
| Sheets | — (no sheet here) | 20px |

The driver app keeps a documented 10–12 scale rather than Terrain's 8: its
controls are 52–56dp tall, where a tighter radius reads hard.

Elevation is **two layers**, never one: a tight contact shadow that seats the
element, plus a wide diffuse one for air. A single blurred shadow is what makes
an interface look cheap — the contact layer is the part the eye reads as *this
object is really there*. Tinted with the ink hue, never pure black.

```
--shadow-card   0 1px 2px  rgb(16 24 32 / .05), 0 1px 3px   rgb(16 24 32 / .04)
--shadow-panel  0 1px 2px  rgb(16 24 32 / .05), 0 8px 24px  -6px rgb(16 24 32 / .10)
--shadow-float  0 2px 4px  rgb(16 24 32 / .06), 0 16px 40px -12px rgb(16 24 32 / .18)
```

## Interaction and accessibility

- Driver touch target **52dp** minimum. The console's is 44px.
- Focus is a 3px route-blue `:focus-visible` outline at 2px offset, applied
  globally — not per component. Componentising it means every new hand-rolled
  element re-acquires the bug, which is exactly how the inputs on four pages
  ended up without a focus ring while the shared `Field` had one.
- Inputs carry `--color-outline` / `borderStrong`, not the divider colour. A box
  you may type into must not look like a box you may only read.
- `prefers-reduced-motion` is honoured globally. The spinner slows to a pulse
  rather than freezing — `animation: none` mid-rotation reads as a hang.
- Status is never colour alone: pills carry text, map lines carry dash pattern.

## Explicitly not in this system

No neon glow, no decorative dashboard charts, no heavy glass blur, no particle
backgrounds, no animated counters, no AI mascot panels. The `backdrop-blur-md`
on the truck drawer was removed: it sits over a moving map, so every marker
passing under it swam behind the driver name and the fix timestamp.

Motion explains an interaction or it does not ship. Nothing competes with
navigation.

No blanket green safety labels. Unknown is not safe.
