from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import OrganizationScopedModel
from apps.core.money import MoneyField


class DepositTransaction(OrganizationScopedModel):
    """Movements of a lease's security deposit. A deposit held is a liability owed back to
    the tenant, never income, so it lives in its own ledger separate from rent.

    held = received − deductions − refunds (reversals undo a specific earlier entry).
    """

    class Kind(models.TextChoices):
        RECEIVED = "received", "Received"
        DEDUCTION = "deduction", "Deduction"
        REFUND = "refund", "Refund"
        REVERSAL = "reversal", "Reversal"

    class Method(models.TextChoices):
        CASH = "cash", "Cash"
        MPESA = "mpesa", "M-Pesa"
        BANK = "bank", "Bank transfer"
        CHEQUE = "cheque", "Cheque"
        OTHER = "other", "Other"
        NOT_APPLICABLE = "", "Not applicable"

    lease = models.ForeignKey(
        "leases.Lease", on_delete=models.PROTECT, related_name="deposit_transactions"
    )
    kind = models.CharField(max_length=16, choices=Kind.choices)
    amount = MoneyField()
    transaction_date = models.DateField()
    method = models.CharField(max_length=16, choices=Method.choices, blank=True, default="")
    reference = models.CharField(max_length=64, blank=True)
    reason = models.CharField(max_length=255, blank=True)
    reverses = models.OneToOneField(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="reversed_by"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["transaction_date", "created_at"]
        constraints = [
            models.CheckConstraint(name="deposits_positive_amount", condition=Q(amount__gt=0)),
            models.CheckConstraint(
                name="deposits_reversal_links_original",
                condition=Q(kind="reversal", reverses__isnull=False)
                | (~Q(kind="reversal") & Q(reverses__isnull=True)),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.get_kind_display()} {self.amount} · {self.lease_id}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise PermissionError("Deposit transactions are immutable; record a reversal instead.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PermissionError("Deposit transactions are immutable; record a reversal instead.")
