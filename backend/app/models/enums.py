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
    #: OPTIONAL second-level review: issues a standalone authorisation for one
    #: selection of a REQUIRES_REVIEW route (LS-11), without `route:select`.
    #: Not required for the normal flow - a MANAGER approves and selects in
    #: one step. See app/core/permissions.py and app/services/route_review.py.
    AUTHORISED_REVIEWER = "AUTHORISED_REVIEWER"
    #: The whole North Eastern Region: all eight states, every district, and
    #: the State Managers under them. Distinct from ADMIN, which is the
    #: technical superuser - this is an operational role that still cannot
    #: read a salary or override a hard route block.
    NORTH_EAST_MANAGER = "NORTH_EAST_MANAGER"
    #: Scoped to ONE state. Sees every district in it, and creates and retires
    #: the District Managers inside it. Cannot touch another state.
    STATE_MANAGER = "STATE_MANAGER"
    #: Scoped to ONE district. Sees that district's work, plus any trip whose
    #: origin or destination is that district - a truck arriving is the
    #: destination district's business even though it was dispatched elsewhere.
    DISTRICT_MANAGER = "DISTRICT_MANAGER"


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
    #: Any government-issued identity document, stored as a masked number and a
    #: file. Deliberately generic: no Aadhaar-specific workflow exists here.
    GOVERNMENT_ID = "GOVERNMENT_ID"
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
    #: The driver acknowledged the dispatched job. Distinct from STARTED,
    #: which is the moment the truck begins travelling. Added in 0008.
    ACCEPTED = "ACCEPTED"
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
class RouteReviewBasis(_StrEnum):
    """Which REQUIRES_REVIEW reason a reviewer actually authorised (LS-11).

    Stored rather than inferred, so the record says what the reviewer was
    looking at. "Nobody has measured this corridor" and "an authority reported
    an incident on it" are different facts, and an incident review must be able
    to tell which one a person accepted.

    HIGH_HAZARD_REPORTED exists in the type but is NOT authorisable under the
    approved policy - the service refuses it. It is kept because PostgreSQL
    cannot drop an enum value, so removing it now would cost an ALTER TYPE to
    reinstate if the policy ever widens.
    """

    HAZARD_DATA_UNKNOWN = "HAZARD_DATA_UNKNOWN"
    HIGH_HAZARD_REPORTED = "HIGH_HAZARD_REPORTED"


class EmergencyState(_StrEnum):
    """Lifecycle of a safety incident."""

    DRIVER_CHECK_REQUIRED = "DRIVER_CHECK_REQUIRED"
    DRIVER_RESPONDED = "DRIVER_RESPONDED"
    SOS_ESCALATED = "SOS_ESCALATED"
    RESOLVED = "RESOLVED"
    FALSE_ALARM = "FALSE_ALARM"


class DriverCheckResponse(_StrEnum):
    """Driver button set for the check-in response."""

    I_AM_SAFE = "I_AM_SAFE"
    TRAFFIC = "TRAFFIC"
    ROAD_BLOCKED = "ROAD_BLOCKED"
    BREAKDOWN = "BREAKDOWN"
    REST_STOP = "REST_STOP"
    LOADING = "LOADING"
    UNLOADING = "UNLOADING"
    MEDICAL_ISSUE = "MEDICAL_ISSUE"
    OTHER = "OTHER"
    NEED_HELP = "NEED_HELP"


class DistrictSource(_StrEnum):
    """Where a district row came from, and therefore whether it counts.

    A district is a government notification, not a fact about software, and
    this table can be written by three very different things: a verified
    gazette, a demo seed, and a test fixture. Free text in `source_name`
    described them but could not be queried, so a dashboard counted 230
    fixtures called "Dash Att Other" as configured districts.

    Operational counts accept VERIFIED_OFFICIAL and DEMO. TEST and
    UNVERIFIED are visible only where somebody has asked to see them.
    """

    #: From a government notification, with its date recorded.
    VERIFIED_OFFICIAL = "VERIFIED_OFFICIAL"
    #: Hand-made for a demo. Real enough to operate against, not a gazette.
    DEMO = "DEMO"
    #: Written by a test or a fixture. Never counted, never offered.
    TEST = "TEST"
    #: Provenance not established. The default, deliberately: a row that
    #: nobody classified is not evidence of a district.
    UNVERIFIED = "UNVERIFIED"


class NotificationKind(_StrEnum):
    """What happened. The client renders the sentence; this names the event.

    Deliberately NOT the same list as TripEventKind. A trip timeline records
    everything that happened on the road; an inbox holds only what somebody
    has to act on or be told about. COMMS_LOST belongs in the timeline; it
    does not belong in four managers' inboxes every time a hill blocks a
    signal.
    """

    TRIP_DISPATCHED = "TRIP_DISPATCHED"
    #: For the destination district: something is on its way to you.
    INCOMING_TRIP = "INCOMING_TRIP"
    ROUTE_CHANGED = "ROUTE_CHANGED"
    TRIP_DELAYED = "TRIP_DELAYED"
    TRIP_ARRIVED = "TRIP_ARRIVED"
    TRIP_DELIVERED = "TRIP_DELIVERED"
    #: The driver asked to stop mid-trip and gave a reason. Always URGENT.
    DRIVER_EMERGENCY_STOP = "DRIVER_EMERGENCY_STOP"
    #: A manager answered that request - resume, hold, return, cancel.
    EMERGENCY_RESOLVED = "EMERGENCY_RESOLVED"
    ROUTE_APPROVED = "ROUTE_APPROVED"


class NotificationSeverity(_StrEnum):
    """How hard to interrupt someone.

    URGENT is reserved for a person asking for help. If routine dispatch is
    urgent, nothing is.
    """

    INFO = "INFO"
    WARNING = "WARNING"
    URGENT = "URGENT"


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
    RouteReviewBasis: "route_review_basis",
    EmergencyState: "emergency_state",
    DriverCheckResponse: "driver_check_response",
    DistrictSource: "district_source",
    NotificationKind: "notification_kind",
    NotificationSeverity: "notification_severity",
}
