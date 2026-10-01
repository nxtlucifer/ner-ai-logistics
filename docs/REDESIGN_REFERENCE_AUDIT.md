# RASTA AI: Redesign reference audit

**Date:** 27 September 2026
**Phase:** Audit only. No file under `manager-web/`, `driver-app/` or `backend/` was changed.
**Owner of this document:** Head of product design (redesign lane)
**Canonical visual target:** the seven reference images. They define the visual design, but none of their data is to be used.
**Supersedes:** the visual verdicts in `docs/REDESIGN_CERTIFICATION.md` (20 Sep). The brief rejects that build because it drifted from the references. This audit keeps that document's data-truth decisions (no `120+`, no SSO) and reverses its layout decisions.

---

## 0. Sources, evidence and method

| Input | Location | Status |
|---|---|---|
| Brief | `C:/Users/patel/Downloads/CLAUDE_REDESIGN_MASTER_PROMPT.md` | Read in full |
| Reference spec | `C:/Users/patel/Downloads/REFERENCE_SPEC.md` | Read in full |
| 7 reference images | `.runtime/sources/redesign/redesgin/manger1-3.jpeg`, `driver1-4.jpeg` | Each opened on its own at native size |
| Contact sheet | `C:/Users/patel/Downloads/REFERENCE_CONTACT_SHEET.png` | Read. It confirms the naming: `manger1` = `manager_01_region_selector`, `manger2` = `manager_02_login`, `manger3` = `manager_03_dashboard`, `driver1..4` = `driver_01_login`, `driver_02_navigate`, `driver_03_safety`, `driver_04_more` |
| Pack `manifest.json` | **Not found.** The only `manifest.json` in Downloads (`Downloads/c/`) is an unrelated database manifest from 7 Sep. | Not used |
| Current screenshots | `.runtime/redesign/current/manager-*.png` (16), `driver-*.png` (12), plus `manager-capture-notes.json` and `driver-capture-evidence.json` | See the list below |
| Function inventory | Inventory lane output passed to this audit | Read. It is truncated after Trucks/Assignments. §11 explains how the gap was filled. |
| Theme / asset architecture | Theme-architecture lane output; `.runtime/redesign/current/theme-arch-*.png`, `theme-arch-samples.txt` | Read |

**Screenshots I opened myself:**
- Manager:
  - region at 1600×900 and 1366×768
  - login at 1600×900
  - overview at 1600×900, plus the full page
  - fleet, trips and drivers at 1600×900
- Driver:
  - login (light)
  - navigate (light and dark)
  - safety (light and dark)
  - more (light and dark)
  - trip (light)
  - assistant (light)

I did not open the other PNGs: the 1366×768 variants of login, overview, fleet, trips and drivers, plus the manager "dark" files that the capture lane measured as byte-identical to light. Anything this document says about them comes from the capture notes.

**Measurement conventions:**
- **Coordinates** were read from each reference at native resolution, to about ±10 px.
  - Manager figures are CSS px at 1600 wide (DPR 1).
  - Driver figures are *device px* of the 900×1600 image. The capture viewport was 450×800 CSS at DPR 2, so **CSS px = device px ÷ 2**.
  - Percentages are of the image width (W) or height (H). Use these, not raw px, at other sizes.
- **Colours** are 5×5-pixel averages sampled from the JPEGs (`scratchpad/redesign-audit/sample.py`). JPEG noise is about ±4 per channel. Surfaces that sit over a photograph in the mockup (the driver login card and fields) are translucent, so their samples are approximate.
- **"Current" facts** come from the screenshots above and the capture lanes' DOM measurements. I state nothing about a screen I did not see or a number nobody measured.

---

## 1. Summary

### 1.1 Largest gaps, ranked

1. **No photographs anywhere.** This applies to both apps, both themes and every screen, yet every reference is built around one. The repo contains no scenic photographs, which is a **BLOCKER** (§10).
2. **Dark theme fails the brief in both apps.**
   - Manager has no dark theme: the OS setting is ignored and the dark PNGs are byte-identical to light.
   - Driver "Dark" is forest green: bg `#06201B`, and 92–95% of screen pixels are green-tinted.
   - The driver login is pinned to Light.
3. **Manager Overview is the wrong shape.** It is a 10-tile KPI panel nested inside a card, then two tables, 1,257 px tall. The reference fits one 900 px viewport: 4 KPI cards, a map with an activity rail, and 3 lower cards.
4. **Manager login split and art.** The split is 52.5/47.5 instead of 60.7/39.3, and the left side is a flat gradient where the reference has a photo.
5. **Region selector.**
   - The map is a flat equal-tone schematic with no selected state.
   - Scope is chosen with radio tiles where the reference uses dropdowns.
   - The stats sit in a white footer strip instead of over the photo.
6. **Driver chrome.** Every driver screen uses a generic greeting header and a flat full-width tab bar. The references use a scenic hero with a large screen title, and a floating rounded forest bar.
7. **Driver card sets are missing.**
   - Safety lacks the emergency card with icon discs, the help CTA and the tools grid.
   - Navigate lacks the quick actions and the route-information tiles.
8. **Theme persistence and control.** The driver does not persist the theme choice. The manager has no theme control at all.

### 1.2 Already right; keep it

- **Manager chrome:** the sidebar width (216 vs about 215) and the forest tone. Card radius of 12 px.
- **Data truth:** no invented data anywhere (no trends, no `120+`, no ETA, no "safe"). No SSO and no forgot-password link.
- **Driver More:** the row set.
- **Theme wording:** the driver already says Light/Dark.
- **Honest states:** the directory shows "Official list pending", and GPS shows staleness.

### 1.3 Baseline before any redesign work (auditor's judgement)

| Screen | Structure | Spacing | Typography | Colour light | Colour dark | Image | Status |
|---|---|---|---|---|---|---|---|
| manager_01 region | PARTIAL | PARTIAL | PARTIAL | PARTIAL | FAIL (none) | FAIL | **FAIL** |
| manager_02 login | PARTIAL | FAIL (split) | PARTIAL | PARTIAL | FAIL (none) | FAIL | **FAIL** |
| manager_03 dashboard | FAIL | FAIL | PARTIAL | PARTIAL | FAIL (none) | FAIL | **FAIL** |
| driver_01 login | FAIL | FAIL | PARTIAL | PARTIAL | FAIL (pinned light) | FAIL | **FAIL** |
| driver_02 navigate | FAIL | FAIL | PARTIAL | PARTIAL | FAIL (green) | FAIL | **FAIL** |
| driver_03 safety | FAIL | FAIL | PARTIAL | PARTIAL | FAIL (green) | FAIL | **FAIL** |
| driver_04 more | PARTIAL | PARTIAL | PARTIAL | PARTIAL | FAIL (green) | FAIL | **FAIL** |

---

## 2. manager_01_region_selector (`manger1.jpeg`, 1600×901)

**Screen:** manager sign-in step 1, the operational region. Code: `LoginPage.tsx` `ScopeScreen`, `NorthEastMap.tsx`, `TerrainScene.tsx`.

### Layout regions

| Region | Box (x, y → x, y) | % of W / H | Notes |
|---|---|---|---|
| Brand header band | 0,0 → 1600,110 | H 0–12% | Logo at x75–217. Tagline text at x297–731 (y63). "North East India" block at x1200–1450. Crosshair at x1520–1565, with a divider at x1485. |
| Left column | x75 → 661 | W 4.7–41.3% | Eyebrow y157, H1 y185–222, lede y235–285 |
| Selector card | 75,312 → 661,615 | W 36.6%, H 33.6% | Sits over the upper mist of the photo |
| Quote + gold rule | rule y611 (x355–385), quote y644 | centred under the card | "FROM THE HILLS TO NEW HORIZONS" |
| NER map (hero) | 745,85 → 1300,625 | W 34.7% (46.6–81.3%), H 60% | Centre about x1022 (64% W). The map *is* the middle column. |
| Capability card | 1292,271 → 1536,457 | W 15.3%, H 20.6% | Abuts the map's east edge |
| Photograph | full width, y≈480 (right) / ≈600 (left) → 901 | bottom 35–45% | Misty valley, river, town, winding highway; a white truck at x1200–1290, y715–770; sun at the right |
| Stats over photo | 75,735 → 540,815 | W 4.7–33.8%, H 81.6–90.5% | 4 items at about 130 px pitch; dividers at x152, 280 and 413; "A MORE CONNECTED INDIA" at y849 |
| Script tagline | 1415,675 → 1570,820 | lower-right | "Mountains Move Markets", white, rotated about −30°, gold underline |

### Background and photo

- The top 55% is a flat warm cream, `#F3F4EE`.
- The photograph rises from the bottom and blends into the cream through mist, with no hard edge.
- The lower-left foreground is dark conifer forest, so the white stats read without a scrim.
- The selector card and map float above the photo's upper edge.

### Typography

| Element | Size | Weight | Case / tracking | Colour |
|---|---|---|---|---|
| Wordmark "RASTA AI" | ≈30 px | 700 | 0.04em | ink |
| "MANAGER CONSOLE" | ≈11 px | 500 | uppercase, 0.2em | ink |
| Header tagline | 15 px | 400 | Title Case with pipe separators | ink ~80% |
| Eyebrow "STEP 1 OF 3" | 13 px | 500 | uppercase, ≈0.35em | muted |
| H1 | ≈36 px | 700 | **Title Case, one line** | ink `#0F1A17` |
| Lede | 18 px | 400 | 2 lines, ≈27 px leading | muted `#5B6660` |
| Field label / value | 16 / 16 px | 600 / 500 | — | ink |
| CTA | 19 px | 500 | "Continue →" | white |
| Map state labels | 17 px | 600 | — | ink; white on the selected state |
| Capability rows | 14 px | 400 (row 1: 600) | — | ink |
| Stats | value 20 px / 600, label 13 px / 400 | — | — | white |
| Letter-spaced taglines | 11–13 px | 500 | uppercase, ≈0.4em | muted / white |

### Cards, radii, buttons

- **Selector card:** `#FAFAF8`, radius ≈12, very soft shadow, 28 px inner padding.
- **Two dropdowns:** 530×52, radius ≈8, 1 px light border, a 20 px leading icon (pin, then government building) and a trailing chevron.
- **Continue:** 530×53, radius ≈8, fill `#163A2D`, white text with an arrow.
- **Capability card:** white, radius ≈12. Four rows at 41 px pitch with bare 20 px outline icons, and no numbers.
- **Map tooltip:** white, radius ≈6, with a small pointer.

### Spacing rhythm

- Label to field is 8–10 px, field to the next label 30 px, last field to CTA 22 px.
- The logo, eyebrow, H1, card and stats all share one left edge at x75 (4.7% W).

### Icons

Outline, about 1.5 px stroke, 20–24 px, in ink. The stats icons are white outline at about 30 px. There is a compass-in-circle beside "North East India" and a crosshair at the far right.

### Navigation

None. The header tagline looks like navigation but is plain text.

### Colours (approx.)

| Role | Hex |
|---|---|
| Page | `#F3F4EE` |
| Card | `#FAFAF8` |
| Field | `#FDFDFD` |
| CTA | `#163A2D` |
| Selected state | `#397961` |
| Other states | `#DBE5DC` (relief-textured) |
| Pin | red, ≈`#D32F2F` |
| Ink | `#0F1A17` |
| Muted | `#5B6660` |
| Gold rules | ≈`#C9A95F` |

### Mockup data that must not be copied

- "STEP 1 OF 3" (sign-in has two steps).
- "120+ Districts".
- "Better Connectivity" and "Safer Communities" presented as stats.
- The Kamrup (Guwahati) pin and tooltip. No district geometry exists.
- "Eight States. Infinite Possibilities." Keep the current honest line.
- The pre-filled Assam / Kamrup values.

### Real data that replaces it

- **Step:** "Step 1 of 2".
- **States:** 8 = `regions.length` from `GET /api/org/regions`. It shows "—" until loaded and on error.
- **Districts:** verified-district count plus "N states pending", from the same payload (today "4 · 6 states pending").
- **Capability items:** "Terrain-aware" and "Audited" (current, honest).
- **Map highlight:** the state from the user's own selection.
- **District:** shown as **text**, e.g. a callout attached to the state label reading "Assam · Kamrup". There is no pin.
- **Map caption:** keep "Schematic. Shapes are indicative, not survey boundaries."

