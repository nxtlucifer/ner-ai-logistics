# SIH 2026 submission package — RASTA AI (SIH26002, Team 17)

| Path | What it is |
| --- | --- |
| `RASTA_AI_SIH26002_TEAM17_FINAL.pdf` | **The submission file.** 6 pages. The portal accepts PDF only |
| `RASTA_AI_SIH26002_TEAM17_FINAL.pptx` | The editable deck, built on the official template |
| `RASTA_AI_SIH26002_TEAM17_PREVIEW.png` | All six slides on one sheet, for a glance check |
| `slides/Slide1..6.PNG` | Each page at 150 dpi, for inspecting a slide at projector size |
| `build_submission.py` | Builds the submission pptx (the MASTER design in `variants/v_master.py`) |
| `build_final_deck.py` | Builds the earlier "house" design, kept as `variants/…_V01_HOUSE.pptx` |
| `render_final_deck.sh` | Build + render on Linux (LibreOffice). The path used to produce the files above |
| `render_final_deck.ps1` | Build + render on Windows (PowerPoint COM). Kept for machines that have it |
| `template.pptx` | The supplied SIH2026 format, unmodified |
| `screenshots/` | The real screens the deck embeds, with `README.md` indexing each one |
| `evidence/` | Browser-capture evidence for the demo scenarios |
| `existing.pptx`, `NER_AI_Logistics_SIH2026.*` | Superseded earlier decks, kept so the edits stay reviewable |

Both outputs are rebuilt from `template.pptx` by the scripts, so the deck is
reproducible rather than hand-patched. Every fact on a slide comes from
`docs/PPT_SOURCE_OF_TRUTH.md`; every picture is a real screen from
`screenshots/`.

## Built against the twelve mistakes judges call out

| # | Mistake | Where it is answered |
| --- | --- | --- |
| 1 | Too much text | Key points and figures, ~1,100 words across six slides |
| 2 | Unclear problem | Slide 2 opens with the corridor and four hard numbers |
| 3 | Generic solution | Slide 2 carries an explicit USP block, four falsifiable claims |
| 4 | No workflow | Slide 3 is one INPUT → PROCESS → OUTPUT flow |
| 5 | Ignoring feasibility | Slide 4 answers technology, implementation, **cost** and scalability, plus risks → mitigations |
| 6 | Weak USP | Same block as 3, labelled USP |
| 7 | No evidence | Real figures on every slide; real screens throughout |
| 8 | Too many technologies | Seven named. No logo wall |
| 9 | Poor visual design | One palette (navy / amber / green), one type scale, one panel style |
| 10 | Not following template | The supplied template, six slides, the six required categories |
| 11 | Missing PS number | `SIH26002` set large on slide 1, repeated on slide 6 |
| 12 | No clear impact | Slide 5 names who gains what, with figures |

## The six slides

The template's own instruction slide requires **six slides including the title**
and **PDF upload**. Both hold. The required categories are kept in order:

1. **Title page** — RASTA AI, SIH26002, theme, category, team, and the line the
   slide exists to leave behind: *shortest is not always usable.*
2. **Idea / proposed solution** — a normal router beside RASTA, and `UNKNOWN ≠ SAFE`.
3. **Technical approach** — the operating loop, not a logo wall; who decides, and
   that neither the LLM nor the experimental model decides.
4. **Feasibility and viability** — three real screens and the physical lifecycle.
5. **Impact and benefits** — who gains what, stated without invented percentages.
6. **Research and references** — sources in about two thirds, the experimental
   model in the remaining third.

Slide 6 states the experimental landslide model the way the repository does:
**95 % recall** on the NER geographic holdout, **not deployed**, because the
**50 % false-positive rate** is too high for production. Recall is the large
number, the safety gate is the dominant block, and the false-positive rate is
smaller but plainly visible and unaltered — a judge should read a team that
validated a model and refused to ship it, not a project that is 50 % accurate.

## Rebuilding

```bash
bash docs/submission/render_final_deck.sh
```

Needs `libreoffice-impress`, `poppler-utils`, `python-pptx`, `Pillow`, and
**`fonts-crosextra-carlito`**. Carlito supplies Calibri's metrics; without it
every text box renders about 8 % wide and the slides overflow. The script warns
if it is missing.

On Windows with PowerPoint, `render_final_deck.ps1` does the same job through
COM (`SaveAs(..., 32)` for PDF, `SaveAs(..., 18)` for slide PNGs).

`build_final_deck.py` finds the template at `SIH_TEMPLATE`, else
`D:\SIH2026 PPT Format.pptx`, else the `template.pptx` beside it.
`TRUCK_WEB=1` tells it `06-truck-verification.png` is the 824×1830 driver web
build rather than a 1264×2780 phone capture, so it is not phone-cropped —
`render_final_deck.sh` sets it.

## Before submitting

`Team ID` prints **17 (internal group no.)**. If the portal issues a separate
registered team ID, that is the value the portal expects there; it is not
derivable from this repository and must not be substituted with the
problem-statement ID. Nothing else is a placeholder — checked programmatically
across all six slides.

Confirm against the current college/SPOC notice before upload: PS **SIH26002**,
title *AI-Based Smart Logistics and Accessibility Intelligence Platform for
North Eastern Region (NER)*, theme **Smart Automation**, category **Software**.

## Demo evidence

`evidence/README.md` indexes the browser capture. Positions there are
**simulated GPS through a dedicated Chrome test context** with geolocation
granted normally to the driver-app origin — the app's own watcher, uploader,
backend ingestion and trip poll all ran unmodified. It is not a physical device
and no native claim rests on it. The physical-phone claims on slide 4 rest on
the APK 1.0.18 certification runs recorded in `docs/terrain/HANDOFF.md`.
