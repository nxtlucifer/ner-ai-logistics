"""Roadside places. One provider: a local OSM corridor snapshot.

No provider Protocol here on purpose - there is one implementation, and an
interface with one implementation is a guess about a second one. Add the seam
when a real live provider is actually configured, not before.
"""

from app.services.places.snapshot import find, snapshot_counts

__all__ = ["find", "snapshot_counts"]
