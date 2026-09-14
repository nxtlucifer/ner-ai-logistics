"""V04 LEDGER — the deck as an audit register.

The product's claim is that every route decision is auditable, so the deck is
set like a register: monospace keys in a fixed left gutter, ruled rows, no
decoration. Nothing is asserted without a key beside it.
"""
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from deckkit import (FACTS as F, Theme, arrow, chain_h, content_slide, hline, picture, pill,
                     rect, stat, text, title_slide_prep)

THEME = Theme(slug="V04_LEDGER", label="Ledger", font="Arial", mono="Courier New",
              accent="0F766E", accent2="115E59", ok="15803D", warn="B45309", danger="B91C1C",
              ink="111827", grey="4B5563", muted="9CA3AF", line="D8DEE4", bg="F6F7F8",
              radius=0.0, border=1.0,
              note="An audit register: monospace keys in a fixed gutter, ruled rows, no decoration.")

GUT = 1.62   # width of the monospace key gutter


def key(s, x, y, w, k, t, size=8.5, color=None):
    text(s, x, y, w, 0.26, [[(k, {"font": t.mono, "size": size, "color": color or t.muted, "bold": True})]], t=t)


def row(s, x, y, w, k, body, t, body_size=11, gutter=GUT, rule=True, bold=False, color=None):
    key(s, x, y + 0.02, gutter - 0.12, k, t)
    tb = text(s, x + gutter, y, w - gutter, 0.3, [body if isinstance(body, list) else
              [(body, {"size": body_size, "bold": bold, "color": color or t.ink})]], t=t)
    if rule:
        hline(s, x, y + 0.32, w, t.line)
    return tb


