import builtins
import uuid

from django.conf import settings
from django.core.files.storage import storages
from django.db import models
from django.db.models import Q

from apps.core.models import OrganizationScopedModel


def private_storage():
    return storages["private"]


def document_path(instance, filename: str) -> str:
    # Never reuse the client's filename on disk; it is kept only as metadata.
    return f"org/{instance.organization_id}/{uuid.uuid4().hex}{instance.extension}"


def _exactly_one_target() -> Q:
    fields = ("property", "unit", "tenant", "lease", "maintenance_request", "inspection")
    options = [Q(**{f"{f}__isnull": f != chosen for f in fields}) for chosen in fields]
    condition = options[0]
    for option in options[1:]:
        condition |= option
    return condition


class Document(OrganizationScopedModel):
    """A private file attached to exactly one record (property, unit, tenant or lease)."""

    class Category(models.TextChoices):
        PHOTO = "photo", "Photo"
        LEASE_AGREEMENT = "lease_agreement", "Lease agreement"
        IDENTITY = "identity", "Identity document"
        INSPECTION = "inspection", "Inspection report"
        OTHER = "other", "Other"

    category = models.CharField(max_length=24, choices=Category.choices, default=Category.OTHER)
    title = models.CharField(max_length=200)
    file = models.FileField(upload_to=document_path, storage=private_storage, max_length=255)
    original_filename = models.CharField(max_length=255)
    extension = models.CharField(max_length=8)
    content_type = models.CharField(max_length=100)
    size = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)
    property = models.ForeignKey(
        "properties.Property",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="documents",
    )
    unit = models.ForeignKey(
        "properties.Unit", null=True, blank=True, on_delete=models.PROTECT, related_name="documents"
    )
    tenant = models.ForeignKey(
        "tenants.Tenant", null=True, blank=True, on_delete=models.PROTECT, related_name="documents"
    )
    lease = models.ForeignKey(
        "leases.Lease", null=True, blank=True, on_delete=models.PROTECT, related_name="documents"
    )
    maintenance_request = models.ForeignKey(
        "maintenance.MaintenanceRequest",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="documents",
    )
    inspection = models.ForeignKey(
        "inspections.Inspection",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="documents",
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    # Soft delete: the file is kept for the audit trail but hidden from normal lists.
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    TARGET_FIELDS = ("property", "unit", "tenant", "lease", "maintenance_request", "inspection")

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                name="documents_exactly_one_target", condition=_exactly_one_target()
            )
        ]

    def __str__(self) -> str:
        return self.title

    @builtins.property  # `property` is shadowed by the field above
    def target_field(self) -> str:
        return next(f for f in self.TARGET_FIELDS if getattr(self, f"{f}_id"))

    @builtins.property
    def target(self):
        return getattr(self, self.target_field)
