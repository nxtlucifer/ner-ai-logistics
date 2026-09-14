"""V05 CORRIDOR — the road is the layout.

Every slide is organised on a single route spine with stations on it, the way
the product organises a trip. Terrain palette: slate, deep green, ochre.
"""
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from deckkit import (FACTS as F, Theme, arrow, chain_h, content_slide, hline, picture, pill,
                     rect, rgb, stat, text, title_slide_prep)

THEME = Theme(slug="V05_CORRIDOR", label="Corridor", font="Calibri", accent="15803D",
              accent2="B45309", ok="15803D", warn="B45309", danger="B91C1C", ink="1C2A24",
              grey="5B6B63", muted="9AA8A0", line="DCE4DF", bg="F4F7F5", radius=0.08, border=1.1,
              note="Every slide runs on a single route spine with stations, the way a trip does.")

SPINE = rgb("15803D")


def spine(s, t, x, y, w, stations, size=8.5, dot=0.13, above=True, color=None, lab_w=1.7):
    """A route line with labelled stations; labels sit above or below the line."""
    col = color or SPINE
    rect(s, x, y - 0.025, w, 0.05, fill=col)
    n = len(stations)
    for i, lab in enumerate(stations):
        cx = x + (w - dot) * i / max(1, n - 1)
        rect(s, cx, y - dot / 2, dot, dot, fill=t.paper, line=col, rounded=True, line_w=1.4, radius=dot / 2)
        ly = y - 0.42 if above else y + 0.12
        text(s, cx - lab_w / 2, ly, lab_w + dot, 0.32, [[(lab, {"bold": True, "size": size, "color": t.ink})]],
             t=t, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.BOTTOM if above else MSO_ANCHOR.TOP, spacing=1.0)


def band(s, t, x, y, w, h, title=None, fill=None, accent=None):
    rect(s, x, y, w, h, fill=fill or t.paper, line=t.line, rounded=True, line_w=1.0, radius=0.08)
    if accent is not None:
        rect(s, x, y, w, 0.05, fill=accent)
    if title:
        text(s, x + 0.16, y + 0.1, w - 0.32, 0.3, [[(title, {"bold": True, "size": 10.5, "color": accent or t.accent})]], t=t)
        return y + 0.44
    return y + 0.16


