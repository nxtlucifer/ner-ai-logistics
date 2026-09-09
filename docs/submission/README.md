# SIH 2026 submission package

**PPT submission 10 September** (earlier date of the 10–11 window). **Package
freeze target 9 September.** All dates Asia/Kolkata.

| Path | What it is |
| --- | --- |
| `NER_AI_Logistics_SIH2026.pptx` | The editable deck. Submit-ready except the one field below |
| `NER_AI_Logistics_SIH2026.pdf` | 6 pages. **The portal accepts PDF only** |
| `slides/Slide1..6.PNG` | Every page rendered, for inspection |
| `evidence/` | Screenshots from the browser capture, with `README.md` indexing which scenario each one establishes |
| `template.pptx` | The supplied SIH2026 format, unmodified |
| `existing.pptx` | The previous deck this was derived from, kept so the edits stay reviewable |

Both outputs are rebuilt from `existing.pptx` by the scripts below, so the deck
is reproducible rather than hand-patched.

## Before submitting — one field only

**`Team ID -` on slide 1 still reads `[REGISTERED TEAM ID]`.** It is the team's
portal registration ID; it is not derivable from anything in this repository and
must not be substituted with the problem-statement ID. Nothing else is a
placeholder — checked programmatically across all six slides.

Confirm against the current college/SPOC notice before upload:

- PS **SIH26002**, title *AI-Based Smart Logistics and Accessibility Intelligence
  Platform for North Eastern Region (NER)*, theme **Smart Automation**, category
  **Software**. Carried over from the previous deck; not re-verified against the
  portal in this session.
- The template's own instruction slide requires **six slides maximum including
  the title** and **PDF upload**. Both hold: 6 slides, 6 PDF pages.

## What changed

Content:

- **Turn-by-turn navigation** and **reviewer-authorised selection** added to the
  capability chips. Both work and neither appeared on the deck.
- OSRM box now reads "Routes, alternatives + turn steps" — the steps are what the
  navigation package is built from.
- Persistence stated precisely: *PostgreSQL + PostGIS (Supabase target; demo on
  isolated local cluster)*. Supabase is the intended production database; every
  demonstration runs on the isolated cluster, and a judge asking what it runs on
  should not be told otherwise.

Rendered defects, all found by exporting the slides and looking at them:

- The logo oval was too narrow for its own word on every slide — "NER-AI
  LOGISTI / CS".
- Card headings printed **on top of** their icons on slides 2 and 4; the title
  card's text ran under the three circular icons on slide 1.
- The capability chip row ended at x=962 on a 960-wide slide, clipping the last
  chip.
- "Routing + Recommendatio / n" wrapped inside an 86px box.
- "ENVIRONMENTA / L" wrapped in its badge on slide 5.

## Rebuilding

PowerPoint COM does the work. LibreOffice is not installed here and the pptx
skill's `soffice` wrapper assumes a Unix socket, so it cannot run on this
machine; `SaveAs(..., 32)` exports PDF and `SaveAs(..., 18)` exports slide PNGs.

Scripts are in the session scratchpad: `fix_deck.ps1`, then `fix_deck2.ps1`,
then the targeted slide-4 and slide-5 passes. **Run them in order from the
pristine `existing.pptx`** — they are not idempotent. A general
overlap-detection pass was tried and abandoned because re-running it
double-shifted slide 6's reference list.

## Demo evidence

`evidence/README.md` indexes the capture. Positions are **simulated GPS through
a dedicated Chrome test context** with geolocation granted normally to the
driver-app origin — the app's own watcher, uploader, backend ingestion and trip
poll all ran unmodified. It is not a physical device and no native claim rests
on it.

Still outstanding: the ~3-minute backup recording. The screenshots cover all
nine required scenarios; the recording is a separate capture pass.
