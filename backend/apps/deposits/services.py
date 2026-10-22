"""Security deposit movements. Held deposits are money owed back to the tenant."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from django.db import transaction

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.core.money import ZERO, quantize
from apps.leases.models import Lease
from apps.organizations.models import organization_today

from .models import DepositTransaction

Kind = DepositTransaction.Kind


@dataclass
class DepositSummary:
    agreed: Decimal
    received: Decimal
    deducted: Decimal
    refunded: Decimal

    @property
    def held(self) -> Decimal:
        return self.received - self.deducted - self.refunded

    @property
    def outstanding(self) -> Decimal:
        return max(self.agreed - self.received, ZERO)


def summarize(lease: Lease) -> DepositSummary:
    totals = {Kind.RECEIVED: ZERO, Kind.DEDUCTION: ZERO, Kind.REFUND: ZERO}
    for tx in DepositTransaction.objects.filter(lease=lease).select_related("reverses"):
        if tx.kind == Kind.REVERSAL:
            totals[tx.reverses.kind] -= tx.amount
        else:
            totals[tx.kind] += tx.amount
    return DepositSummary(
        agreed=quantize(lease.deposit_amount),
        received=totals[Kind.RECEIVED],
        deducted=totals[Kind.DEDUCTION],
        refunded=totals[Kind.REFUND],
    )


def _lock(lease: Lease) -> Lease:
    return Lease.objects.select_for_update().get(pk=lease.pk)


@transaction.atomic
def record(
    *,
    request,
    lease: Lease,
    kind: str,
    amount: Decimal,
    transaction_date: date,
    method: str = "",
    reference: str = "",
    reason: str = "",
) -> DepositTransaction:
    lease = _lock(lease)
    amount = quantize(amount)
    if kind == Kind.REVERSAL:
        raise BusinessRuleViolation("Use the reverse action to undo a transaction.")
    if lease.status == Lease.Status.CANCELLED:
        raise BusinessRuleViolation("This lease was cancelled.")
    if amount <= 0:
        raise BusinessRuleViolation("The amount must be more than zero.")
    if transaction_date > organization_today(lease.organization):
        raise BusinessRuleViolation("The date cannot be in the future.")
    summary = summarize(lease)
    if kind in (Kind.DEDUCTION, Kind.REFUND):
        if not reason.strip():
            raise BusinessRuleViolation("Give a reason for this deduction or refund.")
        if amount > summary.held:
            raise BusinessRuleViolation(f"Only {summary.held} of the deposit is held.")
    tx = DepositTransaction.objects.create(
        organization=lease.organization,
        lease=lease,
        kind=kind,
        amount=amount,
        transaction_date=transaction_date,
        method=method,
        reference=reference,
        reason=reason.strip(),
        created_by=request.user,
    )
    record_event(
        request,
        f"deposit.{kind}",
        target=lease,
        metadata={"amount": str(amount), "reference": reference, "reason": tx.reason},
    )
    return tx


@transaction.atomic
def reverse(*, request, original: DepositTransaction, reason: str) -> DepositTransaction:
    lease = _lock(original.lease)
    original = DepositTransaction.objects.select_related("reverses").get(pk=original.pk)
    if original.kind == Kind.REVERSAL:
        raise BusinessRuleViolation("A reversal cannot itself be reversed.")
    if DepositTransaction.objects.filter(reverses=original).exists():
        raise BusinessRuleViolation("This transaction has already been reversed.")
    if not reason.strip():
        raise BusinessRuleViolation("Give a reason for the reversal.")
    if original.kind == Kind.RECEIVED and summarize(lease).held - original.amount < 0:
        raise BusinessRuleViolation(
            "Reversing this receipt would leave a negative deposit. Reverse the deductions or "
            "refunds made from it first."
        )
    tx = DepositTransaction.objects.create(
        organization=lease.organization,
        lease=lease,
        kind=Kind.REVERSAL,
        amount=original.amount,
        transaction_date=organization_today(lease.organization),
        reason=reason.strip(),
        reverses=original,
        created_by=request.user,
    )
    record_event(
        request,
        "deposit.reversal",
        target=lease,
        metadata={
            "reverses": str(original.pk),
            "kind": original.kind,
            "amount": str(original.amount),
            "reason": tx.reason,
        },
    )
    return tx
