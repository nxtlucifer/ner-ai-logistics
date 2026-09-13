"""One private file: bytes in the database, read only through the files API.

See migration 0011 for why this is a table and not a bucket.
"""

from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import uuid_pk


class StoredFile(Base):
    __tablename__ = "stored_files"
    __table_args__ = (
        sa.CheckConstraint("size_bytes > 0 AND size_bytes <= 5242880", name="ck_stored_files_size"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    owner_driver_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("drivers.id", ondelete="CASCADE"), nullable=True, index=True
    )
    uploaded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: PROFILE_PHOTO | TRUCK_VERIFICATION | DRIVER_DOCUMENT | TRUCK_DOCUMENT | TRUCK_PHOTO | DEMO_REFERENCE
    kind: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    content_type: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    data: Mapped[bytes] = mapped_column(postgresql.BYTEA, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )
