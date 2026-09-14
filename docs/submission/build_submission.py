"""Build the deck that gets submitted.

    python3 docs/submission/build_submission.py
    -> docs/submission/RASTA_AI_SIH26002_TEAM17_FINAL.pptx

The submission is the MASTER design in docs/submission/variants/v_master.py:
the merge of the ten explored designs, laid out against the twelve mistakes SIH
judges call out. The other nine remain in variants/ for comparison, and
build_final_deck.py still builds the earlier "house" design as V01.
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "variants"))

import deckkit as K  # noqa: E402
import v_master  # noqa: E402

OUT = HERE / "RASTA_AI_SIH26002_TEAM17_FINAL.pptx"


def main() -> int:
    prs = K.new_deck()
    shots = K.shots()
    for slide, build in zip(list(prs.slides), v_master.SLIDES):
        build(slide, v_master.THEME, shots)
    K.finish(prs, OUT)
    print("wrote", OUT.name, "slides:", len(prs.slides))
    return 0


if __name__ == "__main__":
    sys.exit(main())
