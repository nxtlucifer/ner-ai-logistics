"""Domain models.

Importing this package registers every table on `Base.metadata`. Alembic's
env.py imports it so autogenerate and the schema-drift test see the complete
schema - a model that is never imported is invisible to both, which is exactly
how a table silently disappears from a migration.
"""

from app.models.audit import AuditLog
from app.models.enums import (
    AssignmentStatus,
    AuditAction,
    CargoPriority,
    DocumentStatus,
    DriverDocumentType,
    DriverStatus,
    MaintenanceKind,
    RouteKind,
    RouteState,
    ShipmentStatus,
    TripEventKind,
    TripStatus,
    TripStopKind,
    TripStopStatus,
    TruckDocumentType,
    TruckStatus,
    UserRole,
)
from app.models.fleet import (
    DriverTruckAssignment,
    Truck,
    TruckDocument,
    TruckMaintenance,
)
from app.models.identity import Driver, DriverDocument, User
from app.models.operations import (
    CargoItem,
    GpsPoint,
    Shipment,
    Trip,
    TripEvent,
    TripRoute,
    TripStop,
)

__all__ = [
    # Identity
    "User",
    "Driver",
    "DriverDocument",
    # Fleet
    "Truck",
    "TruckDocument",
    "TruckMaintenance",
    "DriverTruckAssignment",
    # Operations
    "Shipment",
    "CargoItem",
    "Trip",
    "TripStop",
    "TripRoute",
    "TripEvent",
    "GpsPoint",
    # Audit
    "AuditLog",
    # Enums
    "UserRole",
    "DriverStatus",
    "DocumentStatus",
    "DriverDocumentType",
    "TruckStatus",
    "TruckDocumentType",
    "MaintenanceKind",
    "AssignmentStatus",
    "CargoPriority",
    "ShipmentStatus",
    "TripStatus",
    "TripStopKind",
    "TripStopStatus",
    "RouteKind",
    "RouteState",
    "TripEventKind",
    "AuditAction",
]

# Tables created by migration 0002. The RLS test iterates this rather than a
# hand-maintained list, so a new table cannot be added without RLS coverage.
P2_TABLES: tuple[str, ...] = (
    "users",
    "drivers",
    "driver_documents",
    "trucks",
    "truck_documents",
    "truck_maintenance",
    "driver_truck_assignments",
    "shipments",
    "cargo_items",
    "trips",
    "trip_stops",
    "trip_routes",
    "trip_events",
    "gps_points",
    "audit_logs",
)