def s1(s, t, S):
    title_slide_prep(s)
    text(s, 0.55, 1.3, 6.6, 0.68, [[(F["name"], {"bold": True, "size": 40})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 0.58, 1.98, 6.6, 0.38, [[(F["tagline"], {"size": 12.5, "color": t.grey})]], t=t)
    spine(s, t, 0.6, 2.86, 6.5, ["GUWAHATI DEPOT", "NER CORRIDOR", "SHILLONG DEPOT"], size=9)
    text(s, 0.6, 3.0, 6.5, 0.3, [[("≈ 98.8 km of real OSRM road · plain to plateau · the live demo corridor",
                                   {"size": 10, "color": t.grey})]], t=t, align=PP_ALIGN.CENTER)
    pill(s, 0.55, 3.46, 2.05, 0.58, F["ps_id"], t, fill=t.accent, size=22)
    text(s, 2.78, 3.48, 4.35, 0.54, [[("PROBLEM STATEMENT ID", {"bold": True, "size": 9.5, "color": t.muted})],
                                     [(F["ministry"] + " · " + F["theme"] + " · " + F["category"], {"size": 11.5})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE)
    rows = [("Problem Statement Title", F["ps_title"]), ("Theme", F["theme"]), ("PS Category", F["category"]),
            ("Team ID", F["team_id"]), ("Team Name", F["team"])]
    y = 4.2
    for k, v in rows:
        tall = 0.44 if k == "Problem Statement Title" else 0.27
        text(s, 0.55, y, 2.0, tall, [[(k.upper(), {"bold": True, "size": 9, "color": t.muted})]], t=t)
        text(s, 2.6, y - 0.03, 4.55, tall, [[(v, {"size": 12, "bold": k in ("Team ID", "Team Name")})]], t=t, spacing=1.0)
        hline(s, 0.55, y + tall + 0.01, 6.6, t.line)
        y += tall + 0.05
    text(s, 0.55, 5.96, 6.6, 0.44, [[(F["headline"], {"bold": True, "size": 20})]], t=t)
    text(s, 0.55, 6.4, 6.6, 0.36, [[(F["question"], {"size": 12, "color": t.accent})]], t=t)
    text(s, 0.55, 6.76, 6.6, 0.4, [[(F["proof_line"], {"size": 10, "color": t.accent, "bold": True})]], t=t, spacing=1.1)
    text(s, 7.5, 1.26, 5.35, 0.3, [[("LIVE WORKING SYSTEM", {"bold": True, "size": 10, "color": t.accent})]], t=t)
    picture(s, S["mgr"], 7.55, 2.5, h=3.9, frame=t.line)
    picture(s, S["nav"], 10.44, 1.72, h=4.68, frame=t.line)
    text(s, 7.5, 6.5, 5.35, 0.3, [[("Manager route review · Driver navigation — real screens",
                                    {"size": 9.5, "color": t.grey})]], t=t)


def s2(s, t, S):
    content_slide(s, t, F["titles"][1])
    text(s, 0.5, 1.2, 4, 0.28, [[("PROPOSED SOLUTION", {"bold": True, "size": 10, "color": t.muted})]], t=t)
    text(s, 0.5, 1.46, 8.8, 0.92, [[("Not the shortest road. ", {"bold": True, "size": 24}),
                                    ("The road that is usable now.", {"bold": True, "size": 24, "color": t.accent})]],
         t=t, spacing=1.0)
    text(s, 0.5, 2.38, 8.82, 0.38, [[(F["problem"] + "  ", {"size": 10.5, "color": t.grey}), (F["problem_kick"], {"size": 10.5, "bold": True, "color": t.danger})]], t=t, spacing=1.05)
    y = band(s, t, 0.45, 2.84, 8.87, 0.92, "A NORMAL ROUTER", accent=t.muted)
    chain_h(s, 0.62, y - 0.04, [(F["normal_router"][0], 1.3), (F["normal_router"][1], 2.4), (F["normal_router"][2], 1.3)],
            t, h=0.3, gap=0.16, size=10, lines={i: t.muted for i in range(3)}, colors={i: t.grey for i in range(3)})
    text(s, 6.05, y - 0.06, 3.1, 0.36, [[(F["normal_gap"][0], {"size": 9.5, "color": t.muted})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    y = band(s, t, 0.45, 3.9, 8.87, 2.28, "RASTA AI · THE SAME ROAD, DECIDED ON EVIDENCE", accent=t.accent)
    spine(s, t, 0.85, y + 0.42, 8.1,
          ["ORIGIN", "REAL ROUTE", "EVIDENCE", "POLICY", "DECISION", "MANAGER", "DRIVER"], size=8)
    cx, cy = 0.62, y + 0.72
    for lab, wd in zip(F["evidence_chips"], [0.88, 0.88, 1.4, 1.14, 1.3, 1.04, 1.4]):
        if cx + wd > 9.2:
            cx = 0.62; cy += 0.3
        pill(s, cx, cy, wd, 0.26, lab, t, fill=None, color=t.ink, line=t.line, size=9, bold=False)
        cx += wd + 0.08
    dw = (8.55 - 3 * 0.12) / 4
    dx = 0.62
    for lab, kind in F["decisions"]:
        pill(s, dx, cy + 0.38, dw, 0.34, lab, t, fill=t.c({"ok": "ok", "warn": "warn", "danger": "danger", "ink": "ink"}[kind]), size=10.5)
        dx += dw + 0.12
    rect(s, 0.45, 6.3, 8.87, 0.58, fill=t.paper, line=t.danger, rounded=True, line_w=1.25, radius=0.08)
    text(s, 0.62, 6.34, 2.45, 0.5, [[("UNKNOWN ≠ SAFE", {"bold": True, "size": 15, "color": t.danger})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 3.05, 6.36, 6.1, 0.46, [[(F["unknown_rule"], {"size": 10})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 9.5, 1.2, 3.35, 0.28, [[("MANAGER · CHECK CONDITIONS", {"bold": True, "size": 9.5, "color": t.accent})]], t=t)
    picture(s, S["evid"], 9.5, 1.58, h=4.88, frame=t.line)
    text(s, 9.5, 6.52, 3.35, 0.3, [[("Real screen · evidence · freshness · UNKNOWN", {"size": 9, "color": t.grey})]], t=t)


def s3(s, t, S):
    content_slide(s, t, F["titles"][2])
    y = band(s, t, 0.42, 1.2, 8.9, 1.14, "VERIFIED DATA", accent=t.accent)
    x, bw = 0.6, 1.4
    for lab, sub in F["sources"]:
        text(s, x, y - 0.02, bw, 0.6, [[(lab, {"bold": True, "size": 9})], [(sub, {"size": 8, "color": t.grey})]], t=t, spacing=1.0)
        x += bw + 0.08
    spine(s, t, 0.85, 2.72, 8.1, ["EVIDENCE", "POLICY", "DECISION", "MANAGER", "DRIVER", "60 s WATCH", "REASSESS"],
          size=8, above=False)
    y = 3.1
    for title, sub, accent in [("ROUTE-SPECIFIC EVIDENCE · FastAPI backend",
                                "every factor sampled along the selected road · PostgreSQL + PostGIS (Supabase) · OSRM routes, alternatives, turn steps", None),
                               ("DETERMINISTIC SAFETY POLICY",
                                "11 factors · reason codes · UNKNOWN ≠ SAFE · reviewer authorisation when hazard data is missing", t.accent)]:
        rect(s, 0.42, y, 8.9, 0.56, fill=(t.bg if accent is None else t.accent), line=t.line, rounded=True, radius=0.06)
        text(s, 0.6, y + 0.04, 8.54, 0.48, [[(title, {"bold": True, "size": 10.5, "color": t.paper if accent else t.ink})],
                                            [(sub, {"size": 9, "color": rgb("DCEFE2") if accent else t.grey})]], t=t, spacing=1.0)
        y += 0.66
    dw = (8.9 - 3 * 0.14) / 4
    dx = 0.42
    for lab, kind in F["decisions"]:
        pill(s, dx, y, dw, 0.36, lab, t, fill=t.c({"ok": "ok", "warn": "warn", "danger": "danger", "ink": "ink"}[kind]), size=11)
        dx += dw + 0.14
    y += 0.5
    chain_h(s, 0.42, y, [("MANAGER REVIEW", 1.5), ("DRIVER NAVIGATION", 1.62), ("ROUTE-AHEAD MONITOR (60 s)", 2.04),
                         ("CONDITIONS CHANGE?", 1.6), ("REASSESS / REROUTE", 1.54)], t, h=0.34, gap=0.1, size=9,
            fills={0: t.ink}, colors={0: t.on_dark}, lines={i: t.ink for i in range(5)})
    y = band(s, t, 0.42, y + 0.52, 8.9, 1.38, "BUILT WITH")
    text(s, 0.6, y, 8.54, 0.94, [
        [("CLIENTS  ", {"bold": True, "size": 9, "color": t.muted}), (F["clients"], {"size": 10})],
        [("STACK  ", {"bold": True, "size": 9, "color": t.muted}), (F["stack"], {"size": 10})],
    ], t=t, spacing=1.15, space_after=3)
    y = band(s, t, 9.42, 1.2, 3.46, 5.68, "WHO DECIDES", accent=t.accent)
    for lab, sub, kind in F["deciders"]:
        rect(s, 9.58, y + 0.02, 0.05, 0.68, fill=t.c(kind))
        text(s, 9.74, y, 3.0, 0.82, [[(lab, {"bold": True, "size": 10.5})], [(sub, {"size": 10, "color": t.grey})]], t=t, spacing=1.0)
        y += 0.92
    hline(s, 9.58, y + 0.02, 3.14, t.line)
    text(s, 9.58, y + 0.1, 3.14, 0.28, [[("GOVERNANCE CHAIN", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    yy = y + 0.44
    for i, c in enumerate(F["chain"]):
        pill(s, 9.58, yy, 3.14, 0.32, c, t, fill=None, color=t.ink, line=t.ink, size=10)
        if i < 3:
            arrow(s, 11.15, yy + 0.33, 11.15, yy + 0.44, t.ink)
        yy += 0.46


def s4(s, t, S):
    content_slide(s, t, F["titles"][3])
    text(s, 0.5, 1.1, 9.5, 0.44, [[("Not a concept. A working end-to-end prototype.", {"bold": True, "size": 22})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE)
    spine(s, t, 0.95, 2.0, 11.5, ["PLAN", "REVIEW", "DISPATCH", "ACCEPT", "VERIFY", "NAVIGATE",
                                   "OFF-ROUTE", "APPROVAL", "DELIVERY"], size=8, above=False, lab_w=1.2)
    top, hh = 2.56, 3.44
    y = band(s, t, 0.4, 2.2, 6.4, 4.2, "REAL SCREENS FROM THE CERTIFIED RUN")
    w1, _ = picture(s, S["mgr"], 0.58, top + 0.08, h=hh, frame=t.line)
    w2, _ = picture(s, S["truck"], 0.58 + w1 + 0.2, top + 0.08, h=hh, frame=t.line)
    w3, _ = picture(s, S["nav"], 0.58 + w1 + w2 + 0.4, top + 0.08, h=hh, frame=t.line)
    for cx, cw, lab in [(0.58, w1, "Manager · route review"), (0.58 + w1 + 0.2, w2, "Driver · truck check"),
                        (0.58 + w1 + w2 + 0.4, w3, "Driver · navigation")]:
        text(s, cx, top + hh + 0.14, cw, 0.28, [[(lab, {"size": 9, "color": t.grey})]], t=t, align=PP_ALIGN.CENTER)
    y = band(s, t, 6.95, 2.2, 5.93, 4.2, "PROOF", accent=t.accent)
    cx, cw = 7.13, 5.57
    text(s, cx, y + 0.06, cw, 0.6, [[(F["run_line"], {"size": 11.5})]], t=t, spacing=1.05)
    yy = y + 0.76
    for n, lab in F["proof"]:
        stat(s, cx, yy, cw, n, lab, t, num_size=17, lab_size=11, gap=1.02)
        yy += 0.44
    runs = []
    for i, (n, lab) in enumerate(F["tests"]):
        runs += [(n + " ", {"bold": True, "size": 13, "color": t.accent}),
                 (lab + ("  ·  " if i < 2 else " tests"), {"size": 10.5})]
    text(s, cx, yy + 0.02, cw, 0.34, [runs], t=t, anchor=MSO_ANCHOR.MIDDLE)
    pill(s, cx, yy + 0.5, cw, 0.38, "PHYSICAL ANDROID · CERTIFIED", t, fill=t.accent, size=11.5)
    text(s, cx, yy + 1.0, cw, 0.34, [[("Canonical demo  ", {"bold": True, "size": 10.5, "color": t.muted}),
                                      (F["corridor"], {"bold": True, "size": 11})]], t=t)
    text(s, 0.5, 6.5, 12.35, 0.42, [[("KNOWN LIMITS → MITIGATION   ", {"bold": True, "size": 9, "color": t.muted}),
                                     (F["limits"], {"size": 9, "color": t.grey})]], t=t, spacing=1.05)


def s5(s, t, S):
    content_slide(s, t, F["titles"][4])
    text(s, 0.5, 1.16, 8.8, 0.82, [[("RASTA AI does not ask only ", {"size": 17.5, "color": t.grey}),
                                    ("“Which road is shortest?”", {"size": 17.5, "bold": True}),
                                    ("  It asks  ", {"size": 17.5, "color": t.grey}),
                                    ("“Can this truck reliably use this corridor now?”",
                                     {"size": 17.5, "bold": True, "color": t.accent})]], t=t, spacing=1.05)
    text(s, 0.5, 2.02, 8.8, 0.32, [[(F["supplies"], {"bold": True, "size": 12.5, "color": t.accent}),
                                    ("   — essential logistics for hill communities, decided on evidence",
                                     {"size": 11, "color": t.grey})]], t=t)
    spine(s, t, 0.9, 2.86, 7.9, ["FLEET MANAGER", "DRIVER", "REMOTE COMMUNITY", "GOVERNMENT"], size=8.5)
    for i, (h, b) in enumerate(F["who"]):
        x = 0.5 + i * 2.2
        text(s, x, 3.02, 2.08, 1.0, [[(b, {"size": 10.5})]], t=t, spacing=1.05)
    y = band(s, t, 0.42, 4.14, 8.9, 1.66, "DEMONSTRATED TODAY", accent=t.accent)
    for i, (n, lab) in enumerate(F["caps"]):
        col, r = divmod(i, 3)
        stat(s, 0.62 + col * 4.32, y + 0.02 + r * 0.4, 4.2, n, lab, t, num_size=17, lab_size=10.5,
             align=PP_ALIGN.RIGHT, gap=1.0)
    y = band(s, t, 0.42, 5.9, 8.9, 0.98, "HUMAN GOVERNANCE")
    chain_h(s, 0.6, y + 0.06, [(c, 1.95) for c in F["chain"]], t, h=0.34, gap=0.26, size=10,
            fills={0: t.ink}, colors={0: t.on_dark}, lines={i: t.ink for i in range(4)})
    y = band(s, t, 9.42, 1.2, 3.46, 5.68, "REAL SCREENS · APK 1.0.18")
    w1, _ = picture(s, S["lang"], 9.6, y + 0.06, h=2.5, frame=t.line)
    w2, _ = picture(s, S["mobile"], 9.6 + w1 + 0.16, y + 0.06, h=2.5, frame=t.line)
    text(s, 9.6, y + 2.62, w1, 0.26, [[("Driver · 23 languages", {"size": 9, "color": t.grey})]], t=t, align=PP_ALIGN.CENTER)
    text(s, 9.6 + w1 + 0.16, y + 2.62, w2, 0.26, [[("Manager · mobile", {"size": 9, "color": t.grey})]], t=t, align=PP_ALIGN.CENTER)
    text(s, 9.6, y + 2.98, 3.1, 1.9, [[(F["screens_note"], {"size": 10, "color": t.grey})]], t=t, spacing=1.05)


def s6(s, t, S):
    content_slide(s, t, F["titles"][5])
    y = band(s, t, 0.42, 1.2, 7.4, 4.88, "RESEARCH / EVIDENCE SOURCES BEHIND THE ROUTE DECISION")
    gw = 3.4
    for i, (lab, names, what) in enumerate(F["groups"]):
        col, row = i % 2, i // 2
        x = 0.58 + col * (gw + 0.24)
        yy = y + 0.06 + row * 1.42
        hline(s, x, yy, gw, t.accent, 1.5)
        text(s, x, yy + 0.06, gw, 1.2, [[(lab, {"bold": True, "size": 9.5, "color": t.accent})],
                                        [(names, {"bold": True, "size": 11})],
                                        [(what, {"size": 10, "color": t.grey})]], t=t, spacing=1.05, space_after=3)
    mx, mw = 8.22, 4.5
    band(s, t, 8.05, 1.2, 4.83, 4.88, "EXPERIMENTAL LANDSLIDE RESEARCH", accent=t.accent2)
    text(s, mx, 1.66, 1.85, 0.94, [[(F["ml_recall"], {"bold": True, "size": 44})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, mx + 1.85, 1.7, mw - 1.85, 0.88, [[(F["ml_recall_what"], {"bold": True, "size": 12})],
                                              [(F["ml_recall_sub"], {"size": 9.5, "color": t.grey})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE, spacing=1.05)
    rect(s, mx, 2.74, mw, 0.8, fill=t.ink, rounded=True, radius=0.08)
    text(s, mx, 2.8, mw, 0.7, [[(F["ml_gate_small"], {"bold": True, "size": 11, "color": t.muted})],
                               [(F["ml_gate_big"], {"bold": True, "size": 21, "color": t.on_dark})]],
         t=t, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, spacing=1.0)
    text(s, mx, 3.62, mw, 0.32, [[(F["ml_fpr"], {"bold": True, "size": 13, "color": t.danger}),
                                  ("   " + F["ml_fpr_why"], {"size": 10, "color": t.grey})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    spine(s, t, mx + 0.35, 4.32, mw - 0.7, ["TRAIN", "NER TEST", "SIGNAL", "FP HIGH", "GATE", "NOT DEPLOYED"],
          size=7, above=False, color=t.accent2, lab_w=0.86)
    text(s, mx, 4.78, mw, 0.7, [[(F["ml_caption_lead"] + " ", {"bold": True, "size": 11, "color": t.accent}),
                                 (F["ml_caption"], {"size": 10.5})]], t=t, spacing=1.05)
    text(s, mx, 5.48, mw, 0.5, [[(F["ml_metrics"], {"size": 8, "color": t.grey})]], t=t, spacing=1.05)
    hline(s, 0.5, 6.18, 12.35, t.line)
    text(s, 0.5, 6.24, 3, 0.26, [[("REFERENCES", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    text(s, 0.5, 6.46, 12.35, 0.48, [[(F["refs"], {"size": 9, "color": t.grey})]], t=t, spacing=1.1)


SLIDES = [s1, s2, s3, s4, s5, s6]
