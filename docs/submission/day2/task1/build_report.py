"""Build the Day 2 Task 1 report (Backend Finalization, API & Database Integration)
as a designed Word document and a PDF rendered by Word.

    python docs/submission/day2/task1/build_report.py

Derived from docs/submission/day1/task3/build_report.py: same Markdown parser and
layout engine, navy/teal palette, "---" in the Markdown = page break.

Reuses the Markdown parser from ../build_docs.py; the layout here is its own:
a dark cover band, Georgia headings with a rule, tables with a filled header
row and horizontal rules only, shaded callouts, captioned figures, and an
editable table flowchart. Nothing is an image except the screenshots.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "day1"))
sys.argv = [sys.argv[0]]  # build_docs reads argv at import; give it nothing
import build_docs as bd  # noqa: E402

MD = HERE / "RASTA_AI_DAY2_TASK1_BACKEND_API_DATABASE_FINAL.md"
OUT = HERE / "RASTA_AI_DAY2_TASK1_BACKEND_API_DATABASE_FINAL.docx"
DATE = "19 September 2026"
TEAM = "NER-AI LOGISTICS  ·  Team 17"

from docx import Document  # noqa: E402
from docx.enum.section import WD_SECTION  # noqa: E402
from docx.enum.table import WD_TABLE_ALIGNMENT  # noqa: E402
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK  # noqa: E402
from docx.oxml import OxmlElement  # noqa: E402
from docx.oxml.ns import qn  # noqa: E402
from docx.shared import Cm, Pt, RGBColor  # noqa: E402
from PIL import Image as PILImage  # noqa: E402

INK = RGBColor(0x10, 0x18, 0x20)
GREEN = RGBColor(0x0F, 0x5F, 0x6B)   # teal accent (name kept for the shared helpers)
DEEP = "123B4F"                       # navy fills
MUTED = RGBColor(0x5B, 0x67, 0x70)
RULE = "C9D3D8"
FILL = "F3F6F8"
BAND = "0F2233"
MINT = RGBColor(0x5F, 0xD0, 0xD8)
BODY_FONT = "Calibri"
HEAD_FONT = "Georgia"
CODE_FONT = "Consolas"
CONTENT_CM = 16.6


def shade(el, fill: str) -> None:
    pr = el.get_or_add_tcPr() if el.tag.endswith("}tc") else el.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), fill)
    pr.append(shd)


def borders(el, spec: dict[str, tuple[str, str, str]]) -> None:
    """spec: side -> (val, size in eighths of a point, colour)."""
    is_cell = el.tag.endswith("}tc")
    pr = el.get_or_add_tcPr() if is_cell else el.get_or_add_pPr()
    tag = "w:tcBorders" if is_cell else "w:pBdr"
    b = OxmlElement(tag)
    for side, (val, sz, color) in spec.items():
        e = OxmlElement(f"w:{side}")
        e.set(qn("w:val"), val)
        e.set(qn("w:sz"), sz)
        e.set(qn("w:space"), "4" if not is_cell else "0")
        e.set(qn("w:color"), color)
        b.append(e)
    pr.append(b)


def table_borders(tbl, inside_h: bool = True) -> None:
    tblPr = tbl._tbl.tblPr
    b = OxmlElement("w:tblBorders")
    for side, val in (("top", "single"), ("bottom", "single"), ("left", "nil"), ("right", "nil"),
                      ("insideH", "single" if inside_h else "nil"), ("insideV", "nil")):
        e = OxmlElement(f"w:{side}")
        e.set(qn("w:val"), val)
        e.set(qn("w:sz"), "6")
        e.set(qn("w:color"), RULE)
        b.append(e)
    tblPr.append(b)


def cell_margins(tbl, top=40, bottom=40, left=80, right=80) -> None:
    tblPr = tbl._tbl.tblPr
    m = OxmlElement("w:tblCellMar")
    for side, val in (("top", top), ("bottom", bottom), ("left", left), ("right", right)):
        e = OxmlElement(f"w:{side}")
        e.set(qn("w:w"), str(val))
        e.set(qn("w:type"), "dxa")
        m.append(e)
    tblPr.append(m)


def run_font(r, name: str, size: float | None = None, color: RGBColor | None = None, bold=None, italic=None) -> None:
    r.font.name = name
    r._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), name)
    if size:
        r.font.size = Pt(size)
    if color is not None:
        r.font.color.rgb = color
    if bold is not None:
        r.bold = bold
    if italic is not None:
        r.italic = italic


def add_runs(par, text: str, size: float | None = None, color: RGBColor | None = None) -> None:
    for style, chunk in bd.inline_runs(text):
        r = par.add_run(chunk)
        if style == "code":
            run_font(r, CODE_FONT, (size or 10.5) - 1.0, color)
        else:
            run_font(r, BODY_FONT, size, color, bold=(style == "bold") or None, italic=(style == "italic") or None)


def field(par, instr: str, size: float = 8) -> None:
    for tag, text in (("begin", None), (None, instr), ("separate", None), (None, None), ("end", None)):
        r = par.add_run()
        run_font(r, BODY_FONT, size, MUTED)
        if tag:
            fc = OxmlElement("w:fldChar")
            fc.set(qn("w:fldCharType"), tag)
            r._r.append(fc)
        elif text:
            it = OxmlElement("w:instrText")
            it.set(qn("xml:space"), "preserve")
            it.text = text
            r._r.append(it)


def build() -> None:
    md = MD.read_text(encoding="utf8").replace("\r\n", "\n")
    blocks = bd.parse(md)
    front, body = bd.split_front_matter(blocks)
    title = next((b.text for b in front if b.kind == "heading" and b.level == 1), "RASTA AI")
    sub = next((b.text for b in front if b.kind == "heading" and b.level == 2), "")
    sub2 = next((b.text for b in front if b.kind == "heading" and b.level == 3), "")
    meta = next((b for b in front if b.kind == "table"), None)
    note = next((b for b in front if b.kind == "quote"), None)

    doc = Document()
    st = doc.styles
    st["Normal"].font.name = BODY_FONT
    st["Normal"].font.size = Pt(10)
    st["Normal"].font.color.rgb = INK
    st["Normal"].paragraph_format.space_after = Pt(6)
    st["Normal"].paragraph_format.line_spacing = 1.1
    for name in ("List Bullet", "List Number"):
        st[name].font.name = BODY_FONT
        st[name].font.size = Pt(10.5)
        st[name].paragraph_format.space_after = Pt(3)
    for name, size, color in (("Heading 1", 17, GREEN), ("Heading 2", 12.5, INK), ("Heading 3", 11, INK)):
        s = st[name]
        s.font.name = HEAD_FONT
        s.font.size = Pt(size)
        s.font.color.rgb = color
        s.font.bold = True
        s.paragraph_format.keep_with_next = True
        s.paragraph_format.space_before = Pt(18 if name == "Heading 1" else 12)
        s.paragraph_format.space_after = Pt(6 if name == "Heading 1" else 3)
        s.element.rPr.rFonts.set(qn("w:eastAsia"), HEAD_FONT)

    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(2.2)
    sec.top_margin, sec.bottom_margin = Cm(2.0), Cm(2.0)
    sec.different_first_page_header_footer = True

    # ---- header / footer (not on the cover)
    hp = sec.header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = hp.add_run(f"{title} · {sub.replace('—', '·')} · {sub2} · {TEAM.replace('  ·  ', ' · ')}")
    run_font(r, BODY_FONT, 8, MUTED)
    fp = sec.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    borders(fp._p, {"top": ("single", "4", RULE)})
    r = fp.add_run("Page ")
    run_font(r, BODY_FONT, 8, MUTED)
    field(fp, "PAGE")

    # ---- cover
    band = doc.add_table(rows=1, cols=1)
    band.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = band.rows[0].cells[0]
    cell.width = Cm(CONTENT_CM)
    shade(cell._tc, BAND)
    cell_margins(band, 600, 600, 560, 560)
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(60)
    r = p.add_run("SMART INDIA HACKATHON 2026  ·  PROBLEM STATEMENT SIH26002")
    run_font(r, BODY_FONT, 9, MINT, bold=True)
    p = cell.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    r = p.add_run(title)
    run_font(r, HEAD_FONT, 40, RGBColor(0xF5, 0xF8, 0xF6), bold=True)
    p = cell.add_paragraph()
    r = p.add_run(sub)
    run_font(r, HEAD_FONT, 18, RGBColor(0xE2, 0xEA, 0xE5))
    p = cell.add_paragraph()
    p.paragraph_format.space_before = Pt(4)
    r = p.add_run(sub2)
    run_font(r, HEAD_FONT, 14, RGBColor(0xC7, 0xD4, 0xDC))
    p = cell.add_paragraph()
    p.paragraph_format.space_before = Pt(30)
    p.paragraph_format.space_after = Pt(60)
    r = p.add_run(f"{TEAM}  ·  {DATE}")
    run_font(r, BODY_FONT, 10, RGBColor(0xB4, 0xC2, 0xBA))

    doc.add_paragraph().paragraph_format.space_after = Pt(10)
    if meta:
        t = doc.add_table(rows=0, cols=2)
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        table_borders(t, inside_h=True)
        cell_margins(t, 70, 70, 60, 60)
        for row in meta.rows:
            if not any(row):
                continue
            cells = t.add_row().cells
            cells[0].width, cells[1].width = Cm(4.2), Cm(CONTENT_CM - 4.2)
            pr = cells[0].paragraphs[0]
            rr = pr.add_run(row[0])
            run_font(rr, BODY_FONT, 9, MUTED, bold=True)
            add_runs(cells[1].paragraphs[0], row[1] if len(row) > 1 else "", 9.5)
    if note:
        callout(doc, note.text)
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    # ---- no separate contents page: nine numbered sections keep the report at twelve pages.

    # ---- body: two portrait screenshots in a row sit side by side
    def portrait(b) -> bool:
        if b.kind != "image" or not b.lang:
            return False
        iw, ih = PILImage.open(MD.parent / b.lang).size
        return iw / ih < 0.8
    merged = []
    i = 0
    while i < len(body):
        b = body[i]
        if portrait(b) and i + 1 < len(body) and portrait(body[i + 1]):
            merged.append(bd.Block("imagepair", items=[b.lang, body[i + 1].lang], rows=[[b.text, body[i + 1].text]]))
            i += 2
        else:
            merged.append(b)
            i += 1
    body = merged
    fig = 0
    for b in body:
        if b.kind == "heading":
            style = {2: "Heading 1", 3: "Heading 2", 4: "Heading 3"}.get(b.level, "Heading 3")
            if b.text.startswith("Appendix A"):
                start_landscape(doc)
            hp = doc.add_paragraph(style=style)
            hp.add_run(b.text)
            for rr in hp.runs:
                run_font(rr, HEAD_FONT)
            if style == "Heading 1":
                rule_under(hp)
        elif b.kind == "para":
            add_runs(doc.add_paragraph(), b.text)
        elif b.kind == "quote":
            callout(doc, b.text)
        elif b.kind == "bullets":
            for it in b.items:
                add_runs(doc.add_paragraph(style="List Bullet"), it)
        elif b.kind == "numbers":
            for it in b.items:
                add_runs(doc.add_paragraph(style="List Number"), it)
        elif b.kind == "code":
            code_block(doc, b.text)
        elif b.kind == "table":
            data_table(doc, b.rows)
        elif b.kind == "flow":
            flow_chart(doc, b.items)
        elif b.kind == "image":
            fig += 1
            figure(doc, b)
        elif b.kind == "imagepair":
            figure_pair(doc, b)
        elif b.kind == "rule":
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    doc.save(OUT)
    print("docx:", OUT.name, OUT.stat().st_size // 1024, "KB")


def rule_under(par) -> None:
    borders(par._p, {"bottom": ("single", "8", DEEP)})


def callout(doc, text: str) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.35)
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(10)
    p.paragraph_format.keep_together = True
    shade(p._p, FILL)
    borders(p._p, {"left": ("single", "24", DEEP)})
    add_runs(p, text, 10, INK)


def code_block(doc, text: str) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.keep_together = True
    p.paragraph_format.left_indent = Cm(0.2)
    shade(p._p, FILL)
    borders(p._p, {s: ("single", "4", RULE) for s in ("top", "bottom", "left", "right")})
    lines = text.split("\n")
    longest = max((len(l) for l in lines), default=40)
    size = 8.5 if longest <= 80 else 7.5 if longest <= 100 else 6.8
    for n, l in enumerate(lines):
        r = p.add_run(l)
        run_font(r, CODE_FONT, size, INK)
        if n < len(lines) - 1:
            r.add_break()


def data_table(doc, rows: list[list[str]]) -> None:
    cols = len(rows[0])
    tbl = doc.add_table(rows=0, cols=cols)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl.autofit = False
    table_borders(tbl)
    cell_margins(tbl, 50, 50, 70, 70)
    size = 9.5 if cols <= 2 else 9 if cols <= 4 else 8 if cols <= 5 else 7
    longest = [max((len(r[c]) if c < len(r) else 0) for r in rows) for c in range(cols)]
    weights = [max(6, min(l, 60)) for l in longest]
    # A column is never narrower than its longest unbreakable token (a path, a
    # permission string), so code never wraps mid-word; the rest is shared by weight.
    per_char = {9.5: 0.19, 9: 0.18, 8: 0.16, 7: 0.14}[size]
    token = [max((len(t) for r in rows if c < len(r) for t in r[c].replace("`", "").split()), default=1) for c in range(cols)]
    floors = [max(1.5, min(5.2, per_char * t + 0.5)) for t in token]
    if sum(floors) > CONTENT_CM:  # never wider than the text block
        floors = [f * CONTENT_CM / sum(floors) for f in floors]
    spare = max(0.0, CONTENT_CM - sum(floors))
    widths = [Cm(f + spare * w / sum(weights)) for f, w in zip(floors, weights)]
    for n, row in enumerate(rows):
        tr = tbl.add_row()
        if n == 0:  # repeat the header row when a table runs over a page
            tr._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))
        tr._tr.get_or_add_trPr().append(OxmlElement("w:cantSplit"))  # a row moves whole to the next page
        cells = tr.cells
        for c in range(cols):
            text = row[c] if c < len(row) else ""
            cells[c].width = widths[c]
            par = cells[c].paragraphs[0]
            par.paragraph_format.space_after = Pt(0)
            par.paragraph_format.line_spacing = 1.0
            if n == 0:
                shade(cells[c]._tc, DEEP)
                par.paragraph_format.keep_with_next = True  # never a header row alone at a page foot
                rr = par.add_run(text)
                run_font(rr, BODY_FONT, size, RGBColor(0xFF, 0xFF, 0xFF), bold=True)
            else:
                if n % 2 == 0:
                    shade(cells[c]._tc, FILL)
                # A one-row scoreboard (header + a single row of numbers) reads large.
                add_runs(par, text, 12.5 if len(rows) == 2 and cols >= 4 else size)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def flow_chart(doc, steps: list[str]) -> None:
    tbl = doc.add_table(rows=0, cols=1)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    for n, step in enumerate(steps):
        if n:
            ap = tbl.add_row().cells[0].paragraphs[0]
            ap.alignment = WD_ALIGN_PARAGRAPH.CENTER
            ap.paragraph_format.space_before = ap.paragraph_format.space_after = Pt(0)
            ar = ap.add_run("▼")
            run_font(ar, BODY_FONT, 9, GREEN)
        cell = tbl.add_row().cells[0]
        cell.width = Cm(15.0)
        borders(cell._tc, {s: ("single", "8", DEEP) for s in ("top", "left", "bottom", "right")})
        shade(cell._tc, FILL)
        par = cell.paragraphs[0]
        par.alignment = WD_ALIGN_PARAGRAPH.CENTER
        par.paragraph_format.space_after = Pt(0)
        label, _, rest = step.partition(" — ")
        r = par.add_run(label)
        run_font(r, BODY_FONT, 9.5, GREEN, bold=True)
        if rest:
            r.add_break()
            r2 = par.add_run(rest)
            run_font(r2, BODY_FONT, 8.5, INK)
    doc.add_paragraph()


def caption_runs(par, text: str, size: float = 9) -> None:
    m = re.match(r"^(Figure \d+)\s*[—-]\s*(.*)$", text)
    if m:
        r = par.add_run(m.group(1) + ".  ")
        run_font(r, BODY_FONT, size, GREEN, bold=True)
        add_runs(par, m.group(2), size, MUTED)
    else:
        add_runs(par, text, size, MUTED)


def portrait_width(png: Path) -> Cm:
    iw, ih = PILImage.open(png).size
    return Cm(5.6) if iw / ih < 0.6 else Cm(8.0)


def figure_pair(doc, b) -> None:
    """Two phone or tablet screenshots side by side, a caption under each."""
    tbl = doc.add_table(rows=1, cols=2)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell_margins(tbl, 40, 40, 80, 80)
    for c, (path, caption) in enumerate(zip(b.items, b.rows[0])):
        png = MD.parent / path
        cell = tbl.rows[0].cells[c]
        cell.width = Cm(CONTENT_CM / 2)
        par = cell.paragraphs[0]
        par.alignment = WD_ALIGN_PARAGRAPH.CENTER
        par.paragraph_format.space_after = Pt(2)
        par.add_run().add_picture(str(png), width=min(portrait_width(png), Cm(7.6)))
        cap = cell.add_paragraph()
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        caption_runs(cap, caption, 8.5)
    doc.add_paragraph().paragraph_format.space_after = Pt(6)


def start_landscape(doc) -> None:
    """The appendix page: landscape, so the ER diagram keeps legible labels."""
    from docx.enum.section import WD_ORIENT
    sec = doc.add_section(WD_SECTION.NEW_PAGE)
    sec.orientation = WD_ORIENT.LANDSCAPE
    sec.page_width, sec.page_height = Cm(29.7), Cm(21.0)
    sec.left_margin = sec.right_margin = Cm(2.0)
    sec.top_margin, sec.bottom_margin = Cm(1.6), Cm(1.6)
    sec.different_first_page_header_footer = False  # running header and page number stay on


def landscape_figure(doc, b, png: Path) -> None:
    """The ER diagram on the landscape appendix page (section already opened)."""
    avail_w, avail_h = 25.7, 21.0 - 3.2 - 3.6  # heading and caption take the rest
    iw, ih = PILImage.open(png).size
    w = min(avail_w, avail_h * iw / ih)
    pic = doc.add_paragraph()
    pic.alignment = WD_ALIGN_PARAGRAPH.CENTER
    pic.paragraph_format.space_before = Pt(0)
    pic.paragraph_format.space_after = Pt(4)
    pic.add_run().add_picture(str(png), width=Cm(w))
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    caption_runs(cap, b.text)


def figure(doc, b) -> None:
    png = MD.parent / b.lang
    if not png.exists():
        return
    if png.name == "ercore.png":
        landscape_figure(doc, b, png)
        return
    iw, ih = PILImage.open(png).size
    aspect = iw / ih
    if png.parent.name == "figures":
        # Diagrams get the full text width; screenshots stay a little narrower.
        pic = doc.add_paragraph()
        pic.alignment = WD_ALIGN_PARAGRAPH.CENTER
        pic.paragraph_format.keep_with_next = True
        pic.paragraph_format.space_before = Pt(4)
        pic.paragraph_format.space_after = Pt(2)
        pic.add_run().add_picture(str(png), width=Cm(min(CONTENT_CM, 14.5 * aspect)))
        cap = doc.add_paragraph()
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cap.paragraph_format.space_after = Pt(10)
        caption_runs(cap, b.text)
        return
    if aspect < 0.8:
        # A lone phone or tablet screenshot: picture on the left, caption beside it,
        # rather than a narrow image with a page of white space to its right.
        w = portrait_width(png)
        tbl = doc.add_table(rows=1, cols=2)
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        cell_margins(tbl, 40, 40, 80, 120)
        left, right = tbl.rows[0].cells
        left.width = w + Cm(0.6)
        right.width = Cm(CONTENT_CM) - left.width
        lp = left.paragraphs[0]
        lp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        lp.paragraph_format.space_after = Pt(0)
        lp.add_run().add_picture(str(png), width=w)
        right.vertical_alignment = 1  # centre
        rp = right.paragraphs[0]
        rp.paragraph_format.space_after = Pt(0)
        caption_runs(rp, b.text, 9.5)
        doc.add_paragraph().paragraph_format.space_after = Pt(6)
        return
    width = Cm(11.5 if aspect < 1.3 else 15.0)  # near-square shots narrower; desktop shots almost full width
    pic = doc.add_paragraph()
    pic.alignment = WD_ALIGN_PARAGRAPH.CENTER
    pic.paragraph_format.keep_with_next = True
    pic.paragraph_format.space_before = Pt(6)
    pic.paragraph_format.space_after = Pt(2)
    pic.add_run().add_picture(str(png), width=width)
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.paragraph_format.space_after = Pt(12)
    caption_runs(cap, b.text)


def export_pdf() -> None:
    try:
        import win32com.client
    except ImportError:
        print("pdf: skipped (pywin32 not installed)")
        return
    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    try:
        d = word.Documents.Open(str(OUT), ReadOnly=True)
        d.Fields.Update()
        pdf = OUT.with_suffix(".pdf")
        d.ExportAsFixedFormat(str(pdf), 17)
        print("pdf:", pdf.name, pdf.stat().st_size // 1024, "KB,", d.ComputeStatistics(2), "pages")
        d.Close(False)
    finally:
        word.Quit()


if __name__ == "__main__":
    build()
    export_pdf()
