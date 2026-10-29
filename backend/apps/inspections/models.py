from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import OrganizationScopedModel, TimeStampedModel
from apps.core.money import MoneyField

DEFAULT_CHECKLIST = {
    "Entrance": ["Door and locks", "Keys", "Walls and paint"],
    "Living room": ["Walls and paint", "Floor", "Windows", "Lights and sockets"],
    "Kitchen": ["Sink and taps", "Cabinets", "Worktops", "Walls and paint"],
    "Bedroom(s)": ["Walls and paint", "Floor", "Windows", "Wardrobes"],
    "Bathroom": ["Toilet", "Shower / bath", "Sink and taps", "Tiles"],
    "Utilities": ["Water meter", "Electricity meter", "Water heater"],
}


class Inspection(OrganizationScopedModel):
    class Kind(models.TextChoices):
        MOVE_IN = "move_in", "Move-in"
        MOVE_OUT = "move_out", "Move-out"
        ROUTINE = "routine", "Routine"

    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    reference = models.CharField(max_length=32, editable=False)
    unit = models.ForeignKey(
        "properties.Unit", on_delete=models.PROTECT, related_name="inspections"
    )
    lease = models.ForeignKey(
        "leases.Lease", null=True, blank=True, on_delete=models.PROTECT, related_name="inspections"
    )
    kind = models.CharField(max_length=16, choices=Kind.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SCHEDULED)
    scheduled_for = models.DateField()
    inspector = models.ForeignKey(
        "organizations.Membership",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="inspections",
    )
    summary = models.TextField(blank=True)
    keys_returned = models.PositiveSmallIntegerField(null=True, blank=True)
    tenant_present = models.BooleanField(default=False)
    tenant_signature_name = models.CharField(max_length=150, blank=True)
    inspector_signature_name = models.CharField(max_length=150, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-scheduled_for", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "reference"], name="inspections_unique_ref"
            )
        ]

    def __str__(self) -> str:
        return f"{self.reference} · {self.get_kind_display()} · {self.unit}"


class InspectionItem(TimeStampedModel):
    class Condition(models.TextChoices):
        NOT_CHECKED = "not_checked", "Not checked"
        GOOD = "good", "Good"
        FAIR = "fair", "Fair"
        POOR = "poor", "Poor"
        DAMAGED = "damaged", "Damaged"
        MISSING = "missing", "Missing"

    inspection = models.ForeignKey(Inspection, on_delete=models.CASCADE, related_name="items")
    area = models.CharField(max_length=60)
    name = models.CharField(max_length=100)
    condition = models.CharField(
        max_length=16, choices=Condition.choices, default=Condition.NOT_CHECKED
    )
    notes = models.CharField(max_length=500, blank=True)
    # Proposed charge against the deposit for damage found (move-out only).
    charge_amount = MoneyField(default=0)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "created_at"]
        constraints = [
            models.CheckConstraint(
                name="inspections_item_charge_nonnegative", condition=Q(charge_amount__gte=0)
            )
        ]

    def __str__(self) -> str:
        return f"{self.area}: {self.name}"
