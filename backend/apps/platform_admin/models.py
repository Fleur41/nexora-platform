from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedModel


class SupportGrantQuerySet(models.QuerySet):
    def active(self):
        return self.filter(ended_at__isnull=True, expires_at__gt=timezone.now())


class SupportGrant(TimeStampedModel):
    """Time-limited, read-only access for a Nexora platform admin to one organization.

    Started with a reason, visible to the organization's owners (notified, and every request
    is in their audit log), and over at `expires_at` or when ended early.
    """

    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.CASCADE, related_name="support_grants"
    )
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    reason = models.CharField(max_length=255)
    expires_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)

    objects = SupportGrantQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.user} → {self.organization} until {self.expires_at:%Y-%m-%d %H:%M}"

    @property
    def is_active(self) -> bool:
        return self.ended_at is None and self.expires_at > timezone.now()
