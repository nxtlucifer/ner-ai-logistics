"""V03 CONSOLE — the product's own dark field.

A white masthead keeps the template's title and SIH logo legible; everything
below it is the dark ground the driver app actually uses at night, so the real
screens sit in the deck instead of on top of it.
"""
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from deckkit import (FACTS as F, FOOT, SW, Theme, arrow, chain_h, chain_v, content_slide,
                     hline, picture, pill, rect, rgb, stat, text, title_slide_prep)

THEME = Theme(slug="V03_CONSOLE", label="Console", font="Calibri", accent="38BDF8",
              accent2="22D3EE", ok="34D399", warn="FBBF24", danger="F87171",
              ink="E6EDF6", grey="93A4BC", muted="64748B", line="1E293B", bg="0B1220",
              paper="111C2E", on_dark="FFFFFF", dark=True, radius=0.08, border=1.0,
              note="A white masthead over the driver app's own night field; screens are the light source.")

FIELD = rgb("0B1220")
CARD = rgb("111C2E")
TOP = 1.16


def ground(s, t, from_y=TOP):
    """Paint the field BELOW the masthead only.

    The template draws no white background of its own on a content slide, so a
    full-bleed dark rectangle would put the black serif title and the SIH logo
    on a dark ground and lose both. Everything above from_y stays white."""
    rect(s, -0.02, from_y, SW + 0.04, FOOT - from_y, fill=FIELD)


def card(s, x, y, w, h, t, title=None, sub=None, accent=None, title_size=10.5):
    rect(s, x, y, w, h, fill=CARD, line=t.line, rounded=True, line_w=1.0, radius=0.08)
    if accent is not None:
        rect(s, x, y, 0.06, h, fill=accent)
    if title:
        runs = [(title, {"bold": True, "size": title_size, "color": accent or t.accent})]
        if sub:
            runs.append(("   " + sub, {"size": 9.5, "color": t.muted}))
        text(s, x + 0.18, y + 0.08, w - 0.36, 0.3, [runs], t=t)
        return y + 0.42
    return y + 0.16


