"""V08 LIFECYCLE — read every slide left to right, in bands.

Each slide is three horizontal bands with a coloured rail on the left carrying
the band's name, so a judge reads the deck the way the trip actually runs.
"""
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from deckkit import (FACTS as F, Theme, chain_h, chain_v, content_slide, hline, picture,
                     pill, rect, stat, text, title_slide_prep)

THEME = Theme(slug="V08_LIFECYCLE", label="Lifecycle", font="Calibri", accent="1E4E8C",
              accent2="C2410C", ok="15803D", warn="C2410C", danger="B91C1C", ink="16202B",
              grey="55636F", muted="94A3B0", line="DCE3E9", bg="F3F6F9", radius=0.05, border=1.0,
              note="Three horizontal bands per slide, each with a named rail, read left to right.")

RAIL = 0.92


def rail_band(s, t, x, y, w, h, name, color=None, fill=None):
    """A band with a coloured rail on the left carrying its name."""
    col = color or t.accent
    rect(s, x, y, w, h, fill=fill or t.paper, line=t.line, rounded=True, line_w=1.0, radius=0.05)
    rect(s, x, y, RAIL, h, fill=col, rounded=True, radius=0.05)
    rect(s, x + RAIL - 0.1, y, 0.1, h, fill=col)
    words = name.split()
    text(s, x + 0.06, y, RAIL - 0.14, h, [[(w_, {"bold": True, "size": 8.5, "color": t.paper})] for w_ in words],
         t=t, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, spacing=1.0)
    return x + RAIL + 0.16


