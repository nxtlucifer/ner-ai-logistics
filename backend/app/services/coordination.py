"""What more than one API instance must share, kept in Postgres (migration 0015).

Used only when MULTI_INSTANCE is true; with it false nothing here runs and a
single process keeps today's in-memory behaviour.

  lead / my_turn  one leader per background loop, by lease expiry
  release         give those leases up at shutdown
  pace            the next free slot for a rate-limited provider (Nominatim)
  allow / reset   FixedWindowLimiter (core/rate_limit.py) with shared windows

Every call is one short statement in its own transaction on its OWN session,
so it never commits a caller's work; allow() adds a second, a prune, when a
window starts. Leases and pacing draw from a pool of their own
(db/session.get_coordination_sessionmaker), so they never wait behind the
request that called them or behind a login flood. allow/reset use the request
pool: login and refresh call them holding no connection of their own. Every
time is the database's now(), so instances whose clocks drift still agree. No
Redis, no queue: one boring statement each.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import socket
import uuid

from sqlalchemy import text

from app.core.config import get_settings
from app.core.rate_limit import Decision
from app.db.session import get_coordination_sessionmaker, get_sessionmaker

#: Who this process is in instance_leases. Unique per process start.
INSTANCE_ID = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}"

#: A loop's lease outlives this many of its intervals, so a leader that misses
#: one tick keeps it and a dead one is replaced within ~2.5 intervals.
LEASE_INTERVALS = 2.5


async def _run(sql: str, *, request_pool: bool = False, **params):
    maker = get_sessionmaker() if request_pool else get_coordination_sessionmaker()
    async with maker() as db:
        result = await db.execute(text(sql), params)
        row = result.first() if result.returns_rows else None
        await db.commit()
        return row


async def lead(name: str, ttl_s: float, *, holder: str | None = None) -> bool:
    """Take the lease `name` if it is free or expired, or renew it if we hold
    it. True = this holder leads until now() + ttl_s."""
    row = await _run(
        "INSERT INTO instance_leases (name, holder, expires_at) "
        "VALUES (:name, :holder, now() + make_interval(secs => :ttl)) "
        "ON CONFLICT (name) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at "
        "WHERE instance_leases.expires_at < now() OR instance_leases.holder = excluded.holder "
        "RETURNING holder",
        name=name, holder=holder or INSTANCE_ID, ttl=float(ttl_s),
    )
    return row is not None


async def release(*, holder: str | None = None) -> None:
    """Give up every lease this instance holds (lifespan shutdown), so the next
    leader takes over at its next tick instead of after the TTL."""
    await _run("DELETE FROM instance_leases WHERE holder = :holder", holder=holder or INSTANCE_ID)


async def my_turn(name: str, interval_s: float, *, holder: str | None = None) -> bool:
    """Should this instance run this tick of the background loop `name`?

    Always, on a single instance (no database traffic). With MULTI_INSTANCE,
    only the lease holder; each tick renews it.
    ponytail: a step longer than the lease (2.5 intervals) can overlap the next
    leader once. route_watch renews before every trip, so that is one trip.
    """
    if not get_settings().MULTI_INSTANCE:
        return True
    return await lead(name, interval_s * LEASE_INTERVALS, holder=holder)


async def pace(name: str, spacing_s: float, *, reserve_within_s: float | None = None) -> float:
    """Reserve the next slot for provider `name`, at least `spacing_s` after the
    last slot any instance reserved, and sleep until it. Returns the slot
    (epoch seconds, database clock). `reserve_within_s` bounds the reservation
    only (TimeoutError past it), never the sleep: a slot that is rightly more
    than that away, behind other instances' slots, is still waited for."""
    row = await asyncio.wait_for(_run(
        "INSERT INTO provider_pacing (name, next_at) VALUES (:name, now() + make_interval(secs => :s)) "
        "ON CONFLICT (name) DO UPDATE "
        "SET next_at = greatest(now(), provider_pacing.next_at) + make_interval(secs => :s) "
        "RETURNING extract(epoch from next_at)::float8 - :s AS slot, "
        "extract(epoch from next_at - now())::float8 - :s AS wait",
        name=name, s=float(spacing_s),
    ), reserve_within_s)
    if row.wait > 0:
        await asyncio.sleep(row.wait)
    return row.slot


def _hashed(key: str) -> str:
    """Keys carry login identifiers (whatever a caller typed); only a digest
    is stored, which also bounds its length."""
    return hashlib.sha256(key.encode()).hexdigest()


async def allow(key: str, limit: int, window_s: float) -> Decision:
    """FixedWindowLimiter.check against a shared window: count this attempt on
    `key`; a window older than `window_s` restarts at 1, which is always
    allowed; otherwise allowed while hits <= limit."""
    w = float(window_s)
    row = await _run(
        "INSERT INTO rate_limit_windows AS r (key, window_start, hits) VALUES (:key, now(), 1) "
        "ON CONFLICT (key) DO UPDATE SET "
        "window_start = CASE WHEN r.window_start <= now() - make_interval(secs => :w) THEN now() ELSE r.window_start END, "
        "hits = CASE WHEN r.window_start <= now() - make_interval(secs => :w) THEN 1 ELSE r.hits + 1 END "
        "RETURNING hits, extract(epoch from r.window_start + make_interval(secs => :w) - now())::float8 AS remaining",
        request_pool=True, key=_hashed(key), w=w,
    )
    # Expired windows go, so attacker-chosen keys cannot pile up (the in-memory
    # limiter prunes for the same reason). Only when a window starts (hits 1),
    # the only time a row is added, so a repeated key costs one statement.
    # Its own transaction: it takes no lock while holding another, so it cannot
    # deadlock with a concurrent upsert. The cutoff is never shorter than the
    # auth limiters' shared window, so a caller with a shorter window cannot
    # reset their budgets.
    # ponytail: a limiter LONGER than RATE_LIMIT_WINDOW_SECONDS would need a
    # per-row expiry column; none exists.
    if row.hits == 1:
        cutoff = max(w, float(get_settings().RATE_LIMIT_WINDOW_SECONDS))
        await _run(
            "DELETE FROM rate_limit_windows WHERE window_start <= now() - make_interval(secs => :c)",
            request_pool=True, c=cutoff,
        )
    allowed = row.hits == 1 or row.hits <= limit
    return Decision(
        allowed=allowed,
        retry_after=0 if allowed else max(1, int(row.remaining) + 1),
        used=row.hits,
        limit=limit,
    )


async def reset(key: str) -> None:
    """FixedWindowLimiter.reset: forget `key` for every instance."""
    await _run("DELETE FROM rate_limit_windows WHERE key = :key", request_pool=True, key=_hashed(key))
