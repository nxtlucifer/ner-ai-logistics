"""V06 SIGNAL — one number owns each slide.

Every slide is anchored by the single figure a judge should carry away from it,
set very large, with the argument hanging off it. Thin rules, no panels.
"""
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from deckkit import (FACTS as F, Theme, arrow, chain_h, chain_v, content_slide, hline,
                     picture, pill, rect, stat, text, title_slide_prep)

THEME = Theme(slug="V06_SIGNAL", label="Signal", font="Calibri", accent="4338CA",
              accent2="B45309", ok="047857", warn="B45309", danger="BE123C", ink="0F1020",
              grey="52526B", muted="9A9AB2", line="E2E2EC", bg="F6F6FB", radius=0.06, border=1.0,
              note="One dominant figure per slide, with the argument hanging off it.")


def hero(s, t, x, y, number, cap, sub, num_size=64, w=3.5):
    text(s, x, y, w, num_size / 52.0, [[(number, {"bold": True, "size": num_size, "color": t.accent})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE)
    yy = y + num_size / 52.0 - 0.06
    text(s, x, yy, w, 0.28, [[(cap, {"bold": True, "size": 11.5})]], t=t)
    text(s, x, yy + 0.28, w, 0.7, [[(sub, {"size": 10, "color": t.grey})]], t=t, spacing=1.05)


def s1(s, t, S):
    title_slide_prep(s)
    text(s, 0.55, 1.28, 6.6, 0.66, [[(F["name"], {"bold": True, "size": 38})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 0.58, 1.94, 6.6, 0.38, [[(F["tagline"], {"size": 12, "color": t.grey})]], t=t)
    hline(s, 0.55, 2.42, 6.6, t.ink, 2.0)
    text(s, 0.55, 2.54, 6.6, 1.22, [[(F["headline"], {"bold": True, "size": 33})]], t=t, spacing=0.95)
    text(s, 0.55, 3.74, 6.6, 0.36, [[(F["question"], {"size": 13, "color": t.accent})]], t=t)
    hline(s, 0.55, 4.18, 6.6, t.line)
    pill(s, 0.55, 4.28, 2.0, 0.56, F["ps_id"], t, fill=t.accent, size=22)
    text(s, 2.72, 4.3, 4.4, 0.52, [[("PROBLEM STATEMENT ID", {"bold": True, "size": 9, "color": t.muted})],
                                   [(F["ministry"] + " · " + F["theme"] + " · " + F["category"], {"size": 11})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE)
    y = 5.0
    for k, v in [("Problem Statement Title", F["ps_title"]), ("Theme", F["theme"]),
                 ("PS Category", F["category"]), ("Team ID", F["team_id"]), ("Team Name", F["team"])]:
        tall = 0.42 if k == "Problem Statement Title" else 0.26
        text(s, 0.55, y, 2.0, tall, [[(k.upper(), {"bold": True, "size": 8.5, "color": t.muted})]], t=t)
        text(s, 2.6, y - 0.03, 4.55, tall, [[(v, {"size": 11.5, "bold": k in ("Team ID", "Team Name")})]], t=t, spacing=1.0)
        hline(s, 0.55, y + tall + 0.01, 6.6, t.line)
        y += tall + 0.05
    text(s, 0.55, 6.72, 6.6, 0.4, [[(F["proof_line"], {"size": 10, "color": t.ok, "bold": True})]], t=t, spacing=1.1)
    text(s, 7.5, 1.26, 5.35, 0.28, [[("LIVE WORKING SYSTEM", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    picture(s, S["mgr"], 7.55, 2.5, h=3.9, frame=t.line)
    picture(s, S["nav"], 10.44, 1.7, h=4.7, frame=t.line)
    text(s, 7.5, 6.5, 5.35, 0.3, [[("Manager route review · Driver navigation — real screens",
                                    {"size": 9.5, "color": t.grey})]], t=t)


def s2(s, t, S):
    content_slide(s, t, F["titles"][1])
    hero(s, t, 0.5, 1.3, "11", "ROUTE FACTORS", "scored on the selected road before a truck is dispatched, each with its own freshness", w=3.0)
    hline(s, 0.5, 3.46, 3.0, t.line)
    text(s, 0.5, 3.54, 3.0, 1.0, [[("A normal router checks none of them.", {"size": 11.5, "bold": True})],
                                  [(" → ".join(F["normal_router"]), {"size": 10.5, "color": t.grey})],
                                  [(F["normal_gap"][1], {"size": 10.5, "color": t.grey})]], t=t, spacing=1.05, space_after=4)
    text(s, 3.85, 1.24, 5.45, 0.92, [[("Not the shortest road. ", {"bold": True, "size": 21}),
                                      ("The road that is usable now.", {"bold": True, "size": 21, "color": t.accent})]],
         t=t, spacing=1.0)
    cx, cy = 3.85, 2.26
    for lab, wd in zip(F["evidence_chips"], [0.9, 0.9, 1.44, 1.16, 1.32, 1.06, 1.42]):
        if cx + wd > 9.32:
            cx = 3.85; cy += 0.32
        pill(s, cx, cy, wd, 0.28, lab, t, fill=None, color=t.ink, line=t.line, size=9, bold=False)
        cx += wd + 0.08
    y = cy + 0.46
    chain_v(s, 3.85, 5.45, y, [("OPERATIONAL DECISION  ·  CONTINUE / CAUTION / HOLD / REROUTE", t.accent, None, None),
                               ("Manager governance  ·  authorises, dispatches, approves reroutes", None, t.ink, t.ink),
                               ("Driver  ·  navigation, danger context, 23 languages, offline package", None, t.ink, t.ink)],
            t, h=0.3, gap=0.12, size=10.5)
    hline(s, 0.5, 6.22, 8.82, t.danger, 2.0)
    text(s, 0.5, 6.32, 3.1, 0.44, [[("UNKNOWN ≠ SAFE", {"bold": True, "size": 18, "color": t.danger})]], t=t)
    text(s, 3.85, 6.36, 5.45, 0.5, [[(F["unknown_rule"], {"size": 10.5})]], t=t, spacing=1.05)
    text(s, 9.5, 1.2, 3.35, 0.28, [[("MANAGER · CHECK CONDITIONS", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    picture(s, S["evid"], 9.5, 1.58, h=4.88, frame=t.line)
    text(s, 9.5, 6.52, 3.35, 0.3, [[("Real screen · evidence · freshness · UNKNOWN", {"size": 9, "color": t.grey})]], t=t)


def s3(s, t, S):
    content_slide(s, t, F["titles"][2])
    hero(s, t, 0.5, 1.26, "60 s", "ROUTE-AHEAD MONITOR",
         "the road ahead is re-scored every minute while the truck is moving; a material change goes back through the policy", w=2.9)
    hline(s, 0.5, 3.5, 2.9, t.line)
    text(s, 0.5, 3.6, 2.9, 1.4, [[("A reroute is proposed to the manager, never applied silently.",
                                   {"size": 11, "color": t.grey})]], t=t, spacing=1.05)
    x, bw = 3.75, 0.88
    text(s, 3.75, 1.2, 5.6, 0.26, [[("VERIFIED DATA", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    for lab, sub in F["sources"]:
        text(s, x, 1.48, bw + 0.04, 0.62, [[(lab.split()[0], {"bold": True, "size": 8.5})],
                                           [(sub, {"size": 7.5, "color": t.grey})]], t=t, spacing=1.0)
        x += bw + 0.06
    y = 2.22
    for title, sub, fill in [("ROUTE-SPECIFIC EVIDENCE · FastAPI backend",
                              "every factor sampled along the selected road · PostgreSQL + PostGIS (Supabase) · OSRM routes, alternatives, turn steps", None),
                             ("DETERMINISTIC SAFETY POLICY",
                              "11 factors · reason codes · UNKNOWN ≠ SAFE · reviewer authorisation when hazard data is missing", t.accent)]:
        rect(s, 3.75, y, 5.57, 0.56, fill=fill or t.bg, line=t.line, rounded=True, radius=0.06)
        text(s, 3.9, y + 0.04, 5.3, 0.48, [[(title, {"bold": True, "size": 10.5, "color": t.paper if fill else t.ink})],
                                           [(sub, {"size": 8.5, "color": t.line if fill else t.grey})]], t=t, spacing=1.0)
        y += 0.66
    dw = (5.57 - 3 * 0.1) / 4
    dx = 3.75
    for lab, kind in F["decisions"]:
        pill(s, dx, y, dw, 0.34, lab, t, fill=t.c({"ok": "ok", "warn": "warn", "danger": "danger", "ink": "ink"}[kind]), size=10)
        dx += dw + 0.1
    y += 0.48
    chain_h(s, 3.75, y, [("MANAGER REVIEW", 1.34), ("DRIVER NAVIGATION", 1.44), ("60 s WATCH", 1.0),
                         ("REASSESS / REROUTE", 1.5)], t, h=0.32, gap=0.09, size=8.5,
            fills={0: t.ink}, colors={0: t.on_dark}, lines={i: t.ink for i in range(4)})
    y += 0.5
    hline(s, 3.75, y, 5.57, t.line)
    text(s, 3.75, y + 0.06, 5.57, 1.0, [
        [("CLIENTS  ", {"bold": True, "size": 8.5, "color": t.muted}), (F["clients"], {"size": 9.5})],
        [("STACK  ", {"bold": True, "size": 8.5, "color": t.muted}), (F["stack"], {"size": 9.5})],
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
    hero(s, t, 0.5, 1.2, "12/12", "JUDGE-FLOW STEPS",
         "dispatch → accept → truck check → GPS navigation → real off-route → reroute → manager approval → stops → delivery, on a physical Android phone", w=2.9, num_size=54)
    hline(s, 0.5, 3.6, 2.9, t.line)
    stat(s, 0.5, 3.68, 2.9, "9/9", "role-flow steps", t, num_size=17, lab_size=10.5, gap=0.9)
    runs = []
    for i, (n, lab) in enumerate(F["tests"]):
        runs += [(n + " ", {"bold": True, "size": 12, "color": t.accent}),
                 (lab + ("  ·  " if i < 2 else " tests"), {"size": 9.5})]
    text(s, 0.5, 4.14, 2.9, 0.6, [runs], t=t, spacing=1.1)
    pill(s, 0.5, 4.8, 2.9, 0.36, "PHYSICAL ANDROID · CERTIFIED", t, fill=t.ok, size=10)
    text(s, 0.5, 5.28, 2.9, 0.5, [[("Canonical demo", {"bold": True, "size": 9.5, "color": t.muted})],
                                  [(F["corridor"], {"bold": True, "size": 10.5})]], t=t, spacing=1.05)
    text(s, 3.7, 1.2, 9.15, 0.36, [[("Not a concept. A working end-to-end prototype.", {"bold": True, "size": 19})]], t=t)
    widths = [0.62, 0.74, 0.86, 0.78, 1.06, 0.9, 0.9, 1.76, 0.86]
    chain_h(s, 3.7, 1.64, list(zip(F["lifecycle"], widths)), t, h=0.32, gap=0.07, size=7,
            fills={0: t.accent, 1: t.accent, 7: t.accent, 8: t.ok},
            colors={i: t.on_dark for i in (0, 1, 7, 8)}, lines={i: t.ink for i in (2, 3, 4, 5, 6)})
    top, hh = 2.18, 3.5
    w1, _ = picture(s, S["mgr"], 3.7, top, h=hh, frame=t.line)
    w2, _ = picture(s, S["truck"], 3.7 + w1 + 0.22, top, h=hh, frame=t.line)
    w3, _ = picture(s, S["nav"], 3.7 + w1 + w2 + 0.44, top, h=hh, frame=t.line)
    w4, _ = picture(s, S["review"], 3.7 + w1 + w2 + w3 + 0.66, top, h=hh, frame=t.line)
    for cx, cw, lab in [(3.7, w1, "Manager · route review"), (3.7 + w1 + 0.22, w2, "Driver · truck check"),
                        (3.7 + w1 + w2 + 0.44, w3, "Driver · navigation"),
                        (3.7 + w1 + w2 + w3 + 0.66, w4, "Manager · reroute review")]:
        text(s, cx, top + hh + 0.06, cw, 0.26, [[(lab, {"size": 8.5, "color": t.grey})]], t=t, align=PP_ALIGN.CENTER)
    text(s, 0.5, 6.5, 12.35, 0.42, [[("KNOWN LIMITS → MITIGATION   ", {"bold": True, "size": 9, "color": t.muted}),
                                     (F["limits"], {"size": 9, "color": t.grey})]], t=t, spacing=1.05)


def s5(s, t, S):
    content_slide(s, t, F["titles"][4])
    hero(s, t, 0.5, 1.22, "0", "UNKNOWN FACTORS COUNTED AS SAFE",
         "the rule the whole product is built on: missing or stale evidence is never read as a clear road", w=2.9, num_size=64)
    hline(s, 0.5, 3.6, 2.9, t.line)
    text(s, 0.5, 3.68, 2.9, 0.9, [[(F["supplies"], {"bold": True, "size": 12, "color": t.ok})],
                                  [("essential logistics for hill communities, decided on evidence", {"size": 10, "color": t.grey})]],
         t=t, spacing=1.05, space_after=4)
    text(s, 3.7, 1.2, 5.62, 0.78, [[("RASTA AI does not ask only ", {"size": 15, "color": t.grey}),
                                    ("“Which road is shortest?”", {"size": 15, "bold": True}),
                                    ("  It asks  ", {"size": 15, "color": t.grey}),
                                    ("“Can this truck reliably use this corridor now?”",
                                     {"size": 15, "bold": True, "color": t.accent})]], t=t, spacing=1.05)
    hline(s, 3.7, 2.06, 5.62, t.ink, 1.5)
    text(s, 3.7, 2.14, 4, 0.26, [[("WHO BENEFITS", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    y = 2.44
    for h, b in F["who"]:
        text(s, 3.7, y, 1.9, 0.34, [[(h, {"bold": True, "size": 9.5, "color": t.accent})]], t=t)
        text(s, 5.66, y, 3.66, 0.34, [[(b, {"size": 10})]], t=t)
        hline(s, 3.7, y + 0.34, 5.62, t.line)
        y += 0.42
    text(s, 3.7, y + 0.06, 4, 0.26, [[("DEMONSTRATED TODAY", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    y += 0.34
    for i, (n, lab) in enumerate(F["caps"][:5]):
        col, r = divmod(i, 3)
        stat(s, 3.7 + col * 2.86, y + r * 0.38, 2.8, n, lab, t, num_size=14, lab_size=9, align=PP_ALIGN.RIGHT, gap=0.72)
    hline(s, 0.5, 5.94, 8.82, t.ink, 1.5)
    text(s, 0.5, 6.0, 8.82, 0.26, [[("HUMAN GOVERNANCE — AI HAS NO UNCONTROLLED AUTHORITY",
                                     {"bold": True, "size": 9, "color": t.muted})]], t=t)
    chain_h(s, 0.5, 6.3, [(c, 2.04) for c in F["chain"]], t, h=0.34, gap=0.22, size=10,
            fills={0: t.ink}, colors={0: t.on_dark}, lines={i: t.ink for i in range(4)})
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
    hero(s, t, 0.5, 1.22, F["ml_recall"], F["ml_recall_what"], F["ml_recall_sub"], w=3.0, num_size=64)
    rect(s, 0.5, 3.6, 3.0, 0.86, fill=t.ink, rounded=True, radius=0.06)
    text(s, 0.5, 3.66, 3.0, 0.76, [[(F["ml_gate_small"], {"bold": True, "size": 11, "color": t.muted})],
                                   [(F["ml_gate_big"], {"bold": True, "size": 21, "color": t.on_dark})]],
         t=t, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, spacing=1.0)
    text(s, 0.5, 4.56, 3.0, 0.5, [[(F["ml_fpr"], {"bold": True, "size": 13, "color": t.danger})],
                                  [(F["ml_fpr_why"], {"size": 9.5, "color": t.grey})]], t=t, spacing=1.05)
    text(s, 0.5, 5.2, 3.0, 0.6, [[(F["ml_caption_lead"], {"bold": True, "size": 10.5, "color": t.accent})],
                                 [(F["ml_caption"], {"size": 9.5})]], t=t, spacing=1.05, space_after=2)
    text(s, 3.85, 1.2, 8.98, 0.26, [[("RESEARCH / EVIDENCE SOURCES BEHIND THE ROUTE DECISION",
                                      {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    hline(s, 3.85, 1.48, 8.98, t.ink, 1.5)
    gw = 4.36
    for i, (lab, names, what) in enumerate(F["groups"]):
        col, row = i % 2, i // 2
        x = 3.85 + col * (gw + 0.26)
        y = 1.6 + row * 1.32
        text(s, x, y, gw, 1.14, [[(lab, {"bold": True, "size": 9.5, "color": t.accent})],
                                 [(names, {"bold": True, "size": 11})],
                                 [(what, {"size": 10, "color": t.grey})]], t=t, spacing=1.05, space_after=2)
        hline(s, x, y + 1.18, gw, t.line)
    fy = 5.62
    chain_h(s, 3.85, fy, [(F["ml_flow"][0], 0.84), (F["ml_flow"][1], 1.6), (F["ml_flow"][2], 1.76),
                          (F["ml_flow"][3], 1.94), (F["ml_flow"][4], 1.08), (F["ml_flow"][5], 1.24)],
            t, h=0.28, gap=0.07, size=8, lines={i: t.ink for i in range(6)})
    text(s, 3.85, 6.0, 8.98, 0.34, [[(F["ml_metrics"], {"size": 8, "color": t.grey})]], t=t, spacing=1.05)
    hline(s, 0.5, 6.4, 12.35, t.line)
    text(s, 0.5, 6.46, 12.35, 0.48, [[("REFERENCES   ", {"bold": True, "size": 8.5, "color": t.muted}),
                                      (F["refs"], {"size": 8.5, "color": t.grey})]], t=t, spacing=1.1)


SLIDES = [s1, s2, s3, s4, s5, s6]
