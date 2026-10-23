"""Recording money received and applying it to invoices.

Ledger representation (per lease, see billing.LedgerEntry):

    payment of A, allocated a₁..aₙ to invoices  →  −aᵢ (invoice i) for each allocation,
                                                    −(A − Σaᵢ) (no invoice) = credit held
    credit later applied c to invoice I          →  +c (no invoice), −c (invoice I)
    refund f of credit                           →  +f (no invoice)
    payment reversal                             →  the exact opposite of every entry above

So a lease's balance always equals invoices − credits − payments + refunds, an invoice's amount
due is the sum of its own entries, and "credit held" is the sum of the no-invoice payment
entries. Every movement happens under a lease row lock with an audit event.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from apps.audit.services import record_event
from apps.billing.models import Invoice, LedgerEntry
from apps.billing.services import amount_due
from apps.core.exceptions import BusinessRuleViolation
from apps.core.models import next_reference
from apps.core.money import ZERO, quantize
from apps.leases.models import Lease
from apps.organizations.models import organization_today

from .models import Payment, PaymentAllocation, PaymentConfiguration, PaymentRefund

Entry = LedgerEntry.EntryType


# --- Queries ------------------------------------------------------------------------


def unallocated(payment: Payment) -> Decimal:
    """Part of a payment not yet applied to invoices or refunded (the tenant's credit)."""
    if payment.status != Payment.Status.COMPLETED or payment.lease_id is None:
        return ZERO
    allocated = (
        payment.allocations.filter(is_reversed=False).aggregate(s=Sum("amount"))["s"] or ZERO
    )
    refunded = payment.refunds.aggregate(s=Sum("amount"))["s"] or ZERO
    return quantize(payment.amount - allocated - refunded)


def lease_credit(lease: Lease) -> Decimal:
    total = (
        LedgerEntry.objects.filter(
            lease=lease, payment__isnull=False, invoice__isnull=True
        ).aggregate(s=Sum("amount"))["s"]
        or ZERO
    )
    return quantize(-total)


def open_invoices(lease: Lease) -> list[Invoice]:
    invoices = Invoice.objects.filter(lease=lease, status=Invoice.Status.ISSUED).order_by(
        "due_date", "issue_date", "number"
    )
    return [inv for inv in invoices if amount_due(inv) > 0]


def applicable_configurations(lease: Lease):
    """Enabled payment methods for a lease: the property's own, else organization-wide."""
    today = organization_today(lease.organization)
    configs = (
        PaymentConfiguration.objects.filter(organization=lease.organization, is_enabled=True)
        .exclude(valid_from__gt=today)
        .exclude(valid_to__lt=today)
    )
    property_configs = configs.filter(property_id=lease.unit.property_id)
    return property_configs if property_configs.exists() else configs.filter(property__isnull=True)


# --- Internal helpers -------------------------------------------------------------------


def _lock_lease(lease: Lease) -> Lease:
    return (
        Lease.objects.select_for_update()
        .select_related("tenant", "unit", "organization")
        .get(pk=lease.pk)
    )


def _entry(
    payment: Payment,
    *,
    amount: Decimal,
    entry_type: str,
    invoice=None,
    description: str,
    actor,
    reason="",
) -> LedgerEntry:
    return LedgerEntry.objects.create(
        organization=payment.organization,
        lease=payment.lease,
        tenant=payment.tenant,
        entry_type=entry_type,
        amount=amount,
        invoice=invoice,
        payment=payment,
        reference=payment.receipt_number,
        effective_date=payment.received_on
        if entry_type == Entry.PAYMENT
        else organization_today(payment.organization),
        description=description,
        reason=reason,
        created_by=actor,
    )


def _validate_invoice(payment: Payment, invoice: Invoice) -> None:
    if invoice.organization_id != payment.organization_id or invoice.lease_id != payment.lease_id:
        raise BusinessRuleViolation(f"Invoice {invoice.number} belongs to a different lease.")
    if invoice.status != Invoice.Status.ISSUED:
        raise BusinessRuleViolation(f"Invoice {invoice.number} is void.")


def _plan(payment: Payment, available: Decimal, requested: list[tuple[Invoice, Decimal]] | None):
    """Validate a requested allocation, or build one oldest-due-first."""
    if requested is not None:
        total = ZERO
        plan = []
        for invoice, amount in requested:
            invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
            amount = quantize(amount)
            _validate_invoice(payment, invoice)
            due = amount_due(invoice)
            if amount <= 0:
                raise BusinessRuleViolation("Allocation amounts must be more than zero.")
            if amount > due:
                raise BusinessRuleViolation(f"Invoice {invoice.number} only has {due} due.")
            total += amount
            plan.append((invoice, amount))
        if total > available:
            raise BusinessRuleViolation(
                f"Allocations ({total}) exceed the amount available ({available})."
            )
        return plan
    plan, remaining = [], available
    for invoice in open_invoices(payment.lease):
        if remaining <= 0:
            break
        share = min(remaining, amount_due(invoice))
        plan.append((invoice, share))
        remaining -= share
    return plan


def _post_new_payment(payment: Payment, actor, requested=None) -> None:
    """Ledger entries for a payment just attached to a lease."""
    plan = _plan(payment, payment.amount, requested)
    allocated = ZERO
    for invoice, amount in plan:
        PaymentAllocation.objects.create(
            organization=payment.organization,
            payment=payment,
            invoice=invoice,
            amount=amount,
            created_by=actor,
        )
        _entry(
            payment,
            amount=-amount,
            entry_type=Entry.PAYMENT,
            invoice=invoice,
            description=f"Payment {payment.receipt_number} → {invoice.number}",
            actor=actor,
        )
        allocated += amount
    remainder = payment.amount - allocated
    if remainder > 0:
        _entry(
            payment,
            amount=-remainder,
            entry_type=Entry.PAYMENT,
            description=f"Payment {payment.receipt_number} (credit held)",
            actor=actor,
        )


def _notify_receipt(payment: Payment) -> None:
    from apps.notifications.services import notify, settings_for

    if not settings_for(payment.organization).receipt_notifications:
        return
    currency = payment.organization.currency
    notify(
        organization=payment.organization,
        kind="receipt",
        tenants=[payment.tenant],
        sms=True,
        title=f"Payment received: {currency} {payment.amount:,.2f}",
        body=f"Thank you {payment.tenant.full_name.split()[0]}. "
        f"We received {currency} {payment.amount:,.2f} "
        f"on {payment.received_on:%d %b %Y}. Receipt {payment.receipt_number}.",
        tenant_link=f"/portal/payments/{payment.pk}",
        dedupe_key=f"receipt:{payment.pk}",
    )


# --- Recording ----------------------------------------------------------------------------


@transaction.atomic
def record_payment(
    *,
    request,
    organization,
    amount: Decimal,
    received_on: date,
    method: str,
    lease: Lease | None = None,
    configuration: PaymentConfiguration | None = None,
    reference: str = "",
    external_id: str = "",
    payer_name: str = "",
    payer_phone: str = "",
    account_reference: str = "",
    notes: str = "",
    source: str = Payment.Source.MANUAL,
    statement_import=None,
    allocations: list[tuple[Invoice, Decimal]] | None = None,
    actor=None,
) -> Payment:
    actor = actor if actor is not None else (request.user if request is not None else None)
    amount = quantize(amount)
    if amount <= 0:
        raise BusinessRuleViolation("The amount must be more than zero.")
    if received_on > organization_today(organization):
        raise BusinessRuleViolation("The payment date cannot be in the future.")
    if configuration is not None:
        if configuration.organization_id != organization.pk:
            raise BusinessRuleViolation("That payment method belongs to another organization.")
        method = configuration.method
    if lease is not None:
        if lease.organization_id != organization.pk:
            raise BusinessRuleViolation("That lease belongs to another organization.")
        lease = _lock_lease(lease)
        if lease.status not in Lease.OCCUPYING_STATUSES:
            raise BusinessRuleViolation(
                "Payments can only be recorded against active or ended leases."
            )
    reference = reference.strip().upper()

    try:
        with transaction.atomic():
            payment = Payment.objects.create(
                organization=organization,
                receipt_number=next_reference(organization, "receipt", "RCT", width=5),
                lease=lease,
                tenant=lease.tenant if lease else None,
                method=method,
                configuration=configuration,
                configuration_snapshot=configuration.snapshot() if configuration else {},
                amount=amount,
                received_on=received_on,
                reference=reference,
                external_id=external_id,
                payer_name=payer_name[:150],
                payer_phone=payer_phone[:32],
                account_reference=account_reference[:64],
                notes=notes,
                source=source,
                statement_import=statement_import,
                matched_at=timezone.now() if lease else None,
                created_by=actor,
            )
    except IntegrityError as exc:
        raise BusinessRuleViolation(
            f"A payment with reference {reference} has already been recorded."
            if reference
            else "This transaction has already been recorded."
        ) from exc

    if lease is not None:
        _post_new_payment(payment, actor, allocations)
        if source != Payment.Source.DEPOSIT:
            _notify_receipt(payment)
    record_event(
        request,
        "payment.recorded",
        target=payment,
        organization=organization,
        actor=actor,
        metadata={
            "amount": str(amount),
            "method": method,
            "reference": reference,
            "source": source,
            "lease": lease.reference if lease else None,
        },
    )
    return payment


@transaction.atomic
def match_payment(*, request, payment: Payment, lease: Lease) -> Payment:
    """Attach an unmatched payment (e.g. unknown M-Pesa account) to a lease."""
    payment = Payment.objects.select_for_update().get(pk=payment.pk)
    if payment.status != Payment.Status.COMPLETED:
        raise BusinessRuleViolation("Only completed payments can be matched.")
    if payment.lease_id is not None:
        raise BusinessRuleViolation("This payment is already matched to a lease.")
    if lease.organization_id != payment.organization_id:
        raise BusinessRuleViolation("That lease belongs to another organization.")
    lease = _lock_lease(lease)
    if lease.status not in Lease.OCCUPYING_STATUSES:
        raise BusinessRuleViolation("Payments can only be matched to active or ended leases.")
    payment.lease, payment.tenant = lease, lease.tenant
    payment.matched_at, payment.matched_by = timezone.now(), request.user
    payment.save(update_fields=["lease", "tenant", "matched_at", "matched_by", "updated_at"])
    _post_new_payment(payment, request.user)
    _notify_receipt(payment)
    record_event(request, "payment.matched", target=payment, metadata={"lease": lease.reference})
    return payment


@transaction.atomic
def allocate_credit(
    *,
    request,
    payment: Payment,
    allocations: list[tuple[Invoice, Decimal]] | None = None,
    actor=None,
) -> list[PaymentAllocation]:
    """Apply a payment's held credit to invoices (given, or oldest due first)."""
    actor = actor if actor is not None else (request.user if request is not None else None)
    lease = _lock_lease(payment.lease)
    payment = Payment.objects.select_for_update().get(pk=payment.pk)
    available = unallocated(payment)
    if available <= 0:
        return []
    created = []
    for invoice, amount in _plan(payment, available, allocations):
        allocation = PaymentAllocation.objects.create(
            organization=payment.organization,
            payment=payment,
            invoice=invoice,
            amount=amount,
            created_by=actor,
        )
        _entry(
            payment,
            amount=amount,
            entry_type=Entry.ALLOCATION,
            description=f"Credit from {payment.receipt_number} applied",
            actor=actor,
        )
        _entry(
            payment,
            amount=-amount,
            entry_type=Entry.ALLOCATION,
            invoice=invoice,
            description=f"Credit from {payment.receipt_number} → {invoice.number}",
            actor=actor,
        )
        created.append(allocation)
    if created:
        record_event(
            request,
            "payment.credit_applied",
            target=payment,
            organization=lease.organization,
            actor=actor,
            metadata={
                "invoices": [a.invoice.number for a in created],
                "amount": str(sum(a.amount for a in created)),
            },
        )
    return created


def apply_available_credit(*, request, lease: Lease, actor=None) -> int:
    """Use any credit held on a lease to pay its open invoices (oldest first)."""
    applied = 0
    for payment in Payment.objects.filter(lease=lease, status=Payment.Status.COMPLETED).order_by(
        "received_on", "created_at"
    ):
        if unallocated(payment) > 0 and open_invoices(lease):
            applied += len(allocate_credit(request=request, payment=payment, actor=actor))
    return applied


# --- Corrections ---------------------------------------------------------------------------


@transaction.atomic
def reverse_payment(*, request, payment: Payment, reason: str) -> Payment:
    """Undo a payment entirely (e.g. bounced cheque, recorded twice, wrong tenant)."""
    if not reason.strip():
        raise BusinessRuleViolation("Give a reason for reversing the payment.")
    if payment.lease_id:
        _lock_lease(payment.lease)
    payment = Payment.objects.select_for_update().get(pk=payment.pk)
    if payment.status == Payment.Status.REVERSED:
        raise BusinessRuleViolation("This payment is already reversed.")
    if payment.refunds.exists():
        raise BusinessRuleViolation(
            "Credit from this payment has been refunded; it can't be reversed."
        )
    for entry in list(payment.ledger_entries.all()):
        LedgerEntry.objects.create(
            organization=entry.organization,
            lease=entry.lease,
            tenant=entry.tenant,
            entry_type=Entry.PAYMENT_REVERSAL,
            amount=-entry.amount,
            invoice=entry.invoice,
            payment=payment,
            reference=payment.receipt_number,
            effective_date=organization_today(payment.organization),
            description=f"Reversal of {entry.description}"[:255],
            reason=reason.strip(),
            created_by=request.user,
        )
    payment.allocations.update(is_reversed=True)
    payment.status = Payment.Status.REVERSED
    payment.reversed_at, payment.reversed_by = timezone.now(), request.user
    payment.reversal_reason = reason.strip()
    payment.save()
    record_event(
        request,
        "payment.reversed",
        target=payment,
        metadata={
            "amount": str(payment.amount),
            "reference": payment.reference,
            "reason": payment.reversal_reason,
        },
    )
    return payment


@transaction.atomic
def refund_credit(
    *,
    request,
    payment: Payment,
    amount: Decimal,
    refunded_on: date,
    method: str,
    reference: str,
    reason: str,
) -> PaymentRefund:
    if not reason.strip():
        raise BusinessRuleViolation("Give a reason for the refund.")
    if payment.lease_id is None:
        raise BusinessRuleViolation("Match the payment to a lease first, or reverse it.")
    _lock_lease(payment.lease)
    payment = Payment.objects.select_for_update().get(pk=payment.pk)
    amount = quantize(amount)
    available = unallocated(payment)
    if amount <= 0:
        raise BusinessRuleViolation("The refund must be more than zero.")
    if amount > available:
        raise BusinessRuleViolation(f"Only {available} of this payment is unallocated credit.")
    if refunded_on > organization_today(payment.organization):
        raise BusinessRuleViolation("The refund date cannot be in the future.")
    refund = PaymentRefund.objects.create(
        organization=payment.organization,
        payment=payment,
        amount=amount,
        refunded_on=refunded_on,
        method=method,
        reference=reference.strip(),
        reason=reason.strip(),
        created_by=request.user,
    )
    _entry(
        payment,
        amount=amount,
        entry_type=Entry.REFUND,
        description=f"Refund of credit from {payment.receipt_number}",
        actor=request.user,
        reason=refund.reason,
    )
    record_event(
        request,
        "payment.refunded",
        target=payment,
        metadata={"amount": str(amount), "reference": refund.reference, "reason": refund.reason},
    )
    return refund
