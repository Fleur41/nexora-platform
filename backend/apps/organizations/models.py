import hashlib
import secrets

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower
from django.utils import timezone

from apps.core.models import TimeStampedModel
from apps.core.modules import registry

from .roles import DEFAULT_ACCESS_SCOPE, AccessScope, Role


class Organization(TimeStampedModel):
    """A customer of Nexora (e.g. a landlord or property management company)."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        SUSPENDED = "suspended", "Suspended"

    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=80, unique=True)
    legal_name = models.CharField(max_length=255, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=32, blank=True)
    address = models.CharField(max_length=255, blank=True)
    country = models.CharField(max_length=2, default="KE", help_text="ISO 3166-1 alpha-2")
    currency = models.CharField(max_length=3, default="KES", help_text="ISO 4217")
    timezone = models.CharField(max_length=64, default="Africa/Nairobi")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class Membership(TimeStampedModel):
    """Grants a user a role inside one organization. Never hard-deleted (history matters)."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        SUSPENDED = "suspended", "Suspended"
        REMOVED = "removed", "Removed"

    organization = models.ForeignKey(
        Organization, on_delete=models.PROTECT, related_name="memberships"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="memberships"
    )
    role = models.CharField(max_length=32, choices=Role.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    # Blank means "use the role's default" and is resolved on save.
    access_scope = models.CharField(max_length=16, choices=AccessScope.choices, blank=True)
    extra_permissions = models.JSONField(default=list, blank=True)
    revoked_permissions = models.JSONField(default=list, blank=True)
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    joined_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "user"], name="organizations_membership_unique_user"
            ),
            models.CheckConstraint(
                condition=Q(role__in=Role.values), name="organizations_membership_valid_role"
            ),
        ]
        indexes = [models.Index(fields=["user", "status"])]

    def __str__(self) -> str:
        return f"{self.user} @ {self.organization} ({self.role})"

    def save(self, *args, **kwargs):
        if not self.access_scope:
            self.access_scope = DEFAULT_ACCESS_SCOPE[self.role]
        if self.role == Role.OWNER:
            self.access_scope = AccessScope.ORGANIZATION
        super().save(*args, **kwargs)

    @property
    def has_organization_scope(self) -> bool:
        return self.is_owner or self.access_scope == AccessScope.ORGANIZATION

    @property
    def is_owner(self) -> bool:
        return self.role == Role.OWNER

    @property
    def capabilities(self) -> set[str]:
        if self.status != self.Status.ACTIVE:
            return set()
        if self.is_owner:
            return {c.key for c in registry.capabilities()}
        granted = registry.role_defaults(self.role) | set(self.extra_permissions)
        granted -= set(self.revoked_permissions)
        return {key for key in granted if registry.has_capability(key)}

    def has_capability(self, key: str) -> bool:
        return key in self.capabilities


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Invitation(TimeStampedModel):
    """An emailed invitation to join an organization. Only the token's hash is stored."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        REVOKED = "revoked", "Revoked"

    organization = models.ForeignKey(
        Organization, on_delete=models.PROTECT, related_name="invitations"
    )
    email = models.EmailField()
    role = models.CharField(max_length=32, choices=Role.choices)
    token_hash = models.CharField(max_length=64, unique=True, editable=False)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    expires_at = models.DateTimeField()
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    accepted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    accepted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                "organization",
                Lower("email"),
                condition=Q(status="pending"),
                name="organizations_invitation_one_pending_per_email",
            ),
        ]

    def __str__(self) -> str:
        return f"Invitation for {self.email} to {self.organization}"

    @property
    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    @property
    def is_usable(self) -> bool:
        return self.status == self.Status.PENDING and not self.is_expired

    def issue_token(self) -> str:
        """Generate a fresh secret token; returns the plaintext (never persisted)."""
        token = secrets.token_urlsafe(32)
        self.token_hash = hash_token(token)
        return token


def organization_today(organization: Organization):
    """Today's date in the organization's own timezone (not the server's)."""
    from zoneinfo import ZoneInfo

    return timezone.localdate(timezone=ZoneInfo(organization.timezone))
