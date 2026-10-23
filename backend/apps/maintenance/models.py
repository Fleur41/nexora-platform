from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import OrganizationScopedModel, TimeStampedModel
from apps.core.money import MoneyField


class MaintenanceRequest(OrganizationScopedModel):
    class Category(models.TextChoices):
        PLUMBING = "plumbing", "Plumbing"
        ELECTRICAL = "electrical", "Electrical"
        STRUCTURAL = "structural", "Structural"
        SECURITY = "security", "Security / locks"
        APPLIANCE = "appliance", "Appliance"
        PEST = "pest", "Pest control"
        CLEANING = "cleaning", "Cleaning"
        OTHER = "other", "Other"

    class Urgency(models.TextChoices):
        LOW = "low", "Low"
        NORMAL = "normal", "Normal"
        HIGH = "high", "High"
        EMERGENCY = "emergency", "Emergency"

    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        ACKNOWLEDGED = "acknowledged", "Acknowledged"
        IN_PROGRESS = "in_progress", "In progress"
        ON_HOLD = "on_hold", "On hold"
        RESOLVED = "resolved", "Resolved"
        CLOSED = "closed", "Closed"
        CANCELLED = "cancelled", "Cancelled"

    class Source(models.TextChoices):
        TENANT = "tenant", "Tenant (portal)"
        STAFF = "staff", "Staff"
        INSPECTION = "inspection", "Inspection"

    OPEN_STATUSES = (Status.SUBMITTED, Status.ACKNOWLEDGED, Status.IN_PROGRESS, Status.ON_HOLD)
    TRANSITIONS = {
        Status.SUBMITTED: {Status.ACKNOWLEDGED, Status.IN_PROGRESS, Status.CANCELLED},
        Status.ACKNOWLEDGED: {
            Status.IN_PROGRESS,
            Status.ON_HOLD,
            Status.RESOLVED,
            Status.CANCELLED,
        },
        Status.IN_PROGRESS: {Status.ON_HOLD, Status.RESOLVED},
        Status.ON_HOLD: {Status.IN_PROGRESS, Status.RESOLVED, Status.CANCELLED},
        Status.RESOLVED: {Status.CLOSED, Status.IN_PROGRESS},
        Status.CLOSED: set(),
        Status.CANCELLED: set(),
    }

    reference = models.CharField(max_length=32, editable=False)
    unit = models.ForeignKey(
        "properties.Unit", on_delete=models.PROTECT, related_name="maintenance_requests"
    )
    lease = models.ForeignKey(
        "leases.Lease", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    tenant = models.ForeignKey(
        "tenants.Tenant",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="maintenance_requests",
    )
    source = models.CharField(max_length=16, choices=Source.choices)
    category = models.CharField(max_length=16, choices=Category.choices)
    title = models.CharField(max_length=160)
    description = models.TextField()
    urgency = models.CharField(max_length=16, choices=Urgency.choices, default=Urgency.NORMAL)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SUBMITTED)
    assigned_to = models.ForeignKey(
        "organizations.Membership",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_maintenance",
    )
    scheduled_for = models.DateField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    reported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "reference"], name="maintenance_unique_ref"
            ),
        ]
        indexes = [models.Index(fields=["organization", "status"])]

    def __str__(self) -> str:
        return f"{self.reference} · {self.title}"


class MaintenanceUpdate(TimeStampedModel):
    """A note on a request. Internal notes are never shown to tenants."""

    request = models.ForeignKey(
        MaintenanceRequest, on_delete=models.CASCADE, related_name="updates"
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    author_name = models.CharField(max_length=150)
    from_tenant = models.BooleanField(default=False)
    body = models.TextField(blank=True)
    is_internal = models.BooleanField(default=False)
    status_from = models.CharField(max_length=16, blank=True)
    status_to = models.CharField(max_length=16, blank=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"Update on {self.request.reference}"


class MaintenanceCost(OrganizationScopedModel):
    """A quotation or an incurred cost. Visible only with maintenance.costs."""

    class Kind(models.TextChoices):
        QUOTATION = "quotation", "Quotation"
        EXPENSE = "expense", "Cost incurred"

    class Status(models.TextChoices):
        PENDING = "pending", "Awaiting approval"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        RECORDED = "recorded", "Recorded"

    request = models.ForeignKey(MaintenanceRequest, on_delete=models.PROTECT, related_name="costs")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    supplier_name = models.CharField(max_length=150, blank=True)
    description = models.CharField(max_length=255)
    amount = MoneyField()
    status = models.CharField(max_length=16, choices=Status.choices)
    incurred_on = models.DateField(null=True, blank=True)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.CheckConstraint(name="maintenance_cost_positive", condition=Q(amount__gt=0))
        ]

    def __str__(self) -> str:
        return f"{self.get_kind_display()} {self.amount} on {self.request.reference}"
