"""Charge types every organization starts with.

These only name the charges. Nothing is billed for a type until the landlord adds an
enabled charge rule with an amount, so optional services stay optional.
"""

from django.db import IntegrityError, transaction

from .models import ChargeType, IncomeCategory

DEFAULT_CHARGE_TYPES = [
    # code, name, income category, meter utility, system
    (ChargeType.RENT, "Rent", IncomeCategory.RENTAL_INCOME, "", True),
    ("water", "Water", IncomeCategory.UTILITY_RECOVERY, "water", False),
    ("electricity", "Electricity", IncomeCategory.UTILITY_RECOVERY, "electricity", False),
    ("shared_electricity", "Shared electricity", IncomeCategory.UTILITY_RECOVERY, "", False),
    ("security", "Security", IncomeCategory.SERVICE_CHARGE, "", False),
    ("garbage", "Garbage collection", IncomeCategory.SERVICE_CHARGE, "", False),
    ("sewage", "Sewage", IncomeCategory.UTILITY_RECOVERY, "", False),
    ("parking", "Parking", IncomeCategory.SERVICE_CHARGE, "", False),
    ("internet", "Internet", IncomeCategory.SERVICE_CHARGE, "", False),
    ("service_charge", "Service charge", IncomeCategory.SERVICE_CHARGE, "", False),
    ("other", "Other charges", IncomeCategory.OTHER_INCOME, "", False),
]


def ensure_default_charge_types(organization) -> list[ChargeType]:
    existing = {ct.code: ct for ct in ChargeType.objects.filter(organization=organization)}
    for code, name, category, utility, system in DEFAULT_CHARGE_TYPES:
        if code in existing:
            continue
        try:
            with transaction.atomic():
                existing[code] = ChargeType.objects.create(
                    organization=organization,
                    code=code,
                    name=name,
                    income_category=category,
                    meter_utility=utility,
                    is_system=system,
                )
        except IntegrityError:  # created concurrently
            existing[code] = ChargeType.objects.get(organization=organization, code=code)
    return list(existing.values())
