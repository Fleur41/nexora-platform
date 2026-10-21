"""Nexora Property module: capabilities and role defaults.

Covers the properties, tenants and leases apps. Accountants and caretakers get read
access only; caretakers do not get lease (rent) visibility.
"""

from apps.core.modules import ModuleDefinition
from apps.organizations.roles import Role

PROPERTY_MODULE = ModuleDefinition(
    key="property",
    name="Nexora Property",
    capabilities={
        "properties.view": "View properties, unit types and units",
        "properties.manage": "Create and edit properties, unit types and units",
        "tenants.view": "View tenant contact details",
        "tenants.manage": "Register and edit tenants, including identity documents",
        "leases.view": "View leases and rent terms",
        "leases.manage": "Create, activate, change and end leases",
    },
    role_defaults={
        Role.PROPERTY_MANAGER: {
            "properties.view",
            "properties.manage",
            "tenants.view",
            "tenants.manage",
            "leases.view",
            "leases.manage",
        },
        Role.ACCOUNTANT: {"properties.view", "tenants.view", "leases.view"},
        Role.CARETAKER: {"properties.view", "tenants.view"},
    },
)
