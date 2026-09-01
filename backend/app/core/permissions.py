"""Role-based access control.

Authorization is the application's own concern and lives entirely here, not in
the database. This is a deliberate consequence of a measured fact: the backend
connects to Supabase as the `postgres` role, which has `rolbypassrls = true`.
PostgreSQL RLS therefore cannot participate in backend authorization at all.

    RLS protects          : the Supabase Data API (anon key, PostgREST)
    This module protects  : every request that reaches FastAPI

Conflating the two would produce policies that look like security while
enforcing nothing on the path clients actually use. See docs/SECURITY.md.

Permissions are strings of the form "<resource>:<action>". Roles map to sets of
them. Routes depend on a permission, never on a role name - so changing which
role may do something is a change here, not a sweep through every endpoint.
"""

from typing import Final

from app.models.enums import UserRole

# --- Permission catalogue -------------------------------------------------

DRIVER_READ: Final = "driver:read"
DRIVER_CREATE: Final = "driver:create"
DRIVER_UPDATE: Final = "driver:update"
DRIVER_DEACTIVATE: Final = "driver:deactivate"
DRIVER_READ_SENSITIVE: Final = "driver:read_sensitive"  # salary, full documents

TRUCK_READ: Final = "truck:read"
TRUCK_CREATE: Final = "truck:create"
TRUCK_UPDATE: Final = "truck:update"
TRUCK_RETIRE: Final = "truck:retire"

ASSIGNMENT_READ: Final = "assignment:read"
ASSIGNMENT_CREATE: Final = "assignment:create"
ASSIGNMENT_END: Final = "assignment:end"
ASSIGNMENT_REVIEW: Final = "assignment:review"
ASSIGNMENT_VERIFY_OWN: Final = "assignment:verify_own"

SHIPMENT_READ: Final = "shipment:read"
SHIPMENT_CREATE: Final = "shipment:create"

TRIP_READ: Final = "trip:read"
TRIP_CREATE: Final = "trip:create"
TRIP_DISPATCH: Final = "trip:dispatch"
TRIP_CANCEL: Final = "trip:cancel"
TRIP_CLOSE: Final = "trip:close"

ROUTE_READ: Final = "route:read"
ROUTE_PLAN: Final = "route:plan"
ROUTE_SELECT: Final = "route:select"

# Driver-side execution. "own" is an object-level qualifier a permission string
# cannot express - the binding to *which* trip is enforced in the service layer
# from the authenticated driver, never from a request parameter.
TRIP_EXECUTE_OWN: Final = "trip:execute_own"
LOCATION_SUBMIT_OWN: Final = "location:submit_own"

# Reading where the fleet is. Deliberately its own permission rather than
# folded into trip:read: location is the most sensitive data the system holds
# (docs/SECURITY.md section 3), and a future read-only role should be able to
# see trip progress without seeing a driver's position.
FLEET_LOCATION_READ: Final = "fleet:location_read"

AUDIT_READ: Final = "audit:read"

ALL_PERMISSIONS: Final[frozenset[str]] = frozenset(
    {
        DRIVER_READ, DRIVER_CREATE, DRIVER_UPDATE, DRIVER_DEACTIVATE,
        DRIVER_READ_SENSITIVE,
        TRUCK_READ, TRUCK_CREATE, TRUCK_UPDATE, TRUCK_RETIRE,
        ASSIGNMENT_READ, ASSIGNMENT_CREATE, ASSIGNMENT_END, ASSIGNMENT_REVIEW,
        ASSIGNMENT_VERIFY_OWN,
        SHIPMENT_READ, SHIPMENT_CREATE,
        TRIP_READ, TRIP_CREATE, TRIP_DISPATCH, TRIP_CANCEL, TRIP_CLOSE,
        ROUTE_READ, ROUTE_PLAN, ROUTE_SELECT,
        TRIP_EXECUTE_OWN, LOCATION_SUBMIT_OWN,
        FLEET_LOCATION_READ,
        AUDIT_READ,
    }
)

# --- Role definitions -----------------------------------------------------

_MANAGER_PERMISSIONS: Final[frozenset[str]] = frozenset(
    {
        DRIVER_READ, DRIVER_CREATE, DRIVER_UPDATE, DRIVER_DEACTIVATE,
        TRUCK_READ, TRUCK_CREATE, TRUCK_UPDATE, TRUCK_RETIRE,
        ASSIGNMENT_READ, ASSIGNMENT_CREATE, ASSIGNMENT_END, ASSIGNMENT_REVIEW,
        SHIPMENT_READ, SHIPMENT_CREATE,
        TRIP_READ, TRIP_CREATE, TRIP_DISPATCH, TRIP_CANCEL, TRIP_CLOSE,
        ROUTE_READ, ROUTE_PLAN, ROUTE_SELECT,
        FLEET_LOCATION_READ,
        AUDIT_READ,
    }
)

# A driver reads their own records and verifies their own assignment. Object
# level scoping - "own" - is enforced in the service layer, because a permission
# string cannot express whose row it is. See docs/SECURITY.md section 2.
#
# Note what is ABSENT: FLEET_LOCATION_READ and TRIP_READ. A driver executes
# their own trip and submits their own position; they cannot read the fleet's
# locations or another driver's trip. Location history is visible to managers
# and admins only, never to other drivers - docs/SECURITY.md section 3.
_DRIVER_PERMISSIONS: Final[frozenset[str]] = frozenset(
    {
        DRIVER_READ,
        TRUCK_READ,
        ASSIGNMENT_READ,
        ASSIGNMENT_VERIFY_OWN,
        TRIP_EXECUTE_OWN,
        LOCATION_SUBMIT_OWN,
    }
)

ROLE_PERMISSIONS: Final[dict[UserRole, frozenset[str]]] = {
    # Admin gets everything, including salary visibility, which MANAGER
    # deliberately does not have.
    UserRole.ADMIN: ALL_PERMISSIONS,
    UserRole.MANAGER: _MANAGER_PERMISSIONS,
    UserRole.DRIVER: _DRIVER_PERMISSIONS,
}


def permissions_for(role: UserRole) -> frozenset[str]:
    """Permissions granted to a role.

    An unknown role gets nothing. Failing closed matters: if a role is ever
    added to the enum without being added here, it must be powerless rather
    than accidentally inherit someone else's rights.
    """
    return ROLE_PERMISSIONS.get(role, frozenset())


def has_permission(role: UserRole, permission: str) -> bool:
    return permission in permissions_for(role)
