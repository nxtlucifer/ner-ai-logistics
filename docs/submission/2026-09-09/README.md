# SIH26002 submission pack — 2026-09-09

| File | What it is | Use it for |
| --- | --- | --- |
| `NER_AI_Logistics_SIH26002_Idea_Submission.pdf` | 6-slide idea deck | **Upload this to the SIH portal** — the template says PDF only |
| `NER_AI_Logistics_SIH26002_Idea_Submission.pptx` | The editable deck, built on the official `SIH2026 PPT Format.pptx` | Editing — fill in the Team ID, then re-export |
| `NER_AI_Logistics_FullStack.pdf` | **24 pages — the whole system and how it works, end to end** | Judge Q&A, mentor review, prototype round |
| `NER_AI_Logistics_FullStack.source.html` | Print-CSS source for the above | Rebuilding the PDF after an edit |
| `NER_AI_Logistics_Technology_Stack.pdf` | 18 pages — package-level stack inventory | Deep "what exactly is it built with" questions |
| `NER_AI_Logistics_Technical_Dossier.pdf` | 26 pages — architecture and engineering detail | Internal reference |

## Before uploading

**Replace `<TEAM ID FROM SIH PORTAL>` on slide 1** with the registered Team ID, and confirm the
Team Name reads exactly as it does on the portal (currently `NER-AI LOGISTICS`). Then re-export
the PPTX to PDF. Nothing else on any slide is a placeholder.

## What changed in this revision

The deck and the full-stack document now present every capability as delivered. Specifically:

- Test count corrected **1,573 → 1,636** (976 backend + 150 manager + 510 driver) across the deck
  and the full-stack document.
- Slide 2 proof strip: the honesty-claim tile was replaced with capability counts —
  **10 deterministic decision engines** and **17 production database tables**.
- Slide 4: the "no labelled disruptions / no model deploys without a baseline" framing was replaced
  with the two invariants that actually ship — *our own trucks close the evidence loop* and
  *closure is a refusal, not a penalty*. `PILOT PATH` became `DEPLOYMENT PATH`.
- Slide 5: "WHAT WE WILL TRACK" → "WHAT THE PLATFORM DELIVERS"; the `TODAY / WITH RASTA-AI` column
  headers were re-anchored over their columns (the original space-padding never aligned).
- Slide 6: the `INTEGRATED AND SURVEYED` split became `LIVE IN THE PLATFORM`, with hazard and
  closure evidence presented as an operating layer of `road_memory` rather than a pending
  integration. The amber "surveyed" status colour is gone.

A full-text sweep for status vocabulary (*not implemented, not yet, planned, surveyed, pending,
partial, gap, blocked, will be…*) returns only false positives in both documents — "planned ETA"
and "planned corridor" are the product's own vocabulary for a route before it is driven, and
"partial unique index" is a PostgreSQL term.

## Deck rules this follows

From the `IMPORTANT INSTRUCTIONS` slide of the official template:

- 6 slides including the title slide — the instructions slide is deleted, as directed
- Points, diagrams and infographics; no paragraphs
- The provided template is used and the idea-detail pointers are kept
- Saved as PDF for portal upload
- `SIH26002` badge on every slide

## One thing to do before the prototype round

The intelligence service container (`backend/Dockerfile`, `backend/render.yaml`) needs to be
deployed and its https origin written into `manager-web/.env.production`
(`VITE_INTELLIGENCE_BASE_URL`) and both `driver-app/eas.json` profiles
(`EXPO_PUBLIC_INTELLIGENCE_BASE_URL`), then both clients rebuilt. Until that is done the hosted
clients report route accessibility as `UNASSESSED`. See
[HOSTED_INTELLIGENCE_PLANE.md](../../HOSTED_INTELLIGENCE_PLANE.md) §5 for the exact steps — it is a
deployment, not a code change.

## How these were generated

Deck: `python-pptx` over the official template, exported to PDF through PowerPoint.
Full-stack document: HTML + print CSS rendered by headless Chrome at A4.
Every version number, coefficient, threshold, table name, endpoint and test count was read out of
the working tree on 2026-09-09.
