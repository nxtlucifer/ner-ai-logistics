"""V10 STATEMENT — one sentence, one picture, per slide.

Poster typography. Each slide leads with the single sentence a judge should be
able to repeat afterwards, set very large; the required detail sits underneath
in a compact register so the slide still satisfies the format.
"""
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from deckkit import (FACTS as F, Theme, chain_h, chain_v, content_slide, hline, picture,
                     pill, rect, stat, text, title_slide_prep)

THEME = Theme(slug="V10_STATEMENT", label="Statement", font="Calibri", accent="D92B14",
              accent2="0A0A0A", ok="0F7B4F", warn="B45309", danger="D92B14", ink="0A0A0A",
              grey="59595E", muted="A1A1A8", line="E4E4E7", bg="FAFAFA", radius=0.0, border=1.0,
              note="Poster typography: one repeatable sentence per slide, one picture, detail underneath.")


def say(s, t, x, y, w, parts, size=30, spacing=0.96, h=2.2):
    return text(s, x, y, w, h, [parts], t=t, size=size, spacing=spacing)


def register(s, t, x, y, w, rows, gutter=1.75, size=10, rule=True):
    for k, v in rows:
        text(s, x, y, gutter - 0.1, 0.28, [[(k, {"bold": True, "size": 8, "color": t.muted})]], t=t)
        text(s, x + gutter, y - 0.02, w - gutter, 0.3, [[(v, {"size": size})]], t=t, spacing=1.0)
        if rule:
            hline(s, x, y + 0.3, w, t.line)
        y += 0.38
    return y