### Reference controls with no real function

| Reference control | Truth | Do instead |
|---|---|---|
| Crosshair icon, top right | Nothing behind it | Decorative `aria-hidden`, not a button, or omit |
| District pin | No district geometry | Text callout, no pin |
| State / District as the *only* choices | The real control has 4 scopes (North-East, A state, A district, My own console) that the server checks at login | Keep all 4. See the design below. |
| Header tagline as nav | Not links | Plain text with separators; never link-styled |
| Clicking the map | `NorthEastMap` is not interactive | No pointer cursor. Making it clickable is new work (§15). |

**Scope design that keeps the reference silhouette:**
1. A compact 4-option segmented control ("Scope") at the top of the card.
2. The reference's two icon dropdowns for State and District below it. They are shown or disabled by scope, exactly as the current logic does.
3. Continue at the bottom.

When State or District is chosen, the card looks like the reference. Keep the loading gap (see §11) visible: the State select needs a "Loading states…" placeholder and an error line. Today a failure looks the same as loading.

### What the current implementation gets wrong

1. **No photograph.**
   - The bottom 256 px are vector sage waves.
   - The stats sit on a white strip at the page bottom (y≈818–900), not as white text over a dark photo foreground.
   - The logo is the shield app icon; the reference uses a mountain line-art wordmark.
2. **Map.**
   - Flat equal pale-sage polygons, 615×492 at x586, with crude shapes (Assam is a thin band).
   - No relief texture, and no selected-state fill; nothing is highlighted while "My own console" is chosen.
   - No callout.
   - The reference map is 555×540 at x745.
3. **Selector card.**
   - 438 px wide (x90–529) vs 586.
   - A 2×2 grid of radio tiles instead of two full-width icon dropdowns.
   - Continue is about 398×48 vs 530×53.
   - On a fresh profile, "My own console" is pre-selected.
4. **Heading.**
   - 44 px Sora over two lines, sentence case, where the reference is about 36 px on one line in title case.
   - The left margin is 90 px vs 75.
5. **Capability card.**
   - Close in size and position: x1234–1508 / y278–482 vs x1292–1536 / y271–457.
   - It adds row numbers 1–4 and 32 px sage icon discs; the reference has no numbers and bare icons. Minor.
6. **Header right side.** A leaf icon instead of the compass, and the crosshair is missing (decorative only).
7. **1366×768.** scrollHeight is 818, so the stats strip is cut at the fold. The reference composition fits one viewport.
8. **Dark.** None. The PNG is byte-identical to light under `prefers-color-scheme: dark`.

---

## 3. manager_02_login (`manger2.jpeg`, 1600×901)

**Screen:** manager sign-in step 2, credentials. Code: `LoginPage.tsx` (`LoginPage`, `BrandPanel`), `AuthProvider.tsx`.

### Layout regions

| Region | Box | % | Notes |
|---|---|---|---|
| Left photo panel | 0,0 → 971,901 | **W 60.7%**, full H | Photo with a dark forest overlay |
| · Logo | 52,35 → 220,135 | — | Gold mountain line-art above a white wordmark; "MANAGER CONSOLE" |
| · Top-right of the panel | right edge x924, y47–69; gold rule x872–924 at y96 | — | "North East India / Eight States. Infinite Possibilities." |
| · Gold rule + H1 | rule x58–104 at y188; H1 y215–310 | H 24–34% | 2 lines |
| · Lede | y330–378 | — | 2 lines |
| · Feature rows | y407–686, 4 rows at 72 px pitch | H 45–76% | 62 px discs at x58–121 |
| · Script + gold rule | y735–830; rule at y862 | — | "People Places Possibilities" |
| · Text column | x58 → 460 | 47% of the panel | The photo focal point (bridge and truck) sits in the panel's right half, x450–970, y540–900 |
| Right form panel | 971,0 → 1600,901 | **W 39.3%** | Cream |
| · Top-right link | right-aligned at x1552, y47–69 | — | "New here? / Contact Administrator" |
| · Form column | x1049 → 1552 (503 px) | 80% of the panel; inset 78 left, 48 right | Left-aligned |
| · H1 / lede | y160–198 / y214–262 | — | — |
| · Fields | label y308, input y328–377; label y412, input y432–482 | — | 503×50 each |
| · Remember row | y516 | — | Checkbox left; "Forgot password?" right |
| · CTA | y551–607 | 503×56 | — |
| · "or" + SSO | divider y631; SSO y653–702 | 503×50 | — |
| · Illustration | y700 → 901 | bottom 22% | Illustrated pines up to about 190 px tall at x975–1100 and x1540–1600, with misty ridges; the quote is centred at y772–795 and the gold rule at y821 |

### Background and photo

- **Left panel:** a full-height photograph (misty valley, river, arched highway bridge with a truck, sunrise) under a forest overlay. The overlay is near-opaque over the text column (`#01201A` at x30) and fades to transparent by about x500.
- **Right panel:** flat cream, `#F4F7F0`.

### Typography

| Element | Size / weight |
|---|---|
| Left H1 | ≈46 px / 700, white; "North East." in gold ≈`#E8C77A` |
| Lede | 20 px / 400, white ~85% |
| Feature title / subtitle | 16 px / 600 white / 14 px / 400 white ~70% |
| Wordmark | ≈34 px / 700, letter-spaced |
| Right H1 "Welcome Back" | ≈40 px / 700, ink |
| Right lede | 19 px / 400, muted |
| Labels | 16 px / 600 |
| Input text | 15 px |
| CTA | 20 px / 500 |

### Cards, radii, buttons

- The form has **no card**. Fields are white 503×50, radius ≈8, 1 px `#E0E4DE` border, a 20 px leading icon at a 30 px inset; the password field has an eye.
- **CTA:** 503×56, radius ≈8, `#13392D`, white text with an arrow.
- **SSO:** outlined, 503×50, radius 8.
- **Feature discs:** 62 px **filled** circles, `#0C4731`, holding white 24 px icons.
- **Checkbox:** 22 px, radius 4.

### Spacing rhythm

Label to input is 10 px, input to the next label 30 px, CTA to divider 24 px. Feature rows sit at 72 px pitch.

### Icons

Outline, 20 px on the form; white 24 px inside the discs.

### Navigation

None; there is only a top-right text link.

### Colours (approx.)

| Role | Hex |
|---|---|
| Overlay | `#01201A` → transparent |
| Disc | `#0C4731` |
| Gold text | `#E8C77A` |
| Gold rules | ≈`#C9A95F` |
| Right bg | `#F4F7F0` |
| Field | `#FCFCFC` |
| CTA | `#13392D` |
| Link green | ≈`#1B6E52` |

### Mockup data that must not be copied

- "Remember me". The real control remembers the *region* only.
- "Forgot password?".
- The "or" divider and "Continue with SSO".
- "Contact Administrator" as a link.
- "Email or Username". The real field is email or phone.
- "Eight States. Infinite Possibilities."

### Real data and state that replace it

- **Field label:** "Email or phone" (`autocomplete=username`).
- **Checkbox:** "Remember this region on this device" (localStorage `rasta:workspace`).
- **Top-right text:** "New here? Ask your administrator for an account", as **text**.
- **Scope chip:** "Opening {scope} · Change" is real (it returns to step 1). Place it as a slim chip between the lede and the first label.
- **The SSO block's slot** holds the real line "Driver accounts are created from the Drivers page, not here."
- **"SIH26002 · MDoNER"** is a real attribution; keep it small at the bottom-left, or see §15.

### Reference controls with no real function

| Control | Do instead |
|---|---|
| Forgot password? | Do not render. No reset flow exists. |
| or + Continue with SSO | Do not render. No provider exists. |
| Contact Administrator (link) | Plain text. There is no contact endpoint or mailto. |
| "Remember me" | Keep the honest label, "Remember this region on this device". |

### What the current implementation gets wrong

1. **Split and left panel.**
   - The split is 840/760 (52.5/47.5%) instead of 971/629 (60.7/39.3%).
   - The left panel is a flat dark-green gradient with vector hills and a dashed road. There is no photograph and no truck focal point.
2. **Feature badges.** 42 px *outlined* circles, not about 62 px *filled* ones.
3. **Script tagline.** "People Places Possibilities" is bold italic sans, not script.
4. **Wordmark subtitle.** Reads "NER LOGISTICS"; the reference says "MANAGER CONSOLE".
5. **Form.**
   - The form column is 400 px wide and centred at x1020; the reference is 503 px and left-aligned at x1049.
   - "Welcome back" is 32 px vs about 40.
   - Inputs are 46 px tall with an 8 px radius vs 50.
6. **Log in button.** Renders **pale disabled sage** while the fields are empty; the reference shows a solid forest button about 56 px tall. The disabled rule is real and must stay; see §15 for the visual treatment.
7. **"New here?" position.** Sits at y127; the reference has it at about y47, on the logo's baseline.
8. **Illustration.** The tree and mountain silhouette at the bottom right is faint and about 160 px tall, against tall illustrated pines.
9. **Dark.** None (byte-identical PNG).
10. **1366×768.** Fits with no scroll; the split holds at 52.5% (717/649).

---

## 4. manager_03_dashboard (`manger3.jpeg`, 1600×900)

**Screen:** Overview. It also sets the visual system for every signed-in manager page. Code: `App.tsx` (shell), `OverviewPage.tsx`.

### Layout regions

| Region | Box | % | Notes |
|---|---|---|---|
| Sidebar | 0,0 → 215,900 | **W 13.4%** | `#062621` |
| · Logo | centred, y18–90 | — | Gold mountains above a white wordmark; "MANAGER CONSOLE" |
| · Group 1 | y113–360 | — | Dashboard (active pill 5,113 → 202,155, 42 px tall), Fleet, Drivers, Trucks, Trips, Assignments; about 40 px pitch |
| · Divider, Group 2 | divider y375 | — | Route Intelligence, Alerts (badge "5"), Reports, Diagnostics |
| · Divider, Settings | divider y560; Settings y591 | — | — |
| · Region card | 14,630 → 202,735 | 188×105 | Pin disc, "Assam - Kamrup / Operational Region", divider, "Change Region →" |
| · Pines + tagline | y740 → 900 | — | "Smarter Routes / Stronger North East" |
| Header (no bar) | 215,0 → 1600,105 | H 11.7% | Sits on the canvas; mountain line drawing at x1150–1400, y55–105 |
| · Greeting | x274, y50; meta line y79 | — | "Welcome, Manager 👋", then "● Assam • Kamrup \| Last synced 2 min ago" |
| · Search | 965,15 → 1343,53 | 378×38 | — |
| · Bell, avatar | bell x1392 (red dot); avatar 40 px at x1440 plus "Manager ▾" | — | "North East India …" right-aligned at y75–91 |
| KPI row | y122 → 235 | H 12.6% | 4 cards about 325×113, gutter about 13 |
| Middle row | y250 → 635 | H 42.8% | **Map card** x235–1158 (923 px = 68.6% of content). **Activities** x1170–1580 (410 = 30.5%). |
| Lower row | y648 → 870 | H 24.7% | Districts 463, Weather 496, Scenic 358 (34 / 37 / 27% of content) |
| Content frame | x235 → 1580 | 1,345 px | 20 px margins. **The whole page fits in 900 px with no scroll.** |

### Background and photo

- **Canvas:** `#E9EFE8`–`#EEF2ED`. **Cards:** `#FBFCFA`.
- **Photography:** only the lower-right scenic card (highway and truck, text right-aligned with a gold rule).
- **Vector art:** the sidebar pines and the header mountain line drawing.

### Typography

| Element | Size / weight |
|---|---|
| Greeting | ≈24 px / 700 |
| Meta line | 14 px, muted |
| Card title | 20 px / 700 (map), 16 px / 700 (lower cards) |
| KPI label / value | 14 px / 600 / ≈28 px / 700 |
| KPI trend | 13 px |
| Nav | 15 px / 400 at white ~85%; active 600 white |
| Activity title / subtitle / time | 14 px / 600 / 13 px muted / 13 px muted, right-aligned |

### Cards, radii, buttons

- **Cards:** radius ≈12, one soft shadow, 16–20 px padding.
- **KPI icon tiles:** 64×64, radius ≈10, tinted:
  - sage `#DDEEE4`
  - sage
  - peach `#FBE7D3`
  - pink `#F9DCDB`
