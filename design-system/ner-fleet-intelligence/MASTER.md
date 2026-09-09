# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** NER Fleet Intelligence
**Generated:** 2026-09-05 21:20:56
**Category:** Logistics/Delivery
**Design Dials:** Variance 3/10 (Centered / Minimal) | Motion 3/10 (Subtle) | Density 8/10 (Dense / Dashboard)

---

---

## Project Overrides (authoritative — read before the generated tables above)

These are decisions the generator could not know. Where they conflict with the
generated tables, these win.

### Status colours are RESERVED — never brand, never decoration

The backend already assigns meaning to three hues, and the manager map and the
driver app both render them. A brand colour that reuses one makes every surface
look like it is reporting a condition.

| Hue | Reserved meaning | Token | Source of truth |
|-----|------------------|-------|-----------------|
| Green `#34D399` | `LIVE` freshness / gate passed / OK | `--status-live` | `telemetry_policy.py` |
| Amber `#FBBF24` | `STALE` freshness / warning / needs attention | `--status-stale` | `telemetry_policy.py` |
| Red `#F87171` | `NO_CONTACT` / hazard / refused | `--status-blocked` | `telemetry_policy.py` |
| Slate `#64748B` | `NO_LOCATION` — never plotted, only listed | `--status-none` | `FleetMap.tsx` |

Blue `#2563EB` is the brand primary precisely because it is the one hue with no
status meaning in this system. This is why the neon-green palette the generator
first returned was rejected.

**Colour is never the only carrier.** Every status shows an icon or a word as
well — the UX rule `Accessibility / Color Only`, and the reason a colour-blind
dispatcher can still read the fleet.

### Map colours

Map legibility in daylight is a stated G3 requirement, so these are chosen
against a light OSM raster basemap, not against the app chrome.

| Element | Colour | Treatment |
|---------|--------|-----------|
| Selected / authorised route | `#2563EB` | Solid, 6px, white 8px casing beneath |
| Alternative / backup route | `#EA580C` | Dashed, 4px, always with a text label |
| Travelled portion | `#1E40AF` | Solid, darker, drawn over the selected line |
| Origin marker | `#0F172A` | Filled circle |
| Destination marker | `#2563EB` | Pin |
| Live position | `#34D399` | Circle + accuracy halo — **only from a real fix** |
| Last-known position | `#FBBF24` | Hollow circle + age label — visually distinct from live |

The white casing under the route line is not decoration: a 6px blue line alone
disappears over water and over motorway fills on the OSM raster style.

### Surfaces: the driver is dark, the console follows the system

| Surface | Mode | Why |
|---------|------|-----|
| Driver app | Dark, fixed | Read one-handed in a cab, often at night or in rain. A white screen at 2am is a hazard, not a preference. |
| Manager / reviewer web | Light default, dark supported | Daytime office use, projected in a control room. |
| Map basemap | Always light raster | Daylight legibility (G3). A dark basemap under a blue route fails in sun. |

Driver dark surfaces keep the existing slate ramp (`#0F172A` bg, `#1E293B` card,
`#334155` border) — it already meets contrast and changing it churns every
screen for no gain.

### Touch targets

`48px` minimum on the driver app's primary controls (G3), and the existing
`TOUCH_TARGET = 52` in `driver-app/src/theme.ts` already exceeds it — keep it.
Gloved hands in a moving vehicle.

### Long translations and enlarged text

Every label must survive a string 2.5x its English length (German-scale, and
several Indic translations run longer) and a 200% text-size setting. No fixed
heights on anything containing translated text; no `whiteSpace: nowrap` on a
label. Test at 375px width.

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#2563EB` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#3B82F6` | `--color-secondary` |
| On Secondary | `#000000` | `--color-on-secondary` |
| Accent/CTA | `#EA580C` | `--color-accent` |
| On Accent/CTA | `#000000` | `--color-on-accent` |
| Background | `#EFF6FF` | `--color-background` |
| Foreground | `#1E40AF` | `--color-foreground` |
| Card | `#FFFFFF` | `--color-card` |
| Card Foreground | `#1E40AF` | `--color-card-foreground` |
| Muted | `#E9EFF8` | `--color-muted` |
| Muted Foreground | `#475569` | `--color-muted-foreground` |
| Border | `#BFDBFE` | `--color-border` |
| Destructive | `#DC2626` | `--color-destructive` |
| On Destructive | `#FFFFFF` | `--color-on-destructive` |
| Ring | `#2563EB` | `--color-ring` |

