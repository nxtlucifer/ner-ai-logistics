"""Build the RASTA AI deck variants (SIH26002, Team 17).

    python3 docs/submission/variants/build_variants.py [slug ...]

Each variant is a different design of the same submission: six slides, the six
required categories, on the supplied SIH2026 template, stating only facts from
docs/PPT_SOURCE_OF_TRUTH.md. V01 is the house deck built by
docs/submission/build_final_deck.py and is copied in, not rebuilt here.
"""
from __future__ import annotations

import importlib
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import deckkit as K  # noqa: E402

MODULES = [
    "v_master", "v_editorial", "v_console", "v_ledger", "v_corridor", "v_signal",
    "v_split", "v_lifecycle", "v_blueprint", "v_statement",
]
HOUSE = K.ROOT / "docs" / "submission" / "RASTA_AI_SIH26002_TEAM17_FINAL.pptx"
OUTDIR = Path(__file__).resolve().parent


def build(mod_name: str) -> Path:
    mod = importlib.import_module(mod_name)
    t = mod.THEME
    prs = K.new_deck()
    shots = K.shots()
    slides = list(prs.slides)
    for i, fn in enumerate(mod.SLIDES):
        fn(slides[i], t, shots)
    out = OUTDIR / f"RASTA_AI_SIH26002_TEAM17_{t.slug}.pptx"
    K.finish(prs, out)
    return out


def main(argv):
    wanted = argv or MODULES
    made = []
    if not argv or "V01" in argv:
        dst = OUTDIR / "RASTA_AI_SIH26002_TEAM17_V01_HOUSE.pptx"
        if HOUSE.exists():
            shutil.copy2(HOUSE, dst)
            made.append(dst)
    for name in MODULES:
        if argv and name not in wanted:
            continue
        try:
            made.append(build(name))
        except Exception as exc:  # keep going so one bad variant does not block the rest
            print(f"  !! {name}: {type(exc).__name__}: {exc}")
    for p in made:
        print("wrote", p.name)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
