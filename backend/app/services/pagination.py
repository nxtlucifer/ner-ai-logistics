"""Cursor pagination.

Cursor rather than offset because these tables are append-heavy. With
OFFSET/LIMIT, a row inserted between two page requests shifts every subsequent
row backwards, so the client silently skips records - which for a driver or
truck list means a manager simply never sees one.

The cursor encodes the sort key of the last row returned: (created_at, id). The
id tiebreaker makes ordering total, so rows sharing a timestamp cannot be
duplicated or dropped across a page boundary.
"""

import base64
import binascii
import json
import uuid
from datetime import UTC, datetime
from typing import Any, NamedTuple

from sqlalchemy import ColumnElement, and_, or_

from app.core.errors import APIError

DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 100


class Cursor(NamedTuple):
    created_at: datetime
    id: uuid.UUID


def encode_cursor(created_at: datetime, row_id: uuid.UUID) -> str:
    payload = json.dumps({"t": created_at.isoformat(), "i": str(row_id)})
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def decode_cursor(raw: str) -> Cursor:
    """Parse a client-supplied cursor.

    Opaque to the client but not trusted: it is user input, so a malformed value
    is a 400, never an unhandled exception.
    """
    try:
        padded = raw + "=" * (-len(raw) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
        parsed = datetime.fromisoformat(data["t"])
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return Cursor(created_at=parsed, id=uuid.UUID(data["i"]))
    except (
        binascii.Error, ValueError, KeyError, TypeError, json.JSONDecodeError
    ) as exc:
        raise APIError(
            "Malformed pagination cursor.", code="INVALID_CURSOR"
        ) from exc


def clamp_limit(limit: int | None) -> int:
    """Bound the page size so a client cannot request the whole table."""
    if limit is None:
        return DEFAULT_PAGE_SIZE
    return max(1, min(limit, MAX_PAGE_SIZE))


def cursor_predicate(
    created_at_col: ColumnElement[Any], id_col: ColumnElement[Any], cursor: Cursor
) -> ColumnElement[bool]:
    """Rows strictly after the cursor, in descending (created_at, id) order.

    Written as a compound comparison rather than `created_at < :t` alone, which
    would drop rows sharing the cursor's timestamp.
    """
    return or_(
        created_at_col < cursor.created_at,
        and_(created_at_col == cursor.created_at, id_col < cursor.id),
    )


def build_page(rows: list[Any], limit: int) -> tuple[list[Any], str | None]:
    """Split an over-fetched result into a page and the next cursor.

    Callers query `limit + 1` rows; the extra row proves another page exists
    without a second COUNT query.
    """
    if len(rows) > limit:
        page = rows[:limit]
        last = page[-1]
        return page, encode_cursor(last.created_at, last.id)
    return rows, None