def s1(s, t, S):
    title_slide_prep(s)
    ground(s, t, 1.2)
    text(s, 0.55, 1.4, 6.6, 0.72, [[(F["name"], {"bold": True, "size": 42, "color": t.ink})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 0.58, 2.12, 6.6, 0.4, [[(F["tagline"], {"size": 12.5, "color": t.grey})]], t=t)
    pill(s, 0.55, 2.66, 2.1, 0.6, F["ps_id"], t, fill=t.accent, color=rgb("06121F"), size=23)
    text(s, 2.82, 2.68, 4.3, 0.56, [[("PROBLEM STATEMENT ID", {"bold": True, "size": 9.5, "color": t.muted})],
                                    [(F["ministry"] + " · " + F["theme"] + " · " + F["category"],
                                      {"size": 11.5, "color": t.ink})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    rows = [("Problem Statement Title", F["ps_title"]), ("Theme", F["theme"]),
            ("PS Category", F["category"]), ("Team ID", F["team_id"]), ("Team Name", F["team"])]
    y = 3.42
    for k, v in rows:
        tall = 0.46 if k == "Problem Statement Title" else 0.28
        text(s, 0.55, y, 2.0, tall, [[(k.upper(), {"bold": True, "size": 9, "color": t.muted})]], t=t)
        text(s, 2.6, y - 0.03, 4.55, tall, [[(v, {"size": 12.5, "color": t.ink,
             "bold": k in ("Team ID", "Team Name")})]], t=t, spacing=1.0)
        hline(s, 0.55, y + tall + 0.01, 6.6, t.line)
        y += tall + 0.07
    text(s, 0.55, 5.44, 6.6, 0.46, [[(F["headline"], {"bold": True, "size": 21, "color": t.ink})]], t=t)
    text(s, 0.55, 5.92, 6.6, 0.38, [[(F["question"], {"size": 12.5, "color": t.accent})]], t=t)
    text(s, 0.55, 6.34, 6.6, 0.5, [[(F["proof_line"], {"size": 10.5, "color": t.ok, "bold": True})]], t=t, spacing=1.1)
    text(s, 7.5, 1.36, 5.35, 0.3, [[("LIVE WORKING SYSTEM", {"bold": True, "size": 10, "color": t.accent}),
                                    ("   manager console + Android driver app", {"size": 9.5, "color": t.muted})]], t=t)
    picture(s, S["mgr"], 7.62, 2.5, h=3.9, frame=t.line)
    picture(s, S["nav"], 10.48, 1.76, h=4.64, frame=t.line)
    text(s, 7.5, 6.5, 5.35, 0.3, [[("Manager route review · Driver navigation — real screens, real road",
                                    {"size": 9.5, "color": t.muted})]], t=t)


def s2(s, t, S):
    content_slide(s, t, F["titles"][1])
    ground(s, t)
    text(s, 0.5, 1.26, 4, 0.28, [[("PROPOSED SOLUTION", {"bold": True, "size": 10, "color": t.muted})]], t=t)
    text(s, 0.5, 1.52, 8.7, 0.92, [[("NOT THE SHORTEST ROAD. ", {"bold": True, "size": 24, "color": t.ink}),
                                    ("THE ROAD THAT IS USABLE NOW.", {"bold": True, "size": 24, "color": t.accent})]],
         t=t, spacing=1.0)
    text(s, 0.5, 2.42, 8.82, 0.4, [[(F["problem"] + "  ", {"size": 11, "color": t.grey}), (F["problem_kick"], {"size": 11, "bold": True, "color": t.danger})]], t=t, spacing=1.05)
    card(s, 0.45, 2.92, 2.62, 3.32, t, "A NORMAL ROUTER", accent=t.muted)
    chain_v(s, 0.62, 2.28, 3.4, [(x, None, t.grey, t.line) for x in F["normal_router"]], t, h=0.3, gap=0.24, size=10.5)
    text(s, 0.62, 5.06, 2.28, 1.1, [[(x, {"size": 10, "color": t.muted})] for x in F["normal_gap"]],
         t=t, spacing=1.05, space_after=5)
    card(s, 3.2, 2.92, 6.12, 3.32, t, "RASTA AI", sub="evidence before the road")
    x, w = 3.36, 5.8
    y = chain_v(s, x, w, 3.4, [(F["normal_router"][0], None, t.ink, t.line),
                               ("Real route  ·  OSRM road, alternatives, turn steps", None, t.ink, t.line)],
                t, h=0.28, gap=0.1, size=10.5)
    rect(s, x, y, w, 0.9, fill=FIELD, line=t.line, rounded=True, radius=0.06)
    text(s, x + 0.12, y + 0.04, w - 0.24, 0.26, [[("ROUTE-SPECIFIC EVIDENCE  ", {"bold": True, "size": 10, "color": t.ink}),
                                                  ("each factor with its freshness", {"size": 9.5, "color": t.muted})]], t=t)
    cx, cy = x + 0.12, y + 0.3
    for lab, wd in zip(F["evidence_chips"], [0.86, 0.86, 1.38, 1.1, 1.26, 1.0, 1.36]):
        if cx + wd > x + w - 0.1:
            cx = x + 0.12; cy += 0.28
        pill(s, cx, cy, wd, 0.24, lab, t, fill=None, color=t.ink, line=t.muted, size=9, bold=False)
        cx += wd + 0.08
    y += 1.0
    chain_v(s, x, w, y, [("OPERATIONAL DECISION  ·  CONTINUE / CAUTION / HOLD / REROUTE", t.accent, rgb("06121F"), None),
                         ("Manager governance  ·  authorises, dispatches, approves reroutes", None, t.ink, t.line),
                         ("Driver  ·  navigation, danger context, 23 languages, offline", None, t.ink, t.line)],
            t, h=0.28, gap=0.1, size=10.5)
    rect(s, 0.45, 6.34, 8.87, 0.54, fill=CARD, line=t.danger, rounded=True, line_w=1.25, radius=0.08)
    text(s, 0.62, 6.38, 2.5, 0.46, [[("UNKNOWN ≠ SAFE", {"bold": True, "size": 15, "color": t.danger})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 3.1, 6.4, 6.05, 0.44, [[(F["unknown_rule"], {"size": 10, "color": t.ink})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    card(s, 9.45, 1.24, 3.43, 5.64, t, "MANAGER · CHECK CONDITIONS")
    picture(s, S["evid"], 9.65, 1.74, h=4.56, frame=t.line)
    text(s, 9.62, 6.4, 3.1, 0.3, [[("Real screen · evidence · freshness · UNKNOWN", {"size": 9, "color": t.muted})]], t=t)


def s3(s, t, S):
    content_slide(s, t, F["titles"][2])
    ground(s, t)
    card(s, 0.4, 1.22, 8.9, 3.9, t, "VERIFIED DATA → DECISION → DRIVER", sub="provider adapters with health + freshness")
    x, bw = 0.55, 1.4
    for lab, sub in F["sources"]:
        rect(s, x, 1.68, bw, 0.62, fill=FIELD, line=t.line, rounded=True, radius=0.06)
        text(s, x + 0.1, 1.72, bw - 0.2, 0.54, [[(lab, {"bold": True, "size": 9, "color": t.ink})],
                                                [(sub, {"size": 8, "color": t.muted})]], t=t, spacing=1.0)
        arrow(s, x + bw / 2, 2.32, x + bw / 2, 2.46, t.muted, 0.9)
        x += bw + 0.08
    rect(s, 0.55, 2.5, 8.6, 0.52, fill=FIELD, line=t.line, rounded=True, radius=0.06)
    text(s, 0.68, 2.54, 8.4, 0.46, [[("ROUTE-SPECIFIC EVIDENCE  ·  FastAPI backend", {"bold": True, "size": 10.5, "color": t.ink})],
                                    [("every factor sampled along the selected road · PostgreSQL + PostGIS (Supabase) · OSRM routes, alternatives, turn steps",
                                      {"size": 9, "color": t.muted})]], t=t, spacing=1.0)
    rect(s, 0.55, 3.12, 8.6, 0.52, fill=t.accent, rounded=True, radius=0.06)
    text(s, 0.68, 3.16, 8.4, 0.46, [[("DETERMINISTIC SAFETY POLICY", {"bold": True, "size": 10.5, "color": rgb("06121F")})],
                                    [("11 factors · reason codes · UNKNOWN ≠ SAFE · reviewer authorisation when hazard data is missing",
                                      {"size": 9, "color": rgb("0B2B45")})]], t=t, spacing=1.0)
    dw = (8.6 - 3 * 0.14) / 4
    cx = 0.55
    for lab, kind in F["decisions"]:
        fill = {"ok": t.ok, "warn": t.warn, "danger": t.danger, "ink": t.muted}[kind]
        pill(s, cx, 3.76, dw, 0.34, lab, t, fill=fill, color=rgb("06121F"), size=11)
        cx += dw + 0.14
    loop = [("MANAGER REVIEW", 1.48), ("DRIVER NAVIGATION", 1.6), ("ROUTE-AHEAD MONITOR (60 s)", 2.0),
            ("CONDITIONS CHANGE?", 1.56), ("REASSESS / REROUTE", 1.52)]
    chain_h(s, 0.55, 4.2, loop, t, h=0.34, gap=0.1, size=9,
            fills={0: t.accent}, colors={0: rgb("06121F"), 1: t.ink, 2: t.ink, 3: t.ink, 4: t.ink},
            lines={i: t.muted for i in range(1, 5)})
    text(s, 0.55, 4.64, 8.6, 0.36, [[(F["loop_note"], {"size": 9, "color": t.muted})]], t=t, spacing=1.05)
    card(s, 0.4, 5.24, 8.9, 1.64, t, "BUILT WITH")
    text(s, 0.58, 5.66, 8.54, 1.1, [
        [("CLIENTS  ", {"bold": True, "size": 9, "color": t.muted}), (F["clients"], {"size": 10, "color": t.ink})],
        [("STACK  ", {"bold": True, "size": 9, "color": t.muted}), (F["stack"], {"size": 10, "color": t.ink})],
    ], t=t, spacing=1.15, space_after=3)
    card(s, 9.42, 1.22, 3.46, 5.66, t, "WHO DECIDES", sub="AI is supporting")
    y = 1.72
    for lab, sub, kind in F["deciders"]:
        col = {"accent": t.accent, "ok": t.ok, "muted": t.muted}[kind]
        rect(s, 9.58, y + 0.02, 0.05, 0.68, fill=col)
        text(s, 9.74, y, 3.0, 0.8, [[(lab, {"bold": True, "size": 10, "color": t.ink})],
                                    [(sub, {"size": 9.5, "color": t.grey})]], t=t, spacing=1.0)
        y += 0.9
    hline(s, 9.58, y + 0.02, 3.14, t.line)
    text(s, 9.58, y + 0.1, 3.14, 0.28, [[("GOVERNANCE CHAIN", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    chain_v(s, 9.58, 3.14, y + 0.44, [(c, None, t.ink, t.muted) for c in F["chain"]], t, h=0.32, gap=0.14, size=10)


def s4(s, t, S):
    content_slide(s, t, F["titles"][3])
    ground(s, t)
    text(s, 0.5, 1.2, 9.5, 0.44, [[("NOT A CONCEPT. A WORKING END-TO-END PROTOTYPE.",
                                    {"bold": True, "size": 22, "color": t.ink})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    widths = [0.8, 0.95, 1.1, 1.0, 1.35, 1.15, 1.15, 2.25, 1.1]
    chain_h(s, 0.5, 1.72, list(zip(F["lifecycle"], widths)), t, h=0.34, gap=0.11, size=9,
            fills={0: t.accent, 1: t.accent, 7: t.accent, 8: t.ok},
            colors={i: rgb("06121F") for i in (0, 1, 7, 8)} | {i: t.ink for i in (2, 3, 4, 5, 6)},
            lines={i: t.muted for i in (2, 3, 4, 5, 6)})
    card(s, 0.4, 2.22, 6.2, 4.2, t, "REAL SCREENS FROM THE CERTIFIED RUN")
    top, hh = 2.68, 3.32
    w1, _ = picture(s, S["mgr"], 0.58, top, h=hh, frame=t.line)
    w2, _ = picture(s, S["truck"], 0.58 + w1 + 0.2, top, h=hh, frame=t.line)
    w3, _ = picture(s, S["nav"], 0.58 + w1 + w2 + 0.4, top, h=hh, frame=t.line)
    for cx, cw, lab in [(0.58, w1, "Manager · route review"), (0.58 + w1 + 0.2, w2, "Driver · truck check"),
                        (0.58 + w1 + w2 + 0.4, w3, "Driver · navigation")]:
        text(s, cx, top + hh + 0.06, cw, 0.26, [[(lab, {"size": 9, "color": t.muted})]], t=t, align=PP_ALIGN.CENTER)
    card(s, 6.75, 2.22, 6.13, 4.2, t, "PROOF", sub="physical Android phone · hosted backend · real road")
    cx, cw = 6.93, 5.77
    text(s, cx, 2.72, cw, 0.6, [[(F["run_line"], {"size": 11.5, "color": t.ink})]], t=t, spacing=1.05)
    y = 3.42
    for n, lab in F["proof"]:
        stat(s, cx, y, cw, n, lab, t, num_size=17, lab_size=11, num_color=t.accent, lab_color=t.ink, gap=1.02)
        y += 0.44
    runs = []
    for i, (n, lab) in enumerate(F["tests"]):
        runs += [(n + " ", {"bold": True, "size": 13, "color": t.accent}),
                 (lab + ("  ·  " if i < 2 else " tests"), {"size": 10.5, "color": t.ink})]
    text(s, cx, y + 0.02, cw, 0.34, [runs], t=t, anchor=MSO_ANCHOR.MIDDLE)
    pill(s, cx, y + 0.5, cw, 0.38, "PHYSICAL ANDROID · CERTIFIED", t, fill=t.ok, color=rgb("06121F"), size=11.5)
    text(s, cx, y + 1.0, cw, 0.34, [[("Canonical demo  ", {"bold": True, "size": 10.5, "color": t.muted}),
                                     (F["corridor"], {"bold": True, "size": 11, "color": t.ink})]], t=t)
    text(s, 0.5, 6.5, 12.35, 0.42, [[("KNOWN LIMITS → MITIGATION   ", {"bold": True, "size": 9, "color": t.muted}),
                                     (F["limits"], {"size": 9, "color": t.grey})]], t=t, spacing=1.05)


def s5(s, t, S):
    content_slide(s, t, F["titles"][4])
    ground(s, t)
    text(s, 0.5, 1.24, 8.8, 0.84, [[("RASTA AI does not ask only ", {"size": 18, "color": t.grey}),
                                    ("“Which road is shortest?”", {"size": 18, "bold": True, "color": t.ink}),
                                    ("  It asks  ", {"size": 18, "color": t.grey}),
                                    ("“Can this truck reliably use this corridor now?”",
                                     {"size": 18, "bold": True, "color": t.accent})]], t=t, spacing=1.05)
    text(s, 0.5, 2.14, 8.8, 0.32, [[(F["supplies"], {"bold": True, "size": 12.5, "color": t.ok}),
                                    ("   — essential logistics for hill communities, decided on evidence",
                                     {"size": 11, "color": t.grey})]], t=t)
    card(s, 0.42, 2.56, 8.95, 1.6, t, "WHO BENEFITS")
    cw = 2.04
    for i, (h, b) in enumerate(F["who"]):
        x = 0.58 + i * (cw + 0.16)
        hline(s, x, 3.04, cw, t.accent, 1.5)
        text(s, x, 3.1, cw, 1.0, [[(h, {"bold": True, "size": 10.5, "color": t.accent})],
                                  [(b, {"size": 10.5, "color": t.ink})]], t=t, spacing=1.05, space_after=4)
    card(s, 0.42, 4.26, 8.95, 1.64, t, "DEMONSTRATED TODAY")
    for i, (n, lab) in enumerate(F["caps"]):
        col, row = divmod(i, 3)
        stat(s, 0.62 + col * 4.35, 4.68 + row * 0.4, 4.2, n, lab, t, num_size=17, lab_size=10.5,
             num_color=t.accent, lab_color=t.ink, align=PP_ALIGN.RIGHT, gap=1.0)
    card(s, 0.42, 6.0, 8.95, 0.88, t, "HUMAN GOVERNANCE", sub="AI has no uncontrolled authority")
    chain_h(s, 0.6, 6.42, [(c, 1.95) for c in F["chain"]], t, h=0.34, gap=0.26, size=10,
            fills={0: t.accent}, colors={0: rgb("06121F"), 1: t.ink, 2: t.ink, 3: t.ink},
            lines={i: t.muted for i in range(1, 4)})
    card(s, 9.45, 1.22, 3.43, 5.66, t, "REAL SCREENS · APK 1.0.18")
    w1, _ = picture(s, S["lang"], 9.62, 1.72, h=2.5, frame=t.line)
    w2, _ = picture(s, S["mobile"], 9.62 + w1 + 0.16, 1.72, h=2.5, frame=t.line)
    text(s, 9.62, 4.3, w1, 0.26, [[("Driver · 23 languages", {"size": 9, "color": t.muted})]], t=t, align=PP_ALIGN.CENTER)
    text(s, 9.62 + w1 + 0.16, 4.3, w2, 0.26, [[("Manager · mobile", {"size": 9, "color": t.muted})]], t=t, align=PP_ALIGN.CENTER)
    text(s, 9.62, 4.66, 3.1, 2.0, [[(F["screens_note"], {"size": 10, "color": t.grey})]],
         t=t, spacing=1.05)


def s6(s, t, S):
    content_slide(s, t, F["titles"][5])
    ground(s, t)
    card(s, 0.42, 1.22, 7.4, 4.86, t, "RESEARCH / EVIDENCE SOURCES BEHIND THE ROUTE DECISION", title_size=10.5)
    gw = 3.4
    for i, (lab, names, what) in enumerate(F["groups"]):
        col, row = i % 2, i // 2
        x = 0.58 + col * (gw + 0.24)
        y = 1.72 + row * 1.42
        hline(s, x, y, gw, t.accent, 1.5)
        text(s, x, y + 0.06, gw, 1.2, [[(lab, {"bold": True, "size": 9.5, "color": t.accent})],
                                       [(names, {"bold": True, "size": 11, "color": t.ink})],
                                       [(what, {"size": 10, "color": t.grey})]], t=t, spacing=1.05, space_after=3)
    mx, mw = 8.22, 4.5
    card(s, 8.05, 1.22, 4.83, 4.86, t, "EXPERIMENTAL LANDSLIDE RESEARCH", title_size=10.5, accent=t.muted)
    text(s, mx, 1.66, 1.85, 0.94, [[(F["ml_recall"], {"bold": True, "size": 44, "color": t.ink})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, mx + 1.85, 1.7, mw - 1.85, 0.88, [[(F["ml_recall_what"], {"bold": True, "size": 12, "color": t.ink})],
                                              [(F["ml_recall_sub"], {"size": 9.5, "color": t.grey})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE, spacing=1.05)
    rect(s, mx, 2.74, mw, 0.8, fill=rgb("05080F"), line=t.muted, rounded=True, line_w=1.25, radius=0.08)
    text(s, mx, 2.8, mw, 0.7, [[(F["ml_gate_small"], {"bold": True, "size": 11, "color": t.muted})],
                               [(F["ml_gate_big"], {"bold": True, "size": 21, "color": t.on_dark})]],
         t=t, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, spacing=1.0)
    text(s, mx, 3.62, mw, 0.32, [[(F["ml_fpr"], {"bold": True, "size": 13, "color": t.danger}),
                                  ("   " + F["ml_fpr_why"], {"size": 10, "color": t.grey})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    fy = 4.02
    for row in ([(F["ml_flow"][0], 0.76), (F["ml_flow"][1], 1.58), (F["ml_flow"][2], 1.74)],
                [(F["ml_flow"][3], 1.94), (F["ml_flow"][4], 1.06), (F["ml_flow"][5], 1.24)]):
        chain_h(s, mx, fy, row, t, h=0.28, gap=0.08, size=8,
                colors={i: t.ink for i in range(3)}, lines={i: t.muted for i in range(3)})
        fy += 0.38
    text(s, mx, 4.82, mw, 0.7, [[(F["ml_caption_lead"] + " ", {"bold": True, "size": 11, "color": t.accent}),
                                 (F["ml_caption"], {"size": 10, "color": t.ink})]], t=t, spacing=1.05)
    text(s, mx, 5.5, mw, 0.5, [[(F["ml_metrics"], {"size": 8, "color": t.muted})]], t=t, spacing=1.05)
    text(s, 0.5, 6.18, 3, 0.26, [[("REFERENCES", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    text(s, 0.5, 6.44, 12.35, 0.48, [[(F["refs"], {"size": 9, "color": t.grey})]], t=t, spacing=1.1)


SLIDES = [s1, s2, s3, s4, s5, s6]