- **Activity icon tiles:** 36×36, radius 8, tinted.
- **Outlined buttons** ("View Full Map →", "View All →"): about 132×36, radius ≈6, 1 px border.
- **Map:** inset radius ≈8. The legend is a white card, radius 8, inside the map.
- **Bars:** 12 px tall, pill ends, fill `#084C39` on track `#EEF3F6`.
- **Sidebar active item:** a *filled pill*, `#18453B`. The region card is `#103732`, radius ≈10.

### Spacing rhythm

13–15 px gutters everywhere, activity rows at 62 px pitch, and nav items at about 40 px pitch.

### Icons

- Sidebar: outline, 20 px, white.
- KPI tiles: 28 px, coloured forest / brown-orange / red.
- Activity tiles: 20 px.

### Navigation

- Sidebar groups separated by dividers, with a filled active pill and a count badge.
- A region card at the bottom.
- No top nav; the topbar holds search, bell, avatar and menu.

### Colours (approx.)

| Role | Hex |
|---|---|
| Sidebar | `#062621` |
| Active pill | `#18453B` |
| Canvas | `#E9EFE8` |
| Card | `#FBFCFA` |
| Tints | `#DDEEE4` / `#FBE7D3` / `#F9DCDB` |
| Bar | `#084C39` |
| Danger | ≈`#D32F2F` |
| Route line | blue, ≈`#2F6FE0` |

### Mockup data that must not be copied

- Total Fleet 128, Active Trips 42, Deliveries 1,248, Active Alerts 5.
- +12 / +8 / +18 / +67% trends, and the sparklines.
- The truck tooltip: "AS-01-7890, 62 km/h, ETA 2h 14m, Route Status: Safe".
- The legend: Moving / Idle / Delayed / Alert.
- All five activity rows, including a named person and a licence id.
- District counts 320 / 210 / 180 / 140.
- The whole Weather & Road Alerts card.
- "Last synced 2 min ago", "Assam • Kamrup", "Alerts 5", and the bell's red dot.

### Real data and state that replace it

- **Greeting:** "Welcome, {`display_name`}" + `scopeLabel` + a real "Last synced {age}" from `connectivity.ts` (there is no extra call).
- **KPIs:** 4 cards from `GET /api/dashboard` (15 s poll, cache `dashboard`). All 10 current figures survive:

  | Card | Main figure | Caption (separate link) | Opens |
  |---|---|---|---|
  | Trips under way | `trips_under_way` | "N crossing a state border" (`cross_state_trips`) | /trips |
  | Needing attention | `trips_needing_attention` | "N awaiting a route" (`trips_awaiting_route`) | /trips |
  | Drivers online | `drivers_online` of `drivers_in_scope` | "N with stale GPS" (`drivers_with_stale_gps`) | /drivers |
  | Urgent alerts | `urgent_notifications` | "N unread" (`unread_notifications`) | /notifications |

  - Rules: a figure that is `null` stays hidden (the current rule). Where the Alerts card is null, because the role has no `notification:read`, show **Trucks in transit** (`trucks_in_transit`, → /fleet) in its place. Danger/warning colour appears only when the value is > 0. **No trends and no sparklines**, because no history exists.
- **Map card:** the lazy `FleetMap` (`GET /api/fleet/active`).
  - The header reads "{`trucks_in_transit`} trucks in transit".
  - The legend is real freshness (Live / Stale / No contact / No location), plus Planned route and Observed track.
  - The tooltip shows registration, driver, trip code and GPS age. There is **no ETA and no "safe"**.
  - "View full map →" goes to /fleet; it replaces "Live operations".
- **Activity rail:** `GET /api/notifications?limit=5` for roles with `notification:read`, with "View all →" going to /notifications.
  - For MANAGER / ADMIN, who lack that permission, show "Who is on" from `GET /api/presence`.
  - That list must get a real error state; today a failure renders as "No drivers in scope are reporting" (§11).
- **Lower row:**
  - (a) "Districts by movement": bars from `districts[]` incoming/outgoing. For regional roles, show the compact States table from `states[]` ("Official list pending" stays). "View detailed report →" goes to /reports.
  - (b) Real replacement for Weather & Road Alerts: "Awaiting a decision", up to 4 open trips from the existing trips list with its attention filter, linking to /trips. Alternatively omit it (§15).
  - (c) The scenic card, decorative only, with a licensed photo.

### Reference controls with no real function

| Control | Truth | Do instead |
|---|---|---|
| Global search | No cross-entity search endpoint; deliberately absent | Do not render it. Search stays on Fleet, Trips, Drivers and Trucks. |
| "Route Intelligence" nav item | No such page | Do not add. Route evidence lives in Trips → Trip review and Fleet → Route. |
| "Alerts (5)" item and count | The destination is /notifications; the count needs a real source | "Notifications" item with a badge **only** from real data (§15). No badge until known, and an error must never read as 0. |
| "Settings" | No settings page | The theme toggle lives in the profile menu |
| "Change Region →" | Scope belongs to the account | Region card shows the scope label only. Sign out is the way to change. |
| Profile chevron menu | No menu today | Build it with real items only: Theme (Light/Dark) and Sign out |
| "View All Alerts", the weather card | No region-level weather or road data | Omit, or use the real card above |
| Carousel / emoji | — | Keep the emoji out; decorative only |

**Real items the reference lacks, which must be kept:**
- The SOS badge (`GET /api/emergencies/active`, "Checking SOS…" and "SOS status unknown" states).
- The offline `SyncBanner`.
- The skip link.
- The permission-filtered nav: States & districts, Managers, Review, Notifications, and Assignments (add it with `assignment:read`).
- The "New trip" action, which must be gated by `trip:create` (see §11).
- The Dev pill (dev builds only).

### System rules every other manager page inherits

- **Page header:** a 24 px bold title plus a 14 px muted meta line on the left; actions on the right as 36 px outlined buttons, with one primary.
- **Cards:** radius 12, padding 16–20, gutters 13–15. **Never a card inside a card.**
- **KPI cards:** use the same `KpiCard` (64 px icon tile, label, value, caption link). Today's Fleet KPI cards use a different, icon-less eyebrow style that must go.
- **Tables:** sit inside a card, with 44–48 px rows, 13 px uppercase muted headers, and a right-aligned row action as an outlined button.
- **Empty and loading states:** a centred icon disc, a 16 px title and a 14 px muted line (the Trips and Fleet empty states already follow this).
- **Maps:** a card with an inset radius of 8, legend card top-right, controls top-left. Nothing may overlap the lower third of the map. Today the POI chip bar does, so move it into the card header.

### What the current implementation gets wrong

1. **No map, rail or lower cards.** The Overview has no map, no activity rail and no lower analytical or scenic cards. The map-plus-rail pattern exists only on Fleet (778×598 map and a 520 px Details rail).
2. **Nested KPIs.** 10 KPI tiles of 311×103 with 44 px icon squares are nested inside a "Right now" card, so cards sit inside a card. The reference has 4 standalone cards of about 325×113 with 64 px tiles.
3. **Page height.** 1,257 px at 1600×900 and 1,274 at 1366×768, against a reference that fits 900 px.
4. **Sidebar.**
   - No group dividers, no filled active pill (it uses a green left bar with bold text), no badge, and no pines or tagline.
   - The region card has no divider or link. Correct: the link has no function.
   - A "DEV" pill.
5. **Topbar.**
   - An explicit "Sign out" button; the reference keeps it behind the profile chevron.
   - No greeting.
   - The user block shows "Regional Head / Regional head", so the name and role read the same.
6. **Header meta.** "Overview" is a 28 px Sora title with "New trip" and "Live operations" buttons; the reference has a greeting and meta line.
7. **Label ambiguity (not a bug).** The Overview's "Drivers online 1" is a heartbeat within 90 s. Fleet's "Active drivers 0 · none transmitting" counts LIVE or STALE positions. They sit on neighbouring pages with similar labels. In the redesign, label both by their definition.
8. **Fleet map.**
   - The basemap shows Chinese, Tibetan, Burmese and Bengali place labels at the edges. That is the OSM raster's local-script names.
   - The POI chip bar overlaps the lower map, and the legend falls below the fold at both sizes.
9. **Trips.**
   - A 551 px planner card next to a 745 px review card that holds only an empty state, leaving a large blank area.
   - The list starts below the fold (y860).
   - "Create draft trip" is pale disabled sage.
10. **Drivers.** A single 1320×264 table card fills only about half the viewport. That is fine, but it must not be padded with invented content.
11. **Dark.** None (byte-identical). The only dark surface is the green sidebar gradient `#0B3A30` → `#041A16`, which the brief forbids as a dark-theme look.

---

## 5. driver_01_login (`driver1.jpeg`, 900×1600 device px ≈ 450×800 CSS)

**Screen:** driver sign-in. Code: `driver-app/src/screens/LoginScreen.tsx`, and `App.tsx` (`<ThemeProvider fixed="day">` around line 344).

### Layout regions (device px)

| Region | Box | % of W / H |
|---|---|---|
| Full-bleed photo | 0,0 → 900,1600 | 100% / 100% |
| Language pill | 602,28 → 863,99 (261×71, pill) | W 67–96%, H 1.8–6.2% |
| App icon | 375,140 → 525,288 (150 px, radius ≈28) | W 16.7%, H 8.8–18% |
| Wordmark + subline | y310–358 / y372–390 | stack ends at H 24.4% |
| Login card | 115,450 → 785,983 (670×533) | **W 74.4%**, H 28.1–61.4% (33.3%) |
| · Mobile field | 160,540 → 740,626 (580×86, radius ≈22) | — |
| · Password field | 160,693 → 740,779 | — |
| · Forgot link | right edge at y811 | — |
| · Sign In | 163,846 → 740,938 (577×92, radius ≈24) | H 5.75% |
| Trust row | y1440–1540; columns centred at x233, 450, 665; dividers at x337 and 563 | H 90–96% |
| Photo focal point | truck x240–470, y1120–1360; milestone x765–875, y1215–1395 | lower 30% |

### Background and photo

- A bright morning photograph (sun top-left, branch overhang, snow peaks, river, road, truck from behind, a "NORTH EAST INDIA" milestone).
- There is **no global scrim**; legibility comes from the card.
- **The card:** frosted, translucent sage-cream (about 80–85% opacity with backdrop blur). It carries a faint mountain line drawing at the top-right, a leaf at the lower-left and a soft sage wave along its bottom edge.

### Typography (device px; CSS = ÷2)

| Element | Size / weight / colour |
|---|---|
| Wordmark | ≈56 / 700; navy `#16213A` for "RASTA", green for "AI" |
| Subline "NER LOGISTICS" | ≈20 / 600, 0.3em tracking, green |
| Labels | 20 / 600, uppercase, 0.08em |
| Field text | 26 |
| CTA | 30 / 500 |
| Trust labels | 19, white, 2 lines |

### Cards, radii, buttons

- **Card:** radius ≈40 (20 CSS).
- **Fields:** translucent grey-sage wells, radius ≈22 (11 CSS).
  - The mobile field has a phone icon, a white "+91 ▾" pill (radius ≈12), a divider, then the number.
  - The password field has a lock and an eye.
- **CTA:** 577×92 (46 CSS tall), radius ≈24, fill `#29584E` with a subtle gradient and mountain decoration inside, white text with an arrow.

### Spacing rhythm

- 45 px card padding.
- Label to field 32, field to the next label 40.
- Forgot link to CTA 35.

### Icons

Filled phone and lock, outline eye and globe. The trust icons are about 50 px (a mint shield-check, a white truck, mint people).

### Navigation

None, only the language pill.

### Colours (approx.)

| Role | Hex |
|---|---|
| Card | ≈`#E6ECE8` at ~85% alpha |
| Wells | ≈`#C5D0CE` (translucent) |
| CTA | `#29584E` |
| Wordmark navy | `#16213A` |
| Green | ≈`#2F7A5A` |
| Trust mint | ≈`#8FD9B6` |

### Mockup data that must not be copied

- The filled-in 10-digit mobile number (deliberately not reproduced here). The brief forbids any real or demo number, even as a placeholder.
- "Forgot password?".
- The "+91 ▾" country dropdown.

### Real data and state that replace it

