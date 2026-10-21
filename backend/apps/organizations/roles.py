"""Organization roles and the platform-layer capabilities they grant.

Each business module registers a ModuleDefinition with its own capabilities and
per-role defaults (see apps.core.modules). A membership's effective capabilities are:

    owner          -> every registered capability (cannot be reduced)
    other roles    -> union of module defaults for the role
                      + membership.extra_permissions
                      - membership.revoked_permissions
"""

from django.db import models

from apps.core.modules import ModuleDefinition


class Role(models.TextChoices):
    OWNER = "owner", "Organization owner"
    PROPERTY_MANAGER = "property_manager", "Property manager"
    ACCOUNTANT = "accountant", "Accountant / cashier"
    CARETAKER = "caretaker", "Caretaker / maintenance"


class AccessScope(models.TextChoices):
    """Which records a member can reach within capabilities they hold.

    ORGANIZATION: every record in the organization.
    ASSIGNED: only resources explicitly assigned to the member (e.g. properties). Modules
    decide what "assigned" means for their own resources.
    """

    ORGANIZATION = "organization", "Whole organization"
    ASSIGNED = "assigned", "Assigned resources only"


DEFAULT_ACCESS_SCOPE = {
    Role.OWNER: AccessScope.ORGANIZATION,
    Role.ACCOUNTANT: AccessScope.ORGANIZATION,
    Role.PROPERTY_MANAGER: AccessScope.ASSIGNED,
    Role.CARETAKER: AccessScope.ASSIGNED,
}


PLATFORM_MODULE = ModuleDefinition(
    key="platform",
    name="Nexora Platform",
    capabilities={
        "organization.manage": "Manage organization settings",
        "members.view": "View team members and invitations",
        "members.manage": "Invite, update and remove team members",
        "audit.view": "View the organization audit log",
    },
    role_defaults={
        Role.PROPERTY_MANAGER: {"members.view"},
        Role.ACCOUNTANT: {"audit.view"},
        Role.CARETAKER: set(),
    },
)