def s1(s, t, S):
    title_slide_prep(s)
    text(s, 0.55, 1.28, 6.6, 0.68, [[(F["name"], {"bold": True, "size": 39})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 0.58, 1.96, 6.6, 0.38, [[(F["tagline"], {"size": 12, "color": t.grey})]], t=t)
    cx = rail_band(s, t, 0.5, 2.44, 6.7, 1.1, "THE ASK")
    pill(s, cx, 2.62, 1.9, 0.54, F["ps_id"], t, fill=t.accent, size=21)
    text(s, cx + 2.06, 2.62, 3.8, 0.54, [[("PROBLEM STATEMENT ID", {"bold": True, "size": 9, "color": t.muted})],
                                         [(F["ministry"] + " · " + F["theme"] + " · " + F["category"], {"size": 11})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE)
    cx = rail_band(s, t, 0.5, 3.64, 6.7, 1.94, "THE RECORD")
    y = 3.76
    for k, v in [("Problem Statement Title", F["ps_title"]), ("Theme", F["theme"]),
                 ("PS Category", F["category"]), ("Team ID", F["team_id"]), ("Team Name", F["team"])]:
        tall = 0.44 if k == "Problem Statement Title" else 0.26
        text(s, cx, y, 1.9, tall, [[(k.upper(), {"bold": True, "size": 8.5, "color": t.muted})]], t=t)
        text(s, cx + 1.96, y - 0.03, 6.7 - RAIL - 2.2, tall,
             [[(v, {"size": 11.5, "bold": k in ("Team ID", "Team Name")})]], t=t, spacing=1.0)
        y += tall + 0.04
    cx = rail_band(s, t, 0.5, 5.68, 6.7, 1.24, "THE POINT", color=t.accent2)
    text(s, cx, 5.78, 5.5, 0.44, [[(F["headline"], {"bold": True, "size": 19})]], t=t)
    text(s, cx, 6.2, 5.5, 0.34, [[(F["question"], {"size": 11.5, "color": t.accent})]], t=t)
    text(s, cx, 6.54, 5.5, 0.34, [[(F["proof_line"], {"size": 9, "color": t.ok, "bold": True})]], t=t)
    text(s, 7.45, 1.28, 5.4, 0.28, [[("LIVE WORKING SYSTEM", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    picture(s, S["mgr"], 7.5, 2.5, h=3.9, frame=t.line)
    picture(s, S["nav"], 10.4, 1.68, h=4.72, frame=t.line)
    text(s, 7.45, 6.5, 5.4, 0.3, [[("Manager route review · Driver navigation — real screens",
                                    {"size": 9.5, "color": t.grey})]], t=t)


def s2(s, t, S):
    content_slide(s, t, F["titles"][1])
    text(s, 0.5, 1.2, 8.82, 0.9, [[("Not the shortest road. ", {"bold": True, "size": 23}),
                                   ("The road that is operationally usable now.",
                                    {"bold": True, "size": 23, "color": t.accent})]], t=t, spacing=1.0)
    cx = rail_band(s, t, 0.45, 2.16, 8.87, 0.92, "TODAY", color=t.muted)
    chain_h(s, cx, 2.38, [(F["normal_router"][0], 1.2), (F["normal_router"][1], 2.1), (F["normal_router"][2], 1.2)],
            t, h=0.3, gap=0.14, size=9.5, lines={i: t.muted for i in range(3)}, colors={i: t.grey for i in range(3)})
    text(s, cx + 5.0, 2.36, 2.7, 0.36, [[(F["normal_gap"][1], {"size": 9, "color": t.muted})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    cx = rail_band(s, t, 0.45, 3.18, 8.87, 2.28, "RASTA AI")
    text(s, cx, 3.26, 7.6, 0.28, [[("Origin → real OSRM route, alternatives, turn steps → route-specific evidence",
                                    {"size": 10.5})]], t=t)
    ex, ey = cx, 3.58
    for lab, wd in zip(F["evidence_chips"], [0.86, 0.86, 1.36, 1.1, 1.26, 1.0, 1.36]):
        if ex + wd > 9.2:
            ex = cx; ey += 0.3
        pill(s, ex, ey, wd, 0.26, lab, t, fill=None, color=t.ink, line=t.line, size=9, bold=False)
        ex += wd + 0.08
    dw = (9.2 - cx - 3 * 0.1) / 4
    dx = cx
    for lab, kind in F["decisions"]:
        pill(s, dx, ey + 0.4, dw, 0.34, lab, t, fill=t.c({"ok": "ok", "warn": "warn", "danger": "danger", "ink": "ink"}[kind]), size=10.5)
        dx += dw + 0.1
    text(s, cx, ey + 0.82, 7.6, 0.3, [[("Manager governance → driver navigation, danger context, 23 languages, offline package",
                                        {"size": 10})]], t=t)
    cx = rail_band(s, t, 0.45, 5.56, 8.87, 1.3, "THE RULE", color=t.danger)
    text(s, cx, 5.66, 7.6, 0.4, [[("UNKNOWN ≠ SAFE", {"bold": True, "size": 17, "color": t.danger})]], t=t)
    text(s, cx, 6.08, 7.6, 0.66, [[(F["unknown_rule"], {"size": 10.5})]], t=t, spacing=1.05)
    text(s, 9.5, 1.2, 3.35, 0.28, [[("MANAGER · CHECK CONDITIONS", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    picture(s, S["evid"], 9.5, 1.56, h=4.9, frame=t.line)
    text(s, 9.5, 6.52, 3.35, 0.3, [[("Real screen · evidence · freshness · UNKNOWN", {"size": 9, "color": t.grey})]], t=t)


def s3(s, t, S):
    content_slide(s, t, F["titles"][2])
    cx = rail_band(s, t, 0.42, 1.2, 8.9, 1.06, "VERIFIED DATA")
    x, bw = cx, 1.28
    for lab, sub in F["sources"]:
        text(s, x, 1.32, bw, 0.6, [[(lab, {"bold": True, "size": 8.5})], [(sub, {"size": 7.5, "color": t.grey})]], t=t, spacing=1.0)
        x += bw + 0.05
    cx = rail_band(s, t, 0.42, 2.36, 8.9, 2.3, "DECISION")
    y = 2.46
    for title, sub, fill in [("ROUTE-SPECIFIC EVIDENCE · FastAPI backend",
                              "every factor sampled along the selected road · PostgreSQL + PostGIS (Supabase) · OSRM routes, alternatives, turn steps", None),
                             ("DETERMINISTIC SAFETY POLICY",
                              "11 factors · reason codes · UNKNOWN ≠ SAFE · reviewer authorisation when hazard data is missing", t.accent)]:
        rect(s, cx, y, 7.62, 0.54, fill=fill or t.bg, line=t.line, rounded=True, radius=0.05)
        text(s, cx + 0.12, y + 0.03, 7.4, 0.48, [[(title, {"bold": True, "size": 10, "color": t.paper if fill else t.ink})],
                                                 [(sub, {"size": 8.5, "color": t.line if fill else t.grey})]], t=t, spacing=1.0)
        y += 0.62
    dw = (7.62 - 3 * 0.12) / 4
    dx = cx
    for lab, kind in F["decisions"]:
        pill(s, dx, y, dw, 0.34, lab, t, fill=t.c({"ok": "ok", "warn": "warn", "danger": "danger", "ink": "ink"}[kind]), size=10.5)
        dx += dw + 0.12
    y += 0.46
    chain_h(s, cx, y, [("MANAGER REVIEW", 1.4), ("DRIVER NAVIGATION", 1.5), ("ROUTE-AHEAD 60 s", 1.42),
                       ("CONDITIONS CHANGE?", 1.6), ("REASSESS", 1.04)], t, h=0.32, gap=0.08, size=8,
            fills={0: t.ink}, colors={0: t.on_dark}, lines={i: t.ink for i in range(5)})
    cx = rail_band(s, t, 0.42, 4.76, 8.9, 2.1, "BUILT WITH", color=t.accent2)
    text(s, cx, 4.86, 7.62, 1.9, [
        [("CLIENTS  ", {"bold": True, "size": 9, "color": t.muted}), (F["clients"], {"size": 10})],
        [("STACK  ", {"bold": True, "size": 9, "color": t.muted}), (F["stack"], {"size": 10})],
        [("EVIDENCE  ", {"bold": True, "size": 9, "color": t.muted}),
         ("Open-Meteo / MET Norway · NDMA SACHET · GloFAS · NASA historical landslides · OpenTopoData / Copernicus DEM", {"size": 10})],
        [("Re-scored every 60 s along the road ahead; a reroute is proposed to the manager, never applied silently.",
          {"size": 9.5, "color": t.grey})],
    ], t=t, spacing=1.15, space_after=3)
    text(s, 9.5, 1.2, 3.35, 0.28, [[("WHO DECIDES", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    hline(s, 9.5, 1.48, 3.35, t.ink, 1.5)
    y = 1.6
    for lab, sub, kind in F["deciders"]:
        rect(s, 9.5, y + 0.02, 0.05, 0.68, fill=t.c(kind))
        text(s, 9.66, y, 3.19, 0.82, [[(lab, {"bold": True, "size": 10.5})], [(sub, {"size": 10, "color": t.grey})]], t=t, spacing=1.0)
        y += 0.92
    hline(s, 9.5, y + 0.02, 3.35, t.line)
    text(s, 9.5, y + 0.1, 3.35, 0.28, [[("GOVERNANCE CHAIN", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    chain_v(s, 9.5, 3.35, y + 0.44, [(c, None, t.ink, t.ink) for c in F["chain"]], t, h=0.32, gap=0.14, size=10)


def s4(s, t, S):
    content_slide(s, t, F["titles"][3])
    text(s, 0.5, 1.12, 9.5, 0.4, [[("Not a concept. A working end-to-end prototype.", {"bold": True, "size": 21})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE)
    cx = rail_band(s, t, 0.42, 1.6, 12.46, 0.78, "LIFECYCLE")
    widths = [0.8, 0.94, 1.08, 0.98, 1.3, 1.12, 1.12, 2.16, 1.06]
    chain_h(s, cx, 1.78, list(zip(F["lifecycle"], widths)), t, h=0.34, gap=0.09, size=8.5,
            fills={0: t.accent, 1: t.accent, 7: t.accent, 8: t.ok},
            colors={i: t.on_dark for i in (0, 1, 7, 8)}, lines={i: t.ink for i in (2, 3, 4, 5, 6)})
    cx = rail_band(s, t, 0.42, 2.5, 12.46, 3.92, "EVIDENCE", color=t.accent2)
    top, hh = 2.66, 3.24
    w1, _ = picture(s, S["mgr"], cx, top, h=hh, frame=t.line)
    w2, _ = picture(s, S["truck"], cx + w1 + 0.18, top, h=hh, frame=t.line)
    w3, _ = picture(s, S["nav"], cx + w1 + w2 + 0.36, top, h=hh, frame=t.line)
    for px, pw, lab in [(cx, w1, "Manager · route review"), (cx + w1 + 0.18, w2, "Driver · truck check"),
                        (cx + w1 + w2 + 0.36, w3, "Driver · navigation")]:
        text(s, px, top + hh + 0.06, pw, 0.26, [[(lab, {"size": 9, "color": t.grey})]], t=t, align=PP_ALIGN.CENTER)
    sx = cx + w1 + w2 + w3 + 0.66
    sw = 12.72 - sx
    text(s, sx, 2.66, sw, 0.6, [[("The whole lifecycle above was run end to end on a physical Android phone against "
                                 "the hosted backend, on the real road.", {"size": 11})]], t=t, spacing=1.05)
    y = 3.36
    for n, lab in F["proof"]:
        stat(s, sx, y, sw, n, lab, t, num_size=16, lab_size=10.5, gap=0.96)
        y += 0.42
    runs = []
    for i, (n, lab) in enumerate(F["tests"]):
        runs += [(n + " ", {"bold": True, "size": 12, "color": t.accent}),
                 (lab + ("  ·  " if i < 2 else " tests"), {"size": 10})]
    text(s, sx, y, sw, 0.34, [runs], t=t, anchor=MSO_ANCHOR.MIDDLE)
    pill(s, sx, y + 0.44, sw, 0.36, "PHYSICAL ANDROID · CERTIFIED", t, fill=t.ok, size=11)
    text(s, sx, y + 0.88, sw, 0.5, [[("Canonical demo", {"bold": True, "size": 9.5, "color": t.muted})],
                                    [(F["corridor"], {"bold": True, "size": 10.5})]], t=t, spacing=1.05)
    text(s, 0.42, 6.5, 12.46, 0.42, [[("KNOWN LIMITS → MITIGATION   ", {"bold": True, "size": 9, "color": t.muted}),
                                      (F["limits"], {"size": 9, "color": t.grey})]], t=t, spacing=1.05)


def s5(s, t, S):
    content_slide(s, t, F["titles"][4])
    text(s, 0.5, 1.16, 8.82, 0.8, [[("RASTA AI does not ask only ", {"size": 17, "color": t.grey}),
                                    ("“Which road is shortest?”", {"size": 17, "bold": True}),
                                    ("  It asks  ", {"size": 17, "color": t.grey}),
                                    ("“Can this truck reliably use this corridor now?”",
                                     {"size": 17, "bold": True, "color": t.accent})]], t=t, spacing=1.05)
    cx = rail_band(s, t, 0.45, 2.04, 8.87, 1.5, "WHO GAINS", color=t.ok)
    cw = 1.86
    for i, (h, b) in enumerate(F["who"]):
        x = cx + i * (cw + 0.14)
        text(s, x, 2.14, cw, 1.3, [[(h, {"bold": True, "size": 9, "color": t.accent})],
                                   [(b, {"size": 9.5})]], t=t, spacing=1.05, space_after=3)
    cx = rail_band(s, t, 0.45, 3.64, 8.87, 1.62, "PROVEN")
    for i, (n, lab) in enumerate(F["caps"]):
        col, r = divmod(i, 3)
        stat(s, cx + col * 3.86, 3.76 + r * 0.4, 3.74, n, lab, t, num_size=16, lab_size=10,
             align=PP_ALIGN.RIGHT, gap=0.96)
    cx = rail_band(s, t, 0.45, 5.36, 8.87, 1.5, "GOVERNED", color=t.accent2)
    text(s, cx, 5.46, 7.6, 0.28, [[(F["supplies"], {"bold": True, "size": 11.5, "color": t.ok}),
                                   ("   — essential logistics for hill communities, decided on evidence",
                                    {"size": 10, "color": t.grey})]], t=t)
    chain_h(s, cx, 5.84, [(c, 1.78) for c in F["chain"]], t, h=0.34, gap=0.18, size=9.5,
            fills={0: t.ink}, colors={0: t.on_dark}, lines={i: t.ink for i in range(4)})
    text(s, cx, 6.3, 7.6, 0.3, [[("No invented percentages: impact is stated as who gains what, backed by the working system.",
                                  {"size": 9, "color": t.grey})]], t=t)
    text(s, 9.5, 1.2, 3.35, 0.28, [[("REAL SCREENS · APK 1.0.18", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    w1, _ = picture(s, S["lang"], 9.5, 1.54, h=2.5, frame=t.line)
    w2, _ = picture(s, S["mobile"], 9.5 + w1 + 0.16, 1.54, h=2.5, frame=t.line)
    text(s, 9.5, 4.12, w1, 0.26, [[("Driver · 23 languages", {"size": 9, "color": t.grey})]], t=t, align=PP_ALIGN.CENTER)
    text(s, 9.5 + w1 + 0.16, 4.12, w2, 0.26, [[("Manager · mobile", {"size": 9, "color": t.grey})]], t=t, align=PP_ALIGN.CENTER)
    text(s, 9.5, 4.5, 3.35, 2.0, [[("Real screens, APK 1.0.18. One login, server-decided role: a manager gets a mobile "
                                    "fleet view, a driver gets navigation. Each language shows its status — Verified, "
                                    "Draft or English fallback — so nobody is misled.", {"size": 10, "color": t.grey})]],
         t=t, spacing=1.05)


def s6(s, t, S):
    content_slide(s, t, F["titles"][5])
    cx = rail_band(s, t, 0.42, 1.2, 7.4, 4.86, "SOURCES")
    gw = 2.96
    for i, (lab, names, what) in enumerate(F["groups"]):
        col, row = i % 2, i // 2
        x = cx + col * (gw + 0.2)
        y = 1.32 + row * 1.6
        hline(s, x, y, gw, t.accent, 1.5)
        text(s, x, y + 0.06, gw, 1.4, [[(lab, {"bold": True, "size": 9, "color": t.accent})],
                                       [(names, {"bold": True, "size": 10.5})],
                                       [(what, {"size": 9.5, "color": t.grey})]], t=t, spacing=1.05, space_after=2)
    mx, mw = 8.22, 4.5
    rect(s, 8.05, 1.2, 4.83, 4.86, fill=t.paper, line=t.line, rounded=True, line_w=1.0, radius=0.05)
    rect(s, 8.05, 1.2, 4.83, 0.06, fill=t.accent2)
    text(s, mx, 1.34, mw, 0.28, [[("EXPERIMENTAL LANDSLIDE RESEARCH", {"bold": True, "size": 9.5, "color": t.accent2})]], t=t)
    text(s, mx, 1.66, 1.85, 0.94, [[(F["ml_recall"], {"bold": True, "size": 44})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, mx + 1.85, 1.7, mw - 1.85, 0.88, [[(F["ml_recall_what"], {"bold": True, "size": 12})],
                                              [(F["ml_recall_sub"], {"size": 9.5, "color": t.grey})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE, spacing=1.05)
    rect(s, mx, 2.74, mw, 0.8, fill=t.ink, rounded=True, radius=0.05)
    text(s, mx, 2.8, mw, 0.7, [[(F["ml_gate_small"], {"bold": True, "size": 11, "color": t.muted})],
                               [(F["ml_gate_big"], {"bold": True, "size": 21, "color": t.on_dark})]],
         t=t, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, spacing=1.0)
    text(s, mx, 3.62, mw, 0.32, [[(F["ml_fpr"], {"bold": True, "size": 13, "color": t.danger}),
                                  ("   " + F["ml_fpr_why"], {"size": 10, "color": t.grey})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    fy = 4.02
    for r in ([(F["ml_flow"][0], 0.76), (F["ml_flow"][1], 1.58), (F["ml_flow"][2], 1.74)],
              [(F["ml_flow"][3], 1.94), (F["ml_flow"][4], 1.06), (F["ml_flow"][5], 1.24)]):
        chain_h(s, mx, fy, r, t, h=0.28, gap=0.08, size=8, lines={i: t.ink for i in range(3)})
        fy += 0.38
    text(s, mx, 4.82, mw, 0.68, [[(F["ml_caption_lead"] + " ", {"bold": True, "size": 11, "color": t.accent}),
                                  (F["ml_caption"], {"size": 10})]], t=t, spacing=1.05)
    text(s, mx, 5.5, mw, 0.5, [[(F["ml_metrics"], {"size": 8, "color": t.grey})]], t=t, spacing=1.05)
    hline(s, 0.42, 6.16, 12.46, t.line)
    text(s, 0.42, 6.42, 12.46, 0.48, [[("REFERENCES   ", {"bold": True, "size": 8.5, "color": t.muted}),
                                       (F["refs"], {"size": 8.5, "color": t.grey})]], t=t, spacing=1.1)


SLIDES = [s1, s2, s3, s4, s5, s6]