- **Mobile field:** placeholder "10-digit mobile number" (current, correct), with a fixed "+91" prefix pill and **no chevron**.
- **Password:** field with an eye icon (replaces the "SHOW" text), `accessibilityLabel` "Show password" / "Hide password" (already exists).
- **Language pill:** opens the real `LanguageSheet` (with its search).
- **Help text:** the real line "Need access? Contact your fleet manager — driver accounts and passwords are managed by dispatch." It goes under the CTA, where the Forgot link would be.
- **Trust row:** decorative value statements with no metrics. Whether to keep them is in §15.

### Reference controls with no real function

| Control | Do instead |
|---|---|
| Forgot password? | Omit, and show the help text instead |
| "+91 ▾" dropdown | A fixed prefix pill, not pressable |
| Trust icons | Decorative, not buttons (`accessible={false}`, or grouped as one text) |

### What the current implementation gets wrong

1. **No photograph.** Flat sage `#EEF3ED`, with flat grey vector triangles across the top 30%.
2. **Logo and heading.**
   - The logo is a small horizontal lockup at the left (shield plus "RASTA AI / NER LOGISTICS"), not the large centred stack.
   - An extra "DRIVER / Welcome back / Safer logistics…" heading block is added.
3. **Card.**
   - Opaque white, 90% wide (x45–855), with no translucency or decoration; the reference is 74%.
   - Fields are 86–114 px tall and the mobile field has no phone icon.
   - The password toggle is the text "SHOW".
4. **Sign In.** Pale grey disabled (y948–1060) until both fields are filled; the reference shows a forest CTA with an arrow.
5. **Trust row and empty space.** Replaced by "Secure driver access", the help text and "Safe Routes. Stronger India.", leaving about 20% of the screen empty at the bottom.
6. **Language pill.** "English ▾" with no globe icon, in a rectangle with rounded corners rather than a pill.
7. **Dark.** The login cannot be dark: it is pinned with `fixed="day"`, and `driver-login-dark.png` is identical to light.

---

## 6. driver_02_navigate (`driver2.jpeg`, 900×1600)

**Screen:** Navigate tab. Code: `MapScreen.tsx`, `map/DriverRouteMap.web.tsx` and `DriverRouteMap.native.tsx`, `map/scene.ts`.

### Layout regions (device px)

| Region | Box | % H | Notes |
|---|---|---|---|
| Hero photo | 0,0 → 900,240 | 0–15% | Mountains and a leaf overhang. Title "Navigate" at x58 (≈56 / 700, ink); subtitle ≈24 muted. "Night" chip at 728,37 → 866,96. Script at the top-right. |
| Search bar | 35,240 → 866,315 (831×75, pill) | 4.7% | Frosted; search icon; mic at the right |
| Map card | 35,333 → 866,772 (831×439, radius ≈28) | 27.4% | Dark satellite/terrain imagery, glowing green route, pins. FABs are 66 px white circles at x768–834 (layers y398, locate y478, navigate y558). Route summary overlay at 60,626 → 395,755 (dark translucent, radius ≈20). |
| Start Navigation | 35,786 → 866,862 (76 tall, pill) | 4.75% | `#013A31`, a navigation-arrow icon and an arrow |
| Quick actions | y885 → 1040, 4 cards about 197 wide, gap ≈16, radius ≈20 | 9.7% | Petrol Pump / Food Stop / Rest Area / Request Help, each with a chevron |
| Route information | 35,1062 → 866,1285, radius ≈24 | 13.9% | Title plus "View Details →". 4 tiles about 195×145, radius ≈16, `#E6F0E8`. |
| Scenic strip | y1285 → 1470 | 11.6% | Road, river, milestone; script "Safer Routes Stronger India" |
| Bottom nav | 35,1468 → 866,1575 (831×107, radius ≈40) | 6.7% | Floating, `#012823`. **5 tabs:** Home, Trips, raised Navigate disc (about 100 px, mint ring), Safety, More. Thin dividers. |

### Background

- A photo hero at the top and a scenic strip at the bottom.
- Between them, pale mint-white `#F0F6F2`, with the photo faintly visible at the card edges.

### Typography (device px)

| Element | Size / weight |
|---|---|
| Title | 56 / 700 |
| Subtitle | 24 |
| Search placeholder | 22 |
| Overlay card | 26 / 24, white |
| CTA | 26 / 600 |
| Quick-action title / subtitle | 19 / 600 / 16 muted |
| Section title | 24 / 700 |
| Tile value / label / status | 22 / 500 / 18 muted / 18 green |
| Nav labels | 18 |

### Cards, radii, buttons

- Map card radius ≈28; quick cards and tiles 16–20.
- CTA and search are full pills.
- FABs are 66 px white circles with 30 px dark icons.
- The nav bar has radius ≈40, with a raised centre disc that overlaps the bar's top edge.

### Spacing rhythm

- 35 px side gutter (3.9% W).
- 14–20 px between blocks.
- About 16 px between cards in a row.

### Icons

Filled or solid dark forest at about 40 px in the quick actions; outline at about 40 px in the tiles; white 32 px in the nav.

### Colours (approx.)

| Role | Hex |
|---|---|
| CTA | `#013A31` |
| Nav | `#012823` |
| Active label and ring | mint, ≈`#5BE2BC` |
| Quick card | `#F0F6F2` |
| Tile | `#E6F0E8` |
| Route | glowing green, ≈`#3DDC84` |

### Mockup data that must not be copied

- The "Night" chip.
- Guwahati → Shillong.
- **320 km, 8h 20m.**
- **"Suggested Safe Route".**
- "Hilly Terrain · Moderate", "Weather · Clear".
- The route waypoints.
- "Search location, highway or state" with a mic.
- "Food Stop".
- The Home and Trips tabs.

### Real data and state that replace it

- **Title and subtitle:** "Navigate", with a subtitle from state:
  - "No active trip · search, terrain and SOS still work" (current copy), or
  - `{trip code} · {destination}`.
- **Search:** the real function is **"Search roadside services"** (`GET /api/driver/me/trip/places`; categories Fuel, Emergency, Puncture & tyres, Hotels, Lay-bys & rest, and "Search this area"). The placeholder is "Search roadside services". **No mic** on this field.
- **Map card:** the real Leaflet map, with the selected route polyline and the real position.
  - The position pill shows "Last known · N min" or live, and the speed dial stays.
  - The FABs are real: layers (terrain and landslide overlays), re-centre, and route overview (fit).
  - Mute voice guidance, fleet traffic and alternative route stay as secondary FABs, or move into the layers sheet.
  - The existing **SOS** button stays in the hero or top-right of the map.
- **Route summary overlay:**
  - Origin → destination names.
  - The route distance from the selected route.
  - Duration, only as the route provides it and labelled as such (the current "duration · +N min traffic"), never as an ETA.
  - An evidence line from `GET /api/driver/me/trip/route-risk` showing the level, or `NOT ASSESSED` / `UNKNOWN`. **Never "safe".**
  - With no trip, show "Browsing the map / No active trip" in its place.
- **Primary CTA:** the real next step, and **hidden when there is none**.
  - Trip assigned: "Accept trip".
  - Accepted but not started: "Start trip" (`POST …/trip/start`, today on the Trip tab).
  - Active: "Route details", which expands the existing sheet.
- **Quick actions:** Fuel, Lay-bys & rest, Puncture & tyres (real categories), and **Request help**, which opens the existing emergency sheet (112 / 108 / 1033 `tel:` links).
- **Route-information tiles:** distance (real), duration (real, labelled), terrain evidence (level or NOT ASSESSED), weather evidence (from route-risk, or UNAVAILABLE). "View details →" goes to the existing "Show route details" sheet.
- **Nav:** **4 tabs** (Trip, Navigate, Safety, More), which matches `driver_04` and the product. There is no Home screen to link to (§15).

### Reference controls with no real function

| Control | Do instead |
|---|---|
| Mic on the search field | Omit (speech exists only in the Assistant) |
| General place/highway search | Relabel to the real roadside-services search |
| Food Stop | Replace with a real category |
| "Navigate arrow" FAB | Map to the real "route overview" or re-centre, not a third unexplained arrow |
| Home and Trips tabs | 4-tab nav |
| Carousel / script | Decorative only |

### What the current implementation gets wrong

1. **No hero and no heading.**
   - There is no scenic hero, no "Navigate" title and no subtitle.
   - A floating card "Browsing the map / No active trip …" with a round back button and a red SOS disc sits on the map instead.
2. **Map layout.**
   - The map is **full-bleed** (Leaflet OSM raster) instead of a framed rounded card at about 27% of the height.
   - The map is zoomed out to all of the North East and its neighbours, with multi-script labels.
3. **Search.** A round FAB instead of a top field.
4. **Missing card sets.** No quick-action cards, no route-information tiles and no scenic lower strip.
5. **Bottom bar.**
   - A "SERVICES / NO TRIP · Last known / LOCATION" strip.
   - The bottom nav is flat and full-width, with a rectangular outlined active tab.
6. **Dark.** The map tiles stay light while the chrome turns forest green (`#0C302A`).
7. **State difference, not a design defect.** Tenzing has no active trip, so the route, summary and CTA could not be seen with real data.

---

## 7. driver_03_safety (`driver3.jpeg`, 900×1600)

**Screen:** Safety tab. Code: `SafetyScreen.tsx`, `safety/` (breaks, breakStore, guidance).

### Layout regions (device px)

| Region | Box | % H | Notes |
|---|---|---|---|
| Hero photo | 0,0 → 900,465, rounded bottom corners | 0–29% | Back button (72 px white circle) at 38,35. Title "Safety" at x65 (≈56 / 700); subtitle "Drive safe. We are with you." "Night" chip at 740,44 → 864,100. Truck on a mountain road, milestone, script "People Places Progress". |
| Emergency numbers card | 27,466 → 874,710 (847 = 94% W), radius ≈28 | 15.3% | Title (28 / 700) and subtitle. 3 tiles at y568–690, radius ≈20: 112 pink with a red disc, 108 blue with a blue disc, 1033 sage with a forest disc. Discs are 78 px; numbers ≈30 / 700 in their own colour. |
| "Need Immediate Help?" | 30,727 → 872,850, radius ≈24, `#E3F2EB` | 7.7% | Icon disc about 130 px. "Call 112" button at 598,752 → 851,825 (253×73, radius ≈18, `#094335`). |
| Safety Tools card | 27,864 → 874,1205 | 21.3% | Title and subtitle. 2×2 tiles of about 395×113, gap ≈16, radius ≈20, tinted mint / beige / blue / lavender; 72 px discs; chevrons. |
| Scenic banner | 38,1218 → 862,1395, radius ≈24 | 11.1% | Photo under a forest gradient on the left; white text "Safer Drivers Build Stronger North East"; 4 carousel dots; script |
| Bottom nav | 33,1425 → 866,1548, radius ≈40 | 7.7% | Raised Navigate disc; **active Safety pill** `#1C6953` at x537–686 |
| Page bg | — | — | `#F1FAF5` |

### Typography (device px)

| Element | Size / weight |
|---|---|
| Title | 56 / 700 |
| Section title | 28 / 700 |
| Subtitle | 20, muted |
| Numbers | 30 / 700 |
| Tile title / subtitle | 20 / 600 / 17 muted |
| Help title | 27 / 600 |

### Colours (approx.)

| Role | Hex |
|---|---|
| Tile tints | 112 `#FDEFEF`, 108 `#E8F2FD`, 1033 `#EAF9F2` |
| Discs | red `#ED1F2B`, blue `#055CFB`, forest `#033529` |
| Tool tints | mint `#E6F6EE`, beige `#F9F3E7`, blue `#E6F3FE`, lavender `#EFEBFC` |
| Call CTA | `#094335` |
| Nav | `#073B2F` |

### Icons

- Filled white glyphs in solid colour discs for the emergency tiles.
- Dark glyphs in tinted discs for the tools.
- Chevrons.

### Mockup data that must not be copied

- "Night".
- "Share your live location with support" (no such action exists).
- "View and manage important contacts". The driver cannot edit contacts.
- The carousel dots (no carousel).
- "You can also press manually". Wording only; keep the current honest line.

### Real data and state that replace it

- **112 / 108 / 1033:** the real `tel:` links. Keep the line "Tapping opens your dialler. You still press call."
- **"Call 112" CTA:** the same real `tel:112`.
- **Tools grid, mapped to real functions:**

  | Reference tile | Real destination |
  |---|---|
  | Live Location | **"Your location"** — shows the real GPS state (LIVE / Last known · N min / GPS off) and opens the Navigate tab |
  | Safety Tips | **"Safety guidance"** — the bundled offline guidance topics (existing list) |
  | Emergency Contacts | **"Emergency contact"** — opens My details, where the emergency contact is shown read-only ("Not provided" when empty) |
  | Driver Assistant | Driver Assistant (existing) |

