"""What more than one API instance must share, kept in Postgres (migration 0015).

Used only when MULTI_INSTANCE is true; with it false nothing here runs and a
single process keeps today's in-memory behaviour.

  lead / my_turn  one leader per background loop, by lease expiry
  release         give those leases up at shutdown
  pace            the next free slot for a rate-limited provider (Nominatim)
  allow / reset   GcraLimiter (core/rate_limit.py) with a shared TAT

Every call is one short statement in its own transaction on its OWN session,
so it never commits a caller's work; allow() adds a second, a prune, when a
key's first row is written. Leases and pacing draw from a pool of their own
(db/session.get_coordination_sessionmaker), so they never wait behind the
request that called them or behind a login flood. allow/reset use the request
pool: every caller hands its own connection back first (deps.charge). Every
time is the database's clock, so instances whose clocks drift still agree. No
Redis, no queue: one boring statement each.
"""

from __future__ import annotations

import asyncio
import hashlib
import math
import os
import socket
import uuid

from sqlalchemy import text

from app.core.config import get_settings
from app.core.rate_limit import Decision, units
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


async def allow(key: str, limit: int, window_s: float, *, burst: int | None = None, cost: int = 1) -> Decision:
    """GcraLimiter.check (core/rate_limit.py) against a shared TAT: one upsert,
    so two instances cannot both spend the last unit. `window_start` holds the
    TAT (theoretical arrival time); `hits` is 1 when this attempt passed, 0
    when it was refused - a refusal leaves the TAT where it was."""
    interval = float(window_s) / limit
    capacity = interval * (burst or limit)
    inc = interval * max(1, min(cost, burst or limit))
    # clock_timestamp(), not now(): now() is when the transaction began, and
    # an upsert that queued behind another caller's row lock began earlier
    # than the one it follows - it would see less time elapsed than there was
    # and refuse the last unit of a burst. clock_timestamp() is read as the
    # row is written, in lock order.
    #
    # max(tat, t) + inc <= t + cap  is  tat <= t + (cap - inc), since inc <=
    # cap: one clock read per test. The two tests below can read clocks
    # microseconds apart; only an attempt landing within those microseconds
    # of its conformance time could be counted one way and reported the other.
    conform = "r.window_start <= clock_timestamp() + make_interval(secs => :slack)"
    row = await _run(
        "INSERT INTO rate_limit_windows AS r (key, window_start, hits) "
        "VALUES (:key, clock_timestamp() + make_interval(secs => :inc), 1) "
        "ON CONFLICT (key) DO UPDATE SET "
        f"window_start = CASE WHEN {conform} "
        "THEN greatest(r.window_start, clock_timestamp()) + make_interval(secs => :inc) ELSE r.window_start END, "
        f"hits = CASE WHEN {conform} THEN 1 ELSE 0 END "
        "RETURNING hits, (xmax = 0) AS inserted, "
        "extract(epoch from window_start - clock_timestamp())::float8 AS ahead",
        request_pool=True, key=_hashed(key), inc=inc, slack=capacity - inc,
    )
    # A key's first row prunes the rows whose TAT has passed (a full bucket is
    # the same as no row), so attacker-chosen keys cannot pile up; the
    # in-memory limiter prunes for the same reason. Only on insert, so a
    # repeated key costs one statement. Its own transaction: it takes no lock
    # while holding another, so it cannot deadlock with a concurrent upsert.
    # A past TAT means "full" under every policy, so no caller's budget is
    # shortened by another policy's window.
    if row.inserted:
        await _run("DELETE FROM rate_limit_windows WHERE window_start < clock_timestamp()", request_pool=True)
    allowed = row.hits == 1
    would = row.ahead if allowed else row.ahead + inc
    return Decision(
        allowed=allowed,
        retry_after=0 if allowed else max(1, math.ceil(would - capacity)),
        used=units(would, interval),
        limit=limit,
    )


async def reset(key: str) -> None:
    """GcraLimiter.reset: forget `key` for every instance."""
    await _run("DELETE FROM rate_limit_windows WHERE key = :key", request_pool=True, key=_hashed(key))
