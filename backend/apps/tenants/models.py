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
    # Tenant portal login. A tenant record is linked to at most one user account, which
    # can only ever see this tenant's own records (see apps.portal).
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="tenancies",
    )

    class Meta:
        ordering = ["full_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "id_type", "id_number"],
                condition=~Q(id_number=""),
                name="tenants_tenant_unique_identity",
            ),
            models.UniqueConstraint(
                fields=["organization", "user"],
                condition=Q(user__isnull=False),
                name="tenants_one_tenant_per_user_per_org",
            ),
        ]
        indexes = [models.Index(fields=["organization", "status"])]

    def __str__(self) -> str:
        return self.full_name


class PortalInvitation(OrganizationScopedModel):
    """Invites a tenant to the tenant portal. Only the token's hash is stored."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        REVOKED = "revoked", "Revoked"

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="portal_invitations")
    email = models.EmailField()
    token_hash = models.CharField(max_length=64, unique=True, editable=False)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    expires_at = models.DateTimeField()
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    accepted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant"],
                condition=Q(status="pending"),
                name="tenants_one_pending_portal_invite",
            )
        ]

    def __str__(self) -> str:
        return f"Portal invitation for {self.tenant}"
