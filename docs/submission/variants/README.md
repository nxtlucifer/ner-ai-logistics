# RASTA AI — ten designs of the same submission (SIH26002, Team 17)

Ten complete decks. Same problem statement, same six required categories, same
six slides, same official `template.pptx`, same verified facts. Only the design
changes — pick one, or take a slide from one into another.

Every fact on every deck comes from `docs/PPT_SOURCE_OF_TRUTH.md`. Every picture
is a real screen from `docs/submission/screenshots/`. No variant may invent a
number: the content lives in `FACTS` in `deckkit.py`, and the variants only lay
it out.

| # | Deck | The idea behind it |
| --- | --- | --- |
| V01 | `V01_HOUSE` | The house deck — bordered, titled panels filling every region, the convention the reference SIH decks use. Copied from `docs/submission/RASTA_AI_SIH26002_TEAM17_FINAL.pptx` |
| V02 | `V02_EDITORIAL` | Rules, not boxes. Hairlines and a strict left margin; one statement per slide |
| V03 | `V03_CONSOLE` | A white masthead over the driver app's own night field; the real screens become the light source |
| V04 | `V04_LEDGER` | The deck as an audit register: monospace keys in a fixed gutter, ruled rows, nothing asserted without a key |
| V05 | `V05_CORRIDOR` | The road is the layout. Every slide runs on a route spine with stations, the way a trip does |
| V06 | `V06_SIGNAL` | One number owns each slide — 11 factors, 60 s, 12/12, 0 unknown-as-safe, 95 % recall |
| V07 | `V07_SPLIT` | A hard vertical seam: the claim on a dark field, the screen that backs it on white |
| V08 | `V08_LIFECYCLE` | Three horizontal bands per slide, each with a named rail, read left to right |
| V09 | `V09_BLUEPRINT` | Drafted, not decorated: measured grid, corner ticks, monospace annotation |
| V10 | `V10_STATEMENT` | Poster typography. One sentence a judge can repeat, one picture, detail underneath |

Each deck is here as `.pptx` (editable) and `.pdf` (**the portal accepts PDF
only**), with all six slides on one sheet in `preview/`.

## Rules every deck is held to

`check.py` fails the build on any of these, and all ten pass:

- exactly six slides, the six required categories, on the supplied template
- no shape off the canvas, no non-wrapping text wider than its own box
- `SIH26002`, `NER-AI LOGISTICS`, Team ID `17`, `Smart Automation`, `Software` present
- `UNKNOWN`, `NOT DEPLOYED`, `95 %`, `FPR 50 %`, `Precision 0.32`, `F1 0.48` present
- none of the banned claims from `PPT_SOURCE_OF_TRUTH.md` ("98 %", "guaranteed
  safe", "live landslide detection", "Google-level traffic", …)

The experimental landslide model is stated the same way in all ten: **95 %
recall** large, **NOT DEPLOYED** dominant, **FPR 50 %** smaller but plainly
readable and unaltered, full metrics in the footer. A judge should read a team
that validated a model and refused to ship it.

## Building

```bash
python3 docs/submission/variants/build_variants.py     # all ten
python3 docs/submission/variants/build_variants.py v_ledger   # just one
bash    docs/submission/variants/render.sh             # PDFs + preview sheets
python3 docs/submission/variants/check.py              # the gate
```

Needs `libreoffice-impress`, `poppler-utils`, `python-pptx`, `Pillow`, and
**`fonts-crosextra-carlito`**. Variants use only Calibri, Arial, Times New Roman
and Courier New, the four faces with metric-compatible Linux substitutes, so a
deck looks the same in PowerPoint and in the exported PDF.

## Before submitting

Pick one deck and submit its PDF. `Team ID` prints **17 (internal group no.)**
in all ten; if the portal issued a separate registered team ID, that is the
value it expects there — it is not derivable from this repository and must not
be replaced with the problem-statement ID.
