"""A pasted Google Maps link -> a coordinate, touching only the URL.

WHAT IS TOUCHED

  1. the pasted URL itself
  2. the Location header of each redirect a short link (maps.app.goo.gl,
     goo.gl) answers with - at most MAX_HOPS, each hop re-validated
  3. the expanded URL's coordinates (@lat,lon · q=lat,lon · ll= · destination=
     · daddr= · !3dLAT!4dLON), or failing that its place TEXT (/place/<name>,
     q=<name>), which is handed to OUR geocoder (Nominatim)

WHAT IS NOT

  No page body is read (the request is a HEAD-like GET with the stream never
  consumed), no Google endpoint other than following the share redirect, no
  Places data. The result is drawn on OUR map from OUR geocoder.

SSRF: only Google Maps hosts are contacted, redirects are followed manually,
and every hop must still be a Google Maps host over http(s). Private and
link-local targets are refused by name before any request.
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from urllib.parse import parse_qs, unquote_plus, urlsplit

import httpx

from app.core.config import get_settings
from app.services import geocoding

MAX_HOPS = 5
_ALLOWED = {"google.com", "www.google.com", "maps.google.com", "maps.app.goo.gl", "goo.gl", "g.co"}
_PAIR = re.compile(r"(?<![\d.])([+-]?\d{1,2}(?:\.\d+)?)\s*,\s*([+-]?\d{1,3}(?:\.\d+)?)(?![\d.])")
_AT = re.compile(r"@([+-]?\d{1,2}\.\d+),([+-]?\d{1,3}\.\d+)")
_BANG = re.compile(r"!3d([+-]?\d{1,2}\.\d+)!4d([+-]?\d{1,3}\.\d+)")


class NotAMapsLink(ValueError):
    """Not an http(s) Google Maps URL. Nothing was contacted."""


class NoLocationInLink(ValueError):
    """A Maps link that names neither a coordinate nor a place."""


@dataclass(frozen=True)
class MapLocation:
    lat: float
    lon: float
    label: str | None
    url: str
    #: DIRECT_PARSE / REDIRECT_PARSE / GEOCODED
    via: str


def is_maps_host(host: str) -> bool:
    host = host.lower().rstrip(".")
    return host in _ALLOWED or host.endswith(".google.com") or host.endswith(".goo.gl")


def _is_private(host: str) -> bool:
    try:
        return not ipaddress.ip_address(host).is_global
    except ValueError:
        return host.lower() in {"localhost", "0.0.0.0"}


def _validated(raw: str) -> str:
    url = raw.strip()
    if "://" not in url:
        url = "https://" + url
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise NotAMapsLink("Paste a Google Maps link (google.com/maps or maps.app.goo.gl).")
    if _is_private(parts.hostname) or not is_maps_host(parts.hostname):
        raise NotAMapsLink("Only Google Maps links are accepted here.")
    return url


def _coordinate(lat_s: str, lon_s: str) -> tuple[float, float] | None:
    lat, lon = float(lat_s), float(lon_s)
    return (lat, lon) if -90 <= lat <= 90 and -180 <= lon <= 180 else None


def parse_url(url: str) -> tuple[tuple[float, float] | None, str | None]:
    """(coordinate, place text) present in the URL itself. Either may be None."""
    parts = urlsplit(url)
    query = parse_qs(parts.query)
    label: str | None = None
    place = re.search(r"/place/([^/@?]+)", parts.path)
    if place:
        label = unquote_plus(place.group(1)).strip() or None
    for key in ("q", "query", "destination", "daddr", "ll"):
        for value in query.get(key, []):
            pair = _PAIR.search(value)
            if pair and (coord := _coordinate(*pair.groups())):
                text = re.search(r"\(([^)]+)\)", value)
                return coord, (text.group(1) if text else label)
            if key in ("q", "query", "destination", "daddr") and value.strip() and label is None:
                label = value.strip()
    for pattern in (_AT, _BANG):
        found = pattern.search(url)
        if found and (coord := _coordinate(*found.groups())):
            return coord, label
    return None, label


async def expand(url: str) -> str:
    """Follow a short link's redirects by header only, every hop validated."""
    settings = get_settings()
    current = url
    async with httpx.AsyncClient(timeout=settings.GEOCODING_TIMEOUT_SECONDS, follow_redirects=False) as client:
        for _ in range(MAX_HOPS):
            parts = urlsplit(current)
            if not parts.hostname or _is_private(parts.hostname) or not is_maps_host(parts.hostname):
                raise NotAMapsLink("The link redirected outside Google Maps and was not followed.")
            async with client.stream("GET", current, headers={"User-Agent": geocoding.NOMINATIM_USER_AGENT}) as response:
                target = response.headers.get("location")
                if response.status_code not in (301, 302, 303, 307, 308) or not target:
                    return current
            current = str(httpx.URL(current).join(target))
            if parse_url(current)[0] is not None:
                return current  # the answer is in the URL; nothing more is fetched
    return current


async def resolve(raw: str) -> MapLocation:
    url = _validated(raw)
    coord, label = parse_url(url)
    if coord:
        return MapLocation(coord[0], coord[1], label, url, "DIRECT_PARSE")
    expanded = url
    host = urlsplit(url).hostname or ""
    if host.endswith("goo.gl") or host == "g.co":
        expanded = await expand(url)
        coord, label = parse_url(expanded)
        if coord:
            return MapLocation(coord[0], coord[1], label, expanded, "REDIRECT_PARSE")
    if label:
        found = await geocoding.nominatim_search(label, limit=1)
        if found:
            return MapLocation(found[0].lat, found[0].lon, found[0].address, expanded, "GEOCODED")
        raise NoLocationInLink(f"Our geocoder could not place '{label[:80]}'. Choose the point on the map.")
    raise NoLocationInLink("That link names no coordinate or place. Choose the point on the map.")
