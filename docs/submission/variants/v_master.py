"""MASTER — the one deck to submit.

Merges the ten designs into a single six-slide submission and is built
deliberately against the twelve mistakes SIH judges call out:

  1 too much text          key points and figures, no paragraphs
  2 unclear problem        slide 2 opens with the corridor and four hard numbers
  3 generic solution       an explicit USP block, four claims, each falsifiable
  4 no workflow            slide 3 is one INPUT -> PROCESS -> OUTPUT flow
  5 ignoring feasibility   slide 4 answers technology, implementation, COST, scalability
  6 weak USP               the USP block again, named as such
  7 no evidence            real numbers on every slide, real screens throughout
  8 too many technologies  seven named, no logo wall
  9 poor visual design     one palette, one type scale, one panel style
 10 not following template the supplied template, six slides, six categories
 11 missing PS number      SIH26002 set large on slide 1 and repeated on slide 6
 12 no clear impact        slide 5 names who gains what, with figures

Style follows the two reference decks: framed, titled panels; numbered section
badges; the slide filled edge to edge.
"""
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from deckkit import (FACTS as F, Theme, arrow, chain_h, chain_v, content_slide, hline,
                     picture, pill, rect, rgb, stat, text, title_slide_prep)

THEME = Theme(slug="V00_MASTER", label="Master", font="Calibri", accent="15437E",
              accent2="B26A00", ok="12704A", warn="B26A00", danger="B3261E", ink="14202B",
              grey="55636E", muted="93A1AC", line="D4DCE3", bg="F4F7F9", radius=0.07, border=1.1,
              note="The submission deck: every region framed and numbered, built against the 12 SIH mistakes.")

NAVY = rgb("15437E")
AMBER = rgb("B26A00")


def badge(s, t, x, y, n, color=None):
    """A numbered section badge, the way the reference decks mark sections."""
    d = 0.3
    rect(s, x, y, d, d, fill=color or NAVY, rounded=True, radius=d / 2)
    text(s, x, y - 0.02, d, d, [[(str(n), {"bold": True, "size": 11, "color": t.paper})]],
         t=t, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)


def sect(s, t, x, y, w, h, n, title, sub=None, accent=None, fill=None):
    """Framed, numbered, titled region. Returns the y where content starts."""
    col = accent or NAVY
    rect(s, x, y, w, h, fill=fill or t.paper, line=col, rounded=True, line_w=1.1, radius=0.07)
    rect(s, x, y, w, 0.055, fill=col)
    badge(s, t, x + 0.14, y + 0.14, n, col)
    runs = [(title, {"bold": True, "size": 11.5, "color": col})]
    if sub:
        runs.append(("   " + sub, {"size": 9.5, "color": t.grey}))
    text(s, x + 0.54, y + 0.12, w - 0.7, 0.32, [runs], t=t, anchor=MSO_ANCHOR.MIDDLE)
    return y + 0.52


