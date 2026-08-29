"""Domain enumerations, backed by native PostgreSQL ENUM types.

Native enums rather than CHECK-constrained text: the constraint lives in the
database, so a bad value cannot be written by any client, migration or manual
psql session. See docs/DATA_MODEL.md section 2.

Only enums the P2 schema actually uses are defined here. Payment, payroll,
incident, alert and emergency enums belong to their own later migrations -
creating unused types now would be schema we cannot test.
"""

import enum


class _StrEnum(str, enum.Enum):
    """String-valued enum whose members render as their value.

    Inheriting from `str` keeps comparisons with plain strings working, which
    matters at the API boundary where Pydantic hands us raw values.
    """

    def __str__(self) -> str:
        return self.value


# --- Identity -------------------------------------------------------------


class UserRole(_StrEnum):
    ADMIN = "ADMIN"
    MANAGER = "MANAGER"
    DRIVER = "DRIVER"


class DriverStatus(_StrEnum):
    AVAILABLE = "AVAILABLE"
    ON_TRIP = "ON_TRIP"
    OFF_DUTY = "OFF_DUTY"
    SUSPENDED = "SUSPENDED"


class DocumentStatus(_StrEnum):
    """Derived from `expires_on` by a scheduled job, never hand-edited."""

    VALID = "VALID"
    EXPIRING_SOON = "EXPIRING_SOON"
    EXPIRED = "EXPIRED"
    MISSING = "MISSING"
    REJECTED = "REJECTED"


class DriverDocumentType(_StrEnum):
    DRIVING_LICENCE = "DRIVING_LICENCE"
    AADHAAR = "AADHAAR"
    PAN = "PAN"
    POLICE_VERIFICATION = "POLICE_VERIFICATION"
    MEDICAL_CERTIFICATE = "MEDICAL_CERTIFICATE"
    OTHER = "OTHER"


# --- Fleet ----------------------------------------------------------------


class TruckStatus(_StrEnum):
    AVAILABLE = "AVAILABLE"
    ON_TRIP = "ON_TRIP"
    MAINTENANCE = "MAINTENANCE"
    BREAKDOWN = "BREAKDOWN"
    RETIRED = "RETIRED"


class TruckDocumentType(_StrEnum):
    REGISTRATION_CERTIFICATE = "REGISTRATION_CERTIFICATE"
    INSURANCE = "INSURANCE"
    FITNESS_CERTIFICATE = "FITNESS_CERTIFICATE"
    POLLUTION_CERTIFICATE = "POLLUTION_CERTIFICATE"
    NATIONAL_PERMIT = "NATIONAL_PERMIT"
    STATE_PERMIT = "STATE_PERMIT"
    OTHER = "OTHER"


class MaintenanceKind(_StrEnum):
    SERVICE = "SERVICE"
    REPAIR = "REPAIR"
    BREAKDOWN = "BREAKDOWN"
    INSPECTION = "INSPECTION"


class AssignmentStatus(_StrEnum):
    PENDING_VERIFICATION = "PENDING_VERIFICATION"
    ACTIVE = "ACTIVE"
    ENDED = "ENDED"
    REJECTED = "REJECTED"


# --- Shipment -------------------------------------------------------------


class CargoPriority(_StrEnum):
    LOW = "LOW"
    NORMAL = "NORMAL"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class ShipmentStatus(_StrEnum):
    DRAFT = "DRAFT"
    PLANNED = "PLANNED"
    IN_TRANSIT = "IN_TRANSIT"
    DELIVERED = "DELIVERED"
    CANCELLED = "CANCELLED"


# --- Trip -----------------------------------------------------------------


