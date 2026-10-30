"""Expenses capabilities: the landlord's running costs outside maintenance requests.

Voiding a recorded expense is a financial correction, so it is owner-only by default;
owners can delegate it per member.
"""

from apps.core.modules import ModuleDefinition
from apps.organizations.roles import Role

EXPENSES_MODULE = ModuleDefinition(
    key="expenses",
    name="Nexora Expenses",
    capabilities={
        "expenses.view": "View expenses (utility bills, salaries, rates and other running costs)",
        "expenses.record": "Record and correct expenses",
        "expenses.void": "Void recorded expenses (financial corrections)",
    },
    role_defaults={
        Role.PROPERTY_MANAGER: {"expenses.view", "expenses.record"},
        Role.ACCOUNTANT: {"expenses.view", "expenses.record"},
    },
)