# ------------------------------------------------------------------ slide 1
def s1(s, t, S):
    title_slide_prep(s)
    sect(s, t, 0.42, 1.18, 6.9, 5.72, 1, "PROBLEM STATEMENT", sub="MDoNER")
    logo = __import__("deckkit").BRAND
    s.shapes.add_picture(str(logo), __import__("pptx.util", fromlist=["Inches"]).Inches(0.62),
                         __import__("pptx.util", fromlist=["Inches"]).Inches(1.82),
                         __import__("pptx.util", fromlist=["Inches"]).Inches(0.78),
                         __import__("pptx.util", fromlist=["Inches"]).Inches(0.78))
    text(s, 1.54, 1.78, 5.6, 0.58, [[(F["name"], {"bold": True, "size": 32})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 1.56, 2.3, 5.6, 0.34, [[(F["tagline"], {"size": 11.5, "color": t.grey})]], t=t)
    pill(s, 0.62, 2.78, 2.1, 0.62, F["ps_id"], t, fill=NAVY, size=24)
    text(s, 2.86, 2.8, 4.3, 0.58, [[("PROBLEM STATEMENT ID", {"bold": True, "size": 9, "color": t.muted})],
                                   [(F["theme"] + "  ·  " + F["category"], {"bold": True, "size": 11.5})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE)
    y = 3.56
    for k, v in [("Problem Statement Title", F["ps_title"]), ("Theme", F["theme"]),
                 ("PS Category", F["category"]), ("Team ID", F["team_id"]), ("Team Name", F["team"])]:
        tall = 0.46 if k == "Problem Statement Title" else 0.27
        text(s, 0.62, y, 1.96, tall, [[(k.upper(), {"bold": True, "size": 8.5, "color": t.muted})]], t=t)
        text(s, 2.6, y - 0.03, 4.56, tall, [[(v, {"size": 12, "bold": k in ("Team ID", "Team Name")})]], t=t, spacing=1.0)
        hline(s, 0.62, y + tall + 0.01, 6.5, t.line)
        y += tall + 0.05
    rect(s, 0.62, 5.5, 0.9, 0.055, fill=AMBER)
    text(s, 0.62, 5.62, 6.5, 0.44, [[(F["headline"], {"bold": True, "size": 20})]], t=t)
    text(s, 0.62, 6.08, 6.5, 0.34, [[(F["question"], {"size": 12, "color": NAVY})]], t=t)
    text(s, 0.62, 6.44, 6.5, 0.34, [[(F["proof_line"], {"size": 9.5, "color": t.ok, "bold": True})]], t=t)
    sect(s, t, 7.46, 1.18, 5.42, 5.72, 2, "WORKING SYSTEM", sub="manager console + Android driver app")
    picture(s, S["mgr"], 7.64, 2.56, h=3.76, frame=t.line)
    picture(s, S["nav"], 10.46, 1.84, h=4.48, frame=t.line)
    text(s, 7.64, 6.42, 5.06, 0.3, [[("Real screens · real road · no mock-ups", {"size": 9.5, "color": t.grey})]], t=t)


# ------------------------------------------------------------------ slide 2
def s2(s, t, S):
    content_slide(s, t, F["titles"][1])
    y = sect(s, t, 0.42, 1.16, 4.28, 2.36, 1, "THE PROBLEM", accent=t.danger, fill=t.bg)
    text(s, 0.6, y - 0.04, 3.92, 0.3, [[(F["problem"], {"size": 10, "color": t.ink})]], t=t, spacing=1.05)
    text(s, 0.6, y + 0.3, 3.92, 0.28, [[(F["problem_kick"], {"bold": True, "size": 10.5, "color": t.danger})]], t=t)
    for i, (n, lab) in enumerate(F["evidence_facts"]):
        r, c = divmod(i, 2)
        stat(s, 0.6 + c * 1.98, y + 0.68 + r * 0.42, 1.92, n, lab, t, num_size=14, lab_size=8,
             num_color=t.danger, gap=0.86)
    y = sect(s, t, 4.86, 1.16, 4.46, 2.36, 2, "SHORTEST vs USABLE")
    chain_h(s, 5.04, y - 0.02, [("ORIGIN", 0.9), ("SHORTEST ROAD", 1.5), ("TRUCK", 0.86)], t,
            h=0.28, gap=0.09, size=8, lines={i: t.muted for i in range(3)}, colors={i: t.grey for i in range(3)})
    text(s, 5.04, y + 0.3, 4.1, 0.26, [[("no terrain, weather or hazard check · no governance",
                                         {"size": 8.5, "color": t.muted})]], t=t)
    chain_h(s, 5.04, y + 0.6, [("ORIGIN", 0.72), ("REAL ROUTE", 1.0), ("EVIDENCE", 0.98),
                               ("POLICY", 0.88)], t, h=0.28, gap=0.06, size=7.5,
            lines={i: t.ink for i in range(4)})
    dw = (4.1 - 3 * 0.08) / 4
    dx = 5.04
    for lab, kind in F["decisions"]:
        pill(s, dx, y + 0.96, dw, 0.3, lab, t, fill=t.c({"ok": "ok", "warn": "warn", "danger": "danger", "ink": "ink"}[kind]), size=9)
        dx += dw + 0.08
    text(s, 5.04, y + 1.32, 4.1, 0.26, [[("Manager governance → driver navigation · 23 languages · offline",
                                          {"size": 8.5, "color": t.grey})]], t=t)
    y = sect(s, t, 0.42, 3.66, 8.9, 2.06, 3, "WHAT MAKES IT DIFFERENT", sub="USP", accent=AMBER)
    for i, (head, body) in enumerate(F["usp"]):
        c, r = i % 2, i // 2
        x = 0.6 + c * 4.36
        yy = y + r * 0.72
        rect(s, x, yy, 0.05, 0.6, fill=AMBER)
        text(s, x + 0.16, yy - 0.04, 4.1, 0.68, [[(head, {"bold": True, "size": 9.5, "color": t.ink})],
                                                 [(body, {"size": 9, "color": t.grey})]], t=t, spacing=1.02)
    rect(s, 0.42, 5.9, 8.9, 0.62, fill=t.paper, line=t.danger, rounded=True, line_w=1.4, radius=0.07)
    text(s, 0.62, 5.96, 2.6, 0.5, [[("UNKNOWN ≠ SAFE", {"bold": True, "size": 16, "color": t.danger})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 3.16, 5.98, 5.98, 0.46, [[(F["unknown_rule"], {"size": 10})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    sect(s, t, 9.46, 1.16, 3.42, 5.36, 4, "EVIDENCE SCREEN", accent=t.ok)
    picture(s, S["evid"], 9.64, 1.76, h=4.36, frame=t.line)
    text(s, 9.64, 6.2, 3.06, 0.3, [[("Manager · Check conditions", {"size": 9, "color": t.grey})]], t=t)


# ------------------------------------------------------------------ slide 3
def s3(s, t, S):
    content_slide(s, t, F["titles"][2])
    y = sect(s, t, 0.42, 1.16, 8.9, 1.14, 1, "INPUT", sub="verified sources, each with health + freshness")
    x, bw = 0.6, 1.4
    for lab, sub in F["sources"]:
        text(s, x, y - 0.04, bw, 0.56, [[(lab, {"bold": True, "size": 8.5})], [(sub, {"size": 7.5, "color": t.grey})]],
             t=t, spacing=1.0)
        x += bw + 0.05
    for cx in (1.3, 2.75, 4.2, 5.65, 7.1, 8.55):
        arrow(s, cx, 2.34, cx, 2.5, t.muted, 0.9)
    y = sect(s, t, 0.42, 2.54, 8.9, 2.4, 2, "PROCESS", sub="deterministic, auditable, no model in the loop")
    for title, sub, fill in [("ROUTE-SPECIFIC EVIDENCE · FastAPI backend",
                              "every factor sampled along the selected road · freshness per factor", None),
                             ("DETERMINISTIC SAFETY POLICY",
                              "11 factors · reason codes · UNKNOWN ≠ SAFE · reviewer authorisation when data is missing", NAVY)]:
        rect(s, 0.6, y, 8.54, 0.5, fill=fill or t.bg, line=None if fill else t.line, rounded=True, radius=0.05)
        text(s, 0.74, y + 0.02, 8.3, 0.46, [[(title, {"bold": True, "size": 10, "color": t.paper if fill else t.ink})],
                                            [(sub, {"size": 8.5, "color": rgb("C7D6E8") if fill else t.grey})]], t=t, spacing=1.0)
        y += 0.58
    dw = (8.54 - 3 * 0.12) / 4
    dx = 0.6
    for lab, kind in F["decisions"]:
        pill(s, dx, y, dw, 0.34, lab, t, fill=t.c({"ok": "ok", "warn": "warn", "danger": "danger", "ink": "ink"}[kind]), size=10.5)
        dx += dw + 0.12
    y += 0.46
    chain_h(s, 0.6, y, [("MANAGER REVIEW", 1.4), ("DRIVER NAVIGATION", 1.52), ("ROUTE-AHEAD 60 s", 1.42),
                        ("CONDITIONS CHANGE?", 1.6), ("REASSESS", 1.04)], t, h=0.32, gap=0.08, size=8,
            fills={0: t.ink}, colors={0: t.paper}, lines={i: t.ink for i in range(5)})
    y = sect(s, t, 0.42, 5.18, 8.9, 1.7, 3, "OUTPUT \u00b7 BUILT WITH", sub="seven technologies, nothing decorative")
    text(s, 0.6, y - 0.04, 8.54, 0.28, [[(F["loop_note"], {"size": 9, "color": t.grey})]], t=t)
    text(s, 0.6, y + 0.26, 8.54, 0.86, [
        [("STACK  ", {"bold": True, "size": 8.5, "color": t.muted}), (F["stack"], {"size": 9.5})],
        [("CLIENTS  ", {"bold": True, "size": 8.5, "color": t.muted}), (F["clients"], {"size": 9.5})],
    ], t=t, spacing=1.15, space_after=2)
    y = sect(s, t, 9.46, 1.16, 3.42, 5.72, 4, "WHO DECIDES", accent=AMBER)
    for lab, sub, kind in F["deciders"]:
        col = {"accent": NAVY, "ok": t.ok, "muted": t.muted}[kind]
        rect(s, 9.64, y + 0.02, 0.05, 0.66, fill=col)
        text(s, 9.8, y, 2.92, 0.8, [[(lab, {"bold": True, "size": 10, "color": t.ink})],
                                    [(sub, {"size": 9.5, "color": t.grey})]], t=t, spacing=1.0)
        y += 0.88
    hline(s, 9.64, y + 0.02, 3.06, t.line)
    text(s, 9.64, y + 0.1, 3.06, 0.26, [[("GOVERNANCE CHAIN", {"bold": True, "size": 8.5, "color": t.muted})]], t=t)
    chain_v(s, 9.64, 3.06, y + 0.4, [(c, None, t.ink, t.ink) for c in F["chain"]], t, h=0.3, gap=0.12, size=9.5)


# ------------------------------------------------------------------ slide 4
def s4(s, t, S):
    content_slide(s, t, F["titles"][3])
    y = sect(s, t, 0.42, 1.16, 6.3, 2.5, 1, "FEASIBILITY OF THE IDEA")
    for i, (head, body) in enumerate(F["feasibility"]):
        c, r = i % 2, i // 2
        x = 0.6 + c * 3.06
        yy = y + r * 0.92
        hline(s, x, yy, 2.9, NAVY, 1.4)
        text(s, x, yy + 0.05, 2.9, 0.84, [[(head, {"bold": True, "size": 9, "color": NAVY})],
                                          [(body, {"size": 8.5, "color": t.ink})]], t=t, spacing=1.05)
    y = sect(s, t, 0.42, 3.8, 6.3, 3.08, 2, "RISKS → WHAT WE DO ABOUT THEM", accent=AMBER)
    for i, (risk, fix) in enumerate(F["risks"]):
        yy = y + i * 0.62
        text(s, 0.6, yy, 2.66, 0.56, [[(risk, {"bold": True, "size": 9, "color": t.ink})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
        arrow(s, 3.32, yy + 0.28, 3.5, yy + 0.28, AMBER)
        text(s, 3.58, yy, 3.1, 0.56, [[(fix, {"size": 8.5, "color": t.grey})]], t=t, anchor=MSO_ANCHOR.MIDDLE, spacing=1.05)
        if i < 3:
            hline(s, 0.6, yy + 0.58, 6.0, t.line)
    y = sect(s, t, 6.88, 1.16, 6.0, 5.72, 3, "PROVEN, NOT PROPOSED", sub="physical phone · hosted backend · real road", accent=t.ok)
    widths = [0.62, 0.74, 0.88, 0.8, 1.06, 0.92]
    chain_h(s, 7.06, y - 0.04, list(zip(F["lifecycle"][:6], widths)), t, h=0.28, gap=0.06, size=7,
            fills={0: NAVY, 1: NAVY}, colors={0: t.paper, 1: t.paper}, lines={i: t.ink for i in range(2, 6)})
    chain_h(s, 7.06, y + 0.3, list(zip(F["lifecycle"][6:], [1.06, 2.2, 1.0])), t, h=0.28, gap=0.06, size=7,
            fills={1: NAVY, 2: t.ok}, colors={0: t.ink, 1: t.paper, 2: t.paper}, lines={0: t.ink})
    top, hh = y + 0.72, 2.66
    w1, _ = picture(s, S["mgr"], 7.06, top, h=hh, frame=t.line)
    w2, _ = picture(s, S["truck"], 7.06 + w1 + 0.16, top, h=hh, frame=t.line)
    w3, _ = picture(s, S["nav"], 7.06 + w1 + w2 + 0.32, top, h=hh, frame=t.line)
    for px, pw, lab in [(7.06, w1, "Manager · review"), (7.06 + w1 + 0.16, w2, "Driver · truck check"),
                        (7.06 + w1 + w2 + 0.32, w3, "Driver · navigation")]:
        text(s, px, top + hh + 0.04, pw, 0.24, [[(lab, {"size": 8, "color": t.grey})]], t=t, align=PP_ALIGN.CENTER)
    yy = top + hh + 0.34
    for n, lab in F["proof"]:
        stat(s, 7.06, yy, 5.64, n, lab, t, num_size=16, lab_size=10.5, num_color=t.ok, gap=0.96)
        yy += 0.4
    runs = []
    for i, (n, lab) in enumerate(F["tests"]):
        runs += [(n + " ", {"bold": True, "size": 12, "color": NAVY}),
                 (lab + ("  ·  " if i < 2 else " tests"), {"size": 10})]
    text(s, 7.06, yy, 5.64, 0.32, [runs], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 7.06, yy + 0.38, 5.64, 0.3, [[("Canonical demo  ", {"bold": True, "size": 9, "color": t.muted}),
                                          (F["corridor"], {"bold": True, "size": 10})]], t=t)


# ------------------------------------------------------------------ slide 5
def s5(s, t, S):
    content_slide(s, t, F["titles"][4])
    text(s, 0.45, 1.18, 8.87, 0.34, [[(F["supplies"], {"bold": True, "size": 13, "color": t.ok}),
                                      ("   — essential logistics for hill communities, decided on evidence",
                                       {"size": 11, "color": t.grey})]], t=t)
    y = sect(s, t, 0.42, 1.6, 8.9, 1.62, 1, "WHO BENEFITS")
    cw = 2.04
    for i, (h, b) in enumerate(F["who"]):
        x = 0.6 + i * (cw + 0.16)
        hline(s, x, y - 0.02, cw, NAVY, 1.4)
        text(s, x, y + 0.04, cw, 1.02, [[(h, {"bold": True, "size": 9.5, "color": NAVY})],
                                        [(b, {"size": 9.5})]], t=t, spacing=1.05, space_after=3)
    y = sect(s, t, 0.42, 3.34, 8.9, 1.72, 2, "MEASURABLE TODAY", sub="counted, not estimated", accent=AMBER)
    for i, (n, lab) in enumerate(F["caps"]):
        c, r = divmod(i, 3)
        stat(s, 0.6 + c * 4.34, y + r * 0.4, 4.2, n, lab, t, num_size=17, lab_size=10,
             num_color=AMBER if c else NAVY, align=PP_ALIGN.RIGHT, gap=0.98)
    y = sect(s, t, 0.42, 5.18, 8.9, 1.7, 3, "HUMAN GOVERNANCE", sub="AI has no uncontrolled authority", accent=t.ok)
    chain_h(s, 0.6, y, [(c, 2.02) for c in F["chain"]], t, h=0.34, gap=0.2, size=10,
            fills={0: t.ink}, colors={0: t.paper}, lines={i: t.ink for i in range(4)})
    text(s, 0.6, y + 0.44, 8.54, 0.5, [[("Every reroute is proposed, reviewed and accepted by a person. "
                                         "No invented percentages: impact is stated as who gains what.",
                                         {"size": 9.5, "color": t.grey})]], t=t, spacing=1.05)
    y = sect(s, t, 9.46, 1.16, 3.42, 5.72, 4, "REAL SCREENS", sub="APK 1.0.18")
    w1, _ = picture(s, S["lang"], 9.64, y + 0.04, h=2.34, frame=t.line)
    w2, _ = picture(s, S["mobile"], 9.64 + w1 + 0.14, y + 0.04, h=2.34, frame=t.line)
    text(s, 9.64, y + 2.42, w1, 0.24, [[("23 languages", {"size": 8.5, "color": t.grey})]], t=t, align=PP_ALIGN.CENTER)
    text(s, 9.64 + w1 + 0.14, y + 2.42, w2, 0.24, [[("Manager · mobile", {"size": 8.5, "color": t.grey})]], t=t, align=PP_ALIGN.CENTER)
    text(s, 9.64, y + 2.78, 3.06, 1.6, [[(F["screens_note"], {"size": 9.5, "color": t.grey})]], t=t, spacing=1.05)


# ------------------------------------------------------------------ slide 6
def s6(s, t, S):
    content_slide(s, t, F["titles"][5])
    y = sect(s, t, 0.42, 1.16, 7.4, 4.92, 1, "SOURCES BEHIND EVERY ROUTE DECISION")
    gw = 3.36
    for i, (lab, names, what) in enumerate(F["groups"]):
        c, r = i % 2, i // 2
        x = 0.6 + c * (gw + 0.2)
        yy = y + 0.02 + r * 1.44
        hline(s, x, yy, gw, NAVY, 1.4)
        text(s, x, yy + 0.06, gw, 1.24, [[(lab, {"bold": True, "size": 9, "color": NAVY})],
                                         [(names, {"bold": True, "size": 10.5})],
                                         [(what, {"size": 9.5, "color": t.grey})]], t=t, spacing=1.05, space_after=2)
    mx, mw = 8.24, 4.46
    y = sect(s, t, 8.06, 1.16, 4.82, 4.92, 2, "EXPERIMENTAL ML", sub="research only", accent=AMBER)
    text(s, mx, y + 0.02, 1.8, 0.9, [[(F["ml_recall"], {"bold": True, "size": 42})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    text(s, mx + 1.8, y + 0.06, mw - 1.8, 0.84, [[(F["ml_recall_what"], {"bold": True, "size": 11.5})],
                                                 [(F["ml_recall_sub"], {"size": 9, "color": t.grey})]],
         t=t, anchor=MSO_ANCHOR.MIDDLE, spacing=1.05)
    rect(s, mx, y + 1.02, mw, 0.78, fill=t.ink, rounded=True, radius=0.06)
    text(s, mx, y + 1.08, mw, 0.68, [[(F["ml_gate_small"], {"bold": True, "size": 10.5, "color": t.muted})],
                                     [(F["ml_gate_big"], {"bold": True, "size": 20, "color": t.paper})]],
         t=t, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, spacing=1.0)
    text(s, mx, y + 1.88, mw, 0.3, [[(F["ml_fpr"], {"bold": True, "size": 12.5, "color": t.danger}),
                                     ("   " + F["ml_fpr_why"], {"size": 9.5, "color": t.grey})]], t=t, anchor=MSO_ANCHOR.MIDDLE)
    fy = y + 2.26
    for row in ([(F["ml_flow"][0], 0.76), (F["ml_flow"][1], 1.56), (F["ml_flow"][2], 1.72)],
                [(F["ml_flow"][3], 1.92), (F["ml_flow"][4], 1.04), (F["ml_flow"][5], 1.22)]):
        chain_h(s, mx, fy, row, t, h=0.27, gap=0.07, size=7.5, lines={i: t.ink for i in range(3)})
        fy += 0.36
    text(s, mx, fy + 0.04, mw, 0.62, [[(F["ml_caption_lead"] + " ", {"bold": True, "size": 10.5, "color": NAVY}),
                                       (F["ml_caption"], {"size": 9.5})]], t=t, spacing=1.05)
    text(s, mx, fy + 0.66, mw, 0.4, [[(F["ml_metrics"], {"size": 7.5, "color": t.grey})]], t=t, spacing=1.05)
    hline(s, 0.42, 6.2, 12.46, t.line)
    text(s, 0.42, 6.28, 12.46, 0.56, [[("REFERENCES   ", {"bold": True, "size": 8.5, "color": t.muted}),
                                       (F["refs"], {"size": 8.5, "color": t.grey}),
                                       ("    PS ID SIH26002 · Team NER-AI LOGISTICS (17)",
                                        {"bold": True, "size": 8.5, "color": NAVY})]], t=t, spacing=1.1)


SLIDES = [s1, s2, s3, s4, s5, s6]
