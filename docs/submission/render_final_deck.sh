#!/usr/bin/env bash
# Build + render the final SIH deck on Linux (LibreOffice Impress).
#
#   bash docs/submission/render_final_deck.sh
#
# Produces, next to the source:
#   RASTA_AI_SIH26002_TEAM17_FINAL.pptx   (built by build_final_deck.py)
#   RASTA_AI_SIH26002_TEAM17_FINAL.pdf    (the submission file)
#   RASTA_AI_SIH26002_TEAM17_PREVIEW.png  (six pages on one sheet)
#   slides/Slide1..6.PNG                  (per-slide, for inspection)
#
# Requires: libreoffice-impress, poppler-utils, python-pptx, Pillow, and
# fonts-crosextra-carlito (Calibri metrics — WITHOUT it every text box on the
# deck renders ~8 % wide and overflows).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

BASE="RASTA_AI_SIH26002_TEAM17_FINAL"

fc-match Calibri 2>/dev/null | grep -qi carlito || echo "WARNING: Carlito missing — text will overflow (apt-get install fonts-crosextra-carlito)"

# The submission deck is the MASTER design (docs/submission/variants/v_master.py).
# TRUCK_WEB tells the older house build that 06-truck-verification.png is the
# 824x1830 driver web build, not a 1264x2780 phone capture.
TEMP="$WORK" TRUCK_WEB=1 python3 "$HERE/build_submission.py"

soffice -env:UserInstallation="file://$WORK/lo" --headless --norestore \
        --convert-to pdf --outdir "$HERE" "$HERE/$BASE.pptx" >/dev/null

mkdir -p "$HERE/slides"
pdftoppm -png -r 150 "$HERE/$BASE.pdf" "$WORK/slide"
i=1
for f in "$WORK"/slide-*.png; do
  cp "$f" "$HERE/slides/Slide${i}.PNG"
  i=$((i + 1))
done

python3 - "$HERE" <<'PY'
import sys
from pathlib import Path
from PIL import Image

out = Path(sys.argv[1])
shots = [Image.open(out / "slides" / f"Slide{i}.PNG").convert("RGB") for i in range(1, 7)]
w, h = shots[0].size
scale = 640 / w
tw, th = int(w * scale), int(h * scale)
pad, cols = 18, 2
rows = (len(shots) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw + pad * (cols + 1), rows * th + pad * (rows + 1)), "white")
for i, im in enumerate(shots):
    c, r = i % cols, i // cols
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (pad + c * (tw + pad), pad + r * (th + pad)))
sheet.save(out / "RASTA_AI_SIH26002_TEAM17_PREVIEW.png", optimize=True)
print("preview", sheet.size)
PY

python3 - "$HERE/$BASE.pdf" <<'PY'
import sys, re
data = open(sys.argv[1], "rb").read()
print("PDF pages:", len(re.findall(rb"/Type\s*/Page[^s]", data)))
PY

echo "OK  $HERE/$BASE.pdf"