**Color Notes:** Tracking blue + delivery orange [Accent adjusted from #F97316]

### Typography

**SUPERSEDED the generated pairing.** The generator proposed Inter + Playfair
Display. Playfair is an editorial serif with Latin-only coverage; this product
is a dense operations console that must render 22 Indian scripts (G4). Both
facts rule it out, so the pairing below is the authoritative one.

| Role | Family | Why |
|------|--------|-----|
| UI / body | `Inter` | Neutral, dense-grid legible, huge weight range |
| Indic + Arabic scripts | `Noto Sans <Script>` | The only family with a member for every scheduled script |
| Identifiers & numbers | `JetBrains Mono` | Trip codes, plate numbers, coordinates, distances — fixed advance width stops digits jittering as they tick |

**Script loading rule.** Load the Noto member for the ACTIVE locale only, never
all 22 at once — the full set is several megabytes and this app is opened on a
phone on a hill road. `font-family` is a stack ending in the script font, so an
untranslated Latin string in a Devanagari UI still renders from Inter.

| Script | Family | Locales |
|--------|--------|---------|
| Devanagari | `Noto Sans Devanagari` | hi, mr, ne, sa, kok, mai, brx, doi, ks-Deva, sd-Deva |
| Bengali | `Noto Sans Bengali` | bn, as, mni-Beng |
| Gujarati | `Noto Sans Gujarati` | gu |
| Gurmukhi | `Noto Sans Gurmukhi` | pa |
| Tamil | `Noto Sans Tamil` | ta |
| Telugu | `Noto Sans Telugu` | te |
| Kannada | `Noto Sans Kannada` | kn |
| Malayalam | `Noto Sans Malayalam` | ml |
| Odia | `Noto Sans Oriya` | or |
| Arabic | `Noto Naskh Arabic` | ur, ks, sd — **RTL** |
| Meetei Mayek | `Noto Sans Meetei Mayek` | mni |
| Ol Chiki | `Noto Sans Ol Chiki` | sat |

Latin fallback stack: `Inter, 'Noto Sans <Script>', system-ui, sans-serif`.

### Spacing Variables

*Density: 8/10 — Dense / Dashboard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `2px` / `0.125rem` | Tight gaps |
| `--space-sm` | `4px` / `0.25rem` | Icon gaps, inline spacing |
| `--space-md` | `8px` / `0.5rem` | Standard padding |
| `--space-lg` | `12px` / `0.75rem` | Section padding |
| `--space-xl` | `16px` / `1rem` | Large gaps |
| `--space-2xl` | `24px` / `1.5rem` | Section margins |
| `--space-3xl` | `32px` / `2rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #EA580C;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #2563EB;
  border: 2px solid #2563EB;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #EFF6FF;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #2563EB;
  outline: none;
  box-shadow: 0 0 0 3px #2563EB20;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Minimalism & Swiss Style

**Keywords:** Clean, simple, spacious, functional, white space, high contrast, geometric, sans-serif, grid-based, essential

**Best For:** Enterprise apps, dashboards, documentation sites, SaaS platforms, professional tools

**Key Effects:** Subtle hover (200-250ms), smooth transitions, sharp shadows if any, clear type hierarchy, fast loading

### Page Pattern

**Pattern Name:** Real-Time / Operations Landing

- **Conversion Strategy:** Offer a demo or sandbox and show trust signals. Label telemetry as live only when backed by a current source, with update time and stale state. Provide pause/hide or update-frequency controls for tickers and previews, stop offscreen/hidden work, support keyboard controls, and render a static final snapshot under reduced motion.
- **CTA Placement:** Primary CTA in nav + After metrics
- **Section Order:** Hero (product + live preview or status) > Key metrics/indicators > How it works > CTA (Start trial / Contact)

---

## Motion

**Scroll Reveal** (Subtle) — Trigger: scroll (viewport enter) | Duration: 300-400ms | Easing: `power1.out`

```js
gsap.from(el, { opacity: 0, y: 12, duration: 0.35, ease: 'power1.out', scrollTrigger: { trigger: el, start: 'top 90%', toggleActions: 'play none none reverse' } });
```

**Framework notes:** Requires the ScrollTrigger plugin registered once via gsap.registerPlugin(ScrollTrigger); Use matchMedia('(prefers-reduced-motion: reduce)') to skip non-essential motion and render the final state immediately

- ✅ Keep the y offset small (8-16px) so it reads as a fade, not a slide
- ❌ Don't reveal below-the-fold content needed for SEO/crawlers as invisible-by-default without a no-JS fallback
- ⚡ toggleActions 'play none none reverse' avoids re-triggering on every scroll direction change

---

## Anti-Patterns (Do NOT Use)

- ❌ Static tracking
- ❌ No map integration
- ❌ AI purple/pink gradients

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
