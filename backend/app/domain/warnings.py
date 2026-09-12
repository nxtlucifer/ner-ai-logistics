"""Official warnings from NDMA SACHET (CAP 1.2), matched to a corridor by district.

THE SOURCE

SACHET is the National Disaster Management Authority's Common Alerting
Protocol service. Its public RSS feed (`/cap_public_website/rss/rss_india.xml`)
lists the current alerts; each item links to the alert's CAP XML
(`FetchXMLFile?identifier=...`) carrying sender, event, severity, urgency,
effective/expires, headline and `areaDesc`. State DMAs, IMD centres and the
Central Water Commission all publish through it, so this is the one place a
flood advisory for an Assam river and a nowcast for a Meghalaya district both
appear, from the authority that issued them.

WHAT IS MATCHED, AND WHAT IS NOT

The CAP file names a polygon URL, and that URL is access-controlled (403 to
anonymous clients). So an alert is placed by the DISTRICT NAMES in `areaDesc`,
compared with the districts the corridor crosses (looked up once per route).
That is precise in one direction - a warning naming a corridor district is on
the corridor - and blind in the other: a warning worded without a district is
counted only as "elsewhere in a corridor state". Both counts are published,
and nothing here infers a road closure from an alert.

Scoring is a fixed table over the CAP severity of the matched alerts. A
project-defined weighting, like every other component of the score.
"""

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime
from typing import Final

VERSION: Final[str] = "official-warnings-v1"

LEVEL_ACTIVE: Final[str] = "ACTIVE"
LEVEL_CLEAR: Final[str] = "CLEAR"
LEVEL_UNKNOWN: Final[str] = "UNKNOWN"

REASON_OFFICIAL_WARNING_ON_ROUTE: Final[str] = "OFFICIAL_WARNING_ON_ROUTE"
REASON_NO_OFFICIAL_WARNING_ON_ROUTE: Final[str] = "NO_OFFICIAL_WARNING_ON_ROUTE"
REASON_OFFICIAL_WARNINGS_UNAVAILABLE: Final[str] = "OFFICIAL_WARNINGS_UNAVAILABLE"

#: CAP severity -> points. Extreme and Severe alike: past "Severe" the
#: difference is not something a truck's route choice can act on.
SEVERITY_POINTS: Final[dict[str, int]] = {"Extreme": 20, "Severe": 20, "Moderate": 10, "Minor": 5, "Unknown": 5}

CAP_NS: Final[str] = "urn:oasis:names:tc:emergency:cap:1.2"


@dataclass(frozen=True)
class RssItem:
    identifier: str
    title: str
    author: str
    link: str
    published: str


@dataclass(frozen=True)
class OfficialWarning:
    identifier: str
    sender: str
    sent: datetime | None
    expires: datetime | None
    event: str
    severity: str
    urgency: str
    headline: str
    area_desc: str
    language: str


@dataclass(frozen=True)
class OfficialWarnings:
    level: str
    on_route: tuple[OfficialWarning, ...]
    #: Active alerts elsewhere in a state the corridor crosses - context only.
    in_states: int
    considered: int
    districts: tuple[str, ...]
    provider: str
    fetched_at: datetime | None
    reason_codes: tuple[str, ...]
    version: str = VERSION

    @property
    def is_known(self) -> bool:
        return self.level != LEVEL_UNKNOWN

    @property
    def points(self) -> int:
        return max((SEVERITY_POINTS.get(w.severity, SEVERITY_POINTS["Unknown"]) for w in self.on_route), default=0)


def normalise(text: str) -> str:
    """Letters only, lower-case: 'Ri-Bhoi', 'Ri Bhoi' and 'RI BHOI' are one name."""
    return re.sub(r"[^a-z]", "", text.lower())


def parse_rss(raw: bytes) -> list[RssItem]:
    root = ET.fromstring(raw)
    channel = root.find("channel")
    items: list[RssItem] = []
    for item in channel.findall("item") if channel is not None else []:
        guid = (item.findtext("guid") or "").strip()
        if not guid:
            continue
        items.append(
            RssItem(
                identifier=guid,
                title=(item.findtext("title") or "").strip(),
                author=(item.findtext("author") or "").strip(),
                link=(item.findtext("link") or "").strip(),
                published=(item.findtext("pubDate") or "").strip(),
            )
        )
    return items


def _when(text: str | None) -> datetime | None:
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.strip())
    except ValueError:
        return None


def parse_cap(raw: bytes) -> OfficialWarning | None:
    """One CAP alert; the English `<info>` block when there is more than one."""
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return None
    ns = {"cap": CAP_NS}
    infos = root.findall("cap:info", ns)
    if not infos:
        return None
    info = next((i for i in infos if (i.findtext("cap:language", "", ns) or "").lower().startswith("en")), infos[0])
    area = info.find("cap:area", ns)
    return OfficialWarning(
        identifier=(root.findtext("cap:identifier", "", ns) or "").strip(),
        sender=(root.findtext("cap:sender", "", ns) or "").strip(),
        sent=_when(root.findtext("cap:sent", None, ns)),
        expires=_when(info.findtext("cap:expires", None, ns)),
        event=(info.findtext("cap:event", "", ns) or "").strip(),
        severity=(info.findtext("cap:severity", "", ns) or "Unknown").strip() or "Unknown",
        urgency=(info.findtext("cap:urgency", "", ns) or "").strip(),
        headline=(info.findtext("cap:headline", "", ns) or "").strip(),
        area_desc=(area.findtext("cap:areaDesc", "", ns) or "").strip() if area is not None else "",
        language=(info.findtext("cap:language", "", ns) or "").strip(),
    )


def _active(w: OfficialWarning, now: datetime) -> bool:
    if w.expires is None:
        return True
    expires = w.expires if w.expires.tzinfo else w.expires.replace(tzinfo=now.tzinfo)
    return expires > now


def match_corridor(
    warnings: list[OfficialWarning],
    *,
    districts: set[str],
    states: set[str],
    now: datetime,
    provider: str = "ndma-sachet-cap",
    fetched_at: datetime | None = None,
) -> OfficialWarnings:
    district_keys = {normalise(d) for d in districts if d}
    state_keys = {normalise(s) for s in states if s}
    on_route: list[OfficialWarning] = []
    in_states = 0
    for w in warnings:
        if not _active(w, now):
            continue
        text = normalise(w.area_desc + " " + w.headline)
        if any(k and k in text for k in district_keys):
            on_route.append(w)
        elif any(k and k in text for k in state_keys):
            in_states += 1
    level = LEVEL_ACTIVE if on_route else LEVEL_CLEAR
    return OfficialWarnings(
        level=level,
        on_route=tuple(on_route),
        in_states=in_states,
        considered=len(warnings),
        districts=tuple(sorted(districts)),
        provider=provider,
        fetched_at=fetched_at,
        reason_codes=(REASON_OFFICIAL_WARNING_ON_ROUTE if on_route else REASON_NO_OFFICIAL_WARNING_ON_ROUTE,),
    )