class TripStatus(_StrEnum):
    """Trip lifecycle. Legal transitions live in app/domain/trip_state.py."""

    DRAFT = "DRAFT"
    ASSIGNED = "ASSIGNED"
    VERIFICATION_PENDING = "VERIFICATION_PENDING"
    MANAGER_REVIEW = "MANAGER_REVIEW"
    ACTIVE = "ACTIVE"
    DELAYED = "DELAYED"
    INCIDENT = "INCIDENT"
    DELIVERED = "DELIVERED"
    CLOSED = "CLOSED"
    CANCELLED = "CANCELLED"


class TripStopKind(_StrEnum):
    """Why the truck stops here.

    PICKUP/DROPOFF carry the commercial intent from the shipment. The rest are
    operational stops, and REST/FUEL/CHECKPOINT are what Fleet Sentinel will
    later treat as approved stationary locations rather than raising a check.
    """

    PICKUP = "PICKUP"
    DROPOFF = "DROPOFF"
    REST = "REST"
    FUEL = "FUEL"
    CHECKPOINT = "CHECKPOINT"
    OTHER = "OTHER"


class TripStopStatus(_StrEnum):
    PENDING = "PENDING"
    ARRIVED = "ARRIVED"
    COMPLETED = "COMPLETED"
    SKIPPED = "SKIPPED"


class RouteKind(_StrEnum):
    PRIMARY = "PRIMARY"
    FUEL_EFFICIENT = "FUEL_EFFICIENT"
    EMERGENCY_BACKUP = "EMERGENCY_BACKUP"


class RouteState(_StrEnum):
    PROPOSED = "PROPOSED"
    SELECTED = "SELECTED"
    SUPERSEDED = "SUPERSEDED"
    REJECTED_BLOCKED = "REJECTED_BLOCKED"


class TripEventKind(_StrEnum):
    """Operational timeline of a trip.

    Append-only narrative used by the manager timeline and, later, by incident
    review. Distinct from `audit_logs`, which records *who changed what* for
    compliance; this records *what happened on the road*.
    """

    CREATED = "CREATED"
    ASSIGNED = "ASSIGNED"
    VERIFIED = "VERIFIED"
    DISPATCHED = "DISPATCHED"
    STARTED = "STARTED"
    STOP_ARRIVED = "STOP_ARRIVED"
    STOP_COMPLETED = "STOP_COMPLETED"
    ROUTE_CHANGED = "ROUTE_CHANGED"
    DELAY_DETECTED = "DELAY_DETECTED"
    COMMS_LOST = "COMMS_LOST"
    COMMS_RESTORED = "COMMS_RESTORED"
    BREAKDOWN_REPORTED = "BREAKDOWN_REPORTED"
    INCIDENT_OPENED = "INCIDENT_OPENED"
    INCIDENT_RESOLVED = "INCIDENT_RESOLVED"
    DELIVERED = "DELIVERED"
    CLOSED = "CLOSED"
    CANCELLED = "CANCELLED"


# --- Audit ----------------------------------------------------------------


class AuditAction(_StrEnum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    STATUS_CHANGE = "STATUS_CHANGE"
    LOGIN = "LOGIN"
    LOGIN_FAILED = "LOGIN_FAILED"
    DOCUMENT_ACCESS = "DOCUMENT_ACCESS"


# Names of the PostgreSQL types, so migrations and models cannot drift apart.
ENUM_TYPE_NAMES: dict[type[_StrEnum], str] = {
    UserRole: "user_role",
    DriverStatus: "driver_status",
    DocumentStatus: "document_status",
    DriverDocumentType: "driver_document_type",
    TruckStatus: "truck_status",
    TruckDocumentType: "truck_document_type",
    MaintenanceKind: "maintenance_kind",
    AssignmentStatus: "assignment_status",
    CargoPriority: "cargo_priority",
    ShipmentStatus: "shipment_status",
    TripStatus: "trip_status",
    TripStopKind: "trip_stop_kind",
    TripStopStatus: "trip_stop_status",
    RouteKind: "route_kind",
    RouteState: "route_state",
    TripEventKind: "trip_event_kind",
    AuditAction: "audit_action",
}
