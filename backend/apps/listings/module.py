"""Public listings: publishing vacant units and handling enquiries and viewing requests."""

from apps.core.modules import ModuleDefinition
from apps.organizations.roles import Role

LISTINGS_MODULE = ModuleDefinition(
    key="listings",
    name="Nexora Listings",
    capabilities={
        "listings.view": "See listings, enquiries and viewing requests",
        "listings.manage": "Publish units and handle enquiries and viewings",
    },
    role_defaults={
        Role.PROPERTY_MANAGER: {"listings.view", "listings.manage"},
        # Caretakers often show the units, so they see who's coming.
        Role.CARETAKER: {"listings.view"},
    },
)
