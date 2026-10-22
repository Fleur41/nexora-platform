from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import OrganizationScopedModel


class Meter(OrganizationScopedModel):
    class Utility(models.TextChoices):
        WATER = "water", "Water"
        ELECTRICITY = "electricity", "Electricity"
        GAS = "gas", "Gas"

    unit = models.ForeignKey("properties.Unit", on_delete=models.PROTECT, related_name="meters")
    utility = models.CharField(max_length=16, choices=Utility.choices)
    number = models.CharField(max_length=64, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["unit__property__name", "unit__number", "utility"]
        constraints = [
            # One active meter per utility per unit. Replaced meters are deactivated, not deleted.
            models.UniqueConstraint(
                fields=["unit", "utility"],
                condition=Q(is_active=True),
                name="utilities_one_active_meter",
            )
        ]

    def __str__(self) -> str:
        return f"{self.get_utility_display()} meter · {self.unit}"


class MeterReading(OrganizationScopedModel):
    """A cumulative meter reading. Usage is the difference between consecutive readings and
    is billed once: the line that billed it is recorded on the later reading."""

    meter = models.ForeignKey(Meter, on_delete=models.PROTECT, related_name="readings")
    reading_date = models.DateField()
    value = models.DecimalField(max_digits=14, decimal_places=3)
    is_estimate = models.BooleanField(default=False)
    note = models.CharField(max_length=255, blank=True)
    invoice_line = models.ForeignKey(
        "billing.InvoiceLine",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="meter_readings",
    )
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["meter", "reading_date"]
        constraints = [
            models.UniqueConstraint(
                fields=["meter", "reading_date"], name="utilities_one_reading_per_day"
            ),
            models.CheckConstraint(name="utilities_reading_nonnegative", condition=Q(value__gte=0)),
        ]

    def __str__(self) -> str:
        return f"{self.meter} · {self.reading_date}: {self.value}"
