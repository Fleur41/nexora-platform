from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import OrganizationScopedModel


class Tenant(OrganizationScopedModel):
    """A person (or business) renting from the organization.

    Tenants are never hard-deleted: their lease and financial history must stay available
    after they move out. Archiving hides them from day-to-day lists.
    """

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        ARCHIVED = "archived", "Archived"

    class IdType(models.TextChoices):
        NATIONAL_ID = "national_id", "National ID"
        PASSPORT = "passport", "Passport"
        ALIEN_ID = "alien_id", "Alien ID"
        COMPANY_REG = "company_registration", "Company registration"
        OTHER = "other", "Other"

    full_name = models.CharField(max_length=200)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=32)
    alternate_phone = models.CharField(max_length=32, blank=True)
    id_type = models.CharField(max_length=24, choices=IdType.choices, default=IdType.NATIONAL_ID)
    id_number = models.CharField(max_length=64, blank=True)
    kra_pin = models.CharField("KRA PIN", max_length=20, blank=True)
    occupation = models.CharField(max_length=120, blank=True)
    employer = models.CharField(max_length=200, blank=True)
    emergency_contact_name = models.CharField(max_length=200, blank=True)
    emergency_contact_phone = models.CharField(max_length=32, blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["full_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "id_type", "id_number"],
                condition=~Q(id_number=""),
                name="tenants_tenant_unique_identity",
            )
        ]
        indexes = [models.Index(fields=["organization", "status"])]

    def __str__(self) -> str:
        return self.full_name
