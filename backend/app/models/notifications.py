"""A manager's inbox: one durable row per thing they need to know.

WHY A ROW AND NOT A PUSH

`driver_notifications` records push *attempts* to a phone - it is a delivery
audit and a dedupe window, and a row there means "we tried", not "they know".
This table is the opposite: the row IS the notification. Push and realtime are
two ways of drawing attention to it, and both may fail without anything being
lost. A destination district manager who was asleep when the truck was
dispatched still finds it here.

WHY STRUCTURED PAYLOAD AND NOT A SENTENCE

The manager console will be read in more than one language, and a sentence
frozen into a row in September cannot be translated in October. `kind` plus
`payload` lets the client render the message in whatever language the reader
has chosen, and lets the same row carry a trip code the UI can make clickable.

DEDUPE

`dedupe_key` is unique per recipient. A route re-assessed five times in a
minute is one notification, not five - see `services/notifications.py`. The
uniqueness is a database constraint rather than a check-then-insert, because
two workers racing is exactly when duplicates appear.
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import pg_enum, uuid_pk
from app.models.enums import NotificationKind, NotificationSeverity


class Notification(Base):
    """One durable, addressed, readable notification."""

    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = uuid_pk()
    recipient_user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    trip_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=True, index=True
    )
    kind: Mapped[NotificationKind] = mapped_column(
        pg_enum(NotificationKind), nullable=False
    )
    severity: Mapped[NotificationSeverity] = mapped_column(
        pg_enum(NotificationSeverity),
        nullable=False,
        server_default=NotificationSeverity.INFO.value,
    )
    #: Everything the client needs to render a sentence in the reader's own
    #: language: trip_code, district names, a reason, a driver's name. No
    #: pre-rendered English.
    payload: Mapped[dict] = mapped_column(
        postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
    )
    dedupe_key: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    is_read: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.false()
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )
    read_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        sa.UniqueConstraint(
            "recipient_user_id", "dedupe_key", name="uq_notifications_recipient_dedupe"
        ),
        # The inbox query: newest first, unread first, for one person.
        sa.Index(
            "ix_notifications_recipient_created",
            "recipient_user_id",
            sa.text("created_at DESC"),
        ),
    )
