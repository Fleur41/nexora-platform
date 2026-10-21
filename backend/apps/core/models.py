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


class OrganizationSequence(models.Model):
    """Gap-tolerant, per-organization counters for human-readable references.

    Rows are locked with SELECT ... FOR UPDATE, so concurrent requests never get the
    same number. Used for property, lease, and (later) invoice and receipt numbers.
    """

    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.CASCADE, related_name="+"
    )
    key = models.CharField(max_length=32)
    last_value = models.PositiveBigIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["organization", "key"], name="core_sequence_unique")
        ]

    def __str__(self) -> str:
        return f"{self.key}: {self.last_value}"


def next_reference(organization, key: str, prefix: str, width: int = 4) -> str:
    """Return the next reference like 'LSE-0007'. Must run inside a transaction."""
    from django.db import transaction

    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError("next_reference() must be called inside transaction.atomic()")
    sequence, _ = OrganizationSequence.objects.get_or_create(organization=organization, key=key)
    sequence = OrganizationSequence.objects.select_for_update().get(pk=sequence.pk)
    sequence.last_value += 1
    sequence.save(update_fields=["last_value"])
    return f"{prefix}-{sequence.last_value:0{width}d}"
