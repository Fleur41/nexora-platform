from django.conf import settings
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateRangeField, RangeOperators
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import F, Func, Q
from django.db.models.functions import Coalesce

from apps.core.models import OrganizationScopedModel, TimeStampedModel
from apps.core.money import MoneyField


class DateRange(Func):
    """PostgreSQL daterange(lower, upper, '[]'); a NULL upper bound means open-ended."""

    function = "DATERANGE"
    output_field = DateRangeField()

    def __init__(self, lower, upper):
        super().__init__(lower, upper, models.Value("[]"))


class Lease(OrganizationScopedModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ACTIVE = "active", "Active"
        ENDED = "ended", "Ended"
        CANCELLED = "cancelled", "Cancelled"

    class BillingFrequency(models.TextChoices):
        MONTHLY = "monthly", "Monthly"
        QUARTERLY = "quarterly", "Quarterly"
        SEMI_ANNUAL = "semi_annual", "Every 6 months"
        ANNUAL = "annual", "Annually"

    # Leases in these statuses occupy the unit for their date range.
    OCCUPYING_STATUSES = (Status.ACTIVE, Status.ENDED)

    reference = models.CharField(max_length=32, editable=False)
    tenant = models.ForeignKey("tenants.Tenant", on_delete=models.PROTECT, related_name="leases")
    unit = models.ForeignKey("properties.Unit", on_delete=models.PROTECT, related_name="leases")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    start_date = models.DateField()
    end_date = models.DateField(
        null=True, blank=True, help_text="Contractual end date. Empty for a periodic tenancy."
    )
    ended_on = models.DateField(
        null=True, blank=True, help_text="Date the tenancy actually ended (set when closed)."
    )
    billing_frequency = models.CharField(
        max_length=16, choices=BillingFrequency.choices, default=BillingFrequency.MONTHLY
    )
    rent_due_day = models.PositiveSmallIntegerField(
        default=1, validators=[MinValueValidator(1), MaxValueValidator(28)]
    )
    # Agreed deposit; zero means no deposit. Deposit receipts/refunds are tracked in billing.
    deposit_amount = MoneyField(default=0)
    notes = models.TextField(blank=True)
    end_reason = models.CharField(max_length=255, blank=True)
    activated_at = models.DateTimeField(null=True, blank=True)
    activated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-start_date", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "reference"], name="leases_lease_unique_ref"
            ),
            # At most one active lease per unit at any time.
            models.UniqueConstraint(
                fields=["unit"], condition=Q(status="active"), name="leases_one_active_per_unit"
            ),
            # Active and ended leases on the same unit may never overlap in time.
            ExclusionConstraint(
                name="leases_no_overlapping_occupancy",
                expressions=[
                    ("unit", RangeOperators.EQUAL),
                    (
                        DateRange("start_date", Coalesce("ended_on", "end_date")),
                        RangeOperators.OVERLAPS,
                    ),
                ],
                condition=Q(status__in=["active", "ended"]),
            ),
            models.CheckConstraint(
                condition=Q(end_date__isnull=True) | Q(end_date__gte=F("start_date")),
                name="leases_end_after_start",
            ),
            models.CheckConstraint(
                condition=Q(ended_on__isnull=True) | Q(ended_on__gte=F("start_date")),
                name="leases_ended_after_start",
            ),
            models.CheckConstraint(
                condition=Q(rent_due_day__gte=1, rent_due_day__lte=28),
                name="leases_valid_due_day",
            ),
            models.CheckConstraint(
                condition=Q(deposit_amount__gte=0), name="leases_nonnegative_deposit"
            ),
        ]
        indexes = [
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "end_date"]),
        ]

    def __str__(self) -> str:
        return f"{self.reference} · {self.tenant} · {self.unit}"


class LeaseRentTerm(TimeStampedModel):
    """Effective-dated monthly rent for a lease.

    Terms are append-only once a lease is live: a rent change adds a new term from a future
    date instead of editing the old one, so historical periods keep their original rent.
    """

    lease = models.ForeignKey(Lease, on_delete=models.CASCADE, related_name="rent_terms")
    effective_from = models.DateField()
    monthly_rent = MoneyField()
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["effective_from"]
        constraints = [
            models.UniqueConstraint(
                fields=["lease", "effective_from"], name="leases_rentterm_unique_date"
            ),
            models.CheckConstraint(
                condition=Q(monthly_rent__gte=0), name="leases_rentterm_nonnegative"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.lease.reference}: {self.monthly_rent} from {self.effective_from}"
