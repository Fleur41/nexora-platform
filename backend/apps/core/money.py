"""Money conventions shared by every module.

Amounts are Decimal with 2 decimal places (max 999,999,999,999.99). Never use float.
Rounding is ROUND_HALF_UP at line level; totals are sums of rounded lines.
"""

from decimal import ROUND_HALF_UP, Decimal

from django.core.validators import MinValueValidator
from django.db import models

CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def quantize(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


class MoneyField(models.DecimalField):
    """Non-negative monetary amount."""

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("max_digits", 14)
        kwargs.setdefault("decimal_places", 2)
        kwargs.setdefault("validators", [MinValueValidator(ZERO)])
        super().__init__(*args, **kwargs)

    def deconstruct(self):
        name, path, args, kwargs = super().deconstruct()
        for key, default in (("max_digits", 14), ("decimal_places", 2)):
            if kwargs.get(key) == default:
                kwargs.pop(key)
        kwargs.pop("validators", None)
        return name, path, args, kwargs
