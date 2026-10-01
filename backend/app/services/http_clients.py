"""One long-lived httpx.AsyncClient per provider (DBPOOL-06, NF-10).

Building an `httpx.AsyncClient` builds an SSLContext and loads the CA bundle,
on the event loop: 198-329 ms of blocked loop per construction on Windows
(db-pool lane, 30 Sep 2026), and every request then paid a fresh TCP and TLS
handshake as well. There were 17 such constructions on request paths. One
client per provider keeps the context and the keep-alive connections.

Rules:
  * timeouts stay per request (`client.get(..., timeout=...)`), read from
    settings when the request is made, exactly as before;
  * no cookie outlives a request: the jar refuses every cookie, so a shared
    client never carries one caller's provider cookie into another's request;
  * a client belongs to the event loop that made it (httpcore's pool does), so
    it is rebuilt when the running loop changes - each test's fresh loop,
    never production's single one;
  * `aclose_all()` runs at shutdown, from the app lifespan.

`maplink.expand` deliberately keeps a client per call: it follows redirects
of a URL a manager pasted, and that fetch shares nothing with anyone else's.
"""

from __future__ import annotations

import asyncio
from http.cookiejar import CookieJar, DefaultCookiePolicy

import httpx

_clients: dict[str, tuple[asyncio.AbstractEventLoop, httpx.AsyncClient]] = {}


def get(provider: str, **kwargs: object) -> httpx.AsyncClient:
    """The shared client for `provider`, built on first use in this loop.

    `kwargs` (headers, follow_redirects...) apply when the client is built,
    so one provider name must always be asked for with the same ones.
    """
    loop = asyncio.get_running_loop()
    held = _clients.get(provider)
    if held is None or held[0] is not loop or held[1].is_closed:
        jar = CookieJar(policy=DefaultCookiePolicy(allowed_domains=[]))
        held = _clients[provider] = (loop, httpx.AsyncClient(cookies=jar, **kwargs))
    return held[1]


async def aclose_all() -> None:
    """Close every client this loop owns. Others died with their loop."""
    loop = asyncio.get_running_loop()
    held = list(_clients.values())
    _clients.clear()
    for owner, client in held:
        if owner is loop and not client.is_closed:
            await client.aclose()
