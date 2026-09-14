"""V07 SPLIT — argument left, proof right, every slide.

A hard vertical split: the claim is made on a dark field on the left, and the
screen that backs it sits on white on the right. Nothing crosses the seam.
"""
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from deckkit import (FACTS as F, FOOT, SW, Theme, chain_h, chain_v, content_slide, hline,
                     picture, pill, rect, rgb, stat, text, title_slide_prep)

THEME = Theme(slug="V07_SPLIT", label="Split", font="Arial", accent="2F6BFF", accent2="7C3AED",
              ok="10B981", warn="F59E0B", danger="FB7185", ink="0A0F1C", grey="8892A6",
              muted="5A6478", line="E3E7ED", bg="F5F7FA", paper="FFFFFF", radius=0.0, border=1.0,
              note="A hard vertical seam: the claim on a dark field, the screen that backs it on white.")

DARK = rgb("0A0F1C")
SEAM = 6.72


def field(s, t, top=1.16, x=0.0, w=SEAM):
    rect(s, x, top, w, FOOT - top, fill=DARK)


def L(s, t, x, y, w, h, paras, **kw):
    kw.setdefault("color", rgb("E8ECF4"))
    return text(s, x, y, w, h, paras, t=t, **kw)


def s1(s, t, S):
    title_slide_prep(s)
    field(s, t, 1.2)
    L(s, t, 0.55, 1.42, 5.6, 0.68, [[(F["name"], {"bold": True, "size": 38, "color": rgb("FFFFFF")})]],
      anchor=MSO_ANCHOR.MIDDLE)
    L(s, t, 0.55, 2.1, 5.6, 0.4, [[(F["tagline"], {"size": 11.5, "color": t.grey})]])
    rect(s, 0.55, 2.62, 1.0, 0.045, fill=t.accent)
    L(s, t, 0.55, 2.78, 5.6, 1.2, [[(F["headline"], {"bold": True, "size": 28, "color": rgb("FFFFFF")})]], spacing=0.98)
    L(s, t, 0.55, 3.98, 5.6, 0.4, [[(F["question"], {"size": 12, "color": t.accent})]])
    y = 4.5
    for k, v in [("PROBLEM STATEMENT ID", F["ps_id"]), ("THEME", F["theme"]), ("PS CATEGORY", F["category"]),
                 ("TEAM ID", F["team_id"]), ("TEAM NAME", F["team"])]:
        L(s, t, 0.55, y, 2.1, 0.28, [[(k, {"bold": True, "size": 8.5, "color": t.muted})]])
        L(s, t, 2.7, y - 0.02, 3.45, 0.28, [[(v, {"size": 11.5, "bold": True,
          "color": t.accent if k == "PROBLEM STATEMENT ID" else rgb("E8ECF4")})]])
        hline(s, 0.55, y + 0.28, 5.6, rgb("1C2536"))
        y += 0.36
    L(s, t, 0.55, y + 0.04, 5.6, 0.62, [[(F["ps_title"], {"size": 10.5, "color": t.grey})]], spacing=1.05)
    text(s, 7.0, 1.3, 5.85, 0.28, [[("LIVE WORKING SYSTEM", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    picture(s, S["mgr"], 7.0, 2.42, h=3.98, frame=t.line)
    picture(s, S["nav"], 10.1, 1.62, h=4.78, frame=t.line)
    text(s, 7.0, 6.52, 5.85, 0.3, [[("Manager route review · Driver navigation — real screens, real road",
                                     {"size": 9.5, "color": t.muted})]], t=t)


def s2(s, t, S):
    content_slide(s, t, F["titles"][1])
    field(s, t)
    L(s, t, 0.55, 1.32, 5.6, 0.26, [[("PROPOSED SOLUTION", {"bold": True, "size": 9, "color": t.muted})]])
    L(s, t, 0.55, 1.58, 5.6, 1.2, [[("Not the shortest road. ", {"bold": True, "size": 23, "color": rgb("FFFFFF")}),
                                    ("The road that is usable now.", {"bold": True, "size": 23, "color": t.accent})]],
      spacing=1.0)
    L(s, t, 0.55, 2.82, 5.6, 0.44, [[(F["problem"] + "  ", {"size": 10.5, "color": t.grey}), (F["problem_kick"], {"size": 10.5, "bold": True, "color": t.danger})]], spacing=1.05)
    L(s, t, 0.55, 3.36, 5.6, 0.26, [[("A NORMAL ROUTER", {"bold": True, "size": 9, "color": t.muted})]])
    L(s, t, 0.55, 3.6, 5.6, 0.3, [[("  →  ".join(F["normal_router"]), {"size": 11, "color": t.grey})]])
    L(s, t, 0.55, 3.9, 5.6, 0.36, [[(F["normal_gap"][1], {"size": 10, "color": t.muted})]])
    L(s, t, 0.55, 4.3, 5.6, 0.26, [[("RASTA AI", {"bold": True, "size": 9, "color": t.accent})]])
    cx, cy = 0.55, 4.56
    for lab, wd in zip(F["evidence_chips"], [0.86, 0.86, 1.36, 1.1, 1.26, 1.0, 1.36]):
        if cx + wd > 6.15:
            cx = 0.55; cy += 0.3
        pill(s, cx, cy, wd, 0.26, lab, t, fill=None, color=rgb("E8ECF4"), line=t.muted, size=8.5, bold=False)
        cx += wd + 0.08
    dw = (5.6 - 3 * 0.1) / 4
    dx = 0.55
    for lab, kind in F["decisions"]:
        fill = {"ok": t.ok, "warn": t.warn, "danger": t.danger, "ink": t.muted}[kind]
        pill(s, dx, cy + 0.4, dw, 0.32, lab, t, fill=fill, color=DARK, size=9.5)
        dx += dw + 0.1
    L(s, t, 0.55, cy + 0.82, 5.6, 0.3, [[("Manager governance → driver navigation, 23 languages, offline package",
                                          {"size": 10, "color": t.grey})]])
    rect(s, 0.55, 6.24, 5.6, 0.04, fill=t.danger)
    L(s, t, 0.55, 6.34, 2.3, 0.4, [[("UNKNOWN ≠ SAFE", {"bold": True, "size": 15, "color": t.danger})]])
    L(s, t, 2.9, 6.34, 3.25, 0.5, [[(F["unknown_rule"], {"size": 9, "color": t.grey})]], spacing=1.05)
    text(s, 7.0, 1.28, 5.85, 0.28, [[("MANAGER · CHECK CONDITIONS", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    picture(s, S["evid"], 7.0, 1.62, h=4.76, frame=t.line)
    picture(s, S["ai"], 10.5, 1.62, h=4.76, frame=t.line)
    text(s, 7.0, 6.5, 5.85, 0.3, [[("Manager evidence · Driver route AI — the same decision, both ends",
                                    {"size": 9.5, "color": t.muted})]], t=t)


def s3(s, t, S):
    content_slide(s, t, F["titles"][2])
    field(s, t)
    L(s, t, 0.55, 1.3, 5.6, 0.26, [[("VERIFIED DATA", {"bold": True, "size": 9, "color": t.muted})]])
    x, bw = 0.55, 0.9
    for lab, sub in F["sources"]:
        L(s, t, x, 1.56, bw + 0.02, 0.58, [[(lab.split()[0], {"bold": True, "size": 8, "color": rgb("E8ECF4")})],
                                           [(sub, {"size": 7, "color": t.muted})]], spacing=1.0)
        x += bw + 0.02
    y = 2.24
    for title, sub, fill in [("ROUTE-SPECIFIC EVIDENCE · FastAPI backend",
                              "every factor sampled along the selected road · PostgreSQL + PostGIS (Supabase) · OSRM routes, turn steps", None),
                             ("DETERMINISTIC SAFETY POLICY",
                              "11 factors · reason codes · UNKNOWN ≠ SAFE · reviewer authorisation when hazard data is missing", t.accent)]:
        rect(s, 0.55, y, 5.6, 0.6, fill=fill or rgb("131B2C"))
        L(s, t, 0.68, y + 0.05, 5.34, 0.52, [[(title, {"bold": True, "size": 10, "color": rgb("FFFFFF")})],
                                             [(sub, {"size": 8.5, "color": rgb("C6D0E2") if fill else t.grey})]], spacing=1.0)
        y += 0.7
    dw = (5.6 - 3 * 0.1) / 4
    dx = 0.55
    for lab, kind in F["decisions"]:
        fill = {"ok": t.ok, "warn": t.warn, "danger": t.danger, "ink": t.muted}[kind]
        pill(s, dx, y, dw, 0.32, lab, t, fill=fill, color=DARK, size=9.5)
        dx += dw + 0.1
    y += 0.44
    chain_h(s, 0.55, y, [("MANAGER REVIEW", 1.3), ("DRIVER NAV", 1.05), ("60 s WATCH", 1.05), ("REASSESS", 1.0)],
            t, h=0.3, gap=0.08, size=8,
            fills={0: t.accent, 1: None, 2: None, 3: None},
            colors={0: DARK, 1: rgb("E8ECF4"), 2: rgb("E8ECF4"), 3: rgb("E8ECF4")},
            lines={i: t.muted for i in range(1, 4)})
    y += 0.42
    L(s, t, 0.55, y, 5.6, 0.32, [[(F["loop_note"], {"size": 9, "color": t.muted})]], spacing=1.05)
    y += 0.4
    for lab, sub, kind in F["deciders"]:
        rect(s, 0.55, y + 0.02, 0.05, 0.5, fill=t.c(kind))
        L(s, t, 0.7, y, 5.45, 0.56, [[(lab, {"bold": True, "size": 9.5, "color": rgb("FFFFFF")})],
                                     [(sub, {"size": 8.5, "color": t.grey})]], spacing=1.0)
        y += 0.6
    text(s, 7.0, 1.28, 5.85, 0.28, [[("STACK · CLIENTS · GOVERNANCE", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    hline(s, 7.0, 1.56, 5.85, t.ink, 1.5)
    text(s, 7.0, 1.66, 5.85, 1.3, [
        [("CLIENTS  ", {"bold": True, "size": 9, "color": t.muted}), (F["clients"], {"size": 10.5})],
        [("STACK  ", {"bold": True, "size": 9, "color": t.muted}), (F["stack"], {"size": 10.5})],
    ], t=t, spacing=1.15, space_after=4)
    text(s, 7.0, 3.04, 5.85, 0.28, [[("GOVERNANCE CHAIN", {"bold": True, "size": 9, "color": t.muted})]], t=t)
    chain_v(s, 7.0, 5.85, 3.34, [(c, None, t.ink, t.ink) for c in F["chain"]], t, h=0.38, gap=0.18, size=11)
    text(s, 7.0, 5.68, 5.85, 1.1, [[("Diagnostics reports every provider's real state — healthy, degraded, fallback "
                                     "active or unknown — so a judge can see exactly what a decision rested on.",
                                     {"size": 9.5, "color": t.grey})]], t=t, spacing=1.05)


def s4(s, t, S):
    content_slide(s, t, F["titles"][3])
    field(s, t)
    L(s, t, 0.55, 1.34, 5.6, 0.8, [[("Not a concept. A working end-to-end prototype.",
                                     {"bold": True, "size": 22, "color": rgb("FFFFFF")})]], spacing=1.0)
    L(s, t, 0.55, 2.2, 5.6, 0.26, [[("CERTIFIED LIFECYCLE", {"bold": True, "size": 9, "color": t.muted})]])
    y = 2.46
    for i, step in enumerate(F["lifecycle"]):
        col, r = divmod(i, 3)
        on = i in (0, 1, 7, 8)
        pill(s, 0.55 + col * 1.9, y + r * 0.4, 1.78, 0.32, step, t,
             fill=t.accent if on else None, color=DARK if on else rgb("E8ECF4"),
             line=None if on else t.muted, size=8)
    y += 3 * 0.4 + 0.16
    rect(s, 0.55, y, 5.6, 0.04, fill=t.accent)
    y += 0.16
    for n, lab in F["proof"]:
        L(s, t, 0.55, y, 1.1, 0.36, [[(n, {"bold": True, "size": 18, "color": t.accent})]], anchor=MSO_ANCHOR.MIDDLE)
        L(s, t, 1.72, y, 4.43, 0.36, [[(lab, {"size": 11, "color": rgb("E8ECF4")})]], anchor=MSO_ANCHOR.MIDDLE)
        y += 0.42
    runs = []
    for i, (n, lab) in enumerate(F["tests"]):
        runs += [(n + " ", {"bold": True, "size": 12, "color": t.accent}),
                 (lab + ("  ·  " if i < 2 else " tests"), {"size": 10, "color": rgb("E8ECF4")})]
    L(s, t, 0.55, y, 5.6, 0.34, [runs], anchor=MSO_ANCHOR.MIDDLE)
    pill(s, 0.55, y + 0.44, 5.6, 0.34, "PHYSICAL ANDROID · CERTIFIED", t, fill=t.ok, color=DARK, size=10.5)
    L(s, t, 0.55, y + 0.86, 5.6, 0.3, [[("Canonical demo  ", {"bold": True, "size": 9.5, "color": t.muted}),
                                        (F["corridor"], {"bold": True, "size": 10, "color": rgb("E8ECF4")})]])
    text(s, 7.0, 1.28, 5.85, 0.28, [[("REAL SCREENS FROM THE CERTIFIED RUN", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    top, hh = 1.62, 3.46
    w1, _ = picture(s, S["mgr"], 7.0, top, h=hh, frame=t.line)
    w2, _ = picture(s, S["truck"], 7.0 + w1 + 0.16, top, h=hh, frame=t.line)
    w3, _ = picture(s, S["nav"], 7.0 + w1 + w2 + 0.32, top, h=hh, frame=t.line)
    for cx, cw, lab in [(7.0, w1, "Manager · route review"), (7.0 + w1 + 0.16, w2, "Driver · truck check"),
                        (7.0 + w1 + w2 + 0.32, w3, "Driver · navigation")]:
        text(s, cx, top + hh + 0.06, cw, 0.28, [[(lab, {"size": 9, "color": t.muted})]], t=t, align=PP_ALIGN.CENTER)
    L(s, t, 0.55, 6.4, 5.6, 0.5, [[("KNOWN LIMITS → MITIGATION   ", {"bold": True, "size": 8, "color": t.muted}),
                                    (F["limits"], {"size": 8, "color": t.grey})]], spacing=1.05)


def s5(s, t, S):
    content_slide(s, t, F["titles"][4])
    field(s, t)
    L(s, t, 0.55, 1.3, 5.6, 0.96, [[("“Can this truck reliably use this corridor now?”",
                                     {"bold": True, "size": 21, "color": rgb("FFFFFF")})]], spacing=1.0)
    L(s, t, 0.55, 2.32, 5.6, 0.3, [[(F["supplies"], {"bold": True, "size": 11.5, "color": t.ok})]])
    L(s, t, 0.55, 2.62, 5.6, 0.3, [[("essential logistics for hill communities, decided on evidence",
                                     {"size": 10, "color": t.grey})]])
    y = 3.06
    for h, b in F["who"]:
        L(s, t, 0.55, y, 1.85, 0.5, [[(h, {"bold": True, "size": 9, "color": t.accent})]])
        L(s, t, 2.46, y, 3.69, 0.5, [[(b, {"size": 9.5, "color": rgb("E8ECF4")})]], spacing=1.05)
        hline(s, 0.55, y + 0.52, 5.6, rgb("1C2536"))
        y += 0.6
    rect(s, 0.55, y + 0.06, 5.6, 0.04, fill=t.accent)
    y += 0.2
    for i, (n, lab) in enumerate(F["caps"]):
        r, col = divmod(i, 2)
        L(s, t, 0.55 + col * 2.82, y + r * 0.36, 0.76, 0.32, [[(n, {"bold": True, "size": 14, "color": t.accent})]],
          anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.RIGHT)
        L(s, t, 0.55 + col * 2.82 + 0.86, y + r * 0.36, 1.9, 0.32, [[(lab, {"size": 8.5, "color": rgb("C6D0E2")})]],
          anchor=MSO_ANCHOR.MIDDLE)
    text(s, 7.0, 1.28, 5.85, 0.28, [[("REAL SCREENS · APK 1.0.18", {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    w1, _ = picture(s, S["lang"], 7.0, 1.62, h=3.1, frame=t.line)
    w2, _ = picture(s, S["mobile"], 7.0 + w1 + 0.18, 1.62, h=3.1, frame=t.line)
    w3, _ = picture(s, S["trip"], 7.0 + w1 + w2 + 0.36, 1.62, h=3.1, frame=t.line)
    for cx, cw, lab in [(7.0, w1, "23 languages"), (7.0 + w1 + 0.18, w2, "Manager · mobile"),
                        (7.0 + w1 + w2 + 0.36, w3, "Driver · assigned trip")]:
        text(s, cx, 4.8, cw, 0.26, [[(lab, {"size": 9, "color": t.muted})]], t=t, align=PP_ALIGN.CENTER)
    text(s, 7.0, 5.18, 5.85, 0.26, [[("HUMAN GOVERNANCE — AI HAS NO UNCONTROLLED AUTHORITY",
                                      {"bold": True, "size": 9, "color": t.muted})]], t=t)
    chain_v(s, 7.0, 5.85, 5.46, [(c, None, t.ink, t.ink) for c in F["chain"][:3]], t, h=0.32, gap=0.12, size=10.5)


def s6(s, t, S):
    content_slide(s, t, F["titles"][5])
    field(s, t)
    L(s, t, 0.55, 1.3, 5.6, 0.26, [[("EXPERIMENTAL LANDSLIDE RESEARCH", {"bold": True, "size": 9, "color": t.muted})]])
    L(s, t, 0.55, 1.56, 2.0, 0.95, [[(F["ml_recall"], {"bold": True, "size": 46, "color": rgb("FFFFFF")})]],
      anchor=MSO_ANCHOR.MIDDLE)
    L(s, t, 2.6, 1.6, 3.55, 0.88, [[(F["ml_recall_what"], {"bold": True, "size": 12, "color": rgb("FFFFFF")})],
                                   [(F["ml_recall_sub"], {"size": 9, "color": t.grey})]],
      anchor=MSO_ANCHOR.MIDDLE, spacing=1.05)
    rect(s, 0.55, 2.66, 5.6, 0.86, fill=rgb("FFFFFF"))
    text(s, 0.55, 2.72, 5.6, 0.76, [[(F["ml_gate_small"], {"bold": True, "size": 11, "color": t.muted})],
                                    [(F["ml_gate_big"], {"bold": True, "size": 22, "color": DARK})]],
         t=t, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, spacing=1.0)
    L(s, t, 0.55, 3.62, 5.6, 0.32, [[(F["ml_fpr"], {"bold": True, "size": 13, "color": t.danger}),
                                     ("   " + F["ml_fpr_why"], {"size": 9.5, "color": t.grey})]], anchor=MSO_ANCHOR.MIDDLE)
    fy = 4.02
    for r in ([(F["ml_flow"][0], 0.88), (F["ml_flow"][1], 1.9), (F["ml_flow"][2], 2.02)],
              [(F["ml_flow"][3], 2.3), (F["ml_flow"][4], 1.3), (F["ml_flow"][5], 1.5)]):
        chain_h(s, 0.55, fy, r, t, h=0.28, gap=0.09, size=8,
                fills={i: None for i in range(3)},
                colors={i: rgb("E8ECF4") for i in range(3)}, lines={i: t.muted for i in range(3)})
        fy += 0.38
    L(s, t, 0.55, 4.86, 5.6, 0.7, [[(F["ml_caption_lead"] + " ", {"bold": True, "size": 10.5, "color": t.accent}),
                                    (F["ml_caption"], {"size": 9.5, "color": rgb("E8ECF4")})]], spacing=1.05)
    L(s, t, 0.55, 5.6, 5.6, 0.6, [[(F["ml_metrics"], {"size": 7.5, "color": t.muted})]], spacing=1.1)
    text(s, 7.0, 1.28, 5.85, 0.28, [[("RESEARCH / EVIDENCE SOURCES BEHIND THE ROUTE DECISION",
                                      {"bold": True, "size": 9.5, "color": t.muted})]], t=t)
    hline(s, 7.0, 1.56, 5.85, t.ink, 1.5)
    y = 1.66
    for lab, names, what in F["groups"]:
        text(s, 7.0, y, 5.85, 0.64, [[(lab, {"bold": True, "size": 9, "color": t.accent})],
                                     [(names, {"bold": True, "size": 10.5})],
                                     [(what, {"size": 9.5, "color": t.muted})]], t=t, spacing=1.05, space_after=1)
        hline(s, 7.0, y + 0.66, 5.85, t.line)
        y += 0.74
    text(s, 7.0, y + 0.02, 5.85, 0.6, [[("REFERENCES   ", {"bold": True, "size": 8, "color": t.muted}),
                                        (F["refs"], {"size": 8, "color": t.muted})]], t=t, spacing=1.1)


SLIDES = [s1, s2, s3, s4, s5, s6]
