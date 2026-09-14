#!/usr/bin/env bash
# Render every variant pptx here to PDF + a 6-up contact sheet PNG.
#   bash docs/submission/variants/render.sh [FILE.pptx ...]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
fc-match Calibri 2>/dev/null | grep -qi carlito || echo "WARNING: Carlito missing - text will overflow"
mkdir -p "$HERE/preview"
FILES=("$@"); [ ${#FILES[@]} -eq 0 ] && FILES=("$HERE"/*.pptx)
for f in "${FILES[@]}"; do
  b="$(basename "$f" .pptx)"
  soffice -env:UserInstallation="file://$WORK/lo" --headless --norestore \
          --convert-to pdf --outdir "$HERE" "$f" >/dev/null
  pdftoppm -png -r 150 "$HERE/$b.pdf" "$WORK/$b"
  python3 - "$WORK" "$b" "$HERE/preview/$b.png" <<'PY'
import sys, glob
from PIL import Image
work, base, out = sys.argv[1], sys.argv[2], sys.argv[3]
ims = [Image.open(p).convert("RGB") for p in sorted(glob.glob(f"{work}/{base}-*.png"))]
w, h = ims[0].size
sc = 620 / w
tw, th = int(w * sc), int(h * sc)
pad, cols = 16, 2
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols*tw + pad*(cols+1), rows*th + pad*(rows+1)), "white")
for i, im in enumerate(ims):
    c, r = i % cols, i // cols
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (pad + c*(tw+pad), pad + r*(th+pad)))
sheet.save(out, optimize=True)
print(f"{base}: {len(ims)} pages")
PY
done
