"""Operations capabilities: maintenance, inspections, move-outs and tenant communication."""

from apps.core.modules import ModuleDefinition
from apps.organizations.roles import Role

OPERATIONS_MODULE = ModuleDefinition(
    key="operations",
    name="Nexora Operations",
    capabilities={
        "maintenance.view": "View maintenance requests",
        "maintenance.manage": "Assign, update and resolve maintenance requests",
        "maintenance.costs": "See and record maintenance quotations and costs",
        "inspections.view": "View inspections",
        "inspections.manage": "Schedule and complete inspections",
        "moveouts.view": "View move-out notices (private until acknowledged)",
        "moveouts.manage": "Handle move-outs and settle final accounts",
        "announcements.send": "Send announcements to tenants",
        "tenants.portal": "Invite tenants to the tenant portal",
        "notifications.configure": "Configure reminders and notification channels",
    },
    role_defaults={
        Role.PROPERTY_MANAGER: {
            "maintenance.view",
            "maintenance.manage",
            "maintenance.costs",
            "inspections.view",
            "inspections.manage",
            "moveouts.view",
            "moveouts.manage",
            "announcements.send",
            "tenants.portal",
        },
        Role.ACCOUNTANT: {"maintenance.view", "maintenance.costs", "moveouts.view"},
        Role.CARETAKER: {
            "maintenance.view",
            "maintenance.manage",
            "inspections.view",
            "inspections.manage",
        },
    },
)
