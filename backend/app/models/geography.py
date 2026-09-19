"""Administrative geography: states, their districts, and the India outline.

WHY THIS IS A TABLE AND NOT A CONSTANT

A district list is not a fact about software, it is a fact about a government
notification, and it changes. Assam, Manipur and Arunachal Pradesh have all
gazetted district changes in living memory, and at least one of those changes
was litigated. So every row carries where it came from and when that source
took effect, and a row whose status is contested says so rather than being
quietly dropped or quietly kept.

WHAT THIS IS FOR

Two manager roles are scoped by it. A District Manager sees their district's
work plus any trip whose origin or destination is their district; a State
Manager sees every district in their state. That scoping is enforced in the
service layer against these ids - see `app/core/scope.py` - so it cannot be
defeated by guessing a URL.

BOUNDARIES (migration 0016)

`geometry` on states and districts, and the India outline in
`country_boundaries`, are what app/services/geo_classify.py classifies a point
against with ST_Covers. All nullable until the Survey of India import
(scripts/import_soi_boundaries.py) fills them; each shape carries its source,
source version and when it was verified. Until then no polygon is guessed:
classification fails closed without the India outline.

`states.is_ner` separates the eight North-Eastern states - the management
scope every manager role lives in - from the other Indian states the importer
adds only so classification can say "India, not NER". A non-NER row grants
nobody anything (app/core/scope.py).
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from geoalchemy2 import Geometry
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.base import TimestampMixin, pg_enum, uuid_pk
from app.models.enums import DistrictSource


def _multipolygon() -> Geometry:
    # A fresh type instance per column: see app/models/operations.py on why a
    # shared GeoAlchemy2 instance silently rewrites nullability. The GiST
    # indexes are declared explicitly, as migration 0016 creates them.
    return Geometry(geometry_type="MULTIPOLYGON", srid=4326, spatial_index=False)


class BoundaryProvenance:
    """Where a boundary shape came from. Null while no shape is loaded."""

    geometry_source: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    geometry_source_version: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    geometry_verified_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )


class State(BoundaryProvenance, TimestampMixin, Base):
    """An Indian state. `is_ner` marks the eight the product manages."""

    __tablename__ = "states"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    #: Stable machine key - "assam", "arunachal-pradesh". Used by seeds and
    #: fixtures so they do not depend on a generated id.
    slug: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    #: Where the name came from. Never blank: an unsourced row is a guess.
    source_name: Mapped[str] = mapped_column(sa.Text, nullable=False)
    source_effective_date: Mapped[sa.Date | None] = mapped_column(
        sa.Date, nullable=True
    )

    #: True for the eight North-Eastern states (backfilled by name in 0016).
    #: Management scope; never set by the boundary importer.
    is_ner: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.false()
    )
    geometry: Mapped[object | None] = mapped_column(_multipolygon(), nullable=True)

    districts: Mapped[list["District"]] = relationship(
        back_populates="state", cascade="all, delete-orphan", lazy="raise"
    )

    __table_args__ = (
        sa.UniqueConstraint("slug", name="uq_states_slug"),
        sa.Index("ix_states_geometry", "geometry", postgresql_using="gist"),
    )


class District(BoundaryProvenance, TimestampMixin, Base):
    """A district of one state, with the provenance of that claim."""

    __tablename__ = "districts"

    id: Mapped[uuid.UUID] = uuid_pk()
    state_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("states.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    slug: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    source_name: Mapped[str] = mapped_column(sa.Text, nullable=False)
    #: WHAT KIND of source, as opposed to which one. `source_name` is prose
    #: for a human; this is the field a query can trust. Defaults to
    #: UNVERIFIED so a row inserted by anything that has not thought about
    #: provenance is excluded from operational counts rather than silently
    #: included in them.
    source_status: Mapped[DistrictSource] = mapped_column(
        pg_enum(DistrictSource),
        nullable=False,
        server_default=DistrictSource.UNVERIFIED.value,
    )
    source_effective_date: Mapped[sa.Date | None] = mapped_column(
        sa.Date, nullable=True
    )
    #: True when the district's existence, name or boundary is disputed or was
    #: notified recently enough that sources disagree. A manager may still be
    #: scoped to it; the UI says the status out loud rather than implying
    #: settled fact.
    disputed_or_recently_changed: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.false()
    )
    notes: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    geometry: Mapped[object | None] = mapped_column(_multipolygon(), nullable=True)

    state: Mapped[State] = relationship(back_populates="districts", lazy="raise")

    __table_args__ = (
        # Unique within a state, not globally: two states may each have a
        # district of the same name, and they do.
        sa.UniqueConstraint("state_id", "slug", name="uq_districts_state_slug"),
        sa.Index("ix_districts_geometry", "geometry", postgresql_using="gist"),
    )


class CountryBoundary(BoundaryProvenance, TimestampMixin, Base):
    """A country outline. Only 'IN' is read: it decides "inside India".

    Its own table rather than a states row, so India can never be listed,
    picked or scoped as if it were a state (see migration 0016).
    """

    __tablename__ = "country_boundaries"

    #: ISO 3166-1 alpha-2.
    code: Mapped[str] = mapped_column(sa.String(2), primary_key=True)
    name: Mapped[str] = mapped_column(sa.Text, nullable=False)
    geometry: Mapped[object] = mapped_column(_multipolygon(), nullable=False)
    geometry_source: Mapped[str] = mapped_column(sa.Text, nullable=False)

    __table_args__ = (
        sa.Index("ix_country_boundaries_geometry", "geometry", postgresql_using="gist"),
    )


#: The provenance classes an operational screen may count.
#:
#: Deliberately a list of what IS accepted rather than what is rejected: a
#: new provenance class added later is excluded until somebody decides
#: otherwise, which is the safe direction for a count a ministry might read.
OPERATIONAL_SOURCES = (DistrictSource.VERIFIED_OFFICIAL, DistrictSource.DEMO)
