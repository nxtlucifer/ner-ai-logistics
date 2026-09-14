"""V09 BLUEPRINT — drafted, not decorated.

A drafting sheet: a faint measured grid, corner ticks on every block, monospace
annotation labels. The deck looks like the engineering drawing of the system it
is describing.
"""
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from deckkit import (FACTS as F, FOOT, Theme, chain_h, chain_v, content_slide, hline, picture,
                     pill, rect, stat, text, title_slide_prep)

THEME = Theme(slug="V09_BLUEPRINT", label="Blueprint", font="Arial", mono="Courier New",
              accent="0B4F8A", accent2="0E7490", ok="0F766E", warn="A16207", danger="9F1239",
              ink="0C1A26", grey="4A5C6A", muted="8C9CA8", line="C9D6E0", bg="F2F6F9",
              radius=0.0, border=0.75,
              note="A drafting sheet: measured grid, corner ticks, monospace annotation.")

GRID = None


def sheet(s, t, top=1.2, step=0.66):
    """Faint measured grid over the working area, drawn first."""
    y = top
    while y < FOOT:
        hline(s, 0.3, y, 12.73, t.line, 0.4)
        y += step
    x = 0.3
    while x <= 13.05:
        s_ = s.shapes.add_connector(2, int(x * 914400), int(top * 914400), int(x * 914400), int(FOOT * 914400))
        s_.line.color.rgb = t.line
        s_.line.width = __import__("pptx.util", fromlist=["Pt"]).Pt(0.4)
        x += step


def ticks(s, t, x, y, w, h, size=0.14, color=None):
    """Corner ticks instead of a box."""
    c = color or t.accent
    for cx, cy, dx, dy in ((x, y, 1, 1), (x + w, y, -1, 1), (x, y + h, 1, -1), (x + w, y + h, -1, -1)):
        hline(s, min(cx, cx + dx * size), cy, size, c, 1.1)
        s_ = s.shapes.add_connector(2, int(cx * 914400), int(min(cy, cy + dy * size) * 914400),
                                    int(cx * 914400), int(max(cy, cy + dy * size) * 914400))
        s_.line.color.rgb = c
        s_.line.width = __import__("pptx.util", fromlist=["Pt"]).Pt(1.1)


def note(s, t, x, y, w, label, size=8):
    text(s, x, y, w, 0.24, [[(label, {"font": t.mono, "bold": True, "size": size, "color": t.accent})]], t=t)


def block(s, t, x, y, w, h, label, fill=None):
    rect(s, x, y, w, h, fill=fill or t.paper, line=None)
    ticks(s, t, x, y, w, h)
    if label:
        note(s, t, x + 0.1, y + 0.06, w - 0.2, label)
        return y + 0.34
    return y + 0.1


