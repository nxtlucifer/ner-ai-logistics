"""Build the final SIH 2026 deck on the official template (6 slides).

    python docs/submission/build_final_deck.py
    -> docs/submission/RASTA_AI_SIH26002_TEAM17_FINAL.pptx

Every fact on the slides comes from docs/PPT_SOURCE_OF_TRUTH.md; every picture
is a real screen from docs/submission/screenshots/. The template's own pointers
(title fields, section titles, team oval, SIH logo, footer) are kept; only its
instruction text boxes and the decorative brain picture are replaced.
Rendering (PDF, PNG) is done afterwards with PowerPoint (see render_final_deck.ps1).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from lxml import etree
from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = Path(os.environ.get("SIH_TEMPLATE", r"D:\SIH2026 PPT Format.pptx"))
SHOTS = ROOT / "docs" / "submission" / "screenshots"
OUT = ROOT / "docs" / "submission" / "RASTA_AI_SIH26002_TEAM17_FINAL.pptx"
CROPS = Path(os.environ.get("TEMP", ".")) / "sih" / "crops"
CROPS.mkdir(parents=True, exist_ok=True)

FONT = "Calibri"
INK = RGBColor(0x10, 0x18, 0x20)
BLUE = RGBColor(0x25, 0x63, 0xEB)
GREEN = RGBColor(0x05, 0x96, 0x69)
WARN = RGBColor(0xD9, 0x77, 0x06)
DANGER = RGBColor(0xDC, 0x26, 0x26)
GREY = RGBColor(0x6B, 0x72, 0x80)
MUTED = RGBColor(0x9C, 0xA3, 0xAF)
LINE = RGBColor(0xE5, 0xE7, 0xEB)
BG = RGBColor(0xF7, 0xF8, 0xFA)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)


# ---------------------------------------------------------------- helpers
def remove(shape):
    el = shape._element
    el.getparent().remove(el)


def no_shadow(shape):
    spPr = shape._element.spPr
    if spPr.find(qn("a:effectLst")) is None:
        etree.SubElement(spPr, qn("a:effectLst"))


def rect(slide, x, y, w, h, fill=None, line=None, rounded=False, line_w=0.75):
    kind = MSO_SHAPE.ROUNDED_RECTANGLE if rounded else MSO_SHAPE.RECTANGLE
    s = slide.shapes.add_shape(kind, Inches(x), Inches(y), Inches(w), Inches(h))
    if rounded:
        s.adjustments[0] = 0.12
    if fill is None:
        s.fill.background()
    else:
        s.fill.solid(); s.fill.fore_color.rgb = fill
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line; s.line.width = Pt(line_w)
    no_shadow(s)
    s.text_frame.text = ""
    return s


def text(slide, x, y, w, h, paras, size=14, color=INK, bold=False, align=PP_ALIGN.LEFT,
         anchor=MSO_ANCHOR.TOP, spacing=1.05, space_after=0, margin=0.02):
    """paras: list of paragraphs; a paragraph is a str or a list of (text, opts) runs.
    opts: bold, color, size, font."""
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Inches(margin)
    tf.margin_top = tf.margin_bottom = Inches(margin)
    first = True
    for para in paras:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.alignment = align
        p.line_spacing = spacing
        p.space_after = Pt(space_after)
        runs = [(para, {})] if isinstance(para, str) else para
        for t, o in runs:
            r = p.add_run(); r.text = t
            f = r.font
            f.name = o.get("font", FONT); f.size = Pt(o.get("size", size))
            f.bold = o.get("bold", bold); f.color.rgb = o.get("color", color)
            if o.get("italic"):
                f.italic = True
    return tb


def label(slide, x, y, w, t, color=GREY, size=10.5):
    return text(slide, x, y, w, 0.36, [[(t, {"bold": True, "color": color, "size": size})]])


def pill(slide, x, y, w, h, t, fill=INK, color=WHITE, size=10.5, line=None, bold=True):
    s = rect(slide, x, y, w, h, fill=fill, line=line, rounded=True)
    s.adjustments[0] = 0.5
    tf = s.text_frame
    tf.margin_left = tf.margin_right = Inches(0.06)
    tf.margin_top = tf.margin_bottom = Inches(0.0)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf.word_wrap = True
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = t
    r.font.name = FONT; r.font.size = Pt(size); r.font.bold = bold; r.font.color.rgb = color
    return s


def box(slide, x, y, w, h, title, sub=None, fill=WHITE, line=LINE, title_color=INK,
        sub_color=GREY, title_size=11, sub_size=9, accent=None):
    s = rect(slide, x, y, w, h, fill=fill, line=line, rounded=True)
    if accent is not None:
        rect(slide, x, y + 0.08, 0.06, h - 0.16, fill=accent)
    paras = [[(title, {"bold": True, "color": title_color, "size": title_size})]]
    if sub:
        paras.append([(sub, {"color": sub_color, "size": sub_size})])
    text(slide, x + (0.14 if accent is not None else 0.1), y + 0.05, w - 0.2, h - 0.1, paras,
         anchor=MSO_ANCHOR.MIDDLE, spacing=1.0)
    return s


def arrow(slide, x1, y1, x2, y2, color=MUTED, width=1.25):
    c = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    c.line.color.rgb = color; c.line.width = Pt(width)
    ln = c.line._get_or_add_ln()
    tail = etree.SubElement(ln, qn("a:tailEnd")); tail.set("type", "triangle"); tail.set("w", "med"); tail.set("len", "med")
    return c


def hline(slide, x, y, w, color=LINE, width=0.75):
    c = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x), Inches(y), Inches(x + w), Inches(y))
    c.line.color.rgb = color; c.line.width = Pt(width)
    return c


def crop(name, boxpx=None, out=None):
    src = SHOTS / name
    im = Image.open(src).convert("RGB")
    if boxpx:
        im = im.crop(boxpx)
    dst = CROPS / (out or name)
    im.save(dst, "PNG", optimize=True)
    return dst, im.size


def picture(slide, path, x, y, w=None, h=None, size=None, frame=True):
    if size and w and not h:
        h = w * size[1] / size[0]
    if size and h and not w:
        w = h * size[0] / size[1]
    if frame:
        rect(slide, x - 0.03, y - 0.03, w + 0.06, h + 0.06, fill=WHITE, line=LINE, rounded=True)
    p = slide.shapes.add_picture(str(path), Inches(x), Inches(y), Inches(w), Inches(h))
    return p, w, h


def caption(slide, x, y, t, w=3.2):
    return pill(slide, x, y, w, 0.28, t, fill=INK, color=WHITE, size=9)


def team_oval(slide):
    for sh in slide.shapes:
        if sh.name.startswith("Oval"):
            sh.width = Inches(1.7); sh.height = Inches(0.8); sh.left = Inches(0.3); sh.top = Inches(0.3)
            tf = sh.text_frame; tf.word_wrap = True
            tf.margin_left = tf.margin_right = Inches(0.04)
            tf.vertical_anchor = MSO_ANCHOR.MIDDLE
            for p in list(tf.paragraphs)[1:]:
                p._p.getparent().remove(p._p)
            p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
            for r in list(p.runs):
                r._r.getparent().remove(r._r)
            r = p.add_run(); r.text = "NER-AI\nLOGISTICS"
            r.font.name = FONT; r.font.size = Pt(10); r.font.bold = True; r.font.color.rgb = INK
            r.text = "NER-AI LOGISTICS"
            return sh


def strip_instruction_box(slide):
    for sh in list(slide.shapes):
        if sh.name == "TextBox 8":
            remove(sh)


def set_title(slide, t, size=None):
    for sh in slide.shapes:
        if sh.is_placeholder and sh.placeholder_format.type in (1, 3):  # TITLE / CENTER_TITLE
            tf = sh.text_frame
            p = tf.paragraphs[0]
            for r in list(p.runs)[1:]:
                r._r.getparent().remove(r._r)
            if p.runs:
                p.runs[0].text = t
                if size:
                    p.runs[0].font.size = Pt(size)
                    # the end-of-paragraph mark keeps the template's 44 pt and
                    # inflates the line height; size it like the run
                    p._p.get_or_add_endParaRPr().set("sz", str(int(size * 100)))
            else:
                tf.text = t
            return sh


def notes(slide, t):
    slide.notes_slide.notes_text_frame.text = t


# ---------------------------------------------------------------- slides
def slide1(s, nav, nav_size, mgr, mgr_size):
    for sh in list(s.shapes):
        if sh.name in ("Freeform: Shape 26", "Picture 4", "Subtitle 3", "TextBox 9"):
            remove(sh)
    # brand
    logo = ROOT / "driver-app" / "assets" / "brand-mark.png"
    s.shapes.add_picture(str(logo), Inches(0.55), Inches(1.32), Inches(0.95), Inches(0.95))
    text(s, 1.6, 1.28, 6.0, 0.7, [[("RASTA AI", {"bold": True, "size": 40, "color": INK})]], anchor=MSO_ANCHOR.MIDDLE)
    text(s, 1.62, 1.92, 6.4, 0.5, [[("Route Intelligence for Essential-Supply Logistics in North Eastern India", {"size": 15, "color": GREY})]])
    # PS id, prominent
    pill(s, 0.55, 2.7, 2.35, 0.7, "SIH26002", fill=BLUE, size=26)
    text(s, 3.05, 2.72, 4.0, 0.66, [[("Problem Statement ID", {"bold": True, "size": 11, "color": GREY})],
                                     [("MDoNER · Smart Automation · Software", {"size": 12, "color": INK})]], anchor=MSO_ANCHOR.MIDDLE)
    # template pointers, in the template's order
    rows = [
        ("Problem Statement ID", "SIH26002"),
        ("Problem Statement Title", "AI-Based Smart Logistics and Accessibility Intelligence Platform for North Eastern Region (NER)"),
        ("Theme", "Smart Automation"),
        ("PS Category", "Software"),
        ("Team ID", "17  (internal group no.)"),
        ("Team Name", "NER-AI LOGISTICS"),
    ]
    y = 3.68
    for k, v in rows:
        tall = 0.58 if k == "Problem Statement Title" else 0.33
        text(s, 0.55, y, 2.2, tall, [[(k.upper(), {"bold": True, "size": 10, "color": GREY})]], anchor=MSO_ANCHOR.TOP)
        text(s, 2.75, y - 0.03, 4.4, tall, [[(v, {"bold": k in ("Problem Statement ID", "Team ID", "Team Name"), "size": 14, "color": INK})]], spacing=1.0)
        hline(s, 0.55, y + tall + 0.02, 6.6)
        y += tall + 0.08
    text(s, 0.55, 6.5, 6.7, 0.35, [[("End-to-end working prototype · physical-phone validated · live demo corridor Guwahati → Shillong", {"size": 11.5, "color": GREEN, "bold": True})]])
    # real screens as the visual anchor
    picture(s, mgr, 7.35, 2.75, h=3.7, size=mgr_size)
    p, w, h = picture(s, nav, 10.2, 1.3, h=5.5, size=nav_size)
    caption(s, 7.35, 6.68, "Manager route review · Driver navigation — real screens", w=5.4)


def slide2(s, evid, evid_size):
    strip_instruction_box(s); team_oval(s)
    t = set_title(s, "RASTA AI — ROUTE INTELLIGENCE", size=28)
    t.left = Inches(2.1); t.width = Inches(8.5)
    label(s, 0.5, 1.2, 4, "PROPOSED SOLUTION")
    text(s, 0.5, 1.45, 8.6, 1.0, [[("NOT THE SHORTEST ROAD. ", {"bold": True, "size": 24, "color": INK}),
                                   ("THE ROAD THAT IS OPERATIONALLY USABLE NOW.", {"bold": True, "size": 24, "color": BLUE})]], spacing=1.0)
    # problem
    label(s, 0.5, 2.5, 4, "THE PROBLEM ON NER CORRIDORS")
    probs = ["Mountain terrain", "Monsoon weather", "Landslides", "Flood context", "Road disruptions", "Weak connectivity", "Missing or stale evidence"]
    for i, t in enumerate(probs):
        col, row = divmod(i, 4)
        cx = 0.5 + col * 2.05; cy = 2.8 + row * 0.3
        rect(s, cx, cy + 0.1, 0.1, 0.1, fill=DANGER, rounded=False)
        text(s, cx + 0.18, cy, 1.9, 0.3, [t], size=12.5)
    text(s, 0.5, 4.05, 4.0, 0.35, [[("A shortest-path router still sends the truck.", {"size": 12.5, "color": DANGER, "bold": True})]])
    # what is different
    label(s, 4.75, 2.5, 4, "WHAT IS DIFFERENT")
    usps = [("Evidence-aware routing", " — terrain, weather, warnings, flood, landslide history, traffic, freshness; not shortest-path only"),
            ("Unknown or stale data is exposed", " — never treated as safe"),
            ("Human-governed rerouting", " — a manager approves every safety-critical route change"),
            ("23 languages + offline operation", " — built for drivers on NER corridors")]
    y = 2.78
    for a, b in usps:
        text(s, 4.75, y, 4.35, 0.48, [[(a, {"bold": True, "size": 11.5, "color": INK}), (b, {"size": 11.5, "color": GREY})]], spacing=1.0)
        y += 0.5
    # flow
    label(s, 0.5, 4.86, 4, "THE RASTA FLOW")
    row1 = ["MANAGER TRIP", "REAL ROUTE", "TERRAIN + WEATHER", "LANDSLIDE · FLOOD · WARNINGS", "TRAFFIC + FRESHNESS"]
    row2 = ["ROUTE DECISION", "DRIVER NAVIGATION", "CONTINUOUS MONITORING", "REROUTE / DELIVERY"]
    x = 0.5; y = 5.14; wds = [1.35, 1.2, 1.6, 2.3, 1.75]
    for i, (t, w) in enumerate(zip(row1, wds)):
        pill(s, x, y, w, 0.4, t, fill=WHITE, color=INK, line=INK, size=9.5)
        if i < len(row1) - 1:
            arrow(s, x + w + 0.02, y + 0.2, x + w + 0.13, y + 0.2, color=INK)
        x += w + 0.15
    # row 2 snakes back right-to-left, so the flow reads as one line
    x_end = 0.5 + sum(wds) + 4 * 0.15
    y = 5.68; wds2 = [1.55, 1.75, 2.15, 1.85]
    fills = [BLUE, WHITE, WHITE, WHITE]
    x = x_end
    for i, (t, w) in enumerate(zip(row2, wds2)):
        x -= w
        pill(s, x, y, w, 0.4, t, fill=fills[i], color=WHITE if fills[i] == BLUE else INK, line=None if fills[i] == BLUE else INK, size=9.5)
        if i < len(row2) - 1:
            arrow(s, x - 0.02, y + 0.2, x - 0.13, y + 0.2, color=INK)
        x -= 0.15
    arrow(s, x_end - wds[-1] / 2, 5.55, x_end - wds[-1] / 2, 5.67, color=INK)
    # unknown != safe
    pill(s, 0.5, 6.25, 2.2, 0.42, "UNKNOWN  ≠  SAFE", fill=DANGER, size=12)
    text(s, 2.85, 6.22, 6.3, 0.5, [[("Missing or stale evidence is shown as UNKNOWN and never counted as safe. ", {"size": 11.5, "color": INK}),
                                    ("Routes with unknown hazard data need an authorised reviewer before selection.", {"size": 11.5, "color": GREY})]], spacing=1.0)
    # evidence screen
    p, w, h = picture(s, evid, 9.45, 1.3, h=5.45, size=evid_size)
    caption(s, 9.45, 6.5, "Manager · Check conditions (real screen)", w=w)


def slide3(s):
    strip_instruction_box(s); team_oval(s)
    # data row
    label(s, 0.45, 1.16, 8.5, "VERIFIED DATA  ·  provider adapters with health + freshness")
    srcs = [("WEATHER", "Open-Meteo · MET Norway"), ("TERRAIN", "Copernicus DEM · OpenTopoData"), ("WARNINGS", "NDMA SACHET (CAP)"),
            ("FLOOD", "GloFAS"), ("LANDSLIDE HISTORY", "NASA GLC 2007–17"), ("TRAFFIC", "fleet GPS fixes")]
    x = 0.45; bw = 1.34; gap = 0.1; y = 1.48
    for t, sub in srcs:
        box(s, x, y, bw, 0.68, t, sub, title_size=10, sub_size=8.5)
        arrow(s, x + bw / 2, y + 0.7, x + bw / 2, y + 0.92, color=MUTED)
        x += bw + gap
    total = 6 * bw + 5 * gap
    # backend
    box(s, 0.45, 2.42, total, 0.62, "FASTAPI BACKEND", "PostgreSQL + PostGIS (Supabase) · OSRM routing, alternatives, turn steps · offline trip package · push relay · audit log",
        fill=BG, title_size=11.5, sub_size=9.5)
    arrow(s, 0.45 + total / 2, 3.06, 0.45 + total / 2, 3.28)
    # policy
    box(s, 0.45, 3.3, total, 0.62, "DETERMINISTIC RISK POLICY", "11 factors · reason codes · UNKNOWN ≠ SAFE · reviewer authorisation when hazard data is missing",
        fill=BLUE, line=BLUE, title_color=WHITE, sub_color=WHITE, title_size=11.5, sub_size=9.5)
    arrow(s, 0.45 + total / 2, 3.94, 0.45 + total / 2, 4.16)
    # decisions
    dec = [("CONTINUE", GREEN), ("CAUTION", WARN), ("HOLD", DANGER), ("REROUTE", INK)]
    dw = (total - 3 * 0.15) / 4
    x = 0.45
    for t, c in dec:
        pill(s, x, 4.18, dw, 0.42, t, fill=c, size=11)
        x += dw + 0.15
    # clients
    arrow(s, 0.45 + total * 0.3, 4.62, 0.45 + total * 0.25, 4.92)
    arrow(s, 0.45 + total * 0.7, 4.62, 0.45 + total * 0.75, 4.92)
    cw = (total - 0.3) / 2
    box(s, 0.45, 4.95, cw, 0.78, "MANAGER CONSOLE  ·  React + TypeScript", "trip → route review → conditions → decision → dispatch → reroute review; manager accounts only",
        title_size=11, sub_size=9.5, accent=BLUE)
    box(s, 0.45 + cw + 0.3, 4.95, cw, 0.78, "DRIVER APP  ·  React Native / Expo (Android)", "one login, server-decided role · truck check · GPS navigation · danger cards · 23 languages · offline package",
        title_size=11, sub_size=9.5, accent=GREEN)
    text(s, 0.45, 5.92, total, 0.9, [
        [("STACK  ", {"bold": True, "size": 10, "color": GREY}), ("FastAPI · PostgreSQL / PostGIS (Supabase) · React · React Native / Expo · OSRM · OpenStreetMap · Gemini", {"size": 10.5, "color": INK})],
        [("EVIDENCE  ", {"bold": True, "size": 10, "color": GREY}), ("Open-Meteo / MET Norway · NDMA SACHET · GloFAS · NASA historical landslides · OpenTopoData / Copernicus DEM", {"size": 10.5, "color": INK})],
        [("METHOD  ", {"bold": True, "size": 10, "color": GREY}), ("plan → score evidence → decide → dispatch → track (60 s route-ahead worker) → reassess → human reroute → deliver", {"size": 10.5, "color": INK})],
    ], spacing=1.1)
    # right panel: who decides
    px = 9.35; pw = 3.6
    rect(s, px, 1.18, pw, 5.62, fill=BG, line=None, rounded=True)
    label(s, px + 0.15, 1.28, 3.3, "AI ARCHITECTURE — WHO DECIDES")
    rows = [("DETERMINISTIC SAFETY ENGINE", "makes every operational decision", BLUE),
            ("AI / LLM  (Gemini, OpenRouter fallback)", "explains and assists in the driver's language — never decides", GREEN),
            ("EXPERIMENTAL ML", "research channel only; held out of routing by a validation gate", MUTED)]
    y = 1.65
    for t, sub, c in rows:
        rect(s, px + 0.15, y, 0.07, 0.72, fill=c)
        text(s, px + 0.32, y - 0.02, pw - 0.5, 0.8, [[(t, {"bold": True, "size": 11, "color": INK})], [(sub, {"size": 10.5, "color": GREY})]], spacing=1.0)
        y += 0.92
    hline(s, px + 0.15, 4.4, pw - 0.3, color=LINE)
    label(s, px + 0.15, 4.48, 3.3, "GOVERNANCE CHAIN")
    chain = ["Verified evidence", "Deterministic safety policy", "Manager review", "Driver action"]
    y = 4.8
    for i, t in enumerate(chain):
        pill(s, px + 0.15, y, pw - 0.3, 0.34, t, fill=WHITE, color=INK, line=INK, size=10.5)
        if i < 3:
            arrow(s, px + pw / 2, y + 0.36, px + pw / 2, y + 0.5, color=INK)
        y += 0.52


def slide4(s, mgr, mgr_size, phone, phone_size):
    strip_instruction_box(s); team_oval(s)
    text(s, 0.5, 1.15, 8.5, 0.55, [[("NOT A CONCEPT — AN END-TO-END WORKING PROTOTYPE", {"bold": True, "size": 23, "color": INK})]], anchor=MSO_ANCHOR.MIDDLE)
    text(s, 0.5, 1.68, 8.5, 0.35, [[("Hosted backend, manager console and the Android app on a physical phone, on real roads.", {"size": 12.5, "color": GREY})]])
    # screens
    p, w1, h1 = picture(s, mgr, 0.5, 2.2, h=4.35, size=mgr_size)
    p, w2, h2 = picture(s, phone, 0.5 + w1 + 0.25, 2.2, h=4.35, size=phone_size)
    caption(s, 0.5, 6.62, "Real screens · manager route review · driver trip", w=w1 + w2 + 0.25)
    # working today
    cx = 0.5 + w1 + w2 + 0.6
    label(s, cx, 2.12, 3, "WORKING TODAY")
    items = ["Manager login (manager-only console)", "Driver login · role-aware mobile UI", "Real OSRM route + alternatives", "Terrain, weather, flood, landslide evidence",
             "Truck photo verification", "Physical GPS navigation", "Off-route detection", "Manager-approved reroute", "Offline / degraded operation", "Stops → delivery → fleet available"]
    y = 2.42
    for t in items:
        text(s, cx, y, 0.3, 0.3, [[("✓", {"bold": True, "size": 12, "color": GREEN})]])
        text(s, cx + 0.28, y, 3.0, 0.3, [t], size=11.5)
        y += 0.33
    # validation
    vx = cx + 3.45
    label(s, vx, 2.12, 3, "VALIDATION")
    stats = [("1138+", "backend tests"), ("621+", "driver-app tests"), ("170+", "manager-web tests")]
    y = 2.42
    for n, t in stats:
        text(s, vx, y, 1.4, 0.55, [[(n, {"bold": True, "size": 24, "color": BLUE})]], anchor=MSO_ANCHOR.MIDDLE)
        text(s, vx + 1.35, y, 1.9, 0.55, [[(t, {"size": 11.5, "color": INK})]], anchor=MSO_ANCHOR.MIDDLE)
        y += 0.58
    pill(s, vx, y + 0.05, 3.15, 0.38, "PHYSICAL ANDROID · CERTIFIED", fill=GREEN, size=11)
    text(s, vx, y + 0.5, 3.2, 0.9, [[("Canonical demo  ", {"bold": True, "size": 11, "color": GREY}), ("Guwahati → Shillong", {"bold": True, "size": 12, "color": INK})],
                                    [("≈ 98.8 km real route · 9/9 role steps · 12/12 judge-flow steps on the phone", {"size": 10.5, "color": GREY})]], spacing=1.05)
    # limits
    ly = 5.72
    hline(s, cx, ly - 0.06, 12.85 - cx)
    label(s, cx, ly, 4, "KNOWN LIMITS → MITIGATION")
    lim = [("Render cold start", "warm /health before the demo"),
           ("Provider rate limits", "cached evidence + explicit UNKNOWN"),
           ("Push needs Firebase config", "in-app safety alerts already work"),
           ("Experimental ML", "outside routing until the gate passes")]
    for i, (a, b) in enumerate(lim):
        col, row = divmod(i, 2)
        text(s, cx + col * 3.3, ly + 0.3 + row * 0.4, 3.25, 0.4, [[(a, {"bold": True, "size": 10, "color": INK}), ("  →  " + b, {"size": 10, "color": GREY})]], spacing=1.0)
    notes(s, "Judge answer on ML: We trained and evaluated a landslide-hazard model, but deliberately keep it outside production routing because its geographic false-positive rate is still too high (recall 0.95 at FPR 0.50 on the NER holdout). This prevents unreliable ML from making safety-critical decisions. Tests: backend 1138 passed / 5 skipped, driver 621, manager 170 (14 Sep 2026, commit 0b89ddf). Physical certification: docs/terrain/HANDOFF.md section 9.")


def slide5(s, lang, lang_size):
    strip_instruction_box(s); team_oval(s)
    text(s, 0.5, 1.15, 8.7, 0.95, [[("RASTA AI does not ask only ", {"size": 19, "color": GREY}), ("“Which road is shortest?”", {"size": 19, "color": INK, "bold": True}),
                                    ("  It asks ", {"size": 19, "color": GREY}), ("“Can this truck reliably use this corridor now?”", {"size": 19, "color": BLUE, "bold": True})]], spacing=1.05, anchor=MSO_ANCHOR.MIDDLE)
    label(s, 0.5, 2.2, 4, "WHO BENEFITS")
    who = [("FLEET MANAGERS", "Route usability and uncertainty visible before dispatch; auditable decisions."),
           ("DRIVERS", "Safer navigation, danger context, emergency support, 23 languages."),
           ("REMOTE COMMUNITIES", "More resilient access to food, medicine, fuel and relief supplies."),
           ("GOVERNMENT / OPERATIONS", "Auditable route evidence and disruption visibility per corridor.")]
    cw = 2.1
    for i, (h, b) in enumerate(who):
        x = 0.5 + i * (cw + 0.13)
        hline(s, x, 2.5, cw, color=BLUE, width=1.5)
        text(s, x, 2.56, cw, 1.3, [[(h, {"bold": True, "size": 11, "color": BLUE})], [(b, {"size": 11.5, "color": INK})]], spacing=1.05, space_after=3)
    label(s, 0.5, 3.95, 4, "DEMONSTRATED TODAY")
    caps = [("23", "selectable languages, explicit fallback status"), ("11", "factor route-risk assessment"), ("60 s", "route-ahead coordinator"),
            ("12/12", "judge-flow steps certified on a physical phone"), ("100 %", "of reroutes reviewed by a human"), ("0", "unknown factors counted as safe")]
    for i, (n, t) in enumerate(caps):
        col, row = divmod(i, 3)
        x = 0.5 + col * 4.4; y = 4.25 + row * 0.55
        text(s, x, y, 1.0, 0.5, [[(n, {"bold": True, "size": 22, "color": BLUE})]], anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.RIGHT)
        text(s, x + 1.1, y, 3.2, 0.5, [[(t, {"size": 11.5, "color": INK})]], anchor=MSO_ANCHOR.MIDDLE)
    label(s, 0.5, 5.98, 5, "HUMAN GOVERNANCE — AI HAS NO UNCONTROLLED AUTHORITY")
    chain = ["Verified evidence", "Deterministic safety policy", "Manager governance", "Driver action"]
    x = 0.5; y = 6.28
    for i, t in enumerate(chain):
        w = 2.0
        pill(s, x, y, w, 0.38, t, fill=WHITE if i else INK, color=INK if i else WHITE, line=INK, size=10.5)
        if i < 3:
            arrow(s, x + w + 0.03, y + 0.19, x + w + 0.2, y + 0.19, color=INK)
        x += w + 0.24
    text(s, 0.5, 6.7, 8.7, 0.25, [[("Impact is framed on essential logistics — food, medicine, fuel, relief — and on evidence, not on unmeasured savings.", {"size": 9.5, "color": GREY})]])
    p, w, h = picture(s, lang, 9.75, 1.25, h=4.3, size=lang_size)
    caption(s, 9.75, 1.25 + h + 0.12, "Driver · language selector (real screen)", w=w)
    text(s, 9.75, 1.25 + h + 0.48, w, 0.9, [[("23 languages in the selector; each shows its status — Verified, Draft or English fallback — so a driver is never misled.", {"size": 10, "color": GREY})]], spacing=1.05)


def slide6(s):
    strip_instruction_box(s); team_oval(s)
    label(s, 0.5, 1.18, 5, "RESEARCH / EVIDENCE SOURCES")
    src = [("NASA Global Landslide Catalog", "historical landslide exposure; inventory 2007–2017, ≤5 km accuracy filter"),
           ("NDMA SACHET (CAP feed)", "official warnings, polled with freshness"),
           ("GloFAS — Copernicus Emergency Management", "flood context: river discharge vs 30-day mean"),
           ("Open-Meteo · MET Norway", "weather forecast along the corridor; ERA5-Land archive for research"),
           ("Copernicus DEM GLO-90 · OpenTopoData", "terrain profile, climb, steep segments"),
           ("OpenStreetMap · OSRM", "roads, route alternatives, turn steps"),
           ("MDoNER problem statement SIH26002", "AI-based smart logistics and accessibility intelligence for the NER")]
    y = 1.5
    for a, b in src:
        text(s, 0.5, y, 5.9, 0.55, [[(a, {"bold": True, "size": 12, "color": INK})], [(b, {"size": 10.5, "color": GREY})]], spacing=1.0)
        y += 0.6
    # model validation
    mx = 6.85; mw = 6.0
    rect(s, mx, 1.18, mw, 4.25, fill=BG, rounded=True)
    label(s, mx + 0.2, 1.28, 5, "MODEL VALIDATION — EXPERIMENTAL LANDSLIDE MODEL")
    text(s, mx + 0.2, 1.58, mw - 0.4, 0.62, [[("Logistic regression on NASA GLC events + ERA5-Land rain + DEM slope. ", {"size": 11, "color": INK}),
                                              ("India-wide training (605 events, 3,025 rows) · NER geographic holdout (770 days, 154 events) · temporal split ≤2014 / 2015–17 · threshold chosen on train only.", {"size": 11, "color": GREY})]], spacing=1.0)
    mets = [("0.95", "Recall"), ("0.32", "Precision"), ("0.55", "PR-AUC"), ("0.83", "ROC-AUC"), ("0.50", "FPR")]
    x = mx + 0.2
    for n, t in mets:
        text(s, x, 2.3, 1.1, 0.5, [[(n, {"bold": True, "size": 24, "color": INK})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        text(s, x, 2.78, 1.1, 0.3, [[(t, {"size": 10.5, "color": GREY})]], align=PP_ALIGN.CENTER)
        x += 1.12
    pill(s, mx + 0.2, 3.2, 3.0, 0.38, "EXPERIMENTAL — NOT DEPLOYED", fill=INK, size=11)
    text(s, mx + 3.35, 3.2, 2.5, 0.38, [[("rule baseline: recall 0.25 @ FPR 0.03", {"size": 10, "color": GREY})]], anchor=MSO_ANCHOR.MIDDLE)
    text(s, mx + 0.2, 3.72, mw - 0.4, 1.9, [
        [("Validation before automation. ", {"bold": True, "size": 13, "color": BLUE}), ("Experimental ML stays outside production until it meets the required geographic reliability and false-positive thresholds.", {"size": 13, "color": INK})],
        [("The false-positive floor is a data-design limit (same-site quiet-day negatives; false positives are wet monsoon days), measured in a full error analysis. Next data: sub-daily rain intensity, soil moisture, cross-site negatives.", {"size": 10.5, "color": GREY})],
    ], spacing=1.05, space_after=4)
    hline(s, 0.5, 5.92, 12.35)
    label(s, 0.5, 5.98, 3, "REFERENCES")
    refs = ["gpm.nasa.gov/landslides (NASA GLC)", "sachet.ndma.gov.in", "global-flood.emergency.copernicus.eu (GloFAS)", "open-meteo.com · api.met.no",
            "opentopodata.org · Copernicus DEM", "project-osrm.org · openstreetmap.org", "github.com/nxtlucifer/ner-ai-logistics (repository, tests, model registry, error analysis)"]
    text(s, 0.5, 6.25, 12.35, 0.6, [[("  ·  ".join(refs), {"size": 9.5, "color": GREY})]], spacing=1.1)
    notes(s, "Full references:\n"
             "NASA Global Landslide Catalog — https://gpm.nasa.gov/landslides/ (data via https://data.nasa.gov)\n"
             "NDMA SACHET CAP alerts — https://sachet.ndma.gov.in\n"
             "GloFAS (Copernicus Emergency Management Service) — https://global-flood.emergency.copernicus.eu ; flood API via https://open-meteo.com/en/docs/flood-api\n"
             "Open-Meteo forecast / ERA5-Land archive — https://open-meteo.com ; MET Norway Locationforecast — https://api.met.no\n"
             "OpenTopoData — https://www.opentopodata.org ; Copernicus DEM GLO-90 — https://spacedata.copernicus.eu\n"
             "OSRM — https://project-osrm.org ; OpenStreetMap — https://www.openstreetmap.org\n"
             "Repository — https://github.com/nxtlucifer/ner-ai-logistics (docs/MODEL_REGISTRY.md, docs/HAZARD_ERROR_ANALYSIS.md, docs/AI_INVENTORY.md)\n"
             "Model metrics: NER holdout n=770, 154 events; recall 0.95, precision 0.32, F1 0.48, PR-AUC 0.55, ROC-AUC 0.83, FPR 0.50, Brier 0.12; status EXPERIMENTAL, not deployed.")


def main() -> int:
    prs = Presentation(str(TEMPLATE))
    nav, nav_size = crop("07-navigation.png")
    mgr, mgr_size = crop("02-trip-route.png", (1370, 200, 2470, 1800), "mgr-route.png")
    evid, evid_size = crop("03-route-evidence.png", (1400, 70, 2460, 1720), "mgr-evidence.png")
    phone, phone_size = crop("06b-trip-after-verification.png", (0, 100, 1264, 2780), "phone-trip.png")
    lang, lang_size = crop("11-language-selector.png", (0, 1000, 1264, 2780), "phone-lang.png")
    slides = list(prs.slides)
    slide1(slides[0], nav, nav_size, mgr, mgr_size)
    slide2(slides[1], evid, evid_size)
    slide3(slides[2])
    slide4(slides[3], mgr, mgr_size, phone, phone_size)
    slide5(slides[4], lang, lang_size)
    slide6(slides[5])
    # drop the template's instruction slide (7)
    sldIdLst = prs.slides._sldIdLst
    last = list(sldIdLst)[6]
    rId = last.get(qn("r:id"))
    prs.part.drop_rel(rId)
    sldIdLst.remove(last)
    prs.save(str(OUT))
    print("wrote", OUT, "slides:", len(prs.slides))
    return 0


if __name__ == "__main__":
    sys.exit(main())