- **Keep below the grid:**
  - The **Break card** ("I stopped for a break", with elapsed time and advice, stored on the phone via `safety/breakStore`).
  - The **GUIDANCE** list with its **medical disclaimer**, the reviewed-language note and the provenance/sources footer.
  - Topic detail, including "Call 112 now if…" and "Ask about this guidance".
- **Stop-request and SOS:** these flows live on Trip and Navigate. The redesign must not move or hide them.

### Reference controls with no real function

| Control | Do instead |
|---|---|
| Back arrow | Safety is a tab root, so there is nothing to go back to. Omit it. It *is* real on topic detail ("Back to safety topics"). |
| Carousel dots | Omit |
| "manage" contacts | Label it "View" |
| Live-location sharing | Relabel as above |

### What the current implementation gets wrong

1. **Header.** No scenic hero, back arrow or "Safety" title. The generic header (TB avatar, "Good evening, Tenzing Bhutia", "GPS off · AS-DEMO-0003", theme chip) is used instead.
2. **Emergency numbers.** Three **centred red numbers** with no icon discs:
   - 112 has a pink fill.
   - 108 and 1033 are white with pink borders.
   - The reference has a white card with coloured discs and left-aligned numbers.
3. **Missing cards.** No "Need immediate help / Call 112" card, no Safety Tools grid, and no scenic banner.
4. **Guidance list.** A long run of heavy red-bordered rows (2 px border, `EMERGENCY` eyebrow). The page scrolls about 2.3 viewports (1,506 px of content in a 653 px scroll area).
5. **Dark.** Forest green: cards `#0C302A` on `#06201B`, and the 112 tile is maroon.

---

## 8. driver_04_more (`driver4.jpeg`, 900×1600)

**Screen:** More tab. Code: `MoreScreen.tsx`, `MyDetailsScreen.tsx`, `AssistantScreen.tsx`, `TutorialScreen.tsx`, `i18n/LanguageSheet.tsx`.

### Layout regions (device px)

| Region | Box | % H | Notes |
|---|---|---|---|
| Hero photo | 0,0 → 900,490, rounded bottom corners | 0–30.6% | Back button (84 px circle) at 47,42. "More" at ≈64 / 700; subtitle "More tools. / Safer journeys." at ≈28. "R" road mark at the top-right (750,45 → 855,140). Script. |
| 4 row cards | x28 → 872 (844 = 94% W), each ≈150 tall, gap ≈12: y490–643, 657–806, 818–967, 980–1128 | 9.4% each | Radius ≈28, `#FAFCFB`. Tinted icon discs about 110 px: mint `#DDF7EC`, blue `#DDEEFE`, beige `#F7EDE0`, lavender `#EAE2FC`. Title 30 / 700, subtitle 24 muted, chevron 28. Theme row value "Night" (26 / 600, forest). |
| Sign Out | 33,1148 → 867,1245 (97 tall), radius ≈24 | 6.1% | **Filled** pink `#FDE8E3`, border ≈`#F2A7A5`, red text and icon `#D6424E` (30 / 600) |
| Tagline + rule | y1298; rule 80×3 `#0B3B30` at y1323 | — | "PEOPLE · PLACES · PROGRESS", 16 px, 0.4em |
| Mountain band | y1260 → 1430 | 10.6% | Misty pale-green ridges and pines (illustration) |
| Bottom nav | 28,1428 → 872,1552, radius ≈40, `#043529` | 7.75% | **4 tabs: Trip, Navigate, Safety, More.** Active More pill `#136853` at x675–860, mint label |

### Cards, radii, buttons

Rows radius ≈28 (14 CSS); discs are circles; Sign Out radius ≈24; nav radius ≈40.

### Spacing rhythm

- 28 px gutters (3.1% W).
- 12 px between rows.
- About 35 px disc inset, and 40 px between the disc and the text.

### Icons

Outline, about 48 px, in dark ink inside the tinted discs; chevrons at 28.

### Colours

As listed in the regions table. Page `#F3F9F5`.

### Mockup data that must not be copied

- "Night" and "Night — dark cab surfaces".
- The "R" logo mark (not a RASTA asset; §15).

### Real data and state that replace it

- **Rows:**
  - My details (profile, documents and insurance).
  - Driver Assistant (offline guidance and the translator).
  - Language ("English · changes the app's own labels").
  - Theme ("Light — light surfaces" / "Dark — dark surfaces"; value Light or Dark, with a chevron).
- **Also keep "How RASTA works"** (the real tutorial). The brief allows "Tutorial if currently supported".
- **Sign Out:** `POST /api/auth/logout`.

### Reference controls with no real function

The back arrow: More is a tab root, so omit it. It is real inside the Assistant, My details and Tutorial ("< More").

### What the current implementation gets wrong

1. **Header.** No scenic hero, big title, mark or back arrow; the generic app header is used.
2. **Section labels.** Uppercase labels (YOU, ASSISTANT, LANGUAGE, APPEARANCE) are added.
3. **Rows.**
   - About 120 px tall vs 150.
   - 80 px discs, **all mint**; the source says this was deliberate.
   - The Theme row has no chevron.
4. **Sign Out.** Outlined white with a pink border rather than filled pink.
5. **Bottom of screen.** The tagline and mountain band are missing, leaving the space empty.
6. **Tab bar.** Flat and full-width with a rectangular outlined active tab, not a floating rounded forest bar with a pill.
7. **Dark.** Green (`#0C302A` rows on `#06201B`). The Theme wording "Dark — dark cab surfaces" is correct (Light/Dark).

**Screens with no reference (Trip, Assistant, My details, Tutorial, Phrasebook).** They inherit the driver system: a scenic compact hero or large title, 28 px-radius cards, tinted discs and the floating nav. Their functions are listed in §11.

---

## 9. Theme system plan

### 9.1 Rules (from the brief)

| Rule | What it means here |
|---|---|
| Light comes from the references | Warm cream, sage and forest, with photographs |
| Dark is black or near-black | Green only as accent, CTA, active state or data. No green-tinted neutrals. Photos keep their colour under a neutral black scrim. |
| Same semantic names in both themes and both apps | Components never branch on the theme |
| Wording | **Light / Dark only.** Never Day, Night, "Switch to day" or "Switch to night". |
| Persistence | The explicit choice is persisted locally |
| Switching | **Zero API calls**, no full reload, no flicker |

### 9.2 Tokens

The same names are used in both apps: kebab-case CSS variables in the manager, camelCase `Palette` keys in the driver. The Light column is measured from the references by the theme lane. The Dark column is the brief's value where the brief gives one (marked ★), otherwise derived by the theme lane.

| Token | Light | Dark |
|---|---|---|
| bg | `#EFF2EC` | `#070808` ★ |
| surface | `#FBFCFA` | `#0E1110` ★ |
| surfaceRaised | `#FFFFFF` | `#151918` ★ |
| surfaceSoft (= sunken) | `#E6ECE5` | `#1B201E` ★ |
| border | `#D5DDD4` | `#2A302D` ★ |
| borderStrong (control outline, ≥3:1) | `#75847D` | `#6B746F` |
| text | `#0F1A17` | `#F5F6F2` ★ |
| textMuted | `#525D58` | `#AAB2AD` ★ |
| textFaint | `#5F6A65` | `#8C958F` |
| primary (CTA fill) | `#14382E` | `#39D8A0` |
| primaryHover | `#0C2A21` | `#19B97F` ★ (accentStrong) |
| onPrimary | `#FFFFFF` | `#070808` |
| accent | `#1B6E52` | `#39D8A0` ★ |
| accentSoft | `#DEEEE4` | `#13291F` |
| success / successSoft | `#0E7552` / `#DFEFE4` | `#39D8A0` / `#12241C` |
| warning / warningSoft | `#8A4B09` / `#FCE7D4` | `#E6AE4A` ★ / `#2A2111` |
| danger / dangerSoft | `#A9271D` / `#FADCDA` | `#FF5D67` ★ / `#2E1517` |
| dangerStrong (SOS fill carrying white) | `#C8202B` | `#C62A2F` |
| info / infoSoft | `#1D4ED8` / `#E0F1FF` | `#62A8FF` ★ / `#0F1D2E` |
| route / focus | `#2563EB` | `#62A8FF` |
| shell / shellSurface / shellBorder | `#062621` / `#0C302A` / `#18463B` | `#0A0C0B` / `#151918` / `#222826` |
| onShell / onShellMuted / shellAccent | `#F5F8F6` / `#9FB0A8` / `#5BE2BC` | `#F5F6F2` / `#AAB2AD` / `#39D8A0` |
| brandGold (decoration and on-photo only) | `#C9A227` | `#E3C77A` |
| overlay (modal backdrop) | `rgba(7,12,10,.48)` | `rgba(0,0,0,.64)` |
| imageScrim | forest gradient `rgba(2,33,27,.20)` → `.78` | neutral `rgba(0,0,0,.35)` → `.80` |

**Notes on the tokens:**
- **The shell stays forest in Light.** The references demand it. In Dark it becomes charcoal `#0A0C0B`. That is the only way to satisfy "sidebar black/charcoal".
- **Tints need Dark equivalents.** The driver references use a mint/blue/beige/lavender tint family for icon discs and tool tiles; the dashboard uses sage/peach/pink for KPI tiles. Add `tintMint`, `tintBlue`, `tintBeige`, `tintLavender`, `tintPeach` and `tintPink`, and give each a Dark equivalent at 8–12% saturation, e.g. a `#1B201E` family with a hint of hue. Otherwise the tiles turn into bright pastel blocks in Dark.
- **Light backgrounds.** The driver references are slightly cooler and mint (`#F1FAF5`) than the manager's cream (`#F3F4EE`). One Light `bg` for both apps is within noise; no separate token is proposed.

### 9.3 Manager implementation (smallest change)

1. **Tokens.**
   - Declare the tokens as plain variables on `:root` and override them in `:root[data-theme="dark"]`.
   - Turn the existing `@theme {}` block (`index.css` lines 39–111) into `@theme inline { --color-canvas: var(--bg); --color-surface: var(--surface); … }`.
   - The **1,031 existing utility call sites keep their names**; the capture lane confirmed that utilities compile to `var(--color-x)`.
2. **Colour scheme and first paint.**
   - Set `color-scheme` per theme; today `html { color-scheme: light }` is hard-set.
   - Add an inline `<head>` script of about 3 lines that reads `localStorage['rasta:theme']` before first paint and sets `data-theme`. This prevents a flash. The current CSP (frame-ancestors only) allows it.
   - Wrap reads and writes in try/catch; if storage is blocked, fall back to Light.
3. **Default.** **Light** until the user chooses. The manager ignores the OS today, and the brief says to respect the system only where the product already does.
4. **Toggle.**
   - A new profile menu behind the avatar chevron with a "Theme" choice (Light / Dark, `role="radiogroup"` or two `aria-pressed` buttons) and "Sign out".
   - It must be keyboard-reachable, have a visible focus ring, and close on Escape.
   - Region and login follow the stored choice and have no toggle of their own (§15).
5. **Hard-coded colours.**
   - Replace the 9 `bg-primary text-white` pairs with `text-on-primary`. In Dark, white on `#39D8A0` is 1.83:1.
   - Move the 10 raw shell hex values in `index.css` and the 18 arbitrary colours in `LoginPage.tsx` onto tokens.
   - `tripExport.ts` print CSS **stays Light on purpose**.
6. **Maps** (MapLibre, OSM raster; the probe is at `.runtime/redesign/current/theme-arch-dark-map-probe*.png`).
   - Dark basemap via raster paint on the `osm` layer: `raster-brightness-min 1`, `raster-brightness-max .08`, `raster-hue-rotate 180`, `raster-saturation -0.9`, `raster-contrast .1`. The result is neutral (0% green-dominant pixels).
   - Do **not** use a CSS filter on the canvas; it would recolour the routes and markers.
   - Map paint cannot read CSS variables. On a theme change, read `getComputedStyle(document.documentElement)` and call `setPaintProperty`.
   - Retokenise the overlays:
     - route to `#62A8FF` in Dark;
     - the observed track and fixes (`#101820`, 1.53:1 in Dark) to a light token;
     - hillshade highlight;
     - control, attribution and popup CSS.
