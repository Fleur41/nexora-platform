"""Reporting capabilities: financial and occupancy reports and their exports."""

from apps.core.modules import ModuleDefinition
from apps.organizations.roles import Role

REPORTS_MODULE = ModuleDefinition(
    key="reports",
    name="Nexora Reports",
    capabilities={
        "reports.view": "View and export financial and occupancy reports",
    },
    role_defaults={
        Role.PROPERTY_MANAGER: {"reports.view"},
        Role.ACCOUNTANT: {"reports.view"},
    },
)
