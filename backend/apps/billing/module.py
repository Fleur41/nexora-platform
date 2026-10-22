"""Billing, utilities and deposits capabilities.

Financial corrections (voids, credits) and deposit deductions/refunds are owner-only by
default; owners can delegate them per member.
"""

from apps.core.modules import ModuleDefinition
from apps.organizations.roles import Role

BILLING_MODULE = ModuleDefinition(
    key="billing",
    name="Nexora Billing",
    capabilities={
        "billing.view": "View invoices, tenant balances and statements",
        "billing.configure": "Configure charge types, charge rules and billing settings",
        "billing.generate": "Run billing, raise one-off invoices and enter shared costs",
        "billing.adjust": "Void invoices and issue credits (financial corrections)",
        "meters.view": "View utility meters and readings",
        "meters.record": "Record meter readings and manage meters",
        "deposits.view": "View security deposits",
        "deposits.record": "Record deposits received",
        "deposits.settle": "Record deposit deductions, refunds and reversals",
    },
    role_defaults={
        Role.PROPERTY_MANAGER: {"billing.view", "meters.view", "meters.record", "deposits.view"},
        Role.ACCOUNTANT: {
            "billing.view",
            "billing.generate",
            "meters.view",
            "deposits.view",
            "deposits.record",
        },
        Role.CARETAKER: {"meters.view", "meters.record"},
    },
)