def s1(s, t, S):
    title_slide_prep(s)
    sheet(s, t, 1.22)
    y = block(s, t, 0.5, 1.28, 6.7, 2.2, "FIG.1  SYSTEM IDENTITY")
    text(s, 0.68, y - 0.06, 6.3, 0.66, [[(F["name"], {"bold": True, "size": 36})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 0.7, y + 0.6, 6.3, 0.38, [[(F["tagline"], {"size": 11.5, "color": t.grey})]], t=t)
    pill(s, 0.68, y + 1.04, 1.9, 0.52, F["ps_id"], t, fill=t.accent, size=20, rounded=False)
    text(s, 2.72, y + 1.06, 4.3, 0.48, [[("PROBLEM STATEMENT ID", {"font": t.mono, "bold": True, "size": 8, "color": t.muted})],
                                        [(F["ministry"] + " · " + F["theme"] + " · " + F["category"], {"size": 11})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE)
    y = block(s, t, 0.5, 3.62, 6.7, 1.96, "FIG.2  SUBMISSION RECORD")
    for k, v in [("PS TITLE", F["ps_title"]), ("THEME", F["theme"]), ("PS CATEGORY", F["category"]),
                 ("TEAM ID", F["team_id"]), ("TEAM NAME", F["team"])]:
        tall = 0.44 if k == "PS TITLE" else 0.26
        note(s, t, 0.68, y + 0.02, 1.7, k, size=7.5)
        text(s, 2.44, y - 0.03, 4.6, tall, [[(v, {"size": 11, "bold": k in ("TEAM ID", "TEAM NAME")})]], t=t, spacing=1.0)
        y += tall + 0.04
    y = block(s, t, 0.5, 5.72, 6.7, 1.2, "FIG.3  DESIGN PREMISE", fill=t.bg)
    text(s, 0.68, y - 0.04, 6.3, 0.42, [[(F["headline"], {"bold": True, "size": 19})]], t=t)
    text(s, 0.68, y + 0.36, 6.3, 0.32, [[(F["question"], {"size": 11, "color": t.accent})]], t=t)
    text(s, 0.68, y + 0.66, 6.3, 0.3, [[(F["proof_line"], {"size": 8.5, "color": t.ok, "bold": True})]], t=t)
    block(s, t, 7.45, 1.28, 5.4, 5.64, "FIG.4  AS BUILT — MANAGER + DRIVER")
    picture(s, S["mgr"], 7.62, 2.6, h=3.72, frame=t.line)
    picture(s, S["nav"], 10.42, 1.86, h=4.46, frame=t.line)
    note(s, t, 7.62, 6.44, 5.1, "REAL SCREENS / NO MOCK-UPS")


def s2(s, t, S):
    content_slide(s, t, F["titles"][1])
    sheet(s, t)
    text(s, 0.5, 1.24, 8.82, 0.86, [[("Not the shortest road. ", {"bold": True, "size": 22}),
                                     ("The road that is operationally usable now.",
                                      {"bold": True, "size": 22, "color": t.accent})]], t=t, spacing=1.0)
    y = block(s, t, 0.45, 2.16, 2.66, 2.1, "FIG.1  BASELINE")
    chain_v(s, 0.62, 2.32, y, [(x, None, t.grey, t.muted) for x in F["normal_router"]], t, h=0.3, gap=0.22, size=10)
    text(s, 0.62, y + 1.44, 2.32, 0.6, [[(F["normal_gap"][1], {"size": 9.5, "color": t.muted})]], t=t, spacing=1.05)
    y = block(s, t, 3.24, 2.16, 6.08, 2.1, "FIG.2  RASTA AI — EVIDENCE PATH")
    text(s, 3.42, y - 0.04, 5.72, 0.28, [[("Origin → real OSRM route → route-specific evidence → policy → decision",
                                           {"size": 10})]], t=t)
    ex, ey = 3.42, y + 0.28
    for lab, wd in zip(F["evidence_chips"], [0.84, 0.84, 1.34, 1.08, 1.24, 0.98, 1.34]):
        if ex + wd > 9.18:
            ex = 3.42; ey += 0.28
        pill(s, ex, ey, wd, 0.24, lab, t, fill=None, color=t.ink, line=t.muted, size=8.5, bold=False, rounded=False)
        ex += wd + 0.07
    dw = (5.72 - 3 * 0.1) / 4
    dx = 3.42
    for lab, kind in F["decisions"]:
        pill(s, dx, ey + 0.36, dw, 0.32, lab, t, fill=t.c({"ok": "ok", "warn": "warn", "danger": "danger", "ink": "ink"}[kind]),
             size=10, rounded=False)
        dx += dw + 0.1
    text(s, 3.42, ey + 0.74, 5.72, 0.3, [[("Manager governance → driver navigation, 23 languages, offline package",
                                           {"size": 9.5})]], t=t)
    y = block(s, t, 0.45, 4.4, 8.87, 1.28, "FIG.3  THE INVARIANT", fill=t.bg)
    text(s, 0.62, y - 0.02, 2.5, 0.42, [[("UNKNOWN ≠ SAFE", {"bold": True, "size": 17, "color": t.danger})]], t=t)
    text(s, 3.24, y, 5.9, 0.6, [[(F["unknown_rule"], {"size": 10.5})]], t=t, spacing=1.05)
    y = block(s, t, 0.45, 5.82, 8.87, 1.1, "FIG.4  PROBLEM CONTEXT")
    text(s, 0.62, y - 0.02, 8.5, 0.6, [[(F["problem"], {"size": 10, "color": t.grey})]], t=t, spacing=1.05)
    block(s, t, 9.5, 1.2, 3.38, 5.72, "FIG.5  MANAGER · CHECK CONDITIONS")
    picture(s, S["evid"], 9.66, 1.66, h=4.62, frame=t.line)
    note(s, t, 9.66, 6.42, 3.06, "EVIDENCE / FRESHNESS / UNKNOWN")


def s3(s, t, S):
    content_slide(s, t, F["titles"][2])
    sheet(s, t)
    y = block(s, t, 0.42, 1.2, 8.9, 1.06, "FIG.1  VERIFIED DATA SOURCES")
    x, bw = 0.6, 1.4
    for lab, sub in F["sources"]:
        text(s, x, y - 0.04, bw, 0.6, [[(lab, {"bold": True, "size": 8.5})], [(sub, {"size": 7.5, "color": t.grey})]],
             t=t, spacing=1.0)
        x += bw + 0.05
    y = block(s, t, 0.42, 2.36, 8.9, 2.38, "FIG.2  DECISION PATH")
    for title, sub, fill in [("ROUTE-SPECIFIC EVIDENCE · FastAPI backend",
                              "every factor sampled along the selected road · PostgreSQL + PostGIS (Supabase) · OSRM routes, alternatives, turn steps", None),
                             ("DETERMINISTIC SAFETY POLICY",
                              "11 factors · reason codes · UNKNOWN ≠ SAFE · reviewer authorisation when hazard data is missing", t.accent)]:
        rect(s, 0.6, y, 8.54, 0.54, fill=fill or t.bg, line=t.muted, line_w=0.6)
        text(s, 0.72, y + 0.03, 8.3, 0.48, [[(title, {"bold": True, "size": 10, "color": t.paper if fill else t.ink})],
                                            [(sub, {"size": 8.5, "color": t.line if fill else t.grey})]], t=t, spacing=1.0)
        y += 0.62
    dw = (8.54 - 3 * 0.12) / 4
    dx = 0.6
    for lab, kind in F["decisions"]:
        pill(s, dx, y, dw, 0.34, lab, t, fill=t.c({"ok": "ok", "warn": "warn", "danger": "danger", "ink": "ink"}[kind]),
             size=10.5, rounded=False)
        dx += dw + 0.12
    y += 0.46
    chain_h(s, 0.6, y, [("MANAGER REVIEW", 1.4), ("DRIVER NAVIGATION", 1.5), ("ROUTE-AHEAD 60 s", 1.42),
                        ("CONDITIONS CHANGE?", 1.58), ("REASSESS", 1.0)], t, h=0.32, gap=0.08, size=8,
            fills={0: t.ink}, colors={0: t.on_dark}, lines={i: t.ink for i in range(5)})
    y = block(s, t, 0.42, 4.84, 8.9, 2.04, "FIG.3  IMPLEMENTATION")
    text(s, 0.6, y - 0.02, 8.54, 1.7, [
        [("CLIENTS  ", {"font": t.mono, "bold": True, "size": 8, "color": t.muted}), (F["clients"], {"size": 10})],
        [("STACK  ", {"font": t.mono, "bold": True, "size": 8, "color": t.muted}), (F["stack"], {"size": 10})],
        [("EVIDENCE  ", {"font": t.mono, "bold": True, "size": 8, "color": t.muted}),
         ("Open-Meteo / MET Norway · NDMA SACHET · GloFAS · NASA historical landslides · OpenTopoData / Copernicus DEM",
          {"size": 10})],
        [("Re-scored every 60 s along the road ahead; a reroute is proposed to the manager, never applied silently.",
          {"size": 9.5, "color": t.grey})],
    ], t=t, spacing=1.15, space_after=3)
    y = block(s, t, 9.5, 1.2, 3.38, 5.72, "FIG.4  DECISION AUTHORITY")
    for lab, sub, kind in F["deciders"]:
        rect(s, 9.66, y + 0.02, 0.05, 0.68, fill=t.c(kind))
        text(s, 9.82, y, 2.9, 0.82, [[(lab, {"bold": True, "size": 10})], [(sub, {"size": 9.5, "color": t.grey})]],
             t=t, spacing=1.0)
        y += 0.9
    hline(s, 9.66, y + 0.02, 3.06, t.line)
    note(s, t, 9.66, y + 0.1, 3.06, "GOVERNANCE CHAIN")
    chain_v(s, 9.66, 3.06, y + 0.42, [(c, None, t.ink, t.ink) for c in F["chain"]], t, h=0.32, gap=0.14, size=10)


def s4(s, t, S):
    content_slide(s, t, F["titles"][3])
    sheet(s, t)
    text(s, 0.5, 1.22, 9.5, 0.4, [[("Not a concept. A working end-to-end prototype.", {"bold": True, "size": 21})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE)
    y = block(s, t, 0.42, 1.66, 12.46, 0.78, "FIG.1  CERTIFIED LIFECYCLE")
    widths = [0.8, 0.94, 1.08, 0.98, 1.3, 1.12, 1.12, 2.16, 1.06]
    chain_h(s, 0.6, y - 0.02, list(zip(F["lifecycle"], widths)), t, h=0.32, gap=0.09, size=8.5,
            fills={0: t.accent, 1: t.accent, 7: t.accent, 8: t.ok},
            colors={i: t.on_dark for i in (0, 1, 7, 8)}, lines={i: t.ink for i in (2, 3, 4, 5, 6)})
    y = block(s, t, 0.42, 2.54, 6.5, 3.88, "FIG.2  AS BUILT")
    top, hh = y + 0.04, 3.2
    w1, _ = picture(s, S["mgr"], 0.6, top, h=hh, frame=t.line)
    w2, _ = picture(s, S["truck"], 0.6 + w1 + 0.18, top, h=hh, frame=t.line)
    w3, _ = picture(s, S["nav"], 0.6 + w1 + w2 + 0.36, top, h=hh, frame=t.line)
    for px, pw, lab in [(0.6, w1, "MANAGER / ROUTE REVIEW"), (0.6 + w1 + 0.18, w2, "DRIVER / TRUCK CHECK"),
                        (0.6 + w1 + w2 + 0.36, w3, "DRIVER / NAVIGATION")]:
        note(s, t, px, top + hh + 0.06, pw, lab, size=7)
    y = block(s, t, 7.06, 2.54, 5.82, 3.88, "FIG.3  EVIDENCE OF EXECUTION")
    cx, cw = 7.24, 5.46
    text(s, cx, y - 0.02, cw, 0.6, [[("The whole lifecycle above was run end to end on a physical Android phone against "
                                     "the hosted backend, on the real road.", {"size": 11})]], t=t, spacing=1.05)
    yy = y + 0.66
    for n, lab in F["proof"]:
        stat(s, cx, yy, cw, n, lab, t, num_size=17, lab_size=11, gap=1.0)
        yy += 0.44
    runs = []
    for i, (n, lab) in enumerate(F["tests"]):
        runs += [(n + " ", {"bold": True, "size": 12.5, "color": t.accent}),
                 (lab + ("  ·  " if i < 2 else " tests"), {"size": 10})]
    text(s, cx, yy, cw, 0.34, [runs], t=t, anchor=MSO_ANCHOR.MIDDLE)
    pill(s, cx, yy + 0.46, cw, 0.36, "PHYSICAL ANDROID · CERTIFIED", t, fill=t.ok, size=11, rounded=False)
    note(s, t, cx, yy + 0.92, cw, "CANONICAL DEMO: GUWAHATI → SHILLONG / ≈ 98.8 KM", size=8)
    text(s, 0.42, 6.5, 12.46, 0.42, [[("KNOWN LIMITS → MITIGATION   ", {"font": t.mono, "bold": True, "size": 8, "color": t.muted}),
                                      (F["limits"], {"size": 9, "color": t.grey})]], t=t, spacing=1.05)


def s5(s, t, S):
    content_slide(s, t, F["titles"][4])
    sheet(s, t)
    text(s, 0.5, 1.2, 8.82, 0.8, [[("RASTA AI does not ask only ", {"size": 17, "color": t.grey}),
                                   ("“Which road is shortest?”", {"size": 17, "bold": True}),
                                   ("  It asks  ", {"size": 17, "color": t.grey}),
                                   ("“Can this truck reliably use this corridor now?”",
                                    {"size": 17, "bold": True, "color": t.accent})]], t=t, spacing=1.05)
    y = block(s, t, 0.45, 2.08, 8.87, 1.6, "FIG.1  BENEFICIARIES")
    cw = 2.02
    for i, (h, b) in enumerate(F["who"]):
        x = 0.62 + i * (cw + 0.16)
        hline(s, x, y + 0.02, cw, t.accent, 1.2)
        text(s, x, y + 0.08, cw, 1.1, [[(h, {"bold": True, "size": 9, "color": t.accent})],
                                       [(b, {"size": 9.5})]], t=t, spacing=1.05, space_after=3)
    y = block(s, t, 0.45, 3.8, 8.87, 1.62, "FIG.2  MEASURED TODAY")
    for i, (n, lab) in enumerate(F["caps"]):
        col, r = divmod(i, 3)
        stat(s, 0.62 + col * 4.3, y + r * 0.4, 4.16, n, lab, t, num_size=16, lab_size=10,
             align=PP_ALIGN.RIGHT, gap=0.96)
    y = block(s, t, 0.45, 5.54, 8.87, 1.34, "FIG.3  GOVERNANCE — AI HAS NO UNCONTROLLED AUTHORITY")
    text(s, 0.62, y - 0.02, 8.5, 0.28, [[(F["supplies"], {"bold": True, "size": 11, "color": t.ok}),
                                         ("   — essential logistics for hill communities, decided on evidence",
                                          {"size": 9.5, "color": t.grey})]], t=t)
    chain_h(s, 0.62, y + 0.34, [(c, 1.98) for c in F["chain"]], t, h=0.34, gap=0.2, size=9.5,
            fills={0: t.ink}, colors={0: t.on_dark}, lines={i: t.ink for i in range(4)})
    block(s, t, 9.5, 1.2, 3.38, 5.72, "FIG.4  AS BUILT — APK 1.0.18")
    w1, _ = picture(s, S["lang"], 9.66, 1.66, h=2.44, frame=t.line)
    w2, _ = picture(s, S["mobile"], 9.66 + w1 + 0.14, 1.66, h=2.44, frame=t.line)
    note(s, t, 9.66, 4.18, w1, "23 LANGUAGES", size=7)
    note(s, t, 9.66 + w1 + 0.14, 4.18, w2, "MANAGER / MOBILE", size=7)
    text(s, 9.66, 4.5, 3.06, 2.0, [[("Real screens, APK 1.0.18. One login, server-decided role: a manager gets a mobile "
                                     "fleet view, a driver gets navigation. Each language shows its status — Verified, "
                                     "Draft or English fallback — so nobody is misled.", {"size": 9.5, "color": t.grey})]],
         t=t, spacing=1.05)


def s6(s, t, S):
    content_slide(s, t, F["titles"][5])
    sheet(s, t)
    y = block(s, t, 0.42, 1.2, 7.4, 4.86, "FIG.1  EVIDENCE SOURCES BEHIND THE ROUTE DECISION")
    gw = 3.36
    for i, (lab, names, what) in enumerate(F["groups"]):
        col, row = i % 2, i // 2
        x = 0.6 + col * (gw + 0.2)
        yy = y + 0.04 + row * 1.44
        hline(s, x, yy, gw, t.accent, 1.2)
        text(s, x, yy + 0.06, gw, 1.24, [[(lab, {"font": t.mono, "bold": True, "size": 8, "color": t.accent})],
                                         [(names, {"bold": True, "size": 10.5})],
                                         [(what, {"size": 9.5, "color": t.grey})]], t=t, spacing=1.05, space_after=2)
    mx, mw = 8.22, 4.5
    block(s, t, 8.05, 1.2, 4.83, 4.86, "FIG.2  EXPERIMENTAL LANDSLIDE RESEARCH")
    text(s, mx, 1.64, 1.85, 0.94, [[(F["ml_recall"], {"bold": True, "size": 44})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, mx + 1.85, 1.68, mw - 1.85, 0.88, [[(F["ml_recall_what"], {"bold": True, "size": 12})],
                                               [(F["ml_recall_sub"], {"size": 9.5, "color": t.grey})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE, spacing=1.05)
    rect(s, mx, 2.72, mw, 0.8, fill=t.ink)
    text(s, mx, 2.78, mw, 0.7, [[(F["ml_gate_small"], {"font": t.mono, "bold": True, "size": 10.5, "color": t.muted})],
                                [(F["ml_gate_big"], {"bold": True, "size": 21, "color": t.on_dark})]],
         t=t, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, spacing=1.0)
    text(s, mx, 3.6, mw, 0.32, [[(F["ml_fpr"], {"bold": True, "size": 13, "color": t.danger}),
                                 ("   " + F["ml_fpr_why"], {"size": 10, "color": t.grey})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    fy = 4.0
    for r in ([(F["ml_flow"][0], 0.78), (F["ml_flow"][1], 1.6), (F["ml_flow"][2], 1.76)],
              [(F["ml_flow"][3], 1.96), (F["ml_flow"][4], 1.08), (F["ml_flow"][5], 1.26)]):
        chain_h(s, mx, fy, r, t, h=0.28, gap=0.08, size=8, lines={i: t.ink for i in range(3)})
        fy += 0.38
    text(s, mx, 4.8, mw, 0.68, [[(F["ml_caption_lead"] + " ", {"bold": True, "size": 11, "color": t.accent}),
                                 (F["ml_caption"], {"size": 10})]], t=t, spacing=1.05)
    text(s, mx, 5.48, mw, 0.5, [[(F["ml_metrics"], {"font": t.mono, "size": 7, "color": t.grey})]], t=t, spacing=1.1)
    hline(s, 0.42, 6.16, 12.46, t.ink, 1.0)
    text(s, 0.42, 6.42, 12.46, 0.48, [[("REFERENCES   ", {"font": t.mono, "bold": True, "size": 8, "color": t.muted}),
                                       (F["refs"], {"size": 8.5, "color": t.grey})]], t=t, spacing=1.1)


SLIDES = [s1, s2, s3, s4, s5, s6]
