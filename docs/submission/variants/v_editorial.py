"""V02 EDITORIAL — rules, not boxes.

Nothing is framed. Structure comes from hairlines, a strict left margin and one
dominant statement per slide. Closest to how a technical paper is set.
"""
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from deckkit import (FACTS as F, Theme, arrow, caption, chain_h, chain_v, content_slide,
                     hline, picture, pill, rect, stat, text, title_slide_prep)

THEME = Theme(slug="V02_EDITORIAL", label="Editorial", font="Calibri", display="Calibri",
              accent="1D4ED8", accent2="1E3A8A", ok="047857", ink="0B1220", grey="64748B",
              muted="94A3B8", line="DDE3EA", bg="F8FAFC", radius=0.06, border=0.9,
              note="Hairlines and a strict left margin instead of frames; one statement per slide.")


def s1(s, t, S):
    title_slide_prep(s)
    text(s, 0.55, 1.3, 6.6, 0.7, [[(F["name"], {"bold": True, "size": 40})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 0.58, 1.98, 6.6, 0.4, [[(F["tagline"], {"size": 12.5, "color": t.grey})]], t=t)
    hline(s, 0.55, 2.52, 6.6, t.ink, 1.5)
    text(s, 0.55, 2.62, 3.2, 0.42, [[(F["ps_id"], {"bold": True, "size": 26, "color": t.accent})]], t=t)
    text(s, 3.5, 2.66, 3.65, 0.42, [[(F["ministry"] + " · " + F["theme"] + " · " + F["category"],
                                      {"size": 11.5, "color": t.grey})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    rows = [("Problem Statement ID", F["ps_id"]), ("Problem Statement Title", F["ps_title"]),
            ("Theme", F["theme"]), ("PS Category", F["category"]),
            ("Team ID", F["team_id"]), ("Team Name", F["team"])]
    y = 3.24
    for k, v in rows:
        tall = 0.46 if k == "Problem Statement Title" else 0.28
        text(s, 0.55, y, 2.0, tall, [[(k.upper(), {"bold": True, "size": 9, "color": t.muted})]], t=t)
        text(s, 2.6, y - 0.03, 4.55, tall, [[(v, {"size": 12.5,
             "bold": k in ("Problem Statement ID", "Team ID", "Team Name")})]], t=t, spacing=1.0)
        hline(s, 0.55, y + tall + 0.01, 6.6, t.line)
        y += tall + 0.06
    text(s, 0.55, 5.48, 6.6, 0.46, [[(F["headline"], {"bold": True, "size": 21})]], t=t)
    text(s, 0.55, 5.96, 6.6, 0.38, [[(F["question"], {"size": 12.5, "color": t.accent})]], t=t)
    hline(s, 0.55, 6.4, 6.6, t.line)
    text(s, 0.55, 6.46, 6.6, 0.5, [[(F["proof_line"], {"size": 10.5, "color": t.ok, "bold": True})]], t=t, spacing=1.1)
    text(s, 7.55, 1.26, 5.3, 0.3, [[("LIVE WORKING SYSTEM", {"bold": True, "size": 10, "color": t.muted})]], t=t)
    hline(s, 7.55, 1.56, 5.3, t.ink, 1.2)
    picture(s, S["mgr"], 7.55, 2.5, h=3.9, frame=t.line)
    picture(s, S["nav"], 10.42, 1.74, h=4.66, frame=t.line)
    text(s, 7.55, 6.5, 5.3, 0.3, [[("Manager route review · Driver navigation — real screens",
                                    {"size": 9.5, "color": t.grey})]], t=t)


def s2(s, t, S):
    content_slide(s, t, F["titles"][1])
    text(s, 0.5, 1.2, 4, 0.28, [[("PROPOSED SOLUTION", {"bold": True, "size": 10, "color": t.muted})]], t=t)
    text(s, 0.5, 1.46, 8.7, 0.95, [[("Not the shortest road. ", {"bold": True, "size": 25}),
                                    ("The road that is operationally usable now.",
                                     {"bold": True, "size": 25, "color": t.accent})]], t=t, spacing=1.0)
    text(s, 0.5, 2.4, 8.7, 0.4, [[(F["problem"], {"size": 11, "color": t.grey})]], t=t, spacing=1.05)
    hline(s, 0.5, 2.9, 8.82, t.ink, 1.2)
    text(s, 0.5, 2.98, 2.4, 0.28, [[("A NORMAL ROUTER", {"bold": True, "size": 10, "color": t.muted})]], t=t)
    chain_v(s, 0.5, 2.3, 3.3, [(x, None, t.grey, t.line) for x in F["normal_router"]], t, h=0.3, gap=0.24, size=10.5)
    text(s, 0.5, 4.96, 2.3, 1.2, [[(x, {"size": 10.5, "color": t.grey})] for x in F["normal_gap"]],
         t=t, spacing=1.05, space_after=6)
    arrow(s, 3.02, 4.3, 3.02, 3.0, t.line, 0.9, head=False)
    text(s, 3.2, 2.98, 6.1, 0.28, [[("RASTA AI", {"bold": True, "size": 10, "color": t.accent})]], t=t)
    x, w = 3.2, 6.12
    y = chain_v(s, x, w, 3.3, [(F["normal_router"][0], None, t.ink, t.ink),
                               ("Real route  ·  OSRM road, alternatives, turn steps", None, t.ink, t.ink)],
                t, h=0.28, gap=0.1, size=10.5)
    hline(s, x, y + 0.04, w, t.line)
    text(s, x, y + 0.08, w, 0.26, [[("ROUTE-SPECIFIC EVIDENCE  ", {"bold": True, "size": 10}),
                                    ("each factor sampled along the selected road, with its freshness",
                                     {"size": 9.5, "color": t.grey})]], t=t)
    cx, cy = x, y + 0.38
    for lab, wd in zip(F["evidence_chips"], [0.86, 0.86, 1.38, 1.12, 1.28, 1.02, 1.38]):
        if cx + wd > x + w:
            cx = x; cy += 0.3
        pill(s, cx, cy, wd, 0.25, lab, t, fill=None, color=t.ink, line=t.line, size=9, bold=False)
        cx += wd + 0.08
    y = cy + 0.38
    chain_v(s, x, w, y, [("OPERATIONAL DECISION  ·  CONTINUE / CAUTION / HOLD / REROUTE", t.accent, None, None),
                         ("Manager governance  ·  reviews evidence, authorises, dispatches, approves reroutes", None, t.ink, t.ink),
                         ("Driver  ·  navigation, danger context, 23 languages, offline package", None, t.ink, t.ink)],
            t, h=0.28, gap=0.1, size=10.5)
    hline(s, 0.5, 6.22, 8.82, t.danger, 1.5)
    text(s, 0.5, 6.3, 2.8, 0.4, [[("UNKNOWN ≠ SAFE", {"bold": True, "size": 17, "color": t.danger})]], t=t)
    text(s, 3.2, 6.34, 6.12, 0.5, [[(F["unknown_rule"], {"size": 10.5})]], t=t, spacing=1.05)
    text(s, 9.5, 1.2, 3.35, 0.28, [[("MANAGER · CHECK CONDITIONS", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    hline(s, 9.5, 1.5, 3.35, t.ink, 1.2)
    picture(s, S["evid"], 9.5, 1.64, h=4.86, frame=t.line)
    text(s, 9.5, 6.56, 3.35, 0.3, [[("Real screen · evidence · freshness · UNKNOWN",
                                     {"size": 9, "color": t.grey})]], t=t)


def s3(s, t, S):
    content_slide(s, t, F["titles"][2])
    text(s, 0.5, 1.18, 8.8, 0.28, [[("VERIFIED DATA → DECISION → DRIVER",
                                     {"bold": True, "size": 10, "color": t.muted})]], t=t)
    hline(s, 0.5, 1.48, 8.82, t.ink, 1.2)
    x, bw = 0.5, 1.4
    for lab, sub in F["sources"]:
        text(s, x, 1.56, bw, 0.56, [[(lab, {"bold": True, "size": 9.5})], [(sub, {"size": 8.5, "color": t.grey})]],
             t=t, spacing=1.0)
        arrow(s, x + bw / 2 - 0.05, 2.16, x + bw / 2 - 0.05, 2.34, t.muted, 0.9)
        x += bw + 0.08
    steps = [("ROUTE-SPECIFIC EVIDENCE  ·  FastAPI backend",
              "every factor sampled along the selected road · " + F["stack"].split(" · ")[1] + " · OSRM routes, alternatives, turn steps", None),
             ("DETERMINISTIC SAFETY POLICY",
              "11 factors · reason codes · UNKNOWN ≠ SAFE · reviewer authorisation when hazard data is missing", t.accent)]
    y = 2.4
    for title, sub, accent in steps:
        if accent is not None:
            rect(s, 0.5, y, 0.05, 0.54, fill=accent)
        text(s, 0.68, y, 8.6, 0.54, [[(title, {"bold": True, "size": 11, "color": accent or t.ink})],
                                     [(sub, {"size": 9.5, "color": t.grey})]], t=t, spacing=1.0)
        hline(s, 0.5, y + 0.58, 8.82, t.line)
        y += 0.72
    dw = (8.82 - 3 * 0.14) / 4
    cx = 0.5
    for lab, kind in F["decisions"]:
        pill(s, cx, y, dw, 0.36, lab, t, fill=t.c({"ok": "ok", "warn": "warn", "danger": "danger", "ink": "ink"}[kind]), size=11)
        cx += dw + 0.14
    y += 0.5
    loop = [("MANAGER REVIEW", 1.5), ("DRIVER NAVIGATION", 1.64), ("ROUTE-AHEAD MONITOR (60 s)", 2.04),
            ("CONDITIONS CHANGE?", 1.6), ("REASSESS / REROUTE", 1.56)]
    chain_h(s, 0.5, y, loop, t, h=0.34, gap=0.1, size=9,
            fills={0: t.ink}, colors={0: t.on_dark}, lines={i: t.ink for i in range(5)})
    text(s, 0.5, y + 0.44, 8.82, 0.36, [[("Conditions are re-scored every 60 s along the road ahead; a material change "
                                          "goes back through the policy and a reroute is proposed to the manager — never applied silently.",
                                          {"size": 9.5, "color": t.grey})]], t=t, spacing=1.05)
    hline(s, 0.5, y + 0.86, 8.82, t.line)
    text(s, 0.5, y + 0.92, 8.82, 0.9, [
        [("CLIENTS  ", {"bold": True, "size": 9.5, "color": t.muted}), (F["clients"], {"size": 10.5})],
        [("STACK  ", {"bold": True, "size": 9.5, "color": t.muted}), (F["stack"], {"size": 10.5})],
        [("EVIDENCE  ", {"bold": True, "size": 9.5, "color": t.muted}),
         ("Open-Meteo / MET Norway \u00b7 NDMA SACHET \u00b7 GloFAS \u00b7 NASA historical landslides \u00b7 OpenTopoData / Copernicus DEM",
          {"size": 10.5})],
    ], t=t, spacing=1.1, space_after=3)
    text(s, 9.5, 1.18, 3.35, 0.28, [[("WHO DECIDES", {"bold": True, "size": 10, "color": t.muted})]], t=t)
    hline(s, 9.5, 1.48, 3.35, t.ink, 1.2)
    y = 1.6
    for lab, sub, kind in F["deciders"]:
        rect(s, 9.5, y + 0.03, 0.05, 0.66, fill=t.c(kind))
        text(s, 9.68, y, 3.17, 0.8, [[(lab, {"bold": True, "size": 10.5})], [(sub, {"size": 10, "color": t.grey})]],
             t=t, spacing=1.0)
        y += 0.92
    hline(s, 9.5, y + 0.02, 3.35, t.line)
    text(s, 9.5, y + 0.1, 3.35, 0.28, [[("GOVERNANCE CHAIN", {"bold": True, "size": 10, "color": t.muted})]], t=t)
    chain_v(s, 9.5, 3.35, y + 0.44, [(c, None, t.ink, t.ink) for c in F["chain"]], t, h=0.32, gap=0.14, size=10.5)


def s4(s, t, S):
    content_slide(s, t, F["titles"][3])
    text(s, 0.5, 1.1, 9.5, 0.44, [[("Not a concept. A working end-to-end prototype.", {"bold": True, "size": 23})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE)
    widths = [0.82, 0.98, 1.12, 1.0, 1.36, 1.16, 1.16, 2.28, 1.12]
    chain_h(s, 0.5, 1.64, list(zip(F["lifecycle"], widths)), t, h=0.34, gap=0.1, size=9,
            fills={0: t.accent, 1: t.accent, 7: t.accent, 8: t.ok},
            colors={0: t.on_dark, 1: t.on_dark, 7: t.on_dark, 8: t.on_dark},
            lines={i: t.ink for i in (2, 3, 4, 5, 6)})
    hline(s, 0.5, 2.2, 12.35, t.line)
    top, hh = 2.38, 3.6
    w1, _ = picture(s, S["mgr"], 0.5, top, h=hh, frame=t.line)
    w2, _ = picture(s, S["truck"], 0.5 + w1 + 0.22, top, h=hh, frame=t.line)
    w3, _ = picture(s, S["nav"], 0.5 + w1 + w2 + 0.44, top, h=hh, frame=t.line)
    for cx, cw, lab in [(0.5, w1, "Manager · route review"), (0.5 + w1 + 0.22, w2, "Driver · truck check"),
                        (0.5 + w1 + w2 + 0.44, w3, "Driver · navigation")]:
        text(s, cx, top + hh + 0.06, cw, 0.28, [[(lab, {"size": 9.5, "color": t.grey})]], t=t, align=PP_ALIGN.CENTER)
    px = 0.5 + w1 + w2 + w3 + 0.78
    pw = 12.85 - px
    text(s, px, 2.3, pw, 0.28, [[("PROOF", {"bold": True, "size": 10, "color": t.muted})]], t=t)
    hline(s, px, 2.6, pw, t.ink, 1.2)
    text(s, px, 2.7, pw, 0.62, [[("The whole lifecycle above was run end to end on a physical Android phone "
                                  "against the hosted backend, on the real road.", {"size": 11.5})]], t=t, spacing=1.05)
    y = 3.42
    for n, lab in F["proof"]:
        stat(s, px, y, pw, n, lab, t, num_size=17, lab_size=11, gap=1.02)
        y += 0.44
    runs = []
    for i, (n, lab) in enumerate(F["tests"]):
        runs += [(n + " ", {"bold": True, "size": 13, "color": t.accent}), (lab + ("  ·  " if i < 2 else " tests"), {"size": 10.5})]
    text(s, px, y + 0.04, pw, 0.34, [runs], t=t, anchor=MSO_ANCHOR.MIDDLE)
    hline(s, px, y + 0.5, pw, t.ok, 1.5)
    text(s, px, y + 0.56, pw, 0.34, [[("PHYSICAL ANDROID · CERTIFIED", {"bold": True, "size": 12, "color": t.ok})]], t=t)
    text(s, px, y + 0.94, pw, 0.34, [[("Canonical demo  ", {"bold": True, "size": 10.5, "color": t.muted}),
                                      (F["corridor"], {"bold": True, "size": 11})]], t=t)
    hline(s, 0.5, 6.42, 12.35, t.line)
    text(s, 0.5, 6.48, 12.35, 0.5, [[("KNOWN LIMITS → MITIGATION   ", {"bold": True, "size": 9.5, "color": t.muted}),
                                     (F["limits"], {"size": 9.5})]], t=t, spacing=1.05)


def s5(s, t, S):
    content_slide(s, t, F["titles"][4])
    text(s, 0.5, 1.14, 8.8, 0.86, [[("RASTA AI does not ask only ", {"size": 18, "color": t.grey}),
                                    ("“Which road is shortest?”", {"size": 18, "bold": True}),
                                    ("  It asks  ", {"size": 18, "color": t.grey}),
                                    ("“Can this truck reliably use this corridor now?”",
                                     {"size": 18, "bold": True, "color": t.accent})]], t=t, spacing=1.05)
    text(s, 0.5, 2.06, 8.8, 0.32, [[(F["supplies"], {"bold": True, "size": 12.5, "color": t.ok}),
                                    ("   — essential logistics for hill communities, decided on evidence",
                                     {"size": 11, "color": t.grey})]], t=t)
    hline(s, 0.5, 2.5, 8.82, t.ink, 1.2)
    text(s, 0.5, 2.58, 4, 0.26, [[("WHO BENEFITS", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    cw = 2.07
    for i, (h, b) in enumerate(F["who"]):
        x = 0.5 + i * (cw + 0.16)
        text(s, x, 2.9, cw, 1.1, [[(h, {"bold": True, "size": 10.5, "color": t.accent})],
                                  [(b, {"size": 11, "color": t.ink})]], t=t, spacing=1.05, space_after=4)
    hline(s, 0.5, 4.08, 8.82, t.line)
    text(s, 0.5, 4.14, 4, 0.26, [[("DEMONSTRATED TODAY", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    for i, (n, lab) in enumerate(F["caps"]):
        col, row = divmod(i, 3)
        stat(s, 0.5 + col * 4.44, 4.5 + row * 0.44, 4.3, n, lab, t, num_size=18, lab_size=11,
             align=PP_ALIGN.RIGHT, gap=1.05)
    hline(s, 0.5, 5.92, 8.82, t.line)
    text(s, 0.5, 5.98, 6, 0.26, [[("HUMAN GOVERNANCE — AI HAS NO UNCONTROLLED AUTHORITY",
                                   {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    chain_h(s, 0.5, 6.3, [(c, 2.04) for c in F["chain"]], t, h=0.36, gap=0.22, size=10.5,
            fills={0: t.ink}, colors={0: t.on_dark}, lines={i: t.ink for i in range(4)})
    text(s, 9.5, 1.18, 3.35, 0.28, [[("REAL SCREENS · APK 1.0.18", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    hline(s, 9.5, 1.48, 3.35, t.ink, 1.2)
    w1, h1 = picture(s, S["lang"], 9.5, 1.64, h=2.5, frame=t.line)
    w2, _ = picture(s, S["mobile"], 9.5 + w1 + 0.16, 1.64, h=2.5, frame=t.line)
    text(s, 9.5, 4.24, w1, 0.26, [[("Driver · 23 languages", {"size": 9, "color": t.grey})]], t=t, align=PP_ALIGN.CENTER)
    text(s, 9.5 + w1 + 0.16, 4.24, w2, 0.26, [[("Manager · mobile", {"size": 9, "color": t.grey})]], t=t, align=PP_ALIGN.CENTER)
    text(s, 9.5, 4.62, 3.35, 2.0, [[("Real screens, APK 1.0.18. One login, server-decided role: a manager gets a "
                                     "mobile fleet view, a driver gets navigation. Each language shows its status — "
                                     "Verified, Draft or English fallback — so nobody is misled.",
                                     {"size": 10, "color": t.grey})]], t=t, spacing=1.05)


def s6(s, t, S):
    content_slide(s, t, F["titles"][5])
    text(s, 0.5, 1.18, 7.4, 0.28, [[("RESEARCH / EVIDENCE SOURCES BEHIND THE ROUTE DECISION",
                                     {"bold": True, "size": 10, "color": t.muted})]], t=t)
    hline(s, 0.5, 1.48, 7.42, t.ink, 1.2)
    gw = 3.5
    for i, (lab, names, what) in enumerate(F["groups"]):
        col, row = i % 2, i // 2
        x = 0.5 + col * (gw + 0.42)
        y = 1.62 + row * 1.46
        text(s, x, y, gw, 1.24, [[(lab, {"bold": True, "size": 9.5, "color": t.accent})],
                                 [(names, {"bold": True, "size": 11.5})],
                                 [(what, {"size": 10.5, "color": t.grey})]], t=t, spacing=1.05, space_after=3)
        hline(s, x, y + 1.28, gw, t.line)
    mx, mw = 8.5, 4.35
    text(s, mx, 1.18, mw, 0.28, [[("EXPERIMENTAL LANDSLIDE RESEARCH", {"bold": True, "size": 10, "color": t.muted})]], t=t)
    hline(s, mx, 1.48, mw, t.ink, 1.2)
    text(s, mx, 1.6, 1.8, 0.92, [[(F["ml_recall"], {"bold": True, "size": 44})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, mx + 1.8, 1.64, mw - 1.8, 0.86, [[(F["ml_recall_what"], {"bold": True, "size": 12})],
                                             [(F["ml_recall_sub"], {"size": 9.5, "color": t.grey})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE, spacing=1.05)
    rect(s, mx, 2.66, mw, 0.8, fill=t.ink, rounded=True, radius=0.06)
    text(s, mx, 2.72, mw, 0.7, [[(F["ml_gate_small"], {"bold": True, "size": 11, "color": t.muted})],
                                [(F["ml_gate_big"], {"bold": True, "size": 21, "color": t.on_dark})]],
         t=t, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, spacing=1.0)
    text(s, mx, 3.54, mw, 0.34, [[(F["ml_fpr"], {"bold": True, "size": 13, "color": t.danger}),
                                  ("   " + F["ml_fpr_why"], {"size": 10, "color": t.grey})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    fy = 3.96
    for row in ([(F["ml_flow"][0], 0.74), (F["ml_flow"][1], 1.54), (F["ml_flow"][2], 1.7)],
                [(F["ml_flow"][3], 1.88), (F["ml_flow"][4], 1.02), (F["ml_flow"][5], 1.2)]):
        chain_h(s, mx, fy, row, t, h=0.28, gap=0.08, size=8, lines={i: t.ink for i in range(3)})
        fy += 0.4
    text(s, mx, 4.8, mw, 0.7, [[(F["ml_caption_lead"] + " ", {"bold": True, "size": 11.5, "color": t.accent}),
                                (F["ml_caption"], {"size": 10.5})]], t=t, spacing=1.05)
    text(s, mx, 5.5, mw, 0.5, [[(F["ml_metrics"], {"size": 8, "color": t.grey})]], t=t, spacing=1.05)
    hline(s, 0.5, 6.16, 12.35, t.line)
    text(s, 0.5, 6.22, 3, 0.26, [[("REFERENCES", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    text(s, 0.5, 6.46, 12.35, 0.5, [[(F["refs"], {"size": 9.5, "color": t.grey})]], t=t, spacing=1.1)


SLIDES = [s1, s2, s3, s4, s5, s6]