7. **Tests.**
   - A theme toggle makes **0 fetch calls** (a Vitest spy on `fetch`).
   - The theme persists across a reload (Chrome).
   - An AA contrast check for every text token on bg / surface / surfaceRaised / surfaceSoft in both themes. It is new for the manager; the driver already has one.
   - A wording test: no Day/Night strings. Copy the driver's `themeWording.test.ts`.
   - A neutrality test: Dark bg / surface / surfaceRaised / surfaceSoft / border / shell saturation ≤ 12%.

### 9.4 Driver implementation

1. **Rename the `Palette` keys** to the canonical names in one mechanical pass; `tsc` catches every miss:
   - `card` → `surface`
   - `raised` → `surfaceRaised`
   - `soft` / `sunken` → `surfaceSoft`
   - `muted` → `textMuted`
   - `faint` / `dim` → `textFaint`
   - `bad` → `danger`
   - `warn` → `warning`
   - `ok` → `success`
   - `onAccent` → `onPrimary`
   - the primary CTA fill → `primary`

   There are 730 `COLORS.x` references, all through `makeStyles`.
2. **Replace `NIGHT`** with the Dark column above. It is `#06201B` today (hue 168°, saturation 68%), which the source itself describes as "Deep forest, not charcoal".
3. **Persistence.** Store the choice in AsyncStorage `rasta:theme`, following the `AppLanguageProvider` pattern, and hold the existing splash until it is read, so there is no flash.
4. **First use.**
   - Keep today's behaviour: Expo web follows the system; native starts Light because `app.json` sets `"userInterfaceStyle": "light"`.
   - Switching to `"automatic"` is an owner decision (§15).
5. **Login.** Remove `fixed="day"` in `App.tsx` so the login follows the choice.
6. **Toggle placement.**
   - The More → Theme row is the primary control.
   - The references show a small theme chip at the top-right of the **Navigate and Safety heroes**. Move the existing header chip there, so the quick toggle matches the reference composition.
   - The chip shows the current mode with `aria-label` "Switch to light theme" / "Switch to dark theme" (current).
7. **Maps.**
   - Leaflet (web and WebView): add a CSS filter on `.leaflet-tile-pane` **only**: `invert(1) hue-rotate(180deg) brightness(.95) contrast(.9) saturate(.12)`. The overlays stay true-colour.
   - WebView theme via `injectJavaScript` (toggle a class). Regenerating the HTML would reload the tiles and lose the camera.
   - Fix the native WebView background `#E8EDEB` flash.
8. **Hard-coded colours.** Tokenise the 56 raw hex values outside `theme.ts` as each screen is touched. Priority files:
   - `map/scene.ts` (24)
   - `TripScreen.tsx` (8, including Dark-only green callouts)
   - `DriverRouteMap.native.tsx` (7)
   - `MapScreen.tsx` (7)
9. **Tests.**
   - Extend `theme.contrast.test.ts` with the neutrality check.
   - Keep `themeWording.test.ts`.
   - A theme switch makes 0 requests (mock the transport).

---

## 10. Photography and asset plan — BLOCKER

### 10.1 The blocker

- **The repo has no scenic photographs.** The theme lane confirmed this with `git ls-files`: no `.jpg`, `.jpeg`, `.webp` or `.avif` outside untracked launcher icons.
- The only "scenery" is vector: `TerrainScene.tsx` and `NorthEastMap.tsx`.
- `manager-web/src/assets/hero.png` is an unused Vite scaffold image.
- **The mockup images themselves must not be shipped**, cropped or traced:
  - The brief forbids using a reference as a page background.
  - They carry no licence information.
  - Their photos contain baked-in mockup content (a "NORTH EAST INDIA" milestone, a script slogan).

**Until photographs are approved**, keep the reference composition, put the existing vector scenery in the photo slots, and certify `IMAGE_TREATMENT_MATCH = FAIL` with the mismatch documented. The brief forbids a plain green background as a substitute.

### 10.2 Image slots needed

| Slot | Reference | Aspect / size to deliver | Content and focal point | Scrim |
|---|---|---|---|---|
| M1 lower landscape | manager_01 | Full width, 2400×900 master, visible band about 1600×420 | Misty valley and highway, truck in the right third; dark foreground at the lower-left for the stats | Light: none (mist blend). Dark: neutral black. |
| M2 login panel | manager_02 | ≈1.08:1, 2000×1850 master | Highway or bridge and truck in the right half; the left third calm and dark enough for text | Light: forest overlay (`imageScrim`). Dark: neutral. |
| M3 scenic card | manager_03 | ≈1.6:1, 720×450 | Highway and truck | Gradient behind right-aligned text |
| D1 driver login | driver_01 | 9:16 portrait, 1080×1920 | Sky in the top third (logo); road and truck in the bottom third | Card carries legibility; Dark adds a neutral scrim |
| D2 Navigate hero + lower strip | driver_02 | 3.75:1 strip, 1080×290; lower strip 1080×230 | Mountains; road | Soft cream fade into the page (Light) / black (Dark) |
| D3 Safety hero + banner | driver_03 | ≈1.9:1, 1080×560; banner ≈4.7:1, 1000×215 | Truck on a mountain road; valley and river | Banner: forest (Light) / neutral (Dark) gradient on the left |
| D4 More hero | driver_04 | ≈1.8:1, 1080×590 | Mountains, river, road | Fade into the page |

Three source photographs, cropped differently, cover every slot:
- **(A)** a wide North-East highway with a truck;
- **(B)** a wide mountain valley with a river;
- **(C)** a portrait of a road with a truck.

The sidebar pines, the login tree silhouette and the More mountain band stay **vector**, extending `TerrainScene`.

### 10.3 Sourcing options (owner decides)

| Option | Pros | Obligations and risks |
|---|---|---|
| **1. Wikimedia Commons**, CC BY / CC BY-SA / CC0 / public domain | Free, searchable, real North-East locations | Per-image attribution (author, licence, link) visible in the product, e.g. an "Image credits" line on the Diagnostics page and in the driver's "How RASTA works", plus `docs/ASSET_LICENSES.md`. CC BY-SA: our crops and overlays are adaptations, so the adapted image file stays CC BY-SA. Check people (personality rights), readable number plates (avoid or blur) and truck branding. Verify the licence on the file page, not a mirror. |
| **2. The team's own photographs** | No attribution constraints; authentic | Written confirmation of authorship; strip EXIF GPS and device data; releases for identifiable people |
| **3. Owner-supplied or purchased stock** | Quality control | The licence must cover a web app and a distributed APK; keep the licence file |
| Not recommended without the owner's explicit approval | — | AI-generated imagery: provenance and truthfulness questions; not assessed here |

### 10.4 Technical rules for images

- **Manager (web):**
  - `<picture>` with AVIF and WebP, plus a JPEG fallback.
  - `srcset` widths 800 / 1600 / 2400.
  - Budgets: hero ≤ 180 KB at 1600 w (WebP), card ≤ 60 KB.
  - Preload only the image that is the Largest Contentful Paint on the login and region pages.
  - `loading="lazy"` for the Overview scenic card.
- **Driver:**
  - **Bundled** in the APK (offline use), WebP, 1080 w maximum, ≤ 150 KB each.
  - Owner to confirm a total added-APK budget; this audit suggests ≤ 600 KB.
- **Scrims** are CSS or RN gradient overlays driven by the `imageScrim` token and are **never baked into the file**, so one photo serves both themes.
- **Alt text:** decorative images get `alt=""` or `accessible={false}`. Photos never carry information.
- **Performance:** the lazy manager chunks, the entry-bundle gain and the driver caches must be preserved (§12, gate P). Photos must not enter the JS bundle (import as URLs).

### 10.5 Other asset questions

