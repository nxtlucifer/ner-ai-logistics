"""Shared state for more than one API instance (migration 0015). Written with
plain SQL in services/coordination.py; declared here so the schema-drift test
and autogenerate see the tables."""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class InstanceLease(Base):
    __tablename__ = "instance_leases"

    name: Mapped[str] = mapped_column(sa.Text, primary_key=True)
    holder: Mapped[str] = mapped_column(sa.Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)


class RateLimitWindow(Base):
    __tablename__ = "rate_limit_windows"

    key: Mapped[str] = mapped_column(sa.Text, primary_key=True)
    window_start: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    hits: Mapped[int] = mapped_column(sa.Integer, nullable=False)


class ProviderPacing(Base):
    __tablename__ = "provider_pacing"

    name: Mapped[str] = mapped_column(sa.Text, primary_key=True)
    next_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
