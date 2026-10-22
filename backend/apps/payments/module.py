from apps.core.modules import ModuleDefinition
from apps.organizations.roles import Role

PAYMENTS_MODULE = ModuleDefinition(
    key="payments",
    name="Nexora Pay",
    capabilities={
        "payments.view": "View payments, receipts and payment instructions",
        "payments.record": (
            "Record and allocate payments, match and import transactions, request M-Pesa payments"
        ),
        "payments.reverse": "Reverse payments and refund tenant credit",
        "payment_settings.manage": "Manage payment methods and provider credentials",
    },
    role_defaults={
        Role.PROPERTY_MANAGER: {"payments.view"},
        Role.ACCOUNTANT: {"payments.view", "payments.record"},
        Role.CARETAKER: set(),
    },
)