- **Brand mark.**
  - The manager references use a gold mountain line-art wordmark.
  - `driver_01` uses the **existing shield app icon** (the same as the repo's `brand-mark.svg` / `brand-mark.png`).
  - `driver_04` uses an unrelated "R" road mark.
  - This needs an owner decision (§15).
- **Script taglines** ("Mountains Move Markets", etc.) are decorative. Render them as SVG lettering, or use an OFL Google script font (the manager already loads Google Fonts; the driver would need `expo-font`), or omit them.

---

## 11. Functional preservation map

Sources:
- Manager Region → Trucks: the inventory lane (element-level).
- Assignments, States, Managers, Review, Reports, Notifications, Diagnostics, and all driver screens: the inventory input was **truncated** after Trucks/Assignments. For these I read the page files and listed the API client calls each one makes. That is **a summary, not an element-level inventory**, and a full inventory of each of these pages must be written before it is restyled.

### 11.1 Manager

| Page | Functions that must survive | API | States to keep visibly distinct |
|---|---|---|---|
| Region (step 1) | 4-scope choice; State select (highlights the map); District select with "(recently changed)" and a "directory pending" warning; Continue; remembered scope (`rasta:workspace`) | `GET /api/org/regions` | "—" stats while loading; District disabled with its reason. **Gap:** regions error looks like loading |
| Login (step 2) | Opening-scope chip + Change; identifier; password + show/hide; "Remember this region"; Log in with double-submit guard; error banner (network / server / denied driver); "Restoring session…" gate | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/refresh` | Busy "Signing in…", then "Waking secure server…" after 4 s; disabled until both fields are filled |
| Shell | Permission- and role-filtered nav (hidden, never disabled); Diagnostics; skip link; scope label; offline SyncBanner; sync status; SOS badge; bell → /notifications; avatar and role; Sign out (always clears locally) | `GET /api/emergencies/active` (10 s / 30 s), `/health` probe, `GET /api/org/regions` (scoped roles) | "Checking SOS…", "SOS status unknown" (never reads as no SOS), "Offline · showing last known data" |
| Overview | 10 figures, each opening its rows; New trip; Live operations; States table → /states; districts; "Who is on" | `GET /api/dashboard` (15 s), `GET /api/presence` (15 s) | Loading and error only without a cache; null → hidden; colour only when > 0. **Gap:** presence failure shows as empty |
| Fleet | Quick actions (New trip, Assign truck dialog, Review required, Active trips anchor); stale-poll banner + Retry; Sentinel SOS banner + dossier (focus trap, Escape, resolve); KPI bar; freshness chips; lazy map (markers, planned route, observed track); 2D / Terrain / 3D; POI categories; legend toggles; Fit fleet / Fit trip; search table; detail panel with Overview / Route / Cargo / Activity tabs; Plan / Re-plan route; Check route conditions; candidate cards (Use / Accept reroute / Review & approve / Preview) | `GET /api/fleet/active` (10 s, backoff to 60 s); `GET /api/places?…`; trip / driver / truck / track / routes reads; `POST …/routes/recalculate`, `GET …/reroute`, `GET …/routes/recommendation`, `POST …/routes/{rid}/select`, `POST …/reroute/accept`, `POST …/routes/{rid}/approve`, `POST /api/assignments`, `POST /api/emergencies/{id}/resolve` | "Loading map…", MapLoadBoundary, terrainNote fallback, "Looking…", "Mapped, not verified" + attribution, per-card busy, Fit trip disabled with a title |
| Trips | Planner (gated by `trip:create`); client and weight validation; AddressPicker (suggest / details / Choose on map / Paste Maps link); Swap; region blocker; driver → truck auto-fill with disabled options; Create draft; Trip review (map, layers, "Arrival time unavailable"); Plan / Replan; Check conditions & review; Preview corridor; Use this route / blocked / assigned; approval dialog; Journey history; list tabs, filters, paging; Export CSV / PDF; row Review / Dispatch / Close / Cancel (confirm) / Change journey dialog | `POST /api/trips/plan`, geocoding suggest / details / resolve-link, trip / route / review-authorization reads, `POST …/recalculate`, `GET …/recommendation`, `POST …/select`, `POST …/approve`, `GET …/events`, `GET /api/trips?…&cursor`, `POST …/dispatch`, `/close`, `/cancel`, `/stops` | Each button's disabled-with-reason title; blocker `role=status`; "Every journey starts with a plan" |
| Drivers | Server search; Add driver form (field errors; hosted-disabled with a reason); row Assign truck; profile drawer (documents, verify by hand, change / assign / end, read-only support view, deactivate) | `GET /api/drivers`, `POST /api/drivers`, `GET …/documents`, `POST /api/assignments`, `…/verify-manual`, `…/end`, `POST …/support-session`, `POST …/deactivate` | Phone masking must be kept (it is masked in the table today) |
| Trucks | Search; Add truck; reference photo upload; Assign; End assignment; Retire | `GET/POST /api/trucks`, `POST /api/files?kind=TRUCK_PHOTO`, assignments, `POST …/retire` | pairLocked disabled states. **Gap:** photo upload has no loading or error |
| Assignments* | Assign truck; manual verify (Confirm / cancel); End | listAssignments, listDrivers, listTrucks, verifyAssignmentManually, endAssignment | Linked from Trucks; add to the nav with `assignment:read` |
| States & districts* | Directory view per state / district | listStates, listDistricts | "Official list pending" must stay honest |
| Managers* | List, create and deactivate manager accounts within scope | listManagers, createManager, deactivateManager, listStates, listDistricts | — |
| Review* | Second-level route authorisation: list trips / routes, recommendation, authorise, revoke | listTrips, listRoutes, routeRecommendation, authorizeReview, revokeReviewAuthorization | Route guarded by `route:review_authorize` |
| Reports* | Report figures and trip lists; "View detailed report" target | dashboard, listTrips | — |
| Notifications* | List; mark read | listNotifications, markNotificationsRead | — |
| Diagnostics* | Readiness and provider status | ready, systemProviders | — |

\* A summary from reading the page file (API calls only); an element-level inventory is still required.

### 11.2 Driver

These are summaries from reading the screen files and `api/client.ts`. An element-level inventory is still required.

| Screen | Functions that must survive | API seen in the client or screen |
|---|---|---|
| Shell | 4-tab nav; header status (GPS state, truck code); theme quick chip; presence heartbeat; location upload; push token; read-only support banner; offline | `POST /api/presence/heartbeat`, `POST /api/driver/me/location`, `POST …/push-token` |
| Login | Language sheet (with search); fixed "+91" mobile; password show/hide; Sign In (disabled until complete); help text; errors | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/refresh` |
| Trip (no reference) | Assignment and truck verification; accept; start; stop arrive / complete (pickup-first); complete trip; **stop-request**; instruction acknowledgement; notices; **emergency check-in**; offline package; Open map; Check again; the YOU card | `api.myAssignment`, `…/assignment/verify`, `acceptTrip`, `startTrip`, `arriveAtStop`, `completeStop`, `completeTrip`, `requestTripStop` (`…/trip/stop-request`), `acknowledgeInstruction`, `myNotices`, `checkInEmergency` (`…/trip/check-in`), `…/offline-package` |
| Navigate | Map, route and position; the speed dial; "Last known" / live pill; maneuver card or "Browsing the map"; **SOS → emergency sheet** (112 / 108 / 1033 `tel:`); roadside-services search and categories; place detail with UNKNOWN fields; mute; route overview; terrain and landslide overlays; fleet traffic; alternative route; re-centre; route-details sheet; reroute request; alert acknowledgement; "Find a place to stop" | `…/trip/places`, `…/trip/route-risk`, `…/trip/navigation`, `api.requestReroute` (`…/trip/reroute`) |
| Safety | 112 / 108 / 1033 `tel:` tiles; break card; offline guidance topics with the **medical disclaimer**, language note and sources; topic detail ("Call 112 now if…", "Ask about this guidance") | None found (on-device content; `tel:` links) |
| More | My details, How RASTA works, Driver Assistant, Language, Theme, Sign Out | `POST /api/auth/logout` |
| My details | Profile; documents (add); truck documents; emergency contact (read-only) | `api.myProfile`, `api.addDocument`, `api.addTruckDocument` |
| Assistant | Answers from on-device data ("No connection needed"); ASK chips; mic (device speech, which "needs a connection"); typed input; "< More" back link | On-device (the `ai/` module); the client also defines `/api/ai/ask` and `/api/ai/status` |
| Tutorial, Phrasebook | Short tour; phrasebook | — |

### 11.3 Defects the inventory found

These are not redesign work, but the redesign must not hide them. Fix each one separately, before or alongside restyling its page.

| # | Where | Defect |
|---|---|---|
| D1 | Fleet → Assign truck | Not gated by `can('assignment:create')`. STATE and DISTRICT managers get a 403 on submit. |
| D2 | Fleet → Incident dossier → Confirm & Resolve | Not gated by `can('emergency:resolve')` (403 for STATE and DISTRICT). Hosted: not checked as unavailable. |
| D3 | Fleet / Trips → Approve route | Hosted: `approveRoute` is in `UNAVAILABLE_OPERATIONS` but is not gated via `unavailableReason()`. |
| D4 | Overview → Who is on | `.catch(() => [])` turns a failure into "No drivers in scope are reporting". |
| D5 | Region → State select | A regions failure looks the same as loading (empty select, "—"). |
| D6 | Trucks → photo upload | No loading or error state; failures are swallowed. |
| D7 | Overview → New trip | Not gated by `trip:create`. |
| D8 | Shell → Sign out | No busy state. |

---

## 12. Implementation order

Work screen by screen in the smallest safe steps. **After every step:**
- The existing tests pass: `manager-web` Vitest, `driver-app` Jest.
- Typecheck is clean and the manager build passes.
- Screenshots are taken in both themes at the matrix sizes.
- The network log shows no new calls except those intended.
- Console errors are 0.
- The screen is compared side by side with its reference, and its §13 certification entry is updated.

### Phase 0 — Theme foundation (no visual change in Light)

| Step | Change | Proof |
|---|---|---|
| 0.1 | Manager tokens become runtime variables with an `@theme inline` alias. Light values identical to today. | Screenshots pixel-identical to `.runtime/redesign/current/manager-*.png` |
| 0.2 | Manager Dark values, `data-theme`, head script, persistence, profile menu (Theme + Sign out) | 0 fetch calls on toggle; reload keeps the choice; contrast, neutrality and wording tests |
| 0.3 | Manager hex hotspots onto tokens (`text-on-primary`, shell, login) | Dark screenshots show no white-on-mint and no forest surfaces |
| 0.4 | Manager map dark paint and overlay tokens | Probe-style screenshot; route contrast ≥ 3:1 |
| 0.5 | Driver key rename (mechanical) | `tsc` clean, Jest green, Light screenshots unchanged |
| 0.6 | Driver Dark values, neutrality test, AsyncStorage persistence, splash hold, remove `fixed="day"`, Leaflet filter, WebView inject | Dark pixel scan: 0% green-tinted neutrals; reload keeps the choice |

### Phase 1 — Shared components

**Manager:** `PageHeader`, `Card`, `KpiCard` (64 px tile, caption link, no trend), `IconTile`, `ViewAllButton`, `ScenicImage` (`<picture>` plus `imageScrim`), `ProfileMenu`.

**Driver:** `ScreenHero` (photo, title, subtitle, optional theme chip), `RowCard` (tinted disc), `IconDisc`, `FloatingTabBar` (4 tabs, pill active, touch targets ≥ 52 CSS px, safe-area aware).

Each gets unit tests for its accessible name and keyboard focus.

### Phase 2 — Manager screens

1. **Region**
   - Layout grid to the reference proportions.
   - Segmented scope control plus icon dropdowns.
   - Map styling, including selected state and label callout.
   - Stats over the scenic slot, which uses a vector fallback until photos arrive.
   - Fix D5.
   - Tests: all 4 scopes still post the right `workspace` / `state_id` / `district_id`; a wrong scope is refused; the remembered scope still skips step 1.
2. **Login**
   - 60.7 / 39.3 split, filled 62 px discs, 503 px left-aligned form, forest CTA (disabled look per §15).
   - Tests: the existing login, error-banner and restore-session flows.
3. **Shell**
   - Sidebar groups with dividers, filled pill, region card without a link.
   - Topbar greeting, bell, profile menu, SOS badge.
   - Assignments nav item (`assignment:read`). Fix D8.
   - Tests: nav visibility per role (ADMIN, MANAGER, NE, STATE, DISTRICT).
4. **Overview**
   - 4 KPI cards with caption links (all 10 figures), lazy map card, activity rail, lower row.
   - Fix D4 and D7.
   - Tests: each figure's link target; a null figure is hidden; the map chunk stays lazy.
   - Gate P: the entry bundle does not grow by more than the new components.
5. **Fleet**
   - KPI cards to `KpiCard`; POI bar into the map card header; legend inside the map.
   - Fix D1, D2 and D3.
   - Tests: the existing Fleet tests plus permission gating.
6. **Trips, Drivers, Trucks, Assignments, States, Managers, Review, Reports, Notifications, Diagnostics**
   - Header, card and table system only.
   - Write each page's element-level inventory before touching it.
   - Fix D6 with Trucks.

### Phase 3 — Driver screens

1. **Login:** full-bleed photo slot, centred logo stack, frosted card, eye icon, forest CTA, trust row, Dark scrim.
2. **More:** hero, 150 / 12 rows with tinted discs, filled Sign Out, tagline and mountain band, floating nav.
3. **Safety:** hero with theme chip, emergency card with discs, help CTA, tools grid mapped as in §7, break card and guidance kept below, banner.
4. **Navigate** (highest risk, since it touches the map):
   - Hero and search field (roadside services), framed map card, route summary overlay (real or UNKNOWN), next-step CTA, quick actions, route-information tiles.
   - Tests: MapScreen tests; SOS sheet reachable in ≤ 1 tap from the hero; `tel:` links; no "safe" string (grep test).
5. **Trip, Assistant, My details, Tutorial:** inherit `ScreenHero` and `RowCard`; no reference exists, so certify them for consistency only.

**Photographs** drop in when the owner approves them (§10). Until then every image slot uses the vector fallback and is certified `IMAGE_TREATMENT_MATCH = FAIL`.

---

## 13. Visual comparison method and certification template

### 13.1 Loop (brief §14)

For each reference:
1. Render at the matching size:
   - manager 1600×900, DPR 1;
   - driver 450×800 CSS, DPR 2 (900×1600 PNG).
   Use headless Chrome over CDP with a fresh profile, local stack only, simulated GPS on the Guwahati corridor, and phone numbers masked to the last two digits.
2. Capture Light and Dark.
3. Build a **side-by-side** PNG (reference on the left, implementation on the right) and a **50% onion-skin** overlay.
4. Measure the implementation's key boxes with `getBoundingClientRect` (manager) or the RN web DOM (driver). Compare them with the region tables in §2–§8.
5. Fix the largest mismatch, run the functional tests, and capture again. Repeat. The brief says not to stop after one pass.

### 13.2 Tolerances

| Check | Tolerance |
|---|---|
| Region edges | Within ±2% of W or H of the reference box |
| Type | Within ±10% of size, same weight class |
| Radii | ±2 CSS px |
| Flat-surface colour | ±8 per RGB channel against the token; not measured over photos |
| Structure | Every reference region present, or listed in KNOWN_DIFFERENCES with the reason (a no-function control, real data, or a missing photo) |

Never write "exact" or "pixel-perfect" unless the overlay proves it.

**Evidence location:** `.runtime/redesign/<date>/` (gitignored). Images that go into `docs/` must hold no password, no unmasked phone number and no real person beyond demo accounts.

### 13.3 Certification entry: `docs/REDESIGN_VISUAL_CERTIFICATION.md`

Use one block per screen, with the fields from brief §15:

```text
REFERENCE =
IMPLEMENTATION_SCREENSHOT =
STRUCTURE_MATCH =
SPACING_MATCH =
TYPOGRAPHY_MATCH =
COLOR_MATCH_LIGHT =
COLOR_MATCH_DARK =
IMAGE_TREATMENT_MATCH =
FUNCTIONS_PRESERVED =
ACCESSIBILITY =
RESPONSIVE =
KNOWN_DIFFERENCES =
STATUS =            PASS | PARTIAL | FAIL
```

**Status rules:**
- **PASS** needs every field above to match, both themes captured, the functions test-proven, and the responsive matrix clean.
- While `IMAGE_TREATMENT_MATCH = FAIL` (no approved photos), STATUS is at most **PARTIAL**.
- "Tests pass" alone is never PASS.

**Dark-theme block (brief §18)**, for manager region, login, overview, fleet and trips, and driver login, navigate, safety and more:

```text
DARK_BG_VISUAL = BLACK/NEAR-BLACK | GREEN
GREEN_USAGE    = ACCENT_ONLY | SURFACES
MAP_LABELS_READABLE =
PHOTO_TINT = NEUTRAL | GREEN
```

**Responsive block (brief §13):**

```text
Manager widths: 320 360 390 412 768 1024 1280 1366 1440 1920 2560
Driver: small / normal / large Android, keyboard open, large text, safe areas
HORIZONTAL_OVERFLOW = 0
OFFSCREEN_PRIMARY_CONTROL = 0
DEAD_CONTROL = 0
UNNAMED_INTERACTIVE_CONTROL = 0
```

**Device rule:** with no phone available, `DRIVER_PHYSICAL_VISUAL = BLOCKED`, not PASS. This audit's driver evidence is Expo web only.

**Performance block (brief §17):**

```text
MANAGER_ENTRY_BUNDLE =
FIRST_USEFUL_RENDER =
MAP_FIRST_USEFUL =
DRIVER_SCREEN_SWITCH =
THEME_SWITCH =
```

The final gates and the final report use the fields from brief §19–§20 unchanged.

---

## 14. Things this audit could not verify

- **Driver theme persistence across a reload** was not exercised in a browser. "Not persisted" comes from reading `theme-context.tsx`.
- **Navigate with a real route**, summary and next-step CTA: not seen, because the test driver has no active trip and no trip was created.
- **Physical Android:** not used; the web build only.
- **Pages marked \* in §11** have an API-level summary only.
- **Reference measurements** are visual reads (±10 px), and colours are JPEG samples; translucent surfaces are approximate.

---

## 15. Open decisions for the owner

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | **Photographs (BLOCKER)** | Wikimedia Commons with attribution / the team's own photos / owner-supplied or stock | Team photos if they exist; otherwise Commons CC BY or CC0 with an in-product credits line |
| 2 | Brand mark | Existing shield (repo asset, and `driver_01`) / mountain line-art wordmark (manager refs; must be drawn) / "R" road mark (`driver_04`) | The shield everywhere. The line-art mountains optionally as decoration above the wordmark. Not the "R". |
| 3 | Script taglines | SVG lettering / OFL script font / omit | SVG lettering for the 3–4 lines used, or omit |
| 4 | Region scope control | Segmented 4-option control plus the reference dropdowns / reference dropdowns only | Segmented plus dropdowns. Dropdowns alone would remove North-East and My own console, which the server supports. |
| 5 | Driver tab count | 4 tabs (`driver_04`, current) / 5 with Home and Trips (`driver_02` and `_03`) | 4. There is no Home screen, and adding one is new product scope. |
| 6 | Overview slot of "Weather & Road Alerts" | "Awaiting a decision" trips card (real) / omit and widen the districts card | "Awaiting a decision" |
| 7 | Overview KPI choice | The 4 cards with captions in §4 | As proposed |
| 8 | Notification count badge in the shell | Add one from a cached real source (`/api/dashboard` unread / urgent) / none | Add it only if it reuses an existing cached call. Never hard-code it; an error must never show 0. |
| 9 | First-use theme | Manager Light; driver: web follows the system, native Light (today) / set `app.json` to `"automatic"` | Keep today's behaviour; persist after an explicit choice |
| 10 | Theme toggle on pre-login screens | None (follow the stored choice) / a small toggle | None. The references show none on the logins. |
| 11 | Heading case | Title Case (references) / sentence case (house style) | Title Case on the three manager hero headings, to match the references |
| 12 | Disabled primary CTA look (manager and driver logins) | Pale sage (today) / forest at reduced opacity with `aria-disabled` / always enabled with inline validation | Forest at about 50% opacity. The disabled logic is unchanged. |
| 13 | Driver route colour | Glowing green (reference) / blue route token (today) | **Blue.** Green reads as "safe/OK", and blue is consistent with the manager legend and the Dark contrast (`#62A8FF`). |
| 14 | Basemap style | Keep OSM raster (+ existing hillshade) / a new satellite or terrain provider to match the references | Keep OSM. Local-script edge labels cannot be changed on OSM raster tiles; accept them, or budget for a new tile source. |
| 15 | Driver login trust row | Keep "Safer Deliveries / Smarter Logistics / Stronger India" as decorative statements / replace with current copy | Keep as decoration (no numbers). The owner confirms the claims are acceptable. |
| 16 | Region map interactivity | Static (today) / click a state to select | Static for now; clickable later as separate work |
| 17 | Login footer "SIH26002 · MDoNER" | Keep small / remove | Keep small, bottom-left |
| 18 | Driver custom font | System font (today) / bundle Inter or Sora via `expo-font` | System font; revisit after the visual pass |

---

## 16. Review corrections and adopted decisions (27 Sep, before any code)

An adversarial review re-checked this audit against the seven references, the current screenshots and the
code. Where this section disagrees with an earlier one, **this section wins**.

### 16.1 Corrections

| Section | Correction |
|---|---|
| §4 / §11.1 notifications | ADMIN holds `notification:read` (ALL_PERMISSIONS). Only MANAGER (and the reviewer, who has no Overview) lacks it. |
| §4 KPI rule | The fourth KPI card is chosen with `can('notification:read')`. The urgent and unread counts are never null. Only `cross_state_trips` can be null (district managers), and only that card hides on null. |
| §4 activity rail | "Who is on" (presence) stays for **every** role. It goes in a lower-row card; the rail shows notifications where the role can read them. |
| §4 KPI links | Every caption keeps its current target. Stale GPS goes to `/fleet`. The definition hints ("Delayed or incident", "Cannot be dispatched yet", "Heartbeat in the last 90 seconds", "Last position over 10 minutes old") stay as card sub-lines. |
| §2 region map | The selected-state fill exists today (`NorthEastMap.tsx:82-102`), but only for State and District scopes. What is missing: a highlight for North-East and My own console, the relief texture, and the callout. Other states ≈ `#C0D5C4`. |
| §4 map controls | Compass/fit top-left, zoom bottom-left, legend top-right, as in the reference. Only the POI chip bar leaves the lower map area. |
| §4 sidebar | The active item is a filled pill **plus** a ~4 px gold left accent. Recolour the existing bar, do not remove it. |
| §4 header | A borderless light header band on the surface token (not the canvas). |
| §11.1 Review | `/review` is route-guarded by `route:read`, and its nav item by `route:review_authorize`. Keep both. |
| §11.2 driver header | The header shows GPS state · **licence number**, plus avatar initials and a greeting. |
| §1.2 / §6 ETA | The real arrival time computed from the server's `remaining_at_planned_pace_min` stays, labelled "at planned pace" ("last known" when stale). Only invented or speed-derived ETAs are forbidden. |
| §11.3 D7 | Latent: every role that sees Overview holds `trip:create`. The Fleet "+ New trip" link belongs to the same item. |
| §9.4.1 palette rename | Not mechanical. Driver `accent` is both the CTA fill and accent text; `soft` ≠ `sunken` in Dark; `disabled` was missing. Every `accent` use is reviewed by hand, with screenshot diffs. |
| §5 / §3 measurements | Current driver fields are about 112–115 device px tall (reference 86). The current manager login column spans x1020–1420, centred in its panel; the reference is 503 px wide and left-aligned at x1049. |
| §1.1 #2 | The driver Dark green-pixel share is about 90–99% on non-map screens (Navigate 42%, because the light tiles dominate). |
| §8 theme copy | Keep "Dark — dark cab surfaces" / "Light — light surfaces". They are already translated and use only Light/Dark as the theme words. |
| §9.3.6 manager Dark basemap (Phase A review) | `raster-brightness-min` is **0.8**, not 1, and the planned route is drawn at full opacity in Dark (`--map-route-opacity`: Light 0.7, unchanged). With the probe's values the inverted forest grey (#535752, the 90th-percentile basemap pixel) left the route at 2.2:1, or 3.0:1 at full opacity. Measured on a real planned route: 3.73:1. Evidence: `.runtime/redesign/phase-a/manager/evidence.json` → `review_fixes_r1_r9`. |
| §9.2 manager `accent` | The manager now declares `accent` too (Light `#1B6E52`, Dark `#39D8A0`), so both apps share the name. Existing manager call sites keep `primary`. |

### 16.2 Omissions now in scope

- **`driver-app/src/manager/ManagerRoot.tsx`** (the manager shell inside the driver app) gets the new tokens and a black Dark. It gets no visual reconstruction, because no reference covers it.
- **The truck check (`AssignmentScreen.tsx`)** and Trip, Assistant, My details and Tutorial inherit the new hero and row components and are certified for consistency only.
- **Navigate keeps every active-guidance function.** That means:
  - the maneuver card and the nav-state chip (Idle / Following / Off route / Rerouting / GPS stale / Offline);
  - duration, remaining and arrival at planned pace;
  - alert acknowledgement and "Find a place to stop";
  - reroute requests;
  - the re-centre states;
  - the back button.

  The reference composition is the idle/overview state. While guiding, the guidance panel replaces the quick
  actions.
- **Navigate's Accept / Start** reuse the Trip tab's gates:
  - `can_start`;
  - the `start_blocked_reason` banner;
  - the `ASSIGNMENT_NOT_VERIFIED` → "Check the truck" path;
  - the in-flight guard.

  Where a gate applies, the CTA routes to the Trip tab rather than duplicating logic.
- **GPS status stays visible on every driver screen.** A compact chip sits in each hero.
- **The driver colour rule stays:** green = action, blue = route, amber = caution, red = emergency
  (`MoreScreen.tsx:149-153`). Row discs use neutral or semantic tints that respect it.
- **Reports** keeps Export CSV, Print / PDF and the "Build the report first" state.
- **Mockup copy not to copy:**
  - manager_02 feature rows ("Real-time vehicle tracking", "AI-powered route insights"…). The current honest rows stay.
  - manager_03 "Real-time movement across Assam - Kamrup".
  - "Eight States. Infinite Possibilities." is allowed only as decorative copy, never as data.
- **Dark neutrality test coverage** now includes:
  - the driver `disabled` key;
  - large-surface `accentSoft` / `successSoft`;
  - the manager shell tokens;
  - the Leaflet attribution and control CSS in Dark.
- **The Overview "Awaiting a decision" card** states that it reflects the first page of trips. It and
  `notifications?limit=5` are the only new Overview calls the network gate allows.

### 16.3 Decisions adopted (CEO, per the owner's instruction to continue autonomously)

| # | Decision |
|---|---|
| 1 Photographs | **Resolved.** Ten Wikimedia Commons photographs were downloaded (CC BY 2.0, CC BY 4.0, CC BY-SA 2.0, CC BY-SA 4.0) and six are shipped, each checked on its file page. A visible credit appears on each photo and an image-credits entry lists them all. See `docs/REDESIGN_IMAGE_ATTRIBUTION.md`. |
| 2 Brand mark | The existing shield everywhere. Mountain line-art only as decoration. No "R" mark. |
| 3 Script taglines | Manager: an OFL script face from Google Fonts (already the manager's font source), decorative only. Driver: omitted (bundle size). |
| 4 Region scope | Segmented four-option control (North-East, State, District, My own console) **plus** the reference's State/District dropdowns. |
| 5 Driver tabs | Four tabs (Trip, Navigate, Safety, More) in the driver_04 floating forest bar with an active pill. No centre disc, because a disc cannot centre in four tabs. No new Home screen. |
| 6 Overview lower slot | "Awaiting a decision" trips card, honestly labelled. |
| 7 KPIs | Four cards as §4, with the §16.1 corrections. |
| 8 Notification badge | Only from an existing cached call; never hard-coded; an error never shows 0. |
| 9 First-use theme | Manager Light. Driver unchanged (web follows the system, native Light). The explicit choice persists. |
| 10 Pre-login toggle | None. Region and login follow the stored choice. |
| 11 Heading case | Title Case on the hero headings. |
| 12 Disabled primary CTA | Forest at about 50% opacity with `aria-disabled`. The logic is unchanged. |
| 13 Route colour | Blue (`route` token), not green. |
| 14 Basemap | OSM raster with dark paint in Dark. No new tile provider. |
| 15 Driver login trust row | Kept as decorative statements, with no numbers. |
| 16 Region map | Static (no click-to-select). |
| 17 Login footer | "SIH26002 · MDoNER" kept small. |
| 18 Driver font | System font. |
| 19 Assignments in the sidebar | **Not added.** This keeps the documented decision (`App.tsx:42-43`). |