def s1(s, t, S):
    title_slide_prep(s)
    text(s, 0.55, 1.3, 6.7, 0.6, [[(F["name"], {"bold": True, "size": 30}),
                                   ("   " + F["ps_id"], {"bold": True, "size": 18, "color": t.accent})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE)
    rect(s, 0.55, 1.98, 1.4, 0.06, fill=t.accent)
    say(s, t, 0.55, 2.16, 6.7, [("SHORTEST IS NOT ALWAYS ", {"bold": True, "size": 34}),
                                ("USABLE.", {"bold": True, "size": 34, "color": t.accent})])
    text(s, 0.55, 3.66, 6.7, 0.5, [[(F["question"], {"size": 14, "color": t.grey})]], t=t)
    hline(s, 0.55, 4.24, 6.7, t.ink, 1.5)
    y = register(s, t, 0.55, 4.36, 6.7, [
        ("PROBLEM STATEMENT", F["ps_id"] + "  ·  " + F["ministry"]),
        ("TITLE", "AI-Based Smart Logistics and Accessibility Intelligence Platform (NER)"),
        ("THEME / CATEGORY", F["theme"] + "  ·  " + F["category"]),
        ("TEAM", F["team"] + "  ·  Team ID " + F["team_id"]),
    ])
    text(s, 0.55, y + 0.06, 6.7, 0.6, [[(F["tagline"], {"size": 11, "color": t.grey})]], t=t, spacing=1.05)
    text(s, 0.55, y + 0.56, 6.7, 0.4, [[(F["proof_line"], {"size": 10, "color": t.ok, "bold": True})]], t=t, spacing=1.05)
    picture(s, S["nav"], 10.24, 1.3, h=5.6, frame=t.line)
    picture(s, S["mgr"], 7.5, 2.7, h=4.2, frame=t.line)
    text(s, 7.5, 1.3, 2.6, 0.9, [[("A WORKING SYSTEM, NOT A DECK",
                                   {"bold": True, "size": 11, "color": t.accent})]], t=t, spacing=1.05)


def s2(s, t, S):
    content_slide(s, t, F["titles"][1])
    rect(s, 0.5, 1.22, 1.4, 0.06, fill=t.accent)
    say(s, t, 0.5, 1.4, 8.82, [("A road can be the shortest and still be ", {"size": 28}),
                               ("unusable.", {"bold": True, "size": 28, "color": t.accent})], size=28)
    text(s, 0.5, 2.6, 8.82, 0.42, [[(F["problem"] + "  ", {"size": 11, "color": t.grey}), (F["problem_kick"], {"size": 11, "bold": True, "color": t.danger})]], t=t, spacing=1.05)
    hline(s, 0.5, 3.16, 8.82, t.ink, 1.5)
    text(s, 0.5, 3.26, 2.5, 0.28, [[("A NORMAL ROUTER", {"bold": True, "size": 8.5, "color": t.muted})]], t=t)
    text(s, 0.5, 3.54, 2.6, 0.8, [[("  →  ".join(F["normal_router"]), {"size": 11, "color": t.grey})],
                                  [(F["normal_gap"][1], {"size": 10, "color": t.muted})]], t=t, spacing=1.05, space_after=4)
    text(s, 3.4, 3.26, 5.92, 0.28, [[("RASTA AI", {"bold": True, "size": 8.5, "color": t.accent})]], t=t)
    ex, ey = 3.4, 3.54
    for lab, wd in zip(F["evidence_chips"], [0.86, 0.86, 1.36, 1.1, 1.26, 1.0, 1.36]):
        if ex + wd > 9.32:
            ex = 3.4; ey += 0.3
        pill(s, ex, ey, wd, 0.26, lab, t, fill=None, color=t.ink, line=t.line, size=9, bold=False, rounded=False)
        ex += wd + 0.08
    dw = (5.92 - 3 * 0.1) / 4
    dx = 3.4
    for lab, kind in F["decisions"]:
        pill(s, dx, ey + 0.4, dw, 0.34, lab, t, fill=t.c({"ok": "ok", "warn": "warn", "danger": "danger", "ink": "ink"}[kind]),
             size=10.5, rounded=False)
        dx += dw + 0.1
    text(s, 3.4, ey + 0.84, 5.92, 0.3, [[("Manager governance → driver navigation, 23 languages, offline package",
                                          {"size": 10})]], t=t)
    rect(s, 0.5, 5.86, 8.82, 0.06, fill=t.accent)
    say(s, t, 0.5, 6.0, 4.0, [("UNKNOWN ≠ SAFE", {"bold": True, "size": 24, "color": t.accent})], size=24, h=0.5)
    text(s, 4.2, 6.06, 5.12, 0.6, [[(F["unknown_rule"], {"size": 10.5})]], t=t, spacing=1.05)
    text(s, 9.5, 1.22, 3.35, 0.28, [[("MANAGER · CHECK CONDITIONS", {"bold": True, "size": 8.5, "color": t.muted})]], t=t)
    picture(s, S["evid"], 9.5, 1.56, h=4.9, frame=t.line)
    text(s, 9.5, 6.52, 3.35, 0.3, [[("Real screen · evidence · freshness · UNKNOWN", {"size": 9, "color": t.grey})]], t=t)


def s3(s, t, S):
    content_slide(s, t, F["titles"][2])
    rect(s, 0.5, 1.22, 1.4, 0.06, fill=t.accent)
    say(s, t, 0.5, 1.4, 8.82, [("Evidence decides. ", {"bold": True, "size": 28}),
                               ("AI explains, and never overrules.", {"size": 28, "color": t.grey})], size=28)
    hline(s, 0.5, 2.68, 8.82, t.ink, 1.5)
    x, bw = 0.5, 1.46
    for lab, sub in F["sources"]:
        text(s, x, 2.78, bw, 0.6, [[(lab, {"bold": True, "size": 8.5})], [(sub, {"size": 7.5, "color": t.grey})]],
             t=t, spacing=1.0)
        x += bw + 0.02
    y = 3.46
    for title, sub, fill in [("ROUTE-SPECIFIC EVIDENCE · FastAPI backend",
                              "every factor sampled along the selected road · PostgreSQL + PostGIS (Supabase) · OSRM routes, alternatives, turn steps", None),
                             ("DETERMINISTIC SAFETY POLICY",
                              "11 factors · reason codes · UNKNOWN ≠ SAFE · reviewer authorisation when hazard data is missing", t.ink)]:
        rect(s, 0.5, y, 8.82, 0.54, fill=fill or t.bg)
        text(s, 0.64, y + 0.03, 8.54, 0.48, [[(title, {"bold": True, "size": 10, "color": t.paper if fill else t.ink})],
                                             [(sub, {"size": 8.5, "color": t.muted if fill else t.grey})]], t=t, spacing=1.0)
        y += 0.62
    dw = (8.82 - 3 * 0.12) / 4
    dx = 0.5
    for lab, kind in F["decisions"]:
        pill(s, dx, y, dw, 0.34, lab, t, fill=t.c({"ok": "ok", "warn": "warn", "danger": "danger", "ink": "ink"}[kind]),
             size=10.5, rounded=False)
        dx += dw + 0.12
    y += 0.48
    chain_h(s, 0.5, y, [("MANAGER REVIEW", 1.45), ("DRIVER NAVIGATION", 1.56), ("ROUTE-AHEAD 60 s", 1.48),
                        ("CONDITIONS CHANGE?", 1.64), ("REASSESS", 1.05)], t, h=0.32, gap=0.08, size=8,
            fills={0: t.ink}, colors={0: t.on_dark}, lines={i: t.ink for i in range(5)})
    y += 0.46
    hline(s, 0.5, y, 8.82, t.line)
    text(s, 0.5, y + 0.06, 8.82, 1.0, [
        [("CLIENTS  ", {"bold": True, "size": 8, "color": t.muted}), (F["clients"], {"size": 9.5})],
        [("STACK  ", {"bold": True, "size": 8, "color": t.muted}), (F["stack"], {"size": 9.5})],
    ], t=t, spacing=1.15, space_after=3)
    text(s, 9.5, 1.22, 3.35, 0.28, [[("WHO DECIDES", {"bold": True, "size": 8.5, "color": t.muted})]], t=t)
    hline(s, 9.5, 1.5, 3.35, t.ink, 1.5)
    y = 1.62
    for lab, sub, kind in F["deciders"]:
        rect(s, 9.5, y + 0.02, 0.05, 0.68, fill=t.c(kind) if kind != "accent" else t.accent)
        text(s, 9.66, y, 3.19, 0.82, [[(lab, {"bold": True, "size": 10.5})], [(sub, {"size": 10, "color": t.grey})]],
             t=t, spacing=1.0)
        y += 0.92
    hline(s, 9.5, y + 0.02, 3.35, t.line)
    text(s, 9.5, y + 0.1, 3.35, 0.28, [[("GOVERNANCE CHAIN", {"bold": True, "size": 8.5, "color": t.muted})]], t=t)
    chain_v(s, 9.5, 3.35, y + 0.44, [(c, None, t.ink, t.ink) for c in F["chain"]], t, h=0.32, gap=0.14, size=10)


def s4(s, t, S):
    content_slide(s, t, F["titles"][3])
    rect(s, 0.5, 1.2, 1.4, 0.06, fill=t.accent)
    say(s, t, 0.5, 1.36, 6.0, [("It already runs ", {"size": 27}),
                               ("on a real phone, on a real road.", {"bold": True, "size": 27})], size=27)
    text(s, 0.5, 2.92, 6.0, 0.6, [[(F["run_line"], {"size": 11.5, "color": t.grey})]], t=t, spacing=1.05)
    y = 3.6
    for n, lab in F["proof"]:
        stat(s, 0.5, y, 6.0, n, lab, t, num_size=24, lab_size=12, gap=1.4)
        y += 0.56
    runs = []
    for i, (n, lab) in enumerate(F["tests"]):
        runs += [(n + " ", {"bold": True, "size": 15, "color": t.accent}),
                 (lab + ("  ·  " if i < 2 else " tests"), {"size": 11})]
    text(s, 0.5, y, 6.0, 0.36, [runs], t=t, anchor=MSO_ANCHOR.MIDDLE)
    pill(s, 0.5, y + 0.5, 6.0, 0.4, "PHYSICAL ANDROID · CERTIFIED", t, fill=t.ok, size=12, rounded=False)
    text(s, 0.5, y + 1.0, 6.0, 0.34, [[("Canonical demo  ", {"bold": True, "size": 10, "color": t.muted}),
                                       (F["corridor"], {"bold": True, "size": 11})]], t=t)
    text(s, 6.9, 1.24, 5.98, 0.28, [[("CERTIFIED LIFECYCLE", {"bold": True, "size": 8.5, "color": t.muted})]], t=t)
    for i, step in enumerate(F["lifecycle"]):
        col, r = divmod(i, 3)
        on = i in (0, 1, 7, 8)
        pill(s, 6.9 + col * 2.0, 1.54 + r * 0.38, 1.88, 0.32, step, t,
             fill=t.ink if on else None, color=t.paper if on else t.ink,
             line=None if on else t.line, size=8, rounded=False)
    top, hh = 2.86, 3.34
    w1, _ = picture(s, S["mgr"], 6.9, top, h=hh, frame=t.line)
    w2, _ = picture(s, S["truck"], 6.9 + w1 + 0.2, top, h=hh, frame=t.line)
    w3, _ = picture(s, S["nav"], 6.9 + w1 + w2 + 0.4, top, h=hh, frame=t.line)
    for px, pw, lab in [(6.9, w1, "Manager · route review"), (6.9 + w1 + 0.2, w2, "Driver · truck check"),
                        (6.9 + w1 + w2 + 0.4, w3, "Driver · navigation")]:
        text(s, px, top + hh + 0.06, pw, 0.26, [[(lab, {"size": 9, "color": t.grey})]], t=t, align=PP_ALIGN.CENTER)
    text(s, 0.5, 6.6, 12.35, 0.4, [[("KNOWN LIMITS → MITIGATION   ", {"bold": True, "size": 8, "color": t.muted}),
                                    (F["limits"], {"size": 8, "color": t.grey})]], t=t, spacing=1.05)


def s5(s, t, S):
    content_slide(s, t, F["titles"][4])
    rect(s, 0.5, 1.2, 1.4, 0.06, fill=t.accent)
    say(s, t, 0.5, 1.36, 8.82, [("Food, medicine, fuel and relief ", {"size": 27}),
                                ("reach people when the corridor is decided on evidence.",
                                 {"bold": True, "size": 27})], size=27)
    hline(s, 0.5, 3.24, 8.82, t.ink, 1.5)
    text(s, 0.5, 3.34, 4, 0.28, [[("WHO BENEFITS", {"bold": True, "size": 8.5, "color": t.muted})]], t=t)
    cw = 2.04
    for i, (h, b) in enumerate(F["who"]):
        x = 0.5 + i * (cw + 0.16)
        text(s, x, 3.62, cw, 1.1, [[(h, {"bold": True, "size": 9, "color": t.accent})],
                                   [(b, {"size": 10})]], t=t, spacing=1.05, space_after=3)
    hline(s, 0.5, 4.82, 8.82, t.line)
    text(s, 0.5, 4.88, 4, 0.28, [[("DEMONSTRATED TODAY", {"bold": True, "size": 8.5, "color": t.muted})]], t=t)
    for i, (n, lab) in enumerate(F["caps"]):
        col, r = divmod(i, 3)
        stat(s, 0.5 + col * 4.44, 5.18 + r * 0.4, 4.3, n, lab, t, num_size=17, lab_size=10.5,
             align=PP_ALIGN.RIGHT, gap=1.0)
    rect(s, 0.5, 6.46, 8.82, 0.04, fill=t.ink)
    text(s, 0.5, 6.54, 8.82, 0.34, [[("Verified evidence → deterministic safety policy → manager governance → driver action.  ",
                                      {"bold": True, "size": 10}),
                                     ("AI has no uncontrolled authority; no invented percentages.",
                                      {"size": 10, "color": t.grey})]], t=t)
    text(s, 9.5, 1.22, 3.35, 0.28, [[("REAL SCREENS · APK 1.0.18", {"bold": True, "size": 8.5, "color": t.muted})]], t=t)
    w1, _ = picture(s, S["lang"], 9.5, 1.56, h=2.6, frame=t.line)
    w2, _ = picture(s, S["mobile"], 9.5 + w1 + 0.16, 1.56, h=2.6, frame=t.line)
    text(s, 9.5, 4.24, w1, 0.26, [[("Driver · 23 languages", {"size": 9, "color": t.grey})]], t=t, align=PP_ALIGN.CENTER)
    text(s, 9.5 + w1 + 0.16, 4.24, w2, 0.26, [[("Manager · mobile", {"size": 9, "color": t.grey})]], t=t, align=PP_ALIGN.CENTER)
    text(s, 9.5, 4.62, 3.35, 2.0, [[(F["screens_note"], {"size": 10, "color": t.grey})]],
         t=t, spacing=1.05)


def s6(s, t, S):
    content_slide(s, t, F["titles"][5])
    rect(s, 0.5, 1.2, 1.4, 0.06, fill=t.accent)
    say(s, t, 0.5, 1.36, 7.3, [("We trained it, tested it, and ", {"size": 25}),
                               ("refused to ship it.", {"bold": True, "size": 25, "color": t.accent})], size=25)
    hline(s, 0.5, 2.64, 7.32, t.ink, 1.5)
    text(s, 0.5, 2.72, 7.32, 0.28, [[("RESEARCH / EVIDENCE SOURCES BEHIND THE ROUTE DECISION",
                                      {"bold": True, "size": 8.5, "color": t.muted})]], t=t)
    gw = 3.5
    for i, (lab, names, what) in enumerate(F["groups"]):
        col, row = i % 2, i // 2
        x = 0.5 + col * (gw + 0.32)
        y = 3.04 + row * 1.06
        text(s, x, y, gw, 0.94, [[(lab, {"bold": True, "size": 8, "color": t.accent})],
                                 [(names, {"bold": True, "size": 10})],
                                 [(what, {"size": 9, "color": t.grey})]], t=t, spacing=1.05, space_after=1)
        hline(s, x, y + 0.96, gw, t.line)
    mx, mw = 8.5, 4.35
    text(s, mx, 1.24, mw, 0.28, [[("EXPERIMENTAL LANDSLIDE RESEARCH", {"bold": True, "size": 8.5, "color": t.muted})]], t=t)
    hline(s, mx, 1.52, mw, t.ink, 1.5)
    text(s, mx, 1.64, 1.85, 0.96, [[(F["ml_recall"], {"bold": True, "size": 46})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, mx + 1.85, 1.68, mw - 1.85, 0.9, [[(F["ml_recall_what"], {"bold": True, "size": 12})],
                                              [(F["ml_recall_sub"], {"size": 9.5, "color": t.grey})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE, spacing=1.05)
    rect(s, mx, 2.74, mw, 0.84, fill=t.ink)
    text(s, mx, 2.8, mw, 0.74, [[(F["ml_gate_small"], {"bold": True, "size": 11, "color": t.muted})],
                                [(F["ml_gate_big"], {"bold": True, "size": 22, "color": t.paper})]],
         t=t, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, spacing=1.0)
    text(s, mx, 3.66, mw, 0.32, [[(F["ml_fpr"], {"bold": True, "size": 13, "color": t.accent}),
                                  ("   " + F["ml_fpr_why"], {"size": 10, "color": t.grey})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    fy = 4.06
    for r in ([(F["ml_flow"][0], 0.74), (F["ml_flow"][1], 1.52), (F["ml_flow"][2], 1.68)],
              [(F["ml_flow"][3], 1.88), (F["ml_flow"][4], 1.02), (F["ml_flow"][5], 1.2)]):
        chain_h(s, mx, fy, r, t, h=0.28, gap=0.08, size=8, lines={i: t.ink for i in range(3)})
        fy += 0.38
    text(s, mx, 4.86, mw, 0.68, [[(F["ml_caption_lead"] + " ", {"bold": True, "size": 11, "color": t.accent}),
                                  (F["ml_caption"], {"size": 10})]], t=t, spacing=1.05)
    text(s, mx, 5.54, mw, 0.5, [[(F["ml_metrics"], {"size": 8, "color": t.grey})]], t=t, spacing=1.05)
    hline(s, 0.5, 6.2, 12.35, t.line)
    text(s, 0.5, 6.44, 12.35, 0.48, [[("REFERENCES   ", {"bold": True, "size": 8.5, "color": t.muted}),
                                      (F["refs"], {"size": 8.5, "color": t.grey})]], t=t, spacing=1.1)


SLIDES = [s1, s2, s3, s4, s5, s6]