def s1(s, t, S):
    title_slide_prep(s)
    key(s, 0.55, 1.26, 4, "RECORD / SIH26002 / TEAM-17", t, size=9, color=t.accent)
    text(s, 0.55, 1.5, 6.6, 0.66, [[(F["name"], {"bold": True, "size": 38})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 0.55, 2.16, 6.6, 0.38, [[(F["tagline"], {"size": 12, "color": t.grey})]], t=t)
    hline(s, 0.55, 2.66, 6.6, t.ink, 1.5)
    y = 2.76
    for k, v, b in [("PS.ID", F["ps_id"], True), ("PS.TITLE", F["ps_title"], False),
                    ("THEME", F["theme"], False), ("CATEGORY", F["category"], False),
                    ("TEAM.ID", F["team_id"], True), ("TEAM.NAME", F["team"], True),
                    ("MINISTRY", F["ministry"], False)]:
        tall = 0.5 if k == "PS.TITLE" else 0.34
        key(s, 0.55, y + 0.03, GUT - 0.12, k, t)
        text(s, 0.55 + GUT, y - 0.02, 6.6 - GUT, tall,
             [[(v, {"size": 12.5, "bold": b, "color": t.accent if k == "PS.ID" else t.ink})]], t=t, spacing=1.0)
        hline(s, 0.55, y + tall, 6.6, t.line)
        y += tall + 0.06
    hline(s, 0.55, 5.66, 6.6, t.ink, 1.5)
    text(s, 0.55, 5.76, 6.6, 0.44, [[(F["headline"], {"bold": True, "size": 20})]], t=t)
    text(s, 0.55, 6.2, 6.6, 0.36, [[(F["question"], {"size": 12, "color": t.accent})]], t=t)
    key(s, 0.55, 6.62, 6.6, "STATUS: WORKING PROTOTYPE / PHYSICAL-PHONE VALIDATED / CORRIDOR GUWAHATI-SHILLONG",
        t, size=8.5, color=t.ok)
    key(s, 7.5, 1.26, 5.35, "EXHIBIT A — LIVE WORKING SYSTEM", t, size=9, color=t.accent)
    hline(s, 7.5, 1.52, 5.35, t.ink, 1.2)
    picture(s, S["mgr"], 7.55, 2.48, h=3.92, frame=t.line)
    picture(s, S["nav"], 10.44, 1.72, h=4.68, frame=t.line)
    key(s, 7.5, 6.5, 5.35, "MANAGER ROUTE REVIEW / DRIVER NAVIGATION — REAL SCREENS", t)


def s2(s, t, S):
    content_slide(s, t, F["titles"][1])
    key(s, 0.5, 1.2, 4, "IDEA / PROPOSED SOLUTION", t, size=9, color=t.accent)
    text(s, 0.5, 1.44, 8.8, 0.9, [[("Not the shortest road. ", {"bold": True, "size": 24}),
                                   ("The road that is operationally usable now.",
                                    {"bold": True, "size": 24, "color": t.accent})]], t=t, spacing=1.0)
    hline(s, 0.5, 2.36, 8.82, t.ink, 1.5)
    row(s, 0.5, 2.44, 8.82, "PROBLEM", [(F["problem"], {"size": 10.5, "color": t.grey})], t)
    y = 2.88
    rect(s, 0.5, y, 0.05, 1.34, fill=t.muted)
    key(s, 0.68, y, 2.3, "BASELINE / NORMAL ROUTER", t)
    text(s, 0.68, y + 0.26, 3.3, 0.46, [[("  →  ".join(F["normal_router"]), {"size": 11})]], t=t)
    text(s, 0.68, y + 0.62, 8.6, 0.7, [[(F["normal_gap"][0] + "  " + F["normal_gap"][1],
                                         {"size": 10.5, "color": t.grey})]], t=t, spacing=1.05)
    hline(s, 0.5, y + 1.32, 8.82, t.line)
    y += 1.42
    rect(s, 0.5, y, 0.05, 2.06, fill=t.accent)
    key(s, 0.68, y, 3.4, "RASTA AI / EVIDENCE BEFORE THE ROAD", t, color=t.accent)
    text(s, 0.68, y + 0.26, 8.5, 0.3, [[("Origin  →  real OSRM route, alternatives, turn steps  →  route-specific evidence",
                                         {"size": 11})]], t=t)
    cx, cy = 0.68, y + 0.6
    for lab, wd in zip(F["evidence_chips"], [0.88, 0.88, 1.4, 1.14, 1.3, 1.04, 1.4]):
        if cx + wd > 9.32:
            cx = 0.68; cy += 0.3
        pill(s, cx, cy, wd, 0.26, lab, t, fill=None, color=t.ink, line=t.line, size=9, bold=False, rounded=False)
        cx += wd + 0.08
    dy = cy + 0.38
    dw = (8.64 - 3 * 0.12) / 4
    dx = 0.68
    for lab, kind in F["decisions"]:
        pill(s, dx, dy, dw, 0.34, lab, t, fill=t.c({"ok": "ok", "warn": "warn", "danger": "danger", "ink": "ink"}[kind]),
             size=10.5, rounded=False)
        dx += dw + 0.12
    text(s, 0.68, dy + 0.42, 8.6, 0.3, [[("Manager governance  →  driver navigation, danger context, 23 languages, offline package",
                                          {"size": 10.5})]], t=t)
    hline(s, 0.5, 6.26, 8.82, t.danger, 1.5)
    text(s, 0.5, 6.34, 2.6, 0.4, [[("UNKNOWN ≠ SAFE", {"bold": True, "size": 16, "color": t.danger})]], t=t)
    text(s, 3.1, 6.38, 6.22, 0.46, [[(F["unknown_rule"], {"size": 10.5})]], t=t, spacing=1.05)
    key(s, 9.5, 1.2, 3.35, "EXHIBIT B — CHECK CONDITIONS", t, size=9, color=t.accent)
    hline(s, 9.5, 1.46, 3.35, t.ink, 1.2)
    picture(s, S["evid"], 9.5, 1.6, h=4.86, frame=t.line)
    key(s, 9.5, 6.54, 3.35, "REAL SCREEN / EVIDENCE / FRESHNESS / UNKNOWN", t)


def s3(s, t, S):
    content_slide(s, t, F["titles"][2])
    key(s, 0.5, 1.18, 6, "PIPELINE / VERIFIED DATA → DECISION → DRIVER", t, size=9, color=t.accent)
    hline(s, 0.5, 1.44, 8.82, t.ink, 1.5)
    y = 1.52
    for k, lab in F["sources"]:
        key(s, 0.5, y + 0.02, GUT - 0.12, k.replace(" ", "."), t)
        text(s, 0.5 + GUT, y - 0.02, 8.82 - GUT, 0.3, [[(lab, {"size": 10.5})]], t=t)
        hline(s, 0.5, y + 0.28, 8.82, t.line)
        y += 0.34
    y += 0.06
    for k, title, sub, accent in [("EVIDENCE", "ROUTE-SPECIFIC EVIDENCE · FastAPI backend",
                                   "every factor sampled along the selected road · PostgreSQL + PostGIS (Supabase) · OSRM routes, alternatives, turn steps", None),
                                  ("POLICY", "DETERMINISTIC SAFETY POLICY",
                                   "11 factors · reason codes · UNKNOWN ≠ SAFE · reviewer authorisation when hazard data is missing", t.accent)]:
        key(s, 0.5, y + 0.04, GUT - 0.12, k, t, color=accent or t.muted)
        text(s, 0.5 + GUT, y, 8.82 - GUT, 0.5, [[(title, {"bold": True, "size": 11, "color": accent or t.ink})],
                                                [(sub, {"size": 9.5, "color": t.grey})]], t=t, spacing=1.0)
        hline(s, 0.5, y + 0.52, 8.82, t.line)
        y += 0.6
    key(s, 0.5, y + 0.06, GUT - 0.12, "DECISION", t)
    dw = (8.82 - GUT - 3 * 0.12) / 4
    dx = 0.5 + GUT
    for lab, kind in F["decisions"]:
        pill(s, dx, y, dw, 0.34, lab, t, fill=t.c({"ok": "ok", "warn": "warn", "danger": "danger", "ink": "ink"}[kind]),
             size=10.5, rounded=False)
        dx += dw + 0.12
    y += 0.44
    key(s, 0.5, y + 0.06, GUT - 0.12, "LOOP", t)
    chain_h(s, 0.5 + GUT, y, [("MANAGER REVIEW", 1.3), ("DRIVER NAVIGATION", 1.42), ("ROUTE-AHEAD 60 s", 1.36),
                              ("CONDITIONS CHANGE?", 1.56), ("REASSESS", 0.96)], t, h=0.32, gap=0.07, size=8,
            fills={0: t.ink}, colors={0: t.on_dark}, lines={i: t.ink for i in range(5)})
    y += 0.46
    hline(s, 0.5, y, 8.82, t.line)
    for k, v in [("CLIENTS", F["clients"]), ("STACK", F["stack"])]:
        key(s, 0.5, y + 0.1, GUT - 0.12, k, t)
        tb = text(s, 0.5 + GUT, y + 0.06, 8.82 - GUT, 0.44, [[(v, {"size": 10})]], t=t, spacing=1.1)
        y += 0.46
    key(s, 9.5, 1.18, 3.35, "AUTHORITY / WHO DECIDES", t, size=9, color=t.accent)
    hline(s, 9.5, 1.44, 3.35, t.ink, 1.2)
    y = 1.54
    for lab, sub, kind in F["deciders"]:
        rect(s, 9.5, y + 0.02, 0.05, 0.68, fill=t.c(kind))
        text(s, 9.66, y, 3.19, 0.82, [[(lab, {"bold": True, "size": 10.5})], [(sub, {"size": 10, "color": t.grey})]],
             t=t, spacing=1.0)
        y += 0.92
    hline(s, 9.5, y, 3.35, t.line)
    key(s, 9.5, y + 0.08, 3.35, "GOVERNANCE CHAIN", t)
    yy = y + 0.36
    for i, c in enumerate(F["chain"]):
        pill(s, 9.5, yy, 3.35, 0.32, c, t, fill=None, color=t.ink, line=t.ink, size=10, rounded=False)
        if i < 3:
            arrow(s, 11.17, yy + 0.33, 11.17, yy + 0.44, t.ink)
        yy += 0.45


def s4(s, t, S):
    content_slide(s, t, F["titles"][3])
    key(s, 0.5, 1.12, 6, "RUN LOG / PHYSICAL ANDROID / HOSTED BACKEND", t, size=9, color=t.accent)
    text(s, 0.5, 1.34, 9.5, 0.42, [[("Not a concept. A working end-to-end prototype.", {"bold": True, "size": 22})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE)
    widths = [0.8, 0.95, 1.1, 1.0, 1.35, 1.15, 1.15, 2.25, 1.1]
    chain_h(s, 0.5, 1.84, list(zip(F["lifecycle"], widths)), t, h=0.32, gap=0.11, size=8.5,
            fills={0: t.accent, 1: t.accent, 7: t.accent, 8: t.ok},
            colors={i: t.on_dark for i in (0, 1, 7, 8)},
            lines={i: t.ink for i in (2, 3, 4, 5, 6)})
    hline(s, 0.5, 2.3, 12.35, t.ink, 1.5)
    top, hh = 2.46, 3.5
    w1, _ = picture(s, S["mgr"], 0.5, top, h=hh, frame=t.line)
    w2, _ = picture(s, S["truck"], 0.5 + w1 + 0.2, top, h=hh, frame=t.line)
    w3, _ = picture(s, S["nav"], 0.5 + w1 + w2 + 0.4, top, h=hh, frame=t.line)
    for cx, cw, lab in [(0.5, w1, "MANAGER / ROUTE REVIEW"), (0.5 + w1 + 0.2, w2, "DRIVER / TRUCK CHECK"),
                        (0.5 + w1 + w2 + 0.4, w3, "DRIVER / NAVIGATION")]:
        key(s, cx, top + hh + 0.06, cw, lab, t)
    px = 0.5 + w1 + w2 + w3 + 0.74
    pw = 12.85 - px
    key(s, px, 2.44, pw, "EVIDENCE OF EXECUTION", t, size=9, color=t.accent)
    text(s, px, 2.7, pw, 0.6, [[("The whole lifecycle above was run end to end on a physical Android phone against "
                                "the hosted backend, on the real road.", {"size": 11.5})]], t=t, spacing=1.05)
    y = 3.4
    for n, lab in F["proof"]:
        hline(s, px, y - 0.04, pw, t.line)
        stat(s, px, y, pw, n, lab, t, num_size=17, lab_size=11, gap=1.02)
        y += 0.44
    hline(s, px, y - 0.04, pw, t.line)
    runs = []
    for i, (n, lab) in enumerate(F["tests"]):
        runs += [(n + " ", {"bold": True, "size": 13, "color": t.accent}),
                 (lab + ("  ·  " if i < 2 else " tests"), {"size": 10.5})]
    text(s, px, y, pw, 0.34, [runs], t=t, anchor=MSO_ANCHOR.MIDDLE)
    y += 0.46
    pill(s, px, y, pw, 0.36, "PHYSICAL ANDROID · CERTIFIED", t, fill=t.ok, size=11, rounded=False)
    key(s, px, y + 0.46, pw, "CANONICAL DEMO: GUWAHATI → SHILLONG / ≈ 98.8 KM REAL ROUTE", t)
    hline(s, 0.5, 6.42, 12.35, t.line)
    key(s, 0.5, 6.48, 2.2, "KNOWN LIMITS", t, color=t.warn)
    text(s, 0.5 + GUT + 0.4, 6.46, 12.35 - GUT - 0.4, 0.46, [[(F["limits"], {"size": 9.5, "color": t.grey})]],
         t=t, spacing=1.05)


def s5(s, t, S):
    content_slide(s, t, F["titles"][4])
    key(s, 0.5, 1.14, 6, "IMPACT / WHO GAINS WHAT", t, size=9, color=t.accent)
    text(s, 0.5, 1.38, 8.8, 0.82, [[("RASTA AI does not ask only ", {"size": 17.5, "color": t.grey}),
                                    ("“Which road is shortest?”", {"size": 17.5, "bold": True}),
                                    ("  It asks  ", {"size": 17.5, "color": t.grey}),
                                    ("“Can this truck reliably use this corridor now?”",
                                     {"size": 17.5, "bold": True, "color": t.accent})]], t=t, spacing=1.05)
    text(s, 0.5, 2.24, 8.8, 0.32, [[(F["supplies"], {"bold": True, "size": 12.5, "color": t.ok}),
                                    ("   — essential logistics for hill communities, decided on evidence",
                                     {"size": 11, "color": t.grey})]], t=t)
    hline(s, 0.5, 2.66, 8.82, t.ink, 1.5)
    y = 2.76
    for h, b in F["who"]:
        key(s, 0.5, y + 0.04, 2.1, h.replace(" / ", "/").replace(" ", "."), t, color=t.accent)
        text(s, 0.5 + 2.2, y, 6.62, 0.34, [[(b, {"size": 11})]], t=t)
        hline(s, 0.5, y + 0.34, 8.82, t.line)
        y += 0.42
    key(s, 0.5, y + 0.06, 6, "DEMONSTRATED TODAY", t, size=9, color=t.accent)
    y += 0.32
    for i, (n, lab) in enumerate(F["caps"]):
        col, r = divmod(i, 3)
        stat(s, 0.5 + col * 4.44, y + r * 0.42, 4.3, n, lab, t, num_size=17, lab_size=10.5,
             align=PP_ALIGN.RIGHT, gap=1.0)
    y += 3 * 0.42 + 0.1
    hline(s, 0.5, y, 8.82, t.ink, 1.5)
    key(s, 0.5, y + 0.06, 6, "HUMAN GOVERNANCE — AI HAS NO UNCONTROLLED AUTHORITY", t)
    chain_h(s, 0.5, y + 0.34, [(c, 2.04) for c in F["chain"]], t, h=0.34, gap=0.22, size=10,
            fills={0: t.ink}, colors={0: t.on_dark}, lines={i: t.ink for i in range(4)})
    key(s, 9.5, 1.14, 3.35, "EXHIBIT C — REAL SCREENS / APK 1.0.18", t, size=9, color=t.accent)
    hline(s, 9.5, 1.4, 3.35, t.ink, 1.2)
    w1, _ = picture(s, S["lang"], 9.5, 1.54, h=2.5, frame=t.line)
    w2, _ = picture(s, S["mobile"], 9.5 + w1 + 0.16, 1.54, h=2.5, frame=t.line)
    key(s, 9.5, 4.14, w1, "DRIVER / 23 LANGUAGES", t)
    key(s, 9.5 + w1 + 0.16, 4.14, w2, "MANAGER / MOBILE", t)
    text(s, 9.5, 4.46, 3.35, 2.0, [[("Real screens, APK 1.0.18. One login, server-decided role: a manager gets a "
                                     "mobile fleet view, a driver gets navigation. Each language shows its status — "
                                     "Verified, Draft or English fallback — so nobody is misled.",
                                     {"size": 10, "color": t.grey})]], t=t, spacing=1.05)


def s6(s, t, S):
    content_slide(s, t, F["titles"][5])
    key(s, 0.5, 1.18, 7.4, "SOURCE REGISTER / EVIDENCE BEHIND THE ROUTE DECISION", t, size=9, color=t.accent)
    hline(s, 0.5, 1.44, 7.42, t.ink, 1.5)
    y = 1.52
    for lab, names, what in F["groups"]:
        key(s, 0.5, y + 0.03, 1.9, lab.replace(" / ", "/").replace(" ", "."), t, color=t.accent)
        text(s, 2.45, y, 4.97, 0.72, [[(names, {"bold": True, "size": 11})],
                                      [(what, {"size": 9.5, "color": t.grey})]], t=t, spacing=1.0)
        hline(s, 0.5, y + 0.74, 7.42, t.line)
        y += 0.82
    mx, mw = 8.2, 4.65
    key(s, mx, 1.18, mw, "EXPERIMENTAL LANDSLIDE RESEARCH", t, size=9, color=t.accent)
    hline(s, mx, 1.44, mw, t.ink, 1.5)
    text(s, mx, 1.56, 1.9, 0.94, [[(F["ml_recall"], {"bold": True, "size": 44})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, mx + 1.9, 1.6, mw - 1.9, 0.88, [[(F["ml_recall_what"], {"bold": True, "size": 12})],
                                            [(F["ml_recall_sub"], {"size": 9.5, "color": t.grey})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE, spacing=1.05)
    rect(s, mx, 2.62, mw, 0.8, fill=t.ink)
    text(s, mx, 2.68, mw, 0.7, [[(F["ml_gate_small"], {"font": t.mono, "bold": True, "size": 10.5, "color": t.muted})],
                                [(F["ml_gate_big"], {"bold": True, "size": 21, "color": t.on_dark})]],
         t=t, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, spacing=1.0)
    text(s, mx, 3.5, mw, 0.32, [[(F["ml_fpr"], {"bold": True, "size": 13, "color": t.danger}),
                                 ("   " + F["ml_fpr_why"], {"size": 10, "color": t.grey})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    fy = 3.9
    for r in ([(F["ml_flow"][0], 0.8), (F["ml_flow"][1], 1.64), (F["ml_flow"][2], 1.8)],
              [(F["ml_flow"][3], 1.98), (F["ml_flow"][4], 1.1), (F["ml_flow"][5], 1.28)]):
        chain_h(s, mx, fy, r, t, h=0.28, gap=0.08, size=8, lines={i: t.ink for i in range(3)}, )
        fy += 0.38
    text(s, mx, 4.7, mw, 0.68, [[(F["ml_caption_lead"] + " ", {"bold": True, "size": 11, "color": t.accent}),
                                 (F["ml_caption"], {"size": 10.5})]], t=t, spacing=1.05)
    text(s, mx, 5.38, mw, 0.6, [[(F["ml_metrics"], {"font": t.mono, "size": 7.5, "color": t.grey})]], t=t, spacing=1.1)
    hline(s, 0.5, 6.16, 12.35, t.ink, 1.5)
    key(s, 0.5, 6.22, 3, "REFERENCES", t)
    text(s, 0.5, 6.44, 12.35, 0.48, [[(F["refs"], {"size": 9, "color": t.grey})]], t=t, spacing=1.1)


SLIDES = [s1, s2, s3, s4, s5, s6]
