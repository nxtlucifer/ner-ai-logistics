"""Audit logging.

Answers WHO did WHAT to WHICH entity WHEN. Written inside the caller's
transaction, so an audit entry and the change it describes commit or roll back
together - an audit trail that can disagree with the data is worse than none,
because it is trusted.

`audit_logs` is append-only, enforced by a database trigger (migration 0002).
"""

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.enums import AuditAction

logger = logging.getLogger(__name__)

# Never recorded, even if present on a model being serialised. Some of these
# would be a credential leak into a table that is deliberately immutable and
# retained for two years.
REDACTED_FIELDS: frozenset[str] = frozenset(
    {
        "password", "password_hash", "token", "token_hash", "refresh_token",
        "access_token", "secret", "secret_key", "database_url", "authorization",
        "api_key", "service_role_key", "anon_key",
    }
)

REDACTED_PLACEHOLDER = "***redacted***"


def scrub(data: dict[str, Any] | None) -> dict[str, Any] | None:
    """Remove sensitive keys before anything is persisted.

    Applied at the audit boundary rather than trusting callers to remember,
    because the cost of one forgetful call site is a permanent record of a
    password hash.
    """
    if data is None:
        return None
    cleaned: dict[str, Any] = {}
    for key, value in data.items():
        if key.lower() in REDACTED_FIELDS:
            cleaned[key] = REDACTED_PLACEHOLDER
        elif isinstance(value, dict):
            cleaned[key] = scrub(value)
        elif isinstance(value, uuid.UUID):
            cleaned[key] = str(value)
        else:
            cleaned[key] = value
    return cleaned


async def record(
    db: AsyncSession,
    *,
    action: AuditAction,
    entity_type: str,
    entity_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    reason: str | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """Add an audit row to the current transaction.

    Deliberately does NOT commit. The caller owns the transaction boundary, so
    the audit entry lands atomically with the mutation it describes.

    `actor_user_id` is NULL for system and scheduled actions - that is a real
    distinction, not a missing value.
    """
    entry = AuditLog(
        actor_user_id=actor_user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before=scrub(before),
        after=scrub(after),
        reason=reason,
        ip_address=ip_address,
    )
    db.add(entry)
    return entry


def snapshot(instance: object, fields: tuple[str, ...]) -> dict[str, Any]:
    """Capture named attributes of a model for a before/after record.

    An explicit field list rather than reflecting everything: reflection would
    sweep up relationships (triggering lazy loads) and any column added later,
    including sensitive ones nobody remembered to exclude.
    """
    out: dict[str, Any] = {}
    for field in fields:
        value = getattr(instance, field, None)
        if isinstance(value, uuid.UUID):
            out[field] = str(value)
        elif hasattr(value, "value"):  # enum member
            out[field] = value.value
        elif hasattr(value, "isoformat"):
            out[field] = value.isoformat()
        elif value is not None and type(value).__name__ == "Decimal":
            out[field] = str(value)
        else:
            out[field] = value
    return out
