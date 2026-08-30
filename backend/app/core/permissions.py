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

AUDIT_READ: Final = "audit:read"

ALL_PERMISSIONS: Final[frozenset[str]] = frozenset(
    {
        DRIVER_READ, DRIVER_CREATE, DRIVER_UPDATE, DRIVER_DEACTIVATE,
        DRIVER_READ_SENSITIVE,
        TRUCK_READ, TRUCK_CREATE, TRUCK_UPDATE, TRUCK_RETIRE,
        ASSIGNMENT_READ, ASSIGNMENT_CREATE, ASSIGNMENT_END, ASSIGNMENT_REVIEW,
        ASSIGNMENT_VERIFY_OWN,
        AUDIT_READ,
    }
)

# --- Role definitions -----------------------------------------------------

_MANAGER_PERMISSIONS: Final[frozenset[str]] = frozenset(
    {
        DRIVER_READ, DRIVER_CREATE, DRIVER_UPDATE, DRIVER_DEACTIVATE,
        TRUCK_READ, TRUCK_CREATE, TRUCK_UPDATE, TRUCK_RETIRE,
        ASSIGNMENT_READ, ASSIGNMENT_CREATE, ASSIGNMENT_END, ASSIGNMENT_REVIEW,
        AUDIT_READ,
    }
)

# A driver reads their own records and verifies their own assignment. Object
# level scoping - "own" - is enforced in the service layer, because a permission
# string cannot express whose row it is. See docs/SECURITY.md section 2.
_DRIVER_PERMISSIONS: Final[frozenset[str]] = frozenset(
    {
        DRIVER_READ,
        TRUCK_READ,
        ASSIGNMENT_READ,
        ASSIGNMENT_VERIFY_OWN,
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
