import uuid

from django.db import models


class TimeStampedModel(models.Model):
    """UUID primary key plus creation/modification timestamps.

    UUIDs keep object identifiers non-sequential so they cannot be enumerated.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class OrganizationScopedQuerySet(models.QuerySet):
    def for_organization(self, organization):
        return self.filter(organization=organization)


class OrganizationScopedModel(TimeStampedModel):
    """Base for every private business record. Always belongs to exactly one organization."""

    organization = models.ForeignKey(
        "organizations.Organization",
        on_delete=models.PROTECT,
        related_name="+",
        db_index=True,
    )

    objects = OrganizationScopedQuerySet.as_manager()

    class Meta:
        abstract = True
